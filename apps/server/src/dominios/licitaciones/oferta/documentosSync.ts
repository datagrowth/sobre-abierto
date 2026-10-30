// Pone al día la checklist de la presentación cuando cambia lo que la forma, no al leerla.
import { escuchar } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import type { Db } from '../store.js';
import { sincronizarDocumentos } from './documentos.js';
import { guionVigente } from './guion.js';

// Cambia con un guion o unas decisiones nuevas («licitacion.guion»), los lotes de interés («licitacion.lotes»)
// o un borrador revisado, que puede ser la memoria aceptada («licitacion.borrador»). emitir() avisa en el mismo
// proceso y de forma síncrona: un fallo aquí se registra y no tumba la escritura que emitió el evento.
const EVENTOS_CHECKLIST = ['licitacion.guion', 'licitacion.lotes', 'licitacion.borrador'] as const;
const log = logger('licitaciones');

/** Sincroniza la checklist de una licitación con su guion vigente. false: aún no hay guion. */
function sincronizarConGuion(db: Db, id: string): Result<boolean> {
  try {
    const g = guionVigente(db, id);
    if (!g) return ok(false);
    sincronizarDocumentos(db, id, g);
    return ok(true);
  } catch (err) {
    return fail('db_error', errorMessage(err).slice(0, 300));
  }
}

/** Escucha los eventos que cambian la checklist. Devuelve cómo dejar de escucharlos. */
export function registrarSincronizacionDocumentos(db: () => Db = dbLicitaciones): () => void {
  const quitar = EVENTOS_CHECKLIST.map((tipo) =>
    escuchar(tipo, (e) => {
      if (!e.recurso) return;
      const r = sincronizarConGuion(db(), e.recurso);
      if (r.error)
        log.error('checklist de la oferta sin sincronizar', {
          licitacion: e.recurso,
          evento: tipo,
          error: r.error.message,
        });
    }),
  );
  return () => {
    for (const q of quitar) q();
  };
}
