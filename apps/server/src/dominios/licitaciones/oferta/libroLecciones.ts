// La lección como objeto: de dónde sale, a qué se aplica, cuánta evidencia la apoya y en qué estado está.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { RevisionData } from '../propuestas/revision.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { TEMAS_APARTADO, type TemaApartado } from './temasApartado.js';

const log = logger('licitaciones');

// Las fuentes (edición, mesa, decisión o precio) escriben aquí; la redacción, la Revisión y la pantalla
// Aprendizaje leen de aquí. El alcance es lo que acota a qué se aplica (más el tema de apartado) y la fuerza es
// el número de evidencias independientes. No guarda datos personales: la evidencia apunta al documento y su
// trozo literal va con los nombres de Colaboradores tapados.
export const ORIGENES_LECCION = ['edicion', 'mesa', 'decision', 'precio'] as const;
type OrigenLeccion = (typeof ORIGENES_LECCION)[number];
// licitacion: solo para la suya; organo, tipo_contrato y cpv: para las de ese valor (alcance_valor).
export const ALCANCES = ['general', 'licitacion', 'organo', 'tipo_contrato', 'cpv'] as const;
export type AlcanceLeccion = (typeof ALCANCES)[number];
// descartada: una persona dijo que no al revisarla; retirada: estuvo aceptada y ya no se aplica.
const ESTADOS_LECCION = ['pendiente', 'aceptada', 'descartada', 'retirada'] as const;
type EstadoLeccion = (typeof ESTADOS_LECCION)[number];

const Evidencia = z.object({
  licitacion_id: z.string().nullable(),
  memoria_id: z.number().int().nullable().default(null),
  documento: z.string().nullable().describe('El Word subido, el acta o el resultado del que sale'),
  ubicacion: z
    .string()
    .nullable()
    .describe('Dónde: «apartado 3 · Planificación», «criterio Metodología», «resolución»'),
  texto: z.string().max(600).describe('Trozo corto y literal, sin nombres de personas'),
  porque: z.string().max(600).optional().describe('Por qué se hizo el cambio, según la persona que lo respondió'),
});
export type EvidenciaData = z.infer<typeof Evidencia>;
const Evidencias = z.array(Evidencia);

export type Leccion = {
  id: number;
  licitacion_id: string | null;
  memoria_id: number | null;
  aprendizaje_id: number | null;
  apartado: number | null;
  apartado_titulo: string | null;
  origen: OrigenLeccion;
  alcance: AlcanceLeccion;
  alcance_valor: string | null;
  tema: TemaApartado | null;
  texto: string;
  evidencias: EvidenciaData[];
  fuerza: number;
  estado: EstadoLeccion;
  agente: string;
  creada_en: string;
  revisada_en: string | null;
  revisada_por?: string | null;
  retirada_motivo: string | null;
};
type Fila = Omit<Leccion, 'evidencias'> & { evidencias: string };

// La misma tabla la crea el esquema (store.ts) y la reconstruye la migración de las de antes.
export const SQL_TABLA_LECCIONES = (tabla: string) => `CREATE TABLE IF NOT EXISTS ${tabla} (
  id INTEGER PRIMARY KEY, licitacion_id TEXT, memoria_id INTEGER, aprendizaje_id INTEGER, apartado INTEGER, apartado_titulo TEXT,
  origen TEXT NOT NULL DEFAULT 'edicion' CHECK (origen IN (${ORIGENES_LECCION.map((o) => `'${o}'`).join(', ')})),
  alcance TEXT NOT NULL CHECK (alcance IN (${ALCANCES.map((a) => `'${a}'`).join(', ')})), alcance_valor TEXT,
  tema TEXT CHECK (tema IS NULL OR tema IN (${TEMAS_APARTADO.map((t) => `'${t}'`).join(', ')})),
  texto TEXT NOT NULL, evidencias TEXT NOT NULL DEFAULT '[]', fuerza INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (${ESTADOS_LECCION.map((e) => `'${e}'`).join(', ')})),
  agente TEXT NOT NULL, trabajo_id INTEGER, creada_en TEXT NOT NULL, revisada_en TEXT, retirada_motivo TEXT)`;

/** Evidencias independientes: dos ofertas distintas pesan más que dos cambios de la misma. */
export function fuerzaDe(evidencias: readonly EvidenciaData[]): number {
  return Math.max(1, new Set(evidencias.map((e) => e.licitacion_id ?? e.documento ?? '')).size);
}

function aLeccion(f: Fila): Leccion {
  const ev = Evidencias.safeParse(JSON.parse(f.evidencias || '[]'));
  if (!ev.success) log.warn('evidencias de lección no válidas', { leccion: f.id });
  return { ...f, evidencias: ev.success ? ev.data : [] };
}

// `where` es siempre texto fijo del código; los valores van como parámetros.
export function leccionesDonde(db: Db, where: string, ...args: unknown[]): Leccion[] {
  return (db.prepare(`SELECT * FROM lecciones WHERE ${where}`).all(...args) as Fila[]).map(aLeccion);
}

/** Los nombres de Colaboradores que aparecen en un texto (las lecciones no los guardan). */
export function personasEn(texto: string, tapar: ((t: string) => string) | null): boolean {
  return tapar !== null && tapar(texto) !== texto;
}

export type NuevaLeccion = Pick<
  Leccion,
  'licitacion_id' | 'origen' | 'alcance' | 'alcance_valor' | 'tema' | 'texto' | 'evidencias' | 'agente'
> &
  Partial<Pick<Leccion, 'memoria_id' | 'aprendizaje_id' | 'apartado' | 'apartado_titulo'>>;

