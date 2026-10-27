// La materia o el ámbito concreto que pide un requisito de medios personales.
import { normalizar } from './texto.js';

// Por ejemplo «5 años en monitorización de medios», «formación específica en Copilot» o «30 h de formación en
// teleformación». Los años totales o la titulación no lo acreditan: solo lo que la persona tiene registrado
// (sectores, tecnologías, certificaciones o titulaciones). Si no, una directora sin la materia que pide el
// pliego, unos tutores sin las horas exigidas o un docente sin formación en el curso saldrían todos en «sí» por
// los años totales.
// Conjunciones y vocales sueltas (A, E, O, U, Y): en un pliego en mayúsculas «MEDIOS O VALORACIÓN»
// la «O» es la conjunción, nunca un lenguaje.
const CONJUNCION = /^[AEOUY]$/;

// ¿Está el texto entero en mayúsculas (la mayoría de sus palabras de 4 o más letras)? Entonces
// una letra suelta es parte de él y no un lenguaje («R», «C»). Se decide con todo el texto: una
// palabra vecina en mayúsculas («SQL, R y Python») no lo convierte.
function enMayusculas(texto: string): boolean {
  const largas = texto.match(/\p{L}{4,}/gu) ?? [];
  return largas.filter((w) => w === w.toUpperCase()).length * 2 > largas.length;
}

