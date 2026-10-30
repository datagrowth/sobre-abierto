// Pasajes del pliego para cotejar los compromisos con coste: con un índice falso (la misma
// base que crea la Biblioteca, en un directorio temporal) se comprueba qué trozos quedan,
// cuándo no hay cotejo y que la caché no vuelve a leer los trozos si el pliego no cambia.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as indice from '../../src/biblioteca/motor/documentos/almacen.js';
import { trocearPaginas } from '../../src/biblioteca/motor/documentos/trozos.js';
import { pasajesParaCompromisos } from '../../src/dominios/licitaciones/oferta/pliegoCompromisos.js';
import type { Db } from '../../src/dominios/licitaciones/store.js';

const CARPETA = 'Licitaciones/Radar/2026/tc05';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliego-compromisos-'));
const idx = indice.abrirIndice(tmp);
const lic = new Database(':memory:') as unknown as Db;
after(() => {
  idx.close();
  lic.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

lic.exec(
  'CREATE TABLE pliegos (licitacion_id TEXT, url TEXT, ruta TEXT, clase TEXT, estado TEXT, actualizado_en TEXT)',
);

function indexar(nombre: string, paginas: string[], status: indice.FilaArchivo['status'] = 'ok', mtime = 1): string {
  const ruta = `${CARPETA}/${nombre}`;
  indice.reemplazarArchivo(
    idx,
    {
      path: ruta,
      kind: 'document',
      title: nombre,
      mtime_ms: mtime,
      size: 1,
      pages: paginas.length,
      status,
      error: null,
      source: null,
    },
    status === 'ok' ? trocearPaginas(paginas, true) : [],
  );
  return ruta;
}

function pliego(id: string, ruta: string, clase: string, actualizado = '2026-10-01T00:00:00Z'): void {
  lic.prepare("INSERT INTO pliegos VALUES (?, ?, ?, ?, 'descargado', ?)").run(id, ruta, ruta, clase, actualizado);
}

// Cuenta las lecturas de trozos (la consulta de chunksOfPaths) sin tocar el índice.
function contandoLecturas(db: indice.BaseDatos): { db: indice.BaseDatos; lecturas: () => number } {
  let n = 0;
  const proxy = new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (prop !== 'prepare' || typeof v !== 'function')
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      return (sql: string) => {
        if (/FROM chunks c JOIN files f/.test(sql) && /c\.ord/.test(sql)) n += 1;
        return target.prepare(sql);
      };
    },
  });
  return { db: proxy, lecturas: () => n };
}

const PPT = [
  'PLIEGO DE PRESCRIPCIONES TÉCNICAS. Antecedentes del programa en la provincia.',
  'La empresa adjudicataria deberá realizar, como mínimo, dos tutorías individuales por alumna y curso.',
];
const PCAP = ['Cláusula 12. Criterios de adjudicación: hasta 20 puntos por la calidad del plan de seguimiento.'];
const ADICIONAL = ['El contratista deberá entregar un kit a cada alumna.'];

test('should_return_not_cotejable_without_index_or_legible_pliego', () => {
  // Arrange
  pliego('sin-indice', indexar('ppt-a.pdf', PPT), 'ppt');
  pliego('escaneado', indexar('ppt-escaneado.pdf', [], 'scanned'), 'ppt');
  pliego('solo-adicional', indexar('anexo.pdf', ADICIONAL), 'adicional');
  // Act
  const sinIndice = pasajesParaCompromisos(lic, 'sin-indice', null);
  const ilegible = pasajesParaCompromisos(lic, 'escaneado', idx);
  const sinPliego = pasajesParaCompromisos(lic, 'no-existe', idx);
  const soloAdicional = pasajesParaCompromisos(lic, 'solo-adicional', idx);
  // Assert
  for (const r of [sinIndice, ilegible, sinPliego, soloAdicional])
    assert.deepEqual(r, { pasajes: [], cotejable: false });
});

test('should_keep_only_obligation_passages_of_ppt_and_pcap', () => {
  // Arrange
  const ppt = indexar('ppt-b.pdf', PPT);
  const pcap = indexar('pcap-b.pdf', PCAP);
  pliego('casoC', ppt, 'ppt');
  pliego('casoC', pcap, 'pcap');
  pliego('casoC', indexar('anexo-b.pdf', ADICIONAL), 'adicional');
  // Act
  const r = pasajesParaCompromisos(lic, 'casoC', idx);
  // Assert
  assert.equal(r.cotejable, true);
  assert.deepEqual(r.pasajes.map((p) => [p.clase, p.pagina]).sort(), [
    ['pcap', 1],
    ['ppt', 2],
  ]);
  assert.equal(r.pasajes.find((p) => p.clase === 'ppt')?.texto, PPT[1], 'la cita es literal');
  assert.ok(
    r.pasajes.every((p) => !/Antecedentes|kit/.test(p.texto)),
    'ni lo que no obliga ni otros documentos',
  );
});

test('should_recompute_when_pliego_huella_changes_and_reuse_otherwise', () => {
  // Arrange
  const ruta = indexar('ppt-c.pdf', PPT);
  pliego('cache', ruta, 'ppt');
  const { db, lecturas } = contandoLecturas(idx);
  // Act
  const primera = pasajesParaCompromisos(lic, 'cache', db);
  const segunda = pasajesParaCompromisos(lic, 'cache', db);
  lic.prepare("UPDATE pliegos SET actualizado_en = '2026-10-02T00:00:00Z' WHERE licitacion_id = 'cache'").run();
  const trasActualizar = pasajesParaCompromisos(lic, 'cache', db);
  indexar('ppt-c.pdf', [...PPT, 'El adjudicatario deberá enviar un informe final.'], 'ok', 2);
  const trasReindexar = pasajesParaCompromisos(lic, 'cache', db);
  // Assert
  assert.equal(segunda, primera, 'misma huella: el mismo resultado sin leer');
  assert.notEqual(trasActualizar, primera);
  assert.equal(trasReindexar.pasajes.length, 2);
  assert.equal(lecturas(), 3, 'una lectura por huella distinta');
});
