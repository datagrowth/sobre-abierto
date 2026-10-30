// Diff de la propuesta de Hermes por campo sobre CASO_D (fixtures/cambios y fixtures/comprobaciones, licitación
// inventada): lo guardado decía «desde la puesta en marcha» y
// la propuesta «a contar desde el 28 de diciembre de 2027». Se aplica ese campo solo, por HTTP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-propuesta-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { decisionesDe } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { claveAutomatico, diffPropuesta } = await import('../../src/dominios/licitaciones/oferta/diffPropuesta.js');
const { comoDecisiones } = await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
const express = (await import('express')).default;

type CampoDiff = ReturnType<typeof diffPropuesta>[number];
type PropuestaGuardada = Parameters<typeof diffPropuesta>[1];
type DecisionesData = NonNullable<Parameters<typeof diffPropuesta>[0]>;
type GuionBaseData = Parameters<typeof diffPropuesta>[2];

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cambios');
const o4 = JSON.parse(fs.readFileSync(path.join(DIR, 'casoD-propuesta.json'), 'utf8')) as {
  decisiones: { datos: DecisionesData };
  propuesta: Omit<PropuestaGuardada, 'decisiones'>;
};
const comprobaciones = leerFixtureComprobaciones('casoD');
const guion = comprobaciones.guiones.find((g) => g.id === o4.propuesta.guion_id)!.datos as unknown as GuionBaseData;
const propuesta: PropuestaGuardada = { ...o4.propuesta, decisiones: comoDecisiones(o4.propuesta.datos) };
const SOPORTE = claveAutomatico('Mantenimiento adicional del campus virtual', null);

