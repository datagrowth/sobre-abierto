// Carga del histórico en el hilo de ingesta: baja cada ZIP a un temporal, lo recorre en streaming y lo borra.
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { USER_AGENT } from '../../nucleo/http.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { esUrlDePlataforma, FUENTES } from './placsp/fuentes.js';
import { pedirPermitida } from './placsp/descarga.js';
import { recorrerAtoms, type AlAtom } from './placsp/zip.js';
import { prefiltrar } from './prefiltro.js';
import {
  piezasDe,
  procesarAtomHistorico,
  sectorActual,
  siguienteHistorico,
  type Cuenta,
  type FilaHistorico,
  type Sector,
} from './historico.js';
import type { Db } from './store.js';

// El temporal va en PLATAFORMA_DATA_DIR. Cada .atom procesado queda apuntado en la misma transacción que sus
// entradas, así que si el proceso se corta se sigue por el mismo ZIP y el mismo .atom sin contar nada dos veces.
// Lo que sigue abierto pasa por el prefiltro al guardarse. La PLACSP no admite descargas por rangos: un ZIP
// cortado se vuelve a bajar entero.
// Un ZIP anual anterior a 2018 pesa cientos de MB y la PLACSP sirve a ~200 KB/s.
const TIMEOUT_MS = 4 * 60 * 60_000;
const AVISO_BYTES = 8 * 1024 * 1024;

export type DescargarZip = (
  url: string,
  destino: string,
  alProgreso: (bytes: number) => void,
) => Promise<Result<{ bytes: number }>>;

async function volcar(
  cuerpo: ReadableStream<Uint8Array>,
  destino: string,
  alProgreso: (bytes: number) => void,
): Promise<number> {
  let bytes = 0;
  let avisado = 0;
  const contar = new Transform({
    transform(trozo: Buffer, _codificacion, listo) {
      bytes += trozo.length;
      if (bytes - avisado >= AVISO_BYTES) {
        avisado = bytes;
        alProgreso(bytes);
      }
      listo(null, trozo);
    },
  });
  await pipeline(Readable.fromWeb(cuerpo as WebReadableStream<Uint8Array>), contar, fs.createWriteStream(destino));
  return bytes;
}

const descargarZip: DescargarZip = async (url, destino, alProgreso) => {
  if (!esUrlDePlataforma(url)) return fail('url_no_permitida', `No se descarga fuera de la PLACSP: ${url}`);
  // Como el feed: una redirección no puede sacar la descarga de la PLACSP.
  const r = await pedirPermitida(
    url,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    esUrlDePlataforma,
  );
  if (r.error) return r;
  const res = r.data;
  try {
    if (!res.ok || !res.body) return fail(`placsp_http_${res.status}`, res.statusText);
    // Si el ZIP no existe, la PLACSP responde 200 con una página HTML de error.
    if (!(res.headers.get('content-type') ?? '').includes('zip')) {
      await res.body.cancel();
      return fail('placsp_sin_zip', 'La PLACSP no tiene ese ZIP (respondió con una página de error).');
    }
    return ok({ bytes: await volcar(res.body, destino, alProgreso) });
  } catch (err) {
    fs.rmSync(destino, { force: true });
    return fail('placsp_inalcanzable', errorMessage(err));
  }
};

/** alCandidatas: cuántas licitaciones abiertas del histórico acaban de pasar el prefiltro. */
export type OpcionesCarga = {
  dataDir: string;
  todo: boolean;
  descargar?: DescargarZip;
  hoy?: Date;
  alCandidatas?: (nuevas: number) => void;
};

type Pieza = { fila: FilaHistorico; indice: number; url: string; zip: string };
type Contexto = { sector: Sector; o: OpcionesCarga };

const ahora = () => new Date().toISOString();

function marcar(db: Db, f: Pick<FilaHistorico, 'fuente' | 'anio'>, estado: string, error: string | null = null): void {
  db.prepare(
    `UPDATE historico_estado SET estado = ?, error = ?, actualizado_en = ?,
    terminado_en = CASE WHEN ? IN ('hecho', 'error') THEN ? ELSE NULL END WHERE fuente = ? AND anio = ?`,
  ).run(estado, error, ahora(), estado, ahora(), f.fuente, f.anio);
}

function sumarAtom(db: Db, p: Pieza, indice: number, c: Cuenta): void {
  db.prepare(
    `UPDATE historico_estado SET atoms_hechos = ?, entradas = entradas + ?, guardadas = guardadas + ?,
    fuera_de_sector = fuera_de_sector + ?, errores = errores + ?, actualizado_en = ? WHERE fuente = ? AND anio = ?`,
  ).run(indice + 1, c.entradas, c.guardadas, c.fuera_de_sector, c.errores, ahora(), p.fila.fuente, p.fila.anio);
}

