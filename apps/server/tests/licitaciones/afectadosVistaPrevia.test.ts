// Vista previa de «Actualizar los apartados afectados» para la tarjeta de memoria: la tarjeta no
// conoce el cambio, así que el servidor lo deduce de las decisiones con que se pidió la versión
// frente a las de ahora, dice qué apartados rehace sin escribir nada y devuelve los cambios para
// mandarlos luego a «actualizar-afectados». En la base, con el caso A (Ana García Pérez,
// responsable; Luis Martín Díaz, consultora).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  arrancar,
  cerrar,
  db,
  ID,
  nucleo,
  PERSONAS,
  salidas,
  sinMemorias,
  trabajosDe,
} from '../helpers/memoriaEntorno.js';
import { apartadoCasoA, decisionesCasoA } from './fixtures/casoA.js';

const { afectadosDeCambios, cambiosEntre, vistaPreviaAfectados } =
  await import('../../src/dominios/licitaciones/oferta/apartadosAfectados.js');
const { CambioImpacto } = await import('../../src/dominios/licitaciones/oferta/dependencias.js');
const { baseDependencias, dependenciasDeTexto } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { TIPO_MEMORIA_REDACCION } = await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { ensamblarMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');

before(arrancar);
after(cerrar);

type J = Record<string, any>;
const FRASE_ANA = 'Ana García Pérez coordinará el servicio y será la persona de referencia de la SIIE.';
const memoria = (version: number) =>
  db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as J | undefined;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function limpiar(): void {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');
  if (guardarDecisiones(db, nucleo().db, ID, decisionesCasoA(PERSONAS)).error) throw new Error('decisiones');
}

// Una memoria con fases ya ensamblada, con sus cuatro apartados (Ana nombrada en el 2) y sus dependencias guardadas.
async function ensambladaConAna(): Promise<number> {
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, 1, 'redactando', ?, 'fin', 0)",
      )
      .run(ID, g.id, new Date().toISOString()).lastInsertRowid,
  );
  for (const n of [1, 2, 3, 4]) {
    const a = apartadoCasoA(n, { memoria_id: m, guion_id: g.id, version: 1 }) as J;
    if (n === 2) a['bloques'][0].parrafos = [...a['bloques'][0].parrafos, FRASE_ANA];
    const { id: _i, memoria_id: _m, guion_id: _g, version: _v, apartado: _a, ...datos } = a;
    db.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, recibido_en, dependencias) VALUES (?, ?, 'recibido', ?, ?, ?)",
    ).run(
      m,
      n,
      JSON.stringify(datos),
      new Date().toISOString(),
      JSON.stringify(dependenciasDeTexto(baseDependencias(db, g), g, n, datos as never)),
    );
  }
  const e = await ensamblarMemoria(db, m, { salidas, conocimiento: null });
  assert.equal(e.error, null, e.error?.message);
  return m;
}

// Luis pasa a responsable del servicio y Ana sale, después de pedir la memoria.
async function saleAna(): Promise<void> {
  await esperar(5);
  assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA([PERSONAS[1]!])).error, null);
}

// ── Puro ──

test('should_derive_who_leaves_and_whose_role_changes_from_the_decisions', () => {
  // Arrange
  const antes = {
    lotes: ['2', '4', '6'],
    equipo: [
      { persona_id: 1, rol: 'Responsable', lotes: [] },
      { persona_id: 2, rol: 'Consultora', lotes: [] },
      { persona_id: 3, rol: 'Docente', lotes: ['2'] },
    ],
  };
  const despues = {
    lotes: ['4', '2'],
    equipo: [
      { persona_id: 2, rol: 'Responsable', lotes: [] },
      { persona_id: 3, rol: 'docente', lotes: ['2'] },
    ],
  };

  // Act
  const cambios = cambiosEntre(antes, despues);

  // Assert: la 3 solo cambia de mayúsculas, no cuenta; el lote 6 deja de ir.
  assert.deepEqual(cambios, [
    {
      decisiones: {
        equipo: [
          { persona_id: 1, sale: true },
          { persona_id: 2, sale: false },
        ],
      },
    },
    { lotes: ['4', '2'] },
  ]);
});

test('should_return_no_changes_when_team_and_lots_are_the_same', () => {
  const e = { lotes: ['1'], equipo: [{ persona_id: 1, rol: 'Responsable', lotes: [] }] };

  assert.deepEqual(cambiosEntre(e, { lotes: ['1', '1'], equipo: [...e.equipo] }), []);
});

