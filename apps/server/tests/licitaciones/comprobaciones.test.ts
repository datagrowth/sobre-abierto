// Las comprobaciones (comprobacionesDe) sobre el caso sintético de CASO_E de ofertaCoherencia.test.ts: seis lotes,
// interés en el 2 y el 4, ficha hecha para el 2 y el 6, decisiones para el 2, el 6 y el 4 con un
// solo precio de 72 por alumno (por debajo del umbral) y la nota de rectificación sin bajar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comprobaciones-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { coherenciaOferta } = await import('../../src/dominios/licitaciones/oferta/coherencia.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { DURACION_MIN } = await import('../../src/dominios/licitaciones/oferta/plazo.js');

iniciarNucleo();
const db = dbLicitaciones();
const AHORA = Date.parse('2026-10-14T01:30:00Z');
const ELISA = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Formadora' }).data!.id;

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Siembra copiada de ofertaCoherencia.test.ts (caso CASO_E).
const LOTES = [
  { id: '1', nombre: 'Primeros auxilios básicos', importe: 3_000 },
  { id: '2', nombre: 'Análisis de datos con hojas de cálculo', importe: 6_063.75 },
  { id: '3', nombre: 'Archivo electrónico', importe: 2_000 },
  { id: '4', nombre: 'Atención al público', importe: 756 },
  { id: '5', nombre: 'Seguridad en el puesto', importe: 4_000 },
  { id: '6', nombre: 'Residuos sanitarios', importe: 6_682.5 },
];
const placsp = (nombre: string) => ({
  clase: 'adicional' as const,
  nombre,
  url: `https://contrataciondelestado.es/doc/${encodeURIComponent(nombre)}`,
  hash: null,
});
const BASES = { ...placsp('Bases.pdf'), clase: 'pcap' as const };
const NOTA = placsp('Nota de rectificación ENS.pdf');
const MEMORIA_JUSTIFICATIVA = placsp('Memoria justificativa.pdf');
const UMBRAL =
  'Se considerarán anormalmente bajas las ofertas inferiores en un 15 % al presupuesto base de licitación, IGIC excluido (apartado J).';
const docente = (lote: string, que: string) => ({
  tipo: 'medios_personales',
  descripcion: `Docente principal con titulación relacionada y formación específica en ${que}`,
  excluyente: true,
  cumple: 'dudoso',
  justificacion: 'Falta el certificado del curso.',
  documento: 'Bases.pdf',
  pagina: 64,
  lote,
});
const FICHA = {
  resumen: 'Formación subvencionada FFI para la plantilla de CASO_E en seis lotes (lotes 2 y 6 de interés).',
  requisitos: [docente('2', 'hojas de cálculo avanzadas'), docente('6', 'Residuos sanitarios')],
  criterios: [],
  documentacion: [],
  hitos: [],
  garantias: [],
  penalizaciones: [],
  riesgos: [],
  recomendacion: { decision: 'revisar', motivo: 'Hay que confirmar el ENS.' },
};
const GUION = {
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Anexos, memoria no valorable y oferta económica.',
      documentos: [{ tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' }],
      documento: 'Bases.pdf',
      pagina: 25,
    },
  ],
  memoria: null,
  automaticos: [],
  oferta_economica: {
    formula: 'P = 40 × (Om / O)',
    presupuesto_base: 6_063.75,
    impuesto_aparte: 'IGIC',
    precio_unitario: { unidad: 'alumno', maximo: 110.25 },
    umbral_anormalidad: UMBRAL,
    modelo: 'Anexo VI',
    archivo: 'Archivo electrónico único',
    documento: 'Bases.pdf',
    pagina: 53,
  },
  plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2', '4'],
};
const interes = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id, motivo: 'criba' })));
const LIMITE_LEJANO = '2099-10-15T08:00:00';

