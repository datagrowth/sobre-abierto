// Encaje 0-100 por código, con su desglose en seis componentes con su peso.
import { percentil } from '../../nucleo/estadistica.js';
import { instanteDeHoraEspana } from '../../nucleo/fechas.js';
import { rangoPrefijo } from './buscador.js';
import type { Evaluacion } from './evaluador.js';
import { evaluacionesDeFicha, type GoNoGo } from './ficha.js';
import type { Semaforo } from './gonogo.js';
import { idsDelAmbito } from './lotes.js';
import type { Db } from './store.js';

// La elegibilidad no pesa, cierra: con un excluyente que la empresa no cumple, el encaje se queda en 20 como
// mucho y lleva «no elegible». La temática es lo único que viene de Hermes (su opinión, mezclada con la
// coincidencia de CPV); lo demás sale de los datos. Un componente sin datos no cuenta y su peso se reparte entre
// los demás: inventarle un valor sería falsa precisión. La web enseña siempre el desglose, nunca el número solo.
export const COMPONENTES = [
  { clave: 'tematica', etiqueta: 'Temática', peso: 0.3 },
  { clave: 'solvencia', etiqueta: 'Solvencia y medios', peso: 0.2 },
  { clave: 'competencia', etiqueta: 'Competencia', peso: 0.15 },
  { clave: 'economia', etiqueta: 'Economía', peso: 0.15 },
  { clave: 'capacidad', etiqueta: 'Capacidad', peso: 0.1 },
  { clave: 'historial', etiqueta: 'Historial', peso: 0.1 },
] as const;
export type ClaveComponente = (typeof COMPONENTES)[number]['clave'];

const TOPE_NO_ELEGIBLE = 20;
const OPINION: Record<string, number> = { interesa: 1, revisar: 0.5, descartar: 0 };
// La opinión de Hermes pesa más que la coincidencia de CPV dentro de la temática.
const PESO_OPINION = 0.6;
const DIA_MS = 86_400_000;
const CAPACIDAD_LIMITE = 3;
const CAPACIDAD_VENTANA_MS = 7 * DIA_MS;
// Con pocas ofertas a un órgano, la tasa se acerca a la global (como si hubiera K más con la tasa global).
const K_HISTORIAL = 3;
const MIN_GANADAS_ECONOMIA = 3;
const MIN_COMPARABLES = 10;
const AÑOS_COMPETENCIA = 5;
const AÑOS_CONCENTRACION = 3;
const CUOTA_CONCENTRADO = 0.5;
const MIN_ADJUDICACIONES_ORGANO = 4;
const CASTIGO_CONCENTRADO = 0.3;

type Componente = {
  clave: ClaveComponente;
  etiqueta: string;
  peso: number;
  valor: number | null;
  detalle: string;
  de_hermes: boolean;
};
export type Encaje = { valor: number | null; elegible: boolean; etiqueta: string | null; componentes: Componente[] };

/** Lo de una licitación que necesita el encaje. plazo: hora peninsular sin zona, como la guarda la PLACSP. */
export type EntradaEncaje = {
  id: string;
  cpvs: string[];
  organo_nif: string | null;
  importe: number | null;
  plazo: string | null;
  opinion: 'interesa' | 'revisar' | 'descartar' | null;
  semaforo: Semaforo | null;
  requisitos: Evaluacion[];
};

type Nuestra = {
  licitacion_id: string;
  resultado: string;
  organo_nif: string | null;
  cpvs: string;
  presupuesto: number | null;
};
type Concentracion = { cuota: number; nombre: string | null; nif: string | null; n: number };

/** Lo que es igual para todas las licitaciones de una vez (la lista lo calcula una vez por página). */
export type ContextoEncaje = {
  perfilCpvs: string[];
  nuestras: Nuestra[];
  ganadas: number[];
  enPreparacion: { id: string; plazoMs: number }[];
  nifPropio: string | null;
  ofertasEsperadas: (cpv: string) => { mediana: number; n: number; nivel: number } | null;
  concentracion: (nif: string | null) => Concentracion | null;
  ahoraMs: number;
};

const cpvsDe = (texto: string): string[] => texto.split(',').filter(Boolean);
const mediana = (ordenados: number[]) => percentil(ordenados, 0.5);

