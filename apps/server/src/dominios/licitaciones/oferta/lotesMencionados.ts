// A qué lotes se refiere un criterio del guion o un miembro del equipo. Sin IA: solo lee lo guardado.
import { textoComparable } from '../temas.js';
import type { GuionBaseData } from './guion.js';

// Se deduce de lo que dice su texto («lote 1», «lotes 2 y 4», «lotes 1 a 5») o, en un criterio automático, del
// anexo donde se marca («Anexo II» → el documento «Anexo II (lote 1, criterio 2B1)»). Vacío si no nombra ninguno
// de los lotes de la licitación.
// Lo que, tras un número, lo convierte en una cantidad y no en otro lote («Lote 3 - 2 técnicos»).
const CANTIDAD = String.raw`\s*(?:(?:anos?|meses|mes|semanas?|dias?|horas?|h|hrs?|tecnic[oa]s?|trabajador(?:es|a|as)?|personas?|profesionales|usuarios?|alumnos?|docentes|formador(?:es|a|as)?|plazas?|unidad(?:es)?|uds?|equipos?|licencias?|jornadas?|sesion(?:es)?|cursos?|vehiculos?|puestos?|euros?|km)\b|[€%])`;
const ROMANO = 'xviii|xvii|xix|xvi|xiv|xiii|xii|xv|xx|xi|ix|viii|vii|vi|iv|iii|ii|x|v|i';
// Un lote es «3», «3b», «iii» o una letra; no el principio de «2.1», «2.500», «2B1» ni de una palabra.
// La «a» suelta seguida de lote/la/el/los/las es la preposición («por lote a la empresa», «lote a lote»).
const LETRA = String.raw`(?:a(?!\s+(?:lotes?|la|el|los|las)\b)|[b-z])`;
const ID_BASE = String.raw`(?:\d{1,3}[a-z]?|${ROMANO}|${LETRA})(?![a-z0-9]|\.\d`;
// El primer ID tras «lote» es siempre el lote («Lote 2 Equipos informáticos»); la cantidad solo
// delata como tal a los que siguen a un separador.
const ID_PRIMERO = String.raw`${ID_BASE})`;
const ID = String.raw`${ID_BASE}|${CANTIDAD})`;
// «A-C» y «I-III» pegados: intervalo de letras o romanos (la mayúscula se comprueba aparte).
const SEPARADOR = String.raw`(?:\s*,\s*|\s+(?:y|e|o|a|al)\s+|\s+[-–]\s+|(?<=\d)[-–](?=\d)|(?<=[a-z])[-–](?=[a-z]))`;
const PREFIJO = String.raw`(?:num(?:ero)?\.?|n[.ºo°]*)?\s*`;
const LISTA = new RegExp(String.raw`\blotes?\s+${PREFIJO}(${ID_PRIMERO}(?:${SEPARADOR}${ID})*)`, 'gd');
const PIEZA = new RegExp(String.raw`(${SEPARADOR})|(\d{1,3}[a-z]?|${ROMANO}|[a-z])`, 'g');
const RANGO = ['a', 'al', '-', '–'];

const ROMANOS = [
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'xi',
  'xii',
  'xiii',
  'xiv',
  'xv',
  'xvi',
  'xvii',
  'xviii',
  'xix',
  'xx',
];

/** «01» y «1», «III» y «3», «A» y «a» son el mismo lote. */
function normalizaLote(id: string): string {
  const t = textoComparable(id).trim();
  const romano = new RegExp(`^(?:${ROMANO})$`).test(t) ? ROMANOS.indexOf(t) + 1 : 0;
  return romano > 0 ? String(romano) : t.replace(/^0+(?=\d)/, '');
}

// El texto comparable con, por cada carácter, si en el original iba en mayúscula: una letra o
// un romano solo son un lote si se escriben así («lote A», «lote III»), no «lote i» ni «lote x».
function comparableConMayusculas(t: string): { comparable: string; mayus: boolean[] } {
  let comparable = '';
  const mayus: boolean[] = [];
  for (const c of t) {
    const comp = textoComparable(c);
    comparable += comp;
    for (let k = 0; k < comp.length; k += 1) mayus.push(c !== c.toLowerCase());
  }
  return { comparable, mayus };
}

const esLetra = (id: string) => /^[a-z]$/.test(id);
// «E-learning»: una letra o romano pegados a «-» y una minúscula son el principio de una palabra.
const esLetraORomano = (t: string) => !/^\d/.test(t);

