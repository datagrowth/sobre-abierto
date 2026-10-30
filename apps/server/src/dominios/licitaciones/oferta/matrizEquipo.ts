// Matriz rol exigido × persona, para que una ficha no diga «Cumple» si nadie acredita una materia.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { buscarCvs, type BuscadorCvs } from '../../../nucleo/colaboradores/busqueda.js';
import { evidenciaDeMateria, materiasExigidas, type Materia } from '../../../nucleo/colaboradores/materias.js';
import { listarPersonas, type PersonaGuardada } from '../../../nucleo/colaboradores/personas.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { fichasDe, type FichaDatosData } from '../ficha.js';
import { idsDelAmbito, lotesDeLicitacion } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import {
  enElRol,
  incorporaElRol,
  materiaLiteral,
  materiaSinComprobar,
  porRol,
  rolLiteral,
  rolesNombrados,
  type RolNombrado,
} from './coherencia.js';
import { decisionesDe, type DecisionesData } from './decisiones.js';

// Cada rol que pide el pliego (con su lote y sus materias) es una fila, y cada persona asignada en Decisiones
// lleva, por materia, ✓ / ✗ / no comprobado y de dónde sale. Lo «dudoso» nunca pasa a «sí»: un CV que parece
// mencionarla solo la deja en «no comprobado», con su página. Puro: lo que lee de la base y de la Biblioteca va
// en matrizDeLicitacion, al final.
type RequisitoFicha = FichaDatosData['requisitos'][number];
type CvMencion = { persona_id: number; materia: string; ruta: string; pagina: number | null };
export type EntradaMatriz = {
  requisitos: FichaDatosData['requisitos'];
  decisiones: DecisionesData | null;
  personas: PersonaGuardada[];
  cvs?: CvMencion[];
  // Los lotes a los que se va (el ámbito); sin ellos, los de las decisiones. Vacío: todos.
  lotes?: string[];
};
type EstadoCelda = 'si' | 'no' | 'no_comprobado';
type Celda = {
  materia: string;
  estado: EstadoCelda;
  fuente: 'colaboradores' | 'cv' | null;
  ruta?: string;
  pagina?: number | null;
};
type Asignado = { persona_id: number; nombre: string; celdas: Celda[] };
// a_incorporar: el rol se cubre comprometiendo el perfil, sin persona (decisiones.a_incorporar).
// documento: el del requisito en la ficha, para citarlo con su página. exigido: es el rol que exige
// el requisito (el primero que nombra), el que las comprobaciones piden asignar; los demás salen de sus materias.
export type FilaMatriz = {
  rol: string;
  lote: string | null;
  materias: string[];
  requisito: string;
  valor_exigido: string | null;
  documento: string | null;
  pagina: number | null;
  excluyente: boolean;
  asignados: Asignado[];
  incompatibles: string[];
  a_incorporar: boolean;
  exigido: boolean;
};

// Fila con la raíz del rol para cruzar incompatibilidades sin depender del texto que se enseña.
type FilaInterna = FilaMatriz & { raiz: string; texto: string };
type Grupo = { rol: RolNombrado | null; materias: Materia[] };

const enJuego = (r: RequisitoFicha, lotes: string[]) =>
  r.tipo === 'medios_personales' && r.cumple !== 'no_aplica' && (!r.lote || !lotes.length || lotes.includes(r.lote));

// El rol que exige el requisito tiene fila aunque no le pida materias (p. ej. una coordinadora).
function gruposDe(r: RequisitoFicha): Grupo[] {
  const grupos = porRol(r, materiasExigidas(`${r.descripcion}. ${r.valor_exigido ?? ''}`));
  const exigido = rolesNombrados(r.descripcion)[0] ?? null;
  if (!grupos.length && !exigido) return [{ rol: null, materias: [] }];
  if (exigido && !grupos.some((g) => g.rol?.raiz === exigido.raiz)) grupos.unshift({ rol: exigido, materias: [] });
  return grupos;
}

const mismaMateria = (c: CvMencion, m: Materia, lit: string) =>
  [m.texto, textoComparable(lit)].includes(textoComparable(c.materia));

function celdaDe(p: PersonaGuardada | undefined, id: number, m: Materia, lit: string, cvs: CvMencion[]): Celda {
  if (p && !materiaSinComprobar(m) && evidenciaDeMateria(p, m))
    return { materia: lit, estado: 'si', fuente: 'colaboradores' };
  const cv = cvs.find((c) => c.persona_id === id && mismaMateria(c, m, lit));
  if (cv) return { materia: lit, estado: 'no_comprobado', fuente: 'cv', ruta: cv.ruta, pagina: cv.pagina };
  const sinComprobar = !p || materiaSinComprobar(m);
  return { materia: lit, estado: sinComprobar ? 'no_comprobado' : 'no', fuente: null };
}

function asignadosDe(r: RequisitoFicha, g: Grupo, e: EntradaMatriz): Asignado[] {
  if (!e.decisiones || !g.rol) return [];
  const ids = [...new Set(enElRol(e.decisiones, r, g.rol.raiz).map((m) => m.persona_id))];
  return ids.map((id) => {
    const p = e.personas.find((x) => x.id === id);
    const celdas = g.materias.map((m) => celdaDe(p, id, m, materiaLiteral(r, m), e.cvs ?? []));
    return { persona_id: id, nombre: p?.nombre ?? `colaborador ${id}`, celdas };
  });
}

