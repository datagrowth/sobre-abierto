// «Qué rehace un cambio» de una licitación (POST /oferta/impacto y licitaciones_impacto) y los
// desfases de las comprobaciones, sobre la oferta de CASO_E capturada en producción (fixtures/comprobaciones/casoE.json,
// seudonimizada), sembrada como la deja la plataforma. El pliego pide «tantas proposiciones como
// lotes licite»: el archivo va por lote. Los precios de los tests son inventados y no salen en
// ninguna respuesta.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import type { EstadoOferta } from '../../src/dominios/licitaciones/oferta/ofertaAgente.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impacto-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
const T_CLAUDE = 'c'.repeat(40);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { ofertaParaAgente } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { Decisiones, decisionesDe, escribirDecisiones, SECCIONES } =
  await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { deshacerDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisionesHistorial.js');
const { documentosDelGuion } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { seccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/dependenciasAnexo.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type Impacto = import('../../src/dominios/licitaciones/oferta/dependencias.js').Impacto;

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/licitaciones', rutasLicitaciones());
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const RELLENADO = '2026-10-14T12:00:00.000Z';
let siguiente = 0;

// Precio de un lote, inventado: solo cuenta que cambie.
const conPrecio = (datos: Record<string, unknown>, lote2: number) =>
  Decisiones.parse({
    ...datos,
    ofertas: [
      { lote: '2', pendiente: false, importe: lote2, unitarios: [] },
      { lote: '4', pendiente: false, importe: 700, unitarios: [] },
    ],
  });

function guardar(id: string, datos: ReturnType<typeof conPrecio>): void {
  const r = escribirDecisiones(db, {
    id,
    guion_id: guionVigente(db, id)!.id,
    datos,
    secciones: [...SECCIONES],
    autor: 'web',
  });
  assert.equal(r.error, null);
}

// Los anexos económicos de cada lote, rellenados por Hermes con las decisiones de ahora y con su
// plan guardado (anexoPlan.ts): un cambio de precio se regenera por código.
function rellenarAnexos(id: string): Map<string, string> {
  const g = guionVigente(db, id)!;
  const d = decisionesDe(db, id)!;
  const claves = new Map<string, string>();
  for (const doc of documentosDelGuion(g.datos, ['2', '4']).filter((x) => x.doc.tipo === 'oferta_economica')) {
    const dependencias = JSON.stringify(seccionesDeAnexo(doc.doc.tipo, doc.lote, d.datos));
    const plan = JSON.stringify({ formato: 'docx', lote: doc.lote, desde: 0, hasta: 0, items: [] });
    db.prepare(
      "UPDATE oferta_documentos SET estado = 'borrador', anexo_en = ?, anexo_dependencias = ?, sustituciones = ? WHERE licitacion_id = ? AND clave = ?",
    ).run(RELLENADO, dependencias, plan, id, doc.clave);
    db.prepare(
      `INSERT OR IGNORE INTO oferta_documentos (licitacion_id, clave, nombre, estado, anexo_en, anexo_dependencias, sustituciones, actualizado_en)
      VALUES (?, ?, ?, 'borrador', ?, ?, ?, ?)`,
    ).run(id, doc.clave, doc.doc.nombre, RELLENADO, dependencias, plan, RELLENADO);
    claves.set(doc.lote!, doc.clave);
  }
  return claves;
}

function sembrarPaquete(id: string): void {
  const g = guionVigente(db, id)!;
  const manifiesto = {
    licitacion: { id, expediente: '17-26', titulo: 'Formación bonificada', organo: 'CASO_E' },
    version: 1,
    generado_en: RELLENADO,
    guion: { id: g.id, version: g.version },
    decisiones_en: RELLENADO,
    plazo: { fecha_limite: null, texto: null, canal: null },
    lotes: ['2', '4'],
    carpetas: [],
    valores: [],
    comprobaciones: [],
  };
  db.prepare(
    'INSERT INTO paquetes_presentacion (licitacion_id, version, ruta, guion_id, decisiones_en, manifiesto, bloqueos, avisos, creado_en) VALUES (?, 1, ?, ?, ?, ?, 0, 0, ?)',
  ).run(id, `Salidas/Licitaciones/${id}/paquete-v1`, g.id, RELLENADO, JSON.stringify(manifiesto), RELLENADO);
}

type Caso = { id: string; anexos: Map<string, string>; datos: Record<string, unknown> };

// CASO_E con otro id (cada test el suyo): guion por lote, decisiones v1 con precio, anexos VI de los
// lotes 2 y 4 rellenados con ellas, memoria v1 ensamblada y paquete v1.
function sembrarCasoE(): Caso {
  const f = leerFixtureComprobaciones('casoE');
  siguiente += 1;
  const id = `p-2057${String(siguiente).padStart(4, '0')}`;
  const guiones = f.guiones.map((g, i) => ({
    ...g,
    id: 9000 + siguiente * 10 + i,
    datos: {
      ...g.datos,
      archivos: (g.datos['archivos'] as Record<string, unknown>[]).map((a) => ({ ...a, ambito: 'por_lote' })),
    },
  }));
  const guionId = guiones.at(-1)!.id;
  const memorias = f.memorias.map((m) => ({ ...m, id: 9000 + siguiente, guion_id: guionId, borrador_id: null }));
  sembrarFixture(db, nucleo().db, {
    ...f,
    id,
    guiones,
    memorias,
    ficha: f.ficha ? { ...f.ficha, id: 9000 + siguiente } : null,
    decisiones: null,
    propuesta: null,
    personas: siguiente === 1 ? f.personas : [],
  });
  const datos = { ...f.decisiones!.datos, equipo: [] };
  guardar(id, conPrecio(datos, 600));
  const anexos = rellenarAnexos(id);
  sembrarPaquete(id);
  return { id, anexos, datos };
}

async function impacto(
  id: string,
  cuerpo: unknown,
): Promise<{ status: number; cuerpo: Impacto & { message?: string } }> {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${id}/oferta/impacto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, cuerpo: (await r.json()) as Impacto & { message?: string } };
}

async function impactoMcp(argumentos: Record<string, unknown>): Promise<Impacto> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_CLAUDE}` } },
    }),
  );
  try {
    const r = await client.callTool({ name: 'licitaciones_impacto', arguments: argumentos });
    const texto = (r.content as { text: string }[])[0]?.text ?? '';
    assert.ok(!r.isError, texto);
    return JSON.parse(texto) as Impacto;
  } finally {
    await client.close();
  }
}

const cambios = () => [db, nucleo().db].map((x) => (x.prepare('SELECT total_changes() AS n').get() as { n: number }).n);
const piezas = (i: Impacto) => i.afectadas.map((a) => [a.pieza, a.nombre, a.accion]);
const PRECIO_LOTE_2 = { decisiones: { precio: { lote: '2' } } };

test('should_not_write_anything_when_computing_the_impact', async () => {
  // Arrange
  const { id } = sembrarCasoE();
  const antes = cambios();

  // Act
  const r = await impacto(id, { cambio: PRECIO_LOTE_2 });

  // Assert
  assert.equal(r.status, 200);
  assert.deepEqual(
    piezas(r.cuerpo),
    [
      ['anexo', 'Anexo VI del lote 2', 'regenerar'],
      ['paquete', 'El paquete', 'regenerar'],
    ],
    'solo el Anexo VI del lote 2 y el paquete',
  );
  assert.ok(r.cuerpo.se_mantiene.includes('la memoria: no puede mencionar el precio'));
  assert.deepEqual(cambios(), antes, 'ni la base de licitaciones ni la del núcleo cambian');
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /600|700/, 'sin importes');
});

test('should_answer_the_same_by_http_and_mcp', async () => {
  // Arrange
  const { id } = sembrarCasoE();

  // Act
  const web = await impacto(id, { cambio: PRECIO_LOTE_2 });
  const agente = await impactoMcp({ id, cambio: PRECIO_LOTE_2 });

  // Assert
  assert.equal(web.status, 200);
  assert.deepEqual(agente, web.cuerpo);
});

test('should_flag_the_lot_2_annex_after_its_price_changed_with_the_time', () => {
  // Arrange: el precio del lote 2 cambia después de rellenar los anexos.
  const { id, anexos, datos } = sembrarCasoE();
  guardar(id, conPrecio(datos, 650));
  const hora = horaLocalEspana(Date.parse(decisionesDe(db, id)!.actualizada_en)).slice(11, 16);

  // Act
  const comprobaciones = comprobacionesDe(db, nucleo().db, id).data!;
  const estado = ofertaParaAgente(db, nucleo().db, { id, secciones: ['estado'] }, true).data!['estado'] as EstadoOferta;

  // Assert
  const desfases = comprobaciones.bloqueos.filter(
    (b) => b.clave.startsWith('desfase:') && b.accion.tipo === 'rehacer_anexo',
  );
  assert.equal(desfases.length, 1, 'el del lote 4 lleva su precio de ahora');
  assert.equal(
    desfases[0]!.titulo,
    `El Anexo VI del lote 2 es anterior al precio del lote 2 de las ${hora}: vuelve a rellenarlo`,
  );
  assert.deepEqual(
    [desfases[0]!.gravedad, desfases[0]!.lote, desfases[0]!.accion.destino],
    ['riesgo', '2', `documentos.${anexos.get('2')}`],
  );
  assert.ok(desfases[0]!.clave.startsWith('desfase:2:'));
  assert.deepEqual(
    estado.desfases.filter((d) => d.accion === 'rehacer_anexo'),
    [{ pieza: 'Anexo VI del lote 2', por: 'el precio del lote 2', accion: 'rehacer_anexo' }],
  );
});

test('should_flag_the_cover_after_the_address_changed', async () => {
  // Arrange: la memoria v1 se montó antes de que la empresa pusiera su domicilio.
  const { id } = sembrarCasoE();
  // La captura es de 2027 y el reloj de la prueba es el real: la memoria se monta antes que el cambio del perfil.
  db.prepare('UPDATE memorias SET ensamblada_en = ? WHERE licitacion_id = ?').run('2026-10-13T10:19:11.104Z', id);
  const { guardarPerfilEmpresa, leerPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
  const perfil = leerPerfilEmpresa(nucleo().db)!.perfil;
  assert.equal(
    guardarPerfilEmpresa(nucleo().db, { ...perfil, domicilio: 'Calle Mayor 1, 38001 Santa Cruz de Tenerife' }).error,
    null,
  );

  // Act
  const comprobaciones = comprobacionesDe(db, nucleo().db, id).data!;
  const estado = ofertaParaAgente(db, nucleo().db, { id, secciones: ['estado'] }, true).data!['estado'] as EstadoOferta;

  // Assert
  const portada = comprobaciones.bloqueos.find((b) => b.clave === 'desfase:-:portada');
  assert.ok(portada);
  assert.match(
    portada.titulo,
    /^La portada de la v1 puede llevar el domicilio, el NIF o el representante anterior \(la empresa cambió a las \d\d:\d\d\): vuelve a montarla sin IA$/,
  );
  assert.equal(portada.gravedad, 'riesgo');
  assert.ok(estado.desfases.some((d) => d.pieza === 'La portada de la v1' && d.por === 'los datos de la empresa'));
});

test('should_preview_an_undo', async () => {
  // Arrange: el último guardado cambió el precio del lote 2.
  const { id, datos } = sembrarCasoE();
  guardar(id, conPrecio(datos, 650));
  const version = decisionesDe(db, id)!.version;
  const antes = cambios();

  // Act
  const r = await impacto(id, { deshacer: true });

  // Assert
  assert.equal(r.status, 200);
  assert.deepEqual(piezas(r.cuerpo), [
    ['anexo', 'Anexo VI del lote 2', 'regenerar'],
    ['paquete', 'El paquete', 'regenerar'],
  ]);
  assert.deepEqual(r.cuerpo.afectadas[0]!.por, ['decision.precio[2]']);
  assert.deepEqual(cambios(), antes, 'la vista previa no deshace');
  assert.equal(decisionesDe(db, id)!.version, version);
  // Y deshacer de verdad deja el anexo al día: vuelve a llevar lo de ahora.
  assert.equal(deshacerDecisiones(db, nucleo().db, id, { version }).error, null);
  assert.deepEqual(
    comprobacionesDe(db, nucleo().db, id).data!.bloqueos.filter((b) => b.accion.tipo === 'rehacer_anexo'),
    [],
  );
});

test('should_reject_an_unknown_change_key_with_the_allowed_ones', async () => {
  // Arrange
  const { id } = sembrarCasoE();

  // Act
  const arriba = await impacto(id, { cambio: { precio: { lote: '2' } } });
  const dentro = await impacto(id, { cambio: { decisiones: { importe: 1 } } });
  const ninguno = await impacto(id, {});

  // Assert
  assert.equal(arriba.status, 400);
  assert.equal(arriba.cuerpo.message, '«precio» no es un cambio conocido: usa decisiones, lotes, empresa o guion.');
  assert.equal(dentro.status, 400);
  assert.equal(
    dentro.cuerpo.message,
    '«importe» no es un cambio conocido de las decisiones: usa precio, equipo, automaticos, herramientas, enfoque o datos_anexo.',
  );
  assert.equal(ninguno.status, 400);
});

// El impacto mira las dependencias guardadas de cada apartado (no adivina por el
// texto) y da el coste y la pérdida de «Actualizar los apartados afectados».
function conDependencias(id: string, lotesDe: (n: number) => string[]): { memoria: number; apartados: number[] } {
  const m = db
    .prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND ensayo = 0 ORDER BY version DESC LIMIT 1')
    .get(id) as { id: number };
  const filas = db
    .prepare("SELECT apartado FROM memoria_apartados WHERE memoria_id = ? AND estado = 'recibido' ORDER BY apartado")
    .all(m.id) as { apartado: number }[];
  for (const f of filas) {
    const dep = {
      'guion.apartado': `h${f.apartado}`,
      'ambito.lotes': lotesDe(f.apartado),
      'decision.equipo': [],
      'decision.herramientas': [],
      'decision.automatico': [],
      'decision.enfoque': 'blanda',
    };
    db.prepare('UPDATE memoria_apartados SET dependencias = ? WHERE memoria_id = ? AND apartado = ?').run(
      JSON.stringify(dep),
      m.id,
      f.apartado,
    );
  }
  return { memoria: m.id, apartados: filas.map((f) => f.apartado) };
}

test('should_redo_only_the_sections_whose_saved_dependencies_name_the_removed_lot', async () => {
  // Arrange: solo los dos primeros apartados dependen del lote 4.
  const { id } = sembrarCasoE();
  const { apartados } = conDependencias(id, (n) => (n <= 2 ? ['2', '4'] : ['2']));
  assert.ok(apartados.length > 2);

  // Act
  const r = await impacto(id, { cambio: { lotes: ['2'] } });

  // Assert
  assert.equal(r.status, 200);
  const rehechos = r.cuerpo.afectadas.filter((a) => a.pieza === 'apartado');
  assert.deepEqual(
    rehechos.map((a) => [a.clave.split('-').at(-1), a.accion]),
    [
      ['1', 'rehacer'],
      ['2', 'rehacer'],
    ],
  );
  assert.deepEqual(
    rehechos.map((a) => a.coste),
    [
      { min: 30, runs: 1 },
      { min: 30, runs: 1 },
    ],
    'cada uno lo de «Actualizar los apartados afectados», no el tiempo de la mejora repartido',
  );
  assert.ok(rehechos.every((a) => a.pierde.length === 0));
  assert.match(r.cuerpo.resumen, /Unos 60 min, 2 runs\./);
});

test('should_mark_a_section_of_an_uploaded_word_for_review_without_charging_a_redo', async () => {
  // Arrange: el servidor no rehace una subida a mano, así que «Qué cambia» no ofrece rehacerla.
  const { id } = sembrarCasoE();
  const { memoria } = conDependencias(id, (n) => (n === 1 ? ['2', '4'] : ['2']));
  db.prepare("UPDATE memorias SET subida = 'memoria-editada.docx' WHERE id = ?").run(memoria);

  // Act
  const r = await impacto(id, { cambio: { lotes: ['2'] } });

  // Assert
  const [apartado] = r.cuerpo.afectadas.filter((a) => a.pieza === 'apartado');
  assert.equal(apartado!.accion, 'revisar');
  assert.deepEqual(apartado!.coste, { min: 0, runs: 0 });
});

// Una copia de la memoria m (con sus apartados y dependencias) como otra versión de un lote.
function copiaDeMemoria(id: string, m: number, v: { version: number; lote: string; presentada?: number }): number {
  const nueva = 90_000 + siguiente * 10 + v.version;
  db.prepare(
    `INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, lote, presentada)
    SELECT ?, licitacion_id, guion_id, ?, estado, pedida_en, ensamblada_en, ?, ? FROM memorias WHERE id = ?`,
  ).run(nueva, v.version, v.lote, v.presentada ?? 0, m);
  db.prepare(
    'INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, dependencias) SELECT ?, apartado, estado, datos, dependencias FROM memoria_apartados WHERE memoria_id = ?',
  ).run(nueva, m);
  return nueva;
}

test('should_compute_the_memory_impact_per_lot_without_the_submitted_lot', async () => {
  // Arrange: la v1 es la memoria del lote 2, la v2 la del lote 4 y la v3, la presentada del lote 2.
  const { id } = sembrarCasoE();
  const { memoria, apartados } = conDependencias(id, () => ['2', '4']);
  db.prepare("UPDATE memorias SET lote = '2' WHERE id = ?").run(memoria);
  copiaDeMemoria(id, memoria, { version: 2, lote: '4' });
  copiaDeMemoria(id, memoria, { version: 3, lote: '2', presentada: 1 });

  // Act
  const r = await impacto(id, { cambio: { lotes: ['2'] } });

  // Assert
  assert.equal(r.status, 200);
  const rehechos = r.cuerpo.afectadas.filter((a) => a.pieza === 'apartado');
  const versiones = [...new Set(rehechos.map((a) => a.clave.split('-')[0]))].sort();
  assert.deepEqual(versiones, ['v2'], 'la del lote 4: el lote 2 ya se presentó y su borrador v1 no se rehace');
  assert.equal(rehechos.length, apartados.length);
  assert.ok(rehechos.filter((a) => a.clave.startsWith('v2-')).every((a) => a.nombre.endsWith('(memoria del lote 4)')));
});

test('should_compute_the_memory_impact_of_each_lot_memory', async () => {
  // Arrange: la v1 es la memoria del lote 2 y la v2, la del lote 4; ninguna presentada.
  const { id } = sembrarCasoE();
  const { memoria, apartados } = conDependencias(id, () => ['2', '4']);
  db.prepare("UPDATE memorias SET lote = '2' WHERE id = ?").run(memoria);
  copiaDeMemoria(id, memoria, { version: 2, lote: '4' });

  // Act
  const r = await impacto(id, { cambio: { lotes: ['2'] } });

  // Assert
  const rehechos = r.cuerpo.afectadas.filter((a) => a.pieza === 'apartado');
  assert.deepEqual([...new Set(rehechos.map((a) => a.clave.split('-')[0]))].sort(), ['v1', 'v2']);
  assert.equal(rehechos.length, apartados.length * 2);
});

test('should_regenerate_the_economic_annexes_when_undoing_the_tax', async () => {
  // Arrange: el último guardado decidió IGIC 7 % después de rellenar los anexos económicos.
  const { id } = sembrarCasoE();
  const anterior = decisionesDe(db, id)!.datos;
  guardar(
    id,
    Decisiones.parse({
      ...anterior,
      datos_anexo: { subcontratacion_servidores: null, orden_lotes: null, impuesto: { tipo: 'IGIC', porcentaje: 7 } },
    }),
  );

  // Act
  const comprobaciones = comprobacionesDe(db, nucleo().db, id).data!;
  const r = await impacto(id, { deshacer: true });

  // Assert
  assert.equal(
    comprobaciones.bloqueos.filter((b) => b.accion.tipo === 'rehacer_anexo' && /al impuesto/.test(b.titulo)).length,
    2,
    'un desfase por anexo económico',
  );
  assert.equal(r.status, 200);
  const anexos = r.cuerpo.afectadas.filter((a) => a.pieza === 'anexo');
  assert.deepEqual(anexos.map((a) => [a.nombre, a.accion]).sort(), [
    ['Anexo VI del lote 2', 'regenerar'],
    ['Anexo VI del lote 4', 'regenerar'],
  ]);
  assert.deepEqual(anexos[0]!.por, ['decision.datos_anexo.impuesto']);
});
