// Regla de las comprobaciones «memoria reutilizada».
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import { MINUTOS_POR_ACCION, claveBloqueo, huellaDe, type Bloqueo } from './comprobacionesTipos.js';

// Un apartado que copia literal más del 30 % de una memoria presentada a otro órgano es un riesgo. Se reescribe
// el apartado o se acepta con un motivo. En la Revisión sale en la memoria de su lote (la clave empieza por
// «memoria»).
const REGLA_REUTILIZADA = 'memoria_reutilizada';

const porcentaje = (f: number): string => `${Math.round(f * 100)} %`;

export function reglaMemoriaReutilizada(e: EntradasComprobaciones): Bloqueo[] {
  return (e.reutilizaciones ?? []).flatMap(({ lote, memoria_id, version, apartados }) =>
    apartados.map((r): Bloqueo => ({
      clave: claveBloqueo(REGLA_REUTILIZADA, lote, String(r.apartado)),
      categoria: 'coherencia',
      lote,
      gravedad: 'riesgo',
      titulo: `El apartado ${r.apartado} de la v${version} copia el ${porcentaje(r.fraccion)} de la memoria presentada a ${r.organo} (${r.expediente}): reescríbelo para este cliente`,
      cita: null,
      actor: 'tu',
      accion: { tipo: 'revisar_memoria', destino: `memoria.apartado.${r.apartado}` },
      propuesta: null,
      minutos: MINUTOS_POR_ACCION.revisar_memoria,
      estado: 'abierto',
      huella: huellaDe(REGLA_REUTILIZADA, memoria_id, r.apartado, r.licitacion_id),
    })),
  );
}
