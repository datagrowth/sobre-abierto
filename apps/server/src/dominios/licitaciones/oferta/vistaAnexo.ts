// Vista de un anexo que rellenó Hermes en «Revisar lo que hizo Hermes», para revisarlo sin abrir el Word.
import fsp from 'node:fs/promises';
import type { Router } from 'express';
import { z } from 'zod';
import { fallo, invalido, responder } from '../../../nucleo/http.js';
import { conQuien } from '../../../nucleo/permisos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type AppError, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { formularioDePdf } from '../../../nucleo/documentos/formularioPdf.js';
import { localizarHuecos } from '../../../nucleo/documentos/rellenar.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import type { Db } from '../store.js';
import { conClave } from './anexosTrabajo.js';
import { leerPlan, type PlanAnexoData } from './anexoPlan.js';
import { cambiarDocumento, filaDocumento, type DocumentoOferta, type FilaDocumento } from './documentos.js';
import { cerrarTarjetas, tarjetasDe, USUARIO_POR_DEFECTO, type Tarjeta } from './revisionHermes.js';

const log = logger('licitaciones');

// Muestra su texto con cada valor resaltado y el dato de la hoja del que sale. Los valores se sitúan con el plan
// guardado al rellenarlo (oferta_documentos.sustituciones, anexoPlan.ts) y se marca el que cambió frente a la
// versión anterior del archivo. Aceptar deja el documento «preparado» y cierra su tarjeta; los de acreditación,
// uno a uno.
type ValorResaltado = { desde: number; hasta: number; dato: string; valor: string; cambiado: boolean };
type ParrafoVista = { n: number; texto: string; valores: ValorResaltado[] };
type CampoVista = { nombre: string; dato: string; valor: string; cambiado: boolean };
export type VistaAnexo = {
  clave: string;
  nombre: string;
  version: number;
  formato: 'docx' | 'pdf';
  parrafos: ParrafoVista[] | null;
  campos: CampoVista[] | null;
  avisos: string[];
  acreditacion: boolean;
};

export const AVISO_SIN_PLAN =
  'Este borrador es anterior al registro de valores: se ve el texto, pero sin resaltar lo que puso Hermes.';
const SIN_VERSION_ANTERIOR = 'Es la primera versión del anexo: no hay nada con que comparar.';
const VERSION = /-v(\d+)\.(docx|pdf)$/i;
// Cuánto texto alrededor de un valor sirve para encontrarlo en la versión anterior.
const CONTEXTO = 16;

// ── Lectura de los archivos ─────────────────────────────────────────────────────────────────────

async function leerArchivo(raices: Raices, ruta: string): Promise<Result<Buffer>> {
  const abs = documentoEnDisco(raices, ruta);
  if (abs.error) return abs;
  try {
    return ok(await fsp.readFile(abs.data));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return fail('not_found', `El borrador ya no está en Salidas (${ruta}).`);
    return fail('io_error', `No se pudo leer el borrador: ${errorMessage(err).slice(0, 200)}`);
  }
}

const versionDe = (ruta: string): number => Number(VERSION.exec(ruta)?.[1] ?? 1);

// La versión anterior es el mismo nombre con -v(n-1): escribirAnexo nunca pisa una versión.
async function anterior(raices: Raices, ruta: string): Promise<Buffer | null> {
  const v = versionDe(ruta);
  if (v <= 1 || !VERSION.test(ruta)) return null;
  const r = await leerArchivo(
    raices,
    ruta.replace(VERSION, (_m, _n, ext: string) => `-v${v - 1}.${ext}`),
  );
  return r.error ? null : r.data;
}

// ── Word: párrafos con los valores situados ─────────────────────────────────────────────────────

type ParrafoTexto = { indice: number; texto: string };
type ItemWord = Extract<PlanAnexoData, { formato: 'docx' }>['items'][number];

function parrafosDe(docx: Uint8Array): Result<ParrafoTexto[]> {
  const h = localizarHuecos(docx);
  return h.error ? h : ok(h.data.parrafos.map((p) => ({ indice: p.indice, texto: p.texto })));
}

