// Versiones de modelo anticuadas: un modelo con versión de año y medio antes del inicio se lee como una oferta vieja.
import { textoComparable } from '../temas.js';

// Una versión con fecha (AAAA-MM-DD, AAAAMMDD o AAAA-MM) de más de 12 meses antes del inicio previsto se marca,
// salvo que el pliego la cite. Puro.
export const MESES_VIGENCIA = 12;

// Fecha completa con guiones o compacta (la de los identificadores de modelo) y año-mes suelto.
const COMPLETA = /(?<!\d)(20\d{2})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?!\d)/g;
const ANO_MES = /(?<![\d-])(20\d{2})-(0[1-9]|1[0-2])(?![\d-])/g;

export type VersionFechada = { texto: string; fecha: string; indice: number };

/** Las fechas de versión de un texto, como AAAA-MM-DD (año-mes, el día 1). */
export function versionesFechadas(texto: string): VersionFechada[] {
  const completas = [...texto.matchAll(COMPLETA)].map((m) => ({
    texto: m[0],
    fecha: `${m[1]}-${m[2]}-${m[3]}`,
    indice: m.index,
  }));
  const meses = [...texto.matchAll(ANO_MES)].map((m) => ({
    texto: m[0],
    fecha: `${m[1]}-${m[2]}-01`,
    indice: m.index,
  }));
  return [...completas, ...meses];
}

/** El día `meses` antes de `inicio` (AAAA-MM-DD). */
export function mesesAntes(inicio: string, meses: number): string {
  const d = new Date(`${inicio}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

// Una fecha que no es la versión de un modelo: la de una API («api-version 2024-10-21») o la de
// una norma o guía («ISO/IEC 42001 (2023-12)», «Real Decreto 311/2022 (2022-05-03)»): la palabra
// de la norma y como mucho dos trozos de su código justo delante de la fecha.
const API = /api[-_ ]?version\s*[=:]?\s*$/i;
const NORMA =
  /\b(?:iso|iec|une|ens|rd|real decreto|decreto|ley|reglamento|directiva|guia|norma|ccn|stic|nist|owasp|rgpd|lopdgdd|orden|resolucion|instruccion)\b(?:[\s/:-]*[\p{L}\p{N}./-]+){0,2}\s*[(,]?\s*$/u;
const DELANTE = 40;

function noEsDeModelo(texto: string, v: VersionFechada): boolean {
  const antes = texto.slice(Math.max(0, v.indice - DELANTE), v.indice);
  return API.test(antes) || NORMA.test(textoComparable(antes));
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

// Cómo puede escribir el pliego la misma fecha: los españoles, «14/04/2025» o «14 de abril de 2025».
function formasDeFecha(v: VersionFechada): string[] {
  const [a, m, d] = v.fecha.split('-').map(Number) as [number, number, number];
  const mes = MESES[m - 1]!;
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const dia =
    v.texto.length > 7
      ? [
          `${d}/${m}/${a}`,
          `${dd}/${mm}/${a}`,
          `${dd}-${mm}-${a}`,
          `${dd}.${mm}.${a}`,
          `${d} de ${mes} de ${a}`,
          `${d} de ${mes} del ${a}`,
        ]
      : [];
  return [
    v.texto,
    v.fecha.slice(0, v.texto.length > 7 ? 10 : 7),
    ...dia,
    ...(v.texto.length > 7 ? [] : [`${mm}/${a}`, `${mes} de ${a}`, `${mes} del ${a}`]),
  ];
}

const citada = (v: VersionFechada, citadas: string): boolean => {
  const t = textoComparable(citadas);
  return formasDeFecha(v).some((f) => t.includes(textoComparable(f)));
};

/**
 * Las versiones de modelo fechadas de un texto anteriores en más de 12 meses a `inicio`.
 * `citadas`: el texto del pliego y del dossier; una versión cuya fecha aparece en él (en
 * cualquier forma) la pide el pliego y no cuenta. Las fechas de una API o de una norma no son
 * versiones de modelo.
 */
export function versionesAnticuadas(texto: string, inicio: string, citadas = ''): VersionFechada[] {
  const limite = mesesAntes(inicio, MESES_VIGENCIA);
  return versionesFechadas(texto).filter((v) => v.fecha < limite && !noEsDeModelo(texto, v) && !citada(v, citadas));
}
