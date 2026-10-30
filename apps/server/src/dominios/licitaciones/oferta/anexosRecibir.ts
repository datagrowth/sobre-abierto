// Recibir el anexo de un modelo Word (o transcrito de un PDF): se rellenan solo los huecos, se comprueba
// que el texto del modelo sigue literal y se rechaza la firma o un precio sin decidir.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { pdfDeDocx } from '../../../nucleo/documentos/libreoffice.js';
import {
  diferenciasFueraDelPlan,
  extraerParrafos,
  huecosDe,
  literalesDe,
  localizarHuecos,
  rellenarDocx,
  type Huecos,
  type Relleno,
} from '../../../nucleo/documentos/rellenar.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { archivoExistente, type Raices } from '../../../nucleo/salidas.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { decisionesDe } from './decisiones.js';
import { planWord } from './anexoPlan.js';
import { filaDocumento, type DocumentoConClave } from './documentos.js';
import { hojaDeDatos, type HojaDatos } from './hojaDatos.js';
import { empiezaPor } from './modelosPdf.js';
import { rutaConImportes } from './rutasConImportes.js';
import { recursoAnexo } from './anexosTrabajo.js';
import { type Modelo, comparable, modeloBuscado, modeloDe, modeloDocx } from './anexosModelo.js';
import { type Transcrito, analisisDe, avisoTranscrito, transcritoDe } from './anexosModeloPdf.js';
import { type ContextoAnexo, destinoDe } from './anexosPedir.js';
import {
  type AnexoEntradaData,
  type AnexoRecibido,
  type OpcionesAnexo,
  type SustitucionData,
  archivoDeAnexo,
  carpetaAnexos,
  digitos,
  escribirAnexo,
  guardarAnexo,
} from './anexosGuardado.js';
import { recibirAnexoPdf } from './anexosRecibirPdf.js';
import { logger } from '../../../nucleo/log.js';

const log = logger('licitaciones');

// Lo que pide un modelo Word: el rango y las sustituciones, ya presentes.
type AnexoWord = Omit<AnexoEntradaData, 'desde_parrafo' | 'hasta_parrafo' | 'sustituciones'> & {
  desde_parrafo: number;
  hasta_parrafo: number;
  sustituciones: SustitucionData[];
};

function comoWord(e: AnexoEntradaData): AnexoWord | null {
  return e.desde_parrafo === undefined || e.hasta_parrafo === undefined || e.sustituciones === undefined
    ? null
    : { ...e, desde_parrafo: e.desde_parrafo, hasta_parrafo: e.hasta_parrafo, sustituciones: e.sustituciones };
}

const unicos = (xs: number[]) => [...new Set(xs)].join(', ');

// Los huecos del párrafo sobre los que cae el trozo sustituido. Un hueco vacío tras su etiqueta
// («Fdo.:» al final de la línea, como sale un PDF transcrito) cuenta si el trozo llega hasta él.
function huecosBajo(texto: string, original: string): ReturnType<typeof huecosDe> {
  const i = texto.indexOf(original);
  const fin = i + original.length;
  return i === -1
    ? []
    : huecosDe(texto).filter(
        (h) => (h.texto ? h.inicio < fin : h.inicio <= fin) && h.inicio + Math.max(h.texto.length, 1) > i,
      );
}

// ¿Cae el trozo sustituido sobre un hueco con esa etiqueta («importe», «firma»)?
const esHuecoDe = (etiqueta: string, texto: string, original: string) =>
  huecosBajo(texto, original).some((h) => h.etiqueta === etiqueta);

// Un modelo transcrito de un PDF trae importes como «TOTAL SIN IGIC: ____€»: la etiqueta no los
// ve, pero el «€» detrás o un término de precio delante sí. «total», «IVA» o «IGIC» solos no
// bastan: «Plazo total de ejecución», «Número total de trabajadores» o «NIF-IVA» no son precios.
const ANTES_DE_IMPORTE =
  /(?:\b(?:importe|precio|base imponible)\b|\btotal\s+(?:sin|con|m[aá]s|incluido)\s+(?:el\s+)?(?:igic|iva)\b)[^.;]{0,40}$/iu;
const TRAS_IMPORTE = /^\s*(?:€|euros?\b)/iu;

// En un Word, la etiqueta del hueco basta; lo de alrededor solo se mira en una transcripción.
function esHuecoDeImporte(texto: string, original: string, transcrito: boolean): boolean {
  const porContexto = (h: ReturnType<typeof huecosDe>[number]) =>
    transcrito &&
    h.tipo !== 'casilla' &&
    (TRAS_IMPORTE.test(texto.slice(h.inicio + h.texto.length)) || ANTES_DE_IMPORTE.test(texto.slice(0, h.inicio)));
  return huecosBajo(texto, original).some((h) => h.etiqueta === 'importe' || porContexto(h));
}

