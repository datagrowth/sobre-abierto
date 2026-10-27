// Reglas de decisiones de las comprobaciones: acogerse sin acreditar, piezas con otro guion, precio y lo sin fijar.
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { automaticosContradictorios, type AutomaticoContradictorio } from './automaticosHonestos.js';
import { memoriasDeTrabajo, type EntradasComprobaciones } from './comprobacionesEntradas.js';
import { sinImportes } from './comprobacionesCoherencia.js';
import {
  MINUTOS_POR_ACCION,
  claveBloqueo,
  huellaDe,
  type AccionBloqueo,
  type Actor,
  type Bloqueo,
  type Categoria,
  type Gravedad,
} from './comprobacionesTipos.js';
import { claveCriterio } from './guionLotes.js';

// Cubren acogerse sin acreditar o contra la nota, piezas hechas con otro guion (propuesta, decisiones, memoria,
// cada una con su clave), una propuesta nueva sin mirar, el precio de cada lote y las decisiones sin fijar.
// Sustituyen a automaticos_sin_acreditar y precio_lotes de la coherencia (el adaptador los excluye).
type Fila = {
  regla: string;
  lote?: string | null;
  sujeto?: string;
  categoria?: Categoria;
  gravedad: Gravedad;
  titulo: string;
  actor: Actor;
  accion: AccionBloqueo;
  destino: string;
  huella: unknown[];
};

function fila(f: Fila): Bloqueo {
  const lote = f.lote ?? null;
  return {
    clave: claveBloqueo(f.regla, lote, f.sujeto),
    categoria: f.categoria ?? 'decisiones',
    lote,
    gravedad: f.gravedad,
    titulo: sinImportes(f.titulo),
    cita: null,
    actor: f.actor,
    accion: { tipo: f.accion, destino: f.destino },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION[f.accion],
    estado: 'abierto',
    huella: huellaDe(f.regla, lote, f.gravedad, f.titulo, ...f.huella),
  };
}

const recorte = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

function tituloAcogido(c: AutomaticoContradictorio): string {
  const criterio = `«${recorte(c.criterio, 90)}»${c.lote ? ` (lote ${c.lote})` : ''}`;
  if (c.motivo === 'nota_contraria') return `Te acoges a ${criterio} y tu nota dice que no`;
  return `Te acoges a ${criterio} sin con qué acreditarlo${c.exige ? ` (pide: ${recorte(c.exige, 120)})` : ''}`;
}

// La propuesta de Hermes solo acredita algo si es del guion de ahora: la de otro guion puede hablar de otro criterio.
function deAcogidos(e: EntradasComprobaciones): Bloqueo[] {
  if (!e.guion || !e.decisiones) return [];
  const propuesta = e.propuesta?.guion_id === e.guion.id ? e.propuesta : null;
  return automaticosContradictorios(e.decisiones.datos, e.guion.datos, propuesta).map((c) =>
    fila({
      regla: 'nos_acogemos',
      lote: c.lote,
      sujeto: claveCriterio(c.criterio),
      gravedad: 'impide',
      titulo: tituloAcogido(c),
      actor: 'tu',
      accion: 'desmarcar_criterio',
      destino: `automatico:${c.criterio}|${c.lote ?? ''}`,
      huella: [c.motivo, c.exige],
    }),
  );
}

function propuestaObsoleta(e: EntradasComprobaciones, vigente: number): Bloqueo[] {
  const deGuion = e.propuesta?.guion_id;
  if (deGuion === undefined || deGuion === vigente) return [];
  return [
    fila({
      regla: 'propuesta_obsoleta',
      gravedad: 'riesgo',
      titulo: `La propuesta de Hermes es del guion v${deGuion} (vigente v${vigente})`,
      actor: 'hermes',
      accion: 'esperar_hermes',
      destino: 'propuesta',
      huella: [deGuion, vigente],
    }),
  ];
}

function decisionesObsoletas(e: EntradasComprobaciones, vigente: number): Bloqueo[] {
  const deGuion = e.decisiones?.guion_id;
  if (deGuion === undefined || deGuion === vigente) return [];
  return [
    fila({
      regla: 'decisiones_obsoletas',
      gravedad: 'riesgo',
      titulo: `Tus decisiones son del guion v${deGuion} (vigente v${vigente}): revísalas`,
      actor: 'tu',
      accion: 'aplicar_diff',
      destino: 'decisiones',
      huella: [deGuion, vigente],
    }),
  ];
}

// Solo impide si la memoria está por revisar: darla por buena sería aprobar texto de otro guion.
// Con memoria por lote, una fila por lote (memoria_obsoleta:<lote>), como el MCP.
function memoriaObsoleta(e: EntradasComprobaciones, vigente: number): Bloqueo[] {
  return memoriasDeTrabajo(e).flatMap(({ memoria: m, lote }) => {
    // La presentada no se rehace: que sea de otro guion ya no tiene arreglo.
    if (!m || m.presentada || m.guion_id === vigente) return [];
    const porRevisar = m.borrador?.estado === 'pendiente';
    const v = `v${m.version}${lote ? ` (lote ${lote})` : ''}`;
    return [
      fila({
        regla: 'memoria_obsoleta',
        lote,
        gravedad: porRevisar ? 'impide' : 'riesgo',
        titulo: porRevisar
          ? `La ${v} es de un guion anterior: no la des por buena`
          : `La memoria ${v} es de un guion anterior (v${m.guion_id}; vigente v${vigente})`,
        actor: 'tu',
        accion: 'revisar_memoria',
        destino: 'memoria',
        huella: [m.id, m.guion_id, vigente],
      }),
    ];
  });
}

