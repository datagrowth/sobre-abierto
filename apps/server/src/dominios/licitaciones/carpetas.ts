// Carpetas de Licitaciones en Conocimiento: las del radar y las de lo presentado, con sus nombres y patrones.
import path from 'node:path';
import { z } from 'zod';
import { nucleo } from '../../nucleo/contexto.js';
import { moverFuentesPropuestas } from '../../nucleo/documentos.js';
import { logger } from '../../nucleo/log.js';
import { limpiarNombre } from '../../nucleo/nombres.js';
import { guardarOperacion, leerOperacion } from '../../nucleo/operaciones.js';
import { errorMessage } from '../../nucleo/result.js';
import type { Db, FilaLicitacion } from './store.js';

const log = logger('licitaciones.carpetas');

// El radar baja a Radar/<año>/<expediente> (<id>)/ y lo presentado va a Presentadas/<AAAA-MM - expediente -
// órgano - tema>/, separado para que no se pierda entre el histórico del radar. Aquí están sus nombres, los
// patrones de la estructura anterior y la actualización de las rutas guardadas cuando una carpeta cambia de sitio.
/** Raíz de la estructura anterior: todo colgaba de aquí, mezclado. */
export const CARPETA_ORIGEN = 'Licitaciones';

// Estructura anterior: carpetas de primer nivel como «2026-05 - SER-2026-… - Cliente - Tema»
// (lo presentado) y Licitaciones/<año>/<expediente> (p-123) o (a-123) (lo del radar).
export const ES_PRESENTADA = /^\d{4}-(0[1-9]|1[0-2]) - \S/;
export const ES_ANIO = /^(19|20)\d{2}$/;
export const ES_DEL_RADAR = / \([pa]-[A-Za-z0-9_-]{1,30}\)$/;

export type CarpetasLicitaciones = { radar: string; presentadas: string };

export function carpetasLicitaciones(): CarpetasLicitaciones {
  const { carpetaRadar, carpetaPresentadas } = nucleo().config.licitaciones;
  return { radar: carpetaRadar, presentadas: carpetaPresentadas };
}

type ParaCarpeta = Pick<FilaLicitacion, 'id' | 'expediente' | 'fecha_limite' | 'actualizada_en'>;

/** Carpeta del radar de una licitación: <Radar>/<año>/<expediente> (<id>), relativa a Conocimiento. */
export function carpetaDe(l: ParaCarpeta, radar = carpetasLicitaciones().radar): string {
  const anio = (l.fecha_limite ?? l.actualizada_en).slice(0, 4);
  const expediente = limpiarNombre(l.expediente.replace(/\//g, '-'), 80) || 'sin-expediente';
  return path.posix.join(radar, anio, `${expediente} (${l.id})`);
}

// Órganos con nombres larguísimos: lo habitual se abrevia para que el nombre de la carpeta
// se lea entero en Drive. El orden importa (Las Palmas de Gran Canaria antes que Gran Canaria).
const ABREVIATURAS: [RegExp, string][] = [
  [/\bComplejo Hospitalario Universitario\b/gi, 'CHU'],
  [/\bHospital Universitario\b/gi, 'HU'],
  [/\bServicio Canario de (la )?Salud\b/gi, 'SCS'],
  [/\bAyuntamiento de\b/gi, 'Ayto.'],
  [/\bCabildo (Insular )?de\b/gi, 'Cabildo'],
  [/\bDirecci[oó]n General de\b/gi, 'DG'],
  [/\bComunidad Aut[oó]noma de\b/gi, 'CA'],
  [/\bUniversidad de\b/gi, 'Univ.'],
  [/\bLas Palmas de Gran Canaria\b/gi, 'LPGC'],
  [/\bSanta Cruz de Tenerife\b/gi, 'SC Tenerife'],
  [/\bGran Canaria\b/gi, 'GC'],
];
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'por', 'a', 'al', 'con']);
const INICIO_GENERICO =
  /^(contrataci[oó]n|prestaci[oó]n|adquisici[oó]n|servicios?|suministros?|acuerdo marco|contrato)(\s+(de|del|para|la|las|el|los))*\s+/i;

