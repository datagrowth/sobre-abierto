// Prosa telegráfica: frases sin verbo y retahílas que los jueces ciegos leen como «difícil de leer». Puro.
import { textoComparable } from '../temas.js';
import { frases } from './fugas.js';

// Se vio en una memoria con todas las cifras: frases sin verbo («Azure Spain Central para datos, índices,
// copias y logs; sin réplica fuera de España»), retahílas de fragmentos separados por comas y palabras pegadas
// con barras o a una cifra («perfil/expediente/documento», «Figura2perfiles»). Viene de comprimir para caber en
// el techo de extensión en vez de quitar contenido. Mide solo los párrafos (las listas y las tablas son
// fragmentos por naturaleza).
// Formas verbales sin ambigüedad con sustantivos (sobre el texto sin tildes ni mayúsculas): las
// frecuentes, «se» + verbo, futuro y condicional, plural del presente y gerundio. La tercera del
// singular del presente («limita», «cubre») se confunde con sustantivos: va por lista y sufijos.
const VERBOS = new Set([
  'es',
  'son',
  'esta',
  'estan',
  'era',
  'eran',
  'fue',
  'fueron',
  'hay',
  'habra',
  'ha',
  'han',
  'tiene',
  'tienen',
  'puede',
  'pueden',
  'debe',
  'deben',
  'aplica',
  'registra',
  'limita',
  'garantiza',
  'cubre',
  'define',
  'fija',
  'incluye',
  'usa',
  'utiliza',
  'emplea',
  'entrega',
  'revisa',
  'valida',
  'comprueba',
  'mide',
  'genera',
  'permite',
  'asegura',
  'controla',
  'recoge',
  'contiene',
  'dispone',
  'conserva',
  'separa',
  'exige',
  'implanta',
  'despliega',
  'ejecuta',
  'documenta',
  'establece',
  'realiza',
  'lleva',
  'recibe',
  'envia',
  'marca',
  'cierra',
  'abre',
  'activa',
  'asigna',
  'calcula',
  'clasifica',
  'propone',
  'presta',
  'atiende',
  'resuelve',
  'escala',
  'notifica',
  'informa',
  'coordina',
  'dirige',
  'supervisa',
  'gestiona',
  'mantiene',
  'actualiza',
  'almacena',
  'cifra',
  'protege',
  'muestra',
  'presenta',
  'ofrece',
  'aporta',
  'reduce',
  'evita',
  'sustituye',
  'traslada',
  'corresponde',
  'depende',
  'significa',
  'designa',
  'distingue',
  'construye',
  'identifica',
  'verifica',
  'audita',
  'firma',
  'aprueba',
  'acredita',
  'cumple',
  'supone',
  'requiere',
  'necesita',
  'queda',
  'quedan',
  'sigue',
  'pasa',
  'llega',
  'parte',
  'cuenta',
  'sirve',
  'trabaja',
  'responde',
  'decide',
  'empieza',
  'termina',
  'acaba',
  'dura',
  'ocupa',
  'combina',
  'compara',
  'resume',
  'guarda',
  'trata',
  'carga',
  'crea',
  'lee',
  'escribe',
  'recorre',
  'explica',
  'forma',
  'prepara',
  'publica',
  'consulta',
  'avisa',
  'admite',
  'recibe',
  'da',
  'hace',
  'va',
  'sale',
  'vuelve',
]);
// Plurales en -an/-en que no son verbo.
const NO_VERBOS = new Set([
  'plan',
  'origen',
  'imagen',
  'volumen',
  'orden',
  'examen',
  'resumen',
  'margen',
  'regimen',
  'dictamen',
  'certamen',
  'joven',
  'bien',
  'tambien',
  'quien',
  'alguien',
  'cien',
  'segun',
  'desden',
  'almacen',
  'gran',
  'capitan',
  'balan',
  'man',
  'lan',
  'wan',
  'san',
  'van',
]);
const SUFIJO_VERBAL =
  /^(?:\p{L}{3,}(?:ara|era|ira|aran|eran|iran|aria|eria|iria|arian|erian|irian)|\p{L}{2,}(?:ando|iendo)|\p{L}{3,}(?:iza|izan|ifica|ifican|ece|ecen|uye|uyen))$/u;
const PLURAL_PRESENTE = /^\p{L}{3,}(?:an|en)$/u;

function esVerbo(palabra: string, previa: string | undefined): boolean {
  if (previa === 'se' || VERBOS.has(palabra) || SUFIJO_VERBAL.test(palabra)) return true;
  return PLURAL_PRESENTE.test(palabra) && !NO_VERBOS.has(palabra);
}

