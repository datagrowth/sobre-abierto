// Una ruta nueva que no pidió la web (Atrás o Adelante del navegador, Alt+←, un enlace «#…» o la
// barra de direcciones) también puede dejar atrás cambios sin guardar de las comprobaciones: lo
// que navega por la web ya preguntó (salirCon) y marca su destino como aceptado. Sin React.

/**
 * 'aceptar' si el hash es el ya aceptado o no hay comprobaciones montadas que puedan tener cambios; 'preguntar' si
 * hay que volver a la ruta de antes y preguntar (la guardia repite luego la navegación pedida).
 */
export function decidirHash({ nuevo, aceptado, conGuardia }) {
  return nuevo === aceptado || !conGuardia ? 'aceptar' : 'preguntar';
}