async function casoE(id: string): Promise<void> {
  const l = licitacion({
    titulo: 'Formación subvencionada FFI (6 lotes)',
    publicada: '2026-09-24',
    presupuesto: 30_000,
    lotes: LOTES,
    limite: LIMITE_LEJANO,
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, documentos: [BASES, NOTA, MEMORIA_JUSTIFICATIVA] });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes(['2', '6']), ts, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'pcap', 'Bases.pdf', 'descargado', ?, ?)",
  ).run(id, BASES.url, `Licitaciones/Radar/2026/17-26 (${id})/Bases.pdf`, ts);
  assert.equal(
    (await proponerFicha(db, { ...FICHA, id } as Parameters<typeof proponerFicha>[1], 'licitaciones')).error,
    null,
  );
  assert.equal(elegirLotesInteres(db, id, { lotes: ['2', '4'] }).error, null);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ ...GUION, id }), 'licitaciones')).error, null);
  const datos = {
    lotes: ['2', '6', '4'],
    equipo: [{ persona_id: ELISA, rol_en_la_oferta: 'Tutora titular' }],
    automaticos: [],
    herramientas: [],
    enfoque: 'Lote 6 en Residuos sanitarios.',
    precio: { importe: 72, pendiente: false },
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guionVigente(db, id)!.id,
    JSON.stringify(datos),
    ts,
  );
}

const comprobaciones = (id: string, ahoraMs = AHORA) => {
  const r = comprobacionesDe(db, nucleo().db, id, ahoraMs);
  assert.equal(r.error, null);
  return r.data!;
};

