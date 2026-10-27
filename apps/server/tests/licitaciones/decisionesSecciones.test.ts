// Decisiones guardadas por sección (PATCH /oferta/decisiones/:seccion), con versión, 409 e
// historial, sobre el fixture seudonimizado de CASO_E (fixtures/comprobaciones/casoE.json) y por HTTP.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decisiones-secciones-'));
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
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
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
  oportunidad: { lotes_interes: string[] };
  guiones: { datos: unknown }[];
  decisiones: { datos: DecisionesData };
  personas: { persona_id: number; nombre: string; rol: string }[];
};
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');
const CASO_E = JSON.parse(fs.readFileSync(path.join(DIR, 'casoE.json'), 'utf8')) as Fixture;
const NOTA_CONTRARIA = 'Volumen de Señales Automáticas de Inactividad del Alumnado';
const INACTIVA = 1004;

// Las personas del fixture con id nuevo; Persona D (1004) dada de baja después de fijar el equipo.
function sembrarPersonas(): Map<number, number> {
  return new Map(
    CASO_E.personas.map((p) => {
      const nueva = crearPersona(nucleo().db, {
        nombre: p.nombre,
        tipo: 'interno',
        rol: p.rol,
        activo: p.persona_id !== INACTIVA,
      });
      return [p.persona_id, nueva.data!.id];
    }),
  );
}

// CASO_E tal como estaba: lotes 2 y 4, el guion v4 y las decisiones de las 14:48 (precio pendiente: el fixture no lleva importes).
function casoE(id: string): DecisionesData {
  const ids = sembrarPersonas();
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
  const interes = JSON.stringify(CASO_E.oportunidad.lotes_interes.map((x) => ({ id: x, motivo: 'criba' })));
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes, ts, ts);
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
    equipo: d.equipo.map((m) => ({ ...m, persona_id: ids.get(m.persona_id)! })),
    ofertas: d.ofertas.map((o) => ({ ...o, pendiente: true, importe: null })),
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guion,
    JSON.stringify(datos),
    ts,
  );
  return datos;
}

const url = (id: string, seccion?: string) =>
  `${base}/api/licitaciones/licitaciones/${id}/oferta/decisiones${seccion ? `/${seccion}` : ''}`;
