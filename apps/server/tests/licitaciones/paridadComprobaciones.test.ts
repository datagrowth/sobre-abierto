// Comprobaciones = MCP = «Hoy»: la fila de elegibilidad que «ya nos dejó fuera N veces» se dice
// igual en las comprobaciones, en licitaciones_oferta (Hermes) y en lo que falta de «Hoy». Sobre CASO_F
// (fixtures/comprobaciones/casoF.json, seudonimizada), descartada por la experiencia del director, y otra
// licitación que pidió lo mismo y también dejó fuera a la empresa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paridad-comprobaciones-'));
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
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { anotarDescarte } = await import('../../src/dominios/licitaciones/gonogo.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { ofertaParaAgente } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
const CASO_F = leerFixtureComprobaciones('casoF');
const AHORA = Date.parse(CASO_F.ahora);
const CLAVE_FILA = 'medios:-:auditoria_de_accesibilidad_web_o_evaluacion_de_usabilidad';
const FUERA = 'Esta barrera ya nos dejó fuera 2 veces';

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const descartar = (id: string, motivo: string) =>
  anotarDescarte(db, id, {
    accion: 'descartada',
    categoria: 'solvencia',
    motivo,
    automatico: false,
    quien: 'Persona A',
    ts: '2026-09-25T10:00:00Z',
  });

function fichaAprobada(id: string, descripcion: string): void {
  const requisitos = [
    {
      tipo: 'medios_personales',
      descripcion,
      valor_exigido: '1 perfil',
      excluyente: true,
      cumple: 'no',
      justificacion: 'Prueba.',
    },
  ];
  const datos = {
    resumen: 'Ficha de prueba.',
    requisitos,
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Prueba.' },
  };
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', 'x', 'x', 'x')",
  ).run(id, JSON.stringify(datos));
}

sembrarFixture(db, nucleo().db, CASO_F);
descartar(CASO_F.id, CASO_F.oportunidad.motivo_descarte ?? '');
const otra = licitacion({
  titulo: 'Observatorio de accesibilidad',
  publicada: '2026-09-21',
  presupuesto: 80_000,
  limite: '2026-10-21T10:00:00',
});
guardarLicitacion(db, otra);
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'descartada', 'CPV 79', ?, 'x')",
).run(otra.id, '2026-09-21T10:00:00Z');
fichaAprobada(
  otra.id,
  'Director con 5 años de experiencia en auditoría de accesibilidad web o evaluación de usabilidad.',
);

test('should_say_the_times_left_out_in_the_mcp_like_in_the_comprobaciones', () => {
  // Arrange
  const comprobaciones = comprobacionesDe(db, nucleo().db, CASO_F.id, AHORA);
  const enComprobaciones = comprobaciones.data!.bloqueos.find((b) => b.clave === CLAVE_FILA);
  assert.ok(enComprobaciones?.titulo.endsWith(FUERA), enComprobaciones?.titulo);

  // Act
  const r = ofertaParaAgente(db, nucleo().db, { id: CASO_F.id, secciones: ['bloqueos'] }, true, AHORA);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  const bloqueos = r.data!['bloqueos'] as { clave: string; titulo: string }[];
  assert.equal(bloqueos.find((b) => b.clave === CLAVE_FILA)?.titulo, enComprobaciones?.titulo);
});

test('should_say_the_times_left_out_in_what_today_lists_as_missing', () => {
  // Act
  const falta = faltaDePreparacion(db, CASO_F.id, AHORA);

  // Assert
  assert.ok(
    falta.some((f) => f.includes(FUERA)),
    JSON.stringify(falta),
  );
});
