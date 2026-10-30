// Anexos automáticos que se relanzan solo si cambió lo que llevan (parte 0b), con una
// oferta como la de CASO_E: lotes 2 y 4, un DEUC, un Anexo VI económico y un Anexo I por lote.
// Base y cola reales en un directorio temporal; personas («Persona A») e importes inventados.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';
import { modelosAnexos } from '../nucleo/fixtures/modelosAnexos.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-anexos-auto-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { decisionesDe, guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { documentosDe, documentoDelGuion } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { registrarSincronizacionDocumentos } = await import('../../src/dominios/licitaciones/oferta/documentosSync.js');
const { encolarAnexosAuto } = await import('../../src/dominios/licitaciones/oferta/anexosAuto.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { huella, seccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/dependenciasAnexo.js');

iniciarNucleo();
// Como en producción (iniciarLicitaciones): la checklist se sincroniza con los eventos, no al leerla.
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
const [DEUC_2, ECO_2, ECO_4, DECL_2] = ['a1-d1-l2', 'a1-d2-l2', 'a1-d2-l4', 'a1-d3-l2'];

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
        { tipo: 'deuc', nombre: 'DEUC', obligatorio: true, produce: 'persona' },
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

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Cambio = { precio2?: number; precio4?: number; enfoque?: string };
function decidir(c: Cambio = {}): string {
  const r = guardarDecisiones(db, nucleo().db, ID, {
    lotes: ['2', '4'],
    equipo: [{ persona_id: PERSONA_A, rol_en_la_oferta: 'Formadora', dedicacion: '50 %', lotes: [] }],
    automaticos: [],
    herramientas: ['Aula virtual'],
    enfoque: c.enfoque ?? 'Formación práctica con casos reales de la plantilla.',
    ofertas: [
      { lote: '2', pendiente: false, importe: c.precio2 ?? 5_000 },
      { lote: '4', pendiente: false, importe: c.precio4 ?? 4_000 },
    ],
  });
  assert.equal(r.error, null, r.error?.message);
  return r.data!.actualizada_en;
}

const pedidos = () =>
  (
    nucleo()
      .db.prepare("SELECT clave FROM trabajos_ia WHERE tipo = ? AND estado = 'pendiente' ORDER BY id")
      .all(TIPO_ANEXO) as { clave: string }[]
  ).map((x) => x.clave);
const fila = (clave: string) =>
  db
    .prepare(
      'SELECT estado, avisos, anexo_en, anexo_dependencias FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?',
    )
    .get(ID, clave) as { estado: string; avisos: string; anexo_en: string | null; anexo_dependencias: string | null };
const avisos = (clave: string) => JSON.parse(fila(clave).avisos) as string[];

// Lo que deja recibir un anexo de Hermes: borrador con su archivo, la hora y lo que lleva de las decisiones vigentes.
function recibido(clave: string, op: { legado?: boolean } = {}): void {
  const { guion } = documentosDe(db, ID);
  const d = documentoDelGuion(guion!.datos, clave)!;
  const dep = op.legado ? null : JSON.stringify(seccionesDeAnexo(d.doc.tipo, d.lote, decisionesDe(db, ID)!.datos));
  db.prepare(
    `UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, avisos = '[]', anexo_en = ?, anexo_dependencias = ? WHERE licitacion_id = ? AND clave = ?`,
  ).run(`Salidas/Licitaciones/casoE/anexos/${clave}-v1.docx`, new Date().toISOString(), dep, ID, clave);
}

const cancelar = () =>
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')")
    .run(TIPO_ANEXO);

// Cada caso parte de los cuatro anexos rellenados con las decisiones de partida y sin nada en cola.
beforeEach(() => {
  decidir();
  for (const clave of [ECO_2, ECO_4, DECL_2, 'a1-d3-l4']) recibido(clave);
  cancelar();
});

test('should_not_enqueue_any_annex_when_only_the_approach_changes', () => {
  decidir({ enfoque: 'Tutorías semanales en grupos pequeños y seguimiento por alumno.' });

  const n = encolarAnexosAuto(nucleo().db, db);

  assert.equal(n, 0);
  assert.deepEqual(pedidos(), []);
});

