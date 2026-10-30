// Actas de expedientes ajenos: lectura por código del texto, elección del acta, qué
// licitaciones se leen, cuándo pasa a Hermes (con su tope) y qué acepta de Hermes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { ok, type Result } from '../../src/nucleo/result.js';
import { bastaLectura, licitadoresDeTexto, mejorActa } from '../../src/dominios/licitaciones/actasMercadoLectura.js';
import {
  actaMercadoLeida,
  actaMercadoParaHermes,
  candidataActa,
  guardarActaMercado,
  pedirHermes,
  reiniciarRitmoActas,
  resumenActasMercado,
  TIPO_ACTA_MERCADO,
  vueltaActasMercado,
  type LectorExpediente,
} from '../../src/dominios/licitaciones/actasMercado.js';
import { participacionesDe } from '../../src/dominios/licitaciones/participaciones.js';
import { licitacionSintetica, resultadoSintetico } from '../helpers/licitacion.js';

// La cola apunta la hora real al encolar: el tope de 24 h se mide contra ella.
const AHORA = Date.now();
const RECIENTE = new Date(AHORA - 200 * 86_400_000).toISOString().slice(0, 10);
const ACTA = `ACTA DE LA MESA DE CONTRATACIÓN DE VALORACIÓN DE OFERTAS
Órgano: Cabildo (Q0000001H)
Licitador | CIF | Oferta económica (IVA excluido) | Puntos
SISTEMAS EJEMPLO, S.A. | A-00.000.091 | 85.000,00 € | 45,5
ANALÍTICA EJEMPLO SL B12345674 79.500,50 € 50
Persona A, con DNI 12345678Z, oferta 90.000,00 euros
Empresa Municipal de Aguas SA
CIF: A00000075 queda excluida por no presentar el sobre 2
${'Texto del acta con la valoración de cada criterio. '.repeat(10)}`;

test('should_read_bidders_by_valid_nif_with_name_amount_and_exclusion', () => {
  const leidos = licitadoresDeTexto(ACTA, 'Q0000001H');
  assert.deepEqual(
    leidos.map((l) => [l.nif, l.nombre, l.importe, l.excluida]),
    [
      ['A00000091', 'SISTEMAS EJEMPLO, S.A.', 85_000, false],
      ['B12345674', 'ANALÍTICA EJEMPLO SL', 79_500.5, false],
      ['12345678Z', null, 90_000, false],
      ['A00000075', 'Empresa Municipal de Aguas SA', null, true],
    ],
  );
  assert.deepEqual(licitadoresDeTexto('Expediente 2026/0001234, 12.345.678 habitantes, B12345678 mal escrito'), []);
});

test('should_need_every_offer_the_placsp_counted_before_trusting_the_code', () => {
  const dos = licitadoresDeTexto(ACTA).slice(0, 2);
  assert.equal(bastaLectura(dos, 2), true);
  assert.equal(bastaLectura(dos, 3), false);
  assert.equal(bastaLectura(dos.slice(0, 1), null), false);
});

test('should_prefer_the_valuation_record_over_the_award_and_the_constitution', () => {
  const docs = [
    { nombre: 'Resolución de adjudicación', url: 'r', publicado: '2026-03-01' },
    { nombre: 'Acta de constitución de la mesa', url: 'c', publicado: '2026-02-01' },
    { nombre: 'Acta de la mesa de valoración', url: 'v', publicado: '2026-02-15' },
  ];
  assert.equal(mejorActa(docs)?.url, 'v');
  assert.equal(mejorActa([{ nombre: 'Pliego de prescripciones técnicas', url: 'p', publicado: null }]), null);
});

const PAGINA = (filas: string[]) =>
  `<table id="myTablaDetalleVISUOE"><tbody>${filas
    .map(
      (n, i) => `<tr class="rowClass1"><td>01/03/2026 10:0${i}</td>
  <td><span id="x:textStipo1PadreGen">${n}</span></td><td><a href="https://contrataciondelestado.es/doc/${i}" id="x:linkVerDocPadreGen"><img src="/x/lupa-icon.png" /></a></td></tr>`,
    )
    .join('')}</tbody></table>`;

