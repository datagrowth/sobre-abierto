// Precios de la oferta por lote y por unidad (puro, sin base de datos).
import type { GuionBaseData, OfertaEconomicaLoteData, PrecioUnitarioData } from './guion.js';
import { ofertaDeLote, umbralIlegible } from './guionLotes.js';
import { textoComparable } from '../temas.js';

// Cada lote decidido lleva su precio (o «pendiente»): un importe total o un precio por cada línea de
// precios_unitarios de su oferta económica en el guion. Lo que excluye la oferta (pasar del máximo, un lote sin
// precio) es un error al guardar; bajar del umbral de anormalidad se guarda con aviso (un precio unitario por
// debajo del umbral del pliego). Los mensajes no dicen el precio decidido: también los lee Hermes.
type PrecioConceptoData = { concepto: string; precio: number };
export type OfertaLoteData = {
  lote: string | null;
  pendiente: boolean;
  importe: number | null;
  unitarios: PrecioConceptoData[];
};

type TipoProblemaPrecio = 'precio_falta' | 'precio_maximo' | 'precio_anormal';
export type ProblemaPrecio = {
  tipo: TipoProblemaPrecio;
  gravedad: 'error' | 'aviso';
  del_pliego: boolean;
  lote: string | null;
  mensaje: string;
};

// presupuestos: el de cada lote en la licitación (cuando el guion no trae oferta propia del
// lote); estimado: el umbral de anormalidad estimado (art. 85 RGLCAP) de un lote, si el pliego no fija uno.
export type ContextoPrecios = {
  presupuestos?: Record<string, number | null>;
  estimado?: (lote: string | null) => { umbral: number; ofertas: number } | null;
};

const EUROS = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PORCENTAJE = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const euros = (n: number, unidad: string | null = null) => `${EUROS.format(n)} €${unidad ? ` por ${unidad}` : ''}`;
const delLote = (lote: string | null) => (lote ? ` del lote ${lote}` : '');
const recorte = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const mismo = (a: string, b: string) => textoComparable(a.trim()) === textoComparable(b.trim());

/** Lo que vale la oferta de un lote: Σ precio × cantidad, o el importe total; null si falta alguna cantidad. */
export function importeDeLote(o: OfertaLoteData, oferta: OfertaEconomicaLoteData | null): number | null {
  const lineas = oferta?.precios_unitarios ?? [];
  if (!lineas.length) return o.importe;
  let total = 0;
  for (const l of lineas) {
    const p = o.unitarios.find((u) => mismo(u.concepto, l.concepto));
    if (!p || l.cantidad === null) return null;
    total += p.precio * l.cantidad;
  }
  return Math.round(total * 100) / 100;
}

/** La baja de un lote: sobre Σ máximo × cantidad, sobre el máximo con una sola línea sin cantidad, o sobre el presupuesto. */
export function bajaDeLote(
  o: OfertaLoteData,
  oferta: OfertaEconomicaLoteData | null,
  presupuesto: number | null = oferta?.presupuesto_base ?? null,
): number | null {
  const lineas = oferta?.precios_unitarios ?? [];
  if (lineas.length === 1 && lineas[0]!.cantidad === null) {
    const p = o.unitarios.find((u) => mismo(u.concepto, lineas[0]!.concepto));
    return p && lineas[0]!.maximo ? 1 - p.precio / lineas[0]!.maximo : null;
  }
  const maximo = lineas.length
    ? lineas.reduce<number | null>(
        (t, l) => (t === null || l.maximo === null || l.cantidad === null ? null : t + l.maximo * l.cantidad),
        0,
      )
    : presupuesto;
  const importe = importeDeLote(o, oferta);
  return importe === null || !maximo ? null : 1 - importe / maximo;
}

/** El precio mínimo antes de ser anormal: el máximo menos la baja del umbral. */
export const umbralMinimo = (maximo: number, umbral: number): number =>
  Math.round(maximo * (1 - umbral) * 10_000) / 10_000;

function problemasDeEstructura(d: { lotes: string[]; ofertas: OfertaLoteData[] }): ProblemaPrecio[] {
  const esperados: (string | null)[] = d.lotes.length ? d.lotes : [null];
  const falta = (lote: string | null, mensaje: string): ProblemaPrecio => ({
    tipo: 'precio_falta',
    gravedad: 'error',
    del_pliego: false,
    lote,
    mensaje,
  });
  const vistos = new Set<string | null>();
  const sobran = d.ofertas.flatMap((o) => {
    if (vistos.has(o.lote)) return [falta(o.lote, `El precio${delLote(o.lote)} está dos veces: deja uno.`)];
    vistos.add(o.lote);
    if (esperados.includes(o.lote)) return [];
    return [
      falta(
        o.lote,
        o.lote === null
          ? 'Hay un precio sin lote y la oferta va por lotes: fíjalo lote a lote.'
          : `Hay un precio para el lote ${o.lote}, al que no vamos: quítalo.`,
      ),
    ];
  });
  const faltan = esperados
    .filter((l) => !d.ofertas.some((o) => o.lote === l))
    .map((l) => falta(l, `Falta el precio${l ? ` del lote ${l}` : ' de la oferta'} (o márcalo pendiente).`));
  return [...faltan, ...sobran];
}