type Respuesta = { status: number; body: Record<string, unknown> };
async function enviar(
  metodo: 'PATCH' | 'PUT',
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
  db.prepare('SELECT version, datos FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as {
    version: number;
    datos: string;
  };
type FilaHistorial = { version: number; secciones: string; autor: string };
const historial = (id: string) =>
  db
    .prepare('SELECT version, secciones, autor FROM decisiones_historial WHERE licitacion_id = ? ORDER BY version')
    .all(id) as FilaHistorial[];

// Precios por alumno de prueba (no son los ofertados): con una sola línea de precio unitario, el importe pasa a esa línea.
const PRECIOS = [
  { lote: '2', pendiente: false, importe: 100, unitarios: [] },
  { lote: '4', pendiente: false, importe: 40, unitarios: [] },
];
const precioDe = (o: DecisionesData['ofertas'][number]) => o.importe ?? o.unitarios[0]?.precio ?? null;

test('should_save_the_price_when_the_team_has_an_inactive_person', async () => {
  const ID = 'p-91000540';
  const antes = casoE(ID);

  const r = await enviar('PATCH', url(ID, 'precio'), { version: 1, valor: PRECIOS }, de('Persona A'));

  assert.equal(r.status, 200, String(r.body['message']));
  assert.equal(r.body['version'], 2);
  const datos = JSON.parse(guardada(ID).datos) as DecisionesData;
  assert.deepEqual(
    datos.ofertas.map((o) => [o.lote, precioDe(o), o.pendiente]),
    [
      ['2', 100, false],
      ['4', 40, false],
    ],
  );
  assert.deepEqual(datos.equipo, antes.equipo, 'el equipo no se toca');
  const otras = r.body['problemas_otras'] as string[];
  assert.ok(
    otras.some((p) => p.includes('inactivo')),
    'la persona de baja sale como problema del equipo, no como 400',
  );
  const entero = await enviar('PUT', url(ID), { ...datos });
  assert.equal(entero.status, 400, 'el PUT entero sigue sin poder guardarse');
});

test('should_explain_a_section_validation_error_in_spanish_for_people', async () => {
  // Arrange
  const ID = 'p-91000610';
  const antes = casoE(ID);
  const equipo = antes.equipo.map((m, i) => (i === 0 ? { ...m, rol_en_la_oferta: undefined } : m));

  // Act
  const r = await enviar('PATCH', url(ID, 'equipo'), { version: 1, valor: equipo });
  const lotes = await enviar('PATCH', url(ID, 'lotes'), { version: 1, valor: 'dos' });

  // Assert: la sección y la fila, no «valor» ni el texto de zod.
  assert.equal(r.status, 400);
  assert.equal(r.body['message'], 'Equipo, fila 1, rol en la oferta: falta.');
  assert.equal(lotes.status, 400);
  assert.equal(lotes.body['message'], 'Lotes: tiene que ser una lista.');
  assert.equal(guardada(ID).version, 1, 'no se escribió');
});

test('should_return_409_when_the_version_is_stale_and_not_write', async () => {
  const ID = 'p-91000550';
  casoE(ID);

  const primero = await enviar('PATCH', url(ID, 'precio'), { version: 1, valor: PRECIOS });
  const segundo = await enviar('PATCH', url(ID, 'herramientas'), { version: 1, valor: ['Aula Abierta 4.x'] });

  assert.equal(primero.status, 200);
  assert.equal(segundo.status, 409);
  assert.equal(
    segundo.body['message'],
    'Otra persona guardó decisiones distintas mientras editabas: recarga para ver las suyas.',
  );
  const g = guardada(ID);
  assert.equal(g.version, 2);
  assert.notDeepEqual((JSON.parse(g.datos) as DecisionesData).herramientas, ['Aula Abierta 4.x'], 'no se escribió');
  assert.equal(historial(ID).length, 1);
  const leida = (await (await fetch(url(ID))).json()) as { version: number };
  assert.equal(leida.version, 2, 'el GET da la versión con la que volver a guardar');
  assert.equal(
    (await enviar('PATCH', url(ID, 'herramientas'), { version: 2, valor: ['Aula Abierta 4.x'] })).status,
    200,
  );
});

test('should_reject_taking_a_criterion_whose_note_says_we_do_not', async () => {
  const ID = 'p-91000560';
  const antes = casoE(ID);
  const esperado = `No puedes acogerte a «${NOTA_CONTRARIA}»: tu nota dice que no nos acogemos. Desmárcalo o cambia la nota.`;

  const r = await enviar('PATCH', url(ID, 'automaticos'), { version: 1, valor: antes.automaticos });
  const tras400 = guardada(ID).version;
  const desmarcados = antes.automaticos.map((a) =>
    a.nota?.startsWith('No nos acogemos') ? { ...a, nos_acogemos: false, tramo: null } : a,
  );
  const corregido = await enviar('PATCH', url(ID, 'automaticos'), { version: 1, valor: desmarcados });

  assert.equal(r.status, 400);
  assert.ok(String(r.body['message']).includes(esperado), String(r.body['message']));
  assert.ok(
    !String(corregido.body['message'] ?? '').includes('tu nota dice que no'),
    'desmarcados, ya no se quejan de la nota',
  );
  assert.equal(tras400, 1, 'nada guardado con el 400');
  const entero = await enviar('PUT', url(ID), { ...antes, equipo: [] });
  assert.ok(String(entero.body['message']).includes(esperado), 'el PUT entero también los rechaza');
});

test('should_write_one_history_row_per_save_with_the_changed_section', async () => {
  const ID = 'p-91000570';
  casoE(ID);
  const SIMPLE = 'p-91000580';
  guardarLicitacion(db, {
    ...licitacion({ titulo: 'Contrato sin lotes', publicada: '2026-09-01', limite: '2099-01-01T10:00:00' }),
    id: SIMPLE,
    atom_id: `atom-${SIMPLE}`,
  });
  db.prepare(
    "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'oferta-licitaciones', 1, ?)",
  ).run(
    SIMPLE,
    JSON.stringify({ ...(CASO_E.guiones.at(-1)!.datos as object), automaticos: [], lotes: [] }),
    new Date().toISOString(),
  );
  const decision = {
    lotes: [],
    equipo: [],
    automaticos: [],
    herramientas: ['Aula Abierta'],
    enfoque: 'Formación práctica.',
    ofertas: [{ lote: null, pendiente: true }],
  };

  await enviar('PATCH', url(ID, 'precio'), { version: 1, valor: PRECIOS }, de('Persona A'));
  await enviar('PATCH', url(ID, 'enfoque'), { version: 2, valor: 'Dos partes, una por lote.' });
  const nuevo = await enviar('PUT', url(SIMPLE), decision);
  const cambio = await enviar('PUT', url(SIMPLE), { ...decision, herramientas: ['Aula Abierta', 'Teams'] });

  assert.deepEqual(
    historial(ID).map((h) => [h.version, JSON.parse(h.secciones), h.autor]),
    [
      [2, ['precio'], 'Persona A'],
      [3, ['enfoque'], 'web'],
    ],
  );
  assert.equal(nuevo.status, 200, String(nuevo.body['message']));
  assert.deepEqual([nuevo.body['version'], cambio.body['version']], [1, 2]);
  assert.deepEqual(
    historial(SIMPLE).map((h) => [h.version, JSON.parse(h.secciones)]),
    [
      [1, ['lotes', 'equipo', 'automaticos', 'herramientas', 'enfoque', 'precio', 'datos_anexo', 'a_incorporar']],
      [2, ['herramientas']],
    ],
  );
});

test('should_report_other_sections_problems_without_failing', async () => {
  const ID = 'p-91000590';
  casoE(ID);

  const r = await enviar('PATCH', url(ID, 'herramientas'), {
    version: 1,
    valor: ['Aula Abierta 4.x', 'Microsoft Teams'],
  });
  const desconocida = await enviar('PATCH', url(ID, 'firma'), { version: 2, valor: [] });
  const sinValor = await enviar('PATCH', url(ID, 'equipo'), { version: 2 });

  assert.equal(r.status, 200);
  const otras = r.body['problemas_otras'] as string[];
  assert.ok(
    otras.some((p) => p.includes('inactivo')),
    'equipo',
  );
  assert.ok(
    otras.some((p) => p.includes('tu nota dice que no nos acogemos')),
    'automáticos',
  );
  assert.deepEqual((r.body['datos'] as DecisionesData).herramientas, ['Aula Abierta 4.x', 'Microsoft Teams']);
  assert.equal(desconocida.status, 400);
  assert.equal(sinValor.status, 400, 'sin «valor» no se vacía la sección');
  assert.equal(guardada(ID).version, 2);
});

test('should_show_in_the_comprobaciones_what_a_single_section_left_undecided', async () => {
  // Arrange: guion sin decisiones; solo se guarda el precio.
  const ID = 'p-91000600';
  casoE(ID);
  db.prepare('DELETE FROM decisiones_oferta WHERE licitacion_id = ?').run(ID);

  // Act
  const r = await enviar('PATCH', url(ID, 'precio'), { version: 1, valor: PRECIOS });
  const c = comprobacionesDe(db, nucleo().db, ID).data!;

  // Assert
  assert.equal(r.status, 200, String(r.body['message']));
  assert.ok((r.body['problemas_otras'] as string[]).some((p) => /^Falta decidir \d+ criterios? automáticos?:/.test(p)));
  const fila = c.bloqueos.find((b) => b.clave === 'decisiones_incompletas:-');
  assert.equal(fila?.gravedad, 'impide');
  assert.match(fila?.titulo ?? '', /^Decisiones incompletas: Falta decidir \d+ criterios? automáticos?:/);
  assert.notEqual(c.fases.find((f) => f.nombre === 'decisiones')?.estado, 'hecho');
});

test('should_save_the_annex_data_section_and_drop_its_comprobaciones_row', async () => {
  // Arrange: CASO_E lleva IGIC aparte, así que las comprobaciones piden decidir el impuesto.
  const ID = 'p-91000620';
  casoE(ID);
  const antes = comprobacionesDe(db, nucleo().db, ID).data!;
  const valor = { subcontratacion_servidores: null, orden_lotes: null, impuesto: { tipo: 'IGIC', porcentaje: 3 } };

  // Act
  const r = await enviar('PATCH', url(ID, 'datos_anexo'), { version: 1, valor });
  const despues = comprobacionesDe(db, nucleo().db, ID).data!;

  // Assert
  assert.equal(r.status, 200, String(r.body['message']));
  assert.equal(
    antes.bloqueos.some((b) => b.clave === 'dato_anexo:-:impuesto'),
    true,
  );
  assert.equal(
    despues.bloqueos.some((b) => b.clave === 'dato_anexo:-:impuesto'),
    false,
  );
  assert.deepEqual((JSON.parse(guardada(ID).datos) as DecisionesData).datos_anexo, valor);
  assert.deepEqual(
    historial(ID).map((h) => [h.version, JSON.parse(h.secciones)]),
    [[2, ['datos_anexo']]],
  );
});

test('should_reject_a_malformed_annex_data_section_without_writing', async () => {
  // Arrange
  const ID = 'p-91000630';
  casoE(ID);

  // Act
  const r = await enviar('PATCH', url(ID, 'datos_anexo'), {
    version: 1,
    valor: { impuesto: { tipo: 'IRPF', porcentaje: 3 } },
  });

  // Assert
  assert.equal(r.status, 400);
  assert.equal(guardada(ID).version, 1);
});

test('should_prune_the_lot_order_when_a_lot_is_removed', async () => {
  // Arrange: orden decidido con los dos lotes de CASO_E.
  const ID = 'p-91000640';
  casoE(ID);
  const orden = await enviar('PATCH', url(ID, 'datos_anexo'), {
    version: 1,
    valor: { subcontratacion_servidores: null, orden_lotes: ['4', '2'], impuesto: null },
  });
  assert.equal(orden.status, 200, String(orden.body['message']));

  // Act
  const r = await enviar('PATCH', url(ID, 'lotes'), { version: 2, valor: ['2'] });

  // Assert
  assert.equal(r.status, 200, String(r.body['message']));
  assert.deepEqual((JSON.parse(guardada(ID).datos) as DecisionesData).datos_anexo?.orden_lotes, ['2']);
});
