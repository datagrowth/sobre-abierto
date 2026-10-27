// Memoria de ensayo: para medir el método hay que generarla en casos reales con referencia (ofertas
// ya presentadas, con el plazo vencido) y compararla a ciegas con la presentada. Se pide solo con el plazo vencido y confirmándolo, ninguna fase la frena por plazo,
// sus archivos llevan «-ensayo» y nunca cuenta como la memoria de la oferta.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  arrancar,
  cerrar,
  conectar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  T_OFERTA,
  texto,
  trabajosDe,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { APARTADOS, apartadoCasoA } from './fixtures/casoA.js';

const { pedirMemoria, memoriasDe, resumenOferta, licitacionesConEnsayo } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria, estadoAvance } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { TIPO_MEMORIA_ESTRATEGIA } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { ensamblarMemoria, filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { memoriaConTiempo } = await import('../../src/dominios/licitaciones/oferta/plazo.js');
const { faltaMemoria } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { pendientesDeRevisar } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { descartarVersionesSinRevisar, revisarIa } =
  await import('../../src/dominios/licitaciones/propuestas/revision.js');
const { ApartadoEntrada, recibirApartado } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { CriticaEntrada, recibirCritica, TIPO_MEMORIA_CRITICA } =
  await import('../../src/dominios/licitaciones/oferta/critica.js');
const { actualizarMemoria } = await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { subirMemoria } = await import('../../src/dominios/licitaciones/oferta/subida.js');
const { leccionesParaRedactar } = await import('../../src/dominios/licitaciones/oferta/leccionesAplicadas.js');
const { vueltaCadena } = await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { trabajoDeEnsayo } = await import('../../src/dominios/licitaciones/prioridadCola.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');

before(arrancar);
after(cerrar);

const MIN = 60_000;
const RUTA = `/licitaciones/${ID}/oferta/memoria`;
type Error409 = { error: string; message: string };

// El plazo de la licitación, `ms` desde ahora (negativo: ya venció); devuelve cómo restaurarlo.
function plazoEn(ms: number): () => void {
  const antes = (db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(ID) as { fecha_limite: string })
    .fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(horaLocalEspana(Date.now() + ms), ID);
  return () => {
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(antes, ID);
  };
}

async function conPlazoVencido(fn: () => Promise<void> | void): Promise<void> {
  const restaurar = plazoEn(-2 * 24 * 60 * MIN);
  try {
    await fn();
  } finally {
    restaurar();
  }
}

const limpiar = () => {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');
};
const cuantas = () => (db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n;

test('should_return_409_ensayo_en_plazo_when_the_deadline_has_not_passed', async () => {
  limpiar();
  const r = await api(`${RUTA}?confirmar=1`, { ensayo: true });
  assert.equal(r.status, 409);
  const b = (await r.json()) as Error409;
  assert.equal(b.error, 'ensayo_en_plazo');
  assert.match(b.message, /solo para ofertas con el plazo vencido.*pide la memoria normal/);
  assert.equal(cuantas(), 0, 'no se crea nada');
});

test('should_return_409_ensayo_sin_confirmar_without_confirmation', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    const r = await api(RUTA, { ensayo: true });
    assert.equal(r.status, 409);
    const b = (await r.json()) as Error409;
    assert.equal(b.error, 'ensayo_sin_confirmar');
    assert.match(b.message, /no cambia lo presentado/);
  });
  assert.equal(cuantas(), 0);
});

test('should_create_ensayo_memoria_in_dossier_phase_and_enqueue_the_strategy', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    const r = await api(`${RUTA}?confirmar=1`, { ensayo: true });
    assert.equal(r.status, 202, await r.clone().text());
    const p = (await r.json()) as { memoria: number; ensayo: boolean };
    assert.equal(p.ensayo, true);
    const m = filaMemoria(db, p.memoria)!;
    assert.deepEqual([m.fase, m.ensayo], ['dossier', 1]);
    await avanzarMemoria(nucleo().db, db, p.memoria);
    assert.equal(memoriaPorId(p.memoria).fase, 'estrategia');
    assert.equal(trabajosDe(TIPO_MEMORIA_ESTRATEGIA).length, 1, 'la estrategia se encola aunque el plazo haya vencido');
    assert.deepEqual(licitacionesConEnsayo(db), [ID], 'la cadena relanza sus trabajos colgados');
  });
});

