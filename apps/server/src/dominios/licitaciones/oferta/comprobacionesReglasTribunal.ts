// Regla de las comprobaciones «simulación de tribunal».
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import { MINUTOS_POR_ACCION, claveBloqueo, huellaDe, type Bloqueo } from './comprobacionesTipos.js';
import { textoNota } from './tribunal.js';

// Si el crítico ciego da a la memoria con trabajo menos del 70 % de los puntos de juicio de valor, es un riesgo
// con la nota y su margen. Se mejora la memoria o se acepta con un motivo. En la Revisión sale en la memoria de
// su lote (la clave empieza por «memoria»), en lugar de la nota que la Revisión pone cuando no hay fila.
export const REGLA_TRIBUNAL = 'memoria_tribunal';

export function reglaTribunal(e: EntradasComprobaciones): Bloqueo[] {
  return (e.tribunal ?? [])
    .filter((t) => t.nota.bajo_umbral)
    .map(({ lote, memoria_id, version, nota }): Bloqueo => ({
      clave: claveBloqueo(REGLA_TRIBUNAL, lote),
      categoria: 'coherencia',
      lote,
      gravedad: 'riesgo',
      titulo: `El crítico ciego le da a la v${version} ${textoNota(nota)}: menos del 70 % de los puntos de juicio de valor`,
      cita: null,
      actor: 'tu',
      accion: { tipo: 'revisar_memoria', destino: 'memoria' },
      propuesta: null,
      minutos: MINUTOS_POR_ACCION.revisar_memoria,
      estado: 'abierto',
      huella: huellaDe(REGLA_TRIBUNAL, memoria_id, nota.total, nota.maximo),
    }));
}
