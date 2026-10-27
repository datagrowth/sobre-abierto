// Comparación de textos escritos por personas (requisitos de un pliego, perfiles):
// sin acentos ni mayúsculas, y por palabra entera para que «R» no case con «Rust».

/** «Titulación en Informática» → «titulacion en informatica». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ¿Aparece `termino` en `texto` (ambos normalizados) como palabra o frase entera?
 * Los bordes son cualquier cosa que no sea letra o cifra: «c++», «.net» o «power bi» valen.
 */
export function contieneTermino(texto: string, termino: string): boolean {
  if (termino.length < 1) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(termino)}($|[^\\p{L}\\p{N}])`, 'u').test(texto);
}
