// El plan con que se rellenó un anexo, guardado en oferta_documentos.sustituciones.
import { z } from 'zod';
import { logger } from '../../../nucleo/log.js';
import { textoComparable } from '../temas.js';
import type { HojaDatos } from './hojaDatos.js';

const log = logger('licitaciones');
const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

// Dice qué hueco o campo, de qué dato de la hoja y con qué valor. Permite regenerar el anexo por código cuando
// cambia un dato de la hoja, sin volver a pedírselo a Hermes.
const ItemWord = z.object({
  parrafo: z.number().int(),
  original: z.string(),
  nuevo: z.string(),
  dato: z.string(),
  valor: z.string().nullable(),
});
const CampoPdf = z.object({
  nombre: z.string(),
  valor: z.union([z.string(), z.boolean()]),
  dato: z.string(),
  valor_hoja: z.string().nullable(),
});

const PlanAnexo = z.discriminatedUnion('formato', [
  z.object({
    formato: z.literal('docx'),
    lote: z.string().nullable(),
    desde: z.number().int(),
    hasta: z.number().int(),
    items: z.array(ItemWord),
  }),
  z.object({ formato: z.literal('pdf'), lote: z.string().nullable(), campos: z.array(CampoPdf) }),
]);
export type PlanAnexoData = z.infer<typeof PlanAnexo>;

/**
 * El valor de un dato en la hoja (null si no está o viene vacío). En los grupos «Oferta» solo
 * cuenta la cifra: «40.000,00 (IGIC…)» se queda en «40.000,00», como lo compara el control de datos.
 */
export function valorDeHoja(hoja: HojaDatos | null, dato: string): string | null {
  const c = hoja?.campos.find(
    (x) => x.grupo !== 'Criterios automáticos' && comparable(x.etiqueta) === comparable(dato),
  );
  if (!c || c.valor === null) return null;
  return c.grupo.startsWith('Oferta') ? c.valor.split(' (')[0]! : c.valor;
}

type SustitucionPlan = { parrafo: number; original: string; nuevo: string; dato: string };
type CampoPlan = { nombre: string; valor: string | boolean; dato: string };

export function planWord(c: {
  lote: string | null;
  desde: number;
  hasta: number;
  sustituciones: SustitucionPlan[];
  hoja: HojaDatos | null;
}): PlanAnexoData {
  const items = c.sustituciones.map((s) => ({
    parrafo: s.parrafo,
    original: s.original,
    nuevo: s.nuevo,
    dato: s.dato,
    valor: valorDeHoja(c.hoja, s.dato),
  }));
  return { formato: 'docx', lote: c.lote, desde: c.desde, hasta: c.hasta, items };
}

export function planPdf(c: { lote: string | null; campos: CampoPlan[]; hoja: HojaDatos | null }): PlanAnexoData {
  return {
    formato: 'pdf',
    lote: c.lote,
    campos: c.campos.map((x) => ({
      nombre: x.nombre,
      valor: x.valor,
      dato: x.dato,
      valor_hoja: valorDeHoja(c.hoja, x.dato),
    })),
  };
}

/** Lee el plan guardado; null si no hay o ya no valida (un anexo anterior al plan se queda como está). */
export function leerPlan(json: string | null): PlanAnexoData | null {
  if (json === null) return null;
  let crudo: unknown;
  try {
    crudo = JSON.parse(json);
  } catch {
    log.warn('plan de anexo ilegible', {});
    return null;
  }
  const r = PlanAnexo.safeParse(crudo);
  if (!r.success) log.warn('plan de anexo que ya no valida', { motivo: r.error.issues[0]?.message });
  return r.success ? r.data : null;
}
