// Autorización por ruta (criterio de hecho): cada persona entra con su email, un lector
// recibe 403 al guardar decisiones, un editor 403 al guardar el precio, solo un admin ve los
// usuarios, la contraseña temporal no deja usar la API, el historial firma con el nombre de la
// sesión y ni la contraseña ni el hash salen en respuestas ni en el log.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(agentes, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';
process.env.MONITOR_BASIC_AUTH_USERNAME = 'paco';
process.env.MONITOR_BASIC_AUTH_PASSWORD = 'contraseña-de-emergencia';
delete process.env.MONITOR_SESSION_SECRET;

const express = (await import('express')).default;
const auth = await import('../../src/nucleo/autenticacion.js');
const { autorizar, REGLAS, rolNecesario, rutaNormalizada } = await import('../../src/nucleo/permisos.js');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { rutasPlataforma } = await import('../../src/nucleo/rutas.js');
const { crearUsuario } = await import('../../src/nucleo/usuarios.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');

iniciarNucleo();
const db = dbLicitaciones();
let server: http.Server;
let base = '';

const CLAVE = 'contraseña-de-prueba-larga';
const PERSONAS = { admin: 'Paco Admin', editor: 'Elisa Editora', lector: 'Luis Lector' } as const;

before(async () => {
  await auth.usarUsuariosDe(nucleo().db);
  for (const [rol, nombre] of Object.entries(PERSONAS)) {
    await crearUsuario(nucleo().db, { email: `${rol}@example.com`, nombre, rol, contrasena: CLAVE });
  }
  nucleo().db.prepare("UPDATE usuarios SET debe_cambiarla = 0 WHERE email LIKE '%@example.com'").run();
  const app = express();
  app.use('/auth', auth.router);
  app.use('/api', auth.middleware, autorizar);
  app.use('/api/plataforma', rutasPlataforma());
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cookieDe = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
async function entrar(email: string, password = CLAVE): Promise<string> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: email, password }),
  });
  assert.equal(r.status, 204, `entra ${email}`);
  return cookieDe(r);
}
async function pedir(
  cookie: string,
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
): Promise<{ status: number; body: Record<string, unknown>; texto: string }> {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { cookie, 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  return { status: r.status, body: texto ? (JSON.parse(texto) as Record<string, unknown>) : {}, texto };
}

// La oferta de CASO_E (fixture seudonimizado de las comprobaciones) con su guion y unas decisiones sin precio.
type DecisionesData = import('../../src/dominios/licitaciones/oferta/decisiones.js').DecisionesData;
const CASO_E = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'licitaciones',
      'fixtures',
      'comprobaciones',
      'casoE.json',
    ),
    'utf8',
  ),
) as {
  licitacion: {
    titulo: string;
    presupuesto_sin_iva: number;
    lotes: { id: string; nombre: string; presupuesto_sin_iva: number }[];
  };
  oportunidad: { lotes_interes: string[] };
  guiones: { datos: unknown }[];
  decisiones: { datos: DecisionesData };
};
function oferta(id: string): DecisionesData {
  const lotes = CASO_E.licitacion.lotes.map((l) => ({ id: l.id, nombre: l.nombre, importe: l.presupuesto_sin_iva }));
  guardarLicitacion(db, {
    ...licitacion({
      titulo: CASO_E.licitacion.titulo,
      publicada: '2026-09-24',
      presupuesto: CASO_E.licitacion.presupuesto_sin_iva,
      lotes,
      limite: '2099-10-15T08:00:00',
    }),
    id,
    atom_id: `atom-${id}`,
  });
  const ts = new Date().toISOString();
  const interes = JSON.stringify(CASO_E.oportunidad.lotes_interes.map((x) => ({ id: x, motivo: 'criba' })));
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes, ts, ts);
  const guion = Number(
    db
      .prepare(
        "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 4, ?, 'oferta-licitaciones', 1, ?)",
      )
      .run(id, JSON.stringify(CASO_E.guiones.at(-1)!.datos), ts).lastInsertRowid,
  );
  const datos: DecisionesData = {
    ...CASO_E.decisiones.datos,
    equipo: [],
    ofertas: CASO_E.decisiones.datos.ofertas.map((o) => ({ ...o, pendiente: true, importe: null })),
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guion,
    JSON.stringify(datos),
    ts,
  );
  return datos;
}
const PRECIOS = [
  { lote: '2', pendiente: false, importe: 100, unitarios: [] },
  { lote: '4', pendiente: false, importe: 40, unitarios: [] },
];
const seccion = (id: string, s: string) => `/api/licitaciones/licitaciones/${id}/oferta/decisiones/${s}`;
const autores = (id: string) =>
  (
    db.prepare('SELECT autor FROM decisiones_historial WHERE licitacion_id = ? ORDER BY version').all(id) as {
      autor: string;
    }[]
  ).map((f) => f.autor);

