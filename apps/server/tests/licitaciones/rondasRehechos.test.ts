// «Actualizar» una memoria: la versión nueva copia palabra por palabra los apartados que
// no dependen del cambio. Si su crítica pide rondas, solo se reescriben los rehechos por el cambio;
// si lo que queda por mejorar está todo en los copiados, se ensambla con aviso.
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
import { APARTADOS, apartadoCasoA } from './fixtures/casoA.js';

const { limitarARehechos, SOLO_LO_AFECTADO } = await import('../../src/dominios/licitaciones/oferta/rondasMemoria.js');
const { rehechosDe, soloRehechos } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { CriticaEntrada, recibirCritica } = await import('../../src/dominios/licitaciones/oferta/critica.js');
const { HechosEntrada, recibirHechos } = await import('../../src/dominios/licitaciones/oferta/parcheHechos.js');

before(arrancar);
after(cerrar);

const conFases = (version_base: number | null, apartados_rehechos: string | null) => ({
  fase: 'critica' as const,
  version_base,
  apartados_rehechos,
});

test('should_limit_a_round_of_an_updated_memoria_to_the_redone_sections', () => {
  // Arrange
  const ronda = { tipo: 'ronda' as const, apartados: [1, 2, 4] };

  // Act
  const r = limitarARehechos(ronda, soloRehechos(conFases(3, '[2,3]')));

  // Assert
  assert.deepEqual(r, { tipo: 'ronda', apartados: [2] });
});

test('should_assemble_with_warning_when_only_copied_sections_would_be_rewritten', () => {
  // Arrange
  const ronda = { tipo: 'ronda' as const, apartados: [1, 4] };

  // Act
  const r = limitarARehechos(ronda, soloRehechos(conFases(3, '[2]')));

  // Assert
  assert.deepEqual(r, { tipo: 'ensamblar', motivo: SOLO_LO_AFECTADO, aviso: true });
});

test('should_not_limit_rounds_of_a_memoria_that_does_not_come_from_another_version', () => {
  const ronda = { tipo: 'ronda' as const, apartados: [1, 4] };

  assert.deepEqual(limitarARehechos(ronda, soloRehechos(conFases(null, null))), ronda);
  assert.equal(
    soloRehechos({ fase: null, version_base: 2, apartados_rehechos: '[1]' }),
    null,
    'una subida a mano no tiene rondas',
  );
});

test('should_leave_an_assembly_decision_untouched', () => {
  const ensamblar = { tipo: 'ensamblar' as const, motivo: 'Llega al umbral.', aviso: false };

  assert.deepEqual(limitarARehechos(ensamblar, [2]), ensamblar);
});

test('should_read_redone_sections_as_empty_when_malformed', () => {
  assert.deepEqual(rehechosDe({ apartados_rehechos: 'no es json' }), []);
  assert.deepEqual(rehechosDe({ apartados_rehechos: '{"a":1}' }), []);
  assert.deepEqual(rehechosDe({ apartados_rehechos: '[1,"2",3.5,4]' }), [1, 4]);
  assert.deepEqual(rehechosDe({ apartados_rehechos: null }), []);
});

// ── En la base: una versión «actualizada» que solo rehízo el apartado 2 (caso A) ──

type Numeros = { memoria_id: number; guion_id: number; version: number };

// Redactada entera y criticada en la ronda 0: el 1 en el máximo; el 2 con un motivo que cita el
// hecho «48 horas» (pide parche); el 3 y el 4 con un motivo cualquiera (pedirían otra ronda).
async function actualizadaEnCritica(rehechos: number[]): Promise<Numeros> {
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
  const n = { memoria_id: p.memoria, guion_id: memoriaPorId(p.memoria).guion_id, version: p.version };
  for (const k of [1, 2, 3, 4])
    assert.equal(recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones').error, null);
  db.prepare('UPDATE memorias SET version_base = ?, apartados_rehechos = ? WHERE id = ?').run(
    n.version,
    JSON.stringify(rehechos),
    n.memoria_id,
  );
  await trasLaEstrategia(p.memoria);
  const CITA = 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas';
  const SOBRE_48H = {
    cita: CITA,
    motivo: 'Un único plazo de 48 horas para todo no distingue prioridades.',
    arreglo: 'Fijar 4 horas para las urgentes y 24 horas para el resto.',
  };
  const OTRO = {
    cita: 'un indicador con meta mensual que revisará con la entidad',
    motivo: 'El indicador no tiene cifra.',
    arreglo: 'Fijar la meta del 95 % de consultas en plazo.',
  };
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 0,
    resumen: 'Plazos sin prioridades y cifras genéricas.',
    apartados: APARTADOS.map((a, i) => {
      const tramo = i === 0 ? a.escala.at(-1)! : a.escala.at(-2)!;
      return {
        apartado: i + 1,
        tramo,
        puntos: tramo,
        cita: CITA,
        motivos_para_bajar: i === 0 ? [] : i === 1 ? [SOBRE_48H] : [OTRO],
        falta: [],
      };
    }),
  });
  assert.equal(recibirCritica(db, c, 'critico-licitaciones', { revisar: true }).error, null);
  return n;
}

const pendientes = (n: Numeros) =>
  (
    db
      .prepare("SELECT apartado FROM memoria_apartados WHERE memoria_id = ? AND estado = 'pendiente' ORDER BY apartado")
      .all(n.memoria_id) as { apartado: number }[]
  ).map((f) => f.apartado);
const textos = (n: Numeros) =>
  db.prepare('SELECT apartado, datos FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado').all(n.memoria_id);

test('should_rewrite_only_the_redone_section_in_the_round_and_after_the_facts_patch', async () => {
  // Arrange
  const n = await actualizadaEnCritica([2]);
  const copiados = textos(n);

  // Act: la crítica pide ronda (2, 3 y 4) con parche del hecho «48 horas», y el hecho cambia.
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const enLaRonda = pendientes(n);
  const r = recibirHechos(
    db,
    HechosEntrada.parse({
      id: ID,
      memoria_id: n.memoria_id,
      ronda: 1,
      hechos: [
        {
          clave: 'respuesta_consultas',
          valor: '4 horas (urgentes) y 24 horas (resto)',
          motivo: 'El crítico pide prioridades.',
        },
      ],
    }),
    'oferta-licitaciones',
    { revisar: true },
  );

  // Assert: solo el 2; el 1, el 3 y el 4 siguen con el texto copiado de la base.
  assert.deepEqual([memoriaPorId(n.memoria_id).fase, memoriaPorId(n.memoria_id).ronda], ['hechos', 1]);
  assert.deepEqual(enLaRonda, [2]);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(pendientes(n), [2], 'el 1 usa el hecho, pero es copiado: no se reescribe');
  const ahora = textos(n) as { apartado: number; datos: string }[];
  for (const k of [1, 3, 4]) assert.equal(ahora[k - 1]!.datos, (copiados as { datos: string }[])[k - 1]!.datos);
});

test('should_assemble_instead_of_a_round_when_only_copied_sections_are_weak', async () => {
  // Arrange: la versión solo rehízo el 1, que la crítica deja en el máximo.
  const n = await actualizadaEnCritica([1]);

  // Act
  await avanzarMemoria(nucleo().db, db, n.memoria_id);

  // Assert
  const m = memoriaPorId(n.memoria_id) as unknown as { ronda: number; avisos: string; fase: string | null };
  assert.equal(m.ronda, 0);
  assert.deepEqual(pendientes(n), []);
  assert.ok((JSON.parse(m.avisos) as string[]).includes(SOLO_LO_AFECTADO), m.avisos);
});
