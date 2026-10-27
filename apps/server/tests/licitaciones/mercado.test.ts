// Mercado › Panorama y Vencimientos: trimestres seguidos aunque estén vacíos, volumen,
// tramos, órganos y quién gana con la cuota de la empresa; y «Avisarme cuando salga» hasta que la nueva
// licitación del órgano entra en Oportunidades como «renovación que seguías».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { guardarPerfilEmpresa } from '../../src/nucleo/empresa.js';
import { guardarOrganizacion } from '../../src/nucleo/organizaciones.js';
import {
  panorama,
  OpcionesPanorama,
  trimestreDe,
  trimestresEntre,
} from '../../src/dominios/licitaciones/indices/panorama.js';
import {
  dejarDeSeguirRenovacion,
  seguirRenovacion,
  vueltaRenovaciones,
} from '../../src/dominios/licitaciones/indices/renovaciones.js';
import { vencimientos, OpcionesVencimientos } from '../../src/dominios/licitaciones/indices/vencimientos.js';
import { listarOportunidades, Filtro } from '../../src/dominios/licitaciones/oportunidades.js';
import { FiltroRevision, listaRevision } from '../../src/dominios/licitaciones/revision.js';
import { licitacionSintetica, resultadoSintetico } from '../helpers/licitacion.js';

const AHORA = Date.now();
const DIA = 86_400_000;
const hace = (dias: number) => new Date(AHORA - dias * DIA).toISOString().slice(0, 10);
const ORGANO = { nombre: 'Cabildo de Isla Ejemplo', nif: 'P0000002F', dir3: null, ciudad: null };

function base() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercado-'));
  const dbNucleo = abrirNucleo(dir);
  return { db: abrirLicitaciones(dir), dbNucleo };
}

test('should_name_quarters_and_list_them_without_gaps', () => {
  assert.equal(trimestreDe('2026-10-23'), '2026-T4');
  assert.equal(trimestreDe('2026-01-01'), '2026-T1');
  assert.deepEqual(trimestresEntre('2025-11-10', '2026-07-01'), ['2025-T4', '2026-T1', '2026-T2', '2026-T3']);
});

test('should_sum_our_market_by_quarter_band_organ_and_winner_with_our_share', () => {
  const { db, dbNucleo } = base();
  assert.equal(guardarPerfilEmpresa(dbNucleo, { nif: 'A00000075', nombre: 'Analítica Ejemplo SL' }).error, null);
  guardarOrganizacion(dbNucleo, { nif: 'B12345674', nombre: 'SISTEMAS EJEMPLO SA', tipo: 'empresa' });
  const adj = (id: string, dias: number, nif: string, importe: number, ofertas: number, cpv = '72267000') =>
    guardarLicitacion(
      db,
      licitacionSintetica({
        id,
        cpvs: [cpv],
        organo: ORGANO,
        actualizada_en: `${hace(dias)}T10:00:00Z`,
        resultados: [
          resultadoSintetico({ fecha: hace(dias), adjudicatario_nif: nif, importe_sin_iva: importe, ofertas }),
        ],
      }),
    );
  adj('p-1', 30, 'B12345674', 90_000, 3);
  adj('p-2', 40, 'B12345674', 80_000, 1);
  adj('p-3', 200, 'A00000075', 30_000, 3);
  adj('p-4', 50, 'B12345674', 50_000, 0);
  adj('p-5', 60, 'B12345674', 500_000, 2, '45000000');
  adj('p-6', 900, 'B12345674', 70_000, 2);

  const p = panorama(db, OpcionesPanorama.parse({}), AHORA);

  assert.equal(p.n, 3, 'sin la de 0 ofertas (incidencia), las obras ni la de hace 900 días');
  assert.equal(p.importe, 200_000);
  assert.equal(p.trimestres.length >= 8, true);
  assert.equal(
    p.trimestres.reduce((s, t) => s + t.adjudicaciones, 0),
    3,
  );
  assert.deepEqual(
    p.tramos.filter((t) => t.adjudicaciones).map((t) => [t.tramo, t.adjudicaciones]),
    [
      ['1', 1],
      ['2-3', 2],
    ],
  );
  assert.deepEqual(
    p.organos.map((o) => [o.nombre, o.importe]),
    [['Cabildo de Isla Ejemplo', 200_000]],
  );
  assert.deepEqual(
    p.adjudicatarios.map((a) => [a.nombre, a.cuota, a.nosotros]),
    [
      ['Sistemas Ejemplo', 0.85, false],
      [null, 0.15, true],
    ],
  );
  assert.equal(p.nuestra_cuota?.cuota, 0.15);
});

