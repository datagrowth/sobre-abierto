// El Pipeline: columnas que se mueven solas con la PLACSP, «Lista para firmar» desde el
// veredicto de las comprobaciones, título corto de la ficha o por código, y el aviso de lo que está por revisar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { columnaDe, pipeline, tituloCorto } = await import('../../src/dominios/licitaciones/pipeline.js');
const { licitacion } = await import('../helpers/sinteticas.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const HOY = '2026-10-22T10:00:00';

test('should_cut_the_usual_opening_of_placsp_titles', () => {
  assert.equal(
    tituloCorto('Contratación de los servicios de formación en IA para personal técnico'),
    'Formación en IA para personal técnico',
  );
  assert.equal(
    tituloCorto('contratación anticipada, por lotes, del servicio para la impartición de cursos'),
    'Impartición de cursos',
  );
  assert.equal(tituloCorto('Servicio de cuadro de mando de movilidad.'), 'Cuadro de mando de movilidad');
  assert.equal(
    tituloCorto('Suministro de licencias de software de análisis de datos'),
    'Licencias de software de análisis de datos',
  );
  assert.equal(
    tituloCorto('Servicio Canario de la Salud: formación en IA'),
    'Servicio Canario de la Salud: formación en IA',
  );
  assert.equal(
    tituloCorto('Servicios sociales comunitarios del Ayuntamiento de Aldea'),
    'Servicios sociales comunitarios del Ayuntamiento de Aldea',
  );
  assert.equal(
    tituloCorto('Suministro y mantenimiento de equipos informáticos'),
    'Suministro y mantenimiento de equipos informáticos',
  );
  assert.equal(tituloCorto('Contratación pública verde'), 'Contratación pública verde');
});

test('should_cut_long_titles_at_a_word_with_an_ellipsis', () => {
  // Arrange
  const largo =
    'Servicios necesarios para la ejecución del Programa de Capacitación en Conservación para el personal de archivos y bibliotecas de las entidades locales de la isla';

  // Act
  const t = tituloCorto(largo);

  // Assert
  assert.ok(t.length <= 60, t);
  assert.ok(t.endsWith('…'));
  assert.ok(!t.includes('  '));
  assert.equal(t.startsWith('Programa de Capacitación en Conservación'), true, t);
});

test('should_move_presented_offers_with_the_placsp_and_the_result', () => {
  const base = { veredicto: null, fecha_limite: '2026-10-30T14:00:00' };
  assert.equal(
    columnaDe({ ...base, estado: 'presentada', estado_placsp: 'PUB' }, HOY),
    'presentada',
    'con el plazo abierto',
  );
  assert.equal(
    columnaDe({ ...base, estado: 'presentada', estado_placsp: 'PUB', fecha_limite: '2026-10-20T14:00:00' }, HOY),
    'en_evaluacion',
    'cerrado el plazo',
  );
  assert.equal(columnaDe({ ...base, estado: 'presentada', estado_placsp: 'EV' }, HOY), 'en_evaluacion');
  assert.equal(
    columnaDe({ ...base, estado: 'presentada', estado_placsp: 'ADJ' }, HOY),
    'resuelta',
    'adjudicada, aunque aún no sepamos si ganamos',
  );
  assert.equal(columnaDe({ ...base, estado: 'ganada', estado_placsp: 'RES' }, HOY), 'resuelta');
  assert.equal(
    columnaDe({ ...base, estado: 'en_preparacion', estado_placsp: 'PUB', veredicto: 'lista_para_firmar' }, HOY),
    'lista_para_firmar',
  );
  assert.equal(
    columnaDe({ ...base, estado: 'en_preparacion', estado_placsp: 'PUB', veredicto: 'no_presentable' }, HOY),
    'en_preparacion',
  );
});

function conOportunidad(
  titulo: string,
  estado: string,
  extra: { limite?: string; placsp?: string; tituloFicha?: string } = {},
): string {
  const db = dbLicitaciones();
  const l = {
    ...licitacion({ titulo, publicada: '2026-10-01', limite: extra.limite ?? '2026-11-10T14:00:00' }),
    estado: extra.placsp ?? 'PUB',
  };
  guardarLicitacion(db, l);
  db.prepare(
    'INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?)',
  ).run(l.id, estado, 'CPV 72', '2026-10-01T10:00:00Z', 'x');
  if (extra.tituloFicha) {
    db.prepare(
      "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'aprobada', ?, 'hermes', 'x', 'x')",
    ).run(l.id, JSON.stringify({ titulo_corto: extra.tituloFicha }));
  }
  return l.id;
}

test('should_build_the_board_by_closing_date_and_warn_of_what_is_pending_review', () => {
  // Arrange
  const tarde = conOportunidad('Servicio de analítica tardía', 'presentada', { limite: '2026-11-20T14:00:00' });
  const pronto = conOportunidad('Servicio de analítica temprana', 'presentada', {
    limite: '2026-11-05T14:00:00',
    tituloFicha: 'Analítica temprana para el cabildo',
  });
  const ganada = conOportunidad('Formación ganada', 'ganada', { limite: '2026-09-01T14:00:00', placsp: 'RES' });
  const porRevisar = conOportunidad('Datos abiertos municipales', 'nueva', { limite: '2026-10-30T14:00:00' });
  conOportunidad('Datos que ya cerraron', 'nueva', { limite: '2026-10-01T14:00:00' });
  conOportunidad('Descartada', 'descartada');

  // Act
  const p = pipeline(dbLicitaciones(), Date.parse('2026-10-22T08:00:00Z'));

  // Assert
  const col = Object.fromEntries(p.columnas.map((c) => [c.clave, c.tarjetas]));
  assert.deepEqual(
    p.columnas.map((c) => c.titulo),
    ['En preparación', 'Lista para firmar', 'Presentada', 'En evaluación', 'Resuelta'],
  );
  assert.deepEqual(
    col['presentada']!.map((t) => t.id),
    [pronto, tarde],
    'por fecha de cierre',
  );
  assert.equal(col['presentada']![0]!.titulo_corto, 'Analítica temprana para el cabildo', 'el de la ficha manda');
  assert.equal(col['presentada']![1]!.titulo_corto, 'Analítica tardía', 'sin ficha, por código');
  assert.deepEqual(
    col['resuelta']!.map((t) => [t.id, t.resultado]),
    [[ganada, 'ganada']],
  );
  assert.equal(p.por_revisar.total, 1, 'solo lo nuevo en plazo');
  assert.equal(p.por_revisar.proximas[0]!.id, porRevisar);
});

test('should_put_an_offer_ready_to_sign_in_its_column_from_the_comprobaciones_verdict', () => {
  // Arrange: CASO_E tal como estaba el 14/10, en preparación con lo que impide presentar.
  const db = dbLicitaciones();
  const casoE = leerFixtureComprobaciones('casoE');
  sembrarFixture(db, nucleo().db, casoE);

  // Act
  const p = pipeline(db, Date.parse(casoE.ahora));

  // Assert
  const enPreparacion = p.columnas.find((c) => c.clave === 'en_preparacion')!.tarjetas.map((t) => t.id);
  assert.ok(enPreparacion.includes(casoE.id), 'no presentable: sigue en preparación');
  assert.equal(
    p.columnas.find((c) => c.clave === 'lista_para_firmar')!.tarjetas.some((t) => t.id === casoE.id),
    false,
  );
});

// Arrastrar una tarjeta de Presentada a En preparación deshace la presentación (Pipeline › Tablero).
const { deshacerPresentacion } = await import('../../src/dominios/licitaciones/propuestas/registro.js');

function conPropuesta(id: string, lote: string, resultado = 'pendiente'): void {
  dbLicitaciones()
    .prepare(
      `INSERT INTO propuestas (licitacion_id, lote, presentada_en, resultado, creada_en, actualizada_en)
    VALUES (?, ?, '2026-10-20', ?, 'x', 'x')`,
    )
    .run(id, lote, resultado);
}

test('should_return_a_presented_offer_to_preparation_when_its_presentation_is_undone', () => {
  // Arrange
  const id = conOportunidad('Servicio presentado por error', 'presentada');
  conPropuesta(id, '1');
  conPropuesta(id, '2');

  // Act
  const r = deshacerPresentacion(dbLicitaciones(), id);

  // Assert
  assert.deepEqual(r.data, { estado: 'en_preparacion', borradas: 2 });
  const db = dbLicitaciones();
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM propuestas WHERE licitacion_id = ?').get(id) as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(id) as { estado: string }).estado,
    'en_preparacion',
  );
  const enPreparacion = pipeline(db, Date.parse('2026-10-22T08:00:00Z')).columnas.find(
    (c) => c.clave === 'en_preparacion',
  )!;
  assert.ok(enPreparacion.tarjetas.some((t) => t.id === id));
});

test('should_refuse_to_undo_a_presentation_that_already_has_a_result', () => {
  // Arrange
  const id = conOportunidad('Servicio con un lote ya perdido', 'presentada');
  conPropuesta(id, '1', 'perdida');
  conPropuesta(id, '2');

  // Act
  const r = deshacerPresentacion(dbLicitaciones(), id);

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(
    (dbLicitaciones().prepare('SELECT COUNT(*) AS n FROM propuestas WHERE licitacion_id = ?').get(id) as { n: number })
      .n,
    2,
  );
});

test('should_refuse_to_undo_when_the_offer_is_not_presented_or_does_not_exist', () => {
  const enPreparacion = conOportunidad('Servicio aún en preparación', 'en_preparacion');
  assert.equal(deshacerPresentacion(dbLicitaciones(), enPreparacion).error?.code, 'invalid_input');
  const ganada = conOportunidad('Servicio ya ganado', 'ganada');
  assert.equal(deshacerPresentacion(dbLicitaciones(), ganada).error?.code, 'invalid_input');
  assert.equal(deshacerPresentacion(dbLicitaciones(), 'no-existe').error?.code, 'not_found');
});