function filaDe(r: RequisitoFicha, g: Grupo, e: EntradaMatriz): FilaInterna {
  return {
    rol: g.rol ? rolLiteral(r.descripcion, g.rol) : 'Medios personales',
    raiz: g.rol?.raiz ?? '',
    texto: r.descripcion,
    lote: r.lote ?? null,
    materias: g.materias.map((m) => materiaLiteral(r, m)),
    requisito: r.descripcion,
    valor_exigido: r.valor_exigido ?? null,
    documento: r.documento ?? null,
    pagina: r.pagina ?? null,
    excluyente: r.excluyente,
    asignados: asignadosDe(r, g, e),
    incompatibles: [],
    a_incorporar: Boolean(e.decisiones && g.rol && incorporaElRol(e.decisiones, r, g.rol.raiz)),
    exigido: Boolean(g.rol && g.rol.raiz === rolesNombrados(r.descripcion)[0]?.raiz),
  };
}

// El pliego permite juntar roles («podrá ser la misma persona», «compatibles»): entonces no se avisa.
const PERMITE_JUNTAR =
  /\b(?:puede|pueden|podra|podran)\s+(?:ser\s+)?(?:desempenad[ao]s?\s+por\s+)?(?:la misma persona|coincidir|compatibilizar)|(?<!in)\bcompatibles?\b/;
const juntables = (a: FilaInterna, b: FilaInterna) =>
  [a.texto, b.texto].some((t) => PERMITE_JUNTAR.test(textoComparable(t)));
const mismosLotes = (a: FilaInterna, b: FilaInterna) => !a.lote || !b.lote || a.lote === b.lote;

function incompatiblesDe(f: FilaInterna, filas: FilaInterna[]): string[] {
  return f.asignados.flatMap((a) =>
    filas
      .filter(
        (o) =>
          o !== f &&
          o.raiz &&
          f.raiz &&
          o.raiz !== f.raiz &&
          mismosLotes(f, o) &&
          !juntables(f, o) &&
          o.asignados.some((x) => x.persona_id === a.persona_id),
      )
      .map(
        (o) =>
          `${a.nombre} es ${f.rol} y también ${o.rol}: el pliego los pide como roles distintos, comprueba que pueda ser la misma persona`,
      ),
  );
}

/** Una fila por rol exigido (requisito de medios del ámbito × rol), con sus materias y quién las acredita. */
export function matrizEquipo(e: EntradaMatriz): FilaMatriz[] {
  const lotes = e.lotes ?? e.decisiones?.lotes ?? [];
  const filas = e.requisitos.filter((r) => enJuego(r, lotes)).flatMap((r) => gruposDe(r).map((g) => filaDe(r, g, e)));
  return filas.map((f) => {
    const { raiz: _raiz, texto: _texto, ...fila } = f;
    return { ...fila, incompatibles: incompatiblesDe(f, filas) };
  });
}

// Búsquedas en los CV por petición: cada una cuesta una consulta a la Biblioteca.
const MAX_BUSQUEDAS_CV = 8;

// Las materias que nadie asignado acredita en Colaboradores, de quien tiene CV en la Biblioteca.
function materiasParaCv(filas: FilaMatriz[], personas: PersonaGuardada[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const a of filas.flatMap((f) => f.asignados)) {
    const conCv = personas.some((p) => p.id === a.persona_id && p.cv_ruta);
    for (const c of conCv ? a.celdas.filter((x) => x.estado === 'no') : [])
      out.set(c.materia, [...(out.get(c.materia) ?? []), a.persona_id]);
  }
  return out;
}

async function mencionesEnCvs(
  filas: FilaMatriz[],
  personas: PersonaGuardada[],
  buscador: BuscadorCvs,
): Promise<CvMencion[]> {
  const pendientes = [...materiasParaCv(filas, personas)].slice(0, MAX_BUSQUEDAS_CV);
  const out: CvMencion[] = [];
  for (const [materia, ids] of pendientes) {
    const rutas = await buscador(materia);
    // Sin Biblioteca la matriz sigue solo con Colaboradores: la búsqueda en CV es un apoyo.
    for (const p of rutas.data
      ? personas.filter((x) => ids.includes(x.id) && x.cv_ruta && rutas.data.includes(x.cv_ruta))
      : []) {
      out.push({ persona_id: p.id, materia, ruta: p.cv_ruta!, pagina: null });
    }
  }
  return out;
}

export type OpcionesMatriz = { cv: boolean; buscador?: BuscadorCvs };

/** La matriz de una licitación con su ficha aprobada; con cv, busca en los CV lo que Colaboradores no tiene. */
export async function matrizDeLicitacion(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  op: OpcionesMatriz,
): Promise<Result<{ filas: FilaMatriz[] }>> {
  const l = lotesDeLicitacion(db, id);
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const ficha = fichasDe(db, id).aprobada;
  if (!ficha) return ok({ filas: [] });
  const entrada: EntradaMatriz = {
    requisitos: ficha.datos.requisitos,
    decisiones: decisionesDe(db, id)?.datos ?? null,
    personas: listarPersonas(dbNucleo),
    lotes: idsDelAmbito(l.ambito),
  };
  const filas = matrizEquipo(entrada);
  if (!op.cv) return ok({ filas });
  const cvs = await mencionesEnCvs(filas, entrada.personas, op.buscador ?? buscarCvs);
  return ok({ filas: cvs.length ? matrizEquipo({ ...entrada, cvs }) : filas });
}
