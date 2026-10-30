// Contexto del precio de un lote: ofertas y baja de las adjudicaciones del órgano, un solo licitador e indicios.
import type { Router } from 'express';
import { z } from 'zod';
import { invalido, responder } from '../../../nucleo/http.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { antecedentesDe } from '../antecedentes/index.js';
import type { Nivel } from '../antecedentes/indicios.js';
import { claveOrgano, sqlOrgano } from '../antecedentes/organo.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { lotesDeDatos } from '../lotes.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { plausible } from '../precios/segmento.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from '../store.js';
import { textoComparable } from '../temas.js';
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import { MINUTOS_POR_ACCION, huellaDe, type Bloqueo } from './comprobacionesTipos.js';
import { guionVigente } from './guion.js';
import { ofertaDeLote } from './guionLotes.js';
import { importeDeLote } from './preciosOferta.js';

type UltimaDelOrgano = { anio: number; ganador: string; baja: number | null; ofertas: number | null };
// Incluye el escenario «un solo licitador» con la fórmula del pliego y el nivel de indicios de los antecedentes.
// Sin él se sugeriría una baja alta en un órgano que recibe una oferta y adjudica sin baja, donde con un
// licitador cualquier baja da los puntos máximos. El coste estimado es solo de la persona: margenDe y la fila
// de margen no lo enseñan nunca.
export type ContextoPrecio = {
  organo: { ofertas_media: number | null; baja_media: number | null; ultima: UltimaDelOrgano | null; n: number };
  un_licitador: { texto: string; baja_recomendada: number } | null;
  indicios: Nivel | null;
  nota: string;
};

const ConsultaContextoPrecio = z.object({ lote: z.string().trim().min(1).max(20).optional() });

// Las más recientes bastan para «qué suele pasar»: un órgano grande tiene miles.
const MAX_ADJUDICACIONES = 30;
const NOTA_CONTEXTO =
  'Orientativo: adjudicaciones del mismo órgano publicadas en la PLACSP (de cualquier objeto), que solo dice quién ganó y cuántas ofertas hubo. El escenario de un licitador sale de la fórmula del pliego; si no se puede leer, no se da.';

type FilaAdjudicacion = { anio: string | null; ofertas: number | null; baja: number | null; ganador: string | null };

function adjudicacionesDelOrgano(db: Db, fila: FilaLicitacion): FilaAdjudicacion[] {
  const clave = claveOrgano(fila);
  if (!clave) return [];
  const { sql, args } = sqlOrgano(clave, 'l');
  const resultados = [...RESULTADOS_ADJUDICADOS];
  return db
    .prepare(
      `SELECT substr(COALESCE(a.fecha, l.publicada_en), 1, 4) AS anio, a.ofertas, a.baja, a.adjudicatario_nombre AS ganador
    FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id
    WHERE ${sql} AND l.id <> ? AND a.resultado IN (${resultados.map(() => '?').join(', ')})
    ORDER BY COALESCE(a.fecha, l.publicada_en) DESC, a.ord LIMIT ?`,
    )
    .all(...args, fila.id, ...resultados, MAX_ADJUDICACIONES) as FilaAdjudicacion[];
}

const media = (xs: number[], decimales: number): number | null => {
  if (!xs.length) return null;
  const f = 10 ** decimales;
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * f) / f;
};

// Una baja que no es creíble (0 % con varias ofertas, más del 70 %) es un error de publicación: no cuenta.
const bajaCreible = (a: FilaAdjudicacion): number | null =>
  a.baja !== null && plausible(a.baja, a.ofertas) ? a.baja : null;

function resumenOrgano(adjudicaciones: FilaAdjudicacion[]): ContextoPrecio['organo'] {
  const u = adjudicaciones[0];
  const ultima =
    u && u.anio
      ? { anio: Number(u.anio), ganador: u.ganador ?? 'sin nombre publicado', baja: bajaCreible(u), ofertas: u.ofertas }
      : null;
  return {
    ofertas_media: media(
      adjudicaciones.flatMap((a) => (a.ofertas === null ? [] : [a.ofertas])),
      1,
    ),
    baja_media: media(
      adjudicaciones.flatMap((a) => {
        const b = bajaCreible(a);
        return b === null ? [] : [b];
      }),
      3,
    ),
    ultima,
    n: adjudicaciones.length,
  };
}

// La fórmula se mide contra la mejor oferta (la más baja o la de mayor baja): con una sola, esa
// es la de la empresa y saca el máximo. Una fórmula contra el presupuesto o con saciedad no se puede
// resolver así, y entonces no se dice nada (mejor callar que recomendar mal).
const CONTRA_LA_MEJOR: readonly RegExp[] = [
  /\b(?:o|of|p|pr)\s?_?min\b/,
  /\bb\s?_?max\b/,
  /\bmejor oferta\b/,
  /\bmenor (?:precio|oferta|importe)\b/,
  /\b(?:oferta|precio|importe)s? (?:mas (?:baja|barata|economica)|minim[oa])\b/,
  /\b(?:mayor|maxima) baja (?:ofertada|presentada)\b/,
  /\bbaja (?:mas alta|mayor)\b/,
  /\bmayor baja\b/,
];
const NO_RESOLUBLE = /\bsaciedad\b|\bumbral de puntuacion\b/;

