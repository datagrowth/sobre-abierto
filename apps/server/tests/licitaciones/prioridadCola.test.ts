// Prioridad de la cola de IA de licitaciones: lo que se prepara, por plazo; luego la ficha de
// lo nuevo; al final la criba y el resto del trabajo de fondo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prioridad-cola-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
// Hermes simulado (la frontera HTTP): cada run lanzado queda anotado con su input.
const inputs: string[] = [];
const hermes = escucharLocal(
  http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => {
      cuerpo += c;
    });
    req.on('end', () => {
      const cabecera = { 'content-type': 'application/json' };
      if (req.method === 'POST') {
        inputs.push((JSON.parse(cuerpo) as { input: string }).input);
        res.writeHead(200, cabecera).end(JSON.stringify({ run_id: `run_${inputs.length}`, status: 'started' }));
        return;
      }
      res.writeHead(200, cabecera).end(JSON.stringify({ status: 'started' }));
    });
  }),
);
await new Promise((r) => hermes.once('listening', r));
process.env.HERMES_LICITACIONES_URL = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`;
process.env.HERMES_LICITACIONES_KEY = 'clave-de-hermes-de-prueba';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { prioridadTrabajo } = await import('../../src/dominios/licitaciones/prioridadCola.js');
const { registrarTrabajos } = await import('../../src/dominios/licitaciones/index.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { tiposSinPrioridad } = await import('../../src/nucleo/colaOrden.js');
type Trabajo = import('../../src/nucleo/colaTipos.js').Trabajo;

const { db: dbNucleo } = iniciarNucleo();
const db = dbLicitaciones();
// 14/10/2026 a las 11:00 en Madrid.
const AHORA = Date.parse('2026-10-14T09:00:00Z');

after(() => {
  hermes.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function oportunidad(id: string, estado: string, limite: string | null): void {
  guardarLicitacion(db, { ...licitacion({ titulo: id, publicada: '2026-09-20', limite }), id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, ?, 'CPV 80', ?, ?)",
  ).run(id, estado, ts, ts);
}

// Rango con que la cola ordena un guion automático de esa licitación (la función que usa la cola).
const rango = (id: unknown) =>
  prioridadTrabajo(db, trabajo('licitaciones.guion', 'x', { payload: JSON.stringify({ id }) }), AHORA);

test('should_put_an_offer_in_preparation_before_a_new_tender_and_the_new_one_before_background_work', () => {
  oportunidad('p-oferta', 'en_preparacion', '2026-10-15T08:00:00');
  oportunidad('p-nueva', 'nueva', '2026-10-17T08:00:00');
  const fondo = 2_000_000;
  assert.ok(rango('p-oferta') < rango('p-nueva') && rango('p-nueva') < fondo);
});

test('should_order_by_the_nearest_deadline_within_the_same_level', () => {
  oportunidad('p-cerca', 'en_preparacion', '2026-10-15T08:00:00');
  oportunidad('p-lejos', 'presentada', '2026-10-30T08:00:00');
  oportunidad('p-sin-plazo', 'en_preparacion', null);
  assert.ok(rango('p-cerca') < rango('p-lejos') && rango('p-lejos') < rango('p-sin-plazo'));
});

test('should_count_a_past_deadline_as_zero_hours_left', () => {
  oportunidad('p-vencida', 'en_preparacion', '2026-10-01T08:00:00');
  assert.equal(rango('p-vencida'), 0, 'ni negativo ni detrás de lo de ahora mismo');
});

test('should_treat_an_unknown_tender_as_new_without_failing', () => {
  const r = rango('p-no-existe');
  assert.ok(r >= 1_000_000 && r < 2_000_000);
  assert.equal(rango(undefined), r);
});

// Cableado real: sin él la cola vuelve a FIFO y no falla ningún otro test.
test('should_launch_the_offer_in_preparation_before_eight_new_tenders_and_a_screening_queued_earlier', async () => {
  registrarTrabajos();
  const manana = new Date(Date.now() + 20 * 3_600_000).toISOString().slice(0, 10);
  const pedida_en = '2026-10-14T10:00:00Z';
  for (let i = 0; i < 8; i++) {
    oportunidad(`c-nueva-${i}`, 'nueva', '2026-12-01T10:00:00');
    encolar(dbNucleo, {
      tipo: 'licitaciones.ficha',
      dominio: 'licitaciones',
      clave: `c-ficha-${i}`,
      payload: { id: `c-nueva-${i}`, pedida_en },
    });
  }
  encolar(dbNucleo, {
    tipo: 'licitaciones.cribar',
    dominio: 'licitaciones',
    clave: 'c-criba',
    payload: { lote: 'L1' },
  });
  oportunidad('c-oferta', 'en_preparacion', `${manana}T08:00:00`);
  encolar(dbNucleo, {
    tipo: 'licitaciones.guion',
    dominio: 'licitaciones',
    clave: 'c-guion',
    payload: { id: 'c-oferta', pedida_en },
  });
  await vueltaCola(dbNucleo, 1);
  const lanzados = dbNucleo.prepare("SELECT clave FROM trabajos_ia WHERE estado = 'lanzado'").all() as {
    clave: string;
  }[];
  assert.deepEqual(
    lanzados.map((l) => l.clave),
    ['c-guion'],
  );
  assert.equal(inputs.length, 1);
});

test('should_give_every_tender_job_type_a_priority_so_none_falls_behind_new_tenders', () => {
  registrarTrabajos();
  assert.deepEqual(
    tiposSinPrioridad('licitaciones.'),
    [],
    'un tipo sin gancho queda en neutro, detrás de cualquier ficha nueva',
  );
});

test('should_launch_the_strategy_of_an_offer_in_preparation_before_new_tenders_queued_earlier', async () => {
  registrarTrabajos();
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE estado IN ('pendiente', 'lanzado')").run();
  const manana = new Date(Date.now() + 20 * 3_600_000).toISOString().slice(0, 10);
  const pedida_en = '2026-10-14T10:00:00Z';
  for (let i = 0; i < 3; i++) {
    oportunidad(`est-nueva-${i}`, 'nueva', '2026-12-01T10:00:00');
    encolar(dbNucleo, {
      tipo: 'licitaciones.ficha',
      dominio: 'licitaciones',
      clave: `est-ficha-${i}`,
      payload: { id: `est-nueva-${i}`, pedida_en },
    });
  }
  oportunidad('est-oferta', 'en_preparacion', `${manana}T08:00:00`);
  encolar(dbNucleo, {
    tipo: 'licitaciones.memoria_estrategia',
    dominio: 'licitaciones',
    clave: 'est-estrategia',
    payload: { id: 'est-oferta', memoria_id: 1, version: 1, pedida_en },
  });
  await vueltaCola(dbNucleo, 1);
  const lanzados = dbNucleo
    .prepare("SELECT clave FROM trabajos_ia WHERE estado = 'lanzado' AND clave LIKE 'est-%'")
    .all() as { clave: string }[];
  assert.deepEqual(
    lanzados.map((l) => l.clave),
    ['est-estrategia'],
  );
});

test('should_launch_the_jobs_of_an_ensayo_memoria_after_live_offers_and_new_tenders', async () => {
  registrarTrabajos();
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE estado IN ('pendiente', 'lanzado')").run();
  const manana = new Date(Date.now() + 20 * 3_600_000).toISOString().slice(0, 10);
  const pedida_en = '2026-10-14T10:00:00Z';
  // Presentada y con el plazo vencido: sin la marca de ensayo, la más urgente de la cola.
  oportunidad('e-presentada', 'presentada', '2026-10-08T13:00:00');
  const ensayo = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ensayo) VALUES ('e-presentada', 1, 1, 'redactando', ?, 'estrategia', 1)",
      )
      .run(pedida_en).lastInsertRowid,
  );
  encolar(dbNucleo, {
    tipo: 'licitaciones.memoria_estrategia',
    dominio: 'licitaciones',
    clave: 'e-ensayo',
    payload: { id: 'e-presentada', memoria_id: ensayo, version: 1, pedida_en },
  });
  oportunidad('e-nueva', 'nueva', '2026-12-01T10:00:00');
  encolar(dbNucleo, {
    tipo: 'licitaciones.ficha',
    dominio: 'licitaciones',
    clave: 'e-ficha',
    payload: { id: 'e-nueva', pedida_en },
  });
  oportunidad('e-viva', 'en_preparacion', `${manana}T08:00:00`);
  encolar(dbNucleo, {
    tipo: 'licitaciones.memoria_estrategia',
    dominio: 'licitaciones',
    clave: 'e-viva',
    payload: { id: 'e-viva', memoria_id: ensayo + 1000, version: 1, pedida_en },
  });
  await vueltaCola(dbNucleo, 2);
  const lanzados = dbNucleo
    .prepare("SELECT clave FROM trabajos_ia WHERE estado = 'lanzado' AND clave LIKE 'e-%' ORDER BY id")
    .all() as { clave: string }[];
  assert.deepEqual(
    lanzados.map((l) => l.clave),
    ['e-ficha', 'e-viva'],
    'el ensayo espera',
  );
});

const HORA = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
// El plazo de la PLACSP es hora peninsular sin zona; en octubre, Madrid va a UTC+2.
const plazoEn = (horas: number) => new Date(AHORA + horas * HORA + 2 * HORA).toISOString().slice(0, 19);

function trabajo(tipo: string, id: string, extra: Partial<Trabajo> = {}): Trabajo {
  return {
    id: 1,
    tipo,
    dominio: 'licitaciones',
    clave: `${tipo}-${id}`,
    payload: JSON.stringify({ id }),
    estado: 'pendiente',
    run_id: null,
    intentos: 0,
    error: null,
    proximo_intento_en: null,
    creado_en: iso(AHORA),
    actualizado_en: iso(AHORA),
    lanzado_en: null,
    metricas: null,
    codigo: null,
    run_vivo_desde: null,
    a_mano: 0,
    relanzamientos: 0,
    ...extra,
  };
}

test('should_launch_a_ficha_every_third_launch_even_with_urgent_offer_work', async () => {
  registrarTrabajos();
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE estado IN ('pendiente', 'lanzado')").run();
  for (const n of [1, 2]) {
    const id = encolar(dbNucleo, {
      tipo: 'licitaciones.guion',
      dominio: 'licitaciones',
      clave: `q-guion-previo-${n}`,
      payload: { id: 'q-oferta' },
    });
    dbNucleo
      .prepare("UPDATE trabajos_ia SET estado = 'completado', lanzado_en = ? WHERE id = ?")
      .run(iso(Date.now() + n), id);
  }
  oportunidad('q-oferta', 'en_preparacion', plazoEn(20));
  oportunidad('q-nueva', 'nueva', '2026-12-01T10:00:00');
  encolar(dbNucleo, {
    tipo: 'licitaciones.guion',
    dominio: 'licitaciones',
    clave: 'q-urgente',
    payload: { id: 'q-oferta', pedida_en: '2026-10-14T10:00:00Z' },
  });
  encolar(dbNucleo, {
    tipo: 'licitaciones.ficha',
    dominio: 'licitaciones',
    clave: 'q-ficha',
    payload: { id: 'q-nueva', pedida_en: '2026-10-14T10:00:00Z' },
  });

  await vueltaCola(dbNucleo, 1);

  const lanzados = dbNucleo.prepare("SELECT clave FROM trabajos_ia WHERE estado = 'lanzado'").all() as {
    clave: string;
  }[];
  assert.deepEqual(
    lanzados.map((l) => l.clave),
    ['q-ficha'],
  );
});

test('should_rank_a_job_a_person_asked_for_before_an_automatic_one_of_the_same_tender', () => {
  oportunidad('m-oferta', 'en_preparacion', plazoEn(72));

  const aMano = prioridadTrabajo(db, trabajo('licitaciones.guion', 'm-oferta', { a_mano: 1 }), AHORA);
  const automatico = prioridadTrabajo(db, trabajo('licitaciones.guion', 'm-oferta'), AHORA);

  assert.ok(aMano < automatico);
  assert.ok(aMano >= 0 && automatico < 1_000_000, 'los dos siguen en el nivel de la oferta');
});

test('should_move_up_a_job_that_waited_long_without_leaving_its_level', () => {
  oportunidad('w-nueva', 'nueva', plazoEn(10));
  oportunidad('w-lejana', 'nueva', plazoEn(200));

  const reciente = prioridadTrabajo(db, trabajo('licitaciones.ficha', 'w-lejana'), AHORA);
  const antigua = prioridadTrabajo(
    db,
    trabajo('licitaciones.ficha', 'w-lejana', { creado_en: iso(AHORA - 100 * HORA) }),
    AHORA,
  );
  const antiguaCercana = prioridadTrabajo(
    db,
    trabajo('licitaciones.ficha', 'w-nueva', { creado_en: iso(AHORA - 100 * HORA), a_mano: 1 }),
    AHORA,
  );

  assert.equal(reciente - antigua, 24, 'el envejecimiento tiene tope de 48 h a 0,5');
  assert.equal(antiguaCercana, 1_000_000, 'no baja del suelo de lo nuevo');
});

test('should_put_the_mass_ficha_regeneration_after_all_background_work', () => {
  registrarTrabajos();
  oportunidad('r-nueva', 'nueva', plazoEn(5));

  const regeneracion = prioridadTrabajo(
    db,
    trabajo('licitaciones.ficha', 'r-nueva', { clave: 'ficha-r-nueva-regen-v3' }),
    AHORA,
  );

  assert.ok(regeneracion > 2_000_000, 'detrás del fondo (criba, lecciones…)');
  assert.ok(regeneracion < 3_000_000);
});

test('should_rank_first_the_job_whose_deadline_minus_its_expected_duration_comes_sooner', () => {
  oportunidad('d-memoria', 'en_preparacion', plazoEn(4));
  oportunidad('d-guion', 'en_preparacion', plazoEn(3.5));

  const memoria = prioridadTrabajo(db, trabajo('licitaciones.memoria_redaccion', 'd-memoria'), AHORA);
  const guion = prioridadTrabajo(db, trabajo('licitaciones.guion', 'd-guion'), AHORA);

  assert.ok(memoria < guion);
});

test('should_launch_a_job_with_a_deadline_under_24_hours_before_eight_fichas', async () => {
  registrarTrabajos();
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE estado IN ('pendiente', 'lanzado')").run();
  for (let i = 0; i < 8; i++) {
    oportunidad(`a-nueva-${i}`, 'nueva', '2026-12-01T10:00:00');
    encolar(dbNucleo, {
      tipo: 'licitaciones.ficha',
      dominio: 'licitaciones',
      clave: `a-ficha-${i}`,
      payload: { id: `a-nueva-${i}`, pedida_en: '2026-10-14T10:00:00Z' },
    });
  }
  const manana = new Date(Date.now() + 20 * HORA).toISOString().slice(0, 10);
  oportunidad('a-oferta', 'en_preparacion', `${manana}T08:00:00`);
  encolar(dbNucleo, {
    tipo: 'licitaciones.guion',
    dominio: 'licitaciones',
    clave: 'a-guion',
    payload: { id: 'a-oferta', pedida_en: '2026-10-14T10:00:00Z' },
  });

  await vueltaCola(dbNucleo, 1);

  const lanzados = dbNucleo.prepare("SELECT clave FROM trabajos_ia WHERE estado = 'lanzado'").all() as {
    clave: string;
  }[];
  assert.deepEqual(
    lanzados.map((l) => l.clave),
    ['a-guion'],
    'el último lanzamiento fue una ficha: el cupo no toca',
  );
});

test('should_not_give_the_ficha_quota_to_the_mass_regeneration', async () => {
  // Arrange: dos lanzamientos previos que no fueron fichas y solo fichas de regeneración pendientes.
  registrarTrabajos();
  dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE estado IN ('pendiente', 'lanzado')").run();
  for (const n of [1, 2]) {
    const id = encolar(dbNucleo, {
      tipo: 'licitaciones.guion',
      dominio: 'licitaciones',
      clave: `g-guion-previo-${n}`,
      payload: { id: 'g-oferta' },
    });
    dbNucleo
      .prepare("UPDATE trabajos_ia SET estado = 'completado', lanzado_en = ? WHERE id = ?")
      .run(iso(Date.now() + 10 + n), id);
  }
  oportunidad('g-oferta', 'en_preparacion', plazoEn(20));
  oportunidad('g-vieja', 'nueva', '2026-12-01T10:00:00');
  encolar(dbNucleo, {
    tipo: 'licitaciones.ficha',
    dominio: 'licitaciones',
    clave: 'ficha-g-vieja-regen-v3',
    payload: { id: 'g-vieja', pedida_en: '2026-10-14T10:00:00Z' },
  });
  encolar(dbNucleo, {
    tipo: 'licitaciones.guion',
    dominio: 'licitaciones',
    clave: 'g-urgente',
    payload: { id: 'g-oferta', pedida_en: '2026-10-14T10:00:00Z' },
  });

  // Act
  await vueltaCola(dbNucleo, 1);

  // Assert
  const lanzados = dbNucleo.prepare("SELECT clave FROM trabajos_ia WHERE estado = 'lanzado'").all() as {
    clave: string;
  }[];
  assert.deepEqual(
    lanzados.map((l) => l.clave),
    ['g-urgente'],
    'la regeneración no usa el cupo de la ficha de lo nuevo',
  );
});
