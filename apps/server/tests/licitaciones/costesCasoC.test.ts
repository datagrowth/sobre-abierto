// Prueba de aceptación de los compromisos con coste con la memoria sintética del caso C
// (fixtures/costes). Cada apartado pasa por compromisosDetallados con el perfil por
// defecto, el guion (con el alcance del PPT: 329 alumnas en 5 cursos) y los pasajes del pliego, y
// se compara con la tabla de referencia: los 14 compromisos casan por tipo y fragmento de cita.
// Si un patrón del catálogo cambia, aquí se ve si la tabla sigue saliendo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { perfilCostesPorDefecto } from '../../src/nucleo/perfilCostes.js';
import { textoComparable } from '../../src/dominios/licitaciones/temas.js';
import { raices } from '../../src/dominios/licitaciones/oferta/compromisosMemoria.js';
import {
  compromisosDetallados,
  type CompromisoDetallado,
  type GuionData,
} from '../../src/dominios/licitaciones/oferta/costesCompromisos.js';
import type { Pasaje } from '../../src/dominios/licitaciones/pasajes.js';

const DIR = path.join(import.meta.dirname, 'fixtures', 'costes');
const leer = <T>(n: string): T => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')) as T;

type Esperado = {
  id: string;
  fila: string;
  tipo: string;
  apartado: number;
  fragmento_cita: string;
  otras_citas: string[];
  banda: string | null;
  horas_min: number;
  horas_max: number;
  euros_min?: number;
  euros_max?: number;
  barata_contiene: string[];
};
type Tolerado = { id: string; tipo: string; fragmento_cita: string };
type Exigido = { id: string; fragmento_memoria: string };
type Firma = { revisado_por: string | null; fecha: string | null };
type Fixture = {
  compromisos: Esperado[];
  exigidos_revisados: Exigido[];
  extras_tolerados: Tolerado[];
  firma?: Partial<Record<'exigidos_revisados' | 'extras_tolerados', Firma>>;
};
type ConDiagnostico = { diagnostic: (mensaje: string) => void };
type Hallado = CompromisoDetallado & { apartado: number };

const memoria = leer<{ apartados: { n: number; texto: string }[] }>('casoC-memoria.json');
const guion = leer<{ datos: GuionData }>('casoC-guion.json').datos;
const pliego = leer<Pasaje[]>('casoC-pliego.json');
const esperado = leer<Fixture>('casoC-esperado.json');
const perfil = perfilCostesPorDefecto();
const PRESUPUESTO = 18557;