test('should_bring_the_new_tender_of_a_followed_contract_into_opportunities', () => {
  const { db } = base();
  // Contrato de un año adjudicado hace 300 días: acaba en unos 65 días.
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-actual',
      cpvs: ['72267000'],
      organo: ORGANO,
      actualizada_en: `${hace(300)}T10:00:00Z`,
      duracion: { valor: 1, unidad: 'ANN' },
      resultados: [resultadoSintetico({ fecha: hace(300) })],
    }),
  );
  // Otra del mismo órgano y CPV que ya estaba abierta antes de pedir el aviso: no es la renovación.
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-previa',
      estado: 'PUB',
      cpvs: ['72267000'],
      organo: ORGANO,
      publicada_en: hace(100),
      resultados: [],
    }),
  );
  db.prepare("UPDATE licitaciones SET vista_en = '2000-01-01T00:00:00.000Z' WHERE id = 'p-previa'").run();
  assert.equal(seguirRenovacion(db, { licitacion_id: 'p-nada', lote: '' }, 1).error?.code, 'not_found');
  assert.equal(seguirRenovacion(db, { licitacion_id: 'p-actual', lote: '' }, 1).error, null);
  assert.equal(vencimientos(db, OpcionesVencimientos.parse({}), AHORA).items[0]?.avisar, true);
  assert.equal(vueltaRenovaciones(db), 0, 'aún no ha salido');

  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-otro-organo',
      estado: 'PUB',
      cpvs: ['72267000'],
      publicada_en: hace(1),
      resultados: [],
    }),
  );
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-obras',
      estado: 'PUB',
      cpvs: ['45000000'],
      organo: ORGANO,
      publicada_en: hace(1),
      resultados: [],
    }),
  );
  assert.equal(vueltaRenovaciones(db), 0, 'ni de otro órgano ni de otro CPV');

  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-nueva',
      estado: 'PUB',
      cpvs: ['72267100'],
      organo: ORGANO,
      publicada_en: hace(1),
      fecha_limite: `${hace(-20)}T14:00:00`,
      resultados: [],
    }),
  );
  assert.equal(vueltaRenovaciones(db), 1);
  assert.equal(vueltaRenovaciones(db), 0, 'una vez');
  const lista = listarOportunidades(db, Filtro.parse({ estados: ['nueva'] }), AHORA);
  const nueva = lista.items.find((o) => o.id === 'p-nueva');
  assert.equal(nueva?.renovacion_de, 'p-actual');
  assert.equal(nueva?.motivo_prefiltro, 'renovación que seguías');
  // También en la lista de Oportunidades de la web, con su marca.
  const revision = listaRevision(db, FiltroRevision.parse({}), AHORA, null, false);
  assert.equal(revision.items.find((o) => o.id === 'p-nueva')?.renovacion_de, 'p-actual');
  const evento = db.prepare("SELECT recurso FROM eventos WHERE tipo = 'licitacion.renovacion'").get() as {
    recurso: string;
  };
  assert.equal(evento.recurso, 'p-nueva');
  assert.equal(dejarDeSeguirRenovacion(db, { licitacion_id: 'p-actual', lote: '' }).error, null);
  assert.equal(dejarDeSeguirRenovacion(db, { licitacion_id: 'p-actual', lote: '' }).error?.code, 'not_found');
});

test('should_leave_out_of_the_market_amount_the_ceiling_of_a_framework_agreement_with_several_winners', () => {
  const { db } = base();
  const ganadora = (nif: string, importe: number, lote = '1') =>
    resultadoSintetico({ lote, fecha: hace(30), adjudicatario_nif: nif, importe_sin_iva: importe, ofertas: 12 });
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-am',
      cpvs: ['72267000'],
      presupuesto_sin_iva: null,
      organo: ORGANO,
      actualizada_en: `${hace(30)}T10:00:00Z`,
      resultados: [
        ganadora('B12345674', 5_000_000),
        ganadora('A00000075', 5_000_000),
        ganadora('B12345674', 60_000, '2'),
        ganadora('A00000075', 40_000, '2'),
      ],
    }),
  );

  const p = panorama(db, OpcionesPanorama.parse({}), AHORA);

  assert.equal(p.n, 4, 'las adjudicaciones del acuerdo marco siguen contando');
  assert.equal(p.importe, 100_000, 'el lote con importes distintos sí suma');
  assert.deepEqual(p.acuerdos_marco, { lotes: 1, adjudicaciones: 2 });
  assert.equal(
    p.trimestres.reduce((s, t) => s + t.importe, 0),
    100_000,
  );
});
