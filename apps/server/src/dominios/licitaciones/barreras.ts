// «Qué nos falta»: lo que se acredita con un papel y piden las licitaciones que sigue la empresa.
import { z } from 'zod';
import { evidenciaDeMateria, materiasExigidas, type Materia } from '../../nucleo/colaboradores/materias.js';
import { analizarRequisito } from '../../nucleo/colaboradores/requisito.js';
import type { PerfilEmpresaData } from '../../nucleo/empresa.js';
import type { Evaluacion, Resultado } from './evaluador.js';
import { parsearClasificacion } from './evaluador.js';
import { evaluacionesDeFicha, fichasDe, goNoGo } from './ficha.js';
import { SELECT_RESUMEN, type FilaResumen } from './oportunidades.js';
import type { Db } from './store.js';
import { certificaciones, clavePersonal, codigoClasificacion, otra, sinTildes, type Clave } from './papeles.js';

// Certificaciones, seguro, clasificación empresarial, habilitaciones: cuántas veces no se tiene y cuántas deja
// fuera. Sirve para decidir qué certificación sacar; sale de los requisitos de la PLACSP y de las fichas de
// Hermes, sin IA.
export const OpcionesBarreras = z.object({
  meses: z
    .number()
    .int()
    .min(0)
    .max(120)
    .default(12)
    .describe('Oportunidades llegadas en los últimos N meses; 0 = todas'),
});

export type { Clave } from './papeles.js';
export { certificaciones } from './papeles.js';

type Barrera = Clave & {
  licitaciones: number;
  no_cumplimos: number;
  por_confirmar: number;
  nos_dejan_fuera: number;
  importe_no_cumplimos: number;
  exigidos: string[];
  // Solo el ENS: en cuántas licitaciones se pide cada categoría («sin indicar» si no la dice).
  niveles?: Record<string, number>;
  ejemplos: { id: string; titulo: string; estado: string; importe: number | null; resultado: Resultado }[];
};

// El ENS es una sola certificación con categorías (la alta cubre la media y la básica): una
// fila con la categoría como detalle, no una por categoría, que repartía el mismo papel.
const ORDEN_NIVEL: Record<string, number> = { básica: 1, media: 2, alta: 3 };
const nivelMayor = (a?: string, b?: string) => ((ORDEN_NIVEL[a ?? ''] ?? 0) >= (ORDEN_NIVEL[b ?? ''] ?? 0) ? a : b);

function clasificacion(texto: string | null): Clave {
  const codigo = codigoClasificacion(texto ?? '');
  const c = codigo ? parsearClasificacion(codigo) : null;
  if (!c) return { clave: 'clasificacion', nombre: 'Clasificación empresarial', tipo: 'clasificacion' };
  const sub = c.subgrupo === null ? '' : `-${c.subgrupo}`;
  return { clave: `clasificacion-${c.grupo}${sub}`, nombre: `Clasificación ${c.grupo}${sub}`, tipo: 'clasificacion' };
}

const SEGURO: Clave = { clave: 'seguro-rc', nombre: 'Seguro de responsabilidad civil', tipo: 'seguro' };

/** Lo que se acredita con un papel en un requisito evaluado (de la PLACSP o de la ficha); [] si no es de eso. */
export function clavesDe(e: Evaluacion): Clave[] {
  const texto = [e.exigido, e.descripcion].filter(Boolean).join(' ');
  if (e.clase === 'seguro' || e.etiqueta === 'Seguro de indemnización') return [SEGURO];
  if (e.clase === 'clasificacion') return [clasificacion(e.exigido ?? e.descripcion)];
  if (e.clase === 'habilitacion') return [otra('habilitacion', e.descripcion || e.etiqueta)];
  const certificado =
    e.clase === 'certificacion' || e.etiqueta === 'Certificados de calidad' || e.etiqueta === 'Gestión medioambiental';
  if (!certificado) return [];
  const nombradas = certificaciones(texto);
  return nombradas.length ? nombradas : [otra('certificacion', e.descripcion || e.etiqueta)];
}

const PESO: Record<Resultado, number> = { no_cumple: 0, desconocido: 1, cumple: 2, no_aplica: 3 };
type EnLicitacion = { resultado: Resultado; excluyente: boolean; exigido: string | null };