function ofertasEsperadasCon(db: Db, ahoraMs: number): ContextoEncaje['ofertasEsperadas'] {
  const memo = new Map<string, ReturnType<ContextoEncaje['ofertasEsperadas']>>();
  const desde = new Date(ahoraMs - AÑOS_COMPETENCIA * 365 * DIA_MS).toISOString().slice(0, 10);
  // Por el CPV principal del contrato (licitacion_cpv, con índice) en vez de recorrer la columna de texto.
  const consulta =
    db.prepare(`SELECT a.ofertas FROM licitacion_cpv c JOIN adjudicaciones a ON a.licitacion_id = c.licitacion_id
    WHERE c.lote = '' AND c.principal = 1 AND c.cpv >= ? AND c.cpv < ? AND a.ofertas > 0 AND a.fecha_ref >= ? ORDER BY a.ofertas`);
  return (cpv) => {
    // De 4 cifras a 2 si no llegan los comparables, como el retroceso de los índices.
    for (const nivel of [4, 2]) {
      const p = cpv.slice(0, nivel);
      if (!memo.has(p)) {
        const v = (consulta.all(...rangoPrefijo(p), desde) as { ofertas: number }[]).map((f) => f.ofertas);
        memo.set(p, v.length >= MIN_COMPARABLES ? { mediana: mediana(v)!, n: v.length, nivel } : null);
      }
      const r = memo.get(p);
      if (r) return r;
    }
    return null;
  };
}

function concentracionCon(db: Db, ahoraMs: number): ContextoEncaje['concentracion'] {
  const memo = new Map<string, Concentracion | null>();
  const desde = new Date(ahoraMs - AÑOS_CONCENTRACION * 365 * DIA_MS).toISOString().slice(0, 10);
  const consulta = db.prepare(`SELECT adjudicatario_nif AS nif, MAX(adjudicatario_nombre) AS nombre, COUNT(*) AS n,
      SUM(COUNT(*)) OVER () AS total FROM adjudicaciones
    WHERE organo_nif = ? AND fecha_ref >= ? AND adjudicatario_nif IS NOT NULL GROUP BY adjudicatario_nif ORDER BY n DESC LIMIT 1`);
  return (nif) => {
    if (!nif) return null;
    if (!memo.has(nif)) {
      const f = consulta.get(nif, desde) as
        { nif: string; nombre: string | null; n: number; total: number } | undefined;
      memo.set(nif, f ? { cuota: f.n / f.total, nombre: f.nombre, nif: f.nif, n: f.total } : null);
    }
    return memo.get(nif) ?? null;
  };
}

const ganadasDe = (nuestras: readonly Nuestra[]): number[] =>
  nuestras
    .filter((n) => n.resultado === 'ganada' && n.presupuesto !== null)
    .map((n) => n.presupuesto!)
    .sort((a, b) => a - b);

/**
 * El contexto sin las propuestas de una licitación: para calibrar, cada decidida se puntúa sin
 * su propia respuesta (sus CPV, su resultado y su importe le darían el encaje que se mide).
 */
export function contextoSin(ctx: ContextoEncaje, licitacionId: string): ContextoEncaje {
  const nuestras = ctx.nuestras.filter((n) => n.licitacion_id !== licitacionId);
  return nuestras.length === ctx.nuestras.length ? ctx : { ...ctx, nuestras, ganadas: ganadasDe(nuestras) };
}

export function contextoEncaje(
  db: Db,
  perfil: { cpv_experiencia?: string[]; nif?: string | null } | null,
  ahoraMs = Date.now(),
): ContextoEncaje {
  const nuestras = db
    .prepare(
      `SELECT p.licitacion_id, p.resultado, l.organo_nif, l.cpvs, COALESCE(p.presupuesto, l.presupuesto_sin_iva) AS presupuesto
    FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id`,
    )
    .all() as Nuestra[];
  const ganadas = ganadasDe(nuestras);
  const enPreparacion = (
    db
      .prepare(
        "SELECT o.licitacion_id AS id, l.fecha_limite FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.estado = 'en_preparacion' AND l.fecha_limite IS NOT NULL",
      )
      .all() as { id: string; fecha_limite: string }[]
  ).flatMap((f) => {
    const ms = instanteDeHoraEspana(f.fecha_limite);
    return ms === null ? [] : [{ id: f.id, plazoMs: ms }];
  });
  return {
    perfilCpvs: perfil?.cpv_experiencia ?? [],
    nuestras,
    ganadas,
    enPreparacion,
    nifPropio: perfil?.nif ?? null,
    ofertasEsperadas: ofertasEsperadasCon(db, ahoraMs),
    concentracion: concentracionCon(db, ahoraMs),
    ahoraMs,
  };
}

// ─── Componentes ─────────────────────────────────────────────────────────────

