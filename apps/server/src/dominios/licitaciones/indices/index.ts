// Índices de mercado de una licitación: competencia y baja esperadas, licitadores probables y concentración del órgano.
import { z } from 'zod';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { claseNif } from '../../../nucleo/identidad.js';
import { logger } from '../../../nucleo/log.js';
import { ok, type Result } from '../../../nucleo/result.js';
import { nombresDe } from '../competencia/agregados.js';
import { condicionSector, nombreEmpresa } from '../competencia/ambito.js';
import { SQL_IMPORTE_MERCADO, SQL_SIN_INCIDENCIA } from '../calidad.js';
import { sectorActual } from '../historico.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { licitacionYLote, pliegoDePrecios } from '../precios/index.js';
import type { Db } from '../store.js';
import type { UmbralPliego } from '../precios/escenarios.js';
import * as calc from './calculo.js';
import { comparablesDe, type ConsultaIndices, type Muestra } from './comparables.js';
import { ultimoAcierto } from './acierto.js';

// Cada uno con su muestra, su nivel de CPV y su confianza. Se calculan sobre los comparables (comparables.ts) con
// las fórmulas de calculo.ts y se guardan por segmento en indices_segmento: cada noche se rehacen los de lo que
// sigue la empresa y, si alguien pide uno que no está o tiene más de 36 h, se calcula al momento. La ficha, la
// franja del buscador y el MCP leen esta misma función: las cifras coinciden. Todo es código; nada de IA.
export const OpcionesIndices = z.object({
  lote: z.string().trim().min(1).max(40).optional().describe('Lote (por defecto, el primero de interés)'),
});
export type OpcionesIndicesData = z.infer<typeof OpcionesIndices>;

const NOTA_INDICES =
  'Estadística de lo adjudicado en la PLACSP: comparables del mismo tipo de contrato y CPV (con retroceso de 8 a 2 cifras hasta tener 20), presupuesto entre un tercio y el triple, procedimiento parecido y 5 años, pesando la mitad cada 2 años. La PLACSP solo publica al ganador y el nº de ofertas; quién más se presentó sale de las actas leídas. «Más barata» no es «ganar»: los juicios de valor también puntúan.';

const DIA_MS = 24 * 60 * 60_000;
const MAX_EDAD_MS = 36 * 60 * 60_000;
const ANIOS_CONCENTRACION = 3;
const MAX_COMPARABLES_VISIBLES = 30;
const TROZO = 500;
// El presupuesto se redondea a escalones de un 25 %: segmentos parecidos comparten caché sin
// cambiar la muestra (la banda es ×/÷ 3).
export const ESCALON = 1.25;
const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');
const log = logger('licitaciones.indices');

type LicitadorProbable = calc.Probable & { nombre: string | null; persona_fisica: boolean; evidencia: string };
type ConcentracionOrgano = calc.Concentracion & {
  nombre_primero: string | null;
  concentrado: boolean;
  texto: string | null;
};
export type ComparableVisible = Pick<
  calc.Comparable,
  'licitacion_id' | 'lote' | 'ofertas' | 'baja' | 'fecha' | 'mismo_organo'
> & { peso: number; titulo: string | null; organo: string | null };

type IndicesMercado = {
  clave: string;
  referencia: string;
  muestra: {
    descripcion: string;
    cpv: string | null;
    cifras_cpv: number;
    procedimiento_relajado: boolean;
    n: number;
    n_organo: number;
  };
  confianza: calc.Confianza;
  competencia: calc.Competencia;
  baja: calc.Baja;
  licitadores: LicitadorProbable[];
  concentracion: ConcentracionOrgano | null;
  resumen: string;
  comparables: ComparableVisible[];
  nota: string;
  calculado_en: string;
};

// acierto: la última prueba hacia atrás, leída al pedirla: no va en la caché.
export type IndicesLicitacion = IndicesMercado & {
  id: string;
  lote: { id: string; nombre: string | null } | null;
  lotes_interes: string[];
  de_cache: boolean;
  acierto: ReturnType<typeof ultimoAcierto>;
};

const escalon = (presupuesto: number | null) =>
  presupuesto && presupuesto > 0 ? Math.round(Math.log(presupuesto) / Math.log(ESCALON)) : null;

