// Regenera por código el anexo cuyo dato cambió, a partir del plan con que se rellenó (anexoPlan.ts).
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { pdfDeDocx } from '../../../nucleo/documentos/libreoffice.js';
import { rellenarPdf } from '../../../nucleo/documentos/formularioPdf.js';
import { diferenciasFueraDelPlan, extraerParrafos, rellenarDocx } from '../../../nucleo/documentos/rellenar.js';
import { emitir } from '../../../nucleo/eventos.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { encolar } from '../../../nucleo/trabajos.js';
import { textoComparable } from '../temas.js';
import { leerPlan, valorDeHoja, type PlanAnexoData } from './anexoPlan.js';
import { archivoDeAnexo, carpetaAnexos, escribirAnexo, type Escrito } from './anexosGuardado.js';
import { AVISO_EDITADO, editadoPorPersona, PREFIJO_ANTERIOR, soloPrecio } from './anexosAuto.js';
import { modeloDe, modeloDocx } from './anexosModelo.js';
import { modeloParaPedir, transcritoDe } from './anexosModeloPdf.js';
import { TIPO_ANEXO, trabajoAnexo } from './anexosTrabajo.js';
import type { ContextoAnexo } from './anexosPedir.js';
import { decisionesDe } from './decisiones.js';
import { cambiosEntre, SeccionesAnexo, seccionesDeAnexo } from './dependenciasAnexo.js';
import { frenoSeguro } from './frenoElegibilidad.js';
import { documentoDelGuion, filaDocumento, type DocumentoConClave, type FilaDocumento } from './documentos.js';
import { guionVigente } from './guion.js';
import { hojaDeDatos, type HojaDatos } from './hojaDatos.js';
import { guardaPlazo, licitacionesEnPreparacion } from './plazo.js';

const log = logger('licitaciones');
// Si después cambia ese dato en la hoja (el precio del lote, el NIF o el domicilio del perfil), se vuelve a
// rellenar el modelo con el valor nuevo: 0 runs, segundos y un -vN nuevo que nunca pisa el anterior (alguien
// pudo corregirlo o firmarlo). Ante la duda —el valor viejo no está, o está dos veces, en el texto rellenado, o
// el modelo cambió— no se marca como regenerado: vuelve a Hermes.
export const ESTRUCTURA_NUEVA = 'estructura_nueva';
const PREFIJO_REGENERADO = 'Regenerado por código el ';
const PREFIJO_SIN_REGENERAR = 'No se pudo regenerar por código';
const MARCA_CORRECCIONES = 'tenía correcciones tuyas y no se ha tocado';

/** Un hueco (Word) o campo (PDF) cuyo dato de la hoja ya no es el que se usó al rellenarlo. */
export type CambioHueco = {
  dato: string;
  antes: string | null;
  despues: string | null;
  parrafo?: number;
  campo?: string;
};

const normal = (t: string | null) => (t === null ? null : textoComparable(t).replace(/\s+/g, ' ').trim());
const distinto = (a: string | null, b: string | null) => normal(a) !== normal(b);

/** Los huecos del plan cuyo valor de la hoja (la del lote del plan) difiere del usado al rellenar. Puro. */
export function cambiosDeHoja(plan: PlanAnexoData, hoja: HojaDatos): CambioHueco[] {
  if (plan.formato === 'docx') {
    return plan.items.flatMap((i) => {
      const ahora = valorDeHoja(hoja, i.dato);
      return distinto(i.valor, ahora) ? [{ dato: i.dato, antes: i.valor, despues: ahora, parrafo: i.parrafo }] : [];
    });
  }
  return plan.campos.flatMap((c) => {
    const ahora = valorDeHoja(hoja, c.dato);
    return distinto(c.valor_hoja, ahora)
      ? [{ dato: c.dato, antes: c.valor_hoja, despues: ahora, campo: c.nombre }]
      : [];
  });
}

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// La cifra con que empieza un valor de la oferta («98,50 € por hora» → «98,50»): el agente suele
// escribir solo la cifra, porque el modelo ya dice «euros».
const cifraDe = (t: string) => /^\d[\d.]*(?:,\d+)?/.exec(t)?.[0] ?? null;

