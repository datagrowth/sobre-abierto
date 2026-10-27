// Aprender de las actas de mesa con carpetas de lo presentado como las deja Drive (Villaejemplo 2036-2026,
// acta con 31/40 frente a 39 del ganador): detección por el nombre, cola,
// tool con literalidad y puntos, revisión por la web, lecciones para la memoria y parecidas.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aprendizaje-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
const indexDir = path.join(tmp, 'index');
for (const d of [conocimiento, agentes]) fs.mkdirSync(d, { recursive: true });
const T_LICI = 'l'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.AGENTE_TOKEN_CLAUDE_CODE = 'c'.repeat(40);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = indexDir;
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { trocearPaginas } = await import('../../src/biblioteca/motor/documentos/trozos.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const {
  actasSinAprendizaje,
  aprendizajeRecibido,
  documentosEntregados,
  instruccionesActa,
  PayloadActa,
  pedirLecturaActas,
  rangoActa,
  TIPO_APRENDER_ACTA,
  trozosNoLiterales,
  textoPlano,
} = await import('../../src/dominios/licitaciones/propuestas/actas.js');
const { AprendizajeEntrada, leccionesParaApartado, proponerAprendizaje } =
  await import('../../src/dominios/licitaciones/propuestas/aprendizaje.js');
