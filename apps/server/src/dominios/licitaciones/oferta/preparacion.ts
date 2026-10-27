// Lo que falta para presentar una oferta en preparación, para «Hoy». Solo lee.
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db } from '../store.js';
import { comprobacionesDeEntradas } from './comprobaciones.js';
import { leerEntradasComprobaciones, type EntradasComprobaciones } from './comprobacionesEntradas.js';
import { faseDeBloqueo } from './comprobacionesFases.js';
import type { Bloqueo, Comprobaciones, Categoria, Fase, NombreFase } from './comprobacionesTipos.js';
import { decisionesDe, lotesDecididos } from './decisiones.js';
import type { GuionGuardado } from './guion.js';
import { memoriaDeOtroGuion } from './memoria.js';
import { lotesDeMemoria } from './memoriaLote.js';
import { cierreDe } from './memoriaPresentada.js';
import { primerBloqueoAbierto } from './ofertaAgente.js';

// Sale de las comprobaciones, para que Hoy, la lista, la cabecera y el MCP digan lo mismo y en el mismo orden.
// Primero las filas abiertas de las comprobaciones («Categoría: título»); después, lo que ninguna fila cubre
// porque aún no se ha hecho (guion, memoria, paquete), en el orden de las fases.
type UltimaMemoria = {
  version: number;
  estado: string;
  guion_id: number;
  revision: string | null;
  fase: string | null;
  ronda: number;
};

// En qué fase está: «Hermes redacta la vN (plan y crítico: crítica, ronda 1)».
const FASE_DE_MEMORIA: Record<string, string> = {
  dossier: 'dossier',
  estrategia: 'estrategia',
  ficha: 'ficha de solución pendiente de revisión',
  redaccion: 'redacción',
  critica: 'crítica',
  fin: 'ensamblado',
};
const detalleFase = (m: UltimaMemoria) =>
  m.fase !== null
    ? ` (plan y crítico: ${FASE_DE_MEMORIA[m.fase ?? ''] ?? m.fase}${m.ronda ? `, ronda ${m.ronda}` : ''})`
    : '';

// La última versión de la memoria de la oferta; con lote, la de ese lote (memoriaLote.ts).
function ultimaMemoria(db: Db, id: string, lote: string | null): UltimaMemoria | undefined {
  const delLote = lote === null ? '' : 'AND m.lote = ?';
  return db
    .prepare(
      `SELECT m.version, m.estado, m.guion_id, m.fase, m.ronda, b.estado AS revision FROM memorias m LEFT JOIN borradores b ON b.id = m.borrador_id
    WHERE m.licitacion_id = ? AND m.ensayo = 0 ${delLote} ORDER BY m.version DESC LIMIT 1`,
    )
    .get(id, ...(lote === null ? [] : [lote])) as UltimaMemoria | undefined;
}

// «Memoria técnica: …» o, con memoria por lote, «Memoria técnica del lote 2: …»; null si está hecha.
function estadoMemoria(db: Db, g: GuionGuardado, m: UltimaMemoria | undefined): string | null {
  if (!m) return 'sin redactar';
  const v = `v${m.version}`;
  if (m.estado === 'redactando' || m.estado === 'ensamblando') return `Hermes redacta la ${v}${detalleFase(m)}`;
  if (m.estado === 'fallida') return `falló el montaje de la ${v}`;
  // Antes de mirar la revisión: una sin revisar de otro guion no se da por buena; una aceptada solo
  // cae si el guion vigente pide otra memoria (memoriaDeOtroGuion).
  if (memoriaDeOtroGuion(db, { guion_id: m.guion_id, aceptada: m.revision === 'aceptada' }, g))
    return `la ${v} es de un guion anterior: pide una nueva`;
  if (m.revision === 'aceptada') return null;
  return m.revision === 'descartada' ? `descartaste la ${v}` : `revisa la ${v} y dala por buena`;
}

// Hecha cuando una persona da por buena la última versión, redactada con el guion vigente. Una de
// ensayo no es la memoria de la oferta: ni la hace ni la deja a medias. Si el pliego pide una
// memoria por lote, una línea por cada lote decidido. Presentada la oferta, o subida la memoria
// presentada de ese lote (o la común), no falta nada de él: lo entregado no cambia.
export function faltaMemoria(db: Db, id: string, g: GuionGuardado): string[] {
  if (!g.datos.memoria) return [];
  const cerrado = cierreDe(db, id);
  const lotes = lotesDeMemoria(g.datos, lotesDecididos(db, id, decisionesDe(db, id)?.datos.lotes ?? [])) ?? [null];
  return lotes.flatMap((lote) => {
    if (cerrado(lote)) return [];
    const falta = estadoMemoria(db, g, ultimaMemoria(db, id, lote));
    return falta === null ? [] : [`Memoria técnica${lote === null ? '' : ` del lote ${lote}`}: ${falta}`];
  });
}