// Sustituye `antes` por `despues` si aparece exactamente una vez (y una cifra, sin ser parte de otra mayor).
function sustituirUnaVez(texto: string, antes: string, despues: string): string | null {
  const pares: [string, string][] = [[antes, despues]];
  const [a, b] = [cifraDe(antes), cifraDe(despues)];
  if (a && b && a !== antes) pares.push([a, b]);
  for (const [viejo, nuevo] of pares) {
    const re = new RegExp(`(?<![\\d.,])${escapar(viejo)}(?![\\d]|[.,]\\d)`, 'g');
    const veces = texto.match(re)?.length ?? 0;
    if (veces > 1) return null;
    if (veces === 1) return texto.replace(re, () => nuevo);
  }
  return null;
}

function aplicar(texto: string, c: CambioHueco): string | null {
  if (!c.antes?.trim() || !c.despues?.trim()) return null;
  return sustituirUnaVez(texto, c.antes, c.despues);
}

const sinEncajar = (c: CambioHueco) =>
  fail<PlanAnexoData>(
    ESTRUCTURA_NUEVA,
    `«${c.dato}» no se puede cambiar por código: el valor anterior no está (o está más de una vez) en lo que se rellenó.`,
  );

/**
 * El plan con los valores nuevos: `antes` → `despues` en el texto rellenado (`nuevo`, Word) o en el
 * valor del campo (PDF). Falla con «estructura_nueva» si `antes` (o `despues`) es null o vacío, o
 * no aparece literal una sola vez. Puro.
 */
export function planRegenerado(plan: PlanAnexoData, cambios: CambioHueco[]): Result<PlanAnexoData> {
  if (plan.formato === 'docx') {
    const items: typeof plan.items = [];
    for (const i of plan.items) {
      const c = cambios.find((x) => x.parrafo === i.parrafo && x.dato === i.dato);
      const nuevo = c ? aplicar(i.nuevo, c) : i.nuevo;
      if (c && nuevo === null) return sinEncajar(c);
      items.push(c ? { ...i, nuevo: nuevo!, valor: c.despues } : i);
    }
    return ok({ ...plan, items });
  }
  const campos: typeof plan.campos = [];
  for (const x of plan.campos) {
    const c = cambios.find((y) => y.campo === x.nombre && y.dato === x.dato);
    const valor = c && typeof x.valor === 'string' ? aplicar(x.valor, c) : c ? null : x.valor;
    if (c && valor === null) return sinEncajar(c);
    campos.push(c ? { ...x, valor: valor!, valor_hoja: c.despues } : x);
  }
  return ok({ ...plan, campos });
}

// ── Regenerar un anexo ──

type Base = { f: FilaDocumento; plan: PlanAnexoData; d: DocumentoConClave };
// frenada: la oferta está frenada por elegibilidad: se regenera por código, pero no se pide a Hermes.
type Paso = Base & { c: ContextoAnexo; id: string; cambios: CambioHueco[]; ahoraMs: number; frenada: boolean };
type Relleno = { docx: Buffer | null; pdf: Buffer | null; avisos: string[] };

// Solo un anexo que rellenó Hermes, con su plan, a la vista y que sigue en el guion vigente.
function baseDe(c: ContextoAnexo, id: string, clave: string): Base | null {
  const f = filaDocumento(c.db, id, clave);
  if (!f || f.oculto || f.estado === 'no_aplica' || f.anexo_en === null || f.ruta === null) return null;
  const plan = leerPlan(f.sustituciones);
  const g = plan ? guionVigente(c.db, id) : null;
  const d = g ? documentoDelGuion(g.datos, clave) : null;
  return plan && d ? { f, plan, d } : null;
}

const estructuraNueva = (motivo: string) => fail<Relleno>(ESTRUCTURA_NUEVA, motivo);
const otroModelo = (p: Paso, abs: string) => p.f.anexo_modelo !== null && p.f.anexo_modelo !== abs;

