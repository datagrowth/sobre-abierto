// Un documento de modelos sintético como los de la PLACSP: dos anexos («ANEXO VI»
// declaración responsable y «ANEXO VII» proposición económica) en un mismo .docx, con
// puntos suspensivos, «D./Dña. ……», «con NIF ……», «en representación de ……», casillas ☐
// en una tabla e «importe de …… euros». Varios huecos cruzan dos runs con formatos
// distintos, como deja Word al editar un modelo a trozos.
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

type Run = string | { text: string; bold?: boolean; italics?: boolean };
const parrafo = (...runs: Run[]) => new Paragraph({ children: runs.map((r) => new TextRun(typeof r === 'string' ? { text: r } : r)) });
const celda = (texto: string) => new TableCell({ children: [parrafo(texto)] });

const NIF = 'con NIF ……………';
const REPRESENTACION = 'en representación de ………………………';
export const DOMICILIO = 'con domicilio en ………………………';
const CUOTA = 'IGIC de …………';
export const ISO = '☐ Certificado ISO 14001';
export const DISCAPACIDAD = '☐ Plantilla con discapacidad igual o superior al 10 %';

/** Índices (1-based, como localizarHuecos) de los párrafos del documento. */
export const P = {
  anexo6: 1, declaracion: 2, nombre6: 3, lugar6: 4, firma6: 5,
  anexo7: 6, proposicion: 7, nombre7: 8, importe7: 9, iso: 10, discapacidad: 11, telefono: 12, lugar7: 13, firma7: 14,
} as const;

export async function modelosAnexos(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        parrafo({ text: 'ANEXO VI', bold: true }),
        parrafo('DECLARACIÓN RESPONSABLE DE NO ESTAR INCURSO EN PROHIBICIÓN DE CONTRATAR'),
        parrafo('D./Dña. ……………………', `, ${NIF}, actuando `, REPRESENTACION, ', declara que la empresa no está incursa en prohibición de contratar.'),
        parrafo('En ……………, a …… de ………… de 2026'),
        parrafo('Fdo.: ……………………'),
        parrafo({ text: 'ANEXO VII', bold: true }),
        parrafo('PROPOSICIÓN ECONÓMICA Y CRITERIOS AUTOMÁTICOS'),
        // «D./Dña. ……» + «……………» en negrita; «con NIF ……» + «………» en cursiva.
        parrafo('D./Dña. ……', { text: '………………', bold: true }, ', con NIF ……', { text: '………', italics: true }, `, ${REPRESENTACION}, ${DOMICILIO},`),
        parrafo('se compromete a ejecutar el contrato por un ', { text: 'importe de ………', bold: false }, { text: '…………', bold: true }, ` euros, IGIC excluido, al que corresponde un ${CUOTA} euros.`),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [celda(ISO)] }), new TableRow({ children: [celda(DISCAPACIDAD)] })] }),
        parrafo('Teléfono:'),
        parrafo('En ……………, a …… de ………… de 2026'),
        parrafo('Fdo.: ……………………'),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
