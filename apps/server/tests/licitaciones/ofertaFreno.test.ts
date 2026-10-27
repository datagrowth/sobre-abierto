// Freno de elegibilidad y memoria pedida sola, sobre las ofertas reales del
// 13/10/2027 (fixtures/comprobaciones/, seudonimizadas): CASO_E exige la declaración de conformidad ENS BÁSICA
// y el perfil no la tiene, así que la cadena no gasta cuota en su memoria ni en sus anexos hasta que
// una persona pulse «Vamos» con motivo; Villaejemplo tiene tutores sin nadie en el equipo. Con las
// decisiones sin problemas, la cadena pide sola la memoria por el camino de siempre (guardia de
// plazo de lo automático). Los precios de las decisiones son inventados.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelosAnexos } from '../nucleo/fixtures/modelosAnexos.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-freno-'));
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guionVigente, VERSION_PROMPT_GUION } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { diferenciasGuion } = await import('../../src/dominios/licitaciones/oferta/guionDiff.js');
const { rebasarTrasGuion } = await import('../../src/dominios/licitaciones/oferta/rebase.js');
const { decisionesVigentes } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { aplicarAccionBloqueo } = await import('../../src/dominios/licitaciones/oferta/comprobacionesBloqueos.js');
const { frenoDeElegibilidad } = await import('../../src/dominios/licitaciones/oferta/frenoElegibilidad.js');
const { memoriaAutoQueToca, pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { TIPO_MEMORIA_ESTRATEGIA } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { TIPO_MEMORIA_REDACCION } = await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { actualizarMemoria } = await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { ofertasFrenadas, vueltaCadena } = await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

type Fixture = ReturnType<typeof leerFixtureComprobaciones>;

iniciarNucleo();
const db = dbLicitaciones();
const CASO_E = leerFixtureComprobaciones('casoE');
const CASO_C = leerFixtureComprobaciones('casoC');
// La hora de la captura: quedan 11 h 25 min para el plazo de CASO_E (14/10 08:00 peninsular, 06:00 UTC).
const AHORA = Date.parse(CASO_E.ahora);
const ENS = 'excluyente_vs_perfil:-:ens';
const ENS_BASICA = { nombre: 'ENS', nivel: 'basica', caduca: null };
const listo = () => 'listo' as const;
const MODELO_WORD = 'ANEXO VI.docx';
const BYTES_MODELO = await modelosAnexos();

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Cada caso parte de una base vacía: los fixtures fijan sus ids (fichas, guiones, memorias).
function vaciar(): void {
  db.pragma('foreign_keys = OFF');
  const tablas = db
    .prepare(
      "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB 'busca_texto_*'",
    )
    .all() as { name: string }[];
  for (const { name } of tablas) db.prepare(`DELETE FROM main."${name}"`).run();
  db.pragma('foreign_keys = ON');
  for (const t of ['trabajos_ia', 'personas']) nucleo().db.prepare(`DELETE FROM ${t}`).run();
}

beforeEach(vaciar);

type Opciones = { certificados?: unknown[]; conPrecio?: boolean; sinMemoria?: boolean };

// CASO_E con los precios de los lotes 2 y 4 decididos (la captura no trae importes) y el Anexo VI
// también en Word entre los pliegos: el único modelo que la cadena rellena sola.
function conPrecios(f: Fixture): Fixture {
  const ofertas = ['2', '4'].map((lote) => ({
    lote,
    pendiente: false,
    importe: null,
    unitarios: [{ concepto: 'alumno', precio: 30 }],
  }));
  return { ...f, decisiones: f.decisiones && { ...f.decisiones, datos: { ...f.decisiones.datos, ofertas } } };
}

function sinMemoria(f: Fixture): Fixture {
  return { ...f, guiones: f.guiones.map((g) => ({ ...g, datos: { ...g.datos, memoria: null } })) };
}

function anexoEnWord(f: Fixture): void {
  const ruta = `Licitaciones/Radar/2026/${f.id}/${MODELO_WORD}`;
  fs.mkdirSync(path.dirname(path.join(conocimiento, ruta)), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, ruta), BYTES_MODELO);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/anexo-vi', 'anexo', ?, 'descargado', ?, ?)",
  ).run(f.id, MODELO_WORD, ruta, new Date(AHORA - 86_400_000).toISOString());
}

