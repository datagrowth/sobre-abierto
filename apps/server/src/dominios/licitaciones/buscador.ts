// Búsqueda de texto de Licitaciones: título, órgano, expediente y lotes en licitaciones.db, y pliegos en la Biblioteca.
import { z } from 'zod';
import { percentiles, type Percentiles } from '../../nucleo/estadistica.js';
import { Bandera } from '../../nucleo/http.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import type { LicitacionData } from './placsp/mapper.js';
import type { Db } from './store.js';

// `busca_texto` (FTS5 en licitaciones.db, con el rowid de la licitación) indexa el título, el órgano, el
// expediente y los títulos de los lotes. El texto de los pliegos no se copia: ya está en el índice de la
// Biblioteca (biblioteca.db, FTS5 con página) y se busca ahí entre los pliegos descargados, cruzando por
// `pliegos.ruta`. `GET /buscar` junta las dos con los agregados de lo encontrado; la lista de Oportunidades
// usa la misma búsqueda.
export const SQL_BUSCADOR = `
CREATE VIRTUAL TABLE IF NOT EXISTS busca_texto USING fts5(
  titulo, organo, expediente, lotes, tokenize='unicode61 remove_diacritics 2');
`;

// ─── Índice ──────────────────────────────────────────────────────────────────

/** Indexa (o reindexa) una licitación ya guardada. Va en la transacción de quien guarda. */
export function indexarTexto(
  db: Db,
  l: Pick<LicitacionData, 'id' | 'titulo' | 'organo' | 'expediente' | 'lotes'>,
): void {
  const f = db.prepare('SELECT rowid FROM licitaciones WHERE id = ?').get(l.id) as { rowid: number } | undefined;
  if (!f) return;
  const lotes = l.lotes
    .map((x) => x.nombre)
    .filter(Boolean)
    .join(' · ');
  db.prepare(
    'INSERT OR REPLACE INTO busca_texto (rowid, titulo, organo, expediente, lotes) VALUES (?, ?, ?, ?, ?)',
  ).run(f.rowid, l.titulo, l.organo.nombre, l.expediente, lotes);
}

/** Relleno de una vez con lo que ya había (arreglo de store.ts, después del de los lotes). */
export function rellenarBuscador(db: Db): void {
  db.exec(`INSERT OR REPLACE INTO busca_texto (rowid, titulo, organo, expediente, lotes)
    SELECT l.rowid, l.titulo, l.organo_nombre, l.expediente, COALESCE((SELECT group_concat(t.titulo, ' · ') FROM lotes t WHERE t.licitacion_id = l.id), '')
    FROM licitaciones l`);
}

// ─── Consultas ───────────────────────────────────────────────────────────────

// Lo que separa palabras para FTS5 (unicode61): todo lo que no es letra ni cifra.
const PALABRA = /[\p{L}\p{N}]+/gu;
const MAX_TERMINOS = 12;

/**
 * Consulta FTS5 de un texto libre: todas las palabras, cada una también como principio de otra
 * («form» encuentra «formación»), como al teclear. null si no queda ninguna palabra.
 */
export function consultaFts(texto: string): string | null {
  const terminos = [...new Set((texto.match(PALABRA) ?? []).map((t) => t.toLowerCase()))].slice(0, MAX_TERMINOS);
  return terminos.length ? terminos.map((t) => `"${t}"*`).join(' AND ') : null;
}

/** Los rowid de las licitaciones cuyo título, órgano, expediente o lotes casan, por relevancia. */
export function rowidsPorTexto(db: Db, texto: string, max = 5000): number[] {
  const match = consultaFts(texto);
  if (!match) return [];
  // El título pesa más que el órgano; el expediente y los lotes, como el título.
  return (
    db
      .prepare(
        'SELECT rowid FROM busca_texto WHERE busca_texto MATCH ? ORDER BY bm25(busca_texto, 4.0, 1.0, 4.0, 2.0) LIMIT ?',
      )
      .all(match, max) as { rowid: number }[]
  ).map((f) => f.rowid);
}

export type EnPliego = {
  licitacion_id: string;
  documento: string;
  clase: string;
  pagina: number | null;
  texto: string;
};

const LARGO_FRAGMENTO = 280;
const MAX_TROZOS = 400;

// El trozo cortado alrededor de la primera palabra buscada que aparece.
function fragmento(texto: string, terminos: string[]): string {
  const comparable = texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const en = Math.max(0, Math.min(...terminos.map((t) => comparable.indexOf(t)).filter((i) => i >= 0), texto.length));
  const desde = Math.max(0, Math.min(en - 80, texto.length - LARGO_FRAGMENTO));
  return `${desde > 0 ? '…' : ''}${texto.slice(desde, desde + LARGO_FRAGMENTO).trim()}${desde + LARGO_FRAGMENTO < texto.length ? '…' : ''}`;
}

