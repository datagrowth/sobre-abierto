// Dimensiones con que se calcula lo que cuesta un compromiso (alumnas, horas, semanas, grupos), con su fuente.
import type { PerfilCostesData } from '../../../nucleo/perfilCostes.js';
import type { Pasaje } from '../pasajes.js';
import { textoComparable } from '../temas.js';
import { cifrasDeCoste, normal } from './costesCatalogo.js';
import type { LineaCostes } from './costesTexto.js';
import type { GuionBaseData, UnidadAlcanceData } from './guion.js';

// El orden de fuentes es el alcance del guion (literal del pliego), luego el propio pliego, luego la memoria
// («subgrupos de 10 a 12», la columna «Semanas lectivas», «150 alumnas» si no hay otra fuente) y por último el
// perfil de costes o un supuesto declarado: el supuesto de cada fila dice siempre de dónde sale cada cifra.
type Valor = { valor: number; fuente: string };
export type UnidadCoste = {
  nombre: string;
  claves: string[];
  personas: Valor | null;
  horas: Valor | null;
  grupos: Valor;
  semanas: Valor;
};
// persona/personas: cómo llama la memoria a quien recibe el servicio («alumna», «alumnas»).
export type Dimensiones = { unidades: UnidadCoste[]; subgrupo: Valor; persona: string; personas: string };

// Sin semanas en ningún sitio: las horas del curso a este ritmo, o un curso tipo.
const HORAS_LECTIVAS_SEMANA = 8;
const SEMANAS_POR_DEFECTO = 6;
// Palabras del nombre de un curso que no lo distinguen de otro.
const GENERICAS = new Set([
  'curso',
  'cursos',
  'formacion',
  'servicio',
  'accion',
  'formativa',
  'modulo',
  'taller',
  'programa',
]);

const raiz = (w: string) => w.slice(0, 6);
const palabras = (t: string): string[] =>
  [...textoComparable(t).matchAll(/\p{L}{5,}/gu)].map((m) => m[0]).filter((w) => !GENERICAS.has(w));

/** «Pliego_PPT.pdf», pág. 13 → «PPT pág. 13». */
export function fuenteDoc(documento: string, pagina: number | null | undefined): string {
  const d = /\bp?cap\b|pcap|_cap\b/i.test(documento)
    ? 'PCAP'
    : /ppt|prescripciones/i.test(documento)
      ? 'PPT'
      : documento.replace(/\.[a-z0-9]{2,4}$/i, '');
  return pagina ? `${d} pág. ${pagina}` : d;
}

// Las raíces que solo tiene este curso: «topog» en topografía, no «digita», que comparten dos.
function conClaves(us: Omit<UnidadCoste, 'claves'>[]): UnidadCoste[] {
  const de = us.map((u) => new Set(palabras(u.nombre).map(raiz)));
  return us.map((u, i) => ({ ...u, claves: [...de[i]!].filter((r) => de.every((o, j) => j === i || !o.has(r))) }));
}

/** Los cursos que nombra un texto, con la palabra con que lo hace; vacío si no nombra ninguno. */
export function unidadesNombradas(texto: string, us: UnidadCoste[]): { unidad: UnidadCoste; palabra: string }[] {
  const ws = palabras(texto);
  return us.flatMap((unidad) => {
    const palabra = ws.find((w) => unidad.claves.includes(raiz(w)));
    return palabra ? [{ unidad, palabra }] : [];
  });
}

const deAlcance = (v: number | null, fuente: string): Valor | null => (v === null ? null : { valor: v, fuente });

function unidadDelAlcance(a: UnidadAlcanceData): Omit<UnidadCoste, 'claves'> {
  const f = fuenteDoc(a.documento ?? 'Pliego', a.pagina);
  const horas = deAlcance(a.horas, f);
  const semanas = deAlcance(a.semanas, f) ?? semanasSupuestas(horas);
  return {
    nombre: a.nombre,
    personas: deAlcance(a.personas_minimas, f),
    horas,
    grupos: deAlcance(a.grupos, f) ?? { valor: 1, fuente: 'supuesto: 1 grupo' },
    semanas,
  };
}

function semanasSupuestas(horas: Valor | null): Valor {
  if (!horas) return { valor: SEMANAS_POR_DEFECTO, fuente: `supuesto: ${SEMANAS_POR_DEFECTO} semanas` };
  return {
    valor: Math.max(1, Math.ceil(horas.valor / HORAS_LECTIVAS_SEMANA)),
    fuente: `supuesto: ${HORAS_LECTIVAS_SEMANA} h lectivas por semana`,
  };
}

// Las filas del alcance de los lotes de la empresa (todas si el guion no dice lotes o la fila no los dice).
function alcancePropio(g: GuionBaseData | undefined): UnidadAlcanceData[] {
  const propios = new Set(g?.lotes ?? []);
  return (g?.alcance ?? []).filter((a) => !propios.size || !a.lotes?.length || a.lotes.some((l) => propios.has(l)));
}

const ALUMNAS = /(\d+(?:\.\d{3})*)\s+alumn/g;