test('should_not_throw_and_stay_valid_for_a_framework_with_60_lots_and_a_whole_team_replaced', () => {
  // Arrange: un acuerdo marco con 60 lotes decididos y un equipo de 30 sustituido por otras 30 personas.
  const lotes = Array.from({ length: 60 }, (_, i) => String(i + 1));
  const equipo = (desde: number) =>
    Array.from({ length: 30 }, (_, i) => ({ persona_id: desde + i, rol: 'Docente', lotes: [] }));
  const antes = { lotes: ['1'], equipo: equipo(1) };
  const despues = { lotes, equipo: equipo(101) };

  // Act
  const cambios = cambiosEntre(antes, despues);

  // Assert
  assert.equal(cambios.length, 2);
  assert.deepEqual(
    cambios.map((c) => CambioImpacto.safeParse(c).success),
    [true, true],
    'los límites de CambioImpacto cubren los de las decisiones',
  );
});

// ── En la base ──

test('should_preview_the_sections_a_late_change_redoes_without_writing', async () => {
  // Arrange
  limpiar();
  await ensambladaConAna();
  await saleAna();

  // Act
  const r = vistaPreviaAfectados(nucleo().db, db, { id: ID, version: 1 });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.ok(r.data!.apartados.includes(2), JSON.stringify(r.data!.apartados));
  assert.ok(r.data!.afectadas.every((a) => a.accion === 'rehacer' && a.coste.runs === 1));
  assert.deepEqual(r.data!.cambios, [
    {
      decisiones: {
        equipo: [
          { persona_id: PERSONAS[0], sale: true },
          { persona_id: PERSONAS[1], sale: false },
        ],
      },
    },
  ]);
  assert.match(r.data!.indicaciones, /Luis Martín Díaz sustituye a Ana García Pérez como Responsable del servicio/);
  assert.equal(memoria(2), undefined);
  assert.equal(trabajosDe(TIPO_MEMORIA_REDACCION).length, 0);
});

test('should_preview_nothing_when_decisions_did_not_change_since_the_version', async () => {
  // Arrange
  limpiar();
  await ensambladaConAna();

  // Act
  const r = vistaPreviaAfectados(nucleo().db, db, { id: ID, version: 1 });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual([r.data!.cambios, r.data!.apartados], [[], []]);
});

test('should_not_preview_changes_on_the_submitted_memoria', async () => {
  // Arrange
  limpiar();
  const m = await ensambladaConAna();
  db.prepare('UPDATE memorias SET presentada = 1 WHERE id = ?').run(m);
  await saleAna();

  // Act
  const r = vistaPreviaAfectados(nucleo().db, db, { id: ID, version: 1 });

  // Assert
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /presentada/);
});

test('should_serve_the_preview_by_get_and_redo_with_its_changes_by_post', async () => {
  // Arrange
  limpiar();
  await ensambladaConAna();
  await saleAna();

  // Act
  const previa = await api(`/licitaciones/${ID}/oferta/memoria/1/afectados`, undefined, 'GET');
  const cuerpo = (await previa.json()) as J;
  const trasLaPrevia = memoria(2);
  const pedido = await api(`/licitaciones/${ID}/oferta/memoria/1/actualizar-afectados?confirmar=1`, {
    cambios: cuerpo['cambios'],
    apartados: cuerpo['apartados'],
  });

  // Assert
  assert.equal(previa.status, 200, JSON.stringify(cuerpo));
  assert.equal(trasLaPrevia, undefined);
  assert.equal(pedido.status, 202, JSON.stringify(await pedido.clone().json()));
  assert.deepEqual(JSON.parse(memoria(2)!['apartados_rehechos']), cuerpo['apartados']);
});

test('should_reject_an_empty_list_of_changes', async () => {
  // Arrange
  limpiar();

  // Act
  const r = await api(`/licitaciones/${ID}/oferta/memoria/1/actualizar-afectados?confirmar=1`, { cambios: [] });

  // Assert
  assert.equal(r.status, 400);
});

test('should_merge_sections_of_several_changes_once_each', async () => {
  // Arrange
  limpiar();
  await ensambladaConAna();
  await saleAna();
  const sale = { decisiones: { equipo: [{ persona_id: PERSONAS[0], sale: true }] } };

  // Act
  const r = afectadosDeCambios(nucleo().db, db, { id: ID, version: 1, cambios: [sale, sale] });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(new Set(r.data!.afectadas.map((a) => a.clave)).size, r.data!.afectadas.length);
  assert.deepEqual(r.data!.apartados, [2]);
});
