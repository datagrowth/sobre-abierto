// La pantalla Aprendizaje sobre el caso A: lo que espera a una persona, el libro con su
// uso, ajustar el alcance, retirar (a mano y tras un año sin uso) y el efecto oferta a oferta.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, arrancar, cerrar, db, ID, sinMemorias } from '../helpers/memoriaEntorno.js';

const { insertarLecciones } = await import('../../src/dominios/licitaciones/oferta/libroLecciones.js');
const { apuntarAplicadas } = await import('../../src/dominios/licitaciones/oferta/leccionesAplicadas.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { MOTIVO_SIN_USO, pendientesAprendizaje, retirarSinUso } =
  await import('../../src/dominios/licitaciones/oferta/aprendizajeVista.js');

before(arrancar);
after(cerrar);

type Tarjeta = {
  id: number;
  estado: string;
  alcance: string;
  alcance_valor: string | null;
  titulo_licitacion: string | null;
  opciones_alcance: { organo: string; cpv: string };
  uso: { aplicaciones: number; ofertas: number };
};
type Vista = {
  por_revisar: { lecciones: Tarjeta[] };
  libro: Tarjeta[];
  efecto: {
    ofertas: { pct: number; nuevas_lecciones: boolean; lecciones_aceptadas: number }[];
    trimestres: { trimestre: string; tasa: number }[];
    nota: string;
  };
};
const leer = async () => (await (await api('/aprendizaje', undefined, 'GET')).json()) as Vista;

function leccion(texto: string, estado = 'pendiente', revisada: string | null = null): number {
  insertarLecciones(db, [
    {
      licitacion_id: ID,
      origen: 'edicion',
      alcance: 'general',
      alcance_valor: null,
      tema: 'metodologia',
      texto,
      evidencias: [],
      agente: 'licitaciones',
    },
  ]);
  const id = (db.prepare('SELECT MAX(id) AS id FROM lecciones').get() as { id: number }).id;
  db.prepare('UPDATE lecciones SET estado = ?, revisada_en = ? WHERE id = ?').run(estado, revisada, id);
  return id;
}

const limpiar = () => {
  sinMemorias();
  db.exec(
    'DELETE FROM lecciones; DELETE FROM lecciones_aplicaciones; DELETE FROM aprendizajes; DELETE FROM propuestas;',
  );
};

test('should_list_pending_lessons_with_scope_options_and_the_book_with_where_they_were_used', async () => {
  // Arrange
  limpiar();
  const pendiente = leccion('Describe el ciclo de cada consulta con sus pasos.');
  const aceptada = leccion('Pon un indicador con meta por cada compromiso.', 'aceptada', new Date().toISOString());
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 1, 'ensamblada', 'x')",
      )
      .run(ID, g.id).lastInsertRowid,
  );
  apuntarAplicadas(db, { id: m, version: 1 }, 1, [aceptada]);
  apuntarAplicadas(db, { id: m, version: 1 }, 2, [aceptada]);

  // Act
  const v = await leer();

  // Assert
  const p = v.por_revisar.lecciones.find((l) => l.id === pendiente)!;
  assert.match(p.titulo_licitacion ?? '', /protección de datos/);
  assert.deepEqual(
    [p.opciones_alcance.organo.includes('SIIE'), p.opciones_alcance.cpv],
    [true, '7911'],
    'el órgano y el CPV de su licitación, para ajustar sin teclear',
  );
  const l = v.libro.find((x) => x.id === aceptada)!;
  assert.deepEqual([l.uso.aplicaciones, l.uso.ofertas], [2, 1]);
  assert.equal(pendientesAprendizaje(db), 1, 'la barra lateral cuenta la pendiente');
});