/** Clave del segmento: tipo, CPV, escalón de importe, grupo de procedimiento y órgano. */
function claveSegmento(q: Omit<ConsultaIndices, 'referencia' | 'excluir'>): string {
  const grupo = q.procedimiento === '3' || q.procedimiento === '4' ? 'neg' : 'abi';
  return [q.tipo ?? '-', q.cpv ?? '-', escalon(q.presupuesto) ?? '-', grupo, q.organo_nif ?? '-'].join('|');
}

function participacionesDe(db: Db, ids: string[]): calc.Participacion[] {
  const filas: calc.Participacion[] = [];
  for (let i = 0; i < ids.length; i += TROZO) {
    const trozo = ids.slice(i, i + TROZO);
    filas.push(
      ...(db
        .prepare(
          `SELECT licitacion_id, lote, empresa_nif, rol, fecha_ref AS fecha FROM participaciones
      WHERE licitacion_id IN (${trozo.map(() => '?').join(',')})`,
        )
        .all(...trozo) as calc.Participacion[]),
    );
  }
  return filas;
}

function adjudicacionesDelOrgano(db: Db, organo: string, referencia: string): calc.AdjudicacionOrgano[] {
  const { cpvs } = sectorActual(db, false);
  const sector = condicionSector('a.cpvs', cpvs);
  const desde = new Date(Date.parse(referencia) - ANIOS_CONCENTRACION * 365.25 * DIA_MS).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT a.adjudicatario_nif, ${SQL_IMPORTE_MERCADO} AS importe, a.fecha_ref AS fecha FROM adjudicaciones a
    WHERE a.organo_nif = ? AND a.resultado IN (${ADJUDICADOS}) AND a.nif_valido = 1 AND a.fecha_ref >= ? AND a.fecha_ref < ? AND ${sector.sql}
      AND ${SQL_SIN_INCIDENCIA}`,
    )
    .all(organo, desde, referencia.slice(0, 10), ...sector.args) as calc.AdjudicacionOrgano[];
}

const MES = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const mesDe = (fecha: string | null) => (fecha ? MES.format(new Date(`${fecha.slice(0, 10)}T00:00:00Z`)) : null);

// Sin actas leídas solo se conocen las que ganó: decir «ganó 4 de 4» sería engañoso.
function evidencia(p: calc.Probable): string {
  const soloGanadas = p.presentadas === p.ganadas;
  const organo = p.presentadas_organo
    ? soloGanadas
      ? `${p.ganadas_organo} en este órgano`
      : `${p.ganadas_organo} de ${p.presentadas_organo} en este órgano`
    : null;
  const total = soloGanadas
    ? `ganó ${p.ganadas} parecidas`
    : `ganó ${p.ganadas} de ${p.presentadas} parecidas a las que se presentó`;
  const ultima = mesDe(p.ultima);
  return [`${total}${organo ? ` (${organo})` : ''}`, ultima ? `última vez en ${ultima}` : null]
    .filter(Boolean)
    .join('; ');
}

function nombrar(db: Db, nifs: string[]): (nif: string) => { nombre: string | null; persona_fisica: boolean } {
  const nombres = nombresDe(
    db,
    nifs.filter((n) => claseNif(n) !== 'persona_fisica'),
  );
  return (nif) =>
    claseNif(nif) === 'persona_fisica'
      ? { nombre: null, persona_fisica: true }
      : { nombre: nombreEmpresa(nombres.get(nif) ?? null), persona_fisica: false };
}

const numero = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

function textoUnLicitador(p: number | null): string | null {
  if (p === null) return null;
  if (p < 0.05) return 'casi nunca con un solo licitador';
  if (p >= 0.5) return 'la mitad o más con un solo licitador';
  return `1 de cada ${Math.round(1 / p)} con un solo licitador`;
}

/** «3 ofertas esperadas (2-5) · 1 de cada 4 con un solo licitador · n = 41, CPV 4 dígitos, confianza media». */
export function resumenIndices(c: calc.Competencia, cifras: number, n: number, conf: calc.Confianza): string {
  const ofertas =
    c.ofertas === null
      ? 'Sin dato de ofertas'
      : `${numero(c.ofertas)} ofertas esperadas${c.rango.p25 !== null && c.rango.p75 !== null ? ` (${c.rango.p25}-${c.rango.p75})` : ''}`;
  return [ofertas, textoUnLicitador(c.p_un_licitador), `n = ${n}, CPV ${cifras} dígitos, confianza ${conf}`]
    .filter(Boolean)
    .join(' · ');
}

function visibles(db: Db, comparables: calc.Comparable[]): ComparableVisible[] {
  const top = [...comparables]
    .sort((a, b) => b.peso - a.peso || (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    .slice(0, MAX_COMPARABLES_VISIBLES);
  const ids = [...new Set(top.map((c) => c.licitacion_id))];
  const datos = new Map(
    (ids.length
      ? (db
          .prepare(`SELECT id, titulo, organo_nombre FROM licitaciones WHERE id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids) as { id: string; titulo: string; organo_nombre: string }[])
      : []
    ).map((f) => [f.id, f]),
  );
  return top.map((c) => ({
    licitacion_id: c.licitacion_id,
    lote: c.lote,
    ofertas: c.ofertas,
    baja: c.baja,
    fecha: c.fecha,
    mismo_organo: c.mismo_organo,
    peso: Math.round(c.peso * 1000) / 1000,
    titulo: datos.get(c.licitacion_id)?.titulo ?? null,
    organo: datos.get(c.licitacion_id)?.organo_nombre ?? null,
  }));
}

