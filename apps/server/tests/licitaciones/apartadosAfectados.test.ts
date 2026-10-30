// «Actualizar los apartados afectados»: un cambio de persona o de lotes rehace solo los apartados
// que la nombran o lo nombran, sobre el texto que dejó la persona y con las indicaciones del cambio;
// «Mantener el anterior» vuelve a la base sin runs. Con la memoria de CASO_E sintética en
// los fixtures (fixtures/cambios) y, en la base, con el caso A.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  api,
  arrancar,
  cerrar,
  db,
  ID,
  nucleo,
  PERSONAS,
  salidas,
  sinMemorias,
  trabajosDe,
} from '../helpers/memoriaEntorno.js';
import { apartadoCasoA, decisionesCasoA, type Numeros } from './fixtures/casoA.js';

const { CambioImpacto, dependenciasDeApartado } =
  await import('../../src/dominios/licitaciones/oferta/dependencias.js');
const { apartadosAfectadosDe, apartadosARehacer, diffApartado, indicacionesDeCambio, mantenerAnterior } =
  await import('../../src/dominios/licitaciones/oferta/apartadosAfectados.js');
const { baseDependencias, dependenciasDeTexto } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { actualizarMemoria, NADA_QUE_ACTUALIZAR } =
  await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { instruccionesRedaccion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { ensamblarMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { subirMemoria } = await import('../../src/dominios/licitaciones/oferta/subida.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');

before(arrancar);
after(cerrar);

type J = Record<string, any>;
const fixture = (ruta: string): J => JSON.parse(readFileSync(new URL(`./fixtures/${ruta}`, import.meta.url), 'utf8'));
const CASO_E_MEMORIA = fixture('cambios/casoE-memoria.json');
const CASO_E_COMPROBACIONES = fixture('comprobaciones/casoE.json');
const AMBITO_CASO_E = ['2', '4', '6'];
// Como en dependenciasApartado.test.ts: el alias de una letra se alarga para reconocerlo como nombre.
const LARGO: Record<string, string> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
};
const alias = (t: string) => t.replace(/\bPersona ([A-K])\b/g, (_, l: string) => `Persona ${LARGO[l]}`);
const NOMBRES_CASO_E = new Map<number, string>(
  CASO_E_COMPROBACIONES.personas.map((p: J) => [p.persona_id, alias(p.nombre)]),
);
const EQUIPO_CASO_E = CASO_E_COMPROBACIONES.decisiones.datos.equipo.map((m: J) => ({
  persona_id: m.persona_id as number,
  rol: m.rol_en_la_oferta as string,
  lotes: m.lotes as string[],
}));

function estadoCasoE() {
  const equipo = EQUIPO_CASO_E.map((m: J) => ({
    persona_id: m.persona_id,
    nombre: NOMBRES_CASO_E.get(m.persona_id) ?? '',
    rol: m.rol,
  }));
  const ctx = (n: number) => ({
    n,
    guionApartado: `casoE-${n}`,
    lotesAmbito: AMBITO_CASO_E,
    equipo,
    herramientas: CASO_E_COMPROBACIONES.decisiones.datos.herramientas as string[],
    automaticosVigilados: [],
  });
  return {
    lotes: AMBITO_CASO_E,
    documentos: [],
    paquete: null,
    memoria_ensamblada: true,
    equipo: [...NOMBRES_CASO_E].map(([persona_id, nombre]) => ({ persona_id, nombre, lotes: [] })),
    apartados: CASO_E_MEMORIA.memorias[0].apartados.map((a: J) => {
      const texto = alias(a.texto);
      return {
        memoria_version: 1,
        n: a.apartado,
        titulo: a.titulo,
        texto,
        dependencias: dependenciasDeApartado(texto, ctx(a.apartado)),
      };
    }),
  };
}

const runs = (as: { coste: { runs: number } }[]) => as.reduce((s, a) => s + a.coste.runs, 0);

test('should_redo_only_sections_naming_the_removed_lot_in_casoE', () => {
  const estado = estadoCasoE();

  const r = apartadosARehacer(estado, CambioImpacto.parse({ lotes: ['2', '4'] }));

  // El 3 habla del docente «de cada lote»: no depende de que vaya el 6.
  assert.deepEqual(
    r.map((a) => a.clave),
    ['v1-1', 'v1-2'],
  );
  assert.ok(
    r.every((a) => a.accion === 'rehacer' && a.coste.min === 30 && a.coste.runs === 1 && a.pierde.length === 0),
  );
  assert.ok(runs(r) <= 2);
  const antes = { lotes: AMBITO_CASO_E, equipo: EQUIPO_CASO_E };
  assert.equal(
    indicacionesDeCambio(CambioImpacto.parse({ lotes: ['2', '4'] }), antes, { ...antes, lotes: ['2', '4'] }, []),
    'El lote 6 ya no va.',
  );
});

test('should_name_who_replaces_whom_in_the_role_when_a_person_leaves', () => {
  const antes = { lotes: AMBITO_CASO_E, equipo: EQUIPO_CASO_E };
  const despues = {
    lotes: AMBITO_CASO_E,
    equipo: EQUIPO_CASO_E.map((m: J) => (m.persona_id === 1002 ? { ...m, persona_id: 1006 } : m)),
  };
  const personas = [...NOMBRES_CASO_E]
    .map(([persona_id, nombre]) => ({ persona_id, nombre }))
    .concat({ persona_id: 1006, nombre: 'Persona Bravo' });
  const cambio = CambioImpacto.parse({ decisiones: { equipo: [{ persona_id: 1002, sale: true }] } });

  const texto = indicacionesDeCambio(cambio, antes, despues, personas);
  const r = apartadosARehacer(estadoCasoE(), cambio);

  assert.equal(
    texto,
    'Persona Bravo sustituye a Persona Hotel como Docente principal del lote 2 (hojas de cálculo con asistente de IA) y tutora suplente.',
  );
  assert.ok(r.some((a) => a.clave === 'v1-3'));
  assert.ok(runs(r) <= 3);
});

test('should_say_only_roles_when_the_tender_asks_for_the_team_by_roles', () => {
  // Arrange: el mismo cambio, con un pliego de CV anonimizados (equipoAnonimo).
  const antes = { lotes: AMBITO_CASO_E, equipo: EQUIPO_CASO_E };
  const despues = {
    lotes: AMBITO_CASO_E,
    equipo: EQUIPO_CASO_E.map((m: J) => (m.persona_id === 1002 ? { ...m, persona_id: 1006 } : m)),
  };
  const cambio = CambioImpacto.parse({
    decisiones: {
      equipo: [
        { persona_id: 1002, sale: true },
        { persona_id: 1006, sale: false },
      ],
    },
  });

  // Act
  const texto = indicacionesDeCambio(cambio, antes, despues, null);

  // Assert
  assert.equal(
    texto,
    'Cambia la persona del rol Docente principal del lote 2 (hojas de cálculo con asistente de IA) y tutora suplente; entra en el equipo una persona como Docente principal del lote 2 (hojas de cálculo con asistente de IA) y tutora suplente. El pliego pide el equipo por roles: no escribas el nombre de nadie, solo su rol.',
  );
  for (const nombre of NOMBRES_CASO_E.values()) assert.ok(!texto.includes(nombre), nombre);
});

// ── En la base (caso A: Ana García Pérez, responsable; Luis Martín Díaz, consultora) ──

type FilaTest = { apartado: number; estado: string; datos: string | null; editado: number; trabajo_id: number | null };
const filas = (memoriaId: number) =>
  db
    .prepare(
      'SELECT apartado, estado, datos, editado, trabajo_id FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado',
    )
    .all(memoriaId) as FilaTest[];
const memoria = (version: number) =>
  db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as J | undefined;
const raices = () => ({ salidas, conocimiento: null });
const SALE_ANA = () => ({ decisiones: { equipo: [{ persona_id: PERSONAS[0], sale: true }] } });
const FRASE_ANA = 'Ana García Pérez coordinará el servicio y será la persona de referencia de la SIIE.';

function limpiar(): void {
  sinMemorias();
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;');
  if (guardarDecisiones(db, nucleo().db, ID, decisionesCasoA(PERSONAS)).error) throw new Error('decisiones');
}

function conFrase(n: number, nums: Numeros, frase: string) {
  const a = apartadoCasoA(n, nums);
  a.bloques[0]!.parrafos = [...a.bloques[0]!.parrafos, frase];
  return a;
}

// Una memoria con fases ya ensamblada, con sus cuatro apartados y sus dependencias guardadas, como
// al recibirlos (sin ellas, '{}', como las versiones de antes de la columna).
async function ensamblada(frases: Record<number, string>, conDependencias = true): Promise<number> {
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, 1, 'redactando', ?, 'fin', 0)",
      )
      .run(ID, g.id, new Date().toISOString()).lastInsertRowid,
  );
  for (const n of [1, 2, 3, 4]) {
    const nums = { memoria_id: m, guion_id: g.id, version: 1 };
    const {
      id: _i,
      memoria_id: _m,
      guion_id: _g,
      version: _v,
      apartado: _a,
      ...datos
    } = (frases[n] ? conFrase(n, nums, frases[n]!) : apartadoCasoA(n, nums)) as J;
    db.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, recibido_en) VALUES (?, ?, 'recibido', ?, ?)",
    ).run(m, n, JSON.stringify(datos), new Date().toISOString());
    if (conDependencias) guardarDependencias(m, n, datos);
  }
  const e = await ensamblarMemoria(db, m, raices());
  assert.equal(e.error, null, e.error?.message);
  return m;
}

