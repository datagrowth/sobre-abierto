// Perfil de costes de la empresa (un único registro en nucleo.db, tabla perfil_costes).
import { z } from 'zod';
import { ahora, type Db } from './db.js';
import { emitir } from './eventos.js';
import { logger } from './log.js';
import { fail, ok, type Result } from './result.js';

// Dice lo que cuesta una hora, un envío o un informe, para estimar lo que compromete una memoria. Va APARTE del
// perfil de empresa para que nunca llegue a un agente: perfilParaAgentes y plataforma_empresa no lo leen,
// proponerPerfilEmpresa no lo puede tocar y CambioImpacto.empresa no cambia. Los euros solo van a la web, como
// decisiones.ofertas[].coste_estimado.
/** €/h si ni Ajustes › Empresa ni LICITACIONES_PRECIO_HORA lo dicen. */
export const EUROS_HORA_POR_DEFECTO = 25;
const EUROS_HORA_MAX = 1000;

const num = (min: number, max: number, def: number) => z.number().finite().min(min).max(max).default(def);
const entero = (min: number, max: number, def: number) => z.number().int().min(min).max(max).default(def);

export const PerfilCostes = z.strictObject({
  euros_hora: num(1, EUROS_HORA_MAX, EUROS_HORA_POR_DEFECTO),
  euros_material_por_persona: num(0, 1000, 18),
  euros_envio_por_persona: num(0, 200, 7),
  minutos_preparacion_individual: num(0, 240, 10),
  fraccion_aptas: num(0, 1, 0.75),
  fraccion_ruta_apoyo: num(0, 1, 0.25),
  tamano_subgrupo: entero(1, 200, 11),
  horas_preparacion_por_hora_lectiva: num(0, 10, 1.5),
  horas_por_contacto: num(0, 40, 1),
  horas_montaje_aula: num(0, 200, 8),
  horas_aula_semana: num(0, 60, 4.5),
  horas_por_informe: num(0, 80, 2),
  minutos_extra_comentario: num(0, 60, 3),
  plazo_referencia_dias: entero(1, 60, 5),
  umbral_horas: num(0, 10_000, 15),
  umbral_euros: num(0, 1_000_000, 300),
  umbral_pct_presupuesto: num(0, 1, 0.02),
  // Puede pasar de 1: los añadidos pueden costar más que el presupuesto entero (p. ej. un 190 %).
  umbral_total_pct: num(0, 10, 0.5),
});
export type PerfilCostesData = z.infer<typeof PerfilCostes>;

export type PerfilCostesGuardado = { perfil: PerfilCostesData; actualizado_en: string | null; por_defecto: boolean };

const log = logger('plataforma');

// LICITACIONES_PRECIO_HORA ya existía para la web: es el €/h por defecto mientras nadie guarde
// el perfil, sin duplicar variables. Fuera de rango se ignora en vez de romper la lectura.
function eurosHoraBase(precioHoraEntorno: number | null): number {
  return precioHoraEntorno !== null && precioHoraEntorno >= 1 && precioHoraEntorno <= EUROS_HORA_MAX
    ? precioHoraEntorno
    : EUROS_HORA_POR_DEFECTO;
}

/** Los valores por defecto, con el €/h del entorno si lo hay. */
export function perfilCostesPorDefecto(precioHoraEntorno: number | null = null): PerfilCostesData {
  return PerfilCostes.parse({ euros_hora: eurosHoraBase(precioHoraEntorno) });
}

function leerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/**
 * El perfil guardado o, si no hay o ya no valida, los valores por defecto con por_defecto: true.
 * Nunca falla: sin perfil, las estimaciones siguen saliendo con cifras razonables.
 */
export function leerPerfilCostes(db: Db, precioHoraEntorno: number | null = null): PerfilCostesGuardado {
  const row = db.prepare('SELECT datos, actualizado_en FROM perfil_costes WHERE id = 1').get() as
    { datos: string; actualizado_en: string } | undefined;
  if (!row) return { perfil: perfilCostesPorDefecto(precioHoraEntorno), actualizado_en: null, por_defecto: true };
  const parsed = PerfilCostes.safeParse(leerJson(row.datos));
  if (parsed.success) return { perfil: parsed.data, actualizado_en: row.actualizado_en, por_defecto: false };
  // Solo las rutas de zod, nunca los datos.
  const campos = parsed.error.issues
    .map((i) => i.path.join('.'))
    .slice(0, 10)
    .join(',');
  log.warn('perfil de costes guardado no válido: se usan los valores por defecto', { campos });
  return { perfil: perfilCostesPorDefecto(precioHoraEntorno), actualizado_en: null, por_defecto: true };
}

// Un campo sin enviar toma el valor por defecto; el €/h, el del entorno si lo hay.
function conEurosHoraBase(entrada: unknown, precioHoraEntorno: number | null): unknown {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return entrada;
  return { euros_hora: eurosHoraBase(precioHoraEntorno), ...entrada };
}

/** Valida y guarda el perfil; avisa con el evento «plataforma.empresa_costes» (sin contenido). */
export function guardarPerfilCostes(
  db: Db,
  entrada: unknown,
  precioHoraEntorno: number | null = null,
): Result<PerfilCostesGuardado> {
  const parsed = PerfilCostes.safeParse(conEurosHoraBase(entrada, precioHoraEntorno));
  if (!parsed.success) return fail('invalid_input', z.prettifyError(parsed.error));
  const ts = ahora();
  db.prepare(
    `INSERT INTO perfil_costes (id, datos, actualizado_en) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
  ).run(JSON.stringify(parsed.data), ts);
  emitir(db, { tipo: 'plataforma.empresa_costes', dominio: 'plataforma', recurso: null, datos: {} });
  return ok({ perfil: parsed.data, actualizado_en: ts, por_defecto: false });
}
