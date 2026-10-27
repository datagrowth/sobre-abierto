// Lista por plazo: manda el próximo plazo que hay que cumplir (la solicitud de participación
// mientras siga abierta) y lo vencido va al final. La fila trae la recomendación de la ficha.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import { Filtro, listarOportunidades } from '../../src/dominios/licitaciones/oportunidades.js';
import { FichaDatos } from '../../src/dominios/licitaciones/ficha.js';
import { licitacion } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-orden-'));
const abiertas: Db[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-14T10:00:00Z');
let n = 0;

type Fila = { titulo: string; limite: string; solicitud?: string };

function conNuevas(filas: Fila[]): { db: Db; ids: string[] } {
  n += 1;
  const dir = path.join(tmp, String(n));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  const ids = filas.map((f) => {
    const l = licitacion({ titulo: f.titulo, publicada: '2026-09-30', limite: f.limite });
    guardarLicitacion(db, l);
    db.prepare('UPDATE licitaciones SET fecha_solicitud = ? WHERE id = ?').run(f.solicitud ?? null, l.id);
    db.prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'nueva', 'x', 'x')",
    ).run(l.id);
    return l.id;
  });
  return { db, ids };
}

const porPlazo = (db: Db) =>
  listarOportunidades(db, Filtro.parse({ estados: ['nueva', 'ficha_por_revisar'], orden: 'plazo' }), AHORA).items;

test('should_order_by_participation_request_when_still_open', () => {
  // Arrange
  const { db, ids } = conNuevas([
    { titulo: 'Oferta en 5 días', limite: '2026-10-19T14:00:00' },
    { titulo: 'Dos fases tipo ESMASA', limite: '2026-11-03T14:00:00', solicitud: '2026-10-15T14:00:00' },
  ]);
  // Act
  const orden = porPlazo(db).map((i) => i.id);
  // Assert
  assert.deepEqual(orden, [ids[1], ids[0]]);
});

test('should_fall_back_to_offer_deadline_when_request_passed', () => {
  const { db, ids } = conNuevas([
    { titulo: 'Solicitud ya pasada', limite: '2026-10-24T14:00:00', solicitud: '2026-10-10T14:00:00' },
    { titulo: 'Oferta en 5 días', limite: '2026-10-19T14:00:00' },
  ]);
  const orden = porPlazo(db).map((i) => i.id);
  assert.deepEqual(orden, [ids[1], ids[0]]);
});

test('should_keep_expired_last', () => {
  const { db, ids } = conNuevas([
    {
      titulo: 'Vencida con solicitud futura mal puesta',
      limite: '2026-10-01T14:00:00',
      solicitud: '2026-10-15T08:00:00',
    },
    { titulo: 'Sin solicitud', limite: '2026-10-30T14:00:00' },
    { titulo: 'Solicitud mañana', limite: '2026-11-20T14:00:00', solicitud: '2026-10-15T14:00:00' },
  ]);
  const orden = porPlazo(db).map((i) => i.id);
  assert.deepEqual(orden, [ids[2], ids[1], ids[0]]);
});

test('should_include_ficha_recommendation_without_amounts', () => {
  // Arrange
  const { db, ids } = conNuevas([
    { titulo: 'Con ficha', limite: '2026-10-30T14:00:00' },
    { titulo: 'Sin ficha', limite: '2026-10-31T14:00:00' },
  ]);
  const datos = {
    resumen: 'Servicio de mantenimiento durante dos años.',
    requisitos: [],
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'go', motivo: 'Encaja con lo que hacemos y hay solvencia de sobra.' },
  };
  assert.ok(FichaDatos.safeParse(datos).success);
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'aprobada', ?, 'licitaciones', 'x', 'x')",
  ).run(ids[0], JSON.stringify(datos));
  // Act
  const items = porPlazo(db);
  // Assert
  const conFicha = items.find((i) => i.id === ids[0]);
  assert.deepEqual(conFicha?.recomendacion_ficha, {
    decision: 'go',
    motivo: 'Encaja con lo que hacemos y hay solvencia de sobra.',
  });
  assert.deepEqual(Object.keys(conFicha?.recomendacion_ficha ?? {}).sort(), ['decision', 'motivo']);
  assert.equal(items.find((i) => i.id === ids[1])?.recomendacion_ficha, null);
});
