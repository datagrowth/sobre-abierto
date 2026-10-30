// La memoria técnica por fases: empieza en la del dossier sin encolar nada, no se ensambla al llegar
// el último apartado y su máquina de estados (siguientePaso) decide cada paso de forma pura.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  arrancar,
  cerrar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  trabajosDe,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { apartadoCasoA } from './fixtures/casoA.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';

const { leerConfig, validarConfig } = await import('../../src/nucleo/config.js');
const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria, ensamblarYa, siguientePaso, trabajoDeFase, claveDeFase } =
  await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia, TIPO_MEMORIA_ESTRATEGIA } =
  await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { TIPO_MEMORIA_CRITICA } = await import('../../src/dominios/licitaciones/oferta/critica.js');
const { reservarEnsamblado } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { frenadoHasta } = await import('../../src/nucleo/colaFrenos.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
type EstadoAvance = import('../../src/dominios/licitaciones/oferta/avanceMemoria.js').EstadoAvance;
type AccionAvance = import('../../src/dominios/licitaciones/oferta/avanceMemoria.js').AccionAvance;

before(arrancar);
after(cerrar);

test('should_read_threshold_and_rounds_from_config', () => {
  const ajustada = leerConfig({
    LICITACIONES_MEMORIA_UMBRAL: '0.85',
    LICITACIONES_MEMORIA_RONDAS: '2',
  }).licitaciones;
  assert.deepEqual([ajustada.memoriaUmbral, ajustada.memoriaRondas], [0.85, 2]);
  assert.deepEqual([leerConfig({}).licitaciones.memoriaUmbral, leerConfig({}).licitaciones.memoriaRondas], [0.9, 3]);
  assert.equal(validarConfig({ LICITACIONES_MEMORIA_UMBRAL: '0.3' }).error?.message, 'LICITACIONES_MEMORIA_UMBRAL');
  assert.equal(validarConfig({ LICITACIONES_MEMORIA_RONDAS: '4' }).error?.message, 'LICITACIONES_MEMORIA_RONDAS');
});

test('should_configure_the_critic_profile_and_warn_when_url_has_no_key', () => {
  const con = leerConfig({
    HERMES_OFERTA_CRITICO_URL: 'http://hermes:8642/p/critico-licitaciones',
    HERMES_OFERTA_CRITICO_KEY: 'k'.repeat(20),
  });
  assert.deepEqual(
    [con.hermesCritico?.url, con.hermesCriticoAviso],
    ['http://hermes:8642/p/critico-licitaciones', null],
  );
  const sinKey = leerConfig({ HERMES_OFERTA_CRITICO_URL: 'http://hermes:8642/p/critico-licitaciones' });
  assert.equal(sinKey.hermesCritico, null);
  assert.equal(
    sinKey.hermesCriticoAviso,
    'HERMES_OFERTA_CRITICO_URL sin KEY: la crítica de la memoria la hace el perfil de oferta',
  );
  assert.equal(
    leerConfig({ HERMES_OFERTA_LICITACIONES_KEY: 'k'.repeat(20) }).hermesOfertaAviso,
    'HERMES_OFERTA_LICITACIONES_KEY sin URL: la preparación de ofertas usa el perfil de licitaciones',
  );
});

test('should_create_memoria_in_dossier_phase_without_jobs', () => {
  sinMemorias();
  const r = pedirMemoria(nucleo().db, db, salidas, ID);
  assert.equal(r.error, null);
  const m = memoriaPorId(r.data!.memoria);
  assert.deepEqual([m.fase, m.ronda, m.estado], ['dossier', 0, 'redactando']);
  const apartados = db
    .prepare('SELECT estado, trabajo_id FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(m.id);
  assert.deepEqual(apartados, Array(4).fill({ estado: 'pendiente', trabajo_id: null }));
  assert.equal(
    (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n,
    0,
    'no encola nada al pedirla',
  );
  assert.equal(pedirMemoria(nucleo().db, db, salidas, ID).data?.memoria, m.id, 'con una redactándose, devuelve esa');
});

test('should_reject_unknown_fields_in_the_request', async () => {
  sinMemorias();
  const mal = await api(`/licitaciones/${ID}/oferta/memoria`, { otra: 1 });
  assert.equal(mal.status, 400, 'esquema estricto');
  const bien = await api(`/licitaciones/${ID}/oferta/memoria`, {});
  assert.equal(bien.status, 202);
  assert.equal(memoriaPorId(((await bien.json()) as { memoria: number }).memoria).fase, 'dossier');
});

test('should_not_assemble_memoria_when_last_apartado_arrives', () => {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  const m = memoriaPorId(p.memoria);
  const numeros = { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
  const enDossier = recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(1, numeros)), 'oferta-licitaciones');
  assert.match(enDossier.error?.message ?? '', /está en la fase «dossier», no en la de redacción/);
  db.prepare("UPDATE memorias SET fase = 'redaccion' WHERE id = ?").run(m.id);
  for (const n of [1, 2, 3, 4]) {
    const r = recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(n, numeros)), 'oferta-licitaciones');
    assert.equal(r.error, null, r.error?.message);
  }
  assert.equal(memoriaPorId(m.id).estado, 'redactando', 'no se ensambla al llegar el último apartado');
});

