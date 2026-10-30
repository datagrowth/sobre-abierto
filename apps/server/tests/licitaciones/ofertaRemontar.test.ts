// Volver a montar la memoria sin IA: una versión ya ensamblada se recompone con el
// mismo texto y la portada y la firma del perfil de empresa de ahora, sin ningún run, en
// memoria-vN-2.* junto a lo anterior y sin perder que estuviera dada por buena.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { api, arrancar, cerrar, db, ID, nucleo, salidas, sinMemorias } from '../helpers/memoriaEntorno.js';

const { ensamblarMemoria, filaMemoria, liberarEnsamblados, MAX_CORTES_ENSAMBLADO, remontarMemoria, AVISO_SIN_PERFIL } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { reanudarEnsamblados } = await import('../../src/dominios/licitaciones/oferta/reanudarEnsamblado.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { documentoEnDisco } = await import('../../src/nucleo/salidas.js');

before(arrancar);
after(cerrar);

const PERFIL = {
  nif: 'B12345678',
  nombre: 'Analítica Ejemplo SL',
  domicilio: 'Calle Ejemplo 7, 38001 Puerto de Ejemplo',
};
const NIF_NUEVO = 'B76543210';
type Borrador = { id: number; estado: string; revisado_en: string | null; ruta: string };

const raices = () => ({ salidas, conocimiento: null });
const trabajos = () => (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n;
const borrador = (id: number) =>
  db.prepare('SELECT id, estado, revisado_en, ruta FROM borradores WHERE id = ?').get(id) as Borrador;
const enDisco = (ruta: string) => documentoEnDisco(raices(), ruta).data!;
const textoDocx = (ruta: string) => strFromU8(unzipSync(fs.readFileSync(enDisco(ruta)))['word/document.xml']!);

function sinPerfil(): void {
  nucleo().db.prepare('DELETE FROM perfil_empresa').run();
}

function conPerfil(nif = PERFIL.nif): void {
  assert.equal(guardarPerfilEmpresa(nucleo().db, { ...PERFIL, nif }).error, null);
}

// La primera versión de la memoria de la oferta, con todos sus apartados sin redactar, ya ensamblada (sin Hermes).
async function ensamblada(version = 1): Promise<{ memoria: number; borrador: number; ruta: string }> {
  const g = guionVigente(db, ID)!;
  const memoria = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, ?, 'redactando', ?)",
      )
      .run(ID, g.id, version, new Date().toISOString()).lastInsertRowid,
  );
  const fila = db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, ?, 'fallido')");
  g.datos.memoria!.apartados.forEach((_, i) => fila.run(memoria, i + 1));
  const e = await ensamblarMemoria(db, memoria, raices());
  assert.equal(e.error, null, e.error?.message);
  return { memoria, borrador: e.data!.borrador, ruta: e.data!.ruta };
}

function limpiar(): void {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');
  conPerfil();
}

test('should_remount_assembled_memoria_with_current_company_nif_without_enqueuing_any_job', async () => {
  limpiar();
  const m = await ensamblada();
  conPerfil(NIF_NUEVO);
  const antes = trabajos();

  const r = await remontarMemoria(db, ID, 1, raices());

  assert.equal(r.error, null, r.error?.message);
  assert.equal(trabajos(), antes, 'ningún trabajo de IA');
  assert.match(textoDocx(r.data!.ruta), new RegExp(NIF_NUEVO));
  assert.doesNotMatch(textoDocx(m.ruta), new RegExp(NIF_NUEVO), 'el anterior no se toca');
  assert.equal(filaMemoria(db, m.memoria)!.estado, 'ensamblada');
  assert.equal(filaMemoria(db, m.memoria)!.borrador_id, r.data!.borrador);
  const ev = ultimosEventos(nucleo().db, 50).find((e) => e.tipo === 'licitacion.memoria');
  assert.equal((ev?.datos as { accion?: string } | undefined)?.accion, 'remontada');
});

test('should_drop_stale_missing_profile_warning_after_remount', async () => {
  limpiar();
  sinPerfil();
  const m = await ensamblada();
  assert.ok((JSON.parse(filaMemoria(db, m.memoria)!.avisos) as string[]).includes(AVISO_SIN_PERFIL));
  conPerfil(NIF_NUEVO);

  const r = await remontarMemoria(db, ID, 1, raices());

  assert.equal(r.error, null, r.error?.message);
  assert.ok(!r.data!.avisos.includes(AVISO_SIN_PERFIL));
  const avisos = JSON.parse(filaMemoria(db, m.memoria)!.avisos) as string[];
  assert.ok(!avisos.includes(AVISO_SIN_PERFIL));
  assert.equal(new Set(avisos).size, avisos.length, 'sin avisos repetidos');
});

test('should_keep_accepted_review_after_remount', async () => {
  limpiar();
  const m = await ensamblada();
  db.prepare("UPDATE borradores SET estado = 'aceptada', revisado_en = ? WHERE id = ?").run(
    new Date().toISOString(),
    m.borrador,
  );

  const r = await remontarMemoria(db, ID, 1, raices());

  assert.equal(r.error, null, r.error?.message);
  const nuevo = borrador(r.data!.borrador);
  assert.equal(nuevo.estado, 'aceptada');
  assert.ok(nuevo.revisado_en);
  assert.equal(borrador(m.borrador).estado, 'descartada');
});