// El Word que se rellena: el modelo .docx (o su conversión) o, si el modelo es un PDF sin formulario,
// la transcripción que se hizo de él (los párrafos del plan son los de esa transcripción).
async function modeloWord(p: Paso): Promise<Result<{ bytes: Buffer; abs: string }>> {
  const tipo = modeloDe(p.c.db, p.c.raices, p.id, p.d);
  if (tipo.error || tipo.data.ext !== '.pdf') return modeloDocx(p.c.db, p.c.raices, p.id, p.d);
  const ruta = await modeloParaPedir(p.c.db, p.c.raices, p.id, p.d);
  if (ruta.error || !transcritoDe(p.c.db, ruta.data)) return fail(ESTRUCTURA_NUEVA, 'El modelo ahora es un PDF.');
  try {
    return ok({ bytes: await fsp.readFile(ruta.data), abs: ruta.data });
  } catch (err) {
    return fail('io_error', `No se pudo leer la transcripción del modelo: ${errorMessage(err)}`);
  }
}

async function rellenarWord(p: Paso, plan: Extract<PlanAnexoData, { formato: 'docx' }>): Promise<Result<Relleno>> {
  const m = await modeloWord(p);
  if (m.error) return m;
  if (otroModelo(p, m.data.abs)) return estructuraNueva('El modelo del guion cambió.');
  const subs = plan.items.map(({ parrafo, original, nuevo }) => ({ parrafo, original, nuevo }));
  const r = rellenarDocx(m.data.bytes, subs);
  if (r.error) return estructuraNueva(r.error.message);
  if (r.data.noEncontradas.length || diferenciasFueraDelPlan(m.data.bytes, r.data.docx, r.data.aplicadas).length)
    return estructuraNueva('El modelo ya no casa con el plan guardado.');
  const docx = extraerParrafos(r.data.docx, plan.desde, plan.hasta);
  if (docx.error) return estructuraNueva(docx.error.message);
  const pdf = await pdfDeDocx(docx.data);
  return ok({ docx: docx.data, pdf: pdf.pdf, avisos: pdf.aviso ? [pdf.aviso] : [] });
}

async function rellenarFormulario(p: Paso, plan: Extract<PlanAnexoData, { formato: 'pdf' }>): Promise<Result<Relleno>> {
  const m = modeloDe(p.c.db, p.c.raices, p.id, p.d);
  if (m.error) return m;
  if (m.data.ext !== '.pdf' || otroModelo(p, m.data.abs)) return estructuraNueva('El modelo del guion cambió.');
  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(m.data.abs);
  } catch (err) {
    return fail('io_error', `No se pudo leer el modelo: ${errorMessage(err)}`);
  }
  const r = await rellenarPdf(
    bytes,
    plan.campos.map(({ nombre, valor }) => ({ nombre, valor })),
  );
  if (r.error || r.data.no_encontrados.length) return estructuraNueva('El formulario ya no casa con el plan guardado.');
  return ok({ docx: null, pdf: r.data.pdf, avisos: [] });
}

type Regenerado = { escrito: Escrito; plan: PlanAnexoData; avisos: string[] };

async function rellenarDeNuevo(p: Paso): Promise<Result<Regenerado>> {
  const plan = planRegenerado(p.plan, p.cambios);
  if (plan.error) return plan;
  const r = plan.data.formato === 'docx' ? await rellenarWord(p, plan.data) : await rellenarFormulario(p, plan.data);
  if (r.error) return r;
  const l = p.c.db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(p.id) as {
    id: string;
    expediente: string;
  };
  const w = escribirAnexo(p.c.raices, carpetaAnexos(l), archivoDeAnexo(p.d), { docx: r.data.docx, pdf: r.data.pdf });
  return w.error ? w : ok({ escrito: w.data, plan: plan.data, avisos: r.data.avisos });
}

// Una frase por dato: el mismo dato en dos huecos cuenta una vez.
function frases(cambios: CambioHueco[]): string {
  const vistas = new Set<string>();
  return cambios
    .flatMap((c) => {
      const t = `«${c.dato}» pasó de «${c.antes ?? '(vacío)'}» a «${c.despues ?? '(vacío)'}»`;
      if (vistas.has(t)) return [];
      vistas.add(t);
      return [t];
    })
    .join('; ');
}

const versionDe = (ruta: string | null) => Number(/-v(\d+)\.(?:docx|pdf)$/i.exec(ruta ?? '')?.[1] ?? NaN);
const tenia = (a: string) =>
  a.startsWith(PREFIJO_ANTERIOR) ||
  a === AVISO_EDITADO ||
  a.startsWith(PREFIJO_REGENERADO) ||
  a.startsWith(PREFIJO_SIN_REGENERAR) ||
  a.includes(MARCA_CORRECCIONES);

