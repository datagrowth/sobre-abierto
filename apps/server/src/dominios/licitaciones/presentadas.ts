// Carpeta de lo presentado: se crea (o reutiliza) al registrar la primera propuesta.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  carpetaPorRuta,
  crearCarpeta,
  driveConectado,
  driveListo,
  hijosDe,
  mover,
  pendienteDeSubir,
  tieneArchivos,
} from '../../nucleo/drive.js';
import { emitir } from '../../nucleo/eventos.js';
import { logger } from '../../nucleo/log.js';
import { nombreLibre } from '../../nucleo/nombres.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { raicesActuales } from '../../nucleo/salidas.js';
import {
  apuntarRutas,
  carpetaDe,
  carpetasLicitaciones,
  esCarpetaDeExpediente,
  nombrePresentada,
  reaplicarRutasPendientes,
} from './carpetas.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from './store.js';
import { carpetaUnicaEnDb, SUBCARPETAS_UNICA } from './carpetasUnicas.js';

// Conocimiento/<Presentadas>/<AAAA-MM - expediente - órgano - tema>/ con PLIEGOS,
// DOCUMENTACION PRESENTADA y OTROS DOCUMENTOS, y los pliegos que bajó el radar pasan a
// PLIEGOS. Si en Presentadas ya hay una carpeta de ese expediente (las que el equipo creaba
// a mano y movió la reorganización), se reutiliza. Con Drive se hace con su API (van también
// los Google Docs y bisync lo trae al disco); sin Drive, en el disco, y drive-sync lo subirá.
// Las rutas guardadas se actualizan en la misma operación. Se reintenta solo si falla; nunca
// pisa una carpeta que ya exista. Si la presentación se registró desde un paquete de
// presentación, la versión entera (con los «_firmado.pdf» que se hayan añadido) se copia a
// DOCUMENTACION PRESENTADA en cuanto la carpeta está en el disco, con COPIA.json.

// Es su carpeta de Presentadas en Conocimiento.
export const CARPETA_PLIEGOS = 'PLIEGOS';
export const SUBCARPETAS = ['DOCUMENTACION PRESENTADA', 'OTROS DOCUMENTOS'] as const;
const REINTENTO_MS = 15 * 60_000;
const log = logger('licitaciones.carpetas');

export type CarpetaPresentada = {
  licitacion_id: string;
  nombre: string;
  ruta: string | null;
  drive_id: string | null;
  estado: 'pendiente' | 'hecha' | 'error';
  error: string | null;
  intentos: number;
  creada_en: string;
  actualizada_en: string;
};

export function carpetaPresentadaDe(db: Db, licitacionId: string): CarpetaPresentada | null {
  return (
    (db.prepare('SELECT * FROM carpetas_presentadas WHERE licitacion_id = ?').get(licitacionId) as
      CarpetaPresentada | undefined) ?? null
  );
}

/** Ruta (relativa a Conocimiento) de la carpeta de lo presentado, si ya está creada. */
export function rutaPresentada(db: Db, licitacionId: string): string | null {
  const c = carpetaPresentadaDe(db, licitacionId);
  return c?.estado === 'hecha' ? c.ruta : null;
}

/**
 * Pide la carpeta al registrar una propuesta; con varios lotes, la primera manda (una por
 * licitación). Con carpeta única no hay nada que crear ni mover: lo presentado es su
 * carpeta única y la copia del paquete va a su Presentada/.
 */