function anormal(
  lote: string | null,
  que: string,
  minimo: { valor: number; unidad: string | null; umbral: number; pliego: boolean; ofertas: number },
): ProblemaPrecio {
  const baja = `baja del ${PORCENTAJE.format(minimo.umbral * 100)} %: ${euros(minimo.valor, minimo.unidad)}`;
  return minimo.pliego
    ? {
        tipo: 'precio_anormal',
        gravedad: 'aviso',
        del_pliego: true,
        lote,
        mensaje: `${que}${delLote(lote)} está por debajo del umbral de anormalidad que fija el pliego (${baja}): habría que justificarlo y puede quedar fuera o sin puntos. Súbelo al menos hasta ahí.`,
      }
    : {
        tipo: 'precio_anormal',
        gravedad: 'aviso',
        del_pliego: false,
        lote,
        mensaje: `${que}${delLote(lote)} está por debajo del umbral de anormalidad estimado (${baja}; art. 85 RGLCAP con ${minimo.ofertas} ofertas esperadas): habría que justificarlo. Revísalo con el pliego.`,
      };
}

type Limite = {
  lote: string | null;
  que: string;
  precio: number;
  maximo: number | null;
  unidad: string | null;
  excluye: string;
};

function problemasDeLimite(l: Limite, oferta: OfertaEconomicaLoteData | null, ctx: ContextoPrecios): ProblemaPrecio[] {
  if (l.maximo === null) return [];
  if (l.precio > l.maximo + 1e-9)
    return [
      {
        tipo: 'precio_maximo',
        gravedad: 'error',
        del_pliego: false,
        lote: l.lote,
        mensaje: `${l.que}${delLote(l.lote)} supera ${l.excluye} (${euros(l.maximo, l.unidad)}): la oferta se excluye. Bájalo.`,
      },
    ];
  const pliego = oferta?.umbral_baja ?? null;
  const est = pliego === null ? (ctx.estimado?.(l.lote) ?? null) : null;
  const umbral = pliego ?? est?.umbral ?? null;
  if (umbral === null) return [];
  const valor = umbralMinimo(l.maximo, umbral);
  return l.precio >= valor - 1e-6
    ? []
    : [
        anormal(l.lote, l.que, {
          valor,
          unidad: l.unidad,
          umbral,
          pliego: pliego !== null,
          ofertas: est?.ofertas ?? 0,
        }),
      ];
}

function problemasDeUnitarios(
  o: OfertaLoteData,
  oferta: OfertaEconomicaLoteData,
  ctx: ContextoPrecios,
): ProblemaPrecio[] {
  const lineas = oferta.precios_unitarios;
  const error = (mensaje: string): ProblemaPrecio => ({
    tipo: 'precio_falta',
    gravedad: 'error',
    del_pliego: false,
    lote: o.lote,
    mensaje,
  });
  const ajenos = o.unitarios
    .filter((u) => !lineas.some((l) => mismo(l.concepto, u.concepto)))
    .map((u) =>
      error(
        `«${u.concepto}» no es ningún precio de la oferta económica${delLote(o.lote)} en el guion: los que hay son ${lineas.map((l) => `«${l.concepto}»`).join(', ')}.`,
      ),
    );
  return [
    ...ajenos,
    ...lineas.flatMap((l: PrecioUnitarioData) => {
      const p = o.unitarios.find((u) => mismo(u.concepto, l.concepto));
      if (!p) return [error(`Falta el precio de «${l.concepto}»${delLote(o.lote)} (o marca el lote pendiente).`)];
      return problemasDeLimite(
        {
          lote: o.lote,
          que: `El precio por ${l.unidad}${lineas.length > 1 ? ` («${l.concepto}»)` : ''}`,
          precio: p.precio,
          maximo: l.maximo,
          unidad: l.unidad,
          excluye: 'el precio máximo',
        },
        oferta,
        ctx,
      );
    }),
  ];
}

