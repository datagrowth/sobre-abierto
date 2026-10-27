// Equipo propuesto de una licitación: candidatos por cada requisito de medios personales
// de la ficha aprobada (nada sin ficha aprobada), en la web y por MCP.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'equipo-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(agentes);
const T_LICI = 'l'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { equipoDeLicitacion } = await import('../../src/dominios/licitaciones/equipo.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, 'requisitos.atom'), 'utf8'));

const SERVICIOS = 'p-20435341';
const OBRAS = 'p-20602990';
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fichaConMedios(id: string) {
  return FichaEntrada.parse({
    id,
    resumen: 'Servicio de analítica de datos y cuadros de mando durante dos años.',
    requisitos: [
      {
        tipo: 'medios_personales',
        descripcion: 'Jefe de proyecto con titulación universitaria y 5 años de experiencia',
        excluyente: true,
        valor_exigido: 'PMP',
        cumple: 'dudoso',
        justificacion: 'Depende del equipo.',
        pagina: 18,
      },
      {
        tipo: 'medios_personales',
        descripcion: 'Analista de datos con experiencia en Power BI',
        excluyente: false,
        cumple: 'dudoso',
        justificacion: 'Depende del equipo.',
      },
      {
        tipo: 'solvencia_economica',
        descripcion: 'Volumen anual de negocio',
        excluyente: true,
        cumple: 'si',
        justificacion: 'Lo cumplimos.',
      },
    ],
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Hay que montar el equipo.' },
  });
}

async function aprobar(id: string): Promise<void> {
  // La ficha se aplica al llegar: no hay paso de aprobación.
  assert.equal(
    (await proponerFicha(dbLicitaciones(), fichaConMedios(id), 'licitaciones', { candidatos: async () => null })).error,
    null,
  );
}

test('should_explain_that_the_team_needs_an_approved_sheet', async () => {
  const sin = (await (await fetch(`${base}/api/licitaciones/licitaciones/${OBRAS}/equipo`)).json()) as {
    ficha: string;
    requisitos: unknown[];
    aviso: string;
  };
  assert.equal(sin.ficha, 'sin_ficha');
  assert.deepEqual(sin.requisitos, []);
  assert.match(sin.aviso, /aún no tiene ficha/);
});

test('should_propose_candidates_per_personnel_requirement_of_the_approved_sheet', async () => {
  crearPersona(nucleo().db, {
    nombre: 'Ana Prueba',
    tipo: 'interno',
    rol: 'Jefe de proyecto',
    titulaciones: ['Grado en Matemáticas'],
    certificaciones: ['PMP'],
    anios_experiencia: 9,
  });
  crearPersona(nucleo().db, {
    nombre: 'Bea Prueba',
    tipo: 'externo',
    rol: 'Analista de datos',
    tecnologias: ['Power BI'],
    anios_experiencia: 2,
  });
  await aprobar(SERVICIOS);
  const sinBiblioteca = async () => ({
    data: null,
    error: { code: 'biblioteca_no_disponible', message: 'sin índice' },
  });
  const r = await equipoDeLicitacion(dbLicitaciones(), nucleo().db, SERVICIOS, 5, sinBiblioteca);
  assert.equal(r.error, null);
  assert.equal(r.data?.ficha, 'aprobada');
  assert.equal(r.data?.requisitos.length, 2, 'solo los de medios personales');
  const [jefe, analista] = r.data!.requisitos;
  assert.equal(jefe?.pagina, 18);
  assert.equal(jefe?.excluyente, true);
  assert.deepEqual(jefe?.requisito.certificaciones, ['PMP'], 'el valor exigido también se lee');
  assert.equal(jefe?.internos[0]?.nombre, 'Ana Prueba');
  assert.equal(jefe?.internos[0]?.cumple_minimos, true);
  assert.equal(analista?.externos[0]?.nombre, 'Bea Prueba');
  assert.equal(r.data?.busqueda_semantica, false);
});

test('should_serve_the_team_on_the_web_and_through_mcp_and_validate_input', async () => {
  const web = await fetch(`${base}/api/licitaciones/licitaciones/${SERVICIOS}/equipo?limite=1`);
  const d = (await web.json()) as { requisitos: { internos: unknown[] }[] };
  assert.equal(web.status, 200);
  assert.equal(d.requisitos[0]?.internos.length, 1);
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/${SERVICIOS}/equipo?limite=500`)).status, 400);
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/p-0000/equipo`)).status, 404);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    const t = await client.callTool({ name: 'licitaciones_equipo', arguments: { id: SERVICIOS } });
    assert.equal(t.isError, undefined);
    assert.match((t.content as { text: string }[])[0]?.text ?? '', /Ana Prueba/);
  } finally {
    await client.close();
  }
});
