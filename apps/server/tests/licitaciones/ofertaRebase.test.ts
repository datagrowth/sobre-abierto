// Rebase tras un guion compatible con el caso A: volver a extraer el guion
// sin cambios no desfasa decisiones, memoria ni paquete ni pide otra propuesta (0 runs); un
// cambio solo desfasa lo que toca (un criterio automático, las decisiones; el precio de un lote,
// nada de la memoria), y una memoria de un guion anterior no se actualiza: pide una nueva.
// Cada test usa su licitación.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apartadoCasoA,
  decisionesCasoA,
  FICHA_CASO_A,
  GUION_CASO_A,
  guionCon,
  otraLicitacion,
  type Guion,
} from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-rebase-'));
const salidas = path.join(tmp, 'salidas');
fs.mkdirSync(salidas, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { decisionesVigentes, guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { memoriasDe } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { actualizarMemoria } = await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { paqueteVigente } = await import('../../src/dominios/licitaciones/oferta/paqueteManifiesto.js');
const { vueltaCadena } = await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { TIPO_PROPUESTA_DECISIONES, proponerAlLlegarGuion } =
  await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { guardarSeccion } = await import('../../src/dominios/licitaciones/oferta/decisionesSecciones.js');

iniciarNucleo();
const db = dbLicitaciones();
assert.equal(guardarPerfilEmpresa(nucleo().db, { nif: 'B12345678', nombre: 'Analítica Ejemplo SL' }).error, null);
const PERSONAS = ['Persona A', 'Persona B'].map(
  (nombre) => crearPersona(nucleo().db, { nombre, tipo: 'interno', rol: 'Consultora' }).data!.id,
);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ahora = () => new Date().toISOString();
const listo = () => 'listo' as const;

async function guion(id: string, g: Guion = GUION_CASO_A): Promise<number> {
  const r = await proponerGuion(db, GuionEntrada.parse({ ...g, id }), 'licitaciones');
  assert.equal(r.error, null);
  return r.data!.guion;
}

// Ficha, guion y decisiones guardadas: el punto de partida de cada caso.
async function oferta(id: string): Promise<number> {
  guardarLicitacion(db, otraLicitacion(id));
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
  ).run(id, ahora(), ahora());
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id }), 'licitaciones')).error, null);
  const g = await guion(id);
  assert.equal(guardarDecisiones(db, nucleo().db, id, decisionesCasoA(PERSONAS)).error, null);
  return g;
}

// Una memoria con fases y sus cuatro apartados recibidos; ensamblada, con su borrador.
function memoria(id: string, guionId: number, estado: 'ensamblada' | 'redactando', version = 1): number {
  const m = Number(
    db
      .prepare(
        `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, fase, ronda)
        VALUES (?, ?, ?, ?, ?, ?, 'fin', 0)`,
      )
      .run(id, guionId, version, estado, ahora(), estado === 'ensamblada' ? ahora() : null).lastInsertRowid,
  );
  for (const n of [1, 2, 3, 4]) {
    db.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, recibido_en) VALUES (?, ?, 'recibido', ?, 4000, 2, ?)",
    ).run(m, n, JSON.stringify(apartadoCasoA(n, { memoria_id: m, guion_id: guionId, version })), ahora());
  }
  if (estado !== 'ensamblada') return m;
  const b = db
    .prepare(
      `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, origen, guion_id, version, memoria_id)
    VALUES (?, ?, ?, 100, 'plataforma', ?, 'ensamblado', ?, ?, ?)`,
    )
    .run(id, `Salidas/Licitaciones/${id}/memoria-v${version}.docx`, 'a'.repeat(64), ahora(), guionId, version, m);
  db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(Number(b.lastInsertRowid), m);
  return m;
}