const BASE: EstadoAvance = {
  fase: 'dossier',
  dossier: false,
  estrategia: false,
  critica: false,
  pendientes: 4,
  recibidos: 0,
  trabajo: { estado: 'ninguno', reintento: null, agotado: false },
  plazo: true,
  ficha: 'ninguna',
  ensayo: false,
  parche: 'ninguno',
};
const T = {
  ninguno: { estado: 'ninguno', reintento: null, agotado: false },
  curso: { estado: 'en_curso', reintento: null, agotado: false },
  reintento: { estado: 'fallido', reintento: 1, agotado: false },
  esperando: { estado: 'fallido', reintento: null, agotado: false },
  agotado: { estado: 'fallido', reintento: null, agotado: true },
} as const;

test('should_decide_the_next_step_of_each_phase', () => {
  const casos: [string, Partial<EstadoAvance>, AccionAvance][] = [
    ['dossier sin componer', {}, { tipo: 'componer_dossier' }],
    ['dossier listo', { dossier: true }, { tipo: 'pasar', fase: 'estrategia' }],
    ['estrategia sin pedir', { fase: 'estrategia', dossier: true }, { tipo: 'encolar', reintento: 0 }],
    ['estrategia en curso', { fase: 'estrategia', trabajo: T.curso }, { tipo: 'esperar' }],
    [
      'estrategia que falló: otra ronda',
      { fase: 'estrategia', trabajo: T.reintento },
      { tipo: 'encolar', reintento: 1 },
    ],
    ['estrategia que falló hace poco', { fase: 'estrategia', trabajo: T.esperando }, { tipo: 'esperar' }],
    [
      'estrategia agotada',
      { fase: 'estrategia', trabajo: T.agotado },
      { tipo: 'fallar', motivo: 'La estrategia de la memoria falló en todas sus rondas.' },
    ],
    [
      'estrategia recibida: a la ficha de solución',
      { fase: 'estrategia', estrategia: true, trabajo: T.curso },
      { tipo: 'pasar', fase: 'ficha' },
    ],
    [
      'ficha pendiente: la redacción espera',
      { fase: 'ficha', estrategia: true, ficha: 'pendiente' },
      { tipo: 'esperar' },
    ],
    ['ficha aprobada', { fase: 'ficha', estrategia: true, ficha: 'aprobada' }, { tipo: 'pasar', fase: 'redaccion' }],
    [
      'ficha vencida a las 24 h',
      { fase: 'ficha', estrategia: true, ficha: 'vencida' },
      { tipo: 'vencer_ficha', sinPlazo: false },
    ],
    [
      'ficha pendiente sin tiempo antes del plazo',
      { fase: 'ficha', estrategia: true, ficha: 'pendiente', plazo: false },
      { tipo: 'vencer_ficha', sinPlazo: true },
    ],
    [
      'ensayo: no espera a la ficha',
      { fase: 'ficha', estrategia: true, ficha: 'pendiente', ensayo: true },
      { tipo: 'pasar', fase: 'redaccion' },
    ],
    ['sin ficha (estrategia sin solución)', { fase: 'ficha', estrategia: true }, { tipo: 'pasar', fase: 'redaccion' }],
    ['redacción sin pedir', { fase: 'redaccion' }, { tipo: 'encolar', reintento: 0 }],
    ['redacción a medias', { fase: 'redaccion', pendientes: 2, recibidos: 2, trabajo: T.curso }, { tipo: 'esperar' }],
    [
      'redacción completa',
      { fase: 'redaccion', pendientes: 0, recibidos: 4, trabajo: T.curso },
      { tipo: 'cerrar_redaccion' },
    ],
    [
      'redacción que falló: pide lo que falta',
      { fase: 'redaccion', pendientes: 0, recibidos: 2, trabajo: T.reintento },
      { tipo: 'encolar', reintento: 1 },
    ],
    [
      'redacción agotada con algo',
      { fase: 'redaccion', pendientes: 0, recibidos: 2, trabajo: T.agotado },
      { tipo: 'cerrar_redaccion' },
    ],
    [
      'redacción agotada sin nada',
      { fase: 'redaccion', pendientes: 0, recibidos: 0, trabajo: T.agotado },
      { tipo: 'fallar', motivo: 'La redacción falló en todas sus rondas y no llegó ningún apartado.' },
    ],
    ['crítica sin pedir', { fase: 'critica', pendientes: 0, recibidos: 4 }, { tipo: 'encolar', reintento: 0 }],
    ['crítica recibida', { fase: 'critica', critica: true }, { tipo: 'decidir_ronda' }],
    [
      'crítica agotada',
      { fase: 'critica', trabajo: T.agotado },
      { tipo: 'ensamblar', aviso: 'La crítica de la memoria falló en todas sus rondas: se ensambla sin ella.' },
    ],
    ['fin', { fase: 'fin' }, { tipo: 'esperar' }],
  ];
  for (const [caso, cambios, esperada] of casos)
    assert.deepEqual(siguientePaso({ ...BASE, ...cambios }), esperada, caso);
});

