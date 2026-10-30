// El DEUC de la oferta preparado por código: DEUC-vN.xml en Salidas/…/anexos, para importarlo en el servicio DEUC.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { DatosEspdEntrada, respuestaEspd, type DatosEspd } from '../../../nucleo/documentos/espdRespuesta.js';
import { leerPerfilEmpresa, municipioDe, type PerfilEmpresaData } from '../../../nucleo/empresa.js';
import { emitir } from '../../../nucleo/eventos.js';
import { fallo, responder } from '../../../nucleo/http.js';
import { validarConfig } from '../../../nucleo/config.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import type { Db } from '../store.js';
import { conClave } from './anexosTrabajo.js';
import { destinoDe, type ContextoAnexo } from './anexosPedir.js';
import { editadoPorPersona } from './anexosAuto.js';
import { comprobacionesDe } from './comprobaciones.js';
import { decisionesDe, lotesDecididos } from './decisiones.js';
import { enumerar } from './dependenciasAnexo.js';
import { documentosDe, filaDocumento, sincronizarDocumentos, type FilaDocumento } from './documentos.js';
import { guionVigente } from './guion.js';
import { licitacionesEnPreparacion } from './plazo.js';

const log = logger('licitaciones');

// Sale de la petición que publica el órgano (el pliego marcado «deuc») y del perfil de la empresa; Hermes no lo
// genera: 0 runs. Lleva lo que se sabe sin preguntar (empresa, representante, lotes, PYME, volumen de negocio);
// los motivos de exclusión los responde una persona en el servicio. Nunca lleva precio: el DEUC va en el
// sobre A. La huella va por partes para decir qué cambió cuando ya está importado. Va detrás de
// LICITACIONES_DEUC_XML=1 hasta validar a mano que el servicio lo importa.
/** Interruptor del DEUC en XML (config.licitaciones.deucXml): apagado salvo LICITACIONES_DEUC_XML=1 (el servicio DEUC aún no lo ha importado de verdad). Una config inválida lo deja apagado. */
export function deucXmlActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return validarConfig(env).data?.licitaciones.deucXml ?? false;
}

const DEUC_APAGADO =
  'El DEUC en XML está desactivado en el servidor hasta comprobar que el servicio DEUC lo importa (LICITACIONES_DEUC_XML=1 lo activa): rellénalo en el servicio DEUC.';
const PREFIJO_DEUC_ANTERIOR = 'El DEUC es anterior a';
const AVISO_DEUC_EDITADO =
  'El DEUC tiene cambios tuyos: no se rehace solo. Si cambió algo que lleva, vuelve a prepararlo.';
const MAX_PETICION = 20 * 1024 * 1024;

const Preguntas = z.array(z.object({ codigo: z.string(), nombre: z.string() }));
type Pregunta = z.infer<typeof Preguntas>[number];

// ── Datos de la empresa ──

function domicilioDe(p: PerfilEmpresaData): DatosEspd['operador']['domicilio'] {
  if (p.direccion)
    return { calle: p.direccion.calle, cp: p.direccion.codigo_postal, municipio: p.direccion.municipio, pais: 'ES' };
  const texto = p.domicilio?.trim();
  if (!texto) return null;
  const cp = /\b\d{5}\b/.exec(texto);
  const calle = (cp ? texto.slice(0, cp.index) : texto).replace(/[\s,]+$/, '');
  return { calle: calle || texto, cp: cp?.[0] ?? null, municipio: municipioDe(texto), pais: 'ES' };
}

const pymeDe = (t: PerfilEmpresaData['tamano']): boolean | null => (t === null ? null : t !== 'grande');

function operadorDe(p: PerfilEmpresaData): DatosEspd['operador'] {
  return {
    nombre: p.nombre,
    nif: p.nif,
    domicilio: domicilioDe(p),
    email: p.contacto?.email ?? null,
    telefono: p.contacto?.telefono ?? null,
    pyme: pymeDe(p.tamano),
  };
}

