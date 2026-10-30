// Formularios PDF (AcroForm) de los modelos de los pliegos: listar sus campos y rellenarlos sin aplanar. Puro.
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFFont,
  PDFName,
  PDFObject,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from 'pdf-lib';
import { errorMessage, fail, ok, type Result } from '../result.js';

// Se rellenan sin aplanar, para que una persona pueda corregirlos. Los campos de firma no se tocan nunca (la
// firma la pone una persona con su certificado) y un campo de solo lectura tampoco. Un PDF cifrado o con
// formulario XFA (dinámico) no se puede rellenar y se dice por qué.
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_CAMPOS = 3000;
// Nodos del árbol de campos (campos y grupos) que se recorren antes de fiarse de pdf-lib.
const MAX_NODOS = 5_000;

type TipoCampoPdf = 'texto' | 'casilla' | 'radio' | 'desplegable' | 'lista' | 'firma' | 'boton';
/** valor: texto, casilla marcada o no, o la opción elegida (varias en una lista, separadas por «; »); null si no hay. */
export type CampoPdf = {
  nombre: string;
  tipo: TipoCampoPdf;
  opciones: string[];
  pagina: number | null;
  valor: string | boolean | null;
  solo_lectura: boolean;
  es_firma: boolean;
};
export type ValorPdf = { nombre: string; valor: string | boolean };
export type PdfRelleno = { pdf: Buffer; aplicados: number; no_encontrados: string[] };
export type FormularioPdf = { campos: CampoPdf[]; paginas: number };

async function cargar(bytes: Uint8Array): Promise<Result<PDFDocument>> {
  if (bytes.length > MAX_PDF_BYTES) return fail('invalid_input', 'El PDF es demasiado grande (más de 30 MB).');
  if (!Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-'))
    return fail('invalid_input', 'No se puede leer el PDF: no es un PDF válido.');
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    // Con una cabecera «%PDF-» pero sin cuerpo, pdf-lib no falla: devuelve un documento sin catálogo.
    if (!doc.context.trailerInfo.Root)
      return fail('invalid_input', 'No se puede leer el PDF: está dañado o no es un PDF válido.');
    const xfa = doc.catalog.lookup(PDFName.of('AcroForm'))?.toString().includes('/XFA');
    if (xfa)
      return fail(
        'invalid_input',
        'El PDF tiene un formulario XFA (dinámico): no se puede rellenar; rellénalo a mano.',
      );
    return ok(doc);
  } catch (err) {
    const cifrado = /encrypt/i.test(errorMessage(err));
    return fail(
      'invalid_input',
      cifrado
        ? 'El PDF está protegido con contraseña: no se puede rellenar; rellénalo a mano.'
        : `No se puede leer el PDF: ${errorMessage(err).slice(0, 200)}`,
    );
  }
}

// pdf-lib recorre el árbol de campos sin recordar lo visto: un PDF con el mismo nodo en dos «Kids»,
// encadenado, lo hace exponencial (23 niveles tardan 19 s y 30, más de 40 min). Se comprueba antes,
// con un recorrido propio que rechaza los nodos repetidos y pone tope al tamaño.
function arbolDeCampos(doc: PDFDocument): string | null {
  const raiz = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!raiz) return null;
  const vistos = new Set<PDFRef>();
  const pila: PDFObject[] = [...raiz.asArray()];
  let nodos = 0;
  while (pila.length) {
    const nodo = pila.pop()!;
    nodos += 1;
    if (nodos > MAX_NODOS) return `El formulario tiene demasiados campos (más de ${MAX_NODOS} nodos).`;
    if (nodo instanceof PDFRef) {
      if (vistos.has(nodo))
        return 'El formulario tiene una estructura no válida (campos repetidos): no se puede rellenar.';
      vistos.add(nodo);
    }
    const hijos = doc.context.lookupMaybe(nodo, PDFDict)?.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (hijos) pila.push(...hijos.asArray());
  }
  return null;
}

