// Carpeta única por licitación: el ensayo en seco dice qué se movería sin tocar nada, y la
// migración (en el disco, sin Drive) lo mueve, reescribe las rutas guardadas, apunta la carpeta y
// hace que la oferta y los pliegos sigan escribiéndose en ella. Nunca pisa ni corre con Hermes en marcha.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carpeta-unica-'));
const conocimiento = path.join(tmp, 'conocimiento');
const salidas = path.join(tmp, 'salidas');
fs.mkdirSync(conocimiento, { recursive: true });
fs.mkdirSync(salidas, { recursive: true });
Object.assign(process.env, {
  PLATAFORMA_DATA_DIR: path.join(tmp, 'datos'),
  VAULT_PATH: conocimiento,
  SALIDAS_DIR: salidas,
  HERMES_VAULT_CONFIG_PATH: path.join(tmp, '__no_config__.json'),
  LICITACIONES_ACTIVO: '0',
  NODE_ENV: 'test',
  DRIVE_STATE_DIR: path.join(tmp, 'drive-state'),
});

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { obtenerLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { carpetaDe } = await import('../../src/dominios/licitaciones/carpetas.js');
const { carpetaSalidas, carpetaEnSalidas } = await import('../../src/dominios/licitaciones/propuestas/borrador.js');
const { carpetaPliegos } = await import('../../src/dominios/licitaciones/pliegos.js');
const { cargarCarpetasUnicas, carpetaUnicaEnDb } = await import('../../src/dominios/licitaciones/carpetasUnicas.js');
const { ensayoCarpetaUnica, nombreCarpetaUnica, CARPETA_OFERTAS } =
  await import('../../src/dominios/licitaciones/carpetaUnica.js');
const { migrarCarpetaUnica, leerMigracion, asegurarCarpetaUnica, CLAVE_MIGRACION } =
  await import('../../src/dominios/licitaciones/migracionCarpetaUnica.js');
const { motivoBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
await import('../../src/dominios/licitaciones/tools.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, 'requisitos.atom'), 'utf8'));
const ID = 'p-20435341';
const ts = '2026-10-20T10:00:00.000Z';
const raices = { conocimiento, salidas };

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

beforeEach(() => {
  dbLicitaciones().exec(
    'DELETE FROM oportunidades; DELETE FROM pliegos; DELETE FROM carpetas_presentadas; DELETE FROM borradores; DELETE FROM carpetas_unicas;',
  );
  nucleo().db.exec(`DELETE FROM trabajos_ia; DELETE FROM operaciones_unicas WHERE clave = '${CLAVE_MIGRACION}';`);
  cargarCarpetasUnicas(dbLicitaciones());
  for (const d of [conocimiento, salidas]) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d);
  }
});

function escribir(base: string, rel: string, texto: string): void {
  const abs = path.join(base, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
}

const existe = (base: string, rel: string) => fs.existsSync(path.join(base, ...rel.split('/')));

function enPreparacion(): { radar: string; enSalidas: string } {
  const l = obtenerLicitacion(dbLicitaciones(), ID)!;
  dbLicitaciones()
    .prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'en_preparacion', ?, ?)",
    )
    .run(ID, ts, ts);
  const radar = carpetaDe(l);
  escribir(conocimiento, `${radar}/PCAP.pdf`, '12345');
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/x', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)",
    )
    .run(ID, `${radar}/PCAP.pdf`, ts);
  const enSalidas = carpetaEnSalidas(l);
  escribir(salidas, `${enSalidas.slice(8)}/memoria-v1.docx`, 'abc');
  escribir(salidas, `${enSalidas.slice(8)}/PRESENTACION/v1 2026-10-20/Lote 1/Sobre 2/01 Memoria.pdf`, 'abcd');
  dbLicitaciones()
    .prepare(
      "INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en) VALUES (?, ?, 'x', 3, 'plataforma', ?)",
    )
    .run(ID, `${enSalidas}/memoria-v1.docx`, ts);
  return { radar, enSalidas };
}

const esperar = async () => {
  const m = migrarCarpetaUnica(raices);
  assert.equal(m.error, null);
  return m.data!;
};