function lector(paginas: Record<string, string[]>, texto = ACTA): LectorExpediente & { pedidas: string[] } {
  const pedidas: string[] = [];
  return {
    pedidas,
    pagina: async (url) => {
      pedidas.push(url);
      return ok(PAGINA(paginas[url] ?? []));
    },
    documento: async (url): Promise<Result<Buffer>> => ok(Buffer.from(url)),
    texto: async () => ok(texto),
  };
}

function bases() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actas-mercado-'));
  const dbNucleo = abrirNucleo(dir);
  return { db: abrirLicitaciones(dir), dbNucleo };
}

const ajena = (id: string, extra: Parameters<typeof licitacionSintetica>[0] = {}) =>
  licitacionSintetica({
    id,
    url: `https://contrataciondelestado.es/exp/${id}`,
    cpvs: ['72000000'],
    resultados: [resultadoSintetico({ ofertas: 4, fecha: RECIENTE })],
    ...extra,
  });

test('should_pick_awarded_tenders_of_our_market_with_competition_that_we_did_not_submit', () => {
  const { db } = bases();
  guardarLicitacion(db, ajena('p-sola', { resultados: [resultadoSintetico({ ofertas: 1, fecha: RECIENTE })] }));
  guardarLicitacion(db, ajena('p-obras', { cpvs: ['45000000'] }));
  guardarLicitacion(db, ajena('p-vieja', { resultados: [resultadoSintetico({ ofertas: 3, fecha: '2023-01-01' })] }));
  guardarLicitacion(db, ajena('p-nuestra'));
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES ('p-nuestra', 'presentada', 'x', 'x')",
  ).run();
  assert.equal(candidataActa(db, AHORA), null);
  guardarLicitacion(db, ajena('p-buena'));
  assert.equal(candidataActa(db, AHORA)?.id, 'p-buena');
});