test('should_give_403_to_a_lector_saving_decisions_but_let_them_read', async () => {
  const ID = 'p-30000001';
  const d = oferta(ID);
  const lector = await entrar('lector@example.com');
  assert.equal((await pedir(lector, 'GET', `/api/licitaciones/licitaciones/${ID}/oferta/decisiones`)).status, 200);
  const r = await pedir(lector, 'PATCH', seccion(ID, 'herramientas'), { version: 1, valor: d.herramientas });
  assert.equal(r.status, 403);
  assert.equal(r.body['error'], 'sin_permiso');
});

test('should_give_403_to_an_editor_saving_the_price_and_let_them_save_the_rest', async () => {
  const ID = 'p-30000002';
  const d = oferta(ID);
  const editor = await entrar('editor@example.com');
  const precio = await pedir(editor, 'PATCH', seccion(ID, 'precio'), { version: 1, valor: PRECIOS });
  assert.equal(precio.status, 403, String(precio.body['message']));
  assert.equal(precio.body['error'], 'sin_permiso');
  const herramientas = await pedir(editor, 'PATCH', seccion(ID, 'herramientas'), { version: 1, valor: d.herramientas });
  assert.equal(herramientas.status, 200, String(herramientas.body['message']));
  const entero = await pedir(editor, 'PUT', `/api/licitaciones/licitaciones/${ID}/oferta/decisiones`, {
    ...d,
    ofertas: PRECIOS,
  });
  assert.equal(entero.status, 403, 'tampoco con el PUT de todas las decisiones');
});

test('should_sign_the_history_with_the_session_name_not_with_what_the_body_says', async () => {
  const ID = 'p-30000003';
  oferta(ID);
  const admin = await entrar('admin@example.com');
  const r = await pedir(admin, 'PATCH', seccion(ID, 'precio'), { version: 1, valor: PRECIOS, quien: 'Otra Persona' });
  assert.equal(r.status, 200, String(r.body['message']));
  assert.deepEqual(autores(ID), [PERSONAS.admin]);
});

test('should_show_users_only_to_an_admin_and_never_the_hash', async () => {
  const editor = await entrar('editor@example.com');
  assert.equal((await pedir(editor, 'GET', '/api/plataforma/usuarios')).status, 403);
  assert.equal(
    (
      await pedir(editor, 'POST', '/api/plataforma/usuarios', {
        email: 'x@x.es',
        nombre: 'Equis',
        rol: 'admin',
        contrasena: CLAVE,
      })
    ).status,
    403,
  );
  const admin = await entrar('admin@example.com');
  const r = await pedir(admin, 'GET', '/api/plataforma/usuarios');
  assert.equal(r.status, 200);
  assert.ok(!r.texto.includes('scrypt') && !r.texto.includes('hash'), 'ni el hash ni su campo');
  const s = await pedir(admin, 'GET', '/auth/session');
  assert.deepEqual(
    [(s.body['usuario'] as { rol: string }).rol, (s.body['usuario'] as { nombre: string }).nombre],
    ['admin', PERSONAS.admin],
  );
});

