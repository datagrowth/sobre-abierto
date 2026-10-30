// Lo que se aprende de cómo acabó una oferta: lecciones de decisión y de precio que saca el
// código del resultado, el acta en la carpeta única y el aviso de «sube el acta».
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { leccionesDeResolucion } from '../../src/dominios/licitaciones/propuestas/leccionesResultado.js';
import { actasSinAprendizaje } from '../../src/dominios/licitaciones/propuestas/actas.js';
import { actasQueFaltan } from '../../src/dominios/licitaciones/propuestas/actasQueFaltan.js';
import { AYTO, licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lecciones-resultado-'));
const conocimiento = path.join(tmp, 'conocimiento');
const db = abrirLicitaciones(path.join(tmp, 'datos'));
after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const RIVAL = { nif: 'B99999999', nombre: 'RIVAL HABITUAL SL', importe: 90_000, ofertas: 3 };
const anio = new Date().getUTCFullYear();
for (const mes of ['02', '05'])
  guardarLicitacion(
    db,
    licitacion({ titulo: `Servicio de analítica ${mes}`, publicada: `${anio - 1}-${mes}-10`, ganadores: [RIVAL] }),
  );
const NUESTRA = licitacion({
  titulo: 'Cuadro de mando municipal',
  publicada: `${anio}-03-10`,
  cpv: '72316000',
  ganadores: [RIVAL],
});
guardarLicitacion(db, NUESTRA);

function propuesta(resultado: string, baja: number | null, bajaGanadora: number | null): number {
  db.prepare('DELETE FROM propuestas WHERE licitacion_id = ?').run(NUESTRA.id);
  const ts = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO propuestas (licitacion_id, presentada_en, baja_ofertada, resultado, resultado_origen, ganador_nif, baja_ganadora, creada_en, actualizada_en, resuelta_en)
    VALUES (?, ?, ?, ?, 'placsp', ?, ?, ?, ?, ?)`,
      )
      .run(NUESTRA.id, ts, baja, resultado, resultado === 'ganada' ? null : RIVAL.nif, bajaGanadora, ts, ts, ts)
      .lastInsertRowid,
  );
}
const lecciones = () =>
  db
    .prepare(
      "SELECT origen, alcance, alcance_valor, texto, estado FROM lecciones WHERE licitacion_id = ? AND origen IN ('decision', 'precio') ORDER BY origen",
    )
    .all(NUESTRA.id) as { origen: string; alcance: string; alcance_valor: string; texto: string }[];

test('should_learn_from_losing_to_a_repeated_winner_and_from_bidding_less_than_the_winner', () => {
  // Arrange
  const p = propuesta('perdida', 0.05, 0.12);

  // Act
  const n = leccionesDeResolucion(db, p);
  leccionesDeResolucion(db, p);

  // Assert
  assert.equal(n, 2);
  const [decision, precio] = lecciones();
  assert.deepEqual([decision!.origen, decision!.alcance, decision!.alcance_valor], ['decision', 'organo', AYTO.nombre]);
  assert.match(decision!.texto, /ya había ganado 2 contratos/);
  assert.doesNotMatch(decision!.texto, /RIVAL/, 'sin el nombre del adjudicatario: puede ser una persona física');
  assert.deepEqual([precio!.origen, precio!.alcance, precio!.alcance_valor], ['precio', 'cpv', '7231']);
  assert.match(precio!.texto, /la ganadora bajó un 12 %: con un 5 % perdimos por precio/);
  assert.equal(lecciones().length, 2, 'volver a resolver sustituye las pendientes');
});

test('should_say_the_technical_part_weighed_more_when_we_bid_lower_and_lost', () => {
  leccionesDeResolucion(db, propuesta('perdida', 0.2, 0.1));
  assert.match(
    lecciones().find((l) => l.origen === 'precio')!.texto,
    /perdimos con más baja que la ganadora \(20 % frente a 10 %\)/,
  );
});

test('should_not_invent_a_price_lesson_without_data', () => {
  leccionesDeResolucion(db, propuesta('ganada', 0.3, 0.3));
  assert.deepEqual(lecciones(), [], 'sin mediana del segmento no se sabe si regalamos margen');
});

test('should_ask_for_the_acta_of_a_resolved_offer_and_find_it_in_its_single_folder', () => {
  // Arrange
  propuesta('perdida', 0.05, 0.12);
  const ruta = `Licitaciones/Ofertas/${NUESTRA.expediente} · Cuadro de mando (${NUESTRA.id})`;
  db.prepare('INSERT INTO carpetas_unicas (licitacion_id, ruta, creada_en) VALUES (?, ?, ?)').run(
    NUESTRA.id,
    ruta,
    'x',
  );
  const dir = path.join(conocimiento, ...ruta.split('/'));
  const poner = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  };
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, origen, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/acta', 'otro', 'Acta de valoración de la mesa', 'pendiente', 'expediente', 'x')`,
  ).run(NUESTRA.id);

  // Act + Assert
  assert.deepEqual(
    actasQueFaltan(db, conocimiento).map((x) => [x.licitacion_id, x.carpeta, x.publicada]),
    [[NUESTRA.id, `Conocimiento/${ruta}/Resolución`, true]],
  );
  poner('Pliegos/Acta de apertura del sobre 2.pdf');
  assert.deepEqual(actasSinAprendizaje(db, conocimiento), [], 'el acta de apertura de los pliegos no es la valoración');
  poner('Pliegos/Informe de valoración de las ofertas.pdf');
  assert.deepEqual(actasSinAprendizaje(db, conocimiento), [
    {
      carpeta: `Conocimiento/${ruta}`,
      documento: `Conocimiento/${ruta}/Pliegos/Informe de valoración de las ofertas.pdf`,
    },
  ]);
  poner('Resolución/Acta mesa valoración.pdf');
  assert.deepEqual(
    actasSinAprendizaje(db, conocimiento)[0]!.documento,
    `Conocimiento/${ruta}/Resolución/Acta mesa valoración.pdf`,
    'lo que deja el equipo en Resolución va antes',
  );
  assert.deepEqual(actasQueFaltan(db, conocimiento), [], 'con el acta en su carpeta ya no se pide');
});
