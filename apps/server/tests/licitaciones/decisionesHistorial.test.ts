// Historial y deshacer de las decisiones, por HTTP, con una oferta como la de CASO_E:
// lotes 2 y 4, un Anexo VI económico y un Anexo I por lote. Base y cola reales en un directorio
// temporal; personas («Persona A») e importes inventados, ninguno ofertado.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { modelosAnexos } from '../nucleo/fixtures/modelosAnexos.js';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decisiones-historial-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [salidas, conocimiento, agentes]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { decisionesDe, guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { documentosDe, documentoDelGuion } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { registrarSincronizacionDocumentos } = await import('../../src/dominios/licitaciones/oferta/documentosSync.js');
const { encolarAnexosAuto } = await import('../../src/dominios/licitaciones/oferta/anexosAuto.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { seccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/dependenciasAnexo.js');
const { decisionesEn } = await import('../../src/dominios/licitaciones/oferta/decisionesHistorial.js');
const { coherenciaOferta } = await import('../../src/dominios/licitaciones/oferta/coherencia.js');

iniciarNucleo();
registrarSincronizacionDocumentos();
const db = dbLicitaciones();
const LOTES = ['1', '2', '3', '4'].map((id) => ({ id, nombre: `Lote ${id}`, importe: 6_000 }));
const L = licitacion({
  titulo: 'Formación en competencias digitales',
  publicada: '2026-09-30',
  presupuesto: 24_000,
  lotes: LOTES,
  limite: `${new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)}T08:00:00`,
});
const ID = L.id;
const CARPETA = `Licitaciones/Radar/2026/casoE (${ID})`;
const MODELOS = 'Modelos CASO_E.docx';
const ANEXOS = ['a1-d1-l2', 'a1-d1-l4', 'a1-d2-l2', 'a1-d2-l4'];
const ECO_2 = 'a1-d1-l2';

const oferta = (lote: string) => ({
  lotes: [lote],
  formula: 'P = 40 × (Om / O)',
  presupuesto_base: 6_000,
  impuesto_aparte: 'IGIC',
  precios_unitarios: [],
  umbral_anormalidad: null,
  modelo: 'Anexo VI',
  archivo: 'Archivo electrónico único',
});
const GUION = {
  id: ID,
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Documentación administrativa y oferta económica por lote.',
      ambito: 'por_lote',
      documentos: [
        {
          tipo: 'oferta_economica',
          nombre: 'Anexo VI. Oferta económica',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'Anexo VII', documento: MODELOS, pagina: 1 },
        },
        {
          tipo: 'declaracion',
          nombre: 'Anexo I. Declaración responsable',
          obligatorio: true,
          produce: 'persona',
          origen: { modelo: 'Anexo VI', documento: MODELOS, pagina: 1 },
        },
      ],
    },
  ],
  memoria: null,
  automaticos: [],
  ofertas_economicas: [oferta('2'), oferta('4')],
  plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2', '4'],
};

guardarLicitacion(db, L);
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
).run(
  ID,
  JSON.stringify([
    { id: '2', motivo: 'criba' },
    { id: '4', motivo: 'criba' },
  ]),
  new Date().toISOString(),
  new Date().toISOString(),
);
fs.mkdirSync(path.join(conocimiento, CARPETA), { recursive: true });
fs.writeFileSync(path.join(conocimiento, CARPETA, MODELOS), await modelosAnexos());
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/modelos', 'anexo', ?, 'descargado', ?, ?)",
).run(ID, MODELOS, `${CARPETA}/${MODELOS}`, new Date().toISOString());
const g = await proponerGuion(db, GuionEntrada.parse(GUION), 'licitaciones');
assert.equal(g.error, null, g.error?.message);
const PERSONA_A = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Formadora' }).data!.id;

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

// Importes de prueba inventados (no son ofertados).
function decidir(precio2 = 5_000): number {
  const r = guardarDecisiones(db, nucleo().db, ID, {
    lotes: ['2', '4'],
    equipo: [{ persona_id: PERSONA_A, rol_en_la_oferta: 'Formadora', dedicacion: '50 %', lotes: [] }],
    automaticos: [],
    herramientas: ['Aula virtual'],
    enfoque: 'Formación práctica con casos reales de la plantilla.',
    ofertas: [
      { lote: '2', pendiente: false, importe: precio2 },
      { lote: '4', pendiente: false, importe: 4_000 },
    ],
  });
  assert.equal(r.error, null, r.error?.message);
  return r.data!.version;
}

// Un anexo recibido con las decisiones de ahora; «legado», sin dependencias guardadas (de antes de la O0b).
function recibido(clave: string, op: { legado?: boolean } = {}): void {
  const d = documentoDelGuion(documentosDe(db, ID).guion!.datos, clave)!;
  const dep = op.legado ? null : JSON.stringify(seccionesDeAnexo(d.doc.tipo, d.lote, decisionesDe(db, ID)!.datos));
  db.prepare(
    `UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, avisos = '[]', anexo_en = ?, anexo_dependencias = ? WHERE licitacion_id = ? AND clave = ?`,
  ).run(`Salidas/Licitaciones/casoE/anexos/${clave}-v1.docx`, new Date().toISOString(), dep, ID, clave);
}

