// La Mesa: lo que la persona tiene que hacer hoy, sacado de las comprobaciones de cada oferta activa. Solo lee.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { horaLocalEspana, isoConZonaEspana } from '../../../nucleo/fechas.js';
import { logger } from '../../../nucleo/log.js';
import { ok, type Result } from '../../../nucleo/result.js';
import { fichasDe } from '../ficha.js';
import type { Db } from '../store.js';
import { comprobacionesDe, type BloqueoConCoste } from './comprobaciones.js';
import { REGLA_COMPROMISO_CARO, REGLA_COMPROMISOS_CAROS } from './comprobacionesReglasCostes.js';
import { MINUTOS_POR_ACCION, type Bloqueo, type Comprobaciones, type Cita, type Fase } from './comprobacionesTipos.js';
import { primerBloqueoAbierto } from './ofertaAgente.js';
import { trabajosVivosDe } from './hermesEnVivo.js';
import type { Eta } from '../../../nucleo/colaEta.js';
import { licitacionesEnPreparacion, type LicitacionEnPreparacion } from './plazo.js';
import { proximoHito, type Hito } from './hitos.js';

const log = logger('licitaciones.mesa');

// Sale de las comprobaciones para que la Mesa nunca diga otra cosa que ellas. Tres bloques sin repeticiones:
// «Decide hoy» (ir o no ir), «Tu mesa» (por fecha límite para decidir) y «Listas para firmar».
// Una ficha por revisar entra en «Decide hoy» si su próximo plazo cae en estos días de calendario
// peninsular o menos (ESMASA: la solicitud de participación vencía al día siguiente).
const DIAS_DECIDE_HOY = 3;

type Excluyente = {
  texto: string;
  cumple: string;
  lote: string | null;
  cita: Pick<Cita, 'documento' | 'pagina'> | null;
};
type FichaPorRevisar = {
  tipo: 'ficha_por_revisar';
  id: string;
  titulo: string;
  plazo: string | null;
  solicitud: boolean;
  excluyentes: Excluyente[];
};
type PrimerBloqueo = { clave: string; titulo: string; cita: Cita | null };
// Lo que Hermes hace ahora para la oferta (el primero de HermesEnVivo), con su hora estimada: la
// Mesa lo dice sin tener que abrir las comprobaciones.
type HermesMesa = { nombre: string; estado: 'en_cola' | 'generando'; eta: Eta | null; mas: number };
// Los compromisos caros abiertos de la memoria y hasta cuándo da tiempo a otra ronda que los
// suavice (Comprobaciones.limite_suavizar): con antelación, no a la hora de firmar .
// Solo horas: la Mesa la lee también un agente (licitaciones_mesa), y los euros son de la web.
// total: ningún añadido pasa el umbral por fila, pero juntos pasan el del presupuesto (n son todos los añadidos).
export type CompromisosCaros = { n: number; horas: number; antes_de: string | null; total?: true };
type FilaMesa = {
  id: string;
  titulo: string;
  vence_en: string | null;
  hora_interna_cierre: string | null;
  limite_decidir: string | null;
  veredicto: Comprobaciones['veredicto'];
  primer_bloqueo: PrimerBloqueo | null;
  minutos_persona: number;
  fases: { nombre: Fase['nombre']; estado: Fase['estado'] }[];
  hermes: HermesMesa | null;
  compromisos_caros: CompromisosCaros | null;
  // El primer hito sin hacer (vencido o por venir), el de las comprobaciones.
  proximo_hito: Hito | null;
};
type Frenada = { tipo: 'frenada' } & FilaMesa;
export type Mesa = {
  minutos_total: number;
  decide_hoy: (FichaPorRevisar | Frenada)[];
  tu_mesa: FilaMesa[];
  listas_para_firmar: FilaMesa[];
};

const abierta = (b: Bloqueo): boolean => b.estado === 'abierto' || b.estado === 'propuesta';

/**
 * Una tarea tuya: una fila de las comprobaciones a tu nombre que sigue abierta y no está bien (también lo
 * no comprobado: hay que comprobarlo). La misma para el menú, la Mesa del agente y la web.
 */
export const tareaTuya = (b: Bloqueo): boolean => b.actor === 'tu' && b.gravedad !== 'ok' && abierta(b);