/** Corta en palabra entera a `max` caracteres y quita palabras vacías del final. */
function recortar(texto: string, max: number): string {
  const palabras = texto.split(' ');
  const out: string[] = [];
  for (const p of palabras) {
    if ([...out, p].join(' ').length > max) break;
    out.push(p);
  }
  while (out.length > 1 && VACIAS.has(out[out.length - 1]!.toLowerCase())) out.pop();
  return out.join(' ') || texto.slice(0, max);
}

export function abreviarOrgano(nombre: string, max = 35): string {
  const corto = ABREVIATURAS.reduce((t, [re, abr]) => t.replace(re, abr), limpiarNombre(nombre, 300));
  const palabras = corto.split(' ').filter((p, i) => i === 0 || !VACIAS.has(p.toLowerCase()));
  return recortar(palabras.join(' '), max);
}

/** Tema del título sin «Contratación del servicio de…» delante, con mayúscula. */
export function temaDe(titulo: string, max = 40): string {
  let t = limpiarNombre(titulo, 300);
  for (let i = 0; i < 3 && INICIO_GENERICO.test(t); i++) t = t.replace(INICIO_GENERICO, '');
  t = recortar(t, max);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type DatosPresentada = { presentada_en: string; expediente: string; organo_nombre: string; titulo: string };

// Nombres de carpeta de Drive de hasta 100 caracteres: el tema se lleva lo que sobre.
const MAX_NOMBRE = 100;

const expedienteCarpeta = (expediente: string) => limpiarNombre(expediente.replace(/\//g, '-'), 30) || 'sin-expediente';

/** «AAAA-MM - expediente - órgano abreviado - tema», el formato con el que el equipo ya archivaba. */
export function nombrePresentada(d: DatosPresentada): string {
  const expediente = expedienteCarpeta(d.expediente);
  const prefijo = `${d.presentada_en.slice(0, 7)} - ${expediente} - ${abreviarOrgano(d.organo_nombre) || 'sin-organo'} - `;
  return limpiarNombre(
    `${prefijo}${temaDe(d.titulo, Math.max(10, MAX_NOMBRE - prefijo.length)) || 'sin-tema'}`,
    MAX_NOMBRE,
  );
}

/**
 * ¿Es `nombre` la carpeta de lo presentado de ese expediente («AAAA-MM - <expediente> - …»)?
 * Así se reutiliza la que el equipo ya tenía (con su órgano y tema escritos a mano) en vez
 * de crear otra para la misma licitación.
 */
export function esCarpetaDeExpediente(nombre: string, expediente: string): boolean {
  return (
    ES_PRESENTADA.test(nombre) &&
    nombre
      .slice(7)
      .toLowerCase()
      .startsWith(` - ${expedienteCarpeta(expediente).toLowerCase()} - `)
  );
}

export type CambioRuta = { de: string; a: string };

// Texto de una ruta tal como queda dentro de un JSON guardado (comillas o barras escapadas).
const enJson = (s: string) => JSON.stringify(s).slice(1, -1);

// Columnas con una ruta relativa a Conocimiento (sin prefijo) o a la raíz de documentos
// («Conocimiento/…»). Nombres fijos del código, nunca entrada.
const COLUMNAS_RUTA = [
  { tabla: 'pliegos', columna: 'ruta', prefijo: '', o: '' },
  { tabla: 'nucleo.documentos', columna: 'ruta', prefijo: '', o: 'OR IGNORE ' },
  { tabla: 'evaluaciones', columna: 'documento', prefijo: 'Conocimiento/', o: '' },
];
const COLUMNAS_JSON = [
  { tabla: 'propuestas', columna: 'documentos' },
  { tabla: 'fichas', columna: 'datos' },
  { tabla: 'nucleo.trabajos_ia', columna: 'payload' },
];

function cambiarPrefijos(db: Db, c: CambioRuta): number {
  let n = 0;
  for (const { tabla, columna, prefijo, o } of COLUMNAS_RUTA) {
    n += db
      .prepare(
        `UPDATE ${o}${tabla} SET ${columna} = @a || substr(${columna}, length(@de) + 1)
      WHERE substr(${columna}, 1, length(@de) + 1) = @de || '/'`,
      )
      .run({ de: prefijo + c.de, a: prefijo + c.a }).changes;
  }
  return n;
}

function cambiarEnJson(db: Db, c: CambioRuta): number {
  let n = 0;
  for (const prefijo of ['', 'Conocimiento/']) {
    const viejo = `"${enJson(`${prefijo}${c.de}/`)}`;
    const nuevo = `"${enJson(`${prefijo}${c.a}/`)}`;
    for (const { tabla, columna } of COLUMNAS_JSON) {
      n += db
        .prepare(`UPDATE ${tabla} SET ${columna} = replace(${columna}, ?, ?) WHERE instr(${columna}, ?) > 0`)
        .run(viejo, nuevo, viejo).changes;
    }
  }
  return n;
}

/**
 * Cambia en la base todo lo que apunta dentro de la carpeta `de` para que apunte a `a`
 * (rutas relativas a Conocimiento, sin barra final): pliegos, documentos del núcleo,
 * documentos de las propuestas, evaluaciones, páginas citadas en las fichas y trabajos de
 * IA en cola; también su copia de Google Docs en .gdocs/. `db` es licitaciones.db con
 * nucleo.db adjunta. Devuelve cuántas filas cambiaron.
 */
export function actualizarRutas(db: Db, c: CambioRuta): number {
  const variantes = [c, { de: `.gdocs/${c.de}`, a: `.gdocs/${c.a}` }];
  return db.transaction(() => variantes.reduce((n, v) => n + cambiarPrefijos(db, v) + cambiarEnJson(db, v), 0))();
}

// Cambios de ruta que no se pudieron aplicar tras mover una carpeta: se guardan aparte y
// se reaplican en cada pasada, porque la carpeta ya no está en el sitio viejo y nada más
// permitiría deducirlos.
const CLAVE_RUTAS_PENDIENTES = 'licitaciones.rutas_pendientes';
const Pendientes = z.array(z.object({ de: z.string(), a: z.string() })).catch([]);

function leerPendientes(): CambioRuta[] {
  return leerOperacion(nucleo().db, CLAVE_RUTAS_PENDIENTES, (raw) => Pendientes.parse(raw ?? []))?.datos ?? [];
}

function guardarPendientes(lista: CambioRuta[]): void {
  guardarOperacion(nucleo().db, CLAVE_RUTAS_PENDIENTES, lista.length ? 'pendiente' : 'al_dia', lista);
}

// Base de datos y propuestas de nota pendientes de la Biblioteca; las dos cosas son idempotentes.
async function aplicar(db: Db, c: CambioRuta): Promise<string | null> {
  try {
    log.info('rutas guardadas actualizadas', { de: c.de, a: c.a, filas: actualizarRutas(db, c) });
  } catch (err) {
    return `no se pudieron actualizar las rutas guardadas: ${errorMessage(err)}`;
  }
  const p = await moverFuentesPropuestas(c.de, c.a);
  return p.error ? `no se pudieron actualizar las propuestas de nota pendientes: ${p.error.message}` : null;
}

/**
 * Tras mover una carpeta, apunta a la ruta nueva todo lo guardado. Si algo falla, el cambio
 * queda anotado para reaplicarlo (reaplicarRutasPendientes) y se devuelve el motivo.
 */
export async function apuntarRutas(db: Db, c: CambioRuta): Promise<string | null> {
  const error = await aplicar(db, c);
  if (!error) return null;
  try {
    guardarPendientes([...leerPendientes(), c]);
  } catch (err) {
    log.error('cambio de ruta sin anotar', { de: c.de, a: c.a, error: errorMessage(err) });
  }
  log.error('rutas sin actualizar tras mover', { de: c.de, a: c.a, error });
  return error;
}

/** Reaplica los cambios de ruta que fallaron. Devuelve los que siguen fallando. */
export async function reaplicarRutasPendientes(db: Db): Promise<{ ruta: string; motivo: string }[]> {
  const pendientes = leerPendientes();
  if (!pendientes.length) return [];
  const siguen: CambioRuta[] = [];
  const errores: { ruta: string; motivo: string }[] = [];
  for (const c of pendientes) {
    const error = await aplicar(db, c);
    if (error) {
      siguen.push(c);
      errores.push({ ruta: c.de, motivo: `movida a «${c.a}», pero ${error}` });
    }
  }
  guardarPendientes(siguen);
  return errores;
}