/** Lo que el plan cambió de verdad en el trozo: sin el principio ni el final que comparte con el original. */
function tramoNuevo(original: string, nuevo: string): { inicio: number; fin: number } {
  let pre = 0;
  while (pre < original.length && pre < nuevo.length && original[pre] === nuevo[pre]) pre += 1;
  let suf = 0;
  while (suf < original.length - pre && suf < nuevo.length - pre && original.at(-1 - suf) === nuevo.at(-1 - suf))
    suf += 1;
  return { inicio: pre, fin: nuevo.length - suf };
}

// El borrador es el rango del modelo extraído: el párrafo del plan se busca primero donde debería caer y luego alrededor.
function porCercania(parrafos: ParrafoTexto[], esperado: number): ParrafoTexto[] {
  return [...parrafos].sort(
    (a, b) => Math.abs(a.indice - esperado) - Math.abs(b.indice - esperado) || a.indice - b.indice,
  );
}

function situar(
  parrafos: ParrafoTexto[],
  item: ItemWord,
  desdeModelo: number,
  usados: Map<number, number>,
): { n: number; v: Omit<ValorResaltado, 'cambiado'> } | null {
  const t = tramoNuevo(item.original, item.nuevo);
  if (t.fin <= t.inicio) return null;
  for (const p of porCercania(parrafos, item.parrafo - desdeModelo + 1)) {
    const pos = p.texto.indexOf(item.nuevo, usados.get(p.indice) ?? 0);
    if (pos === -1) continue;
    usados.set(p.indice, pos + item.nuevo.length);
    return {
      n: p.indice,
      v: { desde: pos + t.inicio, hasta: pos + t.fin, dato: item.dato, valor: item.nuevo.slice(t.inicio, t.fin) },
    };
  }
  return null;
}

/** El valor que había en el mismo sitio de la versión anterior del párrafo (null si no se reconoce el sitio). */
function valorAnterior(
  previo: string,
  texto: string,
  v: { desde: number; hasta: number },
  limites: { izq: number; der: number },
): string | null {
  const pre = texto.slice(Math.max(limites.izq, v.desde - CONTEXTO), v.desde);
  const suf = texto.slice(v.hasta, Math.min(limites.der, v.hasta + CONTEXTO));
  const i = pre ? previo.indexOf(pre) : 0;
  if (i === -1) return null;
  const j = suf ? previo.indexOf(suf, i + pre.length) : previo.length;
  return j === -1 ? null : previo.slice(i + pre.length, j);
}

// Sin versión anterior no ha cambiado nada; con ella, cambia el valor distinto o el párrafo que ya no se reconoce.
function marcarCambios(p: ParrafoVista, previo: Map<number, string> | null): ParrafoVista {
  if (!previo) return p;
  const antes = previo.get(p.n);
  const valores = [...p.valores]
    .sort((a, b) => a.desde - b.desde)
    .map((v, i, todos) => {
      if (antes === undefined) return { ...v, cambiado: true };
      const limites = { izq: todos[i - 1]?.hasta ?? 0, der: todos[i + 1]?.desde ?? p.texto.length };
      const viejo = valorAnterior(antes, p.texto, v, limites);
      return { ...v, cambiado: viejo === null ? antes !== p.texto : viejo !== v.valor };
    });
  return { ...p, valores };
}

function parrafosVista(
  parrafos: ParrafoTexto[],
  plan: PlanAnexoData | null,
  previo: Map<number, string> | null,
): ParrafoVista[] {
  const porN = new Map(
    parrafos.map((p): [number, ParrafoVista] => [p.indice, { n: p.indice, texto: p.texto, valores: [] }]),
  );
  if (plan?.formato === 'docx') {
    const usados = new Map<number, number>();
    for (const item of plan.items) {
      const s = situar(parrafos, item, plan.desde, usados);
      if (s) porN.get(s.n)!.valores.push({ ...s.v, cambiado: false });
    }
  }
  return [...porN.values()].map((p) => marcarCambios(p, previo));
}