type Precio = { decidido: boolean; transcrito: boolean };

// Siempre se rechazan: un rango imposible, huecos fuera del modelo, el precio sin decidir y
// cualquier texto en la firma (la pone una persona con su certificado).
function erroresDuros(e: AnexoWord, h: Huecos, precio: Precio): string[] {
  const textos = new Map(h.parrafos.map((p) => [p.indice, p.texto]));
  const fuera = e.sustituciones
    .filter((s) => s.parrafo < e.desde_parrafo || s.parrafo > e.hasta_parrafo)
    .map((s) => s.parrafo);
  const conPrecio = precio.decidido
    ? []
    : e.sustituciones
        .filter(
          (s) =>
            digitos(s.nuevo).length > digitos(s.original).length &&
            esHuecoDeImporte(textos.get(s.parrafo) ?? '', s.original, precio.transcrito),
        )
        .map((s) => s.parrafo);
  const firmados = e.sustituciones
    .filter((s) => anadido(s) && esHuecoDe('firma', textos.get(s.parrafo) ?? '', s.original))
    .map((s) => s.parrafo);
  return [
    e.hasta_parrafo < e.desde_parrafo || e.hasta_parrafo > h.total
      ? `El rango ${e.desde_parrafo}-${e.hasta_parrafo} no vale: el documento tiene ${h.total} párrafos y «hasta_parrafo» no puede ser menor que «desde_parrafo».`
      : null,
    fuera.length
      ? `Las sustituciones de los párrafos ${unicos(fuera)} caen fuera del modelo (párrafos ${e.desde_parrafo}-${e.hasta_parrafo}).`
      : null,
    conPrecio.length
      ? `El precio aún no está decidido (decisiones de la oferta): deja vacío el hueco del importe del párrafo ${unicos(conPrecio)}; lo rellena una persona cuando se fije.`
      : null,
    firmados.length
      ? `La firma se deja en blanco: la pone una persona con su certificado (párrafo ${unicos(firmados)}).`
      : null,
  ].filter((x): x is string => x !== null);
}

// Un hueco redactado (dato «Redacción») no sale de la hoja: solo entra citando documentos que existan.
const esRedaccion = (s: SustitucionData) => comparable(s.dato) === 'redaccion';

// Lo reservado se rechaza antes de mirar si existe: la respuesta distinta le diría a Hermes qué
// documentos con importes hay, y salidas_leer y salidas_listar no se los enseñan (rutasConImportes.ts).
function problemaDeFuente(db: Db, raices: Raices, ruta: string): string | null {
  if (rutaConImportes(db, ruta))
    return `«${ruta}» no se puede citar: lleva los importes de la oferta y ningún agente lo lee.`;
  return archivoExistente(raices, ruta).error
    ? `No encuentro «${ruta}»: cita un documento de la Biblioteca o de Salidas.`
    : null;
}

function erroresDeRedaccion(db: Db, subs: SustitucionData[], raices: Raices): string[] {
  return subs.filter(esRedaccion).flatMap((s) => {
    if (!s.fuentes?.length) return [`El párrafo ${s.parrafo} es redacción: di de qué documentos sale (fuentes).`];
    return s.fuentes.flatMap((f) => problemaDeFuente(db, raices, f.ruta) ?? []);
  });
}

const citaDe = (f: NonNullable<SustitucionData['fuentes']>[number]) =>
  `${path.posix.basename(f.ruta)}${f.pagina ? `, pág. ${f.pagina}` : ''}`;

function avisosDeRedaccion(subs: SustitucionData[]): string[] {
  return subs
    .filter(esRedaccion)
    .map(
      (s) =>
        `Texto redactado por Hermes en el párrafo ${s.parrafo} (fuentes: ${(s.fuentes ?? []).map(citaDe).join('; ')}): comprueba que es cierto antes de firmar.`,
    );
}

// Lo que añade una sustitución además del texto del modelo y de los huecos.
function anadido(s: SustitucionData): string {
  return literalesDe(s.original)
    .reduce((t, lit) => t.replace(lit, ''), s.nuevo)
    .replace(/[\s.…_☐☒:,;()[\]-]/gu, '');
}

