import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTROS_BARRERAS,
  TIPOS_BARRERA,
  filtrarBarreras,
  textoNiveles,
  conFalta,
  textoBarrera,
  textoPersonal,
} from './barrerasFormato.js';

const b = (x) => ({ licitaciones: 1, no_cumplimos: 0, por_confirmar: 0, importe_no_cumplimos: 0, ...x });

test('should_describe_how_often_a_requirement_is_asked_and_what_we_lose', () => {
  assert.equal(
    textoBarrera(b({ licitaciones: 5, no_cumplimos: 3, importe_no_cumplimos: 650000, por_confirmar: 1 })).replace(
      /\s/g,
      ' ',
    ),
    'Lo piden 5 licitaciones · no lo tenemos en 3 (650.000 € en juego) · 1 por confirmar',
  );
  assert.equal(textoBarrera(b({})), 'Lo pide 1 licitación · lo tenemos');
});

test('should_keep_only_what_we_lack_or_must_confirm', () => {
  assert.equal(conFalta(b({ no_cumplimos: 1 })), true);
  assert.equal(conFalta(b({ por_confirmar: 2 })), true);
  assert.equal(conFalta(b({})), false);
});

test('should_show_by_default_what_leaves_us_out_in_several_tenders', () => {
  const b = (clave, fuera, no = fuera, dudas = 0) => ({
    clave,
    nos_dejan_fuera: fuera,
    no_cumplimos: no,
    por_confirmar: dudas,
  });
  const lista = [b('ens', 12), b('iso-9001', 1), b('habilitacion:x', 0, 1), b('iso-20000', 0, 0, 1), b('cmmi', 0, 0)];
  assert.equal(FILTROS_BARRERAS[0].key, 'fuera2', 'el filtro por defecto');
  assert.deepEqual(
    filtrarBarreras(lista, 'fuera2').map((x) => x.clave),
    ['ens'],
  );
  assert.deepEqual(
    filtrarBarreras(lista, 'fuera1').map((x) => x.clave),
    ['ens', 'iso-9001'],
  );
  assert.deepEqual(
    filtrarBarreras(lista, 'falta').map((x) => x.clave),
    ['ens', 'iso-9001', 'habilitacion:x', 'iso-20000'],
  );
  assert.equal(filtrarBarreras(lista, 'todo').length, 5);
});

test('should_describe_the_ens_categories_asked_from_highest', () => {
  assert.equal(textoNiveles({ media: 12, alta: 7, 'sin indicar': 3 }), 'alta en 7 · media en 12 · sin indicar en 3');
  assert.equal(textoNiveles(undefined), null);
  assert.equal(textoNiveles({}), null);
});

test('should_format_personnel_barrier_line', () => {
  const p = (x) => ({
    materia: 'auditoria de accesibilidad web',
    anios_exigidos: 5,
    licitaciones: 2,
    nos_dejan_fuera: 1,
    ...x,
  });
  assert.equal(
    textoPersonal(p({})).replace(/\s/g, ' '),
    'Auditoria de accesibilidad web · 5 años · lo piden 2 licitaciones · nos dejó fuera en 1',
  );
  assert.equal(
    textoPersonal(p({ anios_exigidos: null, licitaciones: 1, nos_dejan_fuera: 0 })).replace(/\s/g, ' '),
    'Auditoria de accesibilidad web · lo pide 1 licitación · aún no nos dejó fuera',
  );
  assert.equal(TIPOS_BARRERA.experiencia_personal, 'experiencia del personal');
});
