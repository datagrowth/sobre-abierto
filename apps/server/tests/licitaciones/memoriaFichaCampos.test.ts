// Ficha de solución frente a la hoja de hechos (puro): la ficha enseña todo lo que la memoria
// compromete; una edición cambia la solución, los hechos que llevan ese valor y ningún otro; un
// inicio nuevo desplaza el calendario; un parche de una ronda arrastra la ficha y la solución.
// Guiones sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solucionCasoA } from './fixtures/estrategiaCasoA.js';

const { Solucion, solucionEnMarkdown } = await import('../../src/dominios/licitaciones/oferta/solucion.js');
const { ALERTA_CERTIFICACION, aplicarRevision, camposDeFicha, desplazarFechas, seguirCambioDeHecho } =
  await import('../../src/dominios/licitaciones/oferta/fichaCampos.js');
const { campoDeFicha } = await import('../../src/dominios/licitaciones/oferta/parcheHechos.js');
type HechoData = import('../../src/dominios/licitaciones/oferta/estrategia.js').HechoData;
type SolucionData = import('../../src/dominios/licitaciones/oferta/solucion.js').SolucionData;

const hecho = (
  clave: string,
  categoria: HechoData['categoria'],
  sobre: string,
  valor: string,
  palabras = [sobre],
): HechoData => ({ clave, categoria, sobre, valor, palabras });

function solucion(cambios: (s: SolucionData) => void = () => {}): SolucionData {
  const s = Solucion.parse(solucionCasoA());
  s.calendario.inicio = '2026-11-02';
  s.calendario.semanas = [
    {
      desde: '2026-11-02',
      hasta: '2026-11-13',
      trabajo: 'Arranque y análisis',
      rol: 'RS',
      entregable: 'Plan de trabajo',
      puerta: 'Acta de arranque',
    },
    {
      desde: '2026-11-16',
      hasta: '2026-12-11',
      trabajo: 'Puesta en marcha del piloto',
      rol: 'RS',
      entregable: 'Piloto en producción',
      puerta: 'Prueba de aceptación',
    },
  ];
  cambios(s);
  return Solucion.parse(s);
}
const campo = (cs: ReturnType<typeof camposDeFicha>, clave: string) => cs.find((c) => c.clave === clave);
const revisar = (s: SolucionData, hechos: HechoData[], nuevos: Record<string, string>) =>
  aplicarRevision(s, hechos, camposDeFicha(s, hechos), new Map(Object.entries(nuevos)));

test('should_show_every_commitment_of_the_solution_in_the_sheet', () => {
  const s = solucion((x) => {
    x.soporte = { horario: 'L-V 9-18', respuesta: 'P1 4 h', meses: 24, canal: '24x7 telefónico' };
    x.arquitectura = [
      {
        capa: 'Datos',
        servicio: 'Base de datos gestionada',
        tier: 'Estándar',
        region: 'UE',
        motivo: 'Aloja los expedientes.',
        control: 'Cumplimiento ENS categoría alta certificado',
        alternativa: 'Otra región de la UE',
      },
    ];
  });
  const cs = camposDeFicha(s, []);
  assert.equal(campo(cs, 'soporte-meses')?.valor, '24 meses');
  assert.equal(campo(cs, 'soporte-canal')?.valor, '24x7 telefónico');
  assert.equal(
    campo(cs, 'semana-2')?.valor,
    '2026-11-16 · 2026-12-11 · Puesta en marcha del piloto · RS · Piloto en producción · Prueba de aceptación',
    'cada tramo, con su fin, su entregable y su puerta',
  );
  assert.equal(
    campo(cs, 'arquitectura-1')?.valor,
    'Base de datos gestionada · Estándar · UE · Cumplimiento ENS categoría alta certificado',
    'con el control de la capa',
  );
  assert.equal(
    campo(cs, 'arquitectura-1')?.alerta,
    ALERTA_CERTIFICACION,
    'una certificación se señala para comprobarla',
  );
  assert.equal(
    campo(cs, 'formacion')?.valor,
    '4 h · 2 sesiones · Personal de oficina de la SIIE · Dos sesiones anuales de 2 horas sobre protección de datos en su trabajo diario.',
  );
  assert.equal(
    campo(cs, 'umbral-1')?.valor,
    '≥ 95 % · respondidas en 48 horas / recibidas · Gestor de tickets · Cada mes',
    'con la fórmula y el momento',
  );
  assert.equal(
    campo(cs, 'riesgo-1')?.valor,
    'Refuerzo de la responsable al 75 % ese mes · RS',
    'cada riesgo con su medida y su dueño',
  );
});

