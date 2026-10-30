// Entidades HTML que algunos órganos publican codificadas dos veces (`&amp;nbsp;` en el
// XML, que el parser deja en `&nbsp;`): se decodifican para que no se vean en la web.
const NOMBRADAS: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  euro: '€',
  ordm: 'º',
  ordf: 'ª',
  iexcl: '¡',
  iquest: '¿',
  middot: '·',
  deg: '°',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  Ccedil: 'Ç',
  agrave: 'à',
  egrave: 'è',
  ograve: 'ò',
  Agrave: 'À',
  Egrave: 'È',
  Ograve: 'Ò',
};

function desdeCodigo(n: number): string | null {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
}

/** «Servicios&nbsp;de IA &amp; datos» → «Servicios de IA & datos». Deja igual lo que no reconoce. */
export function decodificarEntidades(texto: string): string {
  if (!texto.includes('&')) return texto;
  const una = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m: string, e: string) => {
      if (e[0] === '#')
        return desdeCodigo(e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) ?? m;
      return NOMBRADAS[e] ?? m;
    });
  // Dos pasadas como mucho: `&amp;nbsp;` → `&nbsp;` → espacio.
  return una(una(texto))
    .replace(/\u00a0/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}
