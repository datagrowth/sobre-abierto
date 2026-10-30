// Lectura de una página Atom de la PLACSP sin cargar un DOM entero: una página
// del feed de perfiles pesa ~13 MB y 500 entradas. Cada <entry> se parsea aparte.
export type Borrada = { atomId: string; cuando: string; motivo: string | null };

const ENTRY = /<entry>[\s\S]*?<\/entry>/g;
const NEXT = /<link\b[^>]*\brel="next"[^>]*>/;
const HREF = /\bhref="([^"]+)"/;
const DELETED = /<at:deleted-entry\b([^>]*?)(?:\/>|>([\s\S]*?)<\/at:deleted-entry>)/g;

/** El XML de cada <entry> de la página, en el orden del feed (más reciente primero). */
export function entradas(xml: string): string[] {
  return xml.match(ENTRY) ?? [];
}

function desescapar(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** URL de la página anterior (más antigua), si la hay. */
export function enlaceSiguiente(xml: string): string | null {
  const link = xml.match(NEXT)?.[0];
  const href = link?.match(HREF)?.[1];
  return href ? desescapar(href) : null;
}

function atributo(attrs: string, nombre: string): string | null {
  return attrs.match(new RegExp(`\\b${nombre}="([^"]*)"`))?.[1] ?? null;
}

/** Licitaciones retiradas del feed (p. ej. «CERRADA» en las plataformas agregadas). */
export function borradas(xml: string): Borrada[] {
  const out: Borrada[] = [];
  for (const m of xml.matchAll(DELETED)) {
    const attrs = m[1] ?? '';
    const atomId = atributo(attrs, 'ref');
    const cuando = atributo(attrs, 'when');
    const motivo = (m[2] ?? '').match(/<at:comment\b[^>]*\btype="([^"]*)"/)?.[1] ?? null;
    if (atomId && cuando) out.push({ atomId: desescapar(atomId), cuando, motivo });
  }
  return out;
}