// «1 a 5», «1-5», «1 al 5», «A a C»: el intervalo; «2, 3 y 4»: cada uno. Un «-» o «a» cuyo
// segundo número no es mayor no es un intervalo («Lote 3 - 2»): ese segundo no es otro lote.
function idsDeLista(lista: string, desde: number, comparable: string, mayus: boolean[]): string[] {
  const ids: string[] = [];
  let rango = false;
  for (const m of lista.matchAll(PIEZA)) {
    if (m[1]) {
      rango = RANGO.includes(m[1].trim());
      continue;
    }
    if (!/^\d/.test(m[2]!) && !mayus[desde + m.index]) {
      rango = false;
      continue;
    }
    const fin = desde + m.index + m[2]!.length;
    if (esLetraORomano(m[2]!) && /^[-–][a-z]/.test(comparable.slice(fin, fin + 2)) && !mayus[fin + 1]) {
      rango = false;
      continue;
    }
    const id = normalizaLote(m[2]!);
    const previo = ids.at(-1) ?? '';
    const numeros = /^\d+$/.test(id) && /^\d+$/.test(previo);
    const letras = esLetra(id) && esLetra(previo);
    if (rango && (numeros ? Number(id) <= Number(previo) : letras && id <= previo)) {
      rango = false;
      continue;
    }
    if (rango && numeros) {
      for (let n = Number(previo) + 1; n <= Number(id); n += 1) ids.push(String(n));
    } else if (rango && letras) {
      for (let c = previo.charCodeAt(0) + 1; c <= id.charCodeAt(0); c += 1) ids.push(String.fromCharCode(c));
    } else {
      ids.push(id);
    }
    rango = false;
  }
  return ids;
}

// «Igual que en el lote 1», «salvo el lote 3», «sustituye al del lote 1»: nombra otro lote para
// compararse o excluirlo, no dice que lo de aquí sea de ese lote.
const REFERENCIA =
  /(?:como (?:en|para)|igual que|del mismo modo que|excepto|salvo|a diferencia de(?:l)?|sustituyen? a(?:l)?)\s+(?:(?:en|para|a|de|el|la|los|las|del|al|persona|miembro)\s+)*$/;

/** Los lotes de la licitación (`existentes`) que nombra un texto, sin repetir y en orden. */
export function lotesMencionados(texto: string | null | undefined, existentes: string[]): string[] {
  if (!texto || !existentes.length) return [];
  const { comparable, mayus } = comparableConMayusculas(texto);
  const propios = [...comparable.matchAll(LISTA)].filter(
    (m) => !REFERENCIA.test(comparable.slice(Math.max(0, m.index - 40), m.index)),
  );
  const ids = propios.flatMap((m) => idsDeLista(m[1]!, m.indices![1]![0], comparable, mayus));
  const conocidos = new Map(existentes.map((e) => [normalizaLote(e), e]));
  return [...new Set(ids.flatMap((id) => conocidos.get(id) ?? []))];
}

type Automatico = GuionBaseData['automaticos'][number];

const ANEXO = /\banexo\s+([ivxlc]+|\d+)(\s+bis)?\b/;
const anexoDe = (texto: string | undefined) => {
  const m = texto ? ANEXO.exec(textoComparable(texto)) : null;
  return m ? `${m[1]}${m[2] ? ' bis' : ''}` : null;
};

// Los lotes del documento del guion que es el modelo de ese anexo (el pliego suele decir allí de qué lote es).
function lotesDelAnexo(g: GuionBaseData, anexo: string, existentes: string[]): string[] {
  const docs = g.archivos
    .flatMap((a) => a.documentos)
    .filter((d) => anexoDe(d.origen?.modelo) === anexo || anexoDe(d.nombre) === anexo);
  return [...new Set(docs.flatMap((d) => lotesMencionados(`${d.nombre}. ${d.origen?.modelo ?? ''}`, existentes)))];
}

/**
 * Los lotes de un criterio automático: los que nombra en su nombre o su casilla; si no, los del
 * modelo donde se marca y, solo al final, los que cita al decir cómo se acredita (suele ser una
 * comparación con otro lote): entonces `soloDelTexto`, que es una pista y no una certeza.
 */
export function lotesDeAutomaticoDetalle(
  a: Automatico,
  g: GuionBaseData,
  existentes: string[],
): { lotes: string[]; soloDelTexto: boolean } {
  const propios = lotesMencionados(`${a.criterio}. ${a.casilla_en}`, existentes);
  if (propios.length) return { lotes: propios, soloDelTexto: false };
  const anexo = anexoDe(a.casilla_en);
  const delAnexo = anexo ? lotesDelAnexo(g, anexo, existentes) : [];
  if (delAnexo.length) return { lotes: delAnexo, soloDelTexto: false };
  const delComo = lotesMencionados(a.como_se_acredita, existentes);
  return { lotes: delComo, soloDelTexto: delComo.length > 0 };
}

export const lotesDeAutomatico = (a: Automatico, g: GuionBaseData, existentes: string[]): string[] =>
  lotesDeAutomaticoDetalle(a, g, existentes).lotes;

/** Los lotes de cada criterio del guion (automáticos y apartados de la memoria), en ese orden. */
export function lotesDeCriterios(g: GuionBaseData, existentes: string[]): { criterio: string; lotes: string[] }[] {
  const apartados = g.memoria?.valorable === false ? [] : (g.memoria?.apartados ?? []);
  return [
    ...g.automaticos.map((a) => ({ criterio: a.criterio, lotes: lotesDeAutomatico(a, g, existentes) })),
    ...apartados.map((x) => ({
      criterio: x.titulo,
      lotes: lotesMencionados(`${x.titulo}. ${x.se_valorara.join('. ')}`, existentes),
    })),
  ];
}