test('should_read_the_phase_job_and_its_retry_rounds_from_the_queue', () => {
  sinMemorias();
  const m = { licitacion_id: ID, version: 3, ronda: 1 };
  assert.deepEqual(
    [claveDeFase(m, 'estrategia'), claveDeFase(m, 'redaccion'), claveDeFase(m, 'critica')],
    [`memoria-${ID}-v3-estrategia`, `memoria-${ID}-v3-r1`, `memoria-${ID}-v3-critica-r1`],
  );
  const base = claveDeFase(m, 'redaccion');
  const ahora = Date.now();
  assert.deepEqual(trabajoDeFase(nucleo().db, base, ahora), T.ninguno);
  const hace = (min: number) => new Date(ahora - min * 60_000).toISOString();
  const insertar = nucleo().db.prepare(
    "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES ('x', 'licitaciones', ?, '{}', ?, ?, ?)",
  );
  insertar.run(base, 'fallido', hace(40), hace(40));
  insertar.run(`memoria-${ID}-v3-r10`, 'pendiente', hace(1), hace(1));
  assert.deepEqual(
    trabajoDeFase(nucleo().db, base, ahora),
    T.reintento,
    'falló hace 40 min: toca la ronda 1 (la ronda 10 de la memoria no cuenta)',
  );
  insertar.run(`${base}-r1`, 'fallido', hace(5), hace(5));
  assert.deepEqual(trabajoDeFase(nucleo().db, base, ahora), T.esperando);
  insertar.run(`${base}-r2`, 'fallido', hace(40), hace(40));
  assert.deepEqual(trabajoDeFase(nucleo().db, base, ahora), T.agotado, 'tres rondas fallidas');
});

test('should_show_the_phase_dossier_strategy_and_critiques_in_the_api', async () => {
  sinMemorias();
  const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
  const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
  const { estrategiaCasoA } = await import('./fixtures/estrategiaCasoA.js');
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(
    recibirEstrategia(
      db,
      nucleo().db,
      EstrategiaEntrada.parse(estrategiaCasoA({ memoria_id: p.memoria, version: p.version })),
      'oferta-licitaciones',
    ).error,
    null,
  );
  await trasLaEstrategia(p.memoria);
  const o = (await (await api(`/licitaciones/${ID}/oferta`, undefined, 'GET')).json()) as {
    memorias: { progreso: Record<string, unknown> }[];
  };
  const progreso = o.memorias[0]!.progreso as {
    fase: string;
    ronda: number;
    max_rondas: number;
    umbral: number;
    trabajo: { estado: string } | null;
    dossier: { ruta_md: string; equipo_por_roles: boolean };
    estrategia: { ruta_md: string; hechos: unknown[] };
    criticas: unknown[];
    coherencia: unknown[];
  };
  assert.deepEqual(
    [progreso.fase, progreso.ronda, progreso.max_rondas, progreso.umbral, progreso.trabajo?.estado],
    ['redaccion', 0, 3, 0.9, 'en_cola'],
  );
  assert.equal(progreso.dossier.ruta_md, `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v${p.version}-dossier.md`);
  assert.equal(
    progreso.estrategia.ruta_md,
    `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v${p.version}-estrategia.md`,
  );
  assert.deepEqual([progreso.estrategia.hechos.length, progreso.criticas, progreso.coherencia], [4, [], []]);
});