test('should_keep_internal_costs_and_company_profile_for_admins', async () => {
  const editor = await entrar('editor@example.com');
  assert.equal((await pedir(editor, 'GET', '/api/plataforma/empresa/costes')).status, 403);
  assert.equal((await pedir(editor, 'PUT', '/api/plataforma/empresa', {})).status, 403);
  assert.equal((await pedir(editor, 'GET', '/api/plataforma/empresa')).status, 200, 'el perfil se puede leer');
});

test('should_block_the_api_until_the_temporary_password_is_changed', async () => {
  const admin = await entrar('admin@example.com');
  const alta = await pedir(admin, 'POST', '/api/plataforma/usuarios', {
    email: 'nueva@example.com',
    nombre: 'Nueva',
    rol: 'editor',
    contrasena: 'temporal-de-doce',
  });
  assert.equal(alta.status, 201);
  const nueva = await entrar('nueva@example.com', 'temporal-de-doce');
  const antes = await pedir(nueva, 'GET', '/api/plataforma/empresa');
  assert.equal(antes.status, 403);
  assert.equal(antes.body['error'], 'debe_cambiar_contrasena');
  const cambio = await fetch(`${base}/auth/contrasena`, {
    method: 'POST',
    headers: { cookie: nueva, 'content-type': 'application/json' },
    body: JSON.stringify({ actual: 'temporal-de-doce', nueva: 'la mía, larga y nueva' }),
  });
  assert.equal(cambio.status, 200);
  assert.ok(!(await cambio.clone().text()).includes('la mía'), 'la respuesta no repite la contraseña');
  assert.equal((await pedir(cookieDe(cambio), 'GET', '/api/plataforma/empresa')).status, 200);
  assert.equal(
    (await pedir(nueva, 'GET', '/api/plataforma/empresa')).status,
    401,
    'la cookie de antes del cambio ya no vale',
  );
});

test('should_close_the_old_login_once_the_first_admin_has_their_own_password', async () => {
  // El primer admin nace del login de siempre: hasta que cambia la contraseña, ese login es él.
  const primero = await entrar('paco', 'contraseña-de-emergencia');
  const s = await pedir(primero, 'GET', '/auth/session');
  assert.deepEqual(
    [
      (s.body['usuario'] as { emergencia: boolean }).emergencia,
      (s.body['usuario'] as { debe_cambiarla: boolean }).debe_cambiarla,
    ],
    [false, true],
  );
  const cambio = await fetch(`${base}/auth/contrasena`, {
    method: 'POST',
    headers: { cookie: primero, 'content-type': 'application/json' },
    body: JSON.stringify({ actual: 'contraseña-de-emergencia', nueva: 'la de paco, propia y larga' }),
  });
  assert.equal(cambio.status, 200);
  const antigua = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'paco', password: 'contraseña-de-emergencia' }),
  });
  assert.equal(antigua.status, 401, 'la contraseña del .env ya no entra');
});

test('should_apply_a_role_change_at_once_without_logging_in_again', async () => {
  const admin = await entrar('admin@example.com');
  const lista = (await pedir(admin, 'GET', '/api/plataforma/usuarios')).body['usuarios'] as {
    id: number;
    email: string;
  }[];
  const lector = lista.find((x) => x.email === 'lector@example.com')!;
  const cookie = await entrar('lector@example.com');
  assert.equal((await pedir(cookie, 'GET', '/api/plataforma/empresa/costes')).status, 403);
  await pedir(admin, 'PATCH', `/api/plataforma/usuarios/${lector.id}`, { rol: 'admin' });
  assert.equal((await pedir(cookie, 'GET', '/api/plataforma/empresa/costes')).status, 200);
  await pedir(admin, 'PATCH', `/api/plataforma/usuarios/${lector.id}`, { activo: false });
  assert.equal((await pedir(cookie, 'GET', '/api/plataforma/empresa')).status, 401, 'dada de baja, fuera');
});

