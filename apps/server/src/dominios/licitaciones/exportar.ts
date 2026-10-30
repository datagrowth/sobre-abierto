// Exportación CSV de los listados de Licitaciones, con los mismos filtros y columnas que su vista.
import { aCsv, type Columna } from '../../nucleo/csv.js';
import type { ComparableVisible } from './indices/index.js';
import { rankingCompetidores, type FilaRanking, type OpcionesCompetidoresData } from './competencia/competidores.js';
import { rankingOrganismos, type FilaOrganismo, type OpcionesOrganismosData } from './competencia/organismos.js';
import { COLUMNAS, pipeline, type TarjetaPipeline } from './pipeline.js';
import { listarPropuestas, type FiltroPropuestasData, type PropuestaConLicitacion } from './propuestas/registro.js';
import { listaRevision, type FiltroRevisionData, type ItemRevision } from './revision.js';
import type { Db } from './store.js';

// Pipeline, Oportunidades, Presentadas, Competidores, Organismos y los comparables de un índice. Cada uno sale
// de la misma función que su vista, entero (página a página hasta MAX_FILAS) y con las columnas que se ven. Los
// plazos, en hora peninsular como los da la PLACSP.
const MAX_FILAS = 5000;
const PAGINA = 100;

const plazo = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : null);
const TITULO_COLUMNA = new Map<string, string>(COLUMNAS.map((c) => [c.clave, c.titulo]));
const RESULTADO: Record<string, string> = { ganada: 'Ganada', perdida: 'Perdida' };

const DEL_PIPELINE: Columna<TarjetaPipeline>[] = [
  { titulo: 'Estado', valor: (t) => TITULO_COLUMNA.get(t.columna) },
  { titulo: 'Expediente', valor: (t) => t.expediente },
  { titulo: 'Título', valor: (t) => t.titulo },
  { titulo: 'Título corto', valor: (t) => t.titulo_corto },
  { titulo: 'Órgano', valor: (t) => t.organo },
  { titulo: 'Responsable', valor: (t) => t.responsable?.nombre },
  { titulo: 'Importe (€ sin IVA)', valor: (t) => t.importe, tipo: 'numero' },
  { titulo: 'Cierre (hora peninsular)', valor: (t) => plazo(t.fecha_limite) },
  { titulo: 'Resultado', valor: (t) => (t.resultado ? RESULTADO[t.resultado] : null) },
];

export function csvPipeline(db: Db, ahoraMs = Date.now()): string {
  return aCsv(
    DEL_PIPELINE,
    pipeline(db, ahoraMs).columnas.flatMap((c) => c.tarjetas),
  );
}

const OPINION: Record<string, string> = { interesa: 'Interesa', revisar: 'Revisar', descartar: 'Descarta' };
const DE_OPORTUNIDADES: Columna<ItemRevision>[] = [
  { titulo: 'Expediente', valor: (x) => x.expediente },
  { titulo: 'Título', valor: (x) => x.titulo },
  { titulo: 'Órgano', valor: (x) => x.organo },
  { titulo: 'Procedimiento', valor: (x) => x.procedimiento },
  { titulo: 'Importe (€ sin IVA)', valor: (x) => x.importe, tipo: 'numero' },
  { titulo: 'Cierre (hora peninsular)', valor: (x) => plazo(x.fecha_limite) },
  { titulo: 'Solicitud de participación', valor: (x) => plazo(x.fecha_solicitud) },
  { titulo: 'Opinión de Hermes', valor: (x) => OPINION[x.opinion] ?? x.opinion },
  { titulo: 'Motivo', valor: (x) => x.motivo },
  { titulo: 'Encaje (0-100)', valor: (x) => x.encaje?.valor, tipo: 'numero' },
];

/** La pestaña de Oportunidades con sus filtros, entera. */
export function csvOportunidades(db: Db, f: FiltroRevisionData, ahoraMs = Date.now()): string {
  const items: ItemRevision[] = [];
  for (let pagina = 1; items.length < MAX_FILAS; pagina += 1) {
    const r = listaRevision(db, { ...f, pagina, limite: PAGINA }, ahoraMs);
    items.push(...r.items);
    if (r.items.length < PAGINA || items.length >= r.total) break;
  }
  return aCsv(DE_OPORTUNIDADES, items.slice(0, MAX_FILAS));
}

const RESULTADO_PROPUESTA: Record<string, string> = {
  pendiente: 'Pendiente',
  ganada: 'Ganada',
  perdida: 'Perdida',
  desierta: 'Desierta',
  excluida: 'Excluida',
  retirada: 'Retirada',
};
const DE_PRESENTADAS: Columna<PropuestaConLicitacion>[] = [
  { titulo: 'Presentada el', valor: (p) => p.presentada_en.slice(0, 10) },
  { titulo: 'Expediente', valor: (p) => p.expediente },
  { titulo: 'Título', valor: (p) => p.titulo },
  { titulo: 'Órgano', valor: (p) => p.organo },
  { titulo: 'Lote', valor: (p) => p.lote || null },
  { titulo: 'Importe ofertado (€ sin IVA)', valor: (p) => p.importe_ofertado, tipo: 'numero' },
  { titulo: 'Presupuesto (€ sin IVA)', valor: (p) => p.presupuesto, tipo: 'numero' },
  { titulo: 'Baja ofertada', valor: (p) => p.baja_ofertada, tipo: 'porcentaje' },
  { titulo: 'Resultado', valor: (p) => RESULTADO_PROPUESTA[p.resultado] ?? p.resultado },
  { titulo: 'Posición', valor: (p) => p.posicion, tipo: 'numero' },
  { titulo: 'Puntos', valor: (p) => p.puntos_total, tipo: 'numero' },
  { titulo: 'Puntos del ganador', valor: (p) => p.puntos_ganador, tipo: 'numero' },
  { titulo: 'Ganador', valor: (p) => p.ganador_nombre },
  { titulo: 'Baja ganadora', valor: (p) => p.baja_ganadora, tipo: 'porcentaje' },
];