/** Coincidencia de CPV: las mismas 8 cifras 1, las 4 primeras 0,6, las 2 primeras 0,2. Un prefijo corto del perfil solo llega a sus cifras. */
export function coincidenciaCpv(cpvs: string[], referencias: string[]): number {
  let mejor = 0;
  for (const c of cpvs) {
    for (const r of referencias) {
      const largo = Math.min(r.length, 8);
      const comun = [...c.slice(0, largo)].findIndex((d, i) => d !== r[i]);
      const n = comun < 0 ? largo : comun;
      mejor = Math.max(mejor, n >= 8 ? 1 : n >= 4 ? 0.6 : n >= 2 ? 0.2 : 0);
    }
  }
  return mejor;
}

function tematica(ctx: ContextoEncaje, e: EntradaEncaje): Pick<Componente, 'valor' | 'detalle'> {
  const referencias = [...ctx.perfilCpvs, ...ctx.nuestras.flatMap((n) => cpvsDe(n.cpvs))];
  const cpv = referencias.length && e.cpvs.length ? coincidenciaCpv(e.cpvs, referencias) : null;
  const op = e.opinion ? OPINION[e.opinion]! : null;
  if (op === null && cpv === null)
    return { valor: null, detalle: 'Sin opinión de Hermes ni CPV con los que comparar.' };
  const valor = op === null ? cpv! : cpv === null ? op : PESO_OPINION * op + (1 - PESO_OPINION) * cpv;
  const partes = [
    op !== null ? `Hermes: ${e.opinion}` : null,
    cpv !== null ? `CPV parecido a lo nuestro: ${Math.round(cpv * 100)} %` : null,
  ];
  return { valor, detalle: partes.filter(Boolean).join(' · ') };
}

const RESULTADO: Record<string, number> = { cumple: 1, desconocido: 0.5, no_cumple: 0 };

function solvencia(e: EntradaEncaje): Pick<Componente, 'valor' | 'detalle'> {
  const vistos = e.requisitos.filter((r) => r.resultado in RESULTADO);
  if (!vistos.length) return { valor: null, detalle: 'Sin requisitos evaluados todavía.' };
  const cumple = vistos.filter((r) => r.resultado === 'cumple').length;
  return {
    valor: vistos.reduce((s, r) => s + RESULTADO[r.resultado]!, 0) / vistos.length,
    detalle: `${cumple} de ${vistos.length} requisitos cumplidos`,
  };
}

function competencia(ctx: ContextoEncaje, e: EntradaEncaje): Pick<Componente, 'valor' | 'detalle'> {
  const esperadas = e.cpvs[0] ? ctx.ofertasEsperadas(e.cpvs[0]) : null;
  if (!esperadas) return { valor: null, detalle: 'Pocas adjudicaciones parecidas para estimar la competencia.' };
  const c = ctx.concentracion(e.organo_nif);
  const concentrado =
    c !== null && c.n >= MIN_ADJUDICACIONES_ORGANO && c.cuota >= CUOTA_CONCENTRADO && c.nif !== ctx.nifPropio;
  const base = 1 - Math.min(esperadas.mediana, 10) / 10;
  const detalle = `${esperadas.mediana} ofertas esperadas (n = ${esperadas.n}, CPV ${esperadas.nivel} cifras)`;
  return {
    valor: Math.max(0, base - (concentrado ? CASTIGO_CONCENTRADO : 0)),
    detalle: concentrado
      ? `${detalle} · órgano concentrado: ${c!.nombre ?? 'otro adjudicatario'} ganó ${Math.round(c!.cuota * 100)} %`
      : detalle,
  };
}

function economia(ctx: ContextoEncaje, e: EntradaEncaje): Pick<Componente, 'valor' | 'detalle'> {
  if (ctx.ganadas.length < MIN_GANADAS_ECONOMIA || e.importe === null || e.importe <= 0)
    return { valor: null, detalle: 'Pocas ofertas ganadas con las que comparar el importe.' };
  const p25 = percentil(ctx.ganadas, 0.25)!,
    p75 = percentil(ctx.ganadas, 0.75)!;
  const valor = e.importe < p25 ? e.importe / p25 : e.importe > p75 ? p75 / e.importe : 1;
  return {
    valor,
    detalle:
      valor === 1
        ? 'Importe como el de las que ganamos'
        : e.importe < p25
          ? 'Más pequeño que las que ganamos'
          : 'Más grande que las que ganamos',
  };
}

function capacidad(ctx: ContextoEncaje, e: EntradaEncaje): Pick<Componente, 'valor' | 'detalle'> {
  const plazo = e.plazo ? instanteDeHoraEspana(e.plazo) : null;
  if (plazo === null) return { valor: null, detalle: 'Sin plazo.' };
  const cerca = ctx.enPreparacion.filter(
    (o) => o.id !== e.id && Math.abs(o.plazoMs - plazo) <= CAPACIDAD_VENTANA_MS,
  ).length;
  return {
    valor: Math.max(0, 1 - cerca / CAPACIDAD_LIMITE),
    detalle: `${cerca} ${cerca === 1 ? 'oferta' : 'ofertas'} en preparación con plazo a ±7 días`,
  };
}