const esCompromisoCaro = (b: Bloqueo): boolean => b.clave.startsWith(`${REGLA_COMPROMISO_CARO}:`);
const esTotalCaro = (b: Bloqueo): boolean => b.clave.startsWith(`${REGLA_COMPROMISOS_CAROS}:`);
const horasDe = (bs: BloqueoConCoste[]): number => Math.round(bs.reduce((s, b) => s + (b.coste?.horas ?? 0), 0));

/**
 * Las filas compromiso_caro abiertas (la del total repite sus horas) o, sin ninguna, la del total
 * abierta: también pide suavizar. null si no hay ni unas ni otra.
 */
export function compromisosCarosDe(c: Comprobaciones): CompromisosCaros | null {
  const abiertas = (c.bloqueos as BloqueoConCoste[]).filter(abierta);
  const filas = abiertas.filter(esCompromisoCaro);
  if (filas.length) return { n: filas.length, horas: horasDe(filas), antes_de: c.limite_suavizar };
  const totales = abiertas.filter(esTotalCaro);
  if (!totales.length) return null;
  const n = totales.reduce((s, b) => s + (b.coste?.n ?? b.coste?.resumen.anadidos ?? 0), 0);
  return { n, horas: horasDe(totales), antes_de: c.limite_suavizar, total: true };
}

// El «decide antes de» es el de las comprobaciones tal cual (con las duraciones reales y toda la cadena que
// falta): la Mesa no dice otra cosa que las comprobaciones.
function hermesDe(dbNucleo: DbNucleo, id: string, ahoraMs: number): HermesMesa | null {
  const [t, ...resto] = trabajosVivosDe(dbNucleo, id, ahoraMs);
  return t ? { nombre: t.nombre, estado: t.estado, eta: t.eta, mas: resto.length } : null;
}

function filaDe(l: LicitacionEnPreparacion, c: Comprobaciones, hermes: HermesMesa | null): FilaMesa {
  const b = primerBloqueoAbierto(c.bloqueos);
  return {
    id: l.id,
    titulo: l.titulo,
    vence_en: l.fecha_limite ? isoConZonaEspana(l.fecha_limite) : null,
    hora_interna_cierre: c.hora_interna_cierre || null,
    limite_decidir: c.limite_decidir,
    veredicto: c.veredicto,
    primer_bloqueo: b ? { clave: b.clave, titulo: b.titulo, cita: b.cita } : null,
    minutos_persona: c.minutos_persona,
    fases: c.fases.map((f) => ({ nombre: f.nombre, estado: f.estado })),
    hermes,
    compromisos_caros: compromisosCarosDe(c),
    proximo_hito: proximoHito(c.hitos),
  };
}

// Parada por el freno de elegibilidad: un «impide» de elegibilidad sin «vamos» (al decir «vamos»
// la fila deja de estar abierta) es una decisión de ir o no ir, no una tarea más de la mesa.
export const frenada = (c: Comprobaciones): boolean =>
  c.veredicto.tipo === 'no_presentable' &&
  c.bloqueos.some((b) => abierta(b) && b.categoria === 'elegibilidad' && b.gravedad === 'impide');
const paraFirmar = (c: Comprobaciones): boolean =>
  c.veredicto.tipo === 'lista_para_firmar' || c.veredicto.tipo === 'presentable_con_riesgos';

const instante = (iso: string | null): number => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);
// Lo primero que vence de la oferta: la fecha límite para decidir o su próximo hito.
const primero = (f: FilaMesa): number => Math.min(instante(f.limite_decidir), instante(f.proximo_hito?.fecha ?? null));
// Por lo primero que vence; sin nada (sin plazo), al final.
const porLimite = (a: FilaMesa, b: FilaMesa): number =>
  primero(a) - primero(b) || instante(a.vence_en) - instante(b.vence_en) || a.id.localeCompare(b.id);

type Clasificadas = { frenadas: Frenada[]; tu_mesa: FilaMesa[]; listas: FilaMesa[] };

function clasificar(db: Db, dbNucleo: DbNucleo, ahoraMs: number): Clasificadas {
  const out: Clasificadas = { frenadas: [], tu_mesa: [], listas: [] };
  for (const l of licitacionesEnPreparacion(db, ahoraMs)) {
    const c = comprobacionesDe(db, dbNucleo, l.id, ahoraMs);
    if (c.error) {
      log.warn('mesa sin las comprobaciones de una oferta', { id: l.id, codigo: c.error.code });
      continue;
    }
    const fila = filaDe(l, c.data, hermesDe(dbNucleo, l.id, ahoraMs));
    if (frenada(c.data)) out.frenadas.push({ tipo: 'frenada', ...fila });
    else if (paraFirmar(c.data)) out.listas.push(fila);
    else out.tu_mesa.push(fila);
  }
  for (const lista of [out.frenadas, out.tu_mesa, out.listas]) lista.sort(porLimite);
  return out;
}

