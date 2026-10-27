// Los compromisos de los criterios automáticos que se acreditan en el MISMO archivo que la memoria. Puro.
import { textoComparable } from '../temas.js';
import type { GuionBaseData } from './guion.js';
import { tramosDe } from './guionLotes.js';
import type { Hallazgo } from './hechos.js';

// La frontera depende del archivo, no del criterio: si el pliego manda identificar una mejora en el sobre de la
// memoria («las horas adicionales de formación se identificarán en el sobre 2 sin importes»), callarla cuesta
// sus puntos de fórmula; si va en otro archivo, nombrarla es fuga (fugas.ts). Aquí se sacan esos compromisos con
// su valor y se comprueba que la memoria los declara: si falta alguno, es un hallazgo que obliga a rehacer.
export type DecididoMemoria = { criterio: string; nos_acogemos: boolean; tramo?: string | null | undefined };
// cifras: lo que tiene que aparecer en la memoria («24 h», «4 mes»); vacío si el tramo no da un
// valor exacto («16 horas o más»): se pide declararlo, pero el código no puede comprobarlo.
export type CompromisoMemoria = { criterio: string; tramo: string; valor: string | null; cifras: string[] };

const mismo = (a: string, b: string) =>
  textoComparable(a).replace(/\s+/g, ' ').trim() === textoComparable(b).replace(/\s+/g, ' ').trim();

const UNIDADES: [RegExp, string][] = [
  [/^(?:h|hrs?|horas?)$/, 'h'],
  [/^(?:min|minutos?)$/, 'min'],
  [/^dias?$/, 'dia'],
  [/^semanas?$/, 'semana'],
  [/^mes(?:es)?$/, 'mes'],
  [/^anos?$/, 'ano'],
  [/^sesion(?:es)?$/, 'sesion'],
  [/^cursos?$/, 'curso'],
  [/^plazas?$/, 'plaza'],
  [/^personas?$/, 'persona'],
  [/^usuari[oa]s?$/, 'usuario'],
  [/^licencias?$/, 'licencia'],
  [/^visitas?$/, 'visita'],
  [/^informes?$/, 'informe'],
  [/^%$/, '%'],
];
const CANTIDAD = /(?<![\d.,])(\d+(?:[.,]\d+)*)\s*(%|\p{L}+)/gu;
// Un tramo con «o más», «hasta» o «entre» no dice el valor exacto que se oferta.
const COMPARATIVO = /\b(?:mas de|o mas|superior|al menos|como minimo|minimo de|hasta|entre|menos de|igual o)\b|[<>≤≥]/;
// Lo natural con valores pequeños es la letra («un año adicional», «dos sesiones»): sin esto, un
// compromiso bien declarado quedaba «sin declarar» y obligaba a rehacer.
export const EN_LETRA: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciocho: 18,
  veinte: 20,
  veinticuatro: 24,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  cien: 100,
};
const CANTIDAD_EN_LETRA = new RegExp(String.raw`(?<!\p{L})(${Object.keys(EN_LETRA).join('|')})\s+(\p{L}+)`, 'gu');

export const unidadDe = (palabra: string): string | null => UNIDADES.find(([re]) => re.test(palabra))?.[1] ?? null;

// «1.000» es mil (el punto separa miles en español) y «1,5» es uno y medio: así «1.000 horas»
// casa con un valor «1000».
export const numeroNormal = (n: string): string =>
  /^\d{1,3}(?:\.\d{3})+$/.test(n) ? n.replace(/\./g, '') : n.replace(',', '.');

/** Las cantidades con unidad de un texto, normalizadas («24 horas», «veinticuatro (24) horas» y «24 h» → «24 h»). */
export function cifrasConUnidad(texto: string): string[] {
  // «cuatro (4) meses»: la cifra entre paréntesis va antes de la unidad.
  const t = textoComparable(texto).replace(/\((\d+(?:[.,]\d+)*)\)/g, ' $1 ');
  const conCifra = [...t.matchAll(CANTIDAD)].map((m) => [numeroNormal(m[1]!), m[2]!] as const);
  const enLetra = [...t.matchAll(CANTIDAD_EN_LETRA)].map((m) => [String(EN_LETRA[m[1]!]), m[2]!] as const);
  const out = [...conCifra, ...enLetra].flatMap(([n, palabra]) => {
    const u = unidadDe(palabra);
    return u ? [`${n} ${u}`] : [];
  });
  return [...new Set(out)];
}

// Para enseñársela al redactor: «4 mes» o «1 ano» (la forma comparable) la copiaría tal cual.
const LEGIBLE: Record<string, [string, string]> = {
  h: ['hora', 'horas'],
  min: ['minuto', 'minutos'],
  dia: ['día', 'días'],
  semana: ['semana', 'semanas'],
  mes: ['mes', 'meses'],
  ano: ['año', 'años'],
  sesion: ['sesión', 'sesiones'],
  curso: ['curso', 'cursos'],
  plaza: ['plaza', 'plazas'],
  persona: ['persona', 'personas'],
  usuario: ['usuario', 'usuarios'],
  licencia: ['licencia', 'licencias'],
  visita: ['visita', 'visitas'],
  informe: ['informe', 'informes'],
};

