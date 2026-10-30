// Propuestas de punta a punta con adjudicaciones reales de la PLACSP (fixtures): registro
// y baja ofertada, resultado automático ganada/perdida/desierta que no pisa lo puesto a
// mano, estadísticas, propuestas parecidas, evaluación por MCP (esquema estricto, rutas
// dentro de Salidas), el Redactor retirado en la 3.0.0 de la skill y la API web.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'propuestas-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(salidas, { recursive: true });
fs.mkdirSync(conocimiento, { recursive: true });
fs.mkdirSync(agentes);
fs.writeFileSync(path.join(tmp, 'secreto.md'), 'fuera de Salidas');
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
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
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { resolverPresentadas } = await import('../../src/dominios/licitaciones/index.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { registrarPropuesta, propuestasDe, bajaOfertada, NuevaPropuesta } =
  await import('../../src/dominios/licitaciones/propuestas/registro.js');
const { decidirResultado } = await import('../../src/dominios/licitaciones/propuestas/resolucion.js');
const { estadisticasPropuestas, bandaDe } = await import('../../src/dominios/licitaciones/propuestas/estadisticas.js');
const { propuestasParecidas, UMBRAL_PARECIDO } =
  await import('../../src/dominios/licitaciones/propuestas/parecidas.js');
const { propuestaParaAgente } = await import('../../src/dominios/licitaciones/propuestas/index.js');
const { borradoresDe, ERROR_RETIRADO, retirarTrabajosBorrador } =
  await import('../../src/dominios/licitaciones/propuestas/borrador.js');
const { encolar } = await import('../../src/nucleo/trabajos.js');
const { obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { catalogoHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { GUION_CASO_A } = await import('./fixtures/casoA.js');
const { catalogoRegistrado } = await import('../../src/nucleo/mcp/herramienta.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { herramientasColaboradores } = await import('../../src/nucleo/colaboradores/tools.js');
const { McpServer } = await import('@modelcontextprotocol/server');
const { archivosSkill } = await import('../helpers/skill.js');
const { evaluacionRecibida, evaluacionesDe, instruccionesEvaluacion } =
  await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
for (const f of ['perfiles-pagina1.atom', 'requisitos.atom'])
  procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, f), 'utf8'));
procesarPagina(dbLicitaciones(), FUENTES.agregadas, fs.readFileSync(path.join(FIX, 'agregadas.atom'), 'utf8'));

// Adjudicada por lotes (lote 1 a A00000109, lotes 3 y 4 a B00000125), obras adjudicadas sin
// lotes, un suministro aún abierto y unos servicios abiertos (para borrador y evaluación).
const LOTES = 'p-18431943';
const OBRAS = 'a-20508788';
const ABIERTA = 'p-20571214';
const SERVICIOS = 'p-20435341';
const CARPETA = path.join(salidas, 'Licitaciones', `E2026016793 (${SERVICIOS})`);
const NOSOTROS = 'B00000125';

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
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

const json = { 'content-type': 'application/json' };
const post = (ruta: string, body: unknown, method = 'POST') =>
  fetch(`${base}/api/licitaciones${ruta}`, { method, headers: json, body: JSON.stringify(body) });
const estadoOportunidad = (id: string) =>
  dbLicitaciones().prepare('SELECT estado, cambiada_a_mano FROM oportunidades WHERE licitacion_id = ?').get(id) as
    { estado: string; cambiada_a_mano: number } | undefined;
const propuestaDe = (id: string, lote = '') => propuestasDe(dbLicitaciones(), id).find((p) => p.lote === lote)!;

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';

test('should_register_a_submission_with_its_bid_discount_and_mark_the_opportunity_submitted', async () => {
  const r = await post(`/licitaciones/${LOTES}/propuestas`, {
    lote: '3',
    importe_ofertado: 100_000,
    presentada_en: '2025-11-20',
    documentos: ['Salidas/Licitaciones/x/memoria.md'],
  });
  const p = (await r.json()) as {
    lote: string;
    presupuesto: number;
    baja_ofertada: number;
    resultado: string;
    ganador_nif: string | null;
    documentos: string[];
  };
  assert.equal(r.status, 201);
  assert.equal(p.presupuesto, 134_619.5, 'el presupuesto del lote, no el del contrato');
  assert.equal(p.baja_ofertada, 0.2572);
  assert.deepEqual(p.documentos, ['Salidas/Licitaciones/x/memoria.md']);
  assert.equal(p.resultado, 'pendiente', 'sin perfil de empresa no se sabe si el ganador somos nosotros');
  assert.equal(p.ganador_nif, NOSOTROS, 'pero sí quién ganó');
  assert.deepEqual(estadoOportunidad(LOTES), { estado: 'presentada', cambiada_a_mano: 1 });
});

test('should_reject_duplicate_unknown_lots_and_malformed_submissions', async () => {
  assert.equal((await post(`/licitaciones/${LOTES}/propuestas`, { lote: '3' })).status, 409);
  assert.equal((await post(`/licitaciones/${LOTES}/propuestas`, { lote: '9' })).status, 400);
  assert.equal(
    (await post(`/licitaciones/${ABIERTA}/propuestas`, { lote: '1' })).status,
    400,
    'sin lotes, el lote va vacío',
  );
  assert.equal((await post(`/licitaciones/${ABIERTA}/propuestas`, { importe: 5 })).status, 400, 'esquema estricto');
  assert.equal(
    (await post(`/licitaciones/${ABIERTA}/propuestas`, { documentos: ['Salidas/../secreto.md'] })).status,
    400,
  );
  assert.equal((await post(`/licitaciones/${ABIERTA}/propuestas`, { importe_ofertado: -1 })).status, 400);
  assert.equal((await post('/licitaciones/p-0000/propuestas', {})).status, 404);
  assert.equal(bajaOfertada(90, 100), 0.1);
  assert.equal(bajaOfertada(null, 100), null);
  assert.equal(bajaOfertada(90, 0), null);
});

test('should_mark_won_lost_from_the_placsp_award_without_touching_manual_results', () => {
  assert.equal(guardarPerfilEmpresa(nucleo().db, { nif: 'b-00000125', nombre: 'Analítica Ejemplo SL' }).error, null);
  const db = dbLicitaciones();
  for (const [id, lote, importe] of [
    [LOTES, '1', 110_000],
    [OBRAS, '', 530_000],
    [ABIERTA, '', 90_000],
  ] as const) {
    assert.equal(registrarPropuesta(db, id, NuevaPropuesta.parse({ lote, importe_ofertado: importe })).error, null);
  }
  assert.equal(resolverPresentadas(), 3);
  const ganada = propuestaDe(LOTES, '3');
  const perdida = propuestaDe(LOTES, '1');
  assert.deepEqual([ganada.resultado, ganada.resultado_origen], ['ganada', 'placsp']);
  assert.deepEqual([perdida.resultado, perdida.ganador_nif, perdida.baja_ganadora], ['perdida', 'A00000109', 0.3183]);
  assert.equal(propuestaDe(OBRAS).resultado, 'perdida');
  assert.equal(propuestaDe(ABIERTA).resultado, 'pendiente', 'sin adjudicación publicada');
  assert.equal(estadoOportunidad(LOTES)?.estado, 'ganada', 'el lote perdido no deshace el ganado');
  assert.equal(estadoOportunidad(OBRAS)?.estado, 'perdida');
  const eventos = ultimosEventos(nucleo().db, 20).filter((e) => e.tipo === 'licitacion.propuesta_resuelta');
  assert.equal(eventos.length, 3);
  assert.ok(
    eventos.every((e) => !JSON.stringify(e.datos).includes('A00000109')),
    'sin el NIF del ganador',
  );
  assert.equal(resolverPresentadas(), 0, 'idempotente');
});

test('should_keep_a_result_set_by_a_person_and_resume_automatic_when_reset', async () => {
  const id = propuestaDe(OBRAS).id;
  assert.equal(
    (await post(`/propuestas/${id}`, { resultado: 'excluida', lecciones: 'Faltó la clasificación.' }, 'PATCH')).status,
    200,
  );
  resolverPresentadas();
  assert.deepEqual([propuestaDe(OBRAS).resultado, propuestaDe(OBRAS).resultado_origen], ['excluida', 'manual']);
  await post(`/propuestas/${id}`, { resultado: 'pendiente' }, 'PATCH');
  assert.equal(resolverPresentadas(), 1);
  assert.equal(propuestaDe(OBRAS).resultado, 'perdida');
  assert.equal(propuestaDe(OBRAS).lecciones, 'Faltó la clasificación.');
  assert.equal((await post(`/propuestas/${id}`, {}, 'PATCH')).status, 400);
  assert.equal((await post(`/propuestas/${id}`, { resultado: 'inventado' }, 'PATCH')).status, 400);
  assert.equal((await post('/propuestas/99999', { notas: 'x' }, 'PATCH')).status, 404);
});

test('should_decide_lost_desert_or_wait_from_award_rows', () => {
  const fila = (lote: string, resultado: string | null, nif: string | null) => ({
    lote,
    resultado,
    adjudicatario_nif: nif,
    adjudicatario_nombre: nif,
    importe_sin_iva: 10,
    baja: 0.1,
  });
  assert.equal(decidirResultado([fila('', '3', null)], NOSOTROS).resultado, 'desierta');
  assert.equal(decidirResultado([fila('', '9', 'U12345678')], NOSOTROS).resultado, null, 'una UTE puede incluirnos');
  assert.equal(
    decidirResultado([fila('1', '9', 'A1'), fila('2', null, null)], NOSOTROS).resultado,
    null,
    'un lote sin resolver',
  );
  assert.equal(decidirResultado([fila('1', '9', 'A1'), fila('2', '9', NOSOTROS)], NOSOTROS).resultado, 'ganada');
  const sinNif = decidirResultado([fila('', '9', 'A1')], null);
  assert.deepEqual([sinNif.resultado, sinNif.ganador?.adjudicatario_nif], [null, 'A1']);
  assert.equal(decidirResultado([], NOSOTROS).resultado, null);
});

test('should_compute_success_rate_by_sector_body_and_band_and_bid_versus_winner', async () => {
  await post(
    `/propuestas/${propuestaDe(LOTES, '1').id}`,
    { puntos_tecnica: 30, puntos_economica: 40, puntos_total: 70, puntos_ganador: 85, posicion: 3 },
    'PATCH',
  );
  const e = estadisticasPropuestas(dbLicitaciones());
  assert.equal(e.total, 4);
  assert.deepEqual(e.por_resultado, { ganada: 1, perdida: 2, pendiente: 1 });
  assert.equal(e.tasa_exito, 0.333);
  const sector = Object.fromEntries(e.por_sector.map((g) => [g.clave, g.tasa]));
  assert.deepEqual(sector, { 'CPV 79': 0.5, 'CPV 45': 0, 'CPV 39': null });
  const banda = e.por_banda.find((g) => g.clave === bandaDe(130_000))!;
  assert.deepEqual([banda.presentadas, banda.decididas, banda.ganadas], [3, 2, 1]);
  assert.equal(e.por_organo.find((g) => g.clave === 'G00000091')?.tasa, 0.5);
  assert.equal(e.bajas.pares.length, 3);
  const lote1 = e.bajas.pares.find((p) => p.propuesta === propuestaDe(LOTES, '1').id)!;
  assert.deepEqual([lote1.baja_ofertada, lote1.baja_ganadora, lote1.diferencia], [0.118, 0.3183, 0.2003]);
  assert.ok(Math.abs(e.bajas.mediana_diferencia_perdidas! - (0.2003 + 0.0316) / 2) < 1e-6);
  assert.deepEqual([e.puntuaciones.n, e.puntuaciones.media_total, e.puntuaciones.media_ganador], [1, 70, 85]);
  assert.equal(bandaDe(null), 'sin importe');
});

test('should_count_wins_from_registrations_and_minutes_with_their_source', () => {
  // Arrange: una acta de la ganada ya registrada, una ganada que solo consta en el acta, una descartada y una perdida.
  const db = dbLicitaciones();
  const registrada = (
    db.prepare("SELECT licitacion_id FROM propuestas WHERE resultado = 'ganada'").get() as { licitacion_id: string }
  ).licitacion_id;
  const acta = (
    carpeta: string,
    licitacion: string | null,
    expediente: string | null,
    resultado: string,
    estado = 'pendiente',
  ) =>
    db
      .prepare(
        `INSERT INTO aprendizajes (carpeta, licitacion_id, expediente, organo, documento, datos, estado, agente, creado_en)
      VALUES (?, ?, ?, 'Órgano', ?, ?, ?, 'licitaciones', '2026-10-14T10:00:00Z')`,
      )
      .run(
        `Conocimiento/Licitaciones/Presentadas/${carpeta}`,
        licitacion,
        expediente,
        `Conocimiento/Licitaciones/Presentadas/${carpeta}/acta.pdf`,
        JSON.stringify({
          resultado,
          ganador: null,
          puntos_nuestros: null,
          puntos_ganador: null,
          criterios: [],
          lecciones: [],
        }),
        estado,
      );
  acta('Registrada', registrada, null, 'ganada', 'aceptada');
  acta('2026-09 PSTD_2-2026 Municipios', null, 'PSTD_2-2026', 'ganada');
  acta('Descartada', null, 'X-1', 'ganada', 'descartada');
  acta('Perdida', null, 'X-2', 'perdida');
  try {
    // Act
    const g = estadisticasPropuestas(db).ganadas;
    // Assert: la registrada no cuenta dos veces y cada una dice de dónde sale.
    assert.deepEqual([g.total, g.registradas, g.de_actas], [2, 1, 1]);
    assert.deepEqual(
      g.lista.map((x) => [x.fuente, x.licitacion_id ?? x.nombre]),
      [
        ['registro', registrada],
        ['acta', 'PSTD_2-2026'],
      ],
    );
    assert.ok(g.lista[1]?.aprendizaje && g.lista[0]?.propuesta);
  } finally {
    db.prepare("DELETE FROM aprendizajes WHERE carpeta LIKE 'Conocimiento/Licitaciones/Presentadas/%'").run();
  }
});

test('should_rank_similar_past_submissions_won_first', () => {
  const r = propuestasParecidas(dbLicitaciones(), SERVICIOS, 10);
  assert.equal(r.error, null);
  assert.deepEqual(
    r.data!.map((p) => [p.licitacion_id, p.lote, p.resultado]),
    [
      [LOTES, '3', 'ganada'],
      [LOTES, '1', 'perdida'],
      [OBRAS, '', 'perdida'],
    ],
  );
  assert.deepEqual(r.data![0]?.motivos, ['misma división CPV 79', 'mismo tipo de contrato']);
  assert.equal(propuestasParecidas(dbLicitaciones(), 'p-0000', 5).error?.code, 'not_found');
});

async function aprobarFicha(id: string): Promise<void> {
  await proponerFicha(
    dbLicitaciones(),
    FichaEntrada.parse({
      id,
      resumen: 'Servicio de mantenimiento y analítica durante dos años.',
      requisitos: [],
      criterios: [
        { descripcion: 'Precio', peso: 60, tipo: 'formula' },
        { descripcion: 'Memoria técnica', peso: 40, tipo: 'juicio_valor' },
      ],
      documentacion: [],
      hitos: [],
      garantias: [],
      penalizaciones: [],
      riesgos: [],
      recomendacion: { decision: 'go', motivo: 'Encaja.' },
    }),
    'licitaciones',
  );
}

test('should_not_register_licitaciones_registrar_borrador', async () => {
  const lici = await conectar(T_LICI);
  try {
    const nombres = (await lici.listTools()).tools.map((t) => t.name);
    assert.ok(nombres.includes('licitaciones_evaluacion'), 'Hermes sí puede proponer');
    assert.ok(!nombres.includes('licitaciones_registrar_borrador'));
  } finally {
    await lici.close();
  }
  assert.equal((await post(`/licitaciones/${SERVICIOS}/borrador`, {})).status, 404);
});

test('should_cancel_pending_draft_jobs_once', () => {
  const db = nucleo().db;
  const pendiente = encolar(db, {
    tipo: 'licitaciones.borrador',
    dominio: 'licitaciones',
    clave: `borrador-${SERVICIOS}`,
    payload: { id: SERVICIOS },
  });
  const otro = encolar(db, {
    tipo: 'licitaciones.evaluar',
    dominio: 'licitaciones',
    clave: `evaluar-retirada-${SERVICIOS}`,
    payload: { id: SERVICIOS },
  });

  assert.equal(retirarTrabajosBorrador(db), 1);
  const tardio = encolar(db, {
    tipo: 'licitaciones.borrador',
    dominio: 'licitaciones',
    clave: `borrador-tardio-${SERVICIOS}`,
    payload: { id: SERVICIOS },
  });
  assert.equal(retirarTrabajosBorrador(db), 0, 'una sola vez');

  assert.deepEqual(
    [obtenerTrabajo(db, pendiente)?.estado, obtenerTrabajo(db, pendiente)?.error],
    ['cancelado', ERROR_RETIRADO],
  );
  assert.equal(obtenerTrabajo(db, otro)?.estado, 'pendiente', 'los demás tipos no se tocan');
  assert.equal(obtenerTrabajo(db, tardio)?.estado, 'pendiente');
  db.prepare('DELETE FROM trabajos_ia WHERE id IN (?, ?)').run(otro, tardio);
});

// La skill de Hermes (3.13.0): núcleo corto, fases en references/ y las herramientas que hay de verdad.
const NOMBRE_HERRAMIENTA =
  /\b(?:licitaciones|competidores|organismos|colaboradores|plataforma|salidas|biblioteca)_[a-z_]+[a-z]\b/g;

// Las del núcleo (Biblioteca, plataforma, Salidas, colaboradores) entran en el catálogo al registrarse,
// también sin permiso: así se ven sin montarlas en el servidor de este test.
function herramientasDeHermes(): string[] {
  catalogoHerramientas();
  for (const registrar of [herramientasBiblioteca, herramientasColaboradores])
    registrar(new McpServer({ name: 'catalogo', version: '1.0.0' }), { nombre: 'catalogo', permisos: {} });
  return catalogoRegistrado().map((h) => h.nombre);
}

test('should_mention_every_registered_tool_in_some_skill_file', () => {
  const registradas = herramientasDeHermes();
  const instrucciones = archivosSkill().filter((a) => a.ruta !== 'CHANGELOG.md');
  const texto = instrucciones.map((a) => a.texto).join('\n');

  const nombradas = new Set(texto.match(NOMBRE_HERRAMIENTA) ?? []);

  assert.ok(
    ['licitaciones_oferta', 'biblioteca_leer', 'salidas_leer', 'colaboradores_ver'].every((n) =>
      registradas.includes(n),
    ),
    'catálogo completo',
  );
  assert.deepEqual(
    registradas.filter((n) => !texto.includes(`\`${n}\``)),
    [],
    'registradas que la skill no explica',
  );
  assert.deepEqual(
    [...nombradas].filter((n) => !registradas.includes(n)),
    [],
    'la skill nombra herramientas que no existen',
  );
  assert.ok(!texto.includes('licitaciones_registrar_borrador'), 'la skill nombra una herramienta que ya no existe');
});

test('should_keep_skill_core_under_300_lines', () => {
  const archivos = archivosSkill();
  const nucleo = archivos.find((a) => a.ruta === 'SKILL.md')!.texto;
  const referencias = archivos.filter((a) => a.ruta.startsWith('references/'));

  assert.ok(nucleo.split('\n').length < 300, `SKILL.md tiene ${nucleo.split('\n').length} líneas`);
  assert.match(nucleo, /^version: 4.1.0$/m);
  assert.deepEqual(
    referencias.map((a) => a.ruta).sort(),
    [
      'anexos',
      'cribar',
      'decisiones',
      'ficha',
      'guion',
      'memoria',
      'mercado',
      'propuestas-actas',
      'revision-previa',
    ].map((n) => `references/${n}.md`),
  );
  for (const r of referencias) {
    assert.match(r.texto, /\*\*Cuándo leer esto\.\*\*/, r.ruta);
    assert.ok(nucleo.includes(`\`${r.ruta}\``), `el índice del núcleo nombra ${r.ruta}`);
  }
});

test('should_state_the_read_estado_first_rule', () => {
  const nucleo = archivosSkill().find((a) => a.ruta === 'SKILL.md')!.texto;

  assert.ok(
    nucleo.includes(
      'Antes de trabajar, lee estado (licitaciones_oferta secciones=[estado, bloqueos]). Si hay un «impide» de negocio, avisa y no produzcas. En la revisión previa lee las comprobaciones, propón con evidencia (licitaciones_bloqueo_proponer) y no apliques. No digas «lista» si el veredicto no es «Lista para firmar».',
    ),
  );
  assert.ok(nucleo.includes('`<carpeta>/DOCUMENTACION PRESENTADA/<versión>/`'), 'dónde está lo presentado');
  assert.ok(nucleo.includes('`PLIEGOS/Sobre 1/`'), 'lo antiguo de Astilleros Ejemplo');
});

// Un borrador del Redactor de antes de la 3.0.0, ya registrado: se sigue enseñando, evaluando y revisando.
test('should_keep_drafts_written_before_the_drafter_was_retired', async () => {
  await aprobarFicha(SERVICIOS);
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(
    path.join(CARPETA, 'borrador-2026-10-02.md'),
    '# Borrador\n## Memoria técnica (40)\n[completar: equipo]\n',
  );

  dbLicitaciones()
    .prepare(
      "INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en) VALUES (?, ?, 'h', 10, 'licitaciones', ?)",
    )
    .run(SERVICIOS, `Salidas/Licitaciones/E2026016793 (${SERVICIOS})/borrador-2026-10-02.md`, new Date().toISOString());

  assert.deepEqual(
    borradoresDe(dbLicitaciones(), SERVICIOS).map((b) => [b.origen, b.estado]),
    [['hermes', 'pendiente']],
  );
});

const EVALUACION = {
  id: SERVICIOS,
  documento: `Salidas/Licitaciones/E2026016793 (${SERVICIOS})/borrador-2026-10-02.md`,
  resumen: 'Memoria correcta pero sin equipo concreto ni plan de calidad.',
  puntuacion_total: 70,
  puntuacion_maxima: 100,
  criterios: [
    {
      criterio: 'Precio',
      peso: 60,
      tipo: 'formula',
      puntuacion: 48,
      justificacion: 'Baja prevista en la mediana del segmento.',
    },
    {
      criterio: 'Memoria técnica',
      peso: 40,
      tipo: 'juicio_valor',
      puntuacion: 22,
      justificacion: 'Metodología genérica.',
      referencia: '2. Memoria técnica',
    },
  ],
  eliminar: [{ referencia: '1. Introducción', que: 'Sobra la historia de la empresa: no puntúa.' }],
  modificar: [],
  reforzar: [{ referencia: '2. Memoria técnica', que: 'Nombrar al equipo con su experiencia.' }],
  comparables: [
    {
      tipo: 'propuesta',
      referencia: 'p-18431943 lote 3',
      resultado: 'ganada',
      parecido: 'Mismo tipo de servicio; ganó con equipo nominal.',
    },
  ],
  riesgos: [{ descripcion: 'Equipo sin concretar', gravedad: 'alta' }],
};

test('should_validate_evaluations_strictly_and_store_them', async () => {
  const lici = await conectar(T_LICI);
  const pedida = new Date(Date.now() - 1000).toISOString();
  try {
    const evaluar = (args: unknown) =>
      lici.callTool({ name: 'licitaciones_evaluacion', arguments: args as Record<string, unknown> });
    const sobrePeso = await evaluar({
      ...EVALUACION,
      criterios: [{ ...EVALUACION.criterios[0], puntuacion: 70 }, EVALUACION.criterios[1]],
      puntuacion_total: 92,
    });
    assert.equal(sobrePeso.isError, true);
    assert.match(texto(sobrePeso), /mayor que el peso/);
    const mal = await evaluar({ ...EVALUACION, puntuacion_total: 80 });
    assert.match(texto(mal), /suma de los criterios \(70\)/);
    const sobreMil = await evaluar({ ...EVALUACION, puntuacion_maxima: 1000 });
    assert.match(texto(sobreMil), /suma de los pesos \(100\)/);
    const inventado = {
      criterio: 'Inventado',
      peso: 100,
      tipo: 'juicio_valor',
      puntuacion: 70,
      justificacion: 'Sin relación con la ficha.',
    };
    const otrosCriterios = await evaluar({ ...EVALUACION, criterios: [inventado] });
    assert.equal(otrosCriterios.isError, true);
    assert.match(texto(otrosCriterios), /los 2 criterios de la ficha aprobada/);
    assert.match(texto(await evaluar({ ...EVALUACION, id: OBRAS })), /no tiene ficha aprobada/);
    assert.equal((await evaluar({ ...EVALUACION, nota: 'extra' })).isError, true, 'esquema estricto');
    assert.equal((await evaluar({ ...EVALUACION, documento: 'Salidas/../secreto.md' })).isError, true);
    assert.equal((await evaluar({ ...EVALUACION, documento: 'Salidas/Licitaciones/no-existe.md' })).isError, true);
    const ok = await evaluar(EVALUACION);
    assert.equal(ok.isError, undefined, texto(ok));
  } finally {
    await lici.close();
  }
  const guardadas = evaluacionesDe(dbLicitaciones(), SERVICIOS);
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0]?.datos.criterios[1]?.puntuacion, 22);
  assert.equal(evaluacionRecibida(dbLicitaciones(), SERVICIOS, EVALUACION.documento, pedida), true);
  assert.match(
    instruccionesEvaluacion(SERVICIOS, EVALUACION.documento),
    /salidas_leer \(ruta «Licitaciones\/E2026016793/,
  );
  assert.match(instruccionesEvaluacion(SERVICIOS, EVALUACION.documento), /go_no_go\.ficha\.aprobada\.datos\.criterios/);
  assert.match(
    instruccionesEvaluacion(SERVICIOS, 'Conocimiento/Licitaciones/2026/x/p.pdf'),
    /biblioteca_leer \(ruta «Licitaciones\/2026\/x\/p\.pdf»\)/,
  );
});

