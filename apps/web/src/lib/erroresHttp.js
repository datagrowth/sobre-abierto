// Qué decirle a la persona cuando el servidor falla sin dar un mensaje propio: qué pasó y qué hacer.
// El código HTTP se queda en el texto para que quien administra la instalación lo busque en el log.

/** El texto de un error HTTP sin cuerpo útil. */
export function mensajeSinCuerpo(status) {
  if (status === 403)
    return 'No tienes permiso para hacer esto (HTTP 403). Pide a un administrador que te cambie el rol.';
  if (status === 404) return 'Eso ya no existe (HTTP 404). Recarga la página: puede que alguien lo haya borrado.';
  if (status === 408 || status === 504)
    return `El servidor tardó demasiado en responder (HTTP ${status}). Inténtalo de nuevo en un minuto.`;
  if (status === 429) return 'Demasiadas peticiones seguidas (HTTP 429). Espera un minuto y vuelve a intentarlo.';
  if (status >= 500)
    return `El servidor tuvo un problema (HTTP ${status}). Inténtalo de nuevo; si se repite, avisa a quien administre la instalación.`;
  return `La petición no se pudo completar (HTTP ${status}). Recarga la página e inténtalo de nuevo.`;
}

/** Sin red o con el servidor caído, fetch falla antes de recibir nada. */
export const MENSAJE_SIN_CONEXION =
  'No hay conexión con el servidor. Comprueba tu red y recarga la página; si sigue igual, avisa a quien administre la instalación.';
