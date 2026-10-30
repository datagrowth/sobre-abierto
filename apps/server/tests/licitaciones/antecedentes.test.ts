// Antecedentes de una licitación: lectura de las fechas en el CODICE real (anuncio, periodo,
// inicio del contrato, órgano superior), normalización de títulos y órganos, reglas de
// edición, línea de tiempo e indicios de «licitación con nombre», contra una base con
// licitaciones realistas (órgano con NIF, órgano sin NIF, título con otro año, lotes y una
// licitación sin antecedentes).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import { entradas } from '../../src/dominios/licitaciones/placsp/atom.js';
import { mapearEntrada, type LicitacionData } from '../../src/dominios/licitaciones/placsp/mapper.js';
import { licitacion, type Sintetica } from '../helpers/sinteticas.js';
import {
  normalizarOrgano,
  palabrasObjeto,
  pesosDe,
  similitud,
  esDerivado,
} from '../../src/dominios/licitaciones/antecedentes/texto.js';
import { lugaresDe, otroLugar } from '../../src/dominios/licitaciones/antecedentes/lugares.js';
import {
  esEdicion,
  otroObjetoDelOrgano,
  restarDias,
  UMBRAL_PARECIDO,
} from '../../src/dominios/licitaciones/antecedentes/ediciones.js';
import { sumarDuracion, type Hito } from '../../src/dominios/licitaciones/antecedentes/linea.js';
import {
  indiciosHistoricos,
  indicioPlazo,
  indicioSolvencia,
  indiciosDePliego,
  nivelDe,
  sumar,
} from '../../src/dominios/licitaciones/antecedentes/indicios.js';
import { antecedentesDe, resumenAntecedentes } from '../../src/dominios/licitaciones/antecedentes/index.js';
import { FichaDatos, FichaEntrada } from '../../src/dominios/licitaciones/ficha.js';
import { coberturaDeFicha } from '../../src/dominios/licitaciones/fichaCobertura.js';
import { leerSkill } from '../helpers/skill.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antecedentes-'));
let db: Db;
let dir = 0;

beforeEach(() => {
  db?.close();
  dir += 1;
  db = abrirLicitaciones(path.join(tmp, String(dir)));
});