test('should_offer_proposal_writing_tools_only_to_agents_that_may_propose', async () => {
  const claude = await conectar(T_CLAUDE);
  try {
    const herramientas = (await claude.listTools()).tools;
    const nombres = herramientas.map((t) => t.name);
    assert.ok(nombres.includes('licitaciones_propuestas'));
    // Lo que el agente ve en tools/list dice la forma de ahora de las parecidas y las memorias.
    const descripcion = herramientas.find((t) => t.name === 'licitaciones_propuestas')?.description ?? '';
    for (const campo of ['documentos_n', 'carpeta', 'debil', 'licitaciones_oferta', 'Conocimiento/'])
      assert.ok(descripcion.includes(campo), campo);
    assert.doesNotMatch(descripcion, /con sus documentos/);
    assert.ok(!nombres.includes('licitaciones_registrar_borrador'));
    assert.ok(!nombres.includes('licitaciones_evaluacion'));
    const conId = await claude.callTool({ name: 'licitaciones_propuestas', arguments: { id: SERVICIOS } });
    const d = JSON.parse(texto(conId)) as {
      borradores: unknown[];
      evaluaciones: unknown[];
      parecidas: { resultado: string }[];
    };
    assert.deepEqual([d.borradores.length, d.evaluaciones.length, d.parecidas[0]?.resultado], [1, 1, 'ganada']);
    const sinId = JSON.parse(
      texto(await claude.callTool({ name: 'licitaciones_propuestas', arguments: { resultado: 'perdida' } })),
    ) as { historico: { total: number }; estadisticas: { total: number } };
    assert.deepEqual([sinId.historico.total, sinId.estadisticas.total], [2, 4]);
  } finally {
    await claude.close();
  }
});

