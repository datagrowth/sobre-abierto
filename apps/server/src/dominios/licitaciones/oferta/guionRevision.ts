// Revisión del guion de la oferta que envía Hermes (puro: sin base de datos).
import path from 'node:path';
import type { Rubrica } from '../ficha.js';
import { textoComparable } from '../temas.js';
import type { GuionBaseData } from './guion.js';
import { ofertasEconomicas, tramosDe } from './guionLotes.js';

// Distingue lo que nunca se acepta (errorDuroGuion) de lo que se rechaza hasta el tercer envío
// (problemasDeGuion): los apartados de la memoria deben casar con los criterios de juicio de valor de la ficha
// (o, si la ficha no tiene ninguno y el pliego exige igualmente la memoria, ir sin puntos como no valorable),
// citar el pliego y, si el pliego fija un límite de páginas, traerlo.
/** Puntos como los escribe el pliego: «2,5». */
export const puntosTexto = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

function lista(ns: number[], y: boolean): string {
  const t = ns.map(puntosTexto);
  return y && t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t.at(-1)}` : t.join(', ');
}

const comillas = (xs: string[]): string => xs.map((x) => `«${x}»`).join(', ');

/** Lo que nunca se acepta: el guion no casaría consigo mismo. */
export function errorDuroGuion(g: GuionBaseData): string | null {
  const nombres = g.archivos.map((a) => textoComparable(a.nombre.trim()));
  const repetido = g.archivos.find((_, i) => nombres.indexOf(nombres[i]!) !== i);
  if (repetido) return `El archivo «${repetido.nombre}» está repetido: un elemento por archivo electrónico o sobre.`;
  const existe = (archivo: string) => nombres.includes(textoComparable(archivo.trim()));
  const citados = [
    g.memoria?.archivo,
    ...ofertasEconomicas(g).map((o) => o.archivo),
    ...g.automaticos.map((a) => a.archivo),
  ].filter((x): x is string => x !== undefined);
  const falta = citados.find((a) => !existe(a));
  if (falta)
    return `«${falta}» no es ninguno de los archivos del guion (${comillas(g.archivos.map((a) => a.nombre))}): usa el nombre exacto de «archivos».`;
  const memorias = g.archivos.flatMap((a) => a.documentos).filter((d) => d.tipo === 'memoria');
  if (memorias.length > 1)
    return 'Hay más de un documento de tipo «memoria»: la memoria técnica es uno solo (los demás son «otro» o «declaracion»).';
  const porLote = g.archivos.find((a) => a.ambito === 'por_lote');
  if (porLote && !g.lotes?.length)
    return `El archivo «${porLote.nombre}» va «por_lote» y el guion no trae «lotes»: di a qué lotes se refiere o quita ambito.`;
  return null;
}

function multiconjuntoIgual(a: number[], b: number[]): boolean {
  const orden = (xs: number[]) => [...xs].sort((x, y) => y - x);
  const [x, y] = [orden(a), orden(b)];
  return x.length === y.length && x.every((v, i) => Math.abs(v - y[i]!) < 0.01);
}

/** ¿La mesa puntúa la memoria? Los guiones anteriores al campo no lo traen: eran valorables salvo que sus apartados sumen 0 puntos (sin puntos no hay nota posible). */
export const memoriaValorable = (m: {
  valorable?: boolean | undefined;
  apartados?: { puntos: number }[] | undefined;
}): boolean => m.valorable !== false && (m.apartados?.some((a) => a.puntos > 0) ?? true);

function problemaDeRubricas(g: GuionBaseData, rubricas: Rubrica[]): string | null {
  if (!g.memoria)
    return rubricas.length ? 'Hay criterios de juicio de valor en la ficha y el guion no trae «memoria».' : null;
  if (!memoriaValorable(g.memoria)) {
    return rubricas.length
      ? `La ficha aprobada tiene ${rubricas.length} criterios de juicio de valor: la memoria se puntúa. Quita valorable = false y trae un apartado por criterio, con sus puntos.`
      : null;
  }
  if (!rubricas.length)
    return 'El guion trae una memoria valorable y la ficha aprobada no tiene criterios de juicio de valor: si el pliego exige la memoria sin puntuarla (contenido mínimo, «no valorable»), envíala con valorable = false y sus apartados con 0 puntos; si no la pide, memoria = null.';
  const ficha = rubricas.map((r) => r.puntos);
  const guion = g.memoria.apartados.map((a) => a.puntos);
  if (ficha.length !== guion.length) {
    const total = puntosTexto(ficha.reduce((s, p) => s + p, 0));
    return `La memoria tiene ${guion.length} apartados y la ficha aprobada tiene ${ficha.length} criterios de juicio de valor (${lista(ficha, true)} puntos; ${total} en total): un apartado por criterio, con sus mismos puntos.`;
  }
  return multiconjuntoIgual(ficha, guion)
    ? null
    : `Los puntos de los apartados (${lista(guion, false)}) no son los de la ficha (${lista(ficha, false)}).`;
}

// Una memoria que no se puntúa no tiene puntos ni escala, pero sí lo que el pliego exige que
// contenga cada apartado (va en «se_valorara»: la redacción comprueba que lo cubre).
function problemasDeNoValorable(g: GuionBaseData): string[] {
  const m = g.memoria;
  if (!m) {
    const doc = g.archivos.flatMap((a) => a.documentos).find((d) => d.tipo === 'memoria');
    return doc
      ? [
          `Los archivos traen «${doc.nombre}» (tipo memoria) y el guion no trae «memoria»: si el pliego la exige aunque no la puntúe, envíala con valorable = false.`,
        ]
      : [];
  }
  if (memoriaValorable(m)) return [];
  const conPuntos = m.apartados
    .filter((a) => a.puntos > 0 || a.escala.length || a.puntos_se_valorara?.length)
    .map((a) => a.titulo);
  const sinContenido = m.apartados.filter((a) => !a.se_valorara.length).map((a) => a.titulo);
  return [
    ...(conPuntos.length
      ? [
          `La memoria no es valorable: sus apartados van con 0 puntos, sin escala ni puntos_se_valorara: ${comillas(conPuntos)}.`,
        ]
      : []),
    ...(sinContenido.length
      ? [
          `En una memoria no valorable, «se_valorara» es lo que el pliego exige que contenga cada apartado, literal: ${comillas(sinContenido)}.`,
        ]
      : []),
  ];
}

export const AVISO_SIN_MARCAS = 'Un criterio automático sin «marcas» no se puede vigilar en la memoria';

function problemasDeCitas(g: GuionBaseData): string[] {
  const sinCita = (g.memoria?.apartados ?? [])
    .filter((a) => !a.documento || a.pagina === undefined)
    .map((a) => a.titulo);
  const sinDocs = g.archivos.filter((a) => !a.documentos.length).map((a) => a.nombre);
  const sinMarcas = g.automaticos.filter((a) => !a.marcas.length).map((a) => a.criterio);
  return [
    ...(sinCita.length
      ? [`Cada apartado de la memoria debe citar documento y página del pliego: ${comillas(sinCita)}.`]
      : []),
    ...(sinDocs.length ? [`Cada archivo electrónico debe traer al menos un documento: ${comillas(sinDocs)}.`] : []),
    ...(sinMarcas.length ? [`${AVISO_SIN_MARCAS}: ${comillas(sinMarcas)}.`] : []),
  ];
}

// Frases que diría cualquier mejora: como marca, la memoria no podría ofrecer nada.
const GENERICAS = new Set([
  'sin coste adicional',
  'sin coste',
  'coste adicional',
  'sin cargo',
  'gratuito',
  'gratuita',
  'adicional',
  'adicionales',
  'mejora',
  'mejoras',
  'compromiso',
  'certificado',
  'certificacion',
]);
const normal = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();

/** ¿Saldría esta marca en una memoria correcta? Cifras sueltas («30 horas», «10 % del personal») y frases de cualquier mejora. */
export function marcaGenerica(marca: string): boolean {
  const n = normal(marca);
  return GENERICAS.has(n) || /^\d[\d ]*%?( \S+){0,3}$/.test(n);
}

/** ¿Aparece la marca, como palabras enteras, en el texto? */
function marcaEn(marca: string, texto: string): boolean {
  return ` ${normal(texto)} `.includes(` ${normal(marca)} `);
}

type ApartadoRubrica = { titulo: string; se_valorara: string[] };

/** Las marcas que se pueden vigilar en la memoria: ni genéricas ni de lo que el pliego pide tratar en ella. */
export function marcasVigilables(marcas: string[], apartados: ApartadoRubrica[]): string[] {
  const rubrica = apartados.flatMap((a) => [a.titulo, ...a.se_valorara]);
  return marcas.filter((m) => !marcaGenerica(m) && !rubrica.some((t) => marcaEn(m, t)));
}

// Palabras con que empieza el nombre de un criterio y que no son su materia: «Capacidad de
// exportación de datos» se delata por «exportación de datos».
const ENCABEZADO = new Set([
  'capacidad',
  'compromiso',
  'sistema',
  'sistemas',
  'volumen',
  'auditoria',
  'soporte',
  'nivel',
  'numero',
  'grado',
  'porcentaje',
  'frecuencia',
  'periodicidad',
  'plazo',
  'entrega',
  'adscripcion',
  'criterio',
  'mejora',
  'mejoras',
  'oferta',
  'automatizado',
  'automatizada',
  'continuado',
  'continuada',
  'mediante',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'en',
  'por',
  'para',
  'y',
  'a',
  'al',
  'con',
]);
// «2.1.», «Mejora 1:», «2B1.-», «C1.», «B.2 –», «2.a)», «1º», «1.º», «IV.», «A)» delante del nombre.
// Con número basta un espacio; letra y romano exigen separador (un «-» solo si lleva espacio
// detrás: «E-learning» no es numeración), y un dígito con letra pegada («5G Cobertura») tampoco.
const SEP_FUERTE = String.raw`(?:[.:)–—][.:)\-–—]*\s*|-\s+)`;
const ROMANO = 'xviii|xvii|xix|xvi|xiv|xiii|xii|xv|xx|xi|ix|viii|vii|vi|iv|iii|ii|x|v|i';
const NUMERO = String.raw`(?:[A-Za-z]?\d+(?:[A-Za-z]\d+)?|[A-Za-z]\.\d+)(?:\.\d+(?:[A-Za-z]\d+)?)*(?:\s*[.:)\-–—]+\s*|\s+)(?:[A-Za-z][.:)]\s*)?`;
const ORDINAL = String.raw`\d+\.?[º°ª](?:\s*${SEP_FUERTE}|\s+)`;
const NUMERACION = new RegExp(
  String.raw`^\s*(?:(?:criterio|mejora)s?\s+)?(?:${ORDINAL}|\d+\.[a-z]\s+|${NUMERO}|(?:${ROMANO}|[A-Za-z])\s*${SEP_FUERTE})`,
  'i',
);
const NORMA = /\b(?:ISO|UNE(?:-EN)?)[ -]?\d{3,5}(?:[-:]\d{1,4})*\b/gi;
// «V.O. subtitulada», «A.B. Plan»: siglas, no una numeración.
const SIGLAS = /^\s*(?:[A-Za-z]|[IVXivx]{2,5})\.[A-Z]\./;
const MAX_MARCAS = 8;

const palabras = (t: string): number => (normal(t) ? normal(t).split(' ').length : 0);
const marcaUtil = (m: string): boolean => m.length <= 80 && palabras(m) >= 2 && palabras(m) <= 8 && !marcaGenerica(m);
// Las que dicen algo: «formación del personal» tiene dos, y una memoria correcta la diría sin hablar del criterio.
const VACIAS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'en',
  'por',
  'para',
  'y',
  'o',
  'e',
  'a',
  'al',
  'con',
  'un',
  'una',
  'que',
]);
const significativas = (t: string): number =>
  normal(t)
    ? normal(t)
        .split(' ')
        .filter((p) => !VACIAS.has(p)).length
    : 0;
const MIN_SIGNIFICATIVAS = 3;

function sinEncabezado(nombre: string): string {
  const ps = nombre.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < ps.length && ENCABEZADO.has(normal(ps[i]!))) i++;
  return ps.slice(i).join(' ');
}

/**
 * Marcas sacadas del propio criterio cuando Hermes no da ninguna: su nombre (sin numeración
 * ni paréntesis), el nombre sin el encabezado («Capacidad de…») y las normas que cite su nombre.
 * Una palabra suelta, una cifra o un nombre de menos de tres palabras con contenido saldrían
 * en una memoria correcta: no se usan. Las normas de «como_se_acredita» tampoco: una memoria
 * puede decir «ISO 27001» sin que sea ese criterio.
 */
export function marcasDeCriterio(a: { criterio: string; como_se_acredita: string }): string[] {
  const nombre = (SIGLAS.test(a.criterio) ? a.criterio : a.criterio.replace(NUMERACION, ''))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normas = a.criterio.match(NORMA) ?? [];
  const vistas = new Set<string>();
  const candidatas = [nombre, sinEncabezado(nombre)].filter((m) => significativas(m) >= MIN_SIGNIFICATIVAS);
  return [...candidatas, ...normas].filter((m) => {
    const n = normal(m);
    if (!marcaUtil(m) || vistas.has(n)) return false;
    vistas.add(n);
    return true;
  });
}

/** El guion con marcas en los criterios automáticos que no traen ninguna, sacadas del criterio y vigilables. */
export function completarMarcas<G extends Pick<GuionBaseData, 'automaticos' | 'memoria'>>(g: G): G {
  if (g.automaticos.every((a) => a.marcas.length > 0)) return g;
  const apartados = g.memoria?.apartados ?? [];
  const automaticos = g.automaticos.map((a) =>
    a.marcas.length > 0 ? a : { ...a, marcas: marcasVigilables(marcasDeCriterio(a), apartados).slice(0, MAX_MARCAS) },
  );
  return { ...g, automaticos };
}

const AVISO_MARCAS_DEL_NOMBRE = 'Las marcas de estos criterios salen solo de su nombre: revísalas';

/** Aviso para la persona (no un rechazo): criterios sin marcas propias cuyas marcas las sacó el código de su nombre. */
export function avisoMarcasDelNombre(
  enviado: Pick<GuionBaseData, 'automaticos'>,
  completo: Pick<GuionBaseData, 'automaticos'>,
): string | null {
  const nombres = enviado.automaticos
    .filter((a, i) => a.marcas.length === 0 && completo.automaticos[i]!.marcas.length > 0)
    .map((a) => a.criterio);
  return nombres.length
    ? `${AVISO_MARCAS_DEL_NOMBRE}: ${comillas(nombres.slice(0, 6))}${nombres.length > 6 ? ' y más' : ''}.`
    : null;
}

const corto = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

function problemasDeMarcas(g: GuionBaseData): string[] {
  const mem = g.memoria;
  if (!mem) return [];
  const vigiladas = g.automaticos.filter(
    (a) => textoComparable(a.archivo.trim()) !== textoComparable(mem.archivo.trim()),
  );
  const genericas = vigiladas.flatMap((a) =>
    a.marcas.filter(marcaGenerica).map((m) => `«${m}» (${corto(a.criterio)})`),
  );
  const enRubrica = vigiladas.flatMap((a) =>
    a.marcas
      .filter((m) => !marcaGenerica(m))
      .flatMap((m) => {
        const ap = mem.apartados.find((x) => [x.titulo, ...x.se_valorara].some((t) => marcaEn(m, t)));
        return ap ? [`«${m}» (apartado «${corto(ap.titulo)}»)`] : [];
      }),
  );
  return [
    ...(genericas.length
      ? [
          `Estas marcas son demasiado genéricas: saldrían en una memoria correcta y la plataforma la rechazaría: ${genericas.join(', ')}. Usa palabras que solo salgan al hablar de ese criterio, sin cifras sueltas.`,
        ]
      : []),
    ...(enRubrica.length
      ? [
          `Estas marcas salen en lo que el pliego pide valorar en la memoria, así que la memoria tiene que poder decirlas: ${enRubrica.join(', ')}. Usa una marca más específica o quítala.`,
        ]
      : []),
  ];
}

function problemasDePuntosValorara(g: GuionBaseData): string[] {
  return (g.memoria?.apartados ?? []).flatMap((a) => {
    const p = a.puntos_se_valorara;
    if (!p) return [];
    if (p.length !== a.se_valorara.length)
      return [
        `El apartado «${corto(a.titulo)}» trae ${a.se_valorara.length} elementos en «se_valorara» y ${p.length} en «puntos_se_valorara»: uno por elemento, en el mismo orden.`,
      ];
    const suma = p.reduce((s, x) => s + x, 0);
    return Math.abs(suma - a.puntos) < 0.01
      ? []
      : [
          `Los puntos de «se valorará» del apartado «${corto(a.titulo)}» suman ${puntosTexto(suma)} y el apartado vale ${puntosTexto(a.puntos)}.`,
        ];
  });
}

export type LimiteEnPliego = { cita: string; ruta: string; pagina: number | null; paginas: number };

function problemaDeLimite(g: GuionBaseData, limite: LimiteEnPliego | null): string | null {
  if (!g.memoria || g.memoria.limite_paginas !== null || g.memoria.limite_detalle || !limite) return null;
  const doc = path.posix.basename(limite.ruta, path.posix.extname(limite.ruta));
  const donde = limite.pagina === null ? doc : `${doc} pág. ${limite.pagina}`;
  return `El pliego habla de un límite de páginas («…${limite.cita}…», ${donde}) y el guion trae memoria.limite_paginas = null: léelo y ponlo, o explica en limite_detalle por qué no aplica.`;
}

const conLotesTexto = (ls: string[]) => (ls.length === 1 ? `el lote ${ls[0]}` : `los lotes ${ls.join(', ')}`);

// Los lotes que cita cada automático y cada oferta deben ser del guion, y cada lote del guion
// necesita su oferta económica (si solo viene la de un lote, faltan las demás).
function problemasDeLotes(g: GuionBaseData): string[] {
  const delGuion = g.lotes ?? [];
  const citas = [
    ...g.automaticos.map((a) => ({ que: `El criterio «${corto(a.criterio)}»`, lotes: a.lotes ?? [] })),
    ...(g.ofertas_economicas ?? []).map((o, i) => ({ que: `La oferta económica ${i + 1}`, lotes: o.lotes })),
  ];
  const ajenos = citas.flatMap((c) => {
    const fuera = c.lotes.filter((l) => !delGuion.includes(l));
    return fuera.length
      ? [
          `${c.que} cita ${conLotesTexto(fuera)}, que no está en el guion (${delGuion.length ? conLotesTexto(delGuion) : 'sin lotes'}).`,
        ]
      : [];
  });
  const ofertas = g.ofertas_economicas ?? [];
  const sinOferta =
    delGuion.length > 1 && ofertas.length && !ofertas.some((o) => !o.lotes.length)
      ? delGuion.filter((l) => !ofertas.some((o) => o.lotes.includes(l)))
      : [];
  const v3Varios =
    delGuion.length > 1 && !ofertas.length && g.oferta_economica
      ? [
          `El guion trae ${conLotesTexto(delGuion)} y una sola «oferta_economica»: envía «ofertas_economicas», una por lote, con sus precios unitarios y su máximo.`,
        ]
      : [];
  return [
    ...ajenos,
    ...sinOferta.map(
      (l) => `Falta la oferta económica del lote ${l}: una por cada lote del guion, en «ofertas_economicas».`,
    ),
    ...v3Varios,
  ];
}

// Tramos de menos a más; el último da los puntos del criterio.
function problemasDeTramos(g: GuionBaseData): string[] {
  return g.automaticos
    .filter((a) => a.tramos?.length)
    .flatMap((a) => {
      const puntos = tramosDe(a).map((t) => t.puntos);
      const creciente = puntos.every((p, i) => i === 0 || p > puntos[i - 1]!);
      const ultimo = Math.abs(puntos.at(-1)! - a.puntos) < 0.01;
      return creciente && ultimo
        ? []
        : [
            `Los tramos del criterio «${corto(a.criterio)}» van de menos a más puntos y el último vale los del criterio (${puntosTexto(a.puntos)}): ahora ${lista(puntos, false)}.`,
          ];
    });
}

const POR_UNIDAD =
  /precio(?:s)? unitario|por (?:alumn[oa]|hora|edici[oó]n|informe|unidad|participante|sesi[oó]n|jornada|curso)(?![a-záéíóúñ])/i;

// La fórmula puede puntuar un precio por informe mientras el guion trae solo el presupuesto total.
function problemasDePrecioUnitario(g: GuionBaseData): string[] {
  return ofertasEconomicas(g).flatMap((o) => {
    if (o.precios_unitarios.length || o.presupuesto_base === null) return [];
    const m = POR_UNIDAD.exec(`${o.formula} ${o.modelo ?? ''}`);
    return m
      ? [
          `La fórmula puntúa un precio ${m[0].toLowerCase().startsWith('por') ? m[0].toLowerCase() : 'unitario'}${o.lotes.length ? ` (${conLotesTexto(o.lotes)})` : ''}: añade precios_unitarios (concepto, unidad, máximo y cantidad).`,
        ]
      : [];
  });
}

/**
 * Lo que se rechaza hasta el tercer envío (luego queda como aviso). `rubricas`: las de la
 * ficha aprobada (null sin ficha: no se comparan); `limite`: el límite de páginas que se
 * encontró en los pasajes del pliego, si se encontró.
 */
export function problemasDeGuion(
  g: GuionBaseData,
  ctx: { rubricas: Rubrica[] | null; limite: LimiteEnPliego | null },
): string[] {
  const rubricas = ctx.rubricas === null ? null : problemaDeRubricas(g, ctx.rubricas);
  return [
    rubricas,
    ...problemasDeNoValorable(g),
    ...problemasDeCitas(g),
    ...problemasDeMarcas(g),
    ...problemasDePuntosValorara(g),
    ...problemasDeLotes(g),
    ...problemasDeTramos(g),
    ...problemasDePrecioUnitario(g),
    problemaDeLimite(g, ctx.limite),
  ].filter((p): p is string => p !== null);
}

// Las formas en que un pliego fija la extensión de la memoria, sobre texto sin tildes.
const LIMITE = [
  /(?:extension|longitud)\s+(?:maxima\s+)?(?:de\s+(?:la\s+memoria\s+)?)?(?:no\s+(?:podra|debera)\s+(?:superar|exceder)\s+)?(?:de\s+)?(\d{1,3})\s+(?:paginas|caras|folios|hojas)/,
  /(?:maximo|max\.)\s+(?:de\s+)?(\d{1,3})\s+(?:paginas|caras|folios|hojas)/,
  /no\s+(?:podra|debera|podran|deberan)\s+(?:superar|exceder)\s+(?:de\s+)?(?:las?\s+|los\s+)?(\d{1,3})\s+(?:paginas|caras|folios|hojas)/,
  /(\d{1,3})\s+(?:paginas|caras|folios|hojas)\s+(?:como\s+maximo|de\s+extension\s+maxima)/,
];

// El texto sin tildes con, por cada carácter, de qué carácter del original sale: así la cita
// se da con sus tildes aunque la búsqueda se haga sin ellas.
function comparableConOrigen(t: string): { comparable: string; origen: number[] } {
  let comparable = '';
  const origen: number[] = [];
  for (let i = 0; i < t.length; i += 1) {
    const c = textoComparable(t[i]!);
    comparable += c;
    for (let k = 0; k < c.length; k += 1) origen.push(i);
  }
  return { comparable, origen };
}

/** El primer límite de páginas que aparece en unos pasajes del pliego, con la cita literal. */
export function limiteEnPasajes(
  pasajes: { ruta: string; pagina: number | null; texto: string }[],
): LimiteEnPliego | null {
  for (const p of pasajes) {
    const { comparable, origen } = comparableConOrigen(p.texto);
    for (const re of LIMITE) {
      const m = re.exec(comparable);
      if (!m) continue;
      const desde = origen[m.index]!;
      const hasta = origen[m.index + m[0].length - 1]! + 1;
      return {
        cita: p.texto.slice(desde, hasta).replace(/\s+/g, ' '),
        ruta: p.ruta,
        pagina: p.pagina,
        paginas: Number(m[1]),
      };
    }
  }
  return null;
}
