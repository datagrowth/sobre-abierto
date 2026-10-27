// Cliente de /api/plataforma: lo del núcleo que comparten todos los dominios, como el perfil de la empresa.
import { json, request } from './apiCliente';

export const plataformaApi = {
  empresa: () => request('/api/plataforma/empresa'),
  guardarEmpresa: (perfil) => request('/api/plataforma/empresa', json('PUT', perfil)),
  // Costes internos (Ajustes › Empresa): solo la web los lee; nunca llegan a un agente.
  getCostes: () => request('/api/plataforma/empresa/costes'),
  putCostes: (perfil) => request('/api/plataforma/empresa/costes', json('PUT', perfil)),
  cerrarPropuestaEmpresa: () => request('/api/plataforma/empresa/propuesta', { method: 'DELETE' }),
  // Ajustes › Marca: nombre, colores y logo de la instalación (la lee cualquiera; la cambia un admin).
  marca: () => request('/api/plataforma/marca'),
  guardarMarca: (marca) => request('/api/plataforma/marca', json('PUT', marca)),
  subirLogo: (archivo) => {
    const form = new FormData();
    form.append('archivo', archivo, archivo.name);
    return request('/api/plataforma/marca/logo', { method: 'PUT', body: form });
  },
  quitarLogo: () => request('/api/plataforma/marca/logo', { method: 'DELETE' }),
  // Lo que vence, lo pendiente de aprobar y lo nuevo desde `desde` (ISO; sin él, 24 h).
  // Lo que la plataforma hace sola y las tareas de cron de cada perfil de Hermes.
  programado: () => request('/api/plataforma/programado'),
  // La vista previa del resumen semanal, para abrirla en otra pestaña.
  urlPreviaResumen: '/api/plataforma/avisos/resumen/previa',
  hoy: () => request('/api/plataforma/hoy'),
  // Ajustes › Hermes: trabajos por oferta, fallos de 7 días y lo que lleva horas en cola sin salir.
  // La pastilla «Hermes»: por dominio, lo que corre (con su nombre y el título), lo que espera y los fallos.
  colaResumen: () => request('/api/plataforma/cola/resumen'),
  trabajosEstado: () => request('/api/plataforma/trabajos/estado'),
  cancelarTrabajo: (id) => request(`/api/plataforma/trabajos/${encodeURIComponent(id)}/cancelar`, { method: 'POST' }),
  // El resumen semanal por email (Ajustes › Avisos): leerlo cualquiera; cambiarlo y probarlo, un admin.
  avisosConfig: () => request('/api/plataforma/avisos/config'),
  guardarAvisosConfig: (config) => request('/api/plataforma/avisos/config', json('PUT', config)),
  probarResumen: () => request('/api/plataforma/avisos/resumen/prueba', { method: 'POST' }),
  // Las personas activas del equipo, sin email: para elegir responsable y mencionar.
  companeros: () => request('/api/plataforma/companeros'),
  // Comentarios con menciones: los de un recurso de un dominio, publicar y dar por resuelto.
  comentarios: (dominio, recurso) =>
    request(`/api/plataforma/comentarios?${new URLSearchParams({ dominio, recurso })}`),
  comentar: (comentario) => request('/api/plataforma/comentarios', json('POST', comentario)),
  resolverComentario: (id, resuelto) =>
    request(`/api/plataforma/comentarios/${encodeURIComponent(id)}`, json('PATCH', { resuelto })),
  // Las menciones sin leer de quien entra y marcarlas leídas (las de esos comentarios o, sin lista, todas).
  menciones: () => request('/api/plataforma/yo/menciones'),
  leerMenciones: (comentarios) =>
    request('/api/plataforma/yo/menciones/leidas', json('POST', comentarios ? { comentarios } : {})),
  // Ajustes › Integraciones, solo admin: los tokens de la API de lectura (el token, solo al crearlo) y el MCP.
  tokensApi: () => request('/api/plataforma/integraciones/tokens'),
  crearTokenApi: (nombre) => request('/api/plataforma/integraciones/tokens', json('POST', { nombre })),
  revocarTokenApi: (id) =>
    request(`/api/plataforma/integraciones/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  estadoMcp: () => request('/api/plataforma/integraciones/mcp'),
};
