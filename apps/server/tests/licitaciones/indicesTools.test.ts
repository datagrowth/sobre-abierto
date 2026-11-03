// Herramientas MCP de los índices: las mismas cifras que la ficha (paridad), sin el DNI de
// las personas físicas, y quién se presentó de verdad a una licitación resuelta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { guardarParticipacion } from '../../src/dominios/licitaciones/participaciones.js';
import { indicesDeLicitacion } from '../../src/dominios/licitaciones/indices/index.js';
import { indicesParaAgente, licitadoresDeLicitacion } from '../../src/dominios/licitaciones/indices/tools.js';
import { licitacionSintetica, resultadoSintetico } from '../helpers/licitacion.js';

const reciente = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

function base() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indices-tools-'));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  for (let i = 0; i < 25; i++) {
    const persona = i < 3;
    guardarLicitacion(
      db,
      licitacionSintetica({
        id: `p-c${i}`,
        cpvs: ['72267000'],
        actualizada_en: `${reciente(50 + i)}T10:00:00Z`,
        resultados: [
          resultadoSintetico({
            fecha: reciente(50 + i),
            ofertas: 3,
            adjudicatario_nif: persona ? '12345678Z' : 'B00765438',
            adjudicatario_nombre: persona ? 'Persona A' : 'Sistemas Ejemplo SA',
          }),
        ],
      }),
    );
  }
  guardarParticipacion(db, {
    licitacion_id: 'p-c5',
    lote: '',
    empresa_nif: 'A00000075',
    empresa_nombre: 'ANALÍTICA EJEMPLO SL',
    rol: 'licitadora',
    importe_ofertado: 91_000,
    puntos_tecnicos: 40,
    puntos_economicos: 44,
    fuente: 'acta',
    confianza: 0.6,
  });
  guardarLicitacion(db, licitacionSintetica({ id: 'p-abierta', estado: 'PUB', cpvs: ['72267000'], resultados: [] }));
  return db;
}

test('should_give_hermes_the_same_figures_as_the_ficha_without_personal_ids', () => {
  const db = base();
  const ficha = indicesDeLicitacion(db, 'p-abierta').data!;
  const agente = indicesParaAgente(ficha);
  assert.equal(agente.resumen, ficha.resumen);
  assert.deepEqual(agente.competencia, ficha.competencia);
  assert.deepEqual(agente.baja, ficha.baja);
  assert.ok(ficha.licitadores.some((l) => l.nif === '12345678Z'));
  assert.ok(!JSON.stringify(agente).includes('12345678Z'), 'sin DNI');
  assert.ok(agente.licitadores.some((l) => l.nif === 'persona física'));
});

test('should_list_likely_bidders_and_who_actually_bid_on_a_resolved_tender', () => {
  const db = base();
  const r = licitadoresDeLicitacion(db, { id: 'p-c5' });
  assert.equal(r.error, null);
  assert.deepEqual(
    r.data!.presentados.map((p) => [p.nif, p.rol, p.fuente]),
    [
      ['B00765438', 'adjudicataria', 'placsp'],
      ['A00000075', 'licitadora', 'acta'],
    ],
  );
  assert.equal(r.data!.presentados[1]?.nombre, 'Analítica Ejemplo');
  assert.ok(r.data!.probables.length > 0);
  assert.equal(licitadoresDeLicitacion(db, { id: 'p-no-existe' }).error?.code, 'not_found');
});
