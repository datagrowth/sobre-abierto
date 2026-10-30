// Lado del servidor de la ingesta: arranca el hilo, lo reinicia si cae, le pide
// sincronizar o volver a pasar el prefiltro y guarda su último estado.
import { Worker } from 'node:worker_threads';
import type { DatosIngesta, DesdeIngesta, EstadoIngesta, HaciaIngesta } from './protocolo.js';
import { logger } from '../../nucleo/log.js';

const REINICIO_MS = 30_000;
const log = logger('licitaciones.ingesta');

let hilo: Worker | null = null;
let ultimoEstado: EstadoIngesta | null = null;
let fallo: string | null = null;
let alHaberCandidatas: (nuevas: number) => void = () => {};

// En desarrollo (tsx) el hilo se carga desde el .ts; compilado, desde el .js.
function urlHilo(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

function alMensaje(msg: DesdeIngesta): void {
  if (msg.type === 'estado') ultimoEstado = msg.estado;
  else if (msg.type === 'candidatas') alHaberCandidatas(msg.nuevas);
  else fallo = msg.error;
}

function arrancar(datos: DatosIngesta): void {
  const w = new Worker(urlHilo(), { workerData: datos });
  hilo = w;
  fallo = null;
  w.on('message', alMensaje);
  w.on('error', (err) => {
    fallo = err.message;
  });
  w.on('exit', (code) => {
    if (hilo !== w) return;
    hilo = null;
    log.warn('la ingesta se detuvo; se reinicia', { code, error: fallo ?? undefined });
    setTimeout(() => arrancar(datos), REINICIO_MS).unref();
  });
}

export function iniciarIngesta(datos: DatosIngesta, onCandidatas: (nuevas: number) => void): void {
  alHaberCandidatas = onCandidatas;
  if (!hilo) arrancar(datos);
  log.info('ingesta de licitaciones iniciada', { fuentes: datos.fuentes.join(','), cada_min: datos.syncMinutos });
}

function enviar(msg: HaciaIngesta): boolean {
  hilo?.postMessage(msg);
  return hilo !== null;
}

export const pedirSync = (): boolean => enviar({ type: 'sync' });
export const pedirPrefiltro = (): boolean => enviar({ type: 'prefiltrar' });
export const pedirCargaHistorico = (): boolean => enviar({ type: 'historico' });

export function estadoIngesta(): { activa: boolean; error: string | null; estado: EstadoIngesta | null } {
  return { activa: hilo !== null, error: fallo, estado: ultimoEstado };
}
