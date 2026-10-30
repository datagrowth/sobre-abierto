// Login con cookie de sesión firmada: cada persona entra con su email y contraseña (nucleo/usuarios.ts).
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { z } from 'zod';
import { fail, ok, type Result } from './result.js';
import { logger } from './log.js';
import type { Db } from './db.js';
import { fijarUsuario, llegaA, type UsuarioSesion } from './permisos.js';
import {
  anotarAcceso,
  autenticar,
  cambiarContrasenaPropia,
  hayAdminConContrasenaPropia,
  sembrarPrimerAdmin,
  usuarioDeSesion,
  usuarioPorId,
  type Rol,
} from './usuarios.js';

const log = logger('acceso');

// MONITOR_BASIC_AUTH_* crea el primer admin y es acceso de emergencia mientras ningún admin tenga contraseña
// propia (después, src/recuperarAcceso.ts). Sin ellas el servidor queda abierto, algo que en producción exige
// MONITOR_AUTH=off.
const USER = process.env.MONITOR_BASIC_AUTH_USERNAME || '';
const PASS = process.env.MONITOR_BASIC_AUTH_PASSWORD || '';
export const enabled = Boolean(USER && PASS);

const COOKIE = 'hermes_monitor_session';
// Con HTTPS la cookie lleva __Host-: el navegador solo la acepta con Secure, en «/» y sin Domain, y un
// subdominio hermano no puede sobrescribirla. Sin HTTPS (instalación en red local) el prefijo la haría rechazar.
const COOKIE_SEGURA = `__Host-${COOKIE}`;
// Sesión deslizante: 12 h sin usar la plataforma la cierran, pero usándolo se renueva sola (como
// mucho una vez por hora). Antes caducaba a las 12 h del login aunque se estuviera usando, y
// tras un despliegue la pestaña reconectaba con la cookie ya caducada («Sesión requerida»).
// SESION_MAX_S acota lo que vale una cookie robada aunque alguien la renueve sin parar.
const SESSION_TTL_S = 12 * 3600;
const RENOVAR_S = 3600;
export const SESION_MAX_S = 7 * 24 * 3600;

const vacia = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const EntornoAcceso = z.object({
  NODE_ENV: z.preprocess(vacia, z.string().optional()),
  MONITOR_BASIC_AUTH_USERNAME: z.preprocess(vacia, z.string().optional()),
  MONITOR_BASIC_AUTH_PASSWORD: z.preprocess(vacia, z.string().optional()),
  MONITOR_SESSION_SECRET: z.preprocess(vacia, z.string().min(32).optional()),
  MONITOR_AUTH: z.preprocess(vacia, z.enum(['on', 'off']).optional()),
  // Proxies delante del servidor que añaden X-Forwarded-For (Traefik = 1). 0 = no se lee.
  MONITOR_PROXIES_DE_CONFIANZA: z.preprocess(vacia, z.coerce.number().int().min(0).max(5).default(0)),
});

export type ConfigAcceso = { secreto: string | null; proxiesDeConfianza: number; login: boolean };

/**
 * Comprueba el entorno del acceso al arrancar (no al importar: los tests cargan el módulo
 * sin entorno de producción). En producción exige login, salvo MONITOR_AUTH=off, y un
 * MONITOR_SESSION_SECRET propio. El error solo nombra variables, nunca sus valores.
 */
export function validarAcceso(env: NodeJS.ProcessEnv = process.env): Result<ConfigAcceso> {
  const v = EntornoAcceso.safeParse(env);
  if (!v.success) return fail('acceso_invalido', [...new Set(v.error.issues.map((i) => i.path.join('.')))].join(', '));
  const e = v.data;
  const login = Boolean(e.MONITOR_BASIC_AUTH_USERNAME && e.MONITOR_BASIC_AUTH_PASSWORD);
  const produccion = e.NODE_ENV === 'production';
  if (!login && (e.MONITOR_AUTH === 'on' || (produccion && e.MONITOR_AUTH !== 'off'))) {
    return fail('acceso_sin_login', 'MONITOR_BASIC_AUTH_USERNAME y MONITOR_BASIC_AUTH_PASSWORD (o MONITOR_AUTH=off)');
  }
  if (login && produccion && !e.MONITOR_SESSION_SECRET) return fail('acceso_sin_secreto', 'MONITOR_SESSION_SECRET');
  return ok({ secreto: e.MONITOR_SESSION_SECRET ?? null, proxiesDeConfianza: e.MONITOR_PROXIES_DE_CONFIANZA, login });
}