test('should_not_block_the_following_phases_of_an_ensayo_by_the_deadline', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    const p = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true }).data!;
    await avanzarMemoria(nucleo().db, db, p.memoria);
    const m = filaMemoria(db, p.memoria)!;
    assert.equal(memoriaConTiempo(db, m, 'ronda'), true, 'otra ronda');
    assert.equal(memoriaConTiempo(db, { ...m, ensayo: 0 }, 'ronda'), false, 'una normal sí se frena');
    // La estrategia falló hace rato: con tiempo se reintenta, no se salta con el aviso de plazo.
    nucleo()
      .db.prepare("UPDATE trabajos_ia SET estado = 'fallido', actualizado_en = ? WHERE tipo = ?")
      .run(new Date(Date.now() - 40 * MIN).toISOString(), TIPO_MEMORIA_ESTRATEGIA);
    assert.equal(estadoAvance(nucleo().db, db, m).plazo, true);
    await avanzarMemoria(nucleo().db, db, p.memoria);
    assert.equal(memoriaPorId(p.memoria).fase, 'estrategia', 'sigue en la estrategia');
    assert.equal(trabajosDe(TIPO_MEMORIA_ESTRATEGIA).length, 2, 'y la reintenta');
    assert.equal(
      JSON.parse((db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(p.memoria) as { avisos: string }).avisos)
        .length,
      0,
    );
  });
});

// Una memoria de ensayo con todos sus apartados fallidos: se monta con sus marcas.
async function ensayoEnsamblado(): Promise<{ memoria: number; version: number; ruta: string; borrador: number }> {
  let r: { memoria: number; version: number; ruta: string; borrador: number } | null = null;
  await conPlazoVencido(async () => {
    const p = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true });
    assert.equal(p.error, null, p.error?.message);
    db.prepare("UPDATE memoria_apartados SET estado = 'fallido' WHERE memoria_id = ?").run(p.data!.memoria);
    const e = await ensamblarMemoria(db, p.data!.memoria);
    assert.equal(e.error, null, e.error?.message);
    r = { memoria: p.data!.memoria, version: p.data!.version, ruta: e.data!.ruta, borrador: e.data!.borrador };
  });
  return r!;
}