function concentracionDe(db: Db, q: ConsultaIndices): ConcentracionOrgano | null {
  if (!q.organo_nif) return null;
  const c = calc.concentracion(adjudicacionesDelOrgano(db, q.organo_nif, q.referencia));
  if (!c.primero) return null;
  const nombre = nombrar(db, [c.primero.nif])(c.primero.nif);
  const quien = nombre.nombre ?? (nombre.persona_fisica ? 'una persona física' : c.primero.nif);
  const concentrado = c.primero.cuota >= calc.CUOTA_CONCENTRADO && c.contratos >= calc.MIN_CONTRATOS_CONCENTRADO;
  return {
    ...c,
    nombre_primero: nombre.nombre,
    concentrado,
    texto: concentrado
      ? `Órgano concentrado: ${quien} ganó ${c.ultimas.ganadas_primero} de las últimas ${c.ultimas.de}`
      : null,
  };
}

/** Todos los índices de una consulta, sin caché (la prueba hacia atrás lo llama con la fecha de cada adjudicación). */
function calcularIndices(db: Db, q: ConsultaIndices, muestra: Muestra = comparablesDe(db, q)): IndicesMercado {
  const comp = calc.competencia(muestra.comparables);
  const b = calc.baja(muestra.comparables, comp.ofertas);
  const n = muestra.comparables.length;
  const conf = calc.confianza(n, muestra.cifras_cpv);
  const probables = calc.licitadoresProbables(
    muestra.comparables,
    participacionesDe(db, [...new Set(muestra.comparables.map((c) => c.licitacion_id))]),
  );
  const nombre = nombrar(
    db,
    probables.map((p) => p.nif),
  );
  return {
    clave: claveSegmento(q),
    referencia: q.referencia,
    muestra: {
      descripcion: muestra.descripcion,
      cpv: muestra.cpv,
      cifras_cpv: muestra.cifras_cpv,
      procedimiento_relajado: muestra.procedimiento_relajado,
      n,
      n_organo: comp.n_organo,
    },
    confianza: conf,
    competencia: comp,
    baja: b,
    licitadores: probables.map((p) => ({ ...p, ...nombre(p.nif), evidencia: evidencia(p) })),
    concentracion: concentracionDe(db, q),
    resumen: resumenIndices(comp, muestra.cifras_cpv, n, conf),
    comparables: visibles(db, muestra.comparables),
    nota: NOTA_INDICES,
    calculado_en: new Date().toISOString(),
  };
}

function leerCache(db: Db, clave: string, ahoraMs: number): IndicesMercado | null {
  const f = db.prepare('SELECT datos, actualizado_en FROM indices_segmento WHERE clave = ?').get(clave) as
    { datos: string; actualizado_en: string } | undefined;
  if (!f || ahoraMs - Date.parse(f.actualizado_en) > MAX_EDAD_MS) return null;
  try {
    return JSON.parse(f.datos) as IndicesMercado;
  } catch {
    // Una fila rota se recalcula y se sobrescribe.
    return null;
  }
}

