// Detector de reutilización literal: un apartado que copia más del 30 % de una memoria
// presentada a otro órgano sale como riesgo en las comprobaciones; al mismo órgano, o reescrito, no.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, cerrar, db, ID, sinMemorias } from '../helpers/memoriaEntorno.js';
import { licitacion } from '../helpers/sinteticas.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';

const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { fraccionCopiada, reutilizacionesDe, secuencias } =
  await import('../../src/dominios/licitaciones/oferta/reutilizacionLiteral.js');
const { reglaMemoriaReutilizada } =
  await import('../../src/dominios/licitaciones/oferta/comprobacionesReglasReutilizacion.js');

before(arrancar);
after(cerrar);

const CABILDO = { nombre: 'Cabildo Insular de Isla Ejemplo', nif: 'P0000002F' };
const OTRA = licitacion({ titulo: 'Formación en competencias digitales', publicada: '2026-05-01', organo: CABILDO });
guardarLicitacion(db, OTRA);

const METODOLOGIA = Array.from(
  { length: 12 },
  (_, i) =>
    `En la sesión ${i + 1} el equipo docente revisa con cada grupo el avance de las prácticas, resuelve las dudas abiertas en el foro y deja una tarea corta para la semana siguiente.`,
).join(' ');
const PROPIO = Array.from(
  { length: 12 },
  (_, i) =>
    `El plan para el área ${i + 1} combina tutorías individuales, talleres prácticos con casos reales del servicio y una evaluación final que mide lo aprendido por cada persona.`,
).join(' ');

function presentada(id: string, texto: string): number {
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, presentada, subida) VALUES (?, ?, 1, 'ensamblada', 'x', 1, 'presentada.docx')",
      )
      .run(id, g.id).lastInsertRowid,
  );
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, 1, 'recibido', ?)").run(
    m,
    JSON.stringify({ titulo: 'Metodología', bloques: [{ parrafos: [texto] }], cubre: [], compromisos: [] }),
  );
  return m;
}

test('should_measure_the_share_of_eight_word_sequences_copied', () => {
  const a = secuencias(['uno dos tres cuatro cinco seis siete ocho nueve diez']);
  assert.equal(a.size, 3);
  assert.equal(fraccionCopiada(a, secuencias(['Uno, dos, tres, cuatro, cinco, seis, siete, ocho'])), 1 / 3);
  assert.equal(fraccionCopiada(new Set(), a), 0);
});

test('should_flag_a_section_copied_from_an_offer_to_another_body', () => {
  // Arrange
  sinMemorias();
  presentada(OTRA.id, METODOLOGIA);

  // Act
  const r = reutilizacionesDe(db, ID, [PROPIO, `${METODOLOGIA} ${PROPIO.slice(0, 200)}`]);

  // Assert
  assert.equal(r.length, 1);
  assert.equal(r[0]!.apartado, 2);
  assert.equal(r[0]!.licitacion_id, OTRA.id);
  assert.equal(r[0]!.organo, CABILDO.nombre);
  // Las frases del ejemplo se parecen entre sí: muchas secuencias se repiten y el añadido pesa más.
  assert.ok(r[0]!.fraccion > 0.5, String(r[0]!.fraccion));
});

test('should_not_flag_reuse_from_the_same_body_or_from_this_tender', () => {
  sinMemorias();
  const mismo = db.prepare('SELECT organo_nif FROM licitaciones WHERE id = ?').get(ID) as { organo_nif: string | null };
  const delMismo = licitacion({
    titulo: 'Formación anterior',
    publicada: '2025-05-01',
    organo: { nombre: 'Mismo órgano', nif: mismo.organo_nif ?? 'X' },
  });
  guardarLicitacion(db, delMismo);
  if (mismo.organo_nif) presentada(delMismo.id, METODOLOGIA);
  presentada(ID, METODOLOGIA);
  assert.deepEqual(reutilizacionesDe(db, ID, [METODOLOGIA]), []);
});

test('should_not_judge_a_short_section', () => {
  sinMemorias();
  presentada(OTRA.id, METODOLOGIA);
  assert.deepEqual(reutilizacionesDe(db, ID, [METODOLOGIA.slice(0, 300)]), []);
});

test('should_turn_each_copied_section_into_a_risk_row_of_its_lot', () => {
  const e = {
    reutilizaciones: [
      {
        lote: '2',
        memoria_id: 9,
        version: 3,
        apartados: [{ apartado: 4, fraccion: 0.42, licitacion_id: 'p-1', expediente: '7/2026', organo: 'Cabildo' }],
      },
    ],
  } as unknown as EntradasComprobaciones;
  const [b] = reglaMemoriaReutilizada(e);
  assert.equal(b!.clave, 'memoria_reutilizada:2:4');
  assert.equal(b!.gravedad, 'riesgo');
  assert.equal(b!.accion.destino, 'memoria.apartado.4');
  assert.equal(
    b!.titulo,
    'El apartado 4 de la v3 copia el 42 % de la memoria presentada a Cabildo (7/2026): reescríbelo para este cliente',
  );
});
