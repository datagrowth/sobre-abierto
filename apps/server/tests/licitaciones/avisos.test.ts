// Avisos por email: el resumen semanal sin importes ni nombres de personas de fuera,
// que llega exactamente a los marcados el día y la hora elegidos y una vez por semana; el plazo a
// 48 h con algo que impide (CASO_E); la resolución de una presentada; las búsquedas guardadas; y las
// caducidades de la carpeta Empresa sin los CV.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://hermes.ejemplo.es';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { usarEnvioDePrueba } = await import('../../src/nucleo/correo.js');
const { montarCorreo } = await import('../../src/nucleo/correoPlantillas.js');
const avisos = await import('../../src/nucleo/avisos.js');
const { avisarCaducidades } = await import('../../src/nucleo/avisosEmpresa.js');
const { guardarPreferencias } = await import('../../src/nucleo/avisosPersona.js');
const { crearUsuario } = await import('../../src/nucleo/usuarios.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const lic = await import('../../src/dominios/licitaciones/avisos.js');
const { guardarBusqueda, busquedasDe } = await import('../../src/dominios/licitaciones/busquedasGuardadas.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type Correo = import('../../src/nucleo/correo.js').Correo;

iniciarNucleo();
const db = dbLicitaciones();
const dbN = nucleo().db;
after(() => {
  usarEnvioDePrueba(null);
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let enviados: Correo[] = [];
beforeEach(() => {
  enviados = [];
  usarEnvioDePrueba(async (c) => {
    enviados.push(c);
    return { data: { id: String(enviados.length) }, error: null };
  });
});

// Lunes 26 de octubre de 2026 a las 9:00 en Canarias (invierno: UTC).
const LUNES = Date.parse('2026-10-26T09:00:00Z');
const ts = (ms: number) => new Date(ms).toISOString();
const ELISA = (
  await crearUsuario(dbN, {
    email: 'elisa@example.com',
    nombre: 'Elisa Editora',
    rol: 'editor',
    contrasena: 'temporal-de-doce',
  })
).data!;
const LUIS = (
  await crearUsuario(dbN, {
    email: 'luis@example.com',
    nombre: 'Luis Lector',
    rol: 'lector',
    contrasena: 'temporal-de-doce',
  })
).data!;
lic.registrarAvisosLicitaciones(() => ({ db, dbNucleo: dbN }));

function nueva(id: string, titulo: string, llegada: number, presupuesto = 48_000) {
  const l = licitacion({ titulo, publicada: '2026-10-20', limite: '2026-11-20T14:00:00', presupuesto });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, creada_en, actualizada_en) VALUES (?, 'nueva', 'interesa', ?, ?)",
  ).run(id, ts(llegada), ts(llegada));
}

test('should_leave_amounts_and_outside_people_out_of_the_weekly_summary', () => {
  // Arrange: dos nuevas con importe, una presentada que ganó una persona física, un competidor
  // seguido que es empresa y otro que es una persona.
  nueva('p-90001', 'Formación en inteligencia artificial generativa', LUNES - 2 * 86_400_000, 48_250);
  nueva('p-90002', 'Cuadros de mando de movilidad', LUNES - 3 * 86_400_000, 120_000);
  const p = licitacion({
    titulo: 'Talleres de competencias digitales',
    publicada: '2026-08-01',
    ganadores: [{ nif: '12345678Z', nombre: 'Juan Autónomo Pérez', importe: 30_000, ofertas: 3 }],
  });
  guardarLicitacion(db, { ...p, id: 'p-90003', atom_id: 'atom-90003' });
  db.prepare(
    "INSERT INTO propuestas (licitacion_id, lote, presentada_en, importe_ofertado, resultado, importe_ganador, resuelta_en, creada_en, actualizada_en) VALUES ('p-90003', '', '2026-09-01', 31000, 'perdida', 30000, ?, ?, ?)",
  ).run(ts(LUNES - 86_400_000), ts(LUNES), ts(LUNES));
  for (const [nif, nombre, id] of [
    ['B87654321', 'Formadora Canaria SL', 'p-90004'],
    ['87654321X', 'María Competidora López', 'p-90005'],
  ] as const) {
    const g = licitacion({
      titulo: `Servicio ganado por ${id}`,
      publicada: '2026-10-01',
      ganadores: [{ nif, nombre, importe: 9_999, ofertas: 2 }],
    });
    guardarLicitacion(db, {
      ...g,
      id,
      atom_id: `atom-${id}`,
      resultados: g.resultados.map((r) => ({ ...r, fecha: '2026-10-22' })),
    });
    db.prepare("INSERT INTO seguidos (tipo, nif, creado_en, actualizado_en) VALUES ('competidor', ?, ?, ?)").run(
      nif,
      ts(LUNES),
      ts(LUNES),
    );
  }
  // Act
  const { html, texto } = montarCorreo(avisos.resumenSemanal(dbN, LUNES), 'https://hermes.ejemplo.es');
  // Assert
  for (const t of [html, texto]) {
    assert.doesNotMatch(t, /€|48[.,]?250|120[.,]?000|31[.,]?000|9[.,]?999/, 'ningún importe');
    assert.doesNotMatch(t, /Juan Autónomo|María Competidora/, 'ninguna persona de fuera del equipo');
  }
  assert.match(texto, /Formación en inteligencia artificial generativa/);
  assert.match(
    texto,
    /Las 5 nuevas que cierran antes/,
    'sin calibración que lo avale, el resumen no ordena por encaje',
  );
  assert.match(texto, /Perdida: Talleres de competencias digitales/);
  assert.match(texto, /Formadora Canaria SL ganó/, 'el competidor que seguimos, si es una empresa');
});

test('should_send_the_summary_exactly_to_the_marked_people_on_the_chosen_day_and_hour_once', async () => {
  // El día y la hora van en la zona de la empresa: con el perfil en Canarias, las 8:00 de allí.
  assert.equal(
    guardarPerfilEmpresa(dbN, { nif: 'B00123455', nombre: 'Analítica Ejemplo, S.L.', zona_horaria: 'Atlantic/Canary' })
      .error,
    null,
  );
  avisos.guardarConfigResumen(dbN, {
    destinatarios: [ELISA.id],
    dia: 1,
    hora: 8,
    secciones: { plazos: true, nuevas: true, novedades: false, lecciones: true },
  });
  assert.equal(await avisos.resumenSiToca(dbN, LUNES - 2 * 3_600_000), null, 'a las 7:00 aún no');
  const r = await avisos.resumenSiToca(dbN, LUNES);
  assert.deepEqual([r?.estado, r?.enviados], ['enviado', 1]);
  assert.deepEqual(
    enviados.map((c) => c.para),
    ['elisa@example.com'],
  );
  assert.doesNotMatch(enviados[0]!.texto, /Novedades de la semana/, 'sin la sección que se apagó');
  assert.equal((await avisos.resumenSiToca(dbN, LUNES + 3_600_000))?.estado, 'repetido', 'una vez por semana');
  assert.equal(await avisos.resumenSiToca(dbN, LUNES + 86_400_000), null, 'el martes no toca');
});

test('should_warn_48_hours_before_a_deadline_with_something_that_blocks_saying_what_without_amounts', async () => {
  // Arrange: CASO_E tal como estaba el 13/10 a las 20:34, con el plazo el 14 a las 8:00 y el precio sin decidir.
  const casoE = leerFixtureComprobaciones('casoE');
  sembrarFixture(db, dbN, casoE);
  const ahora = Date.parse(casoE.ahora);
  // Act
  await lic.avisarPlazos(db, dbN, ahora);
  await lic.avisarPlazos(db, dbN, ahora + 60_000);
  // Assert
  assert.deepEqual(
    enviados.map((c) => c.para).sort(),
    ['elisa@example.com', 'luis@example.com'],
    'a quien lo tiene activado, una vez',
  );
  assert.match(
    enviados[0]!.texto,
    /Cierra el 14\/10\/2027 a las 08:00 hora peninsular\. /,
    'el perfil del caso no está en Canarias: sin segunda hora',
  );
  assert.match(enviados[0]!.texto, /el precio sin decidir y \d+ cosas que impiden presentar/);
  assert.doesNotMatch(enviados[0]!.texto, /€/);
});

test('should_build_the_summary_only_when_it_is_going_to_be_sent', async () => {
  // Arrange: el martes siguiente, con un dominio que cuenta cuántas veces se monta el resumen.
  let montados = 0;
  avisos.registrarResumenSemanal('contador', () => {
    montados += 1;
    return [];
  });
  const MARTES = LUNES + 8 * 86_400_000;
  avisos.guardarConfigResumen(dbN, { destinatarios: [], dia: 2, hora: 8, secciones: {} });
  // Act + Assert
  assert.equal((await avisos.resumenSiToca(dbN, MARTES))?.estado, 'sin_destinatarios');
  assert.equal(montados, 0, 'a nadie: no se monta');
  avisos.guardarConfigResumen(dbN, { destinatarios: [ELISA.id], dia: 2, hora: 8, secciones: {} });
  for (let m = 0; m < 5; m += 1) await avisos.resumenSiToca(dbN, MARTES + m * 60_000);
  assert.equal(montados, 1, 'una vez enviado, las vueltas siguientes no lo montan');
  avisos.registrarResumenSemanal('contador', () => []);
});

test('should_not_rebuild_the_comprobaciones_every_minute_when_nothing_is_missing', async () => {
  // Arrange: una oferta que cierra mañana; sus comprobaciones, primero sin nada que falte y luego con el precio.
  const l = licitacion({
    titulo: 'Analítica de datos para el cabildo',
    publicada: '2026-10-01',
    limite: '2026-10-27T10:00:00',
  });
  guardarLicitacion(db, { ...l, id: 'p-90100', atom_id: 'atom-90100' });
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES ('p-90100', 'en_preparacion', ?, ?)",
  ).run(ts(LUNES), ts(LUNES));
  let bloqueos: unknown[] = [];
  let mirada = 0;
  const comprobaciones = (() => {
    mirada += 1;
    return { data: { bloqueos }, error: null };
  }) as unknown as import('../../src/dominios/licitaciones/avisos.js').ComprobacionesDe;
  // Act + Assert
  for (let m = 0; m < 10; m += 1) await lic.avisarPlazos(db, dbN, LUNES + m * 60_000, comprobaciones);
  assert.equal(mirada, 1, 'diez vueltas en diez minutos, una sola lectura de las comprobaciones');
  bloqueos = [{ categoria: 'precio', gravedad: 'impide', estado: 'abierto' }];
  await lic.avisarPlazos(db, dbN, LUNES + 15 * 60_000, comprobaciones);
  assert.equal(mirada, 2, 'pasado el rato se vuelve a mirar');
  assert.match(enviados[0]!.asunto, /«Analítica de datos para el cabildo» cierra en menos de 48 h/);
  await lic.avisarPlazos(db, dbN, LUNES + 16 * 60_000, comprobaciones);
  assert.equal(mirada, 2, 'y avisada, no se mira más');
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id = 'p-90100'").run();
});

test('should_tell_who_wants_it_when_placsp_resolves_one_of_ours', async () => {
  guardarPreferencias(dbN, LUIS.id, { resoluciones: false });
  await lic.avisarResolucion(db, dbN, { id: 'p-90003', propuesta: 1, resultado: 'perdida' });
  assert.deepEqual(
    enviados.map((c) => c.para),
    ['elisa@example.com'],
  );
  assert.match(enviados[0]!.asunto, /perdida «Talleres de competencias digitales»/);
  assert.match(enviados[0]!.html, /https:\/\/hermes\.ejemplo\.es\/#\/licitacion\/p-90003/);
});

test('should_send_each_person_the_new_ones_of_their_daily_searches_once_a_day', async () => {
  // Arrange: la búsqueda de Elisa, guardada antes de que llegaran las dos de formación.
  const b = guardarBusqueda(db, ELISA.id, {
    nombre: 'Formación',
    consulta: { texto: 'formación' },
    frecuencia: 'diaria',
  }).data!;
  db.prepare('UPDATE busquedas_guardadas SET avisada_hasta = ? WHERE id = ?').run(ts(LUNES - 10 * 86_400_000), b.id);
  // Act
  await lic.avisarBusquedas(db, dbN, LUNES);
  await lic.avisarBusquedas(db, dbN, LUNES + 60_000);
  // Assert
  assert.deepEqual(
    enviados.map((c) => c.para),
    ['elisa@example.com'],
  );
  assert.match(enviados[0]!.texto, /== Formación · 1 nueva ==/);
  assert.match(enviados[0]!.texto, /Formación en inteligencia artificial generativa/);
  assert.ok((busquedasDe(db, ELISA.id)[0]!.avisada_hasta ?? '') >= ts(LUNES), 'la siguiente vez, solo lo de después');
});

test('should_warn_of_company_documents_about_to_expire_but_not_of_cvs', async () => {
  guardarPreferencias(dbN, ELISA.id, { caducidades: true });
  const ins = dbN.prepare(
    'INSERT INTO empresa_documentos (tipo, nombre, ruta, caduca_en, actualizado_en) VALUES (?, ?, ?, ?, ?)',
  );
  ins.run('certificado', 'Certificado de estar al corriente con la AEAT', 'Empresa/aeat.pdf', '2026-11-05', ts(LUNES));
  ins.run('cv', 'CV de una persona', 'Colaboradores/cv.pdf', '2026-11-05', ts(LUNES));
  await avisarCaducidades(dbN, LUNES);
  await avisarCaducidades(dbN, LUNES + 60_000);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0]!.texto, /Certificado de estar al corriente con la AEAT/);
  assert.doesNotMatch(enviados[0]!.texto, /CV de una persona/);
});

test('should_sum_up_what_is_missing_without_titles_or_figures', () => {
  const b = (categoria: string, gravedad: string, estado = 'abierto') =>
    ({ categoria, gravedad, estado }) as Parameters<typeof lic.queFalta>[0][number];
  assert.equal(
    lic.queFalta([b('precio', 'impide'), b('documentos', 'impide'), b('elegibilidad', 'impide'), b('fugas', 'riesgo')]),
    'el precio sin decidir y 2 cosas que impiden presentar (documentos, elegibilidad)',
  );
  assert.equal(lic.queFalta([b('documentos', 'impide', 'resuelto')]), null, 'lo resuelto no cuenta');
  assert.equal(lic.queFalta([b('empresa', 'impide')]), '1 cosa que impide presentar (datos de la empresa)');
});