test('should_name_the_single_folder_with_file_number_short_title_and_id', () => {
  const nombre = nombreCarpetaUnica({
    id: 'p-1',
    expediente: 'SER/2026/1',
    titulo: 'Contratación del servicio de formación en ofimática para el personal',
  });
  assert.equal(nombre, 'SER-2026-1 · Formación en ofimática para el personal (p-1)');
  const largo = nombreCarpetaUnica({
    id: 'p-20435341',
    expediente: 'X'.repeat(80),
    titulo: 'Tema muy largo '.repeat(20),
  });
  assert.ok(largo.length <= 100, largo);
  assert.ok(largo.endsWith(' (p-20435341)'), largo);
});

test('should_plan_pliegos_oferta_and_sobres_moves_without_touching_anything', () => {
  // Arrange
  const { radar, enSalidas } = enPreparacion();

  // Act
  const e = ensayoCarpetaUnica(dbLicitaciones(), raices);

  // Assert
  const l = e.licitaciones[0]!;
  assert.ok(l.destino.startsWith(`${CARPETA_OFERTAS}/`));
  const dentro = (a: string) => a.slice(`Conocimiento/${l.destino}`.length);
  assert.deepEqual(
    l.pasos.map((p) => [p.de, dentro(p.a), p.archivos]),
    [
      [`Conocimiento/${radar}`, '/Pliegos', 1],
      [enSalidas, '/Oferta', 2],
    ],
  );
  assert.equal(l.filas, 2, 'el pliego y el borrador apuntan dentro');
  assert.ok(existe(conocimiento, `${radar}/PCAP.pdf`) && !existe(conocimiento, l.destino), 'el ensayo no mueve nada');
});

test('should_split_a_presented_folder_into_pliegos_and_presentada', () => {
  enPreparacion();
  const presentada = 'Licitaciones/Presentadas/2026-10 - SER - Órgano - Tema';
  escribir(conocimiento, `${presentada}/PLIEGOS/PPT.pdf`, 'x');
  escribir(conocimiento, `${presentada}/DOCUMENTACION PRESENTADA/v1/oferta.pdf`, 'xy');
  dbLicitaciones()
    .prepare(
      "INSERT INTO carpetas_presentadas (licitacion_id, nombre, ruta, estado, creada_en, actualizada_en) VALUES (?, 'x', ?, 'hecha', ?, ?)",
    )
    .run(ID, presentada, ts, ts);
  const l = ensayoCarpetaUnica(dbLicitaciones(), raices).licitaciones[0]!;
  const enConocimiento = l.pasos
    .filter((p) => p.de.startsWith(`Conocimiento/${presentada}`))
    .map((p) => [p.de.slice(`Conocimiento/${presentada}`.length), p.a.slice(`Conocimiento/${l.destino}`.length)]);
  assert.deepEqual(enConocimiento, [
    ['/PLIEGOS', '/Pliegos'],
    ['/DOCUMENTACION PRESENTADA', '/Presentada'],
  ]);
});

test('should_list_salidas_folders_of_unknown_tenders_apart', () => {
  escribir(salidas, 'Licitaciones/OTRO (p-999)/a.docx', 'z');
  assert.deepEqual(ensayoCarpetaUnica(dbLicitaciones(), raices).sin_licitacion, ['Salidas/Licitaciones/OTRO (p-999)']);
  assert.match(
    ensayoCarpetaUnica(dbLicitaciones(), { conocimiento: null, salidas: null }).sin_disco ?? '',
    /Conocimiento/,
  );
});

