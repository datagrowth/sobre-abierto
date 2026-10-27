// Lotes de una licitación: la regla de presentación, los lotes que eligió la criba y el ámbito de la oferta.
import { z } from 'zod';
import { PRESENTACION_LOTES } from './placsp/codigos.js';
import type { Db } from './store.js';

// La regla de presentación es a un solo lote, a todos o a uno o varios. El ámbito es contra lo que se miden el
// importe, los requisitos, los precios y el equipo: si hay que presentarse a todos los lotes, el contrato
// entero; si la criba no eligió lotes, los que encajaron en el prefiltro; y si ninguno, el total. Es la fuente
// única de los lotes de la oferta (decisiones, guion y ficha se comparan con él).
type CodigoPresentacion = '1' | '2' | '3';
export const UN_LOTE = '1';
export const TODOS_LOS_LOTES = '2';

const LoteGuardado = z.object({
  id: z.string(),
  nombre: z.string().nullable().catch(null),
  presupuesto_sin_iva: z.number().nullable().catch(null),
  cpvs: z.array(z.string()).catch([]),
});
export type LoteDatos = z.infer<typeof LoteGuardado>;

// licitaciones.datos: las versiones guardadas antes de la regla no traen «presentacion».
const DatosLotes = z
  .object({
    lotes: z.array(LoteGuardado).catch([]),
    presentacion: z
      .object({ combinacion: z.string().nullable().catch(null) })
      .nullable()
      .optional()
      .catch(null),
  })
  .catch({ lotes: [], presentacion: null });

