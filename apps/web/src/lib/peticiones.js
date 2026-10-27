// Turnos de petición (sin React, con tests). Cuando los mismos datos se piden varias veces
// seguidas (al escribir en la búsqueda, cambiar un filtro o llegar un evento), solo vale la
// última respuesta: una anterior que llegue tarde pisaría la buena con datos viejos.
export function crearTurnos() {
  let ultimo = 0;
  /** Abre un turno; devuelve si sigue siendo el último cuando llega su respuesta. */
  return function nuevo() {
    const turno = ++ultimo;
    return () => turno === ultimo;
  };
}

// Los avisos del servidor que la persona puede confirmar para seguir.
const AVISOS_CONFIRMABLES = new Set(['plazo_justo', 'via_alternativa']);

/**
 * Un trabajo de Hermes pedido a mano que el servidor frena con un aviso confirmable («plazo_justo»
 * cerca del plazo; «via_alternativa» al preparar la vía alternativa de un requisito abierto): se
 * enseña su mensaje y, si la persona lo confirma, se pide otra vez con la confirmación. `pedir(confirmado)` hace la petición.
 * Si no lo confirma, el aviso sigue como error (la vista lo enseña).
 */
export async function pedirConPlazo(pedir, confirmar = (m) => globalThis.confirm?.(m) ?? false) {
  try {
    return await pedir(false);
  } catch (e) {
    if (!AVISOS_CONFIRMABLES.has(e?.code) || !confirmar(`${e.message}\n\n¿Pedirlo igualmente?`)) throw e;
    return pedir(true);
  }
}
