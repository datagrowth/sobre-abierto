// Colaboradores de punta a punta: alta y edición en la web, alta desde CV (trabajo para
// Hermes → colaboradores_proponer_perfil por MCP → pendiente → aprobación), permisos del
// dominio nuevo, esquema estricto de la tool y datos personales fuera de logs, eventos y auditoría.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'colaboradores-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(path.join(conocimiento, 'Colaboradores'), { recursive: true });
fs.mkdirSync(agentes);
fs.writeFileSync(
  path.join(conocimiento, 'Colaboradores', 'cv-zoe.md'),
  '# CV\nIngeniera informática con 7 años de experiencia.\n',
);
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
const T_CURIOSO = 'k'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
fs.writeFileSync(path.join(agentes, 'curioso.token'), T_CURIOSO);
fs.writeFileSync(path.join(agentes, 'permisos.json'), JSON.stringify({ curioso: { colaboradores: 'ninguno' } }));
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { herramientasColaboradores } = await import('../../src/nucleo/colaboradores/tools.js');
const { rutasColaboradores } = await import('../../src/nucleo/colaboradores/rutas.js');
const { listarPersonas } = await import('../../src/nucleo/colaboradores/personas.js');
const { buscarCandidatos } = await import('../../src/nucleo/colaboradores/busqueda.js');
const { instruccionesPerfilCv, perfilRecibido, listarPropuestas, PayloadPerfilCv } =
  await import('../../src/nucleo/colaboradores/propuestas.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { permisosDe, puede } = await import('../../src/nucleo/agentes/permisos.js');
const { usosRecientes } = await import('../../src/nucleo/agentes/auditoria.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { cvEnDisco, hashCv, TIPO_PERFIL_CV } = await import('../../src/nucleo/colaboradores/cvs.js');
const { registrarTipoTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { fijarRutaBiblioteca, restablecerRutaBiblioteca } = await import('../../src/biblioteca/motor/configuracion.js');

iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
anadirHerramientas(herramientasColaboradores);
anadirHerramientas(herramientasLicitaciones);

let server: http.Server;
let base = '';
let mcp = '';
const json = { 'content-type': 'application/json' };
const CV = 'Colaboradores/cv-zoe.md';
const NOMBRE = 'Zoe Ejemplar Secreta';

before(() => {
  const app = express();
  app.use('/api/colaboradores', rutasColaboradores());
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  server = escucharLocal(http.createServer(app));
  const puerto = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${puerto}/api/colaboradores`;
  mcp = `http://127.0.0.1:${puerto}/mcp`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcp), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

function texto(r: { content: unknown }): string {
  return (r.content as { type: string; text: string }[])[0]?.text ?? '';
}

const LUIS = {
  nombre: 'Luis Prueba',
  tipo: 'interno',
  rol: 'Jefe de proyecto',
  titulaciones: ['Grado en Ingeniería Informática'],
  certificaciones: ['PMP'],
  anios_experiencia: 8,
  tecnologias: ['Python'],
  idiomas: [{ idioma: 'Inglés', nivel: 'B2' }],
  disponibilidad: 'parcial',
  tarifa_hora: 55,
};

test('should_let_only_licitaciones_agents_and_claude_code_read_collaborators_and_only_hermes_profiles_propose', () => {
  assert.equal(puede(permisosDe('claude-code'), 'colaboradores', 'leer'), true);
  assert.equal(puede(permisosDe('cualquiera'), 'colaboradores', 'leer'), false);
  assert.equal(puede(permisosDe('claude-code'), 'colaboradores', 'proponer'), false);
  assert.equal(puede(permisosDe('licitaciones'), 'colaboradores', 'proponer'), true);
  assert.equal(puede(permisosDe('hermes'), 'colaboradores', 'proponer'), false);
  assert.equal(puede(permisosDe('curioso', { curioso: { colaboradores: 'ninguno' } }), 'colaboradores', 'leer'), false);
});

test('should_create_list_update_and_delete_people_validating_the_input', async () => {
  const mal = await fetch(base, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ ...LUIS, email: 'luis@example.com' }),
  });
  assert.equal(mal.status, 400, 'datos de contacto: fuera del esquema');
  const cvFuera = await fetch(base, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ ...LUIS, cv_ruta: '../secretos/cv.pdf' }),
  });
  assert.equal(cvFuera.status, 400);
  const alta = await fetch(base, { method: 'POST', headers: json, body: JSON.stringify(LUIS) });
  const luis = (await alta.json()) as { id: number; activo: boolean; sectores: string[] };
  assert.equal(alta.status, 201);
  assert.equal(luis.activo, true);
  assert.deepEqual(luis.sectores, []);
  const externa = await fetch(base, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ nombre: 'Eva Prueba', tipo: 'externo', tecnologias: ['Power BI'] }),
  });
  assert.equal(externa.status, 201);
  const lista = (await (await fetch(`${base}?tipo=interno`)).json()) as { items: { nombre: string }[] };
  assert.deepEqual(
    lista.items.map((p) => p.nombre),
    ['Luis Prueba'],
  );
  const porTexto = (await (await fetch(`${base}?texto=power`)).json()) as { items: { nombre: string }[] };
  assert.deepEqual(
    porTexto.items.map((p) => p.nombre),
    ['Eva Prueba'],
  );
  assert.equal((await fetch(`${base}?tipo=jefe`)).status, 400);
  const cambio = await fetch(`${base}/${luis.id}`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ ...LUIS, activo: false }),
  });
  assert.equal(cambio.status, 200);
  assert.equal(
    ((await (await fetch(base)).json()) as { items: unknown[] }).items.length,
    1,
    'los inactivos no salen por defecto',
  );
  assert.equal(((await (await fetch(`${base}?inactivos=1`)).json()) as { items: unknown[] }).items.length, 2);
  assert.equal((await fetch(`${base}/abc`)).status, 400);
  assert.equal((await fetch(`${base}/9999`)).status, 404);
  assert.equal((await fetch(`${base}/${luis.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/${luis.id}`)).status, 404);
});

