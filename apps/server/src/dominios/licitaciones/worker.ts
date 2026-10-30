// Hilo de ingesta de licitaciones: sincroniza las fuentes PLACSP, pasa el prefiltro a lo nuevo y cuenta su estado.
import { parentPort, workerData } from 'node:worker_threads';
import { FUENTES, type FuenteId } from './placsp/fuentes.js';
import { abrirLicitaciones, contarLicitaciones, syncEstado } from './store.js';
import { abrirNucleo } from '../../nucleo/db.js';
import { sincronizarFuente } from './sincronizar.js';
import { prefiltrar, reevaluarCandidatas, reprocesarLotes, revisarTodosLosLotes } from './prefiltro.js';
import { cargarHistorico } from './historicoCarga.js';
import { logger } from '../../nucleo/log.js';
import type { DatosIngesta, DesdeIngesta, EstadoIngesta, HaciaIngesta, ResumenVuelta } from './protocolo.js';

// Corre cada N minutos. Parsear páginas de 13 MB no debe frenar al servidor, por eso va aparte.
const datos = workerData as DatosIngesta;
// nucleo.db se crea antes de adjuntarla a licitaciones.db.
abrirNucleo(datos.dataDir).close();
const db = abrirLicitaciones(datos.dataDir);
const ultimas: Partial<Record<FuenteId, ResumenVuelta>> = {};
let fase: EstadoIngesta['fase'] = 'esperando';
let despertar: (() => void) | null = null;
let historico: Promise<void> | null = null;
const log = logger('licitaciones.historico');
const logIngesta = logger('licitaciones');

function post(msg: DesdeIngesta): void {
  parentPort?.postMessage(msg);
}

function estado(): EstadoIngesta {
  const fuentes = Object.fromEntries(
    datos.fuentes.map((f) => [f, { ...syncEstado(db, f), ultima: ultimas[f] ?? null }]),
  );
  return { fase, fuentes, contadores: contarLicitaciones(db) };
}

async function vuelta(): Promise<void> {
  let candidatas = 0;
  for (const f of datos.fuentes) {
    fase = `sincronizando ${f}`;
    post({ type: 'estado', estado: estado() });
    const r = await sincronizarFuente(db, FUENTES[f], datos.maxPaginas);
    ultimas[f] = {
      en: new Date().toISOString(),
      paginas: r.paginas,
      entradas: r.entradas,
      errores: r.errores,
      cambiadas: r.cambiadas.length,
      error: r.error,
    };
    candidatas += prefiltrar(db, r.cambiadas);
    revisarTodosLosLotes(db, r.cambiadas);
  }
  fase = 'esperando';
  post({ type: 'estado', estado: estado() });
  if (candidatas > 0) post({ type: 'candidatas', nuevas: candidatas });
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    despertar = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

async function bucle(): Promise<void> {
  for (;;) {
    await vuelta();
    await dormir(datos.syncMinutos * 60_000);
  }
}

// El histórico corre en este mismo hilo, intercalado con la sincronización: cede el
// turno entre trozos del ZIP, así que el feed en vivo sigue al día mientras tanto.
function lanzarHistorico(): void {
  if (historico) return;
  const alCandidatas = (nuevas: number) => post({ type: 'candidatas', nuevas });
  historico = cargarHistorico(db, { dataDir: datos.dataDir, todo: datos.historicoTodo, alCandidatas })
    .then((r) => {
      if (r.error) log.error('carga del histórico fallida', { error: r.error.message });
    })
    .finally(() => {
      historico = null;
    });
}

parentPort?.on('message', (msg: HaciaIngesta) => {
  if (msg.type === 'sync') despertar?.();
  if (msg.type === 'historico') lanzarHistorico();
  if (msg.type === 'prefiltrar') {
    reevaluarCandidatas(db);
    const nuevas = prefiltrar(db, 'todas');
    post({ type: 'estado', estado: estado() });
    if (nuevas > 0) post({ type: 'candidatas', nuevas });
  }
});

// Lo guardado con una versión anterior del prefiltro se pone al día antes de la primera
// vuelta; las candidatas nuevas se avisan como las de cualquier vuelta. Si falla, la
// ingesta sigue: se reintenta en el siguiente arranque o al guardar Filtros.
try {
  const reprocesadas = reprocesarLotes(db);
  if (reprocesadas > 0) post({ type: 'candidatas', nuevas: reprocesadas });
} catch (err) {
  logIngesta.error('reproceso del prefiltro por lote fallido', {
    error: err instanceof Error ? err.message : String(err),
  });
}
// Lo que quedó a medias en el arranque anterior se reanuda solo.
lanzarHistorico();
bucle().catch((err: unknown) => {
  post({ type: 'fatal', error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