test('should_not_overwrite_previous_files_when_remounting', async () => {
  limpiar();
  const m = await ensamblada();
  const original = fs.readFileSync(enDisco(m.ruta));

  const r = await api(`/licitaciones/${ID}/oferta/memoria/1/remontar`);

  assert.equal(r.status, 202, await r.clone().text());
  const b = (await r.json()) as { ruta: string };
  assert.match(b.ruta, /memoria-v1-2\.docx$/);
  assert.match(m.ruta, /memoria-v1\.docx$/);
  assert.deepEqual(fs.readFileSync(enDisco(m.ruta)), original);
});

test('should_refuse_to_remount_uploaded_word', async () => {
  limpiar();
  const m = await ensamblada();
  db.prepare("UPDATE memorias SET subida = 'memoria-editada.docx' WHERE id = ?").run(m.memoria);

  const r = await remontarMemoria(db, ID, 1, raices());

  assert.equal(r.error?.code, 'conflicto');
  assert.equal(r.error?.message, 'La v1 es un Word subido a mano: corrige la portada en tu Word y súbelo otra vez.');
  assert.equal(filaMemoria(db, m.memoria)!.estado, 'ensamblada');
});

test('should_refuse_to_remount_while_another_version_is_being_written', async () => {
  limpiar();
  const m = await ensamblada();
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 2, 'redactando', ?)",
  ).run(ID, filaMemoria(db, m.memoria)!.guion_id, new Date().toISOString());

  const r = await remontarMemoria(db, ID, 1, raices());

  assert.equal(r.error?.code, 'conflicto');
  assert.equal(filaMemoria(db, m.memoria)!.estado, 'ensamblada');
});

test('should_remount_while_a_rehearsal_or_another_lot_memory_is_being_written', async () => {
  // Arrange: el ensayo de la versión 2, que se redacta (tarda horas), y la versión 3 de otro lote que se monta.
  limpiar();
  const m = await ensamblada();
  const guion = filaMemoria(db, m.memoria)!.guion_id;
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensayo) VALUES (?, ?, 2, 'redactando', ?, 1)",
  ).run(ID, guion, new Date().toISOString());
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, lote) VALUES (?, ?, 3, 'ensamblando', ?, '4')",
  ).run(ID, guion, new Date().toISOString());

  // Act
  const r = await remontarMemoria(db, ID, 1, raices());

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(filaMemoria(db, m.memoria)!.estado, 'ensamblada');
});

test('should_refuse_to_remount_a_memoria_that_is_not_assembled', async () => {
  limpiar();
  const g = guionVigente(db, ID)!;
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, error) VALUES (?, ?, 1, 'fallida', ?, 'x')",
  ).run(ID, g.id, new Date().toISOString());

  const fallida = await remontarMemoria(db, ID, 1, raices());
  const inexistente = await api(`/licitaciones/${ID}/oferta/memoria/9/remontar`);
  const malformada = await api(`/licitaciones/${ID}/oferta/memoria/abc/remontar`);

  assert.equal(fallida.error?.message, 'Solo se vuelve a montar una memoria ya ensamblada.');
  assert.equal(inexistente.status, 404);
  assert.equal(malformada.status, 400);
});

test('should_remount_again_without_ai_when_a_restart_interrupts_its_remount', async () => {
  limpiar();
  const m = await ensamblada();
  db.prepare("UPDATE borradores SET estado = 'aceptada', revisado_en = ? WHERE id = ?").run(
    new Date().toISOString(),
    m.borrador,
  );
  // Lo que deja un reinicio a mitad de «Volver a montar sin IA»: la memoria reservada y su documento de antes.
  db.prepare("UPDATE memorias SET estado = 'ensamblando' WHERE id = ?").run(m.memoria);
  const antes = trabajos();

  await reanudarEnsamblados(db);

  const fila = filaMemoria(db, m.memoria)!;
  assert.deepEqual([fila.estado, fila.error, fila.cortes_ensamblado], ['ensamblada', null, 0]);
  assert.notEqual(fila.borrador_id, m.borrador, 'se volvió a montar');
  assert.equal(borrador(fila.borrador_id!).estado, 'aceptada', 'el nuevo hereda que estaba dada por buena');
  assert.equal(trabajos(), antes, 'sin ningún run');
});

test('should_keep_memoria_assembled_with_its_previous_document_when_its_remount_is_cut_three_times', async () => {
  limpiar();
  const m = await ensamblada();
  db.prepare("UPDATE memorias SET estado = 'ensamblando' WHERE id = ?").run(m.memoria);

  for (let corte = 1; corte < MAX_CORTES_ENSAMBLADO; corte++)
    assert.equal(liberarEnsamblados(db).length, 1, `corte ${corte}: se vuelve a montar`);
  assert.deepEqual(liberarEnsamblados(db), []);

  const fila = filaMemoria(db, m.memoria)!;
  assert.deepEqual(
    [fila.estado, fila.borrador_id, fila.error, fila.cortes_ensamblado],
    ['ensamblada', m.borrador, null, 0],
  );
});

test('should_resume_an_interrupted_first_assembly_on_restart', () => {
  limpiar();
  const g = guionVigente(db, ID)!;
  const memoria = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 1, 'ensamblando', ?)",
      )
      .run(ID, g.id, new Date().toISOString()).lastInsertRowid,
  );

  assert.deepEqual(
    liberarEnsamblados(db).map((f) => f.id),
    [memoria],
    'se devuelve para volver a montarla',
  );

  assert.deepEqual([filaMemoria(db, memoria)!.estado, filaMemoria(db, memoria)!.cortes_ensamblado], ['ensamblando', 1]);
});
