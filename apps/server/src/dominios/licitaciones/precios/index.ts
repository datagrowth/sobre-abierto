// Precios de una licitación (o de un segmento): estadística de bajas, escenarios de oferta y comparables.
import { z } from 'zod';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { nombreDe, PROCEDIMIENTOS, TIPOS_CONTRATO } from '../placsp/codigos.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from '../store.js';
import { percentil } from '../../../nucleo/estadistica.js';
import { resumir, type Resumen } from './estadistica.js';
import { escenarios, type Escenarios, type UmbralPliego, type UnidadEscenarios } from './escenarios.js';
import { comparables, type Comparable } from './comparables.js';
import { elegirSegmento, type Consulta, type Segmento } from './segmento.js';
import { lotesDeLicitacion, type LoteDatos } from '../lotes.js';
import { claveOrgano } from '../antecedentes/organo.js';
import { palabrasObjeto } from '../antecedentes/texto.js';
import { otroObjetoDelOrgano } from '../antecedentes/ediciones.js';
import { guionVigente, type OfertaEconomicaLoteData } from '../oferta/guion.js';
import { ofertaDeLote } from '../oferta/guionLotes.js';

// La estadística sale de lo adjudicado en el histórico. Todo es código sobre datos de la PLACSP; nada de IA.
const NOTA_PRECIOS =
  'Orientativo: estadística de adjudicaciones parecidas publicadas en la PLACSP. El aviso de oferta anormalmente baja usa el umbral del pliego si el guion lo trae como baja; si no, la regla supletoria del art. 85 del RGLCAP suponiendo que el resto oferta la baja mediana del segmento; manda lo que diga el pliego.';

const Cpv = z.string().regex(/^\d{8}$/, 'CPV de 8 cifras');
const Codigo = z.string().regex(/^\d{1,3}$/);

// Lo común a las tools y a la web. Una licitación por `id`, o un segmento por `cpv` + `importe`.
export const OpcionesPrecios = z.object({
  importe: z
    .number()
    .positive()
    .max(1e11)
    .optional()
    .describe('Presupuesto sin IVA; con id, sustituye al de la licitación o del lote'),
  lote: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Con id: lote para el que calcular (por defecto, el primer lote de interés de la criba; sin él, el contrato entero)',
    ),
  mismo_organo: z.boolean().default(false).describe('Comparar solo con adjudicaciones del mismo órgano'),
  ofertas: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Número de ofertas esperado (por defecto, la mediana del segmento)'),
  filtrar_ofertas: z
    .boolean()
    .default(false)
    .describe('Comparar solo con adjudicaciones con un número de ofertas parecido al esperado'),
  bajas: z
    .array(z.number().min(0).max(0.95))
    .max(5)
    .default([])
    .describe('Bajas a evaluar como fracción (0.15 = 15 %)'),
});
export type OpcionesPreciosData = z.infer<typeof OpcionesPrecios>;

export const SegmentoPrecios = z.object({
  cpv: Cpv.describe('CPV principal, 8 cifras'),
  tipo: Codigo.optional().describe('Tipo de contrato CODICE: 1 suministros, 2 servicios, 3 obras…'),
  procedimiento: Codigo.optional().describe('Procedimiento CODICE: 1 abierto, 9 abierto simplificado…'),
});

// lote: para qué lote se calculó (null = contrato entero); lotes_interes: los del ámbito (los de interés de la criba o, sin ellos, los del prefiltro).
export type Precios = {
  consulta: Consulta & { tipo_nombre: string | null; procedimiento_nombre: string | null };
  segmento: Segmento;
  estadistica: Resumen;
  escenarios: Escenarios | null;
  nota: string;
  lote?: { id: string; nombre: string | null; importe: number | null } | null;
  lotes_interes?: string[];
};

/**
 * Consulta a partir de una licitación guardada: su CPV principal, presupuesto, tipo,
 * procedimiento y órgano. Con un lote, su presupuesto y su CPV: las bajas del histórico
 * son por lote y un lote de 100.000 € no se compara con contratos de un millón.
 */
