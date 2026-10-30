// Punto de entrada del servidor: monta Express y Socket.io, registra las rutas de la API y arranca servicios.
import './bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { sessionsRouter } from './nucleo/hermes/sesionesRuta.js';
import { driveRouter } from './nucleo/driveRuta.js';
import * as watcher from './nucleo/hermes/observador.js';
import * as profileLogTailer from './nucleo/hermes/seguimientoLogs.js';
import * as autenticacion from './nucleo/autenticacion.js';
import { SALA_ACTIVIDAD } from './nucleo/hermes/adaptadorEventos.js';
import * as hermesPanelProxy from './nucleo/hermes/proxyPanel.js';
import * as seguridadWeb from './nucleo/seguridadWeb.js';
import { crearAplicacionBiblioteca } from './biblioteca/aplicacion.js';
import { crearRutasAgente } from './biblioteca/rutas/agente.js';
import { iniciarIndexador } from './biblioteca/motor/documentos/servicioIndice.js';
import { obtenerRutaBiblioteca, descartarAjustesObsoletos } from './biblioteca/motor/configuracion.js';
import { disponible as conversorDisponible } from './nucleo/documentos/libreoffice.js';
import { anotarHuellasMcp, iniciarPlataforma } from './nucleo/index.js';
import { nucleo } from './nucleo/contexto.js';
import { registrarEstado } from './nucleo/estado.js';
import { validarConfig } from './nucleo/config.js';
import { autenticarAgente, requiere } from './nucleo/agentes/autenticacionAgentes.js';
import { autorizar } from './nucleo/permisos.js';
import { rutaCalendario } from './nucleo/calendarioRuta.js';
import { leerMarca, paginaConMarca, rutaConfigWeb, rutaLogo } from './nucleo/marca.js';
import { rutasApiLectura } from './nucleo/apiLectura.js';
import { routerMcp } from './nucleo/mcp/servidor.js';
import { rutasPlataforma } from './nucleo/rutas.js';
import { rutasColaboradores } from './nucleo/colaboradores/rutas.js';
import { iniciarLicitaciones } from './dominios/licitaciones/index.js';
import { rutasLicitaciones } from './dominios/licitaciones/rutas.js';
import { versionWeb, CABECERA_VERSION_WEB, exigirVersionWeb, rutaVersion } from './nucleo/versionWeb.js';
import { anotarVersionServidor, huellaCodigo, huellaVersion } from './nucleo/versionServidor.js';
import { ajustarKeepAlive, comprimir } from './nucleo/http.js';
import { logger } from './nucleo/log.js';
import { errorMessage } from './nucleo/result.js';

const log = logger('servidor');

const HERE = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
ajustarKeepAlive(server);

// La web y la API comparten origen (también en desarrollo, por el proxy de Vite): sin CORS.
// Solo si FRONTEND_URL nombra orígenes concretos se abren a ellos; con «*» ya no se refleja
// cualquier origen. Un valor inválido para el arranque más abajo.
const origenes = seguridadWeb.origenesPermitidos(process.env.FRONTEND_URL);
const permitidos = origenes.data ?? [];
const io = new Server(server, {
  ...(permitidos.length ? { cors: { origin: [...permitidos], methods: ['GET'] } } : {}),
  // Los upgrades de /hermes-panel/ los atiende hermesPanelProxy.
  destroyUpgrade: false,
});

app.disable('x-powered-by');
app.use(seguridadWeb.cabecerasSeguridad([hermesPanelProxy.PREFIX]));
if (permitidos.length) app.use(cors({ origin: [...permitidos], exposedHeaders: [CABECERA_VERSION_WEB] }));

// Versión de la web desplegada (hash del bundle): las pestañas abiertas antes del
// despliegue la comparan con la suya y avisan de que recarguen. Sin dist no hay versión.
// WEB_DIST_DIR permite a las pruebas e2e simular un despliegue sirviendo otro build.
const FRONTEND_DIST = process.env.WEB_DIST_DIR ?? path.join(HERE, '..', '..', 'web', 'dist');
const version = versionWeb(FRONTEND_DIST);
if (version.error) log.warn('no se pudo leer la versión de la web', { error: version.error.message });
const versionActual = version.data;
if (versionActual)
  app.use((_req, res, next) => {
    res.setHeader(CABECERA_VERSION_WEB, versionActual);
    next();
  });

