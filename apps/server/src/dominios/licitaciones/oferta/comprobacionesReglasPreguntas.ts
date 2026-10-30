// Regla de las comprobaciones «pregunta al pliego».
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import { MINUTOS_POR_ACCION, claveBloqueo, huellaDe, type Bloqueo } from './comprobacionesTipos.js';

// Una respuesta de «Preguntar al pliego» que una persona pasó a las comprobaciones es un riesgo hasta que se
// acepta con un motivo. Si el pliego no lo dice, la acción es preparar la consulta al órgano. La cita va
// comprobada o no, como la guardó la respuesta.
const REGLA_PREGUNTA = 'pregunta_pliego';
const MAX_PREGUNTA = 140;

const corta = (t: string) => (t.length > MAX_PREGUNTA ? `${t.slice(0, MAX_PREGUNTA - 1)}…` : t);

export function reglaPreguntasPliego(e: EntradasComprobaciones): Bloqueo[] {
  return (e.preguntas_comprobaciones ?? []).map((p): Bloqueo => {
    const accion = p.dice ? 'aceptar_riesgo' : 'consulta_organo';
    // «No lo dice» no tiene cita que comprobar: es lo que Hermes no encontró.
    const respuesta = p.dice
      ? (p.respuesta ?? '')
      : `Hermes no lo encontró en el pliego (no comprobado)${p.respuesta && !/no lo dice/i.test(p.respuesta) ? `: ${p.respuesta}` : ''}`;
    return {
      clave: claveBloqueo(REGLA_PREGUNTA, null, String(p.id)),
      categoria: 'elegibilidad',
      lote: null,
      gravedad: 'riesgo',
      titulo: `«${corta(p.pregunta)}» ${respuesta}`,
      cita: p.cita
        ? {
            documento: p.cita.documento ?? 'Pliegos',
            pagina: p.cita.pagina,
            texto: p.cita.texto,
            comprobada: p.cita.comprobada,
          }
        : null,
      actor: 'tu',
      accion: { tipo: accion, destino: 'resumen' },
      propuesta: null,
      minutos: MINUTOS_POR_ACCION[accion],
      estado: 'abierto',
      huella: huellaDe(REGLA_PREGUNTA, p.id, p.respuesta, p.cita?.texto ?? null),
    };
  });
}
