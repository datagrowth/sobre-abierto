// Recibir el anexo de un modelo PDF con formulario: se rellenan sus campos sin aplanarlo y se rechazan
// el campo de quien firma y un importe sin decidir.
import fsp from 'node:fs/promises';
import { formularioDePdf, rellenarPdf, type FormularioPdf } from '../../../nucleo/documentos/formularioPdf.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { exigirRevision } from '../rechazos.js';
import { decisionesDe } from './decisiones.js';
import { planPdf } from './anexoPlan.js';
import type { DocumentoConClave } from './documentos.js';
import { hojaDeDatos, type HojaDatos } from './hojaDatos.js';
import { rellenable } from './modelosPdf.js';
import { recursoAnexo } from './anexosTrabajo.js';
import { type Modelo, comparable } from './anexosModelo.js';
import type { ContextoAnexo } from './anexosPedir.js';
import {
  type AnexoEntradaData,
  type AnexoRecibido,
  type OpcionesAnexo,
  archivoDeAnexo,
  carpetaAnexos,
  digitos,
  escribirAnexo,
  guardarAnexo,
} from './anexosGuardado.js';
import { logger } from '../../../nucleo/log.js';

const log = logger('licitaciones');

// El campo donde va el nombre de quien firma («Fdo.», «Firma», «Nombre_firmante»): como en un Word, se
// queda en blanco. Se mira palabra a palabra (sin acentos y partiendo «FdoNombre» o «Fdo_nombre»):
// «Confirmacion» no es «firma» y «Fecha_firma» o «Lugar» son datos que se rellenan.
const PALABRAS_DE_FIRMA = new Set(['firma', 'firmas', 'firmado', 'firmante', 'fdo', 'signature', 'signed']);
const PALABRAS_DE_LUGAR_Y_FECHA = new Set(['fecha', 'lugar', 'date', 'place', 'dia', 'mes', 'ano']);