// Sin alcance: el pasaje del pliego que más veces dice «N alumnas» (el cuadro de cursos) da el total.
function unidadDelPliego(pasajes: Pasaje[]): Omit<UnidadCoste, 'claves'> | null {
  const cuentas = pasajes.map((p) =>
    [...textoComparable(p.texto).matchAll(ALUMNAS)].map((m) => Number(m[1]!.replace(/\./g, ''))),
  );
  const mejor = cuentas.reduce((b, c, i) => (c.length > (cuentas[b]?.length ?? 0) ? i : b), -1);
  if (mejor < 0 || cuentas[mejor]!.length < 2) return null;
  const p = pasajes[mejor]!;
  const personas = {
    valor: cuentas[mejor]!.reduce((a, b) => a + b, 0),
    fuente: fuenteDoc(p.clase.length <= 5 ? p.clase.toUpperCase() : p.ruta, p.pagina),
  };
  return {
    nombre: 'Todo el contrato',
    personas,
    horas: null,
    grupos: { valor: 1, fuente: 'supuesto: 1 grupo' },
    semanas: semanasSupuestas(null),
  };
}

// Sin alcance ni pliego (el crítico solo tiene el texto de la memoria): la cifra de alumnas más
// alta que dice la propia memoria («atiende a 150 alumnas»); los subgrupos dicen cifras menores.
function unidadDeLaMemoria(lineas: LineaCostes[]): Omit<UnidadCoste, 'claves'> | null {
  const cifras = lineas.flatMap((l) =>
    [...textoComparable(l.texto).matchAll(ALUMNAS)].map((m) => Number(m[1]!.replace(/\./g, ''))),
  );
  const max = Math.max(0, ...cifras);
  if (!max) return null;
  return {
    nombre: 'Todo el contrato',
    personas: { valor: max, fuente: 'memoria' },
    horas: null,
    grupos: { valor: 1, fuente: 'supuesto: 1 grupo' },
    semanas: semanasSupuestas(null),
  };
}

const SIN_UNIDADES: Omit<UnidadCoste, 'claves'> = {
  nombre: 'Todo el contrato',
  personas: null,
  horas: null,
  grupos: { valor: 1, fuente: 'supuesto: 1 grupo' },
  semanas: semanasSupuestas(null),
};

// Una fila de la tabla de cursos de la memoria con su columna de semanas: «| Limpieza | 30 h | 5 por grupo (dos grupos) |».
function semanasDeFila(
  l: LineaCostes,
  us: UnidadCoste[],
): { unidad: UnidadCoste; semanas: number | null; grupos: number | null } | null {
  const col = (l.cabecera ?? []).findIndex((c) => /\bsemanas?\b/.test(textoComparable(c)));
  const nombradas = col >= 0 && l.celdas ? unidadesNombradas(l.celdas[0] ?? '', us) : [];
  if (nombradas.length !== 1) return null;
  const semanas = /\d+/.exec(l.celdas![col] ?? '')?.[0];
  const grupos = cifrasDeCoste(l.celdas!.join(' ')).find((c) => c.unidad === 'grupo')?.valor ?? null;
  return { unidad: nombradas[0]!.unidad, semanas: semanas ? Number(semanas) : null, grupos };
}

// La memoria precisa las semanas y los grupos que el alcance no da (o da con otro reparto).
function conLaMemoria(us: UnidadCoste[], lineas: LineaCostes[]): UnidadCoste[] {
  const filas = lineas
    .filter((l) => l.celdas)
    .map((l) => semanasDeFila(l, us))
    .filter((x) => x !== null);
  return us.map((u) => {
    const f = filas.find((x) => x.unidad === u);
    if (!f) return u;
    const semanas =
      f.semanas && u.semanas.fuente.startsWith('supuesto') ? { valor: f.semanas, fuente: 'memoria' } : u.semanas;
    const grupos = f.grupos && f.grupos > u.grupos.valor ? { valor: f.grupos, fuente: 'memoria' } : u.grupos;
    return { ...u, semanas, grupos };
  });
}

const SUBGRUPOS = /\bsubgrupos? de (\d+)(?: a (\d+))?/;

function subgrupoDe(lineas: LineaCostes[], perfil: PerfilCostesData): Valor {
  for (const l of lineas) {
    const m = SUBGRUPOS.exec(normal(l.texto));
    if (m) return { valor: m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]), fuente: 'memoria' };
  }
  return { valor: perfil.tamano_subgrupo, fuente: 'perfil de costes' };
}

function comoLlama(lineas: LineaCostes[]): { persona: string; personas: string } {
  const t = textoComparable(lineas.map((l) => l.texto).join(' '));
  if (/\balumnas?\b/.test(t)) return { persona: 'alumna', personas: 'alumnas' };
  if (/\balumnos?\b/.test(t)) return { persona: 'alumno', personas: 'alumnos' };
  return /\busuari[oa]s\b/.test(t)
    ? { persona: 'persona usuaria', personas: 'personas usuarias' }
    : { persona: 'persona', personas: 'personas' };
}

/** Las dimensiones del contrato para calcular costes: alcance, pliego, memoria y perfil, por ese orden. */
export function dimensiones(
  lineas: LineaCostes[],
  perfil: PerfilCostesData,
  guion?: GuionBaseData,
  pliego: Pasaje[] = [],
): Dimensiones {
  const alcance = alcancePropio(guion).map(unidadDelAlcance);
  const base = alcance.length ? alcance : [unidadDelPliego(pliego) ?? unidadDeLaMemoria(lineas) ?? SIN_UNIDADES];
  const unidades = conLaMemoria(conClaves(base), lineas);
  return { unidades, subgrupo: subgrupoDe(lineas, perfil), ...comoLlama(lineas) };
}

/** Subgrupos de un curso: sus personas entre el tamaño del subgrupo, al alza. */
export const subgruposDe = (u: UnidadCoste, d: Dimensiones): number =>
  Math.ceil((u.personas?.valor ?? 0) / Math.max(1, d.subgrupo.valor));