test('should_queue_one_cv_reading_per_cv_only_for_files_in_the_library', async () => {
  const falta = await fetch(`${base}/desde-cv`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ cv_ruta: 'Colaboradores/no-existe.pdf' }),
  });
  assert.equal(falta.status, 404);
  const fuera = await fetch(`${base}/desde-cv`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ cv_ruta: 'Licitaciones/pliego.pdf' }),
  });
  assert.equal(fuera.status, 400);
  const uno = (await (
    await fetch(`${base}/desde-cv`, { method: 'POST', headers: json, body: JSON.stringify({ cv_ruta: CV }) })
  ).json()) as { trabajo: number };
  const otro = (await (
    await fetch(`${base}/desde-cv`, { method: 'POST', headers: json, body: JSON.stringify({ cv_ruta: CV }) })
  ).json()) as { trabajo: number };
  assert.equal(uno.trabajo, otro.trabajo, 'no duplica uno en cola');
  const fila = nucleo().db.prepare('SELECT tipo, clave, payload FROM trabajos_ia WHERE id = ?').get(uno.trabajo) as {
    tipo: string;
    clave: string;
    payload: string;
  };
  assert.equal(fila.tipo, 'colaboradores.perfil_cv');
  assert.ok(!fila.clave.includes('zoe'), 'la clave (Idempotency-Key) no lleva el nombre del archivo');
  const payload = PayloadPerfilCv.parse(JSON.parse(fila.payload));
  assert.match(
    instruccionesPerfilCv(payload, 'Analítica Ejemplo'),
    /colaboradores_proponer_perfil \(cv_ruta=Colaboradores\/cv-zoe\.md\)/,
  );
  assert.equal(perfilRecibido(nucleo().db, CV, payload.pedida_en), false);
});

const PERFIL = {
  nombre: NOMBRE,
  tipo: 'externo',
  rol: 'Científica de datos',
  titulaciones: ['Grado en Ingeniería Informática'],
  certificaciones: [],
  anios_experiencia: 7,
  sectores: ['sanidad'],
  cpv: ['72'],
  tecnologias: ['Python', 'Spark'],
  idiomas: [{ idioma: 'Inglés', nivel: 'C1' }],
};

