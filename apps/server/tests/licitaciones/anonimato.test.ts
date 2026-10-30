// El equipo sin nombres en cualquier versión de la memoria. Un pliego que pide los CV
// anonimizados y una versión que nombra al equipo: aquí, un apartado que nombra se rechaza al
// recibirlo, la línea de equipo de la redacción va por roles y una versión ensamblada dice qué
// apartados nombran (sin decir a quién). Con el caso A (p-91000710) y dos personas inventadas.
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
  ID,
  licitacionCasoA,
  type Numeros,
} from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anonimato-'));
const salidas = path.join(tmp, 'salidas');
const agentes = path.join(tmp, '.agentes');
for (const d of [salidas, agentes]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), 'l'.repeat(40));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
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
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { anonimatoDeMemoria, apartadosQueNombran } = await import('../../src/dominios/licitaciones/oferta/anonimato.js');
const { ApartadoEntrada, memoriasDe, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { instruccionesRedaccion } = await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { componerDossier, guardarDossier } = await import('../../src/dominios/licitaciones/oferta/dossier.js');

const ANA = 'Ana García Pérez';
const LUIS = 'Luis Martín Díaz';
// Una fórmula de pliego habitual, a la forma de una advertencia del guion.
const CV_ANONIMIZADOS =
  'Los currículos del personal adscrito se aportarán anonimizados: cada persona figurará solo por su función.';

// ── Pura ──

test('should_not_count_a_first_name_alone', () => {
  const r = apartadosQueNombran(
    ['Ana coordinará el servicio con Luis.', 'Ana García coordinará el servicio.'],
    [ANA, LUIS],
  );
  assert.deepEqual(r, [{ apartado: 2, personas: 1 }], 'un nombre suelto no identifica; nombre y apellido sí');
});

// ── Con la base ──

iniciarNucleo();
const db = dbLicitaciones();
const ts = new Date().toISOString();
guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ts, ts);
assert.equal(guardarPerfilEmpresa(nucleo().db, { nif: 'B12345678', nombre: 'Analítica Ejemplo SL' }).error, null);
const PERSONAS = [ANA, LUIS].map(
  (nombre) => crearPersona(nucleo().db, { nombre, tipo: 'interno', rol: 'Consultora' }).data!.id,
);
await proponerFicha(db, FichaEntrada.parse(FICHA_CASO_A), 'licitaciones');
assert.equal((await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones')).error, null);
assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA(PERSONAS)).error, null);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Una versión ensamblada (como una subida a mano) cuyos apartados 2 y 4 nombran al equipo.
function ensambladaConNombres(version: number): number {
  const g = guionVigente(db, ID)!;
  const id = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, ?, 'ensamblada', ?)",
      )
      .run(ID, g.id, version, ts).lastInsertRowid,
  );
  const frase: Record<number, string> = {
    2: `${ANA} dirigirá el servicio con ${LUIS}.`,
    4: `Las consultas las atiende Ana García.`,
  };
  for (const n of [1, 2, 3, 4]) {
    const {
      id: _i,
      memoria_id: _m,
      guion_id: _g,
      version: _v,
      apartado: _a,
      ...datos
    } = apartadoCasoA(n, { memoria_id: id, guion_id: g.id, version });
    if (frase[n]) datos.bloques[0]!.parrafos.push(frase[n]!);
    db.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres) VALUES (?, ?, 'recibido', ?, 1000)",
    ).run(id, n, JSON.stringify(datos));
  }
  return id;
}

const conAnonimato = async () => {
  const g = structuredClone(GUION_CASO_A);
  g.memoria.advertencias.push(CV_ANONIMIZADOS);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ id: ID, ...g }), 'licitaciones')).error, null);
};

let previa = 0;

