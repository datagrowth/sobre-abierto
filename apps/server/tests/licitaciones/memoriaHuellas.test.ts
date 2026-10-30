// Huellas del dossier y lo que un cambio tardío deja atrás sobre la
// memoria del lote 2 de CASO_E (fixtures/comprobaciones/casoE.json, seudonimizada): el caso «persona» de Paco
// (la docente principal del lote 2 sale y entra otra), el del precio (no marca nada) y un dossier
// de antes de las huellas (se marca para revisar). Lo que traen los runs (estrategia, apartados)
// se escribe con SQL directo.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-huellas-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
const indexDir = path.join(tmp, 'index');
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = indexDir;
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { trocearPaginas } = await import('../../src/biblioteca/motor/documentos/trozos.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { componerDossier, dossierDe, guardarDossier, huellasActuales, CLAVES_HUELLA_BARATA } =
  await import('../../src/dominios/licitaciones/oferta/dossier.js');
const { afectadosDeHuellas, desfaseMemoria, seccionesCambiadas } =
  await import('../../src/dominios/licitaciones/oferta/huellasMemoria.js');
const { progresoDe, progresoSinNombres } = await import('../../src/dominios/licitaciones/oferta/progresoMemoria.js');
const { filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { estrategiaCasoA } = await import('./fixtures/estrategiaCasoA.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type HechoData = import('../../src/dominios/licitaciones/oferta/estrategia.js').HechoData;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_E = leerFixtureComprobaciones('casoE');
sembrarFixture(db, nucleo().db, CASO_E);
const DIAS = 24 * 3_600_000;

// Los nombres de la captura («Persona H») son de una letra y no se reconocen en un texto: la
// docente del lote 2 y su sustituta llevan seudónimos de dos palabras.
const persona = (nombre: string) => crearPersona(nucleo().db, { nombre, tipo: 'interno', rol: 'Docente' }).data!.id;
const SALE = 'Persona Hache';
const ENTRA = 'Persona Eme';
const ID_SALE = persona(SALE);
const ID_ENTRA = persona(ENTRA);
const ROL_LOTE_2 = 'Docente principal del lote 2';
const ROL_LOTE_4 = 'Docente principal del lote 4';

type Miembro = { persona_id: number; rol_en_la_oferta: string; dedicacion?: string; lotes: string[] };
type Datos = {
  equipo: Miembro[];
  herramientas: string[];
  ofertas: { lote: string; pendiente: boolean; importe: number | null; unitarios: unknown[] }[];
};
const DATOS_BASE = JSON.parse(
  (db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(CASO_E.id) as { datos: string }).datos,
) as Datos;

function decisiones(cambio: (d: Datos) => void = () => {}): void {
  const d = structuredClone(DATOS_BASE);
  // La captura va sin importes ofertados y sin lotes por persona: se ponen los del caso.
  d.ofertas = d.ofertas.map((o) => ({ ...o, pendiente: true, importe: null, unitarios: [] }));
  d.equipo = d.equipo.map((m) =>
    m.rol_en_la_oferta.startsWith(ROL_LOTE_2)
      ? { ...m, persona_id: ID_SALE, lotes: ['2'] }
      : { ...m, lotes: m.rol_en_la_oferta.startsWith(ROL_LOTE_4) ? ['4'] : [] },
  );
  cambio(d);
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(d), CASO_E.id);
}

const HECHOS: HechoData[] = [
  {
    clave: 'docente_lote_2',
    categoria: 'rol',
    sobre: 'docente principal del lote 2',
    valor: ROL_LOTE_2,
    palabras: ['docente'],
  },
  {
    clave: 'plataforma',
    categoria: 'herramienta',
    sobre: 'plataforma de teleformación',
    valor: 'Aula Abierta 4.x',
    palabras: ['plataforma'],
  },
  {
    clave: 'horario_tutorias',
    categoria: 'horario',
    sobre: 'tutorías',
    valor: 'L-V 9:00-14:00 (Canarias)',
    palabras: ['tutorías'],
  },
];
const TEXTOS = [
  `${SALE}, docente principal del lote 2, impartirá las sesiones en directo desde Aula Abierta 4.x.`,
  'El docente principal del lote 2 revisará las tareas cada semana y las devolverá comentadas.',
  'Las tutorías serán de lunes a viernes de 9:00 a 14:00 (hora de Canarias).',
];

const ppt = CASO_E.pliegos.findIndex((p) => p.clase === 'ppt');
const RUTA_PPT = `Licitaciones/Radar/2026/${CASO_E.id}/${ppt}-${CASO_E.pliegos[ppt]!.nombre}`;
function pptIndexado(funciones: string): void {
  const idx = indice.abrirIndice(indexDir);
  const paginas = [
    'Pliego técnico de los servicios de formación.',
    `El docente principal del lote 2 tendrá como funciones ${funciones}`,
  ];
  indice.reemplazarArchivo(
    idx,
    {
      path: RUTA_PPT,
      kind: 'document',
      title: 'PPT',
      mtime_ms: 1,
      size: 1,
      pages: paginas.length,
      status: 'ok',
      error: null,
      source: null,
    },
    trocearPaginas(paginas, true),
  );
  idx.close();
}

let memoria = 0;
// La memoria del lote 2 montada: dossier guardado, hoja de hechos y los tres apartados recibidos.
async function memoriaMontada(): Promise<number> {
  db.exec(
    `DELETE FROM memoria_apartados; DELETE FROM memoria_dossiers; DELETE FROM memoria_estrategias; DELETE FROM memorias;`,
  );
  const r = pedirMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, CASO_E.id, {
    confirmado: true,
    ahoraMs: Date.parse(CASO_E.ahora) - 3 * DIAS,
  });
  assert.equal(r.error, null, r.error?.message);
  const id = r.data!.memorias.map((m) => filaMemoria(db, m.memoria)!).find((m) => m.lote === '2')!.id;
  const d = await componerDossier(db, nucleo().db, id);
  assert.equal(d.error, null, d.error?.message);
  assert.equal(guardarDossier(db, d.data!).error, null);
  const { id: _i, memoria_id: _m, version: _v, ...estrategia } = estrategiaCasoA({ memoria_id: id, version: 1 });
  db.prepare(
    "INSERT INTO memoria_estrategias (memoria_id, datos, agente, creada_en) VALUES (?, ?, 'licitaciones', '2026-10-14T10:00:00Z')",
  ).run(id, JSON.stringify({ ...estrategia, hechos: HECHOS }));
  db.prepare('DELETE FROM memoria_apartados WHERE memoria_id = ?').run(id);
  const insertar = db.prepare(
    "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, avisos) VALUES (?, ?, 'recibido', ?, ?, '[]')",
  );
  TEXTOS.forEach((t, i) =>
    insertar.run(
      id,
      i + 1,
      JSON.stringify({ titulo: `Apartado ${i + 1}`, bloques: [{ parrafos: [t] }], cubre: [], compromisos: [] }),
      t.length,
    ),
  );
  db.prepare("UPDATE memorias SET estado = 'ensamblada', fase = 'fin', ensamblada_en = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
  return id;
}

const sustituir = () =>
  decisiones((d) => {
    d.equipo = d.equipo.map((m) => (m.persona_id === ID_SALE ? { ...m, persona_id: ID_ENTRA } : m));
  });
const desfase = () => {
  const r = desfaseMemoria(db, nucleo().db, memoria);
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
};

beforeEach(async () => {
  pptIndexado('impartir las sesiones del curso y corregir las tareas.');
  decisiones();
  memoria = await memoriaMontada();
});

test('should_mark_equipo_changed_when_the_main_teacher_of_lote_2_is_replaced', () => {
  // Arrange
  sustituir();

  // Act
  const d = desfase();

  // Assert
  assert.deepEqual(d.secciones, ['equipo']);
  assert.deepEqual(d.hechos, ['docente_lote_2']);
  assert.ok(dossierDe(db, memoria)!.equipo_ids.includes(ID_SALE), 'el dossier guarda quién iba');
});

test('should_mark_only_apartados_that_name_the_person_who_left', () => {
  // Arrange
  sustituir();

  // Act
  const d = desfase();

  // Assert
  assert.deepEqual(d.apartados, [1], 'el 2 cita al docente por su rol y sigue valiendo; el 3 no habla del equipo');
});

test('should_not_mark_anything_when_only_the_price_changes', () => {
  // Arrange
  decisiones((d) => {
    d.ofertas = d.ofertas.map((o) => ({ ...o, pendiente: false, importe: o.lote === '2' ? 1 : null }));
  });

  // Act
  const d = desfase();
  const web = progresoDe(db, filaMemoria(db, memoria)!);

  // Assert
  assert.deepEqual(d, { secciones: [], hechos: [], apartados: [] });
  assert.equal(web.desfase, null);
});

test('should_mark_for_review_when_the_stored_dossier_has_no_fingerprint', () => {
  // Arrange: un dossier guardado antes de las huellas (sin huella ni equipo_ids).
  const fila = db.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(memoria) as {
    secciones: string;
  };
  const { equipo_ids: _e, ...viejo } = JSON.parse(fila.secciones) as {
    secciones: Record<string, unknown>[];
    equipo_ids: number[];
  };
  const secciones = viejo.secciones.map(({ huella: _h, ...s }) => s);
  db.prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?').run(
    JSON.stringify({ ...viejo, secciones }),
    memoria,
  );

  // Act
  const d = desfase();

  // Assert
  assert.deepEqual(d.secciones, [...CLAVES_HUELLA_BARATA]);
  assert.deepEqual(d.apartados, [1, 2], 'sin saber quién salió, el rol se busca por sus anclas');
  assert.deepEqual(seccionesCambiadas([{ clave: 'equipo', huella: '' }], { equipo: 'abc' }), ['equipo']);
});

test('should_not_read_pliegos_to_compute_fingerprints', async () => {
  // Arrange
  const guardada = dossierDe(db, memoria)!;
  const equipo = guardada.secciones.find((s) => s.clave === 'equipo')!;
  pptIndexado('dirigir la formación, coordinar a los tutores y evaluar a cada alumno.');

  // Act
  const ahora = huellasActuales(db, nucleo().db, memoria, ['equipo', 'identificacion']);
  const conPliegos = huellasActuales(db, nucleo().db, memoria, ['pliego_tecnico']);
  const recompuesto = await componerDossier(db, nucleo().db, memoria);

  // Assert
  assert.match(equipo.texto, /impartir las sesiones del curso/, 'el dossier entero sí cita el PPT');
  assert.match(recompuesto.data!.secciones.find((s) => s.clave === 'equipo')!.texto, /dirigir la formación/);
  assert.equal(ahora.data!.equipo, equipo.huella, 'la huella no depende de lo que diga el pliego');
  assert.equal(ahora.data!.identificacion, guardada.secciones.find((s) => s.clave === 'identificacion')!.huella);
  assert.equal(conPliegos.error?.code, 'invalid_input');
});

test('should_mark_apartados_with_a_tool_that_is_no_longer_decided', () => {
  // Arrange: sin Aula Abierta en las decisiones.
  decisiones((d) => {
    d.herramientas = d.herramientas.filter((h) => !h.startsWith('Aula Abierta'));
  });

  // Act
  const d = desfase();
  const puro = afectadosDeHuellas({
    secciones: ['herramientas'],
    hechos: HECHOS,
    textos: TEXTOS,
    nombresQueSalen: [],
    herramientas: ['Aula Abierta 4.x'],
  });

  // Assert
  assert.deepEqual(d.secciones, ['herramientas']);
  assert.deepEqual(d.hechos, ['plataforma']);
  assert.deepEqual(d.apartados, [1]);
  assert.deepEqual(puro.apartados, [], 'con la herramienta aún decidida, nada que rehacer');
});

test('should_keep_names_out_of_the_web_state', () => {
  // Arrange
  sustituir();

  // Act
  const web = progresoDe(db, filaMemoria(db, memoria)!);

  // Assert
  assert.deepEqual(web.desfase, { secciones: ['equipo'], apartados: [1] });
  assert.deepEqual(progresoSinNombres(web).desfase, web.desfase);
  assert.ok(!JSON.stringify(web.desfase).includes(SALE) && !JSON.stringify(web.desfase).includes(ENTRA));
});

test('should_mark_apartados_that_name_a_lote_no_longer_in_the_offer', () => {
  // Arrange: el caso «lotes»: se quita el lote 6 de una memoria común de los lotes 2, 6 y 4.
  const textos = [
    'En el lote 6 la formación será presencial en Gran Canaria.',
    'El docente principal del lote 2 revisará las tareas.',
    'Las tutorías serán por la mañana.',
  ];

  // Act
  const conCambio = afectadosDeHuellas({
    secciones: ['identificacion'],
    hechos: [],
    textos,
    nombresQueSalen: [],
    herramientas: [],
    lotesQuitados: ['6'],
  });
  const sinCambio = afectadosDeHuellas({
    secciones: [],
    hechos: [],
    textos,
    nombresQueSalen: [],
    herramientas: [],
    lotesQuitados: ['6'],
  });

  // Assert
  assert.deepEqual(conCambio.apartados, [1]);
  assert.deepEqual(sinCambio.apartados, [], 'sin cambio en la identificación, nada');
});

test('should_mark_apartados_that_promise_what_the_frontier_now_forbids', () => {
  // Arrange: Hermes recomienda ahora no prometer Aula Abierta: cambia la frontera del dossier.
  const antes = (
    db.prepare('SELECT datos FROM propuestas_decisiones WHERE licitacion_id = ?').get(CASO_E.id) as { datos: string }
  ).datos;
  const noPrometer = [
    {
      que: 'Aula Abierta propio',
      motivo: 'No tenemos una plataforma Aula Abierta propia.',
      marcas: ['Aula Abierta 4.x'],
    },
  ];
  db.prepare(
    "UPDATE propuestas_decisiones SET datos = json_set(datos, '$.no_prometer', json(?)) WHERE licitacion_id = ?",
  ).run(JSON.stringify(noPrometer), CASO_E.id);

  // Act
  const d = desfase();
  db.prepare('UPDATE propuestas_decisiones SET datos = ? WHERE licitacion_id = ?').run(antes, CASO_E.id);

  // Assert
  assert.deepEqual(d.secciones, ['frontera']);
  assert.deepEqual(d.apartados, [1]);
});

test('should_hide_the_web_desfase_when_no_apartado_depends_on_the_change', () => {
  // Arrange: una prórroga cambia el plazo (y la huella de la identificación) y ningún apartado lo cita.
  const plazo = (
    db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(CASO_E.id) as { fecha_limite: string }
  ).fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run('2026-12-22T14:00:00', CASO_E.id);

  // Act
  const d = desfase();
  const web = progresoDe(db, filaMemoria(db, memoria)!);
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(plazo, CASO_E.id);

  // Assert
  assert.deepEqual([d.secciones, d.apartados], [['identificacion'], []]);
  assert.equal(web.desfase, null, 'un aviso que no se puede resolver no se enseña');
});

test('should_not_flag_an_older_version_whose_dossier_has_no_fingerprint', () => {
  // Arrange: un dossier de antes de las huellas en una versión que ya no es la última de su lote.
  const fila = db.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(memoria) as {
    secciones: string;
  };
  const viejo = JSON.parse(fila.secciones) as { secciones: Record<string, unknown>[] };
  db.prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?').run(
    JSON.stringify({ ...viejo, secciones: viejo.secciones.map(({ huella: _h, ...s }) => s) }),
    memoria,
  );
  const m = filaMemoria(db, memoria)!;
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, lote) VALUES (?, ?, ?, 'ensamblada', ?, '2')",
  ).run(CASO_E.id, m.guion_id, m.version + 10, new Date().toISOString());

  // Act
  const d = desfaseMemoria(db, nucleo().db, memoria);
  db.prepare('DELETE FROM memorias WHERE licitacion_id = ? AND version = ?').run(CASO_E.id, m.version + 10);

  // Assert
  assert.equal(d.error, null);
  assert.equal(d.data, null, 'solo se marca la vigente de la oferta');
});