test('should_bring_similar_proposals_and_learnings_first_and_evaluations_summarized_when_there_are_ten_long_evaluations', async () => {
  const db = dbLicitaciones();
  const larga = (n: number) => ({
    ...EVALUACION,
    id: undefined,
    documento: undefined,
    resumen: `Evaluación ${n}. ${'Falta concretar quién, cuándo y con qué medida. '.repeat(60)}`.slice(0, 3000),
    criterios: EVALUACION.criterios.map((c) => ({
      ...c,
      justificacion: 'Justificación larga del tramo con citas del pliego. '.repeat(28).slice(0, 1500),
    })),
    reforzar: Array.from({ length: 30 }, (_, i) => ({
      referencia: `2. Memoria técnica — punto ${i + 1}`,
      que: 'Concretar el indicador, el responsable y la frecuencia de medida. '.repeat(15).slice(0, 1000),
    })),
  });
  const insertar = db.prepare(
    'INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, ?, ?, ?, ?)',
  );
  const ids = Array.from({ length: 10 }, (_, n) =>
    Number(
      insertar.run(
        SERVICIOS,
        EVALUACION.documento,
        JSON.stringify(larga(n)),
        'licitaciones',
        new Date(Date.now() + n).toISOString(),
      ).lastInsertRowid,
    ),
  );
  const lici = await conectar(T_LICI);
  try {
    const r = await lici.callTool({ name: 'licitaciones_propuestas', arguments: { id: SERVICIOS } });
    const crudo = texto(r);
    assert.ok(!crudo.includes('respuesta recortada'), `sin recorte (${crudo.length} caracteres)`);
    const d = JSON.parse(crudo) as Record<string, unknown> & {
      parecidas: { resultado: string }[];
      aprendizajes: unknown[];
      evaluaciones: Record<string, unknown>[];
    };
    assert.deepEqual(
      Object.keys(d).slice(0, 3),
      ['id', 'parecidas', 'aprendizajes'],
      'lo que reutiliza el redactor, primero',
    );
    assert.equal(d.parecidas[0]?.resultado, 'ganada');
    assert.ok(Array.isArray(d.aprendizajes));
    assert.equal(d.evaluaciones.length, 10);
    const ev = d.evaluaciones[0]!;
    assert.deepEqual(
      [ev.documento, ev.puntuacion_total, ev.puntuacion_maxima, ev.estado],
      [EVALUACION.documento, 70, 100, 'pendiente'],
    );
    assert.equal(ev.criterios, undefined, 'sin el contenido completo');
    assert.equal(ev.reforzar, undefined);
    assert.ok(String(ev.resumen).length <= 601, 'el resumen, recortado');
  } finally {
    await lici.close();
    db.prepare(`DELETE FROM evaluaciones WHERE id IN (${ids.join(',')})`).run();
  }
});

