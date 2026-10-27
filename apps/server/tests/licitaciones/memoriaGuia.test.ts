// Memoria técnica: la tabla guía «Cómo se responde a cada criterio». Los jueces la leyeron ilegible:
// la evidencia venía del mapa de la estrategia sin espacios («Figura2perfiles/9tipos…») y el
// guion troceaba una sola frase del pliego en filas que no se entienden solas («entregables»).
// Datos sintéticos que reproducen las dos cosas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { GUION_CASO_A } from './fixtures/casoA.js';

const { esFragmento, evidenciaDeGuia, filasDeGuia, legible, SIN_EVIDENCIA_LEGIBLE } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { apelmazado } = await import('../../src/dominios/licitaciones/oferta/telegrafia.js');
const { EstrategiaDatos, problemasDeEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');

const entrada = (item: string, donde: string, evidencia: string) => ({ apartado: 1, item, donde, evidencia });

test('should_group_loose_fragments_under_the_criterion_that_heads_them', () => {
  const filas = filasDeGuia([
    entrada(
      'Diseño del servicio y comprensión del encargo',
      '1.1 Recorrido del usuario',
      'Flujo con los dos perfiles y los límites de la fase 1.',
    ),
    entrada('la solución concreta ofertada', '1.2 Módulos y salidas', 'Tabla de entradas, módulos y salidas.'),
    entrada('sus mecanismos de ejecución', '1.2 Módulos y salidas', 'Secuencia de carga, extracción y validación.'),
    entrada('entregables', '1.3 Entregables y aceptación', 'Matriz de siete entregables con dueño.'),
    {
      apartado: 2,
      item: 'Plan de formación del personal usuario',
      donde: '2.1 Formación',
      evidencia: 'Seis sesiones de 4 horas.',
    },
    { apartado: 2, item: 'evidencias', donde: '2.2 Registro', evidencia: 'Registro de asistencia firmado.' },
  ]);
  assert.equal(filas.length, 2, 'una fila por criterio, no una por trozo');
  assert.deepEqual(filas[0], [
    'Diseño del servicio y comprensión del encargo: la solución concreta ofertada, sus mecanismos de ejecución y entregables',
    '1.1 Recorrido del usuario; 1.2 Módulos y salidas; 1.3 Entregables y aceptación',
    'Flujo con los dos perfiles y los límites de la fase 1; Tabla de entradas, módulos y salidas; Secuencia de carga, extracción y validación; Matriz de siete entregables con dueño.',
  ]);
  assert.equal(filas[1]![0], 'Plan de formación del personal usuario: evidencias', 'un trozo no salta de apartado');
});

test('should_keep_autonomous_criteria_in_their_own_rows', () => {
  assert.deepEqual(
    [
      'Modelo organizativo propuesto',
      'metodología de trabajo y planificación',
      'la solución concreta ofertada',
      'entregables',
      'Plan de calidad',
    ].map(esFragmento),
    [false, false, true, true, false],
  );
  const filas = filasDeGuia([
    entrada('la solución concreta ofertada', '1.1 Solución', 'Arquitectura en tres capas.'),
    entrada('Plan de calidad', '1.2 Calidad', 'Doce indicadores.'),
  ]);
  assert.deepEqual(
    filas.map((f) => f[0]),
    ['la solución concreta ofertada', 'Plan de calidad'],
    'un trozo sin criterio delante encabeza su fila',
  );
});

test('should_make_glued_evidence_readable_without_removing_spaces', () => {
  assert.equal(
    legible('Figura2perfiles/9tipos yexclusiónintegraciónfuncionalETC3.2.'),
    'Figura 2 perfiles/9 tipos yexclusiónintegraciónfuncional ETC3.2.',
  );
  assert.equal(legible('4roles,dedicación porfase,RACI,sinnombres.'), '4 roles, dedicación porfase, RACI, sinnombres.');
  assert.equal(
    legible('Cuotas/modelosS2,revisión 24h, RPO24h, SharePoint y 1,5 días.'),
    'Cuotas/modelos S2, revisión 24h, RPO24h, SharePoint y 1,5 días.',
    'siglas, decimales y unidades quedan',
  );
  const prosa = 'Matriz de los siete entregables con su dueño y su prueba de aceptación.';
  assert.equal(legible(prosa), prosa);
});

test('should_cap_grouped_evidence_with_ellipsis_and_keep_its_spaces', () => {
  const larga =
    'Procedimiento con responsable, calendario semanal, indicador con meta mensual y acta de seguimiento firmada por las dos partes.';
  const filas = filasDeGuia([
    entrada('Plan de trabajo', '1.1 Plan', larga),
    entrada('entregables', '1.2 Entregables', `${larga} Otra`),
    entrada('evidencias', '1.3 Evidencias', `${larga} Más`),
    entrada('dependencias', '1.4 Dependencias', `${larga} Fin`),
  ]);
  const celda = filas[0]![2]!;
  assert.ok(celda.length <= 480 && celda.length > 160, `${celda.length} caracteres: hasta 3 pistas por fila agrupada`);
  assert.ok(celda.endsWith('…'));
  assert.ok(!/\S{30,}/.test(celda), 'nunca se quitan espacios');
  assert.equal(evidenciaDeGuia(['Acta firmada.']), 'Acta firmada.');
});

test('should_detect_glued_evidence_and_spare_readable_technical_text', () => {
  for (const t of [
    'Figura2perfiles/9tipos yexclusiónintegraciónfuncionalETC3.2.',
    'Carga-extracción-pregunta-borrador-cotejo-validación/versiones.',
    '4roles,dedicación porfase,RACI,sinnombres.',
    '31semanas,6+6,28jornadas/fase,aceptación15/02/2027.',
  ]) {
    assert.equal(apelmazado(t), true, t);
  }
  for (const t of [
    'Matriz de los siete entregables con dueño y prueba de aceptación.',
    'Azure OpenAI y AI Search en la región de España, con copias cada 24 h y RPO de 24 h.',
    'Acta firmada.',
    'Lectura/escritura separadas por rol, con registro de accesos.',
  ]) {
    assert.equal(apelmazado(t), false, t);
  }
});

test('should_flag_glued_map_evidence_as_soft_strategy_problem', () => {
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  const e = EstrategiaDatos.parse(datos);
  const ctx = {
    mem: GuionBase.parse(GUION_CASO_A).memoria!,
    fugas: { automaticos: [] },
    porRoles: false,
    equipo: [],
    herramientas: [],
  };
  assert.equal(
    problemasDeEstrategia(e, ctx).blandos.some((b) => /apelmazada/.test(b)),
    false,
    'la evidencia legible no se queja',
  );
  e.mapa[0] = { ...e.mapa[0]!, evidencia: '4roles,dedicación porfase,RACI,sinnombres.' };
  const blandos = problemasDeEstrategia(e, ctx).blandos.filter((b) => /apelmazada/.test(b));
  assert.equal(blandos.length, 1);
  assert.match(
    blandos[0]!,
    /^La evidencia del «mapa» para «.+» \(apartado 1\) va apelmazada: «4roles,dedicación porfase,RACI,sinnombres\.»\. Escríbela como una frase legible/,
  );
});

test('should_keep_lowercase_autonomous_criteria_in_their_own_rows', () => {
  const filas = filasDeGuia([
    entrada('la metodología de trabajo propuesta', '1.1 Metodología', 'Ciclo semanal con revisión.'),
    entrada('el plan de calidad y sus indicadores', '1.2 Calidad', 'Doce indicadores con meta.'),
    entrada('la organización del equipo asignado', '1.3 Equipo', 'Organigrama con cuatro roles.'),
  ]);
  assert.deepEqual(
    filas.map((f) => f[0]),
    [
      'la metodología de trabajo propuesta',
      'el plan de calidad y sus indicadores',
      'la organización del equipo asignado',
    ],
    'sin encabezado delante, cada criterio en su fila',
  );
});

test('should_attach_a_repeated_fragment_to_its_own_criterion', () => {
  const filas = filasDeGuia([
    entrada('Plan de formación', 'A', 'evA'),
    entrada('entregables', 'A2', 'evA2'),
    entrada('Plan de soporte', 'B', 'evB'),
    entrada('entregables', 'B2', 'evB2'),
  ]);
  assert.deepEqual(filas, [
    ['Plan de formación: entregables', 'A; A2', 'evA; evA2.'],
    ['Plan de soporte: entregables', 'B; B2', 'evB; evB2.'],
  ]);
});

test('should_drop_the_final_period_of_a_criterion_that_heads_fragments', () => {
  assert.equal(
    filasDeGuia([
      entrada('Metodología, planificación y pruebas.', '3.1', 'Calendario con fechas.'),
      entrada('entregables', '3.2', 'Matriz de entregables.'),
    ])[0]![0],
    'Metodología, planificación y pruebas: entregables',
  );
});

test('should_not_split_technical_names_in_readable_evidence', () => {
  const t = 'Modelo word2vec, codificación base64 y python3.';
  assert.equal(legible(t), t);
});

test('should_separate_grouped_hints_without_a_final_period', () => {
  assert.equal(
    evidenciaDeGuia(
      ['Tabla de entradas, módulos y salidas', 'Secuencia de carga y validación', 'Matriz de entregables con dueño'],
      480,
    ),
    'Tabla de entradas, módulos y salidas; Secuencia de carga y validación; Matriz de entregables con dueño.',
  );
});

test('should_replace_evidence_that_stays_unreadable_after_separating', () => {
  assert.equal(evidenciaDeGuia(['Ficha/casoA1;I-C-008pp.4-5 yFIP/IIP/IEP07/10p.2.']), SIN_EVIDENCIA_LEGIBLE);
  assert.equal(
    evidenciaDeGuia(['Figura2perfiles/9tipos yexclusiónintegraciónfuncionalETC3.2.']),
    SIN_EVIDENCIA_LEGIBLE,
  );
  assert.equal(
    evidenciaDeGuia([
      'Figura2perfiles/9tipos yexclusiónintegraciónfuncionalETC3.2.',
      'Matriz de entregables con dueño.',
    ]),
    'Matriz de entregables con dueño.',
    'se queda la legible',
  );
});
