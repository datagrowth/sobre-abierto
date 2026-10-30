// La forma de un .docx frente a lo que exige el pliego: fuente, tamaño de letra e interlineado del texto normal.
import { strFromU8, unzipSync } from 'fflate';

export type FormaDocx = { fuente: string | null; tamano: number | null; interlineado: number | null };

// Se leen los valores por defecto del documento y el estilo «Normal», que es lo que usa el cuerpo de la memoria
// (docx.ts los pone en los valores por defecto; Word, en el estilo). Un párrafo con otro formato a mano no se
// ve: es una aproximación para avisar, no para bloquear. Puro: bytes de entrada.
// styles.xml real pesa decenas de KB: más de esto es un zip bomba y no se descomprime.
const MAX_STYLES_BYTES = 5 * 1024 * 1024;

function estilosDe(bytes: Uint8Array): string | null {
  try {
    const f = unzipSync(bytes, { filter: (x) => x.name === 'word/styles.xml' && x.originalSize <= MAX_STYLES_BYTES })[
      'word/styles.xml'
    ];
    return f ? strFromU8(f) : null;
  } catch {
    return null;
  }
}

// En medios puntos (w:sz) y en 240avos de línea (w:line con la regla «auto»); exacto o «al menos» no es un interlineado.
function formaDe(xml: string): FormaDocx {
  const fuente = /<w:rFonts\b[^>]*w:ascii="([^"]+)"/.exec(xml)?.[1] ?? null;
  const sz = /<w:sz\b[^>]*w:val="(\d+)"/.exec(xml)?.[1];
  const espaciado = /<w:spacing\b[^>]*>/.exec(xml)?.[0] ?? '';
  const linea = /w:line="(\d+)"/.exec(espaciado)?.[1];
  const regla = /w:lineRule="(\w+)"/.exec(espaciado)?.[1] ?? 'auto';
  return {
    fuente,
    tamano: sz ? Number(sz) / 2 : null,
    interlineado: linea && regla === 'auto' ? Math.round((Number(linea) / 240) * 100) / 100 : null,
  };
}

/** Fuente, tamaño e interlineado del texto normal del .docx; null si no se puede leer. */
export function formaDeDocx(bytes: Uint8Array): FormaDocx | null {
  const xml = estilosDe(bytes);
  if (!xml) return null;
  const defecto = formaDe(/<w:docDefaults>([\s\S]*?)<\/w:docDefaults>/.exec(xml)?.[1] ?? '');
  const normal = formaDe(/<w:style\b[^>]*w:styleId="Normal"[^>]*>([\s\S]*?)<\/w:style>/.exec(xml)?.[1] ?? '');
  return {
    fuente: normal.fuente ?? defecto.fuente,
    tamano: normal.tamano ?? defecto.tamano,
    interlineado: normal.interlineado ?? defecto.interlineado,
  };
}
