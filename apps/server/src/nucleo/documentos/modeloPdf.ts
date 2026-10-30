// Transcribir a .docx un modelo que viene dentro de un PDF sin campos. Puro y sin dominio.
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { errorMessage, fail, ok, type Result } from '../result.js';

// Es el anexo de un pliego impreso a PDF: texto por página, párrafos rehechos uniendo las líneas que el ancho
// partió y un .docx llano con el texto tal cual, para que localizarHuecos (rellenar.ts) vea los mismos huecos
// que el original. Qué tramo es el modelo lo decide quien llama.
export type ParrafoPdf = { indice: number; pagina: number; texto: string };

/** Texto de cada página por separado; falla con un mensaje claro si el PDF está roto, cifrado o escaneado. */
export async function paginasDePdf(bytes: Uint8Array): Promise<Result<string[]>> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0)
    return fail('invalid_input', 'No se puede leer el texto del PDF: el archivo está vacío.');
  let paginas: string[];
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    // Copia: pdf.js se queda con el buffer que recibe y lo deja inservible para quien llama.
    const proxy = await getDocumentProxy(new Uint8Array(bytes));
    try {
      paginas = (await extractText(proxy, { mergePages: false })).text;
    } finally {
      await proxy.loadingTask.destroy();
    }
  } catch (err) {
    return fail('invalid_input', `No se puede leer el texto del PDF: ${errorMessage(err)}`);
  }
  if (!paginas.some((p) => p.trim())) return fail('invalid_input', 'El PDF es una imagen escaneada: rellénalo a mano.');
  return ok(paginas);
}

// Caracteres de control que pdf.js deja a veces y que no caben en el XML del .docx.
// eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se descarta
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const normalizar = (linea: string) => linea.replace(CONTROL, '').replace(/\s+/gu, ' ').trim();

// Elementos de lista: «a)», «iv)», «(b)», «1.», «2.3», «1)», viñetas y casillas.
const ELEMENTO_LISTA = /^(?:\(?[a-zñ]{1,4}\)|\(?\d+(?:\.\d+)*[.)º]?(?:\s|$)|[-–—•·▪*](?:\s|$)|☐|\[ ?\]|\( ?\))/iu;
// La línea termina una frase o un hueco («……», «...», «___», casilla): lo que sigue es otro párrafo.
const CIERRE = /(?:[.:;]|…|_|☐|\[ ?\]|\( ?\))$/u;

function continua(anterior: string, siguiente: string): boolean {
  if (CIERRE.test(anterior)) return false;
  if (ELEMENTO_LISTA.test(siguiente)) return false;
  return /^\p{Ll}/u.test(siguiente);
}

function parrafosDePagina(texto: string): string[] {
  const parrafos: string[] = [];
  let actual: string | null = null;
  for (const linea of texto.split(/\r?\n/u).map(normalizar)) {
    if (!linea) {
      if (actual) parrafos.push(actual);
      actual = null;
      continue;
    }
    if (actual && continua(actual, linea)) {
      actual = `${actual} ${linea}`;
      continue;
    }
    if (actual) parrafos.push(actual);
    actual = linea;
  }
  if (actual) parrafos.push(actual);
  return parrafos;
}

/** Párrafos de las páginas (numerados desde 1): une las líneas partidas por el ancho, nunca los elementos de lista. */
export function parrafosDePaginas(paginas: string[]): ParrafoPdf[] {
  const salida: ParrafoPdf[] = [];
  paginas.forEach((texto, i) => {
    for (const p of parrafosDePagina(texto ?? '')) salida.push({ indice: salida.length + 1, pagina: i + 1, texto: p });
  });
  return salida;
}

/** Un .docx con un párrafo por ParrafoPdf, Arial 11 y sin estilos, con el texto tal cual. */
export async function docxDeParrafos(parrafos: ParrafoPdf[], titulo: string): Promise<Result<Buffer>> {
  if (!Array.isArray(parrafos) || parrafos.some((p) => typeof p?.texto !== 'string'))
    return fail('invalid_input', 'Los párrafos del modelo no son válidos.');
  try {
    const doc = new Document({
      title: titulo.trim() || 'Modelo transcrito',
      sections: [
        {
          children: parrafos.map(
            (p) => new Paragraph({ children: [new TextRun({ text: p.texto, font: 'Arial', size: 22 })] }),
          ),
        },
      ],
    });
    return ok(Buffer.from(await Packer.toBuffer(doc)));
  } catch (err) {
    return fail('docx_error', `No se pudo generar el .docx del modelo: ${errorMessage(err)}`);
  }
}