function palabrasDe(nombre: string): string[] {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function esCampoDeFirma(nombre: string): boolean {
  const palabras = palabrasDe(nombre);
  return palabras.some((p) => PALABRAS_DE_FIRMA.has(p)) && !palabras.some((p) => PALABRAS_DE_LUGAR_Y_FECHA.has(p));
}

const CAMPO_DE_IMPORTE = /importe|precio|euros|€/i;
// Un valor con pinta de importe («1.234,50», «€», «euros»), ponga lo que ponga el dato que declare el agente.
const PINTA_DE_IMPORTE = /\d[\d.]*,\d{1,2}\b|€|\beuros?\b/i;
type CampoRellenado = NonNullable<AnexoEntradaData['campos']>[number];
const hayTexto = (v: string | boolean) => typeof v === 'string' && v.trim() !== '';

// Un campo de importe: su dato es de la oferta (menos el tipo de impuesto, que no lleva precio), su nombre lo dice o su valor lo parece.
function esImporte(c: CampoRellenado, hoja: HojaDatos | null): boolean {
  const delDato = hoja?.campos.find((x) => comparable(x.etiqueta) === comparable(c.dato));
  const deLaOferta =
    delDato !== undefined && delDato.grupo.startsWith('Oferta') && comparable(delDato.etiqueta) !== 'impuesto';
  return (
    deLaOferta || CAMPO_DE_IMPORTE.test(c.nombre) || (typeof c.valor === 'string' && PINTA_DE_IMPORTE.test(c.valor))
  );
}

// Siempre se rechazan: texto en el campo del nombre de quien firma y el precio sin decidir.
function erroresDurosPdf(campos: CampoRellenado[], c: { hoja: HojaDatos | null; precioDecidido: boolean }): string[] {
  const firmados = campos.filter((x) => hayTexto(x.valor) && esCampoDeFirma(x.nombre)).map((x) => `«${x.nombre}»`);
  const conPrecio = c.precioDecidido
    ? []
    : campos
        .filter((x) => hayTexto(x.valor) && /\d/.test(String(x.valor)) && esImporte(x, c.hoja))
        .map((x) => `«${x.nombre}»`);
  return [
    firmados.length
      ? `La firma se deja en blanco: la pone una persona con su certificado (campo ${firmados.join(', ')}).`
      : null,
    conPrecio.length
      ? `El precio aún no está decidido (decisiones de la oferta): no envíes el campo ${conPrecio.join(', ')} del importe; lo rellena una persona cuando se fije.`
      : null,
  ].filter((x): x is string => x !== null);
}

// El dato debe ser el de la hoja: copiado tal cual (empresa, licitación) o con sus mismas cifras (oferta).
function problemasDeDatosPdf(campos: CampoRellenado[], hoja: HojaDatos): string[] {
  const de = new Map(
    hoja.campos.filter((x) => x.grupo !== 'Criterios automáticos').map((x) => [comparable(x.etiqueta), x]),
  );
  return campos.flatMap((x) => {
    const h = de.get(comparable(x.dato));
    if (!h || typeof x.valor !== 'string') return [];
    if (h.valor === null)
      return hayTexto(x.valor) ? [`La hoja de datos no trae «${h.etiqueta}»: no envíes el campo «${x.nombre}».`] : [];
    const casa =
      h.grupo === 'Oferta' ? digitos(x.valor).includes(digitos(h.valor.split(' (')[0]!)) : x.valor.includes(h.valor);
    return casa
      ? []
      : [
          `«${h.etiqueta}» es «${h.valor}» en la hoja de datos y el campo «${x.nombre}» pone «${x.valor.slice(0, 120)}»: copia el dato tal cual.`,
        ];
  });
}

// Campos de texto que quedan vacíos en el formulario rellenado (la firma se queda en blanco a propósito).
function avisosDelRellenoPdf(restante: FormularioPdf, c: { precioDecidido: boolean }): string[] {
  const vacios = restante.campos.filter(
    (x) => x.tipo === 'texto' && rellenable(x) && (x.valor === null || x.valor === '') && !esCampoDeFirma(x.nombre),
  );
  const importe = vacios.some((x) => CAMPO_DE_IMPORTE.test(x.nombre));
  return [
    ...(vacios.length
      ? [
          `Quedan campos sin rellenar: ${vacios
            .slice(0, 12)
            .map((x) => `«${x.nombre}»`)
            .join(', ')}${vacios.length > 12 ? ' y más' : ''}: complétalos a mano antes de firmar.`,
        ]
      : []),
    ...(!c.precioDecidido && importe
      ? ['Importe sin decidir: el campo del importe queda vacío; rellénalo cuando se fije el precio.']
      : []),
    ...avisoDeAlcance(restante),
  ];
}

// A diferencia de un Word (se extrae el anexo), el PDF rellenado es el documento entero del pliego: si tiene
// páginas fuera de las de sus campos, puede traer más anexos y hay que recortarlo a mano.
function avisoDeAlcance(f: FormularioPdf): string[] {
  const paginas = f.campos.filter(rellenable).flatMap((x) => (x.pagina === null ? [] : [x.pagina]));
  if (!paginas.length) return [];
  const desde = Math.min(...paginas);
  const hasta = Math.max(...paginas);
  if (f.paginas <= hasta - desde + 1) return [];
  return [
    `El PDF rellenado es el documento entero del pliego (${f.paginas} páginas; los campos están en ${desde === hasta ? `la página ${desde}` : `las páginas ${desde} a ${hasta}`}): si trae más anexos, recórtalo a mano antes de presentarlo.`,
  ];
}

export async function recibirAnexoPdf(
  c: ContextoAnexo,
  e: AnexoEntradaData,
  x: { d: DocumentoConClave; modelo: Modelo },
  op: OpcionesAnexo,
): Promise<Result<AnexoRecibido>> {
  const { db, dbNucleo, raices } = c;
  if (e.desde_parrafo !== undefined || e.hasta_parrafo !== undefined || e.sustituciones !== undefined)
    return fail(
      'invalid_input',
      'Este modelo es un PDF con formulario: envía «campos», sin desde_parrafo, hasta_parrafo ni sustituciones. Corrige y vuelve a enviar el anexo entero.',
    );
  const campos = e.campos ?? [];
  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(x.modelo.abs);
  } catch (err) {
    return fail('io_error', `No se pudo leer el modelo: ${errorMessage(err)}`);
  }
  const hoja = hojaDeDatos(db, dbNucleo, e.id, { lote: x.d.lote });
  const precioDecidido = (decisionesDe(db, e.id)?.datos.ofertas ?? []).some(
    (o) => !o.pendiente && (x.d.lote === null || o.lote === x.d.lote),
  );
  const duros = erroresDurosPdf(campos, { hoja: hoja.data, precioDecidido });
  if (duros.length) return fail('invalid_input', `${duros.join(' ')} Corrige y vuelve a enviar el anexo entero.`);
  const relleno = await rellenarPdf(
    bytes,
    campos.map(({ nombre, valor }) => ({ nombre, valor })),
  );
  if (relleno.error)
    return fail('invalid_input', `${relleno.error.message} Corrige y vuelve a enviar el anexo entero.`);
  const blandos = [
    ...relleno.data.no_encontrados.map(
      (n) =>
        `No encuentro el campo «${n.slice(0, 80)}» en el formulario: usa el nombre exacto de la lista de la tarea.`,
    ),
    ...(hoja.data ? problemasDeDatosPdf(campos, hoja.data) : []),
  ];
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_anexo', recursoAnexo(e), op.hoy);
  if (exigir && blandos.length)
    return fail('invalid_input', `${blandos.join(' ')} Corrige y vuelve a enviar el anexo entero.`);
  const despues = await formularioDePdf(relleno.data.pdf);
  const avisos = [
    ...(exigir ? [] : blandos),
    ...(despues.data ? avisosDelRellenoPdf(despues.data, { precioDecidido }) : []),
  ];
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(e.id) as {
    id: string;
    expediente: string;
  };
  const w = escribirAnexo(raices, carpetaAnexos(l), archivoDeAnexo(x.d), { docx: null, pdf: relleno.data.pdf });
  if (w.error) return w;
  guardarAnexo(db, e, {
    w: w.data,
    avisos,
    d: x.d,
    plan: planPdf({ lote: x.d.lote, campos, hoja: hoja.data ?? null }),
  });
  log.info('anexo PDF rellenado', {
    licitacion: e.id,
    clave: e.clave,
    campos: relleno.data.aplicados,
    avisos: avisos.length,
  });
  return ok({
    clave: e.clave,
    ruta: w.data.ruta,
    ruta_pdf: null,
    version: w.data.version,
    aplicadas: relleno.data.aplicados,
    avisos,
  });
}