test('should_return_exige_false_when_pliego_does_not_ask_anonymity', () => {
  previa = ensambladaConNombres(1);
  assert.deepEqual(anonimatoDeMemoria(db, previa), { exige: false, apartados: [], personas: 0 });
  const redactando = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 2, 'redactando', ?)",
      )
      .run(ID, guionVigente(db, ID)!.id, ts).lastInsertRowid,
  );
  assert.equal(anonimatoDeMemoria(db, redactando), null, 'sin ensamblar no hay documento que mirar');
  db.prepare('DELETE FROM memorias WHERE id = ?').run(redactando);
});

test('should_use_current_guion_not_the_version_guion', async () => {
  await conAnonimato();
  const vigente = guionVigente(db, ID)!;
  const suyo = (db.prepare('SELECT guion_id FROM memorias WHERE id = ?').get(previa) as { guion_id: number }).guion_id;
  assert.notEqual(suyo, vigente.id, 'la versión se hizo con el guion anterior, que no lo pedía');
  assert.deepEqual(anonimatoDeMemoria(db, previa), { exige: true, apartados: [2, 4], personas: 2 });
});

test('should_find_apartados_that_name_the_team_when_pliego_asks_anonymous_cvs', () => {
  const id = ensambladaConNombres(2);
  const estado = memoriasDe(db, ID).find((m) => m.id === id)!;
  assert.deepEqual(estado.anonimato, { exige: true, apartados: [2, 4], personas: 2 });
  assert.ok(!JSON.stringify(estado.anonimato).includes('Ana'), 'el estado no lleva nombres');
});

// Una memoria con fases en la redacción, con su dossier (que dice si el equipo va por roles) y el apartado 1 por recibir.
async function enRedaccion(version: number): Promise<Numeros> {
  const guion = guionVigente(db, ID)!.id;
  const id = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, ?, 'redactando', ?, 'redaccion', 0)",
      )
      .run(ID, guion, version, ts).lastInsertRowid,
  );
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, 1, 'pendiente')").run(id);
  const dossier = await componerDossier(db, nucleo().db, id);
  assert.equal(dossier.error, null, dossier.error?.message);
  assert.equal(guardarDossier(db, dossier.data!).error, null);
  return { memoria_id: id, guion_id: guion, version };
}

let enCurso: Numeros = { memoria_id: 0, guion_id: 0, version: 0 };

test('should_write_the_team_line_by_roles_when_anonymous', async () => {
  enCurso = await enRedaccion(3);
  const inst = instruccionesRedaccion(db, nucleo().db, {
    id: ID,
    ...enCurso,
    ronda: 0,
    pedida_en: ts,
  });
  assert.ok(
    inst.includes(
      '- Equipo (por roles, sin nombres: el pliego pide el equipo sin identificar): Responsable del servicio (50 %) | Consultora de protección de datos (100 %).',
    ),
    inst,
  );
  assert.ok(!inst.includes('Equipo nominal'), 'sin la línea con nombres y CV');
});

test('should_reject_an_apartado_that_names_the_team_when_anonymous', () => {
  const a = apartadoCasoA(1, enCurso);
  a.bloques[0]!.parrafos.push(`${ANA} será la persona de referencia.`);
  const r = recibirApartado(db, ApartadoEntrada.parse(a), 'licitaciones', { revisar: true });
  assert.equal(r.error?.code, 'invalid_input');
  assert.match(
    r.error!.message,
    /Nombra a Ana García Pérez y el pliego pide el equipo por roles, sin nombres: escribe solo su rol \(«Ana García Pérez será/,
  );
  const sinNombre = recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(1, enCurso)), 'licitaciones', {
    revisar: true,
  });
  assert.equal(sinNombre.error, null, sinNombre.error?.message);
});

test('should_not_export_a_second_textoDeApartado_besides_the_one_of_redaccion', async () => {
  // Act
  const modulo = await import('../../src/dominios/licitaciones/oferta/anonimato.js');

  // Assert
  assert.equal('textoDeApartado' in modulo, false, 'solo redaccion.ts exporta textoDeApartado');
});
