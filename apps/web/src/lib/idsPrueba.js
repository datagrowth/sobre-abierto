// data-testid estables de las comprobaciones y la Mesa: los specs de Playwright y la
// telemetría los leen, así que se cambian aquí y en ningún otro sitio.
export const VEREDICTO = 'veredicto';
export const bloqueo = (clave) => `bloqueo-${clave}`;
export const BLOQUEO_ACCION = 'bloqueo-accion';
export const precioLote = (id) => `precio-lote-${id}`;
export const SIGUIENTE_TAREA = 'siguiente-tarea';
export const IMPACTO = 'impacto';
export const REGISTRAR_PAQUETE = 'registrar-paquete';
const AVISO_VERSION = 'aviso-version';
export const cajon = (n) => `cajon-${n}`;
export const CONFIRMACION = 'confirmacion';
export const CONFIRMACION_SI = 'confirmacion-si';
export const CONFIRMACION_NO = 'confirmacion-no';
// Atributo de los botones que escriben (data-escribe="true"): un spec comprueba que en solo
// lectura no queda ninguno.
const ATRIBUTO_ESCRIBE = 'data-escribe';
