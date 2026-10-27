// El índice (relación numerada del contenido) de un sobre, como .docx.
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { EN_BLANCO } from '../../../nucleo/documentos/docx.js';

// Se genera con los documentos que de verdad van en la carpeta, así que no puede citar uno ausente ni el lote
// equivocado (una relación hecha a mano puede citar documentos que no están). El lugar es «a la fecha de la
// firma electrónica» y la firma queda en blanco: la pone una persona.
export type DatosIndice = {
  archivo: string;
  expediente: string;
  titulo: string;
  lote: string | null;
  empresa: { nombre: string | null; nif: string | null; municipio: string | null };
  documentos: { orden: number; nombre: string; archivo: string }[];
};

const parrafo = (texto: string, op: { negrita?: boolean; centrado?: boolean; antes?: number } = {}) =>
  new Paragraph({
    ...(op.centrado ? { alignment: AlignmentType.CENTER } : {}),
    spacing: { before: op.antes ?? 0, after: 120 },
    children: [new TextRun({ text: texto, bold: op.negrita ?? false })],
  });

const celda = (texto: string, negrita = false) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: texto, bold: negrita })] })] });

function tabla(docs: DatosIndice['documentos']): Table {
  const cabecera = new TableRow({
    tableHeader: true,
    children: [celda('Nº', true), celda('Documento', true), celda('Archivo', true)],
  });
  const filas = docs.map(
    (d) => new TableRow({ children: [celda(String(d.orden)), celda(d.nombre), celda(d.archivo)] }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [cabecera, ...filas] });
}

/** Las líneas de texto del índice (lo mismo que lleva el .docx), para comprobarlo sin abrirlo. */
function lineasIndice(d: DatosIndice): string[] {
  return [
    `Índice del ${d.archivo}`,
    `Expediente ${d.expediente}: ${d.titulo}`,
    ...(d.lote ? [`Lote ${d.lote}`] : []),
    `Licitador: ${d.empresa.nombre ?? EN_BLANCO} (NIF ${d.empresa.nif ?? EN_BLANCO})`,
    ...d.documentos.map((x) => `${x.orden}. ${x.nombre} — ${x.archivo}`),
    `En ${d.empresa.municipio ?? EN_BLANCO}, a la fecha de la firma electrónica.`,
    `Fdo.: ${EN_BLANCO}`,
  ];
}

/** El índice del sobre como .docx. */
export async function indiceDocx(d: DatosIndice): Promise<Buffer> {
  const [titulo, expediente, ...resto] = lineasIndice(d);
  const cabecera = resto.slice(0, d.lote ? 2 : 1);
  const cierre = resto.slice(-2);
  const doc = new Document({
    sections: [
      {
        children: [
          parrafo(titulo!, { negrita: true, centrado: true }),
          parrafo(expediente!),
          ...cabecera.map((l) => parrafo(l)),
          tabla(d.documentos),
          parrafo(cierre[0]!, { antes: 480 }),
          parrafo(cierre[1]!, { antes: 720 }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