test('should_enqueue_only_lot_2_economic_annex_when_lot_2_price_changes', () => {
  decidir({ precio2: 4_700 });

  const n = encolarAnexosAuto(nucleo().db, db);

  assert.equal(n, 1);
  assert.deepEqual(
    pedidos().map((c) => c.slice(`anexo-auto-${ID}-`.length).replace(/-[0-9a-f]{12}-tras-.*$/, '')),
    [ECO_2],
  );
  assert.deepEqual(avisos(DEUC_2), [], 'el DEUC no recibe avisos');
});

test('should_warn_prepared_annex_with_what_changed_instead_of_rerunning', () => {
  db.prepare("UPDATE oferta_documentos SET estado = 'preparado', avisos = ? WHERE licitacion_id = ? AND clave = ?").run(
    JSON.stringify([
      'El anexo es anterior a las decisiones de las 09:00: si cambió algo que lleva, rehazlo con «Rellenar con Hermes».',
      'Otro aviso.',
    ]),
    ID,
    ECO_2,
  );
  const en = decidir({ precio2: 4_700 });

  const n = encolarAnexosAuto(nucleo().db, db);
  encolarAnexosAuto(nucleo().db, db);

  assert.equal(n, 0);
  assert.deepEqual(pedidos(), []);
  const hora = horaLocalEspana(Date.parse(en)).slice(11, 16);
  assert.deepEqual(
    avisos(ECO_2),
    [
      'Otro aviso.',
      `El anexo es anterior a que cambiara el precio del lote 2 (decisiones de las ${hora}): si cambió algo que lleva, rehazlo con «Rellenar con Hermes».`,
    ],
    'sustituye al anterior, una vez',
  );
  assert.equal(fila(ECO_2).estado, 'preparado');
  assert.deepEqual([avisos(ECO_4), avisos(DEUC_2)], [[], []]);
});

test('should_drop_outdated_warning_when_decisions_go_back_to_what_the_annex_has', () => {
  db.prepare(
    "UPDATE oferta_documentos SET estado = 'preparado', avisos = '[\"Otro aviso.\"]' WHERE licitacion_id = ? AND clave = ?",
  ).run(ID, ECO_2);
  decidir({ precio2: 4_700 });
  encolarAnexosAuto(nucleo().db, db);
  assert.ok(
    avisos(ECO_2).some((a) => a.startsWith('El anexo es anterior a que cambiara')),
    'con el precio B, avisa',
  );

  decidir({ precio2: 5_000 });
  const n = encolarAnexosAuto(nucleo().db, db);

  assert.equal(n, 0);
  assert.deepEqual(avisos(ECO_2), ['Otro aviso.'], 'de vuelta al precio A, el anexo está al día');
});

test('should_backfill_dependencies_of_legacy_annexes_without_enqueuing', () => {
  decidir({ precio2: 4_700 });
  recibido(ECO_2, { legado: true });

  const n = encolarAnexosAuto(nucleo().db, db);

  assert.equal(n, 0, 'rellenado después de las decisiones: está al día');
  const dep = JSON.parse(fila(ECO_2).anexo_dependencias ?? 'null') as { precio: { importe: number }[] };
  assert.deepEqual(
    dep.precio.map((o) => o.importe),
    [4_700],
  );
  decidir({ precio2: 4_600 });
  assert.equal(encolarAnexosAuto(nucleo().db, db), 1, 'con las dependencias ya guardadas, compara por contenido');
});

test('should_use_idempotent_key_from_dependencies_hash', () => {
  decidir({ precio4: 3_800 });
  const { anexo_en } = fila(ECO_4);
  const esperada = seccionesDeAnexo('oferta_economica', '4', decisionesDe(db, ID)!.datos);

  encolarAnexosAuto(nucleo().db, db);
  decidir({ precio4: 3_800, enfoque: 'Otro enfoque, el mismo precio.' });
  encolarAnexosAuto(nucleo().db, db);

  assert.deepEqual(pedidos(), [`anexo-auto-${ID}-${ECO_4}-${huella(esperada)}-tras-${anexo_en}`]);
  const payload = JSON.parse(
    (nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE clave = ?').get(pedidos()[0]) as { payload: string })
      .payload,
  ) as { dependencias: unknown };
  assert.deepEqual(payload.dependencias, esperada, 'lo que lleva viaja con el trabajo');
});
