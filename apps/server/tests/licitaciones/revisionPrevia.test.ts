// Revisión previa al envío sobre las ofertas de fixtures/comprobaciones/ (seudonimizadas):
// se encola una vez por versión del paquete, nunca con el freno de elegibilidad puesto, y la cierra
// licitaciones_revision_previa con REVISION_PREVIA.md junto al paquete, sin pisar y sin importes.
// La base es CASO_D (lote 2) con domicilio y precio puestos, como en ofertaPaqueteAuto.test.ts.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-previa-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { generarPaquete } = await import('../../src/dominios/licitaciones/oferta/paquete.js');
const { frenoDeElegibilidad } = await import('../../src/dominios/licitaciones/oferta/frenoElegibilidad.js');
const { tarjetasDe } = await import('../../src/dominios/licitaciones/oferta/revisionHermes.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { aplicarAccionBloqueo } = await import('../../src/dominios/licitaciones/oferta/comprobacionesBloqueos.js');
const {
  TIPO_REVISION_PREVIA,
  cerrarRevisionPrevia,
  encolarRevisionPrevia,
  pedirRevisionPrevia,
  revisionPreviaDe,
  revisionPreviaHecha,
  revisionesPreviasAuto,
} = await import('../../src/dominios/licitaciones/oferta/revisionPrevia.js');
const { prioridadTrabajo } = await import('../../src/dominios/licitaciones/prioridadCola.js');
const { DURACION_MIN, plazoDe } = await import('../../src/dominios/licitaciones/oferta/plazo.js');
const { nombreTrabajo } = await import('../../src/dominios/licitaciones/oferta/hermesEnVivo.js');
const { registrarTrabajos } = await import('../../src/dominios/licitaciones/index.js');
const { agenteDeTipo } = await import('../../src/nucleo/colaTipos.js');
const { tiposSinPrioridad } = await import('../../src/nucleo/colaOrden.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type Agente = import('../../src/nucleo/agentes/registro.js').Agente;
type Trabajo = import('../../src/nucleo/colaTipos.js').Trabajo;
type Payload = import('../../src/dominios/licitaciones/oferta/revisionPrevia.js').PayloadRevisionPrevia;

iniciarNucleo();
const db = dbLicitaciones();
const CASO_D = leerFixtureComprobaciones('casoD');
const CASO_E = leerFixtureComprobaciones('casoE');
const AHORA = Date.parse(CASO_D.ahora);
const DOMICILIO = 'Calle La Marina 7, 38001 Santa Cruz de Tenerife';
const HERMES: Agente = { nombre: 'hermes', permisos: { licitaciones: 'proponer' } };
const c = () => ({ db, dbNucleo: nucleo().db, raices: raicesActuales() });

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function vaciar(): void {
  db.pragma('foreign_keys = OFF');
  const tablas = db
    .prepare(
      "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB 'busca_texto_*'",
    )
    .all() as { name: string }[];
  for (const { name } of tablas) db.prepare(`DELETE FROM main."${name}"`).run();
  db.pragma('foreign_keys = ON');
  for (const t of ['trabajos_ia', 'personas']) nucleo().db.prepare(`DELETE FROM ${t}`).run();
}

beforeEach(vaciar);

// CASO_D con domicilio y el precio del lote 2: sin freno ni «impide» abierto.
async function conPaquete(): Promise<{ id: string; version: number; ruta: string }> {
  const ofertas = [{ lote: '2', pendiente: false, importe: null, unitarios: [{ concepto: 'alumno', precio: 30 }] }];
  const perfil = { ...CASO_D.perfil, domicilio: DOMICILIO };
  sembrarFixture(db, nucleo().db, {
    ...CASO_D,
    perfil,
    decisiones: CASO_D.decisiones && { ...CASO_D.decisiones, datos: { ...CASO_D.decisiones.datos, ofertas } },
  });
  const r = await generarPaquete(c(), CASO_D.id, AHORA);
  assert.equal(r.error, null, r.error?.message);
  return { id: CASO_D.id, version: r.data!.version, ruta: r.data!.ruta };
}

const trabajos = () =>
  nucleo()
    .db.prepare('SELECT id, clave, payload, a_mano FROM trabajos_ia WHERE tipo = ?')
    .all(TIPO_REVISION_PREVIA) as { id: number; clave: string; payload: string; a_mano: number }[];
const absoluta = (ruta: string) => path.join(tmp, 'salidas', ...ruta.split('/').slice(1));

function proponer(id: string, clave: string, en: string, resumen: string): void {
  const citas = [
    {
      documento: 'PCAP.pdf',
      pagina: 4,
      texto: 'El presupuesto base es de 12.500 € por lote y se valorará la experiencia.',
    },
  ];
  db.prepare(
    "INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, propuesta_json, evidencia_json, quien, motivo, en) VALUES (?, ?, 'h', 'propuesta', ?, ?, 'hermes', NULL, ?)",
  ).run(
    id,
    clave,
    JSON.stringify({
      tipo: 'consulta_organo',
      resumen,
      datos: { tipo: 'consulta_organo', texto: 'x'.repeat(30) },
      campos: 1,
    }),
    JSON.stringify(citas),
    en,
  );
}

test('should_enqueue_one_review_per_package_version', async () => {
  const { id, version } = await conPaquete();

  const primera = revisionesPreviasAuto(nucleo().db, db, AHORA);
  const segunda = revisionesPreviasAuto(nucleo().db, db, AHORA);
  const directa = encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs: AHORA });

  assert.equal(primera, 1);
  assert.equal(segunda, 0);
  assert.equal(directa.data?.nuevo, false);
  assert.deepEqual(
    trabajos().map((t) => t.clave),
    [`revision-previa-${id}-p${version}`],
  );
});

