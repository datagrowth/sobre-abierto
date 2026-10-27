import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoAnotacion, semanasDelInforme, textoFalta, VEREDICTOS } from './coberturaFormato.js';

test('should_say_what_the_aggregate_misses', () => {
  assert.equal(textoFalta(0.125), '12,5 %');
  assert.equal(textoFalta(null), '—');
  assert.equal(VEREDICTOS.anadir_fuente.tono, 'impide');
});

test('should_list_the_counted_weeks_latest_first', () => {
  const informe = {
    comunidades: [
      { semanas: [{ semana: '2026-10-05' }, { semana: '2026-10-12' }] },
      { semanas: [{ semana: '2026-10-12' }] },
    ],
  };
  assert.deepEqual(semanasDelInforme(informe), ['2026-10-12', '2026-10-05']);
  assert.deepEqual(semanasDelInforme(null), []);
});

test('should_validate_the_note_before_sending_it', () => {
  const bien = { semana: '2026-10-12', comunidad: 'ES51', publicadas: '14', fuente: ' Dades obertes ' };
  assert.deepEqual(cuerpoAnotacion(bien).data, {
    semana: '2026-10-12',
    comunidad: 'ES51',
    publicadas: 14,
    fuente: 'Dades obertes',
  });
  assert.equal(cuerpoAnotacion({ ...bien, semana: '' }).error, 'Elige la semana.');
  assert.equal(cuerpoAnotacion({ ...bien, comunidad: '' }).error, 'Elige la comunidad.');
  assert.equal(
    cuerpoAnotacion({ ...bien, publicadas: '1,5' }).error,
    'Escribe cuántas publicó la plataforma esa semana.',
  );
  assert.equal(cuerpoAnotacion({ ...bien, publicadas: '' }).error, 'Escribe cuántas publicó la plataforma esa semana.');
  assert.equal(
    cuerpoAnotacion({ ...bien, fuente: 'x' }).error,
    'Di de dónde sale la cifra (el portal de datos abiertos).',
  );
  assert.equal(cuerpoAnotacion({ ...bien, publicadas: '0' }).data.publicadas, 0, 'cero también es una cifra');
});
