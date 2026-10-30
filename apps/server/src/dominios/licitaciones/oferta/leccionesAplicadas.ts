// Aplicar y medir las lecciones: cuáles se pasan al redactar cada apartado y si el crítico las ve cumplidas.
import { z } from 'zod';
import { mismoOrgano, palabrasSignificativas } from '../propuestas/aprendizaje.js';
import type { Db } from '../store.js';
import { filaMemoria } from './ensamblado.js';
import { guionPorId } from './guion.js';
import { leccionesDonde, ORIGENES_LECCION, type Leccion } from './libroLecciones.js';
import { TEMAS_APARTADO, temaDeApartado, type TemaApartado } from './temasApartado.js';

// Se eligen del libro por su tema, su alcance y el órgano, no solo por palabras, y se anota dónde se pasaron
// (lecciones_aplicaciones). Las de fuerza alta que se quedaron sin aplicar las enseña la Revisión como riesgo.
// Las de decisión y de precio no son de la memoria: no se pasan al redactar.
const DE_LA_MEMORIA = "estado = 'aceptada' AND origen IN ('edicion', 'mesa')";
const FUERZA_ALTA = 2;

// sinLasPropias: para una memoria de ensayo, que se mide a ciegas contra la presentada de su
// licitación; lo aprendido de esa misma memoria contaminaría la comparación.
export type Consulta = {
  licitacion_id: string;
  apartado: number;
  titulo: string;
  se_valorara: string[];
  sinLasPropias?: boolean;
};
type Licitacion = { organo_nombre: string; cpvs: string; tipo_contrato: string | null };

function licitacionDe(db: Db, id: string): Licitacion {
  return (
    (db.prepare('SELECT organo_nombre, cpvs, tipo_contrato FROM licitaciones WHERE id = ?').get(id) as
      Licitacion | undefined) ?? { organo_nombre: '', cpvs: '', tipo_contrato: null }
  );
}

/** ¿Vale la lección para esta licitación? Lo dice su alcance (y las de ensayo no leen las suyas). */
function aplica(l: Leccion, q: Pick<Consulta, 'licitacion_id' | 'sinLasPropias'>, lic: Licitacion): boolean {
  if (q.sinLasPropias && l.licitacion_id === q.licitacion_id) return false;
  switch (l.alcance) {
    case 'licitacion':
      return l.licitacion_id === q.licitacion_id;
    case 'organo':
      return mismoOrgano(lic.organo_nombre, l.alcance_valor);
    case 'cpv':
      return Boolean(l.alcance_valor) && lic.cpvs.split(',').some((c) => c.startsWith(l.alcance_valor!));
    case 'tipo_contrato':
      return l.alcance_valor === lic.tipo_contrato;
    default:
      return true;
  }
}

// La suya de ese apartado manda; luego el tema, lo de toda la memoria y las palabras en común. Lo
// específico (órgano, CPV) y lo que apoyan varias ofertas sube.
function puntos(l: Leccion, q: Consulta, tema: TemaApartado | null, palabras: Set<string>): number {
  if (l.licitacion_id === q.licitacion_id && l.apartado === q.apartado) return 100;
  const deTema = l.tema !== null && l.tema === tema ? 20 : 0;
  const deToda = l.tema === null && l.apartado === null ? 10 : 0;
  const comunes = [...palabrasSignificativas(`${l.apartado_titulo ?? ''} ${l.texto}`)].filter((p) =>
    palabras.has(p),
  ).length;
  if (!deTema && !deToda && !comunes) return 0;
  return deTema + deToda + comunes + (l.alcance === 'general' ? 0 : 5) + 2 * l.fuerza;
}

export type LeccionElegida = Pick<Leccion, 'id' | 'texto'>;

