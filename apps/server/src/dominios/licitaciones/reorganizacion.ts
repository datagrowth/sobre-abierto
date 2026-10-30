// Reorganización única de Conocimiento/Licitaciones: lo presentado y lo del radar dejan de mezclarse.
import path from 'node:path';
import { z } from 'zod';
import { nucleo } from '../../nucleo/contexto.js';
import {
  carpetaPorRuta,
  driveListo,
  hijosDe,
  mover,
  pendienteDeSubir,
  tieneArchivos,
  type ElementoDrive,
} from '../../nucleo/drive.js';
import { emitir } from '../../nucleo/eventos.js';
import { logger } from '../../nucleo/log.js';
import { nombreLibre } from '../../nucleo/nombres.js';
import { guardarOperacion, leerOperacion } from '../../nucleo/operaciones.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { raicesActuales } from '../../nucleo/salidas.js';
import {
  apuntarRutas,
  CARPETA_ORIGEN,
  carpetasLicitaciones,
  ES_ANIO,
  ES_DEL_RADAR,
  ES_PRESENTADA,
  reaplicarRutasPendientes,
} from './carpetas.js';
import { dbLicitaciones } from './db.js';
import type { Db } from './store.js';

// Se hace
// con la API de Drive moviendo carpetas enteras (así van también los Google Docs, que bisync
// no ve, y bisync trae el cambio al disco en su siguiente vuelta); nunca en el disco. Solo
// se mueve lo que casa con los patrones de la estructura anterior (carpetas.ts), nunca se
// sobrescribe (destino ocupado: sufijo -1) y es idempotente: la marca está en nucleo.db y
// cada pasada mira el estado real de Drive, donde lo ya movido no está en el sitio viejo.
// El informe se guarda tras cada movimiento (un reinicio a medias no pierde lo movido) y una
// carpeta con archivos que drive-sync aún no ha subido espera al siguiente intento.

// Lo presentado pasa a <Presentadas>/ y lo que bajó el radar a <Radar>/<año>/.
const CLAVE_REORGANIZACION = 'licitaciones.carpetas';
const ESTADOS_REORGANIZACION = ['pendiente', 'en_curso', 'sincronizando', 'hecha', 'sin_drive', 'error'] as const;
export type EstadoReorganizacion = (typeof ESTADOS_REORGANIZACION)[number];

// Tras mover en Drive, bisync tarda una vuelta (un minuto) en traerlo al disco; si en media
// hora no ha llegado, la descarga de pliegos deja de esperar (y el estado lo dice).
const ESPERA_SINCRONIZACION_MS = 30 * 60_000;
// Un error de Drive se reintenta solo, sin llamar a la API cada minuto.
const REINTENTO_MS = 15 * 60_000;
const SIN_CONEXION = new Set(['NOT_CONNECTED', 'NOT_CONFIGURED', 'REVOKED']);
// Solo esto hace esperar a la descarga: con errores de alguna carpeta (o sin Drive) sigue,
// porque cada licitación baja a la carpeta donde ya están sus pliegos (pliegos.ts).
const ESPERA_DESCARGA: ReadonlySet<EstadoReorganizacion> = new Set(['pendiente', 'en_curso', 'sincronizando']);
const AUN_SIN_SUBIR =
  'tiene archivos en el disco que drive-sync aún no ha subido a Drive: se mueve en el siguiente intento';
const log = logger('licitaciones.carpetas');

const Movida = z.object({ de: z.string(), a: z.string(), tipo: z.enum(['presentada', 'radar']) });
const Omitida = z.object({ ruta: z.string(), motivo: z.string() });
// Siempre uno nuevo: las listas se rellenan con push.
const vacio = () => ({
  mensaje: '',
  movidas: [],
  omitidas: [],
  errores: [],
  empezada_en: null,
  movida_en: null,
  sincronizada_en: null,
});
const InformeSchema = z
  .object({
    mensaje: z.string().default(''),
    movidas: z.array(Movida).default([]),
    omitidas: z.array(Omitida).default([]),
    errores: z.array(Omitida).default([]),
    empezada_en: z.string().nullable().default(null),
    movida_en: z.string().nullable().default(null),
    sincronizada_en: z.string().nullable().default(null),
  })
  .catch(vacio);
type Informe = z.infer<typeof InformeSchema>;
type Omitida = z.infer<typeof Omitida>;
export type Reorganizacion = Informe & { estado: EstadoReorganizacion; actualizada_en: string | null };