// Normaliza como `normalizar`, salvo las letras sueltas en mayúscula («experiencia en R», «C»):
// son lenguajes y se conservan para poder distinguirlas de una preposición, siempre que el
// texto de alrededor no esté también en mayúsculas.
export function normalizarMateria(texto: string): string {
  const mayusculas = enMayusculas(texto);
  const letraSuelta = (tok: string) => /^[A-Z]$/.test(tok) && !CONJUNCION.test(tok) && !mayusculas;
  return texto
    .replace(/[\p{L}\p{N}+#]+/gu, (tok) => (letraSuelta(tok) ? tok : normalizar(tok)))
    .replace(/\s+/g, ' ')
    .trim();
}

// alternativas: basta una («monitorización de medios o valoración de patrocinios»). Vacía:
// el pliego no la nombra («relacionada con el curso») y no se puede comprobar con los datos.
export type Materia = { texto: string; alternativas: string[] };

// docencia: las materias que ha impartido también acreditan la materia (las horas, aparte: matching.ts).
export type PerfilConEvidencia = {
  sectores: string[];
  tecnologias: string[];
  certificaciones: string[];
  titulaciones: string[];
  docencia?: { materia: string }[];
};

const MODIFICADOR =
  '(?: (?:especifica|especificos?|especificas|acreditada|acreditable|demostrable|demostrada|profesional|minima|previa|practica))*';
const ANIOS = '(?: (?:de )?(?:al menos |un minimo de |minimo )?\\d{1,2} (?:anos?|meses))?';
const AMBITO = '(?: (?:el|la|los|las) (?:ambito|sector|materia|area|campo)(?: de)?)?';
const INICIO = new RegExp(
  [
    `\\b(?:experiencia|formacion|conocimientos?|especializacion|cualificacion|docencia)${MODIFICADOR}${ANIOS} (?:en|sobre)${AMBITO} `,
    '\\b\\d{1,2} anos? (?:de experiencia )?(?:profesional )?(?:en|de) ',
    '\\b\\d{1,3} ?(?:h|horas) de formacion (?:(?:especifica )?(?:en|de|sobre) )?',
  ].join('|'),
  'g',
);
// Dónde acaba la materia: puntuación, o lo que ya es otra condición («con titulación», «para el lote»).
const PERSONAS_CON = 'personas|colectivos|usuarios|alumnos|menores|mayores|jovenes|ninos|pacientes';
// «personas con discapacidad» es la materia, no una condición aparte: «con» no corta tras ellas.
// Solo si sigue un colectivo o condición personal; si sigue titulación, experiencia, contrato o
// formación, «con» abre otra condición («personas mayores con titulación de grado»).
const CONDICION_PERSONAL = String.raw`discapacidad|dependencia|diversidad funcional|enfermedad\w*|necesidades|problemas|trastornos?|movilidad|riesgo|exclusion|vulnerabilidad|autismo|alzheimer|demencia|deterioro|adicciones|sordera|ceguera`;
const FIN_COMUN = String.raw`[.;:()[\]]| y (?:con|un|una|el|la|\d)\b|(?<!\b(?:${PERSONAS_CON})) con |(?<=\b(?:${PERSONAS_CON})) con (?!(?:${CONDICION_PERSONAL})\b)| (?:para|durante|que|mediante|segun|acreditad\w*) `;
// Incisos que matizan la materia sin ser otra («marketing digital, al menos 3 años»,
// «gestión de proyectos, impartida por tutores»): lo que sigue no es materia ni lista. Un
// participio + «por» corta solo tras coma o si es de los típicos: «contenidos por canales» no.
const PARTICIPIO = String.raw`(?:impartid|cofinanciad|financiad|prestad|realizad|organizad|desarrollad|ejecutad|ofrecid)[oa]s? por`;
const INCISO = new RegExp(
  String.raw`(?:^|[,\s])(?:al menos|como minimo|preferentemente|preferiblemente|en particular|especialmente|principalmente|en concreto|impartid\w+|${PARTICIPIO})\b.*$|,\s*\w+[ai]d[oa]s? por\b.*$`,
);
// La coma corta la materia («A, tengan…») salvo que sea una lista «A, B y C» (ver materiasDeLista).
const FIN_LISTA = new RegExp(FIN_COMUN);
const SIN_NOMBRE =
  /\brelacionad[ao]s? con (?:el|la|los|las) (?:curso|materia|especialidad|objeto|modulo|accion formativa|contrato|puesto|servicio|prestacion)\w*/g;
// «Experiencia mínima: marketing 1 año, topografía 1, jardinería/arbolado 2»: una materia por elemento.
const LISTA =
  /\b(?:experiencia|titulo|titulacion)[^:.;]{0,30}: ((?:[^,;:.]+? \d{1,2}(?: anos?)?, ?)+[^,;:.]+? \d{1,2}(?: anos?)?)/g;
const SIMILAR = /\b(similar|similares|analog|equivalent|objeto del contrato)/;
const ALTERNATIVA = / y\/o | o | u |\//;
// Una lista con «o» («A, B o C») no se sabe si pide una, varias o todas: no se exige ninguna.
const ALTERNATIVA_LISTA = / y\/o | o | u /;
const NO_ES_MATERIA = new Set([
  'aunque',
  'si',
  'siendo',
  'cuando',
  'donde',
  'se',
  'sera',
  'seran',
  'debera',
  'deberan',
  'ademas',
  'asi',
  'tambien',
  'incluyendo',
  'es',
  'son',
  'preferiblemente',
]);
const HORAS = /^\d{1,3} ?(?:h|horas) de /;
const VACIAS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'en',
  'y',
  'o',
  'u',
  'un',
  'una',
  'con',
  'para',
  'por',
  'al',
  'a',
  'su',
  'sus',
  'que',
  'como',
  'mas',
  'menos',
  'minimo',
  'minima',
  'ano',
  'anos',
  'mes',
  'meses',
  'experiencia',
  'formacion',
  'profesional',
  'laboral',
  'especifica',
  'especifico',
  'acreditada',
  'acreditable',
  'demostrable',
  'previa',
  'h',
  'horas',
  'tareas',
  'funciones',
  'trabajos',
  'labores',
  'servicios',
  'ambito',
  'sector',
  'materia',
  'area',
  'campo',
]);

// Un solo carácter solo cuenta si es una mayúscula suelta (R, C): el resto son restos de «a», «y»…
const palabras = (t: string) =>
  t
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((w) => (w.length >= 2 || /^[A-Z]$/.test(w)) && !/^\d+$/.test(w) && !VACIAS.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());

