// Lectura por páginas encadenando «siguiente» como haría Hermes, sobre trozos sintéticos (sin
// índice): lo leído, puesto en orden, es exactamente el texto entero (ni se pierde ni se repite
// nada), ninguna lectura pasa del tope ya escapado y una marca [pág. N] nunca queda partida.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { textoConMarcas, trozoDePaginas, MAX_PAGINAS_LECTURA } =
  await import('../../src/biblioteca/motor/documentos/lector.js');

type Chunk = { page: number | null; text: string };
type Lectura = {
  absDesde: number;
  absHasta: number;
  texto: string;
  siguiente: { pagina_desde: number; pagina_hasta: number; desde_caracter?: number } | null | undefined;
  empieza_en_pagina?: number | undefined;
};

// Lo que hace leerPaginasDocumento, sin índice: las páginas pedidas (como mucho 15) y su trozo.
function leerTodo(chunks: Chunk[], desde: number, hasta: number): { completo: string; lecturas: Lectura[] } {
  const completo = textoConMarcas(chunks);
  const lecturas: Lectura[] = [];
  let rango: Lectura['siguiente'] = { pagina_desde: desde, pagina_hasta: hasta };
  for (let vueltas = 0; rango && vueltas < 200; vueltas++) {
    const fin = Math.min(rango.pagina_hasta, rango.pagina_desde + MAX_PAGINAS_LECTURA - 1);
    const pedidos = chunks.filter((c) => c.page !== null && c.page >= rango!.pagina_desde && c.page <= fin);
    const p = textoConMarcas(pedidos);
    const t = trozoDePaginas(p, {
      desde: rango.pagina_desde,
      fin,
      pedidoHasta: rango.pagina_hasta,
      desdeCaracter: rango.desde_caracter,
    });
    // Dónde empieza ese texto dentro del documento entero: en la marca de su primera página.
    const base = completo.marcas.find((m) => m.pagina === p.marcas[0]?.pagina)?.pos ?? 0;
    lecturas.push({
      absDesde: base + t.inicio,
      absHasta: base + t.hasta,
      texto: p.texto.slice(t.inicio, t.hasta),
      siguiente: t.siguiente,
      empieza_en_pagina: t.empieza_en_pagina,
    });
    rango = t.siguiente;
  }
  assert.equal(rango ?? null, null, 'la cadena termina');
  return { completo: completo.texto, lecturas };
}

// Seguidas, sin solapes ni huecos (salvo el «\n\n» entre páginas al pasar de un bloque de 15 al siguiente).
function assertSinPerdidas(completo: string, lecturas: Lectura[]): void {
  assert.equal(lecturas[0]?.absDesde, 0);
  for (let i = 1; i < lecturas.length; i++) {
    const hueco = completo.slice(lecturas[i - 1]!.absHasta, lecturas[i]!.absDesde);
    assert.ok(
      hueco === '' || hueco === '\n\n',
      `lectura ${i}: entre ${lecturas[i - 1]!.absHasta} y ${lecturas[i]!.absDesde} hay «${hueco.slice(0, 20)}»`,
    );
  }
  assert.equal(lecturas.at(-1)?.absHasta, completo.length);
  for (const l of lecturas) assert.equal(l.texto, completo.slice(l.absDesde, l.absHasta));
}

const paginas = (n: number, texto: (p: number) => string | null): Chunk[] =>
  Array.from({ length: n }, (_, i) => i + 1).flatMap((p) => {
    const t = texto(p);
    return t === null ? [] : [{ page: p, text: t }];
  });
const lineas = (p: number, n: number) =>
  Array.from({ length: n }, (_, j) => `P${p} linea ${j} ${'dato'.repeat(14)}`).join('\n');

test('should_read_a_100k_page_in_the_middle_of_20_without_losing_or_repeating_text', () => {
  const chunks = paginas(20, (p) => lineas(p, p === 10 ? 1500 : 5));
  const { completo, lecturas } = leerTodo(chunks, 1, 20);
  assert.ok(completo.length > 100_000);
  assertSinPerdidas(completo, lecturas);
  assert.ok(
    lecturas.some((l) => l.siguiente?.desde_caracter !== undefined),
    'se siguió dentro de la página enorme',
  );
  assert.ok(
    lecturas.some((l) => l.empieza_en_pagina === 10),
    'la que empieza a mitad de la pág. 10 lo dice',
  );
});

test('should_never_split_a_page_mark_when_cutting_by_characters', () => {
  // La marca de la pág. 6 empieza a 5 caracteres del tope de 40.000.
  const cuerpo5 = 'a'.repeat(40_000 - 5 - '[pág. 5]\n'.length - 2);
  const chunks: Chunk[] = [{ page: 5, text: cuerpo5 }, ...paginas(10, (p) => (p > 5 ? `pagina ${p} texto` : null))];
  const { completo, lecturas } = leerTodo(chunks, 5, 10);
  assertSinPerdidas(completo, lecturas);
  assert.deepEqual(lecturas[0]?.siguiente, { pagina_desde: 6, pagina_hasta: 10 });
  assert.match(lecturas[1]?.texto ?? '', /^\[pág\. 6\]\n/);
  for (const l of lecturas)
    assert.doesNotMatch(l.texto, /\[p(á(g(\.( \d*)?)?)?)?$/, 'ninguna lectura acaba a mitad de una marca');
});

test('should_not_reread_a_huge_page_that_starts_right_after_an_empty_one', () => {
  // Se piden de la 3 (sin texto) a la 6.
  const chunks = paginas(6, (p) => (p <= 3 ? null : p === 4 ? 'y'.repeat(100_000) : `pagina ${p}`));
  const { completo, lecturas } = leerTodo(chunks, 3, 6);
  assertSinPerdidas(completo, lecturas);
  assert.equal(lecturas.length, 3, '100.000 caracteres en tres lecturas, sin repetir la primera');
});

test('should_keep_every_reading_under_the_escaped_limit_with_tab_rich_sheets', () => {
  const hoja = Array.from({ length: 8000 }, (_, j) => `${j}\t\t"x"\t`).join('\n');
  const { completo, lecturas } = leerTodo(
    [
      { page: 1, text: hoja },
      { page: 2, text: 'fin' },
    ],
    1,
    2,
  );
  assertSinPerdidas(completo, lecturas);
  for (const l of lecturas)
    assert.ok(JSON.stringify(l.texto).length <= 50_002, `una lectura ocupa ${JSON.stringify(l.texto).length} escapada`);
});

test('should_not_skip_pages_because_of_a_literal_page_mark_inside_the_text', () => {
  const chunks = paginas(12, (p) =>
    p === 1 ? `índice: ver [pág. 9]\n\n[pág. 9]\n${'z'.repeat(50_000)}` : `pagina ${p}`,
  );
  const { completo, lecturas } = leerTodo(chunks, 1, 12);
  assertSinPerdidas(completo, lecturas);
  assert.equal(lecturas[0]?.siguiente?.pagina_desde, 1, 'sigue en la pág. 1, no en la 9');
});

test('should_not_split_a_surrogate_pair_when_a_page_has_no_line_breaks', () => {
  const { completo, lecturas } = leerTodo([{ page: 1, text: 'x😀'.repeat(30_000) }], 1, 1);
  assertSinPerdidas(completo, lecturas);
  for (const l of lecturas) assert.doesNotMatch(l.texto, /[\uD800-\uDBFF]$/);
});