test('should_guard_the_deadline_like_any_other_job_of_the_offer', async () => {
  // Arrange: a 20 minutos del cierre no cabe la revisión (30 min) más el margen de firma.
  const { id, version } = await conPaquete();
  const ahoraMs = plazoDe(db, id)!.vence - 20 * 60_000;

  // Act
  const sola = encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs });
  const aMano = encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs, aMano: true });
  const confirmada = encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs, aMano: true, confirmado: true });

  // Assert
  assert.equal(DURACION_MIN.revision_previa, 30);
  assert.equal(sola.error?.code, 'plazo_insuficiente');
  assert.match(sola.error!.message, /la revisión previa del paquete tarda unos 30 min/);
  assert.equal(aMano.error?.code, 'plazo_justo');
  assert.equal(confirmada.error, null, confirmada.error?.message);
  assert.equal(
    nombreTrabajo(TIPO_REVISION_PREVIA, confirmada.data ? '{}' : ''),
    'Revisión previa del paquete',
    'en HermesEnVivo y Actividad, con nombre legible',
  );
});

test('should_not_enqueue_with_an_open_eligibility_brake', () => {
  // CASO_E sin el ENS en el perfil: el freno de elegibilidad la detiene. El paquete se apunta a mano.
  sembrarFixture(db, nucleo().db, { ...CASO_E, perfil: { ...CASO_E.perfil, domicilio: DOMICILIO, certificados: [] } });
  db.prepare(
    "INSERT INTO paquetes_presentacion (licitacion_id, version, ruta, guion_id, decisiones_en, manifiesto, bloqueos, avisos, creado_en) VALUES (?, 1, 'Salidas/x', 0, NULL, '{}', 0, 0, ?)",
  ).run(CASO_E.id, CASO_E.ahora);
  const ahora = Date.parse(CASO_E.ahora);
  assert.equal(
    frenoDeElegibilidad(db, nucleo().db, CASO_E.id, ahora).frenada,
    true,
    'precondición: CASO_E está frenada',
  );

  const r = encolarRevisionPrevia(nucleo().db, db, CASO_E.id, 1, { ahoraMs: ahora, aMano: true });

  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /frenada por elegibilidad/);
  assert.equal(trabajos().length, 0);
});