test('should_offer_each_agent_only_the_collaborator_tools_it_may_use', async () => {
  const lici = await conectar(T_LICI);
  const claude = await conectar(T_CLAUDE);
  const curioso = await conectar(T_CURIOSO);
  try {
    const deLici = (await lici.listTools()).tools.map((t) => t.name);
    const deClaude = (await claude.listTools()).tools.map((t) => t.name);
    const deCurioso = (await curioso.listTools()).tools.map((t) => t.name);
    assert.ok(
      ['colaboradores_buscar', 'colaboradores_ver', 'colaboradores_proponer_perfil', 'licitaciones_equipo'].every((t) =>
        deLici.includes(t),
      ),
    );
    assert.ok(deClaude.includes('colaboradores_buscar') && !deClaude.includes('colaboradores_proponer_perfil'));
    assert.ok(!deCurioso.some((t) => t.startsWith('colaboradores_')), 'sin permiso no ve los colaboradores');
    assert.ok(!deCurioso.includes('licitaciones_equipo'), 'el equipo devuelve personas: tampoco');
    assert.ok(deCurioso.includes('licitaciones_ver'));
  } finally {
    await lici.close();
    await claude.close();
    await curioso.close();
  }
});

test('should_reject_profiles_that_do_not_fit_the_strict_schema', async () => {
  const client = await conectar(T_LICI);
  try {
    const conEmail = await client.callTool({
      name: 'colaboradores_proponer_perfil',
      arguments: { cv_ruta: CV, perfil: { ...PERFIL, email: 'zoe@example.com' } },
    });
    assert.equal(conEmail.isError, true);
    const sinNombre = await client.callTool({
      name: 'colaboradores_proponer_perfil',
      arguments: { cv_ruta: CV, perfil: { ...PERFIL, nombre: undefined } },
    });
    assert.equal(sinNombre.isError, true);
    const nivel = await client.callTool({
      name: 'colaboradores_proponer_perfil',
      arguments: { cv_ruta: CV, perfil: { ...PERFIL, idiomas: [{ idioma: 'Inglés', nivel: 'alto' }] } },
    });
    assert.equal(nivel.isError, true);
    const fuera = await client.callTool({
      name: 'colaboradores_proponer_perfil',
      arguments: { cv_ruta: 'Empresa/cv.pdf', perfil: PERFIL },
    });
    assert.equal(fuera.isError, true);
    const nadie = await client.callTool({
      name: 'colaboradores_proponer_perfil',
      arguments: { cv_ruta: CV, persona_id: 9999, perfil: PERFIL },
    });
    assert.equal(nadie.isError, true);
    assert.match(texto(nadie), /No hay ningún colaborador/);
    assert.equal(listarPropuestas(nucleo().db).length, 0);
  } finally {
    await client.close();
  }
});

type Propuesta = { id: number; actualizada_en: string; persona_id: number | null; perfil: { nombre: string } };

async function proponer(perfil: Record<string, unknown>): Promise<Propuesta> {
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({ name: 'colaboradores_proponer_perfil', arguments: { cv_ruta: CV, perfil } });
    assert.equal(r.isError, undefined, texto(r));
  } finally {
    await client.close();
  }
  const pendientes = (await (await fetch(`${base}/propuestas`)).json()) as Propuesta[];
  assert.equal(pendientes.length, 1);
  return pendientes[0]!;
}

test('should_keep_the_proposed_profile_pending_until_a_person_approves_the_version_seen', async () => {
  const p = await proponer(PERFIL);
  assert.equal(p.perfil.nombre, NOMBRE);
  assert.equal(perfilRecibido(nucleo().db, CV, '2000-01-01T00:00:00.000Z'), true);
  const viejo = await fetch(`${base}/propuestas/${p.id}/revision`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ decision: 'aprobar', version: '2000-01-01T00:00:00.000Z' }),
  });
  assert.equal(viejo.status, 409);
  const ok = await fetch(`${base}/propuestas/${p.id}/revision`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ decision: 'aprobar', version: p.actualizada_en }),
  });
  const r = (await ok.json()) as { estado: string; persona: number };
  assert.equal(r.estado, 'aprobada');
  const zoe = (await (await fetch(`${base}/${r.persona}`)).json()) as {
    cv_ruta: string;
    tipo: string;
    anios_experiencia: number;
  };
  assert.equal(zoe.cv_ruta, CV);
  assert.equal(zoe.anios_experiencia, 7);
  assert.equal(
    (
      await fetch(`${base}/propuestas/${p.id}/revision`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ decision: 'aprobar', version: p.actualizada_en }),
      })
    ).status,
    404,
  );
});

