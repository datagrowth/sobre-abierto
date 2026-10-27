// La evaluación de una memoria con la vara del guion: un criterio por apartado, con su título y sus puntos.
import { textoComparable } from '../temas.js';
import type { Db } from '../store.js';
import type { GuionBaseData } from './guion.js';
import { puntosTexto } from './guionRevision.js';
import { ApartadoDatos, textoDeBloque } from './memoriaRevision.js';

// Cada criterio lleva su título literal, sus puntos y el tramo de la escala del pliego que le daría la mesa; los
// párrafos genéricos se localizan en el apartado donde están (la mejora los corrige ahí).
type ApartadoGuion = NonNullable<GuionBaseData['memoria']>['apartados'][number];
export type CriterioDeApartado = {
  criterio: string;
  peso: number;
  tipo: string;
  puntuacion: number;
  apartado?: number | undefined;
  tramo?: number | undefined;
};

// Tolerancia de las sumas y comparaciones de puntos (los pliegos usan medios puntos).
const EPSILON = 0.01;
// Un trozo de cita más corto que esto aparece en cualquier parte: no localiza nada.
const MIN_FRAGMENTO = 15;

// Las cifras con separador de miles («1.300.000», «72 000») van juntas: con el separador como espacio,
// «300.000 euros» casaría dentro de «1.300.000 euros» aunque se compare palabra a palabra.
const juntarMiles = (t: string) => t.replace(/(\d)[.\u00a0\u202f ](?=\d{3}(?!\d))/g, '$1');
const normal = (t: string) =>
  textoComparable(juntarMiles(t))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const sinNumero = (t: string) => t.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '');
const igual = (a: number, b: number) => Math.abs(a - b) < EPSILON;

