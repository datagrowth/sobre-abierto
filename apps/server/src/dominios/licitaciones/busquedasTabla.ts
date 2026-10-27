// La tabla de las búsquedas guardadas (busquedasGuardadas.ts), aparte y sin importar nada: store.ts
// la crea con el esquema y no puede importar la lógica, que llega hasta store.ts por la lista.
export const SQL_BUSQUEDAS = `
CREATE TABLE IF NOT EXISTS busquedas_guardadas (
  id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, nombre TEXT NOT NULL, consulta TEXT NOT NULL,
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('diaria', 'semanal')), activa INTEGER NOT NULL DEFAULT 1,
  avisada_hasta TEXT, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS busquedas_guardadas_usuario ON busquedas_guardadas(usuario_id, id);
`;
