// Un modelo PDF que es una TABLA DE REQUISITOS sin huecos: se rehace como un .docx propio.
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { ParrafoPdf } from '../../../nucleo/documentos/modeloPdf.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';

// Por ejemplo, páginas de requisitos de seguridad cuyas celdas de «Cumplimiento» vacías no salen en el texto del
// PDF: no se puede transcribir tal cual porque no hay nada que rellenar. Se reconoce de forma conservadora
// (cabecera «Requisito … Cumplimiento» y filas numeradas «1.1 …») y se rehace con una fila por requisito con su
// texto literal y su página, y dos huecos: «Cumplimiento» y «Evidencia/fuente». Ese .docx es el modelo
// «transcrito» y se rellena por el camino Word. Si algo no cuadra, no es una tabla: el modelo sigue «a mano».
/** El aviso del borrador (y el motivo guardado en modelos_pdf) de un modelo generado a partir de la tabla. */
export const AVISO_TABLA =
  'Documento generado a partir de la tabla del pliego: compruébalo con el original antes de firmar.';
/** Con menos filas numeradas no se da por tabla de requisitos. */
const MIN_REQUISITOS = 3;
/** El hueco de cada celda que se rellena: «……» es lo que localizarHuecos (rellenar.ts) reconoce. */
export const HUECO_CELDA = '……………………';
export const COLUMNA_EVIDENCIA = 'Evidencia/fuente';

type FilaRequisito =
  { tipo: 'seccion'; texto: string } | { tipo: 'requisito'; id: string; lineas: string[]; pagina: number };
export type TablaRequisitos = { antes: string[]; columna: string; filas: FilaRequisito[]; despues: string[] };

const ENCABEZADO = /^(?:id\s+)?requisitos?\b/iu;
const CUMPLIMIENTO = /^cumplimiento\b/iu;
const REQUISITO = /^(\d{1,2}\.\d{1,2})\s+\S/u;
// «1. ORGANIZACIÓN DE LA SEGURIDAD»: sin minúsculas («1. Cuando la información…» es texto de una fila).
const SECCION = /^\d{1,2}\.\s+[^\p{Ll}]+$/u;
// La firma («Fdo y sellado», «Firma:», «(Fecha y firma)») o el lugar y fecha con forma de fecha
// («En Madrid, a 12 de octubre de 2026», «En ……, a …… de …… de 20…»): «En los sistemas…, a través
// de…» es texto de una fila.
const HUECO_FECHA = '[.…_]{2,}';
const CIERRE = new RegExp(
  `^(?:fdo\\b|firma(?:do)?(?:\\s+y\\s+sell\\w+)?\\s*[:.]?$|\\(fecha y firma\\)|en\\s+[^,]{1,40},\\s*a\\s+(?:\\d{1,2}|${HUECO_FECHA})\\s+de\\s+(?:\\p{L}{3,}|${HUECO_FECHA})\\s+de\\b)`,
  'iu',
);
const MAX_LINEAS_CABECERA = 6;

type Encabezado = { largo: number; columna: string; resto: string };

// La cabecera de la tabla que empieza en ps[i] («ID Requisito Descripción», «Cumplimiento», «(Sí / No /»,
// …, «Aplica)»), en la misma página. `resto` es lo que el PDF pegó detrás del «)»: el texto de la fila
// que sigue de la página anterior.
function encabezadoEn(ps: ParrafoPdf[], i: number): Encabezado | null {
  const p = ps[i];
  if (!p || !ENCABEZADO.test(p.texto)) return null;
  const c = [i + 1, i + 2].find((j) => ps[j]?.pagina === p.pagina && CUMPLIMIENTO.test(ps[j]!.texto));
  if (c === undefined) return null;
  let texto = ps[c]!.texto;
  let j = c;
  // Las opciones («(Sí / No / …)») pueden ir en la línea siguiente.
  if (ps[j + 1]?.pagina === p.pagina && ps[j + 1]!.texto.startsWith('(')) texto = `${texto} ${ps[++j]!.texto}`;
  const abierto = () => texto.includes('(') && !texto.slice(texto.indexOf('(')).includes(')');
  while (abierto() && j - i < MAX_LINEAS_CABECERA && ps[j + 1]?.pagina === p.pagina)
    texto = `${texto} ${ps[++j]!.texto}`;
  if (abierto()) return null;
  const fin = texto.includes('(') ? texto.indexOf(')', texto.indexOf('(')) + 1 : texto.length;
  return { largo: j - i + 1, columna: texto.slice(0, fin).trim(), resto: texto.slice(fin).trim() };
}

// Las líneas de la tabla sin la cabecera repetida de cada página ni lo que va antes en esa página
// («Expediente …», «- 147 -»). Una página sin la cabecera repetida se toma entera.
function cuerpoDeTabla(ps: ParrafoPdf[], inicio: number): ParrafoPdf[] {
  const out: ParrafoPdf[] = [];
  let i = inicio;
  while (i < ps.length) {
    const enc = i === inicio || ps[i]!.pagina !== ps[i - 1]!.pagina ? cabeceraDePagina(ps, i) : null;
    if (!enc) {
      out.push(ps[i]!);
      i++;
      continue;
    }
    if (enc.resto) out.push({ ...ps[enc.desde + enc.largo - 1]!, texto: enc.resto });
    i = enc.desde + enc.largo;
  }
  return out;
}