// Healthcheck del contenedor: sin auth y sin datos.
app.get('/healthz', (_req, res) => {
  res.type('text').send('ok');
});
// El calendario ICS de una persona: sin sesión, con su token, y solo con datos públicos.
app.get('/cal/:archivo', rutaCalendario);
// La marca de la instalación y su zona horaria: la pantalla de acceso ya la enseña, sin sesión.
app.get('/api/config', rutaConfigWeb);
app.get('/api/marca/logo', rutaLogo);
// Comprimido solo lo que es JSON o estáticos: /mcp responde en streaming (SSE) y la compresión lo
// retendría, y Socket.io ya comprime sus mensajes.
app.use(['/api', '/hermes-vault', '/assets'], comprimir());

// CSRF: todo lo que cambia estado exige el mismo origen, salvo las rutas de agentes (Bearer).
app.use(seguridadWeb.exigirMismoOrigen(permitidos));
app.use('/auth', autenticacion.router);
// Los agentes (Hermes, sus perfiles, Claude Code) entran con su token, no con la
// sesión del navegador: van antes del login del servidor.
const agentesDir = () => nucleo().config.agentesDir;
app.use('/mcp', routerMcp(agentesDir));
app.use('/hermes-vault/agent', autenticarAgente(agentesDir), requiere('biblioteca', 'leer'), crearRutasAgente());
// La API de lectura para BI: con su token de integración, sin sesión. Responde a todo lo
// de /api/v1 (también el 404), así que nunca llega al login de la web de abajo.
app.use('/api/v1', rutasApiLectura());
app.use(['/api', '/hermes-vault', '/hermes-panel'], autenticacion.middleware);
// Rol de la persona en cada ruta, con denegación por defecto (nucleo/permisos.ts).
app.use(['/api', '/hermes-vault', '/hermes-panel'], autorizar);
app.use('/api', autenticacion.renovarSesion);
// Tras el login (un usuario sin sesión recibe 401 antes que 409); /mcp y /hermes-vault/agent
// se montan antes y nunca se comprueban.
app.use('/api/version', rutaVersion(versionActual));
app.use(['/api', '/hermes-vault'], exigirVersionWeb(versionActual));
io.engine.use(seguridadWeb.mismoOrigenEnSocket(permitidos));
io.engine.use(autenticacion.middleware);

app.use('/hermes-vault', crearAplicacionBiblioteca());
app.use(hermesPanelProxy.middleware);
server.on('upgrade', (req, socket, head) => {
  if (hermesPanelProxy.handleUpgrade(req, socket, head, permitidos)) return;
  if (!req.url?.startsWith('/socket.io/')) socket.destroy();
});

app.use('/api/sessions', sessionsRouter);
app.use('/api/drive', driveRouter);
app.use('/api/plataforma', rutasPlataforma());
app.use('/api/colaboradores', rutasColaboradores());
app.use('/api/licitaciones', rutasLicitaciones());

// Serve frontend build (single-port setup so Socket.io shares origin)
app.use(
  express.static(FRONTEND_DIST, {
    // index.html lo sirve la ruta de abajo, con la marca de la instalación.
    index: false,
    // Lo de assets/ lleva el hash en el nombre: un despliegue cambia el nombre, así que el
    // navegador lo guarda un año sin volver a preguntar. index.html se pide en cada carga.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      } else if (path.basename(path.dirname(filePath)) === 'assets') {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);
// Lo que pide el dashboard de Hermes en /assets/ sin su subruta (y no es de esta web).
app.use(hermesPanelProxy.assetsDelPanel);
// index.html se lee una vez (solo cambia al desplegar, que reinicia el proceso); el nombre y los
// colores de la instalación se ponen en cada carga, así un cambio en Ajustes › Marca sale al recargar.
let paginaWeb: string | null = null;
app.get(/^\/(?!api|socket\.io|auth\/|mcp|cal\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  const archivo = path.join(FRONTEND_DIST, 'index.html');
  if (paginaWeb === null && fs.existsSync(archivo)) paginaWeb = fs.readFileSync(archivo, 'utf8');
  if (paginaWeb === null) {
    res.status(404).end();
    return;
  }
  res.type('html').send(paginaConMarca(paginaWeb, leerMarca(nucleo().db)));
});

io.on('connection', (socket) => {
  log.debug('cliente web conectado', { socket: socket.id });
  if (versionActual) socket.emit('version_web', versionActual);
  // La actividad de Hermes solo la ven editores y admins; un lector recibe el resto de eventos.
  if (autenticacion.permiteRol(socket.request, 'editor')) {
    void socket.join(SALA_ACTIVIDAD);
    const s = watcher.getState();
    if (s.sessions.length) socket.emit('hermes_sessions', s.sessions);
  }

  socket.on('disconnect', () => log.debug('cliente web desconectado', { socket: socket.id }));
});

process.on('uncaughtException', (err) => log.error('excepción no capturada', { error: err.message }));
process.on('unhandledRejection', (reason) =>
  log.error('promesa rechazada sin capturar', { error: errorMessage(reason) }),
);
// Como PID 1 en Docker, Node ignora SIGTERM si nadie lo escucha y `docker stop`
// esperaría 10 s para matarlo.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

const PORT = Number(process.env.APP_PORT || 3110);

// Versión de este arranque (código del servidor + web): si es nueva, los fallos de antes ya no
// frenan la cola (un arreglo desplegado no espera 6 h). Va antes de la primera vuelta de la cola.
function anotarVersion(): void {
  const codigo = huellaCodigo(HERE);
  if (codigo.error) {
    log.warn('sin huella del código: el freno de la cola no se levanta al desplegar', { error: codigo.error.message });
    return;
  }
  const v = anotarVersionServidor(nucleo().db, huellaVersion(codigo.data, versionActual));
  if (v.nueva)
    log.info('versión nueva del monitor: el freno de la cola solo cuenta los fallos desde ahora', {
      version: v.huella,
      anterior: v.anterior,
    });
}

// Si el puerto ya está ocupado, salir en vez de quedar como proceso zombie sin
// escuchar; Docker (restart: unless-stopped) lo reintenta.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error('puerto ocupado por otra instancia: saliendo', { puerto: PORT });
    process.exit(1);
  }
  log.error('error del servidor HTTP', { error: err.message });
  process.exit(1);
});

