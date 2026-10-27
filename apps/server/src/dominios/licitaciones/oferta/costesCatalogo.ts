// Catálogo de compromisos que cuestan dinero al ejecutar el contrato. Puro: sin E/S.
import { textoComparable } from '../temas.js';
import { EN_LETRA, numeroNormal, unidadDe } from './compromisosMemoria.js';
import type { LineaCostes } from './costesTexto.js';

// Son nueve tipos, cada uno con su patrón, la magnitud que se compara con el pliego y la formulación barata que
// lo sustituye. Lo extrae el código y no Hermes: así las comprobaciones, la Mesa y el MCP dicen lo mismo en cada
// recálculo, sin runs y con la misma huella. Los compromisos de una memoria llevan todos una cifra o una
// frecuencia explícita, y por eso un catálogo los alcanza. El mismo catálogo se pasa sobre el pliego para saber
// si lo exige.
export const TIPOS_COMPROMISO = [
  'material_fisico',
  'dedicacion_fija',
  'plazo_corto',
  'sesion_recurrente',
  'sesion_individual',
  'cantidad_minima',
  'frecuencia_alta',
  'grupo_extra',
  'horas_extra',
] as const;
export type TipoCompromiso = (typeof TIPOS_COMPROMISO)[number];

const FRECUENCIAS = ['diaria', 'semanal', 'quincenal', 'mensual', 'trimestral', 'por_curso'] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];
export const VECES_POR_SEMANA: Record<Frecuencia, number> = {
  diaria: 5,
  semanal: 1,
  quincenal: 0.5,
  mensual: 12 / 52,
  trimestral: 4 / 52,
  por_curso: 0,
};

type UnidadDedicacion = 'subgrupo' | 'aula' | 'alumna';
type Fraccion = 'aptas' | 'ruta_apoyo';

/**
 * Un compromiso hallado en una frase. magnitud: lo que se compara con el pliego (h por semana,
 * días hábiles, N, grupos…); ancla: el trozo normalizado que lleva la cifra (para citar la celda);
 * rotulo: lo que se compromete, para cotejarlo con el pliego por sus raíces.
 */
export type Deteccion = {
  tipo: TipoCompromiso;
  objeto: string;
  magnitud: number;
  ancla: string;
  rotulo: string;
  horas?: number;
  explicita?: boolean;
  unidad?: UnidadDedicacion;
  fraccion?: Fraccion;
  frecuencia?: Frecuencia;
  nombre?: string;
  porCurso?: boolean;
};

/** Una frase de la memoria o del pliego: cita literal, texto normalizado, celdas si es una fila y la línea de la que sale. */
export type FraseCostes = {
  cita: string;
  norm: string;
  celdas: string[] | null;
  contexto: string;
  linea: LineaCostes | null;
};

// ── Cifras ──

const LETRA = new RegExp(String.raw`(?<![\p{L}\d])(${Object.keys(EN_LETRA).join('|')})(?=\s+\p{L})`, 'gu');
const num = (s: string): number => Number(numeroNormal(s));
export const decimal = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');
const enHoras = (n: number): string => `${decimal(n)} h`;

// «2 h 30 min» → «2,5 h», «30 minutos» → «0,5 h», «media hora» → «0,5 h», «10 a 15 minutos» → «0,25 h»
// (el máximo del intervalo): con todas las duraciones en horas, un solo patrón las lee.
function duracionesEnHoras(s: string): string {
  return s
    .replace(/\bmedia hora\b/g, '0,5 h')
    .replace(/(\d+) horas? y media\b/g, '$1,5 h')
    .replace(/(\d+) a (\d+) ?(minutos?|min|horas?|h)\b/g, '$2 $3')
    .replace(/(\d+(?:,\d+)?) ?(?:horas?|hrs?|h)\b(?: y)? (\d+) ?(?:minutos?|min)\b/g, (_, h: string, m: string) =>
      enHoras(num(h) + Number(m) / 60),
    )
    .replace(/(\d+) ?(?:minutos?|min)\b/g, (_, m: string) => enHoras(Number(m) / 60))
    .replace(/(\d) ?(?:horas?|hrs?)\b/g, '$1 h');
}

