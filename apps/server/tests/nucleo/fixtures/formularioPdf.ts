// Un modelo de anexo en PDF con formulario, generado con pdf-lib: NIF y importe (texto), una
// casilla, un grupo de opciones, un desplegable, una firma y, si se pide, un campo de solo lectura.
import { PDFDocument, PDFString, StandardFonts } from 'pdf-lib';

// extras: campos de texto más (en la página 2); paginasExtra: páginas sin campos al final (otros anexos del pliego).
export type OpcionesFormulario = { soloLectura?: boolean; sinCampos?: boolean; texto?: string; extras?: string[]; paginasExtra?: number };

export async function pdfConFormulario(op: OpcionesFormulario = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  p1.drawText(op.texto ?? 'ANEXO VI. Declaración responsable del licitador', { x: 50, y: 790, size: 12, font: fuente });
  if (op.sinCampos) return Buffer.from(await doc.save());
  const form = doc.getForm();
  const caja = (y: number) => ({ x: 200, y, width: 200, height: 20 });
  form.createTextField('NIF').addToPage(p1, caja(740));
  form.createTextField('Importe').addToPage(p1, caja(700));
  form.createCheckBox('Acepta_condiciones').addToPage(p1, { x: 200, y: 660, width: 15, height: 15 });
  const radio = form.createRadioGroup('Tipo_empresa');
  radio.addOptionToPage('Pyme', p1, { x: 200, y: 620, width: 15, height: 15 });
  radio.addOptionToPage('Gran empresa', p1, { x: 260, y: 620, width: 15, height: 15 });
  const lista = form.createDropdown('Lote');
  lista.addOptions(['1', '2', '3']);
  lista.addToPage(p1, caja(580));
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Fdo.:', { x: 50, y: 700, size: 12, font: fuente });
  form.createTextField('Lugar').addToPage(p2, caja(740));
  if (op.soloLectura) {
    const fijo = form.createTextField('Expediente');
    fijo.addToPage(p2, caja(660));
    fijo.setText('17-26');
    fijo.enableReadOnly();
  }
  (op.extras ?? []).forEach((nombre, i) => form.createTextField(nombre).addToPage(p2, caja(540 - 40 * i)));
  for (let i = 0; i < (op.paginasExtra ?? 0); i += 1) doc.addPage([595, 842]);
  // pdf-lib no crea campos de firma: se añade el widget a mano.
  const firma = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Firma'), Rect: [200, 690, 400, 730], F: 4, P: p2.ref,
  }));
  form.acroForm.addField(firma);
  p2.node.addAnnot(firma);
  return Buffer.from(await doc.save());
}
