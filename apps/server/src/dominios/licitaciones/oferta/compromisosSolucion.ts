// Los compromisos de la solución de la memoria: lo que promete y cuesta dinero al ejecutar el contrato. Puro.
import { z } from 'zod';
import { textoComparable } from '../temas.js';

// Una memoria puede prometer, sin que el pliego lo exija, kits físicos por persona, horas fijas por subgrupo y
// semana, entrevistas individuales, guardias o informes periódicos: cientos de horas y miles de euros que
// vinculan al adjudicatario y no daban puntos. Cada compromiso dice si lo exige el pliego (con su cita) o si lo
// añade la memoria (con el criterio que lo puntúa, por qué compensa y su coste).
// Lo que cuesta de verdad a una empresa pequeña: por encima, la persona lo ve marcado en la ficha.
// Solo horas y un nivel: la memoria va en un sobre sin precios y ningún importe puede llegar a
// ella (fugas.ts lo rechaza), así que los agentes ni estiman ni ven dinero.
export const UMBRAL_HORAS_CARO = 40;
export const UMBRAL_HORAS_MEDIO = 10;

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const CLASES_COMPROMISO = ['exigido', 'anadido'] as const;
export type ClaseCompromiso = (typeof CLASES_COMPROMISO)[number];
export const NIVELES_COSTE = ['bajo', 'medio', 'alto'] as const;
export type NivelCoste = (typeof NIVELES_COSTE)[number];

// Un importe en lo que escribe el agente o la persona acabaría en la estrategia, la ficha o la memoria.
const IMPORTE = /€|\beur(?:os?)?\b/i;
/** ¿Lleva un importe (€, «euros»)? */
export const llevaImporte = (t: string): boolean => IMPORTE.test(t);
const SIN_IMPORTE =
  'Sin importes ni moneda: la memoria va en un sobre sin precios; el coste va en horas o con el nivel';
const SinImporte = (t: z.ZodString) => t.refine((x) => !llevaImporte(x), SIN_IMPORTE);

export const Compromiso = z.strictObject({
  texto: SinImporte(Texto(5, 400)).describe(
    'Lo que la memoria promete, con su frecuencia o cantidad (p. ej. «tutoría individual a petición, respuesta en 48 h»)',
  ),
  clase: z
    .enum(CLASES_COMPROMISO)
    .describe('«exigido» si lo pide el pliego; «anadido» si lo ofrecemos por nuestra cuenta'),
  cita: z.string().trim().max(500).default('').describe('Exigido: la cita literal del pliego del dossier que lo exige'),
  criterio: SinImporte(z.string().trim().max(300))
    .default('')
    .describe('Añadido: el criterio de valoración o apartado que lo puntúa'),
  compensa: SinImporte(z.string().trim().max(400))
    .default('')
    .describe('Añadido: por qué compensa su coste frente a los puntos que da'),
  horas: z
    .number()
    .min(0)
    .max(100_000)
    .nullable()
    .describe('Horas de persona estimadas en todo el contrato (null si no cuesta horas)'),
  nivel: z
    .enum(NIVELES_COSTE)
    .nullable()
    .default(null)
    .describe(
      'Nivel de coste de lo que no son horas de persona (material, desplazamientos): «bajo», «medio» o «alto»; null si solo cuesta horas',
    ),
  supuesto: SinImporte(z.string().trim().max(400))
    .default('')
    .describe('Cómo se estima, en horas o unidades y sin importes (p. ej. «150 alumnas × 1 h», «150 kits impresos»)'),
  quitado: z.boolean().default(false).describe('Envíalo en false: lo marca la persona en la ficha si lo quita'),
});
export type CompromisoData = z.infer<typeof Compromiso>;
type Coste = { horas: number | null; nivel?: NivelCoste | null | undefined };