function alternativas(cola: string): string[] {
  return cola
    .split(ALTERNATIVA)
    .map((a) => a.replace(HORAS, '').trim())
    .filter((a) => palabras(a).length > 0);
}

const sinNombre = (cola: string): Materia => ({ texto: cola, alternativas: [] });

/** Una materia leída de un trozo de texto ya normalizado («ia o ml»); sin palabras con sentido, sin alternativas. */
export function materiaDe(cola: string): Materia {
  return { texto: cola, alternativas: alternativas(cola) };
}
const unaMateria = (parte: string): Materia[] =>
  alternativas(parte).length ? [{ texto: parte, alternativas: alternativas(parte) }] : [];

// «A, B y C»: hacen falta todas. Si la coma no abre una lista clara, no se exige ninguna en vez
// de una parcial (cortar en la primera coma dio por cumplido «monitorización de medios, análisis
// de audiencias y valoración de patrocinios» a quien solo tenía la primera).
function materiasDeLista(cola: string): Materia[] {
  const items = cola
    .split(/\s*,\s*(?:y\s+)?|\s+y\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const clara =
    items.length >= 2 &&
    !ALTERNATIVA_LISTA.test(cola) &&
    items.every((i) => {
      const primera = i.split(' ')[0]!.toLowerCase();
      return i.split(' ').length <= 5 && !/\d/.test(i) && !VACIAS.has(primera) && !NO_ES_MATERIA.has(primera);
    });
  return clara ? items.flatMap(unaMateria) : [sinNombre(cola)];
}

function materiasDeCola(resto: string): Materia[] {
  const corte = resto.slice(0, FIN_LISTA.exec(resto)?.index ?? resto.length);
  const cola = corte
    .replace(INCISO, '')
    .trim()
    .replace(/[,\s]+$/, '');
  if (SIMILAR.test(cola)) return [sinNombre(cola)];
  if (cola.includes(',')) return materiasDeLista(cola);
  // «Python y Power BI»: hacen falta las dos.
  return cola
    .split(' y ')
    .map((x) => x.trim())
    .flatMap(unaMateria);
}

/** Las materias concretas que pide un requisito (todas hacen falta); vacío si solo pide años o titulación. */
export function materiasExigidas(texto: string): Materia[] {
  const t = normalizarMateria(texto);
  const out = new Map<string, Materia>();
  for (const m of t.matchAll(SIN_NOMBRE)) out.set(m[0], { texto: m[0], alternativas: [] });
  for (const m of t.matchAll(LISTA)) {
    for (const item of m[1]!.split(',')) {
      const cola = item.replace(/ \d{1,2}(?: anos?)?\s*$/, '').trim();
      if (alternativas(cola).length) out.set(cola, { texto: cola, alternativas: alternativas(cola) });
    }
  }
  for (const m of t.matchAll(INICIO)) {
    const resto = t.slice(m.index + m[0].length);
    for (const materia of materiasDeCola(resto)) out.set(materia.texto, materia);
  }
  // «5 años de experiencia en X» la leen dos patrones: queda la más larga.
  const todas = [...out.values()];
  return todas.filter(
    (x) => !todas.some((y) => y !== x && y.texto.length > x.texto.length && y.texto.includes(x.texto)),
  );
}

// «audiencias» casa con «audiencia»: la palabra entera o solo el plural (-s, -es). Por raíz,
// «análisis» casaba «analista» y «gestión», «gestionar».
function casaPalabra(w: string, de: string[]): boolean {
  return de.some((x) => x === w || x === `${w}s` || x === `${w}es` || w === `${x}s` || w === `${x}es`);
}

// Términos compuestos cuya primera palabra, en plural, es otra cosa: «medios» (de comunicación)
// no es «medio ambiente». Solo frena una materia de una sola palabra en plural.
const COMPUESTOS = [
  'medio ambiente',
  'medio rural',
  'medio natural',
  'medio marino',
  'medio urbano',
  'medio fisico',
  'medio social',
];

function pluralDeCompuesto(w: string, valor: string): boolean {
  return COMPUESTOS.some((c) => {
    const primera = c.split(' ')[0]!;
    return (w === `${primera}s` || w === `${primera}es`) && valor.includes(c);
  });
}

function casaAlternativa(ws: string[], suyas: string[], valor: string): boolean {
  return ws.every(
    (w) => suyas.includes(w) || (casaPalabra(w, suyas) && !(ws.length === 1 && pluralDeCompuesto(w, valor))),
  );
}

// Sinónimos claros (sobre el texto ya normalizado): cada forma pasa a un solo término, igual en
// la materia que en lo registrado. «AI-900», «Azure AI Fundamentals» o «Aplicación práctica de
// la IA» dan «ia». Sin equivalencias dudosas: «transformación digital» no es «digitalización».
const SINONIMOS: [RegExp, string][] = [
  [/\b(?:inteligencia artificial|artificial intelligence|ai)\b/g, 'ia'],
  [/\b(?:machine learning|aprendizaje automatico)\b/g, 'ml'],
  [/\b(?:deep learning|aprendizaje profundo)\b/g, 'dl'],
  [/\b(?:business intelligence|inteligencia de negocios?)\b/g, 'bi'],
  [/\btecnologias de la informacion y (?:de )?(?:la )?comunicacion(?:es)?\b/g, 'tic'],
];
// Lo que acredita también un campo más amplio: quien registra «machine learning» o «deep
// learning» acredita IA; al revés no (la IA no es por fuerza aprendizaje automático).
const ACREDITA_TAMBIEN: Record<string, string[]> = { ml: ['ia'], dl: ['ml', 'ia'] };
// El ámbito en que se aplica una técnica («IA administrativa», «BI aplicado») no es otra materia:
// basta la técnica. Solo tras uno de esos términos; «gestión administrativa» sigue exigiéndose.
const TECNICAS = new Set(['ia', 'ml', 'dl', 'bi', 'tic']);
const DE_APLICACION = /^(?:administrativ[ao]s?|aplicad[ao]s?|empresarial(?:es)?)$/;

const canonico = (normal: string): string => SINONIMOS.reduce((t, [re, a]) => t.replace(re, a), normal);

function palabrasDeLoRegistrado(normal: string): string[] {
  const ws = palabras(canonico(normal));
  return [...new Set([...ws, ...ws.flatMap((w) => ACREDITA_TAMBIEN[w] ?? [])])];
}

function palabrasDeLaMateria(alternativa: string): string[] {
  const ws = palabras(canonico(alternativa));
  return ws.some((w) => TECNICAS.has(w)) ? ws.filter((w) => !DE_APLICACION.test(w)) : ws;
}

const CAMPOS = ['sectores', 'tecnologias', 'certificaciones', 'titulaciones', 'docencia'] as const;

const valoresDe = (p: PerfilConEvidencia, campo: (typeof CAMPOS)[number]): string[] =>
  campo === 'docencia' ? (p.docencia ?? []).map((d) => d.materia) : p[campo];

/** ¿Lo registrado («Machine learning», «Power BI») acredita la materia? */
export function casaMateria(valor: string, m: Materia): boolean {
  const normal = normalizarMateria(valor);
  const suyas = palabrasDeLoRegistrado(normal);
  return m.alternativas.some((a) => casaAlternativa(palabrasDeLaMateria(a), suyas, normal));
}

/** Dónde tiene registrada la persona la materia («sectores: monitorización de medios»), o null. */
export function evidenciaDeMateria(p: PerfilConEvidencia, m: Materia): string | null {
  for (const campo of CAMPOS) {
    const valor = valoresDe(p, campo).find((v) => casaMateria(v, m));
    if (valor !== undefined) return `${campo}: ${valor}`;
  }
  return null;
}

/** «monitorizacion de medios o valoracion de patrocinios», «relacionada con el curso». */
export const nombresDeMaterias = (ms: Materia[]) => ms.map((m) => `«${m.texto}»`).join(', ');
