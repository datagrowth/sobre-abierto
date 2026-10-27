// Piezas de las instrucciones del run que redacta la memoria: rúbrica, cuota y decisiones del equipo.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { lotesDeLicitacion } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import {
  CAUTELAS_ENFOQUE,
  decisionesDe,
  equipoParaRedactar,
  textoAIncorporar,
  textoHerramientas,
  tieneCautelas,
  type DecisionesData,
  type MiembroEquipo,
} from './decisiones.js';
import { equipoAnonimo } from './dossier.js';
import { meritosEnOtroArchivo } from './fugas.js';
import { SOLO_LO_LISTADO } from './compromisosSolucion.js';
import type { GuionGuardado } from './guion.js';
import { memoriaValorable, puntosTexto } from './guionRevision.js';
import { decisionesDelLote } from './memoriaLote.js';
import {
  CARACTERES_POR_PAGINA,
  esMockup,
  FIGURAS_MAX_MOCKUP,
  sinCitasInternas,
  type ContextoApartado,
} from './memoriaRevision.js';

// La rúbrica literal del guion, la cuota y las decisiones del equipo van en la propia tarea para que Hermes no
// tenga que pedirlas (menos tokens) y no pueda cambiarlas. Llevan nombres, CV y perfil del equipo
// (titulaciones, años, certificaciones; nunca contacto): es la única salida de datos personales de la oferta, y
// va solo a Hermes. Empujan a escribir en afirmativo y a llenar la cuota: la revisión rechaza lo que se queda
// corto o matiza de más.
const MILES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

type ApartadoGuion = NonNullable<GuionGuardado['datos']['memoria']>['apartados'][number];

// La memoria que ganó enseñaba 9 pantallas con su leyenda; la que perdió, un marcador sin contenido.
const MOCKUP = `PANTALLAS (este apartado las pide): hasta ${FIGURAS_MAX_MOCKUP} figuras. Cada pantalla, una figura SVG con llamadas numeradas (1, 2, 3…) sobre lo que se ve y, en el mismo bloque, la lista numerada que explica cada llamada; con varias, una tabla de pantallas (pantalla, para qué sirve, quién la usa). Un mismo caso recorre todas las pantallas: es el hilo común de la memoria.`;

function lineasRubrica(a: ApartadoGuion, total: number): string[] {
  const escala = a.escala.length
    ? a.escala.map((t) => `${puntosTexto(t.puntos)} puntos: ${t.descripcion}`).join('; ')
    : 'el pliego no la detalla';
  return [
    `(${puntosTexto(a.puntos)} puntos de ${puntosTexto(total)} de la memoria)`,
    `Se valorará (cada punto debe quedar tratado y declarado en «cubre»${a.puntos_se_valorara ? '; reparte la extensión según sus puntos' : ''}):`,
    ...a.se_valorara.map(
      (s, i) =>
        `- ${s}${a.puntos_se_valorara?.[i] !== undefined ? ` (máx. ${puntosTexto(a.puntos_se_valorara[i]!)} puntos)` : ''}`,
    ),
    `Escala del pliego: ${escala}. Escribe para el tramo más alto.`,
  ];
}

// Sin puntos, la mesa solo comprueba que está lo exigido: si falta algo, la oferta puede quedar fuera.
function lineasContenidoExigido(a: ApartadoGuion): string[] {
  return [
    '(la memoria no se puntúa: el pliego la exige con un contenido mínimo y la mesa comprueba que está todo)',
    'Contenido que exige el pliego (cada cosa debe quedar tratada y declarada en «cubre»; si falta alguna, la oferta puede quedar excluida):',
    ...a.se_valorara.map((s) => `- ${s}`),
    'Escribe claro y verificable, sin relleno: no hay tramos que ganar, solo cumplir con lo exigido de forma concreta.',
  ];
}

// Con suelo (la memoria puntúa), la extensión objetivo es casi toda su parte del límite: la mesa
// compara con ofertas que llenan su espacio con contenido. Sobre la parte y no sobre la cuota
// (que lleva holgura): si todos llenaran la cuota, la memoria pasaría del límite de páginas.
const OBJETIVO_PARTE = 0.9;
const paginasDe = (caracteres: number) => Math.max(1, Math.round(caracteres / CARACTERES_POR_PAGINA));