// El dato debe ser el de la hoja: copiado tal cual (empresa, licitación) o con sus mismas cifras (oferta).
function problemasDeDatos(subs: SustitucionData[], hoja: HojaDatos): string[] {
  const campos = new Map(
    hoja.campos.filter((c) => c.grupo !== 'Criterios automáticos').map((c) => [comparable(c.etiqueta), c]),
  );
  return subs.flatMap((s) => {
    const c = campos.get(comparable(s.dato));
    if (!c) return [];
    if (c.valor === null)
      return anadido(s)
        ? [`La hoja de datos no trae «${c.etiqueta}»: deja vacío el hueco del párrafo ${s.parrafo}.`]
        : [];
    const casa =
      c.grupo === 'Oferta' ? digitos(s.nuevo).includes(digitos(c.valor.split(' (')[0]!)) : s.nuevo.includes(c.valor);
    return casa
      ? []
      : [
          `«${c.etiqueta}» es «${c.valor}» en la hoja de datos y el párrafo ${s.parrafo} pone «${s.nuevo.slice(0, 120)}»: copia el dato tal cual.`,
        ];
  });
}

// Se rechazan hasta el tercer envío; luego entran como avisos.
function problemasBlandos(e: AnexoWord, c: { h: Huecos; relleno: Relleno; hoja: HojaDatos; modelo: string }): string[] {
  const inicio = c.h.parrafos.find((p) => p.indice === e.desde_parrafo)?.texto ?? '';
  return [
    ...c.relleno.noEncontradas.map(
      (s) =>
        `No encuentro «${s.original.slice(0, 120)}» en el párrafo ${s.parrafo}: cópialo literal de la tarea, con sus puntos.`,
    ),
    ...(empiezaPor(inicio, c.modelo)
      ? []
      : [
          `El párrafo ${e.desde_parrafo} («${inicio.slice(0, 80)}») no es el título de «${c.modelo}»: «desde_parrafo» debe ser el párrafo con su título.`,
        ]),
    ...problemasDeDatos(e.sustituciones, c.hoja),
  ];
}

// Huecos que quedan en el modelo rellenado (las casillas sin marcar son las de lo que no se elige).
function avisosDelRelleno(relleno: Buffer, e: AnexoWord, precioDecidido: boolean): string[] {
  const h = localizarHuecos(relleno);
  if (h.error) return [];
  // La firma se queda en blanco a propósito: no cuenta como hueco por rellenar.
  const quedan = h.data.parrafos.filter(
    (p) =>
      p.indice >= e.desde_parrafo &&
      p.indice <= e.hasta_parrafo &&
      p.huecos.some((x) => x.tipo !== 'casilla' && x.etiqueta !== 'firma'),
  );
  const importe = quedan.some((p) => p.huecos.some((x) => x.etiqueta === 'importe'));
  return [
    ...(quedan.length
      ? [
          `Quedan huecos sin rellenar en los párrafos ${unicos(quedan.map((p) => p.indice))}: complétalos a mano antes de firmar.`,
        ]
      : []),
    ...(!precioDecidido && importe
      ? ['Importe sin decidir: el hueco del importe queda vacío; rellénalo cuando se fije el precio.']
      : []),
  ];
}

type Revisado = { relleno: Relleno; avisos: string[]; hoja: HojaDatos | null };

async function revisarAnexo(
  db: Db,
  dbNucleo: DbNucleo,
  e: AnexoWord,
  c: { bytes: Buffer; d: DocumentoConClave; op: OpcionesAnexo; raices: Raices; transcrito: boolean },
): Promise<Result<Revisado>> {
  const h = localizarHuecos(c.bytes);
  if (h.error) return fail('invalid_input', `No se puede leer el modelo: ${h.error.message}`);
  const precioDecidido = (decisionesDe(db, e.id)?.datos.ofertas ?? []).some(
    (o) => !o.pendiente && (c.d.lote === null || o.lote === c.d.lote),
  );
  const relleno = rellenarDocx(c.bytes, e.sustituciones);
  if (relleno.error) return relleno;
  const duros = [
    ...erroresDuros(e, h.data, { decidido: precioDecidido, transcrito: c.transcrito }),
    ...erroresDeRedaccion(db, e.sustituciones, c.raices),
    ...diferenciasFueraDelPlan(c.bytes, relleno.data.docx, relleno.data.aplicadas),
  ];
  if (duros.length) return fail('invalid_input', `${duros.join(' ')} Corrige y vuelve a enviar el anexo entero.`);
  const hoja = hojaDeDatos(db, dbNucleo, e.id, { lote: c.d.lote });
  const blandos = hoja.error
    ? []
    : problemasBlandos(e, { h: h.data, relleno: relleno.data, hoja: hoja.data, modelo: modeloBuscado(c.d) });
  const exigir = c.op.revisar === true && exigirRevision(db, 'licitaciones_anexo', recursoAnexo(e), c.op.hoy);
  if (exigir && blandos.length)
    return fail('invalid_input', `${blandos.join(' ')} Corrige y vuelve a enviar el anexo entero.`);
  const avisos = [
    ...(exigir ? [] : blandos),
    ...avisosDelRelleno(relleno.data.docx, e, precioDecidido),
    ...avisosDeRedaccion(e.sustituciones),
  ];
  return ok({ relleno: relleno.data, hoja: hoja.data ?? null, avisos });
}

