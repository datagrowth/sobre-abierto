// Errores de las rutas de la Biblioteca: los conocidos devuelven su código y mensaje; un 500
// nunca devuelve el mensaje del error, que puede llevar rutas absolutas del servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';

process.env.NODE_ENV = 'test';
const { manejarError } = await import('../../src/biblioteca/rutas/errores.js');
const { ErrorBiblioteca } = await import('../../src/biblioteca/motor/notas.js');

function respuesta() {
  const r = { status: 0, cuerpo: null as unknown };
  const res = {
    status(s: number) {
      r.status = s;
      return res;
    },
    json(c: unknown) {
      r.cuerpo = c;
      return res;
    },
  };
  return { r, res: res as unknown as Response };
}

test('should_return_code_and_message_for_known_client_errors', () => {
  const { r, res } = respuesta();
  manejarError(new ErrorBiblioteca('La nota no existe.', 'not_found'), res);
  assert.deepEqual(r, { status: 404, cuerpo: { error: 'not_found', message: 'La nota no existe.' } });
});

test('should_not_leak_the_error_message_in_500_responses', () => {
  const ruta = 'C:\\Users\\alguien\\Conocimiento\\secreto.md';
  const inesperado = respuesta();
  manejarError(new Error(`ENOENT: no such file, open '${ruta}'`), inesperado.res);
  assert.equal(inesperado.r.status, 500);
  assert.equal((inesperado.r.cuerpo as { error: string }).error, 'internal_error');
  assert.ok(!JSON.stringify(inesperado.r.cuerpo).includes('alguien'));
  const conocido = respuesta();
  manejarError(new ErrorBiblioteca(`No se pudo leer ${ruta}`, 'read_error'), conocido.res);
  assert.equal(conocido.r.status, 500);
  assert.equal((conocido.r.cuerpo as { error: string }).error, 'read_error');
  assert.ok(!JSON.stringify(conocido.r.cuerpo).includes('alguien'));
});
