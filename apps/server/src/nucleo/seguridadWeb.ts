// Defensas web: mismo origen en lo que cambia estado y en los WebSockets, CORS y cabeceras de seguridad.
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { fail, ok, type Result } from './result.js';
import { logger } from './log.js';

const log = logger('seguridad-web');

type Siguiente = (err?: unknown) => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Siguiente) => void;

// El CORS solo se abre para una lista explícita.
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Los agentes entran con Bearer, sin cookie: no hay sesión que un tercero pueda aprovechar.
const RUTAS_DE_AGENTE = ['/mcp', '/hermes-vault/agent'];

// Ni un script ni una conexión de fuera: un XSS en un texto de pliego o de una nota no puede cargar
// código ajeno ni mandar datos a otro servidor. El estilo en línea es el tema de la instalación
// (paginaConMarca) y los estilos de React.
const CSP_MONITOR = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
// Lo mínimo para lo que no es una página del servidor: el panel de Hermes y los PDF (el visor
// de PDF de Chrome se trata como un plugin y object-src 'none' lo dejaría en blanco).
const CSP_MARCO = "frame-ancestors 'self'";

const OrigenHttp = z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin);

/**
 * FRONTEND_URL → orígenes permitidos además del propio. «*» o vacío = ninguno: la web y
 * la API comparten origen y no necesitan CORS. Admite varios separados por comas.
 */