// Los avisos de la fila que siguen valiendo, más el de la regeneración y, si había correcciones de una persona, el de pasarlas.
function avisosRegenerado(p: Paso, r: Regenerado): string[] {
  const h = horaLocalEspana(p.ahoraMs);
  const que = `${PREFIJO_REGENERADO}${h.slice(8, 10)}/${h.slice(5, 7)} a las ${h.slice(11, 16)}: ${frases(p.cambios)}.`;
  const anterior = Number.isFinite(versionDe(p.f.ruta)) ? versionDe(p.f.ruta) : r.escrito.version - 1;
  const corregido = p.f.estado === 'preparado' || editadoPorPersona(p.c.raices, p.f);
  const correcciones = corregido
    ? [`La v${anterior} anterior ${MARCA_CORRECCIONES}: pásalas a la v${r.escrito.version} si siguen valiendo.`]
    : [];
  const siguen = (JSON.parse(p.f.avisos) as string[]).filter((a) => !tenia(a));
  return [...siguen, ...r.avisos, que, ...correcciones];
}

// Lo que lleva de las decisiones: si solo cambió el precio, el anexo nuevo ya lleva el de ahora;
// si cambió algo más (equipo, criterios), se queda lo anterior para que la cadena lo siga viendo.
function dependenciasTras(p: Paso): string | null {
  const crudo = p.f.anexo_dependencias ?? null;
  const dec = decisionesDe(p.c.db, p.id);
  if (!crudo || !dec) return crudo;
  let antes: ReturnType<typeof SeccionesAnexo.safeParse>;
  try {
    antes = SeccionesAnexo.safeParse(JSON.parse(crudo));
  } catch {
    return crudo;
  }
  const ahora = seccionesDeAnexo(p.d.doc.tipo, p.d.lote, dec.datos);
  return antes.success && soloPrecio(cambiosEntre(antes.data, ahora, p.d.lote)) ? JSON.stringify(ahora) : crudo;
}

function guardarRegenerado(p: Paso, r: Regenerado): { version: number; cambios: CambioHueco[] } {
  const ts = new Date().toISOString();
  const { ruta, ruta_pdf, version } = r.escrito;
  p.c.db
    .prepare(
      `UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, ruta_pdf = ?, avisos = ?, anexo_en = ?, actualizado_en = ?, anexo_dependencias = ?,
    sustituciones = ?, cambios_huecos = ? WHERE licitacion_id = ? AND clave = ?`,
    )
    .run(
      ruta,
      ruta_pdf,
      JSON.stringify(avisosRegenerado(p, r)),
      ts,
      ts,
      dependenciasTras(p),
      JSON.stringify(r.plan),
      JSON.stringify(p.cambios),
      p.id,
      p.f.clave,
    );
  emitir(p.c.db, {
    tipo: 'licitacion.documentos',
    dominio: 'licitaciones',
    recurso: p.id,
    datos: { accion: 'anexo_regenerado', clave: p.f.clave, version, cambios: p.cambios.length },
  });
  log.info('anexo regenerado por código', { licitacion: p.id, clave: p.f.clave, version, cambios: p.cambios.length });
  return { version, cambios: p.cambios };
}

// ── Cuando no se puede: vuelve a Hermes ──

function avisarSinRegenerar(p: Paso): void {
  const aviso = `${PREFIJO_SIN_REGENERAR}: ${frases(p.cambios)}. Rehazlo con «Rellenar con Hermes».`;
  const avisos = JSON.parse(p.f.avisos) as string[];
  if (avisos.includes(aviso)) return;
  const otros = avisos.filter((a) => !a.startsWith(PREFIJO_SIN_REGENERAR));
  p.c.db
    .prepare('UPDATE oferta_documentos SET avisos = ? WHERE licitacion_id = ? AND clave = ?')
    .run(JSON.stringify([...otros, aviso]), p.id, p.f.clave);
}

// El modelo listo para el run, el mismo que pediría una persona: el PDF con campos, el .docx (o la
// conversión del .doc) o la transcripción de un PDF sin formulario.
async function modeloParaRun(p: Paso): Promise<string | null> {
  const ruta = await modeloParaPedir(p.c.db, p.c.raices, p.id, p.d);
  return ruta.error ? null : ruta.data;
}