function guardarDependencias(m: number, n: number, datos: J): void {
  const g = guionVigente(db, ID)!;
  const dep = dependenciasDeTexto(baseDependencias(db, g), g, n, datos as never);
  db.prepare('UPDATE memoria_apartados SET dependencias = ? WHERE memoria_id = ? AND apartado = ?').run(
    JSON.stringify(dep),
    m,
    n,
  );
}

// Lo que hace la web: pide la vista previa del cambio y actualiza con los apartados que enseña.
async function actualizarPorSaleAna(version = 1) {
  const previa = apartadosAfectadosDe(nucleo().db, db, { id: ID, version, cambio: SALE_ANA() });
  assert.equal(previa.error, null, previa.error?.message);
  return actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version,
    apartados: previa.data!.apartados,
    cambios: [SALE_ANA()],
    confirmado: true,
  });
}

async function subida(textos: string[]) {
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '12 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({
      numero: String(i + 1),
      titulo: t,
      bloques: [
        {
          parrafos: [
            textos[i] ??
              'La empresa atenderá las consultas en 48 horas con un indicador mensual revisado con la entidad.',
          ],
        },
      ],
    })),
    pie: { texto: '', numeracion: true },
  });
  const r = await subirMemoria(db, ID, { nombre: 'memoria-editada.docx', datos: docx, campos: {} });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('should_redo_only_sections_naming_the_replaced_person', async () => {
  limpiar();
  await ensamblada({ 2: FRASE_ANA });
  await esperar(5);
  // Luis pasa a ser el responsable del servicio: Ana sale.
  assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA([PERSONAS[1]!])).error, null);

  const r = await actualizarPorSaleAna();

  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.apartados, [2]);
  const segunda = memoria(2)!;
  assert.equal(segunda['indicaciones'], 'Luis Martín Díaz sustituye a Ana García Pérez como Responsable del servicio.');
  assert.equal(segunda['apartados_rehechos'], '[2]');
  assert.deepEqual(
    filas(segunda['id']).map((f) => f.estado),
    ['recibido', 'pendiente', 'recibido', 'recibido'],
  );
  assert.equal(trabajosDe(TIPO_MEMORIA_REDACCION).length, 1, 'un único run de redacción');
});

