// Tablas de los índices de mercado, aparte para que store.ts las cree sin importar el cálculo.

// indices_segmento es la caché de cada noche: una fila por segmento (tipo, CPV, banda de importe, grupo de
// procedimiento y órgano) con sus cifras y, en datos, el cálculo entero. indices_acierto es la prueba hacia
// atrás de cada mes.
export const SQL_INDICES = `
CREATE TABLE IF NOT EXISTS indices_segmento (
  clave TEXT PRIMARY KEY, nivel_cpv INTEGER NOT NULL, n INTEGER NOT NULL, ofertas_p25 REAL, ofertas_p50 REAL, ofertas_p75 REAL,
  p_un_licitador REAL, baja_p25 REAL, baja_p50 REAL, baja_p75 REAL, baja_esperada REAL, confianza TEXT NOT NULL,
  datos TEXT NOT NULL, actualizado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS indices_acierto (
  indice TEXT NOT NULL, mes TEXT NOT NULL, n INTEGER NOT NULL, error_absoluto_medio REAL, cobertura_rango REAL, sesgo REAL,
  calculado_en TEXT NOT NULL, PRIMARY KEY (indice, mes));
`;

// Contratos que vencen y que una persona sigue (renovaciones.ts): encontrada_id, su nueva licitación.
export const SQL_RENOVACIONES = `
CREATE TABLE IF NOT EXISTS renovaciones_seguidas (
  licitacion_id TEXT NOT NULL, lote TEXT NOT NULL DEFAULT '', organo_nif TEXT NOT NULL, cpvs4 TEXT NOT NULL, fin_estimado TEXT,
  usuario_id INTEGER, creada_en TEXT NOT NULL, encontrada_id TEXT, encontrada_en TEXT, PRIMARY KEY (licitacion_id, lote));
`;