test('should_show_the_phase_in_today_list', async () => {
  sinMemorias();
  const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  db.prepare("UPDATE memorias SET fase = 'critica', ronda = 1 WHERE id = ?").run(p.memoria);
  assert.ok(
    faltaDePreparacion(db, ID).includes(
      `Memoria técnica: Hermes redacta la v${p.version} (plan y crítico: crítica, ronda 1)`,
    ),
    faltaDePreparacion(db, ID).join(' | '),
  );
});

// ── Sin tiempo para reintentar: la memoria sigue con lo que hay ──

const AVISO_ESTRATEGIA =
  'No daba tiempo a reintentar la estrategia antes del plazo: la memoria se redactó sin ella, siguiendo la rúbrica.';
const AVISO_CRITICA = 'No daba tiempo a reintentar la crítica antes del plazo: se ensambló sin ella.';

test('should_skip_failed_strategy_and_critique_and_close_redaccion_when_there_is_no_time_to_retry', () => {
  const sinPlazo = { plazo: false };
  for (const [nombre, trabajo] of Object.entries({
    reintento: T.reintento,
    esperando: T.esperando,
    agotado: T.agotado,
  })) {
    assert.deepEqual(
      siguientePaso({ ...BASE, fase: 'estrategia', trabajo, ...sinPlazo }),
      { tipo: 'pasar', fase: 'redaccion', aviso: AVISO_ESTRATEGIA },
      `estrategia fallida (${nombre}): se salta`,
    );
    assert.deepEqual(
      siguientePaso({ ...BASE, fase: 'critica', pendientes: 0, recibidos: 4, trabajo, ...sinPlazo }),
      { tipo: 'ensamblar', aviso: AVISO_CRITICA },
      `crítica fallida (${nombre}): se ensambla sin ella`,
    );
    assert.deepEqual(
      siguientePaso({ ...BASE, fase: 'redaccion', pendientes: 0, recibidos: 2, trabajo, ...sinPlazo }),
      { tipo: 'cerrar_redaccion' },
      `redacción fallida con algo (${nombre}): se cierra sin esperar el reintento`,
    );
    assert.equal(
      siguientePaso({ ...BASE, fase: 'redaccion', pendientes: 0, recibidos: 0, trabajo, ...sinPlazo }).tipo,
      'fallar',
      `redacción fallida sin nada (${nombre}): falla`,
    );
  }
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'estrategia', trabajo: T.curso, ...sinPlazo }),
    { tipo: 'esperar' },
    'lo que está en curso se espera',
  );
  assert.deepEqual(siguientePaso({ ...BASE, fase: 'critica', trabajo: T.curso, ...sinPlazo }), { tipo: 'esperar' });
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'estrategia', estrategia: true, trabajo: T.reintento, ...sinPlazo }),
    { tipo: 'pasar', fase: 'ficha' },
    'una estrategia recibida pasa sin aviso (a la ficha, que sin tiempo no espera)',
  );
  assert.deepEqual(siguientePaso({ ...BASE, fase: 'critica', critica: true, trabajo: T.reintento, ...sinPlazo }), {
    tipo: 'decidir_ronda',
  });
});

