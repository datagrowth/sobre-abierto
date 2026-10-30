// Respuestas de las tools MCP: recortadas a 20.000 caracteres salvo las que el agente
// necesita enteras (lotes de criba), que van en JSON compacto con su propio límite. Lo
// recortado sigue siendo JSON válido y dice cómo seguir; un fallo lleva una referencia.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'herramienta-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.NODE_ENV = 'test';

const {
  aTexto,
  serializar,
  registrarHerramienta,
  avisoDeLentitud,
  TOOL_LENTA_MS,
  RESPUESTA_DETALLE,
  RESPUESTA_LECTURA,
  RESPUESTA_LOTE,
} = await import('../../src/nucleo/mcp/herramienta.js');
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');

iniciarNucleo();
after(() => {
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Recortado = { campo: string; devueltos: number; total: number; como_seguir: unknown; cadenas?: string[] };
const lote = { lote: 2, candidatas: Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}`, titulo: 'x'.repeat(800) })) };

test('should_return_parseable_json_with_recortado_when_list_exceeds_max', () => {
  const { text, recortada } = serializar(lote, 20_000, false);
  const r = JSON.parse(text) as { lote: number; candidatas: unknown[]; recortado: Recortado };
  assert.equal(recortada, true);
  assert.ok(text.length <= 20_000, `${text.length}`);
  assert.equal(r.lote, 2, 'el resto del objeto, entero');
  assert.ok(r.recortado.devueltos < 40 && r.recortado.devueltos > 0);
  assert.equal(r.candidatas.length, r.recortado.devueltos);
  assert.deepEqual([r.recortado.campo, r.recortado.total], ['candidatas', 40]);
  assert.match(String(r.recortado.como_seguir), /limite/);
});

test('should_keep_the_most_items_that_fit', () => {
  const { text } = serializar(lote, 20_000, true);
  const r = JSON.parse(text) as { recortado: Recortado };
  const k = r.recortado.devueltos;
  const masUno = {
    ...lote,
    candidatas: lote.candidatas.slice(0, k + 1),
    recortado: { ...r.recortado, devueltos: k + 1 },
  };
  assert.ok(JSON.stringify(masUno).length > 20_000, 'uno más ya no cabría');
});

test('should_use_tool_specific_next_call_hint', () => {
  const pista = (info: { devueltos: number }) => ({ herramienta: 'licitaciones_cribar', desde: info.devueltos });
  const { text } = serializar(lote, 20_000, true, pista);
  const r = (JSON.parse(text) as { recortado: Recortado }).recortado;
  assert.deepEqual(r.como_seguir, { herramienta: 'licitaciones_cribar', desde: r.devueltos });
});

test('should_cut_a_second_level_list', () => {
  const detalle = {
    id: 'p-1',
    go_no_go: { requisitos: Array.from({ length: 50 }, (_, i) => ({ descripcion: 'x'.repeat(600), i })) },
    antecedentes: { nivel: 'medio' },
  };
  const r = JSON.parse(aTexto(detalle)) as typeof detalle & { recortado: Recortado };
  assert.equal(r.recortado.campo, 'go_no_go.requisitos');
  assert.equal(r.go_no_go.requisitos.length, r.recortado.devueltos);
  assert.equal(r.antecedentes.nivel, 'medio');
});

test('should_truncate_longest_strings_when_there_is_no_list', () => {
  const ficha = { id: 'p-1', resumen: 'corto', objeto: 'a'.repeat(30_000), notas: 'b'.repeat(5_000) };
  const { text, recortada } = serializar(ficha, 20_000, true);
  const r = JSON.parse(text) as typeof ficha & { recortado: Recortado };
  assert.equal(recortada, true);
  assert.ok(text.length <= 20_000, `${text.length}`);
  assert.equal(r.recortado.campo, 'objeto');
  assert.ok(r.objeto.endsWith('…[recortado]'));
  assert.deepEqual([r.notas.length, r.resumen, r.id], [5_000, 'corto', 'p-1']);
});

test('should_truncate_strings_when_not_even_one_item_fits', () => {
  const enorme = {
    resultados: [
      { id: 'r-1', texto: 'z'.repeat(50_000) },
      { id: 'r-2', texto: 'y' },
    ],
  };
  const { text } = serializar(enorme, 20_000, true);
  const r = JSON.parse(text) as { resultados: { texto: string }[]; recortado: Recortado };
  assert.ok(text.length <= 20_000, `${text.length}`);
  assert.equal(r.recortado.campo, 'resultados');
  assert.equal(r.recortado.total, 2);
});

test('should_keep_a_single_huge_item_and_cut_its_text', () => {
  // Arrange: el único pliego no cabe; antes la lista se quedaba vacía y se perdía todo.
  const pliegos = { pliegos: [{ nombre: 'PCAP', texto: 'y'.repeat(30_000) }] };
  // Act
  const { text } = serializar(pliegos, 20_000, false);
  // Assert
  const r = JSON.parse(text) as { pliegos: { nombre: string; texto: string }[]; recortado: Recortado };
  assert.ok(text.length <= 20_000 && text.length > 19_000, `${text.length}`);
  assert.equal(r.pliegos.length, 1);
  assert.equal(r.pliegos[0]!.nombre, 'PCAP');
  assert.ok(r.pliegos[0]!.texto.endsWith('…[recortado]'));
  assert.equal(r.recortado.campo, 'pliegos.0.texto', 'lo recortado es el texto, no la lista');
});

test('should_cut_the_long_text_and_keep_a_small_list_beside_it', () => {
  // Arrange
  const ficha = { id: 'p-1', texto: 'x'.repeat(30_000), avisos: ['falta el PPT'] };
  // Act
  const { text } = serializar(ficha, 20_000, false);
  // Assert
  const r = JSON.parse(text) as typeof ficha & { recortado: Recortado };
  assert.ok(text.length <= 20_000, `${text.length}`);
  assert.deepEqual(r.avisos, ['falta el PPT']);
  assert.equal(r.recortado.campo, 'texto');
  assert.ok(r.texto.length > 19_000);
});

test('should_wrap_a_top_level_list_to_keep_valid_json', () => {
  const { text } = serializar(lote.candidatas, 20_000, true);
  const r = JSON.parse(text) as { elementos: unknown[]; recortado: Recortado };
  assert.equal(r.elementos.length, r.recortado.devueltos);
});

test('should_cut_plain_text_at_line_break_with_next_offset', () => {
  const texto = 'línea del pliego\n'.repeat(2_000);
  const { text, recortada } = serializar(texto, 20_000, true);
  const m = /\n…\[recortado: (\d+) de (\d+) caracteres; sigue con desde=(\d+)\]$/.exec(text);
  assert.equal(recortada, true);
  assert.ok(m, text.slice(-120));
  assert.equal(Number(m[2]), texto.length);
  assert.equal(m[1], m[3]);
  assert.ok(text.length <= 20_000);
  assert.ok(texto.slice(0, Number(m[1])).endsWith('\n'), 'corta en un salto de línea');
});

test('should_keep_whole_answers_under_their_limit', () => {
  assert.deepEqual(serializar({ a: 1 }, 20_000, true), { text: '{"a":1}', recortada: false });
});

test('should_return_a_whole_criba_batch_as_compact_json', () => {
  const t = aTexto(lote, RESPUESTA_LOTE, true);
  assert.doesNotMatch(t, /recortado/);
  assert.equal((JSON.parse(t) as typeof lote).candidatas.length, 40);
  assert.ok(!t.includes('\n'), 'sin sangría');
});

// Una lectura por partes de 20.000 caracteres con saltos de línea: con el recorte genérico
// se perdía el final de cada parte (el sobre JSON y los \n escapados pasan de 20.000).
const parte = {
  ruta: 'Licitaciones/Radar/2026/x/PCAP.pdf',
  titulo: 'PCAP',
  tipo: 'document',
  estado: 'ok',
  paginas: 147,
  total: 269_077,
  desde: 0,
  hasta: 20_000,
  texto: 'línea del pliego\n'.repeat(1_176),
};

test('should_lose_the_end_of_a_reading_part_with_the_generic_limit', () => {
  assert.match(aTexto(parte), /recortado/);
});

test('should_return_a_whole_reading_part_with_the_reading_limit', () => {
  const t = aTexto(parte, RESPUESTA_LECTURA, true);
  assert.doesNotMatch(t, /recortado/);
  assert.equal((JSON.parse(t) as typeof parte).texto, parte.texto);
});

test('should_return_a_big_tender_detail_whole_with_the_detail_limit', () => {
  const detalle = {
    id: 'p-1',
    go_no_go: { requisitos: Array.from({ length: 50 }, (_, i) => ({ descripcion: 'x'.repeat(600), i })) },
    antecedentes: { nivel: 'medio' },
  };
  assert.match(aTexto(detalle), /recortado/);
  assert.equal((JSON.parse(aTexto(detalle, RESPUESTA_DETALLE, true)) as typeof detalle).antecedentes.nivel, 'medio');
});

type Respuesta = { content: { text: string }[]; isError?: boolean };
type Callback = (raw: unknown) => Promise<Respuesta>;
type Servidor = Parameters<typeof registrarHerramienta>[0];

// Un McpServer falso que solo guarda el callback registrado: la frontera es el SDK.
function servidorFalso(): { server: Servidor; llamar: (raw: unknown) => Promise<Respuesta> } {
  let cb: Callback | null = null;
  const server = {
    registerTool: (_n: string, _c: unknown, f: Callback) => {
      cb = f;
    },
  } as unknown as Servidor;
  return { server, llamar: (raw) => cb!(raw) };
}

// El logger no escribe con NODE_ENV=test: se activa solo aquí y se captura stderr.
async function conLog<T>(fn: () => Promise<T>): Promise<{ r: T; log: string }> {
  const original = process.stderr.write.bind(process.stderr);
  const lineas: string[] = [];
  process.env.NODE_ENV = 'development';
  process.stderr.write = ((l: string) => {
    lineas.push(String(l));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { r: await fn(), log: lineas.join('') };
  } finally {
    process.stderr.write = original;
    process.env.NODE_ENV = 'test';
  }
}

const agente = { nombre: 'licitaciones', permisos: { licitaciones: 'leer' as const } };

test('should_include_correlation_ref_in_internal_error', async () => {
  const { server, llamar } = servidorFalso();
  registrarHerramienta(server, agente, {
    nombre: 'tool_que_falla',
    dominio: 'licitaciones',
    accion: 'leer',
    descripcion: 'x',
    entrada: z.object({}),
    ejecutar: () => Promise.reject(new Error('boom')),
  });
  const { r, log } = await conLog(() => llamar({}));
  const texto = r.content[0]!.text;
  const ref = /\(ref\. ([0-9a-f]{8})\)/.exec(texto)?.[1];
  assert.equal(r.isError, true);
  assert.match(texto, /^Error \(internal_error\): Error interno .*avisa a una persona con esta referencia/);
  assert.ok(ref, texto);
  assert.match(log, new RegExp(`"ref":"${ref}"`));
  assert.match(log, /"error":"boom"/);
});

test('should_pass_tool_args_to_the_next_call_hint_when_registered', async () => {
  const { server, llamar } = servidorFalso();
  registrarHerramienta(server, agente, {
    nombre: 'tool_larga',
    dominio: 'licitaciones',
    accion: 'leer',
    descripcion: 'x',
    entrada: z.object({ pagina: z.number() }),
    comoSeguir: (args, info) => ({ pagina: args.pagina + 1, ya_vistos: info.devueltos }),
    ejecutar: async () => ({ data: lote, error: null }),
  });
  const r = await llamar({ pagina: 1 });
  const rec = (JSON.parse(r.content[0]!.text) as { recortado: Recortado }).recortado;
  assert.deepEqual(rec.como_seguir, { pagina: 2, ya_vistos: rec.devueltos });
});

test('should_warn_only_when_a_tool_takes_longer_than_the_threshold', () => {
  assert.equal(avisoDeLentitud(TOOL_LENTA_MS, 'ok', 100), null);
  assert.deepEqual(avisoDeLentitud(TOOL_LENTA_MS + 1, 'ok', 100), {
    ms: TOOL_LENTA_MS + 1,
    resultado: 'ok',
    caracteres: 100,
  });
});

test('should_not_report_characters_for_a_slow_tool_that_failed', () => {
  assert.deepEqual(avisoDeLentitud(TOOL_LENTA_MS + 5, 'error'), { ms: TOOL_LENTA_MS + 5, resultado: 'error' });
});
