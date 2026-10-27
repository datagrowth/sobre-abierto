// La tabla de las actas de expedientes ajenos (actasMercado.ts), aparte para que store.ts la cree
// sin importar la lectura. texto: lo que se pasa a Hermes cuando el código no basta (se borra al leerla).
export const SQL_ACTAS_MERCADO = `
CREATE TABLE IF NOT EXISTS actas_mercado (
  licitacion_id TEXT PRIMARY KEY, estado TEXT NOT NULL, documento_nombre TEXT, documento_url TEXT, licitadores INTEGER NOT NULL DEFAULT 0,
  texto TEXT, error TEXT, revisada_en TEXT NOT NULL, pedida_en TEXT);
CREATE INDEX IF NOT EXISTS actas_mercado_estado ON actas_mercado(estado, revisada_en);
`;