/** Lo presentado con el filtro de su vista (resultado y texto). */
export function csvPresentadas(db: Db, f: Omit<FiltroPropuestasData, 'limite'> = {}): string {
  return aCsv(DE_PRESENTADAS, listarPropuestas(db, { ...f, limite: MAX_FILAS }).items);
}

/** Un ranking entero, siguiendo su «siguiente» página a página. */
function todas<T, O extends { desde: number; limite: number }>(
  o: O,
  pagina: (o: O) => { items: T[]; siguiente: number | null },
): T[] {
  const filas: T[] = [];
  let desde: number | null = 0;
  while (desde !== null && filas.length < MAX_FILAS) {
    const r = pagina({ ...o, desde, limite: PAGINA });
    filas.push(...r.items);
    desde = r.items.length ? r.siguiente : null;
  }
  return filas.slice(0, MAX_FILAS);
}

const DE_COMPETIDORES: Columna<FilaRanking>[] = [
  { titulo: 'NIF', valor: (c) => c.nif },
  { titulo: 'Empresa', valor: (c) => c.nombre },
  { titulo: 'Contratos ganados', valor: (c) => c.contratos, tipo: 'numero' },
  { titulo: 'Importe adjudicado (€ sin IVA)', valor: (c) => c.importe, tipo: 'numero' },
  { titulo: 'Órganos', valor: (c) => c.organos, tipo: 'numero' },
  { titulo: 'Baja media', valor: (c) => c.baja_media, tipo: 'porcentaje' },
  { titulo: 'Ofertas por contrato', valor: (c) => c.ofertas_media, tipo: 'numero' },
  { titulo: 'Última adjudicación', valor: (c) => c.ultimo },
  { titulo: 'Coincidencias con lo nuestro', valor: (c) => c.coincidencias.total, tipo: 'numero' },
  { titulo: 'Seguido', valor: (c) => c.seguido },
];

export function csvCompetidores(db: Db, o: OpcionesCompetidoresData, hoy = new Date()): string {
  return aCsv(
    DE_COMPETIDORES,
    todas(o, (x) => rankingCompetidores(db, x, hoy)),
  );
}

const DE_ORGANISMOS: Columna<FilaOrganismo>[] = [
  { titulo: 'NIF', valor: (x) => x.nif },
  { titulo: 'Órgano', valor: (x) => x.nombre },
  { titulo: 'Licitaciones', valor: (x) => x.licitaciones, tipo: 'numero' },
  { titulo: 'Importe licitado (€ sin IVA)', valor: (x) => x.importe_licitado, tipo: 'numero' },
  { titulo: 'Adjudicaciones', valor: (x) => x.adjudicaciones, tipo: 'numero' },
  { titulo: 'Importe adjudicado (€ sin IVA)', valor: (x) => x.importe_adjudicado, tipo: 'numero' },
  { titulo: 'Baja media', valor: (x) => x.baja_media, tipo: 'porcentaje' },
  { titulo: 'Ofertas por contrato', valor: (x) => x.ofertas_media, tipo: 'numero' },
  { titulo: 'Adjudicatarios distintos', valor: (x) => x.adjudicatarios, tipo: 'numero' },
  { titulo: 'Oportunidades nuestras', valor: (x) => x.oportunidades, tipo: 'numero' },
  { titulo: 'Interés (0-100)', valor: (x) => x.interes.puntos, tipo: 'numero' },
  { titulo: 'Seguido', valor: (x) => x.seguido },
];

export function csvOrganismos(db: Db, o: OpcionesOrganismosData, hoy = new Date()): string {
  return aCsv(
    DE_ORGANISMOS,
    todas(o, (x) => rankingOrganismos(db, x, hoy)),
  );
}

const DE_COMPARABLES: Columna<ComparableVisible>[] = [
  { titulo: 'Licitación', valor: (c) => c.licitacion_id },
  { titulo: 'Título', valor: (c) => c.titulo },
  { titulo: 'Lote', valor: (c) => c.lote || null },
  { titulo: 'Órgano', valor: (c) => c.organo },
  { titulo: 'Mismo órgano', valor: (c) => c.mismo_organo },
  { titulo: 'Fecha', valor: (c) => c.fecha },
  { titulo: 'Ofertas', valor: (c) => c.ofertas, tipo: 'numero' },
  { titulo: 'Baja', valor: (c) => c.baja, tipo: 'porcentaje' },
  { titulo: 'Peso', valor: (c) => c.peso, tipo: 'numero' },
];

export const csvComparables = (comparables: readonly ComparableVisible[]): string => aCsv(DE_COMPARABLES, comparables);