export function leerReorganizacion(): Reorganizacion {
  const op = leerOperacion(nucleo().db, CLAVE_REORGANIZACION, (raw) => InformeSchema.parse(raw ?? {}));
  const estado = z
    .enum(ESTADOS_REORGANIZACION)
    .catch('pendiente')
    .parse(op?.estado ?? 'pendiente');
  return { ...(op?.datos ?? InformeSchema.parse({})), estado, actualizada_en: op?.actualizada_en ?? null };
}

/** La descarga de pliegos espera mientras la reorganización está pendiente, en curso o sin llegar al disco. */
export function descargaPermitida(estado: EstadoReorganizacion): boolean {
  return !ESPERA_DESCARGA.has(estado);
}

const resumen = (i: Informe) =>
  `${i.movidas.length} movidas, ${i.omitidas.length} sin mover, ${i.errores.length} con error`;
// Hay algo movido en Drive después de la última vez que se vio el disco al día.
const sinSincronizar = (i: Informe) =>
  i.movida_en !== null && (i.sincronizada_en === null || i.movida_en > i.sincronizada_en);

function terminar(estado: EstadoReorganizacion, informe: Informe): EstadoReorganizacion {
  guardarOperacion(nucleo().db, CLAVE_REORGANIZACION, estado, informe);
  log.info('reorganización de carpetas', {
    estado,
    movidas: informe.movidas.length,
    omitidas: informe.omitidas.length,
    errores: informe.errores.length,
  });
  emitir(nucleo().db, { tipo: 'licitaciones.carpetas', dominio: 'licitaciones', recurso: null, datos: { estado } });
  return estado;
}

type Ctx = { db: Db; informe: Informe; radar: string; presentadas: string; conocimiento: string | null };
type Sitio = { id: string; ruta: string };
type Destino = Sitio & { ocupados: Set<string> };
type Movimiento = { desde: Sitio; hacia: Destino; tipo: 'presentada' | 'radar' };

async function destino(ruta: string): Promise<Result<Destino>> {
  const id = await carpetaPorRuta(ruta, true);
  if (id.error) return id;
  if (!id.data) return fail('GOOGLE_ERROR', `No se pudo crear «${ruta}» en Drive`);
  const hijos = await hijosDe(id.data);
  return hijos.error ? hijos : ok({ id: id.data, ruta, ocupados: new Set(hijos.data.map((h) => h.name)) });
}

// Se guarda tras cada movimiento: si el proceso se para a medias, lo movido sigue en el
// informe y la siguiente pasada espera a que bisync lo traiga.
function guardarProgreso(ctx: Ctx): void {
  guardarOperacion(nucleo().db, CLAVE_REORGANIZACION, 'en_curso', {
    ...ctx.informe,
    mensaje: 'Moviendo carpetas en Drive…',
  });
}

async function moverA(ctx: Ctx, item: ElementoDrive, m: Movimiento): Promise<void> {
  const de = `${m.desde.ruta}/${item.name}`;
  if (ctx.conocimiento && pendienteDeSubir(path.join(ctx.conocimiento, ...de.split('/')))) {
    ctx.informe.errores.push({ ruta: de, motivo: AUN_SIN_SUBIR });
    return;
  }
  const nombre = nombreLibre(m.hacia.ocupados, item.name);
  const r = await mover(item.id, m.desde.id, m.hacia.id, nombre === item.name ? undefined : nombre);
  if (r.error) {
    ctx.informe.errores.push({ ruta: de, motivo: r.error.message });
    log.warn('carpeta no movida', { de, error: r.error.code });
    return;
  }
  m.hacia.ocupados.add(nombre);
  const a = `${m.hacia.ruta}/${nombre}`;
  ctx.informe.movidas.push({ de, a, tipo: m.tipo });
  ctx.informe.movida_en = new Date().toISOString();
  guardarProgreso(ctx);
  const error = await apuntarRutas(ctx.db, { de, a });
  if (error) ctx.informe.errores.push({ ruta: de, motivo: `movida a «${a}», pero ${error}` });
  else log.info('carpeta movida', { de, a });
}

// En Drive un nombre puede llevar «/» (rclone lo cambia en el disco): no se mueve lo que no
// se pueda escribir igual como ruta.
// eslint-disable-next-line no-control-regex
const NOMBRE_RARO = /[\\/\u0000-\u001f]/;