// Sin HOST: '::' (dual-stack), para que en desarrollo responda también cuando
// 'localhost' resuelve a ::1. En Docker se fija HOST=0.0.0.0.
const HOST = process.env.HOST || '::';

// Con una config inválida se sale antes de escuchar: si no, el error saltaba dentro del
// arranque, el proceso seguía vivo sin plataforma y /healthz decía «ok». Al log van los
// nombres de las variables, no sus valores.
const config = validarConfig();
if (config.error) {
  log.error('configuración no válida: saliendo', { campos: config.error.message });
  process.exit(1);
}
if (origenes.error) {
  log.error('configuración no válida: saliendo', { campos: origenes.error.message });
  process.exit(1);
}
// En producción no se sirve un servidor sin login (daría la terminal de Hermes a cualquiera)
// ni con sesiones firmadas sin un secreto propio.
const acceso = autenticacion.validarAcceso();
if (acceso.error) {
  log.error('acceso al monitor mal configurado: saliendo', {
    motivo: acceso.error.code,
    variables: acceso.error.message,
  });
  process.exit(1);
}
if (!acceso.data.login)
  log.warn(
    'ATENCIÓN: monitor sin login (MONITOR_AUTH=off): cualquiera que llegue al puerto es administrador y usa la terminal de Hermes',
  );
// Fuera de producción se puede arrancar sin secreto propio: entonces cada reinicio cierra las sesiones.
if (acceso.data.login && !acceso.data.secreto)
  log.warn(
    'sesiones firmadas con un secreto aleatorio: cada reinicio las cierra; define MONITOR_SESSION_SECRET (openssl rand -hex 32)',
  );
// La huella va al log y no a Estado: Estado llega a los agentes (plataforma_estado).
if (acceso.data.login && acceso.data.secreto)
  log.info('sesiones firmadas con el secreto propio', { huella_secreto: autenticacion.huellaSecreto() });

server.listen(PORT, HOST, () => {
  log.info('servidor escuchando', {
    host: HOST,
    puerto: PORT,
    login: autenticacion.enabled,
    hermes: process.env.HERMES_BASE_URL || 'http://localhost:9119',
    boveda: obtenerRutaBiblioteca() ?? null,
  });
  watcher.initWatcher(io);
  watcher.startPolling(io);
  profileLogTailer.init(io);
  if (descartarAjustesObsoletos())
    log.info('quitada de la configuración de la Biblioteca la API key del antiguo chat, que ya no se usa');
  iniciarIndexador();
  // Sin LibreOffice el servidor funciona igual: los .doc no se leen y las memorias salen sin PDF.
  void conversorDisponible().then((c) =>
    log.info('conversor de documentos (LibreOffice)', { estado: c.estado, version: c.version }),
  );
  iniciarPlataforma(io, config.data);
  autenticacion.guardarRevocadasEn(nucleo().db);
  autenticacion
    .usarUsuariosDe(nucleo().db)
    .catch((err: unknown) => log.error('usuarios sin preparar', { error: errorMessage(err) }));
  anotarVersion();
  registrarEstado('acceso', autenticacion.estadoAcceso);
  iniciarLicitaciones();
  anotarHuellasMcp();
});