test('should_update_the_same_person_when_a_new_cv_reading_of_her_arrives_keeping_what_a_cv_does_not_say', async () => {
  const [zoe] = listarPersonas(nucleo().db, { inactivos: false, texto: 'Científica' });
  await fetch(`${base}/${zoe!.id}`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ ...PERFIL, cv_ruta: CV, disponibilidad: 'parcial', tarifa_hora: 60 }),
  });
  const p = await proponer({ ...PERFIL, anios_experiencia: 8 });
  assert.equal(p.persona_id, zoe!.id, 'mismo CV → misma persona');
  const editada = { ...PERFIL, anios_experiencia: 9, cv_ruta: CV, disponibilidad: 'parcial', tarifa_hora: 60 };
  const r = (await (
    await fetch(`${base}/propuestas/${p.id}/revision`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        decision: 'aprobar',
        version: p.actualizada_en,
        persona: { ...editada, anios_experiencia: -1 },
      }),
    })
  ).json()) as { error: string };
  assert.equal(r.error, 'invalid_input', 'la ficha corregida se valida entera');
  const bien = (await (
    await fetch(`${base}/propuestas/${p.id}/revision`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ decision: 'aprobar', version: p.actualizada_en, persona: editada }),
    })
  ).json()) as { persona: number };
  assert.equal(bien.persona, zoe!.id);
  const ahora = (await (await fetch(`${base}/${zoe!.id}`)).json()) as {
    anios_experiencia: number;
    tarifa_hora: number;
  };
  assert.equal(ahora.anios_experiencia, 9);
  assert.equal(ahora.tarifa_hora, 60);
  assert.equal(listarPersonas(nucleo().db, { inactivos: true }).filter((x) => x.cv_ruta === CV).length, 1);
});

test('should_find_candidates_for_free_text_through_the_web_and_mcp', async () => {
  const web = await fetch(`${base}/buscar`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ texto: 'Científico de datos con Python e inglés C1, 5 años de experiencia' }),
  });
  const r = (await web.json()) as { requisitos: { externos: { nombre: string; cumple_minimos: boolean }[] }[] };
  assert.equal(web.status, 200);
  assert.equal(r.requisitos[0]?.externos[0]?.nombre, NOMBRE);
  assert.equal(r.requisitos[0]?.externos[0]?.cumple_minimos, true);
  assert.equal(
    (await fetch(`${base}/buscar`, { method: 'POST', headers: json, body: JSON.stringify({}) })).status,
    400,
  );
  const client = await conectar(T_CLAUDE);
  try {
    const t = await client.callTool({
      name: 'colaboradores_buscar',
      arguments: { requisitos: ['Experto en Spark'], tipo: 'externo' },
    });
    assert.equal(t.isError, undefined);
    assert.match(texto(t), /Spark/);
    const vacio = await client.callTool({ name: 'colaboradores_buscar', arguments: { limite: 3 } });
    assert.equal(vacio.isError, true);
    const quince = Array.from(
      { length: 15 },
      (_, i) => `Científico de datos con Python e inglés C1 y ${i + 3} años de experiencia en proyectos públicos`,
    );
    const largo = texto(
      await client.callTool({ name: 'colaboradores_buscar', arguments: { requisitos: quince, limite: 20 } }),
    );
    assert.doesNotMatch(largo, /recortada/, 'una ficha con muchos perfiles necesita la respuesta entera');
    assert.equal((JSON.parse(largo) as { requisitos: unknown[] }).requisitos.length, 15);
  } finally {
    await client.close();
  }
});

test('should_keep_working_with_rules_only_when_the_library_search_fails', async () => {
  const caida = async () => ({ data: null, error: { code: 'biblioteca_no_disponible', message: 'sin índice' } });
  const r = await buscarCandidatos(nucleo().db, { texto: 'Experta en Python', limite: 5 }, caida);
  assert.equal(r.data?.busqueda_semantica, false);
  assert.match(r.data?.aviso ?? '', /solo reglas/);
  assert.equal(r.data?.requisitos[0]?.externos[0]?.nombre, NOMBRE);
});