function sembrarCasoE(op: Opciones = {}): Fixture {
  let f: Fixture = { ...CASO_E, perfil: { ...CASO_E.perfil, certificados: op.certificados ?? [] } };
  if (op.conPrecio !== false) f = conPrecios(f);
  if (op.sinMemoria) f = sinMemoria(f);
  sembrarFixture(db, nucleo().db, f);
  anexoEnWord(f);
  return f;
}

const trabajos = (tipo: string, id: string) =>
  nucleo()
    .db.prepare(
      "SELECT clave, a_mano FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.id') = ? ORDER BY id",
    )
    .all(tipo, id) as { clave: string; a_mano: number }[];
// CASO_E pide una memoria por lote (lotes 2 y 4): cada pedido crea las dos.
const memoriasDelGuion = (id: string, guion: number) =>
  db
    .prepare('SELECT id, estado, fase, lote FROM memorias WHERE licitacion_id = ? AND guion_id = ? ORDER BY id')
    .all(id, guion) as { id: number; estado: string; fase: string | null; lote: string | null }[];
const guionVigenteId = (f: Fixture): number => Math.max(...f.guiones.map((g) => g.id));

// Otro guion, como el de una rectificación: la Declaración ENS cambia de texto y las decisiones se guardan sobre él.
function guionNuevoConOtroEns(f: Fixture): number {
  const g = f.guiones[0]!;
  const datos = JSON.parse(
    JSON.stringify(g.datos).replace('categoría BÁSICA', 'categoría BÁSICA, vigente a la firma del contrato'),
  ) as Record<string, unknown>;
  const nuevo = guionVigenteId(f) + 1;
  db.prepare(
    "INSERT INTO guiones (id, licitacion_id, version, ficha_id, datos, agente, version_prompt, creado_en) VALUES (?, ?, ?, ?, ?, 'licitaciones', ?, ?)",
  ).run(
    nuevo,
    f.id,
    g.version + 1,
    g.ficha_id,
    JSON.stringify(datos),
    VERSION_PROMPT_GUION,
    new Date(AHORA - 60_000).toISOString(),
  );
  db.prepare('UPDATE decisiones_oferta SET guion_id = ? WHERE licitacion_id = ?').run(nuevo, f.id);
  return nuevo;
}

type DatosGuion = NonNullable<ReturnType<typeof guionVigente>>['datos'];

// Una reextracción como la que guarda proponerGuion: el guion nuevo con sus cambios frente al
// vigente y el rebase de lo que esos cambios no tocan.
function guionReextraido(f: Fixture, cambiar: (d: DatosGuion) => void = () => undefined): number {
  const vigente = guionVigente(db, f.id)!;
  const datos = structuredClone(vigente.datos);
  cambiar(datos);
  const cambios = diferenciasGuion(vigente.datos, datos);
  const nuevo = vigente.id + 1;
  db.prepare(
    "INSERT INTO guiones (id, licitacion_id, version, ficha_id, datos, agente, version_prompt, creado_en, cambios) VALUES (?, ?, ?, ?, ?, 'licitaciones', ?, ?, ?)",
  ).run(
    nuevo,
    f.id,
    vigente.version + 1,
    vigente.ficha_id,
    JSON.stringify(datos),
    VERSION_PROMPT_GUION,
    new Date(AHORA - 60_000).toISOString(),
    JSON.stringify(cambios),
  );
  rebasarTrasGuion(db, f.id, vigente.id, nuevo, cambios);
  return nuevo;
}

// Una versión más de la memoria (la captura de CASO_E ya trae la primera, de un guion antiguo que no está).
// Una por lote, como las pide CASO_E (una memoria por lote): la común no cubre a ninguno.
function memoriaDe(f: Fixture, guion: number, estado: 'redactando' | 'ensamblada' | 'ensamblando'): number[] {
  return ['2', '4'].map((lote) => {
    const version =
      ((db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(f.id) as { v: number | null })
        .v ?? 0) + 1;
    return Number(
      db
        .prepare(
          'INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, lote) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          f.id,
          guion,
          version,
          estado,
          new Date(AHORA - 3_600_000).toISOString(),
          estado === 'ensamblada' ? new Date(AHORA - 60_000).toISOString() : null,
          lote,
        ).lastInsertRowid,
    );
  });
}