function guardarCache(db: Db, r: IndicesMercado): void {
  const c = r.competencia;
  const b = r.baja;
  db.prepare(
    `INSERT OR REPLACE INTO indices_segmento (clave, nivel_cpv, n, ofertas_p25, ofertas_p50, ofertas_p75, p_un_licitador, baja_p25, baja_p50,
      baja_p75, baja_esperada, confianza, datos, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.clave,
    r.muestra.cifras_cpv,
    r.muestra.n,
    c.rango.p25,
    c.ofertas,
    c.rango.p75,
    c.p_un_licitador,
    b.rango.p25,
    b.rango.p50,
    b.rango.p75,
    b.esperada,
    r.confianza,
    JSON.stringify(r),
    r.calculado_en,
  );
}

// El umbral es de cada licitación, no del segmento (no va en la caché): el que fija el pliego si el guion
// lo trae como baja; si lo trae pero no se pudo leer como baja, el del art. 85 con el literal (como precios/escenarios.ts).
function conUmbralDelPliego(b: calc.Baja, u: UmbralPliego | null): calc.Baja {
  if (u?.baja != null) return { ...b, umbral_anormal: u.baja, regla_umbral: 'pliego', umbral_literal: u.literal };
  return u?.literal ? { ...b, regla_umbral: 'literal', umbral_literal: u.literal } : b;
}

/** Índices de una licitación (o de un lote suyo) hoy: de la caché si es reciente, si no se calculan y se guardan. */
export function indicesDeLicitacion(
  db: Db,
  id: string,
  o: OpcionesIndicesData = {},
  ahoraMs = Date.now(),
  forzar = false,
): Result<IndicesLicitacion> {
  const e = licitacionYLote(db, id, o.lote);
  if (e.error) return e;
  const { l, lote, interes } = e.data;
  const presupuesto = lote ? lote.presupuesto_sin_iva : (l.presupuesto_sin_iva ?? l.valor_estimado);
  const base = {
    tipo: l.tipo_contrato,
    cpv: lote?.cpvs[0] ?? l.cpvs.split(',').find(Boolean) ?? null,
    procedimiento: l.procedimiento,
    organo_nif: l.organo_nif,
    presupuesto: escalon(presupuesto) === null ? null : ESCALON ** escalon(presupuesto)!,
  };
  const clave = claveSegmento(base);
  const enCache = forzar ? null : leerCache(db, clave, ahoraMs);
  const r = enCache ?? calcularIndices(db, { ...base, referencia: new Date(ahoraMs).toISOString(), excluir: null });
  if (!enCache) guardarCache(db, r);
  return ok({
    ...r,
    baja: conUmbralDelPliego(r.baja, pliegoDePrecios(db, id, lote?.id ?? null, presupuesto)?.umbral ?? null),
    id,
    lote: lote ? { id: lote.id, nombre: lote.nombre } : null,
    lotes_interes: interes,
    de_cache: enCache !== null,
    acierto: ultimoAcierto(db),
  });
}

// ─── Cada noche ──────────────────────────────────────────────────────────────

const HORA_NOCHE = 2;
const POR_VUELTA = 10;
let diaHecho: string | null = null;
let pendientes: string[] = [];

/** Lo que se rehace cada noche: lo que está por revisar, en preparación o presentado. */
function idsDeInteres(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT licitacion_id FROM oportunidades WHERE estado IN ('nueva', 'en_preparacion', 'presentada') ORDER BY licitacion_id`,
      )
      .all() as { licitacion_id: string }[]
  ).map((f) => f.licitacion_id);
}

/**
 * Desde las 2:00 (hora peninsular), una vez al día: borra la caché de más de tres días y rehace
 * los índices de lo que sigue la empresa, unos pocos por vuelta para no frenar el resto. Devuelve cuántos rehizo.
 */
export function vueltaIndices(db: Db, ahoraMs = Date.now()): number {
  const local = horaLocalEspana(ahoraMs);
  const dia = local.slice(0, 10);
  if (diaHecho !== dia && Number(local.slice(11, 13)) >= HORA_NOCHE) {
    diaHecho = dia;
    db.prepare('DELETE FROM indices_segmento WHERE actualizado_en < ?').run(
      new Date(ahoraMs - 3 * DIA_MS).toISOString(),
    );
    pendientes = idsDeInteres(db);
  }
  const lote = pendientes.splice(0, POR_VUELTA);
  let hechos = 0;
  for (const id of lote) {
    // Se recalcula aunque esté en caché: lo de la caché es de ayer.
    const r = indicesDeLicitacion(db, id, {}, ahoraMs, true);
    if (r.error) log.warn('índices sin calcular', { licitacion: id, error: r.error.code });
    else hechos += 1;
  }
  return hechos;
}

/** Para los tests: la próxima vuelta vuelve a empezar el día. */
export function reiniciarNocheIndices(): void {
  diaHecho = null;
  pendientes = [];
}
