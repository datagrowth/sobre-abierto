// Páginas reales de una memoria: el .docx pasa a PDF con LibreOffice y se cuentan y leen sus páginas.
import { errorMessage, fail, ok, type Result } from '../result.js';
import { estimarPaginas, generarDocx, tituloApartado, type Apartado, type Memoria } from './docx.js';
import { convertirBytes, disponible } from './libreoffice.js';

export type PaginasPdf = { paginas: number; pdf: Buffer; porPagina: string[] };

// El índice se hace por pasadas (sin páginas → PDF → con páginas → PDF… hasta que no cambian) para no dejar un
// campo de tabla de contenido que Word pide actualizar al abrir el documento.
/** PDF del .docx con el número de páginas y el texto de cada una. */
export async function paginasDe(docx: Buffer): Promise<Result<PaginasPdf>> {
  const pdf = await convertirBytes(docx, '.docx', 'pdf');
  if (pdf.error) return pdf;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const proxy = await getDocumentProxy(new Uint8Array(pdf.data));
    try {
      const { text } = await extractText(proxy, { mergePages: false });
      return ok({ paginas: proxy.numPages, pdf: pdf.data, porPagina: text });
    } finally {
      await proxy.loadingTask.destroy();
    }
  } catch (err) {
    return fail('pdf_ilegible', `No se pudo leer el PDF generado: ${errorMessage(err)}`);
  }
}

// Sin tildes, espacios ni mayúsculas: el PDF parte los títulos en líneas y pdf.js los junta a su manera.
const clave = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();

export type Localizacion = { previas: number; paginas: Record<string, number>; faltan: string[] };

/**
 * Página del cuerpo en que empieza cada apartado. El índice lista todos los títulos, así que
 * el cuerpo empieza tras la página donde aparece por primera vez el último título; entre el
 * índice y el cuerpo puede haber páginas de más (la tabla guía de la memoria), así que el cuerpo
 * empieza donde sale por primera vez el título del primer apartado. Las páginas anteriores
 * (portada, índice y guía) no cuentan.
 */
export function localizarApartados(
  apartados: Pick<Apartado, 'numero' | 'titulo'>[],
  porPagina: string[],
): Localizacion {
  const textos = porPagina.map(clave);
  const ultimo = apartados.at(-1);
  const finIndice = ultimo ? textos.findIndex((t) => t.includes(clave(tituloApartado(ultimo)))) : -1;
  if (finIndice === -1) return { previas: 0, paginas: {}, faltan: apartados.map((a) => a.numero) };
  const paginas: Record<string, number> = {};
  const faltan: string[] = [];
  const primero = clave(tituloApartado(apartados[0]!));
  const delCuerpo = textos.findIndex((t, k) => k > finIndice && t.includes(primero));
  const inicio = delCuerpo === -1 ? finIndice + 1 : delCuerpo;
  let desde = inicio;
  for (const a of apartados) {
    const titulo = clave(tituloApartado(a));
    const i = textos.findIndex((t, k) => k >= desde && t.includes(titulo));
    if (i === -1) {
      faltan.push(a.numero);
      continue;
    }
    paginas[a.numero] = i - inicio + 1;
    desde = i;
  }
  return { previas: inicio, paginas, faltan };
}

export type MemoriaGenerada = {
  docx: Buffer;
  pdf: Buffer | null;
  paginas: number | null;
  paginas_estimadas: number;
  indice: Record<string, number> | null;
  aviso: string | null;
};

const AVISO_CONVERSOR = {
  ausente:
    'Sin LibreOffice en el servidor: el índice va sin páginas y las páginas son una estimación (ver docs/operar/biblioteca.md → Documentos: LibreOffice).',
  apagado:
    'LibreOffice está apagado (LIBREOFFICE_ACTIVO=0): el índice va sin páginas y las páginas son una estimación.',
} as const;

function sinPdf(
  docx: Buffer,
  estimadas: number,
  aviso: string,
  indice: Record<string, number> | null = null,
): MemoriaGenerada {
  return { docx, pdf: null, paginas: null, paginas_estimadas: estimadas, indice, aviso };
}

