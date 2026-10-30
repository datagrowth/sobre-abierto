// Reanuda los ensamblados que cortó un reinicio del servidor (cada despliegue lo reinicia).
import { errorMessage } from '../../../nucleo/result.js';
import { logger } from '../../../nucleo/log.js';
import type { Db } from '../store.js';
import { esRemontado, liberarEnsamblados, remontarEnsamblado, type FilaMemoria } from './ensamblado.js';
import { guardarEvaluacion } from './rondasMemoria.js';

const log = logger('licitaciones');

// Se vuelven a montar solos con lo que la memoria ya tenía (avisos, su lote, su fase y su ronda), sin que una
// persona tenga que pulsar «Ensamblar». En la memoria se guarda además su última crítica como evaluación, como
// al cerrarla (finalizarMemoria). Vive aparte porque une el ensamblado con la memoria, que ya lo importa.
async function reanudar(db: Db, m: FilaMemoria): Promise<void> {
  const r = await remontarEnsamblado(db, m);
  // La que se volvía a montar sin IA ya guardó su evaluación al ensamblarse la primera vez.
  if (r.error || m.fase === null || esRemontado(m)) return;
  try {
    guardarEvaluacion(db, m, r.data.ruta);
  } catch (err) {
    log.warn('crítica final sin guardar como evaluación al reanudar', {
      memoria: m.id,
      error: errorMessage(err).slice(0, 200),
    });
  }
}

/** Reanuda los ensamblados cortados (liberarEnsamblados decide cuáles) y espera a que acaben. */
export async function reanudarEnsamblados(db: Db): Promise<void> {
  await Promise.all(liberarEnsamblados(db).map((m) => reanudar(db, m)));
}