function guardarEstado(id: string, clave: string, huella: string, estado: string): void {
  db.prepare(
    'INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, quien, motivo, en) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, clave, huella, estado, 'test', 'Lo hablamos con el órgano.', new Date().toISOString());
}

test('should_turn_each_blocking_incoherence_into_one_impide_row_with_a_stable_key', async () => {
  await casoE('p-91000080');

  const c = comprobaciones('p-91000080');

  const bloquean = coherenciaOferta(db, 'p-91000080', { ahoraMs: AHORA }).filter((x) => x.gravedad === 'bloquea');
  // La docente del lote 2 sin nadie en ese rol es de la regla de medios, y el perfil de
  // empresa sin sembrar, de la de documentos: ninguna de las dos sale de la coherencia.
  const impiden = c.bloqueos.filter(
    (b) => b.gravedad === 'impide' && !b.clave.startsWith('medios:') && !b.clave.startsWith('empresa:'),
  );
  assert.ok(
    c.bloqueos.some((b) => b.clave === 'medios:2:rol_docent' && b.gravedad === 'impide'),
    'el rol de docente sin nadie impide',
  );
  assert.ok(
    c.bloqueos.some((b) => b.clave.startsWith('empresa:') && b.clave.endsWith(':perfil') && b.gravedad === 'impide'),
    'sin perfil de empresa, impide',
  );
  assert.equal(impiden.length, bloquean.length, 'una fila impide por cada incoherencia que bloquea');
  assert.deepEqual(
    impiden.map((b) => b.clave.split(':')[0]),
    ['ficha_lotes', 'pliegos', 'precio_anormal', 'precio_anormal', 'lotes_decisiones'],
  );
  assert.ok(
    c.bloqueos.some((b) => b.clave === 'precio_anormal:2') && c.bloqueos.some((b) => b.clave === 'precio_anormal:4'),
    'el precio va por lote',
  );
  assert.equal(new Set(c.bloqueos.map((b) => b.clave)).size, c.bloqueos.length, 'sin claves repetidas');
  assert.ok(
    !c.bloqueos.some((b) => b.clave.startsWith('equipo:')),
    'el equipo lo cubre la regla nueva de medios, no la coherencia',
  );
  assert.deepEqual(
    comprobaciones('p-91000080', AHORA + 3_600_000).bloqueos.map((b) => b.clave),
    c.bloqueos.map((b) => b.clave),
    'la misma clave en otro recálculo',
  );
  assert.equal(c.veredicto.tipo, 'faltan_decisiones');
  assert.equal(c.fases.length, 8);
  assert.deepEqual(
    c.fases.map((f) => `${f.nombre}:${f.estado}`),
    [
      'decidir:te_toca',
      'pliegos:bloqueado',
      'guion:hecho',
      'decisiones:te_toca',
      'memoria:no_aplica',
      'documentos:te_toca',
      'paquete:bloqueado',
      'presentar:pendiente',
    ],
    'con un precio anormal, Decisiones no está hecha; sin memoria en el guion, no aplica; sin perfil de empresa, Documentos impide y el paquete espera',
  );
  assert.equal(
    c.hora_interna_cierre,
    new Date(Date.parse('2099-10-15T06:00:00Z') - 2 * 3_600_000).toISOString(),
    'plazo peninsular (CEST) menos 2 h de margen',
  );
  const tarda = (DURACION_MIN.decisiones + DURACION_MIN.anexo) * 60_000;
  assert.equal(
    c.limite_decidir,
    new Date(Date.parse(c.hora_interna_cierre) - tarda).toISOString(),
    'le queda toda la cadena: la propuesta de decisiones y los anexos, como en la Mesa',
  );
});

test('should_not_write_anything_when_computing_the_comprobaciones', async () => {
  await casoE('p-91000090');
  const cambios = () =>
    [db, nucleo().db].map((d) => (d.prepare('SELECT total_changes() AS n').get() as { n: number }).n);
  const antes = cambios();
  const eventos = ultimosEventos(nucleo().db, 1_000).length;

  comprobaciones('p-91000090');
  comprobaciones('p-91000090');

  assert.deepEqual(cambios(), antes, 'ninguna fila escrita en licitaciones ni en el núcleo');
  assert.equal(ultimosEventos(nucleo().db, 1_000).length, eventos, 'ningún evento emitido');
});

test('should_keep_a_stored_vamos_only_while_the_row_fingerprint_is_the_same', async () => {
  const ID = 'p-91000100';
  await casoE(ID);
  const fila = comprobaciones(ID).bloqueos.find((b) => b.clave.startsWith('ficha_lotes:'))!;
  guardarEstado(ID, fila.clave, fila.huella, 'vamos');

  const conVamos = comprobaciones(ID).bloqueos.find((b) => b.clave === fila.clave)!;
  assert.equal(conVamos.estado, 'vamos');

  assert.equal(elegirLotesInteres(db, ID, { lotes: ['2', '5'] }).error, null);
  const otra = comprobaciones(ID).bloqueos.find((b) => b.clave === fila.clave)!;

  assert.notEqual(otra.huella, fila.huella, 'otro lote cambia lo que dice la fila');
  assert.equal(otra.estado, 'abierto', 'con otra huella, el vamos de antes ya no vale');
});

test('should_return_not_found_for_an_unknown_tender', () => {
  const r = comprobacionesDe(db, nucleo().db, 'p-no-existe', AHORA);

  assert.equal(r.data, null);
  assert.equal(r.error?.code, 'not_found');
});

test('should_change_the_version_when_a_row_changes_and_keep_it_otherwise', async () => {
  const ID = 'p-91000110';
  await casoE(ID);
  const primera = comprobaciones(ID);
  const riesgo = primera.bloqueos.find((b) => b.gravedad === 'riesgo')!;

  assert.equal(comprobaciones(ID, AHORA + 60_000).version, primera.version, 'sin cambios, la misma versión');
  guardarEstado(ID, riesgo.clave, riesgo.huella, 'riesgo_aceptado');
  const segunda = comprobaciones(ID);

  assert.notEqual(segunda.version, primera.version);
  assert.equal(segunda.bloqueos.find((b) => b.clave === riesgo.clave)!.estado, 'riesgo_aceptado');
  assert.equal(comprobaciones(ID).version, segunda.version);
});

test('should_never_put_an_amount_in_a_title', async () => {
  const ID = 'p-91000120';
  await casoE(ID);

  const c = comprobaciones(ID);

  const textos = [c.veredicto.texto, ...c.bloqueos.map((b) => b.titulo), ...c.comprobado.map((x) => x.texto)];
  assert.ok(
    c.bloqueos.some((b) => b.categoria === 'precio'),
    'el caso tiene filas de precio',
  );
  for (const t of textos) {
    assert.doesNotMatch(t, /72/, `sin el precio decidido: ${t}`);
    assert.doesNotMatch(t, /€|euros?\b/i, `sin importes: ${t}`);
  }
});