test('should_serve_the_proposal_block_history_evaluation_requests_and_salidas_files_on_the_web', async () => {
  const bloque = (await (await fetch(`${base}/api/licitaciones/licitaciones/${SERVICIOS}/propuesta`)).json()) as {
    documentos: string[];
    ficha_aprobada: boolean;
    carpeta_salidas: string;
    salidas_configurado: boolean;
  };
  assert.deepEqual(bloque.documentos, [EVALUACION.documento]);
  assert.deepEqual([bloque.ficha_aprobada, bloque.salidas_configurado], [true, true]);
  assert.equal(bloque.carpeta_salidas, `Salidas/Licitaciones/E2026016793 (${SERVICIOS})`);
  const lista = await fetch(`${base}/api/licitaciones/propuestas?resultado=perdida&texto=CU-2026`);
  const l = (await lista.json()) as {
    total: number;
    items: { licitacion_id: string }[];
    estadisticas: { total: number };
  };
  assert.deepEqual([lista.status, l.total, l.items[0]?.licitacion_id, l.estadisticas.total], [200, 1, OBRAS, 4]);
  assert.equal((await fetch(`${base}/api/licitaciones/propuestas?resultado=inventado`)).status, 400);
  assert.equal(
    (await post(`/licitaciones/${SERVICIOS}/evaluaciones`, { documento: 'Salidas/Licitaciones/no-existe.md' })).status,
    404,
  );
  assert.equal(
    (await post(`/licitaciones/${SERVICIOS}/evaluaciones`, { documento: EVALUACION.documento })).status,
    202,
  );
  assert.equal(
    (await post(`/licitaciones/${OBRAS}/evaluaciones`, { documento: EVALUACION.documento })).status,
    400,
    'sin ficha aprobada',
  );
  const archivo = await fetch(
    `${base}/api/licitaciones/salidas/documento?ruta=${encodeURIComponent(EVALUACION.documento)}`,
  );
  assert.equal(archivo.status, 200);
  assert.match(await archivo.text(), /# Borrador/);
  assert.equal(
    (await fetch(`${base}/api/licitaciones/salidas/documento?ruta=${encodeURIComponent('Salidas/../secreto.md')}`))
      .status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/licitaciones/salidas/documento?ruta=${encodeURIComponent('Conocimiento/x/y.md')}`))
      .status,
    400,
  );
});

test('should_refuse_serving_html_from_salidas_and_send_documents_without_sniffing', async () => {
  fs.writeFileSync(path.join(CARPETA, 'trampa.html'), '<script>alert(1)</script>');
  const html = await fetch(
    `${base}/api/licitaciones/salidas/documento?ruta=${encodeURIComponent(`Salidas/Licitaciones/E2026016793 (${SERVICIOS})/trampa.html`)}`,
  );
  assert.equal(html.status, 400);
  const md = await fetch(`${base}/api/licitaciones/salidas/documento?ruta=${encodeURIComponent(EVALUACION.documento)}`);
  assert.equal(md.headers.get('x-content-type-options'), 'nosniff');
  assert.match(md.headers.get('content-disposition') ?? '', /^inline; filename\*=UTF-8''borrador-2026-10-02\.md$/);
});

test('should_delete_a_submission_registered_by_mistake', async () => {
  const id = propuestaDe(ABIERTA).id;
  assert.equal((await fetch(`${base}/api/licitaciones/propuestas/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/api/licitaciones/propuestas/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/api/licitaciones/propuestas/abc`, { method: 'DELETE' })).status, 400);
});

test('should_derive_the_opportunity_from_all_its_lots_whatever_the_order_they_are_resolved', async () => {
  const db = dbLicitaciones();
  db.prepare('DELETE FROM propuestas WHERE licitacion_id = ?').run(LOTES);
  db.prepare("UPDATE oportunidades SET estado = 'presentada' WHERE licitacion_id = ?").run(LOTES);
  assert.equal(
    registrarPropuesta(db, LOTES, NuevaPropuesta.parse({ lote: '1', importe_ofertado: 110_000 })).error,
    null,
  );
  resolverPresentadas();
  assert.equal(estadoOportunidad(LOTES)?.estado, 'perdida', 'solo nos presentamos al lote 1 y lo perdimos');
  assert.equal(
    registrarPropuesta(db, LOTES, NuevaPropuesta.parse({ lote: '3', importe_ofertado: 100_000 })).error,
    null,
  );
  assert.equal(estadoOportunidad(LOTES)?.estado, 'presentada', 'queda un lote por resolver');
  resolverPresentadas();
  assert.equal(estadoOportunidad(LOTES)?.estado, 'ganada', 'el lote perdido resuelto antes no gana al ganado');
  await post(`/propuestas/${propuestaDe(LOTES, '3').id}`, { resultado: 'pendiente' }, 'PATCH');
  assert.equal(estadoOportunidad(LOTES)?.estado, 'presentada', 'reabrir un resultado reabre la oportunidad');
  resolverPresentadas();
  await post(`/propuestas/${propuestaDe(LOTES, '1').id}`, { resultado: 'excluida' }, 'PATCH');
  assert.equal(estadoOportunidad(LOTES)?.estado, 'ganada', 'un lote excluido a mano no deshace el ganado');
});

test('should_not_turn_an_automatic_result_into_a_manual_one_when_only_points_change', async () => {
  const ganada = propuestaDe(LOTES, '3');
  assert.equal(
    (await post(`/propuestas/${ganada.id}`, { resultado: 'ganada', puntos_total: 88, notas: 'Bien.' }, 'PATCH')).status,
    200,
  );
  assert.deepEqual([propuestaDe(LOTES, '3').resultado_origen, propuestaDe(LOTES, '3').puntos_total], ['placsp', 88]);
  assert.equal(estadoOportunidad(LOTES)?.estado, 'ganada');
});

test('should_wait_for_every_lot_before_losing_a_bid_to_the_whole_contract', () => {
  const fila = (lote: string, nif: string) => ({
    lote,
    resultado: '9',
    adjudicatario_nif: nif,
    adjudicatario_nombre: nif,
    importe_sin_iva: 10,
    baja: 0.1,
  });
  assert.equal(
    decidirResultado([fila('1', 'A1')], NOSOTROS, ['1', '2']).resultado,
    null,
    'el lote 2 aún no tiene adjudicación',
  );
  assert.equal(decidirResultado([fila('1', 'A1'), fila('2', 'A2')], NOSOTROS, ['1', '2']).resultado, 'perdida');
  assert.equal(decidirResultado([fila('1', NOSOTROS)], NOSOTROS, ['1', '2']).resultado, 'ganada');
  const db = dbLicitaciones();
  db.prepare('DELETE FROM propuestas WHERE licitacion_id = ?').run(LOTES);
  assert.equal(
    registrarPropuesta(db, LOTES, NuevaPropuesta.parse({ lote: '', importe_ofertado: 400_000 })).error,
    null,
  );
  db.prepare("DELETE FROM adjudicaciones WHERE licitacion_id = ? AND lote <> '1'").run(LOTES);
  resolverPresentadas();
  assert.equal(propuestaDe(LOTES).resultado, 'pendiente', 'un lote adjudicado a otro no basta');
});

test('should_revise_an_automatic_result_when_the_placsp_changes_the_award', () => {
  const db = dbLicitaciones();
  const antes = db.prepare('SELECT adjudicatario_nif FROM adjudicaciones WHERE licitacion_id = ?').get(OBRAS) as {
    adjudicatario_nif: string;
  };
  const obras = propuestaDe(OBRAS);
  assert.deepEqual([obras.resultado, obras.resultado_origen], ['perdida', 'placsp']);
  db.prepare('UPDATE adjudicaciones SET adjudicatario_nif = ? WHERE licitacion_id = ?').run(NOSOTROS, OBRAS);
  assert.equal(resolverPresentadas(), 1);
  assert.deepEqual([propuestaDe(OBRAS).resultado, propuestaDe(OBRAS).ganador_nif], ['ganada', NOSOTROS]);
  assert.equal(estadoOportunidad(OBRAS)?.estado, 'ganada');
  db.prepare('UPDATE adjudicaciones SET adjudicatario_nif = ? WHERE licitacion_id = ?').run(
    antes.adjudicatario_nif,
    OBRAS,
  );
  assert.equal(resolverPresentadas(), 1);
  assert.equal(propuestaDe(OBRAS).resultado, 'perdida');
  assert.equal(resolverPresentadas(), 0, 'idempotente');
});

test('should_hide_ai_drafts_and_evaluations_a_person_discards', async () => {
  const db = dbLicitaciones();
  const [evaluacion] = evaluacionesDe(db, SERVICIOS);
  const [borrador] = borradoresDe(db, SERVICIOS);
  assert.deepEqual([evaluacion?.estado, borrador?.estado], ['pendiente', 'pendiente'], 'lo de la IA entra pendiente');
  assert.equal((await post(`/borradores/${borrador!.id}`, { decision: 'aceptar' }, 'PATCH')).status, 200);
  assert.equal(borradoresDe(db, SERVICIOS)[0]?.estado, 'aceptada');
  assert.equal((await post(`/evaluaciones/${evaluacion!.id}`, { decision: 'descartar' }, 'PATCH')).status, 200);
  assert.equal(evaluacionesDe(db, SERVICIOS).length, 0, 'la descartada no se muestra ni se da a Hermes');
  assert.equal((await post(`/evaluaciones/${evaluacion!.id}`, { decision: 'borrar' }, 'PATCH')).status, 400);
  assert.equal((await post('/evaluaciones/99999', { decision: 'aceptar' }, 'PATCH')).status, 404);
  assert.equal((await post('/borradores/abc', { decision: 'aceptar' }, 'PATCH')).status, 400);
});

const TS_AGENTE = '2026-10-01T10:00:00.000Z';

// Una memoria ensamblada con sus compromisos en los apartados, como la deja la plataforma.
function sembrarMemoriaEnsamblada(id: string): { borradorId: number; memoriaId: number } {
  const db = dbLicitaciones();
  const guion = Number(
    db
      .prepare(
        "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'test', 1, ?)",
      )
      .run(id, JSON.stringify(GUION_CASO_A), TS_AGENTE).lastInsertRowid,
  );
  const borradorId = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, guion_id, version, ruta_md, apartados_json)
    VALUES (?, 'Salidas/Licitaciones/x/memoria-v1.docx', 'h', 10, 'plataforma', ?, 'pendiente', 'ensamblado', ?, 1, 'Salidas/Licitaciones/x/memoria-v1.md', ?)`,
      )
      .run(id, TS_AGENTE, guion, JSON.stringify([{ titulo: 'Metodología', compromisos: ['Informe mensual'] }]))
      .lastInsertRowid,
  );
  const memoriaId = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, borrador_id) VALUES (?, ?, 1, 'ensamblada', ?, ?, ?)",
      )
      .run(id, guion, TS_AGENTE, TS_AGENTE, borradorId).lastInsertRowid,
  );
  db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(memoriaId, borradorId);
  return { borradorId, memoriaId };
}