// Una vez por cambio y por anexo recibido: si el run falla, no se vuelve a pedir en cada vuelta.
const claveRun = (p: Paso) =>
  `anexo-auto-${p.id}-${p.f.clave}-hoja-${crypto.createHash('sha256').update(JSON.stringify(p.cambios)).digest('hex').slice(0, 12)}-tras-${p.f.anexo_en}`;

// El run de siempre, si se puede: ni lo dio por bueno una persona ni lo corrigió, y da tiempo antes del plazo.
async function volverAPedir(p: Paso, motivo: string): Promise<void> {
  log.info('anexo sin regenerar por código: vuelve a Hermes', { licitacion: p.id, clave: p.f.clave, motivo });
  const tocado = p.f.estado === 'preparado' || editadoPorPersona(p.c.raices, p.f);
  const modelo =
    tocado || p.frenada || guardaPlazo(p.c.db, p.id, 'anexo', { ahoraMs: p.ahoraMs }).error
      ? null
      : await modeloParaRun(p);
  if (!modelo) {
    avisarSinRegenerar(p);
    return;
  }
  p.c.db
    .prepare('UPDATE oferta_documentos SET anexo_modelo = ? WHERE licitacion_id = ? AND clave = ?')
    .run(modelo, p.id, p.f.clave);
  const dec = decisionesDe(p.c.db, p.id);
  const dependencias = dec ? seccionesDeAnexo(p.d.doc.tipo, p.d.lote, dec.datos) : undefined;
  const payload = { id: p.id, clave: p.f.clave, pedida_en: new Date(p.ahoraMs).toISOString(), dependencias };
  encolar(p.c.dbNucleo, { tipo: TIPO_ANEXO, dominio: 'licitaciones', clave: claveRun(p), payload });
}

/**
 * Regenera por código el anexo cuyo dato de la hoja cambió: null si no tiene plan, no cambió nada
 * o hay un run suyo en marcha. Si el plan no encaja con lo nuevo, lo pide a Hermes y da null.
 */
async function regenerarAnexo(
  c: ContextoAnexo,
  id: string,
  clave: string,
  ahoraMs: number,
  frenada = false,
): Promise<Result<{ version: number; cambios: CambioHueco[] } | null>> {
  const base = baseDe(c, id, clave);
  if (!base) return ok(null);
  const hoja = hojaDeDatos(c.db, c.dbNucleo, id, { lote: base.plan.lote });
  if (hoja.error) return hoja;
  const cambios = cambiosDeHoja(base.plan, hoja.data);
  if (!cambios.length || trabajoAnexo(c.db, id, clave)) return ok(null);
  const p: Paso = { ...base, c, id, cambios, ahoraMs, frenada };
  const r = await rellenarDeNuevo(p);
  if (r.error?.code === ESTRUCTURA_NUEVA) {
    await volverAPedir(p, r.error.message);
    return ok(null);
  }
  return r.error ? r : ok(guardarRegenerado(p, r.data));
}

/** En cada vuelta: los anexos con plan (ni ocultos ni «no aplica») de las licitaciones en preparación. */
export async function regenerarAnexosPorCodigo(c: ContextoAnexo, ahoraMs = Date.now()): Promise<number> {
  if (!c.raices.salidas) return 0;
  let n = 0;
  for (const l of licitacionesEnPreparacion(c.db, ahoraMs)) {
    const filas = c.db
      .prepare(
        "SELECT clave FROM oferta_documentos WHERE licitacion_id = ? AND sustituciones IS NOT NULL AND oculto = 0 AND estado <> 'no_aplica'",
      )
      .all(l.id) as { clave: string }[];
    if (!filas.length) continue;
    const frenada = frenoSeguro(c.db, c.dbNucleo, l.id, ahoraMs).frenada;
    for (const f of filas) {
      const r = await regenerarAnexo(c, l.id, f.clave, ahoraMs, frenada);
      if (r.error) log.warn('anexo sin regenerar', { licitacion: l.id, clave: f.clave, error: r.error.message });
      else if (r.data) n += 1;
    }
  }
  return n;
}