test('should_never_write_passwords_hashes_or_emails_to_the_log', async () => {
  // Arrange: el logger escribe fuera de los tests; se recoge lo que saldría.
  const salida: string[] = [];
  const escribir = { out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
  const recoger = (c: string | Uint8Array) => {
    salida.push(String(c));
    return true;
  };
  process.stdout.write = recoger as typeof process.stdout.write;
  process.stderr.write = recoger as typeof process.stderr.write;
  process.env.NODE_ENV = 'desarrollo';
  try {
    // Act: un fallo, una entrada normal y el login del .env, que ya no entra.
    await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'editor@example.com', password: 'mala-contraseña-x' }),
    });
    await entrar('editor@example.com');
    await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'paco', password: 'contraseña-de-emergencia' }),
    });
  } finally {
    process.env.NODE_ENV = 'test';
    process.stdout.write = escribir.out;
    process.stderr.write = escribir.err;
  }
  // Assert
  const log = salida.join('');
  assert.match(log, /acceso de emergencia rechazado/, 'se ve que alguien probó la puerta de emergencia');
  for (const prohibido of [CLAVE, 'mala-contraseña-x', 'contraseña-de-emergencia', 'scrypt', 'editor@example.com'])
    assert.ok(!log.includes(prohibido), prohibido);
});

test('should_deny_writes_by_default_and_keep_the_console_for_admins', () => {
  assert.equal(
    rolNecesario('POST', '/api/licitaciones/algo/nuevo'),
    'editor',
    'una ruta nueva que escribe pide editor',
  );
  assert.equal(rolNecesario('GET', '/api/licitaciones/algo/nuevo'), 'lector');
  assert.equal(rolNecesario('GET', '/hermes-panel/chat'), 'admin');
  assert.equal(rolNecesario('GET', '/api/drive/connect'), 'admin', 'conectar Drive es un GET que cambia cosas');
  assert.equal(rolNecesario('POST', '/api/licitaciones/licitaciones/p-1/telemetria'), 'lector');
  assert.equal(
    rolNecesario('POST', '/api/licitaciones/licitaciones/p-1/oferta/impacto'),
    'lector',
    '«Qué cambia» solo calcula',
  );
  assert.equal(rolNecesario('POST', '/api/licitaciones/licitaciones/p-1/oferta/impacto/x'), 'editor', 'solo esa ruta');
  assert.equal(rolNecesario('POST', '/api/licitaciones/busquedas'), 'lector', 'cada uno guarda sus búsquedas');
});

test('should_let_only_an_admin_change_who_gets_the_weekly_summary', async () => {
  const cambio = { destinatarios: [1], dia: 1, hora: 8, secciones: { plazos: true } };
  const editor = await entrar('editor@example.com');
  assert.equal((await pedir(editor, 'PUT', '/api/plataforma/avisos/config', cambio)).status, 403);
  assert.equal((await pedir(editor, 'POST', '/api/plataforma/avisos/resumen/prueba', {})).status, 403);
  const leida = await pedir(editor, 'GET', '/api/plataforma/avisos/config');
  assert.equal(leida.status, 200, 'verlo, cualquiera');
  assert.ok(!leida.texto.includes('@example.com'), 'la lista de personas va sin emails');
  const admin = await entrar('admin@example.com');
  const r = await pedir(admin, 'PUT', '/api/plataforma/avisos/config', cambio);
  assert.equal(r.status, 200, String(r.body['message']));
  assert.deepEqual((r.body as { destinatarios: number[] }).destinatarios, [1]);
});

test('should_let_a_lector_keep_their_own_searches_and_alerts', async () => {
  const admin = await entrar('admin@example.com');
  const lista = (await pedir(admin, 'GET', '/api/plataforma/usuarios')).body['usuarios'] as {
    id: number;
    email: string;
    activo: boolean;
  }[];
  const id = lista.find((u) => u.email === 'editor@example.com')!.id;
  await pedir(admin, 'PATCH', `/api/plataforma/usuarios/${id}`, { rol: 'lector' });
  const lector = await entrar('editor@example.com');
  assert.equal(
    (
      await pedir(lector, 'POST', '/api/licitaciones/busquedas', {
        nombre: 'Formación',
        consulta: { texto: 'formación' },
      })
    ).status,
    201,
  );
  assert.equal((await pedir(lector, 'PUT', '/api/plataforma/yo/avisos', { caducidades: true })).status, 200);
  assert.equal(
    (
      await pedir(lector, 'PATCH', '/api/licitaciones/licitaciones/p-1/oferta/decisiones/herramientas', {
        version: 1,
        valor: [],
      })
    ).status,
    403,
    'lo demás sigue cerrado',
  );
});