export function consultaDe(l: FilaLicitacion, o: OpcionesPreciosData, lote: LoteDatos | null = null): Consulta {
  const cpv = lote?.cpvs[0] ?? l.cpvs.split(',').find(Boolean) ?? null;
  const presupuesto = lote ? lote.presupuesto_sin_iva : (l.presupuesto_sin_iva ?? l.valor_estimado);
  const organo = { organo: l.organo_nif, organo_dir3: l.organo_dir3, organo_norm: l.organo_norm };
  return {
    cpv,
    presupuesto: o.importe ?? presupuesto,
    tipo: l.tipo_contrato,
    procedimiento: l.procedimiento,
    ...organo,
    mismo_organo: o.mismo_organo && claveOrgano(l) !== null,
    ofertas: o.filtrar_ofertas ? (o.ofertas ?? null) : null,
    excluir: l.id,
    titulo: tituloDe(l, lote),
  };
}

// Un lote con nombre propio («Mantenimiento de la web») describe mejor lo adjudicado que el
// título del contrato; un nombre de una palabra («Lote 1», «Madrid») no.
function tituloDe(l: FilaLicitacion, lote: LoteDatos | null): string {
  return lote?.nombre && palabrasObjeto(lote.nombre).size >= 2 ? lote.nombre : l.titulo;
}

export function ofertasEsperadas(o: OpcionesPreciosData, ofertas: (number | null)[]): number {
  if (o.ofertas) return o.ofertas;
  const conDato = ofertas.filter((n): n is number => n !== null && n >= 1).sort((a, b) => a - b);
  // Sin datos de ofertas en el segmento se supone una competencia típica de tres.
  return Math.max(1, Math.round(percentil(conDato, 0.5) ?? 3));
}

// Lo que el guion vigente dice del precio del lote: su umbral de anormalidad y la unidad en
// que se oferta. Sin guion, nada (los escenarios van con el art. 85 y en importe total).
export type PliegoPrecios = { umbral: UmbralPliego | null; unidad: UnidadEscenarios | null };

/** Estadística del segmento, escenarios (si hay presupuesto) y nota de uso. */
export function calcularPrecios(
  db: Db,
  c: Consulta,
  o: OpcionesPreciosData,
  minimo: number,
  pliego: PliegoPrecios | null = null,
): Precios {
  const { segmento, observaciones } = elegirSegmento(db, c, minimo);
  const estadistica = resumir(observaciones);
  const ordenadas = observaciones.map((x) => x.baja).sort((a, b) => a - b);
  const ofertas = ofertasEsperadas(
    o,
    observaciones.map((x) => x.ofertas),
  );
  const base = {
    presupuesto: c.presupuesto ?? 0,
    percentiles: estadistica.percentiles,
    bajas: o.bajas,
    ordenadas,
    ofertas,
  };
  const esc =
    c.presupuesto && observaciones.length
      ? escenarios({ ...base, umbralPliego: pliego?.umbral, unidad: pliego?.unidad })
      : null;
  const consulta = {
    ...c,
    tipo_nombre: nombreDe(TIPOS_CONTRATO, c.tipo),
    procedimiento_nombre: nombreDe(PROCEDIMIENTOS, c.procedimiento),
  };
  return { consulta, segmento, estadistica, escenarios: esc, nota: NOTA_PRECIOS };
}

const citaDe = (oe: OfertaEconomicaLoteData) =>
  oe.documento ? `${oe.documento}${oe.pagina ? `, pág. ${oe.pagina}` : ''}` : null;

// Solo con una línea: con varias (nivel básico y avanzado) cada una tiene su máximo y no hay
// una base común. La base es el precio máximo por unidad, que es contra lo que mide la baja el
// pliego; sin él, el presupuesto entre las unidades previstas.
function unidadDe(oe: OfertaEconomicaLoteData, presupuesto: number | null): UnidadEscenarios | null {
  const l = oe.precios_unitarios.length === 1 ? oe.precios_unitarios[0]! : null;
  const base = l ? (l.maximo ?? (presupuesto && l.cantidad ? presupuesto / l.cantidad : null)) : null;
  return l && base ? { nombre: l.unidad, base } : null;
}