test('should_save_bidders_read_by_code_and_not_ask_hermes_when_all_offers_are_there', async () => {
  const { db, dbNucleo } = bases();
  guardarLicitacion(db, ajena('p-1'));
  reiniciarRitmoActas();
  const l = lector({
    'https://contrataciondelestado.es/exp/p-1': ['Anuncio de adjudicación', 'Acta de la mesa de valoración'],
  });

  const estado = await vueltaActasMercado(db, dbNucleo, 5, l, AHORA);

  assert.equal(estado, 'leida');
  const filas = participacionesDe(db, 'p-1');
  assert.deepEqual(
    filas.map((f) => [f.empresa_nif, f.rol, f.fuente]),
    [
      ['B12345674', 'adjudicataria', 'acta'],
      ['A00000091', 'licitadora', 'acta'],
      ['12345678Z', 'licitadora', 'acta'],
      ['A00000075', 'excluida', 'acta'],
    ],
  );
  assert.equal(filas.find((f) => f.empresa_nif === '12345678Z')?.empresa_nombre, null);
  assert.equal((dbNucleo.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n, 0);
  assert.equal(await vueltaActasMercado(db, dbNucleo, 5, l, AHORA + 60_000), null, 'una cada diez minutos');
});

test('should_mark_without_record_and_retry_only_after_a_month', async () => {
  const { db, dbNucleo } = bases();
  guardarLicitacion(db, ajena('p-2'));
  reiniciarRitmoActas();
  assert.equal(await vueltaActasMercado(db, dbNucleo, 5, lector({}), AHORA), 'sin_acta');
  assert.equal(candidataActa(db, AHORA + 86_400_000), null);
  assert.equal(candidataActa(db, AHORA + 31 * 86_400_000)?.id, 'p-2');
});

test('should_send_multi_lot_records_to_hermes_within_the_daily_cap_and_accept_only_what_the_text_says', async () => {
  const { db, dbNucleo } = bases();
  const lotes = [
    resultadoSintetico({ lote: '1', ofertas: 3, fecha: RECIENTE }),
    resultadoSintetico({
      lote: '2',
      ofertas: 2,
      fecha: RECIENTE,
      adjudicatario_nif: 'A00000075',
      adjudicatario_nombre: 'Aguas SA',
    }),
  ];
  guardarLicitacion(db, ajena('p-3', { resultados: lotes }));
  guardarLicitacion(db, ajena('p-4', { resultados: lotes }));
  reiniciarRitmoActas();
  const l = lector({
    'https://contrataciondelestado.es/exp/p-3': ['Acta de valoración'],
    'https://contrataciondelestado.es/exp/p-4': ['Acta de valoración'],
  });

  assert.equal(await vueltaActasMercado(db, dbNucleo, 1, l, AHORA), 'pendiente_hermes');
  reiniciarRitmoActas();
  await vueltaActasMercado(db, dbNucleo, 1, l, AHORA + 60_000);
  const trabajos = dbNucleo.prepare('SELECT tipo, payload FROM trabajos_ia').all() as {
    tipo: string;
    payload: string;
  }[];
  assert.equal(trabajos.length, 1, 'tope de uno al día');
  assert.equal(trabajos[0]?.tipo, TIPO_ACTA_MERCADO);
  const id = (JSON.parse(trabajos[0]!.payload) as { id: string }).id;
  assert.equal(actaMercadoLeida(db, id), false);
  assert.equal(pedirHermes(db, dbNucleo, 1, AHORA + 25 * 3_600_000), 1, 'al día siguiente entra la otra');

  const vista = actaMercadoParaHermes(db, { id, desde: 0 });
  assert.match(String((vista.data as { texto: string }).texto), /SISTEMAS EJEMPLO/);
  const inventado = guardarActaMercado(db, {
    id,
    sin_datos: false,
    licitadores: [
      {
        nif: 'B12345674',
        nombre: 'Analítica Ejemplo',
        lote: '1',
        rol: 'adjudicataria',
        importe_ofertado: 79_500.5,
        puntos_tecnicos: 40,
        puntos_economicos: 50,
        motivo_exclusion: null,
      },
      {
        nif: 'B85000009',
        nombre: 'Otra',
        lote: '1',
        rol: 'licitadora',
        importe_ofertado: null,
        puntos_tecnicos: null,
        puntos_economicos: null,
        motivo_exclusion: null,
      },
      {
        nif: 'A00000091',
        nombre: 'Sistemas Ejemplo',
        lote: '7',
        rol: 'licitadora',
        importe_ofertado: null,
        puntos_tecnicos: null,
        puntos_economicos: null,
        motivo_exclusion: null,
      },
    ],
  });
  assert.equal(inventado.error?.code, 'invalid_input');
  assert.match(inventado.error?.message ?? '', /B85000009.*no está en el texto|no es válido/);
  assert.match(inventado.error?.message ?? '', /«7»/);

  const bien = guardarActaMercado(db, {
    id,
    sin_datos: false,
    licitadores: [
      {
        nif: 'B-12345674',
        nombre: 'Analítica Ejemplo',
        lote: '1',
        rol: 'adjudicataria',
        importe_ofertado: 79_500.5,
        puntos_tecnicos: 40,
        puntos_economicos: 50,
        motivo_exclusion: null,
      },
      {
        nif: 'A00000091',
        nombre: 'Sistemas Ejemplo',
        lote: '2',
        rol: 'licitadora',
        importe_ofertado: 85_000,
        puntos_tecnicos: 38,
        puntos_economicos: 45.5,
        motivo_exclusion: null,
      },
    ],
  });
  assert.equal(bien.data?.licitadores, 2);
  assert.equal(actaMercadoLeida(db, id), true);
  const ejemplo = participacionesDe(db, id).find((f) => f.empresa_nif === 'A00000091');
  assert.deepEqual([ejemplo?.lote, ejemplo?.puntos_tecnicos, ejemplo?.confianza], ['2', 38, 0.8]);
  assert.equal(guardarActaMercado(db, { id, sin_datos: true, licitadores: [] }).error?.code, 'conflicto');
  assert.equal(resumenActasMercado(db).por_estado['leida_hermes'], 1);
});

test('should_not_take_committee_members_or_signers_as_bidders', () => {
  const acta = `ACTA DE LA MESA DE CONTRATACIÓN
Presidenta: Dña. María López, DNI 12345678Z
Vocal: D. Pedro Ruiz (X1234567L)
Secretario: Juan Gómez 00000000T
Firmado por: 87654321X
Licitador | CIF | Oferta
SISTEMAS EJEMPLO, S.A. | A-00.000.091 | 85.000,00 €
Persona A, autónoma, NIF 11111111H, oferta 90.000,00 euros
Luis Martín 22222222J`;
  assert.deepEqual(
    licitadoresDeTexto(acta).map((l) => l.nif),
    ['A00000091', '11111111H'],
  );
});