/** Qué hacer con cada elemento de primer nivel de Licitaciones/ (las carpetas de destino se saltan). */
export function clasificar(
  hijos: ElementoDrive[],
  reservadas: ReadonlySet<string>,
): { presentadas: ElementoDrive[]; anios: ElementoDrive[]; omitidas: Omitida[] } {
  const out = { presentadas: [] as ElementoDrive[], anios: [] as ElementoDrive[], omitidas: [] as Omitida[] };
  for (const h of hijos) {
    if (reservadas.has(h.name) || h.name.startsWith('.')) continue;
    const ruta = `${CARPETA_ORIGEN}/${h.name}`;
    if (!h.folder) out.omitidas.push({ ruta, motivo: 'es un archivo, no una carpeta' });
    else if (NOMBRE_RARO.test(h.name))
      out.omitidas.push({ ruta, motivo: 'el nombre lleva «/», «\\» o caracteres de control' });
    else if (ES_PRESENTADA.test(h.name)) out.presentadas.push(h);
    else if (ES_ANIO.test(h.name)) out.anios.push(h);
    else out.omitidas.push({ ruta, motivo: 'no empieza por «AAAA-MM - » ni es la carpeta de un año' });
  }
  return out;
}

async function moverAnio(ctx: Ctx, anio: ElementoDrive): Promise<Result<null>> {
  const hijos = await hijosDe(anio.id);
  if (hijos.error) return hijos;
  const desde = { id: anio.id, ruta: `${CARPETA_ORIGEN}/${anio.name}` };
  const delRadar = hijos.data.filter((h) => h.folder && ES_DEL_RADAR.test(h.name) && !NOMBRE_RARO.test(h.name));
  for (const h of hijos.data) {
    if (delRadar.includes(h) || h.name.startsWith('.')) continue;
    ctx.informe.omitidas.push({
      ruta: `${desde.ruta}/${h.name}`,
      motivo: h.folder ? 'no acaba en «(p-…)» ni en «(a-…)»' : 'es un archivo, no una carpeta',
    });
  }
  if (!delRadar.length) return ok(null);
  const hacia = await destino(`${ctx.radar}/${anio.name}`);
  if (hacia.error) return hacia;
  for (const h of delRadar) await moverA(ctx, h, { desde, hacia: hacia.data, tipo: 'radar' });
  return ok(null);
}

async function moverPresentadas(ctx: Ctx, desde: Sitio, lista: ElementoDrive[]): Promise<Result<null>> {
  if (!lista.length) return ok(null);
  const hacia = await destino(ctx.presentadas);
  if (hacia.error) return hacia;
  for (const p of lista) await moverA(ctx, p, { desde, hacia: hacia.data, tipo: 'presentada' });
  return ok(null);
}

// Radar y Presentadas cuelgan (por defecto) de Licitaciones/: no son parte de lo que se mueve.
function reservadas(ctx: Ctx): Set<string> {
  return new Set(
    [ctx.radar, ctx.presentadas].filter((r) => r.startsWith(`${CARPETA_ORIGEN}/`)).map((r) => r.split('/')[1]!),
  );
}

// Un fallo de una parte (Presentadas, un año) no para las demás; sin conexión, sí.
function seguir(ctx: Ctx, ruta: string, r: Result<null>): boolean {
  if (!r.error) return true;
  if (SIN_CONEXION.has(r.error.code)) return false;
  ctx.informe.errores.push({ ruta, motivo: r.error.message });
  return true;
}

async function ejecutar(ctx: Ctx): Promise<Result<null>> {
  const origen = await carpetaPorRuta(CARPETA_ORIGEN);
  if (origen.error) return origen;
  if (origen.data === null) return ok(null);
  const hijos = await hijosDe(origen.data);
  if (hijos.error) return hijos;
  const plan = clasificar(hijos.data, reservadas(ctx));
  ctx.informe.omitidas.push(...plan.omitidas);
  const p = await moverPresentadas(ctx, { id: origen.data, ruta: CARPETA_ORIGEN }, plan.presentadas);
  if (!seguir(ctx, ctx.presentadas, p)) return p;
  for (const anio of plan.anios) {
    const r = await moverAnio(ctx, anio);
    if (!seguir(ctx, `${CARPETA_ORIGEN}/${anio.name}`, r)) return r;
  }
  return ok(null);
}

// Lo movido y aún sin llegar al disco manda (la descarga espera), haya errores o no: si los
// hay, al llegar pasa a «error» y se reintenta (comprobarSincronizacion).
function decidir(informe: Informe, sinConexion: string | null): EstadoReorganizacion {
  if (sinSincronizar(informe)) {
    informe.mensaje = `Movido en Drive (${resumen(informe)}). Falta que drive-sync lo traiga al disco; mientras, la descarga de pliegos espera.`;
    return terminar('sincronizando', informe);
  }
  if (sinConexion) {
    informe.mensaje = sinConexion;
    return terminar('sin_drive', informe);
  }
  if (informe.errores.length) {
    informe.mensaje = `Con errores (${resumen(informe)}): se reintenta en 15 minutos o con «Comprobar de nuevo». Lo que falló sigue en su sitio y la descarga de pliegos sigue.`;
    return terminar('error', informe);
  }
  informe.mensaje = `Hecha (${resumen(informe)}).`;
  return terminar('hecha', informe);
}

