// Modelos de anexo en PDF sin campos, generados con pdf-lib línea a línea, como sale un pliego
// impreso a PDF: cada página es una lista de líneas (vacía = página en blanco).
import { PDFDocument, StandardFonts } from 'pdf-lib';

export async function pdfDeLineas(paginas: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const lineas of paginas) {
    const pagina = doc.addPage([595, 842]);
    lineas.forEach((linea, i) => pagina.drawText(linea, { x: 50, y: 790 - i * 16, size: 11, font: fuente }));
  }
  return Buffer.from(await doc.save());
}

// Un escaneado: la página solo lleva dibujo, ningún texto.
export async function pdfEscaneado(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 495, height: 742, borderWidth: 1 });
  return Buffer.from(await doc.save());
}

// Helvetica de pdf-lib solo codifica WinAnsi: las casillas van como «[ ]» y «( )»; «☐» se prueba sin PDF.
export const MODELO_ANEXO: string[][] = [
  [
    'ANEXO II. MODELO DE DECLARACIÓN RESPONSABLE',
    'D./Dña. ................................ con NIF ____________, en nombre y',
    'representación de la empresa …………………, con domicilio en',
    'la calle ........................',
    'DECLARA:',
    'a) que la empresa cumple los requisitos',
    'b) que no está incursa en prohibición',
    '1. Que acepta el pliego',
    '- Que se somete a los juzgados',
    '[ ] Pyme',
    '( ) Gran empresa',
  ],
  ['En ........, a ..... de .......... de 2026', 'Fdo.:'],
];