async function vistaWord(
  raices: Raices,
  f: FilaDocumento & { ruta: string },
  plan: PlanAnexoData | null,
): Promise<Result<Pick<VistaAnexo, 'parrafos' | 'avisos'>>> {
  const bytes = await leerArchivo(raices, f.ruta);
  if (bytes.error) return bytes;
  const parrafos = parrafosDe(bytes.data);
  if (parrafos.error) return fail('invalid_input', `No se puede leer el borrador: ${parrafos.error.message}`);
  const viejo = await anterior(raices, f.ruta);
  const previo = viejo ? parrafosDe(viejo) : null;
  const mapa = previo && !previo.error ? new Map(previo.data.map((p) => [p.indice, p.texto])) : null;
  const vista = parrafosVista(parrafos.data, plan, mapa);
  const perdidos = plan?.formato === 'docx' ? plan.items.length - vista.reduce((n, p) => n + p.valores.length, 0) : 0;
  const avisos =
    perdidos > 0
      ? [`${perdidos} valor(es) del registro ya no están en el texto del borrador: alguien lo editó después.`]
      : [];
  return ok({ parrafos: vista, avisos: mapa ? avisos : [...avisos, SIN_VERSION_ANTERIOR] });
}

// ── PDF con formulario: los campos guardados ────────────────────────────────────────────────────

const comoTexto = (v: string | boolean | null): string => (typeof v === 'boolean' ? (v ? 'Sí' : 'No') : (v ?? ''));

async function valoresPdf(bytes: Buffer | null): Promise<Map<string, string> | null> {
  if (!bytes) return null;
  const f = await formularioDePdf(bytes);
  return f.error ? null : new Map(f.data.campos.map((c) => [c.nombre, comoTexto(c.valor)]));
}

async function vistaPdf(
  raices: Raices,
  f: FilaDocumento & { ruta: string },
  plan: PlanAnexoData | null,
): Promise<Result<Pick<VistaAnexo, 'campos' | 'avisos'>>> {
  const actuales = await valoresPdf((await leerArchivo(raices, f.ruta)).data ?? null);
  const previos = await valoresPdf(await anterior(raices, f.ruta));
  // Sin plan, lo que se ve es lo rellenado en el PDF, sin saber de qué dato de la hoja salió.
  const base =
    plan?.formato === 'pdf'
      ? plan.campos.map((c) => ({ nombre: c.nombre, dato: c.dato, valor: comoTexto(c.valor) }))
      : [...(actuales ?? new Map<string, string>())]
          .filter(([, v]) => v !== '')
          .map(([nombre, valor]) => ({ nombre, dato: '', valor }));
  if (!plan && !actuales) return fail('invalid_input', 'No se pueden leer los campos del borrador en PDF.');
  const campos = base.map((c) => ({ ...c, cambiado: previos !== null && (previos.get(c.nombre) ?? '') !== c.valor }));
  return ok({ campos, avisos: previos ? [] : [SIN_VERSION_ANTERIOR] });
}

// ── Vista ───────────────────────────────────────────────────────────────────────────────────────

// La tarjeta de la bandeja ya sabe si el anexo acredita un criterio: se usa la misma regla.
function tarjetaDe(db: Db, id: string, f: FilaDocumento, quien = USUARIO_POR_DEFECTO): Tarjeta | null {
  return tarjetasDe(db, id, quien).find((t) => t.clave === `anexo:${f.clave}:${f.anexo_en}`) ?? null;
}

function borradorDe(db: Db, id: string, clave: string): Result<FilaDocumento & { ruta: string }> {
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const f = filaDocumento(db, id, clave);
  if (!f || f.oculto || f.anexo_en === null || f.ruta === null)
    return fail('not_found', `«${clave}» no tiene ningún borrador que rellenara Hermes.`);
  return ok({ ...f, ruta: f.ruta });
}