function cerrar(ctx: Ctx, r: Result<null>): EstadoReorganizacion {
  const { informe } = ctx;
  for (const o of informe.omitidas) log.info('carpeta sin mover', { ruta: o.ruta, motivo: o.motivo });
  if (!r.error) return decidir(informe, null);
  const sinConexion = SIN_CONEXION.has(r.error.code);
  const motivo = sinConexion
    ? `Drive dejó de estar disponible (${r.error.message}): se sigue cuando vuelva.`
    : r.error.message;
  informe.errores.push({ ruta: CARPETA_ORIGEN, motivo });
  return decidir(informe, sinConexion ? motivo : null);
}

async function reorganizarYa(): Promise<EstadoReorganizacion> {
  const { estado: _estado, actualizada_en: _actualizada, ...previo } = leerReorganizacion();
  const drive = driveListo();
  if (!drive.listo) {
    if (sinSincronizar(previo)) return terminar('sincronizando', previo);
    return terminar('sin_drive', {
      ...previo,
      mensaje: `${drive.motivo}: no se mueve nada; se hará sola cuando lo esté.`,
    });
  }
  const informe: Informe = {
    ...vacio(),
    movidas: [...previo.movidas],
    movida_en: previo.movida_en,
    sincronizada_en: previo.sincronizada_en,
    empezada_en: new Date().toISOString(),
  };
  const ctx: Ctx = {
    db: dbLicitaciones(),
    informe,
    ...carpetasLicitaciones(),
    conocimiento: raicesActuales().conocimiento,
  };
  guardarProgreso(ctx);
  informe.errores.push(...(await reaplicarRutasPendientes(ctx.db)));
  return cerrar(ctx, await ejecutar(ctx));
}

let enMarcha: Promise<EstadoReorganizacion> | null = null;

/** Hace (o repite) la reorganización mirando el estado real de Drive. Si ya está en marcha, devuelve esa. */
export function reorganizar(): Promise<EstadoReorganizacion> {
  enMarcha ??= reorganizarYa()
    .catch((err: unknown) => {
      log.error('reorganización de carpetas fallida', { error: errorMessage(err) });
      const { estado: _estado, actualizada_en: _actualizada, ...informe } = leerReorganizacion();
      return terminar('error', { ...informe, mensaje: `Falló: ${errorMessage(err)}. Se reintenta en 15 minutos.` });
    })
    .finally(() => {
      enMarcha = null;
    });
  return enMarcha;
}

/** Al arrancar y en cada vuelta: la hace si no está hecha (tras un error, pasados 15 minutos). */
export function reorganizarSiToca(ahoraMs = Date.now()): Promise<EstadoReorganizacion> {
  const r = leerReorganizacion();
  const toca =
    r.estado === 'pendiente' ||
    r.estado === 'en_curso' ||
    (r.estado === 'sin_drive' && driveListo().listo) ||
    (r.estado === 'error' && ahoraMs - Date.parse(r.actualizada_en ?? '') >= REINTENTO_MS);
  return toca ? reorganizar() : Promise.resolve(r.estado);
}

/**
 * Con lo movido ya fuera del sitio viejo en el disco (bisync lo trajo), o pasada media hora,
 * la descarga de pliegos sigue: queda «hecha» o, si alguna carpeta falló, «error» (que se
 * reintenta pasados 15 minutos).
 */
export function comprobarSincronizacion(conocimiento: string, ahoraMs = Date.now()): EstadoReorganizacion {
  const r = leerReorganizacion();
  if (r.estado !== 'sincronizando') return r.estado;
  const faltan = r.movidas.filter((m) => tieneArchivos(path.join(conocimiento, ...m.de.split('/'))));
  const vencida = ahoraMs - Date.parse(r.movida_en ?? r.actualizada_en ?? '') > ESPERA_SINCRONIZACION_MS;
  if (faltan.length && !vencida) return 'sincronizando';
  const { estado: _estado, actualizada_en: _actualizada, ...informe } = r;
  informe.sincronizada_en = new Date().toISOString();
  const errores = informe.errores.length
    ? ` ${informe.errores.length} carpetas con error se reintentan en 15 minutos.`
    : '';
  informe.mensaje = faltan.length
    ? `Hecha en Drive (${resumen(informe)}), pero ${faltan.length} carpetas siguen con archivos en su sitio viejo del disco tras 30 minutos: revisa drive-sync. La descarga de pliegos sigue.${errores}`
    : `Drive y el disco ya tienen la estructura nueva (${resumen(informe)}).${errores}`;
  return terminar(informe.errores.length ? 'error' : 'hecha', informe);
}