export function pedirCarpetaPresentada(db: Db, licitacionId: string, presentadaEn: string): void {
  const l = obtenerLicitacion(db, licitacionId);
  if (!l) return;
  const unica = carpetaUnicaEnDb(db, licitacionId);
  const nombre = unica
    ? path.posix.basename(unica)
    : nombrePresentada({
        presentada_en: presentadaEn,
        expediente: l.expediente,
        organo_nombre: l.organo_nombre,
        titulo: l.titulo,
      });
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO carpetas_presentadas (licitacion_id, nombre, ruta, estado, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(licitacion_id) DO NOTHING`,
  ).run(licitacionId, nombre, unica, unica ? 'hecha' : 'pendiente', ts, ts);
}

/** Las propuestas registradas antes de existir estas carpetas también piden la suya. Devuelve cuántas. */
function pedirCarpetasDePropuestas(db: Db): number {
  const filas = db
    .prepare(
      `SELECT licitacion_id, MIN(presentada_en) AS presentada_en FROM propuestas
    WHERE licitacion_id NOT IN (SELECT licitacion_id FROM carpetas_presentadas) GROUP BY licitacion_id`,
    )
    .all() as { licitacion_id: string; presentada_en: string }[];
  for (const f of filas) pedirCarpetaPresentada(db, f.licitacion_id, f.presentada_en);
  return filas.length;
}

/**
 * Tras borrar una propuesta: si la licitación ya no tiene ninguna, la carpeta que aún no se
 * creó se cancela. Una ya creada se queda (nunca se borra nada de Drive) y, si se vuelve a
 * registrar, se reutiliza.
 */
export function cancelarCarpetaPresentada(db: Db, licitacionId: string): void {
  if (db.prepare('SELECT 1 FROM propuestas WHERE licitacion_id = ?').get(licitacionId)) return;
  db.prepare("DELETE FROM carpetas_presentadas WHERE licitacion_id = ? AND estado <> 'hecha'").run(licitacionId);
  // Sin propuesta no hay copia que hacer: un paquete que la esperaba vuelve a «sin pedir».
  db.prepare(
    "UPDATE paquetes_presentacion SET copia_estado = NULL, copia_error = NULL WHERE licitacion_id = ? AND copia_estado IN ('pendiente', 'error')",
  ).run(licitacionId);
}

// Los pliegos están donde dice su ruta: pueden seguir en la estructura anterior o estar en
// varias carpetas (p. ej. si cambió el año de la fecha límite). Sin ninguno bajado, donde los
// dejaría el radar. Lo que ya está dentro de la carpeta de lo presentado no se mueve.
function carpetasDeSusPliegos(db: Db, l: FilaLicitacion, destino: string): string[] {
  const filas = db
    .prepare('SELECT ruta FROM pliegos WHERE licitacion_id = ? AND ruta IS NOT NULL ORDER BY rowid')
    .all(l.id) as { ruta: string }[];
  if (!filas.length) return [carpetaDe(l)];
  const dentro = (d: string) => d === destino || d.startsWith(`${destino}/`);
  return [...new Set(filas.map((f) => path.posix.dirname(f.ruta)))].filter((d) => !dentro(d));
}

// Carpetas de Presentadas que ya son de otra licitación (mismo expediente en otro órgano).
function rutasDeOtras(db: Db, licitacionId: string): Set<string> {
  const filas = db
    .prepare('SELECT ruta FROM carpetas_presentadas WHERE licitacion_id <> ? AND ruta IS NOT NULL')
    .all(licitacionId) as { ruta: string }[];
  return new Set(filas.map((f) => f.ruta));
}

/** Carpeta de Presentadas de ese expediente que no es de otra licitación, si la hay. */
function suyaEntre(db: Db, nombres: string[], l: FilaLicitacion): string | null {
  const { presentadas } = carpetasLicitaciones();
  const otras = rutasDeOtras(db, l.id);
  return nombres.find((n) => esCarpetaDeExpediente(n, l.expediente) && !otras.has(`${presentadas}/${n}`)) ?? null;
}

type Sitio = { id: string; ruta: string };

async function destinoEnDrive(db: Db, c: CarpetaPresentada, l: FilaLicitacion): Promise<Result<Sitio>> {
  if (c.drive_id && c.ruta) return ok({ id: c.drive_id, ruta: c.ruta });
  const { presentadas } = carpetasLicitaciones();
  const padre = await carpetaPorRuta(presentadas, true);
  if (padre.error) return padre;
  if (!padre.data) return fail('GOOGLE_ERROR', `No se pudo crear «${presentadas}» en Drive`);
  const hijos = await hijosDe(padre.data);
  if (hijos.error) return hijos;
  const carpetas = hijos.data.filter((h) => h.folder);
  const suya = suyaEntre(
    db,
    carpetas.map((h) => h.name),
    l,
  );
  const elegida = suya
    ? ok(carpetas.find((h) => h.name === suya)!)
    : await crearCarpeta(padre.data, nombreLibre(new Set(hijos.data.map((h) => h.name)), c.nombre));
  if (elegida.error) return elegida;
  const ruta = `${presentadas}/${elegida.data.name}`;
  if (suya) log.info('carpeta de presentada reutilizada', { licitacion: c.licitacion_id, ruta });
  // Se apunta ya: un reintento sigue en esta carpeta en vez de crear otra.
  db.prepare('UPDATE carpetas_presentadas SET drive_id = ?, ruta = ? WHERE licitacion_id = ?').run(
    elegida.data.id,
    ruta,
    c.licitacion_id,
  );
  return ok({ id: elegida.data.id, ruta });
}

async function origenEnDrive(origen: string): Promise<Result<{ padre: string; id: string } | null>> {
  const padre = await carpetaPorRuta(path.posix.dirname(origen));
  if (padre.error || !padre.data) return padre.error ? padre : ok(null);
  const hijos = await hijosDe(padre.data);
  if (hijos.error) return hijos;
  const h = hijos.data.find((x) => x.folder && x.name === path.posix.basename(origen));
  return ok(h ? { padre: padre.data, id: h.id } : null);
}

type Pliegos = { destino: Sitio; id: string | null };

// Con archivos en el disco que Drive aún no tiene, mover ahora los dejaría atrás: bisync los
// subiría después a la ruta vieja. Se reintenta.
function aunSinSubir(conocimiento: string, origen: string, enDrive: boolean): Result<null> | null {
  const abs = path.join(conocimiento, ...origen.split('/'));
  if (enDrive ? !pendienteDeSubir(abs) : !tieneArchivos(abs)) return null;
  return fail('PENDIENTE_SYNC', `«${origen}» tiene archivos que drive-sync aún no ha subido a Drive: se reintenta`);
}

// La primera carpeta de pliegos pasa entera a ser PLIEGOS (un solo movimiento, con su
// datos.json y sus Google Docs); si PLIEGOS ya existe, entra dentro con su nombre.
async function aPliegosEnDrive(db: Db, conocimiento: string, origen: string, p: Pliegos): Promise<Result<null>> {
  const o = await origenEnDrive(origen);
  if (o.error) return o;
  const espera = aunSinSubir(conocimiento, origen, o.data !== null);
  if (espera || !o.data) return espera ?? ok(null);
  const dentro = p.id ? await hijosDe(p.id) : null;
  if (dentro?.error) return dentro;
  const nombre = dentro?.data
    ? nombreLibre(new Set(dentro.data.map((h) => h.name)), path.posix.basename(origen))
    : CARPETA_PLIEGOS;
  const r = await mover(o.data.id, o.data.padre, p.id ?? p.destino.id, nombre);
  if (r.error) return r;
  const a = p.id ? `${p.destino.ruta}/${CARPETA_PLIEGOS}/${nombre}` : `${p.destino.ruta}/${CARPETA_PLIEGOS}`;
  p.id ??= o.data.id;
  const error = await apuntarRutas(db, { de: origen, a });
  return error ? fail('rutas_sin_actualizar', error) : ok(null);
}

async function archivarEnDrive(
  db: Db,
  conocimiento: string,
  c: CarpetaPresentada,
  l: FilaLicitacion,
): Promise<Result<string>> {
  const destino = await destinoEnDrive(db, c, l);
  if (destino.error) return destino;
  const hijos = await hijosDe(destino.data.id);
  if (hijos.error) return hijos;
  const ocupados = new Map(hijos.data.filter((h) => h.folder).map((h) => [h.name, h.id]));
  for (const s of SUBCARPETAS.filter((x) => !ocupados.has(x))) {
    const r = await crearCarpeta(destino.data.id, s);
    if (r.error) return r;
  }
  const p: Pliegos = { destino: destino.data, id: ocupados.get(CARPETA_PLIEGOS) ?? null };
  for (const origen of carpetasDeSusPliegos(db, l, destino.data.ruta)) {
    const r = await aPliegosEnDrive(db, conocimiento, origen, p);
    if (r.error) return r;
  }
  const vacia = p.id ? null : await crearCarpeta(destino.data.id, CARPETA_PLIEGOS);
  return vacia?.error ? vacia : ok(destino.data.ruta);
}

function carpetasEn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function nombresEn(dir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

function rutaEnDisco(db: Db, conocimiento: string, c: CarpetaPresentada, l: FilaLicitacion): string {
  if (c.ruta) return c.ruta;
  const { presentadas } = carpetasLicitaciones();
  const dir = path.join(conocimiento, presentadas);
  return `${presentadas}/${suyaEntre(db, carpetasEn(dir), l) ?? nombreLibre(nombresEn(dir), c.nombre)}`;
}

async function aPliegosEnDisco(db: Db, conocimiento: string, origen: string, ruta: string): Promise<Result<null>> {
  const origenAbs = path.join(conocimiento, origen);
  if (!fs.existsSync(origenAbs)) return ok(null);
  const pliegos = path.join(conocimiento, ruta, CARPETA_PLIEGOS);
  const a = fs.existsSync(pliegos)
    ? `${ruta}/${CARPETA_PLIEGOS}/${nombreLibre(nombresEn(pliegos), path.posix.basename(origen))}`
    : `${ruta}/${CARPETA_PLIEGOS}`;
  await fsp.rename(origenAbs, path.join(conocimiento, a));
  const error = await apuntarRutas(db, { de: origen, a });
  return error ? fail('rutas_sin_actualizar', error) : ok(null);
}

async function archivarEnDisco(
  db: Db,
  conocimiento: string,
  c: CarpetaPresentada,
  l: FilaLicitacion,
): Promise<Result<string>> {
  const ruta = rutaEnDisco(db, conocimiento, c, l);
  try {
    for (const s of SUBCARPETAS) await fsp.mkdir(path.join(conocimiento, ruta, s), { recursive: true });
    db.prepare('UPDATE carpetas_presentadas SET ruta = ? WHERE licitacion_id = ?').run(ruta, c.licitacion_id);
    for (const origen of carpetasDeSusPliegos(db, l, ruta)) {
      const r = await aPliegosEnDisco(db, conocimiento, origen, ruta);
      if (r.error) return r;
    }
    await fsp.mkdir(path.join(conocimiento, ruta, CARPETA_PLIEGOS), { recursive: true });
    return ok(ruta);
  } catch (err) {
    return fail('io_error', errorMessage(err));
  }
}

async function archivar(db: Db, conocimiento: string, c: CarpetaPresentada): Promise<Result<string>> {
  const l = obtenerLicitacion(db, c.licitacion_id);
  if (!l) return fail('not_found', 'La licitación ya no existe.');
  return driveConectado() ? archivarEnDrive(db, conocimiento, c, l) : archivarEnDisco(db, conocimiento, c, l);
}

function apuntar(db: Db, c: CarpetaPresentada, r: Result<string>): void {
  const ts = new Date().toISOString();
  if (r.error) {
    db.prepare(
      "UPDATE carpetas_presentadas SET estado = 'error', error = ?, intentos = intentos + 1, actualizada_en = ? WHERE licitacion_id = ?",
    ).run(`${r.error.code}: ${r.error.message}`.slice(0, 300), ts, c.licitacion_id);
    log.warn('carpeta de presentada sin crear', { licitacion: c.licitacion_id, error: r.error.code });
    return;
  }
  db.prepare(
    "UPDATE carpetas_presentadas SET estado = 'hecha', ruta = ?, error = NULL, actualizada_en = ? WHERE licitacion_id = ?",
  ).run(r.data, ts, c.licitacion_id);
  log.info('carpeta de presentada creada', { licitacion: c.licitacion_id, ruta: r.data });
  emitir(db, {
    tipo: 'licitacion.carpeta_presentada',
    dominio: 'licitaciones',
    recurso: c.licitacion_id,
    datos: { ruta: r.data },
  });
}

// ── Copia del paquete presentado ──

/** Al registrar la presentación de un paquete: su versión se copiará a DOCUMENTACION PRESENTADA. */
export function pedirCopiaPaquete(db: Db, licitacionId: string, version: number): void {
  db.prepare(
    "UPDATE paquetes_presentacion SET copia_estado = 'pendiente', copia_error = NULL WHERE licitacion_id = ? AND version = ? AND (copia_estado IS NULL OR copia_estado = 'error')",
  ).run(licitacionId, version);
}

// Cuándo se intentó por última vez cada copia fallida (en memoria: al reiniciar se reintenta).
const ultimoIntento = new Map<string, number>();

type PaqueteACopiar = { licitacion_id: string; version: number; ruta: string; manifiesto: string };

const listar = (dir: string, rel = ''): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listar(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]))
    .sort();

// Los archivos que lista el manifiesto, con sus textos (guía del DEUC, compromisos…): los demás
// son lo que se añadió después, los firmados.
function delManifiesto(manifiesto: string): Set<string> {
  const m = JSON.parse(manifiesto) as {
    carpetas?: { ruta: string; documentos: { archivo: string }[] }[];
    textos?: { archivo: string }[];
  };
  const docs = (m.carpetas ?? []).flatMap((c) => c.documentos.map((d) => `${c.ruta}/${d.archivo}`));
  return new Set([
    ...docs,
    ...(m.textos ?? []).map((t) => t.archivo),
    'MANIFIESTO.json',
    'INSTRUCCIONES.md',
    'VALORES_A_TECLEAR.md',
  ]);
}

// Copia la versión entera en el disco (drive-sync la sube) y escribe COPIA.json; nunca pisa.
function copiarVersion(origen: string, destino: string, manifiesto: string): void {
  if (fs.existsSync(destino))
    throw new Error(`Ya existe ${path.basename(destino)} en DOCUMENTACION PRESENTADA: no se pisa.`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    escribirCopia(origen, destino, manifiesto);
  } catch (err) {
    // El destino no existía al empezar: lo que haya es una copia a medias que bloquearía el reintento.
    fs.rmSync(destino, { recursive: true, force: true });
    throw err;
  }
}

function escribirCopia(origen: string, destino: string, manifiesto: string): void {
  fs.cpSync(origen, destino, { recursive: true, errorOnExist: true, force: false });
  const lista = delManifiesto(manifiesto);
  const archivos = listar(destino).map((ruta) => {
    const bytes = fs.readFileSync(path.join(destino, ...ruta.split('/')));
    return {
      ruta,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      en_manifiesto: lista.has(ruta),
    };
  });
  const copia = {
    copiado_en: new Date().toISOString(),
    archivos,
    fuera_del_manifiesto: archivos.filter((a) => !a.en_manifiesto).map((a) => a.ruta),
  };
  fs.writeFileSync(path.join(destino, 'COPIA.json'), `${JSON.stringify(copia, null, 2)}\n`, { flag: 'wx' });
}

function copiarPaquete(db: Db, dirs: { conocimiento: string; salidas: string }, p: PaqueteACopiar): void {
  const carpeta = rutaPresentada(db, p.licitacion_id);
  if (!carpeta) return;
  // El paquete está en Salidas o, con carpeta única, en su Sobres/ de Conocimiento.
  const enConocimiento = p.ruta.startsWith('Conocimiento/');
  const origen = path.join(
    enConocimiento ? dirs.conocimiento : dirs.salidas,
    ...p.ruta.replace(/^(Salidas|Conocimiento)\//, '').split('/'),
  );
  const unica = carpetaUnicaEnDb(db, p.licitacion_id);
  const destinoRel = unica
    ? `${unica}/${SUBCARPETAS_UNICA.presentada}/${path.posix.basename(p.ruta)}`
    : `${carpeta}/${SUBCARPETAS[0]}/${path.posix.basename(p.ruta)}`;
  try {
    copiarVersion(origen, path.join(dirs.conocimiento, ...destinoRel.split('/')), p.manifiesto);
    db.prepare(
      "UPDATE paquetes_presentacion SET copia_estado = 'hecha', copia_ruta = ?, copia_error = NULL WHERE licitacion_id = ? AND version = ?",
    ).run(destinoRel, p.licitacion_id, p.version);
    log.info('paquete presentado copiado', { licitacion: p.licitacion_id, version: p.version });
  } catch (err) {
    db.prepare(
      "UPDATE paquetes_presentacion SET copia_estado = 'error', copia_error = ? WHERE licitacion_id = ? AND version = ?",
    ).run(errorMessage(err).slice(0, 300), p.licitacion_id, p.version);
    log.warn('paquete presentado sin copiar', { licitacion: p.licitacion_id, version: p.version });
  }
}

/** Copia los paquetes presentados cuya carpeta de lo presentado ya está en el disco. Devuelve cuántos intentó. */
export function copiarPaquetesPresentados(
  db: Db,
  conocimiento: string,
  salidas: string | null,
  ahoraMs = Date.now(),
): number {
  if (!salidas) return 0;
  const filas = db
    .prepare(
      "SELECT licitacion_id, version, ruta, manifiesto, copia_estado FROM paquetes_presentacion WHERE copia_estado IN ('pendiente', 'error') ORDER BY id",
    )
    .all() as (PaqueteACopiar & { copia_estado: string })[];
  // Sin fila de carpeta (se canceló al borrar la propuesta) no hay dónde copiar; un error se reintenta pasado un rato.
  const listas = filas.filter(
    (p) =>
      carpetaPresentadaDe(db, p.licitacion_id) &&
      !esperaPorCarpeta(db, conocimiento, p.licitacion_id) &&
      (p.copia_estado === 'pendiente' ||
        ahoraMs - (ultimoIntento.get(`${p.licitacion_id}/${p.version}`) ?? 0) >= REINTENTO_MS),
  );
  for (const p of listas) {
    ultimoIntento.set(`${p.licitacion_id}/${p.version}`, ahoraMs);
    copiarPaquete(db, { conocimiento, salidas }, p);
  }
  return listas.length;
}

let enMarcha = false;

async function procesar(db: Db, conocimiento: string, ahoraMs: number): Promise<number> {
  pedirCarpetasDePropuestas(db);
  const sinAplicar = await reaplicarRutasPendientes(db);
  if (sinAplicar.length) log.warn('cambios de ruta aún sin aplicar', { n: sinAplicar.length });
  const desde = new Date(ahoraMs - REINTENTO_MS).toISOString();
  const filas = db
    .prepare(
      `SELECT * FROM carpetas_presentadas WHERE estado = 'pendiente' OR (estado = 'error' AND actualizada_en <= ?)
    ORDER BY creada_en`,
    )
    .all(desde) as CarpetaPresentada[];
  for (const c of filas)
    apuntar(
      db,
      c,
      await archivar(db, conocimiento, c).catch((err: unknown) => fail<string>('io_error', errorMessage(err))),
    );
  copiarPaquetesPresentados(db, conocimiento, raicesActuales().salidas, ahoraMs);
  return filas.length;
}

/**
 * Crea las carpetas pedidas (y reintenta las fallidas pasados 15 minutos). Con Drive
 * conectado pero sin sincronizar aún, espera: lo movido volvería con la copia del disco.
 */
export async function procesarPresentadas(db: Db, conocimiento: string, ahoraMs = Date.now()): Promise<number> {
  if (enMarcha || (driveConectado() && !driveListo().listo)) return 0;
  enMarcha = true;
  try {
    return await procesar(db, conocimiento, ahoraMs);
  } finally {
    enMarcha = false;
  }
}

/** ¿Espera la descarga de pliegos de esta licitación? Sí mientras su carpeta de presentada no está lista en el disco. */
export function esperaPorCarpeta(db: Db, conocimiento: string, licitacionId: string): boolean {
  const c = carpetaPresentadaDe(db, licitacionId);
  // Con carpeta única no se mueve nada al presentar: los pliegos ya bajan a su Pliegos/.
  if (!c || carpetaUnicaEnDb(db, licitacionId)) return false;
  return c.estado !== 'hecha' || !c.ruta || !fs.existsSync(path.join(conocimiento, c.ruta, CARPETA_PLIEGOS));
}

export function contarPresentadas(db: Db): Record<string, number> {
  const filas = db.prepare('SELECT estado AS k, COUNT(*) AS n FROM carpetas_presentadas GROUP BY estado').all() as {
    k: string;
    n: number;
  }[];
  return Object.fromEntries(filas.map((f) => [f.k, f.n]));
}
