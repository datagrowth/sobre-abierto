// Pestañas de vistas (sin React, con tests). La vista abierta puede no ser una pestaña
// (Ajustes se abre desde un botón de la cabecera): aun así el teclado tiene que poder
// entrar en la lista y el desplegable del móvil no puede decir que se ve otra.

/** Clave de la pestaña que recibe el foco con Tab: la abierta o, si no es ninguna, la primera. */
export function pestanaEnfocable(vistas, vista) {
  return vistas.some((v) => v.key === vista) ? vista : (vistas[0]?.key ?? null);
}

const FUERA_DE_LAS_PESTANAS = { ajustes: 'Ajustes' };

/** Opción de más para el desplegable cuando la vista abierta no es una pestaña, o null. */
export function opcionFuera(vistas, vista) {
  if (vistas.some((v) => v.key === vista)) return null;
  return { key: vista ?? '', label: FUERA_DE_LAS_PESTANAS[vista] ?? '' };
}