test('should_keep_retrying_failed_phases_when_there_is_time', () => {
  const conPlazo = { plazo: true };
  assert.deepEqual(siguientePaso({ ...BASE, fase: 'estrategia', trabajo: T.reintento, ...conPlazo }), {
    tipo: 'encolar',
    reintento: 1,
  });
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'estrategia', trabajo: T.esperando, ...conPlazo }),
    { tipo: 'esperar' },
    'falló hace poco: espera',
  );
  assert.equal(siguientePaso({ ...BASE, fase: 'estrategia', trabajo: T.agotado, ...conPlazo }).tipo, 'fallar');
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'critica', pendientes: 0, recibidos: 4, trabajo: T.reintento, ...conPlazo }),
    { tipo: 'encolar', reintento: 1 },
  );
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'critica', pendientes: 0, recibidos: 4, trabajo: T.agotado, ...conPlazo }),
    { tipo: 'ensamblar', aviso: 'La crítica de la memoria falló en todas sus rondas: se ensambla sin ella.' },
  );
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'redaccion', pendientes: 0, recibidos: 2, trabajo: T.reintento, ...conPlazo }),
    { tipo: 'encolar', reintento: 1 },
  );
  assert.deepEqual(
    siguientePaso({ ...BASE, fase: 'redaccion', pendientes: 0, recibidos: 2, trabajo: T.esperando, ...conPlazo }),
    { tipo: 'esperar' },
  );
});

// Una memoria con la estrategia guardada, en la fase de redacción y sin ningún apartado.
async function enRedaccion(): Promise<{ memoria_id: number; guion_id: number; version: number }> {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(
    recibirEstrategia(
      db,
      nucleo().db,
      EstrategiaEntrada.parse(estrategiaCasoA({ memoria_id: p.memoria, version: p.version })),
      'oferta-licitaciones',
    ).error,
    null,
  );
  await trasLaEstrategia(p.memoria);
  const m = memoriaPorId(p.memoria);
  assert.equal(m.fase, 'redaccion');
  return { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
}
// Con los cuatro apartados recibidos pero sin que la máquina de estados haya pasado a la crítica.
async function redactada() {
  const n = await enRedaccion();
  for (const k of [1, 2, 3, 4])
    assert.equal(recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones').error, null);
  return n;
}
const avisosDe = (id: number) =>
  JSON.parse((db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(id) as { avisos: string }).avisos) as string[];
const MIN = 60_000;
const haceMs = (ms: number) => new Date(Date.now() - ms).toISOString();
// El borrador de otro test ocupa la misma ruta (la primera versión del mismo expediente): fuera antes de ensamblar.
const sinBorradores = () => db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');

// El plazo de la licitación, `ms` por delante; devuelve cómo restaurarlo.
function plazoEn(ms: number): () => void {
  const antes = (db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(ID) as { fecha_limite: string })
    .fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(horaLocalEspana(Date.now() + ms), ID);
  return () => {
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(antes, ID);
  };
}

test('should_move_to_redaccion_with_a_warning_when_strategy_failed_and_there_is_no_time', async () => {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(memoriaPorId(p.memoria).fase, 'estrategia');
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'fallido', actualizado_en = ? WHERE tipo = ?")
    .run(haceMs(40 * MIN), TIPO_MEMORIA_ESTRATEGIA);
  const restaurar = plazoEn(60 * MIN);
  try {
    await avanzarMemoria(nucleo().db, db, p.memoria);
  } finally {
    restaurar();
  }
  assert.equal(memoriaPorId(p.memoria).fase, 'redaccion', 'sigue sin estrategia');
  assert.deepEqual(avisosDe(p.memoria), [AVISO_ESTRATEGIA], 'el aviso queda en la memoria');
});

test('should_assemble_without_critique_and_warn_when_it_failed_and_there_is_no_time', async () => {
  const n = await redactada();
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).fase, 'critica');
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'fallido', actualizado_en = ? WHERE tipo = ?")
    .run(haceMs(40 * MIN), TIPO_MEMORIA_CRITICA);
  sinBorradores();
  const restaurar = plazoEn(60 * MIN);
  try {
    await avanzarMemoria(nucleo().db, db, n.memoria_id);
  } finally {
    restaurar();
  }
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.estado, m.error], ['fin', 'ensamblada', null]);
  assert.ok(avisosDe(n.memoria_id).includes(AVISO_CRITICA), avisosDe(n.memoria_id).join(' | '));
});

// ── El primer intento de cada fase levanta el freno de su tipo; los reintentos no ──

function fallos(tipo: string, n: number, cuando: string): void {
  const ins = nucleo().db.prepare(
    "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES (?, 'licitaciones', ?, '{}', 'fallido', ?, ?)",
  );
  for (let i = 0; i < n; i += 1) ins.run(tipo, `otra-${tipo}-${i}`, cuando, cuando);
}