/** Umbral y unidad de la oferta económica del lote en el guion vigente; null sin guion. */
export function pliegoDePrecios(
  db: Db,
  id: string,
  lote: string | null,
  presupuesto: number | null,
): PliegoPrecios | null {
  const g = guionVigente(db, id)?.datos;
  const oe = g ? ofertaDeLote(g, lote) : null;
  if (!oe) return null;
  const umbral =
    oe.umbral_baja != null || oe.umbral_anormalidad
      ? { baja: oe.umbral_baja ?? null, literal: oe.umbral_anormalidad, cita: citaDe(oe) }
      : null;
  return { umbral, unidad: unidadDe(oe, presupuesto) };
}

type Elegido = { l: FilaLicitacion; lote: LoteDatos | null; interes: string[] };

// El lote pedido o, sin pedirlo, el primero del ámbito: de interés de la criba o, sin ellos, del prefiltro.
export function licitacionYLote(db: Db, id: string, lote: string | undefined): Result<Elegido> {
  const l = obtenerLicitacion(db, id);
  const lotes = lotesDeLicitacion(db, id);
  if (!l || !lotes) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const interes = lotes.ambito.lotes.map((x) => x.id);
  if (lote === undefined) return ok({ l, lote: lotes.ambito.lotes[0] ?? null, interes });
  const pedido = lotes.lotes.find((x) => x.id === lote);
  if (!pedido)
    return fail(
      'invalid_input',
      lotes.lotes.length
        ? `La licitación no tiene el lote «${lote}» (lotes: ${lotes.lotes
            .map((x) => x.id)
            .slice(0, 60)
            .join(', ')}).`
        : 'La licitación no tiene lotes: no indiques lote.',
    );
  return ok({ l, lote: pedido, interes });
}

export function preciosDeLicitacion(db: Db, id: string, o: OpcionesPreciosData, minimo: number): Result<Precios> {
  const e = licitacionYLote(db, id, o.lote);
  if (e.error) return e;
  const { l, lote, interes } = e.data;
  const lotePrecios = lote ? { id: lote.id, nombre: lote.nombre, importe: lote.presupuesto_sin_iva } : null;
  const c = consultaDe(l, o, lote);
  const pliego = pliegoDePrecios(db, id, lote?.id ?? null, c.presupuesto);
  return ok({ ...calcularPrecios(db, c, o, minimo, pliego), lote: lotePrecios, lotes_interes: interes });
}

export function consultaDeSegmento(s: z.infer<typeof SegmentoPrecios>, o: OpcionesPreciosData): Consulta {
  return {
    cpv: s.cpv,
    presupuesto: o.importe ?? null,
    tipo: s.tipo ?? null,
    procedimiento: s.procedimiento ?? null,
    organo: null,
    mismo_organo: false,
    ofertas: o.filtrar_ofertas ? (o.ofertas ?? null) : null,
    excluir: null,
  };
}

// Para comparables solo cuentan el importe y el órgano: el tramo de ofertas y las bajas
// a evaluar son de la estadística.
export type OpcionesComparables = Pick<OpcionesPreciosData, 'importe' | 'mismo_organo' | 'lote'>;
const sinOfertas = (o: OpcionesComparables): OpcionesPreciosData => ({ ...o, filtrar_ofertas: false, bajas: [] });

// otro_objeto: del mismo órgano pero sin objeto parecido; la web lo pliega aparte.
export type ComparableDeLicitacion = Comparable & { otro_objeto: boolean };

export function comparablesDeLicitacion(
  db: Db,
  id: string,
  o: OpcionesComparables,
  limite: number,
): Result<ComparableDeLicitacion[]> {
  const e = licitacionYLote(db, id, o.lote);
  if (e.error) return e;
  return ok(
    comparables(db, consultaDe(e.data.l, sinOfertas(o), e.data.lote), limite).map((c) => ({
      ...c,
      otro_objeto: otroObjetoDelOrgano(c),
    })),
  );
}

export function comparablesDeSegmento(
  db: Db,
  s: z.infer<typeof SegmentoPrecios>,
  o: OpcionesComparables,
  limite: number,
): Comparable[] {
  return comparables(db, consultaDeSegmento(s, sinOfertas(o)), limite);
}

export { type Comparable };
