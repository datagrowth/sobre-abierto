// «Actualizar los apartados afectados» sobre una memoria con fases con la memoria del
// lote 2 de CASO_E (fixtures/comprobaciones/casoE.json, seudonimizada): el caso «persona» de §6.2.5 (la docente
// principal del lote 2 sale y entra otra) rehace solo el apartado que la nombra, copia el resto
// palabra por palabra y entra directamente en la redacción, sin dossier ni estrategia por IA. Lo
// que traen los runs (estrategia, apartados) se escribe con SQL directo.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-actualizar-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
const indexDir = path.join(tmp, 'index');
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = indexDir;
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { trocearPaginas } = await import('../../src/biblioteca/motor/documentos/trozos.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { componerDossier, dossierDe, guardarDossier } =
  await import('../../src/dominios/licitaciones/oferta/dossier.js');
const { actualizarMemoria, NADA_QUE_ACTUALIZAR, PREFIJO_HECHOS_REHECHOS, textoDelCambio, textoDelCambioPorRoles } =
  await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { instruccionesRedaccion, lineasActualizacion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { TIPO_MEMORIA_ESTRATEGIA } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { desfaseMemoria } = await import('../../src/dominios/licitaciones/oferta/huellasMemoria.js');
const { estrategiaCasoA } = await import('./fixtures/estrategiaCasoA.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type HechoData = import('../../src/dominios/licitaciones/oferta/estrategia.js').HechoData;

iniciarNucleo();
const db = dbLicitaciones();
let server: http.Server | null = null;
let baseUrl = '';
before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_E = leerFixtureComprobaciones('casoE');
sembrarFixture(db, nucleo().db, CASO_E);
// El plazo real de CASO_E ya pasó: se aplaza para que el pedido no choque con él.
db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run('2026-12-15T08:00:00', CASO_E.id);

const persona = (nombre: string) => crearPersona(nucleo().db, { nombre, tipo: 'interno', rol: 'Docente' }).data!.id;
const SALE = 'Persona Hache';
const ENTRA = 'Persona Eme';
const ID_SALE = persona(SALE);
const ID_ENTRA = persona(ENTRA);
const ROL_LOTE_2 = 'Docente principal del lote 2';
const ROL_LOTE_4 = 'Docente principal del lote 4';

type Miembro = { persona_id: number; rol_en_la_oferta: string; dedicacion?: string; lotes: string[] };
type Datos = {
  equipo: Miembro[];
  herramientas: string[];
  ofertas: { lote: string; pendiente: boolean; importe: number | null; unitarios: unknown[] }[];
};
const DATOS_BASE = JSON.parse(
  (db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(CASO_E.id) as { datos: string }).datos,
) as Datos;

function decisiones(cambio: (d: Datos) => void = () => {}): void {
  const d = structuredClone(DATOS_BASE);
  d.ofertas = d.ofertas.map((o) => ({ ...o, pendiente: true, importe: null, unitarios: [] }));
  d.equipo = d.equipo.map((m) =>
    m.rol_en_la_oferta.startsWith(ROL_LOTE_2)
      ? { ...m, persona_id: ID_SALE, lotes: ['2'] }
      : { ...m, lotes: m.rol_en_la_oferta.startsWith(ROL_LOTE_4) ? ['4'] : [] },
  );
  cambio(d);
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(d), CASO_E.id);
}
const sustituir = () =>
  decisiones((d) => {
    d.equipo = d.equipo.map((m) => (m.persona_id === ID_SALE ? { ...m, persona_id: ID_ENTRA } : m));
  });

const HECHOS: HechoData[] = [
  {
    clave: 'docente_lote_2',
    categoria: 'rol',
    sobre: 'docente principal del lote 2',
    valor: ROL_LOTE_2,
    palabras: ['docente'],
  },
  {
    clave: 'plataforma',
    categoria: 'herramienta',
    sobre: 'plataforma de teleformación',
    valor: 'Aula Abierta 4.x',
    palabras: ['plataforma'],
  },
  {
    clave: 'horario_tutorias',
    categoria: 'horario',
    sobre: 'tutorías',
    valor: 'L-V 9:00-14:00 (Canarias)',
    palabras: ['tutorías'],
  },
];
const TEXTOS = [
  `${SALE}, docente principal del lote 2, impartirá las sesiones en directo desde Aula Abierta 4.x.`,
  'El docente principal del lote 2 revisará las tareas cada semana y las devolverá comentadas.',
  'Las tutorías serán de lunes a viernes de 9:00 a 14:00 (hora de Canarias).',
];

const ppt = CASO_E.pliegos.findIndex((p) => p.clase === 'ppt');
const idx = indice.abrirIndice(indexDir);
const PAGINAS = [
  'Pliego técnico de los servicios de formación.',
  'El docente principal del lote 2 impartirá las sesiones del curso y corregirá las tareas.',
];
indice.reemplazarArchivo(
  idx,
  {
    path: `Licitaciones/Radar/2026/${CASO_E.id}/${ppt}-${CASO_E.pliegos[ppt]!.nombre}`,
    kind: 'document',
    title: 'PPT',
    mtime_ms: 1,
    size: 1,
    pages: PAGINAS.length,
    status: 'ok',
    error: null,
    source: null,
  },
  trocearPaginas(PAGINAS, true),
);
idx.close();

type FilaApartadoTest = {
  apartado: number;
  estado: string;
  datos: string | null;
  agente: string | null;
  editado: number | null;
};
const apartados = (memoria: number) =>
  db
    .prepare(
      'SELECT apartado, estado, datos, agente, editado FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado',
    )
    .all(memoria) as FilaApartadoTest[];
const trabajosDe = (tipo: string, memoria: number) =>
  (nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ?').all(tipo) as { payload: string }[]).filter(
    (t) => (JSON.parse(t.payload) as { memoria_id: number }).memoria_id === memoria,
  );

let base = 0;
let version = 0;
// La memoria con fases del lote 2 montada: dossier guardado, hoja de hechos y los tres apartados recibidos (el 2, editado a mano).
async function memoriaMontada(): Promise<void> {
  db.exec(`DELETE FROM memoria_apartados WHERE memoria_id IN (SELECT id FROM memorias WHERE fase IS NOT NULL);
    DELETE FROM memoria_dossiers; DELETE FROM memoria_estrategias; DELETE FROM memoria_fichas_solucion; DELETE FROM memorias WHERE fase IS NOT NULL;`);
  nucleo().db.exec('DELETE FROM trabajos_ia');
  const r = pedirMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, CASO_E.id, { confirmado: true });
  assert.equal(r.error, null, r.error?.message);
  const m = r.data!.memorias.map((x) => filaMemoria(db, x.memoria)!).find((x) => x.lote === '2')!;
  // Las de los otros lotes ya se presentaron: no frenan la del lote 2.
  db.prepare("UPDATE memorias SET estado = 'ensamblada', fase = 'fin' WHERE fase IS NOT NULL AND id <> ?").run(m.id);
  const d = await componerDossier(db, nucleo().db, m.id);
  assert.equal(d.error, null, d.error?.message);
  assert.equal(guardarDossier(db, d.data!).error, null);
  const {
    id: _i,
    memoria_id: _m,
    version: _v,
    ...estrategia
  } = estrategiaCasoA({ memoria_id: m.id, version: m.version });
  db.prepare(
    "INSERT INTO memoria_estrategias (memoria_id, datos, avisos, agente, creada_en) VALUES (?, ?, '[]', 'licitaciones', '2026-10-14T10:00:00Z')",
  ).run(m.id, JSON.stringify({ ...estrategia, hechos: HECHOS }));
  db.prepare('DELETE FROM memoria_apartados WHERE memoria_id = ?').run(m.id);
  const insertar = db.prepare(
    "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, avisos, editado) VALUES (?, ?, 'recibido', ?, ?, '[]', ?)",
  );
  TEXTOS.forEach((t, i) =>
    insertar.run(
      m.id,
      i + 1,
      JSON.stringify({ titulo: `Apartado ${i + 1}`, bloques: [{ parrafos: [t] }], cubre: [], compromisos: [] }),
      t.length,
      i === 1 ? 1 : 0,
    ),
  );
  db.prepare("UPDATE memorias SET estado = 'ensamblada', fase = 'fin', ensamblada_en = ? WHERE id = ?").run(
    new Date().toISOString(),
    m.id,
  );
  base = m.id;
  version = m.version;
}

async function actualizar(apartadosPedidos?: number[]) {
  const r = await actualizarMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, {
    id: CASO_E.id,
    version,
    apartados: apartadosPedidos,
    confirmado: true,
  });
  return r;
}
async function actualizada() {
  const r = await actualizar();
  assert.equal(r.error, null, r.error?.message);
  return filaMemoria(db, r.data!.memoria)!;
}

