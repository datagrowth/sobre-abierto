// «Volver a esta versión»: la versión siguiente copia los apartados de una anterior y
// se monta sin IA (portada y firma con el perfil de ahora), sin encolar ningún run; la pendiente
// que deja atrás se descarta y se dice, y lo anulado se hereda si la frase no cambió.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { api, arrancar, cerrar, db, ID, nucleo, salidas, sinMemorias } from '../helpers/memoriaEntorno.js';
import { apartadoCasoA } from './fixtures/casoA.js';

const { ensamblarMemoria, filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { fugasDeMemoria } = await import('../../src/dominios/licitaciones/oferta/fugasMemoria.js');
const { restaurarVersion } = await import('../../src/dominios/licitaciones/oferta/restaurar.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { documentoEnDisco } = await import('../../src/nucleo/salidas.js');

before(arrancar);
after(cerrar);

const PERFIL = {
  nif: 'B12345678',
  nombre: 'Analítica Ejemplo SL',
  domicilio: 'Calle Ejemplo 7, 38001 Puerto de Ejemplo',
};
// Nombra el modelo del sobre de los criterios automáticos (Anexo VII): es una fuga.
const FUGA = 'Las mejoras que ofrecemos se detallan en el Anexo VII que acompaña a la oferta.';
const raices = () => ({ salidas, conocimiento: null });
const trabajos = () => (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n;
const estadoBorrador = (id: number) =>
  (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(id) as { estado: string }).estado;
const textoDocx = (ruta: string) =>
  strFromU8(unzipSync(fs.readFileSync(documentoEnDisco(raices(), ruta).data!))['word/document.xml']!);
const datosApartados = (memoria: number) =>
  db
    .prepare('SELECT apartado, estado, datos FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(memoria) as { apartado: number; estado: string; datos: string | null }[];

// Lo redactado de un apartado del caso A, como lo guarda memoria_apartados (sin los números del pedido).
function datosDe(n: number, frase: string): string {
  const {
    id: _i,
    memoria_id: _m,
    guion_id: _g,
    version: _v,
    apartado: _a,
    ...datos
  } = apartadoCasoA(n, { memoria_id: 0, guion_id: 0, version: 0 });
  datos.bloques[0]!.parrafos.push(frase);
  return JSON.stringify(datos);
}

// Una versión de la oferta ya ensamblada (sin Hermes) con una frase propia en cada apartado.
async function ensamblada(version: number, frase: string): Promise<{ memoria: number; borrador: number }> {
  const g = guionVigente(db, ID)!;
  const memoria = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, ?, 'redactando', ?)",
      )
      .run(ID, g.id, version, new Date().toISOString()).lastInsertRowid,
  );
  const fila = db.prepare(
    "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres) VALUES (?, ?, 'recibido', ?, 1000)",
  );
  g.datos.memoria!.apartados.forEach((_, i) => fila.run(memoria, i + 1, datosDe(i + 1, frase)));
  const e = await ensamblarMemoria(db, memoria, raices());
  assert.equal(e.error, null, e.error?.message);
  return { memoria, borrador: e.data!.borrador };
}

function limpiar(): void {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');
  assert.equal(guardarPerfilEmpresa(nucleo().db, PERFIL).error, null);
}

test('should_create_a_new_version_equal_to_the_chosen_one_without_runs', async () => {
  limpiar();
  const v1 = await ensamblada(1, 'Frase propia de la primera versión.');
  db.prepare("UPDATE borradores SET estado = 'aceptada' WHERE id = ?").run(v1.borrador);
  await ensamblada(2, 'Frase propia de la segunda versión.');
  nucleo().db.exec('DELETE FROM trabajos_ia');

  const r = await api(`/licitaciones/${ID}/oferta/memoria/1/restaurar`);

  assert.equal(r.status, 201, await r.clone().text());
  const b = (await r.json()) as { version: number; desde: number; memoria: number; ruta: string; mensaje: string };
  assert.deepEqual([b.version, b.desde], [3, 1]);
  assert.equal(trabajos(), 0, 'ningún run: ni redacción ni autoevaluación');
  assert.deepEqual(
    datosApartados(b.memoria).map((a) => [a.apartado, a.estado, a.datos]),
    datosApartados(v1.memoria).map((a) => [a.apartado, a.estado, a.datos]),
  );
  assert.match(textoDocx(b.ruta), /Frase propia de la primera versión\./);
  assert.match(b.ruta, /memoria-v3\.docx$/);
  const fila = filaMemoria(db, b.memoria)!;
  assert.deepEqual([fila.estado, fila.version_base, fila.apartados_rehechos], ['ensamblada', 1, '[]']);
  assert.equal(estadoBorrador(v1.borrador), 'aceptada', 'la aceptada se queda hasta que se acepte otra');
});

test('should_discard_the_pending_version_and_say_so', async () => {
  limpiar();
  await ensamblada(1, 'Frase propia de la primera versión.');
  const v2 = await ensamblada(2, 'Frase propia de la segunda versión.');
  assert.equal(estadoBorrador(v2.borrador), 'pendiente');

  const r = await restaurarVersion(db, ID, 1, raices());

  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.descartadas, [2]);
  assert.equal(
    r.data!.mensaje,
    'Se crea la v3 igual que la v1, sin Hermes (0 runs). La v2 pendiente pasa a descartada.',
  );
  assert.equal(estadoBorrador(v2.borrador), 'descartada');
  assert.ok(
    r.data!.avisos.includes('Al llegar la v3, la v2 sin revisar pasó a descartada.'),
    'queda dicho en los avisos de la v3',
  );
  assert.equal(estadoBorrador(r.data!.borrador), 'pendiente', 'la copia se revisa como cualquier versión');
});

