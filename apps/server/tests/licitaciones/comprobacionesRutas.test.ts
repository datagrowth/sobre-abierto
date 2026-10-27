// API de las comprobaciones por HTTP (GET con ETag y acciones sobre las filas) y el evento licitacion.comprobaciones,
// sobre el caso sintético de CASO_E de comprobaciones.test.ts.
import { test, after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comprobaciones-rutas-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { emitir, ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { ESPERA_COMPROBACIONES_MS, registrarEventosComprobaciones } =
  await import('../../src/dominios/licitaciones/oferta/comprobacionesEventos.js');
type Comprobaciones = import('../../src/dominios/licitaciones/oferta/comprobacionesTipos.js').Comprobaciones;

iniciarNucleo();
const db = dbLicitaciones();
const ELISA = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Formadora' }).data!.id;

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(comoPersona);
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Siembra copiada de comprobaciones.test.ts (caso CASO_E).
const LOTES = [
  { id: '1', nombre: 'Primeros auxilios básicos', importe: 3_000 },
  { id: '2', nombre: 'Análisis de datos con hojas de cálculo', importe: 6_063.75 },
  { id: '3', nombre: 'Archivo electrónico', importe: 2_000 },
  { id: '4', nombre: 'Atención al público', importe: 756 },
  { id: '5', nombre: 'Seguridad en el puesto', importe: 4_000 },
  { id: '6', nombre: 'Residuos sanitarios', importe: 6_682.5 },
];
const placsp = (nombre: string) => ({
  clase: 'adicional' as const,
  nombre,
  url: `https://contrataciondelestado.es/doc/${encodeURIComponent(nombre)}`,
  hash: null,
});
const BASES = { ...placsp('Bases.pdf'), clase: 'pcap' as const };
const NOTA = placsp('Nota de rectificación ENS.pdf');
const MEMORIA_JUSTIFICATIVA = placsp('Memoria justificativa.pdf');
const UMBRAL =
  'Se considerarán anormalmente bajas las ofertas inferiores en un 15 % al presupuesto base de licitación, IGIC excluido (apartado J).';
const docente = (lote: string, que: string) => ({
  tipo: 'medios_personales',
  descripcion: `Docente principal con titulación relacionada y formación específica en ${que}`,
  excluyente: true,
  cumple: 'dudoso',
  justificacion: 'Falta el certificado del curso.',
  documento: 'Bases.pdf',
  pagina: 64,
  lote,
});
const FICHA = {
  resumen: 'Formación subvencionada FFI para la plantilla de CASO_E en seis lotes (lotes 2 y 6 de interés).',
  requisitos: [docente('2', 'hojas de cálculo avanzadas'), docente('6', 'Residuos sanitarios')],
  criterios: [],
  documentacion: [],
  hitos: [],
  garantias: [],
  penalizaciones: [],
  riesgos: [],
  recomendacion: { decision: 'revisar', motivo: 'Hay que confirmar el ENS.' },
};
const GUION = {
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Anexos, memoria no valorable y oferta económica.',
      documentos: [{ tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' }],
      documento: 'Bases.pdf',
      pagina: 25,
    },
  ],
  memoria: null,
  automaticos: [],
  oferta_economica: {
    formula: 'P = 40 × (Om / O)',
    presupuesto_base: 6_063.75,
    impuesto_aparte: 'IGIC',
    precio_unitario: { unidad: 'alumno', maximo: 110.25 },
    umbral_anormalidad: UMBRAL,
    modelo: 'Anexo VI',
    archivo: 'Archivo electrónico único',
    documento: 'Bases.pdf',
    pagina: 53,
  },
  plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2', '4'],
};
const interes = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id, motivo: 'criba' })));
const LIMITE_LEJANO = '2099-10-15T08:00:00';

async function casoE(id: string): Promise<void> {
  const l = licitacion({
    titulo: 'Formación subvencionada FFI (6 lotes)',
    publicada: '2026-09-24',
    presupuesto: 30_000,
    lotes: LOTES,
    limite: LIMITE_LEJANO,
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, documentos: [BASES, NOTA, MEMORIA_JUSTIFICATIVA] });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes(['2', '6']), ts, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'pcap', 'Bases.pdf', 'descargado', ?, ?)",
  ).run(id, BASES.url, `Licitaciones/Radar/2026/17-26 (${id})/Bases.pdf`, ts);
  assert.equal(
    (await proponerFicha(db, { ...FICHA, id } as Parameters<typeof proponerFicha>[1], 'licitaciones')).error,
    null,
  );
  assert.equal(elegirLotesInteres(db, id, { lotes: ['2', '4'] }).error, null);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ ...GUION, id }), 'licitaciones')).error, null);
  const datos = {
    lotes: ['2', '6', '4'],
    equipo: [{ persona_id: ELISA, rol_en_la_oferta: 'Tutora titular' }],
    automaticos: [],
    herramientas: [],
    enfoque: 'Lote 6 en Residuos sanitarios.',
    precio: { importe: 72, pendiente: false },
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guionVigente(db, id)!.id,
    JSON.stringify(datos),
    ts,
  );
}