/**
 * El mejor pasaje de los pliegos descargados de cada licitación (de `ids`) que casa con el texto.
 * Sin índice de la Biblioteca, o con una consulta que FTS5 no acepta, nada.
 */
export function enPliegos(db: Db, idx: indice.BaseDatos | null, texto: string, ids: string[]): Map<string, EnPliego> {
  const match = consultaFts(texto);
  const salida = new Map<string, EnPliego>();
  if (!idx || !match || !ids.length) return salida;
  const pliegos = new Map<string, { licitacion_id: string; clase: string }>();
  const consulta = db.prepare(
    "SELECT licitacion_id, ruta, clase FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL",
  );
  for (const id of ids)
    for (const p of consulta.all(id) as { licitacion_id: string; ruta: string; clase: string }[])
      pliegos.set(p.ruta, p);
  let trozos: indice.AciertoTrozo[] = [];
  try {
    trozos = indice.buscarFtsEnRutas(idx, match, [...pliegos.keys()], MAX_TROZOS);
  } catch {
    return salida;
  }
  const terminos = (texto.match(PALABRA) ?? []).map((t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
  for (const t of trozos) {
    const p = pliegos.get(t.path);
    if (!p || salida.has(p.licitacion_id)) continue;
    salida.set(p.licitacion_id, {
      licitacion_id: p.licitacion_id,
      documento: t.path,
      clase: p.clase,
      pagina: t.page,
      texto: fragmento(t.text, terminos),
    });
  }
  return salida;
}

// ─── GET /buscar ─────────────────────────────────────────────────────────────

const lista = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(item).max(50));

/** Una búsqueda (la misma forma la guardan las búsquedas guardadas). Todo llega como texto en la query. */
export const Busqueda = z.object({
  q: z.string().trim().min(2, 'Escribe al menos dos letras.').max(200),
  // oportunidades: lo que entró por el prefiltro; todas: también el histórico y lo que no pasó.
  ambito: z.enum(['oportunidades', 'todas']).default('oportunidades'),
  pliegos: Bandera,
  abiertas: Bandera,
  cpv: lista(z.string().regex(/^\d{2,8}$/)),
  comunidad: lista(z.string().regex(/^ES[0-9A-Z]{2}$/)),
  tipos: lista(z.string().regex(/^\d{1,3}$/)),
  importe_min: z.coerce.number().nonnegative().max(1e12).optional(),
  importe_max: z.coerce.number().nonnegative().max(1e12).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});
export type BusquedaData = z.infer<typeof Busqueda>;

type Encontrada = {
  id: string;
  expediente: string;
  titulo: string;
  organo: string;
  importe: number | null;
  fecha_limite: string | null;
  tipo_contrato: string | null;
  estado: string | null;
  en_titulo: boolean;
  en_pliego: EnPliego | null;
};
type Cuenta = { clave: string; n: number };
type Agregados = {
  abiertas: number;
  por_estado: Cuenta[];
  por_tipo: Cuenta[];
  por_comunidad: Cuenta[];
  por_division: (Cuenta & { descripcion: string | null })[];
  importe: Percentiles & { n: number };
};
export type ResultadoBusqueda = { total: number; items: Encontrada[]; agregados: Agregados; pliegos_buscados: boolean };

type Fila = Omit<Encontrada, 'en_titulo' | 'en_pliego'> & {
  rowid: number;
  nuts: string | null;
  division: string | null;
};

// Un prefijo CPV como rango de texto: «72» va de «72» (incluido) a «73», con el índice de licitacion_cpv.
export function rangoPrefijo(p: string): [string, string] {
  return [p, `${p.slice(0, -1)}${String.fromCharCode(p.charCodeAt(p.length - 1) + 1)}`];
}

function condiciones(b: BusquedaData, ahora: string): { donde: string[]; args: unknown[] } {
  const donde = ['l.borrada_en IS NULL'];
  const args: unknown[] = [];
  if (b.ambito === 'oportunidades') donde.push('o.licitacion_id IS NOT NULL');
  if (b.abiertas) {
    donde.push('l.fecha_limite >= ?');
    args.push(ahora);
  }
  if (b.cpv.length) {
    donde.push(
      `EXISTS (SELECT 1 FROM licitacion_cpv c WHERE c.licitacion_id = l.id AND (${b.cpv.map(() => '(c.cpv >= ? AND c.cpv < ?)').join(' OR ')}))`,
    );
    args.push(...b.cpv.flatMap(rangoPrefijo));
  }
  if (b.comunidad.length) {
    donde.push(`(${b.comunidad.map(() => 'l.nuts LIKE ?').join(' OR ')})`);
    args.push(...b.comunidad.map((c) => `${c}%`));
  }
  if (b.tipos.length) {
    donde.push(`l.tipo_contrato IN (${b.tipos.map(() => '?').join(',')})`);
    args.push(...b.tipos);
  }
  if (b.importe_min !== undefined) {
    donde.push('l.presupuesto_sin_iva >= ?');
    args.push(b.importe_min);
  }
  if (b.importe_max !== undefined) {
    donde.push('l.presupuesto_sin_iva <= ?');
    args.push(b.importe_max);
  }
  return { donde, args };
}

// `ids` va en una tabla temporal: pueden ser miles y no caben como parámetros de un IN.
function filas(db: Db, rowids: number[], b: BusquedaData, ahora: string): Fila[] {
  db.exec(
    'CREATE TEMP TABLE IF NOT EXISTS busqueda_ids (rowid_l INTEGER PRIMARY KEY, orden INTEGER NOT NULL); DELETE FROM busqueda_ids;',
  );
  const ins = db.prepare('INSERT OR IGNORE INTO busqueda_ids (rowid_l, orden) VALUES (?, ?)');
  rowids.forEach((r, i) => ins.run(r, i));
  const c = condiciones(b, ahora);
  return db
    .prepare(
      `SELECT l.rowid, l.id, l.expediente, l.titulo, l.organo_nombre AS organo, l.presupuesto_sin_iva AS importe, l.fecha_limite,
      l.tipo_contrato, o.estado, l.nuts,
      (SELECT substr(c.cpv, 1, 2) FROM licitacion_cpv c WHERE c.licitacion_id = l.id AND c.lote = '' AND c.principal = 1) AS division
    FROM busqueda_ids i JOIN licitaciones l ON l.rowid = i.rowid_l LEFT JOIN oportunidades o ON o.licitacion_id = l.id
    WHERE ${c.donde.join(' AND ')} ORDER BY i.orden`,
    )
    .all(...c.args) as Fila[];
}

function contar(valores: (string | null)[]): Cuenta[] {
  const m = new Map<string, number>();
  for (const v of valores) m.set(v ?? '', (m.get(v ?? '') ?? 0) + 1);
  return [...m].map(([clave, n]) => ({ clave, n })).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
}

function agregados(db: Db, fs: Fila[], ahora: string): Agregados {
  const importes = fs
    .map((f) => f.importe)
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const descripcion = db.prepare('SELECT descripcion FROM cpv WHERE codigo = ?');
  return {
    abiertas: fs.filter((f) => f.fecha_limite !== null && f.fecha_limite >= ahora).length,
    por_estado: contar(fs.map((f) => f.estado ?? 'sin_oportunidad')),
    por_tipo: contar(fs.map((f) => f.tipo_contrato)),
    por_comunidad: contar(fs.map((f) => f.nuts?.slice(0, 4) ?? null)),
    por_division: contar(fs.map((f) => f.division)).map((c) => ({
      ...c,
      descripcion: c.clave
        ? ((descripcion.get(c.clave.padEnd(8, '0')) as { descripcion: string } | undefined)?.descripcion ?? null)
        : null,
    })),
    importe: { ...percentiles(importes), n: importes.length },
  };
}

/** GET /buscar: lo que casa en el título (o el órgano, el expediente y los lotes) y, si se pide, en los pliegos. */
export function buscar(db: Db, b: BusquedaData, idx: indice.BaseDatos | null, ahoraMs = Date.now()): ResultadoBusqueda {
  const ahora = horaLocalEspana(ahoraMs);
  const porTexto = rowidsPorTexto(db, b.q);
  // Los pliegos solo se buscan en lo que ya pasó los filtros: son las licitaciones con pliegos bajados.
  const candidatas = b.pliegos ? filas(db, todasLasDelAmbito(db), b, ahora) : [];
  const pliego = b.pliegos
    ? enPliegos(
        db,
        idx,
        b.q,
        candidatas.map((f) => f.id),
      )
    : new Map<string, EnPliego>();
  const rowidPliego = candidatas.filter((f) => pliego.has(f.id)).map((f) => f.rowid);
  const enTitulo = new Set(porTexto);
  const todas = filas(db, [...porTexto, ...rowidPliego.filter((r) => !enTitulo.has(r))], b, ahora);
  const desde = (b.pagina - 1) * b.limite;
  const items = todas.slice(desde, desde + b.limite).map(({ rowid, nuts: _n, division: _d, ...f }) => ({
    ...f,
    en_titulo: enTitulo.has(rowid),
    en_pliego: pliego.get(f.id) ?? null,
  }));
  return {
    total: todas.length,
    items,
    agregados: agregados(db, todas, ahora),
    pliegos_buscados: b.pliegos && idx !== null,
  };
}

// Las licitaciones con algún pliego descargado: las únicas cuyos pliegos se pueden buscar.
function todasLasDelAmbito(db: Db): number[] {
  return (
    db
      .prepare(
        "SELECT DISTINCT l.rowid FROM pliegos p JOIN licitaciones l ON l.id = p.licitacion_id WHERE p.estado = 'descargado' AND p.ruta IS NOT NULL",
      )
      .all() as { rowid: number }[]
  ).map((f) => f.rowid);
}
