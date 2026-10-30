// El contenido de un .docx en el orden del documento: párrafos, tablas e imágenes. Puro.
import { strFromU8 } from 'fflate';
import { fail, ok, type Result } from '../result.js';
import { abrir, arbol, cuerpo, hijo, trozosDe, type Nodo } from './rellenar.js';

// Sirve para leer una memoria que una persona editó en Word sin perder sus tablas ni sus imágenes. Los párrafos
// llevan si son de lista y si llevan imágenes; las tablas, sus filas de celdas de texto.
// marcado: el texto con su **negrita** y *cursiva*; numerada: una lista numerada (no de viñetas).
export type ParrafoDocx = {
  tipo: 'parrafo';
  texto: string;
  marcado: string;
  lista: boolean;
  numerada: boolean;
  titulo: boolean;
  imagenes: string[];
};
type TablaDocx = { tipo: 'tabla'; filas: string[][] };
export type ElementoDocx = ParrafoDocx | TablaDocx;
export type ImagenDocx = { datos: Buffer; tipo: 'png' | 'jpg' };
export type ContenidoDocx = { elementos: ElementoDocx[]; imagenes: Map<string, ImagenDocx> };

const RELACIONES = 'word/_rels/document.xml.rels';
const NUMERACION = 'word/numbering.xml';
const NUMERICOS = new Set(['decimal', 'decimalZero', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman']);

const atributo = (xml: string, n: Nodo, nombre: string): string | null => {
  const m = new RegExp(`\\s${nombre.replace(':', '\\:')}="([^"]*)"`).exec(xml.slice(n.inicio, n.finApertura));
  return m ? m[1]! : null;
};

function descendientes(n: Nodo, nombre: string, out: Nodo[] = []): Nodo[] {
  for (const h of n.hijos) {
    if (h.nombre === nombre) out.push(h);
    descendientes(h, nombre, out);
  }
  return out;
}

const textoDe = (n: Nodo, xml: string) =>
  trozosDe(n, xml, [])
    .map((t) => t.texto)
    .join('');

/** De cada numId de numbering.xml, si su primer nivel numera (1., a), i.) o pone viñetas. */
function numeracionesDe(numbering: string): Map<string, boolean> {
  const abstractas = new Map<string, boolean>();
  for (const m of numbering.matchAll(
    /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  )) {
    const fmt = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="(\w+)"/.exec(m[2]!)?.[1] ?? '';
    abstractas.set(m[1]!, NUMERICOS.has(fmt));
  }
  const out = new Map<string, boolean>();
  for (const m of numbering.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g))
    out.set(m[1]!, abstractas.get(m[2]!) ?? false);
  return out;
}

const activo = (xml: string, rPr: Nodo | null | undefined, etiqueta: string): boolean => {
  const n = rPr ? hijo(rPr, etiqueta) : null;
  return Boolean(n) && !['0', 'false', 'none'].includes(atributo(xml, n!, 'w:val') ?? '');
};

// Las marcas, por fuera de los espacios: «**hito**» y no «** hito **».
const marcar = (t: string, m: string) => (t.trim() ? t.replace(/^(\s*)(.*?)(\s*)$/s, `$1${m}$2${m}$3`) : t);

/** El texto de un párrafo con la negrita y la cursiva de sus fragmentos en Markdown restringido. */
function marcadoDe(p: Nodo, xml: string): string {
  const trozos: { texto: string; b: boolean; i: boolean }[] = [];
  for (const r of descendientes(p, 'w:r')) {
    const rPr = hijo(r, 'w:rPr');
    const t = { texto: textoDe(r, xml), b: activo(xml, rPr, 'w:b'), i: activo(xml, rPr, 'w:i') };
    const ultimo = trozos.at(-1);
    if (ultimo && ultimo.b === t.b && ultimo.i === t.i) ultimo.texto += t.texto;
    else trozos.push(t);
  }
  return trozos
    .map((t) => (t.b ? marcar(t.texto, '**') : t.i ? marcar(t.texto, '*') : t.texto))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lista: numeración de Word (w:numPr) o un estilo de lista; numerada, si su numeración cuenta;
// título: un estilo de título.
function parrafo(p: Nodo, xml: string, numeraciones: Map<string, boolean>): ParrafoDocx {
  const pPr = hijo(p, 'w:pPr');
  const estilo = (pPr && hijo(pPr, 'w:pStyle') && atributo(xml, hijo(pPr, 'w:pStyle')!, 'w:val')) ?? '';
  const numPr = pPr ? hijo(pPr, 'w:numPr') : null;
  const numId = numPr && hijo(numPr, 'w:numId') ? atributo(xml, hijo(numPr, 'w:numId')!, 'w:val') : null;
  const lista = Boolean(numPr) || /list|lista|vi[ñn]eta|bullet/i.test(estilo);
  const imagenes = descendientes(p, 'a:blip')
    .map((b) => atributo(xml, b, 'r:embed'))
    .filter((x): x is string => Boolean(x));
  return {
    tipo: 'parrafo',
    texto: textoDe(p, xml).replace(/\s+/g, ' ').trim(),
    marcado: marcadoDe(p, xml),
    lista,
    numerada: numId !== null && (numeraciones.get(numId) ?? false),
    titulo: /^(heading|t[íi]tulo)/i.test(estilo),
    imagenes,
  };
}

// Cada celda, con el texto de todos sus párrafos (unidos por un salto de línea).
function tabla(t: Nodo, xml: string): TablaDocx {
  const filas = t.hijos
    .filter((h) => h.nombre === 'w:tr')
    .map((tr) =>
      tr.hijos
        .filter((h) => h.nombre === 'w:tc')
        .map((tc) =>
          descendientes(tc, 'w:p')
            .map((p) => textoDe(p, xml).trim())
            .filter(Boolean)
            .join('\n'),
        ),
    );
  return { tipo: 'tabla', filas: filas.filter((f) => f.some(Boolean)) };
}

function imagenesDe(archivos: Record<string, Uint8Array>): Map<string, ImagenDocx> {
  const rels = archivos[RELACIONES] ? strFromU8(archivos[RELACIONES]) : '';
  const out = new Map<string, ImagenDocx>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const destino = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (!id || !destino || !/\/image"/.test(m[0])) continue;
    const ruta = destino.startsWith('/') ? destino.slice(1) : `word/${destino.replace(/^\.\//, '')}`;
    const datos = archivos[ruta];
    const ext = ruta.split('.').pop()?.toLowerCase();
    if (datos && (ext === 'png' || ext === 'jpg' || ext === 'jpeg'))
      out.set(id, { datos: Buffer.from(datos), tipo: ext === 'png' ? 'png' : 'jpg' });
  }
  return out;
}

/** Párrafos y tablas del cuerpo, en orden, con las imágenes PNG o JPEG que usan. */
export function contenidoDocx(docx: Uint8Array): Result<ContenidoDocx> {
  const p = abrir(docx);
  if (p.error) return p;
  const body = cuerpo(p.data.xml) ?? arbol(p.data.xml).find((n) => n.nombre === 'w:body');
  if (!body) return fail('docx_invalido', 'El documento no tiene cuerpo (word/document.xml sin w:body).');
  const numeraciones = numeracionesDe(p.data.archivos[NUMERACION] ? strFromU8(p.data.archivos[NUMERACION]) : '');
  const elementos = body.hijos.flatMap((h): ElementoDocx[] => {
    if (h.nombre === 'w:p') return [parrafo(h, p.data.xml, numeraciones)];
    if (h.nombre === 'w:tbl') return [tabla(h, p.data.xml)];
    // Contenido envuelto (control de contenido, w:sdt): sus párrafos, en orden.
    return descendientes(h, 'w:p').map((x) => parrafo(x, p.data.xml, numeraciones));
  });
  return ok({ elementos, imagenes: imagenesDe(p.data.archivos) });
}

/** Ancho y alto en píxeles de un PNG o un JPEG (null si no se puede leer). */
export function dimensionesImagen(i: ImagenDocx): { ancho: number; alto: number } | null {
  const b = i.datos;
  if (i.tipo === 'png') return b.length >= 24 ? { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) } : null;
  for (let k = 2; k + 9 < b.length;) {
    if (b[k] !== 0xff) return null;
    const marca = b[k + 1]!;
    const largo = b.readUInt16BE(k + 2);
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc)
      return { alto: b.readUInt16BE(k + 5), ancho: b.readUInt16BE(k + 7) };
    k += 2 + largo;
  }
  return null;
}
