// licitaciones_bloqueo_proponer: Hermes propone cómo resolver un bloqueo de las comprobaciones y
// cada cita se comprueba literal contra su documento. Pliego sintético en Markdown con marcas
// [pág. N], como las que deja la extracción de un PDF. La propuesta nunca cambia una decisión.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bloqueo-proponer-'));
const conocimiento = path.join(tmp, 'conocimiento');
const salidas = path.join(tmp, 'salidas');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, salidas]) fs.mkdirSync(d, { recursive: true });
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { BloqueoPropuestaEntrada, comprobarCitas, paginaDe, proponerBloqueo } =
  await import('../../src/dominios/licitaciones/oferta/bloqueoProponer.js');
type Entrada = import('../../src/dominios/licitaciones/oferta/bloqueoProponer.js').BloqueoPropuestaEntrada;
type Agente = import('../../src/nucleo/agentes/registro.js').Agente;

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const raices = { salidas, conocimiento };
const PERSONA = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Formadora' }).data!.id;
const HERMES: Agente = { nombre: 'hermes', permisos: { licitaciones: 'proponer', colaboradores: 'leer' } };
const SIN_COLABORADORES: Agente = { nombre: 'hermes', permisos: { licitaciones: 'proponer' } };

let server: http.Server;
let base = '';

before(() => {
  const app = express();
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

const PAG_1 =
  'El licitador deberá acreditar el Esquema Nacional de Seguridad en categoría básica mediante certificado vigente.';
const PAG_2 =
  'Se valorará con 10 puntos la entrega de la documentación del curso en formato accesible para todo el alumnado.';
const PLIEGO = `[pág. 1]\n${PAG_1}\n\n[pág. 2]\n${PAG_2}\n`;
let siguiente = 0;

// Una licitación con su PCAP descargado en Conocimiento: sin ficha ni guion, las comprobaciones tienen filas abiertas.
function sembrar(): string {
  siguiente += 1;
  const id = `p-3100${siguiente}`;
  const ruta = `Licitaciones/Radar/2026/${id}/PCAP.md`;
  fs.mkdirSync(path.join(conocimiento, path.dirname(ruta)), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, ruta), PLIEGO);
  const l = licitacion({
    titulo: 'Formación en ciberseguridad',
    publicada: '2026-09-24',
    limite: '2099-10-15T08:00:00',
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?)",
  ).run(id, ts, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'pcap', 'PCAP.md', 'descargado', ?, ?)",
  ).run(id, `https://contrataciondelestado.es/doc/${id}`, ruta, ts);
  return id;
}

const primerAbierto = (id: string) =>
  comprobacionesDe(db, nucleo().db, id).data!.bloqueos.find((b) => b.estado === 'abierto')!;

const entrada = (id: string, clave: string, cambios: Partial<Entrada> = {}): Entrada =>
  BloqueoPropuestaEntrada.parse({
    id,
    clave,
    tipo: 'consulta_organo',
    resumen: 'Preguntar al órgano si basta la categoría básica del ENS.',
    citas: [
      { documento: 'PCAP.md', pagina: 1, texto: 'acreditar el Esquema Nacional de Seguridad en categoría básica' },
    ],
    datos: { tipo: 'consulta_organo', texto: '¿Basta con el certificado ENS de categoría básica para el lote 2?' },
    ...cambios,
  });

const filas = (id: string) =>
  db
    .prepare(
      'SELECT clave, huella, estado, propuesta_json, evidencia_json, quien FROM oferta_bloqueos WHERE licitacion_id = ?',
    )
    .all(id) as {
    clave: string;
    huella: string;
    estado: string;
    propuesta_json: string;
    evidencia_json: string;
    quien: string;
  }[];

test('should_reject_an_invented_quote_naming_the_phrase_not_found', async () => {
  // Arrange
  const id = sembrar();
  const inventada = 'El órgano admite cualquier certificado de seguridad equivalente al ENS';

  // Act
  const r = await proponerBloqueo(
    db,
    raices,
    entrada(id, primerAbierto(id).clave, { citas: [{ documento: 'PCAP.md', pagina: 1, texto: inventada }] }),
    HERMES,
  );

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(
    r.error?.message,
    `La cita «${inventada.slice(0, 40)}…» no está en «PCAP.md» (pág. 1): copia la frase literal.`,
  );
  assert.deepEqual(filas(id), [], 'no se guarda nada');
});

