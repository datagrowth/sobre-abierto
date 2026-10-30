// Regla de las comprobaciones «compromiso caro no exigido».
import type { PerfilCostesData } from '../../../nucleo/perfilCostes.js';
import type { BloqueoConCoste } from './comprobaciones.js';
import { sinImportes } from './comprobacionesCoherencia.js';
import { memoriasDeTrabajo, type EntradasComprobaciones, type MemoriaEvaluada } from './comprobacionesEntradas.js';
import { claveBloqueo, huellaDe, MINUTOS_POR_ACCION, type Bloqueo, type Gravedad } from './comprobacionesTipos.js';
import type { NivelCoste } from './compromisosSolucion.js';
import {
  compromisosDetallados,
  enLaFicha,
  instruccionConjunta,
  justificacionDeFicha,
  type Aparicion,
  type ClaseCompromiso,
  type CompromisoDeFicha,
  type CompromisoDetallado,
} from './costesCompromisos.js';
import { ofertaParaLotes } from './guionLotes.js';
import type { EstadoMemoria } from './memoria.js';

// Cada añadido que pasa el umbral del perfil de costes
// es una fila de riesgo con su coste y la acción «Suavizar» (una ronda de memoria con la
// formulación barata). Lo que ya decidió la ficha de solución (exigido o «compensa») no se abre
// otra vez. Los euros y el % del presupuesto van solo en `coste`, que es de la web: el título y
// el supuesto no llevan importes ni porcentajes (con el presupuesto base, público, un % es un
// importe) y quien se lo pasa a un agente quita coste.euros y coste.resumen. Puro.

// La memoria promete kits, horas fijas o entrevistas individuales que el pliego no pedía.
/**
 * Los añadidos de la memoria juntos, igual en todas sus filas: el encabezado «Compromisos añadidos»
 * de la web. euros y presupuesto_pct son solo de la web (el agente no los recibe).
 */
export type ResumenCompromisos = {
  anadidos: number;
  caros: number;
  horas: number;
  euros: number;
  presupuesto_pct: number | null;
};
/**
 * Lo que la web enseña de una fila con coste (chip, supuesto, formulación barata y «Suavizar»).
 * Lleva euros: solo web. nivel: el de licitaciones_compromisos; toda fila pasa un umbral, así que es «alto».
 * n y pct_presupuesto, solo en la fila del total: cuántos añadidos suma y su % del presupuesto base
 * (el % es de la web: con el presupuesto, público, es un importe).
 */
export type CosteBloqueo = {
  horas: number | null;
  euros: number | null;
  supuesto: string;
  clase: ClaseCompromiso;
  criterio: string | null;
  barata: string;
  instruccion: string;
  memoria_version: number;
  apariciones: Aparicion[];
  nivel: NivelCoste;
  resumen: ResumenCompromisos;
  n?: number;
  pct_presupuesto?: number | null;
};

export const REGLA_COMPROMISO_CARO = 'compromiso_caro';
export const REGLA_COMPROMISOS_CAROS = 'compromisos_caros';

const MILES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const horasTexto = (h: number | null): string => (h ? ` (~${MILES.format(h)} h)` : '');
const minuscula = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);
// Los «se valorará» son literales y largos: en el título basta el principio (el entero va en coste.criterio).
const MAX_CRITERIO = 90;
const corto = (t: string): string =>
  t.length <= MAX_CRITERIO ? t : `${t.slice(0, MAX_CRITERIO).replace(/\s+\S*$/, '')}…`;

type Memoria = { m: EstadoMemoria; lote: string | null; texto: string; ficha: CompromisoDeFicha[] };
type Contexto = {
  e: EntradasComprobaciones;
  perfil: PerfilCostesData;
  cotejable: boolean;
  presupuesto: number | null;
  umbralEuros: number;
  resumen: ResumenCompromisos;
};

// El lote de la memoria o, si la oferta va a uno solo, ese: es el que da el presupuesto base.
function loteDelPresupuesto(e: EntradasComprobaciones, lote: string | null): string | null {
  if (lote) return lote;
  const unico = e.ambito.length === 1 ? e.ambito : (e.guion?.datos.lotes ?? []);
  return unico.length === 1 ? unico[0]! : null;
}

// Como el resumen de la memoria: el del lote, el de su oferta económica en el guion o el del contrato.
function presupuestoBase(e: EntradasComprobaciones, lote: string | null): number | null {
  const l = loteDelPresupuesto(e, lote);
  const delLote = l ? e.lotes.lotes.find((x) => x.id === l)?.presupuesto_sin_iva : null;
  const delGuion = e.guion ? ofertaParaLotes(e.guion.datos, l ? [l] : [])?.presupuesto_base : null;
  const base = delLote || delGuion || e.licitacion.presupuesto_sin_iva;
  return base && base > 0 ? base : null;
}