test('should_not_name_anyone_in_the_instructions_when_the_tender_asks_for_anonymous_cvs', async () => {
  // Arrange: como el caso anterior, con un guion que pide los CV anonimizados.
  limpiar();
  await ensamblada({ 2: FRASE_ANA });
  await esperar(5);
  assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA([PERSONAS[1]!])).error, null);
  const g = guionVigente(db, ID)!;
  const anonimo = {
    ...g.datos,
    memoria: {
      ...g.datos.memoria!,
      advertencias: [...g.datos.memoria!.advertencias, 'Los CV se presentarán anonimizados.'],
    },
  };
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(anonimo), g.id);
  try {
    // Act
    const r = apartadosAfectadosDe(nucleo().db, db, { id: ID, version: 1, cambio: SALE_ANA() });

    // Assert
    assert.equal(r.error, null, r.error?.message);
    assert.equal(
      r.data!.indicaciones,
      'Cambia la persona del rol Responsable del servicio. El pliego pide el equipo por roles: no escribas el nombre de nadie, solo su rol.',
    );
  } finally {
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(g.datos), g.id);
  }
});

test('should_redo_a_section_of_an_old_version_naming_who_left_after_saving_the_decisions', async () => {
  limpiar();
  const m = await ensamblada({ 2: FRASE_ANA }, false);
  await esperar(5);
  assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA([PERSONAS[1]!])).error, null);

  const previa = apartadosAfectadosDe(nucleo().db, db, { id: ID, version: 1, cambio: SALE_ANA() });
  const r = await actualizarPorSaleAna();

  assert.equal(previa.error, null, previa.error?.message);
  assert.deepEqual(previa.data!.apartados, [2]);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.apartados, [2]);
  const sinEscribir = db.prepare('SELECT DISTINCT dependencias FROM memoria_apartados WHERE memoria_id = ?').all(m) as {
    dependencias: string;
  }[];
  assert.deepEqual(sinEscribir, [{ dependencias: '{}' }]);
});