const inicial = validarAcceso();
// Sin secreto propio (solo fuera de producción) se usa uno aleatorio: nunca uno derivado de
// la contraseña, que dejaría crackearla a partir de una cookie robada.
const SECRETO_PROPIO = Boolean(inicial.data?.secreto);
const SECRET = inicial.data?.secreto ?? crypto.randomBytes(32).toString('hex');
const PROXIES_DE_CONFIANZA = inicial.data?.proxiesDeConfianza ?? 0;

/**
 * Clave con la que se firman las sesiones: depende del secreto y de las credenciales, así que
 * cambiar MONITOR_BASIC_AUTH_PASSWORD (p. ej. porque se ha filtrado) cierra todas las sesiones
 * abiertas, que si no seguirían renovándose hasta 7 días. No deja sacar la contraseña de una
 * cookie: sin el secreto la clave no se puede reproducir.
 */
export function claveDeSesion(secreto: string, usuario: string, contrasena: string): Buffer {
  return crypto.createHmac('sha256', secreto).update(`sesion\0${usuario}\0${contrasena}`).digest();
}

const CLAVE_SESION = claveDeSesion(SECRET, USER, PASS);

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── Sesiones ────────────────────────────────────────────────────────────────
// Token «exp.inicio.id.usuario.firma» (segundos). El id aleatorio distingue sesiones emitidas en el
// mismo segundo, se conserva al renovar y permite revocar solo la que cierra sesión; inicio es el
// login; usuario, la persona (nucleo/usuarios.ts), o 0 para el acceso de emergencia. El rol no va
// en el token: se lee en cada petición, así que un cambio de rol o una baja valen al momento.
type Sesion = { id: string; expS: number; inicioS: number; usuario: number };
type AlmacenRevocadas = {
  esta: (id: string, ahoraMs: number) => boolean;
  anotar: (id: string, hastaMs: number, ahoraMs: number) => void;
};

function revocadasEnMemoria(): AlmacenRevocadas {
  const mapa = new Map<string, number>();
  return {
    esta: (id, ahoraMs) => (mapa.get(id) ?? 0) > ahoraMs,
    anotar: (id, expMs, ahoraMs) => {
      for (const [k, v] of mapa) if (v < ahoraMs) mapa.delete(k);
      mapa.set(id, expMs);
    },
  };
}

// Hasta que arranca la plataforma (milisegundos tras escuchar), en memoria; luego, en nucleo.db.
let revocadas: AlmacenRevocadas = revocadasEnMemoria();
// nucleo.db, para los usuarios: hasta que llega solo vale el acceso de emergencia.
let base: Db | null = null;

/**
 * Las sesiones cerradas pasan a nucleo.db (sesiones_revocadas): en memoria, cada reinicio
 * volvía a dar por buena una cookie cerrada hasta que caducara, y con la sesión deslizante
 * eso podrían ser días. Se guardan hasta la última caducidad que puede tener un token con ese id.
 */
export function guardarRevocadasEn(db: Db): void {
  revocadas = {
    esta: (id, ahoraMs) =>
      db.prepare('SELECT 1 FROM sesiones_revocadas WHERE id = ? AND expira_ms > ?').get(id, ahoraMs) !== undefined,
    anotar: (id, expMs, ahoraMs) => {
      db.prepare('DELETE FROM sesiones_revocadas WHERE expira_ms <= ?').run(ahoraMs);
      db.prepare('INSERT OR REPLACE INTO sesiones_revocadas (id, expira_ms) VALUES (?, ?)').run(id, expMs);
    },
  };
}

