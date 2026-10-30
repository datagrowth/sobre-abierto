// CPV y lotes en tablas: licitacion_cpv, cpv (vocabulario oficial con jerarquía) y lotes.
import { CPV_2008 } from './cpv.js';
import type { LicitacionData } from './placsp/mapper.js';
import type { Db } from './store.js';

// La columna `licitaciones.cpvs` («,72000000,…,») sigue para los agregados de siempre (`instr`); `licitacion_cpv`
// deja buscar y agrupar por código con índice, y `cpv` trae el vocabulario oficial con su jerarquía para los
// filtros y los índices. `lotes` saca del JSON `datos` lo de cada lote. Las tres se escriben con cada licitación
// que se guarda (guardarLicitacion, la única vía del feed y del histórico) y se rellenan una vez con lo que ya había.
// lote '': los CPV del contrato. Un lote sin CPV propios no tiene filas: hereda los del contrato.
export const SQL_CLASIFICACION = `
CREATE TABLE IF NOT EXISTS cpv (
  codigo TEXT PRIMARY KEY, descripcion TEXT NOT NULL, nivel INTEGER NOT NULL CHECK (nivel BETWEEN 2 AND 8), padre TEXT);
CREATE INDEX IF NOT EXISTS cpv_padre ON cpv(padre);
CREATE TABLE IF NOT EXISTS licitacion_cpv (
  licitacion_id TEXT NOT NULL, lote TEXT NOT NULL DEFAULT '', cpv TEXT NOT NULL, principal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (licitacion_id, lote, cpv));
CREATE INDEX IF NOT EXISTS licitacion_cpv_cpv ON licitacion_cpv(cpv, licitacion_id);
CREATE TABLE IF NOT EXISTS lotes (
  licitacion_id TEXT NOT NULL, numero TEXT NOT NULL, titulo TEXT, presupuesto_sin_iva REAL, valor_estimado REAL,
  cpvs TEXT NOT NULL DEFAULT '', PRIMARY KEY (licitacion_id, numero));
`;

// «,72000000,72410000,» permite buscar por prefijo con instr(cpvs, ',7241').
export function cpvsTexto(cpvs: string[]): string {
  return cpvs.length ? `,${cpvs.join(',')},` : '';
}

// ─── Vocabulario ─────────────────────────────────────────────────────────────

/** Nivel de un código: sus cifras sin los ceros del final, de 2 (división) a 8. */
export function nivelCpv(codigo: string): number {
  return Math.max(2, codigo.replace(/0+$/, '').length);
}

/** El código del nivel de arriba que existe (un nivel puede faltar: se sube hasta encontrarlo). */
export function padreCpv(codigo: string, existe: (c: string) => boolean): string | null {
  const cifras = codigo.slice(0, nivelCpv(codigo));
  for (let n = cifras.length - 1; n >= 2; n--) {
    const candidato = cifras.slice(0, n).padEnd(8, '0');
    if (candidato !== codigo && existe(candidato)) return candidato;
  }
  return null;
}

/**
 * Carga el vocabulario CPV 2008 si la tabla no lo tiene entero (al arrancar Licitaciones; los
 * tests que no lo necesitan no lo cargan). Devuelve cuántos códigos escribió.
 */
export function cargarVocabularioCpv(db: Db): number {
  const hay = (db.prepare('SELECT COUNT(*) AS n FROM cpv').get() as { n: number }).n;
  if (hay >= CPV_2008.length) return 0;
  const codigos = new Set(CPV_2008.map(([c]) => c));
  const ins = db.prepare('INSERT OR REPLACE INTO cpv (codigo, descripcion, nivel, padre) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const [c, d] of CPV_2008)
      ins.run(
        c,
        d,
        nivelCpv(c),
        padreCpv(c, (x) => codigos.has(x)),
      );
  })();
  return CPV_2008.length;
}

export type CpvDescrito = { codigo: string; prefijo: string; descripcion: string | null; nivel: number };

/** Prefijos de 2 a 8 cifras (los del prefiltro) con su descripción oficial; null si no está en el vocabulario. */
export function describirCpvs(db: Db, prefijos: string[]): CpvDescrito[] {
  const buscar = db.prepare('SELECT descripcion FROM cpv WHERE codigo = ?');
  return prefijos.map((prefijo) => {
    const codigo = prefijo.padEnd(8, '0');
    const f = buscar.get(codigo) as { descripcion: string } | undefined;
    return { codigo, prefijo, descripcion: f?.descripcion ?? null, nivel: nivelCpv(codigo) };
  });
}

