// Fichas de Hermes en Estado: las últimas con su calidad y las métricas del run que las trajo.
import type { MetricasRun } from '../../nucleo/hermes/metricas.js';
import { media } from '../../nucleo/estadistica.js';
import type { Db } from './store.js';
import { VERSION_PROMPT_FICHA } from './ficha.js';

// Las métricas son modelo, duración, tokens y llamadas; la calidad se mide por código. Las medias por modelo
// comparan modelos con las mismas fichas de la versión actual del análisis.
export type FichaReciente = {
  licitacion: string;
  creada_en: string;
  version: number;
  modelo: string | null;
  duracion_s: number | null;
  tokens: number | null;
  llamadas: number | null;
  recortadas: number;
  rechazos: number;
  calidad: number | null;
  dudosos_pct: number | null;
  requisitos: number | null;
  corregidos: number | null;
};
export type PorModelo = {
  modelo: string;
  fichas: number;
  calidad_media: number | null;
  dudosos_media: number | null;
  duracion_media_s: number | null;
  tokens_media: number | null;
};

const MUESTRA = 100;
const RECIENTES = 20;

type Fila = {
  licitacion_id: string;
  creada_en: string;
  version_prompt: number;
  calidad: number | null;
  dudosos_pct: number | null;
  requisitos: number | null;
  corregidos: number | null;
  metricas: string | null;
};

function aReciente(f: Fila): FichaReciente {
  const m = f.metricas ? (JSON.parse(f.metricas) as MetricasRun) : null;
  const tokens =
    m && (m.tokens_entrada !== null || m.tokens_salida !== null)
      ? (m.tokens_entrada ?? 0) + (m.tokens_salida ?? 0)
      : null;
  return {
    licitacion: f.licitacion_id,
    creada_en: f.creada_en,
    version: f.version_prompt,
    modelo: m?.modelo ?? null,
    duracion_s: m?.duracion_s ?? null,
    tokens,
    llamadas: m?.llamadas_herramientas ?? null,
    recortadas: m?.respuestas_recortadas ?? 0,
    rechazos: m?.rechazos ?? 0,
    calidad: f.calidad,
    dudosos_pct: f.dudosos_pct,
    requisitos: f.requisitos,
    corregidos: f.corregidos,
  };
}

const redondeo = (n: number | null) => (n === null ? null : Math.round(n));
const mediaDe = (xs: (number | null)[]) => redondeo(media(xs.filter((x): x is number => x !== null)));

function porModelo(fichas: FichaReciente[]): PorModelo[] {
  const grupos = new Map<string, FichaReciente[]>();
  for (const f of fichas.filter((x) => x.version === VERSION_PROMPT_FICHA))
    grupos.set(f.modelo ?? 'sin dato', [...(grupos.get(f.modelo ?? 'sin dato') ?? []), f]);
  return [...grupos]
    .map(([modelo, fs]) => ({
      modelo,
      fichas: fs.length,
      calidad_media: mediaDe(fs.map((f) => f.calidad)),
      dudosos_media: mediaDe(fs.map((f) => f.dudosos_pct)),
      duracion_media_s: mediaDe(fs.map((f) => f.duracion_s)),
      tokens_media: mediaDe(fs.map((f) => f.tokens)),
    }))
    .sort((a, b) => b.fichas - a.fichas);
}

/** Las últimas fichas con su calidad y su run, y las medias por modelo (solo de la versión actual). */
export function fichasRecientes(db: Db): {
  recientes: FichaReciente[];
  por_modelo: PorModelo[];
  version_actual: number;
} {
  const filas = db
    .prepare(
      `SELECT f.licitacion_id, f.creada_en, f.version_prompt,
      json_extract(f.datos, '$.calidad.puntuacion') AS calidad, json_extract(f.datos, '$.calidad.dudosos_pct') AS dudosos_pct,
      json_extract(f.datos, '$.calidad.requisitos') AS requisitos, json_extract(f.datos, '$.calidad.corregidos_por_codigo') AS corregidos,
      t.metricas FROM fichas f LEFT JOIN nucleo.trabajos_ia t ON t.id = f.trabajo_id
    WHERE f.estado = 'aprobada' ORDER BY f.id DESC LIMIT ?`,
    )
    .all(MUESTRA) as Fila[];
  const todas = filas.map(aReciente);
  return { recientes: todas.slice(0, RECIENTES), por_modelo: porModelo(todas), version_actual: VERSION_PROMPT_FICHA };
}
