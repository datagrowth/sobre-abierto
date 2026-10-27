// Formato de «Preguntar al pliego», sin React y con tests: el estado de cada
// pregunta, la cita y el borrador de la consulta al órgano cuando el pliego no lo dice.

// Una respuesta sin cita comprobada se enseña «no comprobada»: Hermes puede equivocarse. Que el
// pliego no lo dice no tiene cita que buscar: es lo que Hermes no encontró, también sin comprobar.
export function estadoPregunta(p) {
  if (p.estado === 'pendiente') return { texto: 'Hermes lo está buscando', tono: 'hermes' };
  if (p.estado === 'fallida') return { texto: 'Hermes no pudo responder: vuelve a preguntarlo', tono: 'riesgo' };
  if (!p.dice) return { texto: 'Hermes no lo encontró en el pliego (no comprobado)', tono: 'riesgo' };
  return p.cita?.comprobada ? { texto: 'Cita comprobada', tono: 'ok' } : { texto: 'No comprobada', tono: 'riesgo' };
}

const nombreDocumento = (ruta) => (ruta ? ruta.split('/').pop() : null);

/** «PPT.pdf, pág. 3» o, sin documento, null. */
export function dondeCita(cita) {
  const doc = nombreDocumento(cita?.documento);
  if (!doc) return null;
  return cita.pagina ? `${doc}, pág. ${cita.pagina}` : doc;
}

// La pregunta como la escribiría la empresa al órgano: con «¿…?» aunque la persona no lo pusiera.
function comoPregunta(t) {
  const limpio = t
    .trim()
    .replace(/^¿+|\?+$/g, '')
    .trim();
  return `¿${limpio.charAt(0).toLowerCase()}${limpio.slice(1)}?`;
}

/** El borrador de la consulta al órgano para una pregunta que el pliego no responde. */
export function consultaAlOrgano(p, f) {
  return [
    `Asunto: consulta sobre el expediente ${f.expediente}`,
    '',
    `En relación con la licitación «${f.titulo}» (expediente ${f.expediente}), y no habiendo encontrado la respuesta en los pliegos, les planteamos la siguiente consulta:`,
    '',
    comoPregunta(p.pregunta),
    '',
    'Muchas gracias.',
  ].join('\n');
}

/** ¿Se puede pasar a las comprobaciones? Solo una pregunta ya respondida. */
export const sePuedePasar = (p) => p.estado === 'respondida';