// La página (1, 2…) de cada campo: la del primer widget que la tenga, mirando las anotaciones de cada página.
function paginasDeWidgets(doc: PDFDocument): Map<PDFRef, number> {
  const mapa = new Map<PDFRef, number>();
  doc.getPages().forEach((p, i) => {
    for (const ref of p.node.Annots()?.asArray() ?? []) if (ref instanceof PDFRef) mapa.set(ref, i + 1);
  });
  return mapa;
}

// Qué referencia tiene cada diccionario, de una vez: getObjectRef de pdf-lib barre todos los objetos en cada llamada.
function referencias(doc: PDFDocument): Map<PDFObject, PDFRef> {
  return new Map([...doc.context.enumerateIndirectObjects()].map(([ref, obj]) => [obj, ref]));
}

function tipoDe(f: PDFField): TipoCampoPdf {
  if (f instanceof PDFTextField) return 'texto';
  if (f instanceof PDFCheckBox) return 'casilla';
  if (f instanceof PDFRadioGroup) return 'radio';
  if (f instanceof PDFDropdown) return 'desplegable';
  if (f instanceof PDFOptionList) return 'lista';
  if (f instanceof PDFSignature) return 'firma';
  return 'boton';
}

function valorDe(f: PDFField): string | boolean | null {
  if (f instanceof PDFTextField) return f.getText() ?? null;
  if (f instanceof PDFCheckBox) return f.isChecked();
  if (f instanceof PDFRadioGroup) return f.getSelected() ?? null;
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) return f.getSelected().join('; ') || null;
  return null;
}

function opcionesDe(f: PDFField): string[] {
  return f instanceof PDFRadioGroup || f instanceof PDFDropdown || f instanceof PDFOptionList ? f.getOptions() : [];
}

function paginaDe(f: PDFField, c: { paginas: Map<PDFRef, number>; refs: Map<PDFObject, PDFRef> }): number | null {
  for (const w of f.acroField.getWidgets()) {
    const ref = c.refs.get(w.dict);
    const pagina = ref ? c.paginas.get(ref) : undefined;
    if (pagina !== undefined) return pagina;
  }
  return null;
}

/** Los campos del formulario de un PDF, con su página y su valor actual, y cuántas páginas tiene; sin campos si no hay formulario. */
export async function formularioDePdf(bytes: Uint8Array): Promise<Result<FormularioPdf>> {
  const doc = await cargar(bytes);
  if (doc.error) return doc;
  const arbol = arbolDeCampos(doc.data);
  if (arbol) return fail('invalid_input', arbol);
  try {
    const campos = doc.data.getForm().getFields();
    if (campos.length > MAX_CAMPOS)
      return fail('invalid_input', `El formulario tiene demasiados campos (más de ${MAX_CAMPOS}).`);
    const contexto = { paginas: paginasDeWidgets(doc.data), refs: referencias(doc.data) };
    return ok({
      paginas: doc.data.getPageCount(),
      campos: campos.map((f) => ({
        nombre: f.getName(),
        tipo: tipoDe(f),
        opciones: opcionesDe(f),
        pagina: paginaDe(f, contexto),
        valor: valorDe(f),
        solo_lectura: f.isReadOnly(),
        es_firma: f instanceof PDFSignature,
      })),
    });
  } catch (err) {
    return fail('invalid_input', `No se pueden leer los campos del PDF: ${errorMessage(err).slice(0, 200)}`);
  }
}

/** Los campos del formulario de un PDF, con su página y su valor actual; vacío si no tiene formulario. */
export async function camposDePdf(bytes: Uint8Array): Promise<Result<CampoPdf[]>> {
  const f = await formularioDePdf(bytes);
  return f.error ? f : ok(f.data.campos);
}

