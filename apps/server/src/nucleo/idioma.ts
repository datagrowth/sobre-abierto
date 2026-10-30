// Idioma en que está escrito un título: catalán (o valenciano), euskera, gallego o español.

// La PLACSP no lo dice (las plataformas autonómicas no publican el idioma y el resto pone siempre «es»), así
// que se deduce de palabras propias de cada lengua. Pensado para avisar y filtrar, no para traducir: ante la
// duda, devuelve null.
export const IDIOMAS = {
  es: 'español',
  en: 'inglés',
  ca: 'catalán o valenciano',
  eu: 'euskera',
  gl: 'gallego',
  fr: 'francés',
  de: 'alemán',
  pt: 'portugués',
  it: 'italiano',
} as const;
export type CodigoIdioma = keyof typeof IDIOMAS;
// Lenguas cooficiales que se detectan en los títulos.
export const IDIOMAS_DETECTABLES = ['ca', 'eu', 'gl'] as const;
type Detectable = (typeof IDIOMAS_DETECTABLES)[number] | 'es';

// Palabras que solo (o casi solo) aparecen en esa lengua dentro de un título de contrato.
const PALABRAS: Record<Detectable, Set<string>> = {
  ca: new Set([
    'els',
    'les',
    'per',
    'amb',
    'dels',
    'pel',
    'pels',
    'servei',
    'serveis',
    'subministrament',
    'manteniment',
    'ajuntament',
    'generalitat',
    'aquest',
    'aquesta',
    'mitjançant',
    'desenvolupament',
    'programari',
    'dades',
    'projecte',
    'gestió',
    'tècnic',
    'tècnica',
    'assistència',
    'implantació',
    'contractació',
    'execució',
    'obres',
    'renovació',
    'producció',
    'carrers',
    'municipals',
    'públics',
    'públiques',
    'neteja',
    'enllumenat',
    'instal·lació',
    'instal·lacions',
    'informàtic',
    'informàtics',
    'equipaments',
    'redacció',
  ]),
  eu: new Set([
    'eta',
    'zerbitzua',
    'zerbitzuak',
    'zerbitzuko',
    'kontratua',
    'kontratazioa',
    'udala',
    'udalaren',
    'udalerriko',
    'hornidura',
    'kudeaketa',
    'mantentze',
    'lanak',
    'obrak',
    'obren',
    'egiteko',
    'emateko',
    'eraikitzeko',
    'bidez',
    'batzordea',
    'eusko',
    'jaurlaritza',
    'aldundia',
    'berri',
    'bat',
    'zuzendaritza',
    'garbiketa',
    'hiriko',
    'eskola',
    'ikastetxe',
    'eraikina',
  ]),
  gl: new Set([
    'servizo',
    'servizos',
    'mantemento',
    'concello',
    'xunta',
    'subministración',
    'desenvolvemento',
    'xestión',
    'mellora',
    'limpeza',
    'posibilidade',
    'instalacións',
    'edificacións',
    'saúde',
    'das',
    'nas',
    'ao',
    'aos',
    'unha',
    'municipais',
    'deputación',
    'actuacións',
    'rúa',
    'rúas',
    'praza',
    'veciñal',
  ]),
  es: new Set([
    'y',
    'el',
    'los',
    'las',
    'servicio',
    'servicios',
    'suministro',
    'mantenimiento',
    'ayuntamiento',
    'para',
    'con',
    'por',
    'del',
    'obras',
    'gestión',
    'desarrollo',
    'limpieza',
    'mejora',
    'municipales',
    'instalaciones',
    'contrato',
    'asistencia',
    'implantación',
    'calles',
    'suministros',
    'varias',
    'varios',
    'diversas',
    'diversos',
    'calle',
    'plaza',
    'adquisición',
    'reforma',
  ]),
};
// Conjunciones de una letra: solo en minúscula («Fase I» no es catalán).
const DE_UNA_LETRA: Record<string, Detectable> = { i: 'ca', e: 'gl' };
// Sufijos muy del euskera en palabras largas («Urnietako», «lurzoruaren»).
const SUFIJO_EUSKERA = /(tzeko|etako|tako|aren|tzea|ekin)$/;
// Apóstrofo catalán: «l'objecte», «d'acord».
const ELISION_CATALANA = /(^|[\s(«"])[ldsn]['’][a-zàèéíïòóúüç]/gi;

function puntuar(texto: string): Record<Detectable, number> {
  const puntos: Record<Detectable, number> = { ca: 0, eu: 0, gl: 0, es: 0 };
  puntos.ca += (texto.match(ELISION_CATALANA) ?? []).length;
  const palabras = texto.split(/[^\p{L}·]+/u).filter(Boolean);
  palabras.forEach((original, i) => {
    const palabra = original.toLowerCase();
    if (original.length === 1) {
      // En español también se escribe «e» ante «i» o «hi» («cubiertas e impermeabilización»).
      const ante = (palabras[i + 1] ?? '').toLowerCase();
      const idioma = original === 'e' && /^h?i/.test(ante) ? undefined : DE_UNA_LETRA[original];
      if (idioma) puntos[idioma] += 1;
      return;
    }
    for (const idioma of Object.keys(PALABRAS) as Detectable[]) if (PALABRAS[idioma].has(palabra)) puntos[idioma] += 1;
    if (palabra.length >= 7 && SUFIJO_EUSKERA.test(palabra)) puntos.eu += 1;
  });
  return puntos;
}

/**
 * «Servei de neteja…» → «ca»; «Servizo de limpeza…» → «gl»; «Urnietako … zerbitzua» → «eu»;
 * «Servicio de limpieza…» → «es». Un título en español que cita un nombre en otra lengua
 * sigue siendo «es». Sin señales claras, null.
 */
export function idiomaDelTexto(texto: string | null | undefined): Detectable | null {
  if (!texto) return null;
  const puntos = puntuar(texto);
  const [mejor, valor] = (['ca', 'eu', 'gl'] as const)
    .map((i) => [i, puntos[i]] as const)
    .sort((a, b) => b[1] - a[1])[0]!;
  if ((valor >= 2 && valor > puntos.es) || (valor >= 1 && puntos.es === 0)) return mejor;
  return puntos.es > 0 ? 'es' : null;
}
