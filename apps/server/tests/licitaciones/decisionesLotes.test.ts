// Los lotes como sección de las decisiones (PATCH /oferta/decisiones/lotes): poda lo de los
// lotes quitados, deja pendiente el precio de los nuevos, historial de los lotes de interés y
// deshacer sin encolar. Sobre el fixture seudonimizado de CASO_E (fixtures/comprobaciones/casoE.json) con
// el caso de Paco: de los lotes 2, 6 y 4 a 2 y 4. Precios de prueba, ninguno ofertado.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decisiones-lotes-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { escuchar } = await import('../../src/nucleo/eventos.js');
type DecisionesData = import('../../src/dominios/licitaciones/oferta/decisiones.js').DecisionesData;

iniciarNucleo();
const db = dbLicitaciones();

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(comoPersona);
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Fixture = {
  licitacion: {
    titulo: string;
    presupuesto_sin_iva: number;
    lotes: { id: string; nombre: string; presupuesto_sin_iva: number }[];
  };
  guiones: { datos: unknown }[];
  decisiones: { datos: DecisionesData };
  personas: { persona_id: number; nombre: string; rol: string }[];
};
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');
const CASO_E = JSON.parse(fs.readFileSync(path.join(DIR, 'casoE.json'), 'utf8')) as Fixture;
const SOLO_LOTE_6 = 1003;
const TRES_LOTES = ['2', '6', '4'];