/**
 * El buscador de los filtros: con cifras, los códigos que empiezan así; con letras, los que lo
 * dicen en la descripción. Los generales primero, para que «72» ofrezca antes la división que sus hojas.
 */
export function buscarCpv(db: Db, texto: string, limite = 20): CpvDescrito[] {
  const t = texto.trim();
  const porCifras = /^\d+$/.test(t);
  const patron = porCifras ? `${t}%` : `%${t.replace(/[\\%_]/g, '\\$&')}%`;
  const filas = db
    .prepare(
      `SELECT codigo, descripcion, nivel FROM cpv WHERE ${porCifras ? 'codigo' : 'descripcion'} LIKE ? ESCAPE '\\'
    ORDER BY nivel, codigo LIMIT ?`,
    )
    .all(patron, limite) as { codigo: string; descripcion: string; nivel: number }[];
  return filas.map((f) => ({ ...f, prefijo: f.codigo.slice(0, f.nivel) }));
}

// ─── Escritura con cada licitación ───────────────────────────────────────────

/** Sustituye los CPV y los lotes de una licitación por los de esta versión. Va en la transacción de quien guarda. */
export function guardarClasificacion(db: Db, l: Pick<LicitacionData, 'id' | 'cpvs' | 'lotes'>): void {
  db.prepare('DELETE FROM licitacion_cpv WHERE licitacion_id = ?').run(l.id);
  db.prepare('DELETE FROM lotes WHERE licitacion_id = ?').run(l.id);
  const cpv = db.prepare(
    'INSERT OR IGNORE INTO licitacion_cpv (licitacion_id, lote, cpv, principal) VALUES (?, ?, ?, ?)',
  );
  // El CODICE no marca cuál es el principal: hace de principal el primero que publica el órgano.
  l.cpvs.forEach((c, i) => cpv.run(l.id, '', c, i === 0 ? 1 : 0));
  const lote = db.prepare(
    'INSERT OR IGNORE INTO lotes (licitacion_id, numero, titulo, presupuesto_sin_iva, valor_estimado, cpvs) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const x of l.lotes) {
    lote.run(l.id, x.id, x.nombre, x.presupuesto_sin_iva, x.valor_estimado ?? null, cpvsTexto(x.cpvs));
    x.cpvs.forEach((c, i) => cpv.run(l.id, x.id, c, i === 0 ? 1 : 0));
  }
}

/**
 * Relleno de una vez con lo que ya había (arreglo de store.ts): en SQL, porque son cientos de
 * miles de licitaciones. Las de `datos` que no son JSON válido se saltan en vez de tumbar la migración.
 */
export function rellenarClasificacion(db: Db): void {
  db.exec(`
    INSERT OR IGNORE INTO licitacion_cpv (licitacion_id, lote, cpv, principal)
      SELECT l.id, '', j.value, j.key = 0 FROM licitaciones l, json_each('["' || replace(trim(l.cpvs, ','), ',', '","') || '"]') j
      WHERE l.cpvs <> '';
    INSERT OR IGNORE INTO lotes (licitacion_id, numero, titulo, presupuesto_sin_iva, valor_estimado, cpvs)
      SELECT l.id, COALESCE(json_extract(x.value, '$.id'), '?'), json_extract(x.value, '$.nombre'), json_extract(x.value, '$.presupuesto_sin_iva'),
        json_extract(x.value, '$.valor_estimado'),
        COALESCE((SELECT ',' || group_concat(c.value, ',') || ',' FROM json_each(x.value, '$.cpvs') c), '')
      FROM licitaciones l, json_each(l.datos, '$.lotes') x WHERE json_valid(l.datos);
    INSERT OR IGNORE INTO licitacion_cpv (licitacion_id, lote, cpv, principal)
      SELECT l.id, COALESCE(json_extract(x.value, '$.id'), '?'), c.value, c.key = 0
      FROM licitaciones l, json_each(l.datos, '$.lotes') x, json_each(x.value, '$.cpvs') c WHERE json_valid(l.datos);
  `);
}