// El pretérito («definió») lleva la tilde que textoComparable quita: se mira antes.
const PRETERITO = /\p{L}{2,}[óé](?!\p{L})/u;
const palabrasDe = (frase: string) =>
  textoComparable(frase)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** ¿La frase (de 4 palabras o más) no lleva ningún verbo? */
export function fraseSinVerbo(frase: string): boolean {
  const ps = palabrasDe(frase);
  if (ps.filter((p) => /\p{L}/u.test(p)).length < 4 || PRETERITO.test(frase)) return false;
  return !ps.some((p, i) => esVerbo(p, ps[i - 1]));
}

// Una retahíla: 6 trozos o más separados por comas, punto y coma, barras o «·», de 2 palabras o
// menos de media (una enumeración corta dentro de una frase con verbo es prosa).
const SEPARADORES = /\s*[,;·/]\s*|\s+y\s+/;
export function esRetahila(frase: string): boolean {
  const trozos = frase
    .replace(/[.:]\s*$/, '')
    .split(SEPARADORES)
    .filter((t) => t.trim());
  if (trozos.length < 6) return false;
  return trozos.reduce((n, t) => n + t.trim().split(/\s+/).length, 0) / trozos.length <= 2;
}

// Palabras pegadas: dos palabras unidas por una barra sin espacios (al menos una de 4 letras en
// minúscula: «TCP/IP» o «I/O» no cuentan, «y/o» tampoco) o una palabra pegada a una cifra
// («Figura2perfiles», «modelosS2», «9tipos»).
// Por palabra (lo separado por espacios), sin cuantificadores abiertos sobre el texto entero: un
// párrafo de miles de letras sin espacios disparaba el retroceso de una expresión global.
// Los nombres técnicos que acaban en cifra («base64», «sha256», «python3», «gpt4o») o llevan una
// unidad («100kbps») se escriben así: pegada es la cifra entre dos palabras, o delante de una
// palabra que no es una unidad, o una minúscula seguida de sigla y cifra.
const BARRA = /^\p{L}+(?:\/\p{L}+)+$/u;
const ENTRE_PALABRAS = /\p{L}{3}\d+\p{Ll}{4}/u;
const SIGLA_PEGADA = /\p{Ll}{4}\p{Lu}\d/u;
const CIFRA_Y_PALABRA = /^\d+(\p{Ll}{4,})$/u;
const UNIDADES = new Set([
  'kbps',
  'mbps',
  'gbps',
  'tbps',
  'khz',
  'mhz',
  'ghz',
  'kwh',
  'mwh',
  'rpm',
  'dpi',
  'ppm',
  'fps',
  'iops',
  'vcpu',
  'vcpus',
  'core',
  'cores',
  'gbit',
]);
const sinPuntuacion = (t: string) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function trozoPegado(p: string): boolean {
  const unidad = CIFRA_Y_PALABRA.exec(p);
  if (unidad) return !UNIDADES.has(unidad[1]!.toLowerCase());
  return ENTRE_PALABRAS.test(p) || SIGLA_PEGADA.test(p);
}

function pegada(token: string): boolean {
  if (BARRA.test(token)) return token !== 'y/o' && token.split('/').some((p) => /^\p{Ll}{4}/u.test(p));
  return token.split(/[^\p{L}\p{N}]+/u).some(trozoPegado);
}

export function pegadasEn(texto: string): string[] {
  return texto
    .split(/\s+/)
    .map(sinPuntuacion)
    .filter((t) => t && pegada(t));
}