// Una memoria normal ya montada y con su borrador en `estado` (sin pasar por Hermes).
function memoriaNormal(version: number, estado: 'pendiente' | 'aceptada'): number {
  const g = guionVigente(db, ID)!;
  const ts = new Date().toISOString();
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, estado)
    VALUES (?, ?, 'x', 1, 'Memoria', 'plataforma', ?, 'ensamblado', ?, ?, ?)`,
      )
      .run(ID, `Salidas/Licitaciones/x/memoria-v${version}.docx`, ts, g.id, version, estado).lastInsertRowid,
  );
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, borrador_id) VALUES (?, ?, ?, 'ensamblada', ?, ?, ?)",
      )
      .run(ID, g.id, version, ts, ts, b).lastInsertRowid,
  );
  db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(m, b);
  return b;
}

test('should_write_the_ensayo_files_with_the_ensayo_suffix_and_keep_the_pending_one', async () => {
  limpiar();
  const pendiente = memoriaNormal(1, 'pendiente');
  const e = await ensayoEnsamblado();
  assert.equal(e.version, 2);
  assert.match(e.ruta, /\/memoria-v2-ensayo\.docx$/);
  const b = db.prepare('SELECT ruta_md, ruta_json, resumen FROM borradores WHERE id = ?').get(e.borrador) as {
    ruta_md: string;
    ruta_json: string;
    resumen: string;
  };
  assert.match(b.ruta_md, /\/memoria-v2-ensayo\.md$/);
  assert.match(b.ruta_json, /\/memoria-v2-ensayo\.json$/);
  assert.match(b.resumen, /^Memoria técnica v2 \(ensayo, no presentada\)/);
  assert.equal(
    (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(pendiente) as { estado: string }).estado,
    'pendiente',
    'no descarta la que está por revisar',
  );
  assert.equal(memoriasDe(db, ID)[0]!.ensayo, true, 'el estado de la memoria dice que es de ensayo');
});

test('should_keep_using_the_non_ensayo_memoria_as_current_for_a_live_offer', async () => {
  limpiar();
  const aceptada = memoriaNormal(1, 'aceptada');
  const e = await ensayoEnsamblado();
  // La oferta sigue viva (el plazo de la licitación de prueba no ha vencido).
  assert.deepEqual(faltaMemoria(db, ID, guionVigente(db, ID)!), [], 'la presentada, dada por buena, hace la memoria');
  assert.equal(resumenOferta(db, ID).memoria?.version, 1);
  assert.equal(
    pendientesDeRevisar(db, 50, ID).filter((x) => x.tipo === 'borrador').length,
    0,
    'la de ensayo no sale en Hoy por revisar',
  );
  const r = revisarIa(db, 'borradores', e.borrador, { decision: 'aceptar' });
  assert.equal(r.error?.code, 'conflicto', 'no se da por buena');
  assert.equal(
    (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(aceptada) as { estado: string }).estado,
    'aceptada',
    'ni pisa la aceptada',
  );
  const c = await conectar(T_OFERTA);
  try {
    type Estado = { version: number; ensayo: boolean };
    const o = JSON.parse(texto(await c.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }))) as {
      memoria: Estado;
      memoria_ensayo: Estado | null;
    };
    assert.deepEqual(
      [o.memoria.version, o.memoria.ensayo],
      [1, false],
      'licitaciones_oferta da la memoria de la oferta, no la de ensayo',
    );
    assert.deepEqual(
      [o.memoria_ensayo?.version, o.memoria_ensayo?.ensayo],
      [e.version, true],
      'y la de ensayo, aparte',
    );
  } finally {
    await c.close();
  }
});

test('should_still_return_plazo_vencido_for_a_normal_request_after_the_deadline', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    assert.equal(pedirMemoria(nucleo().db, db, salidas, ID, { confirmado: true }).error?.code, 'plazo_vencido');
    const r = await api(`${RUTA}?confirmar=1`);
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as Error409).error, 'plazo_vencido');
  });
  assert.equal(cuantas(), 0);
});

test('should_reject_a_malformed_ensayo_flag_or_an_unknown_key_with_400_and_create_nothing', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    for (const cuerpo of [{ ensayo: 'true' }, { ensayo: 1 }, { ensayo: 'false' }, { ensayo: true, otra: 1 }]) {
      const r = await api(`${RUTA}?confirmar=1`, cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.equal(((await r.json()) as Error409).error, 'invalid_input');
    }
    const r = await api(`${RUTA}?confirmar=1`, { ensayo: false });
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as Error409).error, 'plazo_vencido', 'ensayo: false es un pedido normal');
  });
  assert.equal(cuantas(), 0);
});

// Una evaluación pendiente de la versión `version` (la autoevaluación de Hermes).
function evaluacionPendiente(version: number): number {
  return Number(
    db
      .prepare(
        "INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, 'Salidas/x.docx', ?, 'oferta-licitaciones', ?)",
      )
      .run(ID, JSON.stringify({ memoria: { version } }), new Date().toISOString()).lastInsertRowid,
  );
}
const estadoDe = (tabla: 'borradores' | 'evaluaciones', id: number) =>
  (db.prepare(`SELECT estado FROM ${tabla} WHERE id = ?`).get(id) as { estado: string }).estado;

test('should_keep_the_ensayo_draft_and_its_score_when_a_newer_offer_version_arrives_or_is_accepted', async () => {
  limpiar();
  const e = await ensayoEnsamblado();
  const nota = evaluacionPendiente(e.version);
  const vieja = evaluacionPendiente(0);
  // Lo que hacen subir un Word y ensamblar una memoria normal.
  const nueva = memoriaNormal(e.version + 1, 'pendiente');
  descartarVersionesSinRevisar(db, ID, nueva, e.version + 1);
  assert.deepEqual(
    [estadoDe('borradores', e.borrador), estadoDe('evaluaciones', nota)],
    ['pendiente', 'pendiente'],
    'el ensayo conserva su Word y su nota',
  );
  assert.equal(estadoDe('evaluaciones', vieja), 'descartada', 'lo de la oferta sin revisar sí queda atrás');
  assert.equal(revisarIa(db, 'borradores', nueva, { decision: 'aceptar' }).error, null);
  assert.equal(estadoDe('borradores', e.borrador), 'pendiente', 'dar por buena la de la oferta no descarta el ensayo');
});

const INDICACIONES = { apartados: [1], indicaciones: 'Cuantifica el volumen de consultas atendidas cada mes.' };
// Una memoria de la oferta ya montada con el método de fases: sobre ella se pide la nueva versión.
const enFin = (version: number) => db.prepare("UPDATE memorias SET fase = 'fin' WHERE version = ?").run(version);

test('should_not_let_a_running_ensayo_block_improving_or_uploading_the_offer_memoria', async () => {
  limpiar();
  let ensayo = 0;
  await conPlazoVencido(() => {
    ensayo = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true }).data!.memoria;
  });
  assert.equal(filaMemoria(db, ensayo)!.estado, 'redactando');
  memoriaNormal(2, 'pendiente');
  enFin(2);
  const subida = await subirMemoria(db, ID, {
    nombre: 'memoria.docx',
    datos: Buffer.from('no es un word'),
    campos: {},
  });
  assert.equal(subida.error?.code, 'invalid_input', 'llega a leer el Word: el ensayo no la frena');
  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version: 2,
    ...INDICACIONES,
    confirmado: true,
  });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(filaMemoria(db, r.data!.memoria)!.ensayo, 0);
});

test('should_refuse_to_improve_an_ensayo_memoria_even_if_the_deadline_reopens', async () => {
  limpiar();
  const e = await ensayoEnsamblado();
  // ensayoEnsamblado restaura el plazo: como una ampliación publicada después del ensayo.
  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version: e.version,
    ...INDICACIONES,
    confirmado: true,
  });
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /es de ensayo/);
  assert.equal(cuantas(), 1, 'no crea ninguna versión');
});

test('should_write_the_ensayo_dossier_and_strategy_with_the_ensayo_suffix', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    const p = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true }).data!;
    await avanzarMemoria(nucleo().db, db, p.memoria);
    const d = db.prepare('SELECT ruta_md FROM memoria_dossiers WHERE memoria_id = ?').get(p.memoria) as {
      ruta_md: string;
    };
    assert.ok(d.ruta_md.endsWith(`/memoria-v${p.version}-ensayo-dossier.md`), d.ruta_md);
    assert.equal(
      recibirEstrategia(
        db,
        nucleo().db,
        EstrategiaEntrada.parse(estrategiaCasoA({ memoria_id: p.memoria, version: p.version })),
        'oferta-licitaciones',
      ).error,
      null,
    );
    const s = db.prepare('SELECT ruta_md FROM memoria_estrategias WHERE memoria_id = ?').get(p.memoria) as {
      ruta_md: string;
    };
    assert.ok(s.ruta_md.endsWith(`/memoria-v${p.version}-ensayo-estrategia.md`), s.ruta_md);
  });
});

test('should_not_feed_the_ensayo_with_lessons_learned_from_its_own_presented_memoria', async () => {
  limpiar();
  db.exec('DELETE FROM lecciones');
  const a = APARTADOS[0]!;
  db.prepare(
    `INSERT INTO lecciones (licitacion_id, memoria_id, apartado, apartado_titulo, alcance, texto, agente, creada_en, estado)
    VALUES (?, 1, 1, ?, 'licitacion', 'LECCION-PROPIA: cuantificar el volumen de consultas.', 'oferta-licitaciones', ?, 'aceptada')`,
  ).run(ID, a.titulo, new Date().toISOString());
  const q = { licitacion_id: ID, apartado: 1, titulo: a.titulo, se_valorara: a.se_valorara };
  assert.equal(leccionesParaRedactar(db, q).length, 1, 'la memoria de la oferta sí la usa');
  assert.deepEqual(leccionesParaRedactar(db, { ...q, sinLasPropias: true }), []);
  await conPlazoVencido(async () => {
    const p = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true }).data!;
    await avanzarMemoria(nucleo().db, db, p.memoria);
    const d = db.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(p.memoria) as {
      secciones: string;
    };
    assert.doesNotMatch(d.secciones, /LECCION-PROPIA/, 'el dossier del ensayo no la lleva');
  });
  db.exec('DELETE FROM lecciones');
});

const CITA = 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas';
const MOTIVO = {
  cita: 'un indicador con meta mensual que revisará con la entidad',
  motivo: 'El indicador no tiene cifra.',
  arreglo: 'Fijar la meta del 95 % de consultas en plazo.',
};

test('should_run_the_critique_and_another_round_of_an_ensayo_with_the_deadline_passed', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    const p = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true }).data!;
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
    await avanzarMemoria(nucleo().db, db, p.memoria);
    const m = memoriaPorId(p.memoria);
    const n = { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
    for (const k of [1, 2, 3, 4])
      assert.equal(recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones').error, null);
    await avanzarMemoria(nucleo().db, db, p.memoria);
    assert.equal(memoriaPorId(p.memoria).fase, 'critica');
    assert.equal(trabajosDe(TIPO_MEMORIA_CRITICA).length, 1, 'el crítico se encola: es lo que se mide');
    const tramos = [8, 5, 5, 4];
    const c = CriticaEntrada.parse({
      id: ID,
      memoria_id: p.memoria,
      ronda: 0,
      resumen: 'Le faltan cifras propias de la entidad en la calidad y el acompañamiento.',
      apartados: APARTADOS.map((a, i) => ({
        apartado: i + 1,
        tramo: tramos[i]!,
        puntos: tramos[i]!,
        cita: CITA,
        motivos_para_bajar: tramos[i]! < a.escala.at(-1)! ? [MOTIVO] : [],
        falta: [],
      })),
    });
    assert.equal(recibirCritica(db, c, 'critico-licitaciones', { revisar: true }).error, null);
    await avanzarMemoria(nucleo().db, db, p.memoria);
    const tras = memoriaPorId(p.memoria);
    assert.deepEqual(
      [tras.fase, tras.ronda, tras.estado],
      ['redaccion', 1, 'redactando'],
      'otra ronda, no se ensambla por plazo',
    );
  });
});

test('should_relaunch_a_hung_job_of_an_ensayo_with_the_deadline_passed', async () => {
  limpiar();
  await conPlazoVencido(async () => {
    const p = pedirMemoria(nucleo().db, db, salidas, ID, { ensayo: true, confirmado: true }).data!;
    await avanzarMemoria(nucleo().db, db, p.memoria);
    const t = trabajosDe(TIPO_MEMORIA_ESTRATEGIA)[0]!;
    nucleo()
      .db.prepare("UPDATE trabajos_ia SET estado = 'lanzado', run_id = NULL, error = NULL, lanzado_en = ? WHERE id = ?")
      .run(new Date(Date.now() - 5 * 60 * MIN).toISOString(), t.id);
    assert.equal(vueltaCadena(nucleo().db, db, Date.now(), () => 'listo').relanzados, 1);
    assert.equal(trabajosDe(TIPO_MEMORIA_ESTRATEGIA)[0]!.estado, 'pendiente');
  });
});

test('should_recognise_the_jobs_of_an_ensayo_so_the_queue_puts_them_behind_live_offers', async () => {
  limpiar();
  const e = await ensayoEnsamblado();
  const normal = memoriaNormal(e.version + 1, 'pendiente');
  const rutaNormal = (db.prepare('SELECT ruta FROM borradores WHERE id = ?').get(normal) as { ruta: string }).ruta;
  assert.equal(trabajoDeEnsayo(db, { id: ID, memoria_id: e.memoria }), true);
  assert.equal(trabajoDeEnsayo(db, { id: ID, documento: e.ruta }), true, 'su autoevaluación');
  assert.equal(trabajoDeEnsayo(db, { id: ID, memoria_id: e.memoria + 1 }), false);
  assert.equal(trabajoDeEnsayo(db, { id: ID, documento: rutaNormal }), false);
  assert.equal(trabajoDeEnsayo(db, { id: ID }), false);
  assert.equal(trabajoDeEnsayo(db, null), false);
});