test('should_fail_as_value_for_an_unknown_version', async () => {
  limpiar();
  await ensamblada(1, 'Frase propia de la primera versión.');
  const antes = (db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n;

  const desconocida = await restaurarVersion(db, ID, 9, raices());
  const ultima = await restaurarVersion(db, ID, 1, raices());
  const ruta404 = await api(`/licitaciones/${ID}/oferta/memoria/9/restaurar`);
  const malformada = await api(`/licitaciones/${ID}/oferta/memoria/0/restaurar`);

  assert.deepEqual(
    [desconocida.error?.code, desconocida.error?.message],
    ['not_found', 'No hay memoria v9 de esta licitación.'],
  );
  assert.deepEqual([ultima.error?.code, ultima.error?.message], ['conflicto', 'La v1 ya es la última versión.']);
  assert.deepEqual([ruta404.status, malformada.status], [404, 400]);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n,
    antes,
    'no se crea ninguna versión',
  );
});

test('should_refuse_to_restore_while_another_version_is_being_written', async () => {
  limpiar();
  const v1 = await ensamblada(1, 'Frase propia de la primera versión.');
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 2, 'redactando', ?)",
  ).run(ID, filaMemoria(db, v1.memoria)!.guion_id, new Date().toISOString());

  const r = await restaurarVersion(db, ID, 1, raices());

  assert.equal(r.error?.code, 'conflicto');
  assert.equal(r.error?.message, 'La v2 se está redactando o montando: vuelve a la v1 cuando termine.');
});

test('should_inherit_the_annulled_leak_of_the_restored_version', async () => {
  limpiar();
  const v1 = await ensamblada(1, FUGA);
  assert.ok(
    fugasDeMemoria(db, v1.memoria).some((f) => f.cita === FUGA),
    'la frase es una fuga',
  );
  const anulacion = {
    motivo: 'Es el horario del pliego, no la bolsa ofertada.',
    en: new Date().toISOString(),
    fugas: [
      {
        apartado: 1,
        tipo: 'documento',
        marca: 'Anexo VII',
        criterio: 'Mejora 1: bolsa de horas adicionales',
        cita: FUGA,
      },
    ],
  };
  db.prepare('UPDATE memorias SET anulacion_fugas = ? WHERE id = ?').run(JSON.stringify(anulacion), v1.memoria);
  await ensamblada(2, 'Frase propia de la segunda versión.');

  const r = await restaurarVersion(db, ID, 1, raices());

  assert.equal(r.error, null, r.error?.message);
  assert.ok(r.data!.fugas_heredadas > 0);
  const heredada = JSON.parse(filaMemoria(db, r.data!.memoria)!.anulacion_fugas!) as {
    heredada_de: number;
    motivo: string;
    fugas: { cita: string }[];
  };
  assert.deepEqual([heredada.heredada_de, heredada.motivo], [1, anulacion.motivo]);
  assert.ok(heredada.fugas.every((f) => f.cita === FUGA));
});

test('should_keep_the_lote_of_the_restored_version_and_compare_with_the_last_of_its_lote', async () => {
  // Arrange: memoria por lote (CASO_E): v1 y v2 del lote 2, v3 del lote 4.
  limpiar();
  const delLote = (memoria: number, lote: string) =>
    db.prepare('UPDATE memorias SET lote = ? WHERE id = ?').run(lote, memoria);
  const v1 = await ensamblada(1, 'Frase propia de la primera versión.');
  delLote(v1.memoria, '2');
  const v2 = await ensamblada(2, 'Frase propia de la segunda versión.');
  delLote(v2.memoria, '2');
  const v3 = await ensamblada(3, 'Frase propia de la tercera versión.');
  delLote(v3.memoria, '4');

  // Act
  const ultimaDel4 = await restaurarVersion(db, ID, 3, raices());
  const r = await restaurarVersion(db, ID, 1, raices());

  // Assert
  assert.deepEqual(
    [ultimaDel4.error?.code, ultimaDel4.error?.message],
    ['conflicto', 'La v3 ya es la última versión de la memoria del lote 4.'],
  );
  assert.equal(r.error, null, r.error?.message);
  assert.equal(
    filaMemoria(db, r.data!.memoria)!.lote,
    '2',
    'la copia de una memoria del lote 2 sigue siendo del lote 2',
  );
  assert.deepEqual(r.data!.descartadas, [1, 2], 'solo las pendientes de su lote');
  assert.equal(estadoBorrador(v3.borrador), 'pendiente', 'la del lote 4 no se toca');
});