function limpiarMemoria(id: string): void {
  for (const t of ['borradores', 'memorias', 'guiones'])
    dbLicitaciones().prepare(`DELETE FROM ${t} WHERE licitacion_id = ?`).run(id);
}

test('should_mark_similar_proposal_as_weak_when_only_contract_type_matches', () => {
  const r = propuestasParecidas(dbLicitaciones(), SERVICIOS, 10);
  assert.equal(r.error, null);
  for (const p of r.data!) {
    // Lo que solo coincide en el tipo de contrato (o en un punto) es débil siempre; con clase CPV común, nunca.
    if (p.puntos_parecido <= UMBRAL_PARECIDO)
      assert.equal(p.debil, true, `${p.licitacion_id}: ${p.motivos.join(', ')}`);
    if (p.motivos.some((m) => m.startsWith('misma clase CPV')))
      assert.equal(p.debil, false, `${p.licitacion_id}: ${p.motivos.join(', ')}`);
  }
  assert.ok(
    r.data!.some((p) => p.debil),
    'hay una débil en los fixtures',
  );
  // Estudios de tendencias frente a soporte administrativo: misma división CPV 79 y tipo, otro objeto.
  assert.equal(r.data!.find((p) => p.licitacion_id === LOTES)?.debil, true);
  const primeraDebil = r.data!.findIndex((p) => p.debil);
  assert.ok(primeraDebil === -1 || r.data!.slice(primeraDebil).every((p) => p.debil), 'las débiles, al final');
});

