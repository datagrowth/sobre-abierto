// Regla de las comprobaciones «lección no aplicada».
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import { MINUTOS_POR_ACCION, claveBloqueo, huellaDe, type Bloqueo } from './comprobacionesTipos.js';
import type { LeccionNoAplicada } from './leccionesAplicadas.js';

// Una lección de fuerza alta que vale para esta memoria y no se pasó a la redacción, o que el crítico ciego no
// ve cumplida, es un riesgo. Se acepta con un motivo (la lección no aplica a este pliego) o se pide otra
// versión. En la Revisión sale en la memoria de su lote (la clave empieza por «memoria»).
const REGLA_LECCION = 'memoria_leccion';
const MAX_TEXTO = 140;

const corto = (t: string) => (t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO - 1)}…` : t);

function titulo(l: LeccionNoAplicada, version: number): string {
  if (l.motivo === 'no_pasada')
    return `Lección no aplicada en la v${version} (la apoyan ${l.fuerza} ofertas): «${corto(l.texto)}»`;
  const donde = l.apartados.length === 1 ? `el apartado ${l.apartados[0]}` : `los apartados ${l.apartados.join(', ')}`;
  return `El crítico no ve cumplida en ${donde} de la v${version} la lección «${corto(l.texto)}»`;
}

export function reglaLeccionesNoAplicadas(e: EntradasComprobaciones): Bloqueo[] {
  return (e.lecciones_no_aplicadas ?? []).flatMap(({ lote, version, lecciones }) =>
    lecciones.map((l): Bloqueo => ({
      clave: claveBloqueo(REGLA_LECCION, lote, String(l.leccion_id)),
      categoria: 'coherencia',
      lote,
      gravedad: 'riesgo',
      titulo: titulo(l, version),
      cita: null,
      actor: 'tu',
      accion: { tipo: 'aceptar_riesgo', destino: 'memoria' },
      propuesta: null,
      minutos: MINUTOS_POR_ACCION.aceptar_riesgo,
      estado: 'abierto',
      huella: huellaDe(REGLA_LECCION, l.leccion_id, l.motivo, version),
    })),
  );
}