// Lo de una licitación, una vez por clave y con lo peor que salió (no cumple > dudoso > cumple).
function porClave(evals: Evaluacion[]): Map<string, Clave & EnLicitacion> {
  const m = new Map<string, Clave & EnLicitacion>();
  for (const e of evals) {
    for (const c of clavesDe(e)) {
      const previa = m.get(c.clave);
      const excluyente = e.excluyente || Boolean(previa?.excluyente);
      const nivel = nivelMayor(c.nivel, previa?.nivel);
      if (!previa || PESO[e.resultado] < PESO[previa.resultado])
        m.set(c.clave, { ...c, resultado: e.resultado, excluyente, exigido: e.exigido, ...(nivel ? { nivel } : {}) });
      else Object.assign(previa, { excluyente, ...(nivel ? { nivel } : {}) });
    }
  }
  return m;
}

// Requisitos de la licitación: los de la ficha y los de la PLACSP que no son un «por
// confirmar» que la ficha ya leyó del pliego.
function requisitosDe(db: Db, f: FilaResumen, perfil: PerfilEmpresaData | null, hoy: Date): Evaluacion[] {
  const { aprobada } = fichasDe(db, f.id);
  const deFicha = aprobada ? evaluacionesDeFicha(aprobada.datos) : [];
  const placsp = goNoGo(db, f, perfil, hoy).requisitos.filter(
    (e) => !(deFicha.length && e.resultado === 'desconocido'),
  );
  // Lo que el pliego pide pero no afecta a la empresa (p. ej. solo a las UTE) no es una barrera.
  return [...placsp, ...deFicha].filter((e) => e.resultado !== 'no_aplica');
}

function nueva(c: Clave): Barrera {
  return {
    clave: c.clave,
    nombre: c.nombre,
    tipo: c.tipo,
    licitaciones: 0,
    no_cumplimos: 0,
    por_confirmar: 0,
    nos_dejan_fuera: 0,
    importe_no_cumplimos: 0,
    exigidos: [],
    ejemplos: [],
    ...(c.clave === 'ens' ? { niveles: {} } : {}),
  };
}

function sumar(b: Barrera, f: FilaResumen, en: EnLicitacion & { nivel?: string }): void {
  b.licitaciones += 1;
  if (b.niveles) b.niveles[en.nivel ?? 'sin indicar'] = (b.niveles[en.nivel ?? 'sin indicar'] ?? 0) + 1;
  if (en.resultado === 'no_cumple') {
    b.no_cumplimos += 1;
    b.importe_no_cumplimos += f.presupuesto_sin_iva ?? 0;
    if (en.excluyente) b.nos_dejan_fuera += 1;
  }
  if (en.resultado === 'desconocido') b.por_confirmar += 1;
  if (en.exigido && b.exigidos.length < 3 && !b.exigidos.includes(en.exigido)) b.exigidos.push(en.exigido);
  b.ejemplos.push({
    id: f.id,
    titulo: f.titulo,
    estado: f.op_estado,
    importe: f.presupuesto_sin_iva,
    resultado: en.resultado,
  });
}

const MAX_EJEMPLOS = 5;

const seguidasDesde = (db: Db, desde: string): FilaResumen[] =>
  db.prepare(`${SELECT_RESUMEN} WHERE o.estado <> 'candidata' AND o.creada_en >= ?`).all(desde) as FilaResumen[];

type Respuesta = { meses: number; oportunidades: number; barreras: Barrera[]; personal: BarreraPersonal[] };