function textoExtension(c: ContextoApartado, valorable: boolean): string {
  const q = c.cuota;
  if (!q)
    return `El pliego no fija límite de páginas: extensión proporcionada a ${valorable ? 'sus puntos' : 'lo que exige'}, sin relleno.`;
  if (q.sinLimite)
    return `El pliego no fija límite de páginas: la estrategia le da unos ${MILES.format(q.objetivo)} caracteres y es un techo, no una meta; la plataforma rechaza lo que pase de ${MILES.format(q.caracteres)}. Sin relleno.`;
  if (q.minimo === null)
    return `Cuota: hasta unos ${MILES.format(q.objetivo)} caracteres (≈ ${paginasDe(q.objetivo)} páginas de las ${q.limite} del límite; la plataforma rechaza lo que pase de ${MILES.format(q.caracteres)}), sin relleno.`;
  const objetivo = `${MILES.format(Math.round((q.objetivo * OBJETIVO_PARTE) / 100) * 100)}-${MILES.format(q.objetivo)}`;
  return `Extensión objetivo: ${objetivo} caracteres (su parte del límite, ≈ ${paginasDe(q.objetivo)} páginas de las ${q.limite}; entre todos los apartados llenan el límite). La plataforma rechaza lo que pase de ${MILES.format(q.caracteres)} y lo que no llegue a ${MILES.format(q.minimo)}.`;
}

/** La rúbrica literal, la cuota y las advertencias del apartado `n` (también para la redacción entera). */
export function lineasApartado(g: GuionGuardado, c: ContextoApartado, n: number): string[] {
  const mem = g.datos.memoria!;
  const valorable = memoriaValorable(mem);
  const a = mem.apartados[n - 1]!;
  const cuota = textoExtension(c, valorable);
  const [entre, ...rubrica] = valorable
    ? lineasRubrica(
        a,
        mem.apartados.reduce((s, x) => s + x.puntos, 0),
      )
    : lineasContenidoExigido(a);
  const advertencias = mem.advertencias.length ? mem.advertencias.map((x) => `«${x}»`).join(' ') : 'ninguna';
  const donde = a.documento ? `Está en ${a.documento}${a.pagina ? ` pág. ${a.pagina}` : ''}.` : null;
  return [
    `APARTADO: «${a.titulo}» ${entre}. ${cuota}`,
    ...rubrica,
    `Advertencias del pliego (literales): ${advertencias}.`,
    ...(donde ? [donde] : []),
    ...(esMockup(a) ? [MOCKUP] : []),
  ];
}

const MAX_TECNOLOGIAS = 10;

// Lo estructurado del CV (sin contacto): con ello el redactor presenta a cada persona sin
// tener que abrir su CV ni inventar titulaciones o años.
function perfilDe(p: MiembroEquipo): string {
  const partes = [
    p.titulaciones.join(', '),
    p.anios_experiencia !== null ? `${p.anios_experiencia} años de experiencia` : '',
    p.certificaciones.length ? `certificaciones: ${p.certificaciones.join(', ')}` : '',
    p.sectores.length ? `sectores: ${p.sectores.join(', ')}` : '',
    p.tecnologias.length ? `tecnologías: ${p.tecnologias.slice(0, MAX_TECNOLOGIAS).join(', ')}` : '',
  ].filter(Boolean);
  return partes.length ? `: ${partes.join('; ')}` : '';
}

const dedicacionDe = (p: MiembroEquipo) => (p.dedicacion ? ` (${p.dedicacion})` : '');

function lineaEquipo(
  dbNucleo: DbNucleo,
  d: DecisionesData,
  meritos: { criterio: string; archivo: string } | null,
  anonimo: boolean,
): string {
  const equipo = equipoParaRedactar(dbNucleo, d);
  if (!equipo.length) return '- Equipo nominal: sin equipo nominal fijado: no nombres personas.';
  // La experiencia, la titulación o las certificaciones del equipo puntúan en otro archivo: con
  // nombres y años, la memoria revela lo que allí se valora (puede ser causa de exclusión).
  if (meritos) {
    return `- Equipo (redacta por roles, sin nombres, años de experiencia, titulaciones ni certificaciones: se valoran en «${meritos.criterio}», que va en «${meritos.archivo}»): ${equipo.map((p) => `${p.rol_en_la_oferta}${dedicacionDe(p)}`).join(' | ')}.`;
  }
  // CV anonimizados: con el nombre, la memoria identifica a quien el pliego pide no identificar.
  if (anonimo)
    return `- Equipo (por roles, sin nombres: el pliego pide el equipo sin identificar): ${equipo.map((p) => `${p.rol_en_la_oferta}${dedicacionDe(p)}`).join(' | ')}.`;
  const texto = equipo
    .map(
      (p) =>
        `${p.nombre} — ${p.rol_en_la_oferta}${dedicacionDe(p)}${perfilDe(p)}; ${p.cv_ruta ? `CV «${p.cv_ruta}»` : 'sin CV en la Biblioteca'}`,
    )
    .join(' | ');
  return `- Equipo nominal (usa estos nombres, roles y datos; no inventes titulaciones, años ni certificaciones; el detalle, en su CV): ${texto}.`;
}

