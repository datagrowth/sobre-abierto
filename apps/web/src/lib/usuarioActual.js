// Quién usa la web y con qué rol, según /auth/session. El servidor es quien autoriza; esto
// solo evita enseñar como disponible lo que va a dar 403 (un lector ve los botones que guardan
// desactivados). Sin login (la instalación no pide usuario) no hay persona: se actúa como admin. Sin React.

export const ROLES = ['admin', 'editor', 'lector'];
const NIVEL = { lector: 1, editor: 2, admin: 3 };

export const NOMBRE_ROL = { admin: 'Admin', editor: 'Editor', lector: 'Lector' };

/** La tabla «Qué puede hacer cada uno» de Ajustes › Usuarios: [qué, admin, editor, lector]. */
export const QUE_PUEDE = [
  ['Ver todo', true, true, true],
  ['Aplicar oportunidades, preparar ofertas, decidir (salvo el precio), memoria y lecciones', true, true, false],
  ['Decidir el precio', true, false, false],
  ['Empresa, costes internos, usuarios, avisos, Drive y la Consola de Hermes', true, false, false],
];

let actual = null;
const oyentes = new Set();

export const usuarioActual = () => actual;

export function suscribirUsuario(avisar) {
  oyentes.add(avisar);
  return () => oyentes.delete(avisar);
}

/** Se queda solo con lo que conoce; un rol raro cuenta como lector (lo mínimo). */
export function fijarUsuario(datos) {
  actual =
    datos && typeof datos === 'object'
      ? Object.freeze({
          id: Number(datos.id) || 0,
          nombre: typeof datos.nombre === 'string' ? datos.nombre : '',
          email: typeof datos.email === 'string' ? datos.email : null,
          rol: ROLES.includes(datos.rol) ? datos.rol : 'lector',
          emergencia: datos.emergencia === true,
          debe_cambiarla: datos.debe_cambiarla === true,
        })
      : null;
  oyentes.forEach((avisar) => avisar());
  return actual;
}

/** Si la persona llega al rol que pide algo. Sin persona (monitor sin login), sí. */
export function puede(usuario, necesario) {
  if (!usuario) return true;
  return (NIVEL[usuario.rol] ?? 0) >= (NIVEL[necesario] ?? 99);
}

export const esAdmin = (usuario) => puede(usuario, 'admin');

/** Lo que dice el botón desactivado a quien no puede guardar. */
export const SOLO_VER = 'Con permiso de lector puedes ver, pero no guardar. Pídele a un admin otro permiso.';

export const MIN_CONTRASENA = 12;

/** Lo que falla de una contraseña nueva antes de mandarla (el servidor lo vuelve a comprobar), o null. */
export function problemaContrasena(nueva, repetida) {
  if (String(nueva ?? '').length < MIN_CONTRASENA)
    return `La contraseña necesita al menos ${MIN_CONTRASENA} caracteres.`;
  if (repetida !== undefined && nueva !== repetida) return 'Las dos contraseñas no coinciden.';
  return null;
}

// Sin letras que se confunden al dictarlas o copiarlas (0/O, 1/l/I).
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Una contraseña temporal para el alta: 16 caracteres al azar en grupos de 4 («abcd-efgh-…»). */
export function contrasenaTemporal(azar = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const letras = Array.from(azar(16), (x) => ALFABETO[x % ALFABETO.length]).join('');
  return letras.match(/.{4}/g).join('-');
}

/** El estado de un usuario en la tabla de Ajustes › Usuarios. */
export function estadoUsuario(u) {
  if (!u.activo) return { texto: 'De baja', tono: 'neutro' };
  if (u.debe_cambiarla) return { texto: 'Falta su primer acceso', tono: 'riesgo' };
  return { texto: 'Activo', tono: 'ok' };
}

/** Las iniciales para el avatar: «Ana García» → «AG». */
export function iniciales(nombre) {
  const partes = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    partes
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('') || '?'
  );
}
