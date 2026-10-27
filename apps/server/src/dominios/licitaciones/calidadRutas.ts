// API web de la calidad del dato (/api/licitaciones/calidad, Ajustes › Fuentes).
import type { Router } from 'express';
import { responder } from '../../nucleo/http.js';
import { ok } from '../../nucleo/result.js';
import { resumenActasMercado } from './actasMercado.js';
import { resumenCalidad } from './calidad.js';
import { dbLicitaciones } from './db.js';
import { historialAcierto, ultimoAcierto } from './indices/acierto.js';

// Incidencias por regla, lo que queda fuera de los índices, pliegos que no se leen, la prueba hacia atrás de los
// índices y las actas de expedientes ajenos.
export function rutasCalidad(r: Router): void {
  r.get('/calidad', (_req, res) => {
    const db = dbLicitaciones();
    responder(
      res,
      ok({
        ...resumenCalidad(db),
        acierto: { ultimo: ultimoAcierto(db), historial: historialAcierto(db) },
        actas_mercado: resumenActasMercado(db),
      }),
    );
  });
}
