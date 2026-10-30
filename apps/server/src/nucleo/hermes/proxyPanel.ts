// Sirve el dashboard oficial de Hermes bajo /hermes-panel/: el servidor hace de proxy e inicia sesión en Hermes
// por el usuario, que solo se autentica una vez, contra la plataforma.
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { createProxyServer } from 'httpxy';
import * as hermesClient from './clienteHermes.js';
import * as autenticacion from '../autenticacion.js';
import { endurecerRespuestaDelPanel, origenEsPropio } from '../seguridadWeb.js';
import { logger } from '../log.js';

const log = logger('panel-hermes');

// Hermes admite ir detrás de un proxy con subruta (X-Forwarded-Prefix) y reescribe sus assets, su
// router y sus WebSockets. Se quitan las X-Forwarded-* de Traefik para que Hermes vea HTTP simple y
// use siempre los mismos nombres de cookie; sus Set-Cookie (rotación de la sesión) se guardan en el
// tarro compartido y no llegan al navegador; y GET /hermes-panel/login (adonde Hermes manda al
// caducar la sesión) no llega a Hermes: el servidor vuelve a iniciar sesión y redirige a la página pedida.
// Se usa httpxy directamente: http-proxy-middleware solo añadía el filtro de rutas con micromatch
// (braces, vulnerable y sin versión corregida), y el filtro y la reescritura ya se hacen aquí.

export const PREFIX = '/hermes-panel';
const DROPPED_HEADERS = [
  'authorization',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-for',
  'x-forwarded-server',
  'x-real-ip',
  'forwarded',
];

const ORIGEN_HERMES = new URL(hermesClient.HERMES_BASE).origin;

function prepareUpstream(proxyReq: ClientRequest): void {
  for (const h of DROPPED_HEADERS) proxyReq.removeHeader(h);
  proxyReq.setHeader('x-forwarded-prefix', PREFIX);
  // Hermes (desde la v0.17) rechaza el WebSocket del chat si el Origin no es su propia
  // dirección («pty refused: origin_mismatch»): detrás de un proxy nunca lo es. El servidor ya
  // comprobó que el origen es el suyo (handleUpgrade y exigirMismoOrigen), así que hacia
  // Hermes va el de Hermes.
  if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', ORIGEN_HERMES);
  const cookie = hermesClient.getSessionCookie();
  if (cookie) proxyReq.setHeader('cookie', cookie);
  else proxyReq.removeHeader('cookie');
}

const proxy = createProxyServer({ target: hermesClient.HERMES_BASE, changeOrigin: true, ws: true });
proxy.on('proxyReq', (proxyReq) => prepareUpstream(proxyReq));
proxy.on('proxyReqWs', (proxyReq) => prepareUpstream(proxyReq));
// Se emite antes de copiar las cabeceras a la respuesta: quitar Set-Cookie aquí basta.
proxy.on('proxyRes', (proxyRes) => {
  const setCookie = proxyRes.headers['set-cookie'];
  if (setCookie) {
    hermesClient.absorbSetCookie(setCookie);
    delete proxyRes.headers['set-cookie'];
  }
  endurecerRespuestaDelPanel(proxyRes.headers);
  if (proxyRes.statusCode === 401) void hermesClient.refreshToken();
});
proxy.on('error', (err, _req, res) => {
  log.error('proxy a Hermes falló', { error: err.message });
  if (res && 'writeHead' in res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('El dashboard de Hermes no responde.');
  } else {
    res?.destroy();
  }
});

// /hermes-panel/x?y → /x?y: Hermes sirve en la raíz y se entera de la subruta por X-Forwarded-Prefix.
function sinPrefijo(url: string | undefined): string {
  return (url ?? '').slice(PREFIX.length) || '/';
}

function safeNext(raw: unknown): string {
  const next = typeof raw === 'string' ? raw : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith(PREFIX) ? next : '/';
}