test('should_not_repeat_memoria_content_for_the_agent', async () => {
  const { borradorId } = sembrarMemoriaEnsamblada(SERVICIOS);
  const lici = await conectar(T_LICI);
  try {
    const d = JSON.parse(
      texto(await lici.callTool({ name: 'licitaciones_propuestas', arguments: { id: SERVICIOS } })),
    ) as {
      parecidas: Record<string, unknown>[];
      borradores: Record<string, unknown>[];
      memorias: Record<string, unknown>[];
    };
    const b = d.borradores.find((x) => x.id === borradorId)!;
    assert.deepEqual(Object.keys(b).sort(), ['estado', 'fugas', 'guion_id', 'id', 'ruta', 'ruta_md', 'version']);
    assert.ok(b.fugas, 'se conservan las fugas');
    assert.deepEqual(Object.keys(d.memorias[0]!).sort(), [
      'ensayo',
      'estado',
      'fugas',
      'guion_id',
      'id',
      'ruta',
      'ruta_md',
      'version',
    ]);
    assert.ok(!JSON.stringify(d).includes('Informe mensual'), 'sin compromisos ni apartados de la memoria');
    for (const p of d.parecidas) {
      assert.equal(typeof p.documentos_n, 'number');
      assert.equal(p.documentos, undefined);
    }
  } finally {
    await lici.close();
    limpiarMemoria(SERVICIOS);
  }
});