function paquete(id: string, guionId: number): void {
  const manifiesto = {
    licitacion: { id, expediente: id, titulo: 'Oferta', organo: 'SIIE' },
    version: 1,
    generado_en: ahora(),
    guion: { id: guionId, version: 1 },
    decisiones_en: null,
    plazo: { fecha_limite: null, texto: null, canal: null },
    lotes: [],
    carpetas: [],
    valores: [],
    comprobaciones: [],
  };
  db.prepare(
    `INSERT INTO paquetes_presentacion (licitacion_id, version, ruta, guion_id, manifiesto, bloqueos, avisos, creado_en)
    VALUES (?, 1, ?, ?, ?, 0, 0, ?)`,
  ).run(id, `Salidas/Licitaciones/${id}/paquete-v1`, guionId, JSON.stringify(manifiesto), ahora());
}

const guionDe = (tabla: 'memorias' | 'decisiones_oferta' | 'propuestas_decisiones', id: string) =>
  (db.prepare(`SELECT guion_id FROM ${tabla} WHERE licitacion_id = ?`).get(id) as { guion_id: number }).guion_id;
const propuestasPedidas = (id: string) =>
  (
    nucleo()
      .db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.id') = ?")
      .get(TIPO_PROPUESTA_DECISIONES, id) as { n: number }
  ).n;

test('should_keep_decisions_memory_and_package_valid_after_an_identical_reextraction', async () => {
  const id = 'p-rebase-1';
  const g1 = await oferta(id);
  memoria(id, g1, 'ensamblada');
  paquete(id, g1);

  const g2 = await guion(id);

  assert.notEqual(g2, g1);
  assert.equal(decisionesVigentes(db, nucleo().db, id).guion_cambiado, false);
  assert.equal(paqueteVigente(db, id)?.desfasado, false);
  assert.equal(memoriasDe(db, id)[0]?.guion_cambiado, false);
  assert.equal(
    (db.prepare('SELECT guion_id FROM borradores WHERE licitacion_id = ?').get(id) as { guion_id: number }).guion_id,
    g2,
  );
});

test('should_not_ask_a_new_proposal_after_an_identical_reextraction', async () => {
  const id = 'p-rebase-2';
  const g1 = await oferta(id);
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, agente, creada_en) VALUES (?, ?, '{}', 'licitaciones', ?)",
  ).run(id, g1, ahora());
  const antes = propuestasPedidas(id);

  const g2 = await guion(id);
  vueltaCadena(nucleo().db, db, Date.now(), listo);

  assert.equal(guionDe('propuestas_decisiones', id), g2);
  assert.equal(propuestasPedidas(id) - antes, 0, 'ningún run de propuesta nuevo');
});

test('should_not_ask_for_a_new_proposal_when_the_rebase_already_moved_it_to_the_current_guion', async () => {
  const id = 'p-rebase-2b';
  guardarLicitacion(db, otraLicitacion(id));
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
  ).run(id, ahora(), ahora());
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id }), 'licitaciones')).error, null);
  const g1 = await guion(id);
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, agente, creada_en) VALUES (?, ?, '{}', 'licitaciones', ?)",
  ).run(id, g1, ahora());
  const g2 = await guion(id);
  const antes = propuestasPedidas(id);

  proponerAlLlegarGuion(nucleo().db, db, id);

  assert.equal(guionDe('propuestas_decisiones', id), g2);
  assert.equal(propuestasPedidas(id) - antes, 0, 'ningún run de propuesta nuevo');
});

test('should_leave_decisions_outdated_when_an_automatic_criterion_changed', async () => {
  const id = 'p-rebase-3';
  const g1 = await oferta(id);
  memoria(id, g1, 'ensamblada');

  await guion(
    id,
    guionCon((g) => {
      g.automaticos[0]!.puntos = 12;
    }),
  );

  assert.equal(decisionesVigentes(db, nucleo().db, id).guion_cambiado, true);
  assert.equal(guionDe('decisiones_oferta', id), g1);
});

test('should_rebase_the_memory_when_only_a_lot_price_changed', async () => {
  const id = 'p-rebase-4';
  const g1 = await oferta(id);
  memoria(id, g1, 'ensamblada');
  paquete(id, g1);

  const g2 = await guion(
    id,
    guionCon((g) => {
      g.oferta_economica.presupuesto_base = 52_000;
    }),
  );

  assert.equal(guionDe('memorias', id), g2);
  assert.equal(memoriasDe(db, id)[0]?.guion_cambiado, false);
  assert.equal(guionDe('decisiones_oferta', id), g1, 'el precio sí desfasa las decisiones');
  assert.equal(paqueteVigente(db, id)?.desfasado, true, 'el paquete solo se rebasa sin ningún cambio');
});