/** ¿Pasa el umbral? ≥ umbral_horas, o ≥ max(umbral_euros, umbral_pct × presupuesto base). */
const esCaroParaComprobaciones = (
  x: Pick<CompromisoDetallado, 'horas' | 'euros'>,
  perfil: PerfilCostesData,
  umbralEuros: number,
): boolean => (x.horas ?? 0) >= perfil.umbral_horas || (x.euros ?? 0) >= umbralEuros;

/** ¿Los añadidos juntos pasan de umbral_total_pct del presupuesto base? Lo mismo en las comprobaciones y en el resumen. */
export const totalEnRiesgo = (
  anadidos: number,
  euros: number,
  presupuesto: number | null,
  perfil: PerfilCostesData,
): boolean => presupuesto !== null && presupuesto > 0 && anadidos > 0 && euros >= perfil.umbral_total_pct * presupuesto;

function tituloFila(x: CompromisoDetallado, cotejable: boolean, quitado: boolean): string {
  const que = `La memoria promete ${minuscula(x.texto)}${horasTexto(x.horas)}`;
  if (quitado) return sinImportes(`${que}, que se quitó en la ficha de solución`);
  if (!cotejable) return sinImportes(`${que} y no se pudo cotejar con el pliego`);
  if (x.criterio) return sinImportes(`${que}: puntúa en «${corto(x.criterio)}», pero hay una forma más barata`);
  return sinImportes(`${que} y el pliego ${x.pliego ? 'pide menos' : 'no lo pide'}`);
}

const comparable = (t: string): string => t.replace(/\s+/g, ' ').trim();

function citaDe(x: CompromisoDetallado, mem: Memoria): Bloqueo['cita'] {
  const a = x.apariciones[0];
  if (!a) return null;
  const donde = a.seccion ?? a.apartado;
  const documento = `Memoria v${mem.m.version}${donde ? `, apartado ${donde}` : ''}`;
  return { documento, pagina: null, texto: a.cita, comprobada: comparable(mem.texto).includes(comparable(a.cita)) };
}

function costeDe(x: CompromisoDetallado, m: EstadoMemoria, resumen: ResumenCompromisos): CosteBloqueo {
  return {
    horas: x.horas,
    euros: x.euros,
    supuesto: x.supuesto,
    clase: x.clase,
    criterio: x.criterio,
    barata: x.barata,
    instruccion: x.instruccion,
    memoria_version: m.version,
    apariciones: x.apariciones,
    nivel: 'alto',
    resumen,
  };
}