/** Lo que el DEUC declara de la empresa y de la oferta: perfil y lotes decididos. Sin NIF o sin domicilio, «conflicto» con lo que falta. */
export function datosEspdDe(dbNucleo: DbNucleo, dbLic: Db, id: string): Result<DatosEspd> {
  const perfil = leerPerfilEmpresa(dbNucleo)?.perfil ?? null;
  const operador = perfil ? operadorDe(perfil) : null;
  const faltan = [...(operador?.nif ? [] : ['NIF']), ...(operador?.domicilio ? [] : ['domicilio'])];
  if (!perfil || !operador || faltan.length)
    return fail(
      'conflicto',
      `Faltan datos de la empresa para el DEUC: ${faltan.join(', ')}. Complétalos en Ajustes › Empresa.`,
    );
  const lotes = lotesDecididos(dbLic, id, decisionesDe(dbLic, id)?.datos.lotes ?? []);
  const datos = DatosEspdEntrada.safeParse({
    operador,
    lotes: [...lotes].sort(),
    representante: perfil.representante
      ? { nombre: perfil.representante.nombre, nif: perfil.representante.nif, cargo: perfil.representante.cargo }
      : null,
    volumen_negocio: perfil.volumen_negocio.map((v) => ({ anio: v.anio, importe: v.importe })),
  });
  if (!datos.success)
    return fail(
      'conflicto',
      `Los datos de la empresa no valen para el DEUC (${datos.error.issues[0]?.path.join('.') ?? ''}): revísalos en Ajustes › Empresa.`,
    );
  return ok(datos.data);
}

// ── La petición del órgano ──

type Peticion = { ruta: string; texto: string; sha256: string };

/** La petición del DEUC entre los pliegos (tipo «deuc»): la más reciente si hay varias. Ruta en Conocimiento. */
export function peticionDeuc(db: Db, id: string): { ruta: string } | null {
  const f = db
    .prepare(
      "SELECT ruta FROM pliegos WHERE licitacion_id = ? AND tipo = 'deuc' AND estado = 'descargado' AND ruta IS NOT NULL ORDER BY actualizado_en DESC LIMIT 1",
    )
    .get(id) as { ruta: string } | undefined;
  return f ? { ruta: `Conocimiento/${f.ruta}` } : null;
}

