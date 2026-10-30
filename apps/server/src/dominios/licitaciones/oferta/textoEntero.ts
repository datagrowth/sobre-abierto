// El texto de una versión subida a mano que no se pudo repartir entero por los apartados del guion.
import fs from 'node:fs';
import { z } from 'zod';
import type { ElementoDocx } from '../../../nucleo/documentos/leerDocx.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { frases } from './fugas.js';
import { localizarTitulos } from './memoriaTexto.js';

// Es lo que queda antes del primer título encontrado (el bloque «sin apartado» de un reparto parcial) y los
// párrafos de una versión guardada entera, que las lecciones comparan con la última de Hermes. Los párrafos se
// guardan en el .json de la versión al subirla (subidaFlexible.ts) porque el .md va por páginas y no casa
// párrafo a párrafo; el .md entero es lo que leyó Hermes, y con él se comprueban los genéricos de su evaluación.
// Las líneas del índice («2. Metodología ........ 7») no son contenido: se quedan fuera.
const LINEA_DE_INDICE = /(?:\.{3,}|…+|\t)\s*\d+$/;

const textoDe = (e: ElementoDocx): string =>
  e.tipo === 'parrafo' ? e.texto.trim() : e.filas.map((f) => f.join(' | ')).join('\n');

/** Los párrafos con texto, en orden (tablas como filas «a | b»). */
export function parrafosDeElementos(es: ElementoDocx[]): string[] {
  return es.map(textoDe).filter((t) => t.length > 0);
}

/** Lo que hay antes del primer título del guion encontrado (sin el índice); null si nada o si no se encontró ninguno. */
export function textoSinApartado(es: ElementoDocx[], titulos: string[]): string | null {
  const primero = localizarTitulos(es, titulos).find((x): x is number => x !== null);
  if (primero === undefined) return null;
  const parrafos = parrafosDeElementos(es.slice(0, primero)).filter((t) => !LINEA_DE_INDICE.test(t));
  return parrafos.length ? parrafos.join('\n\n') : null;
}

/** La sección «Sin apartado» del .md de una versión repartida a medias ('' si no hay nada fuera de los apartados). */
export function seccionSinApartado(es: ElementoDocx[], titulos: string[]): string {
  const t = textoSinApartado(es, titulos);
  return t
    ? [
        '',
        '',
        '## Sin apartado',
        '',
        'Lo que el documento trae antes del primer título del guion: no pasa a las versiones que monte la plataforma.',
        '',
        t,
      ].join('\n')
    : '';
}

const JsonEntero = z.object({ parrafos: z.array(z.string()) });

// Un archivo de la versión en Salidas (su .md o su .json); null si falta o no se puede leer.
function archivoDeLaVersion(
  db: Db,
  memoriaId: number,
  columna: 'ruta_md' | 'ruta_json',
  raices: Raices,
): string | null {
  const b = db
    .prepare(`SELECT b.${columna} AS ruta FROM memorias m JOIN borradores b ON b.id = m.borrador_id WHERE m.id = ?`)
    .get(memoriaId) as { ruta: string | null } | undefined;
  if (!b?.ruta) return null;
  const abs = documentoEnDisco(raices, b.ruta);
  if (abs.error || !fs.existsSync(abs.data)) return null;
  return fs.readFileSync(abs.data, 'utf8');
}

/** Los párrafos de una versión guardada entera, desde su .json en Salidas; [] si no se pueden leer. */
export function parrafosDeVersionEntera(db: Db, memoriaId: number, raices: Raices = raicesActuales()): string[] {
  const json = archivoDeLaVersion(db, memoriaId, 'ruta_json', raices);
  if (json === null) return [];
  try {
    const j = JsonEntero.safeParse(JSON.parse(json));
    return j.success ? j.data.parrafos : [];
  } catch {
    // Un .json tocado a mano en Drive: sin párrafos no hay con qué comparar (lecciones.ts lo dice).
    return [];
  }
}

/** El texto entero de una versión subida a mano (su .md: apartados, «Sin apartado» o el documento); null si no se lee. */
export function textoDeVersionSubida(db: Db, memoriaId: number, raices: Raices = raicesActuales()): string | null {
  return archivoDeLaVersion(db, memoriaId, 'ruta_md', raices);
}

const clave = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();
const MIN_FRASE = 15;

const frasesDe = (parrafo: string): string[] => {
  const partes = frases(parrafo)
    .map(clave)
    .filter((f) => f.length >= MIN_FRASE);
  return partes.length ? partes : [clave(parrafo)];
};

// Un PDF trae los párrafos cortados por página y con la cabecera o el pie pegados: un párrafo
// de Hermes sigue si al menos la mitad de sus frases están en el texto subido…
function sigue(parrafo: string, subido: string): boolean {
  const partes = frasesDe(parrafo);
  return partes.filter((f) => subido.includes(f)).length * 2 >= partes.length;
}

// …y uno subido es nuevo si las frases de Hermes que contiene no llegan a la mitad de su texto.
function esNuevo(k: string, deHermes: string, frasesHermes: string[]): boolean {
  if (!k || deHermes.includes(k)) return false;
  return frasesHermes.filter((f) => k.includes(f)).reduce((n, f) => n + f.length, 0) * 2 < k.length;
}

/**
 * Lo quitado (párrafos de Hermes que ya no están) y lo añadido (párrafos subidos que Hermes no
 * escribió, sin repetir: una cabecera suelta en cada página cuenta una vez) entre la versión de
 * Hermes y una subida entera. Por contenido, no párrafo a párrafo.
 */
export function cambiosEnTextoEntero(antes: string[], despues: string[]): { quitados: string[]; anadidos: string[] } {
  const subido = clave(despues.join(' '));
  const deHermes = clave(antes.join(' '));
  const frasesHermes = [...new Set(antes.flatMap(frasesDe))];
  const vistos = new Set<string>();
  const anadidos = despues.filter((x) => {
    const k = clave(x);
    if (vistos.has(k) || !esNuevo(k, deHermes, frasesHermes)) return false;
    vistos.add(k);
    return true;
  });
  return { quitados: antes.filter((x) => !sigue(x, subido)), anadidos };
}
