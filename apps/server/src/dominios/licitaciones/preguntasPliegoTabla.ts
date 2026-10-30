// La tabla de «Preguntar al pliego» (preguntasPliego.ts), aparte y sin importar nada: store.ts la crea.

// store.ts la crea con el esquema y no puede importar la lógica. estado: pendiente (en la cola de Hermes),
// respondida o fallida; dice: si el pliego lo dice (0: «el pliego no lo dice»); comprobada: la cita se encontró
// literal en los pliegos; en_comprobaciones: una persona la pasó a una fila de las comprobaciones.
export const SQL_PREGUNTAS_PLIEGO = `
CREATE TABLE IF NOT EXISTS preguntas_pliego (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, pregunta TEXT NOT NULL, quien TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'respondida', 'fallida')),
  dice INTEGER, respuesta TEXT, cita TEXT, documento TEXT, pagina INTEGER, comprobada INTEGER NOT NULL DEFAULT 0,
  agente TEXT, en_comprobaciones INTEGER NOT NULL DEFAULT 0, creada_en TEXT NOT NULL, respondida_en TEXT);
CREATE INDEX IF NOT EXISTS preguntas_pliego_licitacion ON preguntas_pliego(licitacion_id, id);
`;
