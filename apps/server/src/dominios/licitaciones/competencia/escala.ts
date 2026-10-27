// Escala de los rankings de competencia (Ajustes › Fuentes y filtros): territorio y banda de presupuesto.
import { z } from 'zod';
import { ahora } from '../../../nucleo/db.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';

// El formulario manda «» en un campo que se deja en blanco: cuenta como sin indicar.
const vacioANulo = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Es con lo que se abren Competidores y Organismos. Va aparte del prefiltro, que decide qué entra en el radar,
// no a qué escala se compara. Sin guardar, toda España y sin banda; la banda propia (percentiles de las
// presentadas por la empresa, ambito.ts) manda en cuanto hay bastantes.
const EscalaCompetencia = z
  .strictObject({
    region_nuts: z
      .preprocess(
        vacioANulo,
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^ES[0-9A-Z]{0,3}$/, 'prefijo NUTS de España, p. ej. «ES7» o «ES30»')
          .nullable(),
      )
      .default(null),
    banda_min: z.number().finite().nonnegative().nullable().default(null),
    banda_max: z.number().finite().positive().nullable().default(null),
  })
  .refine((e) => e.banda_min === null || e.banda_max === null || e.banda_min <= e.banda_max, {
    path: ['banda_max'],
    message: 'la banda de importe va de menos a más',
  });
export type EscalaData = z.infer<typeof EscalaCompetencia>;

export const ESCALA_NEUTRA: EscalaData = { region_nuts: null, banda_min: null, banda_max: null };

/** La escala guardada o, sin guardar (o si ya no valida), la neutra. */
export function leerEscala(db: Db): EscalaData {
  const f = db.prepare('SELECT datos FROM escala_competencia WHERE id = 1').get() as { datos: string } | undefined;
  const e = f ? EscalaCompetencia.safeParse(JSON.parse(f.datos)) : null;
  return e?.success ? e.data : ESCALA_NEUTRA;
}

export function guardarEscala(db: Db, entrada: unknown): Result<EscalaData> {
  const e = EscalaCompetencia.safeParse(entrada);
  if (!e.success) return fail('invalid_input', z.prettifyError(e.error));
  db.prepare(
    `INSERT INTO escala_competencia (id, datos, actualizado_en) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
  ).run(JSON.stringify(e.data), ahora());
  return ok(e.data);
}