function historial(ctx: ContextoEncaje, e: EntradaEncaje): Pick<Componente, 'valor' | 'detalle'> {
  const decididas = ctx.nuestras.filter((n) => ['ganada', 'perdida', 'excluida'].includes(n.resultado));
  if (!decididas.length) return { valor: null, detalle: 'Aún no hay ofertas resueltas.' };
  const global = decididas.filter((n) => n.resultado === 'ganada').length / decididas.length;
  const delOrgano = e.organo_nif ? decididas.filter((n) => n.organo_nif === e.organo_nif) : [];
  const ganadas = delOrgano.filter((n) => n.resultado === 'ganada').length;
  const valor = (ganadas + K_HISTORIAL * global) / (delOrgano.length + K_HISTORIAL);
  return {
    valor,
    detalle: delOrgano.length
      ? `${ganadas} de ${delOrgano.length} ganadas con este órgano`
      : `Sin ofertas a este órgano; tasa global ${Math.round(global * 100)} %`,
  };
}

/** El encaje de una licitación con su desglose. */
export function encajeDe(ctx: ContextoEncaje, e: EntradaEncaje): Encaje {
  const calculados: Record<ClaveComponente, Pick<Componente, 'valor' | 'detalle'>> = {
    tematica: tematica(ctx, e),
    solvencia: solvencia(e),
    competencia: competencia(ctx, e),
    economia: economia(ctx, e),
    capacidad: capacidad(ctx, e),
    historial: historial(ctx, e),
  };
  const componentes = COMPONENTES.map((c) => {
    const x = calculados[c.clave];
    return {
      ...c,
      valor: x.valor === null ? null : Math.round(x.valor * 100),
      detalle: x.detalle,
      de_hermes: c.clave === 'tematica' && e.opinion !== null,
    };
  });
  const conDatos = componentes.filter((c) => c.valor !== null);
  const pesos = conDatos.reduce((s, c) => s + c.peso, 0);
  const bruto = pesos ? Math.round(conDatos.reduce((s, c) => s + c.peso * c.valor!, 0) / pesos) : null;
  const elegible = e.semaforo?.color !== 'rojo';
  return {
    valor: bruto === null ? null : elegible ? bruto : Math.min(bruto, TOPE_NO_ELEGIBLE),
    elegible,
    etiqueta: elegible ? null : 'no elegible',
    componentes,
  };
}

// ─── De una licitación ───────────────────────────────────────────────────────

export type Opinion = 'interesa' | 'revisar' | 'descartar';

/** La opinión que manda: lo descartado por Hermes; si no, la ficha (con los pliegos leídos) y si no, la criba. */
export function opinionQueManda(x: {
  de_hermes: boolean;
  decision_ficha: string | null;
  veredicto_ia: string | null;
}): Opinion {
  if (x.de_hermes) return 'descartar';
  if (x.decision_ficha === 'go') return 'interesa';
  if (x.decision_ficha === 'no_go') return 'descartar';
  if (x.decision_ficha === 'revisar') return 'revisar';
  return x.veredicto_ia === 'interesa' || x.veredicto_ia === 'descartar' ? x.veredicto_ia : 'revisar';
}

/**
 * La entrada del encaje con el go/no-go de la licitación: los CPV y el importe del ámbito (los
 * lotes a los que se va) y los requisitos de la PLACSP y de la ficha que cuentan, como el semáforo.
 * opinion: null si aún no hay criba ni ficha.
 */
export function entradaDeGoNoGo(
  f: {
    id: string;
    cpvs: string;
    organo_nif: string | null;
    presupuesto_sin_iva: number | null;
    fecha_limite: string | null;
  },
  g: GoNoGo,
  opinion: Opinion | null,
): EntradaEncaje {
  const lotes = idsDelAmbito(g.ambito);
  const deFicha = g.ficha.aprobada
    ? evaluacionesDeFicha(g.ficha.aprobada.datos).filter(
        (r) => r.lote === null || !lotes.length || lotes.includes(r.lote),
      )
    : [];
  return {
    id: f.id,
    cpvs: g.ambito.cpvs.length ? g.ambito.cpvs : cpvsDe(f.cpvs),
    organo_nif: f.organo_nif,
    importe: g.ambito.importe ?? f.presupuesto_sin_iva,
    plazo: f.fecha_limite,
    opinion,
    semaforo: g.semaforo,
    requisitos: [...g.requisitos, ...deFicha],
  };
}