after(() => {
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mapear(f: string, id: string): LicitacionData {
  const fuente = f.startsWith('lotes-agregadas') || f.startsWith('agregadas') ? 'agregadas' : 'perfiles';
  const found = entradas(fs.readFileSync(path.join(FIX, f), 'utf8'))
    .map((e) => mapearEntrada(fuente, e).data)
    .find((d) => d?.id === id);
  assert.ok(found, `falta ${id} en ${f}`);
  return found;
}

function guardar(s: Sintetica): string {
  const l = licitacion(s);
  guardarLicitacion(db, l, 'historico');
  return l.id;
}

const INCUMBENTE = { nif: 'B85000001', nombre: 'Tributos Digitales SL' };

test('should_read_notice_date_planned_period_contract_start_and_parent_body_from_real_codice', () => {
  assert.equal(
    mapear('requisitos.atom', 'p-20435341').publicada_en,
    '2026-09-16',
    'primer anuncio DOC_CN, aunque salga en el perfil y en el DOUE',
  );
  assert.deepEqual(mapear('requisitos.atom', 'p-20602990').periodo, { inicio: '2026-12-01', fin: null });
  assert.equal(mapear('perfiles-pagina1.atom', 'p-18431943').resultados.find((r) => r.inicio)?.inicio, '2026-09-15');
  const agregada = mapear('lotes-agregadas.atom', 'a-20603673');
  assert.equal(agregada.publicada_en, '2026-10-01');
  assert.equal(agregada.organo.superior, 'Junta de Ejemplo');
  assert.equal(agregada.organo.dir3, 'A09999001');
});

test('should_identify_a_body_without_nif_by_its_entity_and_not_by_its_role', () => {
  assert.equal(
    normalizarOrgano('Junta de Gobierno Local', 'Ayuntamiento de Villaejemplo'),
    'ayuntamiento de villaejemplo',
  );
  assert.equal(normalizarOrgano('Alcaldía', 'Ayuntamiento de Villaejemplo'), 'ayuntamiento de villaejemplo');
  assert.equal(
    normalizarOrgano('Ayuntamiento de Vitoria-Gasteiz-Junta de Gobierno Local'),
    'ayuntamiento de vitoria gasteiz',
  );
  assert.equal(
    normalizarOrgano('OSAKIDETZA - Servicio Vasco de Salud -Director Gerente'),
    'osakidetza servicio vasco de salud',
  );
  assert.equal(normalizarOrgano('Metro de Madrid, S.A.'), 'metro de madrid sa');
  assert.equal(normalizarOrgano('Pleno'), null, 'un cargo sin superior no identifica a nadie');
});

// Nombres reales de las agregadas (dos meses de la PLACSP) que antes compartían clave entre
// entidades distintas, o que no casaban con su propia entidad.
test('should_not_mix_bodies_with_the_same_generic_name_and_another_parent', () => {
  const gipuzkoa = normalizarOrgano('Consejo de Gobierno Foral', 'Diputación Foral de Gipuzkoa');
  assert.equal(gipuzkoa, 'diputacion foral de gipuzkoa');
  assert.notEqual(gipuzkoa, normalizarOrgano('Consejo de Gobierno Foral', 'Diputación Foral de Álava'));
  assert.equal(normalizarOrgano('Director/a Gerente', 'Fundación BiscayTIK'), 'fundacion biscaytik');
  assert.equal(
    normalizarOrgano('Gerente/a', 'Instituto Foral de Asistencia Social de Bizkaia'),
    'instituto foral de asistencia social de bizkaia',
  );
  assert.equal(normalizarOrgano('Diputado/a General', 'Diputación Foral de Álava'), 'diputacion foral de alava');
  assert.equal(normalizarOrgano('junta Gobierno Local', 'Ayuntamiento de Villanorte'), 'ayuntamiento de villanorte');
  assert.equal(normalizarOrgano('Pleno del Ayuntamiento', 'Ayuntamiento de Villasur'), 'ayuntamiento de villasur');
  assert.equal(normalizarOrgano('Junta del Concejo', 'CONCEJO DE ZUHATZU'), 'concejo de zuhatzu');
  assert.equal(normalizarOrgano('Comité directivo', 'Consorcio Haurreskolak'), 'consorcio haurreskolak');
  assert.equal(normalizarOrgano('Presidente de la Cuadrilla', 'Cuadrilla de Ayala'), 'cuadrilla de ayala');
  for (const nombre of [
    'Alcaldía Ayuntamiento de Castejón',
    'ALCALDIA DE CASTEJÓN',
    'PLENO DE LA CORPORACIÓN MUNICIPAL DE CASTEJÓN',
    'AYUNTAMIENTO DE CASTEJÓN',
  ]) {
    assert.equal(normalizarOrgano(nombre, 'Ayuntamiento de Castejón'), 'ayuntamiento de castejon', nombre);
  }
  assert.equal(
    normalizarOrgano('Ajuntament de Palafolls', "Entitats de l'administració local"),
    'ajuntament de palafolls | entitats de ladministracio local',
    'nombre propio: con su superior',
  );
  assert.equal(
    normalizarOrgano('Dirección General de Servicios Sociales', 'Comunidad de La Rioja'),
    'direccion general de servicios sociales | comunidad de la rioja',
    'no junta todas las direcciones de la comunidad',
  );
});

test('should_compare_titles_without_years_file_numbers_or_stop_words', () => {
  const a = palabrasObjeto(
    'Exp. 2023/045 - Servicio de mantenimiento de la aplicación de gestión tributaria 2023-2024',
  );
  const b = palabrasObjeto('Servicios de mantenimiento de las aplicaciones de gestión tributaria (2025/2026)');
  assert.deepEqual([...a].sort(), ['aplicacion', 'gestion', 'mantenimiento', 'tributaria']);
  const pesos = pesosDe([a, b]);
  assert.equal(similitud(a, b, pesos), 1, 'cambian el año, el expediente y el plural');
  assert.equal(similitud(a, new Set(), pesos), 0);
  assert.ok(esDerivado('3º CBAM con Pfizer del acuerdo marco 2207/2022'));
  assert.ok(esDerivado('Contrato basado en el acuerdo marco de suministro de papel'));
  assert.ok(!esDerivado('Acuerdo marco de suministro de papel'));
});

test('should_weigh_down_words_the_same_body_repeats_in_every_title', () => {
  const docs = [
    'hospital universitario limpieza',
    'hospital universitario lavanderia',
    'hospital universitario catering',
    'hospital universitario vigilancia',
  ].map((t) => new Set(t.split(' ')));
  const pesos = pesosDe(docs);
  assert.ok(pesos('hospital') < pesos('limpieza'));
  assert.ok(
    similitud(docs[0]!, docs[1]!, pesos) < 0.5,
    'compartir el nombre del hospital no hace parecidos dos contratos',
  );
});

test('should_tell_apart_the_same_service_in_another_place_route_or_sector', () => {
  assert.ok(
    otroLugar(
      lugaresDe('Servicio de investigación privada en la provincia de Ourense'),
      lugaresDe('Servicio de investigación privada en Alicante'),
    ),
  );
  assert.ok(otroLugar(lugaresDe('Transporte escolar Ruta P-203'), lugaresDe('Transporte escolar ruta 2346S16004054N')));
  assert.ok(
    otroLugar(lugaresDe('Servicio en Castilla y León'), lugaresDe('Servicio en León')),
    'la comunidad no es la provincia',
  );
  assert.ok(
    !otroLugar(lugaresDe('Limpieza de la sede de Madrid y Toledo'), lugaresDe('Limpieza de la sede de Toledo')),
  );
  assert.ok(
    !otroLugar(lugaresDe('Limpieza de la sede de Madrid'), lugaresDe('Limpieza de la sede')),
    'si uno no nombra lugar, no se descarta',
  );
  assert.deepEqual([...lugaresDe('Contrato (Lote 2) de limpieza en Las Palmas de Gran Canaria')].sort(), [
    'lote:2',
    'lugar:las palmas',
  ]);
});

test('should_accept_an_edition_by_the_rules_of_similarity_cpv_and_amount', () => {
  const p = (similitud: number, cpv: string | null, importe: boolean | null, distinto = false) => ({
    similitud,
    cpv_comun: cpv,
    importe_parecido: importe,
    distinto_lugar: distinto,
  });
  assert.equal(esEdicion(p(0.75, null, false)), true, 'título casi igual aunque cambien CPV e importe');
  assert.equal(esEdicion(p(0.6, '72', true)), true);
  assert.equal(esEdicion(p(0.6, '72', null)), true, 'sin importe publicado no se descarta');
  assert.equal(esEdicion(p(0.6, null, true)), false, 'sin CPV común');
  assert.equal(esEdicion(p(0.6, '72', false)), false, 'importe de otro orden');
  assert.equal(esEdicion(p(0.6, '72', true, true)), false, 'cada uno con una palabra propia');
  assert.equal(esEdicion(p(0.49, '7226', true)), false);
});

test('should_estimate_the_contract_end_from_start_and_duration', () => {
  assert.equal(sumarDuracion('2024-01-01', { valor: 2, unidad: 'ANN' }), '2025-12-31');
  assert.equal(sumarDuracion('2024-03-15', { valor: 12, unidad: 'MON' }), '2025-03-14');
  assert.equal(sumarDuracion('2024-01-01', { valor: 10, unidad: 'DAY' }), '2024-01-10');
  assert.equal(sumarDuracion('2024-01-01', { valor: 1, unidad: 'XYZ' }), null);
  assert.equal(restarDias('2025-07-01', 180), '2025-01-02');
});

function hito(h: Partial<Hito>): Hito {
  return {
    licitacion_id: 'p-1',
    anio: '2023',
    fecha: '2023-03-01',
    expediente: 'E',
    titulo: 'T',
    url: null,
    estado: 'Resuelta',
    similitud: 1,
    cpv_comun: '72',
    lote: null,
    lote_nombre: null,
    presupuesto: 100_000,
    resultado: 'Formalizado',
    adjudicada: true,
    adjudicatario_nif: 'B1',
    adjudicatario_nombre: 'Uno SL',
    importe: 99_500,
    baja: 0.005,
    ofertas: 1,
    duracion: null,
    inicio: null,
    fin: null,
    fin_estimado: false,
    ...h,
  };
}

test('should_score_history_signals_with_explicit_rules', () => {
  const sinDatos: string[] = [];
  const hitos = [
    hito({
      licitacion_id: 'p-3',
      anio: '2023',
      fecha: '2023-03-01',
      inicio: '2023-07-01',
      fin: '2025-06-30',
      fin_estimado: true,
      ofertas: 2,
    }),
    hito({ licitacion_id: 'p-2', anio: '2021', fecha: '2021-03-01', ofertas: 1, baja: 0.01 }),
    hito({
      licitacion_id: 'p-1',
      anio: '2019',
      fecha: '2019-03-01',
      adjudicatario_nif: 'B2',
      adjudicatario_nombre: 'Otra SA',
      ofertas: 4,
      baja: 0.2,
    }),
  ];
  const indicios = indiciosHistoricos(hitos, '2025-07-01', sinDatos);
  const por = Object.fromEntries(indicios.map((i) => [i.codigo, i]));
  assert.equal(por['incumbente']?.peso, 2, 'dos ediciones seguidas: la de 2019 la ganó otra');
  assert.match(por['incumbente']?.dato ?? '', /Uno SL \(B1\) ganó las 2 últimas ediciones adjudicadas \(2023, 2021\)/);
  assert.equal(por['pocas_ofertas']?.peso, 1, 'una edición con una oferta');
  assert.equal(por['bajas_minimas']?.peso, 1, 'solo la de 2023: la de una oferta ya cuenta en pocas_ofertas');
  assert.match(por['bajas_minimas']?.dato ?? '', /baja mediana del 0,5 % en su adjudicación/);
  assert.match(por['continuidad']?.dato ?? '', /30\/06\/2025 \(estimado/);
  assert.deepEqual(sinDatos, []);
});

test('should_rate_as_low_a_single_previous_edition_won_with_one_offer', () => {
  const indicios = sumar(indiciosHistoricos([hito({ ofertas: 1, baja: 0.001 })], null, []), []);
  assert.deepEqual(
    indicios.indicios.map((i) => [i.codigo, i.peso]),
    [
      ['incumbente', 1],
      ['pocas_ofertas', 1],
    ],
    'la baja casi nula con una oferta es lo esperable: no suma otra vez',
  );
  assert.equal(indicios.nivel, 'bajo');
});

test('should_count_single_offers_by_lot_and_not_by_the_worst_lot_of_an_edition', () => {
  const lote = (licitacion_id: string, l: string, ofertas: number) =>
    hito({ licitacion_id, lote: l, ofertas, baja: 0.15, fecha: `${licitacion_id === 'p-2' ? '2023' : '2021'}-03-01` });
  const unLote = [
    lote('p-2', '1', 1),
    lote('p-2', '2', 5),
    lote('p-2', '3', 6),
    lote('p-1', '1', 1),
    lote('p-1', '2', 4),
    lote('p-1', '3', 7),
  ];
  assert.ok(
    !indiciosHistoricos(unLote, null, []).some((i) => i.codigo === 'pocas_ofertas'),
    'un lote de tres con una oferta no marca la edición',
  );
  const mayoria = [lote('p-2', '1', 1), lote('p-2', '2', 1), lote('p-2', '3', 6)];
  assert.equal(indiciosHistoricos(mayoria, null, []).find((i) => i.codigo === 'pocas_ofertas')?.peso, 1);
});

test('should_not_count_unit_price_awards_as_minimal_discounts', () => {
  const hitos = [
    hito({ baja: 0, ofertas: 5 }),
    hito({ licitacion_id: 'p-2', fecha: '2021-01-01', anio: '2021', baja: 0, ofertas: 6 }),
  ];
  assert.ok(
    !indiciosHistoricos(hitos, null, []).some((i) => i.codigo === 'bajas_minimas'),
    'baja 0 con varias ofertas: precio unitario, no una baja',
  );
});

const plazo = (p: Partial<Parameters<typeof indicioPlazo>[0]>) => ({
  publicada_en: '2025-09-01',
  fecha_limite: null,
  procedimiento: '1',
  tipo_contrato: '2',
  importe: 100_000,
  ...p,
});

test('should_score_only_deadlines_below_the_legal_minimum_of_each_procedure_and_contract_type', () => {
  const sinDatos: string[] = [];
  const ajustado = indicioPlazo(plazo({ fecha_limite: '2025-09-16T14:00:00' }), sinDatos);
  assert.deepEqual(
    [ajustado?.peso, ajustado?.titulo],
    [0, 'Plazo de presentación en el mínimo legal'],
    'en el mínimo es lo habitual: se muestra sin puntos',
  );
  assert.equal(indicioPlazo(plazo({ fecha_limite: '2025-09-10T14:00:00' }), sinDatos)?.peso, 2);
  assert.equal(indicioPlazo(plazo({ fecha_limite: '2025-10-15T14:00:00' }), sinDatos), null);
  assert.equal(
    indicioPlazo(plazo({ fecha_limite: '2025-09-05T14:00:00', procedimiento: '3' }), sinDatos),
    null,
    'negociado: no aplica',
  );
  assert.equal(indicioPlazo(plazo({ publicada_en: null, fecha_limite: '2025-09-05T14:00:00' }), sinDatos), null);
  assert.deepEqual(sinDatos, ['Plazo: la PLACSP no publica la fecha del anuncio o el fin de plazo.']);
});

test('should_use_26_days_for_open_works_and_the_simplified_minimums_by_amount', () => {
  const obra = indicioPlazo(plazo({ fecha_limite: '2025-09-21T14:00:00', tipo_contrato: '3', importe: 900_000 }), []);
  assert.equal(obra?.peso, 2, 'obra por abierto con 20 días: 6 por debajo de los 26');
  assert.match(obra?.explicacion ?? '', /26 días naturales \(art\. 156\.6 LCSP\)/);
  assert.equal(
    indicioPlazo(plazo({ fecha_limite: '2025-09-17T14:00:00', tipo_contrato: '3', importe: 900_000 }), [])?.peso,
    2,
    'con 16 días no está «en el mínimo»',
  );
  const simplificado = (dia: string, tipo: string, importe: number) =>
    indicioPlazo(
      plazo({ fecha_limite: `2025-09-${dia}T14:00:00`, procedimiento: '9', tipo_contrato: tipo, importe }),
      [],
    );
  assert.equal(simplificado('16', '2', 90_000)?.peso, 0, 'simplificado ordinario: 15 días (art. 159.3)');
  assert.equal(simplificado('10', '2', 90_000)?.peso, 2);
  assert.equal(simplificado('15', '2', 40_000)?.peso, 0, 'sumario: 10 días hábiles, unos 14 naturales (art. 159.6)');
  assert.equal(simplificado('08', '1', 40_000)?.peso, 0, 'sumario de suministros: 5 días hábiles (bienes corrientes)');
  assert.doesNotMatch(simplificado('10', '2', 90_000)?.explicacion ?? '', /solo cabe por urgencia/);
  const sinDatos: string[] = [];
  indicioPlazo(plazo({ fecha_limite: '2025-09-16T14:00:00', importe: 500_000 }), sinDatos);
  assert.match(sinDatos[0] ?? '', /regulación armonizada/);
});

const volumen = (umbral: number, valor: number | null, codigo = '5') => ({
  clase: 'financiera',
  codigo,
  umbral,
  valor,
});

test('should_flag_turnover_above_the_legal_cap_of_one_and_a_half_times_the_estimated_value', () => {
  const alta = indicioSolvencia({
    requisitos: [volumen(400_000, 240_000), volumen(1.5, 240_000)],
    duracion: { valor: 2, unidad: 'ANN' },
  });
  assert.match(alta?.dato ?? '', /400\.000 € de volumen anual de negocio: 1,7 veces el valor estimado \(240\.000 €\)/);
  assert.match(
    alta?.explicacion ?? '',
    /1,5 veces el valor estimado del contrato, salvo casos justificados \(art\. 87\.1\.a\)/,
  );
  assert.equal(
    indicioSolvencia({ requisitos: [volumen(300_000, 300_000)], duracion: { valor: 3, unidad: 'ANN' } }),
    null,
    '3 años y 300.000 €: pedir 300.000 € es legal y frecuente',
  );
  assert.equal(
    indicioSolvencia({ requisitos: [volumen(348_000, 231_575)], duracion: { valor: 1, unidad: 'ANN' } }),
    null,
    'exactamente 1,5 veces el valor estimado (redondeado)',
  );
  assert.equal(
    indicioSolvencia({ requisitos: [volumen(1.5, 10_000)], duracion: null }),
    null,
    'un ratio no es un importe',
  );
  assert.equal(
    indicioSolvencia({ requisitos: [volumen(400_000, null)], duracion: null }),
    null,
    'sin valor no se mide',
  );
});

test('should_flag_similar_works_above_twice_the_seventy_percent_reference', () => {
  const trabajos = (umbral: number) =>
    indicioSolvencia({ requisitos: [volumen(umbral, 300_000, 'OSR-COMPTASK')], duracion: { valor: 3, unidad: 'ANN' } });
  assert.equal(trabajos(130_000), null, '1,3 veces la anualidad media: por debajo del doble del 70 %');
  assert.match(
    trabajos(200_000)?.dato ?? '',
    /200\.000 € de trabajos similares \(importe anual\): 2 veces la anualidad media \(100\.000 €\)/,
  );
});

test('should_add_pliego_signals_with_a_cap_and_compute_the_level', () => {
  const senales = [
    {
      tipo: 'marca_o_compatibilidad' as const,
      descripcion: 'Exige compatibilidad con un producto concreto sin «o equivalente»',
      cita: 'compatible con SIGMA',
      pagina: 7,
    },
    { tipo: 'experiencia_especifica' as const, descripcion: 'Experiencia en el sistema actual del ayuntamiento' },
    { tipo: 'solvencia_a_medida' as const, descripcion: 'Tres contratos con el mismo software' },
    { tipo: 'otra' as const, descripcion: 'Plazo de implantación de una semana' },
  ];
  const pliego = indiciosDePliego(senales);
  assert.deepEqual(
    pliego.map((i) => i.peso),
    [2, 1, 1, 0],
    'máximo 4 puntos del pliego',
  );
  assert.match(pliego[0]?.dato ?? '', /«compatible con SIGMA» \(pág\. 7\)/);
  assert.equal(nivelDe(2), 'bajo');
  assert.equal(nivelDe(3), 'medio');
  assert.equal(nivelDe(5), 'alto');
  assert.equal(sumar(pliego, []).nivel, 'medio');
});

// Tres ediciones del mismo contrato (2019, 2021, 2023), ganadas las dos últimas por el mismo
// adjudicatario con una oferta y baja mínima; la nueva sale con el plazo justo y empieza al
// acabar la anterior. Alrededor, contratos del mismo órgano que no son ediciones.
function historiaConNombre(): string {
  guardar({
    titulo: 'Servicio de mantenimiento de la aplicación de gestión tributaria 2019-2020',
    publicada: '2019-02-10',
    ganadores: [{ nif: 'B85000009', nombre: 'Otra Consultora SA', importe: 95_000, ofertas: 5 }],
  });
  guardar({
    titulo: 'Exp. 2021/12 Mantenimiento de la aplicación de gestión tributaria (2021-2022)',
    publicada: '2021-02-10',
    ganadores: [{ ...INCUMBENTE, importe: 119_000, ofertas: 1 }],
  });
  guardar({
    titulo: 'Servicios de mantenimiento de las aplicaciones de gestión tributaria 2023-2024',
    publicada: '2023-02-10',
    ganadores: [{ ...INCUMBENTE, importe: 119_500, ofertas: 1, inicio: '2023-07-01' }],
  });
  guardar({
    titulo: 'Suministro de licencias de ofimática',
    publicada: '2023-05-02',
    cpv: '48000000',
    ganadores: [{ ...INCUMBENTE, importe: 30_000, ofertas: 3 }],
  });
  guardar({
    titulo: '2º contrato basado en el acuerdo marco de mantenimiento de la aplicación de gestión tributaria',
    publicada: '2024-01-15',
    procedimiento: '7',
  });
  guardar({
    titulo: 'Mantenimiento de la aplicación de gestión tributaria',
    publicada: '2023-03-01',
    organo: { nombre: 'Ayuntamiento de Villaoeste', nif: 'P0000015H' },
  });
  guardar({ titulo: 'Mantenimiento de la aplicación de gestión tributaria (refuerzo)', publicada: '2025-04-01' });
  return guardar({
    titulo: 'Mantenimiento de la aplicación de gestión tributaria 2025-2026',
    publicada: '2025-06-02',
    limite: '2025-06-17T14:00:00',
    inicio: '2025-07-01',
  });
}

test('should_build_the_timeline_of_previous_editions_of_the_same_body_and_object', () => {
  const id = historiaConNombre();
  const a = antecedentesDe(db, id, { limite: 12 });
  assert.equal(a.error, null);
  assert.deepEqual(
    a.data?.ediciones.map((h) => h.anio),
    ['2023', '2021', '2019'],
    'sin la de otro órgano, la derivada, otro objeto ni la de hace dos meses',
  );
  const ultima = a.data?.ediciones[0];
  assert.equal(ultima?.adjudicatario_nif, 'B85000001');
  assert.equal(ultima?.ofertas, 1);
  assert.equal(ultima?.baja, 0.0042);
  assert.deepEqual([ultima?.inicio, ultima?.fin, ultima?.fin_estimado], ['2023-07-01', '2025-06-30', true]);
  assert.match(ultima?.url ?? '', /^https:\/\/contrataciondelestado\.es\//);
  assert.equal(a.data?.licitacion.organo_por, 'mismo NIF del órgano');
});

test('should_rate_as_high_a_tender_with_a_repeated_winner_single_offers_tight_deadline_and_continuity', () => {
  const id = historiaConNombre();
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  const codigos = a?.indicios.indicios.map((i) => i.codigo) ?? [];
  assert.deepEqual(
    [...codigos].sort(),
    ['continuidad', 'incumbente', 'plazo_corto', 'pocas_ofertas'],
    'sin bajas mínimas: las dos las ganó con una sola oferta',
  );
  assert.equal(
    a?.indicios.indicios.find((i) => i.codigo === 'plazo_corto')?.peso,
    0,
    '15 días en un abierto: el mínimo, no suma',
  );
  assert.equal(a?.indicios.puntos, 5);
  assert.equal(a?.nivel, 'alto');
  assert.match(a?.nota ?? '', /Indicios, no pruebas/);
  const resumen = resumenAntecedentes(db, id).data;
  assert.equal(resumen?.nivel, 'alto');
  assert.match(resumen?.incumbente ?? '', /Tributos Digitales SL/);
});

test('should_find_editions_of_a_body_without_nif_by_dir3_or_entity_name', () => {
  const junta = { nombre: 'Junta de Gobierno Local', nif: null, superior: 'Ayuntamiento de Villaejemplo' };
  guardar({
    titulo: 'Servicio de limpieza de los colegios públicos',
    publicada: '2021-03-01',
    organo: junta,
    ganadores: [{ nif: 'B31000001', nombre: 'Limpiezas Ribera SL', importe: 80_000, ofertas: 2 }],
    cpv: '90911200',
  });
  guardar({
    titulo: 'Limpieza de colegios públicos municipales',
    publicada: '2023-03-01',
    organo: { nombre: 'Alcaldía', nif: null, superior: 'Ayuntamiento de Villaejemplo', dir3: 'L09999003' },
    cpv: '90911200',
  });
  guardar({
    titulo: 'Servicio de limpieza de los colegios públicos',
    publicada: '2023-03-01',
    organo: { ...junta, superior: 'Ayuntamiento de Villaeste' },
    cpv: '90911200',
  });
  const id = guardar({
    titulo: 'Servicio de limpieza de colegios públicos 2025',
    publicada: '2025-03-01',
    organo: { nombre: 'Concejalía de Educación', nif: null, dir3: 'L09999003' },
    cpv: '90911200',
  });
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  assert.equal(a?.ediciones.length, 1, 'por DIR3 encuentra la de la Alcaldía, que lo publicaba');
  const porNombre = guardar({
    titulo: 'Servicio de limpieza de los colegios públicos 2025-2026',
    publicada: '2025-03-02',
    organo: junta,
    cpv: '90911200',
  });
  const b = antecedentesDe(db, porNombre, { limite: 12 }).data;
  assert.deepEqual(
    b?.ediciones.map((h) => h.anio),
    ['2023', '2021'],
    'la Alcaldía y la Junta del mismo ayuntamiento; no la de Cortes',
  );
  assert.equal(
    b?.licitacion.organo_por,
    'mismo código DIR3 o mismo nombre de órgano (la plataforma no publica su NIF)',
  );
});

test('should_answer_without_editions_and_say_what_is_missing', () => {
  const id = guardar({
    titulo: 'Redacción del plan director de la red de saneamiento',
    publicada: '2025-05-05',
    limite: '2025-06-30T14:00:00',
  });
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  assert.deepEqual(a?.ediciones, []);
  assert.equal(a?.nivel, 'bajo');
  assert.ok(a?.indicios.sin_datos.some((s) => /No hay ediciones anteriores/.test(s)));
  assert.equal(antecedentesDe(db, 'p-0', { limite: 12 }).error?.code, 'not_found');
});

test('should_follow_each_lot_to_the_most_similar_lot_or_contract_of_previous_editions', () => {
  guardar({
    titulo: 'Servicios informáticos municipales (2 lotes)',
    publicada: '2023-01-20',
    cpv: '72000000',
    lotes: [
      { id: '1', nombre: 'Soporte de la sede electrónica', importe: 60_000 },
      { id: '2', nombre: 'Mantenimiento de la web municipal', importe: 40_000 },
    ],
    ganadores: [
      { nif: 'B11111111', nombre: 'Sede SL', importe: 59_000, ofertas: 2, lote: '1' },
      { nif: 'B22222222', nombre: 'Web SL', importe: 39_900, ofertas: 1, lote: '2' },
    ],
  });
  guardar({
    titulo: 'Mantenimiento de la web municipal',
    publicada: '2021-01-20',
    presupuesto: 35_000,
    cpv: '72000000',
    ganadores: [{ nif: 'B22222222', nombre: 'Web SL', importe: 34_950, ofertas: 1 }],
  });
  const id = guardar({
    titulo: 'Servicios informáticos municipales (2 lotes)',
    publicada: '2025-01-20',
    cpv: '72000000',
    lotes: [
      { id: '1', nombre: 'Mantenimiento de la web municipal', importe: 45_000 },
      { id: '2', nombre: 'Soporte de la sede electrónica', importe: 65_000 },
    ],
  });
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  const web = a?.lotes.find((l) => l.id === '1');
  assert.deepEqual(
    web?.ediciones.map((h) => [h.anio, h.lote, h.adjudicatario_nombre]),
    [
      ['2023', '2', 'Web SL'],
      ['2021', null, 'Web SL'],
    ],
  );
  assert.equal(web?.indicios.indicios.find((i) => i.codigo === 'incumbente')?.peso, 2);
  const sede = a?.lotes.find((l) => l.id === '2');
  assert.deepEqual(
    sede?.ediciones.map((h) => [h.lote, h.adjudicatario_nombre]),
    [['1', 'Sede SL']],
  );
  assert.equal(antecedentesDe(db, id, { lote: '2', limite: 12 }).data?.lotes.length, 1);
  assert.equal(antecedentesDe(db, id, { lote: '9', limite: 12 }).error?.code, 'invalid_input');
});

// p-91000020 (real): requisito general de 135.956 € de volumen de negocio, 0,7 veces el
// total; comparado con cada lote salía «8,1 veces». Solo el requisito propio del lote se mide contra el lote.
test('should_measure_general_solvency_against_the_whole_contract_also_in_each_lot', () => {
  const id = guardar({
    titulo: 'Suministro de material deportivo para las instalaciones municipales',
    publicada: '2025-05-05',
    limite: '2025-06-30T14:00:00',
    presupuesto: 194_222,
    lotes: [
      { id: '1', nombre: 'Material de gimnasio', importe: 16_800 },
      { id: '2', nombre: 'Material de piscina', importe: 42_500 },
      { id: '3', nombre: 'Equipamiento de pistas', importe: 134_922 },
    ],
    requisitos: [
      { clase: 'financiera', codigo: '5', descripcion: 'Volumen anual de negocio', umbral: 135_956, lote: null },
      {
        clase: 'financiera',
        codigo: '5',
        descripcion: 'Volumen anual de negocio del lote 1',
        umbral: 60_000,
        lote: '1',
      },
    ],
  });
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  const solvencia = (i: { indicios: { codigo: string }[] }) => i.indicios.some((x) => x.codigo === 'solvencia_alta');
  assert.equal(solvencia(a!.indicios), false, 'contrato: 0,7 veces');
  assert.deepEqual(
    a?.lotes.map((l) => [l.id, solvencia(l.indicios)]),
    [
      ['1', true],
      ['2', false],
      ['3', false],
    ],
    'solo el lote 1, por su propio requisito',
  );
  assert.match(
    a?.lotes[0]?.indicios.indicios.find((x) => x.codigo === 'solvencia_alta')?.dato ?? '',
    /60\.000 €.*3,6 veces el valor estimado \(16\.800 €\)/,
  );
  assert.ok(a?.indicios.sin_datos.some((s) => /no consta el valor estimado/.test(s)));
});

function aprobarFicha(id: string, senales: unknown[]): void {
  const datos = {
    resumen: 'Servicios del ayuntamiento en dos lotes durante dos años.',
    requisitos: [],
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Hay señales de pliego a medida.' },
    senales_pliego: senales,
  };
  assert.ok(FichaDatos.safeParse(datos).success);
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES (?, 'aprobada', ?, 'hermes', 'x', 'x')",
  ).run(id, JSON.stringify(datos));
}

test('should_count_a_pliego_signal_of_one_lot_only_in_that_lot', () => {
  const id = guardar({
    titulo: 'Servicios informáticos municipales (2 lotes)',
    publicada: '2025-01-20',
    limite: '2025-03-20T14:00:00',
    lotes: [
      { id: '1', nombre: 'Mantenimiento de la web municipal', importe: 45_000 },
      { id: '2', nombre: 'Soporte de la sede electrónica', importe: 65_000 },
    ],
  });
  aprobarFicha(id, [
    { tipo: 'experiencia_especifica', descripcion: 'Experiencia en el gestor de contenidos actual del ayuntamiento' },
    {
      tipo: 'marca_o_compatibilidad',
      descripcion: 'Compatibilidad obligatoria con la sede actual sin «o equivalente»',
      lote: '2',
      pagina: 9,
    },
  ]);
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  const pliego = (i: { indicios: { codigo: string }[] }) =>
    i.indicios.filter((x) => x.codigo.startsWith('pliego_')).map((x) => x.codigo);
  assert.deepEqual(pliego(a!.indicios), ['pliego_experiencia_especifica']);
  assert.deepEqual(pliego(a!.lotes[0]!.indicios), ['pliego_experiencia_especifica']);
  assert.deepEqual(pliego(a!.lotes[1]!.indicios).sort(), [
    'pliego_experiencia_especifica',
    'pliego_marca_o_compatibilidad',
  ]);
});

test('should_summarize_editions_incumbent_and_signals_from_the_same_scope', () => {
  for (const anio of ['2019', '2021', '2023']) {
    guardar({
      titulo: `Limpieza de los colegios públicos ${anio}`,
      publicada: `${anio}-03-01`,
      cpv: '90911200',
      ganadores: [{ nif: 'B31000009', nombre: 'Limpiezas X SL', importe: 50_000, ofertas: 1 }],
    });
  }
  const id = guardar({
    titulo: 'Servicios varios del ayuntamiento 2026',
    publicada: '2026-03-01',
    cpv: '90911200',
    lotes: [
      { id: '1', nombre: 'Limpieza de los colegios públicos', importe: 55_000 },
      { id: '2', nombre: 'Mantenimiento de jardines', importe: 30_000 },
    ],
  });
  const a = antecedentesDe(db, id, { limite: 12 }).data;
  assert.deepEqual(a?.ediciones, [], 'el título del contrato no dice de qué es');
  const r = resumenAntecedentes(db, id).data;
  assert.equal(r?.ambito, 'lote 1');
  assert.equal(r?.ediciones, 3, 'las del lote, no las 0 del contrato');
  assert.match(r?.incumbente ?? '', /Limpiezas X SL \(B31000009\) ganó las 3 últimas/);
});

test('should_keep_the_ficha_example_of_the_hermes_skill_valid_with_pliego_signals', () => {
  const md = leerSkill();
  const inicio = md.indexOf('```json', md.indexOf('Ejemplo (no añadas campos')) + '```json'.length;
  const ejemplo = JSON.parse(md.slice(inicio, md.indexOf('```', inicio))) as unknown;
  const r = FichaEntrada.safeParse(ejemplo);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data?.senales_pliego?.[0]?.tipo, 'juicio_valor_favorece');
  // El ejemplo enseña la ficha que se acepta a la primera: lista de temas completa y citas.
  assert.deepEqual(coberturaDeFicha(r.data.cobertura, r.data.requisitos, []).problemas, []);
  assert.ok(r.data.requisitos.length >= 10);
});

// CASO_B y CASO_F: «mismo órgano» marcaba adjudicaciones de objeto ajeno como si fueran ediciones.
test('should_count_a_same_body_award_as_an_edition_only_with_a_similar_object_and_cpv', () => {
  const del = (parecido: number | null, cpv_comun: string | null) =>
    otroObjetoDelOrgano({ mismo_organo: true, parecido, cpv_comun });

  assert.equal(del(UMBRAL_PARECIDO, '80'), false, 'en el umbral, cuenta como edición');
  assert.equal(del(UMBRAL_PARECIDO - 0.01, '805'), true);
  assert.equal(del(0.9, null), true, 'sin CPV en común no es la misma licitación');
  assert.equal(del(null, '80'), true, 'sin título que comparar no se puede dar por edición');
  assert.equal(
    otroObjetoDelOrgano({ mismo_organo: false, parecido: 0, cpv_comun: null }),
    false,
    'de otro órgano no es «otro objeto del mismo órgano»',
  );
});