beforeEach(async () => {
  decisiones();
  await memoriaMontada();
});

test('should_create_a_version_in_redaction_with_only_affected_apartados_pending', async () => {
  // Arrange
  sustituir();

  // Act
  const m = await actualizada();

  // Assert
  assert.equal(m.fase, 'redaccion');
  assert.equal(m.ronda, 0);
  assert.equal(m.estado, 'redactando');
  assert.equal(m.version_base, version);
  assert.deepEqual(JSON.parse(m.apartados_rehechos!), [1]);
  assert.deepEqual(
    apartados(m.id).map((a) => [a.apartado, a.estado]),
    [
      [1, 'pendiente'],
      [2, 'recibido'],
      [3, 'recibido'],
    ],
  );
  assert.match(m.indicaciones!, new RegExp(`${SALE} ya no está`));
  assert.match(m.indicaciones!, new RegExp(`${ROL_LOTE_2}[^:]*: ${ENTRA}`));
});

const aManoDeRedaccion = (memoria: number) =>
  (
    nucleo()
      .db.prepare('SELECT a_mano FROM trabajos_ia WHERE tipo = ? AND clave LIKE ?')
      .get(TIPO_MEMORIA_REDACCION, `%v${filaMemoria(db, memoria)!.version}-%`) as { a_mano: number }
  ).a_mano;