async function relogin(req: Request, res: Response): Promise<void> {
  await hermesClient.refreshToken();
  if (hermesClient.loginMode && !hermesClient.getSessionCookie()) {
    res
      .status(502)
      .type('text')
      .send('El monitor no pudo iniciar sesión en Hermes: revisa HERMES_DASHBOARD_BASIC_AUTH_USERNAME / PASSWORD.');
    return;
  }
  res.redirect(PREFIX + safeNext(req.query.next));
}

export async function middleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = req.path;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next();
  if (path === PREFIX) return res.redirect(`${PREFIX}/`);
  if (req.method === 'GET' && path === `${PREFIX}/login`) return relogin(req, res);
  await hermesClient.ensureSession();
  req.url = sinPrefijo(req.originalUrl);
  // Los fallos de conexión los atiende el evento «error» (502); esto solo evita una promesa suelta.
  proxy.web(req, res).catch(() => undefined);
}

/**
 * Piezas del dashboard que Hermes pide sin la subruta. Su web carga partes bajo demanda (p. ej.
 * el terminal del chat, `xterm-*.js`) con rutas absolutas `/assets/…` que ignoran
 * X-Forwarded-Prefix: llegaban a la web del servidor, que respondía con su index.html, y el chat
 * se quedaba en negro. Se monta después de los archivos de la web del servidor: solo llega aquí
 * lo que el servidor no tiene, y se pide a Hermes con la sesión del servidor.
 */
export async function assetsDelPanel(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== 'GET' || !req.path.startsWith('/assets/')) return next();
  if (!autenticacion.allows(req)) {
    res.status(401).json({ error: 'Sesión requerida' });
    return;
  }
  // Solo el admin ve el panel; y sin «..» ni su forma codificada para no salir de /assets/.
  if (!autenticacion.permiteRol(req, 'admin')) {
    res.status(403).json({ error: 'Sin permiso' });
    return;
  }
  if (/\.\.|%2e|%2f|%5c|\\/i.test(req.url)) {
    res.status(400).json({ error: 'Ruta no válida' });
    return;
  }
  await hermesClient.ensureSession();
  proxy.web(req, res).catch(() => undefined);
}

// Los upgrades no pasan por Express: se comprueban aquí el origen (un WebSocket no pasa por
// CORS y la cookie Lax viaja desde cualquier subdominio) y la sesión del servidor.
// Una cabecera para el log (sin cookies ni nada que identifique sesiones).
const cabecera = (req: IncomingMessage, n: string) => String(req.headers[n] ?? '').slice(0, 200) || null;

export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  origenes: readonly string[] = [],
): boolean {
  if (!req.url?.startsWith(`${PREFIX}/`)) return false;
  if (!origenEsPropio(req, origenes)) {
    // Si un proxy delante reescribe el Host, todo WebSocket del panel caería aquí: que se vea.
    log.warn('websocket del panel rechazado por su origen', {
      origen: cabecera(req, 'origin'),
      host: cabecera(req, 'host'),
    });
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return true;
  }
  if (!autenticacion.allows(req)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return true;
  }
  // La Consola es una terminal con las claves de Hermes: solo un admin (nucleo/permisos.ts).
  if (!autenticacion.permiteRol(req, 'admin')) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return true;
  }
  // La sesión con Hermes se comprueba (y se renueva si caducó) antes del upgrade: si no, el
  // WebSocket llega a Hermes con una cookie que ya no vale y el chat queda en negro.
  hermesClient
    .ensureSession()
    .then(() => hermesClient.comprobarSesion())
    .then(() => {
      req.url = sinPrefijo(req.url);
      return proxy.ws(req, socket as Socket, {}, head);
    })
    .catch((err: unknown) => {
      log.warn('websocket del panel no abierto', {
        error: err instanceof Error ? err.message.slice(0, 160) : 'desconocido',
      });
      socket.destroy();
    });
  return true;
}
