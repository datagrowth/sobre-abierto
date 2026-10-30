// Lectura por código de un acta o resolución de un expediente ajeno: licitadores, NIF e importe ofertado.
import { claseNif, estadoNif } from '../../nucleo/identidad.js';
import { rangoActaDeNombre } from './propuestas/actas.js';

// Los licitadores se reconocen por su NIF con el control bien (el de una línea de tabla o un párrafo), el nombre
// es lo que va delante en la línea y el importe ofertado, el primer importe en euros que le sigue. Los puntos y
// lo que no está en tabla los lee Hermes si esto no basta.
export type LicitadorLeido = {
  nif: string;
  nombre: string | null;
  importe: number | null;
  excluida: boolean;
};

// Un NIF con lo que suelen meter en medio («A-00.000.091», «B 12345674», «ES12345678Z»): la letra
// del principio, las cifras con o sin puntos y la letra de control, si la hay.
const NIF_SUELTO = /\b(?:ES[\s-]?)?([A-Z])?[\s-]?(\d[\d.]{5,10}\d)(?:[\s-]?([A-Z]))?\b/g;
const IMPORTE = /(\d{1,3}(?:\.\d{3})+|\d{3,}),(\d{2})(?!\d)/g;
const EXCLUSION = /\bexclu(?:id[ao]s?|sión|ye|ir)\b/i;
// Lo que acompaña al NIF y no es el nombre: etiquetas, importes, porcentajes y puntos.
const RUIDO =
  /\b(?:c\.?i\.?f\.?|n\.?i\.?f\.?|n\.?i\.?e\.?|d\.?n\.?i\.?|importe|euros?|eur|iva|puntos?|ptos?)\b\.?:?|\b(?:empresa|licitador(?:a|es)?|oferta)\s*:|€|\d[\d.,]*\s*%?/gi;
const MAX_NOMBRE = 160;
// Quien forma la mesa o firma el acta lleva a veces su DNI: no es un licitador (y es un dato personal).
const MESA =
  /\b(?:president[ae]|vocal(?:es)?|secretari[oa]|interventor[a]?|asesor[a]?|letrad[oa]|suplente|firmad[oa]|firma|miembros?\s+de\s+la\s+mesa)\b/i;
// Una persona física solo cuenta si su línea dice que licita u oferta, o trae su importe.
const LICITA = /\b(?:licit\w*|ofert\w*|present\w*|propo\w*)\b/i;

type NifEnLinea = { nif: string; desde: number; hasta: number };

function nifsDeLinea(linea: string): NifEnLinea[] {
  const hallados: NifEnLinea[] = [];
  for (const m of linea.matchAll(NIF_SUELTO)) {
    const cifras = (m[2] ?? '').replace(/\./g, '');
    const nif = [`${m[1] ?? ''}${cifras}${m[3] ?? ''}`, `${m[1] ?? ''}${cifras}`].find(
      (n) => estadoNif(n) === 'valido',
    );
    if (nif && !hallados.some((h) => h.nif === nif))
      hallados.push({ nif, desde: m.index, hasta: m.index + m[0].length });
  }
  return hallados;
}

function importesDe(texto: string): number[] {
  return [...texto.matchAll(IMPORTE)]
    .map((m) => Number(`${(m[1] ?? '').replace(/\./g, '')}.${m[2]}`))
    .filter((n) => n >= 100);
}

function nombreDe(texto: string): string | null {
  const limpio = texto
    .replace(NIF_SUELTO, ' ')
    .replace(RUIDO, ' ')
    .replace(/[|;:()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:[\s,]+(?:con|y))+$/i, '')
    .replace(/^[\s,.\-–]+|[\s,\-–]+$/g, '');
  return /\p{L}{3}/u.test(limpio) ? limpio.slice(0, MAX_NOMBRE) : null;
}

/**
 * Licitadores que se leen del texto: uno por NIF válido que no sea del órgano ni de otro
 * organismo. El nombre es lo que va delante del NIF en su línea o, si no hay nada, la línea
 * anterior (tablas con el nombre encima); el importe, el primero que le sigue en la línea.
 * No cuenta un NIF en la línea de un cargo de la mesa o de la firma, ni una persona física sin importe
 * ni palabra de licitar u ofertar en su línea. Una persona física se devuelve sin nombre.
 */
export function licitadoresDeTexto(texto: string, organoNif: string | null = null): LicitadorLeido[] {
  const lineas = texto.split(/\r?\n/);
  const porNif = new Map<string, LicitadorLeido>();
  lineas.forEach((linea, i) => {
    const nifs = nifsDeLinea(linea);
    nifs.forEach((h, j) => {
      if (h.nif === organoNif || claseNif(h.nif) === 'organismo' || porNif.has(h.nif)) return;
      const inicio = j > 0 ? nifs[j - 1]!.hasta : 0;
      const tramo = linea.slice(inicio, nifs[j + 1]?.desde ?? linea.length);
      if (MESA.test(tramo)) return;
      const persona = claseNif(h.nif) === 'persona_fisica';
      const resto = linea.slice(h.hasta, nifs[j + 1]?.desde ?? linea.length);
      const importe = importesDe(resto)[0] ?? null;
      if (persona && importe === null && !LICITA.test(tramo)) return;
      const nombre =
        nombreDe(linea.slice(inicio, h.desde)) ?? (j === 0 && i > 0 ? nombreDe(lineas[i - 1] ?? '') : null);
      porNif.set(h.nif, { nif: h.nif, nombre: persona ? null : nombre, importe, excluida: EXCLUSION.test(tramo) });
    });
  });
  return [...porNif.values()];
}

/** ¿Basta lo leído por código? Si están todas las ofertas que dice la PLACSP (sin ese dato, con dos ya hay competencia). */
export function bastaLectura(leidos: LicitadorLeido[], ofertas: number | null): boolean {
  return leidos.length >= Math.max(2, ofertas ?? 2);
}

export type DocumentoPublicado = { nombre: string; url: string; publicado: string | null };

/** El documento que mejor dice quién se presentó: el acta de valoración antes que el informe o la resolución. */
export function mejorActa<T extends DocumentoPublicado>(docs: T[]): T | null {
  const conRango = docs
    .map((d) => ({ d, rango: rangoActaDeNombre(d.nombre) }))
    .filter((x): x is { d: T; rango: number } => x.rango !== null);
  conRango.sort((a, b) => a.rango - b.rango || (b.d.publicado ?? '').localeCompare(a.d.publicado ?? ''));
  return conRango[0]?.d ?? null;
}

/** Texto en el que se busca un NIF que cita Hermes: solo letras y cifras, en mayúsculas. */
export function textoParaNif(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
