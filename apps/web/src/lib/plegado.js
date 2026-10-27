// Cajas plegables que recuerdan, en este navegador, si se dejaron plegadas o desplegadas.

/** Clave de localStorage de una caja: «dg.plegado.oferta.guion». */
export function clavePlegado(nombre) {
  return `dg.plegado.${nombre}`;
}

/** Lo guardado («1» plegada, «0» desplegada) o, sin nada guardado, como venga por defecto. */
export function estadoPlegado(guardado, porDefecto = false) {
  if (guardado === '1') return true;
  if (guardado === '0') return false;
  return porDefecto;
}