/**
 * Los usuarios viven en nucleo.db. Sin ninguno, el login de siempre pasa a ser el primer admin
 * (que cambia la contraseña al entrar); mientras ningún admin tenga contraseña propia, ese login
 * además entra como acceso de emergencia. En cuanto la tiene, deja de valer.
 */
export async function usarUsuariosDe(db: Db): Promise<void> {
  base = db;
  if (await sembrarPrimerAdmin(db, USER, PASS))
    log.info('primer admin creado con el acceso de siempre: cambiará la contraseña al entrar');
}

function sign(cuerpo: string): string {
  return crypto.createHmac('sha256', CLAVE_SESION).update(cuerpo).digest('base64url');
}

const ahoraS = () => Math.floor(Date.now() / 1000);

function emitirToken(s: Omit<Sesion, 'expS'>, ahora: number): { token: string; expS: number } {
  const expS = Math.min(ahora + SESSION_TTL_S, s.inicioS + SESION_MAX_S);
  const cuerpo = `${expS}.${s.inicioS}.${s.id}.${s.usuario}`;
  return { token: `${cuerpo}.${sign(cuerpo)}`, expS };
}

function issueToken(usuario: number): string {
  const ahora = ahoraS();
  return emitirToken({ id: crypto.randomBytes(12).toString('base64url'), inicioS: ahora, usuario }, ahora).token;
}

const ENTERO = /^\d+$/;

// Las partes de un token y lo que lleva firmado; null si no tiene la forma. Los de antes de los
// usuarios (sin persona) ya no valen: quien los tenga vuelve a entrar con su email.
function partesToken(token: string): (Sesion & { cuerpo: string; firma: string }) | null {
  const p = token.split('.');
  if (p.length !== 5 || !p.every(Boolean) || ![p[0], p[1], p[3]].every((x) => ENTERO.test(x ?? ''))) return null;
  return {
    expS: Number(p[0]),
    inicioS: Number(p[1]),
    id: p[2]!,
    usuario: Number(p[3]),
    firma: p[4]!,
    cuerpo: p.slice(0, 4).join('.'),
  };
}

function leerToken(token: string): Sesion | null {
  const t = partesToken(token);
  const ahoraMs = Date.now();
  if (!t || t.expS * 1000 < ahoraMs) return null;
  if (!safeEqual(t.firma, sign(t.cuerpo)) || revocadas.esta(t.id, ahoraMs)) return null;
  return { id: t.id, expS: t.expS, inicioS: t.inicioS, usuario: t.usuario };
}

// Hasta el máximo de la sesión, no hasta la exp de esta cookie: otra copia con el mismo id
// (robada y renovada, o renovada por una petición que respondió después de «Salir») puede
// caducar más tarde, y en cuanto la revocación venciera volvería a valer.
function revocar(token: string): void {
  const sesion = leerToken(token);
  if (sesion) revocadas.anotar(sesion.id, (sesion.inicioS + SESION_MAX_S) * 1000, Date.now());
}

