// Acceso al guion por lote (puro, sin base de datos), con la misma forma para guiones actuales y antiguos.
import { textoComparable } from '../temas.js';
import type { AutomaticoGuion, GuionBaseData, OfertaEconomicaLoteData, TramoData } from './guion.js';

// Un guion actual trae una oferta económica por lote, con sus precios unitarios, y automáticos con sus lotes y
// tramos; uno antiguo traía una sola oferta y automáticos para todos. Nadie lee los campos crudos: estas
// funciones dan la misma forma a los dos.
type Archivo = GuionBaseData['archivos'][number];
type DocumentoArchivo = Archivo['documentos'][number];

/**
 * El umbral de anormalidad (como baja) que fija el propio pliego sobre el presupuesto o el
 * precio máximo: «inferiores en un 15 % al presupuesto» → 0,15; «inferior al 85 % del
 * precio máximo» → 0,15. Si lo mide sobre la media de las ofertas, depende de las demás:
 * null, como si no lo fijara.
 */
export function umbralDelPliego(texto: string | null | undefined): number | null {
  if (!texto || /media|promedio/i.test(texto) || !/presupuesto|precio|importe|tipo de licitaci/i.test(texto))
    return null;
  const candidatos = porcentajes(sinImpuestos(texto));
  // Con varios porcentajes distintos manda el que va junto a «inferior en / baja / anormal»; si
  // aun así no hay uno solo, no se adivina (cae al estimado, con aviso).
  const cerca = candidatos.filter((c) => c.junto);
  const valores = [...new Set((cerca.length ? cerca : candidatos).map((c) => c.valor))];
  if (valores.length !== 1) return null;
  const p = valores[0]! / 100;
  if (!p || p >= 1) return null;
  return p > 0.5 ? Math.round((1 - p) * 10_000) / 10_000 : p;
}

// «IGIC del 7 % excluido», «IVA (21 %)», «21 % de IVA»: el porcentaje del impuesto no es el umbral.
const CIFRA = String.raw`\d{1,3}(?:[.,]\d{1,2})?`;
const UNIDAD = String.raw`\s*(?:%|por\s*(?:ciento|cien|100)\b|unidades porcentuales)`;
const IMPUESTO = new RegExp(
  String.raw`\b(?:iva|igic|ipsi|impuestos?)\b[^.;%\d]{0,12}${CIFRA}${UNIDAD}|${CIFRA}${UNIDAD}[^.;\d]{0,8}\b(?:iva|igic|ipsi)\b`,
  'gi',
);
const sinImpuestos = (t: string) => t.replace(IMPUESTO, ' ');
const JUNTO_A_BAJA = /(inferior(?:es)?|baja|anormal\w*|desproporcionad\w*|temerari\w*)[^.;\d]{0,40}$/i;

function porcentajes(texto: string): { valor: number; junto: boolean }[] {
  return [...texto.matchAll(new RegExp(String.raw`(?<![\d.,])(${CIFRA})${UNIDAD}`, 'gi'))].map((m) => ({
    valor: Number(m[1]!.replace(',', '.')),
    junto: JUNTO_A_BAJA.test(texto.slice(Math.max(0, m.index - 60), m.index)),
  }));
}

/** El pliego da un literal con porcentajes que no se ha podido leer como umbral (no es «sobre la media»). */
export function umbralIlegible(texto: string | null | undefined): boolean {
  if (!texto || /media|promedio/i.test(texto) || umbralDelPliego(texto) !== null) return false;
  return porcentajes(sinImpuestos(texto)).length > 0;
}

// Un guion antiguo: su única oferta vale para todos sus lotes y el precio unitario es una línea.
type ConOfertas = Pick<GuionBaseData, 'oferta_economica' | 'ofertas_economicas' | 'lotes'>;

function deV3(g: ConOfertas): OfertaEconomicaLoteData[] {
  const oe = g.oferta_economica;
  if (!oe) return [];
  const pu = oe.precio_unitario;
  return [
    {
      ...oe,
      lotes: g.lotes ?? [],
      precios_unitarios: pu ? [{ concepto: pu.unidad, unidad: pu.unidad, maximo: pu.maximo, cantidad: null }] : [],
      umbral_baja: umbralDelPliego(oe.umbral_anormalidad),
    },
  ];
}