function puntosDe(formula: string): number | null {
  const m = /=\s*(\d+(?:[.,]\d+)?)\s*(?:×|x|\*|·)/i.exec(formula) ?? /(\d+(?:[.,]\d+)?)\s*puntos/i.exec(formula);
  return m ? Number(m[1]!.replace(',', '.')) : null;
}

/** Con un único licitador, ¿cualquier baja da el máximo de puntos? null si la fórmula no lo deja saber. */
export function escenarioUnLicitador(formula: string | null | undefined): ContextoPrecio['un_licitador'] {
  if (!formula) return null;
  const t = textoComparable(formula).replace(/\s+/g, ' ');
  if (NO_RESOLUBLE.test(t) || !CONTRA_LA_MEJOR.some((r) => r.test(t))) return null;
  const p = puntosDe(formula);
  const puntos = p === null ? 'la puntuación máxima' : `los ${String(p).replace('.', ',')} puntos`;
  return { texto: `Con un solo licitador cualquier baja da ${puntos}: no hace falta bajar`, baja_recomendada: 0 };
}

function indiciosDe(db: Db, id: string, lote: string | null): Nivel | null {
  const a = antecedentesDe(db, id, { limite: 12, lote: lote ?? undefined });
  if (a.error) return null;
  return lote ? (a.data.lotes[0]?.indicios.nivel ?? null) : a.data.indicios.nivel;
}

function loteValido(fila: FilaLicitacion, lote: string | null): Result<null> {
  if (lote === null) return ok(null);
  const lotes = lotesDeDatos(fila.datos).map((l) => l.id);
  if (lotes.includes(lote)) return ok(null);
  return fail(
    'invalid_input',
    lotes.length
      ? `La licitación no tiene el lote «${lote}» (lotes: ${lotes.slice(0, 60).join(', ')}).`
      : 'La licitación no tiene lotes: no indiques lote.',
  );
}

/** Contexto de la fila de precio de un lote (o del contrato entero, con lote null). Solo lee. */
export function contextoPrecio(dbLic: Db, id: string, lote: string | null): Result<ContextoPrecio> {
  const fila = obtenerLicitacion(dbLic, id);
  if (!fila) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const valido = loteValido(fila, lote);
  if (valido.error) return valido;
  const guion = guionVigente(dbLic, id);
  const oe = guion ? ofertaDeLote(guion.datos, lote) : null;
  return ok({
    organo: resumenOrgano(adjudicacionesDelOrgano(dbLic, fila)),
    un_licitador: escenarioUnLicitador(oe?.formula),
    indicios: indiciosDe(dbLic, id, lote),
    nota: NOTA_CONTEXTO,
  });
}

// ── Margen frente al coste estimado ──

/** Margen del importe ofertado sobre el coste estimado (los dos sin impuestos), o null si falta alguno. */
export function margenDe(
  importe: number | null,
  costeEstimado: number | null | undefined,
): { margen: number; negativo: boolean } | null {
  if (importe === null || costeEstimado === null || costeEstimado === undefined) return null;
  const margen = Math.round((importe - costeEstimado) * 100) / 100;
  return { margen, negativo: margen < 0 };
}

function filaMargen(lote: string | null): Bloqueo {
  return {
    clave: `precio_margen:${lote ?? '-'}:-`,
    categoria: 'precio',
    lote,
    gravedad: 'riesgo',
    titulo: lote
      ? `El precio del lote ${lote} queda por debajo del coste estimado`
      : 'El precio queda por debajo del coste estimado',
    cita: null,
    actor: 'tu',
    accion: { tipo: 'fijar_precio', destino: `precio-lote-${lote ?? 'unico'}` },
    propuesta: null,
    // Sin importes ni coste en la huella: la fila llega al MCP y una huella de dos cifras se adivina.
    minutos: MINUTOS_POR_ACCION.fijar_precio,
    estado: 'abierto',
    huella: huellaDe('precio_margen', lote),
  };
}

/** Regla de las comprobaciones: una fila riesgo por lote cuyo precio decidido queda por debajo de su coste estimado. */
export function reglaMargenPrecio(e: Pick<EntradasComprobaciones, 'guion' | 'decisiones'>): Bloqueo[] {
  if (!e.guion || !e.decisiones) return [];
  const g = e.guion.datos;
  // El mismo importe que la hoja y el paquete (importeDeLote): el margen no puede salir de otra cuenta.
  return e.decisiones.datos.ofertas
    .filter(
      (o) => !o.pendiente && margenDe(importeDeLote(o, ofertaDeLote(g, o.lote)), o.coste_estimado)?.negativo === true,
    )
    .map((o) => filaMargen(o.lote));
}

// ── API web ──

export function rutasContextoPrecio(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/precio/contexto',
    conId((id, req, res) => {
      const q = ConsultaContextoPrecio.safeParse(req.query);
      if (!q.success) return invalido(res, q.error);
      responder(res, contextoPrecio(dbLicitaciones(), id, q.data.lote ?? null));
    }),
  );
}