// Lo guardado antes del contrato con el extractor decía «origen», «añadido» y euros: se lee igual,
// y los euros (también los del supuesto) pasan a un nivel y se descartan: ningún importe llega a nadie.
// El esquema rechaza un importe en cualquier texto del compromiso, y con él la estrategia entera
// dejaba de validar («compensa: 4.000 € frente a 10 puntos»): la memoria se quedaba sin estrategia.
const EUROS_ALTO = 1_000;
type Guardado = Record<string, unknown>;
const IMPORTES = /\d[\d.,]*\s*(?:€|\beur(?:os?)?\b)|€\s*\d[\d.,]*|€|\beur(?:os?)?\b/gi;
/** El texto sin sus importes (y sin los paréntesis o espacios que dejan). */
export const sinImportes = (t: string): string =>
  t
    .replace(IMPORTES, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
// La justificación con un importe se vacía (va con su criterio); lo prometido pierde solo el importe.
const VACIAR_CON_IMPORTE = ['supuesto', 'criterio', 'compensa'] as const;
function textosSinImporte(c: Guardado): Guardado {
  const vacios = VACIAR_CON_IMPORTE.filter((k) => typeof c[k] === 'string' && llevaImporte(c[k])).map((k) => [k, '']);
  const texto = typeof c['texto'] === 'string' && llevaImporte(c['texto']) ? [['texto', sinImportes(c['texto'])]] : [];
  return Object.fromEntries([...vacios, ...texto]) as Guardado;
}
function compromisoNormalizado(c: unknown): unknown {
  if (!c || typeof c !== 'object') return c;
  const { origen, euros, ...resto } = c as Guardado;
  const clase = resto['clase'] ?? origen;
  const deEuros = typeof euros === 'number' && euros > 0 ? (euros > EUROS_ALTO ? 'alto' : 'medio') : null;
  return {
    ...resto,
    ...textosSinImporte(resto),
    ...(clase !== undefined ? { clase: clase === 'añadido' ? 'anadido' : clase } : {}),
    ...(resto['nivel'] === undefined && deEuros ? { nivel: deEuros } : {}),
  };
}

/** Una solución guardada (JSON crudo) con los compromisos en el vocabulario de ahora. No cambia la entrada. */
export function solucionNormalizada<T>(solucion: T): T {
  const s = solucion as Guardado | null | undefined;
  if (!s || typeof s !== 'object' || !Array.isArray(s['compromisos'])) return solucion;
  return { ...s, compromisos: (s['compromisos'] as unknown[]).map(compromisoNormalizado) } as T;
}

const RANGO: Record<NivelCoste, number> = { bajo: 0, medio: 1, alto: 2 };
const nivelDeHoras = (h: number | null): NivelCoste | null =>
  h === null ? null : h > UMBRAL_HORAS_CARO ? 'alto' : h > UMBRAL_HORAS_MEDIO ? 'medio' : 'bajo';

/** El nivel de coste: el de sus horas o el declarado, el mayor (null si no trae ninguno). */
export function nivelDeCoste(c: Coste): NivelCoste | null {
  const xs = [nivelDeHoras(c.horas), c.nivel ?? null].filter((x): x is NivelCoste => x !== null);
  return xs.length ? xs.reduce((a, b) => (RANGO[b] > RANGO[a] ? b : a)) : null;
}

/** ¿Pasa del umbral de horas o es de coste alto? */
export const esCaro = (c: Coste): boolean => nivelDeCoste(c) === 'alto';

const MILES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
/** «150 h, coste alto», «coste medio», «sin coste estimado». */
export function textoDeCoste(c: Coste): string {
  const nivel = nivelDeCoste(c);
  const partes = [...(c.horas ? [`${MILES.format(c.horas)} h`] : []), ...(nivel ? [`coste ${nivel}`] : [])];
  return partes.length ? partes.join(', ') : 'sin coste estimado';
}

/** Lo que la memoria compromete: lo que la persona no quitó en la ficha. */
export const compromisosVigentes = (cs: readonly CompromisoData[]): CompromisoData[] => cs.filter((c) => !c.quitado);

/** El aviso de un compromiso caro (null si no lo es): sale en la estrategia y en la ficha. */
export function avisoDeCoste(c: CompromisoData): string | null {
  if (c.quitado || !esCaro(c)) return null;
  const umbral = `${c.supuesto || 'sin supuesto'}; umbral ${UMBRAL_HORAS_CARO} h o coste alto`;
  // Una cita real pero genérica («realizará el seguimiento del alumnado») colaba como exigido un
  // añadido inflado: lo caro exigido también se enseña, para comprobar que la cita lo pide tal cual.
  if (c.clase === 'exigido')
    return `Compromiso exigido caro: «${c.texto}» cuesta ${textoDeCoste(c)} (${umbral}). Comprueba que la cita del pliego («${c.cita || 'sin cita'}») exige esto tal cual; si exige menos, escribe solo lo que exige.`;
  return `Compromiso añadido caro: «${c.texto}» cuesta ${textoDeCoste(c)} (${umbral}) y el pliego no lo exige. Mantenlo solo si compensa los puntos de «${c.criterio || 'sin criterio'}»; si no, suavízalo (a petición, mensual, asíncrono, digital) o quítalo.`;
}

const sinCoste = (c: CompromisoData) => nivelDeCoste(c) === null;

// Un añadido sin criterio que lo puntúe es coste sin puntos; sin coste, nadie puede decidir si compensa.
export function problemasDeAnadido(c: CompromisoData): string[] {
  if (c.clase !== 'anadido' || c.quitado) return [];
  return [
    ...(c.criterio.length < 3
      ? [
          `El compromiso añadido «${c.texto}» no dice qué criterio o apartado lo puntúa: si nada lo puntúa, quítalo (cuesta y no da puntos).`,
        ]
      : []),
    ...(sinCoste(c)
      ? [
          `El compromiso añadido «${c.texto}» no trae coste: estima las horas de persona o, si no son horas, el nivel de coste, con su supuesto.`,
        ]
      : []),
    ...(!sinCoste(c) && c.supuesto.length < 3
      ? [`El compromiso añadido «${c.texto}» no dice de dónde sale su coste: escribe el supuesto («N personas × M h»).`]
      : []),
  ];
}

// Lo exigido también cuesta: sin coste, un exigido caro no llegaba a la ficha y nadie lo veía.
export function problemasDeExigidoSinCoste(c: CompromisoData): string[] {
  if (c.clase !== 'exigido' || c.quitado || !sinCoste(c)) return [];
  return [
    `El compromiso exigido «${c.texto}» no trae coste: estima las horas de persona o, si no son horas, el nivel de coste (con su supuesto) para que la ficha enseñe lo que cuesta cumplirlo.`,
  ];
}

// ── Compromisos cuantificados en el texto que no están en la lista ──

// Lo que cuesta al ejecutar: una frecuencia, una cantidad por persona, horas, material físico o
// disponibilidad fuera de horario. Sobre texto comparable (sin tildes, en minúsculas) y con las
// personas ya normalizadas («por alumnas», «con cada alumna» → «cada alumno»). «Semanal» suelto
// no: «un calendario semanal de trabajo» es planificación, no una sesión fija que cueste.
const FUERTES: RegExp[] = [
  /\bcada (?:alumno|participante|beneficiario)\b/g,
  /\b\d+(?:,\d+)? h\b/g,
  /\bguardias?\b/g,
  /\bdomingos?\b/g,
  /\bfines? de semana\b/g,
  /\bkits?\b/g,
  /\bentrevistas? individual(?:es)?\b/g,
];
// Una frecuencia o «por usuario» solo cuestan horas de persona si hablan de personas o sesiones:
// «la carga se ejecuta cada día» o «permisos por usuario» son técnica, no un compromiso.
const CON_PERSONAS: RegExp[] = [
  /\bcada (?:semana|dia|lunes|martes|miercoles|jueves|viernes|sabado)\b/g,
  /\bcada usuario\b/g,
];
const PERSONAS =
  /\b(?:sesion|tutori|entrevist|reunion|llamad|visit|seguimiento|taller|clase|formacion|acompanamiento|mentori|orientacion|atencion|informe|contact|presencial|desplaz|docente|profesional|tecnic[oa]|coordinador|kit|material)/;
// Las horas de reloj («de 9 a 14 h», «a las 20 h») son un horario, no horas de trabajo.
const RELOJ =
  /\b(?:de |entre )?(?:las )?\d{1,2}(?: \d{2})? (?:a|y) (?:las )?\d{1,2}(?: \d{2})? h\b|\blas \d{1,2}(?: \d{2})? h\b/g;
// Escrito como capacidad o a petición ya no compromete una cantidad fija, pero solo si va pegado
// a lo que compromete (o abre la frase); «podrá» solo si es «podrá pedir»: «un kit que podrá
// llevarse a casa» o «una guardia hasta las 20:00» siguen comprometiendo el kit y la guardia.
const A_PETICION = String.raw`a (?:peticion|demanda|solicitud)|bajo demanda|si (?:lo|la|los|las) (?:solicita|pide|piden|solicitan)|cuando (?:lo|la) (?:solicite|pida)n?|(?:puede|podra)n? (?:pedir|solicitar)`;
const CAPACIDAD_CERCA = new RegExp(String.raw`\b(?:${A_PETICION}|hasta (?:un maximo de )?\d|capacidad)\b`);
const CAPACIDAD_AL_ABRIR = new RegExp(String.raw`^(?:${A_PETICION})\b`);
const VENTANA = 6;
const VACIAS = new Set([
  'para',
  'como',
  'cada',
  'entre',
  'sobre',
  'desde',
  'hasta',
  'segun',
  'horas',
  'semana',
  'todas',
  'todos',
  'durante',
  'contrato',
  'servicio',
]);

const personas = (t: string) =>
  t.replace(
    /\b(?:por|a cada|con cada|cada) (alumn|participant|usuari|beneficiari)(?:[oa]s?|es?)\b/g,
    (_, n: string) => `cada ${n}${n === 'participant' ? 'e' : 'o'}`,
  );
const comparable = (t: string) =>
  personas(
    textoComparable(t)
      .replace(/(\d)[.,](\d)/g, '$1,$2')
      .replace(/(\d) ?horas?\b/g, '$1 h')
      .replace(/[^\p{L}\p{N},]+|,(?!\d)|(?<!\d),/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
// Un listado dice lo mismo con otras palabras: «sesión semanal» es «cada semana».
const comparableListado = (t: string) =>
  comparable(t)
    .replace(/\bsemanal(?:es|mente)?\b|\bpor semana\b/g, 'cada semana')
    .replace(/\bdiari(?:[oa]s?|amente)\b|\bal dia\b/g, 'cada dia');
const palabras = (t: string) => new Set(t.split(' ').filter((w) => w.length >= 5 && !VACIAS.has(w)));
const frases = (texto: string) =>
  texto
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 10);
const incluye = (l: string, d: string) => ` ${l} `.includes(` ${d} `);

type Disparador = { d: string; desde: number; hasta: number };
const coincidencias = (t: string, res: RegExp[]): Disparador[] =>
  res.flatMap((re) => [...t.matchAll(re)].map((m) => ({ d: m[0], desde: m.index, hasta: m.index + m[0].length })));

function disparadores(t: string): Disparador[] {
  return [...coincidencias(t, FUERTES), ...(PERSONAS.test(t) ? coincidencias(t, CON_PERSONAS) : [])];
}

function aPeticion(t: string, x: Disparador): boolean {
  const antes = t.slice(0, x.desde).split(' ').filter(Boolean).slice(-VENTANA);
  const despues = t.slice(x.hasta).split(' ').filter(Boolean).slice(0, VENTANA);
  return CAPACIDAD_CERCA.test([...antes, x.d, ...despues].join(' '));
}

// Las palabras de la frase sin las de sus disparadores: «alumno» o «guardia» no dicen de qué habla.
function suyas(t: string, ds: Disparador[]): Set<string> {
  const sin = ds.reduce((x, d) => `${x.slice(0, d.desde)}${' '.repeat(d.hasta - d.desde)}${x.slice(d.hasta)}`, t);
  return palabras(sin.replace(/\s+/g, ' ').trim());
}

// Un texto listado cubre un disparador si lo lleva y habla de lo mismo (comparte al menos una
// palabra con contenido): «cada semana» en un riesgo no cubre otra cosa.
const cubre = (l: string, d: string, ws: Set<string>) => incluye(l, d) && [...palabras(l)].some((w) => ws.has(w));

export const MAX_FRASES_NO_LISTADAS = 5;

function noListada(f: string, lista: string[], quitados: string[], deLaEmpresa: Set<string>): boolean {
  const t = comparable(f).replace(RELOJ, ' ').replace(/\s+/g, ' ');
  const todos = disparadores(t);
  const activos = CAPACIDAD_AL_ABRIR.test(t) ? [] : todos.filter((x) => !aPeticion(t, x));
  if (!activos.length) return false;
  const ws = suyas(t, todos);
  for (const w of deLaEmpresa) ws.delete(w);
  // Lo que la persona quitó en la ficha no vale aunque lo traigan la hoja de hechos u otro campo.
  if (activos.some((x) => quitados.some((q) => cubre(q, x.d, ws)))) return true;
  return !activos.every((x) => lista.some((l) => cubre(l, x.d, ws)));
}

/**
 * Las frases de `texto` que comprometen una frecuencia, una cantidad por persona, horas, material
 * físico o disponibilidad fuera de horario y no están en `listados` (los compromisos vigentes, la
 * hoja de hechos y la solución) o repiten uno de `quitados` (los que la persona quitó en la
 * ficha). Lo escrito como capacidad o a petición, pegado a lo que compromete, no cuenta.
 */
export function compromisosNoListados(
  texto: string,
  listados: string[],
  quitados: string[] = [],
  empresa: string | null = null,
): string[] {
  const lista = listados.map(comparableListado);
  const fuera = quitados.map(comparableListado);
  // El nombre de la empresa sale en casi todas las frases («Acme impartirá…»): no dice de qué hablan.
  const deLaEmpresa = new Set(empresa ? comparable(empresa).split(' ') : []);
  return [...new Set(frases(texto))]
    .filter((f) => noListada(f, lista, fuera, deLaEmpresa))
    .slice(0, MAX_FRASES_NO_LISTADAS);
}

/** El problema blando de un apartado con compromisos cuantificados fuera de la lista (null si no hay). */
export function problemaDeNoListados(frasesNoListadas: string[]): string | null {
  if (!frasesNoListadas.length) return null;
  const citas = frasesNoListadas.map((f) => `«${f.length > 200 ? `${f.slice(0, 197)}…` : f}»`).join(' ');
  return `Estas frases comprometen una frecuencia, una cantidad, horas, material físico o disponibilidad fuera de horario que no está en la lista de compromisos de la solución: ${citas} Escríbelas como capacidad o a petición («a petición de la entidad», «hasta N al mes») o quítalas: lo escrito vincula al ejecutar el contrato y cuesta.`;
}

// Las instrucciones de la estrategia y de la redacción.
export const COMPROMISOS_BARATOS = `Compromisos («compromisos» de la solución): cada cosa que la memoria promete y cuesta al ejecutar (frecuencias, horas, sesiones, material, entrevistas, informes, disponibilidad fuera de horario). «exigido» si lo pide el pliego, con la cita literal del dossier; «anadido» si lo ofrecemos nosotros, con el criterio o apartado que lo puntúa, por qué compensa y su coste (horas de persona en todo el contrato y, si lo que cuesta no son horas, el nivel «bajo», «medio» o «alto», con el supuesto en horas o unidades; sin importes ni moneda: la memoria va en un sobre sin precios). Lo añadido solo entra si compensa frente a los puntos que da: por defecto, la formulación más barata que puntúe (a petición en vez de fija, mensual en vez de semanal, asíncrono en vez de presencial, materiales digitales o del propio alumnado en vez de kits, y las frecuencias y cantidades mínimas que valore el pliego). Nada de guardias, fines de semana, entrevistas con cada persona ni material físico por persona si el pliego no lo exige o lo puntúa expresamente. La plataforma marca a la persona en la ficha todo añadido de más de ${UMBRAL_HORAS_CARO} h o de coste alto.`;

// Lo listado es la lista de compromisos, la solución y la hoja de hechos: con solo la lista, la
// redacción escribía «hasta 20 horas, a petición» la formación de 20 h en 10 sesiones que el
// criterio valoraba, y el crítico bajaba el tramo por transferencia sin horas.
export const SOLO_LO_LISTADO =
  'COMPROMISOS: compromete solo lo que está en la lista de compromisos, en la solución y en la hoja de hechos (y en la ficha, sin lo que la persona quitó): eso sí va con sus cifras. Cualquier otra frecuencia, cantidad, número de horas, material físico o disponibilidad fuera de horario se escribe como capacidad o a petición («a petición de la entidad», «hasta N al mes», «materiales digitales»), nunca como compromiso fijo: lo escrito en la memoria vincula al ejecutar el contrato y cuesta. Lo que la persona quitó en la ficha no se escribe aunque lo traigan la hoja de hechos u otra parte de la estrategia.';

// El crítico pedía «más seguimiento» y la ronda lo convertía en una sesión semanal fija con cada
// persona. Lo que el criterio valora expresamente sí se concreta: dejarlo vago pierde los puntos.
export const RONDA_SIN_COMPROMISOS_NUEVOS =
  'Si lo que señala el crítico pide más frecuencia, horas, sesiones, material o presencia que no está en la lista de compromisos, la solución ni la hoja de hechos, no lo añadas como compromiso fijo: escríbelo como capacidad o a petición, o concreta lo que ya está comprometido. Excepción: si lo que falta es lo que el criterio valora expresamente («se valorará…»), concrétalo con las cifras de la solución o de la hoja de hechos; eso puntúa.';
