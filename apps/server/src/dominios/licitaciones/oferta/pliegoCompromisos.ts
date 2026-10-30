// Pasajes literales del PPT y del PCAP con los que se coteja si el pliego exige un compromiso de la memoria.
import { abrirIndiceLectura } from '../../../biblioteca/motor/documentos/servicioIndice.js';
import * as indice from '../../../biblioteca/motor/documentos/almacen.js';
import { logger } from '../../../nucleo/log.js';
import type { Db } from '../store.js';
import type { Pasaje } from '../pasajes.js';
import { estadoEnIndice } from '../pliegosIndice.js';
import { marcasDe, textoComparable, type Tema } from '../temas.js';

// Se coteja si un compromiso de la memoria lo exige el pliego o lo añade la empresa (costesCompromisos).
// Síncrono y sin escrituras: las comprobaciones lo leen dentro de su transacción. Leer todos los trozos de dos
// pliegos en cada recálculo sería lo caro, así que el resultado se guarda en memoria por licitación mientras no
// cambien sus pliegos (ni lo que el índice tiene de ellos).
export type PasajesCompromisos = { pasajes: Pasaje[]; cotejable: boolean };

const log = logger('licitaciones.pliegoCompromisos');
const MAX_CACHE = 50;
const NO_COTEJABLE: PasajesCompromisos = Object.freeze({
  pasajes: Object.freeze([]) as unknown as Pasaje[],
  cotejable: false,
});
// Lo que obliga al adjudicatario. Sobre texto comparable (minúsculas y sin tildes).
const MARCAS_OBLIGACION: readonly RegExp[] = [
  /\bdeber(a|an)\b/,
  /\bcomo minimo\b/,
  /\bal menos\b/,
  /\bminimo de\b/,
  /\b(la empresa|la entidad|el|la) (adjudicatari[oa]|contratista)\b/,
  /\bobligatori[oa]s?\b/,
  /\bse (exige|requiere)n?\b/,
];
const TEMAS_OBLIGACION: readonly Tema[] = [
  'prestaciones',
  'niveles_servicio',
  'metodologia_entregables',
  'criterios_adjudicacion',
];

type FilaPliego = { ruta: string; clase: string; actualizado_en: string };
type Entrada = { huella: string; valor: PasajesCompromisos };

// LRU por id de licitación: Map conserva el orden de inserción y cada acierto se reinserta al final.
const cache = new Map<string, Entrada>();

function pliegosPrincipales(dbLic: Db, id: string): FilaPliego[] {
  return dbLic
    .prepare(
      `SELECT ruta, clase, actualizado_en FROM pliegos
    WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL AND clase IN ('ppt', 'pcap') ORDER BY ruta`,
    )
    .all(id) as FilaPliego[];
}

// Incluye lo que el índice sabe de cada pliego: uno que se indexa (o reindexa) después cambia la huella.
function huellaDe(idx: indice.BaseDatos, filas: FilaPliego[]): string {
  return filas
    .map((f) => {
      const archivo = indice.obtenerArchivo(idx, f.ruta);
      return [f.ruta, f.actualizado_en, archivo?.status ?? '-', archivo?.mtime_ms ?? '-', archivo?.chunks ?? '-'].join(
        '|',
      );
    })
    .join('\n');
}

function obliga(texto: string): boolean {
  const comparable = textoComparable(texto);
  return (
    MARCAS_OBLIGACION.some((re) => re.test(comparable)) || TEMAS_OBLIGACION.some((t) => marcasDe(t, comparable) > 0)
  );
}

function calcular(idx: indice.BaseDatos, filas: FilaPliego[]): PasajesCompromisos {
  const legibles = filas.filter((f) => estadoEnIndice(idx, f.ruta).estado_indice === 'ok');
  if (!legibles.length) return NO_COTEJABLE;
  const clase = new Map(legibles.map((f) => [f.ruta, f.clase]));
  const pasajes = indice
    .trozosDeRutas(idx, [...clase.keys()])
    .filter((c) => obliga(c.text))
    .map((c) => ({ ruta: c.path, clase: clase.get(c.path) ?? 'ppt', pagina: c.page, texto: c.text }));
  return { pasajes, cotejable: true };
}

function guardar(id: string, entrada: Entrada): void {
  cache.delete(id);
  cache.set(id, entrada);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

/** Pasajes con obligaciones del PPT y del PCAP legibles; sin índice o sin pliego legible, cotejable=false. */
export function pasajesParaCompromisos(
  dbLic: Db,
  id: string,
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): PasajesCompromisos {
  if (!idx) return NO_COTEJABLE;
  try {
    const filas = pliegosPrincipales(dbLic, id);
    const huella = huellaDe(idx, filas);
    const previa = cache.get(id);
    if (previa?.huella === huella) {
      guardar(id, previa);
      return previa.valor;
    }
    const valor = calcular(idx, filas);
    guardar(id, { huella, valor });
    return valor;
  } catch (e) {
    // Índice a medio crear o tabla ausente: sin cotejo, pero las comprobaciones no se caenn.
    log.warn('pasajes_compromisos_fallo', { licitacion: id, error: e instanceof Error ? e.message : String(e) });
    return NO_COTEJABLE;
  }
}