test('should_migrate_moving_folders_rewriting_paths_and_keeping_a_copy', async () => {
  // Arrange
  const { radar, enSalidas } = enPreparacion();
  const destino = ensayoCarpetaUnica(dbLicitaciones(), raices).licitaciones[0]!.destino;

  // Act
  const m = await esperar();

  // Assert
  assert.equal(m.estado, 'hecha', m.mensaje);
  assert.ok(existe(conocimiento, `${destino}/Pliegos/PCAP.pdf`) && !existe(conocimiento, radar));
  assert.ok(existe(conocimiento, `${destino}/Oferta/memoria-v1.docx`) && !existe(salidas, enSalidas.slice(8)));
  assert.ok(existe(conocimiento, `${destino}/Sobres/v1 2026-10-20/Lote 1/Sobre 2/01 Memoria.pdf`));
  const db = dbLicitaciones();
  assert.equal(
    (db.prepare('SELECT ruta FROM pliegos WHERE licitacion_id = ?').get(ID) as { ruta: string }).ruta,
    `${destino}/Pliegos/PCAP.pdf`,
  );
  assert.equal(
    (db.prepare('SELECT ruta FROM borradores WHERE licitacion_id = ?').get(ID) as { ruta: string }).ruta,
    `Conocimiento/${destino}/Oferta/memoria-v1.docx`,
  );
  assert.equal(carpetaUnicaEnDb(db, ID), destino);
  const l = obtenerLicitacion(db, ID)!;
  assert.equal(
    carpetaSalidas(l),
    `Conocimiento/${destino}/Oferta`,
    'lo nuevo de la oferta se escribe ya en su carpeta',
  );
  assert.equal(carpetaPliegos(db, l), `${destino}/Pliegos`);
  assert.ok(
    fs.existsSync(path.join(m.copia!, 'licitaciones.db')) && fs.existsSync(path.join(m.copia!, 'nucleo.db')),
    'copia previa de las bases',
  );
  assert.ok(fs.existsSync(path.join(m.copia!, 'manifiesto.json')));
  assert.deepEqual(ensayoCarpetaUnica(db, raices).licitaciones, [], 'repetido, el ensayo sale vacío');
});

test('should_not_overwrite_an_occupied_destination', async () => {
  // Arrange
  const { radar } = enPreparacion();
  const destino = ensayoCarpetaUnica(dbLicitaciones(), raices).licitaciones[0]!.destino;
  escribir(conocimiento, `${destino}/Pliegos/de-antes.pdf`, 'y');

  // Act
  const m = await esperar();

  // Assert
  assert.equal(m.estado, 'error');
  assert.match(m.errores[0]!.motivo, /ya existe/);
  assert.ok(existe(conocimiento, `${radar}/PCAP.pdf`), 'lo suyo sigue donde estaba');
  assert.equal(carpetaUnicaEnDb(dbLicitaciones(), ID), null);
});

test('should_refuse_to_migrate_while_hermes_is_working', () => {
  nucleo()
    .db.prepare(
      "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES ('licitaciones.memoria', 'licitaciones', 'k', '{}', 'lanzado', ?, ?)",
    )
    .run(ts, ts);
  const m = migrarCarpetaUnica(raices);
  assert.equal(m.error?.code, 'conflicto');
  assert.equal(leerMigracion().estado, 'sin_lanzar');
});

test('should_give_a_new_offer_its_folder_once_the_migration_ran', async () => {
  // Arrange: migración sin nada que mover y, después, una oferta nueva en preparación.
  await esperar();
  enPreparacion();

  // Act
  const r = await asegurarCarpetaUnica(ID, raices);

  // Assert
  assert.equal(r.error, null);
  const destino = carpetaUnicaEnDb(dbLicitaciones(), ID)!;
  assert.ok(existe(conocimiento, `${destino}/Pliegos/PCAP.pdf`));
  assert.equal(leerMigracion().hechas.length, 0, 'Aplicar no toca el informe de la migración');
});

test('should_hide_cv_copies_from_the_library_to_agents_without_permission', () => {
  const cv = 'Licitaciones/Ofertas/X (p-1)/Oferta/documentos/Colaboradores/cv-ana.pdf';
  assert.match(motivoBiblioteca(cv, { permisos: {} }) ?? '', /CV/);
  assert.equal(motivoBiblioteca(cv, { permisos: { colaboradores: 'leer' } }), null);
  assert.equal(
    motivoBiblioteca('Licitaciones/Ofertas/X (p-1)/Sobres/v1/VALORES_A_TECLEAR.md', { permisos: {} }),
    null,
    'los importes de lo pasado se aprenden',
  );
});