/** El texto comparable para los patrones: sin tildes ni marcas, con las cifras en letra en número y las duraciones en horas. */
export function normal(t: string): string {
  const s = textoComparable(t)
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(LETRA, (w) => String(EN_LETRA[w]));
  return duracionesEnHoras(s).trim();
}

export type CifraCoste = { valor: number; unidad: string; minimo: boolean };
const CIFRA =
  /(?:(al menos|como minimo|un minimo de|minimo de|no menos de|≥|>=) ?)?(?<![\d.,])(\d+(?:[.,]\d+)*) ?(%|\p{L}+)/gu;
const singular = (w: string): string => (w.length > 4 ? w.replace(/(?<=[^aeiou])es$|s$/, '') : w);

/** Las cifras con unidad: «2 h 30 min» → 2,5 h; «≥ 20 empleadores» → 20 empleador (mínimo); «dos grupos» → 2 grupo; «1.000 alumnas» → 1000. */
export function cifrasDeCoste(texto: string): CifraCoste[] {
  return [...normal(texto).matchAll(CIFRA)].map((m) => ({
    valor: num(m[2]!),
    unidad: unidadDe(m[3]!) ?? singular(m[3]!),
    minimo: Boolean(m[1]),
  }));
}

const RELOJ = /(\d{1,2}):(\d{2}) ?(?:a|y|-|hasta) ?(?:las )?(\d{1,2}):(\d{2})/;
/** «de 19:00 a 21:00» → 2 (h); null sin franja horaria. */
function duracionDeReloj(norm: string): number | null {
  const m = RELOJ.exec(norm);
  if (!m) return null;
  const h = (Number(m[3]) * 60 + Number(m[4]) - Number(m[1]) * 60 - Number(m[2])) / 60;
  return h > 0 && h <= 12 ? h : null;
}

const HORAS = /(\d+(?:,\d+)?) h\b/;
// La primera duración de la ventana (o su franja horaria); null si no trae ninguna.
function duracionEn(ventana: string): { horas: number; ancla: string } | null {
  const reloj = RELOJ.exec(ventana);
  const h = HORAS.exec(ventana);
  if (reloj && (!h || reloj.index < h.index)) return { horas: duracionDeReloj(reloj[0]) ?? 1, ancla: reloj[0] };
  return h ? { horas: num(h[1]!), ancla: h[0] } : null;
}

// ── Contexto ──

// Lo que, pegado a lo que compromete, lo convierte en un servicio a petición, que no cuesta una cantidad fija.
const A_PETICION =
  /\b(?:a (?:peticion|demanda|solicitud)|bajo demanda|si (?:lo|la|los|las) (?:solicita|pide)n?|cuando (?:lo|la) (?:solicite|pida)n?|(?:puede|podra)n? (?:pedir|solicitar)\w*)\b/;
const POR_PERSONA =
  /\bcada (?:alumn|participant|usuari|persona|beneficiari)\w*|\bpor (?:alumn|participant|usuari|persona)\w*/;