test('should_pass_the_person_edited_text_as_base_with_the_change_instructions', async () => {
  limpiar();
  const m = await ensamblada({ 2: FRASE_ANA });
  const editado = `${FRASE_ANA} Tabla de turnos revisada a mano por el equipo.`;
  const editada = { titulo: '2. Gestión', bloques: [{ parrafos: [editado] }], cubre: [], compromisos: [] };
  db.prepare('UPDATE memoria_apartados SET datos = ?, editado = 1 WHERE memoria_id = ? AND apartado = 2').run(
    JSON.stringify(editada),
    m,
  );
  await esperar(5);
  assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA([PERSONAS[1]!])).error, null);

  const r = await actualizarPorSaleAna();

  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.apartados, [2]);
  const [t] = trabajosDe(TIPO_MEMORIA_REDACCION);
  const inst = instruccionesRedaccion(db, nucleo().db, JSON.parse(t!.payload));
  assert.ok(inst.includes('Este es el texto actual del apartado (puede estar editado por una persona)'));
  assert.ok(inst.includes(editado), 'la base es el texto que dejó la persona');
  assert.ok(inst.includes('Luis Martín Díaz sustituye a Ana García Pérez como Responsable del servicio.'));
  assert.ok(inst.includes('conserva el resto palabra por palabra'));
});

test('should_refuse_to_update_an_uploaded_word_because_hermes_does_not_redo_a_persons_document', async () => {
  limpiar();
  await subida([`${FRASE_ANA} Tabla de turnos revisada a mano por el equipo.`]);

  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version: 1,
    apartados: [1],
    cambios: [SALE_ANA()],
    confirmado: true,
  });

  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /se subió a mano/);
  assert.equal(memoria(2), undefined);
});

test('should_fail_when_no_section_depends_on_the_change', async () => {
  limpiar();
  await ensamblada({});

  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version: 1,
    apartados: [],
    cambios: [{ decisiones: { equipo: [{ persona_id: PERSONAS[1], sale: true }] } }],
    confirmado: true,
  });

  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(r.error?.message, NADA_QUE_ACTUALIZAR);
  assert.equal(memoria(2), undefined);
});

test('should_reject_a_change_that_is_not_one_of_the_known_kinds', async () => {
  limpiar();

  const r = await api(`/licitaciones/${ID}/oferta/memoria/1/actualizar-afectados?confirmar=1`, {
    cambio: { precio: 98.5 },
  });

  assert.equal(r.status, 400);
  assert.equal(memoria(1), undefined);
});

test('should_keep_previous_section_and_reassemble_without_runs', async () => {
  limpiar();
  await ensamblada({ 2: FRASE_ANA });
  const a = await actualizarPorSaleAna();
  assert.equal(a.error, null, a.error?.message);
  const segunda = memoria(2)!;
  const nuevo = {
    ...apartadoCasoA(2, { memoria_id: segunda['id'], guion_id: segunda['guion_id'], version: 2 }),
    titulo: '2. Texto nuevo sin Ana',
  };
  db.prepare(
    "UPDATE memoria_apartados SET estado = 'recibido', datos = ?, recibido_en = ? WHERE memoria_id = ? AND apartado = 2",
  ).run(JSON.stringify(nuevo), new Date().toISOString(), segunda['id']);
  assert.equal((await ensamblarMemoria(db, segunda['id'], raices())).error, null);
  const diff = diffApartado(db, { id: ID, version: 2, n: 2 });
  assert.ok(diff.data!.antes.includes(FRASE_ANA) && !diff.data!.despues.includes(FRASE_ANA));
  const trabajos = nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number };

  const r = await mantenerAnterior(db, { id: ID, version: 2, n: 2 }, raices());

  assert.equal(r.error, null, r.error?.message);
  assert.equal(filas(segunda['id'])[1]!.datos, filas(memoria(1)!['id'])[1]!.datos);
  assert.equal(memoria(2)!['apartados_rehechos'], '[]');
  assert.equal(memoria(2)!['estado'], 'ensamblada');
  assert.deepEqual(nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get(), trabajos);
  const igual = diffApartado(db, { id: ID, version: 2, n: 2 }).data!;
  assert.equal(igual.antes, igual.despues);
  assert.equal((await mantenerAnterior(db, { id: ID, version: 2, n: 2 }, raices())).error?.code, 'invalid_input');
});

