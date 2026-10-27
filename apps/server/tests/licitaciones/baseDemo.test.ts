// Base demo para la medición con persona (scripts/baseDemo.ts): nueva, con las 5 ofertas
// seudonimizadas y sin escribir nunca en una ruta de la base real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'base-demo-test-'));
process.env.NODE_ENV = 'test';
const { crearBaseDemo, validarDestino } = await import('../../scripts/baseDemo.js');
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('should_refuse_a_destination_inside_the_real_data_volume', () => {
  const r = validarDestino('/opt/data/demo');
  assert.equal(r.error?.code, 'destino_prohibido');
});

test('should_refuse_a_relative_destination_that_resolves_inside_the_real_data_volume', () => {
  // Arrange: «data/demo» lanzado desde /opt y «/opt/x/../data/demo» acaban en /opt/data/demo.
  const relativa = path.relative(process.cwd(), path.resolve('/opt/data/demo-nueva'));
  const conPuntos = '/opt/x/../data/demo';

  // Act
  const r = [validarDestino(relativa), validarDestino(conPuntos), validarDestino('/data')];

  // Assert
  assert.deepEqual(
    r.map((x) => x.error?.code),
    ['destino_prohibido', 'destino_prohibido', 'destino_prohibido'],
  );
});

test('should_accept_a_new_folder_whose_name_only_starts_like_the_real_one', () => {
  assert.equal(validarDestino('/opt/database-demo').error, null, '/opt/database no es /opt/data');
});

test('should_refuse_a_destination_that_already_has_files', () => {
  const ocupado = path.join(tmp, 'ocupado');
  fs.mkdirSync(ocupado);
  fs.writeFileSync(path.join(ocupado, 'algo.txt'), 'x');
  assert.equal(validarDestino(ocupado).error?.code, 'destino_ocupado');
});

test('should_seed_the_five_offers_in_a_new_base_and_point_the_environment_at_it', async () => {
  const destino = path.join(tmp, 'nueva');

  const r = await crearBaseDemo(destino);

  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data?.ofertas, ['casoE', 'casoB', 'casoF', 'casoD', 'casoC']);
  assert.ok((r.data?.entorno.PLATAFORMA_DATA_DIR ?? '').startsWith(path.resolve(destino)));
  const archivos = fs.readdirSync(path.join(destino, 'datos'));
  assert.ok(archivos.length > 0, 'hay base en disco');
});

test('should_not_overwrite_a_base_that_was_just_created', async () => {
  const r = await crearBaseDemo(path.join(tmp, 'nueva'));
  assert.equal(r.error?.code, 'destino_ocupado');
});