test('should_queue_the_redaction_by_hand_when_a_person_asks', async () => {
  // Arrange
  sustituir();

  // Act
  const m = await actualizada();

  // Assert
  assert.equal(aManoDeRedaccion(m.id), 1);
});

test('should_not_queue_the_redaction_by_hand_when_an_agent_asks', async () => {
  // Arrange
  sustituir();

  // Act
  const r = await actualizarMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, {
    id: CASO_E.id,
    version,
    confirmado: true,
    porAgente: true,
    motivo: 'Subir el apartado 1 al tramo máximo.',
  });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(aManoDeRedaccion(r.data!.memoria), 0);
});

test('should_refuse_an_agent_round_without_asking_to_confirm_when_the_deadline_is_too_tight', async () => {
  // Arrange: el agente no tiene cómo confirmar un plazo justo.
  sustituir();
  const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
  const antes = (
    db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(CASO_E.id) as { fecha_limite: string }
  ).fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(
    horaLocalEspana(Date.now() + 5 * 60_000),
    CASO_E.id,
  );

  try {
    // Act
    const pedido = { id: CASO_E.id, version, motivo: 'Subir el apartado 1 al tramo máximo.' };
    const agente = await actualizarMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, { ...pedido, porAgente: true });
    const persona = await actualizarMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, pedido);

    // Assert
    assert.equal(agente.error?.code, 'plazo_insuficiente', agente.error?.message);
    assert.equal(persona.error?.code, 'plazo_justo', 'una persona sí puede confirmarlo');
  } finally {
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(antes, CASO_E.id);
  }
});