/** Lo que escribe el logger mientras corre `fn` (en test no escribe: se pasa a development). */
async function logDe(fn: () => Promise<void>): Promise<string> {
  const escrito: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.env.NODE_ENV = 'development';
  // Solo se quedan las líneas del logger; lo demás (el protocolo del runner de tests) sigue su camino.
  const capturar = (original: typeof out) =>
    ((c: string | Uint8Array, ...resto: never[]) => {
      if (typeof c === 'string' && c.startsWith('{"ts"')) {
        escrito.push(c);
        return true;
      }
      return original(c, ...resto);
    }) as typeof process.stdout.write;
  process.stdout.write = capturar(out);
  process.stderr.write = capturar(err);
  try {
    await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    process.env.NODE_ENV = 'test';
  }
  return escrito.join('');
}

test('should_never_write_personal_data_to_logs_events_or_audit', async () => {
  const log = await logDe(async () => {
    // Una ficha guardada que ya no valida avisa en el log: solo con su id y los campos.
    nucleo()
      .db.prepare(
        "INSERT INTO personas (nombre, tipo, activo, cv_ruta, datos, creada_en, actualizada_en) VALUES (?, 'externo', 1, NULL, ?, 'x', 'x')",
      )
      .run('Persona Rota Confidencial', JSON.stringify({ nombre: 'Persona Rota Confidencial', tipo: 'otro' }));
    listarPersonas(nucleo().db);
    const client = await conectar(T_LICI);
    try {
      await client.callTool({ name: 'colaboradores_ver', arguments: {} });
      await client.callTool({ name: 'colaboradores_buscar', arguments: { texto: `Busco a ${NOMBRE}` } });
    } finally {
      await client.close();
    }
  });
  assert.match(log, /persona guardada no válida/, 'el aviso sí sale');
  assert.ok(!/Confidencial|Zoe|Ejemplar|cv-zoe/.test(log), log);
  const auditoria = JSON.stringify(usosRecientes(nucleo().db, 200));
  const eventos = JSON.stringify(ultimosEventos(nucleo().db, 200));
  assert.ok(auditoria.includes('colaboradores_proponer_perfil'));
  assert.ok(!/Zoe|Ejemplar|cv-zoe|Luis|Eva/.test(auditoria), auditoria);
  assert.ok(!/Zoe|Ejemplar|cv-zoe|Luis|Eva/.test(eventos), eventos);
});

function escribirCv(nombre: string): string {
  fs.writeFileSync(path.join(conocimiento, 'Colaboradores', nombre), '# CV\nConsultora con 6 años de experiencia.\n');
  return `Colaboradores/${nombre}`;
}

async function pedirLectura(cvRuta: string, personaId?: number): Promise<number> {
  const r = await fetch(`${base}/desde-cv`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(personaId ? { cv_ruta: cvRuta, persona_id: personaId } : { cv_ruta: cvRuta }),
  });
  return r.status;
}

async function enviarPerfil(cvRuta: string, perfil: Record<string, unknown>): Promise<Propuesta> {
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({ name: 'colaboradores_proponer_perfil', arguments: { cv_ruta: cvRuta, perfil } });
    assert.equal(r.isError, undefined, texto(r));
  } finally {
    await client.close();
  }
  return listarPropuestas(nucleo().db).find((p) => p.cv_ruta === cvRuta) as unknown as Propuesta;
}

async function decidir(p: Propuesta, decision: 'aprobar' | 'rechazar'): Promise<{ persona: number | null }> {
  const r = await fetch(`${base}/propuestas/${p.id}/revision`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ decision, version: p.actualizada_en }),
  });
  assert.equal(r.status, 200);
  return (await r.json()) as { persona: number | null };
}

test('should_reject_cv_paths_with_backslashes_or_drive_letters_and_never_leave_the_library', async () => {
  assert.equal(await pedirLectura('Colaboradores/x\\..\\..\\..\\..\\Windows\\win.ini'), 400);
  const conUnidad = await fetch(base, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ ...LUIS, cv_ruta: 'Colaboradores/C:/secreto.pdf' }),
  });
  assert.equal(conUnidad.status, 400);
  assert.equal(cvEnDisco(conocimiento, 'Colaboradores/../../secreto.pdf'), null);
  assert.equal(cvEnDisco(conocimiento, CV), path.join(conocimiento, 'Colaboradores', 'cv-zoe.md'));
});

