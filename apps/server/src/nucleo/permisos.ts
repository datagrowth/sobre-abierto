// Quién hace cada petición de la web y qué puede hacer.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { alcanza, type Rol } from './usuarios.js';

// El login (nucleo/autenticacion.ts) deja aquí la persona de la sesión; `autorizar` comprueba su rol en cada
// ruta, con denegación por defecto: leer, cualquiera; escribir, editor; lo de la tabla de abajo, lo que diga. El
// precio se comprueba donde se escribe (escribirDecisiones), porque una misma ruta puede llevarlo o no.
export type UsuarioSesion = { id: number; nombre: string; rol: Rol; emergencia: boolean; debe_cambiarla: boolean };

/** Quien firma lo que se guarda y con qué rol. */
export type Actor = { nombre: string; rol: Rol };

const porPeticion = new WeakMap<IncomingMessage, UsuarioSesion>();

export function fijarUsuario(req: IncomingMessage, u: UsuarioSesion): void {
  porPeticion.set(req, u);
}

export const usuarioDe = (req: IncomingMessage): UsuarioSesion | null => porPeticion.get(req) ?? null;

// Una ruta montada sin el login delante (los tests de cada dominio) actúa como la web de siempre.
// En el servidor todo /api pasa antes por el login y por `autorizar`, que sin persona dan 401.
const SIN_SESION: Actor = { nombre: 'web', rol: 'admin' };

/** Quien firma: el nombre de la persona de la sesión, nunca lo que diga el cuerpo de la petición. */
export function actorDe(req: IncomingMessage): Actor {
  const u = usuarioDe(req);
  return u ? { nombre: u.nombre.slice(0, 60), rol: u.rol } : SIN_SESION;
}

export const quienDe = (req: IncomingMessage): string => actorDe(req).nombre;

/**
 * El cuerpo con la firma de la sesión en `campo` («quien» casi siempre): lo que firme el navegador
 * no cuenta, que se podía suplantar.
 */
export function conQuien(req: IncomingMessage & { body?: unknown }, campo = 'quien'): unknown {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? { ...b, [campo]: quienDe(req) } : (b ?? {});
}

const NOMBRE_ROL: Record<Rol, string> = { admin: 'admin', editor: 'editor', lector: 'lector' };

const mensajeSinPermiso = (rol: Rol, necesario: Rol): string =>
  `Con permiso de ${NOMBRE_ROL[rol]} no se puede hacer esto: hace falta ${NOMBRE_ROL[necesario]}. Pídeselo a un admin.`;

export const PRECIO_SOLO_ADMIN = 'Solo un admin decide el precio. Lo demás de la oferta sí lo puedes guardar.';

// ejemplo: una ruta que la regla tiene que cubrir (el test la prueba con mayúsculas, «//», «%» y barra final).
export type Regla = { patron: RegExp; rol: Rol; metodos?: 'lectura' | 'escritura'; ejemplo: string };