// La base de licitaciones con una consulta que lanza (como un SQLITE_BUSY) en cuanto lleva ese id,
// fuera de la lectura de las entradas (que ya devuelve el error como valor): al calcular las comprobaciones.
function conLecturaRota(id: string): typeof db {
  const lanza =
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) => {
      if (a.includes(id) && !db.inTransaction) throw new Error('SQLITE_BUSY: database is locked');
      return fn(...a);
    };
  return new Proxy(db, {
    get(base, k) {
      if (k !== 'prepare') {
        const v = Reflect.get(base, k, base) as unknown;
        return typeof v === 'function' ? v.bind(base) : v;
      }
      return (sql: string) => {
        const st = base.prepare(sql);
        return new Proxy(st, {
          get(s, m) {
            const v = Reflect.get(s, m, s) as unknown;
            return typeof v === 'function'
              ? ['get', 'all', 'run', 'iterate'].includes(String(m))
                ? lanza(v.bind(s))
                : v.bind(s)
              : v;
          },
        });
      };
    },
  });
}

test('should_brake_only_the_offer_whose_comprobaciones_throws_and_go_on_with_the_others', () => {
  // Arrange: CASO_E sin problemas de elegibilidad y otra oferta cuyas comprobaciones lanzan al leerlas.
  sembrarFixture(db, nucleo().db, CASO_C);
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });

  // Act
  const frenadas = ofertasFrenadas(nucleo().db, conLecturaRota(CASO_C.id), [CASO_C.id, f.id], AHORA);

  // Assert
  assert.deepEqual([...frenadas], [CASO_C.id], 'la rota queda frenada y CASO_E se calcula igual');
});

test('should_not_ask_memory_or_annexes_for_casoE_while_the_ens_requirement_is_open', () => {
  const f = sembrarCasoE();
  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), true, 'sin el freno, a CASO_E le tocaría la memoria');

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.deepEqual(frenoDeElegibilidad(db, nucleo().db, f.id, AHORA), {
    frenada: true,
    bloqueos: [{ clave: ENS, titulo: 'Exigen ENS BÁSICA y el perfil no lo tiene' }],
  });
  assert.deepEqual([v.memorias, v.anexos, v.frenadas], [0, 0, 1]);
  assert.deepEqual(memoriasDelGuion(f.id, guionVigenteId(f)), []);
  assert.deepEqual(
    [trabajos(TIPO_MEMORIA_ESTRATEGIA, f.id), trabajos(TIPO_ANEXO, f.id)],
    [[], []],
    'ni un run de CASO_E en la cola',
  );
});

test('should_ask_them_after_a_person_says_vamos_with_a_reason', () => {
  const f = sembrarCasoE();
  assert.equal(
    aplicarAccionBloqueo(db, f.id, ENS, { accion: 'vamos' }).error?.code,
    'invalid_input',
    'sin motivo no vale',
  );
  assert.equal(
    aplicarAccionBloqueo(db, f.id, ENS, {
      accion: 'vamos',
      motivo: 'La declaración ENS llega del proveedor antes de la firma.',
    }).error,
    null,
  );

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(frenoDeElegibilidad(db, nucleo().db, f.id, AHORA).frenada, false);
  assert.deepEqual([v.memorias, v.frenadas], [1, 0]);
  assert.deepEqual(
    memoriasDelGuion(f.id, guionVigenteId(f)).map((m) => m.lote),
    ['2', '4'],
  );
  assert.ok(v.anexos >= 1, 'el Anexo VI en Word se pide solo');
  assert.ok(trabajos(TIPO_ANEXO, f.id).length >= 1);
});

test('should_brake_again_when_the_guion_changes_the_fingerprint', () => {
  const f = sembrarCasoE();
  aplicarAccionBloqueo(db, f.id, ENS, {
    accion: 'vamos',
    motivo: 'La declaración ENS llega del proveedor antes de la firma.',
  });
  const nuevo = guionNuevoConOtroEns(f);
  assert.equal(
    memoriaAutoQueToca(db, nucleo().db, f.id),
    true,
    'con las decisiones sobre el guion nuevo tocaría la memoria',
  );

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.deepEqual(
    frenoDeElegibilidad(db, nucleo().db, f.id, AHORA).bloqueos.map((b) => b.clave),
    [ENS],
    'el «Vamos» era para el texto anterior',
  );
  assert.deepEqual([v.memorias, v.anexos, v.frenadas], [0, 0, 1]);
  assert.deepEqual(memoriasDelGuion(f.id, nuevo), []);
});