// La misma ruta escrita de otra forma: Express la sirve igual (no distingue mayúsculas y tolera «//»).
const variantes = (r: string): string[] => {
  const ultimo = r.split('/').at(-1)!;
  const codificado = `%${ultimo.charCodeAt(0).toString(16).toUpperCase()}${ultimo.slice(1)}`;
  return [
    r,
    r.toUpperCase(),
    r.replace(/\/([^/]+)$/, (_m, x: string) => `/${x[0]!.toUpperCase()}${x.slice(1)}`),
    r.replace(/^\/([^/]+)\//, '/$1//'),
    `${r}/`,
    r.replace(/[^/]+$/, codificado),
    r.replace(/^\/([^/]+)\//, '/$1/./'),
    r.replace(/^\/([^/]+)\//, '/$1/otra/../'),
  ];
};

test('should_apply_every_rule_to_its_path_written_in_any_case_or_with_extra_slashes', () => {
  assert.ok(REGLAS.length >= 10);
  for (const regla of REGLAS) {
    const metodos = regla.metodos === 'lectura' ? ['GET'] : regla.metodos === 'escritura' ? ['POST'] : ['GET', 'POST'];
    for (const ruta of variantes(regla.ejemplo))
      for (const m of metodos) {
        assert.equal(rolNecesario(m, ruta), regla.rol, `${m} ${ruta} (regla de ${regla.ejemplo})`);
      }
  }
  assert.equal(rutaNormalizada('/api/%E0%A4%A'), null);
  assert.equal(rolNecesario('GET', '/api/%E0%A4%A'), 'admin', 'lo que no se puede decodificar pide lo más');
});

test('should_not_let_an_editor_into_admin_routes_by_changing_case_or_slashes', async () => {
  const admin = await entrar('admin@example.com');
  const lista = (await pedir(admin, 'GET', '/api/plataforma/usuarios')).body['usuarios'] as {
    id: number;
    email: string;
  }[];
  const nuevo = await pedir(admin, 'POST', '/api/plataforma/usuarios', {
    email: 'otra.editora@example.com',
    nombre: 'Otra Editora',
    rol: 'editor',
    contrasena: CLAVE,
  });
  assert.equal(nuevo.status, 201);
  nucleo().db.prepare("UPDATE usuarios SET debe_cambiarla = 0 WHERE email = 'otra.editora@example.com'").run();
  const e = await entrar('otra.editora@example.com');
  for (const [metodo, ruta, cuerpo] of [
    ['GET', '/api/plataforma/Usuarios'],
    ['GET', '/API/plataforma/usuarios'],
    ['GET', '/api/Plataforma/usuarios'],
    [
      'POST',
      '/api/plataforma/Usuarios',
      { email: 'colado@example.com', nombre: 'Colado', rol: 'admin', contrasena: CLAVE },
    ],
    ['PUT', '/api/plataforma/Avisos/config', { destinatarios: [], dia: 1, hora: 8, secciones: {} }],
    ['GET', '/api/plataforma/empresa/Costes'],
    ['GET', '/api/plataforma//empresa/costes'],
    ['GET', '/api/plataforma/empresa/costes/'],
  ] as [string, string, unknown?][]) {
    assert.equal((await pedir(e, metodo, ruta, cuerpo)).status, 403, `${metodo} ${ruta}`);
  }
  assert.ok(lista.length > 0);
  assert.ok(!(await pedir(admin, 'GET', '/api/plataforma/usuarios')).texto.includes('colado@'), 'no se creó nadie');
});
