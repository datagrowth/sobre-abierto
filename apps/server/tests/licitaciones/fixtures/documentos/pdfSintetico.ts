// PDF de pliego sintéticos, como sale un pliego impreso a PDF: cada página es una lista de líneas
// (texto sin campos), en Helvetica de 9 puntos. Helvetica solo codifica WinAnsi: la viñeta «●»
// de algunos modelos (no es un elemento de lista para modeloPdf.ts, a diferencia de «•») va en
// ZapfDingbats con un ToUnicode que la devuelve como U+25CF, igual que en los pliegos de verdad.
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

const TAMANO = 9;
const INTERLINEA = 12;
const VINETA = '●';
// ZapfDingbats dibuja «●» con el código 0x6C («l»): sin ToUnicode, pdf.js lo leería como «l».
const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
  '1 begincodespacerange', '<00> <FF>', 'endcodespacerange', '1 beginbfchar', '<6C> <25CF>', 'endbfchar',
  'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
].join('\n');

/** Un PDF sin campos con una página por lista de líneas. */
export async function pdfDePaginas(paginas: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const simbolos = await doc.embedFont(StandardFonts.ZapfDingbats);
  for (const lineas of paginas) {
    const pagina = doc.addPage([595, 842]);
    lineas.forEach((linea, i) => {
      const y = 800 - i * INTERLINEA;
      if (!linea.startsWith(VINETA)) return pagina.drawText(linea, { x: 40, y, size: TAMANO, font: fuente });
      pagina.drawText(VINETA, { x: 40, y, size: TAMANO, font: simbolos });
      pagina.drawText(linea.slice(VINETA.length), { x: 40 + simbolos.widthOfTextAtSize(VINETA, TAMANO), y, size: TAMANO, font: fuente });
    });
  }
  // Tras dibujarlo todo: cada drawText vuelve a generar el diccionario de la fuente al guardar.
  await simbolos.embed();
  (doc.context.lookup(simbolos.ref) as PDFDict).set(PDFName.of('ToUnicode'), doc.context.register(doc.context.stream(TO_UNICODE)));
  return Buffer.from(await doc.save());
}
