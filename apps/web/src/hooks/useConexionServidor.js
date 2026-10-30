// Hook que abre la conexión Socket.io con el servidor y vuelca sus eventos en los stores de la web.
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import useEstadoFlujo from '../estado/flujo';
import useEstadoActividad from '../estado/actividad';
import { avisarSiNueva } from '../lib/versionWeb';
import { avisarSiSinSesion } from '../lib/sesion';

// En desarrollo, proxy de Vite; en producción Socket.io comparte origen con la web.
const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3110';

// Un solo socket para toda la app, que sobrevive al recargado en caliente.
let socket = null;

let ultimaComprobacion = 0;

function comprobarSesion() {
  if (Date.now() - ultimaComprobacion < 10_000) return;
  ultimaComprobacion = Date.now();
  avisarSiSinSesion(401);
}

function connect() {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    reconnectionAttempts: Infinity,
    timeout: 5000,
  });

  const flow = useEstadoFlujo.getState;
  const activity = useEstadoActividad.getState;

  // La primera conexión no es una reconexión: las vistas acaban de cargar sus datos.
  let conectadoAntes = false;
  socket.on('connect', () => {
    flow().setConnected(true);
    // Lo que pasó con el socket caído no llegó como evento: las vistas abiertas se recargan.
    if (conectadoAntes) window.dispatchEvent(new CustomEvent('plataforma-reconectado'));
    conectadoAntes = true;
    flow().loadSessions();
    // Tras una reconexión se recupera lo que pasó mientras tanto.
    const sessionId = activity().sessionId;
    if (sessionId) activity().loadHistory(sessionId);
  });
  socket.on('disconnect', () => flow().setConnected(false));
  // El handshake rechazado no trae el 401 al cliente: GuardiaAcceso pregunta por la sesión (como
  // mucho cada 10 s, el socket reintenta cada 3) y, si caducó, la app vuelve al login.
  socket.on('connect_error', comprobarSesion);

  // Tras un despliegue el socket se reconecta solo y el servidor dice qué versión sirve.
  socket.on('version_web', (version) => avisarSiNueva(version));
  socket.on('hermes_sessions', (sessions) => flow().setSessions(sessions));

  // activityStore descarta lo que no es de la sesión que se está viendo.
  socket.on('activity', (item) => {
    activity().applyActivity(item);
    if (item?.sessionId) flow().touchSession(item.sessionId, item.at);
  });
  socket.on('processing_start', ({ sessionId, instruction } = {}) => {
    activity().setExecuting(sessionId, true, instruction || undefined);
  });
  socket.on('processing_stop', ({ sessionId } = {}) => {
    activity().setExecuting(sessionId, false);
  });
  // Eventos de la plataforma (criba hecha, licitación que cambia de estado…): los
  // paneles que los necesitan escuchan el evento «plataforma» de window.
  socket.on('plataforma', (evento) => {
    window.dispatchEvent(new CustomEvent('plataforma', { detail: evento }));
  });

  window.addEventListener('beforeunload', () => {
    socket?.disconnect();
    socket = null;
  });
  return socket;
}

export default function useConexionServidor() {
  useEffect(() => {
    connect();
  }, []);
}
