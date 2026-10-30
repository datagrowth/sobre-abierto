// Lo que no debe llegar a un texto que se entrega o que lee el redactor (puro).

// Son citas internas del pliego («Bases, pp. 12», «», «PCAP.pdf»), marcas de texto sin terminar y menciones a
// lotes. Lo usan la revisión de la memoria, las decisiones y su propuesta.
const hallar =
  (re: RegExp) =>
  (t: string): string[] =>
    [...t.matchAll(re)].map((m) => m[0].trim());

/** Marcas de texto sin terminar: «[PENDIENTE», «por confirmar», «TBD»… */
export const SIN_TERMINAR = /\[(?:pendiente|completar|todo)\b|por confirmar|\bTBD\b|\bXXX\b/gi;

/** Las marcas de texto sin terminar de un texto. */
export const marcasSinTerminar = (t: string): string[] => hallar(SIN_TERMINAR)(t);

// Citas internas del pliego (nombre de archivo, «§», «pág. N», «pp. N»): en el documento que
// se entrega quedan como caracteres raros. Primero las que van entre paréntesis, enteras;
// luego las sueltas que queden.
const CITA_ENTRE_PARENTESIS = /\([^()]*(?:§|\.(?:docx?|pdf)\b|p(?:[áa]gs?|p)?\.\s*\d)[^()]*\)/gi;
const CITA_SUELTA = /§+\s*\d[\d.,\s–-]*\d|\b[\w-]+\.(?:docx?|pdf)\b|\b(?:p[áa]gs?|pp)\.\s*\d+(?:\s*[-–]\s*\d+)?/gi;

/** Las citas internas del pliego de un texto. */
export function citasInternas(t: string): string[] {
  return [...hallar(CITA_ENTRE_PARENTESIS)(t), ...hallar(CITA_SUELTA)(t.replace(CITA_ENTRE_PARENTESIS, ' '))];
}

/** El texto sin citas internas del pliego: lo que el equipo escribe para Hermes no le enseña a citar. */
export function sinCitasInternas(t: string): string {
  return t
    .replace(CITA_ENTRE_PARENTESIS, '')
    .replace(CITA_SUELTA, '')
    .replace(/[^\S\n]+([.,;:)])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/[,;:]+(?=\s*\.)/g, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

const LOTES = /\blotes?\s+(?:n[º°o.]\s*)?(\d{1,3}(?:\s*(?:,|y|e|-)\s*\d{1,3})*)/gi;
// Tras «lote 3, » un número seguido de una palabra («30 alumnas», «15 horas») es una cifra, no otro lote.
const CIFRA_CON_UNIDAD = /^\s*[a-záéíóúñ]/i;

/**
 * Los lotes que nombra un texto: «lote 2», «lotes 2, 4 y 6», «lote nº 3». Con `validos` (los lotes de
 * la licitación) los números que siguen a una coma o a «y» solo cuentan si son uno de ellos; sin él,
 * si no van seguidos de una palabra (cifras como «lote 3, 30 alumnas»).
 */
export function lotesNombrados(t: string, validos?: string[]): string[] {
  const ids = [...t.matchAll(LOTES)].flatMap((m) => {
    const trozos = m[1]!.split(/\s*(?:,|y|e|-)\s*/);
    const final = m.index! + m[0].length;
    return trozos.filter((x, i) => {
      if (i === 0) return true;
      if (validos) return validos.includes(String(Number(x)));
      return i < trozos.length - 1 || !CIFRA_CON_UNIDAD.test(t.slice(final, final + 3));
    });
  });
  return [...new Set(ids.map((x) => String(Number(x))))];
}
