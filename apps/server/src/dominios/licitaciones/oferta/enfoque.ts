// El enfoque de las decisiones, opcional: lo que la persona quiere que la memoria cuente.
import { z } from 'zod';
import { logger } from '../../../nucleo/log.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { descripcionDeFuga, detectarFugas } from './fugas.js';
import { contextoFugasDe } from './fugasMemoria.js';
import type { GuionGuardado } from './guion.js';

const log = logger('licitaciones');
const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);

// Es lo que la estrategia no sacaría del pliego. Se revisa al guardar: una fuga a otro sobre se rechaza (p. ej.
// delatar un criterio automático) y prometer lo que Hermes recomendó no prometer solo avisa (un enfoque puede
// afirmar una plataforma, un alojamiento o un asistente propios que la empresa no tiene). Lee la propuesta
// guardada sin pasar por propuestaDecisiones.ts, que importa este módulo: así no hay ciclo.
export const NoPrometer = z.strictObject({
  que: Texto(3, 200).describe(
    'Lo que la memoria no debe prometer: «Moodle propio», «alojamiento en la UE», «chatbot 24/7»',
  ),
  motivo: Texto(10, 400).describe('Por qué: no lo tenemos o no conviene'),
  marcas: z
    .array(Texto(2, 40))
    .min(1)
    .max(5)
    .describe('Palabras que lo delatarían en el enfoque o en la memoria: «Moodle propio», «24/7»'),
});
export type NoPrometerData = z.infer<typeof NoPrometer>;

const DelaPropuesta = z.object({ no_prometer: z.array(NoPrometer).max(10).default([]) });

/** Lo que Hermes recomendó no prometer al proponer las decisiones (vacío sin propuesta o si no valida). */
export function noPrometerDe(db: Db, id: string): NoPrometerData[] {
  const f = db.prepare('SELECT datos FROM propuestas_decisiones WHERE licitacion_id = ?').get(id) as
    { datos: string } | undefined;
  if (!f) return [];
  const d = DelaPropuesta.safeParse(JSON.parse(f.datos));
  if (!d.success) {
    log.warn('no_prometer de la propuesta no válido', { licitacion: id });
    return [];
  }
  return d.data.no_prometer;
}

/** El texto en minúsculas, sin tildes y con los espacios de un solo blanco. */
const comparable = (t: string): string => textoComparable(t).replace(/\s+/g, ' ').trim();
const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Si la marca aparece como palabra entera («24/7» casa; «Moodle» no casa en «Moodles»). */
export function contieneMarca(texto: string, marca: string): boolean {
  const m = comparable(marca);
  if (!m) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapar(m)}(?![\\p{L}\\p{N}])`, 'u').test(comparable(texto));
}

/** Fuga en el enfoque (p. ej. delatar un criterio automático): nunca se acepta, ni con avisos. */
function fugaEnEnfoque(db: Db, enfoque: string, guion: GuionGuardado): string | null {
  const fugas = detectarFugas(enfoque, contextoFugasDe(db, guion));
  if (!fugas.length) return null;
  return `El enfoque delata lo que va en otro sobre: ${fugas.slice(0, 3).map(descripcionDeFuga).join('; ')}. El redactor lo copiaría en la memoria y sería causa de exclusión: quítalo del enfoque.`;
}

function avisoDe(enfoque: string, n: NoPrometerData): string | null {
  const marca = n.marcas.find((m) => contieneMarca(enfoque, m));
  return marca ? `El enfoque promete «${marca}» y Hermes recomendó no prometer «${n.que}»: ${n.motivo}` : null;
}

/** Errores (la fuga entre sobres: no se guarda) y avisos (lo que Hermes dijo no prometer: se guarda). Vacío, nada. */
export function revisarEnfoque(
  db: Db,
  guion: GuionGuardado,
  enfoque: string,
  noPrometer: NoPrometerData[],
): { errores: string[]; avisos: string[] } {
  if (!enfoque.trim()) return { errores: [], avisos: [] };
  const fuga = fugaEnEnfoque(db, enfoque, guion);
  const avisos = noPrometer.map((n) => avisoDe(enfoque, n)).filter((a): a is string => a !== null);
  return { errores: fuga ? [fuga] : [], avisos };
}

/** Las líneas de la frontera del dossier: lo que la estrategia no debe prometer. */
export function lineasNoPrometer(noPrometer: NoPrometerData[]): string[] {
  return noPrometer.map((n) =>
    `- No prometer (lo recomendó Hermes al proponer las decisiones): «${n.que}» — ${n.motivo}.`.replace(/\.\.$/, '.'),
  );
}
