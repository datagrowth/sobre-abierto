import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosLaterales, ayudaCuenta, lineasPastilla, totalPendiente, tituloPestana } from './hoyFormato.js';

const it = (titulo, fecha) => ({ tipo: 't', titulo, detalle: null, fecha, importe: null, enlace: {} });

test('should_count_pending_items_for_the_tab_title', () => {
  assert.equal(totalPendiente({ licitaciones: 2, equipo: 1 }), 3);
  assert.equal(tituloPestana(3, 'Analítica Ejemplo · Licitaciones'), '(3) Analítica Ejemplo · Licitaciones');
  assert.equal(tituloPestana(0, 'Sobre Abierto'), 'Sobre Abierto');
});

test('should_say_under_each_section_what_waits_for_review', () => {
  const avisos = avisosLaterales({
    secciones: [
      { seccion: 'licitaciones', por_aprobar: [{ ...it('ASISTE', null), corto: 'Memoria v5 por revisar' }] },
      { seccion: 'equipo', por_aprobar: [it('A', null), it('B', null)] },
      { seccion: 'biblioteca', por_aprobar: [] },
    ],
  });
  assert.deepEqual(avisos, { licitaciones: 'Memoria v5 por revisar', equipo: '2 cosas por revisar' });
  assert.deepEqual(avisosLaterales(null), {});
});

test('should_prefer_the_domain_summary_that_explains_its_menu_count', () => {
  // Arrange: Licitaciones con resumen y algo por revisar que diría otra cuenta.
  const hoy = {
    secciones: [
      {
        seccion: 'licitaciones',
        resumen: '19 decisiones tuyas en 3 ofertas',
        por_aprobar: [it('A', null), it('B', null)],
      },
    ],
  };

  // Act
  const avisos = avisosLaterales(hoy);

  // Assert
  assert.deepEqual(avisos, { licitaciones: '19 decisiones tuyas en 3 ofertas' });
});

test('should_describe_the_licitaciones_menu_count_as_tenders_waiting_for_you', () => {
  assert.equal(ayudaCuenta('pipeline', 'Pipeline', 3), 'Pipeline: 3 ofertas te esperan');
  assert.equal(ayudaCuenta('pipeline', 'Pipeline', 1), 'Pipeline: 1 oferta te espera');
  assert.equal(ayudaCuenta('oportunidades', 'Oportunidades', 12), 'Oportunidades: 12 esperan revisión');
  assert.equal(ayudaCuenta('pipeline', 'Pipeline', 0), 'Pipeline', 'sin tareas, solo el nombre');
  assert.match(ayudaCuenta('equipo', 'Equipo', 2), /^Equipo: 2 cosas esperan tu revisión/);
});

test('should_say_what_hermes_does_per_domain_and_show_a_domain_without_profile_as_paused', () => {
  // Arrange: lo que devuelve /api/plataforma/cola/resumen.
  const resumen = {
    dominios: [
      {
        dominio: 'licitaciones',
        en_marcha: [{ tipo: 'licitaciones.memoria_redaccion', recurso: 'p-1', titulo: 'Villaejemplo' }],
        en_cola: 2,
        fallos_24h: 0,
        zombis: 0,
        en_pausa: false,
        motivo_pausa: null,
      },
      {
        dominio: 'equipo',
        en_marcha: [],
        en_cola: 9,
        fallos_24h: 0,
        zombis: 9,
        en_pausa: true,
        motivo_pausa: 'sin_perfil',
      },
    ],
  };

  // Act
  const lineas = lineasPastilla(resumen);

  // Assert
  assert.deepEqual(
    lineas.map((l) => l.texto),
    ['Licitaciones: 1 en marcha (memoria Villaejemplo) · 2 en cola · 0 fallos', 'Equipo (en pausa)'],
  );
  assert.deepEqual(
    lineas.map((l) => l.pausa),
    [false, true],
  );
});

test('should_name_the_paused_by_limit_domain_and_shorten_long_titles', () => {
  const titulo = 'Servicio de asistencia técnica para la redacción de proyectos';
  const [l] = lineasPastilla({
    dominios: [
      {
        dominio: 'licitaciones',
        en_marcha: [
          { tipo: 'licitaciones.cribar', recurso: null, titulo: null },
          { tipo: 'licitaciones.ficha', recurso: 'p-2', titulo },
        ],
        en_cola: 0,
        fallos_24h: 1,
        en_pausa: true,
        motivo_pausa: 'limite',
      },
    ],
  });
  assert.equal(
    l.texto,
    'Licitaciones (en pausa por el límite de uso): 2 en marcha (criba y 1 más) · 0 en cola · 1 fallo',
  );
  const [f] = lineasPastilla({
    dominios: [
      {
        dominio: 'licitaciones',
        en_marcha: [{ tipo: 'licitaciones.ficha', nombre: 'Ficha', titulo }],
        en_cola: 0,
        fallos_24h: 0,
      },
    ],
  });
  assert.match(f.texto, /^Licitaciones: 1 en marcha \(Ficha Servicio de asistencia técn…\)/);
  assert.deepEqual(lineasPastilla(null), []);
});