/** Las lecciones aceptadas que tocan a un apartado, las mejores primero. */
export function leccionesParaRedactar(db: Db, q: Consulta, limite = 5): LeccionElegida[] {
  const lic = licitacionDe(db, q.licitacion_id);
  const tema = temaDeApartado([q.titulo, ...q.se_valorara].join(' '));
  const palabras = palabrasSignificativas([q.titulo, ...q.se_valorara].join(' '));
  return leccionesDonde(db, `${DE_LA_MEMORIA} ORDER BY creada_en DESC LIMIT 300`)
    .filter((l) => aplica(l, q, lic))
    .map((l) => ({ l, p: puntos(l, q, tema, palabras) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || b.l.creada_en.localeCompare(a.l.creada_en))
    .slice(0, limite)
    .map(({ l }) => ({ id: l.id, texto: l.texto }));
}

/** Las que tocan a un apartado de una memoria (las que reciben su redacción y su dossier). */
function leccionesDelApartado(
  db: Db,
  m: { licitacion_id: string; guion_id: number; ensayo: number },
  apartado: number,
): LeccionElegida[] {
  const a = guionPorId(db, m.guion_id)?.datos.memoria?.apartados[apartado - 1];
  return a
    ? leccionesParaRedactar(db, {
        licitacion_id: m.licitacion_id,
        apartado,
        titulo: a.titulo,
        se_valorara: a.se_valorara,
        sinLasPropias: m.ensayo === 1,
      })
    : [];
}

/**
 * Al llegar la redacción de un apartado, quedan apuntadas como aplicadas las lecciones que
 * le tocan: no al construir el prompt, que puede fallar o rehacerse sin que llegue nada.
 */
export function apuntarAlRecibir(db: Db, memoriaId: number, apartado: number): void {
  const m = filaMemoria(db, memoriaId);
  if (m)
    apuntarAplicadas(
      db,
      m,
      apartado,
      leccionesDelApartado(db, m, apartado).map((l) => l.id),
    );
}

/** Apunta qué lecciones se pasaron a la redacción de un apartado (repetir no duplica). */
export function apuntarAplicadas(
  db: Db,
  m: { id: number; version: number },
  apartado: number,
  ids: readonly number[],
): void {
  const ins =
    db.prepare(`INSERT INTO lecciones_aplicaciones (leccion_id, memoria_id, version, apartado, aplicada_en) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(leccion_id, memoria_id, apartado) DO NOTHING`);
  const ts = new Date().toISOString();
  for (const id of ids) ins.run(id, m.id, m.version, apartado, ts);
}

export type Aplicacion = {
  leccion_id: number;
  texto: string;
  origen: Leccion['origen'];
  fuerza: number;
  apartado: number;
  cumplida: boolean | null;
  nota: string | null;
};

/** Las lecciones que se pasaron a una memoria, por apartado, con lo que dijo el crítico. */
export function aplicacionesDe(db: Db, memoriaId: number): Aplicacion[] {
  const filas = db
    .prepare(
      `SELECT a.leccion_id, l.texto, l.origen, l.fuerza, a.apartado, a.cumplida, a.nota FROM lecciones_aplicaciones a
    JOIN lecciones l ON l.id = a.leccion_id WHERE a.memoria_id = ? ORDER BY a.apartado, a.leccion_id`,
    )
    .all(memoriaId) as (Omit<Aplicacion, 'cumplida'> & { cumplida: number | null })[];
  return filas.map((f) => ({ ...f, cumplida: f.cumplida === null ? null : f.cumplida === 1 }));
}

export type Cumplimiento = { leccion: number; apartado: number; cumple: boolean; nota: string };

/** Lo que dice el crítico de cada lección pasada; las que no se pasaron a ese apartado se ignoran. */
export function marcarCumplidas(db: Db, memoriaId: number, xs: readonly Cumplimiento[]): number {
  const up = db.prepare(
    'UPDATE lecciones_aplicaciones SET cumplida = ?, nota = ?, comprobada_en = ? WHERE memoria_id = ? AND leccion_id = ? AND apartado = ?',
  );
  const ts = new Date().toISOString();
  return xs.reduce((n, x) => n + up.run(x.cumple ? 1 : 0, x.nota, ts, memoriaId, x.leccion, x.apartado).changes, 0);
}

export type LeccionNoAplicada = {
  leccion_id: number;
  texto: string;
  fuerza: number;
  motivo: 'no_pasada' | 'no_cumplida';
  apartados: number[];
};

/**
 * Las lecciones de fuerza alta que valen para esta memoria (por su alcance y porque algún apartado
 * es de su tema) y no se pasaron a la redacción o el crítico no las ve cumplidas.
 */
export function leccionesNoAplicadas(db: Db, memoriaId: number): LeccionNoAplicada[] {
  const m = filaMemoria(db, memoriaId);
  const apartados = m ? (guionPorId(db, m.guion_id)?.datos.memoria?.apartados ?? []) : [];
  if (!m || !apartados.length) return [];
  const lic = licitacionDe(db, m.licitacion_id);
  const temas = new Set(apartados.map((a) => temaDeApartado([a.titulo, ...a.se_valorara].join(' '))));
  const pasadas = aplicacionesDe(db, memoriaId);
  return leccionesDonde(db, `${DE_LA_MEMORIA} AND fuerza >= ?`, FUERZA_ALTA)
    .filter(
      (l) =>
        aplica(l, { licitacion_id: m.licitacion_id, sinLasPropias: m.ensayo === 1 }, lic) &&
        (l.tema === null || temas.has(l.tema)),
    )
    .flatMap((l): LeccionNoAplicada[] => {
      const suyas = pasadas.filter((p) => p.leccion_id === l.id);
      if (!suyas.length)
        return [{ leccion_id: l.id, texto: l.texto, fuerza: l.fuerza, motivo: 'no_pasada', apartados: [] }];
      const fallidas = suyas.filter((p) => p.cumplida === false).map((p) => p.apartado);
      return fallidas.length === suyas.length
        ? [{ leccion_id: l.id, texto: l.texto, fuerza: l.fuerza, motivo: 'no_cumplida', apartados: fallidas }]
        : [];
    });
}

// ── Para los agentes (licitaciones_libro_lecciones) ──

export const ConsultaLibro = z.strictObject({
  id: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .optional()
    .describe('Una licitación: solo las lecciones que valen para ella por su alcance'),
  tema: z.enum(TEMAS_APARTADO).optional().describe('Solo las de un tema de apartado'),
  origen: z.enum(ORIGENES_LECCION).optional().describe('edicion, mesa, decision o precio'),
  retiradas: z.boolean().default(false).describe('Incluir también las retiradas (con su motivo)'),
  limite: z.number().int().min(1).max(100).default(30),
});

/** El libro (aceptadas y, si se pide, retiradas), con dónde se aplicó cada una y si se cumplió. */
export function libroParaAgente(
  db: Db,
  q: z.infer<typeof ConsultaLibro>,
  tapar: ((t: string) => string) | null,
): unknown[] {
  const lic = q.id ? licitacionDe(db, q.id) : null;
  const estados = q.retiradas ? "('aceptada', 'retirada')" : "('aceptada')";
  const aplicaciones =
    db.prepare(`SELECT m.licitacion_id, a.version, a.apartado, a.cumplida FROM lecciones_aplicaciones a JOIN memorias m ON m.id = a.memoria_id
    WHERE a.leccion_id = ? ORDER BY a.aplicada_en DESC LIMIT 20`);
  return leccionesDonde(db, `estado IN ${estados} ORDER BY fuerza DESC, revisada_en DESC`)
    .filter(
      (l) =>
        (!q.id || aplica(l, { licitacion_id: q.id }, lic!)) &&
        (!q.tema || l.tema === q.tema) &&
        (!q.origen || l.origen === q.origen),
    )
    .slice(0, q.limite)
    .map((l) => ({
      id: l.id,
      texto: l.texto,
      origen: l.origen,
      alcance: l.alcance,
      alcance_valor: l.alcance_valor,
      tema: l.tema,
      fuerza: l.fuerza,
      estado: l.estado,
      ...(l.retirada_motivo ? { retirada_motivo: l.retirada_motivo } : {}),
      evidencias: l.evidencias.map((e) => ({ ...e, texto: tapar ? tapar(e.texto) : e.texto })),
      aplicaciones: (
        aplicaciones.all(l.id) as {
          licitacion_id: string;
          version: number;
          apartado: number;
          cumplida: number | null;
        }[]
      ).map((a) => ({ ...a, cumplida: a.cumplida === null ? null : a.cumplida === 1 })),
    }));
}
