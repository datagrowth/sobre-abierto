// Lo que promete la memoria frente a lo que sostienen las decisiones, el pliego y los anexos. Puro.
import { textoComparable } from '../temas.js';
import type { DecisionesData } from './decisiones.js';
import { detectarFugas, frases } from './fugas.js';
import type { GuionBaseData } from './guion.js';
import { marcasVigilables } from './guionRevision.js';
import { nombresDelEquipoEn, valoresDe } from './hechos.js';

// Una memoria puede prometer «alertas» o un asistente «disponible de forma continuada» que Hermes dijo no
// prometer, o abrir cursos más tarde de lo que exige el pliego desde la formalización. Son sospechas (riesgo,
// nunca impide): la persona acepta el riesgo o pide otra ronda.
type CompromisoMemoria = { apartado: number; que: string; quien: string; cuando_o_medida: string };
export type TipoChoque = 'persona_fuera' | 'plazo_guion' | 'automatico_no_acogido' | 'no_prometer' | 'anexo_distinto';
export type Choque = { apartado: number; cita: string; tipo: TipoChoque; esperado: string; encontrado: string };
// Un plazo literal del pliego (los hitos de la ficha), con dónde lo dice.
type PlazoPliego = { texto: string; pagina: number | null };
export type DatoAnexo = { clave: string; dato: string; valor: string };

export type EntradaCompromisos = {
  compromisos: CompromisoMemoria[];
  // textos[i] es el apartado i+1.
  textos: string[];
  decisiones: (Pick<DecisionesData, 'automaticos'> & { lotes?: string[] }) | null;
  // Todas las personas conocidas y las del equipo de las decisiones.
  personas: string[];
  nombresEquipo: string[];
  guion: Pick<GuionBaseData, 'automaticos' | 'memoria'>;
  plazos: PlazoPliego[];
  // Lo que Hermes dijo no prometer, ya separado («alertas», «chatbot 24/7»).
  noPrometer: string[];
  anexos: DatoAnexo[];
};

type Frase = { apartado: number; frase: string };

const CITA_MAX = 240;
const citaDe = (f: string): string => (f.length > CITA_MAX ? `${f.slice(0, CITA_MAX - 1).trim()}…` : f);
// La firma («Fdo.: …») nombra a quien firma, que no tiene por qué estar en el equipo.
const FIRMA = /^\s*(?:fdo\b|firmado\b)/i;