const mismoArchivo = (a: string, b: string) =>
  textoComparable(a).replace(/\s+/g, ' ').trim() === textoComparable(b).replace(/\s+/g, ' ').trim();

// Con los automáticos en el mismo archivo que la memoria no hay fuga posible, pero sí
// contradicción: la memoria no puede describir un nivel que el modelo no marca (ni dejarse lo
// marcado), y cumplir lo ofertado es obligación esencial del contrato.
function lineasMismoArchivo(g: GuionGuardado, d: DecisionesData): string[] {
  const mem = g.datos.memoria!;
  const juntos = g.datos.automaticos.filter((a) => mismoArchivo(a.archivo, mem.archivo));
  if (!juntos.length) return [];
  const decision = (criterio: string) => d.automaticos.find((x) => mismoArchivo(x.criterio, criterio));
  const si = juntos
    .filter((a) => decision(a.criterio)?.nos_acogemos)
    .map((a) => `«${a.criterio}»${decision(a.criterio)?.nota ? ` (${decision(a.criterio)!.nota})` : ''}`);
  const no = juntos.filter((a) => !decision(a.criterio)?.nos_acogemos).map((a) => `«${a.criterio}»`);
  return [
    `- Criterios automáticos que van en el mismo archivo que la memoria (se marcan en su modelo): describe lo ofertado de forma coherente con el modelo, sin superarlo; lo no ofertado no se describe.`,
    `  · Nos acogemos: ${si.length ? si.join('; ') : 'a ninguno'}.`,
    `  · No nos acogemos: ${no.length ? no.join('; ') : 'a ninguno'}.`,
  ];
}

// La frontera con los otros sobres, en positivo: ni afirmar ni negar (decir que no le
// acogemos a algo también lo menciona y además resta).
function lineaFrontera(c: ContextoApartado): string {
  const dinero = 'Tampoco van importes, porcentajes de baja ni nada de la oferta económica.';
  if (!c.automaticos.length)
    return `- Frontera con los otros sobres: el guion no trae criterios automáticos que vayan en otro archivo. ${dinero}`;
  const archivos = [...new Set(c.automaticos.map((a) => `«${a.archivo}»`))].join(' y ');
  const marcas = [...new Set(c.automaticos.flatMap((a) => a.marcas))].map((m) => `«${m}»`).join(', ni ');
  const criterios = c.automaticos
    .map((a) => `«${a.criterio.length > 90 ? `${a.criterio.slice(0, 87)}…` : a.criterio}»`)
    .join(', ');
  const delatan = [...new Set((c.literales ?? []).map((l) => `«${l.marca}»`))];
  const ofrecido = `${delatan.length ? ` Tampoco ${delatan.join(', ')}: es lo que ofrecemos en ellos o el modelo donde se marca.` : ''} Ni cuentes con otras palabras lo que se declara en ellos.`;
  return `- Frontera con los otros sobres: estas materias se valoran en ${archivos} y no aparecen en la memoria, ni para afirmarlas ni para negarlas (mezclarlas es causa de exclusión): ${criterios}${marcas ? `; ni ${marcas}` : ''}.${ofrecido} El nombre del órgano y el título de la licitación sí se citan tal cual. ${dinero}`;
}

// El enfoque lo escribe el equipo para Hermes y suele llevar sus citas al pliego («Bases,
// pág. 9»): pasado literal, el redactor las copiaba en la memoria.
function lineaEnfoque(enfoque: string): string {
  const limpio = sinCitasInternas(enfoque);
  if (!limpio) return '- Instrucciones del equipo: ninguna más allá de estas decisiones.';
  return `- Instrucciones del equipo (orientan qué contar y con qué énfasis; no las copies en el texto): «${limpio}».${tieneCautelas(limpio) ? ` ${CAUTELAS_ENFOQUE}` : ''}`;
}

