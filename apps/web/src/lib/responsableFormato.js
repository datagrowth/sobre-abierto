// El responsable de una oferta, sin React para probarlo: las opciones del selector y si
// una ficha lo enseña (solo las ofertas del Pipeline).

const CON_OFERTA = new Set(['en_preparacion', 'presentada', 'ganada', 'perdida']);

/** Si la ficha enseña quién la lleva: las del Pipeline. */
export const conResponsable = (f) => CON_OFERTA.has(f?.estado);

/**
 * «Sin responsable» y el equipo activo. Quien la lleva sale aunque ya no esté en la lista (de baja
 * entre dos lecturas): si no, el selector enseñaría a otra persona.
 */
export function opcionesResponsable(companeros = [], actual = null) {
  const lista = actual && !companeros.some((c) => c.id === actual.id) ? [...companeros, actual] : companeros;
  return [{ valor: '', texto: 'Sin responsable' }, ...lista.map((c) => ({ valor: String(c.id), texto: c.nombre }))];
}