test('should_not_read_cvs_from_a_library_folder_saved_in_the_web_settings_when_VAULT_PATH_is_fixed', async () => {
  const otra = path.join(tmp, 'otra-biblioteca');
  fs.mkdirSync(path.join(otra, 'Colaboradores'), { recursive: true });
  fs.writeFileSync(path.join(otra, 'nota.md'), '# Nota\n');
  fs.writeFileSync(path.join(otra, 'Colaboradores', 'cv-solo-en-ajustes.md'), '# CV\n');
  fijarRutaBiblioteca(otra);
  try {
    assert.notEqual(
      await pedirLectura('Colaboradores/cv-solo-en-ajustes.md'),
      202,
      'manda VAULT_PATH: el CV de la otra carpeta no existe para la plataforma',
    );
  } finally {
    restablecerRutaBiblioteca();
  }
});

test('should_hide_cvs_from_agents_that_cannot_read_collaborators_and_audit_cv_paths_as_a_hash', async () => {
  const curioso = await conectar(T_CURIOSO);
  const lici = await conectar(T_LICI);
  try {
    const leer = await curioso.callTool({ name: 'biblioteca_leer', arguments: { ruta: CV } });
    assert.equal(leer.isError, true);
    assert.match(texto(leer), /forbidden/);
    const buscar = await curioso.callTool({
      name: 'biblioteca_buscar',
      arguments: { consulta: 'ingeniera', carpeta: 'colaboradores' },
    });
    assert.equal(buscar.isError, true);
    const suyo = await lici.callTool({ name: 'biblioteca_leer', arguments: { ruta: CV } });
    assert.equal(suyo.isError, undefined, texto(suyo));
    assert.match(texto(suyo), /7 años de experiencia/);
    const nota = await lici.callTool({
      name: 'biblioteca_proponer',
      arguments: { titulo: 'Resumen del CV', contenido: 'x', fuente: CV },
    });
    assert.equal(nota.isError, true, 'los CV no se convierten en notas');
  } finally {
    await curioso.close();
    await lici.close();
  }
  const usos = usosRecientes(nucleo().db, 50).filter(
    (u) => u.herramienta === 'biblioteca_leer' || u.herramienta === 'biblioteca_proponer',
  );
  assert.equal(usos.length, 3);
  assert.ok(
    usos.every((u) => u.recurso === `Colaboradores/${hashCv(CV)}`),
    JSON.stringify(usos),
  );
});

test('should_erase_every_trace_of_a_deleted_person_including_profiles_rejected_before_her_signup', async () => {
  const cv = escribirCv('cv-eva-borrable.md');
  assert.equal(await pedirLectura(cv), 202);
  await decidir(await enviarPerfil(cv, { ...PERFIL, nombre: 'Eva Borrable Secreta' }), 'rechazar');
  const { persona } = await decidir(await enviarPerfil(cv, { ...PERFIL, nombre: 'Eva Borrable Secreta' }), 'aprobar');
  assert.equal((await fetch(`${base}/${persona}`, { method: 'DELETE' })).status, 200);
  const db = nucleo().db;
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM personas_propuestas WHERE cv_ruta = ?').get(cv) as { n: number }).n,
    0,
  );
  const trabajos = db
    .prepare("SELECT estado, payload FROM trabajos_ia WHERE tipo = 'colaboradores.perfil_cv'")
    .all() as { estado: string; payload: string }[];
  assert.ok(!JSON.stringify(trabajos).includes('cv-eva-borrable'), JSON.stringify(trabajos));
  assert.ok(
    trabajos.some((t) => t.estado === 'cancelado' && t.payload.includes(hashCv(cv))),
    'la lectura pendiente se cancela',
  );
});