const { propuestaDeLicitacion } = await import('../../src/dominios/licitaciones/propuestas/index.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const raices = { salidas: null, conocimiento };
assert.equal(guardarPerfilEmpresa(nucleo().db, { nif: 'B76543210', nombre: 'Analítica Ejemplo SL' }).error, null);

const PRESENTADAS = 'Conocimiento/Licitaciones/Presentadas';
const VILLAEJEMPLO = `${PRESENTADAS}/2026-03 - 2036-2026 - Villaejemplo - Big Data flujos turísticos`;
const HOSPITAL = `${PRESENTADAS}/2026-05 - SER-2026-0000003222 - Ejemplo GC - Formación estadística`;
const SIN_ACTA = `${PRESENTADAS}/2026-08 - 77-2026 - Cabildo Isla Ejemplo - Cuadro de mando`;
const ACTA_VILLAEJEMPLO = `${VILLAEJEMPLO}/Villaejemplo_2036-2026_Acta_Mesa_2026-06-22.pdf`;
const ACTA_HOSPITAL = `${HOSPITAL}/OTROS DOCUMENTOS/Ejemplo_SER-2026-0000003222_Acta_Mesa_2026-07-17.pdf`;

function archivo(ruta: string): void {
  const abs = path.join(conocimiento, ...ruta.slice('Conocimiento/'.length).split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
}

for (const r of [
  ACTA_VILLAEJEMPLO,
  `${VILLAEJEMPLO}/Villaejemplo_2036-2026_Decreto_2026-2704_2026-08-21.pdf`,
  `${VILLAEJEMPLO}/DOCUMENTACION PRESENTADA/memoria técnica.docx`,
  `${VILLAEJEMPLO}/DOCUMENTACION PRESENTADA/Anexo II oferta económica.pdf`,
  `${VILLAEJEMPLO}/PLIEGOS/Acta de constitución de la mesa.pdf`,
  ACTA_HOSPITAL,
  `${SIN_ACTA}/PLIEGOS/Resolución de adjudicación modelo.pdf`,
  `${SIN_ACTA}/DOCUMENTACION PRESENTADA/Acta notarial.pdf`,
])
  archivo(r);

// El acta de Villaejemplo indexada como la deja la Biblioteca (texto con saltos de línea de PDF).
const PAGINAS_ACTA = [
  'ACTA DE LA MESA DE CONTRATACIÓN\nExpediente 2036-2026. Servicio de análisis Big Data de los flujos turísticos del municipio de Villaejemplo.',
  'Valoración de los criterios sujetos a juicio de valor (40 puntos)\nANALÍTICA EJEMPLO SL\n1. Metodología de análisis de los flujos turísticos (20 puntos): 14 puntos. La propuesta describe las fuentes de datos de telefonía y tarjetas, si bien presenta aspectos que la memoria no cuan-\ntifica, como el volumen de registros y la frecuencia de actualización.\n2. Plan de trabajo y cronograma (20 puntos): 17 puntos. Cronograma detallado por fases con hitos semanales.',
  'TURISMO ANALÍTICO SL obtiene 19 y 20 puntos respectivamente, con un total de 39 puntos. ANALÍTICA EJEMPLO SL obtiene un total de 31 puntos.',
];
const idx = indice.abrirIndice(indexDir);
indice.reemplazarArchivo(
  idx,
  {
    path: ACTA_VILLAEJEMPLO.slice('Conocimiento/'.length),
    kind: 'document',
    title: 'Acta',
    mtime_ms: 1,
    size: 1,
    pages: 3,
    status: 'ok',
    error: null,
    source: null,
  },
  trocearPaginas(PAGINAS_ACTA, true),
);

const AYTO = { nombre: 'Ayuntamiento de Villaejemplo', nif: 'P0000004B' };
const OBJETIVO = licitacion({
  titulo: 'Observatorio turístico con datos de movilidad',
  publicada: '2026-09-30',
  organo: AYTO,
  cpv: '72316000',
});
guardarLicitacion(db, OBJETIVO);

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
  idx.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = { 'content-type': 'application/json' };
const api = (ruta: string, body?: unknown, method = 'POST') =>
  fetch(
    `${base}/api/licitaciones${ruta}`,
    method === 'GET' ? {} : { method, headers: json, body: JSON.stringify(body ?? {}) },
  );
const leer = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';
const olvidarRechazos = () => nucleo().db.prepare('DELETE FROM auditoria_agentes').run();

const COMENTARIO =
  'presenta aspectos que la memoria no cuantifica, como el volumen de registros y la frecuencia de actualización';
const APRENDIZAJE = {
  carpeta: VILLAEJEMPLO,
  documento: ACTA_VILLAEJEMPLO,
  resultado: 'perdida',
  ganador: 'TURISMO ANALÍTICO SL',
  puntos_nuestros: 31,
  puntos_ganador: 39,
  criterios: [
    {
      criterio: 'Metodología de análisis de los flujos turísticos',
      puntos_max: 20,
      nuestros: 14,
      ganador: 19,
      comentario_mesa: `La propuesta describe las fuentes de datos de telefonía y tarjetas, si bien ${COMENTARIO}.`,
      pagina: 2,
    },
    {
      criterio: 'Plan de trabajo y cronograma',
      puntos_max: 20,
      nuestros: 17,
      ganador: 20,
      comentario_mesa: 'Cronograma detallado por fases con hitos semanales.',
      pagina: 2,
    },
  ],
  lecciones: [
    'La mesa quiere cifras: la memoria no cuantificaba el volumen de registros ni la frecuencia de actualización.',
  ],
};

async function conectar() {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  return client;
}

async function enviar(args: unknown) {
  const c = await conectar();
  try {
    return await c.callTool({ name: 'licitaciones_aprendizaje', arguments: args as Record<string, unknown> });
  } finally {
    await c.close();
  }
}

test('should_rank_report_names_and_ignore_other_files', () => {
  assert.equal(rangoActa('Villaejemplo_2036-2026_Acta_Mesa_2026-06-22.pdf'), 0);
  assert.equal(rangoActa('Informe técnico de valoración.docx'), 1);
  assert.equal(rangoActa('Decreto_2026-2704.pdf'), 4);
  assert.equal(rangoActa('Resolución de adjudicación.pdf'), 3);
  assert.equal(rangoActa('Acta de apertura del sobre 2 de la mesa.pdf'), 2, 'la de apertura no trae la valoración');
  assert.equal(rangoActa('memoria técnica.docx'), null);
  assert.equal(rangoActa('Acta_Mesa.xlsx'), null, 'solo documentos que la Biblioteca lee');
});

test('should_detect_presented_folders_with_a_report_and_without_learning', () => {
  const pendientes = actasSinAprendizaje(db, conocimiento);
  assert.deepEqual(
    pendientes,
    [
      { carpeta: VILLAEJEMPLO, documento: ACTA_VILLAEJEMPLO },
      { carpeta: HOSPITAL, documento: ACTA_HOSPITAL },
    ],
    'el acta antes que el decreto; nada de PLIEGOS ni de lo entregado',
  );
  assert.deepEqual(documentosEntregados(conocimiento, VILLAEJEMPLO), [
    `${VILLAEJEMPLO}/DOCUMENTACION PRESENTADA/memoria técnica.docx`,
    `${VILLAEJEMPLO}/DOCUMENTACION PRESENTADA/Anexo II oferta económica.pdf`,
  ]);
});

test('should_queue_one_job_per_folder_and_tell_how_many_are_pending', async () => {
  const antes = await leer<{ items: unknown[]; pendientes_de_leer: number }>(api('/aprendizajes', undefined, 'GET'));
  assert.deepEqual([antes.items.length, antes.pendientes_de_leer], [0, 2]);
  const r = await api('/aprendizajes/leer');
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { encolados: 2 });
  assert.deepEqual(await leer(api('/aprendizajes/leer')), { encolados: 0 }, 'no se repite lo que está en cola');
  assert.equal(pedirLecturaActas(nucleo().db, db, { conocimiento, max: 2, aMano: false }), 0, 'la vuelta tampoco');
  const despues = await leer<{ pendientes_de_leer: number; leyendo: number }>(api('/aprendizajes', undefined, 'GET'));
  assert.deepEqual([despues.pendientes_de_leer, despues.leyendo], [0, 2]);
  const filas = nucleo()
    .db.prepare('SELECT id, payload FROM trabajos_ia WHERE tipo = ? ORDER BY id')
    .all(TIPO_APRENDER_ACTA) as { id: number; payload: string }[];
  const p = PayloadActa.parse(JSON.parse(filas[0]!.payload));
  assert.deepEqual([p.carpeta, p.documento], [VILLAEJEMPLO, ACTA_VILLAEJEMPLO]);
  assert.ok(obtenerTrabajo(nucleo().db, filas[0]!.id));
  const ins = instruccionesActa(
    p,
    { nombre: 'Analítica Ejemplo SL', nif: 'B76543210' },
    documentosEntregados(conocimiento, p.carpeta),
  );
  assert.match(
    ins,
    /biblioteca_leer \(ruta «Licitaciones\/Presentadas\/2026-03 - 2036-2026 - Villaejemplo - Big Data flujos turísticos\/Villaejemplo_2036-2026_Acta_Mesa_2026-06-22\.pdf»\)/,
  );
  assert.match(ins, /NIF B76543210/);
  assert.match(ins, /DOCUMENTACION PRESENTADA\/memoria técnica\.docx/);
  assert.match(ins, /licitaciones_aprendizaje/);
});

test('should_find_literal_quotes_despite_case_accents_and_hyphenated_line_breaks', () => {
  const plano = textoPlano(PAGINAS_ACTA.join('\n'));
  assert.deepEqual(
    trozosNoLiterales('PRESENTA ASPECTOS QUE LA MEMORIA NO CUANTIFICA, como el volumen de registros', plano),
    [],
  );
  assert.deepEqual(
    trozosNoLiterales('La propuesta describe las fuentes … con hitos semanales', plano),
    [],
    'los tramos unidos con «…» se buscan por separado',
  );
  assert.equal(
    trozosNoLiterales('La memoria es excelente y muy completa en todo', plano)[0],
    'la memoria es excelente y muy completa en',
  );
});

test('should_reject_points_over_the_maximum_always', async () => {
  olvidarRechazos();
  const malo = structuredClone(APRENDIZAJE);
  malo.criterios[0]!.nuestros = 25;
  for (let i = 0; i < 3; i++) {
    const r = await enviar(malo);
    assert.equal(r.isError, true);
    assert.match(
      texto(r),
      /En «Metodología de análisis de los flujos turísticos» los puntos \(25 nuestros, 19 del ganador\) superan el máximo 20\./,
    );
  }
  olvidarRechazos();
});

test('should_reject_a_comment_that_is_not_literal_then_accept_with_warning_at_the_third', async () => {
  olvidarRechazos();
  const parafraseado = structuredClone(APRENDIZAJE);
  parafraseado.criterios[0]!.comentario_mesa =
    'A la memoria le faltaban cifras sobre el volumen y la actualización de los datos.';
  for (let i = 0; i < 2; i++) {
    const r = await enviar(parafraseado);
    assert.equal(r.isError, true);
    assert.match(
      texto(r),
      /El comentario de la mesa en «Metodología de análisis de los flujos turísticos» no está literal en el documento/,
    );
  }
  const tercera = await enviar(parafraseado);
  assert.equal(tercera.isError, undefined, texto(tercera));
  const d = JSON.parse(texto(tercera)) as { estado: string; avisos: string[] };
  assert.equal(d.estado, 'pendiente');
  assert.match(d.avisos.join(' '), /no está literal/);
  olvidarRechazos();
});

test('should_accept_a_literal_learning_and_replace_the_pending_one', async () => {
  const pedida = new Date(Date.now() - 1000).toISOString();
  const r = await enviar(APRENDIZAJE);
  assert.equal(r.isError, undefined, texto(r));
  assert.deepEqual(JSON.parse(texto(r)), { aprendizaje: 1, estado: 'pendiente', avisos: [] });
  assert.equal(aprendizajeRecibido(db, VILLAEJEMPLO, pedida), true);
  const lista = await leer<{
    items: {
      id: number;
      carpeta: string;
      expediente: string;
      organo: string;
      avisos: string[];
      datos: { puntos_nuestros: number };
    }[];
  }>(api('/aprendizajes', undefined, 'GET'));
  assert.equal(lista.items.length, 1);
  const a = lista.items[0]!;
  assert.deepEqual(
    [a.carpeta, a.expediente, a.organo, a.datos.puntos_nuestros, a.avisos],
    [VILLAEJEMPLO, '2036-2026', 'Villaejemplo', 31, []],
  );
  // Sus lecciones van al libro, pendientes, con el criterio que más se parece como evidencia.
  const l = db
    .prepare('SELECT origen, alcance, alcance_valor, tema, estado, evidencias FROM lecciones WHERE aprendizaje_id = ?')
    .get(a.id) as { evidencias: string };
  assert.deepEqual(
    { ...l, evidencias: JSON.parse(l.evidencias) },
    {
      origen: 'mesa',
      alcance: 'organo',
      alcance_valor: 'Villaejemplo',
      tema: 'metodologia',
      estado: 'pendiente',
      evidencias: [
        {
          licitacion_id: null,
          memoria_id: null,
          documento: ACTA_VILLAEJEMPLO,
          ubicacion: 'criterio «Metodología de análisis de los flujos turísticos», pág. 2',
          texto: `14/20 (ganador 19). La mesa: «La propuesta describe las fuentes de datos de telefonía y tarjetas, si bien ${COMENTARIO}.»`,
        },
      ],
    },
  );
});

test('should_reject_an_acta_lesson_that_names_a_team_member', async () => {
  const tapar = (t: string) => t.split('Persona D').join('la persona 4');
  const r = await proponerAprendizaje(
    db,
    raices,
    AprendizajeEntrada.parse({
      ...APRENDIZAJE,
      lecciones: ['La mesa valoró que Persona D coordinara el servicio desde el primer día.'],
    }),
    { agente: 'licitaciones', idx, tapar },
  );
  assert.match(r.error?.message ?? '', /La lección 1 nombra a una persona del equipo/);
});

test('should_accept_the_acta_reading_when_a_person_accepts_one_of_its_lessons_in_the_book', async () => {
  const l = db
    .prepare("SELECT id, aprendizaje_id FROM lecciones WHERE origen = 'mesa' AND estado = 'pendiente'")
    .get() as { id: number; aprendizaje_id: number };
  const r = await api(`/lecciones/${l.id}`, { decision: 'aceptar' }, 'PATCH');
  assert.deepEqual([r.status, await r.json()], [200, { id: l.id, estado: 'aceptada' }]);
  assert.equal(
    (db.prepare('SELECT estado FROM aprendizajes WHERE id = ?').get(l.aprendizaje_id) as { estado: string }).estado,
    'aceptada',
    'la lectura del acta pasa a la redacción',
  );
  assert.equal((await api('/lecciones/9999', { decision: 'aceptar' }, 'PATCH')).status, 404);
});

test('should_reject_a_document_outside_the_folder_or_a_folder_outside_presentadas', async () => {
  const fuera = await proponerAprendizaje(
    db,
    raices,
    AprendizajeEntrada.parse({ ...APRENDIZAJE, documento: ACTA_HOSPITAL }),
    { agente: 'licitaciones', idx },
  );
  assert.match(fuera.error?.message ?? '', /El documento debe estar dentro de esa carpeta/);
  const otra = await proponerAprendizaje(
    db,
    raices,
    AprendizajeEntrada.parse({
      ...APRENDIZAJE,
      carpeta: 'Conocimiento/Empresa/Actas',
      documento: 'Conocimiento/Empresa/Actas/acta.pdf',
    }),
    { agente: 'licitaciones', idx },
  );
  assert.match(otra.error?.message ?? '', /«carpeta» es la carpeta que dio la tarea/);
});

test('should_accept_and_discard_learnings_from_the_web', async () => {
  const materno = await proponerAprendizaje(
    db,
    raices,
    AprendizajeEntrada.parse({
      carpeta: HOSPITAL,
      documento: ACTA_HOSPITAL,
      resultado: 'ganada',
      ganador: 'ANALÍTICA EJEMPLO SL',
      puntos_nuestros: 45,
      puntos_ganador: 45,
      criterios: [
        {
          criterio: 'Metodología docente y materiales de formación estadística',
          puntos_max: 25,
          nuestros: 22,
          ganador: 22,
          comentario_mesa: '',
          pagina: 3,
        },
      ],
      lecciones: ['Los ejercicios con datos reales del hospital puntuaron alto.'],
    }),
    { agente: 'licitaciones', idx },
  );
  assert.equal(materno.error, null);
  const aceptar = await api('/aprendizajes/1', { decision: 'aceptar' }, 'PATCH');
  assert.equal(aceptar.status, 200);
  assert.deepEqual(await aceptar.json(), { id: 1, estado: 'aceptada' });
  const deMaterno = () =>
    db
      .prepare('SELECT estado FROM lecciones WHERE aprendizaje_id = ?')
      .all(materno.data!.aprendizaje)
      .map((x) => (x as { estado: string }).estado);
  assert.deepEqual(deMaterno(), ['pendiente']);
  assert.equal(
    (await api(`/aprendizajes/${materno.data!.aprendizaje}`, { decision: 'descartar' }, 'PATCH')).status,
    200,
  );
  assert.deepEqual(deMaterno(), ['descartada'], 'un acta descartada no deja lecciones por revisar');
  assert.equal((await api('/aprendizajes/99', { decision: 'aceptar' }, 'PATCH')).status, 404);
  assert.equal((await api('/aprendizajes/1', { decision: 'quizá' }, 'PATCH')).status, 400);
  const lista = await leer<{ items: { id: number; estado: string }[]; pendientes_de_leer: number }>(
    api('/aprendizajes', undefined, 'GET'),
  );
  assert.deepEqual(
    lista.items.map((x) => [x.id, x.estado]),
    [[1, 'aceptada']],
    'lo descartado deja de mostrarse',
  );
  assert.equal(lista.pendientes_de_leer, 0, 'una carpeta con aprendizaje, aunque descartado, no se vuelve a leer sola');
  const otraVez = await enviar(APRENDIZAJE);
  assert.match(texto(otraVez), /ya tiene un aprendizaje aceptado/);
});

test('should_give_lessons_for_a_section_ordered_by_similarity_using_only_accepted', async () => {
  const consulta = {
    titulo: 'Metodología de análisis de datos turísticos',
    se_valorara: ['Fuentes de datos de flujos turísticos', 'Frecuencia de actualización'],
    organo: 'Ayuntamiento de Villaejemplo',
  };
  const lecciones = leccionesParaApartado(db, consulta);
  assert.deepEqual(
    lecciones[0],
    `En Villaejemplo (2036-2026), «Metodología de análisis de los flujos turísticos»: 14/20 (ganador 19). La mesa dijo: «La propuesta describe las fuentes de datos de telefonía y tarjetas, si bien ${COMENTARIO}.».`,
  );
  assert.equal(
    lecciones.some((l) => /Materno|docente/.test(l)),
    false,
    'el descartado no se usa',
  );
  assert.deepEqual(leccionesParaApartado(db, { titulo: 'Plan de comunicación', se_valorara: ['Redes sociales'] }), []);
  assert.equal(leccionesParaApartado(db, consulta, 1).length, 1);
});

test('should_add_accepted_learnings_of_the_same_body_to_similar_proposals', () => {
  const p = propuestaDeLicitacion(db, raices, OBJETIVO.id);
  assert.equal(p.error, null);
  assert.deepEqual(
    p.data!.aprendizajes.map((a) => [a.carpeta, a.motivos, a.puntos_ganador]),
    [[VILLAEJEMPLO, ['mismo órgano'], 39]],
  );
});

// I1 (revisión de la): el comentario literal de la mesa puede nombrar a quien propusimos; en
// el libro va tapado. Por la tool, que tapa con los nombres de Colaboradores.
test('should_mask_team_names_in_the_evidence_of_an_acta_lesson', async () => {
  // Arrange
  crearPersona(nucleo().db, { nombre: 'Lucía Fernández Ruiz', tipo: 'interno', rol: 'Coordinadora' });
  const carpeta = `${PRESENTADAS}/2026-04 - 88-2026 - Aldea - Formación digital`;
  const acta = `${carpeta}/Aldea_88-2026_Acta_Mesa_2026-07-01.pdf`;
  archivo(acta);
  const comentario = 'La coordinación de Lucía Fernández Ruiz se describe con detalle y reuniones semanales';
  indice.reemplazarArchivo(
    idx,
    {
      path: acta.slice('Conocimiento/'.length),
      kind: 'document',
      title: 'Acta',
      mtime_ms: 1,
      size: 1,
      pages: 1,
      status: 'ok',
      error: null,
      source: null,
    },
    trocearPaginas([`Valoración. Metodología y coordinación (10 puntos): 8 puntos. ${comentario}.`], true),
  );

  // Act
  const r = await enviar({
    carpeta,
    documento: acta,
    resultado: 'perdida',
    ganador: null,
    puntos_nuestros: 8,
    puntos_ganador: 10,
    criterios: [
      {
        criterio: 'Metodología y coordinación',
        puntos_max: 10,
        nuestros: 8,
        ganador: 10,
        comentario_mesa: comentario,
        pagina: 1,
      },
    ],
    lecciones: ['La mesa valora la coordinación con reuniones fijas: descríbelas con su frecuencia.'],
  });

  // Assert
  assert.equal(r.isError, undefined, texto(r));
  const l = db
    .prepare('SELECT evidencias FROM lecciones WHERE aprendizaje_id = (SELECT id FROM aprendizajes WHERE carpeta = ?)')
    .get(carpeta) as { evidencias: string };
  const evidencia = JSON.parse(l.evidencias)[0].texto as string;
  assert.doesNotMatch(evidencia, /Lucía Fernández/);
  assert.match(evidencia, /La coordinación de la persona \d+ se describe/);
});

// I2 (revisión de la): un acta leída antes del libro de lecciones deja sus lecciones al arrancar.
test('should_pass_to_the_book_the_lessons_of_actas_read_before_it_once', async () => {
  // Arrange: el acta de Aldea como la dejaba la plataforma antes del libro de lecciones (sin lecciones en él).
  const { leccionesDeActasAnteriores } =
    await import('../../src/dominios/licitaciones/propuestas/leccionesResultado.js');
  const carpeta = `${PRESENTADAS}/2026-04 - 88-2026 - Aldea - Formación digital`;
  const id = (db.prepare('SELECT id FROM aprendizajes WHERE carpeta = ?').get(carpeta) as { id: number }).id;
  db.prepare('DELETE FROM lecciones WHERE aprendizaje_id = ?').run(id);
  const deAldea = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM lecciones WHERE aprendizaje_id = ?').get(id) as { n: number }).n;

  // Act
  const pasadas = leccionesDeActasAnteriores(db, null);
  const otraVez = leccionesDeActasAnteriores(db, null);

  // Assert
  assert.deepEqual(
    [pasadas, otraVez, deAldea()],
    [1, 0, 1],
    'solo la de Aldea, una vez; las de Villaejemplo ya estaban y la descartada no cuenta',
  );
});
