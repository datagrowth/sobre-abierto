// Memoria técnica, paso 4: la coherencia por código contra la hoja de hechos, con frases sintéticas de
// una memoria de formación (el horario de 9:00 a 18:00 frente a 9-17 h, los tiempos de respuesta distintos
// entre apartados) y el equipo nombrado cuando el pliego lo pide por roles. Al recibir un
// apartado una contradicción se rechaza hasta el tercer envío y un nombre por roles, siempre; los
// hallazgos del documento entero se guardan en la memoria.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrancar,
  cerrar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { apartadoCasoA } from './fixtures/casoA.js';

const { contradiccionesEntreApartados, hallazgosDeCoherencia, textoDeHallazgo, valoresDe } =
  await import('../../src/dominios/licitaciones/oferta/hechos.js');
const { ApartadoEntrada, pedirMemoria, recibirApartado, recursoApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { hallazgosDe } = await import('../../src/dominios/licitaciones/oferta/coherenciaMemoria.js');
type HechoCoherencia = import('../../src/dominios/licitaciones/oferta/hechos.js').HechoCoherencia;

before(arrancar);
after(cerrar);

const HORARIO: HechoCoherencia = {
  clave: 'horario_atencion',
  categoria: 'horario',
  sobre: 'la atención tutorial',
  valor: 'L-V 9:00-17:00 (peninsular)',
  palabras: ['atención'],
};
const RESPUESTA: HechoCoherencia = {
  clave: 'respuesta',
  categoria: 'plazo',
  sobre: 'la primera respuesta a una incidencia',
  valor: '4 horas hábiles',
  palabras: ['respuesta'],
};
const ALUMNAS: HechoCoherencia = {
  clave: 'alumnas',
  categoria: 'cifra',
  sobre: 'alumnas por curso',
  valor: '30 alumnas',
  palabras: ['alumnas'],
};

test('should_find_schedule_contradiction_9_18_vs_9_17', () => {
  const formacion =
    'La atención académica y técnica se presta de lunes a viernes, de 9:00 a 18:00. Los plazos de respuesta corren dentro de ese horario.';
  const hs = hallazgosDeCoherencia([formacion], [HORARIO]);
  assert.equal(hs.length, 1);
  assert.deepEqual(
    { ...hs[0], cita: undefined },
    {
      apartado: 1,
      hecho: 'horario_atencion',
      cita: undefined,
      encontrado: '9:00-18:00',
      esperado: 'L-V 9:00-17:00 (peninsular)',
      tipo: 'contradiccion',
    },
  );
  assert.equal(
    textoDeHallazgo(hs[0]!, [HORARIO]),
    'La hoja de hechos dice «L-V 9:00-17:00 (peninsular)» para la atención tutorial y aquí pone 9:00-18:00 («La atención académica y técnica se presta de lunes a viernes, de 9:00 a 18:00.»): copia el valor de la hoja.',
  );
  assert.deepEqual(
    hallazgosDeCoherencia(['Las 30 alumnas de cada curso. Cada curso admite 40 alumnas.'], [ALUMNAS]).map(
      (h) => h.encontrado,
    ),
    ['40 alumna'],
  );
});

test('should_accept_equivalent_schedule_formats', () => {
  for (const t of [
    '9:00-17:00',
    'de 9 a 17 h',
    '9.00–17.00 h',
    'de 9:00 a 17:00 horas',
    'desde las 9:00 hasta las 17:00',
    '9h00-17h00',
  ]) {
    assert.deepEqual(valoresDe('horario', t), ['9:00-17:00'], t);
    assert.deepEqual(hallazgosDeCoherencia([`La atención será de lunes a viernes, ${t}.`], [HORARIO]), [], t);
  }
  assert.deepEqual(valoresDe('plazo', 'primera respuesta en 4 horas hábiles; resolución en 2 días; 24/7'), [
    '4 h',
    '2 dia',
    '24/7',
  ]);
  assert.deepEqual(valoresDe('plazo', 'atención de 9 a 17 h'), [], 'el «17 h» de un horario no es un plazo');
});

test('should_find_response_time_contradiction_between_apartados', () => {
  const textos = [
    'Cada incidencia técnica recibe su primera respuesta en 4 horas hábiles.',
    'El aula está disponible las 24 horas.',
    'La tutora dará respuesta a cada consulta en 24 horas.',
    'La respuesta a una incidencia que impide entregar llega en 4 horas hábiles y su resolución, el mismo día.',
  ];
  const entre = contradiccionesEntreApartados(textos);
  assert.equal(entre.length, 1);
  assert.deepEqual([entre[0]!.apartado, entre[0]!.tipo, entre[0]!.encontrado], [3, 'entre_apartados', '24 h']);
  assert.match(
    textoDeHallazgo(entre[0]!),
    /^El apartado 3 dice 24 h para «respuesta» y otro dice 4 h \(apartado 1: «Cada incidencia técnica recibe su primera respuesta en 4 horas hábiles\.»\): comprueba si es el mismo servicio y, si lo es, que coincidan/,
  );
  assert.deepEqual(
    hallazgosDeCoherencia(textos, [RESPUESTA]).map((h) => h.apartado),
    [3],
    'contra la hoja, solo el que no casa',
  );
});

test('should_ignore_numbers_in_sentences_without_fact_anchors', () => {
  const textos = [
    'Tutoría en directo los jueves de 17:00 a 18:00.',
    'Cada sesión dura de 2 a 4 horas; el curso tiene 40 horas.',
    'Se atienden 1.000-2.000 visitas al mes.',
  ];
  assert.deepEqual(hallazgosDeCoherencia(textos, [HORARIO, RESPUESTA, ALUMNAS]), []);
  assert.deepEqual(valoresDe('horario', 'de 2 a 4 horas'), [], 'una duración no es un horario');
  assert.deepEqual(valoresDe('horario', 'entre 1.000-2.000 visitas'), []);
});

test('should_flag_team_name_when_team_must_be_anonymous', () => {
  const equipo = ['Ana García Pérez', 'Luis Martín Díaz'];
  const texto = 'Ana García coordinará el servicio. La consultora revisará los registros. Ana revisará el plan.';
  const porRoles = hallazgosDeCoherencia([texto], [], { equipo, porRoles: true });
  assert.deepEqual(
    porRoles.map((h) => [h.tipo, h.encontrado]),
    [['nombre', 'Ana García Pérez']],
    'nombre y apellido, sí; el nombre suelto, no',
  );
  assert.match(
    textoDeHallazgo(porRoles[0]!),
    /^Nombra a Ana García Pérez y el pliego pide el equipo por roles, sin nombres: escribe solo su rol/,
  );
  assert.deepEqual(hallazgosDeCoherencia([texto], [], { equipo }), [], 'sin la regla de roles, los nombres van');
  const roles: HechoCoherencia[] = [
    {
      clave: 'responsable',
      categoria: 'rol',
      sobre: 'responsable del servicio',
      valor: 'Ana García Pérez, responsable del servicio',
      palabras: ['responsable'],
    },
    {
      clave: 'consultora',
      categoria: 'rol',
      sobre: 'consultora de protección de datos',
      valor: 'Luis Martín Díaz, consultora de protección de datos',
      palabras: ['consultora'],
    },
  ];
  const cruzado = hallazgosDeCoherencia(
    ['Luis Martín, responsable del servicio, revisará cada lunes los registros.'],
    roles,
    { equipo },
  );
  assert.deepEqual(
    cruzado.map((h) => [h.tipo, h.encontrado]),
    [['contradiccion', 'Luis Martín Díaz, responsable del servicio']],
  );
});

test('should_warn_unknown_tool_but_not_block', () => {
  const hs = hallazgosDeCoherencia(
    ['Las consultas se registran en Jira y se avisa por Teams.'],
    [{ clave: 'tickets', categoria: 'herramienta', sobre: 'registro', valor: 'Microsoft Teams', palabras: ['avisa'] }],
    { herramientas: ['Gestor de tickets'] },
  );
  assert.deepEqual(
    hs.map((h) => [h.tipo, h.encontrado]),
    [['herramienta', 'jira']],
  );
});

// Una memoria del caso A en la redacción, con la estrategia de la fixture (horario 9:00-17:00, respuesta en 48 horas).
async function enRedaccion() {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(
    recibirEstrategia(
      db,
      nucleo().db,
      EstrategiaEntrada.parse(estrategiaCasoA({ memoria_id: p.memoria, version: p.version })),
      'oferta-licitaciones',
    ).error,
    null,
  );
  await trasLaEstrategia(p.memoria);
  const m = memoriaPorId(p.memoria);
  return { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
}
const conFrase = (n: number, numeros: { memoria_id: number; guion_id: number; version: number }, frase: string) => {
  const a = apartadoCasoA(n, numeros);
  a.bloques[0]!.parrafos.push(frase);
  return ApartadoEntrada.parse(a);
};
const dosRechazos = (recurso: string) => {
  const ins = nucleo().db.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('oferta-licitaciones', 'licitaciones_memoria_apartado', 'licitaciones', ?, 'error', ?)",
  );
  for (let i = 0; i < 2; i += 1) ins.run(recurso, new Date().toISOString());
};

test('should_reject_apartado_that_contradicts_the_facts_until_the_third_try', async () => {
  const n = await enRedaccion();
  const malo = conFrase(1, n, 'La atención de consultas será de lunes a viernes de 9:00 a 18:00, también en agosto.');
  const r = recibirApartado(db, malo, 'oferta-licitaciones', { revisar: true });
  assert.match(
    r.error?.message ?? '',
    /La hoja de hechos dice «L-V 9:00-17:00 \(hora de Canarias\)» para atención de consultas y aquí pone 9:00-18:00/,
  );
  dosRechazos(recursoApartado({ id: ID, version: n.version, apartado: 1 }));
  const tercero = recibirApartado(db, malo, 'oferta-licitaciones', { revisar: true });
  assert.equal(tercero.error, null, 'al tercer envío entra como aviso');
  assert.match(tercero.data!.avisos.join(' '), /La hoja de hechos dice «L-V 9:00-17:00/);
  const jira = recibirApartado(
    db,
    conFrase(2, n, 'Cada incidencia se registra en Jira con su prioridad y su responsable asignado.'),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.equal(jira.error, null, 'una herramienta ajena no bloquea');
  assert.match(jira.data!.avisos.join(' '), /Nombra «jira», que no está en las decisiones ni en la hoja de hechos/);
});

test('should_always_reject_a_team_name_when_the_team_goes_by_roles', async () => {
  const n = await enRedaccion();
  const fila = db.prepare('SELECT secciones FROM memoria_dossiers WHERE memoria_id = ?').get(n.memoria_id) as {
    secciones: string;
  };
  db.prepare('UPDATE memoria_dossiers SET secciones = ? WHERE memoria_id = ?').run(
    JSON.stringify({ ...JSON.parse(fila.secciones), equipo_por_roles: true }),
    n.memoria_id,
  );
  dosRechazos(recursoApartado({ id: ID, version: n.version, apartado: 1 }));
  const r = recibirApartado(
    db,
    conFrase(1, n, 'Ana García Pérez coordinará el servicio y será la interlocutora de la entidad.'),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.match(
    r.error?.message ?? '',
    /Nombra a Ana García Pérez y el pliego pide el equipo por roles, sin nombres/,
    'también en el tercer envío',
  );
});

test('should_store_the_document_findings_on_the_memoria', async () => {
  const n = await enRedaccion();
  dosRechazos(recursoApartado({ id: ID, version: n.version, apartado: 2 }));
  for (const k of [1, 3, 4])
    assert.equal(
      recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones', { revisar: true }).error,
      null,
    );
  assert.equal(
    recibirApartado(
      db,
      conFrase(2, n, 'La primera respuesta a cada consulta llegará en 72 horas desde su registro.'),
      'oferta-licitaciones',
      { revisar: true },
    ).error,
    null,
  );
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.equal(m.fase, 'critica');
  const hs = hallazgosDe(m);
  assert.ok(
    hs.some(
      (h) =>
        h.apartado === 2 && h.tipo === 'contradiccion' && h.hecho === 'respuesta_consultas' && h.encontrado === '72 h',
    ),
    JSON.stringify(hs),
  );
  assert.ok(
    hs.some((h) => h.apartado === 2 && h.tipo === 'entre_apartados'),
    'y frente a los otros apartados (48 horas)',
  );
});

test('should_accept_bold_and_italics_but_flag_other_markdown_marks', async () => {
  const { caracteresDe } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
  assert.equal(
    caracteresDe([{ parrafos: ['Plan con **hitos** y *fechas*.'] }]),
    'Plan con hitos y fechas.'.length,
    'las marcas no ocupan',
  );
  const n = await enRedaccion();
  const r = recibirApartado(
    db,
    conFrase(1, n, 'Consulte el [detalle](https://ejemplo.es) y el `codigo` del plan de trabajo mensual.'),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.match(
    r.error?.message ?? '',
    /Solo se admiten \*\*negrita\*\* y \*cursiva\*: estas marcas saldrían tal cual en el Word: «\[detalle\]\(https:\/\/ejemplo\.es\)», «`codigo`»/,
  );
  assert.equal(
    recibirApartado(
      db,
      conFrase(1, n, 'El plan fija **cuatro hitos** con *fechas cerradas* y responsable.'),
      'oferta-licitaciones',
      { revisar: true },
    ).error,
    null,
  );
});

test('should_match_anchor_by_whole_word_or_plural_never_by_a_fragment', () => {
  // Hay hallazgo solo si la frase lleva el ancla del hecho (y un valor que contradice su «48 horas»).
  const casa = (ancla: string, frase: string) =>
    hallazgosDeCoherencia([frase], [{ ...RESPUESTA, valor: '48 horas', palabras: [ancla] }]).length === 1;
  assert.equal(
    casa('consultas', 'La consulta se responde en 24 horas.'),
    true,
    'el ancla «consultas» casa con «consulta»',
  );
  assert.equal(casa('consultas', 'Las consultas se responden en 24 horas.'), true, 'y con «consultas»');
  assert.equal(casa('consultas', 'El consultor responde en 24 horas.'), false, 'no con «consultor»');
  assert.equal(casa('consultas', 'La consultoría responde en 24 horas.'), false, 'ni con «consultoría»');
  assert.equal(casa('consulta', 'Las consultas se responden en 24 horas.'), true, 'el singular casa con el plural');
  assert.equal(
    casa('tiempo de respuesta', 'El tiempo de respuesta es de 24 horas.'),
    true,
    'un ancla de varias palabras casa entera',
  );
  assert.equal(
    casa('tiempo de respuesta', 'El tiempo medio de respuesta es de 24 horas.'),
    false,
    'sin las palabras seguidas no casa',
  );
  assert.equal(casa('tiempo de respuesta', 'La respuesta tarda 24 horas.'), false, 'ni con solo una de ellas');
});

test('should_not_anchor_between_apartados_on_a_word_that_only_starts_like_the_anchor', () => {
  const textos = [
    'La consultoría de seguridad responde en 4 horas hábiles.',
    'El consultor tarda 24 horas en contestar.',
  ];
  assert.deepEqual(contradiccionesEntreApartados(textos), [], '«consultoría» y «consultor» no son el ancla «consulta»');
  const consultas = ['Cada consulta se contesta en 4 horas hábiles.', 'Las consultas se contestan en 24 horas.'];
  assert.deepEqual(
    contradiccionesEntreApartados(consultas).map((h) => [h.apartado, h.tipo]),
    [[2, 'entre_apartados']],
    'singular y plural sí son la misma ancla',
  );
});