/** El borrador del anexo con sus valores resaltados (Word) o sus campos (PDF con formulario). */
async function vistaAnexo(db: Db, raices: Raices, id: string, clave: string): Promise<Result<VistaAnexo>> {
  const f = borradorDe(db, id, clave);
  if (f.error) return f;
  const plan = leerPlan(f.data.sustituciones);
  const formato = plan?.formato ?? (f.data.ruta.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx');
  const cabecera = {
    clave,
    nombre: f.data.nombre,
    version: versionDe(f.data.ruta),
    formato,
    acreditacion: tarjetaDe(db, id, f.data)?.acreditacion ?? false,
  };
  const sinPlan = plan ? [] : [AVISO_SIN_PLAN];
  if (formato === 'pdf') {
    const p = await vistaPdf(raices, f.data, plan);
    return p.error
      ? p
      : ok({ ...cabecera, parrafos: null, campos: p.data.campos, avisos: [...sinPlan, ...p.data.avisos] });
  }
  const w = await vistaWord(raices, f.data, plan);
  return w.error
    ? w
    : ok({ ...cabecera, parrafos: w.data.parrafos, campos: null, avisos: [...sinPlan, ...w.data.avisos] });
}

// ── Aceptar ─────────────────────────────────────────────────────────────────────────────────────

type AnexosAceptados = { documentos: DocumentoOferta[] };
type Elegido = { f: FilaDocumento; tarjeta: Tarjeta | null };

function elegidos(db: Db, id: string, claves: string[], quien: string): Result<Elegido[]> {
  const out: Elegido[] = [];
  for (const clave of claves) {
    const f = borradorDe(db, id, clave);
    if (f.error) return f;
    if (f.data.estado !== 'borrador')
      return fail('conflicto', `«${f.data.nombre}» ya está ${f.data.estado.replace('_', ' ')}.`);
    out.push({ f: f.data, tarjeta: tarjetaDe(db, id, f.data, quien) });
  }
  if (out.length > 1 && out.some((e) => e.tarjeta?.acreditacion))
    return fail('invalid_input', 'Los anexos de acreditación se aceptan uno a uno.');
  return ok(out);
}

// Un paso que falla dentro de la transacción la deshace entera y su error sale tal cual.
class Revertir extends Error {
  constructor(readonly fallo: AppError) {
    super(fallo.message);
  }
}

// Primero se cierran las tarjetas (con el documento ya preparado dejan de salir) y luego cambia cada fila; todo o nada.
function aplicar(db: Db, id: string, es: Elegido[], quien: string): DocumentoOferta[] {
  const pendientes = es.flatMap((e) => (e.tarjeta?.estado === 'pendiente' ? [e.tarjeta.clave] : []));
  return db.transaction(() => {
    const c = pendientes.length ? cerrarTarjetas(db, id, pendientes, { accion: 'aceptar', quien }) : ok([]);
    if (c.error) throw new Revertir(c.error);
    return es.map((e) => {
      const d = cambiarDocumento(db, id, e.f.clave, { estado: 'preparado' });
      if (d.error) throw new Revertir(d.error);
      return d.data;
    });
  })();
}

/** Da por buenos los borradores: cada uno queda «preparado» y su tarjeta, cerrada para la oferta. */
function aceptarAnexos(db: Db, id: string, claves: string[], quien: string): Result<AnexosAceptados> {
  const es = elegidos(db, id, [...new Set(claves)], quien);
  if (es.error) return es;
  try {
    const documentos = aplicar(db, id, es.data, quien);
    log.info('anexos aceptados', { licitacion: id, claves: documentos.map((d) => d.clave).join(', ') });
    return ok({ documentos });
  } catch (err) {
    if (err instanceof Revertir) return fail(err.fallo.code, err.fallo.message);
    log.error('anexos sin aceptar', { licitacion: id, error: errorMessage(err) });
    return fail('io_error', 'No se pudieron aceptar los anexos.');
  }
}

// ── API web ─────────────────────────────────────────────────────────────────────────────────────

const AceptarAnexos = z.strictObject({
  claves: z.array(z.string().min(4).max(80)).min(1).max(60),
  quien: z.string().trim().min(2).max(60).optional(),
});

export function rutasVistaAnexo(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/documentos/:clave/vista',
    conId(
      conClave((id, clave, _req, res) => {
        vistaAnexo(dbLicitaciones(), raicesActuales(), id, clave).then(
          (x) => responder(res, x),
          fallo(res, 'vista del anexo', 'licitaciones'),
        );
      }),
    ),
  );
  r.post(
    '/licitaciones/:id/oferta/documentos/aceptar',
    conId((id, req, res) => {
      const e = AceptarAnexos.safeParse(conQuien(req));
      if (!e.success) return invalido(res, e.error);
      responder(res, aceptarAnexos(dbLicitaciones(), id, e.data.claves, e.data.quien ?? USUARIO_POR_DEFECTO));
    }),
  );
}
