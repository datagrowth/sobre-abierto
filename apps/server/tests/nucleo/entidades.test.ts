// Entidades HTML que llegan codificadas dos veces en los títulos de la PLACSP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodificarEntidades } from '../../src/nucleo/entidades.js';

test('should_decode_double_encoded_entities_in_titles', () => {
  assert.equal(
    decodificarEntidades('Servicios&nbsp;de Inteligencia Artificial'),
    'Servicios de Inteligencia Artificial',
  );
  assert.equal(decodificarEntidades('IA &amp;nbsp; datos &amp;amp; BI'), 'IA datos & BI');
  assert.equal(decodificarEntidades('Formaci&oacute;n &#8220;digital&#8221; &#x20AC;'), 'Formación “digital” €');
});

test('should_leave_unknown_entities_and_plain_text_untouched', () => {
  assert.equal(decodificarEntidades('Lote 1 & 2'), 'Lote 1 & 2');
  assert.equal(decodificarEntidades('&inventada; sigue'), '&inventada; sigue');
  assert.equal(decodificarEntidades(''), '');
});