test('should_write_revision_previa_md_without_overwriting_and_without_amounts', async () => {
  const { id, version, ruta } = await conPaquete();
  encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs: AHORA });
  const previo = path.join(absoluta(ruta), 'REVISION_PREVIA.md');
  fs.writeFileSync(previo, 'lo que había');
  proponer(
    id,
    'empresa:-:domicilio',
    new Date(AHORA + 60_000).toISOString(),
    'Consultar al órgano si 12.500 € incluye el IGIC.',
  );

  const r = cerrarRevisionPrevia(
    db,
    raicesActuales(),
    {
      id,
      paquete_version: version,
      resumen: 'Revisé las comprobaciones; la oferta sale por 9.800 euros y queda una consulta.',
    },
    HERMES,
  );

  assert.equal(r.error, null, r.error?.message);
  assert.equal(fs.readFileSync(previo, 'utf8'), 'lo que había');
  assert.equal(r.data!.ruta_md, `${ruta}/REVISION_PREVIA-2.md`);
  const md = fs.readFileSync(absoluta(r.data!.ruta_md), 'utf8');
  assert.match(md, /Consultar al órgano/);
  assert.match(md, /Cita de «PCAP\.pdf» \(pág\. 4\)/);
  assert.doesNotMatch(md, /€|euros|12\.500|9\.800/);
});

test('should_be_done_only_when_closed_by_the_tool', async () => {
  const { id, version } = await conPaquete();
  const e = encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs: Date.now() });
  const payload = JSON.parse(trabajos()[0]!.payload) as Payload;
  assert.equal(revisionPreviaHecha(db, payload), false);
  assert.equal(
    tarjetasDe(db, id, 'web').some((t) => t.tipo === 'revision_previa'),
    false,
  );

  const r = cerrarRevisionPrevia(
    db,
    raicesActuales(),
    { id, paquete_version: version, resumen: 'Revisé las comprobaciones y no hay nada que proponer.' },
    HERMES,
  );
  const otra = cerrarRevisionPrevia(
    db,
    raicesActuales(),
    { id, paquete_version: version, resumen: 'Otra vez la misma revisión.' },
    HERMES,
  );

  assert.equal(e.error, null);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(revisionPreviaHecha(db, payload), true);
  assert.equal(otra.error?.code, 'conflicto');
  assert.equal(
    tarjetasDe(db, id, 'web').some((t) => t.tipo === 'revision_previa' && t.clave === `revision_previa:v${version}`),
    true,
  );
});

test('should_list_proposals_made_since_it_was_requested', async () => {
  const { id, version } = await conPaquete();
  proponer(id, 'antes:-:x', '2000-01-01T00:00:00.000Z', 'Una propuesta de antes de pedir la revisión.');
  const pedida = pedirRevisionPrevia(nucleo().db, db, id, { version, ahoraMs: AHORA });
  assert.equal(pedida.error, null, pedida.error?.message);
  proponer(
    id,
    'empresa:-:domicilio',
    new Date(AHORA + 60_000).toISOString(),
    'Completar el domicilio con el de la escritura.',
  );

  const r = cerrarRevisionPrevia(
    db,
    raicesActuales(),
    { id, paquete_version: version, resumen: 'Revisé las comprobaciones y propuse una cosa.' },
    HERMES,
  );
  const vista = revisionPreviaDe(db, id);

  assert.equal(r.data?.propuestas, 1);
  assert.deepEqual(
    vista.propuestas.map((p) => p.clave),
    ['empresa:-:domicilio'],
  );
  assert.equal(vista.revision?.estado, 'terminada');
  assert.equal(trabajos()[0]!.a_mano, 1);
});

test('should_return_the_review_of_the_requested_package_version_not_a_newer_pending_one', async () => {
  // Arrange: la del v1 terminada y la del v2 recién pedida.
  const { id, version } = await conPaquete();
  assert.equal(pedirRevisionPrevia(nucleo().db, db, id, { version, ahoraMs: AHORA }).error, null);
  assert.equal(
    cerrarRevisionPrevia(
      db,
      raicesActuales(),
      { id, paquete_version: version, resumen: 'Revisé las comprobaciones del primer paquete.' },
      HERMES,
    ).error,
    null,
  );
  db.prepare(
    "INSERT INTO revisiones_previas (licitacion_id, paquete_version, estado, pedida_en) VALUES (?, ?, 'pedida', ?)",
  ).run(id, version + 1, new Date().toISOString());

  // Act
  const deLaTarjeta = revisionPreviaDe(db, id, version);
  const ultima = revisionPreviaDe(db, id);

  // Assert
  assert.equal(deLaTarjeta.revision?.estado, 'terminada');
  assert.equal(deLaTarjeta.revision?.paquete_version, version);
  assert.match(deLaTarjeta.revision?.ruta_md ?? '', /REVISION_PREVIA/);
  assert.equal(ultima.revision?.paquete_version, version + 1);
});

