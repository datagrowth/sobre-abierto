// Descarte tipificado: la categoría se guarda y el motivo sobrevive a recuperar la licitación.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  Cambio,
  cambiarOportunidad,
  detalle,
  historialDescartes,
} from '../../src/dominios/licitaciones/oportunidades.js';
import { descartarSola } from '../../src/dominios/licitaciones/gonogo.js';
import { MOTIVO_SIN_PLIEGOS, recuperarConPliegos } from '../../src/dominios/licitaciones/pliegos.js';
import { licitacion } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-descartes-'));
const abiertas: Db[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

let n = 0;
function conNueva(): { db: Db; id: string } {
  n += 1;
  const dir = path.join(tmp, String(n));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  const l = licitacion({ titulo: 'CASO_F', publicada: '2026-09-24', limite: '2026-12-15T08:00:00' });
  guardarLicitacion(db, l);
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'nueva', 'x', 'x')",
  ).run(l.id);
  return { db, id: l.id };
}

const cambio = (c: unknown) => Cambio.parse(c);
const motivoActual = (db: Db, id: string) =>
  (db.prepare('SELECT motivo_descarte AS m FROM oportunidades WHERE licitacion_id = ?').get(id) as { m: string | null })
    .m;

test('should_keep_the_discard_reason_in_the_history_after_recovering', () => {
  const { db, id } = conNueva();
  cambiarOportunidad(db, id, cambio({ estado: 'descartada', motivo_descarte: 'Falta solvencia técnica' }));
  cambiarOportunidad(db, id, cambio({ estado: 'nueva' }));
  cambiarOportunidad(db, id, cambio({ estado: 'descartada', motivo_descarte: 'Plazo imposible' }));
  const h = historialDescartes(db, id);
  assert.deepEqual(
    h.map((e) => [e.accion, e.motivo]),
    [
      ['descartada', 'Falta solvencia técnica'],
      ['recuperada', 'Falta solvencia técnica'],
      ['descartada', 'Plazo imposible'],
    ],
  );
  assert.equal(motivoActual(db, id), 'Plazo imposible');
});

test('should_clear_the_current_reason_when_recovering', () => {
  const { db, id } = conNueva();
  cambiarOportunidad(db, id, cambio({ estado: 'descartada', motivo_descarte: 'No encaja' }));
  cambiarOportunidad(db, id, cambio({ estado: 'nueva' }));
  assert.equal(motivoActual(db, id), null);
});

test('should_store_the_discard_category', () => {
  const { db, id } = conNueva();
  cambiarOportunidad(
    db,
    id,
    cambio({ estado: 'descartada', motivo_descarte: 'Sin ISO 27001', categoria_descarte: 'certificacion' }),
    'Persona A',
  );
  const [e] = historialDescartes(db, id);
  assert.equal(e?.categoria, 'certificacion');
  assert.equal(e?.quien, 'Persona A');
  const d = detalle(db, id);
  assert.equal(d.data?.categoria_descarte, 'certificacion');
});

test('should_accept_a_discard_without_category_and_reject_an_unknown_one', () => {
  assert.equal(Cambio.safeParse({ estado: 'descartada', motivo_descarte: 'No encaja' }).success, true);
  assert.equal(
    Cambio.safeParse({ estado: 'descartada', motivo_descarte: 'No encaja', categoria_descarte: 'rareza' }).success,
    false,
  );
});

test('should_not_log_twice_when_discarding_an_already_discarded_one', () => {
  const { db, id } = conNueva();
  cambiarOportunidad(db, id, cambio({ estado: 'descartada', motivo_descarte: 'No encaja' }));
  cambiarOportunidad(db, id, cambio({ estado: 'descartada', motivo_descarte: 'No encaja' }));
  assert.equal(historialDescartes(db, id).length, 1);
});

test('should_not_promise_that_the_reason_tunes_the_screening', () => {
  const r = Cambio.safeParse({ estado: 'descartada' });
  assert.equal(r.success, false);
  const msg = r.success ? '' : r.error.issues.map((i) => i.message).join(' ');
  assert.match(msg, /Al descartar, elige el motivo y dilo en pocas palabras\./);
  assert.doesNotMatch(msg, /criba/);
});

test('should_log_the_automatic_discard_and_its_automatic_recovery', () => {
  // Arrange: sin pliegos que bajar, Hermes la descarta; luego la plataforma publica el PCAP.
  const { db, id } = conNueva();
  assert.equal(descartarSola(db, id, MOTIVO_SIN_PLIEGOS, 'pliegos'), true);
  const pcap = {
    clase: 'pcap',
    nombre: 'PCAP.pdf',
    url: 'https://contrataciondelestado.es/wps/wcm/connect/PCAP.pdf',
    hash: null,
  };
  const l = licitacion({ titulo: 'CASO_F', publicada: '2026-09-24', limite: '2099-12-15T08:00:00' });
  guardarLicitacion(db, { ...l, id, documentos: [pcap] } as Parameters<typeof guardarLicitacion>[1]);

  // Act
  const recuperadas = recuperarConPliegos(db);

  // Assert
  assert.equal(recuperadas, 1);
  assert.deepEqual(
    historialDescartes(db, id).map((e) => [e.accion, e.automatico, e.quien, e.motivo]),
    [
      ['descartada', true, 'hermes', MOTIVO_SIN_PLIEGOS],
      ['recuperada', true, 'hermes', MOTIVO_SIN_PLIEGOS],
    ],
  );
});

test('should_not_log_an_automatic_discard_of_one_a_person_already_moved', () => {
  // Arrange
  const { db, id } = conNueva();
  db.prepare('UPDATE oportunidades SET cambiada_a_mano = 1 WHERE licitacion_id = ?').run(id);

  // Act
  const descartada = descartarSola(db, id, 'No cumplimos un excluyente.', 'requisitos');

  // Assert
  assert.equal(descartada, false);
  assert.deepEqual(historialDescartes(db, id), []);
});
