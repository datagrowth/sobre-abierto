// Figuras de un documento dibujadas como código (SVG): diagramas de arquitectura, pantallas, calendarios.
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { errorMessage, fail, ok, type Result } from '../result.js';

// Llegan de un agente, así que se aceptan solo autocontenidas (sin scripts, sin recursos externos) y se
// rasterizan aquí a PNG para el .docx: Word y LibreOffice las pintan igual y el documento no depende de ningún
// servicio de imágenes.
export const SVG_MAX = 60_000;
// Ancho útil de la página (A4 con 2,5 cm de margen = 16 cm ≈ 453 pt) y de la imagen en Word.
const ANCHO_UTIL_PT = 453;
const ANCHO_PNG = 1600;
// Por debajo de esto el texto de la figura no se lee impreso.
export const LETRA_MINIMA_PT = 7;

const PROHIBIDO: [RegExp, string][] = [
  [/<script\b/i, 'scripts'],
  [/<foreignObject\b/i, 'foreignObject'],
  [/<(?:image|iframe|embed|object|use)\b[^>]*\b(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, 'imágenes o recursos externos'],
  [/<image\b/i, 'imágenes incrustadas'],
  [/<!(?:DOCTYPE|ENTITY)\b/i, 'DOCTYPE o entidades'],
  [/<[^>]*\son[a-z]+\s*=/i, 'atributos de evento (on…)'],
  [/javascript:/i, 'javascript:'],
  [/@import\b/i, '@import'],
  [/url\(\s*["']?\s*(?!#)/i, 'url() externas'],
];

const VIEWBOX = /<svg\b[^>]*\sviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i;

/** Ancho y alto del viewBox (null si no hay o no es válido). */
function dimensionesSvg(svg: string): { ancho: number; alto: number } | null {
  const m = VIEWBOX.exec(svg);
  const ancho = Number(m?.[3]);
  const alto = Number(m?.[4]);
  return m && ancho > 0 && alto > 0 ? { ancho, alto } : null;
}

/** Lo que impide aceptar una figura (vacío si se puede dibujar sin riesgo). */
export function erroresDeSvg(svg: string): string[] {
  const t = svg.trim();
  const forma =
    /^(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(t) && /<\/svg>$/i.test(t) ? [] : ['debe ser un único <svg>…</svg>'];
  const viewBox = dimensionesSvg(t) ? [] : ['necesita viewBox="0 0 ancho alto"'];
  const prohibido = PROHIBIDO.filter(([re]) => re.test(t)).map(([, nombre]) => `no admite ${nombre}`);
  return [...forma, ...viewBox, ...prohibido];
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (t: string) =>
  t
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTIDADES[n.toLowerCase()] ?? m);

/** El texto visible de la figura (rótulos de <text>), para revisarlo como el resto del apartado. */
export function textosDeSvg(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((m) =>
      decodificar(m[1]!.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** La letra más pequeña de la figura en puntos, ya a su tamaño en la página (null si no declara ninguna). */
export function letraMinimaPt(svg: string): number | null {
  const d = dimensionesSvg(svg);
  const tamanos = [...svg.matchAll(/font-size\s*[:=]\s*["']?\s*([\d.]+)/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0);
  if (!d || !tamanos.length) return null;
  return Math.round(Math.min(...tamanos) * (ANCHO_UTIL_PT / d.ancho) * 10) / 10;
}

/** Proporción alto/ancho (para estimar cuánto ocupa); 0,6 si no se puede leer. */
function proporcionSvg(svg: string): number {
  const d = dimensionesSvg(svg);
  return d ? d.alto / d.ancho : 0.6;
}

// En Word, a 96 px por pulgada: 600 px ≈ 15,9 cm (el ancho útil) y 820 px ≈ 21,7 cm de alto
// como mucho, para que quepa con su pie en el cuerpo de un A4 (24,7 cm).
const ANCHO_PX = 600;
const ALTO_MAX_PX = 820;
const ALTO_UTIL_PX = 933;

/** Tamaño de la figura en el documento, en píxeles de Word, sin deformarla. */
export function tamanoEnPagina(ancho: number, alto: number): { width: number; height: number } {
  const height = Math.round((ANCHO_PX * alto) / ancho);
  if (height <= ALTO_MAX_PX) return { width: ANCHO_PX, height };
  return { width: Math.round((ANCHO_PX * ALTO_MAX_PX) / height), height: ALTO_MAX_PX };
}

/** Parte de una página que ocupa una imagen de ese tamaño a todo el ancho útil. */
export function fraccionDeImagen(ancho: number, alto: number): number {
  return tamanoEnPagina(ancho, alto).height / ALTO_UTIL_PX;
}

/** Parte de una página que ocupa la figura (sin el pie). */
export function fraccionDePagina(svg: string): number {
  return Math.min(ANCHO_PX * proporcionSvg(svg), ALTO_MAX_PX) / ALTO_UTIL_PX;
}

export type Png = { png: Buffer; ancho: number; alto: number };

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(datos.length, 0);
  cab.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), datos])), 0);
  return Buffer.concat([cab, datos, crc]);
}

/**
 * PNG en RGB, sin canal alfa (el fondo blanco ya está pintado): LibreOffice, al pasar el .docx
 * a PDF, convierte el alfa de un PNG RGBA en una máscara vacía y la figura sale invisible.
 */
export function pngRgb(rgba: Buffer, ancho: number, alto: number): Buffer {
  const fila = 1 + ancho * 3;
  const crudo = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y += 1) {
    let o = y * fila + 1;
    for (let i = y * ancho * 4, fin = i + ancho * 4; i < fin; i += 4) {
      crudo[o++] = rgba[i]!;
      crudo[o++] = rgba[i + 1]!;
      crudo[o++] = rgba[i + 2]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.writeUInt8(8, 8); // 8 bits por canal
  ihdr.writeUInt8(2, 9); // color: RGB
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    firma,
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

/** La figura en PNG, con las fuentes del sistema (Liberation Sans en el servidor, métrica de Arial). */
export function svgAPng(svg: string): Result<Png> {
  const errores = erroresDeSvg(svg);
  if (errores.length) return fail('figura_invalida', errores.join('; '));
  try {
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: ANCHO_PNG },
      background: 'white',
      font: { loadSystemFonts: true, defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
    }).render();
    return ok({ png: pngRgb(r.pixels, r.width, r.height), ancho: r.width, alto: r.height });
  } catch (err) {
    return fail('figura_invalida', errorMessage(err));
  }
}