function listaPuntos(ns: number[]): string {
  const t = ns.map(puntosTexto);
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} o ${t.at(-1)}` : t.join('');
}

/** Puntos del tramo más alto de un apartado (sin escala, sus puntos). */
export function tramoMaximo(a: ApartadoGuion): number {
  return a.escala.length ? Math.max(...a.escala.map((t) => t.puntos)) : a.puntos;
}

function problemaDeTramo(c: CriterioDeApartado, a: ApartadoGuion, n: number): string | null {
  const tramos = a.escala.map((t) => t.puntos);
  if (!tramos.length) return null;
  if (c.tramo === undefined)
    return `Falta «tramo» en el apartado ${n}: los puntos del tramo de su escala que le daría la mesa (${listaPuntos(tramos)}).`;
  if (!tramos.some((t) => igual(t, c.tramo!)))
    return `El tramo ${puntosTexto(c.tramo)} no está en la escala del apartado ${n} (${listaPuntos(tramos)}).`;
  if (c.puntuacion > c.tramo + EPSILON)
    return `En el apartado ${n}, la puntuación (${puntosTexto(c.puntuacion)}) pasa de su tramo (${puntosTexto(c.tramo)}): puntúa como la mesa, con los puntos del tramo.`;
  return null;
}

function problemasDeCriterio(c: CriterioDeApartado, a: ApartadoGuion, n: number): string[] {
  const casa =
    normal(sinNumero(c.criterio)) === normal(a.titulo) && igual(c.peso, a.puntos) && c.tipo === 'juicio_valor';
  const forma = casa
    ? null
    : `El criterio del apartado ${n} es «${a.titulo}», de ${puntosTexto(a.puntos)} puntos y de juicio de valor: usa ese título literal como «criterio», esos puntos como «peso» y tipo juicio_valor.`;
  return [forma, problemaDeTramo(c, a, n)].filter((p): p is string => p !== null);
}

/** Lo que no casa con los apartados del guion (vacío si la evaluación los puntúa todos bien). */
export function problemasContraGuion(
  criterios: CriterioDeApartado[],
  apartados: ApartadoGuion[],
  versionGuion: number,
): string[] {
  const n = apartados.length;
  const numeros = criterios.map((c) => c.apartado);
  const validos = new Set(numeros.filter((a): a is number => a !== undefined && a <= n));
  if (criterios.length !== n || validos.size !== n) {
    const total = puntosTexto(apartados.reduce((s, a) => s + a.puntos, 0));
    return [
      `Puntúa los ${n} apartados de la memoria del guion (v${versionGuion}), un criterio por apartado con «apartado» (de 1 a ${n}), su título literal como «criterio», sus puntos como «peso» y tipo juicio_valor: puntuacion_maxima = ${total}. Solo esos: los criterios automáticos y el precio no van en la memoria.`,
    ];
  }
  return criterios.flatMap((c) => problemasDeCriterio(c, apartados[c.apartado! - 1]!, c.apartado!));
}

// Hermes recorta las citas largas con «…» (y puede cortar la última a media palabra): cada trozo
// debe estar tal cual, de palabra entera a palabra entera («olumen» no vale dentro de «volumen»)
// salvo por el lado que corta, y nunca a media cifra («300.000» no vale dentro de «1.300.000»).
type Fragmento = { texto: string; abreCortado: boolean; cierraCortado: boolean };
function fragmentos(cita: string): Fragmento[] {
  const trozos = cita.split(/…|\.\.\./).map(normal);
  const cortable = (c: string | undefined) => c !== undefined && !/\d/.test(c);
  return trozos
    .map((texto, k) => ({ texto, abreCortado: k > 0 && cortable(texto[0]), cierraCortado: cortable(texto.at(-1)) }))
    .filter((f) => f.texto.length >= MIN_FRAGMENTO);
}

// La primera aparición del trozo desde «desde» con sus bordes en límite de palabra (salvo los cortados).
function posicion(texto: string, f: Fragmento, desde: number): number {
  for (let i = texto.indexOf(f.texto, desde); i >= 0; i = texto.indexOf(f.texto, i + 1)) {
    const abre = f.abreCortado || texto[i - 1] === ' ';
    const cierra = f.cierraCortado || texto[i + f.texto.length] === ' ';
    if (abre && cierra) return i;
  }
  return -1;
}

// Todos los trozos, en el orden de la cita.
function contiene(texto: string, partes: Fragmento[]): boolean {
  let desde = 0;
  for (const p of partes) {
    const i = posicion(texto, p, desde);
    if (i < 0) return false;
    desde = i + p.texto.length;
  }
  return true;
}

/** Para cada cita, el apartado (1-based) cuyo texto la contiene literalmente, o null. */
export function localizarCitas(textos: string[], citas: string[]): (number | null)[] {
  const normales = textos.map((t) => ` ${normal(t)} `);
  return citas.map((cita) => {
    const partes = fragmentos(cita);
    if (!partes.length) return null;
    const i = normales.findIndex((t) => contiene(t, partes));
    return i < 0 ? null : i + 1;
  });
}

/** El texto de cada apartado redactado de una memoria (título y bloques), por orden; '' si no lo hay. */
export function textosDeApartados(db: Db, memoriaId: number): string[] {
  const filas = db
    .prepare('SELECT apartado, datos FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(memoriaId) as { apartado: number; datos: string | null }[];
  const textos: string[] = [];
  for (const f of filas) textos[f.apartado - 1] = textoDeDatos(f.datos);
  return Array.from(textos, (t) => t ?? '');
}

/** El texto de un apartado (título y bloques) desde sus datos guardados; '' si no los hay. */
export function textoDeDatos(datos: string | null): string {
  const d = datos ? ApartadoDatos.safeParse(JSON.parse(datos)) : null;
  return d?.success ? [d.data.titulo, ...d.data.bloques.map(textoDeBloque)].join('\n') : '';
}

/** ¿La referencia de una sugerencia apunta a este apartado («2.», «2.1 …», «apartado 2» o su título)? */
export function esDelApartado(referencia: string, n: number, titulo: string): boolean {
  const r = ` ${normal(referencia)} `;
  return (
    new RegExp(`^ (?:apartado )?${n} `).test(r) || r.includes(` apartado ${n} `) || r.includes(` ${normal(titulo)} `)
  );
}