test('should_show_facts_that_no_field_carries_as_their_own_fields', () => {
  const s = solucion((x) => {
    x.soporte = null;
  });
  const cs = camposDeFicha(s, [hecho('guardia', 'horario', 'guardia de soporte', '24x7')]);
  assert.deepEqual(campo(cs, 'hecho-guardia'), {
    clave: 'hecho-guardia',
    grupo: 'Hoja de hechos',
    etiqueta: 'guardia de soporte',
    propuesto: '24x7',
    valor: '24x7',
  });
});

test('should_carry_an_edited_composite_value_to_the_solution_and_its_facts', () => {
  const s = solucion();
  const hechos = [hecho('respuesta_consultas', 'plazo', 'respuesta a consultas', '48 horas', ['respuesta'])];
  const r = revisar(s, hechos, { 'soporte-respuesta': 'Respuesta a consultas en 72 horas' });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.hechos[0]!.valor, '72 horas', 'la hoja que copian los apartados y compara la coherencia');
  assert.equal(r.data!.solucion.soporte!.respuesta, 'Respuesta a consultas en 72 horas');
  assert.ok(
    solucionEnMarkdown(r.data!.solucion).some((l) => l.includes('Respuesta a consultas en 72 horas')),
    'el contrato de la redacción, también',
  );
  assert.deepEqual(campo(r.data!.campos, 'soporte-respuesta')?.hechos, [
    { clave: 'respuesta_consultas', valor: '72 horas' },
  ]);
});

test('should_replace_the_only_schedule_fact_written_in_another_way', () => {
  const s = solucion((x) => {
    x.soporte = { horario: 'L-V, 8:00-18:00', respuesta: 'Respuesta en 48 horas', meses: null, canal: 'Correo' };
  });
  const hechos = [hecho('horario_atencion', 'horario', 'horario de atención', 'lunes a viernes de 8:00 a 18:00')];
  const r = revisar(s, hechos, { 'soporte-horario': 'L-V, 9:00-14:00' });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(
    r.data!.hechos[0]!.valor,
    'L-V, 9:00-14:00',
    'el mismo compromiso escrito de otra forma: lo sustituye entero',
  );
});

test('should_not_change_other_facts_that_share_a_short_value', () => {
  const s = solucion((x) => {
    x.alias_roles = [
      { rol: 'Responsable del servicio', alias: 'RS', dedicacion: '50 %' },
      { rol: 'Consultora de protección de datos', alias: 'CPD', dedicacion: '50 %' },
    ];
  });
  const hechos = [
    hecho('rs', 'rol', 'responsable del servicio', 'Responsable del servicio (50 %)'),
    hecho('cpd', 'rol', 'consultora de protección de datos', 'Consultora de protección de datos (50 %)'),
    hecho(
      'cobertura',
      'indicador',
      'cobertura de los tipos documentales',
      'Cobertura del banco de pruebas: 50 % de los tipos documentales',
    ),
  ];
  const r = revisar(s, hechos, { 'rol-1': '30 %' });
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    r.data!.hechos.map((h) => h.valor),
    [
      'Responsable del servicio (30 %)',
      'Consultora de protección de datos (50 %)',
      'Cobertura del banco de pruebas: 50 % de los tipos documentales',
    ],
  );
  assert.deepEqual(
    r.data!.solucion.alias_roles.map((x) => x.dedicacion),
    ['30 %', '50 %'],
  );
});

test('should_shift_the_calendar_and_the_fact_dates_when_the_start_moves', () => {
  const s = solucion();
  const hechos = [
    hecho('fase1', 'calendario', 'fase 1', 'Fase 1: 2026-11-02 a 2026-11-13'),
    hecho('piloto', 'calendario', 'entrega del piloto', 'Piloto el 11/12/2026'),
    hecho('presentacion', 'plazo', 'presentación de la oferta', 'Ofertas hasta el 2026-10-20'),
  ];
  const r = revisar(s, hechos, { inicio: '2026-11-16' });
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    r.data!.solucion.calendario.semanas.map((x) => [x.desde, x.hasta]),
    [
      ['2026-11-16', '2026-11-27'],
      ['2026-11-30', '2026-12-25'],
    ],
  );
  assert.deepEqual(
    r.data!.hechos.map((h) => h.valor),
    ['Fase 1: 2026-11-16 a 2026-11-27', 'Piloto el 25/12/2026', 'Ofertas hasta el 2026-10-20'],
    'lo de antes del inicio no se mueve',
  );
  assert.equal(
    desplazarFechas('Comité el 2 de noviembre de 2026', '2026-11-02', 14),
    'Comité el 16 de noviembre de 2026',
  );
});

