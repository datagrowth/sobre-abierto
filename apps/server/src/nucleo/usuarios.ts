// Usuarios propios de la web: cada persona entra con su email y contraseña, y tiene un rol (admin, editor o lector).
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ahora, type Db } from './db.js';
import { fail, ok, type Result } from './result.js';

// La contraseña se guarda con scrypt de node:crypto; el hash y el email nunca salen en el log ni en una
// respuesta de la API (solo el email, a un admin, en Usuarios).
const ROLES = ['admin', 'editor', 'lector'] as const;
export type Rol = (typeof ROLES)[number];
const NIVEL: Record<Rol, number> = { lector: 1, editor: 2, admin: 3 };

/** Si un rol llega a lo que pide una acción: admin > editor > lector. */
export const alcanza = (rol: Rol, necesario: Rol): boolean => NIVEL[rol] >= NIVEL[necesario];

const MIN_CONTRASENA = 12;

export type Usuario = {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  debe_cambiarla: boolean;
  activo: boolean;
  ultimo_acceso: string | null;
  creado_en: string;
};

type Fila = Omit<Usuario, 'debe_cambiarla' | 'activo'> & {
  debe_cambiarla: number;
  activo: number;
  hash: string;
  contrasena_en: string;
};

const COLUMNAS = 'id, email, nombre, rol, debe_cambiarla, activo, ultimo_acceso, creado_en';

const publico = (f: Omit<Fila, 'hash' | 'contrasena_en'>): Usuario => ({
  id: f.id,
  email: f.email,
  nombre: f.nombre,
  rol: f.rol,
  debe_cambiarla: f.debe_cambiarla === 1,
  activo: f.activo === 1,
  ultimo_acceso: f.ultimo_acceso,
  creado_en: f.creado_en,
});

// ─── Contraseñas ─────────────────────────────────────────────────────────────

const scrypt = promisify(crypto.scrypt) as (
  c: string,
  sal: Buffer,
  largo: number,
  o: crypto.ScryptOptions,
) => Promise<Buffer>;
// Una de las combinaciones equivalentes que da OWASP (N = 2^14, r = 8, p = 5): 16 MiB por intento
// en vez de los 128 MiB de N = 2^17, que con varios logins a la vez pesarían en el contenedor.
const COSTE = { N: 2 ** 14, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
const LARGO = 32;

/** «scrypt$N$r$p$sal$hash» en base64url: el coste va con el hash para poder subirlo sin romper los de antes. */
export async function hashContrasena(contrasena: string): Promise<string> {
  const sal = crypto.randomBytes(16);
  const h = await scrypt(contrasena, sal, LARGO, COSTE);
  return ['scrypt', COSTE.N, COSTE.r, COSTE.p, sal.toString('base64url'), h.toString('base64url')].join('$');
}

export async function contrasenaValida(contrasena: string, guardado: string): Promise<boolean> {
  const [alg, n, r, p, sal, h] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64url');
  const N = Number(n),
    R = Number(r),
    P = Number(p);
  const calculado = await scrypt(contrasena, Buffer.from(sal, 'base64url'), esperado.length, {
    N,
    r: R,
    p: P,
    maxmem: Math.max(COSTE.maxmem, 256 * N * R),
  });
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

// Para un email que no existe se compara igual contra un hash de relleno: si no, el tiempo de
// respuesta diría qué emails tienen cuenta.
let relleno: Promise<string> | null = null;
const hashDeRelleno = () => (relleno ??= hashContrasena(crypto.randomBytes(16).toString('hex')));

// ─── Validación ──────────────────────────────────────────────────────────────

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .pipe(z.email({ message: 'Escribe un email válido.' }));
// Dos letras como mínimo: es lo que firma en el historial (quien, de 2 a 60).
const Nombre = z.string().trim().min(2, 'El nombre necesita al menos dos letras.').max(60);
const Contrasena = z
  .string()
  .min(MIN_CONTRASENA, `La contraseña necesita al menos ${MIN_CONTRASENA} caracteres.`)
  .max(200);

const AltaUsuario = z.object({ email: Email, nombre: Nombre, rol: z.enum(ROLES), contrasena: Contrasena }).strict();
const CambioUsuario = z
  .object({
    email: Email.optional(),
    nombre: Nombre.optional(),
    rol: z.enum(ROLES).optional(),
    activo: z.boolean().optional(),
  })
  .strict();
const NuevaTemporal = z.object({ contrasena: Contrasena }).strict();
const CambioPropio = z.object({ actual: z.string().max(200), nueva: Contrasena }).strict();

const mensaje = (e: z.ZodError) => e.issues[0]?.message ?? 'Datos no válidos.';

// ─── Consultas ───────────────────────────────────────────────────────────────

export function listarUsuarios(db: Db): Usuario[] {
  return (
    db.prepare(`SELECT ${COLUMNAS} FROM usuarios ORDER BY activo DESC, nombre COLLATE NOCASE`).all() as Fila[]
  ).map(publico);
}

export function usuarioPorId(db: Db, id: number): Usuario | null {
  const f = db.prepare(`SELECT ${COLUMNAS} FROM usuarios WHERE id = ?`).get(id) as Fila | undefined;
  return f ? publico(f) : null;
}

/** El usuario de una sesión: activo y con la sesión abierta después de su último cambio de contraseña. */
export function usuarioDeSesion(db: Db, id: number, inicioS: number): Usuario | null {
  const f = db.prepare(`SELECT ${COLUMNAS}, contrasena_en FROM usuarios WHERE id = ? AND activo = 1`).get(id) as
    Fila | undefined;
  if (!f || Math.floor(Date.parse(f.contrasena_en) / 1000) > inicioS) return null;
  return publico(f);
}

const hayUsuarios = (db: Db): boolean => db.prepare('SELECT 1 FROM usuarios LIMIT 1').get() !== undefined;

/**
 * Si algún admin activo ya eligió su contraseña (la temporal que pone otro admin o el instalador no
 * cuenta). Mientras sea que sí, el acceso de emergencia (MONITOR_BASIC_AUTH_*) no entra: su
 * contraseña está en el `.env` y no puede seguir valiendo como llave maestra de quien ya tiene la suya.
 */
export function hayAdminConContrasenaPropia(db: Db): boolean {
  return (
    db.prepare("SELECT 1 FROM usuarios WHERE rol = 'admin' AND activo = 1 AND debe_cambiarla = 0 LIMIT 1").get() !==
    undefined
  );
}

function adminsActivos(db: Db, sin: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").get(sin) as {
      n: number;
    }
  ).n;
}