test('should_copy_unaffected_apartados_verbatim', async () => {
  // Arrange
  sustituir();

  // Act
  const m = await actualizada();

  // Assert
  const antes = apartados(base);
  const despues = apartados(m.id);
  for (const n of [2, 3]) {
    assert.equal(despues[n - 1]!.datos, antes[n - 1]!.datos, `el apartado ${n} queda palabra por palabra`);
    assert.equal(despues[n - 1]!.agente, `copiado-v${version}`);
  }
  assert.equal(despues[1]!.editado, 1, 'lo editado a mano sigue marcado como editado');
});

test('should_drop_affected_facts_from_the_copied_strategy', async () => {
  // Arrange
  sustituir();

  // Act
  const m = await actualizada();

  // Assert
  const e = db.prepare('SELECT datos, avisos, agente FROM memoria_estrategias WHERE memoria_id = ?').get(m.id) as {
    datos: string;
    avisos: string;
    agente: string;
  };
  assert.deepEqual(
    (JSON.parse(e.datos) as { hechos: HechoData[] }).hechos.map((h) => h.clave),
    ['plataforma', 'horario_tutorias'],
  );
  assert.ok((JSON.parse(e.avisos) as string[]).includes(`${PREFIJO_HECHOS_REHECHOS} docente_lote_2.`));
  assert.equal(e.agente, `copiado-v${version}`);
});

test('should_not_queue_dossier_or_strategy_jobs', async () => {
  // Arrange
  sustituir();

  // Act
  const m = await actualizada();

  // Assert
  assert.equal(trabajosDe(TIPO_MEMORIA_ESTRATEGIA, m.id).length, 0);
  assert.equal(trabajosDe(TIPO_MEMORIA_REDACCION, m.id).length, 1, 'un único run de redacción de lo afectado');
  const dossier = dossierDe(db, m.id)!;
  assert.equal(dossier.version, m.version, 'el dossier de la nueva se compone por código');
  assert.ok(dossier.equipo_ids.includes(ID_ENTRA) && !dossier.equipo_ids.includes(ID_SALE));
  assert.equal(filaMemoria(db, m.id)!.fase, 'redaccion');
});

test('should_tell_the_writer_to_keep_edited_text_and_change_only_what_depends', async () => {
  // Arrange
  sustituir();
  const m = await actualizada();
  const payload = {
    id: CASO_E.id,
    memoria_id: m.id,
    guion_id: m.guion_id,
    version: m.version,
    ronda: 0,
    pedida_en: m.pedida_en,
  };

  // Act
  const texto = instruccionesRedaccion(db, nucleo().db, payload);

  // Assert
  assert.match(texto, new RegExp(`ACTUALIZACIÓN DE LA v${version} POR UN CAMBIO TARDÍO: Cambió el equipo`));
  assert.match(texto, /cambia solo lo que depende del cambio y conserva el resto palabra por palabra/);
  assert.ok(texto.includes(TEXTOS[0]!), 'lleva el texto actual del apartado afectado');
  assert.match(texto, /TE TOCA REDACTAR los apartados 1;/);
  assert.deepEqual(
    lineasActualizacion(db, { ...m, ronda: 1 }, 1),
    [],
    'en las rondas manda el crítico, no la actualización',
  );
});

test('should_refuse_when_nothing_depends_on_the_change', async () => {
  // Arrange: solo cambia el precio del lote 2.
  decisiones((d) => {
    d.ofertas = d.ofertas.map((o) => (o.lote === '2' ? { ...o, pendiente: false, importe: 1 } : o));
  });
  const versiones = (
    db.prepare('SELECT COUNT(*) AS n FROM memorias WHERE licitacion_id = ?').get(CASO_E.id) as { n: number }
  ).n;

  // Act
  const r = await actualizar();

  // Assert
  assert.equal(r.error?.code, 'invalid_input', r.error?.message);
  assert.equal(r.error?.message, NADA_QUE_ACTUALIZAR);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM memorias WHERE licitacion_id = ?').get(CASO_E.id) as { n: number }).n,
    versiones,
  );
});

