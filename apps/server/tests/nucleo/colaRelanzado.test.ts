// Cancelar trabajos: los zombis que no salen en 48 h sin nada que los retenga y el «Cancelar» de
// Estado, sobre una tabla trabajos_ia sembrada a mano.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-relanzado-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { ahora } = await import('../../src/nucleo/db.js');
const { obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { estadoCola } = await import('../../src/nucleo/colaConsultas.js');
const { cancelarZombis, cancelarTrabajo } = await import('../../src/nucleo/colaRelanzado.js');
const { insertarTrabajo } = await import('../helpers/cola.js');

const otraCola = (nombre: string) => abrirNucleo(path.join(tmp, nombre));

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_cancel_pending_jobs_never_launched_after_48_hours', () => {
  // Arrange
  const d = otraCola('zombis');
  const ahoraMs = Date.parse('2026-10-15T10:00:00Z');
  const zombi = insertarTrabajo(d, 'zombi', { estado: 'pendiente', creado: '2026-10-12T09:00:00Z' });
  const reciente = insertarTrabajo(d, 'reciente', { estado: 'pendiente', creado: '2026-10-14T09:00:00Z' });
  const relanzado = insertarTrabajo(d, 'relanzado', {
    estado: 'pendiente',
    creado: '2026-10-01T09:00:00Z',
    actualizado: '2026-10-15T09:00:00Z',
  });
  const reintento = insertarTrabajo(d, 'reintento', {
    estado: 'pendiente',
    creado: '2026-10-01T09:00:00Z',
    lanzado: '2026-10-01T09:05:00Z',
  });

  // Act
  const antes = estadoCola(d, ahoraMs) as { sin_salir: { id: number }[] };
  const n = cancelarZombis(d, ahoraMs);

  // Assert: Estado enseña con «Cancelar» lo que lleva más de 6 h sin salir; solo se cancela solo
  // el que en 48 h ni salió ni tocó nadie.
  assert.deepEqual(
    antes.sin_salir.map((s) => s.id),
    [zombi, reciente],
  );
  assert.equal(n, 1);
  assert.equal(obtenerTrabajo(d, zombi)?.estado, 'cancelado');
  assert.equal(obtenerTrabajo(d, zombi)?.codigo, 'zombi');
  for (const id of [reciente, relanzado, reintento]) assert.equal(obtenerTrabajo(d, id)?.estado, 'pendiente');
  d.close();
});

test('should_not_cancel_as_zombie_a_job_held_by_a_known_brake_and_restart_its_clock', () => {
  // Arrange: lo pedido el viernes espera a que se reinicie Hermes (herramientas desfasadas) o una herramienta.
  const d = otraCola('zombis_retenidos');
  const ahoraMs = Date.parse('2026-10-19T10:00:00Z');
  const viernes = '2026-10-16T09:00:00Z';
  const desfase = insertarTrabajo(d, 'desfase', {
    estado: 'pendiente',
    creado: viernes,
    codigo: 'herramientas_desfasadas',
  });
  const herramienta = insertarTrabajo(d, 'herramienta', {
    estado: 'pendiente',
    creado: viernes,
    codigo: 'sin_herramienta',
  });
  const frenado = insertarTrabajo(d, 'frenado', { estado: 'pendiente', creado: viernes });

  // Act: la vuelta sabe que «frenado» lo retiene un freno del tipo.
  const n = cancelarZombis(d, ahoraMs, (t) => t.codigo !== null || t.clave === 'frenado');

  // Assert
  assert.equal(n, 0);
  for (const id of [desfase, herramienta, frenado]) {
    const t = obtenerTrabajo(d, id)!;
    assert.equal(t.estado, 'pendiente');
    assert.equal(t.actualizado_en, new Date(ahoraMs).toISOString(), 'las 48 h cuentan desde que se levanta el freno');
  }
  assert.equal(cancelarZombis(d, ahoraMs + 3_600_000), 0, 'sin el freno, aún no han pasado 48 h desde que se levantó');
  d.close();
});

test('should_keep_waiting_codes_out_of_zombie_cancel_by_default_and_announce_each_cancelled_one', () => {
  // Arrange
  const d = otraCola('zombis_aviso');
  const ahoraMs = Date.parse('2026-10-15T10:00:00Z');
  const espera = insertarTrabajo(d, 'espera', {
    estado: 'pendiente',
    creado: '2026-10-12T09:00:00Z',
    codigo: 'sin_herramienta',
  });
  const zombi = insertarTrabajo(d, 'zombi', {
    estado: 'pendiente',
    payload: '{"id":"LIC-Z"}',
    creado: '2026-10-12T09:00:00Z',
  });

  // Act
  const n = cancelarZombis(d, ahoraMs);

  // Assert
  assert.equal(n, 1);
  assert.equal(obtenerTrabajo(d, espera)?.estado, 'pendiente');
  const eventos = d.prepare('SELECT recurso, datos FROM eventos ORDER BY id').all() as {
    recurso: string | null;
    datos: string;
  }[];
  const aviso = eventos
    .map((e) => ({
      recurso: e.recurso,
      ...(JSON.parse(e.datos) as { trabajo: number; estado: string; codigo: string }),
    }))
    .find((e) => e.trabajo === zombi);
  assert.deepEqual(aviso && { recurso: aviso.recurso, estado: aviso.estado, codigo: aviso.codigo }, {
    recurso: 'LIC-Z',
    estado: 'cancelado',
    codigo: 'zombi',
  });
  d.close();
});

test('should_cancel_one_job_on_request', () => {
  // Arrange
  const d = otraCola('cancelar_uno');
  const pendiente = insertarTrabajo(d, 'p', { estado: 'pendiente', creado: ahora() });
  const otro = insertarTrabajo(d, 'o', { estado: 'pendiente', creado: ahora() });
  const hecho = insertarTrabajo(d, 'h', { estado: 'completado', creado: ahora() });

  // Act
  const r = cancelarTrabajo(d, pendiente);

  // Assert
  assert.deepEqual(r, { data: { id: pendiente, estado: 'cancelado' }, error: null });
  assert.equal(obtenerTrabajo(d, pendiente)?.estado, 'cancelado');
  assert.equal(obtenerTrabajo(d, otro)?.estado, 'pendiente');
  assert.equal(cancelarTrabajo(d, hecho).error?.code, 'conflict');
  assert.equal(cancelarTrabajo(d, 999_999).error?.code, 'not_found');
  d.close();
});
