// «Resolución publicada: sube el acta» (fuente «mesa»): avisa en Aprendizaje de dónde dejarla.
import fs from 'node:fs';
import path from 'node:path';
import { SUBCARPETAS_UNICA } from '../carpetasUnicas.js';
import type { Db } from '../store.js';
import { actaDeCarpeta, actaDeCarpetaUnica, RANGO_EN_PLIEGOS, rangoActaDeNombre } from './actas.js';

// Una oferta resuelta en los últimos meses sin acta leída y sin acta en su carpeta avisa en Aprendizaje de dónde
// dejarla. Si la PLACSP la publicó en la página del expediente, se baja sola con los pliegos
// (pliegosExpediente.ts revisa las resueltas una vez al día) y el aviso lo dice: no hace falta buscarla.
const DIAS_AVISO_ACTA = 120;
const DIA_MS = 86_400_000;

export type ActaQueFalta = {
  licitacion_id: string;
  titulo: string;
  resultado: 'ganada' | 'perdida';
  resuelta_en: string;
  // Dónde dejarla («Conocimiento/…»); null si la licitación aún no tiene carpeta.
  carpeta: string | null;
  // La PLACSP publica algo que parece el acta y se está bajando.
  publicada: boolean;
};

type Fila = {
  licitacion_id: string;
  titulo: string;
  resultado: 'ganada' | 'perdida';
  resuelta_en: string;
  unica: string | null;
  presentada: string | null;
};

// Resueltas (la más reciente por licitación) sin aprendizaje de su carpeta ni de la licitación.
const RESUELTAS = `SELECT p.licitacion_id, l.titulo, p.resultado, MAX(p.resuelta_en) AS resuelta_en, u.ruta AS unica, c.ruta AS presentada
  FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id
  LEFT JOIN carpetas_unicas u ON u.licitacion_id = p.licitacion_id
  LEFT JOIN carpetas_presentadas c ON c.licitacion_id = p.licitacion_id AND c.estado = 'hecha'
  WHERE p.resultado IN ('ganada', 'perdida') AND p.resuelta_en >= @desde
    AND NOT EXISTS (SELECT 1 FROM aprendizajes a WHERE a.licitacion_id = p.licitacion_id AND a.estado <> 'descartada')
  GROUP BY p.licitacion_id ORDER BY resuelta_en DESC`;

function yaTieneActa(conocimiento: string | null, f: Fila): boolean {
  if (!conocimiento) return false;
  if (f.unica) return actaDeCarpetaUnica(path.join(conocimiento, ...f.unica.split('/'))) !== null;
  const dir = f.presentada ? path.join(conocimiento, ...f.presentada.split('/')) : null;
  return dir !== null && fs.existsSync(dir) && actaDeCarpeta(dir) !== null;
}

function publicadaEnPlacsp(db: Db, id: string): boolean {
  const nombres = db
    .prepare("SELECT nombre FROM pliegos WHERE licitacion_id = ? AND origen = 'expediente' AND estado = 'pendiente'")
    .all(id) as { nombre: string }[];
  return nombres.some((n) => (rangoActaDeNombre(n.nombre) ?? Infinity) <= RANGO_EN_PLIEGOS);
}

/** Las ofertas resueltas a las que les falta el acta para aprender de la mesa. */
export function actasQueFaltan(db: Db, conocimiento: string | null, ahoraMs = Date.now()): ActaQueFalta[] {
  const filas = db
    .prepare(RESUELTAS)
    .all({ desde: new Date(ahoraMs - DIAS_AVISO_ACTA * DIA_MS).toISOString() }) as Fila[];
  return filas
    .filter((f) => !yaTieneActa(conocimiento, f))
    .map((f) => ({
      licitacion_id: f.licitacion_id,
      titulo: f.titulo,
      resultado: f.resultado,
      resuelta_en: f.resuelta_en,
      carpeta: f.unica
        ? `Conocimiento/${f.unica}/${SUBCARPETAS_UNICA.resolucion}`
        : f.presentada
          ? `Conocimiento/${f.presentada}`
          : null,
      publicada: publicadaEnPlacsp(db, f.licitacion_id),
    }));
}

// Para pliegosExpediente.ts: las presentadas resueltas en los últimos meses y sin acta leída.
export const SQL_RESUELTAS_SIN_ACTA = `o.estado IN ('presentada', 'ganada', 'perdida')
  AND EXISTS (SELECT 1 FROM propuestas p WHERE p.licitacion_id = l.id AND p.resultado IN ('ganada', 'perdida') AND p.resuelta_en >= @desdeResueltas)
  AND NOT EXISTS (SELECT 1 FROM aprendizajes a WHERE a.licitacion_id = l.id AND a.estado <> 'descartada')`;
export const desdeResueltas = (ahoraMs: number) => new Date(ahoraMs - DIAS_AVISO_ACTA * DIA_MS).toISOString();