test('should_accept_a_literal_quote_from_the_tender_page', async () => {
  // Arrange
  const id = sembrar();
  const ruta = `Conocimiento/Licitaciones/Radar/2026/${id}/PCAP.md`;
  const citas = [
    { documento: 'PCAP.md', pagina: 2, texto: 'Se valorará con 10 puntos la entrega de la documentación del curso' },
    { documento: ruta, pagina: null, texto: 'deberá ACREDITAR el Esquema Nacional de Seguridad, en categoría básica' },
  ];

  // Act
  const problemas = await comprobarCitas(db, raices, id, citas);

  // Assert
  assert.deepEqual(problemas, [], 'por nombre o por ruta, con mayúsculas y puntuación distintas');
});

test('should_reject_a_quote_on_the_wrong_page', async () => {
  // Arrange
  const id = sembrar();
  const cita = {
    documento: 'PCAP.md',
    pagina: 2,
    texto: 'acreditar el Esquema Nacional de Seguridad en categoría básica',
  };

  // Act
  const problemas = await comprobarCitas(db, raices, id, [cita, { ...cita, pagina: 9 }]);

  // Assert
  assert.deepEqual(problemas, [
    'La cita «acreditar el Esquema Nacional de Segurid…» no está en «PCAP.md» (pág. 2): copia la frase literal.',
    '«PCAP.md» no tiene página 9.',
  ]);
  assert.equal(paginaDe(PLIEGO, 1)?.trim(), PAG_1, 'la página 1 acaba donde empieza la 2');
});

test('should_reject_an_unknown_or_closed_blocker_key', async () => {
  // Arrange
  const id = sembrar();
  const b = primerAbierto(id);
  db.prepare(
    "INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, quien, motivo, en) VALUES (?, ?, ?, 'riesgo_aceptado', 'web', 'Lo asumimos.', ?)",
  ).run(id, b.clave, b.huella, new Date().toISOString());

  // Act
  const desconocida = await proponerBloqueo(db, raices, entrada(id, 'no_existe:1'), HERMES);
  const cerrada = await proponerBloqueo(db, raices, entrada(id, b.clave), HERMES);

  // Assert
  assert.equal(desconocida.error?.code, 'not_found');
  assert.equal(cerrada.error?.code, 'conflicto');
  assert.match(cerrada.error!.message, /ya está cerrado/);
  assert.equal(filas(id).length, 1, 'solo la fila de la persona');
});

test('should_store_the_proposal_with_the_blocker_fingerprint_and_never_apply_it', async () => {
  // Arrange
  const id = sembrar();
  const b = primerAbierto(id);
  const decisionesAntes = db.prepare('SELECT COUNT(*) AS n FROM decisiones_oferta WHERE licitacion_id = ?').get(id);
  const e = entrada(id, b.clave);

  // Act
  const r = await proponerBloqueo(db, raices, e, HERMES);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data, { clave: b.clave, estado: 'propuesta' });
  const [f] = filas(id);
  assert.equal(f?.huella, b.huella);
  assert.equal(f?.estado, 'propuesta');
  assert.equal(f?.quien, 'hermes');
  assert.deepEqual(JSON.parse(f!.propuesta_json), {
    tipo: 'consulta_organo',
    resumen: e.resumen,
    datos: e.datos,
    campos: 1,
  });
  assert.deepEqual(JSON.parse(f!.evidencia_json), e.citas);
  const fila = comprobacionesDe(db, nucleo().db, id).data!.bloqueos.find((x) => x.clave === b.clave)!;
  assert.equal(fila.estado, 'propuesta', 'sale en la fila como propuesta de Hermes');
  assert.equal(fila.propuesta?.resumen, e.resumen);
  // La fila lleva qué propone (tipo y datos) y su evidencia, para que una persona lo aplique.
  assert.equal(fila.propuesta?.tipo, 'consulta_organo');
  assert.deepEqual(fila.propuesta?.datos, e.datos);
  assert.deepEqual(
    fila.propuesta?.citas,
    e.citas.map((c) => ({ ...c, comprobada: true })),
  );
  assert.deepEqual(
    db.prepare('SELECT COUNT(*) AS n FROM decisiones_oferta WHERE licitacion_id = ?').get(id),
    decisionesAntes,
    'ninguna decisión cambia',
  );
});

