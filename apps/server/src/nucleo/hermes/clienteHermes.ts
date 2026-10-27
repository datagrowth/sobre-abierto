// Cliente HTTP del dashboard de Hermes: gestiona la autenticación (login o token de sesión) de las peticiones.
import { logger } from '../log.js';

export const HERMES_BASE = process.env.HERMES_BASE_URL || 'http://localhost:9119';
const log = logger('hermes-dashboard');

// Dos modos de autenticación contra el dashboard de Hermes:
//
// 1) Login (HERMES_DASHBOARD_BASIC_AUTH_USERNAME / PASSWORD definidos): el dashboard
//    exige sesión. Se hace POST /auth/password-login y se reenvían las cookies de
//    sesión; Hermes las rota solo con el refresh token y las devuelve en Set-Cookie.
//    No se manda Authorization: un Bearer que no sea del proveedor da 401.
//
// 2) Sin login (Hermes local en loopback): el token de sesión ROTA con cada reinicio
//    del gateway, así que se lee de `window.__HERMES_SESSION_TOKEN__` en el HTML y se
//    refresca al recibir 401/403. HERMES_TOKEN en .env es solo una semilla opcional.
const DASH_USER = process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME || '';
const DASH_PASS = process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD || '';
export const loginMode = Boolean(DASH_USER && DASH_PASS);

let cachedToken = process.env.HERMES_TOKEN || '';
let sessionCookie = '';
let refreshing: Promise<string> | null = null; // promesa en vuelo para no loguear/refrescar en paralelo

export function getSessionCookie(): string {
  return sessionCookie;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function storeCookies(res: Response): void {
  absorbSetCookie(res.headers.getSetCookie());
}

// También la usa el proxy del panel: Hermes rota las cookies en respuestas a
// peticiones del navegador y el tarro compartido debe quedarse con las nuevas.
export function absorbSetCookie(list: string[] | undefined): void {
  if (!list || !list.length) return;
  const jar = new Map(sessionCookie ? sessionCookie.split('; ').map((c) => [c.split('=')[0] ?? '', c]) : []);
  for (const raw of list) {
    const pair = (raw.split(';')[0] ?? '').trim();
    const name = pair.split('=')[0] ?? '';
    const expired = /max-age=0\b/i.test(raw) || pair === `${name}=` || pair === `${name}=""`;
    if (expired) jar.delete(name);
    else if (pair) jar.set(name, pair);
  }
  sessionCookie = [...jar.values()].join('; ');
}

async function login(): Promise<void> {
  try {
    const res = await fetch(`${HERMES_BASE}/auth/password-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ provider: 'basic', username: DASH_USER, password: DASH_PASS, next: '/' }),
    });
    if (res.ok) {
      sessionCookie = '';
      storeCookies(res);
      log.info('sesión iniciada en el dashboard');
    } else if (res.status === 401) {
      sessionCookie = '';
      log.error('login rechazado: revisa HERMES_DASHBOARD_BASIC_AUTH_USERNAME / PASSWORD');
    } else if (res.status === 429) {
      log.error('demasiados intentos de login; Hermes está limitando');
    } else {
      log.error('login fallido', { status: res.status });
    }
  } catch (e) {
    log.error('no se pudo iniciar sesión', { error: errorMessage(e) });
  }
}

async function readTokenFromHtml(): Promise<void> {
  try {
    const res = await fetch(`${HERMES_BASE}/`, { headers: { Accept: 'text/html' } });
    if (!res.ok) return;
    const html = await res.text();
    const token = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)?.[1];
    if (token) {
      if (token !== cachedToken) log.info('token de sesión refrescado desde el gateway');
      cachedToken = token;
    }
  } catch (e) {
    log.error('no se pudo refrescar el token', { error: errorMessage(e) });
  }
}

export async function refreshToken(): Promise<string> {
  if (refreshing) return refreshing;
  refreshing = (loginMode ? login() : readTokenFromHtml()).then(() => cachedToken);
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (loginMode) {
    if (sessionCookie) headers.Cookie = sessionCookie;
  } else if (cachedToken) {
    headers.Authorization = `Bearer ${cachedToken}`;
  }
  return { ...headers, ...extra };
}

type HermesFetchOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

export async function hermesFetch(path: string, opts: HermesFetchOptions = {}): Promise<unknown> {
  const url = `${HERMES_BASE}${path}`;
  const send = () => fetch(url, { ...opts, headers: buildHeaders(opts.headers) });

  if (loginMode ? !sessionCookie : !cachedToken) await refreshToken();

  let res = await send();
  storeCookies(res);

  // Sesión caducada o token rotado: re-login / relectura y un reintento.
  if (res.status === 401 || res.status === 403) {
    await refreshToken();
    res = await send();
    storeCookies(res);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Hermes ${path} -> ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export async function ensureSession(): Promise<void> {
  if (loginMode && !sessionCookie) await refreshToken();
}

// La sesión comprobada hace menos de esto se da por buena (un WebSocket por pestaña no
// debe costar una petición más cada vez).
const SESION_COMPROBADA_MS = 60_000;
let comprobadaEn = 0;

/**
 * Comprueba contra Hermes que la sesión guardada sigue valiendo y, si no (p. ej. Hermes se
 * recreó en un despliegue y su cookie ya no vale), inicia sesión otra vez. Lo usa el proxy
 * antes de abrir un WebSocket: el upgrade no pasa por la renovación ante un 401 de las
 * peticiones HTTP, y con una cookie caducada el chat del panel se quedaba en negro.
 */
export async function comprobarSesion(ahora = Date.now()): Promise<boolean> {
  if (ahora - comprobadaEn < SESION_COMPROBADA_MS) return true;
  try {
    await hermesFetch('/api/sessions?limit=1');
    comprobadaEn = ahora;
    return true;
  } catch (e) {
    log.warn('sesión del dashboard no comprobada', { error: errorMessage(e).slice(0, 160) });
    return false;
  }
}

/** Para pruebas: olvida cuándo se comprobó la sesión. */
export function olvidarComprobacion(): void {
  comprobadaEn = 0;
}