function leerJson(texto: string | null | undefined): unknown {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

export function lotesDeDatos(datos: string): LoteDatos[] {
  return DatosLotes.parse(leerJson(datos)).lotes;
}

const SIGNO = String.raw`[_:.\-–—)]`;
const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// El «Lote N» con que la PLACSP abre a veces el nombre: «Lote 3: …», «LOTE Nº 3.- …»,
// «Lote 1 Servicios…», «l1_servicio…» o «3. …». «L3» o un número suelto, solo con un signo
// detrás: «3 cursos de inglés» es el nombre.
function prefijoDeLote(id: string): RegExp {
  const n = `0*${escaparRegex(id.replace(/^0+(?=.)/, ''))}`;
  const numero = String.raw`(?:n\.?\s*[º°o]\.?|n[uú]m(?:ero)?\.?)?`;
  const corto = String.raw`(?=\s*${SIGNO})`;
  return new RegExp(
    String.raw`^(?:lote\s*${numero}\s*${n}|l${n}${corto}|${n}${corto})(?![\p{L}\p{N}])[\s_:.\-–—)]*`,
    'iu',
  );
}

/** «Lote 3: Nombre» con «Lote 3» una sola vez, venga como venga el nombre de la PLACSP. */
export function etiquetaLote(id: string, nombre: string | null | undefined): string {
  const prefijo = prefijoDeLote(id);
  let resto = (nombre ?? '').trim();
  for (let antes = ''; resto && resto !== antes;) {
    antes = resto;
    resto = resto.replace(prefijo, '').trim();
  }
  return resto ? `Lote ${id}: ${resto}` : `Lote ${id}`;
}

const LoteInteres = z.object({ id: z.string(), motivo: z.string() });
export type LoteInteresData = z.infer<typeof LoteInteres>;

/** oportunidades.lotes_interes ([{id, motivo}]); vacío si no hay o no se entiende. */
export function leerLotesInteres(texto: string | null | undefined): LoteInteresData[] {
  return z.array(LoteInteres).catch([]).parse(leerJson(texto));
}

/** oportunidades.lotes_prefiltro (ids). */
export function leerIds(texto: string | null | undefined): string[] {
  return z.array(z.string()).catch([]).parse(leerJson(texto));
}

const EUROS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
export const eurosTexto = (n: number | null): string => (n === null ? 'importe sin publicar' : `${EUROS.format(n)} €`);

// Lo que confirma la ficha aprobada (leído del PCAP) cuando la PLACSP no publica la regla.
const REGLAS_FICHA = { un_lote: '1', todos_los_lotes: '2', uno_o_varios: '3' } as const;
type ReglaFicha = keyof typeof REGLAS_FICHA;

export type Presentacion = {
  codigo: CodigoPresentacion | null;
  regla: string;
  origen: 'placsp' | 'ficha' | null;
  sin_confirmar: boolean;
  maximo_lotes: number | null;
  maximo_adjudicables: number | null;
  combinacion: string | null;
};

// Una fila de licitaciones con lo que hace falta de su oportunidad y de su ficha aprobada.
export type FilaLotes = {
  datos: string;
  presentacion_lotes?: string | null;
  max_lotes_oferta?: number | null;
  max_lotes_adjudicacion?: number | null;
  regla_ficha?: string | null;
  maximo_ficha?: number | null;
  lotes_interes?: string | null;
  lotes_prefiltro?: string | null;
  presupuesto_sin_iva?: number | null;
  cpvs?: string;
};

// Object.hasOwn y no `in`: `in` también ve «toString» o «constructor» del prototipo.
const esCodigo = (c: string | null | undefined): c is CodigoPresentacion =>
  c != null && Object.hasOwn(PRESENTACION_LOTES, c);

function codigoDeFicha(regla: string | null | undefined): CodigoPresentacion | null {
  return regla && Object.hasOwn(REGLAS_FICHA, regla) ? REGLAS_FICHA[regla as ReglaFicha] : null;
}

/**
 * Regla de presentación: la de la PLACSP o, sin ella, la que confirmó la ficha aprobada
 * (y lo mismo con el máximo de lotes por oferta). Null si no hay lotes.
 */
function presentacionDe(f: FilaLotes, lotes: LoteDatos[]): Presentacion | null {
  if (!lotes.length) return null;
  const dePlacsp = esCodigo(f.presentacion_lotes) ? f.presentacion_lotes : null;
  const codigo = dePlacsp ?? codigoDeFicha(f.regla_ficha);
  return {
    codigo,
    origen: dePlacsp ? 'placsp' : codigo ? 'ficha' : null,
    sin_confirmar: codigo === null,
    regla: codigo
      ? (PRESENTACION_LOTES[codigo] ?? codigo)
      : 'Sin confirmar: la PLACSP no la publica (está en el pliego)',
    maximo_lotes: f.max_lotes_oferta ?? f.maximo_ficha ?? null,
    maximo_adjudicables: f.max_lotes_adjudicacion ?? null,
    combinacion: DatosLotes.parse(leerJson(f.datos)).presentacion?.combinacion ?? null,
  };
}

type LoteElegido = LoteDatos & { motivo: string };

// origen: de dónde salen los lotes del ámbito. aviso: lo que hay que saber al leerlo (importe
// que se mide con el total). error: hay más lotes en juego de los que permite la regla; no se
// recorta (cuáles se quedan lo decide una persona) y la oferta no está lista hasta elegir.
export type Ambito = {
  por_lotes: boolean;
  origen: 'interes' | 'prefiltro' | 'total';
  lotes: LoteElegido[];
  importe: number | null;
  cpvs: string[];
  descripcion: string;
  aviso: string | null;
  error: string | null;
};

const MOTIVO_PREFILTRO = 'Encajó en el prefiltro (la criba no eligió lotes)';

function descripcionTotal(lotes: number, p: Presentacion | null): string {
  if (!lotes) return 'Contrato entero';
  return p?.codigo === TODOS_LOS_LOTES
    ? 'Todos los lotes (hay que presentarse a todos)'
    : 'Contrato entero (sin lotes de interés elegidos)';
}

// Los de interés de la criba o, sin ellos, los que encajaron en el prefiltro.
function lotesEnJuego(f: FilaLotes, lotes: LoteDatos[]): { origen: 'interes' | 'prefiltro'; elegidos: LoteElegido[] } {
  const deLista = (ids: LoteInteresData[]) =>
    ids.flatMap((i): LoteElegido[] => {
      const lote = lotes.find((l) => l.id === i.id);
      return lote ? [{ ...lote, motivo: i.motivo }] : [];
    });
  const interes = deLista(leerLotesInteres(f.lotes_interes));
  if (interes.length) return { origen: 'interes', elegidos: interes };
  return {
    origen: 'prefiltro',
    elegidos: deLista(leerIds(f.lotes_prefiltro).map((id) => ({ id, motivo: MOTIVO_PREFILTRO }))),
  };
}

// A un solo lote, o un máximo por oferta: cuántos lotes caben en una oferta (null sin tope).
function limiteDe(p: Presentacion | null): number | null {
  return p?.codigo === UN_LOTE ? 1 : (p?.maximo_lotes ?? null);
}

const enumerar = (lotes: LoteElegido[]) => lotes.map((l) => l.id).join(', ');

function avisoDe(sinImporte: LoteElegido[]): string | null {
  if (!sinImporte.length) return null;
  const uno = sinImporte.length === 1;
  return `${uno ? 'El lote' : 'Los lotes'} ${enumerar(sinImporte)} no ${uno ? 'publica' : 'publican'} importe: cuenta el del contrato.`;
}

function excesoDe(enJuego: LoteElegido[], limite: number | null, origen: Ambito['origen']): string | null {
  if (limite === null || enJuego.length <= limite) return null;
  const cuales = origen === 'prefiltro' ? 'encajaron en el prefiltro' : 'son de interés';
  return `La regla permite ${limite === 1 ? 'un solo lote' : `${limite} lotes`} por oferta y ${enJuego.length} lotes ${cuales} (${enumerar(enJuego)}): elige ${limite === 1 ? 'a cuál vamos' : 'a cuáles vamos'} en el bloque Lotes.`;
}

/**
 * Contra qué se mide la licitación: los lotes de interés (o del prefiltro), o el total si
 * hay que ir a todos o no hay lotes en juego. Si pasan de lo que permite la regla, no se
 * recortan: `error` lo dice. Si algún lote en juego no publica importe, el importe queda
 * null (se mide con el total).
 */
function ambitoDe(f: FilaLotes, lotes: LoteDatos[], p: Presentacion | null): Ambito {
  const total = { importe: f.presupuesto_sin_iva ?? null, cpvs: (f.cpvs ?? '').split(',').filter(Boolean) };
  const { origen, elegidos } =
    p?.codigo === TODOS_LOS_LOTES ? { origen: 'total' as const, elegidos: [] } : lotesEnJuego(f, lotes);
  if (!elegidos.length)
    return {
      por_lotes: false,
      origen: 'total',
      lotes: [],
      ...total,
      descripcion: descripcionTotal(lotes.length, p),
      aviso: null,
      error: null,
    };
  const sinImporte = elegidos.filter((l) => l.presupuesto_sin_iva === null);
  const cpvs = [...new Set(elegidos.flatMap((l) => l.cpvs))];
  const ids = `${elegidos.length === 1 ? 'Lote' : 'Lotes'} ${enumerar(elegidos)}`;
  return {
    por_lotes: true,
    origen,
    lotes: elegidos,
    cpvs: cpvs.length ? cpvs : total.cpvs,
    importe: sinImporte.length ? null : elegidos.reduce((a, l) => a + (l.presupuesto_sin_iva ?? 0), 0),
    descripcion: origen === 'prefiltro' ? `${ids} (del prefiltro)` : ids,
    aviso: avisoDe(sinImporte),
    error: excesoDe(elegidos, limiteDe(p), origen),
  };
}

/** Unos lotes en una frase, con su preposición: «al lote 2», «a los lotes 2, 4», «del lote 4», «para los lotes 2, 6». */
export function conLotes(prep: 'a' | 'de' | 'para', ids: string[]): string {
  if (ids.length !== 1) return `${prep} los lotes ${ids.join(', ')}`;
  return `${{ a: 'al', de: 'del', para: 'para el' }[prep]} lote ${ids[0]}`;
}

/** Los ids de los lotes del ámbito: los de la oferta. Vacío si se mide con el contrato entero. */
export function idsDelAmbito(a: Ambito): string[] {
  return a.por_lotes ? a.lotes.map((l) => l.id) : [];
}

export type LotesLicitacion = { lotes: LoteDatos[]; presentacion: Presentacion | null; ambito: Ambito };

export function lotesDeFila(f: FilaLotes): LotesLicitacion {
  const lotes = lotesDeDatos(f.datos);
  const presentacion = presentacionDe(f, lotes);
  return { lotes, presentacion, ambito: ambitoDe(f, lotes, presentacion) };
}

// Regla y máximo de lotes que confirmó la última ficha aprobada, como columnas regla_ficha
// y maximo_ficha. `alias` es un nombre fijo del código (la tabla licitaciones en la
// consulta) y `campo` una constante de aquí, nunca entrada.
const sqlDeFicha = (
  alias: string,
  campo: 'regla' | 'maximo_lotes',
): string => `(SELECT json_extract(fi.datos, '$.presentacion_lotes.${campo}')
  FROM fichas fi WHERE fi.licitacion_id = ${alias}.id AND fi.estado = 'aprobada' ORDER BY fi.revisada_en DESC, fi.id DESC LIMIT 1)`;
export const sqlReglaFicha = (alias: string): string =>
  `${sqlDeFicha(alias, 'regla')} AS regla_ficha, ${sqlDeFicha(alias, 'maximo_lotes')} AS maximo_ficha`;

export const COLUMNAS_LOTES =
  'l.datos, l.presentacion_lotes, l.max_lotes_oferta, l.max_lotes_adjudicacion, l.presupuesto_sin_iva, l.cpvs';

/** Lotes, regla y ámbito de una licitación guardada; null si no existe. */
export function lotesDeLicitacion(db: Db, id: string): LotesLicitacion | null {
  const f = db
    .prepare(
      `SELECT ${COLUMNAS_LOTES}, o.lotes_interes, o.lotes_prefiltro, ${sqlReglaFicha('l')}
    FROM licitaciones l LEFT JOIN oportunidades o ON o.licitacion_id = l.id WHERE l.id = ?`,
    )
    .get(id) as FilaLotes | undefined;
  return f ? lotesDeFila(f) : null;
}