test('should_ask_the_memory_alone_when_decisions_have_no_problems', async () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);
  const otra = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.deepEqual([v.memorias, v.frenadas], [1, 0]);
  assert.deepEqual(
    memoriasDelGuion(f.id, guionVigenteId(f)).map((m) => [m.estado, m.fase, m.lote]),
    [
      ['redactando', 'dossier', '2'],
      ['redactando', 'dossier', '4'],
    ],
  );
  assert.deepEqual(trabajos(TIPO_MEMORIA_ESTRATEGIA, f.id), [], 'nacen en el dossier: aún no se encola ningún run');
  assert.equal(otra.memorias, 0, 'la siguiente vuelta no la pide otra vez');
  // Las fases siguientes, sin componer el dossier de verdad: ninguna levanta el freno de su tipo.
  const ids = memoriasDelGuion(f.id, guionVigenteId(f)).map((m) => m.id);
  for (const fase of ['estrategia', 'redaccion'])
    for (const id of ids) {
      db.prepare('UPDATE memorias SET fase = ? WHERE id = ?').run(fase, id);
      await avanzarMemoria(nucleo().db, db, id);
    }
  assert.deepEqual(
    [...trabajos(TIPO_MEMORIA_ESTRATEGIA, f.id), ...trabajos(TIPO_MEMORIA_REDACCION, f.id)].map((t) => t.a_mano),
    [0, 0, 0, 0],
    'automática: no levanta el freno de su tipo en ninguna fase',
  );
});

test('should_not_ask_the_memory_alone_when_a_decision_has_problems', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA], conPrecio: false });

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), false, 'falta el precio por alumno de los lotes 2 y 4');
  assert.equal(v.memorias, 0);
});

test('should_not_ask_the_automatic_memorias_when_the_two_lotes_do_not_fit_before_the_deadline', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  // 7 h antes del plazo: las dos memorias (2 × 3 h más 2 h de margen) no caben.
  const ahora = Date.parse('2027-10-13T23:00:00Z');

  const v = vueltaCadena(nucleo().db, db, ahora, listo);

  assert.equal(v.memorias, 0);
  assert.deepEqual(memoriasDelGuion(f.id, guionVigenteId(f)), []);
});

test('should_not_pass_a_tight_deadline_for_the_automatic_memory', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  // 3 h 30 min antes del plazo: no cabe ni una. Una persona recibiría el aviso «plazo_justo» y podría confirmarlo; la cadena, no.
  const ahora = Date.parse('2027-10-14T02:30:00Z');

  const sola = pedirMemoria(nucleo().db, db, nucleo().config.salidasDir, f.id, {
    automatica: true,
    confirmado: true,
    ahoraMs: ahora,
  });
  const aMano = pedirMemoria(nucleo().db, db, nucleo().config.salidasDir, f.id, { ahoraMs: ahora });
  const v = vueltaCadena(nucleo().db, db, ahora, listo);

  assert.equal(sola.error?.code, 'plazo_insuficiente');
  assert.equal(aMano.error?.code, 'plazo_justo');
  assert.equal(v.memorias, 0);
  assert.deepEqual(memoriasDelGuion(f.id, guionVigenteId(f)), []);
});

test('should_not_ask_a_memory_for_an_offer_whose_guion_has_no_memoria', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA], sinMemoria: true });

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), false);
  assert.equal(v.memorias, 0);
  assert.deepEqual(trabajos(TIPO_MEMORIA_ESTRATEGIA, f.id), []);
});