function frasesDe(e: EntradaCompromisos): Frase[] {
  const deTextos = e.textos.flatMap((t, i) =>
    frases(t).map((f) => ({ apartado: i + 1, frase: f.replace(/^#+\s*/, '') })),
  );
  const deCompromisos = e.compromisos.map((c) => ({ apartado: c.apartado, frase: `${c.que}: ${c.cuando_o_medida}.` }));
  return [...deTextos, ...deCompromisos].filter((f) => !FIRMA.test(f.frase));
}

// ── Términos («alojamiento en la UE», «chatbot 24/7») ──

const VACIAS = new Set(
  'de del la las el los en un una unos unas y o ni a al por con para sin su sus que lo ya no se'.split(' '),
);
// Cómo se dice lo mismo en una memoria: «disponible de forma continuada» es un 24/7.
const SINONIMOS: Record<string, string[]> = {
  '24/7': ['24/7', '24 horas', 'continuad*', 'continuament*', 'permanent*', 'cualquier hora', 'todos los dias'],
  chatbot: ['chatbot*', 'asistente virtual', 'asistente de ia', 'asistente conversacional', 'asistente inteligente'],
  ue: ['ue', 'union europea'],
};

const normal = (t: string): string =>
  ` ${textoComparable(t)
    .replace(/24\s*(?:\/|x)\s*7/g, '24/7')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()} `;

// Una forma con «*» casa por el principio de una palabra («continuad*»); sin ella, entera.
const casaForma = (n: string, forma: string): boolean =>
  forma.endsWith('*') ? n.includes(` ${forma.slice(0, -1)}`) : n.includes(` ${forma} `);

function formasDe(termino: string): string[] {
  return SINONIMOS[termino] ?? [termino.length >= 6 ? `${termino.slice(0, 5)}*` : termino];
}

function terminosDe(texto: string): string[] {
  return [...normal(texto).matchAll(/24\/7|[\p{L}\p{N}]+/gu)].map((m) => m[0]).filter((t) => !VACIAS.has(t));
}

const casanTodos = (terminos: string[], frase: string): boolean => {
  const n = normal(frase);
  return terminos.length > 0 && terminos.every((t) => formasDe(t).some((f) => casaForma(n, f)));
};

/** Lo que Hermes dijo no prometer: las frases que empiezan por «No prometer», separadas. */
export function noPrometerDe(textos: string[]): string[] {
  const frasesNo = textos.flatMap((t) => frases(t)).filter((f) => /^no prometer\b/i.test(f));
  const items = frasesNo.flatMap((f) =>
    f
      .replace(/^no prometer\s*/i, '')
      .replace(/[.;:]+$/, '')
      .split(/,\s*|\s+ni\s+|\s+y\s+/),
  );
  return [...new Set(items.map((x) => x.trim()).filter((x) => terminosDe(x).length > 0))];
}

// ── Detectores ──

function personasFuera(fs: Frase[], e: EntradaCompromisos): Choque[] {
  const equipo = new Set(e.nombresEquipo.map((n) => normal(n)));
  const ajenas = e.personas.filter((p) => !equipo.has(normal(p)));
  if (!ajenas.length) return [];
  return fs.flatMap(({ apartado, frase }) =>
    nombresDelEquipoEn(frase, ajenas).map((p) => ({
      apartado,
      cita: citaDe(frase),
      tipo: 'persona_fuera' as const,
      esperado: 'una persona del equipo de las decisiones',
      encontrado: p,
    })),
  );
}

const DIAS_POR_UNIDAD: Record<string, number> = { dia: 1, semana: 7, mes: 30 };
const aDias = (v: string): number | null => {
  const [n, u] = v.split(' ');
  const factor = DIAS_POR_UNIDAD[u ?? ''];
  return factor ? Number(n) * factor : null;
};

const HABLA_DE_INICIO = /inici|comienz|comenz|empez|empiez|arranq|puesta en marcha|apertura|abrir/;
const DESDE_EL_CONTRATO = /formaliz|firma del contrato|adjudicaci|notificaci/;

type Limite = { dias: number; texto: string };

// El plazo más corto del pliego para empezar a prestar el servicio («en máximo 15 días desde la formalización»).
function limiteDeInicio(plazos: PlazoPliego[]): Limite | null {
  // Por cláusulas: «…desde formalización; prórrogas hasta 36 meses» no es un plazo de inicio de 36 meses.
  const limites = plazos.flatMap((p) =>
    p.texto.split(/;\s*/).flatMap((clausula) => {
      const c = textoComparable(clausula);
      if (!HABLA_DE_INICIO.test(c) || !DESDE_EL_CONTRATO.test(c)) return [];
      const dias = valoresDe('plazo', clausula)
        .map(aDias)
        .filter((d): d is number => d !== null);
      const literal = clausula.trim().replace(/[.;:,]+$/, '');
      const texto = p.pagina === null ? literal : `${literal} (pliego, pág. ${p.pagina})`;
      return dias.length ? [{ dias: Math.min(...dias), texto }] : [];
    }),
  );
  return limites.sort((a, b) => a.dias - b.dias)[0] ?? null;
}

const SEMANA = /\bsemanas?\s+(?:lectivas?\s+)?(\d{1,2})\b/g;
// «semanas lectivas 1 a 5; transformación digital, 6 a 10»: en una frase de semanas, cada tramo
// empieza una. Nunca un horario («de 9 a 14», «9 a 14 h»).
const TRAMO = /(?<![\d:.,])(?<!\bde\s)(\d{1,2})\s*(?:a|-|–)\s*(\d{1,2})\b(?!\s*(?:h\b|horas?\b|:|[.,]\d))/g;
// Las semanas que cuentan desde el cierre de un curso no son el calendario de inicio.
const TRAS_EL_CIERRE = /cierre|finaliz|termin/;

function semanasDe(c: string): number[] {
  if (!/\bsemanas?\b/.test(c)) return [];
  const tramos = [...c.matchAll(TRAMO)].filter((m) => Number(m[2]) > Number(m[1])).map((m) => Number(m[1]));
  return [...[...c.matchAll(SEMANA)].map((m) => Number(m[1])), ...tramos];
}

// Lo que la frase pone más tarde que el límite: «semana 6» empieza el día 35.
function inicioTardio(frase: string, limite: Limite): string | null {
  const c = textoComparable(frase);
  if (TRAS_EL_CIERRE.test(c)) return null;
  const semana = semanasDe(c).find((n) => (n - 1) * 7 > limite.dias);
  if (semana !== undefined) return `semana ${semana}`;
  if (!HABLA_DE_INICIO.test(c) || !DESDE_EL_CONTRATO.test(c)) return null;
  return valoresDe('plazo', frase).find((v) => (aDias(v) ?? 0) > limite.dias) ?? null;
}

function plazosDelPliego(fs: Frase[], e: EntradaCompromisos): Choque[] {
  const limite = limiteDeInicio(e.plazos);
  if (!limite) return [];
  return fs.flatMap(({ apartado, frase }) => {
    const encontrado = inicioTardio(frase, limite);
    return encontrado
      ? [{ apartado, cita: citaDe(frase), tipo: 'plazo_guion' as const, esperado: limite.texto, encontrado }]
      : [];
  });
}

const mismo = (a: string, b: string): boolean => normal(a) === normal(b);

// La memoria es común a los lotes: un criterio solo queda fuera si la empresa no se acoge en ninguno de
// los lotes del ámbito (vacío = todos). Si en uno sí, la memoria puede hablar de él.
function criteriosNoAcogidos(d: EntradaCompromisos['decisiones']): { criterio: string }[] {
  const ambito = d?.lotes ?? [];
  const enAmbito = (d?.automaticos ?? []).filter((x) => !x.lote || !ambito.length || ambito.includes(x.lote));
  const acogidos = enAmbito.filter((x) => x.nos_acogemos);
  return enAmbito.filter((x) => !x.nos_acogemos && !acogidos.some((a) => mismo(a.criterio, x.criterio)));
}

// Las marcas de los automáticos a los que la empresa no se acoge (como las fugas, contextoFugasDe), vayan
// o no en el mismo archivo que la memoria: si la empresa no se acoge, la memoria no puede prometerlo.
function noAcogidos(fs: Frase[], e: EntradaCompromisos): Choque[] {
  const mem = e.guion.memoria;
  const fuera = criteriosNoAcogidos(e.decisiones);
  if (!mem || !fuera.length) return [];
  const automaticos = e.guion.automaticos
    .filter((a) => fuera.some((d) => mismo(d.criterio, a.criterio)))
    .map((a) => ({ criterio: a.criterio, archivo: a.archivo, marcas: marcasVigilables(a.marcas, mem.apartados) }));
  return fs.flatMap(({ apartado, frase }) =>
    detectarFugas(frase, { automaticos })
      .filter((f) => f.tipo === 'marca')
      .map((f) => ({
        apartado,
        cita: citaDe(frase),
        tipo: 'automatico_no_acogido' as const,
        esperado: `no nos acogemos a «${f.criterio}»`,
        encontrado: f.marca,
      })),
  );
}

function loQueNoSePromete(fs: Frase[], e: EntradaCompromisos): Choque[] {
  return e.noPrometer.flatMap((item) => {
    const terminos = terminosDe(item);
    const vistos = new Set<number>();
    return fs
      .filter((f) => !vistos.has(f.apartado) && casanTodos(terminos, f.frase) && vistos.add(f.apartado))
      .map(({ apartado, frase }) => ({
        apartado,
        cita: citaDe(frase),
        tipo: 'no_prometer' as const,
        esperado: `Hermes dijo no prometer ${item}`,
        encontrado: item,
      }));
  });
}

// El mismo dato (por sus palabras) con un horario o un plazo que no comparte nada con el del anexo.
function choqueConAnexo(f: Frase, a: DatoAnexo): Choque | null {
  for (const tipo of ['horario', 'plazo'] as const) {
    const esperados = valoresDe(tipo, a.valor);
    const encontrados = esperados.length ? valoresDe(tipo, f.frase) : [];
    if (encontrados.length && !encontrados.some((v) => esperados.includes(v))) {
      return {
        apartado: f.apartado,
        cita: citaDe(f.frase),
        tipo: 'anexo_distinto',
        esperado: `${a.valor} (${a.dato}, ${a.clave})`,
        encontrado: encontrados.join(', '),
      };
    }
  }
  return null;
}

function anexosDistintos(fs: Frase[], e: EntradaCompromisos): Choque[] {
  return e.anexos.flatMap((a) => {
    const terminos = terminosDe(a.dato);
    return fs
      .filter((f) => casanTodos(terminos, f.frase))
      .map((f) => choqueConAnexo(f, a))
      .filter((c): c is Choque => c !== null);
  });
}

const DETECTORES: readonly ((fs: Frase[], e: EntradaCompromisos) => Choque[])[] = [
  personasFuera,
  plazosDelPliego,
  noAcogidos,
  loQueNoSePromete,
  anexosDistintos,
];

/** Lo que la memoria promete y no casa con el equipo, el pliego, los automáticos, lo que Hermes dijo no prometer o los anexos. */
export function coherenciaCompromisos(e: EntradaCompromisos): Choque[] {
  const fs = frasesDe(e);
  if (!fs.length) return [];
  const vistos = new Set<string>();
  return DETECTORES.flatMap((d) => d(fs, e)).filter((c) => {
    const k = `${c.apartado}|${c.tipo}|${c.encontrado}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
