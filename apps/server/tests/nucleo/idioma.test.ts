// Idioma de un título, con títulos reales de la PLACSP (plataformas agregadas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idiomaDelTexto } from '../../src/nucleo/idioma.js';

test('should_recognize_catalan_basque_and_galician_titles', () => {
  assert.equal(idiomaDelTexto('Subministrament i serveis de suport tecnològic en CPD mnpal'), 'ca');
  assert.equal(
    idiomaDelTexto(
      "L'objecte del present contracte és la contractació d'un servei de programari o plataforma de gestió documental",
    ),
    'ca',
  );
  assert.equal(
    idiomaDelTexto('Urnietako udalerriko 3 eta 4 poligonoetako landa-lurzoruaren lurzatiak mugatze zerbitzua.'),
    'eu',
  );
  assert.equal(
    idiomaDelTexto(
      'Azpeitiko Soreasu antzokiko sarreretako batean kanpo-estalki berri bat eraikitzeko obren zuzendaritza',
    ),
    'eu',
  );
  assert.equal(idiomaDelTexto('Servizo de limpeza de edificios públicos e instalacións municipais.'), 'gl');
  assert.equal(idiomaDelTexto('Mellora de pavimentación en Amarelle. Fase I'), 'gl');
});

test('should_keep_spanish_titles_spanish_even_when_they_quote_another_language', () => {
  assert.equal(
    idiomaDelTexto(
      'Contrato de servicios para la gestión e impartición del programa " Bertsogintza eta ahozkotasuna".',
    ),
    'es',
  );
  assert.equal(
    idiomaDelTexto(
      'Servicios de instalación, montaje, mantenimiento, asistencia técnica y desmontaje de equipamientos de sonido',
    ),
    'es',
  );
  assert.equal(idiomaDelTexto('Diseño e implantación de un simulador tarifario'), 'es');
  assert.equal(idiomaDelTexto('Fase I del proyecto ERP'), 'es', '«I» no cuenta como la conjunción catalana');
  assert.equal(idiomaDelTexto('Fase I'), null);
  assert.equal(
    idiomaDelTexto('Suministros e instalación de aires acondicionados en varias unidades de Valladolid'),
    'es',
    '«e» ante «i» también es español',
  );
  assert.equal(idiomaDelTexto('Adecuación edificio almacén'), null);
  assert.equal(idiomaDelTexto(''), null);
});