// ─── Acceso ──────────────────────────────────────────────────────────────────

/** Email y contraseña de una persona activa: el usuario o null, en tiempo parecido exista o no. */
export async function autenticar(db: Db, email: string, contrasena: string): Promise<Usuario | null> {
  const f = db
    .prepare(`SELECT ${COLUMNAS}, hash FROM usuarios WHERE email = ? AND activo = 1`)
    .get(email.trim().toLowerCase()) as Fila | undefined;
  const valida = await contrasenaValida(contrasena, f?.hash ?? (await hashDeRelleno()));
  return f && valida ? publico(f) : null;
}

export function anotarAcceso(db: Db, id: number): void {
  db.prepare('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?').run(ahora(), id);
}

/**
 * Al arrancar sin ningún usuario, el login de siempre (MONITOR_BASIC_AUTH_*) pasa a ser el primer
 * admin, que cambia la contraseña en su primer acceso. Su «email» es el usuario de siempre hasta
 * que lo cambie en Ajustes › Usuarios. Devuelve si lo creó.
 */
export async function sembrarPrimerAdmin(db: Db, usuario: string, contrasena: string): Promise<boolean> {
  if (!usuario || !contrasena || hayUsuarios(db)) return false;
  const hash = await hashContrasena(contrasena);
  const t = ahora();
  const r = db
    .prepare(
      `INSERT INTO usuarios (email, nombre, rol, hash, debe_cambiarla, contrasena_en, creado_en, actualizado_en)
    SELECT ?, ?, 'admin', ?, 1, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM usuarios)`,
    )
    .run(usuario.trim().toLowerCase(), usuario.trim(), hash, t, t, t);
  return r.changes === 1;
}

// ─── Gestión (Ajustes › Usuarios, solo admin) ────────────────────────────────

const EMAIL_REPETIDO = 'Ya hay un usuario con ese email.';