const CATEGORIA: Record<Categoria, string> = {
  elegibilidad: 'Elegibilidad',
  precio: 'Precio',
  decisiones: 'Decisiones',
  coherencia: 'Coherencia',
  fugas: 'Fugas entre sobres',
  documentos: 'Documentos',
  empresa: 'Empresa',
  firma: 'Firma',
  plazo: 'Hitos del plazo',
};

// Lo que aún no se ha hecho y ninguna fila dice, por fase y estado. La memoria va aparte (faltaMemoria).
const POR_FASE: Partial<Record<NombreFase, Partial<Record<Fase['estado'], string>>>> = {
  guion: { en_curso: 'Guion: Hermes lo está sacando del pliego', pendiente: 'Guion: pídelo con «Extraer del pliego»' },
  decisiones: { en_curso: 'Decisiones: Hermes las está proponiendo', te_toca: 'Decisiones: revísalas y guárdalas' },
  documentos: { en_curso: 'Documentos: Hermes rellena los anexos', te_toca: 'Documentos: prepara los de la checklist' },
};

// El mismo criterio que el primer bloqueo de la Mesa y del MCP: así falta[0] es siempre ese.
const abiertas = (c: Comprobaciones): Bloqueo[] => c.bloqueos.filter((b) => primerBloqueoAbierto([b]) !== null);

function deLasFases(c: Comprobaciones, filas: readonly Bloqueo[]): string[] {
  const conFila = new Set(filas.map(faseDeBloqueo));
  return c.fases.flatMap((f) => {
    const texto = conFila.has(f.nombre) ? undefined : POR_FASE[f.nombre]?.[f.estado];
    return texto ? [texto] : [];
  });
}

// La memoria de otro guion ya la dice su fila (memoria_obsoleta): no se repite con otras palabras.
function deLaMemoria(db: Db, e: EntradasComprobaciones, filas: readonly Bloqueo[]): string[] {
  if (!e.guion || filas.some((b) => b.clave.startsWith('memoria_obsoleta:'))) return [];
  return faltaMemoria(db, e.id, e.guion);
}

// El último paso: sin paquete se pide cuando todo lo demás está; uno desfasado o con bloqueos se
// dice siempre (se generó y ya no sirve tal cual).
function delPaquete(e: EntradasComprobaciones, loDemasHecho: boolean): string[] {
  const p = e.paquete;
  if (!p) return loDemasHecho && e.guion ? ['Paquete: prepara el paquete de presentación (paso 4)'] : [];
  if (p.desfasado) return [`Paquete: la v${p.version} está desfasada; vuelve a prepararlo`];
  return p.bloqueos
    ? [`Paquete: la v${p.version} tiene ${p.bloqueos} ${p.bloqueos === 1 ? 'bloqueo' : 'bloqueos'}`]
    : [];
}

function faltaDeComprobaciones(db: Db, e: EntradasComprobaciones, c: Comprobaciones): string[] {
  const filas = abiertas(c);
  const resto = [
    ...filas.map((b) => `${CATEGORIA[b.categoria]}: ${b.titulo}`),
    ...deLasFases(c, filas),
    ...deLaMemoria(db, e, filas),
  ];
  return [...resto, ...delPaquete(e, resto.length === 0)];
}

type Vista = { e: EntradasComprobaciones; comprobaciones: Comprobaciones };

function vistaDe(db: Db, id: string, ahoraMs: number): Vista | null {
  const e = leerEntradasComprobaciones(db, nucleo().db, id, ahoraMs);
  if (e.error) return null;
  return { e: e.data, comprobaciones: comprobacionesDeEntradas(db, e.data) };
}

/**
 * Lo que falta para presentar la oferta, en el orden de las comprobaciones; vacío si todo está preparado.
 * Si las comprobaciones no se pueden leer (ya registrado en comprobacionesEntradas) se dice, en vez de darla por preparada.
 */
export function faltaDePreparacion(db: Db, id: string, ahoraMs: number = Date.now()): string[] {
  const v = vistaDe(db, id, ahoraMs);
  if (!v) return ['No se pudo calcular qué falta; abre las comprobaciones para verlo'];
  return faltaDeComprobaciones(db, v.e, v.comprobaciones);
}

export type ResumenComprobaciones = {
  veredicto: Comprobaciones['veredicto'];
  primer_bloqueo: { clave: string; titulo: string } | null;
};

/** El veredicto y el primer bloqueo de las comprobaciones, para la lista; null si no se puede leer. */
export function resumenDeComprobaciones(
  db: Db,
  id: string,
  ahoraMs: number = Date.now(),
): ResumenComprobaciones | null {
  const v = vistaDe(db, id, ahoraMs);
  if (!v) return null;
  const primero = primerBloqueoAbierto(v.comprobaciones.bloqueos);
  return {
    veredicto: v.comprobaciones.veredicto,
    primer_bloqueo: primero ? { clave: primero.clave, titulo: primero.titulo } : null,
  };
}
