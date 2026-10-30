// «Subir versión editada» con una memoria hecha fuera (un PDF, o un Word sin los títulos del
// guion): qué admite, cuándo sugerir subirla como presentada y cómo se abre ese panel
// (SubirMemoriaPresentada.jsx) desde el formulario de subida (SubirVersion.jsx).

export const ACEPTA_SUBIDA =
  '.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// El enlace no puede ser un #ancla: la web navega por el hash (useRuta.js).
export const EVENTO_ABRIR_PRESENTADA = 'abrir-memoria-presentada';

/** Con la oferta presentada o el plazo vencido, lo que se sube suele ser lo que se entregó. */
export function sugerirPresentada(o) {
  return Boolean(o?.presentada_o_vencida);
}

/** Abre el panel «Subir la memoria presentada» de la licitación id (lote: el de ese lote; null, la común). */
export function abrirPresentada(id, lote = null) {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_PRESENTADA, { detail: { id, lote } }));
}

/** ¿El aviso de abrirPresentada es para el panel de esta licitación y este lote? */
export function esAbrirPresentada(detalle, id, lote = null) {
  return detalle?.id === id && (detalle.lote ?? null) === (lote ?? null);
}

/** ¿Se ofrece «Pedir cambios»? No en una de ensayo ni en una subida a mano (sin progreso: el servidor no la rehace). */
export function puedePedirCambios(m) {
  return Boolean(m && !m.ensayo && !m.sin_repartir && m.progreso && m.estado === 'ensamblada');
}