// CASO_E con los lotes 2, 6 y 4: un precio por lote, Persona J (1003) solo en el lote 6 y un
// automático propio del lote 6. Las demás personas van en todos los lotes.
function casoE(id: string): { datos: DecisionesData; ids: Map<number, number> } {
  const ids = new Map(
    CASO_E.personas.map((p) => [
      p.persona_id,
      crearPersona(nucleo().db, { nombre: p.nombre, tipo: 'interno', rol: p.rol }).data!.id,
    ]),
  );
  const lotes = CASO_E.licitacion.lotes.map((l) => ({ id: l.id, nombre: l.nombre, importe: l.presupuesto_sin_iva }));
  const l = licitacion({
    titulo: CASO_E.licitacion.titulo,
    publicada: '2026-09-24',
    presupuesto: CASO_E.licitacion.presupuesto_sin_iva,
    lotes,
    limite: '2099-10-15T08:00:00',
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, JSON.stringify(TRES_LOTES.map((x) => ({ id: x, motivo: 'criba' }))), ts, ts);
  const guion = Number(
    db
      .prepare(
        "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 4, ?, 'oferta-licitaciones', 1, ?)",
      )
      .run(id, JSON.stringify(CASO_E.guiones.at(-1)!.datos), ts).lastInsertRowid,
  );
  const d = CASO_E.decisiones.datos;
  const datos: DecisionesData = {
    ...d,
    lotes: TRES_LOTES,
    equipo: d.equipo.map((m) => ({
      ...m,
      persona_id: ids.get(m.persona_id)!,
      lotes: m.persona_id === SOLO_LOTE_6 ? ['6'] : [],
    })),
    automaticos: [
      ...d.automaticos,
      { criterio: 'Formación específica en Azure', lote: '6', nos_acogemos: false, tramo: null },
    ],
    ofertas: TRES_LOTES.map((lote, i) => ({ lote, pendiente: false, importe: 100 + i, unitarios: [] })),
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guion,
    JSON.stringify(datos),
    ts,
  );
  // La v1 en el historial, como la deja la migración de decisiones_oferta.version.
  db.prepare(
    "INSERT INTO decisiones_historial (licitacion_id, version, guion_id, datos, secciones, autor, creada_en) VALUES (?, 1, ?, ?, '[]', 'web', ?)",
  ).run(id, guion, JSON.stringify(datos), ts);
  return { datos, ids };
}

const url = (id: string, accion: string) => `${base}/api/licitaciones/licitaciones/${id}/oferta/decisiones/${accion}`;
type Respuesta = { status: number; body: Record<string, unknown> };
async function enviar(
  metodo: 'PATCH' | 'POST',
  destino: string,
  cuerpo: unknown,
  headers: Record<string, string> = {},
): Promise<Respuesta> {
  const r = await fetch(destino, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
const guardada = (id: string) =>
  JSON.parse(
    (db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as { datos: string }).datos,
  ) as DecisionesData;
const interes = (id: string) =>
  (
    JSON.parse(
      (
        db.prepare('SELECT lotes_interes FROM oportunidades WHERE licitacion_id = ?').get(id) as {
          lotes_interes: string;
        }
      ).lotes_interes,
    ) as { id: string }[]
  ).map((x) => x.id);
const historialLotes = (id: string) =>
  (
    db.prepare('SELECT lotes, autor FROM lotes_interes_historial WHERE licitacion_id = ? ORDER BY id').all(id) as {
      lotes: string;
      autor: string;
    }[]
  ).map((h) => [JSON.parse(h.lotes) as string[], h.autor]);
const trabajos = () => (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n;
const precios = (d: DecisionesData) => d.ofertas.map((o) => [o.lote, o.pendiente]);

test('should_prune_lot_6_price_criteria_and_the_person_only_in_lot_6', async () => {
  const ID = 'p-91000650';
  const { datos: antes, ids } = casoE(ID);

  const r = await enviar('PATCH', url(ID, 'lotes'), { version: 1, valor: ['2', '4'] }, de('Persona A'));

  assert.equal(r.status, 200, String(r.body['message']));
  assert.equal(r.body['version'], 2);
  assert.deepEqual(r.body['poda'], { precios: ['6'], automaticos: 1, personas: [ids.get(SOLO_LOTE_6)] });
  const d = guardada(ID);
  assert.deepEqual(d.lotes, ['2', '4']);
  assert.deepEqual(precios(d), [
    ['2', false],
    ['4', false],
  ]);
  assert.ok(!d.automaticos.some((a) => a.lote === '6'), 'sin el automático del lote 6');
  assert.equal(d.automaticos.length, antes.automaticos.length - 1);
  assert.deepEqual(
    d.equipo.map((m) => m.persona_id),
    antes.equipo.filter((m) => m.lotes.length === 0).map((m) => m.persona_id),
    'solo sale la persona del lote 6',
  );
  assert.deepEqual(interes(ID), ['2', '4'], 'los lotes de interés cambian en la misma escritura');
  const h = db
    .prepare('SELECT secciones, autor FROM decisiones_historial WHERE licitacion_id = ? AND version = 2')
    .get(ID) as { secciones: string; autor: string };
  assert.deepEqual([JSON.parse(h.secciones), h.autor], [['lotes'], 'Persona A']);
});

test('should_add_a_pending_price_for_a_new_lot', async () => {
  const ID = 'p-91000660';
  const { datos: antes } = casoE(ID);

  const r = await enviar('PATCH', url(ID, 'lotes'), { version: 1, valor: ['2', '6', '4', '3'] });

  assert.equal(r.status, 200, String(r.body['message']));
  assert.deepEqual(r.body['poda'], { precios: [], automaticos: 0, personas: [] });
  const d = guardada(ID);
  assert.deepEqual([...d.lotes].sort(), ['2', '3', '4', '6']);
  assert.deepEqual(
    precios(d),
    [
      ['2', false],
      ['6', false],
      ['4', false],
      ['3', true],
    ],
    'solo el lote nuevo queda pendiente',
  );
  assert.deepEqual(d.equipo, antes.equipo, 'añadir un lote no toca el equipo');
});

test('should_not_write_anything_when_the_lots_are_not_eligible_or_the_version_is_stale', async () => {
  const ID = 'p-91000670';
  casoE(ID);

  const ajeno = await enviar('PATCH', url(ID, 'lotes'), { version: 1, valor: ['2', '9'] });
  const vacio = await enviar('PATCH', url(ID, 'lotes'), { version: 1, valor: [] });
  const vieja = await enviar('PATCH', url(ID, 'lotes'), { version: 7, valor: ['2'] });

  assert.deepEqual([ajeno.status, vacio.status, vieja.status], [400, 400, 409]);
  assert.ok(String(ajeno.body['message']).includes('no tiene el lote 9'), String(ajeno.body['message']));
  assert.deepEqual(interes(ID), TRES_LOTES);
  assert.deepEqual(guardada(ID).lotes, TRES_LOTES);
  assert.deepEqual(historialLotes(ID), []);
});

test('should_record_the_lots_history_from_the_summary_too', async () => {
  const ID = 'p-91000680';
  casoE(ID);

  const resumen = await fetch(`${base}/api/licitaciones/oportunidades/${ID}/lotes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lotes: ['2', '4'] }),
  });
  const igual = elegirLotesInteres(db, ID, { lotes: ['2', '4'], quien: 'Persona B' });
  const otra = elegirLotesInteres(db, ID, { lotes: ['2'], quien: 'Persona B' });

  assert.equal(resumen.status, 200);
  assert.equal(igual.error, null);
  assert.equal(otra.error, null);
  assert.deepEqual(
    historialLotes(ID),
    [
      [['2', '4'], 'web'],
      [['2'], 'Persona B'],
    ],
    'una fila por cambio; repetir la misma elección no deja fila',
  );
});

test('should_undo_back_to_lots_2_6_4_without_queueing', async () => {
  const ID = 'p-91000690';
  const { datos: antes } = casoE(ID);
  const quitado = await enviar('PATCH', url(ID, 'lotes'), { version: 1, valor: ['2', '4'] });
  const enCola = trabajos();

  const r = await enviar('POST', url(ID, 'deshacer'), { version: 2 });

  assert.equal(quitado.status, 200, String(quitado.body['message']));
  assert.equal(r.status, 200, String(r.body['message']));
  assert.equal(r.body['restaurada'], 1);
  const d = guardada(ID);
  assert.deepEqual(d.lotes, TRES_LOTES);
  assert.deepEqual(
    d.ofertas.map((o) => [o.lote, o.importe ?? o.unitarios[0]?.precio]),
    [
      ['2', 100],
      ['6', 101],
      ['4', 102],
    ],
    'vuelven los precios podados',
  );
  assert.deepEqual(d.equipo, antes.equipo, 'vuelve la persona del lote 6');
  assert.equal(trabajos(), enCola, 'deshacer no encola nada');
});

test('should_not_announce_a_lots_change_that_is_rolled_back', async () => {
  // Arrange: la escritura de las decisiones falla después de elegir los lotes (la BD la rechaza).
  const ID = 'p-91000700';
  casoE(ID);
  const oidos: string[] = [];
  const dejar = escuchar('*', (e) => {
    if (e.recurso === ID) oidos.push(e.tipo);
  });
  db.exec(
    `CREATE TEMP TRIGGER falla_historial BEFORE INSERT ON decisiones_historial WHEN NEW.licitacion_id = '${ID}' BEGIN SELECT RAISE(ABORT, 'disco lleno'); END`,
  );

  // Act
  let status = 0;
  try {
    const r = await fetch(url(ID, 'lotes'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, valor: ['2', '4'] }),
    });
    status = r.status;
  } finally {
    db.exec('DROP TRIGGER falla_historial');
    dejar();
  }

  // Assert
  assert.notEqual(status, 200);
  assert.deepEqual(interes(ID), TRES_LOTES, 'los lotes de interés no cambian');
  assert.deepEqual(oidos, [], 'ningún aviso de un cambio que no se guardó');
});