/** Las ofertas económicas del guion, por lote; un guion antiguo da una sola, para todos sus lotes. */
export function ofertasEconomicas(g: ConOfertas): OfertaEconomicaLoteData[] {
  if (!g.ofertas_economicas?.length) return deV3(g);
  return g.ofertas_economicas.map((o) => ({
    ...o,
    umbral_baja: o.umbral_baja ?? umbralDelPliego(o.umbral_anormalidad),
  }));
}

/** La oferta económica de un lote (la que lo cita o, si ninguna lo cita, la del contrato entero). */
export function ofertaDeLote(g: GuionBaseData, lote: string | null): OfertaEconomicaLoteData | null {
  const todas = ofertasEconomicas(g);
  const delLote = lote === null ? undefined : todas.find((o) => o.lotes.includes(lote));
  return delLote ?? todas.find((o) => !o.lotes.length) ?? (todas.length === 1 && lote === null ? todas[0]! : null);
}

/** La oferta de referencia para unos lotes: la del lote si es uno; si no, la primera (la del contrato en un guion antiguo). */
export function ofertaParaLotes(g: GuionBaseData, lotes: string[]): OfertaEconomicaLoteData | null {
  const delLote = lotes.length === 1 ? ofertaDeLote(g, lotes[0]!) : null;
  return delLote ?? ofertasEconomicas(g)[0] ?? null;
}

/** Los automáticos que puntúan en un lote (los que lo citan o no citan ninguno); con null, todos. */
export function automaticosDeLote(g: GuionBaseData, lote: string | null): AutomaticoGuion[] {
  if (lote === null) return g.automaticos;
  return g.automaticos.filter((a) => !a.lotes?.length || a.lotes.includes(lote));
}

/** El código con que el pliego numera un criterio («2B1. – », «2.3 – »); no es parte de su nombre. */
const CODIGO_CRITERIO = /^\s*\d*[A-Za-z]?\d+(?:\.\d+)*\.?\s*[–—-]\s*/;

const comparar = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

/**
 * Con qué se compara un criterio: su nombre sin el código del pliego, porque unas veces el
 * guion lo trae («2B1. – Soporte») y otras la web o la propuesta lo dejan en «Soporte». El código
 * se quita del texto original, antes de pasar a minúsculas, y si solo era código se usa entero.
 */
export function claveCriterio(t: string): string {
  const sinCodigo = comparar(t.replace(CODIGO_CRITERIO, ''));
  return sinCodigo || comparar(t);
}

// El código del pliego sin espacios ni guiones («2B1. – » → «2b1»), o null si no lo lleva.
function codigoCriterio(t: string): string | null {
  const m = CODIGO_CRITERIO.exec(t);
  return m ? m[0].replace(/[\s.–—-]+/g, '').toLowerCase() : null;
}

/**
 * El nombre literal del automático del guion al que se refiere un texto, o null si no casa con
 * ninguno o es ambiguo. El nombre sin código basta si solo un automático lo lleva; con dos de
 * igual nombre y distinto código («2A1. – Formación» y «2B1. – Formación») decide el código, y
 * sin él no se adivina.
 */
export function criterioDelGuion(g: Pick<GuionBaseData, 'automaticos'>, texto: string): string | null {
  const clave = claveCriterio(texto);
  const porTexto = new Map(
    g.automaticos.filter((a) => claveCriterio(a.criterio) === clave).map((a) => [comparar(a.criterio), a.criterio]),
  );
  const literales = [...porTexto.values()];
  if (literales.length <= 1) return literales[0] ?? null;
  const codigo = codigoCriterio(texto);
  const delCodigo = codigo ? literales.filter((l) => codigoCriterio(l) === codigo) : [];
  return delCodigo.length === 1 ? delCodigo[0]! : null;
}