// La clave no lleva cifras: la misma fila entre rondas aunque cambie el coste (eso lo dice la huella).
// La huella tampoco lleva la memoria: un riesgo aceptado sigue aceptado en la versión siguiente
// mientras prometa lo mismo con el mismo coste.
function filaCompromiso(x: CompromisoDetallado, mem: Memoria, c: Contexto, sujeto: string): BloqueoConCoste {
  const apartado = x.apariciones.find((a) => a.apartado !== null)?.apartado ?? null;
  const gravedad: Gravedad = c.cotejable ? 'riesgo' : 'no_comprobado';
  const quitado = enLaFicha(x, mem.ficha)?.quitado === true;
  return {
    clave: claveBloqueo(REGLA_COMPROMISO_CARO, mem.lote, sujeto),
    categoria: 'coherencia',
    lote: mem.lote,
    gravedad,
    titulo: tituloFila(x, c.cotejable, quitado),
    cita: citaDe(x, mem),
    actor: 'tu',
    accion: { tipo: 'suavizar', destino: apartado ? `memoria.apartado.${apartado}` : 'memoria' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.suavizar,
    estado: 'abierto',
    huella: huellaDe(REGLA_COMPROMISO_CARO, x.tipo, x.objeto, gravedad, quitado, x.horas, x.euros),
    coste: costeDe(x, mem.m, c.resumen),
  };
}

// Dos compromisos del mismo tipo y objeto (un informe mensual y otro semanal) no comparten clave.
function sujetos(xs: CompromisoDetallado[]): string[] {
  const vistos = new Map<string, number>();
  return xs.map((x) => {
    const base = `${x.tipo}_${x.objeto}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

const suma = (xs: CompromisoDetallado[], k: 'horas' | 'euros'): number => xs.reduce((a, x) => a + (x[k] ?? 0), 0);

// Riesgo y no impide (decisión por defecto: el responsable de la oferta puede cambiarla): un riesgo abierto ya impide «Lista para firmar».
// Cuenta todos los añadidos, también los justificados en la ficha: su coste es real.
function filaTotal(anadidos: CompromisoDetallado[], mem: Memoria, c: Contexto): BloqueoConCoste | null {
  const { horas, euros } = c.resumen;
  if (!totalEnRiesgo(anadidos.length, euros, c.presupuesto, c.perfil)) return null;
  const n = anadidos.length;
  const umbral = Math.round(c.perfil.umbral_total_pct * 100);
  const supuesto = `${n} compromisos añadidos: ${MILES.format(horas)} h y material; juntos pasan del ${umbral} % del presupuesto base del lote (Ajustes › Empresa)`;
  return {
    clave: claveBloqueo(REGLA_COMPROMISOS_CAROS, mem.lote, 'total'),
    categoria: 'coherencia',
    lote: mem.lote,
    gravedad: c.cotejable ? 'riesgo' : 'no_comprobado',
    titulo: sinImportes(
      `Los ${n} compromisos añadidos de la memoria suman ${horas ? `~${MILES.format(horas)} h` : 'material'}: coste alto frente al presupuesto base`,
    ),
    cita: null,
    actor: 'tu',
    accion: { tipo: 'suavizar', destino: 'memoria' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.suavizar,
    estado: 'abierto',
    huella: huellaDe(REGLA_COMPROMISOS_CAROS, horas, euros, c.resumen.presupuesto_pct),
    coste: {
      horas,
      euros,
      supuesto,
      clase: 'anadido',
      criterio: null,
      barata: '',
      instruccion: instruccionConjunta(anadidos),
      memoria_version: mem.m.version,
      apariciones: anadidos.flatMap((x) => x.apariciones),
      nivel: 'alto',
      resumen: c.resumen,
      n,
      pct_presupuesto: c.resumen.presupuesto_pct,
    },
  };
}

function resumenDe(anadidos: CompromisoDetallado[], caros: number, presupuesto: number | null): ResumenCompromisos {
  const euros = suma(anadidos, 'euros');
  const presupuesto_pct = presupuesto ? Math.round((euros / presupuesto) * 100) : null;
  return { anadidos: anadidos.length, caros, horas: suma(anadidos, 'horas'), euros, presupuesto_pct };
}

function filasDeMemoria(mem: Memoria, e: EntradasComprobaciones, perfil: PerfilCostesData): BloqueoConCoste[] {
  const cotejable = e.pliego_costes?.cotejable === true;
  const presupuesto = presupuestoBase(e, mem.lote);
  const umbralEuros = Math.max(perfil.umbral_euros, perfil.umbral_pct_presupuesto * (presupuesto ?? 0));
  const anadidos = compromisosDetallados(mem.texto, perfil, e.guion?.datos, e.pliego_costes).filter(
    (x) => x.clase === 'anadido',
  );
  const caros = anadidos.filter(
    (x) => esCaroParaComprobaciones(x, perfil, umbralEuros) && !justificacionDeFicha(enLaFicha(x, mem.ficha)),
  );
  const c: Contexto = {
    e,
    perfil,
    cotejable,
    presupuesto,
    umbralEuros,
    resumen: resumenDe(anadidos, caros.length, presupuesto),
  };
  const claves = sujetos(caros);
  const total = filaTotal(anadidos, mem, c);
  return [...caros.map((x, i) => filaCompromiso(x, mem, c, claves[i]!)), ...(total ? [total] : [])];
}

function memoriaConTexto(e: EntradasComprobaciones, x: MemoriaEvaluada): Memoria | null {
  const m = x.memoria;
  if (!m || m.presentada) return null;
  const t = e.textos_costes?.find((y) => y.memoria_id === m.id);
  const texto = (t?.textos ?? []).filter(Boolean).join('\n\n');
  return texto.trim() ? { m, lote: x.lote, texto, ficha: t?.ficha ?? [] } : null;
}

/** Una fila por compromiso añadido caro de cada memoria con trabajo, y la del total si pasa del umbral del presupuesto. */
export function reglaCompromisosCaros(e: EntradasComprobaciones): BloqueoConCoste[] {
  const perfil = e.perfil_costes;
  if (!perfil) return [];
  return memoriasDeTrabajo(e).flatMap((x) => {
    const mem = memoriaConTexto(e, x);
    return mem ? filasDeMemoria(mem, e, perfil) : [];
  });
}