test('should_not_ask_twice_for_the_same_guion_after_a_failed_memory', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  vueltaCadena(nucleo().db, db, AHORA, listo);
  db.prepare(
    "UPDATE memorias SET estado = 'fallida', error = 'El run terminó sin dejar el resultado esperado.' WHERE licitacion_id = ? AND guion_id = ?",
  ).run(f.id, guionVigenteId(f));
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'fallido' WHERE tipo = ?").run(TIPO_MEMORIA_ESTRATEGIA);

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), false);
  assert.equal(v.memorias, 0);
  assert.deepEqual(
    memoriasDelGuion(f.id, guionVigenteId(f)).map((m) => m.estado),
    ['fallida', 'fallida'],
    'la rehace una persona',
  );
});

test('should_brake_casoC_while_no_one_in_the_team_covers_the_gardening_and_surveying_tutors', () => {
  const f: Fixture = { ...CASO_C, perfil: { ...CASO_C.perfil, certificados: [] } };
  sembrarFixture(db, nucleo().db, f);

  const v = vueltaCadena(nucleo().db, db, Date.parse(f.ahora), listo);

  const claves = frenoDeElegibilidad(db, nucleo().db, f.id, Date.parse(f.ahora)).bloqueos.map((b) => b.clave);
  assert.ok(
    claves.includes('medios:3:topografia') && claves.includes('medios:3:jardineria_arbolado'),
    claves.join(', '),
  );
  assert.equal(v.frenadas, 1);
  assert.deepEqual(trabajos(TIPO_ANEXO, f.id), []);
});

test('should_ask_them_after_a_person_accepts_the_risk_of_an_unchecked_row', () => {
  const f = sembrarCasoE({ certificados: [{ nombre: 'ENS', nivel: null, caduca: null }] });
  const freno = frenoDeElegibilidad(db, nucleo().db, f.id, AHORA);
  assert.deepEqual(
    freno.bloqueos.map((b) => b.clave),
    [ENS],
    'precondición: el ENS sin categoría frena',
  );

  assert.equal(
    aplicarAccionBloqueo(db, f.id, ENS, {
      accion: 'aceptar_riesgo',
      motivo: 'El proveedor confirma la categoría BÁSICA por escrito.',
    }).error,
    null,
  );
  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(frenoDeElegibilidad(db, nucleo().db, f.id, AHORA).frenada, false);
  assert.deepEqual([v.memorias, v.frenadas], [1, 0]);
});

test('should_not_ask_a_new_memory_when_the_old_one_was_assembled_after_an_identical_guion', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  const ms = memoriaDe(f, guionVigenteId(f), 'redactando');
  const nuevo = guionReextraido(f);
  for (const m of ms)
    db.prepare("UPDATE memorias SET estado = 'ensamblada', ensamblada_en = ? WHERE id = ?").run(
      new Date(AHORA).toISOString(),
      m,
    );

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(v.memorias, 0);
  assert.deepEqual(
    memoriasDelGuion(f.id, nuevo).map((x) => x.id),
    ms,
    'las memorias pasan al guion idéntico',
  );
  assert.deepEqual(trabajos(TIPO_MEMORIA_ESTRATEGIA, f.id), [], '0 runs');
});

test('should_not_ask_a_new_memory_when_the_guion_only_changed_the_points_of_a_section', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  const anterior = guionVigenteId(f);
  memoriaDe(f, anterior, 'ensamblada');
  guionReextraido(f, (d) => {
    d.memoria!.apartados[2]!.puntos += 1;
  });
  const d = decisionesVigentes(db, nucleo().db, f.id);
  assert.deepEqual([d.guion_cambiado, d.problemas], [false, []], 'precondición: las decisiones pasaron al guion nuevo');

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), false, 'una versión nueva rehace solo el apartado 3');
  assert.equal(v.memorias, 0);
  assert.equal(memoriasDelGuion(f.id, anterior).length, 2);
  assert.deepEqual(trabajos(TIPO_MEMORIA_ESTRATEGIA, f.id), []);
});