const hallados: Hallado[] = memoria.apartados.flatMap((a) =>
  compromisosDetallados(a.texto, perfil, guion, pliego).map((c) => ({ ...c, apartado: a.n })),
);

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[*_`«»]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const citaCon = (c: CompromisoDetallado, fragmento: string) =>
  c.apariciones.some((a) => comparable(a.cita).includes(comparable(fragmento)));

// Una frase puede comprometer dos cosas del mismo tipo («tutoría grabada y con resumen escrito»):
// entre las que llevan el fragmento, la que se llama como la fila de la tabla.
const parecido = (c: Hallado, nombre: string) => {
  const r = raices(nombre);
  return [...raices(c.texto)].filter((x) => r.has(x)).length;
};

// El hallazgo del mismo tipo que lleva el fragmento: primero en su apartado y con la cita principal.
function casar(e: {
  tipo: string;
  apartado?: number;
  fragmento_cita: string;
  otras_citas?: string[];
  fila?: string;
}): Hallado | null {
  const delTipo = hallados.filter((c) => c.tipo === e.tipo);
  const orden = [
    ...delTipo.filter((c) => c.apartado === e.apartado),
    ...delTipo.filter((c) => c.apartado !== e.apartado),
  ];
  const nombre = e.fila ?? e.fragmento_cita;
  for (const f of [e.fragmento_cita, ...(e.otras_citas ?? [])]) {
    const con = orden.filter((x) => citaCon(x, f));
    if (con.length) return con.reduce((a, b) => (parecido(b, nombre) > parecido(a, nombre) ? b : a));
  }
  return null;
}

const casados = new Map(esperado.compromisos.map((e) => [e.id, casar(e)]));
const tolerados = esperado.extras_tolerados.map(casar).filter((c) => c !== null);
const porId = (id: string): Hallado => {
  const c = casados.get(id);
  assert.ok(c, `no se encuentra el compromiso «${id}»`);
  return c;
};

// Cubierto: casa con la tabla o un tolerado, o repite en otro apartado uno que casa (mismo tipo y objeto).
function cubierto(c: Hallado): boolean {
  const cubiertos = [...casados.values(), ...tolerados].filter((x) => x !== null);
  return cubiertos.some(
    (x) =>
      x === c || (x.tipo === c.tipo && x.objeto === c.objeto && (c.tipo !== 'frecuencia_alta' || x.texto === c.texto)),
  );
}

// Una fila de las comprobaciones: ≥ 15 h o ≥ max(300 €, 2 % del presupuesto base) con el perfil por defecto.
const umbralEuros = Math.max(perfil.umbral_euros, perfil.umbral_pct_presupuesto * PRESUPUESTO);
const esCaro = (c: Hallado) => (c.horas ?? 0) >= perfil.umbral_horas || (c.euros ?? 0) >= umbralEuros;

test('should_find_at_least_12_of_14_reference_commitments_as_anadido', () => {
  // Arrange
  const ids = esperado.compromisos.map((e) => e.id);
  // Act
  const anadidos = ids.filter((id) => casados.get(id)?.clase === 'anadido');
  // Assert
  assert.equal(ids.length, 14);
  assert.ok(
    anadidos.length >= 12,
    `solo ${anadidos.length}/14: faltan ${ids.filter((id) => !anadidos.includes(id)).join(', ')}`,
  );
});

test('should_estimate_kits_between_4000_and_6000_euros', () => {
  // Arrange
  const kits = porId('kits');
  // Act
  const euros = kits.euros ?? 0;
  // Assert
  assert.ok(euros >= 4000 && euros <= 6000, `kits: ${euros} € (${kits.supuesto})`);
  assert.match(kits.supuesto, /189 alumnas/, 'huerto 69 + reparaciones 120, del PPT');
});

test('should_estimate_fixed_dedication_between_500_and_800_hours', () => {
  // Arrange
  const dedicacion = porId('dedicacion_fija');
  // Act
  const horas = dedicacion.horas ?? 0;
  // Assert
  assert.ok(horas >= 500 && horas <= 800, `dedicación: ${horas} h (${dedicacion.supuesto})`);
});

test('should_estimate_interviews_between_110_and_200_hours', () => {
  // Arrange
  const entrevistas = porId('entrevistas');
  // Act
  const horas = entrevistas.horas ?? 0;
  // Assert
  assert.ok(horas >= 110 && horas <= 200, `entrevistas: ${horas} h (${entrevistas.supuesto})`);
});

test('should_keep_other_commitments_in_their_cost_band', () => {
  // Arrange
  const conBanda = esperado.compromisos.filter((e) => e.banda !== null);
  // Act
  const fuera = conBanda.flatMap((e) => {
    const h = porId(e.id).horas ?? 0;
    return h >= e.horas_min && h <= e.horas_max
      ? []
      : [`${e.id}: ${h} h (banda ${e.banda}, ${e.horas_min}-${e.horas_max})`];
  });
  // Assert
  assert.ok(conBanda.length >= 10);
  assert.deepEqual(fuera, []);
});

// La aceptación pide la firma de una persona en cada lista: sin ella, el test pasa contra
// una propuesta que nadie revisó. Se avisa en la salida en vez de fallar (la firma no es de código).
function avisarSinFirma(t: ConDiagnostico, parte: 'exigidos_revisados' | 'extras_tolerados'): void {
  if (!esperado.firma?.[parte]?.revisado_por)
    t.diagnostic(
      `casoC-esperado.json: «${parte}» sin firmar (revisado_por: null). Falta la revisión de una persona antes de cerrar la prueba de aceptación.`,
    );
}

test('should_mark_zero_reviewed_exigidos_as_anadido', (t) => {
  // Arrange
  avisarSinFirma(t, 'exigidos_revisados');
  const anadidosSueltos = hallados.filter((c) => c.clase === 'anadido' && !cubierto(c));
  // Act
  const marcados = esperado.exigidos_revisados
    .filter((x) => anadidosSueltos.some((c) => citaCon(c, x.fragmento_memoria)))
    .map((x) => x.id);
  // Assert
  assert.ok(esperado.exigidos_revisados.length >= 10);
  assert.deepEqual(marcados, []);
});

test('should_not_flag_more_than_8_costly_anadidos_outside_expected_and_tolerated', (t) => {
  // Arrange
  avisarSinFirma(t, 'extras_tolerados');
  const sueltos = hallados.filter((c) => c.clase === 'anadido' && esCaro(c) && !cubierto(c));
  // Act: el mismo compromiso en dos apartados es un solo falso positivo.
  const distintos = [...new Set(sueltos.map((c) => `${c.tipo} · ${c.texto}`))];
  // Assert
  assert.ok(distintos.length <= 8, `${distintos.length} añadidos caros fuera de la tabla: ${distintos.join('; ')}`);
});

test('should_propose_a_cheaper_wording_for_each_matched_commitment', () => {
  // Arrange
  const casables = esperado.compromisos.filter((e) => casados.get(e.id));
  // Act
  const sinBarata = casables.filter(
    (e) => !e.barata_contiene.some((b) => comparable(porId(e.id).barata).includes(comparable(b))),
  );
  // Assert
  assert.deepEqual(
    sinBarata.map((e) => `${e.id}: «${porId(e.id).barata}»`),
    [],
  );
  for (const e of casables)
    assert.match(porId(e.id).instruccion, /no añadas compromisos con coste que el pliego no pide/);
});