test('should_stop_the_running_cv_reading_of_a_deleted_person_and_reject_its_late_profile', async () => {
  // Hermes simulado: solo recibe la orden de parar el run.
  const paradas: string[] = [];
  const hermes = escucharLocal(
    http.createServer((req, res) => {
      paradas.push(req.url ?? '');
      res.writeHead(200, json).end('{}');
    }),
  );
  const puerto = (hermes.address() as AddressInfo).port;
  registrarTipoTrabajo(TIPO_PERFIL_CV, {
    destino: () => ({ url: `http://127.0.0.1:${puerto}`, key: 'h'.repeat(20) }),
    instrucciones: () => 'lee',
    hecho: () => false,
  });
  try {
    const cv = escribirCv('cv-iker-borrable.md');
    const { persona } = await decidir(
      await enviarPerfil(cv, { ...PERFIL, nombre: 'Iker Borrable Secreto' }),
      'aprobar',
    );
    assert.equal(await pedirLectura(cv, persona!), 202);
    const db = nucleo().db;
    db.prepare(
      "UPDATE trabajos_ia SET estado = 'lanzado', run_id = 'run_cv_iker' WHERE tipo = ? AND json_extract(payload, '$.cv_ruta') = ?",
    ).run(TIPO_PERFIL_CV, cv);
    assert.equal((await fetch(`${base}/${persona}`, { method: 'DELETE' })).status, 200);
    const t = db.prepare("SELECT estado, payload FROM trabajos_ia WHERE run_id = 'run_cv_iker'").get() as {
      estado: string;
      payload: string;
    };
    assert.equal(t.estado, 'cancelado');
    assert.ok(!t.payload.includes('cv-iker'), t.payload);
    for (let i = 0; i < 50 && paradas.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(paradas, ['/v1/runs/run_cv_iker/stop'], 'el run en marcha se para en Hermes');

    const client = await conectar(T_LICI);
    try {
      const tarde = await client.callTool({
        name: 'colaboradores_proponer_perfil',
        arguments: { cv_ruta: cv, perfil: { ...PERFIL, nombre: 'Iker Borrable Secreto' } },
      });
      assert.equal(tarde.isError, true, 'el perfil que llega tarde de un run cancelado se rechaza');
      assert.match(texto(tarde), /persona borrada/);
    } finally {
      await client.close();
    }
    assert.ok(!listarPropuestas(db).some((p) => p.cv_ruta === cv));

    assert.equal(await pedirLectura(cv), 202, 'pedir otra vez la lectura desde la web lo vuelve a permitir');
    await decidir(await enviarPerfil(cv, { ...PERFIL, nombre: 'Iker Borrable Secreto' }), 'rechazar');
  } finally {
    hermes.close();
  }
});

test('should_link_a_new_cv_uploaded_from_a_persons_card_to_that_person', async () => {
  const alta = await fetch(base, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ nombre: 'Rosa Prueba', tipo: 'interno', disponibilidad: 'parcial' }),
  });
  const rosa = (await alta.json()) as { id: number };
  const cv = escribirCv('cv-rosa-1.md');
  assert.equal(await pedirLectura(cv, rosa.id), 202);
  const p = await enviarPerfil(cv, { ...PERFIL, nombre: 'Rosa Prueba', tipo: 'interno' });
  assert.equal(p.persona_id, rosa.id, 'Hermes no mandó persona_id: vale el del pedido');
  const { persona } = await decidir(p, 'aprobar');
  assert.equal(persona, rosa.id);
  const ficha = (await (await fetch(`${base}/${rosa.id}`)).json()) as {
    cv_ruta: string;
    disponibilidad: { estado: string };
    cv: { leido_en: string | null; antiguo: boolean };
  };
  assert.equal(ficha.cv_ruta, cv);
  assert.equal(
    ficha.disponibilidad.estado,
    'disponible',
    'la disponibilidad declarada se ignora: se calcula con sus ofertas',
  );
  assert.ok(ficha.cv.leido_en && !ficha.cv.antiguo, 'el CV recién aprobado no es antiguo');
});

test('should_log_and_answer_500_when_the_candidate_search_fails', async () => {
  const db = nucleo().db;
  const rota = Number(
    db
      .prepare(
        "INSERT INTO personas (nombre, tipo, activo, cv_ruta, datos, creada_en, actualizada_en) VALUES ('x', 'externo', 1, NULL, 'no es json', 'x', 'x')",
      )
      .run().lastInsertRowid,
  );
  let status = 0;
  try {
    const log = await logDe(async () => {
      status = (
        await fetch(`${base}/buscar`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ texto: 'Busco a Marta Confidencial' }),
        })
      ).status;
    });
    assert.equal(status, 500);
    assert.match(log, /fallo buscando candidatos/);
    assert.ok(!/Marta|Confidencial/.test(log), log);
  } finally {
    db.prepare('DELETE FROM personas WHERE id = ?').run(rota);
  }
});