/** Lo que piden las oportunidades seguidas (todas salvo las sin cribar) y le falta a la empresa, de más a menos. */
export function barreras(
  db: Db,
  perfil: PerfilEmpresaData | null,
  o: z.infer<typeof OpcionesBarreras>,
  hoy = new Date(),
): Respuesta {
  const desde = o.meses ? new Date(hoy.getTime() - o.meses * 30.44 * 86_400_000).toISOString() : '';
  const filas = seguidasDesde(db, desde);
  const total = new Map<string, Barrera>();
  for (const f of filas) {
    for (const [clave, en] of porClave(requisitosDe(db, f, perfil, hoy))) {
      const b = total.get(clave) ?? nueva(en);
      total.set(clave, b);
      sumar(b, f, en);
    }
  }
  const lista = [...total.values()].map((b) => ({
    ...b,
    importe_no_cumplimos: Math.round(b.importe_no_cumplimos),
    ejemplos: b.ejemplos
      .sort((x, y) => PESO[x.resultado] - PESO[y.resultado] || (y.importe ?? 0) - (x.importe ?? 0))
      .slice(0, MAX_EJEMPLOS),
  }));
  lista.sort(
    (a, b) =>
      b.nos_dejan_fuera - a.nos_dejan_fuera || b.no_cumplimos - a.no_cumplimos || b.licitaciones - a.licitaciones,
  );
  return { meses: o.meses, oportunidades: filas.length, barreras: lista, personal: barrerasDePersonal(db, desde) };
}

// ── La experiencia del personal ──
// La barrera real de una descartada de este tipo no es un papel: es que nadie del equipo tiene
// «5 años en monitorización de medios». Sale de los medios personales excluyentes de la ficha que
// la empresa no cumple o están por confirmar, y de los descartes tipificados como solvencia que hablan del
// personal: esos dejaron fuera a la empresa aunque la ficha dijera «sí» por los años totales.

export type BarreraPersonal = Clave & {
  materia: string;
  anios_exigidos: number | null;
  licitaciones: number;
  nos_dejan_fuera: number;
  ejemplos: { id: string; titulo: string; estado: string; fuera: boolean }[];
};

type Descarte = { categoria: string | null; motivo: string | null };
type ExigenciaPersonal = { clave: Clave; materia: string; anios: number | null; fuera: boolean };
type Candidata = { m: Materia; anios: number | null; resultado: Resultado };

// Un descarte por solvencia que no nombra ninguna materia cuenta si habla de personas.
const HABLA_DE_PERSONAL =
  /personal|equipo|perfil|director|coordinador|jefe|analista|tecnic|consultor|docente|formador|tutor|experiencia|titulacion/;