test('should_reject_an_edit_that_breaks_the_calendar_or_its_parts', () => {
  const s = solucion();
  assert.match(
    revisar(s, [], { 'semana-1': '2026-11-13 · 2026-11-02 · Arranque · RS · Plan · Acta' }).error?.message ?? '',
    /acaban antes de empezar: 2026-11-13–2026-11-02/,
  );
  assert.match(
    revisar(s, [], { formacion: '4 h · 2 sesiones · Personal' }).error?.message ?? '',
    /«Formación \(horas · sesiones · destinatarios · plan\)» lleva 4 partes separadas por « · »; llegaron 3\./,
  );
  assert.match(
    revisar(s, [], { formacion: 'muchas · 2 sesiones · Personal · Plan' }).error?.message ?? '',
    /«horas» va como número \(llegó «muchas»\)/,
  );
});

test('should_bind_a_fact_written_differently_to_its_composite_field', () => {
  const s = solucion((x) => {
    x.arquitectura = [
      {
        capa: 'Modelo de lenguaje',
        servicio: 'Servicio gestionado de modelos',
        tier: 'Standard',
        region: 'West Europe',
        motivo: 'Datos en la UE.',
        control: 'Cifrado en tránsito',
        alternativa: 'North Europe',
      },
    ];
  });
  const hechos = [hecho('region', 'otro', 'región de la nube', 'Región: West Europe (Países Bajos)')];
  const campos = camposDeFicha(s, hechos);
  assert.deepEqual(campo(campos, 'arquitectura-1')?.hechos, [
    { clave: 'region', valor: 'Región: West Europe (Países Bajos)' },
  ]);
  const f = {
    memoria_id: 1,
    estado: 'aprobada' as const,
    campos,
    creada_en: '',
    vence_en: '',
    revisada_en: null,
    revisada_por: 'Elisa',
    editados: [],
    no_revisados: [],
  };
  assert.equal(
    campoDeFicha(f, hechos[0]!),
    'Modelo de lenguaje (servicio · tier · región · control): Servicio gestionado de modelos · Standard · West Europe · Cifrado en tránsito',
  );
});

test('should_follow_a_round_patch_in_the_sheet_and_the_solution', () => {
  const s = solucion();
  const hechos = [hecho('respuesta_consultas', 'plazo', 'respuesta a consultas', '48 horas', ['respuesta'])];
  const r = seguirCambioDeHecho(
    s,
    camposDeFicha(s, hechos),
    { clave: 'respuesta_consultas', antes: '48 horas', despues: '4 horas (urgentes) y 24 horas (resto)' },
    2,
  );
  assert.equal(r.solucion.soporte!.respuesta, 'Respuesta a consultas en 4 horas (urgentes) y 24 horas (resto)');
  const c = campo(r.campos, 'soporte-respuesta')!;
  assert.equal(c.valor, 'Respuesta a consultas en 4 horas (urgentes) y 24 horas (resto)');
  assert.deepEqual(c.ronda, { n: 2, antes: 'Respuesta a consultas en 48 horas' });
});

test('should_apply_an_edit_made_on_a_sheet_opened_before_fields_had_all_their_parts', () => {
  const s = solucion();
  const deAntes = [
    {
      clave: 'umbral-1',
      grupo: 'Umbrales de calidad',
      etiqueta: 'Consultas respondidas en plazo',
      propuesto: '≥ 95 %',
      valor: '≥ 95 %',
    },
  ];
  const r = aplicarRevision(s, [], deAntes, new Map([['umbral-1', '≥ 90 %']]));
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.solucion.umbrales[0]!.umbral, r.data!.solucion.umbrales[0]!.formula],
    ['≥ 90 %', 'respondidas en 48 horas / recibidas'],
    'la fórmula sigue como estaba',
  );
});