// Solo los campos que se han tocado: pdf-lib, con todos, regenera también los que no traen apariencia
// aunque no se hayan tocado, y uno de solo lectura con un valor fuera de la fuente haría fallar el relleno.
function refrescar(f: PDFField, fuente: PDFFont): void {
  if (f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList)
    f.defaultUpdateAppearances(fuente);
  else if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) f.defaultUpdateAppearances();
}

/** Los valores rellenados («nombre: valor», uno por línea): el texto de un PDF no los trae, y el paquete los comprueba como el resto. */
export function textoDeCampos(campos: CampoPdf[]): string {
  return campos
    .filter((c) => !c.es_firma && (c.valor === true || (typeof c.valor === 'string' && c.valor.trim() !== '')))
    .map((c) => `${c.nombre}: ${c.valor === true ? 'sí' : String(c.valor)}`)
    .join('\n');
}

function aplicar(f: PDFField, valor: string | boolean): string | null {
  const nombre = `«${f.getName()}»`;
  if (f instanceof PDFSignature)
    return `El campo ${nombre} es una firma: la pone una persona con su certificado; déjalo en blanco.`;
  if (f.isReadOnly()) return `El campo ${nombre} es de solo lectura: no se rellena.`;
  if (f instanceof PDFCheckBox) {
    if (typeof valor !== 'boolean') return `El campo ${nombre} es una casilla: su valor es verdadero o falso.`;
    if (valor) f.check();
    else f.uncheck();
    return null;
  }
  if (typeof valor !== 'string') return `El campo ${nombre} no es una casilla: su valor es un texto.`;
  if (f instanceof PDFTextField) {
    f.setText(valor);
    return null;
  }
  if (f instanceof PDFRadioGroup || f instanceof PDFDropdown || f instanceof PDFOptionList) {
    if (!f.getOptions().includes(valor))
      return `El campo ${nombre} no tiene la opción «${valor.slice(0, 80)}»: las opciones son ${f
        .getOptions()
        .map((o) => `«${o}»`)
        .join(', ')}.`;
    f.select(valor);
    return null;
  }
  return `El campo ${nombre} no se puede rellenar (es un botón).`;
}

/**
 * Rellena los campos dados sin aplanar el formulario (una persona puede corregirlos). Rechaza,
 * con la frase de cada uno, firmas, campos de solo lectura, casillas sin booleano y opciones que
 * no existen; los nombres que no están en el PDF se devuelven aparte.
 */
export async function rellenarPdf(bytes: Uint8Array, valores: ValorPdf[]): Promise<Result<PdfRelleno>> {
  const doc = await cargar(bytes);
  if (doc.error) return doc;
  const arbol = arbolDeCampos(doc.data);
  if (arbol) return fail('invalid_input', arbol);
  try {
    const form = doc.data.getForm();
    const porNombre = new Map(form.getFields().map((f) => [f.getName(), f]));
    const noEncontrados: string[] = [];
    const rechazos: string[] = [];
    const tocados: PDFField[] = [];
    for (const v of valores) {
      const campo = porNombre.get(v.nombre);
      if (!campo) {
        noEncontrados.push(v.nombre);
        continue;
      }
      const rechazo = aplicar(campo, v.valor);
      if (rechazo) rechazos.push(rechazo);
      else tocados.push(campo);
    }
    if (rechazos.length) return fail('invalid_input', rechazos.join(' '));
    const fuente = await doc.data.embedFont(StandardFonts.Helvetica);
    for (const f of tocados) refrescar(f, fuente);
    return ok({
      pdf: Buffer.from(await doc.data.save({ updateFieldAppearances: false })),
      aplicados: tocados.length,
      no_encontrados: noEncontrados,
    });
  } catch (err) {
    const fuente = /cannot encode|WinAnsi/i.test(errorMessage(err));
    return fail(
      'invalid_input',
      fuente
        ? 'Algún valor lleva caracteres que la fuente del formulario no admite (solo letras latinas y signos habituales).'
        : `No se pudo rellenar el PDF: ${errorMessage(err).slice(0, 200)}`,
    );
  }
}