test('should_not_lift_the_brake_when_a_phase_is_retried', async () => {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  // Los fallos van un instante por delante de la reactivación del primer intento; se adelanta el reloj de la vuelta para que toque reintentar.
  const despues = new Date(Date.now() + 50).toISOString();
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'fallido', actualizado_en = ? WHERE tipo = ?")
    .run(despues, TIPO_MEMORIA_ESTRATEGIA);
  fallos(TIPO_MEMORIA_ESTRATEGIA, 2, despues);
  assert.notEqual(frenadoHasta(nucleo().db, TIPO_MEMORIA_ESTRATEGIA), null, 'tres fallos seguidos frenan el tipo');
  await avanzarMemoria(nucleo().db, db, p.memoria, Date.now() + 40 * MIN);
  assert.equal(
    trabajosDe(TIPO_MEMORIA_ESTRATEGIA).some((t) => t.clave === `memoria-${ID}-v${p.version}-estrategia-r1`),
    true,
    'se encoló la ronda 1',
  );
  assert.notEqual(frenadoHasta(nucleo().db, TIPO_MEMORIA_ESTRATEGIA), null, 'un reintento no levanta el freno');
});

test('should_lift_the_brake_and_leave_the_critique_launchable_when_a_new_memoria_reaches_it', async () => {
  const n = await redactada();
  fallos(TIPO_MEMORIA_CRITICA, 3, new Date().toISOString());
  assert.notEqual(
    frenadoHasta(nucleo().db, TIPO_MEMORIA_CRITICA),
    null,
    'tres fallos seguidos frenan el tipo de la crítica',
  );
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).fase, 'critica');
  const t = trabajosDe(TIPO_MEMORIA_CRITICA).find((x) => x.clave === `memoria-${ID}-v${n.version}-critica-r0`)!;
  assert.equal(t.estado, 'pendiente');
  assert.equal(
    frenadoHasta(nucleo().db, TIPO_MEMORIA_CRITICA, Date.now(), ID),
    null,
    'el primer intento lo pidió una persona: el freno se levanta para esta oferta y el trabajo es lanzable',
  );
  assert.notEqual(
    frenadoHasta(nucleo().db, TIPO_MEMORIA_CRITICA),
    null,
    'pedir una oferta no le quita el freno a las demás',
  );
});

// ── Ensamblar ya una memoria que espera a la crítica ──

async function esperarEnsamblada(id: number): Promise<void> {
  for (let i = 0; i < 100 && memoriaPorId(id).estado !== 'ensamblada'; i += 1)
    await new Promise((r) => setTimeout(r, 50));
}
async function enCritica() {
  const n = await redactada();
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).fase, 'critica');
  sinBorradores();
  return n;
}

test('should_refuse_to_assemble_now_what_is_not_waiting_for_the_critique', async () => {
  assert.equal(ensamblarYa(db, 99_999).error?.code, 'not_found');
  sinMemorias();
  const recien = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  assert.equal(ensamblarYa(db, recien.memoria).error?.code, 'conflicto', 'una en el dossier no');
  const n = await enRedaccion();
  assert.equal(ensamblarYa(db, n.memoria_id).error?.code, 'conflicto', 'una en la redacción no');
  db.prepare("UPDATE memorias SET fase = 'critica', estado = 'fallida' WHERE id = ?").run(n.memoria_id);
  assert.equal(ensamblarYa(db, n.memoria_id).error?.code, 'conflicto', 'ni una que ya no esté «redactando»');
  assert.match(
    ensamblarYa(db, n.memoria_id).error?.message ?? '',
    /Solo se puede ensamblar ya una memoria con el texto escrito que espera a la crítica/,
  );
});

test('should_assemble_now_a_memoria_in_critique_phase_with_the_person_warning', async () => {
  const n = await enCritica();
  const r = ensamblarYa(db, n.memoria_id);
  assert.deepEqual(r.data, { memoria: n.memoria_id, version: n.version });
  await esperarEnsamblada(n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.estado, m.error], ['fin', 'ensamblada', null]);
  assert.ok(
    avisosDe(n.memoria_id).includes(
      'Se ensambló sin esperar a que acabaran las rondas de la crítica, a petición de una persona.',
    ),
    avisosDe(n.memoria_id).join(' | '),
  );
});