// La primera que casa manda. Lo que no está aquí: leer, lector; escribir, editor. Se comparan con
// la ruta normalizada (rutaNormalizada): en minúsculas, porque Express enruta sin distinguirlas.
export const REGLAS: readonly Regla[] = [
  // Lo de cada persona: su contraseña, sus avisos y sus búsquedas guardadas.
  { patron: /^\/api\/plataforma\/yo(\/|$)/, rol: 'lector', ejemplo: '/api/plataforma/yo/avisos' },
  { patron: /^\/api\/licitaciones\/busquedas(\/|$)/, rol: 'lector', ejemplo: '/api/licitaciones/busquedas/3' },
  // Un lector ve y comenta; dar por resuelto el de otro lo comprueba comentarios.ts.
  { patron: /^\/api\/plataforma\/comentarios(\/|$)/, rol: 'lector', ejemplo: '/api/plataforma/comentarios/3' },
  // Abrir una pestaña de la ficha anota el tiempo de la tarea: no cambia nada de la oferta.
  {
    patron: /^\/api\/licitaciones\/licitaciones\/[^/]+\/telemetria$/,
    rol: 'lector',
    ejemplo: '/api/licitaciones/licitaciones/p-1/telemetria',
  },
  // «Qué cambia» de las comprobaciones es un POST que solo calcula (el cambio que se ensaya va en el cuerpo).
  {
    patron: /^\/api\/licitaciones\/licitaciones\/[^/]+\/oferta\/impacto$/,
    rol: 'lector',
    ejemplo: '/api/licitaciones/licitaciones/p-1/oferta/impacto',
  },
  // Los CV del equipo y lo que Hermes está haciendo (instrucciones y resultados) no son para un lector.
  { patron: /^\/api\/colaboradores(\/|$)/, rol: 'editor', metodos: 'lectura', ejemplo: '/api/colaboradores/3' },
  { patron: /^\/api\/sessions(\/|$)/, rol: 'editor', metodos: 'lectura', ejemplo: '/api/sessions/s1/activity' },
  { patron: /^\/api\/plataforma\/usuarios(\/|$)/, rol: 'admin', ejemplo: '/api/plataforma/usuarios' },
  // Los tokens de la API de lectura y el estado del MCP (Ajustes › Integraciones).
  {
    patron: /^\/api\/plataforma\/integraciones(\/|$)/,
    rol: 'admin',
    ejemplo: '/api/plataforma/integraciones/tokens/2',
  },
  {
    patron: /^\/api\/plataforma\/avisos(\/|$)/,
    rol: 'admin',
    metodos: 'escritura',
    ejemplo: '/api/plataforma/avisos/config',
  },
  // La marca de la instalación (Ajustes › Marca): nombre, colores y logo.
  {
    patron: /^\/api\/plataforma\/marca(\/|$)/,
    rol: 'admin',
    metodos: 'escritura',
    ejemplo: '/api/plataforma/marca/logo',
  },
  // Los euros internos solo los ve un admin (Ajustes › Empresa › Costes internos).
  { patron: /^\/api\/plataforma\/empresa\/costes(\/|$)/, rol: 'admin', ejemplo: '/api/plataforma/empresa/costes' },
  {
    patron: /^\/api\/plataforma\/empresa(\/|$)/,
    rol: 'admin',
    metodos: 'escritura',
    ejemplo: '/api/plataforma/empresa/documentos/2',
  },
  // Conectar Drive (connect y callback son GET con efecto), elegir carpeta y desconectar.
  { patron: /^\/api\/drive\/(connect|callback)$/, rol: 'admin', ejemplo: '/api/drive/callback' },
  { patron: /^\/api\/drive(\/|$)/, rol: 'admin', metodos: 'escritura', ejemplo: '/api/drive/folder' },
  {
    patron: /^\/api\/licitaciones\/(carpeta-unica\/migracion|carpetas\/reorganizar)$/,
    rol: 'admin',
    metodos: 'escritura',
    ejemplo: '/api/licitaciones/carpeta-unica/migracion',
  },
  {
    patron: /^\/hermes-vault\/api\/v1\/settings\/vault(\/|$)/,
    rol: 'admin',
    metodos: 'escritura',
    ejemplo: '/hermes-vault/api/v1/settings/vault',
  },
  // La Consola de Hermes es una terminal con sus claves.
  { patron: /^\/hermes-panel(\/|$)/, rol: 'admin', ejemplo: '/hermes-panel/chat' },
];

const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * La ruta como la ve el router, para que la regla y la ruta servida no puedan ser distintas:
 * decodificada una vez, en minúsculas (Express no distingue), sin «//», «/./» ni «/../» y sin la
 * barra del final. null si no se puede decodificar (se trata como la más restringida).
 */
export function rutaNormalizada(ruta: string): string | null {
  let r: string;
  try {
    r = decodeURIComponent(ruta);
  } catch {
    return null;
  }
  const segmentos: string[] = [];
  for (const s of r.toLowerCase().split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') segmentos.pop();
    else segmentos.push(s);
  }
  return `/${segmentos.join('/')}`;
}

/** El rol que pide una petición de la web. */
export function rolNecesario(metodo: string, ruta: string): Rol {
  const tipo = LECTURA.has(metodo.toUpperCase()) ? 'lectura' : 'escritura';
  const r = rutaNormalizada(ruta);
  if (r === null) return 'admin';
  const regla = REGLAS.find((x) => x.patron.test(r) && (!x.metodos || x.metodos === tipo));
  return regla?.rol ?? (tipo === 'lectura' ? 'lector' : 'editor');
}

const rutaDe = (req: IncomingMessage & { originalUrl?: string }): string =>
  (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';

function negar(res: ServerResponse, status: number, cuerpo: { error: string; message: string }): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(cuerpo));
}

/**
 * Tras el login, en /api, /hermes-vault y /hermes-panel. Sin persona, 401; con la contraseña
 * temporal sin cambiar, 403 hasta que la cambie (eso va por /auth, fuera de aquí).
 */
export function autorizar(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void {
  const u = usuarioDe(req);
  if (!u) return negar(res, 401, { error: 'sin_sesion', message: 'Sesión requerida' });
  if (u.debe_cambiarla)
    return negar(res, 403, { error: 'debe_cambiar_contrasena', message: 'Cambia tu contraseña temporal para seguir.' });
  const necesario = rolNecesario(req.method ?? 'GET', rutaDe(req));
  if (!alcanza(u.rol, necesario))
    return negar(res, 403, { error: 'sin_permiso', message: mensajeSinPermiso(u.rol, necesario) });
  next();
}

/** Para lo que no pasa por `autorizar` (el WebSocket de la Consola): si la persona llega a ese rol. */
export const llegaA = (u: UsuarioSesion | null, rol: Rol): boolean =>
  Boolean(u && !u.debe_cambiarla && alcanza(u.rol, rol));
