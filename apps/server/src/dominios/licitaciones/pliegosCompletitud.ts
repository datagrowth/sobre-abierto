// ¿Está en Drive todo lo que publicó la PLACSP? Compara lo publicado con los pliegos bajados.
import path from 'node:path';
import type { Db } from './store.js';
import { esUrlDePliego } from './placsp/fuentes.js';
import { descargaCompleta, documentosDelFeed } from './pliegos.js';
import { VERSION_MAPPER } from './placsp/mapper.js';
import { fichasDe, type FichaGuardada } from './ficha.js';
import { guionVigente, type GuionBaseData } from './oferta/guion.js';
import { ofertasEconomicas } from './oferta/guionLotes.js';
import { textoComparable } from './temas.js';
import { REVISAR_CADA_MS, revisionExpediente, type RevisionExpediente } from './pliegosExpediente.js';

// Compara los documentos del feed y los de la página del expediente (pliegosExpediente.ts) con los pliegos
// bajados (un ZIP cuenta como bajado cuando se descomprimió) y con lo que citan el guion y la ficha. Un anexo
// que define criterios o el modelo que hay que rellenar y no se bajó deja la oferta coja sin que nadie lo note:
// por eso se dice en la licitación y en «Hoy».
type MotivoFalta = 'sin_encolar' | 'pendiente' | 'error' | 'no_descargable';
// intentos: los que lleva fallando (un pendiente con error se reintenta solo); citado: el guion
// o la ficha lo usan (p. ej. el modelo de un anexo), así que urge más.
export type DocumentoQueFalta = {
  nombre: string;
  clase: string;
  motivo: MotivoFalta;
  error: string | null;
  intentos: number;
  citado: boolean;
};
type CitaSinPliego = { documento: string; en: 'guion' | 'ficha' };
// completa: si está en Drive todo lo publicado; null mientras no esté comprobado qué se publicó
// (sin_comprobar), porque «no falta nada de lo que consta» no es «no falta nada».
// descarga_completa: si a la licitación le toca bajar todo (en preparación o con la ficha
// pedida); si no, solo se baja lo que lee la ficha y lo demás falta a propósito. sin_comprobar:
// los datos son de un mapper anterior, que no leía los «Otros documentos» ni los anuncios, y la
// página del expediente aún no se ha podido revisar. expediente: su última revisión.
export type CompletitudPliegos = {
  completa: boolean | null;
  descarga_completa: boolean;
  publicados: number;
  descargados: number;
  faltan: DocumentoQueFalta[];
  citados_sin_pliego: CitaSinPliego[];
  sin_comprobar: boolean;
  expediente: RevisionExpediente | null;
};

const AVISO_SIN_COMPROBAR =
  'No se ha comprobado si la PLACSP publica más documentos («Otros documentos», como una nota de rectificación, o los de los anuncios): los datos de esta licitación son anteriores a que la plataforma los leyera y la página del expediente aún no se ha podido revisar. Hasta entonces no se puede dar por completo lo que hay en Drive: revísalo en la PLACSP y deja lo que falte en la carpeta de los pliegos. Mientras esté en preparación, la página se revisa sola cada pocas horas.';

/** El aviso de lo no comprobado, con el fallo de la última revisión de la página si lo hubo. */
export function avisoSinComprobar(c: Pick<CompletitudPliegos, 'expediente'>): string {
  const fallo = c.expediente?.error ? ` La última revisión de la página falló (${c.expediente.error}).` : '';
  return `${AVISO_SIN_COMPROBAR}${fallo}`;
}

/** Si los datos guardados son de un mapper anterior al que lee todos los documentos publicados. */
function datosSinComprobar(datos: string): boolean {
  const v = (JSON.parse(datos) as { mapper?: unknown }).mapper;
  return typeof v !== 'number' || v < VERSION_MAPPER;
}

type FilaPliego = {
  url: string;
  clase: string;
  nombre: string;
  ruta: string | null;
  estado: string;
  error: string | null;
  intentos: number;
  origen: string;
};

const OBTENIDO = new Set(['descargado', 'descomprimido']);
/** Si un pliego ya está en Drive: bajado o, si era un ZIP, descomprimido en sus documentos. */
export const pliegoObtenido = (estado: string): boolean => OBTENIDO.has(estado);
const MAX_CITAS = 20;
// Un fallo pasajero avisa cuando ya lleva un rato (1 + 2 + 4 minutos de espera): antes es ruido.
const INTENTOS_PARA_AVISAR = 3;

