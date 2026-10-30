import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loteParaRegistrar,
  filasRegistroPaquete,
  leerRegistroPaquete,
  textoCopiaPaquete,
  estadoPaquete,
  resumenPaquete,
  incoherencias,
  problemasAgrupados,
} from './presentacionFormato.js';
import { OFERTA } from '../../tests/fixtures/ofertaFixtures.mjs';

// El caso de CASO_E: decisiones para los lotes 2, 6 y 4 con lotes de interés 2 y 4 y
// un precio por debajo del umbral del pliego. Preparación decía «Todo listo».
const LOTES_CASO_E =
  'Las decisiones son para los lotes 2, 6, 4 y vamos a los lotes 2, 4 (bloque Lotes del Resumen): guarda otra vez las decisiones o, si son otros, cámbialos antes en el bloque Lotes.';

const COHERENCIA_CASO_E = [
  { tipo: 'lotes_decisiones', gravedad: 'bloquea', donde: 'decisiones', mensaje: LOTES_CASO_E },
  {
    tipo: 'precio_anormal',
    gravedad: 'bloquea',
    donde: 'decisiones',
    mensaje:
      'El precio decidido está por debajo del umbral de anormalidad que fija el pliego (baja del 15 %: 93,71 € por alumno).',
  },
  {
    tipo: 'equipo',
    gravedad: 'aviso',
    donde: 'decisiones',
    mensaje: 'Nadie del equipo de las decisiones tiene el rol que exige este requisito excluyente de la ficha.',
  },
];

test('should_pick_the_lot_to_register', () => {
  assert.equal(loteParaRegistrar({ datos: { lotes: ['2'] } }, { lotes: [{ id: '1' }] }), '2');
  assert.equal(loteParaRegistrar({ datos: { lotes: ['1', '2'] } }, { lotes: [{ id: '3' }] }), '3');
  assert.equal(loteParaRegistrar(null, null), '');
});

test('should_list_incoherences_first_blocking_and_not_repeat_them_as_decision_problems', () => {
  const o = {
    ...OFERTA,
    coherencia: COHERENCIA_CASO_E,
    decisiones_problemas: [LOTES_CASO_E, 'No hay ningún colaborador con id 9 (o está inactivo).'],
  };
  assert.deepEqual(
    incoherencias(o).map((c) => c.tipo),
    ['lotes_decisiones', 'precio_anormal', 'equipo'],
  );
  assert.deepEqual(problemasAgrupados(o), ['Personas que ya no están en Colaboradores (1): id 9.']);
  assert.deepEqual(incoherencias(null), []);
});

test('should_summarize_the_package_and_say_its_state', () => {
  const paquete = {
    version: 2,
    ruta: 'Salidas/Licitaciones/x/PRESENTACION/v2 2026-10-14 1830',
    creado_en: '2026-10-14T16:30:00.000Z',
    bloqueos: 0,
    avisos: 1,
    desfasado: false,
  };
  assert.match(resumenPaquete(paquete), /^v2 · 14 oct 2026, \d\d:30 · sin bloqueos · 1 aviso$/);
  assert.match(resumenPaquete({ ...paquete, bloqueos: 3, avisos: 0 }), /· 3 bloqueos$/);
  assert.equal(estadoPaquete(null), 'sin');
});

test('el registro precargado desde el paquete da un cuerpo por lote, con el precio por unidad y la versión del paquete', () => {
  const registro = [
    { lote: '2', importe_ofertado: null, presupuesto: 110.25, unidad: 'alumno', precio_unitario: 100 },
    { lote: '4', importe_ofertado: 18000, presupuesto: 20000, unidad: null, precio_unitario: null },
  ];
  const filas = filasRegistroPaquete(registro);
  assert.deepEqual(
    filas.map((f) => f.valor),
    ['100', '18.000'],
  );
  assert.deepEqual(leerRegistroPaquete(filas, 2, '2026-10-15').cuerpos, [
    {
      lote: '2',
      precio_unitario: 100,
      unidad: 'alumno',
      importe_ofertado: null,
      presupuesto: 110.25,
      paquete_version: 2,
      presentada_en: '2026-10-15',
    },
    { lote: '4', importe_ofertado: 18000, presupuesto: 20000, paquete_version: 2, presentada_en: '2026-10-15' },
  ]);
  assert.match(
    leerRegistroPaquete([{ ...filas[0], valor: 'mucho' }], 2).error,
    /El precio por alumno del lote 2 es un número/,
  );
  assert.equal(
    textoCopiaPaquete({
      version: 2,
      copia: { estado: 'hecha', ruta: 'Presentadas/x/DOCUMENTACION PRESENTADA/v2', error: null },
    }),
    'Paquete v2 copiado en Presentadas/x/DOCUMENTACION PRESENTADA/v2.',
  );
  assert.match(
    textoCopiaPaquete({ version: 2, copia: { estado: 'error', ruta: null, error: 'Ya existe' } }),
    /no se pudo copiar a DOCUMENTACION PRESENTADA: Ya existe/,
  );
  assert.equal(textoCopiaPaquete({ version: 2, copia: null }), null);
});

test('should_group_problems_by_type_without_repeating_lists', () => {
  // CASO_D: un mensaje por criterio, cada uno con la lista entera del guion.
  const lista =
    'los que hay son «Mantenimiento adicional del campus», «Itinerarios de autoformación», «Ampliación de las sesiones de formación»';
  const o = {
    coherencia: [{ tipo: 'equipo', gravedad: 'aviso', mensaje: 'Ya lo dice la coherencia.' }],
    decisiones_problemas: [
      `El criterio «2B1.- Personalización del kit de bienvenida» no está en el guion vigente (v3): ${lista}.`,
      `El criterio «2B2.- Ediciones impresas adicionales» no está en el guion vigente (v3): ${lista}.`,
      `El criterio «2B2.- Ediciones impresas adicionales» no está en el guion vigente (v3): ${lista}.`,
      'Falta decidir 2 criterios automáticos: «Mantenimiento adicional del campus», «Itinerarios de autoformación» (lote 2).',
      'Elige el tramo de «Ampliación de las sesiones de formación» al que nos acogemos.',
      'Ya lo dice la coherencia.',
      'Algo que no tiene tipo.',
    ],
  };

  const grupos = problemasAgrupados(o);

  assert.deepEqual(grupos, [
    'Criterios sin decidir (2): «Mantenimiento adicional del campus» y «Itinerarios de autoformación» (lote 2).',
    'Criterios que cambiaron de nombre o ya no están en el guion (2): «2B1.- Personalización del kit de bienvenida» y «2B2.- Ediciones impresas adicionales».',
    'Criterios sin tramo elegido (1): «Ampliación de las sesiones de formación».',
    'Algo que no tiene tipo.',
  ]);
  assert.ok(
    grupos.every((g) => !g.includes('los que hay son')),
    'la lista del guion no se repite',
  );
  assert.deepEqual(problemasAgrupados(null), []);
});