test('should_keep_the_lote_of_the_base', async () => {
  // Arrange
  sustituir();

  // Act
  const m = await actualizada();
  const otra = await actualizar([2]);

  // Assert
  assert.equal(m.lote, '2');
  assert.equal(otra.error?.code, 'conflicto', 'la del lote 2 ya se está redactando');
});

test('should_update_from_the_actualizar_afectados_route_and_refuse_an_uploaded_base', async () => {
  // Arrange
  sustituir();
  const subida = (
    db.prepare('SELECT version FROM memorias WHERE licitacion_id = ? AND fase IS NULL LIMIT 1').get(CASO_E.id) as {
      version: number;
    }
  ).version;
  db.prepare("UPDATE memorias SET subida = 'memoria-editada.docx' WHERE licitacion_id = ? AND version = ?").run(
    CASO_E.id,
    subida,
  );
  const post = (v: number, body: unknown) =>
    fetch(
      `${baseUrl}/api/licitaciones/licitaciones/${CASO_E.id}/oferta/memoria/${v}/actualizar-afectados?confirmar=1`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );

  // Act
  const malo = await post(version, { apartados: [0] });
  const r = await post(version, {});
  const deSubida = await post(subida, {});

  // Assert
  assert.equal(malo.status, 400);
  assert.equal(r.status, 202, await r.clone().text());
  const cuerpo = (await r.json()) as { memoria: number; apartados: number[] };
  assert.equal(filaMemoria(db, cuerpo.memoria)!.fase, 'redaccion');
  assert.deepEqual(cuerpo.apartados, [1]);
  assert.equal(deSubida.status, 409, 'Hermes no rehace una versión subida a mano');
  assert.match(((await deSubida.json()) as { message: string }).message, /se subió a mano/);
  db.prepare('UPDATE memorias SET subida = NULL WHERE licitacion_id = ? AND version = ?').run(CASO_E.id, subida);
});

test('should_take_a_memoria_assembled_before_the_phases_as_base_and_go_through_dossier_and_strategy', async () => {
  // Arrange: la base se montó por el método anterior (sin fase ni estrategia) y no se subió a mano.
  db.prepare('UPDATE memorias SET fase = NULL WHERE id = ?').run(base);
  db.prepare('DELETE FROM memoria_estrategias WHERE memoria_id = ?').run(base);
  db.prepare('DELETE FROM memoria_dossiers WHERE memoria_id = ?').run(base);
  const INDICACIONES = 'Añade al apartado 1 el calendario de sesiones en directo del lote.';

  // Act
  const r = await actualizarMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, {
    id: CASO_E.id,
    version,
    apartados: [1],
    indicaciones: INDICACIONES,
    mejora: true,
    confirmado: true,
  });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  const m = filaMemoria(db, r.data!.memoria)!;
  assert.deepEqual([m.version_base, m.mejora, m.indicaciones], [version, 1, INDICACIONES]);
  assert.equal(m.fase, 'estrategia', 'el dossier ya se compuso y toca la estrategia');
  assert.equal(dossierDe(db, m.id)?.version, m.version, 'dossier nuevo, con el guion de la versión');
  assert.equal(trabajosDe(TIPO_MEMORIA_ESTRATEGIA, m.id).length, 1, 'la estrategia que le faltaba a la base');
  assert.equal(trabajosDe(TIPO_MEMORIA_REDACCION, m.id).length, 0, 'la redacción espera a la estrategia');
  assert.deepEqual(
    apartados(m.id).map((a) => [a.apartado, a.estado]),
    [
      [1, 'pendiente'],
      [2, 'recibido'],
      [3, 'recibido'],
    ],
    'solo se redacta lo pedido; el resto se copia de la base',
  );
  // Con fase otra vez, la siguiente prueba la limpia como a las demás.
  db.prepare("UPDATE memorias SET fase = 'fin' WHERE id = ?").run(base);
});