/** Pone a cada criterio el nombre literal que le da el guion, si casa con uno solo de sus automáticos. */
export function conCriteriosDelGuion<T extends { criterio: string }>(
  xs: T[],
  g: Pick<GuionBaseData, 'automaticos'>,
): T[] {
  return xs.map((x) => {
    const literal = criterioDelGuion(g, x.criterio);
    return literal && literal !== x.criterio ? { ...x, criterio: literal } : x;
  });
}

/**
 * El automático del guion de un criterio en un lote. Un guion actual trae «uno por criterio y conjunto
 * de lotes», así que el mismo texto puede salir varias veces, con lotes y tramos distintos: manda
 * el que cita el lote o, si ninguno lo hace, el común. Con lote null, el común o el primero.
 */
export function automaticoDe(
  g: Pick<GuionBaseData, 'automaticos'>,
  criterio: string,
  lote: string | null,
): AutomaticoGuion | undefined {
  const literal = criterioDelGuion(g, criterio);
  const homonimos = literal === null ? [] : g.automaticos.filter((a) => comparar(a.criterio) === comparar(literal));
  if (lote === null) return homonimos.find((a) => !a.lotes?.length) ?? homonimos[0];
  return homonimos.find((a) => a.lotes?.includes(lote)) ?? homonimos.find((a) => !a.lotes?.length);
}

/** Los tramos de un automático; sin ellos, uno solo: el criterio con sus puntos. */
export function tramosDe(a: AutomaticoGuion): TramoData[] {
  return a.tramos?.length ? a.tramos : [{ descripcion: a.criterio, puntos: a.puntos }];
}

/** Los documentos de un archivo que se exigen en un lote (los que lo citan o no citan ninguno). */
export function documentosDeLote(archivo: Archivo, lote: string | null): DocumentoArchivo[] {
  if (lote === null) return archivo.documentos;
  return archivo.documentos.filter((d) => !d.lotes?.length || d.lotes.includes(lote));
}

/** Los archivos electrónicos de las ofertas económicas (para no buscar en ellos fugas de la memoria). */
export function archivosEconomicos(g: ConOfertas): string[] {
  const vistos = new Set<string>();
  return ofertasEconomicas(g)
    .map((o) => o.archivo)
    .filter((a) => {
      const k = textoComparable(a.trim());
      const nuevo = !vistos.has(k);
      vistos.add(k);
      return nuevo;
    });
}

export type MaximoLote = {
  lote: string | null;
  unidad: string | null;
  maximo: number | null;
  presupuesto: number | null;
};

// El presupuesto de un lote: el de la licitación o, si no lo trae, el de una oferta solo de ese
// lote. El de una oferta común (guion antiguo, o una para varios lotes) es el del contrato: no vale.
function presupuestoDeLote(
  g: GuionBaseData,
  lote: string,
  oferta: OfertaEconomicaLoteData | null,
  presupuestos: Record<string, number | null>,
): number | null {
  const soloSuya = Boolean(g.ofertas_economicas?.length) && oferta?.lotes.length === 1 && oferta.lotes[0] === lote;
  return presupuestos[lote] ?? (soloSuya ? oferta.presupuesto_base : null);
}

/**
 * El precio máximo de cada lote del ámbito según el guion (null si el pliego no lo fija), con el
 * presupuesto del lote como único dato firme (presupuestos: los de los lotes de la licitación). La
 * ficha lo enseña en vez de dejar que un texto libre del modelo («precio máximo 0») pase por un dato.
 */
export function maximosPorLote(
  g: GuionBaseData,
  lotes: string[],
  presupuestos: Record<string, number | null> = {},
): MaximoLote[] {
  return (lotes.length ? lotes : [null]).map((lote) => {
    const oferta = ofertaDeLote(g, lote);
    const linea = oferta?.precios_unitarios[0];
    const presupuesto =
      lote === null ? (oferta?.presupuesto_base ?? null) : presupuestoDeLote(g, lote, oferta, presupuestos);
    return { lote, unidad: linea?.unidad ?? null, maximo: linea?.maximo ?? null, presupuesto };
  });
}
