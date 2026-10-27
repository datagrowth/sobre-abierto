// Montaje cortado: si el servidor se reinicia (un despliegue) mientras ensambla una memoria, en la
// siguiente vuelta la vuelve a montar sola, sin perder sus avisos ni su fase; solo si se
// corta tres veces seguidas queda fallida para que una persona lo mire.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrancar,
  cerrar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { APARTADOS, apartadoCasoA } from './fixtures/casoA.js';

const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { CriticaEntrada, recibirCritica } = await import('../../src/dominios/licitaciones/oferta/critica.js');
const { ENSAMBLADO_INTERRUMPIDO, liberarEnsamblados, MAX_CORTES_ENSAMBLADO } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { reanudarEnsamblados } = await import('../../src/dominios/licitaciones/oferta/reanudarEnsamblado.js');
const { evaluacionDeMemoria } = await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');

before(arrancar);
after(cerrar);

type Fila = {
  estado: string;
  fase: string | null;
  ronda: number;
  error: string | null;
  avisos: string;
  cortes_ensamblado: number;
  borrador_id: number | null;
};
const fila = (id: number) =>
  db
    .prepare('SELECT estado, fase, ronda, error, avisos, cortes_ensamblado, borrador_id FROM memorias WHERE id = ?')
    .get(id) as Fila;
const limpiar = () => {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');
};

// Una memoria con todos sus apartados que un reinicio dejó «ensamblando» en su fase final.
function memoriaCortada(): number {
  limpiar();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  db.exec("UPDATE memoria_apartados SET estado = 'recibido'");
  db.prepare("UPDATE memorias SET estado = 'ensamblando', fase = 'fin', avisos = ? WHERE id = ?").run(
    JSON.stringify(['Aviso de antes del corte.']),
    p.memoria,
  );
  return p.memoria;
}

// Una memoria criticada que había empezado a ensamblarse (fase fin) cuando se cortó.
async function criticadaCortada(): Promise<number> {
  limpiar();
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
  const n = { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
  for (const k of [1, 2, 3, 4])
    assert.equal(recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones').error, null);
  await trasLaEstrategia(p.memoria);
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: m.id,
    ronda: 0,
    resumen: 'Cumple con lo que se valora.',
    apartados: APARTADOS.map((a, i) => ({
      apartado: i + 1,
      tramo: a.escala.at(-1)!,
      puntos: a.escala.at(-1)!,
      cita: 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas',
      motivos_para_bajar: [],
      falta: [],
    })),
  });
  assert.equal(recibirCritica(db, c, 'critico-licitaciones', { revisar: true }).error, null);
  db.prepare("UPDATE memorias SET estado = 'ensamblando', fase = 'fin', avisos = ? WHERE id = ?").run(
    JSON.stringify(['Coherencia: aviso de antes del corte.']),
    m.id,
  );
  return m.id;
}

test('should_reassemble_a_memoria_cut_by_a_restart_on_the_next_round_keeping_its_warnings', async () => {
  const id = memoriaCortada();
  await reanudarEnsamblados(db);
  const f = fila(id);
  assert.deepEqual(
    [f.estado, f.error, f.cortes_ensamblado],
    ['ensamblada', null, 0],
    'se monta sola y el contador vuelve a 0',
  );
  assert.ok(f.borrador_id, 'con su borrador en Salidas');
  assert.ok((JSON.parse(f.avisos) as string[]).includes('Aviso de antes del corte.'), f.avisos);
});

test('should_reassemble_a_criticised_memoria_cut_in_its_final_phase_and_store_its_last_critique_as_evaluation', async () => {
  const id = await criticadaCortada();
  await reanudarEnsamblados(db);
  const f = fila(id);
  assert.deepEqual(
    [f.estado, f.fase, f.ronda, f.error],
    ['ensamblada', 'fin', 0, null],
    'sigue en su fase fin, sin volver a redactar ni a criticar',
  );
  assert.ok((JSON.parse(f.avisos) as string[]).includes('Coherencia: aviso de antes del corte.'), f.avisos);
  const m = memoriaPorId(id);
  assert.ok(evaluacionDeMemoria(db, ID, m.version), 'la última crítica queda como evaluación, como al cerrarla');
});

test('should_fail_with_the_interrupted_message_only_after_three_cuts_in_a_row', () => {
  const id = memoriaCortada();
  for (let corte = 1; corte < MAX_CORTES_ENSAMBLADO; corte++) {
    // El remontaje se corta otra vez: la memoria sigue «ensamblando» sin que nadie la monte.
    assert.deepEqual(
      liberarEnsamblados(db).map((m) => m.id),
      [id],
      `corte ${corte}: se vuelve a montar`,
    );
    assert.deepEqual([fila(id).estado, fila(id).cortes_ensamblado], ['ensamblando', corte]);
  }
  assert.deepEqual(liberarEnsamblados(db), [], 'al tercer corte seguido ya no se reanuda');
  const f = fila(id);
  assert.deepEqual(
    [f.estado, f.error, f.cortes_ensamblado],
    ['fallida', ENSAMBLADO_INTERRUMPIDO, 0],
    'una persona la relanza con la cuenta a cero',
  );
});

test('should_count_only_cuts_in_a_row_because_a_finished_assembly_resets_the_count', async () => {
  const id = memoriaCortada();
  liberarEnsamblados(db);
  assert.equal(fila(id).cortes_ensamblado, 1, 'el primer remontaje también se cortó');
  await reanudarEnsamblados(db);
  assert.deepEqual(
    [fila(id).estado, fila(id).cortes_ensamblado],
    ['ensamblada', 0],
    'el segundo acaba y la cuenta vuelve a 0',
  );
  db.prepare("UPDATE memorias SET estado = 'ensamblando' WHERE id = ?").run(id);
  assert.deepEqual(
    liberarEnsamblados(db).map((m) => m.cortes_ensamblado),
    [1],
    'un corte en otro ensamblado empieza de nuevo',
  );
});

test('should_not_touch_memorias_that_are_not_assembling', async () => {
  limpiar();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await reanudarEnsamblados(db);
  assert.deepEqual([fila(p.memoria).estado, fila(p.memoria).cortes_ensamblado], ['redactando', 0]);
});

test('should_resume_a_lot_memoria_with_its_lot_leaving_the_other_lots_versions_unreviewed', async () => {
  // La memoria del lote 1 ya ensamblada y sin revisar; la del lote 2 la cortó un reinicio.
  const lote1 = memoriaCortada();
  db.prepare("UPDATE memorias SET lote = '1' WHERE id = ?").run(lote1);
  await reanudarEnsamblados(db);
  const borradorLote1 = fila(lote1).borrador_id!;
  const g = memoriaPorId(lote1).guion_id;
  const lote2 = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, lote) VALUES (?, ?, 2, 'ensamblando', ?, '2')",
      )
      .run(ID, g, new Date().toISOString()).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO memoria_apartados (memoria_id, apartado, estado) SELECT ?, apartado, 'recibido' FROM memoria_apartados WHERE memoria_id = ?",
  ).run(lote2, lote1);

  await reanudarEnsamblados(db);

  assert.equal(fila(lote2).estado, 'ensamblada');
  const estado = (id: number) =>
    (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(id) as { estado: string }).estado;
  assert.equal(estado(borradorLote1), 'pendiente', 'la memoria del lote 2 no deja atrás la del lote 1');
  assert.equal(
    (db.prepare('SELECT lote FROM memorias WHERE id = ?').get(lote2) as { lote: string }).lote,
    '2',
    'sigue siendo del lote 2',
  );
});