// Una petición en Latin-1 se pasa a texto y se declara UTF-8: la respuesta se escribe en UTF-8.
function textoDePeticion(bytes: Buffer): string {
  const declarada =
    /^<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(bytes.subarray(0, 200).toString('latin1'))?.[1]?.toLowerCase() ??
    'utf-8';
  if (declarada === 'utf-8' || declarada === 'utf8') return bytes.toString('utf8').replace(/^\uFEFF/, '');
  const texto = new TextDecoder(
    declarada === 'iso-8859-1' || declarada === 'latin1' ? 'windows-1252' : declarada,
  ).decode(bytes);
  return texto.replace(/^(<\?xml[^>]*encoding=["'])[^"']+/i, '$1UTF-8');
}

function leerPeticion(db: Db, raices: Raices, id: string): Result<Peticion> {
  const p = peticionDeuc(db, id);
  if (!p)
    return fail('conflicto', 'No hay petición del DEUC (Deuc.xml) entre los pliegos: rellénalo en el servicio DEUC.');
  const abs = documentoEnDisco(raices, p.ruta);
  if (abs.error) return abs;
  try {
    if (fs.statSync(abs.data).size > MAX_PETICION)
      return fail('invalid_input', 'La petición del DEUC es demasiado grande.');
    const bytes = fs.readFileSync(abs.data);
    return ok({
      ruta: p.ruta,
      texto: textoDePeticion(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } catch (err) {
    return fail('io_error', `No se pudo leer la petición del DEUC: ${errorMessage(err).slice(0, 200)}`);
  }
}

// ── Huella por partes ──

const PARTES = [
  'la petición del órgano',
  'los datos de la empresa',
  'el representante',
  'los lotes',
  'el volumen de negocio',
] as const;
const corta = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

/** Huella de lo que lleva el DEUC: cambiar el enfoque o el precio no la cambia; el domicilio o los lotes, sí. */
export function huellaDeuc(peticionSha256: string, d: DatosEspd): string {
  return [
    peticionSha256.slice(0, 16),
    corta(d.operador),
    corta(d.representante),
    corta([...d.lotes].sort()),
    corta(d.volumen_negocio),
  ].join('.');
}

function cambiosDeHuella(antes: string, ahora: string): string[] {
  const a = antes.split('.');
  const b = ahora.split('.');
  return PARTES.filter((_, i) => a[i] !== b[i]);
}

// ── Versiones guardadas ──

type FilaDeuc = { version: number; ruta: string; huella: string; sin_responder: string };

function ultimaDeuc(db: Db, id: string): FilaDeuc | null {
  return (
    (db
      .prepare(
        'SELECT version, ruta, huella, sin_responder FROM deuc_respuestas WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(id) as FilaDeuc | undefined) ?? null
  );
}

// null: la fila no se puede leer (escritura a medias, edición a mano). No se sabe qué queda, que no es «nada».
function preguntasDe(id: string, f: FilaDeuc | null): Pregunta[] | null {
  if (!f) return [];
  let crudo: unknown;
  try {
    crudo = JSON.parse(f.sin_responder);
  } catch {
    crudo = undefined;
  }
  const r = Preguntas.safeParse(crudo);
  if (r.success) return r.data;
  log.warn('DEUC con preguntas ilegibles', { licitacion: id, version: f.version });
  return null;
}

// «wx» como escribirAnexo: nunca se pisa lo que ya está en Salidas (alguien pudo editarlo o importarlo).
function escribirXml(
  raices: Raices,
  carpeta: string,
  desde: number,
  xml: string,
): Result<{ ruta: string; version: number }> {
  const dir = documentoEnDisco(raices, carpeta);
  if (dir.error) return dir;
  try {
    fs.mkdirSync(dir.data, { recursive: true });
    let v = desde;
    while (fs.existsSync(path.join(dir.data, `DEUC-v${v}.xml`))) v += 1;
    fs.writeFileSync(path.join(dir.data, `DEUC-v${v}.xml`), xml, { encoding: 'utf8', flag: 'wx' });
    return ok({ ruta: `${carpeta}/DEUC-v${v}.xml`, version: v });
  } catch (err) {
    return fail('io_error', `No se pudo guardar el DEUC en Salidas: ${errorMessage(err).slice(0, 300)}`);
  }
}

const avisoPreguntas = (n: number) =>
  n === 1
    ? 'Queda 1 pregunta por responder en el servicio DEUC (motivos de exclusión…).'
    : `Quedan ${n} preguntas por responder en el servicio DEUC (motivos de exclusión…).`;

// ── Generar ──

// sin_responder: null si no se sabe (ver preguntasDe).
export type DeucPreparado = { ruta: string; version: number; sin_responder: number | null };
type Plan = { peticion: Peticion; datos: DatosEspd; huella: string };

function planDeuc(c: ContextoAnexo, id: string): Result<Plan> {
  const datos = datosEspdDe(c.dbNucleo, c.db, id);
  if (datos.error) return datos;
  const peticion = leerPeticion(c.db, c.raices, id);
  if (peticion.error) return peticion;
  return ok({ peticion: peticion.data, datos: datos.data, huella: huellaDeuc(peticion.data.sha256, datos.data) });
}

// La fila de la checklist pasa a llevar ese XML: también la de otro lote o la que perdió su ruta.
function apuntarFila(db: Db, id: string, clave: string, x: DeucPreparado): void {
  const ts = new Date().toISOString();
  const avisos = x.sin_responder ? [avisoPreguntas(x.sin_responder)] : [];
  db.prepare(
    `UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, ruta_pdf = NULL, avisos = ?, anexo_en = ?, actualizado_en = ?
    WHERE licitacion_id = ? AND clave = ?`,
  ).run(x.ruta, JSON.stringify(avisos), ts, ts, id, clave);
  emitir(db, {
    tipo: 'licitacion.documentos',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'deuc', clave, version: x.version, sin_responder: x.sin_responder },
  });
}

function guardarDeuc(
  db: Db,
  id: string,
  clave: string,
  r: { ruta: string; version: number; plan: Plan; preguntas: Pregunta[] },
): void {
  db.prepare(
    'INSERT INTO deuc_respuestas (licitacion_id, version, ruta, huella, peticion_sha256, sin_responder, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    r.version,
    r.ruta,
    r.plan.huella,
    r.plan.peticion.sha256,
    JSON.stringify(r.preguntas),
    new Date().toISOString(),
  );
  apuntarFila(db, id, clave, { ruta: r.ruta, version: r.version, sin_responder: r.preguntas.length });
}

function generarDeuc(c: ContextoAnexo, id: string, clave: string, plan: Plan): Result<DeucPreparado> {
  const ultima = ultimaDeuc(c.db, id);
  const r = respuestaEspd(plan.peticion.texto, plan.datos, new Date(), randomUUID());
  if (r.error) return fail(r.error.code === 'invalid_input' ? 'invalid_input' : 'conflicto', r.error.message);
  const l = c.db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(id) as {
    id: string;
    expediente: string;
  };
  const w = escribirXml(c.raices, `${carpetaSalidas(l)}/anexos`, (ultima?.version ?? 0) + 1, r.data.xml);
  if (w.error) return w;
  guardarDeuc(c.db, id, clave, { ...w.data, plan, preguntas: r.data.sin_responder });
  log.info('DEUC preparado', { licitacion: id, version: w.data.version, sin_responder: r.data.sin_responder.length });
  return ok({ ruta: w.data.ruta, version: w.data.version, sin_responder: r.data.sin_responder.length });
}

// La misma huella y su archivo aún en Salidas: se devuelve la versión que hay, sin escribir nada.
function vigente(c: ContextoAnexo, id: string, plan: Plan, ultima: FilaDeuc | null): DeucPreparado | null {
  if (!ultima || ultima.huella !== plan.huella) return null;
  const abs = documentoEnDisco(c.raices, ultima.ruta);
  return abs.data && fs.existsSync(abs.data)
    ? { ruta: ultima.ruta, version: ultima.version, sin_responder: preguntasDe(id, ultima)?.length ?? null }
    : null;
}

/** Prepara DEUC-vN.xml para el documento DEUC de la checklist (o devuelve el vigente si no cambió nada de lo que lleva). */
export async function prepararDeuc(c: ContextoAnexo, id: string, clave: string): Promise<Result<DeucPreparado>> {
  if (!deucXmlActivo()) return fail('no_configurado', DEUC_APAGADO);
  const dest = destinoDe(c.db, c.raices, id, clave);
  if (dest.error) return dest;
  if (dest.data.d.doc.tipo !== 'deuc')
    return fail('invalid_input', 'Este documento no es el DEUC: el DEUC en XML solo se prepara en su fila.');
  const plan = planDeuc(c, id);
  if (plan.error) return plan;
  const hay = vigente(c, id, plan.data, ultimaDeuc(c.db, id));
  if (!hay) return generarDeuc(c, id, clave, plan.data);
  if (filaDocumento(c.db, id, clave)?.ruta !== hay.ruta) apuntarFila(c.db, id, clave, hay);
  return ok(hay);
}

// ── En cada vuelta ──

const frenadaPorElegibilidad = (c: ContextoAnexo, id: string, ahoraMs: number): boolean => {
  const cab = comprobacionesDe(c.db, c.dbNucleo, id, ahoraMs);
  return (
    cab.error !== null ||
    cab.data.bloqueos.some(
      (b) =>
        (b.estado === 'abierto' || b.estado === 'propuesta') &&
        b.categoria === 'elegibilidad' &&
        b.gravedad === 'impide',
    )
  );
};

function avisarEnFila(db: Db, id: string, f: FilaDocumento, aviso: string, prefijo: string): void {
  const avisos = JSON.parse(f.avisos) as string[];
  if (avisos.includes(aviso)) return;
  db.prepare('UPDATE oferta_documentos SET avisos = ? WHERE licitacion_id = ? AND clave = ?').run(
    JSON.stringify([...avisos.filter((a) => !a.startsWith(prefijo)), aviso]),
    id,
    f.clave,
  );
}

// Las filas del DEUC que la vuelta puede rehacer: visibles y sin documento puesto a mano. Un DEUC
// «por_lote» tiene una por lote, y todas llevan el mismo XML (declara todos los lotes decididos).
function filasDeuc(db: Db, id: string): FilaDocumento[] {
  return documentosDe(db, id)
    .documentos.filter((d) => d.tipo === 'deuc' && d.estado !== 'no_aplica')
    .map((d) => filaDocumento(db, id, d.clave))
    .filter((f): f is FilaDocumento => f !== null && !f.oculto && !(f.ruta !== null && f.anexo_en === null));
}

// Con la huella de nuevo al día, los avisos de «anterior a los cambios» y de «cambios tuyos» sobran.
function quitarAvisosDeuc(db: Db, id: string, f: FilaDocumento): void {
  const avisos = JSON.parse(f.avisos) as string[];
  const quedan = avisos.filter((a) => !a.startsWith(PREFIJO_DEUC_ANTERIOR) && a !== AVISO_DEUC_EDITADO);
  if (quedan.length !== avisos.length)
    db.prepare('UPDATE oferta_documentos SET avisos = ? WHERE licitacion_id = ? AND clave = ?').run(
      JSON.stringify(quedan),
      id,
      f.clave,
    );
}

// La versión vigente no cambia: se quitan los avisos viejos y se apuntan a ella las filas que no la llevan.
function alDia(c: ContextoAnexo, id: string, filas: FilaDocumento[], hay: DeucPreparado | null): void {
  for (const f of filas) {
    quitarAvisosDeuc(c.db, id, f);
    if (hay && f.ruta !== hay.ruta && f.estado !== 'preparado' && !editadoPorPersona(c.raices, f))
      apuntarFila(c.db, id, f.clave, hay);
  }
}

// Preparado (importado o firmado) no se rehace: se avisa de qué cambió. Editado a mano, tampoco.
function rehacibles(
  c: ContextoAnexo,
  id: string,
  filas: FilaDocumento[],
  ultima: FilaDeuc | null,
  huella: string,
): FilaDocumento[] {
  return filas.filter((f) => {
    if (f.estado === 'preparado') {
      if (ultima)
        avisarEnFila(
          c.db,
          id,
          f,
          `${PREFIJO_DEUC_ANTERIOR} los cambios en ${enumerar(cambiosDeHuella(ultima.huella, huella))}: vuelve a importarlo.`,
          PREFIJO_DEUC_ANTERIOR,
        );
      return false;
    }
    if (editadoPorPersona(c.raices, f)) {
      avisarEnFila(c.db, id, f, AVISO_DEUC_EDITADO, AVISO_DEUC_EDITADO);
      return false;
    }
    return true;
  });
}

export function deucAutoDe(c: ContextoAnexo, id: string, ahoraMs: number): boolean {
  const guion = guionVigente(c.db, id);
  if (!decisionesDe(c.db, id) || !guion) return false;
  // La vuelta prepara el DEUC antes de la cadena: la fila de un lote recién decidido aún no estaría.
  sincronizarDocumentos(c.db, id, guion);
  const filas = filasDeuc(c.db, id);
  const plan = filas.length ? planDeuc(c, id) : null;
  if (!plan || plan.error) return false;
  const ultima = ultimaDeuc(c.db, id);
  if (ultima?.huella === plan.data.huella) {
    alDia(c, id, filas, vigente(c, id, plan.data, ultima));
    return false;
  }
  const pendientes = rehacibles(c, id, filas, ultima, plan.data.huella);
  // El DEUC declara la solvencia: con un excluyente abierto sin «Vamos» no se prepara solo.
  if (!pendientes.length || frenadaPorElegibilidad(c, id, ahoraMs)) return false;
  const r = generarDeuc(c, id, pendientes[0]!.clave, plan.data);
  if (r.error) {
    log.warn('DEUC sin preparar', { licitacion: id, codigo: r.error.code });
    return false;
  }
  for (const f of pendientes.slice(1)) apuntarFila(c.db, id, f.clave, r.data);
  return true;
}

/** En cada vuelta, sin runs: DEUC nuevo para lo que está en preparación con decisiones y cuya huella cambió. Devuelve cuántos. */
export function deucAuto(dbNucleo: DbNucleo, dbLic: Db, raices: Raices, ahoraMs: number = Date.now()): number {
  if (!deucXmlActivo() || !raices.salidas) return 0;
  let n = 0;
  for (const l of licitacionesEnPreparacion(dbLic, ahoraMs)) {
    try {
      if (deucAutoDe({ db: dbLic, dbNucleo, raices }, l.id, ahoraMs)) n += 1;
    } catch (err) {
      log.error('DEUC automático fallido', { licitacion: l.id, error: errorMessage(err).slice(0, 200) });
    }
  }
  return n;
}

// ── Lo que ven la web y Hermes ──

// sin_responder: null si no se sabe (ver preguntasDe).
export type InfoDeuc = {
  peticion: string | null;
  respuesta: string | null;
  version: number | null;
  sin_responder: Pregunta[] | null;
};

/** La fila del DEUC en la checklist: la petición (Conocimiento), la última respuesta (Salidas) y las preguntas que quedan. */
export function infoDeuc(db: Db, id: string): InfoDeuc {
  const u = ultimaDeuc(db, id);
  return {
    peticion: peticionDeuc(db, id)?.ruta ?? null,
    respuesta: u?.ruta ?? null,
    version: u?.version ?? null,
    sin_responder: preguntasDe(id, u),
  };
}

/** licitaciones_oferta: con «estado», la última versión del DEUC y lo que queda por responder, sin rutas. */
export function conDeucParaAgente(db: Db, r: Result<Record<string, unknown>>): Result<Record<string, unknown>> {
  if (r.error || !('estado' in r.data)) return r;
  const id = String(r.data['id']);
  const u = ultimaDeuc(db, id);
  return u ? ok({ ...r.data, deuc: { version: u.version, sin_responder: preguntasDe(id, u) } }) : r;
}

/** POST /licitaciones/:id/oferta/documentos/:clave/deuc → { ruta, version, sin_responder }. */
export function rutasDeuc(r: Router): void {
  r.post(
    '/licitaciones/:id/oferta/documentos/:clave/deuc',
    conId(
      conClave((id, clave, _req, res) => {
        prepararDeuc({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() }, id, clave).then(
          (x) => responder(res, x),
          fallo(res, 'DEUC de la oferta', 'licitaciones'),
        );
      }),
    ),
  );
}