test('should_say_who_left_and_who_came_in_without_the_o4_change', () => {
  // Act
  const t = textoDelCambio(['equipo'], ['Persona A'], [{ nombre: 'Persona B', rol: ROL_LOTE_2 }]);
  const sinNada = textoDelCambio([], [], []);

  // Assert
  assert.equal(t, `Cambió el equipo: Persona A ya no está; ${ROL_LOTE_2}: Persona B.`);
  assert.equal(sinNada, 'Cambió lo decidido para la oferta.');
});

test('should_copy_the_solution_sheet_reviewed_by_a_person', async () => {
  // Arrange: en la base una persona aprobó la ficha (inicio el 01/12 y 8 h de soporte).
  sustituir();
  const campos = JSON.stringify([
    { clave: 'inicio', valor: '01/12/2026' },
    { clave: 'soporte', valor: '8 h' },
  ]);
  db.prepare(
    `INSERT INTO memoria_fichas_solucion (memoria_id, estado, campos, creada_en, vence_en, revisada_en, revisada_por, editados)
    VALUES (?, 'aprobada', ?, '2026-10-14T10:00:00Z', '2026-10-14T12:00:00Z', '2026-10-14T11:00:00Z', 'Persona A', '["soporte"]')`,
  ).run(base, campos);

  // Act
  const m = await actualizada();

  // Assert
  const ficha = db
    .prepare('SELECT estado, campos, editados, revisada_por FROM memoria_fichas_solucion WHERE memoria_id = ?')
    .get(m.id) as { estado: string; campos: string; editados: string; revisada_por: string } | undefined;
  assert.deepEqual(ficha, { estado: 'aprobada', campos, editados: '["soporte"]', revisada_por: 'Persona A' });
});

test('should_resign_the_dossier_when_nothing_depends_on_the_change', async () => {
  // Arrange: una prórroga cambia la identificación y ningún apartado cita el plazo.
  const plazo = (
    db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(CASO_E.id) as { fecha_limite: string }
  ).fecha_limite;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run('2026-12-22T14:00:00', CASO_E.id);
  const antes = desfaseMemoria(db, nucleo().db, base).data!;

  // Act
  const r = await actualizar();
  const despues = desfaseMemoria(db, nucleo().db, base).data!;
  db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(plazo, CASO_E.id);

  // Assert
  assert.deepEqual(antes.secciones, ['identificacion']);
  assert.equal(r.error?.message, NADA_QUE_ACTUALIZAR);
  assert.deepEqual(despues.secciones, [], 'el desfase no se queda para siempre');
});

test('should_not_name_people_in_update_instructions_when_team_goes_by_roles', async () => {
  // Arrange: CV anonimizados: el dossier de la base va por roles.
  db.prepare(
    "UPDATE memoria_dossiers SET secciones = json_set(secciones, '$.equipo_por_roles', json('true')) WHERE memoria_id = ?",
  ).run(base);
  sustituir();

  // Act
  const m = await actualizada();

  // Assert
  assert.ok(!m.indicaciones!.includes(SALE) && !m.indicaciones!.includes(ENTRA), m.indicaciones!);
  assert.match(m.indicaciones!, new RegExp(`cambia la persona del rol ${ROL_LOTE_2}`));
  assert.equal(
    textoDelCambioPorRoles(['equipo'], [], 1),
    'Cambió el equipo: sale una persona del equipo. El pliego pide el equipo por roles: no escribas el nombre de nadie, solo su rol.',
  );
});
