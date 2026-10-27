// Utilidades de texto de la búsqueda: plegado (minúsculas + sin acentos), stopwords
// ES/EN y tokenización.

// Stopwords ES/EN + palabras de pregunta. Filtrarlas evita que una pregunta en
// lenguaje natural ("qué notas tengo sobre X") o un título se llenen de ruido.
const PALABRAS_VACIAS = new Set([
  // español
  'que',
  'cual',
  'cuales',
  'como',
  'cuando',
  'donde',
  'quien',
  'quienes',
  'sobre',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
  'u',
  'e',
  'en',
  'con',
  'para',
  'por',
  'al',
  'a',
  'se',
  'su',
  'sus',
  'mi',
  'mis',
  'tu',
  'tus',
  'me',
  'te',
  'lo',
  'le',
  'les',
  'nos',
  'muy',
  'mas',
  'este',
  'esta',
  'esto',
  'estos',
  'estas',
  'ese',
  'esa',
  'eso',
  'esos',
  'esas',
  'tengo',
  'tienes',
  'tiene',
  'hay',
  'son',
  'es',
  'ser',
  'estar',
  'entre',
  'entiendo',
  'quiero',
  'dame',
  'dime',
  'busca',
  'buscar',
  'mapea',
  'muestra',
  'hablan',
  'habla',
  'trata',
  'tratan',
  'relacionadas',
  'relacionado',
  'nota',
  'notas',
  'tema',
  'temas',
  // inglés
  'the',
  'a',
  'an',
  'of',
  'on',
  'in',
  'to',
  'and',
  'or',
  'what',
  'which',
  'how',
  'about',
  'is',
  'are',
  'do',
  'does',
  'have',
  'has',
  'my',
  'me',
  'i',
  'you',
  'for',
  'with',
  'from',
  'note',
  'notes',
  'topic',
  'topics',
]);

// Minúsculas + sin diacríticos, para que "análisis" ≈ "analisis" y "qué" ≈ "que".
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Parte un texto en términos: pliega, separa por no-palabra, descarta stopwords y
// tokens de 1 carácter. Si el filtrado lo deja vacío cae a los tokens sin filtrar,
// para no perder la intención de una query que es toda stopwords.
export function tokenizar(texto: string): string[] {
  const crudo = normalizarTexto(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  const filtradas = crudo.filter((t) => !PALABRAS_VACIAS.has(t));
  return filtradas.length > 0 ? filtradas : crudo;
}