const url = (id: string) => `${base}/api/licitaciones/licitaciones/${id}/comprobaciones`;

async function verComprobaciones(id: string): Promise<Comprobaciones> {
  const r = await fetch(url(id));
  assert.equal(r.status, 200);
  return (await r.json()) as Comprobaciones;
}

// Como revalida el navegador. Sin cache-control, fetch de Node añade «no-cache» a una petición
// condicional y Express, con razón, responde entera.
const revalidar = (id: string, etag: string | null) =>
  fetch(url(id), { headers: { 'if-none-match': etag ?? '', 'cache-control': 'max-age=0' } });

type Respuesta = { status: number; comprobaciones: Comprobaciones; message: unknown };
async function actuar(
  id: string,
  clave: string,
  cuerpo: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Respuesta> {
  const r = await fetch(`${url(id)}/bloqueos/${encodeURIComponent(clave)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  });
  const body = (await r.json()) as Comprobaciones & { message?: unknown };
  return { status: r.status, comprobaciones: body, message: body.message };
}

type FilaGuardada = { clave: string; huella: string; estado: string; quien: string; motivo: string | null; en: string };
const guardadas = (id: string) =>
  db
    .prepare('SELECT clave, huella, estado, quien, motivo, en FROM oferta_bloqueos WHERE licitacion_id = ? ORDER BY id')
    .all(id) as FilaGuardada[];
const fila = (c: Comprobaciones, prefijo: string) => c.bloqueos.find((b) => b.clave.startsWith(prefijo))!;

test('should_return_the_comprobaciones_with_an_etag_and_304_when_unchanged', async () => {
  const ID = 'p-91000450';
  await casoE(ID);

  const primera = await fetch(url(ID));
  const etag = primera.headers.get('etag');
  const segunda = await revalidar(ID, etag);

  assert.equal(primera.status, 200);
  assert.ok(etag, 'las comprobaciones llevan ETag');
  assert.equal(((await primera.json()) as Comprobaciones).id, ID);
  assert.equal(segunda.status, 304, 'sin cambios, no se vuelve a mandar');
  assert.equal((await fetch(url('p-no-existe'))).status, 404);
});

test('should_store_vamos_with_its_reason_on_an_eligibility_row', async () => {
  const ID = 'p-91000460';
  await casoE(ID);
  const antes = await fetch(url(ID));
  const ficha = fila((await antes.json()) as Comprobaciones, 'ficha_lotes:');
  assert.equal(ficha.categoria, 'elegibilidad');

  const r = await actuar(
    ID,
    ficha.clave,
    { accion: 'vamos', motivo: 'El lote 6 lo cubre la otra ficha.' },
    de('Persona A'),
  );

  assert.equal(r.status, 200);
  assert.equal(
    fila(r.comprobaciones, 'ficha_lotes:').estado,
    'vamos',
    'la respuesta son las comprobaciones recalculadas',
  );
  const [g] = guardadas(ID);
  assert.deepEqual(
    { clave: g!.clave, huella: g!.huella, estado: g!.estado, quien: g!.quien, motivo: g!.motivo },
    {
      clave: ficha.clave,
      huella: ficha.huella,
      estado: 'vamos',
      quien: 'Persona A',
      motivo: 'El lote 6 lo cubre la otra ficha.',
    },
  );
  assert.ok(!Number.isNaN(Date.parse(g!.en)));
  assert.equal((await revalidar(ID, antes.headers.get('etag'))).status, 200, 'con la acción cambia el ETag');
  const sinQuien = await actuar(ID, fila(r.comprobaciones, 'pliegos:').clave, {
    accion: 'vamos',
    motivo: 'Los pliegos ya están.',
  });
  assert.equal(sinQuien.status, 200);
  assert.equal(guardadas(ID).at(-1)!.quien, 'web', 'sin quién, la web');
});

test('should_refuse_vamos_on_a_non_eligibility_row', async () => {
  const ID = 'p-91000470';
  await casoE(ID);
  const c = await verComprobaciones(ID);

  const precio = await actuar(ID, fila(c, 'precio_anormal:').clave, { accion: 'vamos', motivo: 'Vamos igual.' });
  const sinMotivo = await actuar(ID, fila(c, 'ficha_lotes:').clave, { accion: 'vamos' });

  assert.equal(precio.status, 400);
  assert.equal(precio.message, 'Vamos solo vale para un bloqueo de elegibilidad, y con motivo.');
  assert.equal(sinMotivo.status, 400, 'sin motivo tampoco');
  assert.equal((await actuar(ID, 'no:-:existe', { accion: 'vamos', motivo: 'Vamos igual.' })).status, 404);
  assert.equal(
    (await actuar(ID, fila(c, 'ficha_lotes:').clave, { accion: 'vamos', motivo: 'Vamos igual.', otro: 1 })).status,
    400,
    'campos de más',
  );
  assert.equal(guardadas(ID).length, 0, 'nada guardado');
});

test('should_refuse_to_accept_an_impide_as_a_risk', async () => {
  const ID = 'p-91000480';
  await casoE(ID);
  const c = await verComprobaciones(ID);
  const impide = c.bloqueos.find((b) => b.gravedad === 'impide')!;
  const riesgo = c.bloqueos.find((b) => b.gravedad === 'riesgo')!;

  const r = await actuar(ID, impide.clave, { accion: 'aceptar_riesgo', motivo: 'Lo asumimos.' });
  const sinPropuesta = await actuar(ID, impide.clave, { accion: 'aplicar_propuesta' });
  const aceptado = await actuar(ID, riesgo.clave, { accion: 'aceptar_riesgo', motivo: 'Lo asumimos.' });

  assert.equal(r.status, 409);
  assert.equal(r.message, 'Esto impide presentar: no se puede aceptar como riesgo. Resuélvelo o descarta la oferta.');
  assert.equal(sinPropuesta.status, 409);
  assert.equal(sinPropuesta.message, 'No hay propuesta de Hermes para este bloqueo.');
  assert.equal(aceptado.status, 200, 'un riesgo sí se acepta');
  assert.deepEqual(
    guardadas(ID).map((g) => [g.clave, g.estado]),
    [[riesgo.clave, 'riesgo_aceptado']],
  );
});

test('should_discard_the_offer_with_its_typed_reason', async () => {
  const ID = 'p-91000490';
  await casoE(ID);
  const clave = fila(await verComprobaciones(ID), 'ficha_lotes:').clave;
  assert.equal((await actuar(ID, clave, { accion: 'descartar' })).status, 400, 'sin motivo no se descarta');

  const r = await actuar(
    ID,
    clave,
    { accion: 'descartar', motivo: 'Sin ENS no podemos ir.', categoria_descarte: 'certificacion' },
    de('Persona A'),
  );

  assert.equal(r.status, 200);
  assert.equal(r.comprobaciones.veredicto.tipo, 'descartada');
  const op = db.prepare('SELECT estado, motivo_descarte FROM oportunidades WHERE licitacion_id = ?').get(ID) as {
    estado: string;
    motivo_descarte: string;
  };
  assert.deepEqual({ ...op }, { estado: 'descartada', motivo_descarte: 'Sin ENS no podemos ir.' });
  const h = db
    .prepare('SELECT accion, categoria, quien FROM descartes_historial WHERE licitacion_id = ?')
    .all(ID) as object[];
  assert.deepEqual(
    h.map((x) => ({ ...x })),
    [{ accion: 'descartada', categoria: 'certificacion', quien: 'Persona A' }],
  );
  assert.deepEqual(
    guardadas(ID).map((g) => [g.clave, g.motivo, g.quien]),
    [[clave, 'Sin ENS no podemos ir.', 'Persona A']],
    'auditada en la fila',
  );
});

test('should_reopen_a_row_when_its_fingerprint_changes', async () => {
  const ID = 'p-91000500';
  await casoE(ID);
  const ficha = fila(await verComprobaciones(ID), 'ficha_lotes:');
  assert.equal(
    (await actuar(ID, ficha.clave, { accion: 'vamos', motivo: 'El lote 6 lo cubre la otra ficha.' })).status,
    200,
  );

  assert.equal(elegirLotesInteres(db, ID, { lotes: ['2', '5'] }).error, null);
  const otra = (await verComprobaciones(ID)).bloqueos.find((b) => b.clave === ficha.clave)!;

  assert.notEqual(otra.huella, ficha.huella);
  assert.equal(otra.estado, 'abierto', 'otra huella: el vamos ya no vale');
});

test('should_emit_one_comprobaciones_event_per_tender_after_a_burst', async () => {
  const [A, B] = ['p-91000510', 'p-91000520'];
  await casoE(A);
  await casoE(B);
  mock.timers.enable({ apis: ['setTimeout'] });
  const dejar = registrarEventosComprobaciones();
  const avisos = (id: string) =>
    ultimosEventos(nucleo().db, 1_000).filter((e) => e.tipo === 'licitacion.comprobaciones' && e.recurso === id);
  const de = (tipo: string, recurso: string | null, dominio = 'licitaciones') =>
    emitir(nucleo().db, { tipo, dominio, recurso, datos: {} });
  try {
    for (const tipo of ['licitacion.guion', 'licitacion.decisiones', 'licitacion.documentos']) de(tipo, A);
    de('licitacion.memoria', B);
    de('licitacion.comprobaciones', B);
    de('licitaciones.lotes', B);
    de('licitacion.guion', null);
    de('biblioteca.nota', B, 'biblioteca');
    const antes = [avisos(A).length, avisos(B).length];

    mock.timers.tick(ESPERA_COMPROBACIONES_MS - 1);
    assert.deepEqual([avisos(A).length, avisos(B).length], antes, 'aún dentro de la espera');
    mock.timers.tick(1);

    assert.deepEqual(
      [avisos(A).length, avisos(B).length],
      [antes[0]! + 1, antes[1]! + 1],
      'un aviso por licitación tras la ráfaga',
    );
    assert.deepEqual(avisos(A)[0]!.datos, { id: A, version: (await verComprobaciones(A)).version });
  } finally {
    dejar();
    mock.timers.reset();
  }
});
