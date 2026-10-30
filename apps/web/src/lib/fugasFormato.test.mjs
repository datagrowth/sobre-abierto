import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisosSinFugas,
  dondeFuga,
  fugasDe,
  gravedadFuga,
  indicacionDeFuga,
  textoAnonimato,
  textoComprobadoFugas,
  textoFugas,
} from './fugasFormato.js';

const HALLAZGO = {
  apartado: 2,
  tipo: 'eco',
  cita: 'El técnico de soporte accederá a lo imprescindible para resolver el problema de acceso, sin pedir contraseñas.',
  marca: 'acceso solo para actuaciones indispensables y precisas para solventar la incidencia',
  criterio: 'Asistencia con acceso remoto',
  archivo: 'Sobre C',
  descripcion: 'repite con otras palabras lo que se declara en «Asistencia con acceso remoto»',
};
const version = (hallazgos, estado = 'pendiente') => ({
  version: 2,
  borrador: { id: 7, estado },
  fugas: { hallazgos, anulada: null },
});

test('should_return_empty_leaks_when_the_server_does_not_send_them', () => {
  assert.deepEqual(fugasDe(undefined), { hallazgos: [], anulada: null });
  assert.deepEqual(fugasDe({ fugas: { hallazgos: [HALLAZGO], anulada: { motivo: 'x', en: '2026-10-14' } } }).anulada, {
    motivo: 'x',
    en: '2026-10-14',
  });
});

test('should_say_how_many_leaks_there_are_and_what_to_do', () => {
  assert.equal(textoFugas(version([])), null);
  assert.match(
    textoFugas(version([HALLAZGO])),
    /^La memoria menciona una cosa que va en el archivo de los criterios automáticos o de la oferta económica: es causa de exclusión\./,
  );
  assert.match(textoFugas(version([HALLAZGO, HALLAZGO])), /^La memoria menciona 2 cosas que van/);
});

test('should_hide_the_leak_warnings_that_the_leak_panel_already_shows', () => {
  const avisos = [
    'Fuga entre sobres en el apartado 2: repite con otras palabras…',
    'LibreOffice está apagado: páginas estimadas.',
  ];
  assert.deepEqual(avisosSinFugas(avisos), ['LibreOffice está apagado: páginas estimadas.']);
  assert.deepEqual(avisosSinFugas(), []);
});

const ensamblada = (hallazgos) => ({ ...version(hallazgos), estado: 'ensamblada' });
const guion = (archivos) => ({
  memoria: { archivo: 'Sobre B', apartados: [] },
  automaticos: archivos.map((archivo, i) => ({ criterio: `Criterio ${i + 1}`, archivo })),
});

test('should_label_an_echo_as_suspicion_and_a_mark_as_blocking', () => {
  assert.deepEqual(gravedadFuga(HALLAZGO), { clave: 'sospecha', texto: 'Sospecha' });
  assert.deepEqual(gravedadFuga({ ...HALLAZGO, tipo: 'marca' }), { clave: 'impide', texto: 'Impide' });
  assert.deepEqual(
    gravedadFuga({ ...HALLAZGO, tipo: 'importe' }),
    { clave: 'impide', texto: 'Impide' },
    'un importe de la oferta es fuga dura',
  );
  assert.deepEqual(gravedadFuga({ ...HALLAZGO, tipo: 'importe_suelto' }), {
    clave: 'no_comprobado',
    texto: 'No comprobado',
  });
  assert.equal(gravedadFuga(undefined).clave, 'impide', 'lo desconocido no se rebaja');
});

test('should_say_what_was_checked_when_there_are_no_leaks', () => {
  assert.equal(
    textoComprobadoFugas(ensamblada([]), guion(['Sobre C', 'sobre  c', 'Sobre C', 'Sobre B'])),
    'Comprobado: 0 fugas contra los 3 criterios del Sobre C',
  );
  assert.equal(
    textoComprobadoFugas(ensamblada([]), guion(['Sobre C'])),
    'Comprobado: 0 fugas contra el criterio del Sobre C',
  );
  assert.equal(textoComprobadoFugas(ensamblada([HALLAZGO]), guion(['Sobre C'])), null, 'con hallazgos habla el panel');
  assert.equal(textoComprobadoFugas(version([]), guion(['Sobre C'])), null, 'sin ensamblar aún no se comprobó');
  assert.equal(textoComprobadoFugas(ensamblada([]), null), null);
});

test('should_say_no_aplica_when_memory_and_criteria_share_a_file', () => {
  assert.equal(
    textoComprobadoFugas(ensamblada([]), guion(['Sobre B', 'SOBRE B'])),
    'No aplica: memoria y criterios van en el mismo archivo',
  );
  assert.equal(
    textoComprobadoFugas(ensamblada([]), guion([])),
    'No aplica: memoria y criterios van en el mismo archivo',
  );
});

test('should_prefill_another_round_with_the_leak_quote', () => {
  assert.equal(indicacionDeFuga(HALLAZGO), `Quita del apartado 2: «${HALLAZGO.cita}»`);
});

test('should_say_how_many_people_and_which_apartados_when_memoria_names_team', () => {
  const m = { anonimato: { exige: true, apartados: [2, 5], personas: 3 } };

  const t = textoAnonimato(m);

  assert.equal(
    t,
    'El pliego pide el equipo por roles, sin nombres, y la memoria nombra a 3 personas del equipo en los apartados 2 y 5: cámbialo por su rol con «Pedir cambios» o subiendo una versión editada.',
  );
});

test('should_say_nothing_when_pliego_allows_names', () => {
  assert.equal(textoAnonimato({ anonimato: { exige: false, apartados: [], personas: 0 } }), null);
  assert.equal(textoAnonimato({ anonimato: null }), null);
  assert.equal(textoAnonimato(undefined), null);
});

test('should_say_nothing_when_the_memory_names_nobody_and_use_singular_for_one', () => {
  assert.equal(textoAnonimato({ anonimato: { exige: true, apartados: [], personas: 0 } }), null);
  assert.match(
    textoAnonimato({ anonimato: { exige: true, apartados: [4], personas: 1 } }),
    /a 1 persona del equipo en el apartado 4:/,
  );
});

test('should_place_a_leak_in_its_section_or_in_the_text_of_a_whole_version', () => {
  assert.equal(dondeFuga(HALLAZGO), 'Apartado 2');
  assert.equal(dondeFuga({ ...HALLAZGO, apartado: 0 }), 'En el texto', 'subida entera, sin apartados');
});