test('should_adjust_the_scope_and_retire_an_accepted_lesson_with_a_reason', async () => {
  limpiar();
  const id = leccion('Cita la normativa interna del cliente.', 'aceptada', new Date().toISOString());
  const malo = await api(`/lecciones/${id}/alcance`, { alcance: 'organo' }, 'PATCH');
  assert.equal(malo.status, 400, 'un alcance de órgano dice cuál');
  const bien = await api(
    `/lecciones/${id}/alcance`,
    { alcance: 'organo', alcance_valor: 'SIIE', tema: 'calidad' },
    'PATCH',
  );
  assert.equal(bien.status, 200);
  assert.deepEqual(db.prepare('SELECT alcance, alcance_valor, tema FROM lecciones WHERE id = ?').get(id), {
    alcance: 'organo',
    alcance_valor: 'SIIE',
    tema: 'calidad',
  });
  assert.equal((await api(`/lecciones/${id}/retirar`, { motivo: 'no' })).status, 400, 'retirar pide por qué');
  assert.equal(
    (await api(`/lecciones/${id}/retirar`, { motivo: 'Contradice la lección del cronograma.' })).status,
    200,
  );
  assert.equal(
    (await api(`/lecciones/${id}/retirar`, { motivo: 'Contradice la lección del cronograma.' })).status,
    409,
    'solo una aceptada se retira',
  );
  assert.deepEqual(
    (await leer()).libro.map((x) => [x.id, x.estado]),
    [[id, 'retirada']],
    'la retirada sigue en el libro',
  );
});

test('should_retire_by_itself_an_accepted_lesson_unused_for_a_year', () => {
  limpiar();
  const haceDos = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString();
  const sinUso = leccion('Una lección que ya nadie usa.', 'aceptada', haceDos);
  const usada = leccion('Una lección que se sigue usando.', 'aceptada', haceDos);
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 1, 'ensamblada', 'x')",
      )
      .run(ID, g.id).lastInsertRowid,
  );
  apuntarAplicadas(db, { id: m, version: 1 }, 1, [usada]);
  assert.equal(retirarSinUso(db), 1);
  const estado = (id: number) => db.prepare('SELECT estado, retirada_motivo FROM lecciones WHERE id = ?').get(id);
  assert.deepEqual(estado(sinUso), { estado: 'retirada', retirada_motivo: MOTIVO_SIN_USO });
  assert.deepEqual(estado(usada), { estado: 'aceptada', retirada_motivo: null });
});

test('should_show_the_effect_offer_by_offer_marking_when_lessons_were_accepted_as_a_trend', async () => {
  // Arrange: dos actas (62 % y 80 % del ganador) y una lección aceptada entre medias.
  limpiar();
  const acta = (carpeta: string, nuestros: number, ganador: number, fecha: string) =>
    db
      .prepare(
        `INSERT INTO aprendizajes (carpeta, documento, datos, estado, agente, creado_en) VALUES (?, ?, ?, 'aceptada', 'licitaciones', ?)`,
      )
      .run(
        carpeta,
        `${carpeta}/acta.pdf`,
        JSON.stringify({
          resultado: 'perdida',
          ganador: null,
          puntos_nuestros: nuestros,
          puntos_ganador: ganador,
          criterios: [],
          lecciones: [],
        }),
        fecha,
      );
  acta('Conocimiento/a', 31, 50, '2026-03-01T00:00:00Z');
  leccion('Cuantifica el volumen de datos.', 'aceptada', '2026-04-01T00:00:00Z');
  acta('Conocimiento/b', 40, 50, '2026-06-01T00:00:00Z');
  const ts = '2026-08-10T00:00:00Z';
  for (const [lote, resultado] of [
    ['1', 'ganada'],
    ['2', 'perdida'],
  ])
    db.prepare(
      `INSERT INTO propuestas (licitacion_id, lote, presentada_en, resultado, creada_en, actualizada_en, resuelta_en) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(ID, lote, ts, resultado, ts, ts, ts);

  // Act
  const e = (await leer()).efecto;

  // Assert
  assert.deepEqual(
    e.ofertas.map((o) => [o.pct, o.lecciones_aceptadas, o.nuevas_lecciones]),
    [
      [62, 0, false],
      [80, 1, true],
    ],
  );
  assert.deepEqual(e.trimestres, [{ trimestre: '2026-T3', ganadas: 1, perdidas: 1, tasa: 50 }]);
  assert.match(e.nota, /tendencia, no una prueba/);
});
