// Servidor MCP de la plataforma por HTTP, como lo usan Hermes y Claude Code:
// cliente oficial (protocolo actual), cliente de 2025 sin SDK (JSON-RPC a mano),
// tools según permisos, errores de validación como resultado y auditoría.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { NIF_EJEMPLO, NOMBRE_EJEMPLO, VOLUMEN_2025 } from '../fixtures/empresaEjemplo.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(path.join(conocimiento, 'Empresa'), { recursive: true });
fs.mkdirSync(agentes);
fs.writeFileSync(
  path.join(conocimiento, 'Empresa', 'perfil-licitaciones.md'),
  '# Perfil\nConsultora de datos e inteligencia artificial.\n',
);
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.VAULT_PATH = conocimiento;
// Carpeta de una oferta en Salidas, con su paquete en PRESENTACION/vN/Lote N/<n> Sobre X/.
const salidas = path.join(tmp, 'salidas');
const OFERTA = 'Licitaciones/CP-0417-2027 (p-91000880)';
fs.mkdirSync(path.join(salidas, OFERTA, 'PRESENTACION', 'v1', 'Lote 1', '1 Sobre A'), { recursive: true });
fs.writeFileSync(
  path.join(salidas, OFERTA, 'PRESENTACION', 'v1', 'Lote 1', '1 Sobre A', 'declaracion.md'),
  '# Declaración',
);
fs.writeFileSync(path.join(salidas, OFERTA, 'memoria.md'), '# Memoria');
process.env.SALIDAS_DIR = salidas;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { cerrarDbLicitaciones, dbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { licitacion } = await import('../helpers/sinteticas.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { usosRecientes } = await import('../../src/nucleo/agentes/auditoria.js');

iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
anadirHerramientas(herramientasLicitaciones);

let server: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function texto(r: { content: unknown }): string {
  return (r.content as { type: string; text: string }[])[0]?.text ?? '';
}

test('should_refuse_connections_without_a_valid_agent_token', async () => {
  const sin = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(sin.status, 401);
  const mal = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${'x'.repeat(40)}` },
    body: '{}',
  });
  assert.equal(mal.status, 401);
});

test('should_offer_each_agent_only_the_tools_it_may_use', async () => {
  const lici = await conectar(T_LICI);
  const claude = await conectar(T_CLAUDE);
  try {
    const deLici = (await lici.listTools()).tools.map((t) => t.name);
    const deClaude = (await claude.listTools()).tools.map((t) => t.name);
    assert.ok(deLici.includes('licitaciones_cribar'));
    assert.ok(deLici.includes('biblioteca_buscar'));
    assert.ok(!deClaude.includes('licitaciones_cribar'), 'Claude Code no criba');
    assert.ok(deClaude.includes('licitaciones_ver'));
    assert.ok(deClaude.includes('plataforma_estado'));
  } finally {
    await lici.close();
    await claude.close();
  }
});

// PDF mínimo de una línea de texto (ASCII) por página.
function pdfDePaginas(textos: string[]): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${textos.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${textos.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  textos.forEach((t, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('should_return_first_15_pages_and_next_call_when_biblioteca_leer_range_exceeds_limit', async () => {
  const { escanearBiblioteca, compararIndice, indexarHallazgos } =
    await import('../../src/biblioteca/motor/documentos/indexador.js');
  const store = await import('../../src/biblioteca/motor/documentos/almacen.js');
  fs.writeFileSync(
    path.join(conocimiento, 'Empresa', 'pliego-largo.pdf'),
    pdfDePaginas(Array.from({ length: 27 }, (_, i) => `Contenido de la pagina ${i + 1}`)),
  );
  const db = store.abrirIndice(process.env.BIBLIOTECA_INDEX_DIR!);
  try {
    for (const f of compararIndice(await escanearBiblioteca(conocimiento), store.estadosArchivos(db)).changed)
      await indexarHallazgos(db, f);
  } finally {
    db.close();
  }
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({
      name: 'biblioteca_leer',
      arguments: { ruta: 'Empresa/pliego-largo.pdf', pagina_desde: 1, pagina_hasta: 27 },
    });
    assert.equal(r.isError, undefined, texto(r));
    const datos = JSON.parse(texto(r)) as {
      pagina_hasta: number;
      ultima_pagina_completa: number | null;
      siguiente?: { pagina_desde: number; pagina_hasta: number };
    };
    assert.equal(datos.pagina_hasta, 15);
    assert.equal(datos.ultima_pagina_completa, 15, 'sin recorte por caracteres, las 15 están enteras');
    assert.deepEqual(datos.siguiente, { pagina_desde: 16, pagina_hasta: 27 });
  } finally {
    await client.close();
  }
});

test('should_list_salidas_folder_with_salidas_listar', async () => {
  // Arrange
  const client = await conectar(T_LICI);
  try {
    // Act
    const r = await client.callTool({ name: 'salidas_listar', arguments: { carpeta: `${OFERTA}/` } });
    const vacia = await client.callTool({ name: 'salidas_listar', arguments: { carpeta: '' } });
    // Assert
    assert.equal(r.isError, undefined, texto(r));
    const datos = JSON.parse(texto(r)) as {
      carpeta: string;
      documentos: { ruta: string; tamano: number }[];
      hay_mas: boolean;
      recortado?: unknown;
    };
    assert.equal(datos.carpeta, `Salidas/${OFERTA}`);
    assert.deepEqual(
      datos.documentos.map((d) => d.ruta),
      [`Salidas/${OFERTA}/PRESENTACION/v1/Lote 1/1 Sobre A/declaracion.md`, `Salidas/${OFERTA}/memoria.md`],
    );
    assert.equal(datos.hay_mas, false);
    assert.equal(datos.recortado, undefined, '«recortado» es la clave del recorte de la respuesta, no del listado');
    assert.equal(vacia.isError, true, 'la carpeta se valida antes de listar');
  } finally {
    await client.close();
  }
});

test('should_not_list_or_read_valores_a_teclear_via_mcp', async () => {
  // Arrange: el paquete deja los importes en VALORES_A_TECLEAR.md, que Hermes nunca debe leer.
  const valores = path.join(salidas, OFERTA, 'PRESENTACION', 'v1', 'VALORES_A_TECLEAR.md');
  fs.writeFileSync(valores, '# Valores\nLote 1: 12.345,67 €');
  const client = await conectar(T_LICI);
  try {
    // Act
    const lista = await client.callTool({ name: 'salidas_listar', arguments: { carpeta: OFERTA } });
    const leido = await client.callTool({
      name: 'salidas_leer',
      arguments: { ruta: `${OFERTA}/PRESENTACION/v1/VALORES_A_TECLEAR.md` },
    });
    const enMinusculas = await client.callTool({
      name: 'salidas_leer',
      arguments: { ruta: `Salidas/${OFERTA}/PRESENTACION/v1/valores_a_teclear.md` },
    });
    // Assert
    const datos = JSON.parse(texto(lista)) as { documentos: { ruta: string }[]; ocultos?: number };
    assert.ok(
      datos.documentos.every((d) => !/VALORES_A_TECLEAR/i.test(d.ruta)),
      JSON.stringify(datos.documentos),
    );
    assert.equal(datos.ocultos, 1);
    assert.equal(leido.isError, true);
    assert.match(texto(leido), /^Error \(forbidden\): .*importes de la oferta/);
    assert.doesNotMatch(texto(leido), /12\.345/);
    assert.equal(enMinusculas.isError, true);
  } finally {
    await client.close();
    fs.rmSync(valores);
  }
});

test('should_hint_a_subfolder_when_salidas_listing_is_cut', async () => {
  // Arrange: más de 100 documentos con rutas largas, más de 20.000 caracteres de listado.
  const dir = path.join(salidas, OFERTA, 'muchos');
  fs.mkdirSync(dir);
  for (let i = 0; i < 105; i++)
    fs.writeFileSync(
      path.join(dir, `${String(i).padStart(3, '0')} ${'documento con nombre largo '.repeat(3)}.md`),
      'x',
    );
  const client = await conectar(T_LICI);
  try {
    // Act
    const r = await client.callTool({ name: 'salidas_listar', arguments: { carpeta: `${OFERTA}/muchos` } });
    // Assert
    const datos = JSON.parse(texto(r)) as { hay_mas: boolean; recortado?: { campo: string; como_seguir: string } };
    assert.equal(datos.hay_mas, true, 'el listado ya venía cortado en 100');
    assert.equal(datos.recortado?.campo, 'documentos');
    assert.match(datos.recortado?.como_seguir ?? '', /subcarpeta/);
    assert.doesNotMatch(datos.recortado?.como_seguir ?? '', /limite|pagina/);
  } finally {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('should_tell_agent_to_use_salidas_listar_when_reading_a_folder', async () => {
  // Arrange
  const client = await conectar(T_LICI);
  try {
    // Act: como en CASO_D, la carpeta con la barra final.
    const r = await client.callTool({ name: 'salidas_leer', arguments: { ruta: `Salidas/${OFERTA}/` } });
    const doc = await client.callTool({ name: 'salidas_leer', arguments: { ruta: `${OFERTA}/memoria.md` } });
    // Assert
    assert.equal(r.isError, true);
    assert.match(
      texto(r),
      /es una carpeta: usa salidas_listar \(carpeta «Licitaciones\/CP-0417-2027 \(p-91000880\)»\)/,
    );
    assert.doesNotMatch(texto(r), /no es una ruta válida/);
    assert.equal(doc.isError, undefined, texto(doc));
    assert.match(texto(doc), /# Memoria/);
  } finally {
    await client.close();
  }
});

test('should_read_library_path_with_or_without_conocimiento_prefix', async () => {
  const client = await conectar(T_LICI);
  try {
    const sin = await client.callTool({
      name: 'biblioteca_leer',
      arguments: { ruta: 'Empresa/perfil-licitaciones.md' },
    });
    const con = await client.callTool({
      name: 'biblioteca_leer',
      arguments: { ruta: 'Conocimiento/Empresa/perfil-licitaciones.md' },
    });
    assert.equal(con.isError, undefined, texto(con));
    assert.equal(texto(con), texto(sin));
    const busca = await client.callTool({
      name: 'biblioteca_buscar',
      arguments: { consulta: 'consultora de datos', carpeta: 'Conocimiento/Empresa' },
    });
    assert.equal(busca.isError, undefined, texto(busca));
    assert.match(texto(busca), /perfil-licitaciones\.md/);
    const raro = await client.callTool({
      name: 'biblioteca_leer',
      arguments: { ruta: 'ConocimientoX/Empresa/perfil-licitaciones.md' },
    });
    assert.equal(raro.isError, true, 'solo se quita la raíz exacta');
  } finally {
    await client.close();
  }
});

test('should_read_the_library_and_return_validation_errors_as_tool_results', async () => {
  const client = await conectar(T_LICI);
  try {
    const leido = await client.callTool({
      name: 'biblioteca_leer',
      arguments: { ruta: 'Empresa/perfil-licitaciones.md' },
    });
    assert.equal(leido.isError, undefined);
    assert.match(texto(leido), /Consultora de datos/);
    const fuera = await client.callTool({ name: 'biblioteca_leer', arguments: { ruta: '../../etc/passwd' } });
    assert.equal(fuera.isError, true);
    const malo = await client.callTool({
      name: 'licitaciones_cribar',
      arguments: { lote: 1, veredictos: [{ id: 'p-1', veredicto: 'quizás' }] },
    });
    assert.equal(malo.isError, true);
    const sinLote = await client.callTool({
      name: 'licitaciones_cribar',
      arguments: { lote: 77, veredictos: [{ id: 'p-1', veredicto: 'interesa', motivo: 'encaja', confianza: 0.9 }] },
    });
    assert.equal(sinLote.isError, true);
    assert.match(texto(sinLote), /No existe el lote 77/);
  } finally {
    await client.close();
  }
});

test('should_return_each_search_result_text_only_once', async () => {
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({
      name: 'biblioteca_buscar',
      arguments: { consulta: 'consultora de datos e inteligencia artificial' },
    });
    assert.equal(r.isError, undefined, texto(r));
    const crudo = texto(r);
    const d = JSON.parse(crudo) as { resultados: { ruta: string; tipo: string; texto: string }[]; contexto?: string };
    assert.equal(d.contexto, undefined, 'sin un segundo formato con el mismo texto');
    const perfil = d.resultados.find((x) => x.ruta === 'Empresa/perfil-licitaciones.md');
    assert.ok(perfil, crudo);
    assert.match(perfil.texto, /Consultora de datos e inteligencia artificial/);
    assert.equal(
      crudo.split('Consultora de datos e inteligencia artificial').length - 1,
      1,
      'el texto de la nota aparece una sola vez',
    );
  } finally {
    await client.close();
  }
});

test('should_record_who_used_which_tool', () => {
  const usos = usosRecientes(nucleo().db, 20, 'licitaciones');
  assert.ok(
    usos.some(
      (u) =>
        u.herramienta === 'biblioteca_leer' && u.resultado === 'ok' && u.recurso === 'Empresa/perfil-licitaciones.md',
    ),
  );
  assert.ok(usos.some((u) => u.herramienta === 'licitaciones_cribar' && u.resultado === 'error'));
});

test('should_answer_price_and_comparables_questions_by_tender_or_by_segment', async () => {
  const client = await conectar(T_CLAUDE);
  try {
    const sinNada = await client.callTool({ name: 'licitaciones_precios', arguments: { importe: 100000 } });
    assert.equal(sinNada.isError, true);
    assert.match(texto(sinNada), /Indica id/);
    const fuera = await client.callTool({ name: 'licitaciones_precios', arguments: { cpv: '72212100', bajas: [1.5] } });
    assert.equal(fuera.isError, true, 'una baja de más del 95 % no pasa la validación');
    const segmento = await client.callTool({
      name: 'licitaciones_precios',
      arguments: { cpv: '72212100', importe: 100000, tipo: '2', bajas: [0.15] },
    });
    assert.equal(segmento.isError, undefined);
    const p = JSON.parse(texto(segmento)) as { segmento: { n: number; suficiente: boolean }; nota: string };
    assert.equal(p.segmento.suficiente, false);
    assert.match(p.nota, /RGLCAP/);
    const desconocida = await client.callTool({ name: 'licitaciones_comparables', arguments: { id: 'p-0' } });
    assert.equal(desconocida.isError, true);
    const similares = await client.callTool({
      name: 'licitaciones_comparables',
      arguments: { cpv: '72212100', limite: 5 },
    });
    assert.deepEqual(JSON.parse(texto(similares)), []);
  } finally {
    await client.close();
  }
});

test('should_answer_competitor_and_organ_questions_read_only', async () => {
  const client = await conectar(T_CLAUDE);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(
      ['competidores_ranking', 'competidores_ver', 'organismos_ranking', 'organismos_ver'].every((n) =>
        tools.includes(n),
      ),
    );
    const ranking = await client.callTool({
      name: 'competidores_ranking',
      arguments: { meses: 12, orden: 'coincidencias' },
    });
    assert.equal(ranking.isError, undefined);
    assert.match((JSON.parse(texto(ranking)) as { nota: string }).nota, /ganadores/);
    const malOrden = await client.callTool({ name: 'organismos_ranking', arguments: { orden: 'alfabetico' } });
    assert.equal(malOrden.isError, true);
    const desconocido = await client.callTool({ name: 'competidores_ver', arguments: { nif: 'b-1234567.8' } });
    assert.equal(desconocido.isError, true);
    assert.match(texto(desconocido), /B12345678/);
    await client.callTool({ name: 'organismos_ver', arguments: { nif: 'q-2800001-a' } });
    const recursos = nucleo()
      .db.prepare(
        "SELECT herramienta, recurso FROM auditoria_agentes WHERE herramienta IN ('competidores_ver', 'organismos_ver') ORDER BY id",
      )
      .all();
    assert.deepEqual(
      recursos.map((r) => ({ ...(r as object) })),
      [
        { herramienta: 'competidores_ver', recurso: null },
        { herramienta: 'organismos_ver', recurso: 'Q2800001A' },
      ],
      'el NIF de un adjudicatario puede ser un DNI: no va a la auditoría',
    );
  } finally {
    await client.close();
  }
});

test('should_propose_notes_signed_by_the_calling_agent', async () => {
  const client = await conectar(T_CLAUDE);
  try {
    const r = await client.callTool({
      name: 'biblioteca_proponer',
      arguments: { titulo: 'Idea de mejora', contenido: 'Afinar el prefiltro.' },
    });
    assert.equal(r.isError, undefined);
    const nota = fs.readFileSync(path.join(conocimiento, '_Propuestas', 'Idea de mejora.md'), 'utf8');
    assert.match(nota, /origen: claude-code/);
    const uso = usosRecientes(nucleo().db, 50).find((u) => u.herramienta === 'biblioteca_proponer');
    assert.equal(uso?.recurso, null, 'el título de la nota no va a la auditoría');
  } finally {
    await client.close();
  }
});

// Clientes que aún hablan el protocolo de 2025 (p. ej. otros SDK): JSON-RPC sin sesión.
async function rpc(token: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data =
    raw
      .split('\n')
      .find((l) => l.startsWith('data: '))
      ?.slice(6) ?? raw;
  return { status: res.status, json: data ? (JSON.parse(data) as Record<string, unknown>) : null };
}

test('should_let_agents_propose_the_company_profile_without_changing_it', async () => {
  const client = await conectar(T_CLAUDE);
  try {
    const perfil = { nif: 'b-00123455', nombre: NOMBRE_EJEMPLO, volumen_negocio: [VOLUMEN_2025], tamano: 'micro' };
    const r = await client.callTool({
      name: 'plataforma_empresa_proponer',
      arguments: { perfil, motivo: 'Modelo 200 de 2025 y escritura 904' },
    });
    assert.equal(r.isError, undefined);
    const vigente = await client.callTool({ name: 'plataforma_empresa', arguments: {} });
    assert.equal(vigente.isError, true, 'la propuesta no guarda el perfil');
    const { leerPropuestaEmpresa } = await import('../../src/nucleo/empresa.js');
    const p = leerPropuestaEmpresa(nucleo().db);
    assert.equal(p?.perfil.nif, NIF_EJEMPLO, 'normalizado');
    assert.equal(p?.agente, 'claude-code');
    const malo = await client.callTool({
      name: 'plataforma_empresa_proponer',
      arguments: { perfil: { ...perfil, tamano: 'enorme' }, motivo: 'tamaño que no existe' },
    });
    assert.equal(malo.isError, true);
  } finally {
    await client.close();
  }
});

test('should_serve_2025_clients_without_sessions', async () => {
  const init = await rpc(T_LICI, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'viejo', version: '1' } },
  });
  assert.equal(init.status, 200);
  assert.ok((init.json?.['result'] as Record<string, unknown>)?.['serverInfo']);
  const lista = await rpc(T_LICI, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = (lista.json?.['result'] as { tools: { name: string }[] }).tools.map((t) => t.name);
  assert.ok(tools.includes('licitaciones_candidatas'));
});

test('should_reject_unknown_key_estado_naming_estados_limite_and_pagina', async () => {
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({ name: 'licitaciones_oportunidades', arguments: { estado: 'descartada' } });
    assert.equal(r.isError, true);
    assert.match(texto(r), /estados/);
    assert.match(texto(r), /limite/);
    assert.match(texto(r), /pagina/);
  } finally {
    await client.close();
  }
});

test('should_default_to_ten_opportunities_for_agents', async () => {
  const db = dbLicitaciones();
  for (let i = 0; i < 12; i++) {
    const l = licitacion({ titulo: `Oportunidad ${i}`, publicada: '2026-09-20', limite: '2099-01-01T10:00:00' });
    guardarLicitacion(db, l);
    db.prepare(
      'INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?)',
    ).run(l.id, 'nueva', 'CPV 72', '2026-09-20T10:00:00Z', 'x');
  }
  const client = await conectar(T_LICI);
  try {
    const r = await client.callTool({ name: 'licitaciones_oportunidades', arguments: {} });
    assert.equal(r.isError, undefined, texto(r));
    const d = JSON.parse(texto(r)) as { total: number; items: unknown[] };
    assert.equal(d.items.length, 10);
    assert.ok(d.total >= 12);
  } finally {
    await client.close();
  }
});