// La versión 2 de «Mantener el anterior»: sale de la 1 con el apartado 2 rehecho sin Ana, ya ensamblada.
async function segundaConApartadoRehecho(): Promise<J> {
  await ensamblada({ 2: FRASE_ANA });
  const a = await actualizarPorSaleAna();
  assert.equal(a.error, null, a.error?.message);
  const segunda = memoria(2)!;
  const nuevo = {
    ...apartadoCasoA(2, { memoria_id: segunda['id'], guion_id: segunda['guion_id'], version: 2 }),
    titulo: '2. Texto nuevo sin Ana',
  };
  db.prepare(
    "UPDATE memoria_apartados SET estado = 'recibido', datos = ?, recibido_en = ? WHERE memoria_id = ? AND apartado = 2",
  ).run(JSON.stringify(nuevo), new Date().toISOString(), segunda['id']);
  assert.equal((await ensamblarMemoria(db, segunda['id'], raices())).error, null);
  return memoria(2)!;
}

test('should_not_touch_the_section_when_the_version_cannot_be_remounted', async () => {
  // Arrange: otra versión de la misma memoria se está redactando.
  limpiar();
  const segunda = await segundaConApartadoRehecho();
  const antes = filas(segunda['id'])[1]!.datos;
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 3, 'redactando', ?)",
  ).run(ID, segunda['guion_id'], new Date().toISOString());

  // Act
  const r = await mantenerAnterior(db, { id: ID, version: 2, n: 2 }, raices());

  // Assert
  assert.equal(r.error?.code, 'conflicto');
  assert.equal(filas(segunda['id'])[1]!.datos, antes, 'el texto rehecho sigue, como el Word');
  assert.equal(memoria(2)!['apartados_rehechos'], segunda['apartados_rehechos'], 'se puede volver a pedir');
  assert.equal(memoria(2)!['estado'], 'ensamblada');
});

test('should_mark_the_version_evaluation_as_outdated_after_keeping_the_previous_section', async () => {
  // Arrange: la versión 2 ya tiene su evaluación, hecha con el apartado 2 rehecho.
  limpiar();
  await segundaConApartadoRehecho();
  db.prepare(
    "INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, 'Salidas/memoria-segunda.docx', ?, 'licitaciones', ?)",
  ).run(ID, JSON.stringify({ memoria: { version: 2 } }), new Date().toISOString());

  // Act
  const r = await mantenerAnterior(db, { id: ID, version: 2, n: 2 }, raices());

  // Assert
  assert.equal(r.error, null, r.error?.message);
  const ev = db
    .prepare("SELECT estado FROM evaluaciones WHERE licitacion_id = ? AND json_extract(datos, '$.memoria.version') = 2")
    .all(ID) as { estado: string }[];
  assert.deepEqual(
    ev.map((e) => e.estado),
    ['descartada'],
    'sus notas y citas ya no son del texto',
  );
});

test('should_refuse_to_compute_sections_to_redo_when_base_is_an_uploaded_word', async () => {
  // Arrange: Hermes no rehace una subida a mano (actualizarMemoria.ts la rechaza).
  limpiar();
  await subida([FRASE_ANA, FRASE_ANA]);

  // Act
  const r = apartadosAfectadosDe(nucleo().db, db, { id: ID, version: 1, cambio: SALE_ANA() });

  // Assert
  assert.equal(r.error?.code, 'conflicto');
  assert.match(r.error!.message, /se subió a mano: Hermes no la rehace/);
});