function descarteVigente(db: Db, id: string): Descarte | null {
  const f = db
    .prepare(
      'SELECT accion, categoria, motivo FROM descartes_historial WHERE licitacion_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(id) as (Descarte & { accion: string }) | undefined;
  return f?.accion === 'descartada' ? { categoria: f.categoria, motivo: f.motivo } : null;
}

function candidatasDe(evals: Evaluacion[]): Candidata[] {
  return evals
    .filter((e) => e.clase === 'medios_personales' && e.excluyente && e.resultado !== 'no_aplica')
    .flatMap((e) => {
      const texto = `${e.descripcion}. ${e.exigido ?? ''}`;
      const anios = analizarRequisito(texto).anios_minimos;
      return materiasExigidas(texto)
        .filter((m) => m.alternativas.length)
        .map((m) => ({ m, anios, resultado: e.resultado }));
    });
}

// Las materias que un descarte por solvencia dio como causa: las que nombra su motivo o, si no
// nombra ninguna y habla del personal, todas las que pide la ficha.
function fueraPorDescarte(cs: Candidata[], d: Descarte | null): Set<Candidata> {
  if (d?.categoria !== 'solvencia') return new Set();
  const motivo = sinTildes(d.motivo ?? '');
  const comoPerfil = { sectores: [motivo], tecnologias: [], certificaciones: [], titulaciones: [] };
  const nombradas = cs.filter((c) => evidenciaDeMateria(comoPerfil, c.m) !== null);
  if (nombradas.length) return new Set(nombradas);
  return new Set(!motivo || HABLA_DE_PERSONAL.test(motivo) ? cs : []);
}

/** La experiencia del personal que pide una licitación y le falta a la empresa o dejó fuera a la empresa, una vez por materia. */
function exigenciasPersonal(db: Db, id: string): ExigenciaPersonal[] {
  const { aprobada } = fichasDe(db, id);
  const cs = aprobada ? candidatasDe(evaluacionesDeFicha(aprobada.datos)) : [];
  const porDescarte = fueraPorDescarte(cs, cs.length ? descarteVigente(db, id) : null);
  const out = new Map<string, ExigenciaPersonal>();
  for (const c of cs) {
    const fuera = c.resultado === 'no_cumple' || porDescarte.has(c);
    if (!fuera && c.resultado !== 'desconocido') continue;
    const clave = clavePersonal(c.m.texto);
    const previa = out.get(clave.clave);
    const anios = Math.max(previa?.anios ?? 0, c.anios ?? 0) || null;
    out.set(clave.clave, { clave, materia: c.m.texto, anios, fuera: fuera || Boolean(previa?.fuera) });
  }
  return [...out.values()];
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const mitad = Math.floor(o.length / 2);
  return o.length % 2 ? o[mitad]! : (o[mitad - 1]! + o[mitad]!) / 2;
}

type Acumulada = BarreraPersonal & { anios: number[] };

function acumular(total: Map<string, Acumulada>, f: FilaResumen, x: ExigenciaPersonal): void {
  const b = total.get(x.clave.clave) ?? {
    ...x.clave,
    materia: x.materia,
    anios_exigidos: null,
    licitaciones: 0,
    nos_dejan_fuera: 0,
    ejemplos: [],
    anios: [],
  };
  total.set(x.clave.clave, b);
  b.licitaciones += 1;
  b.nos_dejan_fuera += Number(x.fuera);
  if (x.anios !== null) b.anios.push(x.anios);
  b.ejemplos.push({ id: f.id, titulo: f.titulo, estado: f.op_estado, fuera: x.fuera });
}

/** La experiencia del personal que piden las oportunidades seguidas desde `desde` ('' = todas), de más a menos veces fuera. */
export function barrerasDePersonal(db: Db, desde: string): BarreraPersonal[] {
  const total = new Map<string, Acumulada>();
  for (const f of seguidasDesde(db, desde)) for (const x of exigenciasPersonal(db, f.id)) acumular(total, f, x);
  const lista = [...total.values()].map(({ anios, ...b }) => ({
    ...b,
    anios_exigidos: mediana(anios),
    ejemplos: b.ejemplos.sort((x, y) => Number(y.fuera) - Number(x.fuera)).slice(0, MAX_EJEMPLOS),
  }));
  return lista.sort((a, b) => b.nos_dejan_fuera - a.nos_dejan_fuera || b.licitaciones - a.licitaciones);
}

// ── Cuántas veces dejó fuera a la empresa una barrera, para las comprobaciones ──

// Lo que dejó fuera a una licitación: los papeles excluyentes que la ficha da por no cumplidos (o
// por confirmar, si se descartó por certificación) y la experiencia del personal.
function fueraEn(db: Db, id: string): string[] {
  const { aprobada } = fichasDe(db, id);
  const porCertificacion = descarteVigente(db, id)?.categoria === 'certificacion';
  const papeles = aprobada ? [...porClave(evaluacionesDeFicha(aprobada.datos)).values()] : [];
  const fuera = papeles.filter(
    (p) => p.excluyente && (p.resultado === 'no_cumple' || (porCertificacion && p.resultado === 'desconocido')),
  );
  return [
    ...fuera.map((p) => p.clave),
    ...exigenciasPersonal(db, id)
      .filter((x) => x.fuera)
      .map((x) => x.clave.clave),
  ];
}

/**
 * Cuántas licitaciones seguidas dejó fuera a la empresa cada barrera (clave de «Qué nos falta»). La
 * licitación `excepto` (la de las comprobaciones) solo cuenta si ya está descartada: la que se prepara aún no dejó fuera a la empresa.
 */
export function vecesFueraPorClave(db: Db, excepto: string | null = null): Map<string, number> {
  const veces = new Map<string, number>();
  for (const f of seguidasDesde(db, '')) {
    if (f.id === excepto && f.op_estado !== 'descartada') continue;
    for (const clave of new Set(fueraEn(db, f.id))) veces.set(clave, (veces.get(clave) ?? 0) + 1);
  }
  return veces;
}

/** Cuántas veces dejó fuera a la empresa una barrera (ver vecesFueraPorClave). */
export const vecesFuera = (db: Db, clave: string, excepto: string | null = null): number =>
  vecesFueraPorClave(db, excepto).get(clave) ?? 0;
