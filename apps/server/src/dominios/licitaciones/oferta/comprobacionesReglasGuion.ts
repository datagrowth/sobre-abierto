// Validaciones del guion por código, antes de darlo por bueno. Puras: leen la ficha y el guion de las entradas.
import { textoComparable } from '../temas.js';
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import {
  MINUTOS_POR_ACCION,
  claveBloqueo,
  huellaDe,
  type AccionBloqueo,
  type Bloqueo,
  type Categoria,
  type Cita,
  type Gravedad,
} from './comprobacionesTipos.js';
import type { GuionBaseData } from './guion.js';
import { archivosEconomicos, automaticosDeLote, ofertaDeLote } from './guionLotes.js';
import { memoriaValorable, puntosTexto } from './guionRevision.js';

// Los puntos de cada lote suman lo que reparte el pliego, la fórmula del precio es de un tipo conocido y la
// memoria de juicio de valor no va en el archivo de la oferta económica.
export type TipoFormula = 'tramos' | 'media' | 'logaritmica' | 'lineal' | 'proporcional';

// Primero la forma de la fórmula y después las palabras: el texto de una fórmula lineal suele citar
// el precio más bajo o la baja media del umbral, y eso no la hace proporcional ni «sobre la media».
const RANGO = /(?:de|entre|desde)\s+\d+(?:[.,]\d+)?\s*%?\s*(?:a|y|hasta|al)\s+\d+(?:[.,]\d+)?\s*%/g;
const FORMULAS: readonly [TipoFormula, RegExp][] = [
  ['tramos', /\btramos?\b|escalonad/],
  ['logaritmica', /\blog(?:aritm\w*|\s*\(|\s*[₁1]|\b)|\bln\s*\(/],
  [
    'media',
    /\b(?:pmed|omed|bmed)\s*\/|\/\s*(?:pmed|omed)\b|media aritmetica|precio medio|oferta media|media de (?:las|los) (?:ofertas|precios)/,
  ],
  // (PBL - Oi) / (PBL - Omin), 1 - (Oi - Omin) / Pbase, Bi / Bmax, «por cada 1 % de baja».
  [
    'lineal',
    /\([^()]*-[^()]*\)\s*\/|\b(?:b|bi|baja\w*)\s*\/\s*(?:bmax|bm|baja\s+maxima|mayor\s+baja)\b|por cada \d+(?:[.,]\d+)?\s*(?:%|por ciento|puntos? porcentual\w*) de baja/,
  ],
  // Omin / Oi, «oferta más baja / oferta».
  ['proporcional', /\b(?:omin|pmin|bmin|ob|om)\s*\/|(?:oferta mas baja|precio mas bajo|mejor oferta)\s*\//],
  ['lineal', /\blineal|proporcional(?:mente)? a la baja|porcentaje de baja/],
  ['proporcional', /proporcional|regla de tres|inversamente/],
  ['media', /\bmedia\b|\bpromedio\b/],
];

// Los signos como se escriben en los pliegos (·, ×, ÷, guiones largos) a los de siempre.
const normalizarFormula = (f: string): string =>
  textoComparable(f).replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/[–—−]/g, '-').replace(/\s+/g, ' ');

/**
 * El tipo de una fórmula de precio, o null si no es ninguno de los que la plataforma conoce (o el
 * texto no trae fórmula: «el criterio de la mejor oferta» sin decir cómo puntúa a las demás).
 */
export function tipoFormula(formula: string): TipoFormula | null {
  const t = normalizarFormula(formula);
  if ((t.match(RANGO) ?? []).length >= 2) return 'tramos';
  return FORMULAS.find(([, re]) => re.test(t))?.[0] ?? null;
}

type Fila = {
  regla: string;
  lote: string | null;
  sujeto?: string;
  categoria: Categoria;
  gravedad: Gravedad;
  titulo: string;
  cita: Cita | null;
  guion: number;
};

function fila(f: Fila): Bloqueo {
  const accion: AccionBloqueo = 'extraer_guion';
  return {
    clave: claveBloqueo(f.regla, f.lote, f.sujeto),
    categoria: f.categoria,
    lote: f.lote,
    gravedad: f.gravedad,
    titulo: f.titulo,
    cita: f.cita,
    actor: 'tu',
    accion: { tipo: accion, destino: 'guion' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION[accion],
    estado: 'abierto',
    huella: huellaDe(f.regla, f.lote, f.guion, f.titulo),
  };
}

// «Lote 2: mejora económica…»: la ficha reparte los puntos por lote.
const DE_LOTE = /^\s*lote\s+([\w.]+)\s*[:.–-]/i;
const PRECIO = /precio|economic/;
type CriterioFicha = { descripcion: string; peso: number; tipo: string };

function criteriosDeLote(criterios: readonly CriterioFicha[], lote: string | null): CriterioFicha[] {
  if (lote === null || !criterios.some((c) => DE_LOTE.test(c.descripcion))) return [...criterios];
  return criterios.filter((c) => {
    const m = DE_LOTE.exec(c.descripcion);
    return !m || textoComparable(m[1]!) === textoComparable(lote);
  });
}

// Un automático del guion que parece el precio: sumarlo con el precio de la ficha lo contaría dos veces.
const AUTOMATICO_PRECIO = /\bprecio\b|oferta economica/;

const nombres = (cs: readonly CriterioFicha[]): string => cs.map((c) => `«${c.descripcion.slice(0, 60)}»`).join(', ');

// Por qué no se pueden juzgar los pesos del lote; null si se puede.
function sinJuicio(
  g: GuionBaseData,
  delLote: readonly CriterioFicha[],
  precio: readonly CriterioFicha[],
  lote: string | null,
): string | null {
  if (!delLote.length) return 'la ficha no trae los criterios de valoración';
  if (!precio.length) return 'la ficha no tiene ningún criterio de precio con fórmula';
  if (precio.length > 1)
    return `la ficha tiene ${precio.length} criterios económicos (${nombres(precio)}) y no se sabe cuál es el precio`;
  const comoPrecio = automaticosDeLote(g, lote).find((a) => AUTOMATICO_PRECIO.test(textoComparable(a.criterio)));
  return comoPrecio
    ? `el guion trae «${comoPrecio.criterio.slice(0, 60)}» entre los automáticos y parece el precio`
    : null;
}

type Pesos = { tipo: 'juzgados'; guion: number; ficha: number } | { tipo: 'sin_juicio'; motivo: string };

// Los puntos del lote según el guion (memoria valorable, automáticos y precio de la ficha) frente a
// los que reparte la ficha, o por qué no se pueden comparar (sale «no comprobado», no se calla).
function pesosDeLote(g: GuionBaseData, criterios: readonly CriterioFicha[], lote: string | null): Pesos {
  const delLote = criteriosDeLote(criterios, lote);
  const precio = delLote.filter((c) => c.tipo === 'formula' && PRECIO.test(textoComparable(c.descripcion)));
  const motivo = sinJuicio(g, delLote, precio, lote);
  if (motivo) return { tipo: 'sin_juicio', motivo };
  const memoria = g.memoria && memoriaValorable(g.memoria) ? g.memoria.apartados.reduce((s, a) => s + a.puntos, 0) : 0;
  const automaticos = automaticosDeLote(g, lote).reduce((s, a) => s + a.puntos, 0);
  return {
    tipo: 'juzgados',
    guion: memoria + automaticos + precio[0]!.peso,
    ficha: delLote.reduce((s, c) => s + c.peso, 0),
  };
}

// Los lotes del guion a los que se va; sin lotes, el contrato entero.
function lotesDe(e: EntradasComprobaciones, g: GuionBaseData): (string | null)[] {
  const lotes = (g.lotes ?? []).filter((l) => !e.ambito.length || e.ambito.includes(l));
  return lotes.length ? lotes : [null];
}

const delLote = (lote: string | null): string => (lote === null ? '' : ` del lote ${lote}`);

function reglaPesos(e: EntradasComprobaciones, g: GuionBaseData, guion: number): Bloqueo[] {
  if (!e.ficha) return [];
  const criterios = e.ficha.datos.criterios;
  return lotesDe(e, g).flatMap((lote) => {
    const p = pesosDeLote(g, criterios, lote);
    if (p.tipo === 'sin_juicio') {
      return [
        fila({
          regla: 'guion_pesos',
          lote,
          categoria: 'coherencia',
          gravedad: 'no_comprobado',
          guion,
          cita: null,
          titulo: `No se pudo comprobar que los criterios del guion${delLote(lote)} sumen lo que reparte el pliego: ${p.motivo}. Compruébalo en Criterios de valoración`,
        }),
      ];
    }
    if (Math.abs(p.guion - p.ficha) < 0.01) return [];
    return [
      fila({
        regla: 'guion_pesos',
        lote,
        categoria: 'coherencia',
        gravedad: 'impide',
        guion,
        cita: null,
        titulo: `Los criterios del guion${delLote(lote)} suman ${puntosTexto(p.guion)} puntos y la ficha reparte ${puntosTexto(p.ficha)}: vuelve a extraer el guion o revisa la ficha`,
      }),
    ];
  });
}

// Una fila por oferta económica (varias de un lote la comparten): la fórmula es una sola. Riesgo y no
// «impide» (decía impide): lo que impide no se acepta, y no reconocer la fórmula no es un error
// de la oferta sino que el código no sabe leerla o el pliego no la da.
function reglaFormula(e: EntradasComprobaciones, g: GuionBaseData, guion: number): Bloqueo[] {
  const vistas = new Set<string>();
  return lotesDe(e, g).flatMap((lote) => {
    const o = ofertaDeLote(g, lote);
    if (!o || vistas.has(o.formula) || tipoFormula(o.formula) !== null) return [];
    vistas.add(o.formula);
    return [
      fila({
        regla: 'guion_formula',
        lote,
        categoria: 'precio',
        gravedad: 'riesgo',
        guion,
        titulo: `Fórmula de precio no reconocida${delLote(lote)}: léela en el pliego antes de fijar el precio`,
        cita: {
          documento: o.documento ?? o.archivo,
          pagina: o.pagina ?? null,
          texto: o.formula.slice(0, 300),
          comprobada: false,
        },
      }),
    ];
  });
}

// La memoria que puntúa por juicio de valor no puede ir en el archivo de las fórmulas: se abriría con el precio.
function reglaSobres(g: GuionBaseData, guion: number): Bloqueo[] {
  const m = g.memoria;
  if (!m || !memoriaValorable(m)) return [];
  const archivo = textoComparable(m.archivo.trim());
  if (!archivosEconomicos(g).some((a) => textoComparable(a.trim()) === archivo)) return [];
  return [
    fila({
      regla: 'guion_sobres',
      lote: null,
      categoria: 'documentos',
      gravedad: 'impide',
      guion,
      titulo: `El guion pone la memoria de juicio de valor en «${m.archivo}», el archivo de la oferta económica: vuelve a extraer el guion`,
      cita: m.documento
        ? { documento: m.documento, pagina: m.pagina ?? null, texto: m.archivo, comprobada: false }
        : null,
    }),
  ];
}

export function reglasGuion(e: EntradasComprobaciones): Bloqueo[] {
  if (!e.guion) return [];
  const { datos, id } = e.guion;
  return [...reglaPesos(e, datos, id), ...reglaFormula(e, datos, id), ...reglaSobres(datos, id)];
}
