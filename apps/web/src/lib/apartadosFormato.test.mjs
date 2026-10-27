import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoApartado, indicacionesDeFugas, motivosPrecargados } from './apartadosFormato.js';

// Una fuga de ejemplo (seudonimizada): un eco del criterio de asistencia remota del Sobre C.
const FUGA = {
  apartado: 2,
  tipo: 'eco',
  archivo: 'Sobre “C” - Criterios cuantificables mediante fórmulas',
  cita: 'Persona K accederá a lo imprescindible para resolver el problema de acceso, sin pedir contraseñas.',
};
const apartado = (n, estado = 'recibido', extra = {}) => ({
  apartado: n,
  titulo: `Apartado ${n}`,
  estado,
  rechazos: 0,
  error: null,
  ...extra,
});
const casoFuga = (extra = {}) => ({
  version: 2,
  apartados: [apartado(1), apartado(2), apartado(3)],
  fugas: { hallazgos: [FUGA], anulada: null },
  mejorable: [],
  ...extra,
});

test('should_preselect_sections_with_leaks_failed_or_weak', () => {
  // Arrange
  const m = casoFuga({
    apartados: [apartado(1), apartado(2), apartado(3), apartado(4, 'fallido')],
    mejorable: [3, 2, 9],
  });

  // Act
  const marcados = motivosPrecargados(m);

  // Assert
  assert.deepEqual(marcados, [2, 3, 4], 'la fuga, el flojo y el fallido, sin repetir ni apartados que no existen');
  assert.deepEqual(motivosPrecargados(casoFuga()), [2], 'Villaejemplo: solo el apartado de la fuga');
  assert.deepEqual(motivosPrecargados(casoFuga({ fugas: undefined })), [], 'sin motivos no marca nada');
  assert.deepEqual(motivosPrecargados(null), []);
});

test('should_put_each_leak_quote_in_the_instructions', () => {
  // Arrange
  const otra = { apartado: 3, tipo: 'importe', archivo: 'Oferta económica', cita: 'un coste de 300 € por alumna' };

  // Act
  const indicaciones = indicacionesDeFugas(casoFuga({ fugas: { hallazgos: [FUGA, otra], anulada: null } }));

  // Assert
  assert.equal(
    indicaciones,
    [
      `Apartado 2: quita «${FUGA.cita}» (fuga del Sobre C).`,
      'Apartado 3: quita «un coste de 300 € por alumna» (fuga hacia «Oferta económica»).',
    ].join('\n'),
  );
  assert.equal(indicacionesDeFugas(casoFuga({ fugas: { hallazgos: [], anulada: null } })), '');
});

test('should_render_a_normal_rejection_as_a_retry_round_not_an_error', () => {
  // Arrange
  const error =
    'El apartado se queda en 0,6 páginas de las 3 de su cuota. Corrige y vuelve a enviar el apartado entero.';

  // Act
  const rechazado = estadoApartado(apartado(2, 'pendiente', { rechazos: 1, error }));
  const fallido = estadoApartado(apartado(2, 'fallido', { rechazos: 3, error }));

  // Assert
  assert.deepEqual(rechazado, {
    texto: 'ronda 2 · reintentando',
    tono: 'neutro',
    detalle: 'El apartado se queda en 0,6 páginas de las 3 de su cuota.',
  });
  assert.equal(fallido.texto, 'fallido');
  assert.equal(fallido.tono, 'peligro');
  assert.ok(!fallido.detalle.includes('Corrige y vuelve a enviar'));
  assert.equal(estadoApartado(apartado(2)), null, 'recibido: lo pinta el chip de siempre');
  assert.equal(estadoApartado(apartado(2, 'pendiente')), null, 'pendiente sin rechazos');
});
