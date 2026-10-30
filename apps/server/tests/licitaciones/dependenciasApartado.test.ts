// Dependencias guardadas por apartado: de qué lotes, personas y roles,
// herramientas y automáticos vigilados depende el texto de cada apartado. Con la memoria de CASO_E
// capturada en producción (fixtures/cambios/casoE-memoria.json, seudonimizada) y su equipo de las comprobaciones,
// y en la base con el caso A: al recibir un apartado, al subir un Word, al conservarlo
// en una nueva versión y al vuelo para las versiones de antes de la columna.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrancar, cerrar, db, ID, nucleo, PERSONAS, salidas, sinMemorias } from '../helpers/memoriaEntorno.js';
import { apartadoCasoA, type Numeros } from './fixtures/casoA.js';

const { CambioImpacto, dependenciasDeApartado, impactoDe } =
  await import('../../src/dominios/licitaciones/oferta/dependencias.js');
const { ApartadoEntrada, dependenciasDe, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { actualizarMemoria } = await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { subirMemoria } = await import('../../src/dominios/licitaciones/oferta/subida.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');

before(arrancar);
after(cerrar);

type J = Record<string, any>;
const fixture = (ruta: string): J => JSON.parse(readFileSync(new URL(`./fixtures/${ruta}`, import.meta.url), 'utf8'));
const CASO_E_MEMORIA = fixture('cambios/casoE-memoria.json');
const CASO_E_COMPROBACIONES = fixture('comprobaciones/casoE.json');
// El ámbito con el lote 6 que se quita (el de los tests de «Qué cambia» de la).
const AMBITO_CASO_E = ['2', '4', '6'];
// Un nombre se reconoce por dos palabras («Ana García»): el alias de una letra («Persona D») se
// alarga igual en el texto y en el equipo («Persona Delta»).
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
const nombresCasoE = () =>
  new Map<number, string>(CASO_E_COMPROBACIONES.personas.map((p: J) => [p.persona_id, alias(p.nombre)]));

function contextoCasoE(n: number) {
  const nombres = nombresCasoE();
  const equipo = CASO_E_COMPROBACIONES.decisiones.datos.equipo.map((m: J) => ({
    persona_id: m.persona_id,
    nombre: nombres.get(m.persona_id) ?? '',
    rol: m.rol_en_la_oferta,
  }));
  return {
    n,
    guionApartado: `casoE-${n}`,
    lotesAmbito: AMBITO_CASO_E,
    equipo,
    herramientas: CASO_E_COMPROBACIONES.decisiones.datos.herramientas as string[],
    automaticosVigilados: [],
  };
}

const apartadosCasoE = (): J[] => CASO_E_MEMORIA.memorias[0].apartados.map((a: J) => ({ ...a, texto: alias(a.texto) }));

function estadoCasoE() {
  const nombres = nombresCasoE();
  return {
    lotes: AMBITO_CASO_E,
    documentos: [],
    paquete: null,
    memoria_ensamblada: true,
    equipo: [...nombres].map(([persona_id, nombre]) => ({ persona_id, nombre, lotes: [] })),
    apartados: apartadosCasoE().map((a) => ({
      memoria_version: 1,
      n: a.apartado,
      titulo: a.titulo,
      texto: a.texto,
      dependencias: dependenciasDeApartado(a.texto, contextoCasoE(a.apartado)),
    })),
  };
}

const apartadosAfectados = (r: ReturnType<typeof impactoDe>) =>
  r.afectadas.filter((a) => a.pieza === 'apartado').map((a) => [a.clave, a.accion]);

test('should_record_lot_6_for_casoE_section_that_says_both_lots', () => {
  const [primero, segundo, tercero] = apartadosCasoE();

  const deps = [primero, segundo, tercero].map((a) => dependenciasDeApartado(a!.texto, contextoCasoE(a!.apartado)));

  // «los dos lotes» y «ambos lotes» no dicen cuáles: con tres en el ámbito, van todos.
  assert.deepEqual(deps[0]!['ambito.lotes'], AMBITO_CASO_E);
  assert.deepEqual(deps[1]!['ambito.lotes'], AMBITO_CASO_E);
  // «el personal docente principal de cada lote» no depende de cuáles van.
  assert.deepEqual(deps[2]!['ambito.lotes'], ['2', '4']);
  assert.deepEqual(apartadosAfectados(impactoDe(estadoCasoE(), CambioImpacto.parse({ lotes: ['2', '4'] }))), [
    ['v1-1', 'rehacer'],
    ['v1-2', 'rehacer'],
  ]);
});

test('should_list_only_sections_naming_the_person_as_affected_by_a_team_change', () => {
  const estado = estadoCasoE();

  // Persona D (1004), el analista de calidad formativa: la nombran los apartados 2 y 3, no el 1.
  const r = impactoDe(estado, CambioImpacto.parse({ decisiones: { equipo: [{ persona_id: 1004, sale: true }] } }));

  assert.deepEqual(apartadosAfectados(r), [
    ['v1-2', 'rehacer'],
    ['v1-3', 'rehacer'],
  ]);
  assert.ok(r.se_mantiene.includes('el resto de la memoria: no nombra lo que cambia'));
});

test('should_find_a_person_by_the_role_head_when_the_section_does_not_name_her', () => {
  const ctx = contextoCasoE(1);

  const d = dependenciasDeApartado(
    'El analista externo de calidad formativa prepara los informes quincenales. La tutora responde en dos horas.',
    ctx,
  );

  assert.deepEqual(d['decision.equipo'], [
    { persona_id: 1004, rol: 'Analista externo de calidad formativa (panel de seguimiento e informes cada diez días)' },
  ]);
});

test('should_never_record_price_as_a_dependency', () => {
  const ctx = contextoCasoE(1);

  const d = dependenciasDeApartado(
    'El precio ofertado del lote 2 y su importe no se mencionan aquí; Persona Hotel imparte el lote 2 con videollamada integrada del campus.',
    ctx,
  );

  assert.deepEqual(Object.keys(d).sort(), [
    'ambito.lotes',
    'decision.automatico',
    'decision.enfoque',
    'decision.equipo',
    'decision.herramientas',
    'guion.apartado',
  ]);
  assert.ok(!JSON.stringify(d).includes('precio'));
  assert.equal(d['decision.enfoque'], 'blanda');
  assert.deepEqual(d['decision.herramientas'], ['videollamada integrada del campus']);
  assert.deepEqual(d['ambito.lotes'], ['2']);
});

test('should_review_and_never_redo_sections_when_the_approach_changes', () => {
  const r = impactoDe(estadoCasoE(), CambioImpacto.parse({ decisiones: { enfoque: true } }));

  assert.ok(apartadosAfectados(r).every(([, accion]) => accion === 'revisar'));
  assert.equal(apartadosAfectados(r).length, 3);
});

// ── En la base ──

type FilaApartadoTest = { apartado: number; estado: string; dependencias: string; editado: number };
const filas = (memoriaId: number) =>
  db
    .prepare(
      'SELECT apartado, estado, dependencias, editado FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado',
    )
    .all(memoriaId) as FilaApartadoTest[];
const memoriaDe = (version: number) =>
  db.prepare('SELECT id, version, guion_id FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as {
    id: number;
    version: number;
    guion_id: number;
  };
const numeros = (m: { id: number; version: number; guion_id: number }): Numeros => ({
  memoria_id: m.id,
  guion_id: m.guion_id,
  version: m.version,
});

function limpiar(): void {
  sinMemorias();
  db.exec('DELETE FROM borradores');
}

function conFrase(n: number, nums: Numeros, frase: string) {
  const a = apartadoCasoA(n, nums);
  a.bloques[0]!.parrafos = [...a.bloques[0]!.parrafos, frase];
  return a;
}

// Una memoria con fases ensamblada, con sus cuatro apartados recibidos, como la dejaría una versión de antes de la columna.
function memoriaEnsamblada(version: number, apartado: (n: number, nums: Numeros) => object = apartadoCasoA): number {
  const g = guionVigente(db, ID)!;
  const ts = new Date().toISOString();
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, estado)
    VALUES (?, ?, 'x', 1, 'Memoria', 'plataforma', ?, 'ensamblado', ?, ?, 'pendiente')`,
      )
      .run(ID, `Salidas/Licitaciones/x/memoria-v${version}.docx`, ts, g.id, version).lastInsertRowid,
  );
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, borrador_id, fase, ronda) VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, 'fin', 0)",
      )
      .run(ID, g.id, version, ts, ts, b).lastInsertRowid,
  );
  db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(m, b);
  for (const n of [1, 2, 3, 4]) {
    const {
      id: _i,
      memoria_id: _m,
      guion_id: _g,
      version: _v,
      apartado: _a,
      ...datos
    } = apartado(n, { memoria_id: m, guion_id: g.id, version }) as J;
    db.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, recibido_en) VALUES (?, ?, 'recibido', ?, ?)",
    ).run(m, n, JSON.stringify(datos), ts);
  }
  return m;
}

test('should_record_the_person_named_in_a_section', () => {
  limpiar();
  const g = guionVigente(db, ID)!;
  const memoria = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, 1, 'redactando', ?, 'redaccion', 0)",
      )
      .run(ID, g.id, new Date().toISOString()).lastInsertRowid,
  );
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, 1, 'pendiente')").run(memoria);
  const entrada = ApartadoEntrada.parse(
    conFrase(1, numeros(memoriaDe(1)), 'Ana García coordinará el servicio con la entidad.'),
  );

  const r = recibirApartado(db, entrada, 'licitaciones');

  assert.equal(r.error, null, r.error?.message);
  const fila = filas(memoria)[0]!;
  const d = JSON.parse(fila.dependencias) as J;
  assert.deepEqual(d['decision.equipo'], [{ persona_id: PERSONAS[0], rol: 'Responsable del servicio' }]);
  assert.match(d['guion.apartado'], /^[0-9a-f]{16}$/);
  assert.equal(d['decision.enfoque'], 'blanda');
  assert.equal(fila.editado, 0);
});

test('should_mark_sections_of_an_uploaded_word_as_edited', async () => {
  limpiar();
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const texto =
    'Luis Martín revisó a mano este apartado: responsables, plazos e indicadores quedan como los acordó el equipo.';
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '12 de octubre de 2026',
    },
    apartados: titulos
      .slice(0, 3)
      .map((t, i) => ({ numero: String(i + 1), titulo: t, bloques: [{ parrafos: [texto] }] })),
    pie: { texto: '', numeracion: true },
  });

  const r = await subirMemoria(db, ID, { nombre: 'memoria-editada.docx', datos: docx, campos: {} });

  assert.equal(r.error, null, r.error?.message);
  const fs = filas(r.data!.memoria);
  assert.ok(fs.length === 4 && fs.every((f) => f.editado === 1));
  const recibidos = fs.filter((f) => f.estado === 'recibido');
  assert.equal(recibidos.length, 3);
  for (const f of recibidos)
    assert.deepEqual((JSON.parse(f.dependencias) as J)['decision.equipo'], [
      { persona_id: PERSONAS[1], rol: 'Consultora de protección de datos' },
    ]);
});

test('should_copy_dependencies_when_a_section_is_kept_in_a_new_version', async () => {
  limpiar();
  const base = memoriaEnsamblada(1);
  const guardadas = JSON.stringify({
    'guion.apartado': 'abc',
    'ambito.lotes': [],
    'decision.equipo': [{ persona_id: PERSONAS[1], rol: 'Consultora' }],
    'decision.herramientas': [],
    'decision.automatico': [],
    'decision.enfoque': 'blanda',
  });
  db.prepare('UPDATE memoria_apartados SET dependencias = ?, editado = 1 WHERE memoria_id = ? AND apartado = 2').run(
    guardadas,
    base,
  );

  const r = await actualizarMemoria(nucleo().db, db, salidas, {
    id: ID,
    version: 1,
    apartados: [1],
    indicaciones: 'Cuantifica el volumen de consultas atendidas cada mes.',
    confirmado: true,
  });

  assert.equal(r.error, null, r.error?.message);
  const [primero, segundo] = filas(r.data!.memoria);
  assert.equal(primero!.estado, 'pendiente');
  assert.equal(segundo!.dependencias, guardadas);
  assert.equal(segundo!.editado, 1);
});

test('should_return_null_without_writing_for_versions_before_the_column', () => {
  limpiar();
  const m = memoriaEnsamblada(1, (n, nums) =>
    n === 3 ? conFrase(n, nums, 'Ana García Pérez responde las consultas.') : apartadoCasoA(n, nums),
  );
  assert.equal(filas(m)[2]!.dependencias, '{}');

  const d = dependenciasDe(db, m, 3);

  assert.equal(d, null);
  assert.equal(filas(m)[2]!.dependencias, '{}');
  assert.equal(dependenciasDe(db, m, 9), null);
});
