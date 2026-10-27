// Lee la página del expediente en la PLACSP (detalle_licitacion), que lista todo lo publicado.
import { decodificarEntidades } from '../../../nucleo/entidades.js';
import { logger } from '../../../nucleo/log.js';
import { esUrlDePlataforma } from './fuentes.js';

// Lista cada anuncio con sus versiones anteriores (rectificaciones) y los «Otros documentos» (memoria
// justificativa, mesa, notas de rectificación, aclaraciones). El feed solo trae lo de su última versión y, en
// datos de antes del mapper actual, ni eso: una nota de rectificación u otros documentos estaban publicados y
// nadie los veía. Aquí solo se lee el HTML; pedirlo y registrar lo encontrado es cosa de pliegosExpediente.ts.
export type DocumentoExpediente = { clase: 'anuncio' | 'otro'; nombre: string; url: string; publicado: string | null };

// Se parte por la etiqueta de cierre y se busca la de apertura en cada trozo: un regex perezoso
// entre ambas es cuadrático con etiquetas sin cerrar (y el HTML viene de fuera). Las aperturas
// excluyen «<» en sus atributos por lo mismo.
const FILA = { apertura: /<tr\b[^<>]*>/i, cierre: /<\/tr>/i };
const CELDA = { apertura: /<td\b[^<>]*>/i, cierre: /<\/td>/i };
const ENLACE = { apertura: /<a\b[^<>]*?\bhref=(?:"([^"]*)"|'([^']*)')[^<>]*>/i, cierre: /<\/a>/i };
const MAX_ELEMENTOS = 2000;
const log = logger('licitaciones.expediente_html');
const PLATAFORMA = 'https://contrataciondelestado.es/';
const FECHA = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/;
// Los «Otros documentos» van en su propia tabla (DOC_GEN) con un solo enlace («Ver»); cada
// anuncio, en html, xml y pdf: el pdf es el que se guarda.
const OTRO_DOCUMENTO = /PadreGen|'DOC_GEN'/;
const ICONO = /\/(\w+)-icon\.\w+/;

const texto = (html: string) =>
  decodificarEntidades(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
// Quita lo que va de «abre» a «cierra» con indexOf: una apertura sin cerrar corta hasta el final
// (los regex perezosos reexploraban el resto por cada apertura: cuadrático). La copia en
// minúsculas solo cambia A-Z para que sus índices coincidan con los del html.
function quitar(html: string, abre: string, cierra: string): string {
  const bajo = html.replace(/[A-Z]/g, (c) => c.toLowerCase());
  let fuera = '';
  let pos = 0;
  for (;;) {
    const i = bajo.indexOf(abre, pos);
    if (i < 0) return fuera + html.slice(pos);
    fuera += html.slice(pos, i);
    const j = bajo.indexOf(cierra, i + abre.length);
    if (j < 0) return fuera;
    pos = j + cierra.length;
  }
}
const sinRuido = (html: string) =>
  quitar(quitar(quitar(html, '<!--', '-->'), '<script', '</script>'), '<style', '</style>');

// «28/09/2026 13:41» → «2026-09-28T13:41» (hora peninsular, como la publica la PLACSP).
function fechaIso(t: string): string | null {
  const m = FECHA.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : null;
}

type Trozo = { interior: string; apertura: RegExpExecArray };

// Los elementos cerrados, con tope: lo que pase de MAX_ELEMENTOS se descarta y se deja dicho.
function elementos(html: string, tipo: { apertura: RegExp; cierre: RegExp }): Trozo[] {
  const trozos = html.split(tipo.cierre).slice(0, -1);
  if (trozos.length > MAX_ELEMENTOS)
    log.warn('página del expediente con demasiados elementos', {
      total: trozos.length,
      descartados: trozos.length - MAX_ELEMENTOS,
    });
  return trozos.slice(0, MAX_ELEMENTOS).flatMap((t) => {
    const m = tipo.apertura.exec(t);
    return m ? [{ interior: t.slice(m.index + m[0].length), apertura: m }] : [];
  });
}

type Enlace = { url: string; icono: string | null };

// Los href de la página pueden ser relativos, con comillas simples o con el «&» codificado.
function absoluta(href: string, base: string): string | null {
  try {
    return new URL(decodificarEntidades(href), base).href;
  } catch {
    return null;
  }
}

function enlaces(fila: string, base: string): Enlace[] {
  return elementos(fila, ENLACE).flatMap((e) => {
    const url = absoluta(e.apertura[1] ?? e.apertura[2] ?? '', base);
    return url && esUrlDePlataforma(url) ? [{ url, icono: ICONO.exec(e.interior)?.[1] ?? null }] : [];
  });
}

function elegido(es: Enlace[], otro: boolean): Enlace | null {
  if (otro) return es.length === 1 ? es[0]! : (es.find((e) => e.icono === 'pdf') ?? es[0] ?? null);
  return es.find((e) => e.icono === 'pdf') ?? null;
}

// El nombre lleva la fecha: un anuncio y su rectificación se llaman igual en cada versión.
function nombre(tipo: string, publicado: string | null): string {
  if (!publicado) return tipo;
  const [d, h] = publicado.split('T');
  return `${tipo} ${d!.split('-').reverse().join('-')} ${h!.replace(':', '')}`;
}

function documentoDeFila(fila: string, base: string): DocumentoExpediente | null {
  const otro = OTRO_DOCUMENTO.test(fila);
  const e = elegido(enlaces(fila, base), otro);
  if (!e) return null;
  const celdas = elementos(fila, CELDA).map((c) => texto(c.interior));
  const publicado = fechaIso(celdas[0] ?? '');
  const tipo = celdas[1] || (otro ? 'Otro documento' : 'Anuncio');
  return {
    clase: otro ? 'otro' : 'anuncio',
    nombre: `${nombre(tipo, publicado)}${otro ? '' : '.pdf'}`,
    url: e.url,
    publicado,
  };
}

/**
 * Lo publicado en la página del expediente: el pdf de cada anuncio (también de sus versiones
 * anteriores) y cada «Otro documento», cada URL una vez y solo de la propia PLACSP. Una página
 * sin tabla de documentos (la PLACSP devolvió otra cosa) da una lista vacía. urlPagina resuelve
 * los enlaces relativos.
 */
export function documentosDelExpediente(html: string, urlPagina: string = PLATAFORMA): DocumentoExpediente[] {
  const docs = elementos(sinRuido(html), FILA)
    .map((f) => documentoDeFila(f.interior, urlPagina))
    .filter((d): d is DocumentoExpediente => d !== null);
  return docs.filter((d, i) => docs.findIndex((x) => x.url === d.url) === i);
}

/** Si lo recibido es la página de un expediente (tiene su tabla de documentos publicados). */
export function esPaginaDeExpediente(html: string): boolean {
  return /id="myTablaDetalleVISUOE"|TableEx1_Aux/.test(html);
}
