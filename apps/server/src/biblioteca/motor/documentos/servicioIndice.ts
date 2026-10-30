// Lado del servidor del índice de la Biblioteca: hilo del indexador, búsquedas por significado y lectura del índice.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { obtenerRutaBiblioteca } from '../configuracion.js';
import { logger } from '../../../nucleo/log.js';
import * as store from './almacen.js';
import type { DesdeWorker, EstadoIndexador, HaciaWorker, DatosWorker } from './protocolo.js';

const log = logger('indexador');
const TIEMPO_MAXIMO_CONSULTA_MS = 20_000;
const REINICIO_MS = 30_000;
const COMPROBACION_BIBLIOTECA_MS = 30_000;

// Arranca el hilo del indexador para la bóveda configurada y abre el índice en solo lectura
// para la búsqueda por palabras.
let worker: Worker | null = null;
let raizWorker: string | null = null;
let estado: EstadoIndexador | null = null;
let fatal: string | null = null;
let siguienteConsulta = 1;
const esperando = new Map<number, (hits: { id: number; score: number }[]) => void>();
let bdLectura: { dir: string; db: store.BaseDatos } | null = null;

/** Dónde vive el índice de una bóveda (fuera de ella en Docker, para no mezclarlo con lo que va a Drive). */
function carpetaIndiceDe(raiz: string): string {
  return process.env.BIBLIOTECA_INDEX_DIR?.trim() || path.join(raiz, '.hermes-vault', 'index');
}

function carpetaModelosDe(raiz: string): string {
  return process.env.BIBLIOTECA_MODELS_DIR?.trim() || path.join(raiz, '.hermes-vault', 'models');
}

// En desarrollo (tsx) el hilo se carga desde el .ts; compilado, desde el .js.
function urlWorker(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

function alRecibirMensaje(mensaje: DesdeWorker): void {
  if (mensaje.type === 'status') estado = mensaje.status;
  else if (mensaje.type === 'fatal') fatal = mensaje.error;
  else {
    esperando.get(mensaje.id)?.(mensaje.hits);
    esperando.delete(mensaje.id);
  }
}

function lanzar(raiz: string): void {
  const datos: DatosWorker = { raiz, carpetaIndice: carpetaIndiceDe(raiz), carpetaModelos: carpetaModelosDe(raiz) };
  const w = new Worker(urlWorker(), { workerData: datos });
  worker = w;
  raizWorker = raiz;
  fatal = null;
  w.on('message', alRecibirMensaje);
  w.on('error', (err) => {
    fatal = err.message;
  });
  w.on('exit', (codigo) => {
    if (worker !== w) return;
    worker = null;
    for (const resolve of esperando.values()) resolve([]);
    esperando.clear();
    log.warn('el indexador se detuvo; se reinicia', {
      codigo,
      causa: fatal ?? null,
      reinicio_s: REINICIO_MS / 1000,
    });
    setTimeout(asegurarIndexador, REINICIO_MS).unref();
  });
}

// Arranca el indexador, o lo cambia de bóveda si se eligió otra en Ajustes.
function asegurarIndexador(): void {
  const raiz = obtenerRutaBiblioteca();
  if (raiz === raizWorker && worker) return;
  if (worker) {
    const anterior = worker;
    worker = null;
    void anterior.terminate();
  }
  estado = null;
  cerrarIndiceLectura();
  if (raiz && fs.existsSync(raiz)) lanzar(raiz);
  else raizWorker = null;
}

export function iniciarIndexador(): void {
  asegurarIndexador();
  setInterval(asegurarIndexador, COMPROBACION_BIBLIOTECA_MS).unref();
  log.info('indexando notas y documentos', { carpeta: raizWorker ?? '(sin bóveda)' });
}

/** Pide al indexador que mire ya si hay cambios (p. ej. tras aprobar una propuesta). */
export function pedirReescaneo(): void {
  worker?.postMessage({ type: 'rescan' } satisfies HaciaWorker);
}

export function estadoIndexador(): { running: boolean; error: string | null; status: EstadoIndexador | null } {
  return { running: worker !== null, error: fatal, status: estado };
}

/**
 * Trozos más parecidos en significado a un texto (solo entre `ids` si se dan). Vacío si el
 * modelo aún no está listo.
 */
export function busquedaSemantica(texto: string, k: number, ids?: number[]): Promise<{ id: number; score: number }[]> {
  if (!worker) return Promise.resolve([]);
  const id = siguienteConsulta++;
  return new Promise((resolve) => {
    const temporizador = setTimeout(() => {
      esperando.delete(id);
      resolve([]);
    }, TIEMPO_MAXIMO_CONSULTA_MS);
    esperando.set(id, (aciertos) => {
      clearTimeout(temporizador);
      resolve(aciertos);
    });
    worker!.postMessage({ type: 'query', id, text: texto, k, ...(ids ? { ids } : {}) } satisfies HaciaWorker);
  });
}

export function cerrarIndiceLectura(): void {
  bdLectura?.db.close();
  bdLectura = null;
}

/** El índice en solo lectura, o null si aún no existe. */
export function abrirIndiceLectura(): store.BaseDatos | null {
  const raiz = obtenerRutaBiblioteca();
  if (!raiz) return null;
  const directorio = carpetaIndiceDe(raiz);
  if (bdLectura?.dir === directorio) return bdLectura.db;
  if (!fs.existsSync(store.rutaArchivoIndice(directorio))) return null;
  try {
    bdLectura = { dir: directorio, db: store.abrirIndice(directorio, true) };
    return bdLectura.db;
  } catch {
    return null;
  }
}
