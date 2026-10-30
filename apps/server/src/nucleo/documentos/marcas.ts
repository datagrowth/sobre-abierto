// Markdown restringido en el texto de la memoria: solo **negrita** y *cursiva*. Lo demás
// (#, `código`, [enlaces](…), __, ~~) se queda literal y la revisión lo avisa. Puro.

export type TrozoMarcado = { texto: string; negrita: boolean; cursiva: boolean };

const MARCA = /\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*/g;

/** El texto en trozos con su formato, en orden. */
export function trozosMarcados(t: string): TrozoMarcado[] {
  const out: TrozoMarcado[] = [];
  let i = 0;
  for (const m of t.matchAll(MARCA)) {
    if (m.index > i) out.push({ texto: t.slice(i, m.index), negrita: false, cursiva: false });
    out.push({ texto: m[1] ?? m[2]!, negrita: m[1] !== undefined, cursiva: m[2] !== undefined });
    i = m.index + m[0].length;
  }
  if (i < t.length || !out.length) out.push({ texto: t.slice(i), negrita: false, cursiva: false });
  return out;
}

/** El texto sin las marcas de negrita y cursiva (lo que se lee y lo que ocupa). */
export const sinMarcas = (t: string): string =>
  t.replace(MARCA, (_, a: string | undefined, b: string | undefined) => a ?? b ?? '');

const NO_ADMITIDAS = /(?:^|\n)\s*#{1,6}\s+\S[^\n]{0,40}|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|__[^_\n]+__|~~[^~\n]+~~/g;

/** Marcas de Markdown que el Word no pinta (títulos, código, enlaces, __, ~~). */
export const marcasNoAdmitidas = (t: string): string[] =>
  [...t.matchAll(NO_ADMITIDAS)].map((m) => m[0].trim().slice(0, 60));