test('should_route_post_ensamblar_of_a_redactando_memoria_through_ensamblar_ya', async () => {
  const redaccion = await redactada();
  const rechazada = await api(`/licitaciones/${ID}/oferta/memoria/${redaccion.version}/ensamblar`);
  assert.equal(rechazada.status, 409, 'con todo recibido pero aún en la redacción no sale por el ensamblado normal');
  const n = await enCritica();
  const r = await api(`/licitaciones/${ID}/oferta/memoria/${n.version}/ensamblar`);
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { memoria: n.memoria_id, version: n.version });
  await esperarEnsamblada(n.memoria_id);
  assert.ok(
    avisosDe(n.memoria_id).some((a) => /a petición de una persona/.test(a)),
    'sale por el cierre de la memoria (coherencia y avisos), no por el ensamblado normal',
  );
  assert.equal(memoriaPorId(n.memoria_id).fase, 'fin');
});

test('should_refuse_to_reserve_assembly_of_a_memoria_that_failed_before_the_end', () => {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  db.prepare(
    "UPDATE memorias SET estado = 'fallida', fase = 'estrategia', error = 'La estrategia de la memoria falló en todas sus rondas.' WHERE id = ?",
  ).run(p.memoria);
  const r = reservarEnsamblado(db, p.memoria);
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error?.message ?? '', /falló antes de redactarse: no hay nada que montar/);
  assert.equal(memoriaPorId(p.memoria).estado, 'fallida', 'no se toca');
  db.prepare("UPDATE memorias SET estado = 'fallida', fase = 'dossier' WHERE id = ?").run(p.memoria);
  assert.match(
    reservarEnsamblado(db, p.memoria).error?.message ?? '',
    /falló antes de redactarse/,
    'tampoco si falló en el dossier',
  );
  db.prepare("UPDATE memorias SET fase = 'fin' WHERE id = ?").run(p.memoria);
  assert.equal(
    reservarEnsamblado(db, p.memoria).error,
    null,
    'una que falló al montar el Word (fase «fin») sí se reintenta',
  );
});

// ── Un apartado que no se pidió en esta ronda ──

test('should_reject_apartado_that_is_not_pending_in_this_round', async () => {
  const n = await enRedaccion();
  const enviar = (k: number) => recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones');
  assert.equal(enviar(1).error, null);
  const otra = enviar(1);
  assert.equal(otra.error?.code, 'invalid_input');
  assert.match(
    otra.error?.message ?? '',
    /El apartado 1 no se reescribe en esta ronda: no lo reenvíes\./,
    'ya recibido: no se pisa',
  );
  db.prepare('UPDATE memorias SET ronda = 1 WHERE id = ?').run(n.memoria_id);
  db.prepare(
    "UPDATE memoria_apartados SET estado = CASE apartado WHEN 2 THEN 'pendiente' ELSE 'recibido' END, ronda = 1 WHERE memoria_id = ? AND apartado IN (2, 3)",
  ).run(n.memoria_id);
  assert.match(
    enviar(3).error?.message ?? '',
    /El apartado 3 no se reescribe en esta ronda/,
    'en la ronda 1, solo los que se pidieron',
  );
  assert.equal(enviar(2).error, null, 'el pedido sí');
});

// ── Con el plazo justo ──

const margenMs = () => nucleo().config.licitaciones.margenFirmaHoras * 3_600_000;

test('should_warn_with_a_confirmable_error_when_the_deadline_is_too_tight_for_the_memoria', () => {
  sinMemorias();
  const restaurarPlazo = plazoEn(margenMs() + 60 * MIN);
  try {
    const r = pedirMemoria(nucleo().db, db, salidas, ID);
    assert.equal(r.error?.code, 'plazo_justo', 'lo pide una persona: aviso que se puede confirmar');
    assert.match(r.error?.message ?? '', /la memoria técnica .* tarda unos 3 h.*hazlo a mano\.$/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n, 0, 'no se crea nada');
    const confirmada = pedirMemoria(nucleo().db, db, salidas, ID, { confirmado: true });
    assert.equal(confirmada.error, null, confirmada.error?.message);
    assert.equal(memoriaPorId(confirmada.data!.memoria).fase, 'dossier', 'confirmada, se pide igualmente');
  } finally {
    restaurarPlazo();
  }
});