type ModeloAlRecibir =
  { formato: 'pdf'; modelo: Modelo } | { formato: 'docx'; bytes: Buffer; transcrito: Transcrito | null };

// La transcripción de un PDF con que se rellena: la que leyó el run (anexo_modelo) o, si no hay, la del análisis.
function docxTranscrito(db: Db, e: AnexoEntradaData, d: DocumentoConClave, m: Modelo): Transcrito | null {
  const t = transcritoDe(db, filaDocumento(db, e.id, e.clave)?.anexo_modelo ?? null);
  if (t) return t;
  const a = analisisDe(db, m, d).data;
  return a?.tipo === 'transcrito' ? transcritoDe(db, a.docx) : null;
}

// Con qué se rellena lo recibido: el PDF con formulario, o los bytes del Word (el .docx del pliego, su conversión o la transcripción del PDF).
async function modeloAlRecibir(
  c: ContextoAnexo,
  e: AnexoEntradaData,
  d: DocumentoConClave,
): Promise<Result<ModeloAlRecibir>> {
  const m = modeloDe(c.db, c.raices, e.id, d);
  const transcrito = !m.error && m.data.ext === '.pdf' ? docxTranscrito(c.db, e, d, m.data) : null;
  if (!m.error && m.data.ext === '.pdf' && !transcrito) return ok({ formato: 'pdf', modelo: m.data });
  if (!transcrito) {
    const docx = await modeloDocx(c.db, c.raices, e.id, d);
    return docx.error ? docx : ok({ formato: 'docx', bytes: docx.data.bytes, transcrito: null });
  }
  try {
    return ok({ formato: 'docx', bytes: await fsp.readFile(transcrito.abs), transcrito });
  } catch (err) {
    return fail('io_error', `No se pudo leer la transcripción del modelo: ${errorMessage(err)}`);
  }
}

/**
 * Rellena el modelo con el plan de Hermes, comprueba la literalidad y lo guarda en Salidas como
 * borrador. Con `revisar` (la tool) rechaza con frases concretas; lo que no es literal o pone
 * un precio sin decidir se rechaza siempre.
 */
export async function recibirAnexo(
  c: ContextoAnexo,
  e: AnexoEntradaData,
  op: OpcionesAnexo = {},
): Promise<Result<AnexoRecibido>> {
  const { db, dbNucleo, raices } = c;
  const dest = destinoDe(db, raices, e.id, e.clave);
  if (dest.error) return dest;
  const modelo = await modeloAlRecibir(c, e, dest.data.d);
  if (modelo.error) return modelo;
  if (modelo.data.formato === 'pdf') return recibirAnexoPdf(c, e, { d: dest.data.d, modelo: modelo.data.modelo }, op);
  const word = comoWord(e);
  if (!word)
    return fail(
      'invalid_input',
      'Este modelo es un Word: envía desde_parrafo, hasta_parrafo y sustituciones (no «campos»). Corrige y vuelve a enviar el anexo entero.',
    );
  const { transcrito } = modelo.data;
  const r = await revisarAnexo(db, dbNucleo, word, {
    bytes: modelo.data.bytes,
    d: dest.data.d,
    op,
    raices,
    transcrito: transcrito !== null,
  });
  if (r.error) return r;
  const docx = extraerParrafos(r.data.relleno.docx, word.desde_parrafo, word.hasta_parrafo);
  if (docx.error) return docx;
  const pdf = await pdfDeDocx(docx.data);
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(e.id) as {
    id: string;
    expediente: string;
  };
  const w = escribirAnexo(raices, carpetaAnexos(l), archivoDeAnexo(dest.data.d), { docx: docx.data, pdf: pdf.pdf });
  if (w.error) return w;
  const avisos = [
    ...r.data.avisos,
    ...(pdf.aviso ? [pdf.aviso] : []),
    ...(transcrito ? [avisoTranscrito(transcrito)] : []),
  ];
  const plan = planWord({
    lote: dest.data.d.lote,
    desde: word.desde_parrafo,
    hasta: word.hasta_parrafo,
    sustituciones: word.sustituciones,
    hoja: r.data.hoja,
  });
  guardarAnexo(db, e, { w: w.data, avisos, d: dest.data.d, plan });
  log.info('anexo rellenado', {
    licitacion: e.id,
    clave: e.clave,
    sustituciones: r.data.relleno.aplicadas.length,
    avisos: avisos.length,
  });
  return ok({
    clave: e.clave,
    ruta: w.data.ruta,
    ruta_pdf: w.data.ruta_pdf,
    version: w.data.version,
    aplicadas: r.data.relleno.aplicadas.length,
    avisos,
  });
}