test('should_let_improve_an_old_memory_redoing_only_the_changed_sections', async () => {
  const id = 'p-rebase-5';
  const g1 = await oferta(id);
  memoria(id, g1, 'ensamblada');
  const g2 = await guion(
    id,
    guionCon((g) => {
      g.memoria.apartados[1]!.se_valorara.push('Plan de mejora continua');
    }),
  );
  assert.equal(guionDe('memorias', id), g1, 'un apartado con otro contenido no se rebasa');
  assert.equal(guionDe('decisiones_oferta', id), g2, 'el enfoque no desfasa las decisiones');

  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id,
    version: 1,
    indicaciones: 'Añade el plan de mejora continua que pide ahora el pliego.',
    mejora: true,
  });

  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.apartados, [2], 'el apartado que cambió de contenido');
  const nueva = db.prepare('SELECT guion_id, fase FROM memorias WHERE id = ?').get(r.data!.memoria) as {
    guion_id: number;
    fase: string;
  };
  assert.equal(nueva.guion_id, g2, 'la versión nueva es del guion vigente');
});

test('should_refuse_to_update_an_old_memory_when_its_sections_moved', async () => {
  const id = 'p-rebase-6';
  const g1 = await oferta(id);
  memoria(id, g1, 'ensamblada');
  await guion(
    id,
    guionCon((g) => {
      g.memoria.apartados.reverse();
    }),
  );
  assert.equal(guionDe('memorias', id), g1);

  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id,
    version: 1,
    apartados: [1],
    indicaciones: 'Rehaz el primer apartado con más detalle.',
  });

  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /se redactó con otro guion/);
});

test('should_not_rebase_a_memory_still_being_written', async () => {
  const id = 'p-rebase-7';
  const g1 = await oferta(id);
  memoria(id, g1, 'redactando');

  const g2 = await guion(id);

  assert.equal(guionDe('memorias', id), g1);
  assert.equal(guionDe('decisiones_oferta', id), g2);
});

test('should_keep_actualizada_en_and_version_so_no_annex_is_requested', async () => {
  const id = 'p-rebase-8';
  await oferta(id);
  const leer = () =>
    db.prepare('SELECT actualizada_en, version, guion_id FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as {
      actualizada_en: string;
      version: number;
      guion_id: number;
    };
  const historial = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM decisiones_historial WHERE licitacion_id = ?').get(id) as { n: number }).n;
  const antes = leer();
  const filasAntes = historial();

  const g2 = await guion(id);

  const despues = leer();
  assert.deepEqual(
    [despues.actualizada_en, despues.version, despues.guion_id],
    [antes.actualizada_en, antes.version, g2],
  );
  assert.equal(historial(), filasAntes, 'los datos no cambian: ninguna versión nueva');
  assert.equal(guionVigente(db, id)?.id, g2);
});

test('should_accept_a_section_patch_with_the_version_read_before_the_rebase', async () => {
  const id = 'p-rebase-9';
  await oferta(id);
  const leida = (
    db.prepare('SELECT version FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as { version: number }
  ).version;
  await guion(id);

  const r = guardarSeccion(db, nucleo().db, id, 'enfoque', {
    version: leida,
    valor: 'Una persona de referencia y respuesta en 24 horas.',
  });

  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.version, leida + 1);
});

test('should_rebase_a_memory_assembled_after_an_identical_reextraction', async () => {
  const id = 'p-rebase-10';
  const g1 = await oferta(id);
  const m = memoria(id, g1, 'redactando');
  const g2 = await guion(id);
  assert.equal(guionDe('memorias', id), g1, 'mientras se redacta sigue con su guion');
  db.prepare("UPDATE memorias SET estado = 'ensamblada', ensamblada_en = ? WHERE id = ?").run(ahora(), m);

  vueltaCadena(nucleo().db, db, Date.now(), listo);

  assert.equal(guionDe('memorias', id), g2);
  assert.equal(memoriasDe(db, id)[0]?.guion_cambiado, false);
});
