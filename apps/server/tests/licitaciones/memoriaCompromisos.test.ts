// Frontera por archivo (diagnóstico de la memoria técnica): un criterio automático al que nos
// acogemos y que el pliego manda acreditar en el MISMO archivo que la memoria (horas adicionales
// de formación, meses adicionales de soporte «identificados en el sobre técnico sin importes») se
// declara en ella con su valor; si va en otro archivo, sigue sin nombrarse. Guiones sintéticos
// sobre el del caso A: solo cambia en qué archivo se acredita cada mejora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { GUION_CASO_A } from './fixtures/casoA.js';

process.env.NODE_ENV = 'test';

const { compromisosDeLaMemoria, compromisosSinDeclarar, cifrasConUnidad } =
  await import('../../src/dominios/licitaciones/oferta/compromisosMemoria.js');
const { contextoDeFugas, detectarFugas } = await import('../../src/dominios/licitaciones/oferta/fugas.js');
const { obligaARehacer, textoDeHallazgo } = await import('../../src/dominios/licitaciones/oferta/hechos.js');
const { EstrategiaDatos, problemasDeEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');

const MEMORIA = GUION_CASO_A.memoria.archivo;
const OTRO = 'Archivo electrónico nº 2';
const FORMACION = 'Horas adicionales de formación al personal';
const SOPORTE = 'Meses adicionales de soporte tras la puesta en marcha';

// Las dos mejoras, acreditadas en el archivo que se diga, con sus tramos.
function guionCon(archivo: string) {
  const base = {
    como_se_acredita: 'Se identifican en la propuesta técnica, sin importes.',
    casilla_en: 'Propuesta técnica',
    archivo,
    documento: 'PCAP.pdf',
    pagina: 36,
  };
  return GuionBase.parse({
    ...GUION_CASO_A,
    automaticos: [
      {
        ...base,
        criterio: FORMACION,
        puntos: 2,
        marcas: ['horas adicionales de formación'],
        tramos: [
          { descripcion: '8 horas adicionales', puntos: 1, valor: '8' },
          { descripcion: '24 horas adicionales', puntos: 2, valor: '24' },
        ],
      },
      {
        ...base,
        criterio: SOPORTE,
        puntos: 2,
        marcas: ['meses adicionales de soporte'],
        tramos: [
          { descripcion: '2 meses adicionales', puntos: 1 },
          { descripcion: '4 meses adicionales', puntos: 2 },
        ],
      },
    ],
  });
}
const DECIDIDOS = [
  {
    criterio: FORMACION,
    nos_acogemos: true,
    tramo: '24 horas adicionales',
    nota: 'Las imparte la responsable del servicio.',
  },
  { criterio: SOPORTE, nos_acogemos: true, tramo: '4 meses adicionales' },
];
const DECLARA =
  'La empresa impartirá 24 horas de formación al personal en seis sesiones durante la semana 10. El soporte se amplía 4 meses, de lunes a viernes de 9:00 a 17:00.';

test('should_list_same_file_commitments_with_their_value_to_declare', () => {
  const cs = compromisosDeLaMemoria(guionCon(MEMORIA), DECIDIDOS);
  assert.deepEqual(
    cs.map((c) => [c.criterio, c.tramo, c.valor, c.cifras]),
    [
      [FORMACION, '24 horas adicionales', '24', ['24 h']],
      [SOPORTE, '4 meses adicionales', null, ['4 mes']],
    ],
  );
  assert.deepEqual(
    compromisosDeLaMemoria(
      guionCon(MEMORIA),
      DECIDIDOS.map((d) => ({ ...d, nos_acogemos: false })),
    ),
    [],
    'lo que no ofrecemos no se declara',
  );
  assert.deepEqual(cifrasConUnidad('24h, 24 horas y 4 meses; 10 %'), ['24 h', '4 mes', '10 %']);
});

test('should_not_check_a_value_when_the_tier_is_a_range', () => {
  const g = guionCon(MEMORIA);
  g.automaticos[1]!.tramos = [{ descripcion: '3 meses o más', puntos: 2 }];
  const [, soporte] = compromisosDeLaMemoria(g, [
    DECIDIDOS[0]!,
    { criterio: SOPORTE, nos_acogemos: true, tramo: '3 meses o más' },
  ]);
  assert.deepEqual(soporte!.cifras, [], '«o más» no dice el valor exacto: se pide declararlo, sin comprobar la cifra');
});

test('should_not_flag_a_commitment_declared_in_its_own_file_as_a_leak', () => {
  const ctx = contextoDeFugas({ guion: guionCon(MEMORIA), decididos: DECIDIDOS });
  assert.deepEqual(detectarFugas(DECLARA, ctx), [], 'el compromiso del propio sobre no es fuga');
  assert.deepEqual(
    detectarFugas('Ofrecemos 24 horas adicionales de formación por 1.200 € más IVA.', ctx).map((f) => f.tipo),
    ['importe'],
    'los importes siguen vigilados',
  );
});

test('should_keep_not_naming_the_improvement_when_it_goes_in_another_file', () => {
  const g = guionCon(OTRO);
  assert.deepEqual(compromisosDeLaMemoria(g, DECIDIDOS), [], 'en otro archivo no hay nada que declarar');
  const fugas = detectarFugas(
    'El personal recibirá 24 horas adicionales de formación.',
    contextoDeFugas({ guion: g, decididos: DECIDIDOS }),
  );
  assert.deepEqual(
    fugas.map((f) => [f.tipo, f.marca, f.archivo]),
    [['decidido', '24 horas', OTRO]],
    'y nombrar lo ofrecido sigue siendo fuga',
  );
});

test('should_block_when_a_same_file_commitment_value_is_missing_from_the_memoria', () => {
  const g = guionCon(MEMORIA);
  const cs = compromisosDeLaMemoria(g, DECIDIDOS);
  assert.deepEqual(compromisosSinDeclarar(['', DECLARA, '', ''], g, cs), [], 'declarado en cualquier apartado basta');
  assert.deepEqual(compromisosSinDeclarar(['', '', '', ''], g, cs), [], 'sin texto aún, nada que comprobar');
  const hs = compromisosSinDeclarar(
    [
      'El plan de trabajo dura doce semanas.',
      'Se forma al personal en sesiones prácticas.',
      'El soporte se amplía 4 meses.',
      '',
    ],
    g,
    cs,
  );
  assert.equal(hs.length, 1);
  assert.deepEqual(
    [hs[0]!.tipo, hs[0]!.hecho, hs[0]!.esperado, hs[0]!.apartado],
    ['compromiso', FORMACION, '24 horas', 3],
    'va al apartado que trata de la formación',
  );
  assert.equal(obligaARehacer(hs[0]!), true, 'es bloqueante: obliga a rehacer');
  assert.match(
    textoDeHallazgo(hs[0]!),
    /^La memoria no declara lo que ofrecemos en «Horas adicionales de formación al personal» \(24 horas\), que se acredita en este mismo archivo: decláralo con su valor y su plan .*sin importes\.$/,
  );
});

test('should_ask_for_the_same_file_commitment_in_the_strategy_fact_sheet', () => {
  const g = guionCon(MEMORIA);
  const ctx = {
    mem: g.memoria!,
    fugas: contextoDeFugas({ guion: g, decididos: DECIDIDOS }),
    porRoles: false,
    equipo: [],
    herramientas: [],
    compromisos: compromisosDeLaMemoria(g, DECIDIDOS),
  };
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  const e = EstrategiaDatos.parse(datos);
  const sin = problemasDeEstrategia(e, ctx);
  assert.equal(sin.blandos.filter((b) => /se acredita en esta memoria/.test(b)).length, 2, sin.blandos.join('\n'));
  e.hechos.push({
    clave: 'formacion_adicional',
    categoria: 'cifra',
    sobre: 'formación adicional al personal',
    valor: '24 horas en seis sesiones',
    palabras: ['formación'],
  });
  e.hechos.push({
    clave: 'soporte_adicional',
    categoria: 'plazo',
    sobre: 'soporte tras la puesta en marcha',
    valor: '4 meses',
    palabras: ['soporte'],
  });
  const con = problemasDeEstrategia(e, ctx);
  assert.deepEqual(
    [con.duros, con.blandos.filter((b) => /se acredita en esta memoria/.test(b))],
    [[], []],
    'con su valor en la hoja, ni fuga ni problema',
  );
});

test('should_read_figures_in_parentheses_in_words_and_with_thousands_separator', () => {
  assert.deepEqual(
    cifrasConUnidad('veinticuatro (24) horas y cuatro (4) meses; 1.000 horas').sort(),
    ['1000 h', '24 h', '4 mes'].sort(),
  );
  assert.deepEqual(
    cifrasConUnidad('La garantía se amplía un año adicional con dos sesiones.').sort(),
    ['1 ano', '2 sesion'].sort(),
  );
  const g = guionCon(MEMORIA);
  g.automaticos[0]!.tramos = [{ descripcion: '1.000 horas adicionales', puntos: 2, valor: '1000' }];
  const cs = compromisosDeLaMemoria(g, [
    { criterio: FORMACION, nos_acogemos: true, tramo: '1.000 horas adicionales' },
    DECIDIDOS[1]!,
  ]);
  assert.deepEqual(
    compromisosSinDeclarar(['Se imparten 1.000 horas de formación y cuatro (4) meses adicionales de soporte.'], g, cs),
    [],
    'declarados los dos',
  );
});

test('should_show_the_commitment_readable_and_accept_it_written_in_words', () => {
  const GARANTIA = 'Ampliación del plazo de garantía';
  const g = guionCon(MEMORIA);
  g.automaticos = [
    {
      ...g.automaticos[0]!,
      criterio: GARANTIA,
      marcas: ['garantía'],
      tramos: [{ descripcion: '1 año adicional', puntos: 2, valor: '1' }],
    },
  ];
  const cs = compromisosDeLaMemoria(g, [{ criterio: GARANTIA, nos_acogemos: true, tramo: '1 año adicional' }]);
  assert.deepEqual(
    compromisosSinDeclarar(['La garantía se amplía un año adicional.'], g, cs),
    [],
    'en letra también está declarado',
  );
  const [h] = compromisosSinDeclarar(['La garantía es la legal.'], g, cs);
  assert.equal(h!.esperado, '1 año', 'nunca la forma comparable («1 ano»)');
  assert.match(textoDeHallazgo(h!), /\(1 año\)/);
});
