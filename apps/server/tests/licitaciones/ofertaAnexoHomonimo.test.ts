// Anexos cuyo modelo es un .docx suelto con el mismo número («ANEXO V.docx»), caso Villaejemplo: la fila
// de la checklist sale rellenable en lugar de «el modelo está en un PDF sin campos». El número de
// anexo no se confunde con otro (V/VI, III/III Bis), el nombre admite guiones bajos, gana el archivo
// que nombra el lote y sin homónimo todo sigue como antes. Sin personas ni importes reales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DocumentoConAnexo } from '../../src/dominios/licitaciones/oferta/anexosChecklist.js';
import { ID, guionCon, licitacionCasoA } from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-homonimo-'));
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

const { iniciarNucleo } = await import('../../src/nucleo/contexto.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { dbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { documentosOferta } = await import('../../src/dominios/licitaciones/oferta/anexosChecklist.js');
const { numeroDeAnexo, pliegoHomonimo } = await import('../../src/dominios/licitaciones/oferta/anexosModelo.js');

iniciarNucleo();
const db = dbLicitaciones();
const CARPETA = `Licitaciones/Radar/2026/casoC (${ID})`;
const NOMBRES = [
  'PCAP.pdf',
  'ANEXO V.docx',
  'ANEXO VI.docx',
  'ANEXO VII.docx',
  'ANEXO IV.docx',
  'Anexo_III_Proposicion_Economica.docx',
  'Anexo III Bis.docx',
];

guardarLicitacion(db, licitacionCasoA());
for (const n of NOMBRES) {
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
  ).run(
    ID,
    `https://contrataciondelestado.es/${encodeURIComponent(n)}`,
    n,
    `${CARPETA}/${n}`,
    new Date().toISOString(),
  );
}

const guion = guionCon((g) => {
  const origen = (modelo: string) => ({ modelo, documento: 'PCAP.pdf', pagina: 1 });
  const docs = g.archivos[0]!.documentos as unknown as Record<string, unknown>[];
  docs[4] = {
    tipo: 'declaracion',
    nombre: 'Anexo V',
    obligatorio: true,
    produce: 'persona',
    origen: origen('Anexo V, LOTE 3, apartado 2'),
  };
  docs[5] = {
    tipo: 'declaracion',
    nombre: 'Anexo VI',
    obligatorio: true,
    produce: 'persona',
    origen: origen('Anexo VI'),
  };
  (g.archivos[1]!.documentos[0] as unknown as { origen: unknown }).origen = origen('Anexo VII');
});
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);

test('should_read_annex_number_from_model_name', () => {
  assert.equal(numeroDeAnexo('Anexo V, LOTE 3, apartado 2'), 'V');
  assert.equal(numeroDeAnexo('ANEXO II (instrucciones para rellenarlo)'), 'II');
  assert.equal(numeroDeAnexo('Anexo III Bis'), 'III BIS');
  assert.equal(numeroDeAnexo('Anexo 12'), '12');
  assert.equal(numeroDeAnexo('Modelo de proposición'), null);
});

test('should_use_homonymous_docx_when_model_names_an_annex', () => {
  assert.equal(pliegoHomonimo(db, ID, 'Anexo V', null), `${CARPETA}/ANEXO V.docx`);
});

test('should_not_confuse_annex_v_with_annex_vi', () => {
  assert.equal(pliegoHomonimo(db, ID, 'Anexo VI', null), `${CARPETA}/ANEXO VI.docx`);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo III', null), `${CARPETA}/Anexo_III_Proposicion_Economica.docx`);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo III Bis', null), `${CARPETA}/Anexo III Bis.docx`);
});

test('should_match_annex_with_underscores_in_file_name', () => {
  assert.equal(pliegoHomonimo(db, ID, 'ANEXO III', null), `${CARPETA}/Anexo_III_Proposicion_Economica.docx`);
});

test('should_prefer_the_file_that_names_the_lot', () => {
  const ruta = `${CARPETA}/ANEXO IV - Lote 2.docx`;
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'https://x/iv2', 'anexo', 'ANEXO IV - Lote 2.docx', 'descargado', ?, ?)",
  ).run(ID, ruta, new Date().toISOString());
  assert.equal(pliegoHomonimo(db, ID, 'Anexo IV', '2'), ruta);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo IV', null), `${CARPETA}/ANEXO IV.docx`);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo IV', '3'), `${CARPETA}/ANEXO IV.docx`);
});

test('should_fall_back_to_origin_document_when_no_homonymous_file', async () => {
  assert.equal(pliegoHomonimo(db, ID, 'Anexo VIII', null), null);
  const r = await documentosOferta(db, raicesActuales(), ID);
  const fila = r.data!.documentos.find((d) => d.nombre === 'Anexo XIII. Declaración responsable')!;
  assert.equal(fila.anexo.rellenable, false);
  assert.match(fila.anexo.motivo ?? '', /No encuentro/);
});

test('should_mark_rows_fillable_when_homonymous_docx_exists', async () => {
  const r = await documentosOferta(db, raicesActuales(), ID);
  assert.equal(r.error, null);
  for (const nombre of ['Anexo V', 'Anexo VI', 'Anexo VII. Proposición económica']) {
    const fila: DocumentoConAnexo = (r.data?.documentos ?? []).find((d) => d.nombre === nombre)!;
    assert.equal(fila.anexo.rellenable, true, nombre);
    assert.equal(fila.anexo.motivo, null);
    assert.ok(
      fila.anexo.avisos.some((a: string) => a.startsWith('Modelo tomado de «ANEXO')),
      nombre,
    );
  }
});

test('should_read_annex_subnumber_from_model_name', () => {
  assert.equal(numeroDeAnexo('Anexo V.2 compromiso de adscripción'), 'V.2');
  assert.equal(numeroDeAnexo('Anexo 1.1'), '1.1');
  assert.equal(numeroDeAnexo('Ver el Anexo V.'), 'V');
});

test('should_not_confuse_annexes_with_subnumbering', () => {
  const ahora = new Date().toISOString();
  for (const n of ['ANEXO V.1.docx', 'ANEXO V.2.docx', 'Anexo 1.1.docx']) {
    db.prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
    ).run(ID, `https://contrataciondelestado.es/${encodeURIComponent(n)}`, n, `${CARPETA}/${n}`, ahora);
  }
  assert.equal(pliegoHomonimo(db, ID, 'Anexo V.1 declaración responsable', null), `${CARPETA}/ANEXO V.1.docx`);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo V.2 compromiso', null), `${CARPETA}/ANEXO V.2.docx`);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo V', null), `${CARPETA}/ANEXO V.docx`);
  assert.equal(pliegoHomonimo(db, ID, 'Anexo 1', null), null, '«Anexo 1.1.docx» no es el «Anexo 1»');
});
