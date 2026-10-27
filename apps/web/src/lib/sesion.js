// Sesión del monitor caducada con la app abierta. Sin esto cada panel enseñaba «Sesión
// requerida» y solo recargando volvía la pantalla de login. Viaja como evento de window
// para que lo recoja GuardiaAcceso, igual que el aviso de versión nueva.
export const EVENTO_SESION_CADUCADA = 'sesion-caducada';

/** Un 401 de la API o del Socket.io es la sesión del monitor (los agentes no usan la web). */
export const esSinSesion = (status) => status === 401;

/** Si la respuesta dice que no hay sesión, avisa para volver al login. Devuelve si avisó. */
export function avisarSiSinSesion(status) {
  if (typeof window === 'undefined' || !esSinSesion(status)) return false;
  window.dispatchEvent(new CustomEvent(EVENTO_SESION_CADUCADA));
  return true;
}

/** Lo que dice /auth/session: con login activado y sin sesión válida, hay que volver a entrar. */
export const debeVolverAEntrar = (s) => Boolean(s && s.enabled && !s.authenticated);