const POR_CURSO = /\b(?:por|cada|en cada|de cada) (?:curso|accion formativa)\b/;
const FRECUENCIA_RE: [RegExp, Frecuencia][] = [
  [/\bcada dia\b|\bdiari(?:[oa]s?|amente)\b/, 'diaria'],
  [
    /\bcada (?:semana|tutoria|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\bsemanal(?:es|mente)?\b|\bpor semana\b|\b(?:el|los) domingos?\b/,
    'semanal',
  ],
  [/\bquincenal(?:es|mente)?\b|\bcada 15 dias\b/, 'quincenal'],
  [/\bmensual(?:es|mente)?\b|\bcada mes\b|\bal mes\b/, 'mensual'],
  [/\btrimestral(?:es|mente)?\b|\bcada 3 meses\b/, 'trimestral'],
];

/** La frecuencia más alta que dice la frase; null si no dice ninguna. */
const frecuenciaDe = (norm: string): Frecuencia | null => FRECUENCIA_RE.find(([re]) => re.test(norm))?.[1] ?? null;
/** ¿Lo dice como servicio a petición («a petición de la alumna», «puede pedirla»)? */
const esAPeticion = (norm: string): boolean => A_PETICION.test(norm);

// La frecuencia que va con lo que se compromete (a menos de CERCA caracteres), no la de otra cosa de la frase.
const CERCA = 50;
const frecuenciaCerca = (norm: string, m: RegExpExecArray): Frecuencia | null =>
  frecuenciaDe(norm.slice(Math.max(0, m.index - CERCA), m.index + m[0].length + CERCA));

const rotuloDesde = (norm: string, desde: number): string =>
  norm
    .slice(desde)
    .split(/[,.;:|()]/)[0]!
    .split(' ')
    .slice(0, 6)
    .join(' ');

// ── Detectores ──

type Detector = (f: FraseCostes) => Deteccion[];

const ENVIO = /\b(?:envi|entreg|recib|repart|remit|facilit)\w*|\bhace(?:mos)? llegar\b/;
const FISICO =
  /\b(?:material(?:es)?|kits?|termometros?|guantes|bayetas?|maletin(?:es)?|utensilios?|herramientas?|paquetes?|libros? impresos?|cuadernos?)\b/;
const DIGITAL = /\b(?:digital(?:es)?|electronic[oa]s?|online|en linea|descargables?|pdf|aula virtual|plataforma)\b/;

const material: Detector = ({ norm }) => {
  const m = FISICO.exec(norm);
  if (!m || !ENVIO.test(norm) || !POR_PERSONA.test(norm) || DIGITAL.test(norm)) return [];
  return [
    { tipo: 'material_fisico', objeto: 'material', magnitud: 1, ancla: m[0], rotulo: rotuloDesde(norm, m.index) },
  ];
};

const DEDICACION =
  /(\d+(?:,\d+)?) h (?:semanales |a la semana |por semana |cada semana )?por (subgrupo|aula|grupo|alumn[ao])/;
const SEMANAL = /\bsemana(?:l|les|lmente)?\b|\bdedicacion\b/;
const INDIVIDUAL = /\b(?:llamad|entrevist|videollamad|revis)\w*/;

// Una fila de la tabla que reparte el tiempo de la tutoría, la consulta o el resumen (p. ej.
// «Tutoría en directo, consulta de mañana y resumen escrito | 3 h por aula») no se
// cuenta dos veces: cada una de esas sesiones ya la cuenta sesion_recurrente.
function repartoDeSesiones(linea: LineaCostes | null): boolean {
  const tarea = linea?.celdas?.[0];
  return Boolean(tarea) && RECURRENTES.some(([, re]) => re.test(normal(tarea!)));
}

const dedicacion: Detector = ({ norm, linea }) => {
  const m = DEDICACION.exec(norm);
  if (!m) return [];
  const unidad: UnidadDedicacion =
    m[2] === 'subgrupo' ? 'subgrupo' : m[2] === 'aula' || m[2] === 'grupo' ? 'aula' : 'alumna';
  const marco = normal(`${linea?.titulo ?? ''} ${(linea?.cabecera ?? []).join(' ')}`);
  if (!SEMANAL.test(norm) && !SEMANAL.test(marco)) return [];
  if (unidad === 'alumna' && INDIVIDUAL.test(norm)) return [];
  if (repartoDeSesiones(linea)) return [];
  return [
    {
      tipo: 'dedicacion_fija',
      objeto: unidad,
      magnitud: num(m[1]!),
      ancla: m[0],
      rotulo: `dedicacion por ${unidad}`,
      unidad,
    },
  ];
};

// «Corregido» suelto es un participio («el error queda corregido en 2 días»): no es corregir una entrega.
const CORRECCION =
  /\b(?:correcc|corrige|corrigen|corregir\w*|corregira|retroaliment|devoluc|calific)\w*|\brevision de (?:tareas|entregas|practicas|ejercicios)\b/;
// Lo que se corrige son entregas, y se dice cerca del plazo (no en otra celda de la fila).
const ENTREGAS = /\b(?:tareas?|entregas?|practicas?|ejercicios?|trabajos?|actividades?|evidencias?)\b/;
const PLAZO = /\ben (\d+(?:,\d+)?) dias? habil\w*|\b(\d+(?:,\d+)?) dias? habil\w* desde (?:la|su) entrega/g;
const ANTES_DEL_PLAZO = 100;

const plazo: Detector = ({ norm }) =>
  [...norm.matchAll(PLAZO)].slice(0, 1).flatMap((m) => {
    const cerca = norm.slice(Math.max(0, m.index - ANTES_DEL_PLAZO), m.index + m[0].length + 40);
    const c = CORRECCION.exec(cerca);
    if (!c || !ENTREGAS.test(cerca)) return [];
    return [
      {
        tipo: 'plazo_corto' as const,
        objeto: 'correccion',
        magnitud: num(m[1] ?? m[2]!),
        ancla: m[0].trim(),
        rotulo: rotuloDesde(cerca, c.index),
      },
    ];
  });

const RECURRENTES: [string, RegExp][] = [
  ['consulta', /\bconsultas?\b(?! de seguimiento)/],
  ['guardia', /\bguardias?\b/],
  ['resumen', /\bresumen(?:es)? escrit/],
  ['sintesis', /\bsintesis\b/],
  ['tutoria', /\btutorias?\b(?! individual| docente)/],
  ['sesion', /\bsesion(?:es)? (?:en directo|grupal(?:es)?|sincronic\w*)/],
  ['reunion', /\breunion(?:es)?\b(?! individual)/],
];

// Hasta la siguiente cosa que se compromete: «tutoría de 1 h y consulta de 0,5 h» da a cada una la suya.
function ventana(norm: string, desde: number, familia: [string, RegExp][]): string {
  const resto = norm.slice(desde + 1);
  const otras = familia.map(([, re]) => resto.search(re)).filter((i) => i >= 0);
  return norm.slice(desde, desde + 1 + Math.min(90, ...otras));
}

const recurrente: Detector = ({ norm }) =>
  RECURRENTES.flatMap(([objeto, re]) => {
    const m = re.exec(norm);
    const frecuencia = m ? frecuenciaCerca(norm, m) : null;
    if (!m || !frecuencia || frecuencia === 'por_curso') return [];
    const d = duracionEn(ventana(norm, m.index, RECURRENTES));
    const horas = d?.horas ?? 1;
    return [
      {
        tipo: 'sesion_recurrente' as const,
        objeto,
        magnitud: horas * VECES_POR_SEMANA[frecuencia],
        ancla: d?.ancla ?? m[0],
        rotulo: rotuloDesde(norm, m.index),
        horas,
        frecuencia,
        explicita: Boolean(d),
      },
    ];
  });

// Minutos por defecto de cada sesión individual si la memoria no los dice.
const INDIVIDUALES: [string, RegExp, number][] = [
  ['entrevista', /\bentrevistas?\b/, 30],
  ['revision', /\brevis(?:a|an|ara|ion|iones|ados?|adas?)\b/, 30],
  ['tutoria_individual', /\btutorias? individual(?:es)?\b/, 30],
  ['llamada', /\bllamad(?:a|as)\b|\bllamara\b/, 10],
  ['videollamada', /\bvideollamadas?\b/, 15],
];
const FAMILIA_INDIVIDUAL: [string, RegExp][] = INDIVIDUALES.map(([o, re]) => [o, re]);
const DE_CV = /\b(?:cv|curriculum|plan(?:es)? personal(?:es)?)\b/;

function individualDe(norm: string): { objeto: string; m: RegExpExecArray; minutos: number } | null {
  for (const [objeto, re, minutos] of INDIVIDUALES) {
    const m = re.exec(norm);
    if (m && (objeto !== 'revision' || DE_CV.test(norm))) return { objeto, m, minutos };
  }
  return null;
}

const individual: Detector = ({ norm }) => {
  const s = individualDe(norm);
  if (!s || (!POR_PERSONA.test(norm) && !(s.objeto === 'revision' || /\bindividual(?:es)?\b/.test(norm)))) return [];
  const d = duracionEn(ventana(norm, s.m.index, FAMILIA_INDIVIDUAL));
  const horas = d?.horas ?? s.minutos / 60;
  const fraccion: Fraccion | undefined = /\baptas?\b/.test(norm)
    ? 'aptas'
    : /\bruta de apoyo\b/.test(norm)
      ? 'ruta_apoyo'
      : undefined;
  return [
    {
      tipo: 'sesion_individual',
      objeto: s.objeto,
      magnitud: horas,
      ancla: d?.ancla ?? s.m[0],
      rotulo: rotuloDesde(norm, s.m.index),
      horas,
      explicita: Boolean(d),
      ...(fraccion ? { fraccion } : {}),
    },
  ];
};

const MINIMO = /(?:\b(?:al menos|como minimo|un minimo de|minimo de|no menos de)|≥|>=) ?(\d+(?:\.\d{3})*) (\p{L}+)/u;
const CONTABLES =
  /^(?:empleador|empresa|entidad|contacto|visita|reunion|actividad|oferta|organizacion|asociacion|colaborador|acuerdo|convenio)/;

const minimo: Detector = ({ norm, contexto }) => {
  const m = MINIMO.exec(norm);
  if (!m || !CONTABLES.test(m[2]!) || num(m[1]!) < 2) return [];
  const porCurso = POR_CURSO.test(norm) || POR_CURSO.test(contexto);
  return [
    {
      tipo: 'cantidad_minima',
      objeto: singular(m[2]!),
      magnitud: num(m[1]!),
      ancla: m[0],
      rotulo: rotuloDesde(norm, m.index),
      nombre: m[2]!,
      porCurso,
    },
  ];
};

// «Informe de finalización», «de participación» o «de dedicación» son informes de la plataforma que
// la tutora consulta (su tiempo ya está en la tabla de dedicación), no un informe que se redacta.
const INFORME = /\binformes?\b(?! de (?:aptitud|finalizacion|participacion|dedicacion|calificaciones|actividad))/;
const PERIODICOS: [string, RegExp][] = [
  ['informe', INFORME],
  ['cruce', /\bcruz(?:a|an|ara|amos)\b|\bcruces?\b/],
  ['consulta_seguimiento', /\bconsultas? de seguimiento\b/],
  ['publicacion', /\bpublica(?:n|ra|mos)?\b(?=.{0,40}\bofertas\b)/],
  ['boletin', /\bboletin(?:es)?\b/],
];
const ALTAS = new Set<Frecuencia>(['diaria', 'semanal', 'quincenal', 'mensual']);

const periodico: Detector = ({ norm }) => {
  const hit = PERIODICOS.map(([objeto, re]) => ({ objeto, m: re.exec(norm) })).find((x) => x.m);
  const frecuencia = hit?.m ? frecuenciaCerca(norm, hit.m) : null;
  if (!hit?.m || !frecuencia || !ALTAS.has(frecuencia)) return [];
  return [
    {
      tipo: 'frecuencia_alta',
      objeto: hit.objeto,
      magnitud: VECES_POR_SEMANA[frecuencia],
      ancla: hit.m[0],
      rotulo: rotuloDesde(norm, hit.m.index),
      frecuencia,
    },
  ];
};

const GRUPOS = /\b(\d+) grupos\b/;
const grupos: Detector = ({ norm }) => {
  const m = GRUPOS.exec(norm);
  if (!m || Number(m[1]) < 2) return [];
  return [{ tipo: 'grupo_extra', objeto: 'grupo', magnitud: Number(m[1]), ancla: m[0], rotulo: 'grupos' }];
};

const EXTRA =
  /\b(?:taller(?:es)?|adicional(?:es)?|complementari[oa]s?|sesion(?:es)? grupal(?:es)?|modulos? complementarios?)\b/;
// Unas horas por subgrupo, aula o semana son dedicación, no horas añadidas al curso.
const HORAS_EXTRA = /(\d+(?:,\d+)?) h\b(?! (?:por|cada|a la) (?:subgrupo|aula|grupo|alumn\w*|semana))(?! semanales)/;

// Las horas van con lo extra en su misma cláusula: en «sesión grupal grabada; entrevista de 30
// minutos», los 30 minutos son de la entrevista y no de la sesión.
const clausulaExtra = (norm: string): string | undefined =>
  norm.split(';').find((c) => EXTRA.test(c) && HORAS_EXTRA.test(c));

const horasExtra: Detector = ({ norm, contexto }) => {
  const c = clausulaExtra(norm);
  const k = c ? EXTRA.exec(c) : null;
  const m = c ? HORAS_EXTRA.exec(c) : null;
  if (!c || !k || !m) return [];
  const objeto = /\btaller/.test(c)
    ? 'taller'
    : /\bsesion(?:es)? grupal/.test(c)
      ? 'sesion_grupal'
      : 'horas_adicionales';
  const porCurso = POR_CURSO.test(norm) || POR_CURSO.test(contexto);
  return [
    { tipo: 'horas_extra', objeto, magnitud: num(m[1]!), ancla: m[0], rotulo: rotuloDesde(c, k.index), porCurso },
  ];
};

const DETECTORES: Detector[] = [
  material,
  dedicacion,
  plazo,
  recurrente,
  individual,
  minimo,
  periodico,
  grupos,
  horasExtra,
];

/** Lo que compromete una frase, por tipo (vacío si lo dice a petición). */
export function detectar(f: FraseCostes): Deteccion[] {
  if (esAPeticion(f.norm)) return [];
  return DETECTORES.flatMap((d) => d(f));
}

// ── Lo que el pliego nombra sin cifra ──

const NOMBRADOS: [TipoCompromiso, [string, RegExp][]][] = [
  ['sesion_recurrente', RECURRENTES],
  ['frecuencia_alta', PERIODICOS],
  ['sesion_individual', FAMILIA_INDIVIDUAL],
  ['plazo_corto', [['correccion', CORRECCION]]],
];

/** Las cosas que nombra una frase del pliego aunque no les ponga cifra («las tutorías que se establezcan»). */
export function objetosNombrados(norm: string): { tipo: TipoCompromiso; objeto: string; rotulo: string }[] {
  return NOMBRADOS.flatMap(([tipo, familia]) =>
    familia.flatMap(([objeto, re]) => {
      const m = re.exec(norm);
      return m ? [{ tipo, objeto, rotulo: rotuloDesde(norm, m.index) }] : [];
    }),
  );
}

/**
 * Lo mínimo que concreta una obligación que el pliego nombra sin cifra: eso es exigido y lo de
 * encima, añadido. Los informes, según la tabla de costes firmada: «informes periódicos» se cumple con
 * uno por curso, y el informe mensual sale como añadido (el plan decía mensual; manda la tabla firmada).
 */
export const CONCRECION_MINIMA: Partial<Record<TipoCompromiso, { magnitud: number; texto: string }>> = {
  sesion_recurrente: { magnitud: 1, texto: '1 sesión semanal de 1 h' },
  frecuencia_alta: { magnitud: 0, texto: 'una vez por curso' },
};

/** En los plazos, menos días es más exigente. */
export const menosEsMas = (tipo: TipoCompromiso): boolean => tipo === 'plazo_corto';

// ── Formulación barata ──

type ParametrosBarata = { plazoReferencia: number; persona: string };
const ESCALON: Partial<Record<Frecuencia, Frecuencia>> = {
  diaria: 'semanal',
  semanal: 'mensual',
  quincenal: 'mensual',
  mensual: 'por_curso',
  trimestral: 'por_curso',
};
const FRECUENCIA_TEXTO: Record<Frecuencia, string> = {
  diaria: 'diaria',
  semanal: 'semanal',
  quincenal: 'quincenal',
  mensual: 'mensual',
  trimestral: 'trimestral',
  por_curso: 'una vez por curso',
};
const CON_GRABACION = new Set(['consulta', 'resumen', 'sintesis', 'tutoria', 'sesion']);

function frecuenciaBarata(d: Deteccion): string {
  const de = d.frecuencia ?? 'semanal';
  const a = ESCALON[de] ?? 'por_curso';
  return a === 'por_curso'
    ? `Una vez por curso en lugar de ${FRECUENCIA_TEXTO[de]}`
    : `Con frecuencia ${FRECUENCIA_TEXTO[a]} en lugar de ${FRECUENCIA_TEXTO[de]}`;
}

function individualBarata(d: Deteccion, p: ParametrosBarata): string {
  if (d.objeto === 'llamada') return 'Un mensaje en lugar de la llamada';
  if (d.objeto === 'revision') return 'A petición, en 10 días hábiles';
  return `A petición de la ${p.persona}`;
}

/** La formulación que mantiene el servicio sin el coste: reproduce la tabla de costes firmada. */
export function formulacionBarata(d: Deteccion, p: ParametrosBarata): string {
  switch (d.tipo) {
    case 'material_fisico':
      return 'Utensilios de casa, vídeos de demostración y casos simulados; sin envío';
    case 'dedicacion_fija':
      return `Sin dedicación fija: quita la tabla y compromete solo el plazo de corrección (${p.plazoReferencia} días hábiles)`;
    case 'plazo_corto':
      return `${p.plazoReferencia} días hábiles y comentario breve`;
    case 'sesion_recurrente':
      return CON_GRABACION.has(d.objeto) ? 'Quítala; basta la grabación de la tutoría' : 'Quítala';
    case 'sesion_individual':
      return individualBarata(d, p);
    case 'cantidad_minima':
      return `Al menos ${Math.max(1, Math.round(d.magnitud / 4))} ${d.nombre ?? d.objeto} por curso`;
    case 'frecuencia_alta':
      return frecuenciaBarata(d);
    case 'grupo_extra':
      return 'Un grupo, como pide el pliego';
    case 'horas_extra':
      return `${decimal(d.magnitud * 0.6)} h asíncronas${d.porCurso ? ' por curso' : ''}`;
  }
}

/** La magnitud escrita para leerla («0,5 h por semana», «3 días hábiles», «2 grupos»). */
export function magnitudTexto(tipo: TipoCompromiso, m: number): string {
  switch (tipo) {
    case 'material_fisico':
      return 'envío a cada persona';
    case 'dedicacion_fija':
    case 'sesion_recurrente':
      return `${decimal(m)} h por semana`;
    case 'sesion_individual':
      return `${decimal(m * 60)} min`;
    case 'plazo_corto':
      return `${decimal(m)} días hábiles`;
    case 'frecuencia_alta':
      return FRECUENCIA_TEXTO[FRECUENCIAS.find((f) => VECES_POR_SEMANA[f] === m) ?? 'semanal'];
    case 'grupo_extra':
      return `${m} grupos`;
    case 'cantidad_minima':
      return String(m);
    case 'horas_extra':
      return `${decimal(m)} h`;
  }
}
