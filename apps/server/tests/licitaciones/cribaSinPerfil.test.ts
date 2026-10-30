// La criba sin el perfil de licitaciones (Conocimiento/Empresa/perfil-licitaciones.md): no se
// crea ningún lote ni se gasta un trabajo que Hermes acabaría sin resultado;
// Estado, Programado y «Cribar ahora» dicen qué falta. Con el perfil, se criba.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'criba-sin-perfil-'));
const conocimiento = path.join(tmp, 'conocimiento');
fs.mkdirSync(path.join(conocimiento, 'Empresa'), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = conocimiento;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { automatismos } = await import('../../src/nucleo/programado.js');
const { programarCriba, pedirCriba, estadoLicitaciones } = await import('../../src/dominios/licitaciones/index.js');
const { registrarProgramadoLicitaciones } = await import('../../src/dominios/licitaciones/programado.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { TIPO_CRIBA } = await import('../../src/dominios/licitaciones/criba.js');

iniciarNucleo();
Object.assign(nucleo().config, {
  hermesLicitaciones: { url: 'http://hermes:8642/p/licitaciones', key: 'l'.repeat(20) },
});
registrarProgramadoLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PERFIL = path.join(conocimiento, 'Empresa', 'perfil-licitaciones.md');
const trabajosCriba = () =>
  (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ?').get(TIPO_CRIBA) as { n: number }).n;
const lotesCreados = () => (dbLicitaciones().prepare('SELECT COUNT(*) AS n FROM lotes_criba').get() as { n: number }).n;
const automatismoCriba = () => automatismos().find((a) => a.id === 'licitaciones.criba');

function candidata(titulo: string): void {
  const l = licitacion({ titulo, publicada: '2026-10-01', limite: '2099-12-31T14:00:00' });
  guardarLicitacion(dbLicitaciones(), l);
  dbLicitaciones()
    .prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'candidata', 'CPV 72', 'x', 'x')",
    )
    .run(l.id);
}

test('should_not_queue_the_criba_nor_create_batches_without_the_company_profile', () => {
  candidata('Plataforma de analítica de datos');
  assert.deepEqual(programarCriba(true), []);
  assert.equal(trabajosCriba(), 0, 'no se gasta un trabajo');
  assert.equal(lotesCreados(), 0, 'las candidatas siguen sin lote, a la espera');
  fs.writeFileSync(PERFIL, '');
  assert.deepEqual(programarCriba(true), [], 'un perfil vacío tampoco sirve');
});

test('should_say_in_estado_programado_and_cribar_ahora_that_the_profile_is_missing', () => {
  fs.rmSync(PERFIL, { force: true });
  assert.match(
    String(estadoLicitaciones()['aviso_hermes']),
    /falta el perfil de licitaciones \(Conocimiento\/Empresa\/perfil-licitaciones\.md\)/,
  );
  assert.deepEqual([automatismoCriba()?.estado, automatismoCriba()?.proxima], ['parado', null]);
  assert.match(automatismoCriba()?.detalle ?? '', /falta el perfil de licitaciones/);
  const aMano = pedirCriba();
  assert.equal(aMano.error?.code, 'no_configurado', '«Cribar ahora» no dice «Criba enviada a Hermes»');
  assert.match(aMano.error?.message ?? '', /Escríbelo en la Biblioteca/);
});

test('should_queue_the_criba_once_the_company_profile_exists', () => {
  fs.writeFileSync(PERFIL, '# Perfil de licitaciones\nConsultora de datos e inteligencia artificial.\n');
  const r = pedirCriba();
  assert.equal(r.data?.lotes.length, 1);
  assert.equal(trabajosCriba(), 1);
  assert.equal(estadoLicitaciones()['aviso_hermes'], null);
  assert.equal(automatismoCriba()?.estado, 'activo');
});