test('should_update_a_memoria_of_a_compatible_older_guion_redoing_the_sections_that_changed', async () => {
  // Arrange: la cadena la da por cubierta (caso anterior), así que actualizarla tiene que poder hacerse.
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  const anterior = guionVigenteId(f);
  const [lote2] = memoriaDe(f, anterior, 'ensamblada');
  const total = guionVigente(db, f.id)!.datos.memoria!.apartados.length;
  for (let n = 1; n <= total; n += 1)
    db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, ?, 'recibido', ?)").run(
      lote2,
      n,
      JSON.stringify({ titulo: `Apartado ${n}`, bloques: [{ parrafos: [`Texto ${n}.`] }], cubre: [], compromisos: [] }),
    );
  const nuevo = guionReextraido(f, (d) => {
    d.memoria!.apartados[2]!.puntos += 1;
  });
  const version = (db.prepare('SELECT version FROM memorias WHERE id = ?').get(lote2) as { version: number }).version;

  // Act
  const r = await actualizarMemoria(nucleo().db, db, nucleo().config.salidasDir, {
    id: f.id,
    version,
    confirmado: true,
  });

  // Assert
  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), false);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.apartados, [3], 'el apartado que cambió de puntos');
  const v = db
    .prepare('SELECT guion_id, version_base, indicaciones FROM memorias WHERE id = ?')
    .get(r.data!.memoria) as {
    guion_id: number;
    version_base: number;
    indicaciones: string;
  };
  assert.deepEqual([v.guion_id, v.version_base], [nuevo, version], 'la versión nueva es del guion vigente');
  assert.match(v.indicaciones, /El guion vigente cambió los puntos, el contenido o la escala del apartado 3/);
});

test('should_not_ask_a_new_memory_while_one_of_an_older_guion_is_being_assembled', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  memoriaDe(f, guionVigenteId(f), 'ensamblando');
  guionReextraido(f);

  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  assert.equal(memoriaAutoQueToca(db, nucleo().db, f.id), false);
  assert.equal(v.memorias, 0);
});

test('should_still_ask_the_annexes_when_creating_the_memory_throws', () => {
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  db.exec(
    "CREATE TRIGGER memorias_bloqueadas BEFORE INSERT ON memorias BEGIN SELECT RAISE(ABORT, 'base de datos bloqueada'); END",
  );
  try {
    const v = vueltaCadena(nucleo().db, db, AHORA, listo);

    assert.equal(v.memorias, 0);
    assert.ok(v.anexos >= 1, 'el fallo de la memoria no corta la vuelta');
    assert.ok(trabajos(TIPO_ANEXO, f.id).length >= 1);
  } finally {
    db.exec('DROP TRIGGER memorias_bloqueadas');
  }
});

test('should_tell_the_web_through_get_offer_hermes_that_the_chain_is_braked_and_why', async () => {
  // Arrange
  const f = sembrarCasoE();
  const http = await import('node:http');
  const express = (await import('express')).default;
  const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  const server = escucharLocal(http.createServer(app));
  const { port } = server.address() as import('node:net').AddressInfo;

  // Act
  const r = await fetch(`http://127.0.0.1:${port}/api/licitaciones/licitaciones/${f.id}/oferta/hermes`);
  const cuerpo = (await r.json()) as {
    freno_elegibilidad: { frenada: boolean; bloqueos: { clave: string; titulo: string }[] };
  };
  server.close();

  // Assert: las comprobaciones pueden decir que Hermes espera tu «Vamos» en la fila del ENS.
  assert.equal(r.status, 200);
  assert.equal(cuerpo.freno_elegibilidad.frenada, true);
  assert.ok(cuerpo.freno_elegibilidad.bloqueos.some((b) => b.clave === ENS && b.titulo.includes('ENS')));
});

test('should_ask_the_lote_memorias_although_a_common_memoria_covers_the_guion', () => {
  // Arrange: CASO_E tal como está en la captura: una memoria común ya redactada con el guion vigente.
  const f = sembrarCasoE({ certificados: [ENS_BASICA] });
  const version =
    ((db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(f.id) as { v: number | null })
      .v ?? 0) + 1;
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en) VALUES (?, ?, ?, 'ensamblada', ?, ?)",
  ).run(
    f.id,
    guionVigenteId(f),
    version,
    new Date(AHORA - 3_600_000).toISOString(),
    new Date(AHORA - 60_000).toISOString(),
  );

  // Act
  const v = vueltaCadena(nucleo().db, db, AHORA, listo);

  // Assert
  assert.equal(v.memorias, 1);
  assert.deepEqual(
    memoriasDelGuion(f.id, guionVigenteId(f)).map((m) => m.lote),
    [null, '2', '4'],
  );
});
