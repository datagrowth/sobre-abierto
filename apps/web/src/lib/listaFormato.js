// Por qué el proceso automático no saca adelante una oportunidad (pestaña «Errores» de
// Oportunidades y aviso de la ficha), sin React y con tests.

const ERRORES_PROCESO = {
  pliegos_error: 'No se pudieron bajar los pliegos',
  pliegos_ilegibles: 'La Biblioteca no puede leer los pliegos (escaneados o dañados)',
  ficha_fallida: 'Hermes no pudo hacer la ficha tras tres rondas',
};

/**
 * El error de procesamiento de una oportunidad: { texto, detalle, reintentar } o null. Unos
 * pliegos ilegibles no se arreglan pidiéndolos otra vez: se sube uno legible o se descarta.
 */
export function errorDeProceso(e) {
  if (!e?.codigo) return null;
  return {
    texto: ERRORES_PROCESO[e.codigo] ?? 'Error de procesamiento',
    detalle: e.detalle ?? null,
    reintentar: e.codigo !== 'pliegos_ilegibles',
  };
}
