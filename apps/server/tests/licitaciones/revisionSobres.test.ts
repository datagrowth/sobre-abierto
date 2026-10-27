// La Revisión por sobre y documento sobre las 5 ofertas reales de las comprobaciones: el mismo
// veredicto que las comprobaciones, cada fila de las comprobaciones una vez y en su sitio (el precio en la oferta
// económica de su lote, un criterio en su archivo, lo de la memoria en la memoria, la empresa en el
// DEUC), las firmas de cada sobre, la nota del crítico ciego por apartado y «Registrar» apagado
// mientras algo impida presentar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-sobres-'));
for (const d of ['salidas', 'conocimiento']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { memoriasDe } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { revisionPorSobres } = await import('../../src/dominios/licitaciones/oferta/revisionSobres.js');
const { OFERTAS_COMPROBACIONES, leerFixtureComprobaciones, sembrarFixture } =
  await import('../helpers/comprobacionesFixtures.js');

type Revision = NonNullable<ReturnType<typeof revisionPorSobres>['data']>;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Cada oferta se mira justo después de sembrarla, como en el banco e2e (personas y perfil son del núcleo).
const calculadas: Record<
  string,
  {
    id: string;
    ahora: number;
    revision: Revision;
    comprobaciones: NonNullable<ReturnType<typeof comprobacionesDe>['data']>;
  }
> = {};
for (const o of OFERTAS_COMPROBACIONES) {
  const f = leerFixtureComprobaciones(o);
  sembrarFixture(db, nucleo().db, f);
  const ahora = Date.parse(f.ahora);
  const r = revisionPorSobres(db, nucleo().db, f.id, ahora);
  assert.ok(r.data, r.error?.message);
  calculadas[o] = {
    id: f.id,
    ahora,
    revision: r.data,
    comprobaciones: comprobacionesDe(db, nucleo().db, f.id, ahora).data!,
  };
}

const todas = (r: Revision) => [
  ...r.generales,
  ...r.sobres.flatMap((s) => [...s.comprobaciones, ...s.documentos.flatMap((d) => d.comprobaciones)]),
];
const documentoCon = (r: Revision, clave: string) =>
  r.sobres.flatMap((s) => s.documentos).find((d) => d.comprobaciones.some((c) => c.clave === clave));
const sobreCon = (r: Revision, clave: string) => r.sobres.find((s) => s.comprobaciones.some((c) => c.clave === clave));

test('should_give_the_comprobaciones_verdict_and_place_each_comprobaciones_row_once', () => {
  for (const o of OFERTAS_COMPROBACIONES) {
    // Arrange
    const { revision, comprobaciones } = calculadas[o]!;

    // Act
    const claves = todas(revision).map((c) => c.clave);

    // Assert
    assert.deepEqual(revision.veredicto, comprobaciones.veredicto, o);
    for (const b of comprobaciones.bloqueos)
      assert.equal(claves.filter((k) => k === b.clave).length, 1, `${o}: ${b.clave}`);
    const impide = comprobaciones.bloqueos.some((b) => b.gravedad === 'impide' && b.estado === 'abierto');
    assert.equal(revision.puede_registrar, !impide, `${o}: Registrar sigue al «impide»`);
  }
});

test('should_put_price_and_annex_data_in_the_economic_offer_of_their_lot', () => {
  const { revision } = calculadas.casoE!;
  assert.equal(documentoCon(revision, 'precio:2')?.tipo, 'oferta_economica');
  assert.equal(documentoCon(revision, 'dato_anexo:-:impuesto')?.tipo, 'oferta_economica');
  const casoB = calculadas.casoB!.revision;
  assert.match(
    documentoCon(casoB, 'precio:1')?.nombre ?? '',
    /LOTE 1/,
    'el precio del lote 1, en la proposición del lote 1',
  );
});

test('should_put_criteria_in_their_envelope_and_memory_rows_in_the_memory', () => {
  const { revision } = calculadas.casoE!;
  assert.ok(
    sobreCon(revision, 'nos_acogemos:-:formatos_de_descarga_de_los_registros_de_actividad'),
    'el criterio, en el archivo donde va',
  );
  assert.equal(documentoCon(revision, 'memoria_promete:1:no_prometer')?.tipo, 'memoria');
  const casoC = calculadas.casoC!.revision;
  assert.equal(documentoCon(casoC, 'compromiso_caro:-:sesion_recurrente_consulta')?.tipo, 'memoria');
  assert.match(
    documentoCon(casoC, 'medios:3:topografia')?.nombre ?? '',
    /ADSCRIPCI/,
    'los medios, en el compromiso de adscripción',
  );
  assert.equal(documentoCon(casoC, 'obligatorio_condicionado:-:a3_d2')?.clave, 'a3-d2');
});

test('should_put_company_data_in_the_deuc_and_what_belongs_to_no_document_on_top', () => {
  assert.equal(documentoCon(calculadas.casoB!.revision, 'empresa:-:domicilio')?.tipo, 'deuc');
  const casoE = calculadas.casoE!.revision;
  assert.ok(
    casoE.generales.some((c) => c.clave === 'empresa:-:domicilio'),
    'sin DEUC en el guion, arriba',
  );
  assert.ok(casoE.generales.some((c) => c.clave === 'propuesta_posterior:-'));
});

test('should_ask_to_sign_each_envelope_that_requires_it', () => {
  const { revision } = calculadas.casoC!;
  const firmas = revision.sobres.map((s) => s.comprobaciones.find((c) => c.clave.startsWith('firma:')));
  assert.ok(
    firmas.every((f) => f?.estado === 'pendiente' && f.accion?.destino === 'kit_firma'),
    JSON.stringify(firmas),
  );
});

test('should_show_the_blind_critic_score_and_flag_weak_sections', () => {
  // Arrange: una crítica de la memoria de Villaejemplo con un apartado flojo
  const { id, ahora } = calculadas.casoC!;
  const m = memoriasDe(db, id).find((x) => !x.ensayo)!;
  const datos = {
    resumen: 'Le falta un calendario con fechas reales.',
    apartados: [
      {
        apartado: 1,
        tramo: 2,
        puntos: 2,
        cita: 'Cita literal de la memoria',
        motivos_para_bajar: [{ cita: 'cita', motivo: 'Sin fechas', arreglo: 'Añadir un calendario con fechas' }],
        falta: [],
      },
    ],
  };
  db.prepare(
    "INSERT INTO memoria_criticas (memoria_id, ronda, datos, total, maximo, independiente, ciega, avisos, agente, creada_en) VALUES (?, 0, ?, 20, 45, 1, 1, '[]', 'critico', 'x')",
  ).run(m.id, JSON.stringify(datos));

  // Act
  const r = revisionPorSobres(db, nucleo().db, id, ahora);

  // Assert
  const memoria = r.data!.sobres.flatMap((s) => s.documentos).find((d) => d.tipo === 'memoria')!;
  // Por debajo del 70 %, la nota es la fila del tribunal de las comprobaciones, con su margen y su acción; no se repite.
  assert.equal(
    memoria.comprobaciones.find((c) => c.clave === `critica:${m.id}`),
    undefined,
  );
  const nota = memoria.comprobaciones.find((c) => c.clave === 'memoria_tribunal:-');
  assert.equal(nota?.estado, 'riesgo');
  assert.match(
    nota!.titulo,
    /^El crítico ciego le da a la v\d+ 20 de 45 \(entre [\d,]+ y 20 si la mesa baja un tramo en cada apartado\): menos del 70 %/,
  );
  assert.equal(nota?.accion?.bloqueo, 'memoria_tribunal:-');
  const flojo = memoria.comprobaciones.find((c) => c.clave === `critica:${m.id}:1`);
  assert.equal(flojo?.estado, 'riesgo');
  assert.equal(flojo?.detalle, 'Añadir un calendario con fechas');
});

// Una crítica anterior al último apartado recibido no es del texto de ahora.
test('should_not_raise_the_comprobaciones_risk_with_a_critique_of_an_earlier_text', () => {
  // Arrange: la crítica de antes (20 de 45) queda de una fecha anterior al último apartado
  const { id, ahora } = calculadas.casoC!;
  const m = memoriasDe(db, id).find((x) => !x.ensayo)!;
  const hay = db
    .prepare("SELECT COUNT(*) AS n FROM memoria_apartados WHERE memoria_id = ? AND estado = 'recibido'")
    .get(m.id) as { n: number };
  assert.ok(hay.n > 0, 'la memoria de Villaejemplo tiene apartados recibidos');
  db.prepare(
    "UPDATE memoria_apartados SET recibido_en = '2026-10-10T10:00:00.000Z' WHERE memoria_id = ? AND estado = 'recibido'",
  ).run(m.id);
  db.prepare("UPDATE memoria_criticas SET creada_en = '2026-10-09T10:00:00.000Z' WHERE memoria_id = ?").run(m.id);

  // Act
  const r = revisionPorSobres(db, nucleo().db, id, ahora);

  // Assert
  const memoria = r.data!.sobres.flatMap((s) => s.documentos).find((d) => d.tipo === 'memoria')!;
  assert.equal(
    memoria.comprobaciones.some((c) => c.clave === 'memoria_tribunal:-'),
    false,
  );
  const nota = memoria.comprobaciones.find((c) => c.clave === `critica:${m.id}`);
  assert.equal(nota?.estado, 'riesgo');
  assert.match(nota!.titulo, /a un texto anterior \(algún apartado cambió después\): pide otra crítica$/);
});

test('should_count_by_state_and_take_accepted_risks_as_correct', () => {
  const { revision } = calculadas.casoE!;
  const c = revision.cuentas;
  assert.equal(c.correcto + c.riesgo + c.impide + c.pendiente, todas(revision).length);
});

test('should_need_a_guion', () => {
  const sinGuion = revisionPorSobres(db, nucleo().db, 'p-no-existe');
  assert.equal(sinGuion.error?.code, 'not_found');
});
