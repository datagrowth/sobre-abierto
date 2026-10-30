// Prueba hacia atrás de los índices: el resumen calculado a mano, el texto que se publica
// y la vuelta mensual sobre una base sintética (solo con lo anterior a cada adjudicación).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import {
  casosDePrueba,
  evaluarCaso,
  historialAcierto,
  reiniciarPruebaAcierto,
  resumirAcierto,
  textoAcierto,
  ultimoAcierto,
  vueltaAcierto,
} from '../../src/dominios/licitaciones/indices/acierto.js';
import { indicesDeLicitacion } from '../../src/dominios/licitaciones/indices/index.js';
import { licitacionSintetica, resultadoSintetico } from '../helpers/licitacion.js';

const DIA = 86_400_000;

test('should_summarise_mean_absolute_error_bias_and_range_coverage_by_index', () => {
  const r = resumirAcierto([
    { ofertas: { esperado: 3, p25: 2, p75: 4, real: 5 }, baja: { esperado: 0.1, p25: 0.05, p75: 0.12, real: 0.15 } },
    { ofertas: { esperado: 4, p25: 3, p75: 5, real: 4 }, baja: { esperado: 0.2, p25: 0.1, p75: 0.3, real: null } },
    {
      ofertas: { esperado: null, p25: null, p75: null, real: 2 },
      baja: { esperado: null, p25: null, p75: null, real: 0.1 },
    },
  ]);
  assert.deepEqual(r, [
    { indice: 'ofertas', n: 2, error_absoluto_medio: 1, cobertura_rango: 0.5, sesgo: -1 },
    { indice: 'baja', n: 1, error_absoluto_medio: 0.05, cobertura_rango: 0, sesgo: -0.05 },
  ]);
  assert.deepEqual(resumirAcierto([])[0], {
    indice: 'ofertas',
    n: 0,
    error_absoluto_medio: null,
    cobertura_rango: null,
    sesgo: null,
  });
});

test('should_say_how_far_each_index_deviates_in_points_or_offers', () => {
  assert.equal(
    textoAcierto({ indice: 'baja', n: 120, error_absoluto_medio: 0.058, cobertura_rango: 0.48, sesgo: 0 }),
    'La baja esperada se desvía de media 5,8 puntos (prueba hacia atrás, 12 meses, n = 120)',
  );
  assert.equal(
    textoAcierto({ indice: 'ofertas', n: 90, error_absoluto_medio: 1.42, cobertura_rango: 0.5, sesgo: 0 }),
    'Las ofertas esperadas se desvían de media 1,4 ofertas (prueba hacia atrás, 12 meses, n = 90)',
  );
  assert.equal(
    textoAcierto({ indice: 'baja', n: 0, error_absoluto_medio: null, cobertura_rango: null, sesgo: null }),
    null,
  );
});

test('should_backtest_once_a_month_with_only_what_was_known_before_each_award', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acierto-'));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  // A las 3:00 UTC ya son las 4:00 o las 5:00 en la península.
  const ahora = Date.parse(`${new Date().toISOString().slice(0, 10)}T03:00:00Z`);
  const fecha = (dias: number) => new Date(ahora - dias * DIA).toISOString().slice(0, 10);
  for (let i = 0; i < 40; i++) {
    guardarLicitacion(
      db,
      licitacionSintetica({
        id: `p-${i}`,
        cpvs: ['72267000'],
        actualizada_en: `${fecha(20 + i * 15)}T10:00:00Z`,
        resultados: [
          resultadoSintetico({
            fecha: fecha(20 + i * 15),
            ofertas: 2 + (i % 4),
            importe_sin_iva: 100_000 * (1 - 0.05 * (1 + (i % 4))),
          }),
        ],
      }),
    );
  }
  guardarLicitacion(
    db,
    licitacionSintetica({ id: 'p-obras', cpvs: ['45000000'], resultados: [resultadoSintetico({ fecha: fecha(30) })] }),
  );
  // Con 0 ofertas (incidencia de calidad): no se evalúa.
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-cero',
      cpvs: ['72267000'],
      resultados: [resultadoSintetico({ fecha: fecha(25), ofertas: 0 })],
    }),
  );

  const casos = casosDePrueba(db, ahora);
  assert.equal(casos.length, 24, 'los de los últimos 12 meses y de nuestros CPV');
  assert.notEqual(evaluarCaso(db, casos[0]!).ofertas.esperado, null);
  const masAntigua = evaluarCaso(db, { ...casos[0]!, licitacion_id: 'p-39', fecha: fecha(20 + 39 * 15) });
  assert.equal(masAntigua.ofertas.esperado, null, 'la más antigua no tiene nada anterior en la base');

  reiniciarPruebaAcierto();
  assert.equal(vueltaAcierto(db, ahora), null);
  assert.equal(vueltaAcierto(db, ahora + 60_000), null);
  const mes = vueltaAcierto(db, ahora + 120_000);
  assert.match(mes ?? '', /^\d{4}-\d{2}$/);
  const u = ultimoAcierto(db);
  assert.ok((u.ofertas?.n ?? 0) > 0);
  assert.ok((u.baja?.cobertura_rango ?? -1) >= 0);
  assert.match(u.baja?.texto ?? '', /^La baja esperada se desvía de media/);
  assert.equal(vueltaAcierto(db, ahora + 180_000), null, 'una vez al mes');
  assert.equal(historialAcierto(db).length, 2);

  guardarLicitacion(db, licitacionSintetica({ id: 'p-abierta', estado: 'PUB', cpvs: ['72267000'], resultados: [] }));
  assert.equal(indicesDeLicitacion(db, 'p-abierta', {}, ahora).data?.acierto.baja?.mes, mes);
});
