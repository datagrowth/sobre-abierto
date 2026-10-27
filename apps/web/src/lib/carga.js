// Estado de un recurso cargado (sin React, para poder probarlo). Si una recarga falla, los
// datos que ya se veían se conservan: desmontar el formulario por un fallo de red haría
// perder lo que la persona estaba escribiendo.

const HORA_MADRID = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Carga correcta: limpia cualquier fallo anterior. `clave`: de qué consulta son los datos (otro lote, filtro o página). */
export function trasCarga(data, ahora = Date.now(), clave = undefined) {
  return { kind: 'ready', data, actualizado: ahora, ...(clave === undefined ? {} : { clave }) };
}

/**
 * Fallo: con datos previos de la misma consulta los conserva y anota el fallo; sin ellos (o si
 * los que hay son de otra `clave`: otro lote, filtro o página) es un error, no datos de otra consulta.
 */
export function trasFallo(previo, message, ahora = Date.now(), clave = undefined) {
  const mismaConsulta = clave === undefined || previo?.clave === clave;
  if (previo?.kind === 'ready' && mismaConsulta) return { ...previo, fallo: { message, en: ahora } };
  return { kind: 'error', message };
}

/** «No se pudo actualizar (…) · datos de las HH:MM» (hora de Madrid), o null si no hay fallo. */
export function textoFalloRecarga(estado) {
  if (!estado?.fallo) return null;
  const hora = estado.actualizado != null ? HORA_MADRID.format(new Date(estado.actualizado)) : null;
  const base = `No se pudo actualizar (${estado.fallo.message})`;
  return hora ? `${base} · datos de las ${hora}` : base;
}