// Una lección que ya está en el libro (pendiente o aceptada) con el mismo origen, alcance y tema y casi
// las mismas palabras es la misma: la nueva suma su evidencia (y, si es de otra oferta, sube su
// fuerza). La evidencia de una oferta que ya estaba se sustituye: reenviar no la cuenta dos veces.
const PARECIDO_MISMA = 0.5;
// Las palabras que cuentan para comparar enunciados (4 letras o más). Aquí y no las de
// propuestas/aprendizaje.ts: store.ts carga este módulo y aquel lo carga a él.
const palabrasSignificativas = (t: string) =>
  new Set(
    textoComparable(t)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((p) => p.length >= 4),
  );
const claveOferta = (e: EvidenciaData) => e.licitacion_id ?? e.documento ?? '';

function parecido(a: Set<string>, b: Set<string>): number {
  const comunes = [...a].filter((p) => b.has(p)).length;
  return comunes / Math.max(1, a.size + b.size - comunes);
}

function laMisma(db: Db, l: NuevaLeccion): Leccion | null {
  const palabras = palabrasSignificativas(l.texto);
  const candidatas = leccionesDonde(
    db,
    "estado IN ('pendiente', 'aceptada') AND origen = ? AND alcance = ? AND alcance_valor IS ? AND tema IS ?",
    l.origen,
    l.alcance,
    l.alcance_valor,
    l.tema,
  );
  return (
    candidatas
      .map((c) => ({ c, p: parecido(palabras, palabrasSignificativas(c.texto)) }))
      .filter((x) => x.p >= PARECIDO_MISMA)
      .sort((a, b) => b.p - a.p)[0]?.c ?? null
  );
}

export function guardarEvidencias(db: Db, id: number, evidencias: EvidenciaData[]): void {
  db.prepare('UPDATE lecciones SET evidencias = ?, fuerza = ? WHERE id = ?').run(
    JSON.stringify(evidencias),
    fuerzaDe(evidencias),
    id,
  );
}

/**
 * Mete lecciones pendientes de cualquier origen. Si ya hay la misma de otra oferta, se le suman las
 * evidencias (su fuerza sube) en vez de crear otra. Devuelve cuántas llegaron.
 */
export function insertarLecciones(db: Db, nuevas: readonly NuevaLeccion[]): number {
  const ins =
    db.prepare(`INSERT INTO lecciones (licitacion_id, memoria_id, aprendizaje_id, apartado, apartado_titulo, origen, alcance, alcance_valor, tema, texto, evidencias, fuerza, agente, creada_en)
    VALUES (@licitacion_id, @memoria_id, @aprendizaje_id, @apartado, @apartado_titulo, @origen, @alcance, @alcance_valor, @tema, @texto, @evidencias, @fuerza, @agente, @ts)`);
  const ts = new Date().toISOString();
  for (const l of nuevas) {
    const misma = laMisma(db, l);
    const ofertas = new Set(l.evidencias.map(claveOferta));
    if (misma)
      guardarEvidencias(db, misma.id, [
        ...misma.evidencias.filter((e) => !ofertas.has(claveOferta(e))),
        ...l.evidencias,
      ]);
    else
      ins.run({
        memoria_id: null,
        aprendizaje_id: null,
        apartado: null,
        apartado_titulo: null,
        ...l,
        evidencias: JSON.stringify(l.evidencias),
        fuerza: fuerzaDe(l.evidencias),
        ts,
      });
  }
  return nuevas.length;
}

/**
 * Reenviar (otra lectura del acta, otra propuesta de la misma memoria) sustituye lo pendiente de esa
 * fuente: la lección que solo tenía sus evidencias se borra y la que sumaba las de otras ofertas se
 * queda con esas. `es`: si una evidencia es de esa fuente.
 */
export function soltarPendientes(db: Db, where: string, valor: unknown, es: (e: EvidenciaData) => boolean): void {
  for (const l of leccionesDonde(db, `estado = 'pendiente' AND ${where}`, valor)) {
    const otras = l.evidencias.filter((e) => !es(e));
    if (!otras.length) db.prepare('DELETE FROM lecciones WHERE id = ?').run(l.id);
    else guardarEvidencias(db, l.id, otras);
  }
}

/**
 * Una persona acepta o descarta una lección pendiente (o vuelve a decidir). Aceptar una de un acta
 * da por buena también la lectura del acta: sus puntos y comentarios pasan a la redacción.
 */
export function revisarDelLibro(
  db: Db,
  leccionId: number,
  r: RevisionData,
  quien = 'web',
): Result<{ id: number; estado: 'aceptada' | 'descartada' }> {
  const l = db.prepare('SELECT licitacion_id, aprendizaje_id, estado FROM lecciones WHERE id = ?').get(leccionId) as
    { licitacion_id: string | null; aprendizaje_id: number | null; estado: EstadoLeccion } | undefined;
  if (!l) return fail('not_found', `No hay ninguna lección ${leccionId}.`);
  if (l.estado === 'retirada') return fail('conflicto', 'Esa lección está retirada: no se vuelve a revisar.');
  const estado = r.decision === 'aceptar' ? 'aceptada' : 'descartada';
  const ts = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE lecciones SET estado = ?, revisada_en = ?, revisada_por = ? WHERE id = ?').run(
      estado,
      ts,
      quien,
      leccionId,
    );
    if (estado === 'aceptada' && l.aprendizaje_id !== null)
      db.prepare(
        "UPDATE aprendizajes SET estado = 'aceptada', revisado_en = ? WHERE id = ? AND estado = 'pendiente'",
      ).run(ts, l.aprendizaje_id);
  })();
  emitir(db, {
    tipo: 'licitacion.lecciones',
    dominio: 'licitaciones',
    recurso: l.licitacion_id,
    datos: { leccion: leccionId, estado },
  });
  return ok({ id: leccionId, estado });
}