const trabajos = () => (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n;
const cancelar = () =>
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')")
    .run(TIPO_ANEXO);
const importe2 = () => decisionesDe(db, ID)!.datos.ofertas.find((o) => o.lote === '2')!.importe;

type Respuesta = { status: number; body: Record<string, unknown> };
async function deshacer(cuerpo: unknown, headers: Record<string, string> = {}): Promise<Respuesta> {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/decisiones/deshacer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

// Cada caso parte de los anexos rellenados con las decisiones de partida y sin nada en cola.
beforeEach(() => {
  decidir();
  for (const clave of ANEXOS) recibido(clave);
  cancelar();
});

test('should_restore_the_previous_decisions_as_a_new_version', async () => {
  const antes = decidir(4_700);

  const r = await deshacer({ version: antes }, de('Persona A'));

  assert.equal(r.status, 200, String(r.body['message']));
  assert.equal(r.body['version'], antes + 1);
  assert.equal(r.body['restaurada'], antes - 1);
  assert.deepEqual(r.body['secciones'], ['precio']);
  assert.equal(importe2(), 5_000);
  const f = db
    .prepare('SELECT motivo, autor FROM decisiones_historial WHERE licitacion_id = ? AND version = ?')
    .get(ID, antes + 1) as { motivo: string; autor: string };
  assert.deepEqual(f, { motivo: `deshacer v${antes}`, autor: 'Persona A' });
});

const lotesDeInteres = () =>
  (
    JSON.parse(
      (
        db.prepare('SELECT lotes_interes FROM oportunidades WHERE licitacion_id = ?').get(ID) as {
          lotes_interes: string;
        }
      ).lotes_interes,
    ) as { id: string }[]
  ).map((x) => x.id);

test('should_bring_back_the_lots_of_interest_when_undoing_a_lots_change', async () => {
  // Arrange: la empresa va al 2 y al 4 y se quita el 4 por PATCH (cambia el ámbito y poda su precio).
  const v = decisionesDe(db, ID)!.version;
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/decisiones/lotes`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: v, valor: ['2'] }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(lotesDeInteres(), ['2']);

  // Act
  const d = await deshacer({ version: v + 1 });

  // Assert
  assert.equal(d.status, 200, String(d.body['message']));
  assert.deepEqual(decisionesDe(db, ID)!.datos.lotes, ['2', '4']);
  assert.deepEqual(lotesDeInteres(), ['2', '4'], 'el ámbito vuelve con las decisiones');
  assert.ok(!coherenciaOferta(db, ID).some((x) => x.tipo === 'lotes_decisiones'), 'decisiones y ámbito casan');
});

test('should_return_409_when_undoing_a_stale_version', async () => {
  const antes = decidir(4_700);

  const r = await deshacer({ version: antes - 1 });

  assert.equal(r.status, 409);
  assert.equal(decisionesDe(db, ID)!.version, antes, 'no se escribió nada');
  assert.equal(importe2(), 4_700);
});

test('should_not_queue_any_job_when_undoing', async () => {
  const version = decidir(4_700);
  const antes = trabajos();

  const r = await deshacer({ version });
  const n = encolarAnexosAuto(nucleo().db, db);

  assert.equal(r.status, 200, String(r.body['message']));
  assert.equal(n, 0, 'los anexos vuelven a casar con lo que llevan');
  assert.equal(trabajos(), antes);
});

test('should_not_relaunch_an_annex_whose_section_values_are_back_to_what_it_used', async () => {
  recibido(ECO_2, { legado: true });
  const version = decidir(4_700);

  await deshacer({ version });
  // Sin esto, el rellenado y los guardados caen en el mismo milisegundo y la comparación por hora es azarosa.
  const anexoEn = (
    db.prepare('SELECT anexo_en FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?').get(ID, ECO_2) as {
      anexo_en: string;
    }
  ).anexo_en;
  db.prepare('UPDATE decisiones_historial SET creada_en = ? WHERE licitacion_id = ? AND version >= ?').run(
    new Date(Date.parse(anexoEn) + 1_000).toISOString(),
    ID,
    version,
  );
  const n = encolarAnexosAuto(nucleo().db, db);

  assert.equal(n, 0, 'sin dependencias guardadas, compara con las decisiones de cuando se rellenó');
  const dep = JSON.parse(
    (
      db
        .prepare('SELECT anexo_dependencias FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?')
        .get(ID, ECO_2) as { anexo_dependencias: string }
    ).anexo_dependencias,
  ) as { precio: { importe: number }[] };
  assert.deepEqual(
    dep.precio.map((o) => o.importe),
    [5_000],
  );
});

test('should_return_the_decisions_in_force_at_an_instant', () => {
  // Instante fijado a mano: con dos guardados en el mismo milisegundo, «ahora» no separaba las versiones.
  const entre = '2026-06-01T10:00:00.000Z';
  const primera = decidir(4_700);
  db.prepare('UPDATE decisiones_historial SET creada_en = ? WHERE licitacion_id = ? AND version = ?').run(
    entre,
    ID,
    primera,
  );
  decidir(4_600);

  const d = decisionesEn(db, ID, entre);

  assert.equal(d!.ofertas.find((o) => o.lote === '2')!.importe, 4_700);
  assert.equal(decisionesEn(db, ID, '2000-01-01T00:00:00.000Z'), null);
});

test('should_list_the_history_without_amounts', async () => {
  decidir(4_321);

  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/decisiones/historial`);
  const texto = await r.text();

  assert.equal(r.status, 200);
  const lista = JSON.parse(texto) as {
    version: number;
    secciones: string[];
    autor: string;
    motivo: string | null;
    creada_en: string;
  }[];
  assert.ok(lista.length >= 2);
  assert.deepEqual(Object.keys(lista[0]!).sort(), ['autor', 'creada_en', 'motivo', 'secciones', 'version']);
  assert.ok(lista[0]!.version > lista[1]!.version, 'de la más reciente a la primera');
  assert.deepEqual(lista[0]!.secciones, ['precio']);
  assert.ok(!texto.includes('4321') && !texto.includes('importe'), 'sin precios');
});
