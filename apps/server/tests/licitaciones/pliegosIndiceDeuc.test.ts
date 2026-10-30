// El DEUC (XML de la petición) se indexa en la Biblioteca, pero no es un pliego que lea la ficha:
// con un DEUC legible y sin PCAP ni PPT no se debe dar la ficha por lista.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliegos-indice-deuc-'));
const conocimiento = path.join(tmp, 'conocimiento');
fs.mkdirSync(conocimiento);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = conocimiento;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { legibilidadDePliegos, listoParaFicha } = await import('../../src/dominios/licitaciones/pliegosIndice.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
const db = dbLicitaciones();
const idx = indice.abrirIndice(path.join(tmp, 'indice'));
after(() => {
  idx.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function bajado(id: string, url: string, ruta: string, tipo: string | null): void {
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, tipo, actualizado_en) VALUES (?, ?, 'otro', ?, 'descargado', ?, ?, 'x')",
  ).run(id, url, path.basename(ruta), ruta, tipo);
  indice.reemplazarArchivo(
    idx,
    {
      path: ruta,
      kind: 'document',
      title: ruta,
      mtime_ms: 1,
      size: 1,
      pages: 1,
      status: 'ok',
      error: null,
      source: null,
    },
    [{ page: 1, text: 'texto' }],
  );
}

test('should_not_count_an_indexed_deuc_as_a_readable_pliego_for_the_ficha', () => {
  const l = licitacion({ titulo: 'Solo con DEUC', publicada: '2026-09-24', limite: '2026-10-30T08:00:00' });
  guardarLicitacion(db, l);
  bajado(l.id, 'https://contrataciondelestado.es/deuc', `Licitaciones/${l.id}/DEUC.xml`, 'deuc');

  const leg = legibilidadDePliegos(db, l.id, idx);

  assert.deepEqual(leg, []);
  // listoParaFicha([]) da 'listo': por eso ficha.ts excluye el DEUC al ver si hay pliegos bajados.
  assert.equal(listoParaFicha(leg), 'listo');
  bajado(l.id, 'https://contrataciondelestado.es/otro', `Licitaciones/${l.id}/Anexo.pdf`, null);
  assert.deepEqual(
    legibilidadDePliegos(db, l.id, idx)!.map((x) => path.basename(x.ruta)),
    ['Anexo.pdf'],
  );
});