iniciarNucleo();
const db = dbLicitaciones();
sembrarFixture(db, nucleo().db, comprobaciones);
const ID = comprobaciones.id;
const app = express();
app.use(express.json());
app.use(comoPersona);
app.use('/api/licitaciones', rutasLicitaciones());
const server = escucharLocal(http.createServer(app));
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones/licitaciones/${ID}/oferta/decisiones/propuesta`;
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Respuesta = { status: number; body: Record<string, unknown> };
async function pedir(ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}): Promise<Respuesta> {
  const res = await fetch(
    `${base}/${ruta}`,
    cuerpo === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(cuerpo) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const guardadas = () => decisionesDe(db, ID)!;
const soporteGuardado = () =>
  guardadas().datos.automaticos.find((a) => claveAutomatico(a.criterio, a.lote) === SOPORTE)!;
let ultimaRespuesta: Record<string, unknown> = {};
const sinAutomaticos = (d: DecisionesData) => ({ ...d, automaticos: undefined });

test('should_show_the_casoD_term_change_from_puesta_en_marcha_to_28_december_as_one_field', () => {
  const campos = diffPropuesta(o4.decisiones.datos, propuesta, guion);

  const conCambio = campos.filter(
    (c) =>
      /puesta en marcha/.test(JSON.stringify(c.guardado)) &&
      /28 de diciembre de 2027/.test(JSON.stringify(c.propuesto)),
  );
  assert.deepEqual(
    conCambio.map((c) => [c.campo, c.seccion, c.igual]),
    [[SOPORTE, 'automaticos', false]],
  );
});

test('should_match_criteria_with_a_code_prefix_as_the_same_field', () => {
  const campos = diffPropuesta(o4.decisiones.datos, propuesta, guion);

  const soporte = campos.find((c) => c.campo === SOPORTE)!;
  assert.match((soporte.guardado as { criterio: string }).criterio, /^2B1\. – Mantenimiento adicional/);
  assert.equal(campos.filter((c) => c.seccion === 'automaticos').length, propuesta.datos.automaticos.length);
});

test('should_never_include_price_in_the_diff', () => {
  const campos = diffPropuesta(o4.decisiones.datos, propuesta, guion);

  assert.deepEqual(
    campos.filter((c: CampoDiff) => /precio|ofertas/.test(c.campo) || /"importe"|"unitarios"/.test(JSON.stringify(c))),
    [],
  );
  assert.deepEqual([...new Set(campos.map((c) => c.seccion))].sort(), [
    'automaticos',
    'enfoque',
    'equipo',
    'herramientas',
    'lotes',
  ]);
});

test('should_mark_everything_as_new_when_nothing_is_saved', () => {
  const campos = diffPropuesta(null, propuesta, guion);

  assert.equal(
    campos.some((c) => c.igual),
    false,
  );
  assert.equal(campos.find((c) => c.campo === 'lotes')?.guardado, null);
});

test('should_list_the_casoD_term_change_by_http', async () => {
  const r = await pedir('diff');

  assert.equal(r.status, 200);
  assert.equal(r.body['guion_version'], 3);
  assert.equal(r.body['propuesta_creada_en'], propuesta.creada_en);
  assert.equal((r.body['campos'] as CampoDiff[]).find((c) => c.campo === SOPORTE)?.igual, false);
});

test('should_apply_one_field_without_touching_the_others', async () => {
  const antes = guardadas();

  const r = await pedir('aplicar', { campos: [SOPORTE] }, de('Elisa'));
  ultimaRespuesta = r.body;

  assert.equal(r.status, 200, JSON.stringify(r.body));
  const despues = guardadas();
  assert.equal(despues.version, antes.version + 1);
  assert.equal(r.body['version'], despues.version);
  assert.deepEqual(sinAutomaticos(despues.datos), sinAutomaticos(antes.datos));
  const otros = (d: DecisionesData) =>
    d.automaticos.filter((a) => criterioDeLote2(a.criterio) && claveAutomatico(a.criterio, a.lote) !== SOPORTE);
  assert.deepEqual(otros(despues.datos), otros(antes.datos));
  assert.match(String(soporteGuardado().motivo_hermes), /a contar desde el 28 de diciembre de 2027/);
  const tras = await pedir('diff');
  assert.equal((tras.body['campos'] as CampoDiff[]).find((c) => c.campo === SOPORTE)?.igual, true);
});

// Los del lote 2 son los del guion vigente; los del lote 1 eran de un guion anterior.
function criterioDeLote2(criterio: string): boolean {
  return /mantenimiento adicional|itinerarios de autoformación|sesiones de formación/i.test(criterio);
}

test('should_drop_criteria_from_an_older_outline_and_say_so', () => {
  const avisos = ultimaRespuesta['avisos'] as string[];

  assert.equal(
    guardadas().datos.automaticos.every((a) => criterioDeLote2(a.criterio)),
    true,
  );
  assert.ok(
    avisos.some((a) =>
      /^Se quitan 3 criterios que ya no están en el guion vigente \(v3\): «2B1\.- Personalización/.test(a),
    ),
    avisos.join(' | '),
  );
});

test('should_record_hermes_as_proposer_and_the_person_as_applier', () => {
  const origen = soporteGuardado().origen!;

  assert.equal(origen.propuesto_por, 'hermes');
  assert.equal(origen.aplicado_por, 'Elisa');
  assert.ok(Date.parse(origen.en) > 0);
});

test('should_keep_the_person_note_separate_from_hermes_reason', () => {
  const s = soporteGuardado();

  assert.equal(s.nota, 'Ocho meses de mantenimiento desde la puesta en marcha');
  assert.match(String(s.motivo_hermes), /Tramo máximo de 16 puntos/);
});

test('should_record_origin_on_each_applied_team_member', async () => {
  const campo = (await pedir('diff')).body['campos'] as CampoDiff[];
  const persona = campo.find((c) => c.seccion === 'equipo' && !c.igual)!;

  const r = await pedir('aplicar', { campos: [persona.campo] });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = Number(persona.campo.split(':')[1]);
  const m = guardadas().datos.equipo.find((x) => x.persona_id === id)!;
  assert.equal(m.rol_en_la_oferta, (persona.propuesto as { rol_en_la_oferta: string }).rol_en_la_oferta);
  assert.equal(m.origen?.aplicado_por, 'web');
  assert.equal(m.motivo_hermes, persona.motivo_hermes);
});

test('should_reject_a_field_the_proposal_does_not_have', async () => {
  const antes = guardadas().version;

  const r = await pedir('aplicar', { campos: ['automatico:no existe|'] });

  assert.equal(r.status, 400);
  assert.match(String(r.body['message']), /no tiene el campo «automatico:no existe\|»/);
  assert.equal(guardadas().version, antes);
});

test('should_reject_an_empty_list_of_fields', async () => {
  const r = await pedir('aplicar', { campos: [] });

  assert.equal(r.status, 400);
});

test('should_apply_an_accreditation_field_only_on_its_own', async () => {
  const g = structuredClone(guion);
  g.automaticos[0]!.tipo = 'acreditacion';
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(g), propuesta.guion_id);
  const antes = guardadas().version;

  const r = await pedir('aplicar', { campos: [SOPORTE, 'herramientas'] });

  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(guion), propuesta.guion_id);
  assert.equal(r.status, 400);
  assert.match(String(r.body['message']), /se aplica de uno en uno/);
  assert.equal(guardadas().version, antes);
});

test('should_reject_applying_a_proposal_made_with_an_older_outline', async () => {
  const g = comprobaciones.guiones.find((x) => x.id === propuesta.guion_id)!;
  db.prepare(
    'INSERT INTO guiones (id, licitacion_id, version, ficha_id, datos, agente, version_prompt, creado_en) SELECT 99, licitacion_id, 4, ficha_id, datos, agente, version_prompt, ? FROM guiones WHERE id = ?',
  ).run(new Date().toISOString(), g.id);
  const antes = guardadas().version;

  const r = await pedir('aplicar', { campos: [SOPORTE] });

  assert.equal(r.status, 400);
  assert.equal(r.body['message'], 'La propuesta es del guion v3 y el vigente es el v4: espera a la nueva.');
  assert.equal(guardadas().version, antes);
});