test('should_keep_assembled_memory_drafts_working', async () => {
  const { borradorId } = sembrarMemoriaEnsamblada(SERVICIOS);
  try {
    const web = (await (await fetch(`${base}/api/licitaciones/licitaciones/${SERVICIOS}/propuesta`)).json()) as {
      borradores: { id: number; origen: string }[];
      carpeta_salidas: string;
    };
    assert.deepEqual(web.borradores.find((b) => b.id === borradorId)?.origen, 'ensamblado');
    assert.equal(web.carpeta_salidas, `Salidas/Licitaciones/E2026016793 (${SERVICIOS})`);

    // Con el apartado sin redactar, el PATCH pide el motivo como «Dar por buena».
    const aceptar = await post(
      `/borradores/${borradorId}`,
      { decision: 'aceptar', motivo: 'Se completa a mano en el Word.' },
      'PATCH',
    );

    assert.equal(aceptar.status, 200);
    assert.equal(borradoresDe(dbLicitaciones(), SERVICIOS).find((b) => b.id === borradorId)?.estado, 'aceptada');
  } finally {
    limpiarMemoria(SERVICIOS);
  }
});

test('should_give_sections_as_object_not_json_string', () => {
  const base = {
    id: 7,
    licitacion_id: SERVICIOS,
    ruta: 'Salidas/a/borrador.md',
    origen: 'hermes',
    estado: 'pendiente',
  };
  const vacio = {
    id: SERVICIOS,
    propuestas: [],
    evaluaciones: [],
    parecidas: [],
    aprendizajes: [],
    documentos: [],
    carpeta_salidas: 'Salidas/x',
    ficha_aprobada: false,
    salidas_configurado: true,
    carpeta_presentada: null,
    guion: null,
    memorias: [],
  };
  const vista = (apartados_json: string | null) =>
    propuestaParaAgente({ ...vacio, borradores: [{ ...base, apartados_json }] } as never).borradores[0] as Record<
      string,
      unknown
    >;
  assert.deepEqual(vista('[{"titulo":"A"}]').apartados, [{ titulo: 'A' }]);
  assert.equal(vista('{no es json').apartados, null, 'JSON roto: null, sin tirar');
  assert.equal(vista(null).apartados, null);
  assert.equal(vista('[]').apartados_json, undefined);
});