// Con lote, la memoria es solo suya (el pliego pide una por lote): si no, prometía lo de los dos.
function lineaLotes(dbLic: Db, id: string, d: DecisionesData, lote: string | null): string {
  const lotes = lotesDeLicitacion(dbLic, id)?.lotes ?? [];
  const nombreLote = (l: string) => {
    const n = lotes.find((x) => x.id === l)?.nombre;
    return n ? `lote ${l} (${n})` : `lote ${l}`;
  };
  if (lote !== null)
    return `- Lotes: ${nombreLote(lote)}. Esta memoria es solo de este lote: el pliego pide una por lote.`;
  return `- Lotes: ${d.lotes.length ? d.lotes.map(nombreLote).join(', ') : 'toda la licitación'}.`;
}

/** Las decisiones del equipo (lotes, equipo con su CV, herramientas, enfoque) y la frontera con los otros sobres; con lote, solo las de ese lote. */
export function lineasDecisiones(
  dbLic: Db,
  dbNucleo: DbNucleo,
  g: GuionGuardado,
  c: ContextoApartado,
  lote: string | null = null,
): string[] {
  const todas = decisionesDe(dbLic, g.licitacion_id)?.datos;
  if (!todas)
    return ['DECISIONES DE LA OFERTA: no hay decisiones guardadas; no inventes equipo, herramientas ni mejoras.'];
  const d = decisionesDelLote(todas, lote);
  return [
    'DECISIONES DE LA OFERTA (fijadas por el equipo; no las cambies):',
    lineaLotes(dbLic, g.licitacion_id, d, lote),
    lineaEquipo(dbNucleo, d, meritosEnOtroArchivo(g.datos), equipoAnonimo(g.datos)),
    ...[textoAIncorporar(todas, lote)].filter((t): t is string => t !== null).map((t) => `- ${t}`),
    `- ${textoHerramientas(d.herramientas)}`,
    lineaEnfoque(d.enfoque),
    ...lineasMismoArchivo(g, d),
    lineaFrontera(c),
  ];
}

/** Las reglas de la casa para redactar (diferenciadores, voz, prosa, audiencia y figuras): las comparte toda redacción. La voz lleva el nombre de la empresa. */
export const REGLAS_REDACCION = {
  diferenciadores:
    'Nuestros diferenciadores (úsalos cuando encajen, con hechos, no como eslóganes): soluciones a medida frente a producto cerrado; trato directo con quien hace el trabajo; autonomía del cliente al terminar (documentación, formación, nada propietario); alcance claro en positivo: qué entregamos, cuándo y cómo se mide.',
  voz: (empresa: string) =>
    `Escribe concreto y operativo: quién hace qué, en qué plazo, con qué herramienta, con qué indicador. Cada compromiso con quién lo asume y cuándo o con qué medida. Voz afirmativa, en presente o futuro de compromiso («${empresa} implanta…», «${empresa} implantará…», «la responsable revisará cada lunes…»): sin condicionales ni matices que resten («en la medida de lo posible», «si procede», «en su caso», «no incluye»); lo que no ofrecemos no se menciona. Sin autoelogio, sin «líder», sin repetir el pliego. Español de España, tratamiento de usted hacia el órgano, voz de empresa.`,
  // Para caber en el techo de extensión, una versión comprimía la sintaxis («Azure Spain Central para
  // datos; sin réplica fuera de España») y los jueces la leyeron como telegráfica.
  prosa:
    'Prosa que se lee de corrido: párrafos completos, frases con sujeto y verbo, sus artículos y conectores («por eso», «además», «para ello»); nada de frases nominales, retahílas de sustantivos separados por comas ni palabras unidas con barras («lectura/escritura»: «lectura y escritura»). Las tablas, solo para datos (fechas, cifras, roles, umbrales); el razonamiento va en párrafos. Si el texto no cabe en la extensión, quita lo secundario: no comprimas la sintaxis.',
  audiencia:
    'Audiencia: las herramientas, los ejemplos y el nivel técnico se ajustan a los destinatarios que fija el pliego (alumnado, personal de oficina, técnicos…): a quien usa ofimática, ejemplos de su trabajo diario, no herramientas de ingeniería de datos.',
  // Lo escrito vincula al ejecutar: prometer horas que el pliego no pedía cuesta dinero y no da puntos.
  compromisos: SOLO_LO_LISTADO,
  figuras:
    'Figuras: si el apartado pide pantallas, una arquitectura, un flujo o un calendario, dibújalo como figura SVG en el bloque que lo explica (como mucho 4 por apartado, 10 si el apartado pide pantallas; pocas y que digan algo que el texto no puede). La plataforma la numera («Figura N») y la mete en el Word; preséntala en el párrafo como «la figura siguiente». Reglas del SVG en la skill (sección «Figuras»).',
} as const;
