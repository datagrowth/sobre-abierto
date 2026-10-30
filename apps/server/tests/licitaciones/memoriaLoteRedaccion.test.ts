// Memoria por lote II: lo que redacta o comprueba la memoria de un lote solo
// ve su lote. CASO_E pide «una Memoria Técnica específica para cada lote» y la empresa va a los lotes 2 y 4:
// la del lote 2 no nombra a quien solo va en el lote 4, ni promete lo de «ambos lotes», y su
// portada lleva solo su lote. Una memoria común (Villaejemplo) sale exactamente como antes.
// Fixtures de las comprobaciones (captura del 14/10/2026, seudonimizada).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-lote-redaccion-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { componerDossier } = await import('../../src/dominios/licitaciones/oferta/dossier.js');
const { instruccionesRedaccion } = await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { instruccionesEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { documentoEnMarkdown, filaMemoria, lotesDePortada } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { contextoCoherencia } = await import('../../src/dominios/licitaciones/oferta/coherenciaMemoria.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_E = leerFixtureComprobaciones('casoE');
const CASO_C = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, CASO_E);
sembrarFixture(db, nucleo().db, CASO_C);

type Equipo = { persona_id: number; rol_en_la_oferta: string; lotes: string[] }[];
function ajustarDecisiones(id: string, equipo?: (e: Equipo) => Equipo): void {
  const fila = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as { datos: string };
  const d = JSON.parse(fila.datos) as {
    equipo: Equipo;
    ofertas: { pendiente: boolean; importe: number | null; unitarios: unknown[] }[];
  };
  // La captura va sin importes ofertados: con los precios pendientes las decisiones no tienen problemas.
  d.ofertas = d.ofertas.map((o) => ({ ...o, pendiente: true, importe: null, unitarios: [] }));
  if (equipo) d.equipo = equipo(d.equipo);
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(d), id);
}
ajustarDecisiones(CASO_C.id);
// En la captura nadie lleva lotes: el docente del lote 4 (1003 en el fixture) va solo en el lote 4
// y la docente del lote 2 (1002, también tutora suplente), solo en el 2. Al sembrar, los
// persona_id se renumeran: se reconocen por su rol.
const ROL_LOTE_4 = 'Docente principal del lote 4';
const ROL_LOTE_2 = 'Docente principal del lote 2';
const loteDelRol = (rol: string): string[] =>
  rol.startsWith(ROL_LOTE_4) ? ['4'] : rol.startsWith(ROL_LOTE_2) ? ['2'] : [];
ajustarDecisiones(CASO_E.id, (e) => e.map((m) => ({ ...m, lotes: loteDelRol(m.rol_en_la_oferta) })));
const nombreDe = (id: number) => String(CASO_E.personas.find((p) => p.persona_id === id)!['nombre']);

const DIAS = 24 * 3_600_000;
function pedir(id: string): { id: number; version: number; guion_id: number; lote: string | null }[] {
  db.prepare(
    "DELETE FROM memoria_apartados WHERE memoria_id IN (SELECT id FROM memorias WHERE licitacion_id = ? AND estado = 'redactando')",
  ).run(id);
  db.prepare("DELETE FROM memorias WHERE licitacion_id = ? AND estado = 'redactando'").run(id);
  const r = pedirMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, id, {
    confirmado: true,
    ahoraMs: Date.parse(CASO_E.ahora) - 3 * DIAS,
  });
  assert.equal(r.error, null, r.error?.message);
  return r.data!.memorias.map((m) => {
    const f = filaMemoria(db, m.memoria)!;
    return { id: f.id, version: f.version, guion_id: f.guion_id, lote: f.lote };
  });
}
const payloadRedaccion = (lic: string, m: { id: number; version: number; guion_id: number }) => ({
  id: lic,
  memoria_id: m.id,
  guion_id: m.guion_id,
  version: m.version,
  ronda: 0,
  pedida_en: new Date().toISOString(),
});
async function dossier(memoriaId: number): Promise<Record<string, string>> {
  const d = await componerDossier(db, nucleo().db, memoriaId);
  assert.equal(d.error, null, d.error?.message);
  return Object.fromEntries(d.data!.secciones.map((s) => [s.clave, s.texto]));
}
const enRedaccion = (memoriaId: number) =>
  db.prepare("UPDATE memorias SET fase = 'redaccion' WHERE id = ?").run(memoriaId);

test('should_tell_the_writer_the_memoria_is_only_for_its_lote', async () => {
  // Arrange
  const [lote2] = pedir(CASO_E.id);
  enRedaccion(lote2!.id);

  // Act
  const redaccion = instruccionesRedaccion(db, nucleo().db, payloadRedaccion(CASO_E.id, lote2!));
  const estrategia = instruccionesEstrategia(db, {
    id: CASO_E.id,
    memoria_id: lote2!.id,
    version: lote2!.version,
    pedida_en: new Date().toISOString(),
  });
  const identificacion = (await dossier(lote2!.id))['identificacion']!;

  // Assert
  assert.equal(lote2!.lote, '2');
  assert.match(redaccion, /- Lotes: lote 2\b[^\n]*\. Esta memoria es solo de este lote: el pliego pide una por lote\./);
  assert.doesNotMatch(redaccion, /- Lotes:[^\n]*lote 4/);
  assert.match(redaccion, new RegExp(`versión ${lote2!.version}, lote 2`));
  assert.match(estrategia, /Esta memoria es solo del lote 2: temas, hechos y equipo de ese lote\./);
  assert.match(
    identificacion,
    /- Lote: Lote 2\b[^\n]*\. Esta memoria es solo de este lote: el pliego pide una memoria por lote; no hables de los demás lotes \(van en su propia memoria\)\./,
  );
  assert.doesNotMatch(identificacion, /Lotes a los que vamos|Lote 4/);
});

