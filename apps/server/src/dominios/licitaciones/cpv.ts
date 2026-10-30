// Vocabulario CPV 2008 oficial de la UE en español, cargado de src/datos/cpv.json.
import { z } from 'zod';
import datos from '../../datos/cpv.json' with { type: 'json' };

// Se valida al cargar porque el JSON se regenera con un script y una fila mal formada rompería
// la tabla `cpv` sin avisar.
const esquema = z.array(z.tuple([z.string().regex(/^\d{8}$/), z.string().min(1)]));

/** Pares [código de 8 cifras sin dígito de control, descripción]. */
export const CPV_2008: ReadonlyArray<readonly [string, string]> = esquema.parse(datos);