/** «24 h» → «24 horas», «1 ano» → «1 año»: la cifra comparable, escrita para leerla. */
function cifraLegible(cifra: string): string {
  const [n, u] = cifra.split(' ') as [string, string];
  const formas = LEGIBLE[u];
  return formas ? `${n} ${Number(n) === 1 ? formas[0] : formas[1]}` : `${n} ${u}`;
}

// «24» a secas: la unidad sale del tramo o del criterio («horas adicionales de formación»).
function unidadSuelta(texto: string): string | null {
  for (const p of textoComparable(texto).split(/[^\p{L}%]+/u)) {
    const u = p ? unidadDe(p) : null;
    if (u) return u;
  }
  return null;
}

function cifrasDelCompromiso(valor: string | null, tramo: string, criterio: string): string[] {
  if (valor) {
    const propias = cifrasConUnidad(valor);
    if (propias.length) return propias;
    const n = /^\s*(\d+(?:[.,]\d+)*)\s*$/.exec(valor)?.[1];
    const u = n ? unidadSuelta(`${tramo} ${criterio}`) : null;
    if (n && u) return [`${numeroNormal(n)} ${u}`];
  }
  return COMPARATIVO.test(textoComparable(tramo)) ? [] : cifrasConUnidad(tramo);
}

type GuionCompromisos = Pick<GuionBaseData, 'automaticos' | 'memoria'>;

/** Los criterios automáticos a los que se acoge la empresa y que se acreditan en el archivo de la memoria, con su valor. */
export function compromisosDeLaMemoria(g: GuionCompromisos, decididos: DecididoMemoria[]): CompromisoMemoria[] {
  const mem = g.memoria;
  if (!mem) return [];
  const vistos = new Set<string>();
  return g.automaticos
    .filter((a) => mismo(a.archivo, mem.archivo))
    .flatMap((a) => {
      const d = decididos.find((x) => x.nos_acogemos && mismo(x.criterio, a.criterio));
      if (!d || vistos.has(textoComparable(a.criterio))) return [];
      vistos.add(textoComparable(a.criterio));
      const tramos = tramosDe(a);
      const t =
        (d.tramo ? tramos.find((x) => mismo(x.descripcion, d.tramo!)) : undefined) ??
        (tramos.length === 1 ? tramos[0] : undefined);
      const tramo = t?.descripcion ?? d.tramo ?? a.criterio;
      const valor = t?.valor ?? null;
      return [{ criterio: a.criterio, tramo, valor, cifras: cifrasDelCompromiso(valor, tramo, a.criterio) }];
    });
}

/** «tramo «X», valor «24»»: lo que el dossier y los avisos dicen del compromiso. */
export const valorDeCompromiso = (c: CompromisoMemoria): string =>
  `tramo «${c.tramo}»${c.valor ? `, valor «${c.valor}»` : ''}`;

// Las raíces de las palabras con contenido: para llevar el hallazgo al apartado que trata del
// criterio (la formación, el soporte), no siempre al primero.
export const raices = (t: string) =>
  new Set([...textoComparable(t).matchAll(/\p{L}{5,}/gu)].map((m) => m[0].slice(0, 6)));

function apartadoDelCompromiso(g: GuionCompromisos, c: CompromisoMemoria): number {
  const buscadas = raices(`${c.criterio} ${c.tramo}`);
  const puntos = (g.memoria?.apartados ?? []).map(
    (a) => [...raices([a.titulo, ...a.se_valorara].join(' '))].filter((r) => buscadas.has(r)).length,
  );
  const mejor = Math.max(0, ...puntos);
  return mejor > 0 ? puntos.indexOf(mejor) + 1 : Math.max(1, puntos.length);
}

/** Los compromisos cuyo valor no aparece en la memoria (textos[i] es el apartado i+1); sin texto aún, ninguno. */
export function compromisosSinDeclarar(textos: string[], g: GuionCompromisos, cs: CompromisoMemoria[]): Hallazgo[] {
  if (!textos.some((t) => t.trim())) return [];
  const dichas = new Set(cifrasConUnidad(textos.join('\n')));
  return cs
    .filter((c) => c.cifras.length && !c.cifras.every((x) => dichas.has(x)))
    .map((c) => ({
      apartado: apartadoDelCompromiso(g, c),
      hecho: c.criterio,
      cita: '',
      encontrado: 'sin declarar',
      esperado: c.cifras.map(cifraLegible).join(', '),
      tipo: 'compromiso' as const,
    }));
}
