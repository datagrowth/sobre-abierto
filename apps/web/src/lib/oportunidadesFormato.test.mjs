import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anadirEtiqueta,
  conPagina,
  etiquetaCpv,
  textoEnPliego,
  consultaRevision,
  plazoQueManda,
  unirPaginas,
  filtrosIniciales,
  leerImporte,
  textoOpinion,
  textoPieOportunidades,
} from './oportunidadesFormato.js';

const PREFILTRO = {
  cpv_prefijos: ['72', '80'],
  palabras: ['datos'],
  excluir_palabras: ['obra'],
  importe_min: 15000,
  importe_max: null,
  tipos_contrato: ['2'],
  nuts_prefijos: [],
  excluir_idiomas: ['eu'],
};

test('should_start_the_visible_filters_from_the_prefilter', () => {
  // Act
  const f = filtrosIniciales(PREFILTRO);

  // Assert
  assert.deepEqual(f, {
    opinion: ['interesa', 'revisar', 'descartar'],
    comunidades: [],
    importe_min: 15000,
    importe_max: null,
    cpv: ['72', '80'],
    palabras: ['datos'],
    excluir: ['obra'],
    tipos: ['2'],
    idiomas: ['eu'],
  });
  assert.deepEqual(filtrosIniciales(null).cpv, [], 'sin prefiltro, sin filtros');
});

test('should_send_only_what_filters', () => {
  // Arrange
  const filtros = { ...filtrosIniciales(PREFILTRO), opinion: ['interesa', 'revisar'], comunidades: ['ES70', 'ES30'] };

  // Act
  const q = new URLSearchParams(consultaRevision({ pestana: 'por_revisar', texto: ' cabildo ', filtros }));
  const enErrores = new URLSearchParams(consultaRevision({ pestana: 'errores', filtros }));
  const sinNada = new URLSearchParams(consultaRevision({ filtros: filtrosIniciales(null) }));

  // Assert
  assert.equal(q.get('texto'), 'cabildo');
  assert.equal(q.get('opinion'), 'interesa,revisar');
  assert.equal(q.get('cpv'), '72,80');
  assert.equal(q.get('importe_min'), '15000');
  assert.equal(q.has('importe_max'), false);
  assert.equal(q.get('comunidad'), 'ES70,ES30');
  assert.equal(enErrores.has('opinion'), false, 'la opinión solo filtra en Por revisar');
  assert.deepEqual([...sinNada.keys()], ['pestana', 'pagina', 'limite']);
});

test('should_read_amounts_written_in_spanish', () => {
  assert.equal(leerImporte('15.000 €'), 15000);
  assert.equal(leerImporte('15000'), 15000);
  assert.equal(leerImporte('1.234,5'), 1234.5);
  assert.equal(leerImporte(''), null);
  assert.equal(leerImporte('mucho'), null);
  assert.equal(leerImporte('-3'), null);
});

test('should_add_tags_once_and_never_empty', () => {
  assert.deepEqual(anadirEtiqueta(['72'], ' 80 '), ['72', '80']);
  assert.deepEqual(anadirEtiqueta(['72'], '72'), ['72']);
  assert.deepEqual(anadirEtiqueta(['72'], '  '), ['72']);
});

test('should_name_the_opinion_and_count_the_footer', () => {
  assert.equal(textoOpinion('descartar'), 'Descarta');
  assert.equal(textoOpinion('interesa'), 'Interesa');
  assert.equal(textoPieOportunidades(4, 4), '4 oportunidades');
  assert.equal(textoPieOportunidades(50, 120), '50 de 120 oportunidades');
  assert.equal(textoPieOportunidades(1, 1), '1 oportunidad');
});

test('should_ask_for_another_page_of_the_same_query', () => {
  assert.equal(
    conPagina('pestana=por_revisar&pagina=1&limite=50&texto=ia', 3),
    'pestana=por_revisar&pagina=3&limite=50&texto=ia',
  );
});

test('should_join_pages_without_repeating_rows', () => {
  const p1 = { total: 3, cuentas: { a: 3 }, items: [{ id: 'p-1' }, { id: 'p-2' }] };
  const p2 = { total: 3, cuentas: { a: 3 }, items: [{ id: 'p-2' }, { id: 'p-3' }] };
  assert.deepEqual(
    unirPaginas([p1, p2]).items.map((x) => x.id),
    ['p-1', 'p-2', 'p-3'],
  );
  assert.equal(unirPaginas([p1]).total, 3);
});

test('should_show_the_participation_request_while_it_is_open', () => {
  const ahora = Date.parse('2026-10-20T10:00:00+02:00');
  const dosFases = { fecha_solicitud: '2026-10-23T14:00:00', fecha_limite: '2026-11-20T14:00:00' };
  assert.deepEqual(plazoQueManda(dosFases, ahora), { fecha: '2026-10-23T14:00:00', solicitud: true });
  assert.deepEqual(plazoQueManda({ ...dosFases, fecha_solicitud: '2026-10-19T14:00:00' }, ahora), {
    fecha: '2026-11-20T14:00:00',
    solicitud: false,
  });
  assert.deepEqual(plazoQueManda({ fecha_solicitud: null, fecha_limite: null }, ahora), {
    fecha: null,
    solicitud: false,
  });
});

test('should_label_a_cpv_prefix_with_a_short_official_description', () => {
  assert.deepEqual(etiquetaCpv('72', null), { texto: '72', titulo: undefined });
  assert.deepEqual(etiquetaCpv('80', 'Servicios de enseñanza'), {
    texto: '80 · Servicios de enseñanza',
    titulo: '80 · Servicios de enseñanza',
  });
  const larga = etiquetaCpv('72', 'Servicios TI: consultoría, desarrollo de software, Internet y apoyo');
  assert.equal(larga.texto, '72 · Servicios TI: consultoría…', 'corta en la palabra, no a media palabra');
  assert.match(larga.titulo, /Internet y apoyo$/);
});

test('should_ask_for_the_pliegos_only_with_text_to_search', () => {
  assert.match(consultaRevision({ texto: 'ens', pliegos: true }), /pliegos=1/);
  assert.doesNotMatch(consultaRevision({ texto: '', pliegos: true }), /pliegos/);
  assert.doesNotMatch(consultaRevision({ texto: 'ens' }), /pliegos/);
});

test('should_say_where_the_text_appears_in_the_pliegos', () => {
  assert.equal(textoEnPliego(null), null);
  assert.equal(
    textoEnPliego({ clase: 'ppt', pagina: 2, texto: '…uso de inteligencia artificial…' }),
    'En el PPT, pág. 2: «…uso de inteligencia artificial…»',
  );
  assert.equal(textoEnPliego({ clase: 'raro', pagina: null, texto: 'x' }), 'En un pliego: «x»');
});