test('should_leave_out_team_of_other_lotes_in_the_dossier', async () => {
  // Arrange
  const [lote2, lote4] = pedir(CASO_E.id);

  // Act
  const equipo2 = (await dossier(lote2!.id))['equipo']!;
  const equipo4 = (await dossier(lote4!.id))['equipo']!;

  // Assert
  assert.equal(lote4!.lote, '4');
  assert.ok(!equipo2.includes(ROL_LOTE_4), 'el docente del lote 4 no está en la del lote 2');
  assert.ok(!equipo2.includes(nombreDe(1003)));
  assert.ok(equipo2.includes(ROL_LOTE_2));
  assert.ok(equipo4.includes(ROL_LOTE_4));
  assert.ok(!equipo4.includes(ROL_LOTE_2), 'ni la docente del 2 en la del 4');
  assert.ok(equipo4.includes('Tutora académica titular'), 'quien no lleva lotes va en las dos');
});

test('should_put_only_its_lote_on_the_cover', () => {
  // Arrange
  const [lote2, lote4] = pedir(CASO_E.id);

  // Act
  const portada2 = lotesDePortada(db, CASO_E.id, lote2!.lote);
  const portada4 = lotesDePortada(db, CASO_E.id, lote4!.lote);
  const documento2 = documentoEnMarkdown(db, lote2!.id) ?? '';

  // Assert
  assert.equal(portada2.length, 1);
  assert.match(portada2[0]!, /^Lote 2\b/);
  assert.match(portada4[0]!, /^Lote 4\b/);
  assert.equal(lotesDePortada(db, CASO_E.id).length, 2, 'sin lote, los decididos');
  const cabecera = documento2.split('\n').find((l) => l.includes('**Expediente:**')) ?? '';
  assert.ok(cabecera.includes(portada2[0]!), cabecera);
  assert.ok(!cabecera.includes(portada4[0]!), cabecera);
});

test('should_check_coherence_only_against_the_team_of_its_lote', () => {
  // Arrange
  const [lote2, lote4] = pedir(CASO_E.id);

  // Act
  const equipo2 = contextoCoherencia(db, filaMemoria(db, lote2!.id)!)!.op.equipo ?? [];
  const equipo4 = contextoCoherencia(db, filaMemoria(db, lote4!.id)!)!.op.equipo ?? [];

  // Assert
  assert.ok(!equipo2.includes(nombreDe(1003)));
  assert.ok(equipo2.includes(nombreDe(1002)));
  assert.ok(equipo4.includes(nombreDe(1003)));
  assert.ok(!equipo4.includes(nombreDe(1002)));
  assert.ok(equipo2.includes(nombreDe(1001)) && equipo4.includes(nombreDe(1001)));
});

test('should_not_change_dossier_or_instructions_when_memoria_has_no_lote', async () => {
  // Arrange
  const [casoC] = pedir(CASO_C.id);
  const [casoE] = pedir(CASO_E.id);
  // La memoria común de CASO_E (como las de antes de la memoria por lote): todo el equipo y los dos lotes.
  db.prepare('UPDATE memorias SET lote = NULL WHERE id = ?').run(casoE!.id);
  enRedaccion(casoC!.id);
  enRedaccion(casoE!.id);

  // Act
  const dossierCasoC = await dossier(casoC!.id);
  const dossierCasoE = await dossier(casoE!.id);
  const redaccionCasoE = instruccionesRedaccion(db, nucleo().db, payloadRedaccion(CASO_E.id, casoE!));
  const estrategiaCasoE = instruccionesEstrategia(db, {
    id: CASO_E.id,
    memoria_id: casoE!.id,
    version: casoE!.version,
    pedida_en: new Date().toISOString(),
  });

  // Assert
  assert.equal(casoC!.lote, null);
  const lotes = lotesDePortada(db, CASO_C.id);
  assert.ok(
    dossierCasoC['identificacion']!.includes(
      `- Lotes a los que vamos: ${lotes.length ? lotes.join('; ') : 'el contrato entero'}.`,
    ),
  );
  assert.ok(
    dossierCasoE['identificacion']!.includes(`- Lotes a los que vamos: ${lotesDePortada(db, CASO_E.id).join('; ')}.`),
  );
  assert.ok(dossierCasoE['equipo']!.includes(ROL_LOTE_4) && dossierCasoE['equipo']!.includes(ROL_LOTE_2));
  assert.match(redaccionCasoE, /- Lotes: lote 2\b[^\n]*, lote 4\b[^\n]*\.\n/);
  assert.match(redaccionCasoE, new RegExp(`versión ${casoE!.version}, `));
  assert.doesNotMatch(redaccionCasoE, /lote 2, ronda|versión \d+, lote/);
  for (const texto of [
    ...Object.values(dossierCasoC),
    ...Object.values(dossierCasoE),
    redaccionCasoE,
    estrategiaCasoE,
  ]) {
    assert.doesNotMatch(texto, /Esta memoria es solo (?:de este lote|del lote)/);
  }
});
