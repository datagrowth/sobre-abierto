// Dónde vive cada cosa en la navegación de la interfaz: sin React, con tests.

// Las ofertas nuestras (la estamos preparando o ya se presentó) cuelgan del Pipeline; el resto
// (por revisar, nuevas, descartadas), de Oportunidades.
const DEL_PIPELINE = new Set(['en_preparacion', 'presentada', 'ganada', 'perdida']);

/** Las migas y el «volver» de una ficha: { seccion, vista, texto }. Sin ficha aún, el Pipeline. */
export function seccionDeLicitacion(f) {
  if (!f || DEL_PIPELINE.has(f.estado)) return { seccion: 'pipeline', vista: null, texto: 'Pipeline' };
  return { seccion: 'oportunidades', vista: null, texto: 'Oportunidades' };
}

/**
 * Las cuentas de la barra lateral desde las del servidor (por dominio): lo de Licitaciones que
 * espera a una persona va al Pipeline; Equipo y Biblioteca, igual.
 */
export function cuentasDeNavegacion(cuentas = {}) {
  const { licitaciones = 0, ...resto } = cuentas;
  return { ...resto, pipeline: licitaciones };
}

/** Lo mismo con los avisos de debajo del nombre. */
export function avisosDeNavegacion(avisos = {}) {
  const { licitaciones = null, ...resto } = avisos;
  return licitaciones ? { ...resto, pipeline: licitaciones } : resto;
}