// Como lo cita Hermes (ruta o nombre, con o sin extensión) y como se llama en Drive.
const clave = (t: string) =>
  textoComparable(path.posix.basename(t.replace(/\\/g, '/')))
    .replace(/\.[a-z][a-z0-9]{0,4}$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// Solo cuenta lo que se cita como archivo: «Cuadro de características» es una parte del PCAP.
const esArchivo = (t: string) => /\.[a-z][a-z0-9]{1,4}$/i.test(t.trim()) || t.includes('/');

function motivo(url: string, fila: FilaPliego | undefined): MotivoFalta | null {
  if (!esUrlDePliego(url)) return 'no_descargable';
  if (!fila) return 'sin_encolar';
  if (OBTENIDO.has(fila.estado)) return null;
  return fila.estado === 'error' ? 'error' : 'pendiente';
}

function citasDeGuion(g: GuionBaseData): string[] {
  return [
    ...g.archivos.flatMap((a) => [a.documento, ...a.documentos.map((d) => d.origen?.documento)]),
    g.memoria?.documento,
    ...(g.memoria?.apartados ?? []).map((a) => a.documento),
    ...g.automaticos.map((a) => a.documento),
    ...ofertasEconomicas(g).map((o) => o.documento),
  ].filter((d): d is string => Boolean(d));
}

function citasDeFicha(d: FichaGuardada['datos']): string[] {
  return [
    ...d.requisitos.map((r) => r.documento),
    ...(d.cobertura ?? []).map((c) => c.documento),
    ...(d.senales_pliego ?? []).map((s) => s.documento),
    d.presentacion_lotes?.documento,
  ].filter((x): x is string => Boolean(x));
}

function citas(db: Db, id: string): CitaSinPliego[] {
  const guion = guionVigente(db, id);
  const ficha = fichasDe(db, id).aprobada;
  const todas = [
    ...(guion ? citasDeGuion(guion.datos).map((documento) => ({ documento, en: 'guion' as const })) : []),
    ...(ficha ? citasDeFicha(ficha.datos).map((documento) => ({ documento, en: 'ficha' as const })) : []),
  ].filter((c) => esArchivo(c.documento));
  return todas.filter((c, i) => todas.findIndex((x) => clave(x.documento) === clave(c.documento)) === i);
}

// comprobado_en sobrevive a los fallos posteriores: si la última revisión falló y la última
// buena tiene más de dos vueltas, ya no vale (días de 503 no son «comprobado»).
function revisionVigente(e: RevisionExpediente | null, ahoraMs: number): boolean {
  if (!e?.comprobado_en) return false;
  return !(e.error && Date.parse(e.comprobado_en) < ahoraMs - 2 * REVISAR_CADA_MS);
}

/**
 * Lo publicado (en el feed o en la página del expediente) que no está en Drive (y por qué), cuántos hay y cuántos se bajaron, y lo que el
 * guion o la ficha citan como archivo sin que sea ningún pliego bajado ni publicado. Sin la
 * licitación, null.
 */
export function completitudPliegos(db: Db, id: string, ahoraMs = Date.now()): CompletitudPliegos | null {
  const l = db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(id) as { datos: string } | undefined;
  if (!l) return null;
  const filas = db
    .prepare('SELECT url, clase, nombre, ruta, estado, error, intentos, origen FROM pliegos WHERE licitacion_id = ?')
    .all(id) as FilaPliego[];
  const porUrl = new Map(filas.map((f) => [f.url, f]));
  const delFeed = documentosDelFeed(l.datos);
  const urlsFeed = new Set(delFeed.map((d) => d.url));
  const publicados = [...delFeed, ...filas.filter((f) => f.origen === 'expediente' && !urlsFeed.has(f.url))];
  const faltan = publicados.flatMap((d): DocumentoQueFalta[] => {
    const fila = porUrl.get(d.url);
    const m = motivo(d.url, fila);
    return m
      ? [
          {
            nombre: d.nombre,
            clase: d.clase,
            motivo: m,
            error: fila?.error ?? null,
            intentos: fila?.intentos ?? 0,
            citado: false,
          },
        ]
      : [];
  });
  const bajados = new Set(
    filas.filter((f) => OBTENIDO.has(f.estado)).flatMap((f) => [clave(f.nombre), ...(f.ruta ? [clave(f.ruta)] : [])]),
  );
  const citados_sin_pliego: CitaSinPliego[] = [];
  for (const c of citas(db, id)) {
    const k = clave(c.documento);
    if (bajados.has(k)) continue;
    const falta = faltan.find((f) => clave(f.nombre) === k);
    if (falta) falta.citado = true;
    else if (citados_sin_pliego.length < MAX_CITAS) citados_sin_pliego.push(c);
  }
  const expediente = revisionExpediente(db, id);
  const sin_comprobar = datosSinComprobar(l.datos) && !revisionVigente(expediente, ahoraMs);
  return {
    completa: sin_comprobar ? null : faltan.length === 0,
    descarga_completa: descargaCompleta(db, id),
    publicados: publicados.length,
    descargados: publicados.length - faltan.length,
    faltan,
    citados_sin_pliego,
    sin_comprobar,
    expediente,
  };
}

/**
 * Lo que falta y pide a una persona: lo que dio error, lo que está en una plataforma de la que no
 * se baja solo y lo que lleva un rato fallando. Lo que aún no está en cola entra en la vuelta
 * siguiente (cada minuto) y lo que espera su turno se bajará: no avisan.
 */
export function faltanConAviso(c: CompletitudPliegos | null): DocumentoQueFalta[] {
  return (c?.faltan ?? []).filter(
    (f) =>
      f.motivo === 'error' ||
      f.motivo === 'no_descargable' ||
      (f.motivo === 'pendiente' && f.intentos >= INTENTOS_PARA_AVISAR),
  );
}