export function origenesPermitidos(valor: string | undefined): Result<string[]> {
  const limpio = (valor ?? '').trim();
  if (!limpio || limpio === '*') return ok([]);
  const lista = z.array(OrigenHttp).safeParse(
    limpio
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return lista.success ? ok(lista.data) : fail('frontend_url_invalida', 'FRONTEND_URL');
}

function cabecera(req: IncomingMessage, nombre: string): string {
  const v = req.headers[nombre];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

function origenDe(valor: string): URL | null {
  try {
    const u = new URL(valor);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

// Host sin el puerto por defecto, como lo escribe el navegador en Origin.
function hostNormalizado(host: string): string {
  return host.toLowerCase().replace(/:(80|443)$/, '');
}

// Comprobar el origen hace falta aunque la cookie sea SameSite=Lax: cualquier subdominio del dominio
// de la empresa cuenta como «mismo sitio», así que el navegador mandaría la cookie en un POST o en un
// WebSocket abierto desde otra web de la empresa. El origen se compara con la cabecera Host, no con
// X-Forwarded-Host: Traefik y el proxy de Vite conservan el Host público, y no hay que fiarse de una
// cabecera que, desde la red interna, escribe quien quiera. Si algún proxy reescribiera el Host,
// FRONTEND_URL admite la lista de orígenes buenos.
/** La cabecera Origin es la del propio servidor (su Host) o una de las permitidas. */
export function origenEsPropio(req: IncomingMessage, permitidos: readonly string[]): boolean {
  const origen = origenDe(cabecera(req, 'origin'));
  if (!origen) return false;
  if (permitidos.includes(origen.origin)) return true;
  const host = cabecera(req, 'host');
  return host !== '' && hostNormalizado(origen.host) === hostNormalizado(host);
}

/**
 * Petición hecha desde la propia web. Los navegadores mandan Origin en todo lo que no es
 * GET/HEAD; si falta, vale Sec-Fetch-Site (same-origin, o none si la abrió el usuario).
 * Sin ninguna de las dos se rechaza: un cliente de verdad las manda.
 */
function peticionDelMismoOrigen(req: IncomingMessage, permitidos: readonly string[]): boolean {
  if (cabecera(req, 'origin')) return origenEsPropio(req, permitidos);
  const sitio = cabecera(req, 'sec-fetch-site');
  return sitio === 'same-origin' || sitio === 'none';
}

function rutaDeAgente(ruta: string): boolean {
  const r = ruta.toLowerCase();
  return RUTAS_DE_AGENTE.some((p) => r === p || r.startsWith(`${p}/`));
}

function rutaDe(req: IncomingMessage): string {
  return (req.url ?? '').split('?')[0] ?? '';
}

function rechazar(res: ServerResponse): void {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Origen no permitido' }));
}

/**
 * Para montar en la raíz de Express: todo método que cambia estado exige el mismo origen,
 * salvo las rutas de agentes con Bearer. Denegar por defecto cubre también las rutas nuevas.
 */
export function exigirMismoOrigen(permitidos: readonly string[]): Middleware {
  return (req, res, next) => {
    const ruta = rutaDe(req);
    if (METODOS_SEGUROS.has(req.method ?? '') || rutaDeAgente(ruta) || peticionDelMismoOrigen(req, permitidos))
      return next();
    log.warn('petición rechazada por su origen', { metodo: req.method, ruta, origen: cabecera(req, 'origin') || null });
    rechazar(res);
  };
}

/**
 * Para io.engine.use (se aplica también a los upgrades). Un WebSocket no pasa por CORS,
 * así que el upgrade exige Origin igual al propio; el long-polling, como cualquier petición:
 * los GET no se pueden leer desde fuera y los POST (envíos) exigen el mismo origen.
 */
export function mismoOrigenEnSocket(permitidos: readonly string[]): Middleware {
  return (req, res, next) => {
    const vale = req.headers.upgrade
      ? origenEsPropio(req, permitidos)
      : METODOS_SEGUROS.has(req.method ?? '') || peticionDelMismoOrigen(req, permitidos);
    if (vale) return next();
    log.warn('socket rechazado por su origen', { origen: cabecera(req, 'origin') || null });
    rechazar(res);
  };
}

// Traefik termina el TLS y avisa con X-Forwarded-Proto. Si alguien la falsea por HTTP, el
// navegador ignora HSTS fuera de HTTPS: no hay nada que ganar.
function llegaPorHttps(req: IncomingMessage): boolean {
  const socketTls = (req.socket as { encrypted?: boolean }).encrypted === true;
  return socketTls || cabecera(req, 'x-forwarded-proto').split(',')[0]?.trim() === 'https';
}

// El tipo de la respuesta solo se sabe al enviar las cabeceras: Node pasa siempre por
// writeHead (también en el envío implícito), así que se ajusta ahí.
function sinObjectSrcEnPdf(res: ServerResponse): void {
  const writeHead = res.writeHead;
  res.writeHead = function (this: ServerResponse, ...args: unknown[]) {
    if (/^application\/pdf/i.test(String(res.getHeader('content-type') ?? '')))
      res.setHeader('Content-Security-Policy', CSP_MARCO);
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as ServerResponse['writeHead'];
}

/**
 * Cabeceras de seguridad de todas las respuestas del servidor. En las rutas de un proxy
 * (el panel de Hermes) solo nosniff y frame-ancestors: el resto lo decide Hermes.
 */
export function cabecerasSeguridad(rutasProxy: readonly string[]): Middleware {
  return (req, res, next) => {
    const ruta = rutaDe(req);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (rutasProxy.some((p) => ruta === p || ruta.startsWith(`${p}/`))) {
      res.setHeader('Content-Security-Policy', CSP_MARCO);
      return next();
    }
    res.setHeader('Content-Security-Policy', CSP_MONITOR);
    sinObjectSrcEnPdf(res);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (llegaPorHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

/**
 * Sobre la respuesta de Hermes (antes de copiarla al navegador): añade nosniff y, si su CSP
 * no dice quién puede enmarcarlo, una política más con frame-ancestors. Una CSP con varias
 * políticas separadas por comas las aplica todas, así que la de Hermes queda intacta.
 */
export function endurecerRespuestaDelPanel(cabeceras: IncomingHttpHeaders): void {
  cabeceras['x-content-type-options'] = 'nosniff';
  const csp = ([] as string[])
    .concat(cabeceras['content-security-policy'] ?? [])
    .filter(Boolean)
    .join(', ');
  if (!csp) cabeceras['content-security-policy'] = CSP_MARCO;
  else if (!/frame-ancestors/i.test(csp)) cabeceras['content-security-policy'] = `${csp}, ${CSP_MARCO}`;
}
