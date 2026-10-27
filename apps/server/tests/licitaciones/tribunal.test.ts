// Simulación de tribunal: la nota del crítico ciego con su margen y la fila de las comprobaciones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notaTribunal, textoNota } from '../../src/dominios/licitaciones/oferta/tribunal.js';
import { reglaTribunal } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasTribunal.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import type { CriticaGuardada } from '../../src/dominios/licitaciones/oferta/critica.js';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';

type J = Record<string, any>;
const escala = (...ps: number[]) => ps.map((puntos) => ({ puntos, descripcion: `Tramo de ${puntos}` }));
const MEMORIA = {
  archivo: 'Sobre B',
  titulo_documento: 'Memoria',
  limite_paginas: 20,
  advertencias: [],
  apartados: [
    { titulo: 'Metodología', puntos: 25, se_valorara: ['x'], escala: escala(0, 10, 18, 25) },
    { titulo: 'Plan de trabajo', puntos: 15, se_valorara: ['y'], escala: [] },
  ],
} as unknown as GuionBaseData['memoria'];

function critica(total: number, apartados: J[]): Pick<CriticaGuardada, 'datos' | 'total' | 'maximo'> {
  return { total, maximo: 40, datos: { resumen: 'r', apartados } as CriticaGuardada['datos'] };
}

test('should_give_the_score_with_its_margin_one_band_down', () => {
  // Arrange: el 1 en el tramo de 25 con 22; el 2 sin escala, 10
  const c = critica(32, [
    { apartado: 1, tramo: 25, puntos: 22 },
    { apartado: 2, tramo: 15, puntos: 10 },
  ]);

  // Act
  const t = notaTribunal(c, MEMORIA)!;

  // Assert: un tramo más abajo, el 1 se queda en 18; el 2 no tiene con qué bajar
  assert.deepEqual(t, { total: 32, maximo: 40, minimo: 28, bajo_umbral: false });
  assert.equal(textoNota(t), '32 de 40 (entre 28 y 32 si la mesa baja un tramo en cada apartado)');
});

test('should_flag_below_seventy_percent_of_the_value_judgement_points', () => {
  const t = notaTribunal(
    critica(27.5, [
      { apartado: 1, tramo: 18, puntos: 17.5 },
      { apartado: 2, tramo: 15, puntos: 10 },
    ]),
    MEMORIA,
  )!;
  assert.equal(t.bajo_umbral, true);
  assert.equal(t.minimo, 20);
});

test('should_not_score_a_non_valued_memory', () => {
  const noValorable = { ...MEMORIA!, valorable: false };
  assert.equal(notaTribunal(critica(1, [{ apartado: 1, tramo: 1, puntos: 1 }]), noValorable), null);
  assert.equal(notaTribunal(critica(1, []), null), null);
});

test('should_add_a_comprobaciones_risk_only_when_the_score_is_below_the_threshold', () => {
  const nota = (bajo: boolean) => ({ total: 20, maximo: 40, minimo: 15, bajo_umbral: bajo });
  const e = (bajo: boolean) =>
    ({ tribunal: [{ lote: '2', memoria_id: 5, version: 3, nota: nota(bajo) }] }) as unknown as EntradasComprobaciones;
  assert.deepEqual(reglaTribunal(e(false)), []);
  const [b] = reglaTribunal(e(true));
  assert.equal(b!.clave, 'memoria_tribunal:2');
  assert.equal(b!.gravedad, 'riesgo');
  assert.equal(
    b!.titulo,
    'El crítico ciego le da a la v3 20 de 40 (entre 15 y 20 si la mesa baja un tramo en cada apartado): menos del 70 % de los puntos de juicio de valor',
  );
});