test('should_prefix_every_agent_path_with_its_root', () => {
  const vacio = {
    id: SERVICIOS,
    propuestas: [],
    evaluaciones: [],
    aprendizajes: [],
    documentos: [],
    carpeta_salidas: 'Salidas/x',
    ficha_aprobada: false,
    salidas_configurado: true,
    guion: null,
    memorias: [],
  };
  const parecida = {
    id: 1,
    documentos: ['Conocimiento/a.pdf', 'Conocimiento/b.pdf'],
    carpeta: 'Licitaciones/Presentadas/2026-1 X',
  };
  const v = propuestaParaAgente({
    ...vacio,
    parecidas: [parecida],
    borradores: [{ id: 2, ruta: 'Licitaciones/x/borrador.md', origen: 'hermes', apartados_json: null }],
    carpeta_presentada: { ruta: 'Licitaciones/Presentadas/2026-1 X', estado: 'hecha', error: null },
  } as never);
  assert.equal(v.parecidas[0]?.carpeta, 'Conocimiento/Licitaciones/Presentadas/2026-1 X');
  assert.equal(v.parecidas[0]?.documentos_n, 2);
  assert.equal(v.carpeta_presentada?.ruta, 'Conocimiento/Licitaciones/Presentadas/2026-1 X');
  assert.equal((v.borradores[0] as { ruta: string }).ruta, 'Salidas/Licitaciones/x/borrador.md');
  const ya = propuestaParaAgente({
    ...vacio,
    parecidas: [{ ...parecida, carpeta: 'Conocimiento/Y' }],
    borradores: [],
    carpeta_presentada: null,
  } as never);
  assert.equal(ya.parecidas[0]?.carpeta, 'Conocimiento/Y', 'no se duplica la raíz');
});

// Registrar el paquete con las comprobaciones diciendo «impide»: solo con un motivo, que queda guardado.
const CON_IMPIDE = 'p-20602990';
const SIN_IMPIDE = 'p-20379303';
const MOTIVO = 'El órgano confirmó por teléfono que acepta el anexo';

async function comprobacionesDeTest(id: string) {
  const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
  const c = comprobacionesDe(dbLicitaciones(), nucleo().db, id);
  assert.ok(c.data, c.error?.message);
  return c.data;
}

// Lo que haría la persona con cada fila que impide: dejarla resuelta con la huella que vio.
async function resolverImpiden(id: string) {
  const c = await comprobacionesDeTest(id);
  const insertar = dbLicitaciones().prepare(
    "INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, quien, en) VALUES (?, ?, ?, 'resuelto', 'test', ?)",
  );
  for (const b of c.bloqueos.filter((x) => x.gravedad === 'impide'))
    insertar.run(id, b.clave, b.huella, new Date().toISOString());
}

test('should_reject_registering_a_package_with_open_blockers_without_motive', async () => {
  // Arrange
  const impiden = (await comprobacionesDeTest(CON_IMPIDE)).bloqueos.filter((b) => b.gravedad === 'impide');
  assert.ok(impiden.length > 0, 'la licitación de la prueba tiene algo que impide');

  // Act
  const r = registrarPropuesta(
    dbLicitaciones(),
    CON_IMPIDE,
    NuevaPropuesta.parse({ importe_ofertado: 1000, paquete_version: 1 }),
  );
  const web = await post(`/licitaciones/${CON_IMPIDE}/propuestas`, { importe_ofertado: 1000, paquete_version: 1 });
  const cuerpo = (await web.json()) as { error: string; message: string };

  // Assert
  assert.equal(r.error?.code, 'impide_abierto');
  assert.match(r.error?.message ?? '', /^No se puede registrar: .+\. Resuélvelo o registra con un motivo\.$/);
  assert.ok(r.error?.message.includes(impiden[0]!.titulo), 'dice qué lo impide');
  assert.equal(web.status, 409, 'es un conflicto esperado, no un fallo del servidor');
  assert.equal(cuerpo.error, 'impide_abierto');
  assert.equal(propuestasDe(dbLicitaciones(), CON_IMPIDE).length, 0, 'no se registra nada');
  assert.equal(
    NuevaPropuesta.safeParse({ paquete_version: 1, forzar_motivo: 'corto' }).success,
    false,
    'el motivo es una frase, no un «ok»',
  );
});

test('should_register_with_a_15_char_motive_and_store_it', async () => {
  // Arrange
  const cuerpo = { importe_ofertado: 1000, paquete_version: 1, forzar_motivo: `  ${MOTIVO}  ` };

  // Act
  const r = await post(`/licitaciones/${CON_IMPIDE}/propuestas`, cuerpo);
  const p = (await r.json()) as { forzado_motivo: string | null; paquete_version: number };

  // Assert
  assert.equal(r.status, 201);
  assert.equal(p.forzado_motivo, MOTIVO);
  assert.equal(p.paquete_version, 1);
  assert.equal(propuestaDe(CON_IMPIDE).forzado_motivo, MOTIVO, 'queda guardado para la auditoría');
});

test('should_register_without_motive_when_nothing_blocks', async () => {
  // Arrange
  await resolverImpiden(SIN_IMPIDE);
  const sinPaquete = registrarPropuesta(
    dbLicitaciones(),
    OBRAS,
    NuevaPropuesta.parse({ lote: '', importe_ofertado: 1000 }),
  );

  // Act
  const r = registrarPropuesta(
    dbLicitaciones(),
    SIN_IMPIDE,
    NuevaPropuesta.parse({ importe_ofertado: 1000, paquete_version: 2 }),
  );

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data?.forzado_motivo, null);
  assert.notEqual(sinPaquete.error?.code, 'impide_abierto', 'sin paquete_version (fuera de Hermes) no hay guardia');
});
