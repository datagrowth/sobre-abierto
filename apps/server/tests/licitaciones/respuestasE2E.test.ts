// Datos del banco Playwright de la web (scripts/respuestasE2E.ts): un mapa de respuestas por oferta
// de los fixtures de las comprobaciones, calculado por las rutas de siempre, y nada escrito si una respuesta
// lleva un NIF de persona, un correo o un teléfono.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'respuestas-e2e-test-'));
const { escribirMapas, generarRespuestas, prepararEntorno } = await import('../../scripts/respuestasE2E.js');
prepararEntorno(tmp);
process.env.NODE_ENV = 'test';
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

type Respuesta = { status: number; body: unknown };
const OFERTAS = ['casoE', 'casoB', 'casoF', 'casoD', 'casoC'];

test('should_write_one_response_map_per_fixture_with_comprobaciones_and_mesa', async () => {
  // Arrange
  const salida = path.join(tmp, 'datos');

  // Act
  const mapas = await generarRespuestas();
  assert.equal(mapas.error, null, mapas.error?.message);
  const escritos = escribirMapas(salida, mapas.data!);

  // Assert
  assert.equal(escritos.error, null, escritos.error?.message);
  for (const oferta of OFERTAS) {
    const mapa = JSON.parse(fs.readFileSync(path.join(salida, `${oferta}.json`), 'utf8')) as Record<string, Respuesta>;
    const comprobaciones = Object.entries(mapa).find(([ruta]) =>
      /^GET \/api\/licitaciones\/licitaciones\/[^/]+\/comprobaciones$/.test(ruta),
    )?.[1];
    assert.equal(comprobaciones?.status, 200, `${oferta}: /comprobaciones`);
    assert.ok((comprobaciones.body as { veredicto?: { tipo?: string } }).veredicto?.tipo, `${oferta}: veredicto`);
    assert.equal(mapa['GET /api/licitaciones/mesa']?.status, 200, `${oferta}: /mesa`);
  }
  assert.ok(fs.existsSync(path.join(salida, 'casoE.impacto.precio-lote-2.json')));
  assert.ok(fs.existsSync(path.join(salida, 'casoE.impacto.quitar-lote-6.json')));
});

const PERSONALES = [
  ['NIF', '87654321X', 'DNI'],
  ['NIF', 'Y1234567X', 'NIE'],
  ['correo', 'persona@ejemplo.es', 'correo'],
  ['teléfono', '+34 928 123 456', 'teléfono'],
] as const;
for (const [tipo, valor, caso] of PERSONALES) {
  test(`should_fail_when_a_response_contains_a_nif_email_or_phone (${caso})`, () => {
    // Arrange
    const salida = path.join(tmp, `con-${caso}`);
    const mapas = {
      limpio: { 'GET /api/x': { status: 200, body: { nif: 'A00378067', representante: '12345678Z' } } },
      sucio: { 'GET /api/licitaciones/licitaciones/p-1/equipo': { status: 200, body: { dato: valor } } },
    };

    // Act
    const r = escribirMapas(salida, mapas);

    // Assert: no escribe ninguno, dice dónde y de qué tipo, pero no repite el dato.
    assert.equal(r.error?.code, 'datos_personales');
    assert.match(r.error!.message, new RegExp(`sucio GET /api/licitaciones/licitaciones/p-1/equipo: ${tipo}`));
    assert.ok(!r.error!.message.includes(valor));
    assert.equal(fs.existsSync(salida), false);
  });
}

test('should_write_maps_with_public_cifs_and_the_fictitious_nif', () => {
  // Arrange
  const salida = path.join(tmp, 'limpio');
  const mapas = {
    casoE: {
      'GET /api/x': {
        status: 200,
        body: { organo: 'A00378067', representante: '12345678Z', importe: 29688.75, fecha: '2026-10-15T08:00:00' },
      },
    },
  };

  // Act
  const r = escribirMapas(salida, mapas);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    r.data!.map((f) => path.basename(f)),
    ['casoE.json'],
  );
});