async function bajarPieza(db: Db, p: Pieza, descargar: DescargarZip): Promise<Result<void>> {
  if (fs.existsSync(p.zip)) return ok(undefined);
  marcar(db, p.fila, 'descargando');
  const parcial = `${p.zip}.part`;
  const progreso = db.prepare(
    'UPDATE historico_estado SET bytes = ?, actualizado_en = ? WHERE fuente = ? AND anio = ?',
  );
  progreso.run(0, ahora(), p.fila.fuente, p.fila.anio);
  // Un ZIP nuevo puede traer otros .atom: se recorre desde el principio.
  db.prepare('UPDATE historico_estado SET atoms_hechos = 0 WHERE fuente = ? AND anio = ?').run(
    p.fila.fuente,
    p.fila.anio,
  );
  const r = await descargar(p.url, parcial, (bytes) => progreso.run(bytes, ahora(), p.fila.fuente, p.fila.anio));
  if (r.error) {
    fs.rmSync(parcial, { force: true });
    return r;
  }
  progreso.run(r.data.bytes, ahora(), p.fila.fuente, p.fila.anio);
  fs.renameSync(parcial, p.zip);
  return ok(undefined);
}

function alAtom(db: Db, p: Pieza, c: Contexto): AlAtom {
  const fuente = FUENTES[p.fila.fuente];
  return (xml, indice) => {
    const nuevas = db.transaction(() => {
      const r = procesarAtomHistorico(db, fuente, xml, c.sector);
      sumarAtom(db, p, indice, r);
      return prefiltrar(db, r.abiertas, c.o.hoy?.getTime() ?? Date.now());
    })();
    if (nuevas > 0) c.o.alCandidatas?.(nuevas);
  };
}

async function cargarPieza(db: Db, p: Pieza, c: Contexto): Promise<Result<void>> {
  const bajada = await bajarPieza(db, p, c.o.descargar ?? descargarZip);
  if (bajada.error) return bajada;
  marcar(db, p.fila, 'procesando');
  const saltar = (
    db
      .prepare('SELECT atoms_hechos FROM historico_estado WHERE fuente = ? AND anio = ?')
      .get(p.fila.fuente, p.fila.anio) as { atoms_hechos: number }
  ).atoms_hechos;
  const r = await recorrerAtoms(p.zip, saltar, alAtom(db, p, c));
  // La pieza se apunta antes de borrar el ZIP: un corte entre medias no la repite.
  if (!r.error) {
    db.prepare(
      `UPDATE historico_estado SET piezas_hechas = ?, atoms_hechos = 0, actualizado_en = ? WHERE fuente = ? AND anio = ?`,
    ).run(p.indice + 1, ahora(), p.fila.fuente, p.fila.anio);
  }
  // Un ZIP que no se puede leer no se reintenta tal cual: la próxima vez se vuelve a bajar.
  fs.rmSync(p.zip, { force: true });
  return r.error ? r : ok(undefined);
}

function rutaTemporal(dataDir: string, f: FilaHistorico, indice: number): string {
  return path.join(dataDir, 'historico-tmp', `${f.fuente}-${f.anio}-${String(indice + 1).padStart(2, '0')}.zip`);
}

async function cargarAnio(db: Db, fila: FilaHistorico, o: OpcionesCarga): Promise<Result<void>> {
  // El año en curso gana un ZIP cada mes: el total se recalcula al reanudar.
  const urls = piezasDe(FUENTES[fila.fuente], fila.anio, o.hoy);
  db.prepare('UPDATE historico_estado SET piezas_total = ? WHERE fuente = ? AND anio = ?').run(
    urls.length,
    fila.fuente,
    fila.anio,
  );
  const c: Contexto = { sector: sectorActual(db, o.todo), o };
  fs.mkdirSync(path.join(o.dataDir, 'historico-tmp'), { recursive: true });
  for (let indice = fila.piezas_hechas; indice < urls.length; indice += 1) {
    const pieza: Pieza = { fila, indice, url: urls[indice] ?? '', zip: rutaTemporal(o.dataDir, fila, indice) };
    const r = await cargarPieza(db, pieza, c);
    if (r.error) return r;
  }
  return ok(undefined);
}

// Un fallo inesperado (disco lleno, base bloqueada) deja el año en «error» en vez de
// quedarse «descargando» y repetirse en cada arranque.
async function cargarAnioSeguro(db: Db, fila: FilaHistorico, o: OpcionesCarga): Promise<Result<void>> {
  try {
    return await cargarAnio(db, fila, o);
  } catch (err) {
    return fail('historico_fallido', errorMessage(err));
  }
}

/**
 * Carga, uno detrás de otro, los años pendientes (y reanuda el que quedó a medias).
 * Devuelve cuántos terminó. Un año que falla queda en «error» con el motivo.
 */
export async function cargarHistorico(db: Db, o: OpcionesCarga): Promise<Result<{ hechos: number }>> {
  let hechos = 0;
  try {
    for (let fila = siguienteHistorico(db); fila; fila = siguienteHistorico(db)) {
      const r = await cargarAnioSeguro(db, fila, o);
      marcar(
        db,
        fila,
        r.error ? 'error' : 'hecho',
        r.error ? `${r.error.code}: ${r.error.message}`.slice(0, 500) : null,
      );
      if (!r.error) hechos += 1;
    }
  } catch (err) {
    return fail('historico_fallido', errorMessage(err));
  }
  return ok({ hechos });
}