// Una propuesta del mismo guion llegada después de guardar: puede traer algo que no se ha mirado.
function propuestaPosterior(e: EntradasComprobaciones, vigente: number): Bloqueo[] {
  const p = e.propuesta;
  const d = e.decisiones;
  if (!p || !d || p.guion_id !== vigente || d.guion_id !== vigente || p.creada_en <= d.actualizada_en) return [];
  return [
    fila({
      regla: 'propuesta_posterior',
      gravedad: 'riesgo',
      titulo: 'Hermes propuso cambios después de tus decisiones',
      actor: 'tu',
      accion: 'aplicar_diff',
      destino: 'propuesta',
      huella: [p.creada_en, d.actualizada_en],
    }),
  ];
}

function deGuionDistinto(e: EntradasComprobaciones): Bloqueo[] {
  if (!e.guion) return [];
  const vigente = e.guion.id;
  return [
    ...propuestaObsoleta(e, vigente),
    ...decisionesObsoletas(e, vigente),
    ...memoriaObsoleta(e, vigente),
    ...propuestaPosterior(e, vigente),
  ];
}

const DIA_MS = 86_400_000;
const DIAS_PARA_IMPEDIR = 5;
const diaUtc = (fecha: string): number => Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`);

// Días de calendario peninsular hasta el plazo (el jueves 15 visto el miércoles 14 es 1), o null sin plazo.
export function diasHastaPlazo(fechaLimite: string | null, ahoraMs: number): number | null {
  if (!fechaLimite || !/^\d{4}-\d{2}-\d{2}/.test(fechaLimite)) return null;
  return Math.round((diaUtc(fechaLimite) - diaUtc(horaLocalEspana(ahoraMs))) / DIA_MS);
}

// Un importe vacío con «pendiente» desmarcado tampoco es un precio decidido (se puede
// guardar así), como en preparacion.ts. El único predicado: lo usan la regla, las fases, lo
// comprobado y el MCP, para que la persona y el agente vean lo mismo.
export function precioDecidido(e: Pick<EntradasComprobaciones, 'decisiones'>, lote: string | null): boolean {
  const ofertas = e.decisiones?.datos.ofertas ?? [];
  return ofertas.some(
    (o) => (o.lote === lote || o.lote === null) && !o.pendiente && (o.importe !== null || o.unitarios.length > 0),
  );
}

/** Precio de cada lote del ámbito (o del contrato entero) decidido, mirado en las decisiones. */
export function preciosDecididos(e: Pick<EntradasComprobaciones, 'decisiones' | 'ambito'>): boolean {
  if (!e.decisiones?.datos.ofertas.length) return false;
  return e.ambito.length ? e.ambito.every((lote) => precioDecidido(e, lote)) : precioDecidido(e, null);
}

// Sin plazo conocido no se puede decir que ya no da tiempo: queda en riesgo.
function dePrecio(e: EntradasComprobaciones): Bloqueo[] {
  if (!e.guion) return [];
  const dias = diasHastaPlazo(e.licitacion.fecha_limite, e.ahoraMs);
  const gravedad: Gravedad = dias !== null && dias < DIAS_PARA_IMPEDIR ? 'impide' : 'riesgo';
  const lotes: (string | null)[] = e.ambito.length ? e.ambito : [null];
  return lotes
    .filter((lote) => !precioDecidido(e, lote))
    .map((lote) =>
      fila({
        regla: 'precio',
        lote,
        categoria: 'precio',
        gravedad,
        titulo: lote ? `Precio del lote ${lote} sin decidir` : 'Precio sin decidir',
        actor: 'tu',
        accion: 'fijar_precio',
        destino: `precio-lote-${lote ?? 'unico'}`,
        huella: [],
      }),
    );
}

function sinDecisiones(e: EntradasComprobaciones): Bloqueo[] {
  if (!e.guion || e.decisiones) return [];
  return [
    fila({
      regla: 'decisiones_falta',
      gravedad: 'impide',
      titulo: 'Decisiones sin fijar',
      actor: 'tu',
      accion: 'aplicar_diff',
      destino: 'decisiones',
      huella: [],
    }),
  ];
}

// Unas decisiones guardadas por secciones pueden no decidir aún los automáticos o el equipo: así
// no están fijadas, y el anexo de criterios no puede rellenarse a ciegas.
function incompletas(e: EntradasComprobaciones): Bloqueo[] {
  const problemas = e.decisiones_incompletas ?? [];
  if (!e.guion || !e.decisiones || !problemas.length) return [];
  const mas = problemas.length > 1 ? ` (y ${problemas.length - 1} más)` : '';
  return [
    fila({
      regla: 'decisiones_incompletas',
      gravedad: 'impide',
      titulo: `Decisiones incompletas: ${recorte(problemas[0]!, 200)}${mas}`,
      actor: 'tu',
      accion: 'aplicar_diff',
      destino: 'decisiones',
      huella: problemas,
    }),
  ];
}

export function reglasDecisiones(e: EntradasComprobaciones): Bloqueo[] {
  return [...deAcogidos(e), ...deGuionDistinto(e), ...dePrecio(e), ...sinDecisiones(e), ...incompletas(e)];
}
