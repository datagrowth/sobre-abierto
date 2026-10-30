// El asistente de la oferta en la web, sin React y con tests: qué pregunta toca, el hilo como
// conversación, qué rehace cambiar una respuesta ya dada («Qué cambia») y los textos del panel.

/** La pregunta que se enseña: la elegida en «Lo que hay que decidir» o la primera pendiente. */
export function preguntaActual(preguntas, elegida) {
  return preguntas.find((p) => p.clave === elegida) ?? preguntas.find((p) => p.estado === 'pendiente') ?? null;
}

/** «Vamos con la oferta. Para redactar todos los documentos necesito 8 decisiones…». */
export function introduccion({ total, hechas }) {
  if (!total) return 'Aún no hay nada que decidir: las preguntas salen del guion de la oferta.';
  const ya = hechas
    ? ` ${hechas === 1 ? 'Una ya la tengo' : `${hechas} ya las tengo`} de la ficha y de lo decidido;`
    : '';
  const resto = total - hechas;
  if (!resto)
    return `Vamos con la oferta. Las ${total} decisiones que necesito para redactar los documentos están tomadas. Si quieres cambiar alguna, elígela en «Lo que hay que decidir».`;
  return `Vamos con la oferta. Para redactar todos los documentos necesito ${total === 1 ? 'una decisión' : `${total} decisiones`}.${ya} te pregunto ${resto === 1 ? 'la que falta' : 'el resto de una en una'}.`;
}

/** «PCAP, cláusula 8.5, pág. 13 · PPT, pág. 8». */
export function textoCitas(citas = []) {
  return citas.map((c) => [c.documento, c.pagina ? `pág. ${c.pagina}` : null].filter(Boolean).join(', ')).join(' · ');
}

// Quién habla en cada mensaje del hilo: la plataforma habla como Hermes, en pequeño.
const QUIEN = { persona: 'persona', hermes: 'hermes', plataforma: 'hermes' };

/**
 * El hilo como conversación: antes de cada respuesta, la pregunta a la que contesta (si no es la
 * misma que la anterior); el texto libre, con «lo está leyendo» mientras Hermes lo interpreta; la
 * interpretación por confirmar, con sus acciones.
 */
export function conversacion(mensajes = []) {
  const out = [];
  let ultimaPregunta = null;
  for (const m of mensajes) {
    if (
      (m.tipo === 'respuesta' || m.tipo === 'libre') &&
      m.pregunta &&
      m.pregunta !== ultimaPregunta &&
      m.datos?.titulo
    ) {
      out.push({ clave: `p-${m.id}`, quien: 'hermes', tipo: 'pregunta', texto: m.datos.titulo });
    }
    if (m.pregunta) ultimaPregunta = m.pregunta;
    out.push({
      clave: `m-${m.id}`,
      quien: QUIEN[m.autor] ?? 'hermes',
      tipo: m.tipo,
      texto: m.texto,
      estado: m.estado,
      id: m.id,
      pregunta: m.pregunta,
      explicacion: m.datos?.explicacion ?? null,
    });
    if (m.tipo === 'libre' && m.estado === 'interpretando')
      out.push({
        clave: `l-${m.id}`,
        quien: 'hermes',
        tipo: 'leyendo',
        texto: 'Lo estoy leyendo: te digo lo que entiendo para que lo confirmes.',
      });
  }
  return out;
}

/** Lo que cambiar una respuesta ya dada rehace (para «Qué cambia»); null si no hace falta mirarlo. */
export function cambioDeRespuesta(pregunta, accion) {
  if (!pregunta || pregunta.estado !== 'hecha' || !accion) return null;
  switch (accion.tipo) {
    case 'precio':
      return { decisiones: { precio: { lote: accion.lote } } };
    case 'automatico':
      return { decisiones: { automaticos: true } };
    case 'enfoque':
      return { decisiones: { enfoque: true } };
    case 'dato_anexo':
      return { decisiones: { datos_anexo: [accion.dato] } };
    case 'lotes':
      return { lotes: accion.lotes };
    case 'persona':
      return { decisiones: { equipo: [{ persona_id: accion.persona_id, sale: false }] } };
    default:
      return null;
  }
}

/** «4 de 8» y el ancho de la barra. */
export function progreso({ total, hechas }) {
  return { texto: `${hechas} de ${total}`, porcentaje: total ? Math.round((hechas / total) * 100) : 0 };
}

/** Lo que enseña cada documento del plan por sobres: «Se generará» o «Generado». */
export const estadoDocumento = (d) =>
  d.generado ? { texto: 'Generado', tono: 'ok' } : { texto: 'Se generará', tono: 'neutro' };

const TONO = { ok: 'ok', riesgo: 'riesgo', impide: 'impide', neutro: 'neutro' };
export const tonoOpcion = (o) => (o.hermes ? 'hermes' : (TONO[o.tono] ?? 'neutro'));

/** El texto de ayuda de la caja de texto, según lo que haga el texto libre de la pregunta. */
export function ayudaTexto(p) {
  if (!p?.libre) return null;
  if (p.seccion === 'precio') return 'Escribe el importe sin impuestos («29.280») o la baja («8,5 % de baja»).';
  if (p.seccion === 'lotes' || p.clave === 'dato_anexo:orden_lotes') return 'Escribe los lotes («1 y 3»).';
  if (p.seccion === 'enfoque') return 'Escribe las indicaciones para la memoria.';
  return 'Escribe tu respuesta: Hermes la lee y te dice lo que entiende para que lo confirmes.';
}