test('should_reject_assigning_a_person_without_colaboradores_permission', async () => {
  // Arrange
  const id = sembrar();
  const e = entrada(id, primerAbierto(id).clave, {
    tipo: 'asignar_persona',
    datos: {
      tipo: 'asignar_persona',
      persona_id: PERSONA,
      rol: 'Docente principal',
      cv_ruta: 'Conocimiento/Colaboradores/persona-a/cv.pdf',
      cv_pagina: 2,
    },
  });

  // Act
  const sin = await proponerBloqueo(db, raices, e, SIN_COLABORADORES);
  const con = await proponerBloqueo(db, raices, e, HERMES);

  // Assert
  assert.equal(sin.error?.code, 'forbidden');
  assert.equal(con.error, null, con.error?.message);
});

test('should_reject_a_document_outside_tender_library_or_outputs', async () => {
  // Arrange
  const id = sembrar();
  fs.writeFileSync(path.join(salidas, 'borrador.md'), PLIEGO);
  const cita = { pagina: null, texto: 'acreditar el Esquema Nacional de Seguridad en categoría básica' };

  // Act
  const problemas = await comprobarCitas(db, raices, id, [
    { ...cita, documento: 'C:/Windows/system.ini' },
    { ...cita, documento: 'Otro pliego.pdf' },
    { ...cita, documento: 'Salidas/borrador.md' },
  ]);

  // Assert
  assert.equal(problemas.length, 2, 'el de Salidas sí vale');
  assert.ok(
    problemas.every((p) => p.startsWith('No conozco ese documento')),
    problemas.join('\n'),
  );
});

test('should_reject_a_proposal_whose_type_is_a_person_decision', () => {
  // Act
  const precio = BloqueoPropuestaEntrada.safeParse({ ...entrada('p-1', 'precio:2'), tipo: 'fijar_precio' });
  const distinto = BloqueoPropuestaEntrada.safeParse({ ...entrada('p-1', 'precio:2'), tipo: 'borrador_anexo_xiv' });

  // Assert
  assert.equal(precio.success, false, 'el precio lo fija una persona');
  assert.equal(distinto.success, false, 'tipo y datos.tipo tienen que coincidir');
});

test('should_offer_the_tool_only_to_proposing_agents_and_answer_an_invented_quote_with_the_phrase', async () => {
  // Arrange
  const id = sembrar();
  const conectar = async (token: string) => {
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return c;
  };
  const [lici, claude] = [await conectar(T_LICI), await conectar(T_CLAUDE)];
  const inventada = 'El órgano admite cualquier certificado de seguridad equivalente al ENS';
  try {
    // Act
    const herramienta = (await lici.listTools()).tools.find((t) => t.name === 'licitaciones_bloqueo_proponer');
    const deClaude = (await claude.listTools()).tools.map((t) => t.name);
    const r = await lici.callTool({
      name: 'licitaciones_bloqueo_proponer',
      arguments: {
        ...entrada(id, primerAbierto(id).clave),
        citas: [{ documento: 'PCAP.md', pagina: 1, texto: inventada }],
      },
    });

    // Assert
    assert.match(herramienta?.description ?? '', /nunca se aplica: lo aplica una persona/);
    assert.ok(!deClaude.includes('licitaciones_bloqueo_proponer'), 'quien solo lee no propone');
    assert.equal(r.isError, true);
    const texto = (r.content as { text: string }[])[0]!.text;
    assert.ok(
      texto.includes(`La cita «${inventada.slice(0, 40)}…» no está en «PCAP.md» (pág. 1): copia la frase literal.`),
      texto,
    );
  } finally {
    await lici.close();
    await claude.close();
  }
});