export async function crearUsuario(db: Db, datos: unknown): Promise<Result<Usuario>> {
  const v = AltaUsuario.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(v.data.email)) return fail('conflicto', EMAIL_REPETIDO);
  const hash = await hashContrasena(v.data.contrasena);
  const t = ahora();
  const r = db
    .prepare(
      `INSERT INTO usuarios (email, nombre, rol, hash, debe_cambiarla, contrasena_en, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(v.data.email, v.data.nombre, v.data.rol, hash, t, t, t);
  return ok(usuarioPorId(db, Number(r.lastInsertRowid))!);
}

export function cambiarUsuario(db: Db, id: number, datos: unknown): Result<Usuario> {
  const v = CambioUsuario.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  const previo = usuarioPorId(db, id);
  if (!previo) return fail('not_found', 'Ese usuario no existe.');
  const c = v.data;
  const dejaDeSerAdmin =
    previo.rol === 'admin' && previo.activo && ((c.rol && c.rol !== 'admin') || c.activo === false);
  if (dejaDeSerAdmin && adminsActivos(db, id) === 0)
    return fail('conflicto', 'Tiene que quedar al menos un admin activo.');
  if (c.email && c.email !== previo.email && db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(c.email))
    return fail('conflicto', EMAIL_REPETIDO);
  db.prepare(`UPDATE usuarios SET email = ?, nombre = ?, rol = ?, activo = ?, actualizado_en = ? WHERE id = ?`).run(
    c.email ?? previo.email,
    c.nombre ?? previo.nombre,
    c.rol ?? previo.rol,
    (c.activo ?? previo.activo) ? 1 : 0,
    ahora(),
    id,
  );
  return ok(usuarioPorId(db, id)!);
}

/** Contraseña temporal que pone un admin: la persona la cambia al entrar y sus sesiones abiertas se cierran. */
export async function restablecerContrasena(db: Db, id: number, datos: unknown): Promise<Result<Usuario>> {
  const v = NuevaTemporal.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  if (!usuarioPorId(db, id)) return fail('not_found', 'Ese usuario no existe.');
  const t = ahora();
  db.prepare(
    'UPDATE usuarios SET hash = ?, debe_cambiarla = 1, contrasena_en = ?, actualizado_en = ? WHERE id = ?',
  ).run(await hashContrasena(v.data.contrasena), t, t, id);
  return ok(usuarioPorId(db, id)!);
}

/**
 * Cada persona cambia la suya sabiendo la actual. Las demás sesiones abiertas dejan de valer; quien
 * llama vuelve a emitir la de este navegador. Devuelve el instante del cambio.
 */
export async function cambiarContrasenaPropia(
  db: Db,
  id: number,
  datos: unknown,
): Promise<Result<{ usuario: Usuario; cambiada_en: string }>> {
  const v = CambioPropio.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  const f = db.prepare('SELECT hash FROM usuarios WHERE id = ? AND activo = 1').get(id) as { hash: string } | undefined;
  if (!f || !(await contrasenaValida(v.data.actual, f.hash)))
    return fail('contrasena_incorrecta', 'La contraseña actual no es correcta.');
  if (v.data.actual === v.data.nueva) return fail('invalid_input', 'La nueva tiene que ser distinta de la actual.');
  const t = ahora();
  db.prepare(
    'UPDATE usuarios SET hash = ?, debe_cambiarla = 0, contrasena_en = ?, actualizado_en = ? WHERE id = ?',
  ).run(await hashContrasena(v.data.nueva), t, t, id);
  return ok({ usuario: usuarioPorId(db, id)!, cambiada_en: t });
}

/**
 * Recuperación de acceso desde la terminal del servidor: una contraseña temporal para un admin activo,
 * que la web le obliga a cambiar al entrar. Las sesiones que tuviera abiertas se cierran.
 */
export async function recuperarAdmin(
  db: Db,
  email: unknown,
): Promise<Result<{ usuario: Usuario; contrasena: string }>> {
  const v = Email.safeParse(email);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  const f = db.prepare(`SELECT ${COLUMNAS} FROM usuarios WHERE email = ?`).get(v.data) as Fila | undefined;
  if (!f || f.rol !== 'admin' || f.activo !== 1)
    return fail('not_found', 'No hay ningún administrador activo con ese email.');
  const contrasena = crypto.randomBytes(12).toString('base64url');
  const r = await restablecerContrasena(db, f.id, { contrasena });
  return r.error ? fail(r.error.code, r.error.message) : ok({ usuario: r.data, contrasena });
}
