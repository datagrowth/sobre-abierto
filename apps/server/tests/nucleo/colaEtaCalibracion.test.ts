// Calibración de la hora estimada con duraciones reales: el fixture son las duraciones en
// minutos (redondeadas a 0,1 y ordenadas) de los trabajos completados de una semana de producción,
// por tipo: sin fechas, recurso ni métricas, para no dejar en el repo cuándo se trabajó en cada
// oferta. Las filas se generan aquí. Cada trabajo se estima SIN él (leave-one-out) y se mira si su
// fin real cae en el intervalo; si no, la hora estimada presumiría de una precisión que no tiene.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-eta-calib-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { contextoEta, detalleTrabajo } = await import('../../src/nucleo/colaEta.js');

type Muestra = { tipo: string; lanzado_en: string; actualizado_en: string };
const DURACIONES = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'cola', 'duraciones-7dias.json'), 'utf8'),
) as Record<string, number[]>;

const MIN_MUESTRAS_TIPO = 10;
const COBERTURA_MINIMA = 0.8;
const MIN_MS = 60_000;
// Instante fijo y sintético: cada trabajo acaba un minuto antes del anterior, todos dentro de los 7 días de la ventana.
const AHORA = Date.parse('2026-01-15T12:00:00.000Z');
const MUESTRAS: Muestra[] = Object.entries(DURACIONES)
  .flatMap(([tipo, minutos]) => minutos.map((min) => ({ tipo, min })))
  .map(({ tipo, min }, i) => {
    const fin = AHORA - (i + 1) * MIN_MS;
    return {
      tipo,
      lanzado_en: new Date(fin - min * MIN_MS).toISOString(),
      actualizado_en: new Date(fin).toISOString(),
    };
  });

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function porTipo(): Map<string, Muestra[]> {
  const out = new Map<string, Muestra[]>();
  for (const m of MUESTRAS) out.set(m.tipo, [...(out.get(m.tipo) ?? []), m]);
  return out;
}

function sembrar(db: ReturnType<typeof abrirNucleo>, muestras: Muestra[]): number[] {
  const ins =
    db.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, lanzado_en)
    VALUES (?, 'licitaciones', ?, '{}', 'completado', ?, ?, ?)`);
  return db.transaction(() =>
    muestras.map((m, j) =>
      Number(ins.run(m.tipo, `calib-${j}`, m.lanzado_en, m.actualizado_en, m.lanzado_en).lastInsertRowid),
    ),
  )();
}

/**
 * Cobertura leave-one-out de un tipo: cada trabajo pasa a «lanzado» (así no cuenta en las
 * duraciones) y se mira si su fin real cae en el intervalo estimado al lanzarlo.
 */
function cobertura(muestras: Muestra[]): number {
  const db = abrirNucleo(fs.mkdtempSync(path.join(tmp, 'db-')));
  try {
    const ids = sembrar(db, muestras);
    let dentro = 0;
    ids.forEach((id, i) => {
      db.prepare("UPDATE trabajos_ia SET estado = 'lanzado', actualizado_en = lanzado_en WHERE id = ?").run(id);
      // Más de un minuto entre consultas: si no, la memo de la cola devuelve las duraciones del anterior.
      const eta = detalleTrabajo(db, obtenerTrabajo(db, id)!, contextoEta(db, AHORA + i * 61_000, 2)).eta;
      const fin = Date.parse(muestras[i]!.actualizado_en);
      if (eta && fin >= Date.parse(eta.desde) && fin <= Date.parse(eta.hasta)) dentro += 1;
      db.prepare("UPDATE trabajos_ia SET estado = 'completado', actualizado_en = ? WHERE id = ?").run(
        muestras[i]!.actualizado_en,
        id,
      );
    });
    return dentro / muestras.length;
  } finally {
    db.close();
  }
}

test('should_place_at_least_80_percent_of_last_week_jobs_inside_their_estimated_interval', () => {
  const tipos = [...porTipo()].filter(([, m]) => m.length >= MIN_MUESTRAS_TIPO);
  assert.ok(tipos.length >= 3, 'el fixture debe tener varios tipos con muestras suficientes');
  // Conjunto, no tipo a tipo: con 13 muestras un solo fallo más baja del 80 % y no dice nada.
  const dentro = tipos.reduce((s, [, m]) => s + cobertura(m) * m.length, 0);
  const total = tipos.reduce((s, [, m]) => s + m.length, 0);
  assert.ok(
    dentro / total >= COBERTURA_MINIMA,
    `cobertura ${((dentro / total) * 100).toFixed(0)} % con ${total} trabajos`,
  );
});

test('should_skip_types_with_fewer_than_ten_samples', () => {
  const pocos = [...porTipo()].filter(([, m]) => m.length < MIN_MUESTRAS_TIPO);
  assert.ok(pocos.length > 0, 'el fixture debe incluir algún tipo con pocas muestras');
  for (const [tipo, muestras] of pocos) {
    assert.ok(muestras.length < MIN_MUESTRAS_TIPO, tipo);
  }
  const incluidos = [...porTipo()].filter(([, m]) => m.length >= MIN_MUESTRAS_TIPO).map(([t]) => t);
  assert.ok(pocos.every(([t]) => !incluidos.includes(t)));
});