/** Convierte el .docx a PDF y lo lee; en los tests, uno que no necesita LibreOffice. */
export type Medidor = (docx: Buffer) => Promise<Result<PaginasPdf>>;

// Poner las páginas en el índice puede mover lo medido sin ellas (un título que parte línea
// alarga el índice), así que se vuelve a medir con ellas puestas hasta que no cambian.
export const MAX_PASADAS = 3;

const mismas = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

// Páginas del cuerpo (PDF menos portada, índice y guía) para el «Página N de M» del pie; sin
// apartados localizados no hay cuerpo que contar y el pie queda sin total.
type ConTotal = Localizacion & { total?: number };
const conTotal = (l: Localizacion, paginasPdf: number): ConTotal =>
  l.previas > 0 && paginasPdf > l.previas ? { ...l, total: paginasPdf - l.previas } : l;

type Pasada = { escrita: ConTotal; medida: ConTotal; pdf: PaginasPdf; estable: boolean };

function definitiva(docx: Buffer, p: Pasada, estimadas: number): MemoriaGenerada {
  const avisos = [
    p.escrita.faltan.length
      ? `No se localizaron en el PDF los apartados ${p.escrita.faltan.join(', ')}: el índice no trae su página.`
      : null,
    p.estable
      ? null
      : `La paginación siguió cambiando tras ${MAX_PASADAS} pasadas con el índice: puede desviarse una página.`,
  ].filter((a): a is string => a !== null);
  return {
    docx,
    pdf: p.pdf.pdf,
    paginas: p.pdf.paginas - p.medida.previas,
    paginas_estimadas: estimadas,
    indice: p.escrita.paginas,
    aviso: avisos.length ? avisos.join(' ') : null,
  };
}

/**
 * Cada pasada escribe en el índice la última medida y vuelve a medir, hasta que coinciden o
 * se llega a MAX_PASADAS. Se entrega el documento de la última pasada con el índice que lleva.
 */
export async function pasadasConIndice(
  m: Memoria,
  primera: ConTotal,
  estimadas: number,
  medir: Medidor = paginasDe,
): Promise<MemoriaGenerada> {
  let escrita = primera;
  for (let pasada = 1; ; pasada += 1) {
    const docx = await generarDocx({
      ...m,
      indice: { paginas: escrita.paginas, ...(escrita.total ? { total_cuerpo: escrita.total } : {}) },
    });
    const pdf = await medir(docx);
    if (pdf.error)
      return sinPdf(docx, estimadas, `No se pudo generar el PDF definitivo: ${pdf.error.message}`, escrita.paginas);
    const medida = conTotal(localizarApartados(m.apartados, pdf.data.porPagina), pdf.data.paginas);
    const estable = mismas(medida.paginas, escrita.paginas) && medida.total === escrita.total;
    if (estable || pasada === MAX_PASADAS)
      return definitiva(docx, { escrita, medida, pdf: pdf.data, estable }, estimadas);
    escrita = medida;
  }
}

/**
 * Con LibreOffice: una pasada sin páginas y las necesarias con ellas (índice con páginas
 * reales + PDF); sin él, docx con índice sin páginas, pdf null y paginas null. Nunca lanza:
 * si ni el docx se pudo generar, llega vacío con el motivo en `aviso`.
 */
export async function generarMemoriaCompleta(m: Memoria): Promise<MemoriaGenerada> {
  const estimadas = estimarPaginas(m).paginas;
  try {
    const sinPaginas = await generarDocx({ ...m, indice: {} });
    const conversor = await disponible();
    if (conversor.estado !== 'ok') return sinPdf(sinPaginas, estimadas, AVISO_CONVERSOR[conversor.estado]);
    const p1 = await paginasDe(sinPaginas);
    if (p1.error) return sinPdf(sinPaginas, estimadas, `No se pudo generar el PDF: ${p1.error.message}`);
    return await pasadasConIndice(
      m,
      conTotal(localizarApartados(m.apartados, p1.data.porPagina), p1.data.paginas),
      estimadas,
    );
  } catch (err) {
    return sinPdf(Buffer.alloc(0), estimadas, `No se pudo generar el documento: ${errorMessage(err)}`);
  }
}