function readCookie(req: IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

function cookieDeSesion(req: IncomingMessage): string {
  return readCookie(req, COOKIE_SEGURA) || readCookie(req, COOKIE);
}

const EMERGENCIA: UsuarioSesion = {
  id: 0,
  nombre: 'Acceso de emergencia',
  rol: 'admin',
  emergencia: true,
  debe_cambiarla: false,
};
// Sin login (escritorio) no hay personas: la web hace de admin y firma «web», como siempre.
const SIN_LOGIN: UsuarioSesion = { id: 0, nombre: 'web', rol: 'admin', emergencia: false, debe_cambiarla: false };

// Hasta que llega nucleo.db no hay usuarios y solo vale el acceso de emergencia. Se consulta en cada
// petición: así las sesiones de emergencia ya abiertas caen en cuanto un admin elige su contraseña.
const emergenciaAbierta = (): boolean => !base || !hayAdminConContrasenaPropia(base);

// La persona de una sesión válida: activa y sin cambio de contraseña posterior al login.
function personaDe(s: Sesion): UsuarioSesion | null {
  if (s.usuario === 0) return emergenciaAbierta() ? EMERGENCIA : null;
  const u = base ? usuarioDeSesion(base, s.usuario, s.inicioS) : null;
  return u ? { id: u.id, nombre: u.nombre, rol: u.rol, emergencia: false, debe_cambiarla: u.debe_cambiarla } : null;
}

/** Id de la sesión de la petición (liga el `state` de OAuth a quien lo inició); null sin sesión. */
export function idDeSesion(req: IncomingMessage): string | null {
  return sesionDe(req)?.sesion.id ?? null;
}

function sesionDe(req: IncomingMessage): { sesion: Sesion; persona: UsuarioSesion } | null {
  const sesion = leerToken(cookieDeSesion(req));
  const persona = sesion ? personaDe(sesion) : null;
  return sesion && persona ? { sesion, persona } : null;
}

export function allows(req: IncomingMessage): boolean {
  return !enabled || sesionDe(req) !== null;
}

/** Sesión válida de alguien con ese rol: para el WebSocket de la Consola, que no pasa por Express. */
export function permiteRol(req: IncomingMessage, rol: Rol): boolean {
  return !enabled || llegaA(sesionDe(req)?.persona ?? null, rol);
}

// El HTML/JS del frontend es público (la pantalla de login vive en él); la API, Socket.io, la
// Biblioteca y el panel de Hermes exigen sesión.
// Sirve tanto para Express como para el handshake de Socket.io (req/res nativos). Deja la persona
// en la petición (nucleo/permisos.ts) para autorizar y firmar lo que se guarde.
export function middleware(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void {
  const s = enabled ? sesionDe(req) : { persona: SIN_LOGIN };
  if (s) {
    fijarUsuario(req, s.persona);
    return next();
  }
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Sesión requerida' }));
}

// Renueva la cookie de una sesión válida emitida hace más de RENOVAR_S, si aún puede alargarse
// (no pasa de SESION_MAX_S desde el login).
function renovar(req: express.Request, res: express.Response): void {
  const s = enabled ? sesionDe(req)?.sesion : null;
  const ahora = ahoraS();
  if (!s || res.headersSent || s.expS - ahora > SESSION_TTL_S - RENOVAR_S) return;
  const nuevo = emitirToken(s, ahora);
  if (nuevo.expS <= s.expS) return;
  res.append('Set-Cookie', cookieDeSesionNueva(req, nuevo.token, nuevo.expS - ahora));
}

/** Tras `middleware`, en la API: quien usa el servidor (la web la consulta cada minuto) no pierde la sesión. */
export function renovarSesion(req: express.Request, res: express.Response, next: express.NextFunction): void {
  renovar(req, res);
  next();
}

export type EstadoAcceso = {
  login: boolean;
  secreto: 'propio' | 'aleatorio';
  sesion_horas_sin_uso: number;
  sesion_dias_max: number;
};

/**
 * Para Estado: si las sesiones sobreviven a un reinicio (secreto propio). Sin huella del secreto:
 * Estado llega a los agentes por plataforma_estado, y con un secreto de poca entropía una huella
 * dejaría probar candidatos sin conexión y forjar sesiones. La huella va solo al log de arranque.
 */
export function estadoAcceso(): EstadoAcceso {
  return {
    login: enabled,
    secreto: SECRETO_PROPIO ? 'propio' : 'aleatorio',
    sesion_horas_sin_uso: SESSION_TTL_S / 3600,
    sesion_dias_max: SESION_MAX_S / 86_400,
  };
}

/** Para el log de arranque (solo Dokploy lo ve): si cambia entre despliegues, el secreto es otro. */
export function huellaSecreto(): string | null {
  return SECRETO_PROPIO
    ? crypto.createHmac('sha256', SECRET).update('huella-del-secreto-de-sesion').digest('hex').slice(0, 8)
    : null;
}

// ─── Fuerza bruta ────────────────────────────────────────────────────────────

/**
 * IP del cliente. Sin proxies de confianza, la del socket: X-Forwarded-For lo escribe
 * cualquiera que llegue al puerto desde la red interna. Con N proxies, la entrada N
 * contando desde el final: cada proxy añade al final la IP de quien le habló, y lo que
 * va antes pudo inventarlo el cliente.
 */
export function ipCliente(req: IncomingMessage, proxiesDeConfianza: number): string {
  const directa = req.socket.remoteAddress ?? '';
  if (proxiesDeConfianza <= 0) return directa;
  const cadena = ([] as string[])
    .concat(req.headers['x-forwarded-for'] ?? [])
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (cadena.length >= proxiesDeConfianza) return cadena[cadena.length - proxiesDeConfianza] ?? directa;
  return cadena[0] ?? directa;
}

export type OpcionesLimite = {
  maxPorIp: number;
  /** Fallos de una misma cuenta (desde cualquier IP) antes de bloquearla; por defecto, como maxPorIp. */
  maxPorCuenta?: number;
  bloqueoIpMs: number;
  maxGlobal: number;
  ventanaGlobalMs: number;
  esperaGlobalMs: number;
  esperaGlobalMaxMs: number;
  tope: number;
};

const LIMITES: OpcionesLimite = {
  maxPorIp: 10,
  bloqueoIpMs: 15 * 60_000,
  maxGlobal: 30,
  ventanaGlobalMs: 60_000,
  esperaGlobalMs: 60_000,
  esperaGlobalMaxMs: 5 * 60_000,
  tope: 5000,
};

// Una IP que entró hace menos de esto no sufre el freno global.
const IP_CONOCIDA_MS = 24 * 3600_000;
const claveCuenta = (cuenta: string) => `cuenta:${cuenta.trim().toLowerCase()}`;

type FallosIp = { fallos: number; bloqueadoHasta: number; ultimo: number };

/**
 * Límite de intentos fallidos por IP, por cuenta y, además, global (entre todas las IP): quien
 * pueda variar su IP o su X-Forwarded-For choca con el global, cuya espera se duplica en
 * cada bloqueo seguido (y vuelve a la base tras una hora sin bloqueos). El global solo frena: no
 * alcanza a las IP que han entrado hace poco, así que un atacante sin cuenta no deja fuera a la
 * empresa. El mapa por IP y cuenta se purga en cada fallo y nunca pasa de `tope` entradas.
 */
export function crearLimitador(o: OpcionesLimite = LIMITES, reloj: () => number = Date.now) {
  const porIp = new Map<string, FallosIp>();
  const conocidas = new Map<string, number>();
  let recientes: number[] = [];
  let bloqueoGlobalHasta = 0;
  let nivelGlobal = 0;

  const caducada = (e: FallosIp, ahora: number) => e.bloqueadoHasta <= ahora && ahora - e.ultimo > o.bloqueoIpMs;

  function anotarIp(ip: string, ahora: number, maximo = o.maxPorIp): boolean {
    const previa = porIp.get(ip);
    // Un bloqueo ya vencido, o fallos de hace más de bloqueoIpMs, empiezan la cuenta de cero.
    const deCero = !previa || (previa.bloqueadoHasta > 0 && previa.bloqueadoHasta <= ahora) || caducada(previa, ahora);
    const e = deCero ? { fallos: 0, bloqueadoHasta: 0, ultimo: ahora } : previa;
    e.fallos += 1;
    e.ultimo = ahora;
    if (e.fallos >= maximo) e.bloqueadoHasta = ahora + o.bloqueoIpMs;
    porIp.delete(ip);
    porIp.set(ip, e);
    for (const [k, v] of porIp) if (caducada(v, ahora)) porIp.delete(k);
    // Por orden de inserción: sale lo que lleva más tiempo sin fallar.
    for (const k of porIp.keys()) {
      if (porIp.size <= o.tope) break;
      porIp.delete(k);
    }
    return e.bloqueadoHasta > ahora;
  }

  function anotarGlobal(ahora: number): boolean {
    recientes = recientes.filter((t) => ahora - t < o.ventanaGlobalMs);
    recientes.push(ahora);
    if (recientes.length < o.maxGlobal) return false;
    if (ahora - bloqueoGlobalHasta > 3_600_000) nivelGlobal = 0;
    bloqueoGlobalHasta = ahora + Math.min(o.esperaGlobalMs * 2 ** nivelGlobal, o.esperaGlobalMaxMs);
    nivelGlobal += 1;
    recientes = [];
    return true;
  }

  return {
    /** Milisegundos que le quedan a esta IP (o cuenta) para poder intentarlo (0 = puede). */
    espera(ip: string, cuenta?: string): number {
      const ahora = reloj();
      const conocida = ahora - (conocidas.get(ip) ?? -Infinity) < IP_CONOCIDA_MS;
      const global = conocida ? 0 : bloqueoGlobalHasta - ahora;
      const propias = [ip, cuenta ? claveCuenta(cuenta) : ''].map((k) => (porIp.get(k)?.bloqueadoHasta ?? 0) - ahora);
      return Math.max(0, global, ...propias);
    },
    /** Anota un fallo; dice qué bloqueo ha saltado, si alguno. */
    fallo(ip: string, cuenta?: string): 'ip' | 'cuenta' | 'global' | null {
      const ahora = reloj();
      const global = anotarGlobal(ahora);
      const deIp = anotarIp(ip, ahora);
      const deCuenta = cuenta ? anotarIp(claveCuenta(cuenta), ahora, o.maxPorCuenta ?? o.maxPorIp) : false;
      return global ? 'global' : deIp ? 'ip' : deCuenta ? 'cuenta' : null;
    },
    exito(ip: string, cuenta?: string): void {
      porIp.delete(ip);
      if (cuenta) porIp.delete(claveCuenta(cuenta));
      const ahora = reloj();
      conocidas.delete(ip);
      conocidas.set(ip, ahora);
      for (const [k, t] of conocidas) if (ahora - t >= IP_CONOCIDA_MS || conocidas.size > o.tope) conocidas.delete(k);
    },
    tamano(): number {
      return porIp.size;
    },
  };
}

const limitador = crearLimitador();

// ─── Rutas ───────────────────────────────────────────────────────────────────

// «username» es el email (o el usuario del acceso de emergencia): el nombre del campo es el de siempre.
const Credenciales = z.object({ username: z.string().max(200), password: z.string().max(1000) });

// APP_URL con https cuenta aunque el proxy no mande X-Forwarded-Proto.
function conHttps(req: express.Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https' || /^https:/i.test(process.env.APP_URL ?? '');
}

function cookieDeSesionNueva(req: express.Request, valor: string, maxAge: number): string {
  const segura = conHttps(req);
  const atributos = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${segura ? '; Secure' : ''}`;
  return `${segura ? COOKIE_SEGURA : COOKIE}=${valor}; ${atributos}`;
}

function esAccesoDeEmergencia(c: z.infer<typeof Credenciales>): boolean {
  // Las dos comparaciones siempre: cortar en la primera diría por el tiempo si el usuario existe.
  const userOk = safeEqual(c.username, USER);
  const passOk = safeEqual(c.password, PASS);
  return userOk && passOk;
}

/** La persona de unas credenciales: un usuario activo, el acceso de emergencia o nadie. */
async function quienEntra(body: unknown): Promise<{ usuario: number } | null> {
  const c = Credenciales.safeParse(body ?? {});
  if (!c.success) return null;
  const u = base ? await autenticar(base, c.data.username, c.data.password) : null;
  if (u) {
    anotarAcceso(base!, u.id);
    return { usuario: u.id };
  }
  if (!esAccesoDeEmergencia(c.data)) return null;
  if (!emergenciaAbierta()) {
    log.warn('acceso de emergencia rechazado: ya hay un admin con contraseña propia');
    return null;
  }
  log.warn('entrada con el acceso de emergencia (MONITOR_BASIC_AUTH_*)');
  return { usuario: 0 };
}

// Lo que la web sabe de quien la usa. El email va solo a su dueño, nunca al log.
function quienSoy(s: { persona: UsuarioSesion } | null): Record<string, unknown> | null {
  if (!s) return null;
  const { id, nombre, rol, emergencia, debe_cambiarla } = s.persona;
  const email = !emergencia && base ? (usuarioPorId(base, id)?.email ?? null) : null;
  return { id, nombre, rol, emergencia, debe_cambiarla, email };
}

// El email que se intenta, para limitar por cuenta además de por IP.
function cuentaDe(body: unknown): string | undefined {
  const c = Credenciales.safeParse(body ?? {});
  return c.success && c.data.username.trim() ? c.data.username : undefined;
}

function bloqueado(req: express.Request, res: express.Response): string | null {
  const ip = ipCliente(req, PROXIES_DE_CONFIANZA);
  const espera = limitador.espera(ip, cuentaDe(req.body));
  if (espera <= 0) return ip;
  res.setHeader('Retry-After', String(Math.ceil(espera / 1000)));
  res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  return null;
}

export const router = express.Router();

router.get('/session', (req, res) => {
  const s = enabled ? sesionDe(req) : null;
  if (s) renovar(req, res);
  res.json({ enabled, authenticated: !enabled || s !== null, usuario: quienSoy(s) });
});

router.post('/login', express.json({ limit: '10kb' }), (req, res) => {
  if (!enabled) {
    res.status(204).end();
    return;
  }
  const ip = bloqueado(req, res);
  if (!ip) return;
  quienEntra(req.body).then(
    (entra) => {
      if (!entra) {
        const bloqueo = limitador.fallo(ip, cuentaDe(req.body));
        if (bloqueo) log.warn('login bloqueado por intentos fallidos', { alcance: bloqueo });
        res.status(401).json({ error: 'Email o contraseña incorrectos' });
        return;
      }
      limitador.exito(ip, cuentaDe(req.body));
      res.setHeader('Set-Cookie', cookieDeSesionNueva(req, issueToken(entra.usuario), SESSION_TTL_S));
      res.status(204).end();
    },
    () => {
      res.status(500).json({ error: 'internal_error' });
    },
  );
});

const ESTADO_CAMBIO: Record<string, number> = { invalid_input: 400, contrasena_incorrecta: 403 };

/**
 * Cada persona cambia su contraseña (también la temporal del primer acceso, que hasta entonces no
 * deja usar la API). Las demás sesiones suyas se cierran; esta sigue con una cookie nueva.
 */
router.post('/contrasena', express.json({ limit: '10kb' }), (req, res) => {
  const s = enabled ? sesionDe(req) : null;
  if (!s || s.persona.emergencia || !base) {
    res.status(s ? 400 : 401).json({
      error: s ? 'El acceso de emergencia no tiene contraseña propia: entra con tu email.' : 'Sesión requerida',
    });
    return;
  }
  const ip = bloqueado(req, res);
  if (!ip) return;
  const db = base;
  cambiarContrasenaPropia(db, s.persona.id, req.body ?? {}).then(
    (r) => {
      if (r.error) {
        if (r.error.code === 'contrasena_incorrecta') limitador.fallo(ip);
        res.status(ESTADO_CAMBIO[r.error.code] ?? 500).json({ error: r.error.code, message: r.error.message });
        return;
      }
      revocar(cookieDeSesion(req));
      res.setHeader('Set-Cookie', cookieDeSesionNueva(req, issueToken(s.persona.id), SESSION_TTL_S));
      res.json({ usuario: quienSoy({ persona: { ...s.persona, debe_cambiarla: false } }) });
    },
    () => {
      res.status(500).json({ error: 'internal_error' });
    },
  );
});

router.post('/logout', (req, res) => {
  revocar(cookieDeSesion(req));
  res.setHeader('Set-Cookie', cookieDeSesionNueva(req, '', 0));
  res.status(204).end();
});