function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

type FilaNueva = { id: string; titulo: string; fecha_limite: string | null; fecha_solicitud: string | null };

// La solicitud de participación manda mientras siga vigente: es lo primero que vence.
function proximoPlazo(f: FilaNueva, ahora: string): { plazo: string | null; solicitud: boolean } {
  if (f.fecha_solicitud && f.fecha_solicitud >= ahora) return { plazo: f.fecha_solicitud, solicitud: true };
  return { plazo: f.fecha_limite, solicitud: false };
}

// Los excluyentes que la empresa no tiene claros: «no_aplica» no afecta a la empresa y no pide decisión.
function excluyentesPorConfirmar(db: Db, id: string): Excluyente[] {
  const requisitos = fichasDe(db, id).aprobada?.datos.requisitos ?? [];
  return requisitos
    .filter((r) => r.excluyente && r.cumple !== 'si' && r.cumple !== 'no_aplica')
    .map((r) => ({
      texto: r.descripcion,
      cumple: r.cumple,
      lote: r.lote ?? null,
      cita: r.documento ? { documento: r.documento, pagina: r.pagina ?? null } : null,
    }));
}

/** Las fichas aprobadas sin decidir cuyo próximo plazo cae en DIAS_DECIDE_HOY o menos («Decide hoy»). */
function fichasPorRevisar(db: Db, ahoraMs: number): FichaPorRevisar[] {
  const ahora = horaLocalEspana(ahoraMs);
  const hasta = `${sumarDias(ahora.slice(0, 10), DIAS_DECIDE_HOY)}T23:59:59`;
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo, l.fecha_limite, l.fecha_solicitud FROM oportunidades o
    JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'nueva' AND l.borrada_en IS NULL
      AND EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = l.id AND f.estado = 'aprobada')
      AND (l.fecha_solicitud BETWEEN ? AND ? OR l.fecha_limite BETWEEN ? AND ?)`,
    )
    .all(ahora, hasta, ahora, hasta) as FilaNueva[];
  return filas
    .map((f) => ({ f, ...proximoPlazo(f, ahora) }))
    .filter(({ plazo }) => plazo !== null && plazo >= ahora && plazo <= hasta)
    .sort((a, b) => (a.plazo ?? '').localeCompare(b.plazo ?? '') || a.f.id.localeCompare(b.f.id))
    .map(({ f, plazo, solicitud }) => ({
      tipo: 'ficha_por_revisar',
      id: f.id,
      titulo: f.titulo,
      plazo: plazo ? isoConZonaEspana(plazo) : null,
      solicitud,
      excluyentes: excluyentesPorConfirmar(db, f.id),
    }));
}

// Lo que vence antes, primero: el plazo de la ficha o la fecha límite para decidir de la oferta frenada.
const urgencia = (x: FichaPorRevisar | Frenada): number =>
  x.tipo === 'ficha_por_revisar'
    ? x.plazo
      ? Date.parse(x.plazo)
      : Number.POSITIVE_INFINITY
    : instante(x.limite_decidir ?? x.vence_en);

/** La Mesa de hoy. Una oferta sale una sola vez: frenada, lista para firmar o en tu mesa. */
export function mesaDe(db: Db, dbNucleo: DbNucleo, ahoraMs: number = Date.now()): Result<Mesa> {
  const { frenadas, tu_mesa, listas } = clasificar(db, dbNucleo, ahoraMs);
  const fichas = fichasPorRevisar(db, ahoraMs);
  const decide_hoy = [...fichas, ...frenadas].sort((a, b) => urgencia(a) - urgencia(b));
  const minutos =
    [...frenadas, ...tu_mesa, ...listas].reduce((s, f) => s + f.minutos_persona, 0) +
    fichas.length * MINUTOS_POR_ACCION.vamos;
  return ok({ minutos_total: Math.round(minutos * 10) / 10, decide_hoy, tu_mesa, listas_para_firmar: listas });
}