// Palabras gramaticales: la prosa española que se lee bien lleva un tercio largo de artículos,
// preposiciones y conjunciones; el estilo telegráfico las quita («PAAI emitirá acta de recurso,
// versión, modalidad»). Medido en dos memorias del mismo pliego sin contar nombres ni siglas: la
// que los jueces leyeron como telegráfica, del 28 al 35 % por apartado; la que se leía bien, del
// 39 al 44 %. Un párrafo de arquitectura lleno de servicios y con sus artículos da más del 42 %.
const GRAMATICALES = new Set([
  'de',
  'la',
  'el',
  'en',
  'y',
  'e',
  'a',
  'los',
  'las',
  'del',
  'al',
  'se',
  'que',
  'por',
  'un',
  'una',
  'unos',
  'unas',
  'con',
  'para',
  'su',
  'sus',
  'lo',
  'como',
  'o',
  'u',
  'este',
  'esta',
  'estos',
  'estas',
  'cada',
  'no',
  'si',
  'cuando',
  'donde',
  'entre',
  'sin',
  'sobre',
  'hasta',
  'desde',
  'le',
  'les',
  'ya',
  'mas',
  'tambien',
  'pero',
  'porque',
  'cual',
  'cuales',
  'quien',
]);
const MIN_PALABRAS_TELEGRAFIA = 150;
export const DENSIDAD_MINIMA = 0.35;
// Una palabra pegada cada 400 palabras (al menos 3) se tolera: «lectura/escritura» es normal en técnico.
const MIN_PEGADAS = 3;
const PALABRAS_POR_PEGADA = 400;
export const pegadasToleradas = (palabras: number): number =>
  Math.max(MIN_PEGADAS, Math.floor(palabras / PALABRAS_POR_PEGADA));

export type Telegrafia = { palabras: number; densidad: number; ejemplos: string[]; pegadas: string[] };

// Los nombres de servicios, productos y siglas («Azure AI Search», «Key Vault», «Entra ID»,
// «text-embedding-3-large») son palabras de contenido que no hacen telegráfica una prosa con sus
// artículos: no cuentan para la densidad. Nombre es lo que empieza en mayúscula fuera del
// principio de la frase, lleva una cifra o une trozos con guion, barra, punto o guion bajo.
const COMPUESTO = /[\p{L}\p{N}][-_./@][\p{L}\p{N}]/u;
const esNombre = (token: string, primero: boolean): boolean =>
  /\d/.test(token) || COMPUESTO.test(token) || (!primero && /^\p{Lu}/u.test(token));

function palabrasDeProsa(parrafo: string): string[] {
  return frases(parrafo).flatMap((f) =>
    f
      .split(/\s+/)
      .map(sinPuntuacion)
      .filter(Boolean)
      .filter((t, i) => !esNombre(t, i === 0))
      .flatMap(palabrasDe),
  );
}

/** Lo telegráfico de unos párrafos: la proporción de palabras gramaticales (sin contar nombres propios ni siglas), frases sin verbo o en retahíla de ejemplo y las palabras pegadas. */
export function telegrafiaDe(parrafos: string[]): Telegrafia {
  const ps = parrafos.flatMap(palabrasDeProsa).filter((p) => /\p{L}/u.test(p));
  const gramaticales = ps.filter((p) => GRAMATICALES.has(p)).length;
  const ejemplos = parrafos.flatMap((p) => frases(p)).filter((f) => fraseSinVerbo(f) || esRetahila(f));
  return {
    palabras: ps.length,
    densidad: ps.length ? gramaticales / ps.length : 1,
    ejemplos,
    pegadas: parrafos.flatMap(pegadasEn),
  };
}

/** ¿Es telegráfico? Con 150 palabras o más, menos de un 35 % de palabras gramaticales; o más palabras pegadas de las toleradas. */
export function esTelegrafico(t: Telegrafia): boolean {
  return (
    (t.palabras >= MIN_PALABRAS_TELEGRAFIA && t.densidad < DENSIDAD_MINIMA) ||
    t.pegadas.length > pegadasToleradas(t.palabras)
  );
}

// Un texto corto apelmazado: la evidencia del mapa de la estrategia sale tal cual en la tabla guía
// del documento, y puede llegar sin espacios («Figura2perfiles/9tipos yexclusiónintegración…»,
// «4roles,dedicación porfase,RACI»). Sospechoso es un trozo (lo separado por espacios) con una
// palabra pegada, una coma pegada a una letra o 25 caracteres seguidos; apelmazado, con dos
// sospechosos o con uno y trozos de más de 12 caracteres de media (la prosa ronda los 6).
const LARGO_SIN_ESPACIO = 25;
const MEDIA_APELMAZADA = 12;
const COMA_PEGADA = /[,;]\p{L}/u;

/** ¿Va el texto sin espacios entre palabras y cifras? */
export function apelmazado(texto: string): boolean {
  const trozos = texto.trim().split(/\s+/).filter(Boolean);
  const sospechosos = trozos.filter(
    (t) => t.length >= LARGO_SIN_ESPACIO || COMA_PEGADA.test(t) || pegada(sinPuntuacion(t)),
  ).length;
  const media = trozos.length ? trozos.join('').length / trozos.length : 0;
  return sospechosos >= 2 || (sospechosos === 1 && media > MEDIA_APELMAZADA);
}