// La cabecera repetida de la página que empieza en ps[i], si está entre sus primeras líneas.
function cabeceraDePagina(ps: ParrafoPdf[], i: number): (Encabezado & { desde: number }) | null {
  for (let j = i; j < i + 3 && ps[j]?.pagina === ps[i]!.pagina; j++) {
    const enc = encabezadoEn(ps, j);
    if (enc) return { ...enc, desde: j };
  }
  return null;
}

type Lectura = { filas: FilaRequisito[]; despues: string[] } | null;

// Filas: sección, requisito numerado o continuación de la fila anterior; desde la firma, el cierre.
// El cierre va detrás de la última fila numerada: lo que parece firma antes de ella es texto de una
// fila (si no, los requisitos que siguen saldrían sin huecos).
function filasDe(cuerpo: ParrafoPdf[]): Lectura {
  const filas: FilaRequisito[] = [];
  const ultimaNumerada = cuerpo.reduce((u, x, n) => (REQUISITO.test(x.texto) ? n : u), -1);
  for (const [n, p] of cuerpo.entries()) {
    if (n > ultimaNumerada && CIERRE.test(p.texto)) return { filas, despues: cuerpo.slice(n).map((x) => x.texto) };
    const id = REQUISITO.exec(p.texto)?.[1];
    const ultima = filas.at(-1);
    if (id) filas.push({ tipo: 'requisito', id, lineas: [p.texto], pagina: p.pagina });
    else if (SECCION.test(p.texto)) filas.push({ tipo: 'seccion', texto: p.texto });
    else if (ultima?.tipo === 'requisito') ultima.lineas.push(p.texto);
    else if (ultima) ultima.texto = `${ultima.texto} ${p.texto}`;
    else return null;
  }
  return { filas, despues: [] };
}

/**
 * La tabla de requisitos del tramo de un modelo (sus párrafos del PDF, desde el título), o null si
 * no lo es: hace falta la cabecera con «Requisito» y «Cumplimiento» y al menos MIN_REQUISITOS
 * filas numeradas sin repetir.
 */
export function tablaDeRequisitos(ps: ParrafoPdf[]): TablaRequisitos | null {
  const inicio = ps.findIndex((_, i) => encabezadoEn(ps, i) !== null);
  if (inicio < 0) return null;
  const leidas = filasDe(cuerpoDeTabla(ps, inicio));
  if (!leidas) return null;
  const ids = leidas.filas.flatMap((f) => (f.tipo === 'requisito' ? [f.id] : []));
  if (ids.length < MIN_REQUISITOS || new Set(ids).size !== ids.length) return null;
  return { antes: ps.slice(0, inicio).map((p) => p.texto), columna: encabezadoEn(ps, inicio)!.columna, ...leidas };
}

// ── El .docx ──

const texto = (t: string, negrita = false) =>
  new Paragraph({ children: [new TextRun({ text: t, font: 'Arial', size: 22, bold: negrita })] });
const celda = (parrafos: Paragraph[], ancho: number, columnas = 1) =>
  new TableCell({ children: parrafos, columnSpan: columnas, width: { size: ancho, type: WidthType.PERCENTAGE } });

function filaDocx(f: FilaRequisito): TableRow {
  if (f.tipo === 'seccion') return new TableRow({ children: [celda([texto(f.texto, true)], 100, 3)] });
  const requisito = [...f.lineas.map((l) => texto(l)), texto(`(pág. ${f.pagina})`)];
  return new TableRow({
    children: [celda(requisito, 55), celda([texto(HUECO_CELDA)], 20), celda([texto(HUECO_CELDA)], 25)],
  });
}

/** El .docx del modelo: lo de antes de la tabla tal cual, una fila por requisito (texto, «Cumplimiento», «Evidencia/fuente») y el cierre. */
export async function docxDeTablaRequisitos(t: TablaRequisitos, titulo: string): Promise<Result<Buffer>> {
  try {
    const cabecera = new TableRow({
      tableHeader: true,
      children: [
        celda([texto('Requisito', true)], 55),
        celda([texto(t.columna, true)], 20),
        celda([texto(COLUMNA_EVIDENCIA, true)], 25),
      ],
    });
    const tabla = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [cabecera, ...t.filas.map(filaDocx)],
    });
    const doc = new Document({
      title: titulo.trim() || 'Tabla de requisitos',
      sections: [{ children: [...t.antes.map((l) => texto(l)), tabla, ...t.despues.map((l) => texto(l))] }],
    });
    return ok(Buffer.from(await Packer.toBuffer(doc)));
  } catch (err) {
    return fail('docx_error', `No se pudo generar el .docx de la tabla de requisitos: ${errorMessage(err)}`);
  }
}