test('should_register_the_job_type_with_licitacion_priority', async () => {
  const { id, version } = await conPaquete();
  registrarTrabajos();
  encolarRevisionPrevia(nucleo().db, db, id, version, { ahoraMs: AHORA });
  const t = nucleo().db.prepare('SELECT * FROM trabajos_ia WHERE tipo = ?').get(TIPO_REVISION_PREVIA) as Trabajo;

  const rango = prioridadTrabajo(db, t, AHORA);

  assert.notEqual(agenteDeTipo(TIPO_REVISION_PREVIA), null);
  assert.equal(tiposSinPrioridad('licitaciones.').includes(TIPO_REVISION_PREVIA), false);
  assert.ok(rango < 1_000_000, `una oferta en preparación va en el nivel de oferta (rango ${rango})`);
});

test('should_enqueue_a_review_after_generating_the_casoC_package_and_show_it_in_the_comprobaciones_once_closed', async () => {
  const CASO_C = leerFixtureComprobaciones('casoC');
  const ahora = Date.parse(CASO_C.ahora);
  sembrarFixture(db, nucleo().db, CASO_C);
  // El paquete, con la hora real o la de la captura si es posterior: la checklist se sincroniza al generarlo y un paquete «del pasado» saldría desfasado.
  const p = await generarPaquete(c(), CASO_C.id, Math.max(ahora, Date.now()));
  assert.equal(p.error, null, p.error?.message);
  // Villaejemplo está frenada por los tutores del lote 3: sin «Vamos» no se gasta cuota.
  const freno = frenoDeElegibilidad(db, nucleo().db, CASO_C.id, ahora);
  assert.equal(revisionesPreviasAuto(nucleo().db, db, ahora), 0);
  for (const b of freno.bloqueos)
    assert.equal(
      aplicarAccionBloqueo(db, CASO_C.id, b.clave, { accion: 'vamos', motivo: 'Los tutores se contratan para el lote' })
        .error,
      null,
    );
  // Tras el «Vamos» la checklist se pone al día y el paquete v1 queda desfasado: la cadena lo rehace (v2).
  const v2 = await generarPaquete(c(), CASO_C.id, Math.max(ahora, Date.now()));
  assert.equal(v2.error, null, v2.error?.message);

  const n = revisionesPreviasAuto(nucleo().db, db, ahora);
  const fila = comprobacionesDe(db, nucleo().db, CASO_C.id, ahora).data!.bloqueos.find(
    (b) => b.clave === 'empresa:-:domicilio',
  )!;
  db.prepare(
    "INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, propuesta_json, evidencia_json, quien, motivo, en) VALUES (?, ?, ?, 'propuesta', ?, '[]', 'hermes', NULL, ?)",
  ).run(
    CASO_C.id,
    fila.clave,
    fila.huella,
    JSON.stringify({
      tipo: 'vincular_documento',
      resumen: 'Vincular la escritura con el domicilio social.',
      datos: {},
      campos: 1,
    }),
    new Date().toISOString(),
  );
  const r = cerrarRevisionPrevia(
    db,
    raicesActuales(),
    {
      id: CASO_C.id,
      paquete_version: v2.data!.version,
      resumen: 'Revisé las comprobaciones y propuse vincular la escritura.',
    },
    HERMES,
  );

  assert.equal(n, 1);
  assert.equal(r.error, null, r.error?.message);
  assert.ok(fs.existsSync(absoluta(`${v2.data!.ruta}/REVISION_PREVIA.md`)));
  assert.equal(
    tarjetasDe(db, CASO_C.id, 'web').some((t) => t.tipo === 'revision_previa'),
    true,
  );
  const despues = comprobacionesDe(db, nucleo().db, CASO_C.id, ahora).data!.bloqueos.find(
    (b) => b.clave === 'empresa:-:domicilio',
  )!;
  assert.equal(despues.estado, 'propuesta', 'la propuesta sale en su fila sin aplicarse');
});