function presupuestoDe(o: OfertaLoteData, oferta: OfertaEconomicaLoteData | null, ctx: ContextoPrecios): number | null {
  const propia = oferta && o.lote !== null && oferta.lotes.includes(o.lote) && oferta.lotes.length === 1;
  const delLoteLic = o.lote === null ? null : (ctx.presupuestos?.[o.lote] ?? null);
  return (propia ? oferta.presupuesto_base : null) ?? delLoteLic ?? oferta?.presupuesto_base ?? null;
}

// El pliego da un literal con porcentajes que no se leyó como umbral: se usa el estimado, con aviso.
function avisoUmbralIlegible(lote: string | null, oferta: OfertaEconomicaLoteData | null): ProblemaPrecio[] {
  const literal = oferta?.umbral_anormalidad;
  if (!literal || oferta.umbral_baja != null || !umbralIlegible(literal)) return [];
  return [
    {
      tipo: 'precio_anormal',
      gravedad: 'aviso',
      del_pliego: false,
      lote,
      mensaje: `No se pudo leer el umbral de anormalidad del pliego${delLote(lote)} («${recorte(literal, 200)}»): compruébalo a mano; el que se usa es el estimado.`,
    },
  ];
}

function problemasDeOferta(o: OfertaLoteData, g: GuionBaseData, ctx: ContextoPrecios): ProblemaPrecio[] {
  if (o.pendiente) return [];
  const oferta = ofertaDeLote(g, o.lote);
  if (oferta?.precios_unitarios.length)
    return [...problemasDeUnitarios(o, oferta, ctx), ...avisoUmbralIlegible(o.lote, oferta)];
  if (o.importe === null)
    return [
      {
        tipo: 'precio_falta',
        gravedad: 'error',
        del_pliego: false,
        lote: o.lote,
        mensaje: `Falta el importe${delLote(o.lote)} (o márcalo pendiente).`,
      },
    ];
  const excluye = o.lote ? 'el presupuesto del lote' : 'el presupuesto base';
  return [
    ...problemasDeLimite(
      {
        lote: o.lote,
        que: 'El precio decidido',
        precio: o.importe,
        maximo: presupuestoDe(o, oferta, ctx),
        unidad: null,
        excluye,
      },
      oferta,
      ctx,
    ),
    ...avisoUmbralIlegible(o.lote, oferta),
  ];
}

/**
 * Lo que no cuadra del precio de cada lote con el guion: errores (no se guarda: falta un lote,
 * sobra uno, pasa del máximo) y avisos (por debajo del umbral de anormalidad; `del_pliego`
 * si lo fija el pliego, que en la coherencia bloquea).
 */
export function problemasDePrecios(
  d: { lotes: string[]; ofertas: OfertaLoteData[] },
  g: GuionBaseData,
  ctx: ContextoPrecios = {},
): ProblemaPrecio[] {
  const todos = [...problemasDeEstructura(d), ...d.ofertas.flatMap((o) => problemasDeOferta(o, g, ctx))];
  return [...todos.filter((p) => p.gravedad === 'error'), ...todos.filter((p) => p.gravedad === 'aviso')];
}

// El precio único de unas decisiones anteriores a los precios por lote, lote a lote.
function repartir(o: OfertaLoteData, lotes: string[], g: GuionBaseData): OfertaLoteData[] {
  return lotes.map((lote) => {
    const unitario = (ofertaDeLote(g, lote)?.precios_unitarios.length ?? 0) === 1;
    return lotes.length === 1 || unitario ? { ...o, lote } : { lote, pendiente: true, importe: null, unitarios: [] };
  });
}

/**
 * Las ofertas de unas decisiones en su forma de ahora: sin ninguna, cada lote pendiente; un
 * solo precio sin lote (decisiones anteriores a los precios por lote) vale para cada lote
 * decidido si es un precio unitario o hay un solo lote; un importe total con varios lotes
 * no se reparte (sería el total del contrato en cada lote): cada lote vuelve a pendiente; y
 * un importe en un lote con un solo precio unitario es ese precio.
 */
export function normalizarOfertas(ofertas: OfertaLoteData[], lotes: string[], g: GuionBaseData): OfertaLoteData[] {
  const base = ofertas.length ? ofertas : [{ lote: null, pendiente: true, importe: null, unitarios: [] }];
  const porLote = base.length === 1 && base[0]!.lote === null && lotes.length ? repartir(base[0]!, lotes, g) : base;
  return porLote.map((o) => {
    const lineas = ofertaDeLote(g, o.lote)?.precios_unitarios ?? [];
    if (o.importe === null || o.unitarios.length || lineas.length !== 1) return o;
    return { ...o, importe: null, unitarios: [{ concepto: lineas[0]!.concepto, precio: o.importe }] };
  });
}
