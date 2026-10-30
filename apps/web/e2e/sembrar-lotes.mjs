// Siembra, en los datos temporales del e2e, una licitación real recortada «a uno o varios
// lotes» (máx. 2; fixture lotes-perfiles.atom del servidor) en preparación con el lote 2 de
// interés. Se ejecuta con el loader de tsx (importa el código del servidor) antes de arrancarlo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server');
const desde = (rel) => import(pathToFileURL(path.join(SERVER, rel)).href);

const ID = 'p-20602952';

const { iniciarNucleo, cerrarNucleo } = await desde('src/nucleo/contexto.ts');
const { dbLicitaciones, cerrarDbLicitaciones } = await desde('src/dominios/licitaciones/db.ts');
const { procesarPagina } = await desde('src/dominios/licitaciones/sincronizar.ts');
const { FUENTES } = await desde('src/dominios/licitaciones/placsp/fuentes.ts');

iniciarNucleo();
const db = dbLicitaciones();
procesarPagina(
  db,
  FUENTES.perfiles,
  fs.readFileSync(path.join(SERVER, 'tests', 'licitaciones', 'fixtures', 'lotes-perfiles.atom'), 'utf8'),
);
const ts = new Date().toISOString();
db.prepare(
  `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'e2e', ?, ?, ?)
  ON CONFLICT(licitacion_id) DO UPDATE SET estado = excluded.estado, lotes_interes = excluded.lotes_interes`,
).run(ID, JSON.stringify([{ id: '2', motivo: 'tamaño' }]), ts, ts);
cerrarDbLicitaciones();
cerrarNucleo();
