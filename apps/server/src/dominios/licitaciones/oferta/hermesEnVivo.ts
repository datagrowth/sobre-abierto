// HermesEnVivo: una línea por oferta con lo que Hermes hace ahora para ella.
import { contextoEta, detalleTrabajo, type DetalleTrabajo } from '../../../nucleo/colaEta.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { frenadoHasta } from '../../../nucleo/colaFrenos.js';
import { MAX_INTENTOS, type Trabajo } from '../../../nucleo/colaTipos.js';
import { pausaHastaMs } from '../../../nucleo/colaEsperas.js';
import { RELANZADO } from '../../../nucleo/colaRelanzado.js';
import { runsALaVezActual } from '../../../nucleo/trabajos.js';
import { ultimoFallo } from '../../../nucleo/colaConsultas.js';
import type { Db } from '../store.js';
import { propuestasAutoHoy, runsDeOfertaHoy } from './topes.js';

// Incluye su sitio en la cola y la hora estimada, el último fallo dicho en lenguaje legible, los topes del día y
// lo que la frena. El `nombre` legible sale de aquí para que la web no mantenga su propio mapa de tipos.
// pedido_por_hermes: lo pidió un agente con licitaciones_pedir (evento EVENTO_PEDIDO_HERMES), no una persona.
export type TrabajoEnVivo = {
  id: number;
  tipo: string;
  nombre: string;
  estado: 'en_cola' | 'generando';
  desde: string;
  pedido_por_hermes: boolean;
} & DetalleTrabajo;
type FalloEnVivo = { tipo: string; nombre: string; codigo: string | null; texto: string; en: string };
type FrenoEnVivo = { tipo: string; nombre: string; hasta: string; alcance: 'tipo' | 'oferta' };
export type HermesEnVivo = {
  trabajos: TrabajoEnVivo[];
  ultimo_fallo: FalloEnVivo | null;
  runs_hoy: number;
  tope_runs: number;
  propuestas_auto_hoy: number;
  tope_propuestas: number;
  frenos: FrenoEnVivo[];
  pausa_hasta: string | null;
};

const PREFIJO = 'licitaciones.';
/** El evento que deja licitaciones_pedir (pedirFase.ts) con el trabajo que encoló: «pedido por Hermes». */
export const EVENTO_PEDIDO_HERMES = 'licitacion.pedido_hermes';
const DIA_MS = 86_400_000;

const NOMBRE_TIPO: Record<string, string> = {
  ficha: 'Ficha',
  guion: 'Guion de la oferta',
  decisiones: 'Propuesta de decisiones',
  memoria_estrategia: 'Memoria: plan',
  memoria_redaccion: 'Memoria: redacción',
  memoria_critica: 'Memoria: crítica',
  evaluar: 'Nota de la memoria',
  lecciones: 'Lecciones de tus cambios',
  borrador: 'Borrador',
  cribar: 'Criba',
  aprender_acta: 'Lectura de actas',
  eval_juicio: 'Juicio del banco de memorias',
  resumen_competidor: 'Resumen de competidor',
  memoria_hechos: 'Memoria: hechos',
  revision_previa: 'Revisión previa del paquete',
  leer_acta_mercado: 'Acta de un expediente ajeno',
};

const FRASE_CODIGO: Record<string, string> = {
  sin_resultado: 'Hermes no dejó resultado',
  run_inactivo: 'Hermes dejó de responder',
  run_tiempo_maximo: 'tardó más del máximo',
  run_perdido: 'Hermes se reinició',
  limite_uso: 'se agotó el uso del modelo',
  sin_herramienta: 'falta una herramienta en Hermes',
  consulta_fallida: 'no se pudo consultar a Hermes',
  relanzado: 'se relanzó',
  herramientas_desfasadas: 'Hermes tiene herramientas antiguas: hay que reiniciarlo',
};

// Esperas que no son fallos del trabajo: ya se ven en motivo_espera y pausa_hasta, y como
// «último fallo» dirían que algo falló cuando solo espera (al uso del modelo, a que se reinicie
// Hermes) o una persona lo relanzó.
const ESPERAS = new Set(['limite_uso', 'herramientas_desfasadas']);
const esFallo = (t: Trabajo): boolean =>
  t.codigo !== null && !ESPERAS.has(t.codigo) && !(t.codigo === 'relanzado' && t.error?.startsWith(RELANZADO));

function payloadDe(payload: string): Record<string, unknown> {
  try {
    const p = JSON.parse(payload) as unknown;
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Nombre legible de un trabajo de la oferta: el apartado y la clave del anexo salen del payload. */
export function nombreTrabajo(tipo: string, payload: string): string {
  const corto = tipo.startsWith(PREFIJO) ? tipo.slice(PREFIJO.length) : tipo;
  const p = payloadDe(payload);
  // Sin payload (los avisos de un tipo entero) se nombra el tipo: «Memoria: apartados», «Anexos».
  if (corto === 'memoria_apartado')
    return typeof p['apartado'] === 'number' ? `Memoria: apartado ${p['apartado']}` : 'Memoria: apartados';
  if (corto === 'anexo') return typeof p['clave'] === 'string' ? `Anexo ${p['clave']}` : 'Anexos';
  return NOMBRE_TIPO[corto] ?? corto;
}

const horaPeninsular = (iso: string): string => horaLocalEspana(Date.parse(iso)).slice(11, 16);

/** «falló 2 de 3: Hermes no dejó resultado; reintento a las 16:05» (hora peninsular). */
export function textoFallo(codigo: string | null, intentos: number, proximo: string | null): string {
  const frase = FRASE_CODIGO[codigo ?? ''] ?? 'error de Hermes';
  const cuenta = intentos > 0 ? `falló ${intentos} de ${MAX_INTENTOS}: ` : '';
  const reintento =
    proximo && Number.isFinite(Date.parse(proximo)) ? `; reintento a las ${horaPeninsular(proximo)}` : '';
  return `${cuenta}${frase}${reintento}`;
}

function vivosDe(dbNucleo: DbNucleo, id: string): Trabajo[] {
  return dbNucleo
    .prepare(
      `SELECT * FROM trabajos_ia WHERE dominio = 'licitaciones' AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? ORDER BY id`,
    )
    .all(id) as Trabajo[];
}

/** Solo los trabajos vivos de la oferta con su hora estimada (lo que la Mesa resume en una línea). */
export function trabajosVivosDe(dbNucleo: DbNucleo, id: string, ahoraMs = Date.now()): TrabajoEnVivo[] {
  return trabajosEnVivo(dbNucleo, id, vivosDe(dbNucleo, id), ahoraMs);
}

/** Los trabajos de la oferta `id` que pidió Hermes (licitaciones_pedir), por el evento que dejó al pedirlos. */
export function pedidosPorHermes(dbNucleo: DbNucleo, id: string): Set<number> {
  const filas = dbNucleo
    .prepare("SELECT json_extract(datos, '$.trabajo') AS trabajo FROM eventos WHERE tipo = ? AND recurso = ?")
    .all(EVENTO_PEDIDO_HERMES, id) as { trabajo: unknown }[];
  return new Set(filas.flatMap((f) => (typeof f.trabajo === 'number' ? [f.trabajo] : [])));
}

function trabajosEnVivo(dbNucleo: DbNucleo, id: string, vivos: Trabajo[], ahoraMs: number): TrabajoEnVivo[] {
  if (!vivos.length) return [];
  const ctx = contextoEta(dbNucleo, ahoraMs, runsALaVezActual());
  const deHermes = pedidosPorHermes(dbNucleo, id);
  return vivos.map((t) => ({
    id: t.id,
    tipo: t.tipo,
    nombre: nombreTrabajo(t.tipo, t.payload),
    estado: t.estado === 'lanzado' ? 'generando' : 'en_cola',
    desde: t.actualizado_en,
    pedido_por_hermes: deHermes.has(t.id),
    ...detalleTrabajo(dbNucleo, t, ctx),
  }));
}

// Un vivo con código de fallo ya falló al menos una vez y aún tiene reintento; uno fallido del
// todo en las últimas 24 h sale de ultimoFallo (que lo calla si después se completó); con MAX,
// SQLite da el payload de la fila más reciente de cada tipo (el apartado o el anexo que falló).
function fallosVivos(vivos: Trabajo[]): FalloEnVivo[] {
  return vivos.filter(esFallo).map((t) => ({
    tipo: t.tipo,
    nombre: nombreTrabajo(t.tipo, t.payload),
    codigo: t.codigo,
    en: t.actualizado_en,
    texto: textoFallo(t.codigo, t.intentos, t.proximo_intento_en),
  }));
}

function fallosFinales(dbLic: Db, dbNucleo: DbNucleo, id: string, ahoraMs: number): FalloEnVivo[] {
  const filas = dbNucleo
    .prepare(
      `SELECT tipo, payload, MAX(actualizado_en) AS en FROM trabajos_ia WHERE dominio = 'licitaciones' AND estado = 'fallido'
    AND json_extract(payload, '$.id') = ? AND actualizado_en >= ? GROUP BY tipo`,
    )
    .all(id, new Date(ahoraMs - DIA_MS).toISOString()) as { tipo: string; payload: string }[];
  return filas.flatMap((f) => {
    const u = ultimoFallo(dbLic, f.tipo, id, ahoraMs);
    return u
      ? [
          {
            tipo: f.tipo,
            nombre: nombreTrabajo(f.tipo, f.payload),
            codigo: u.codigo,
            en: u.en,
            texto: textoFallo(u.codigo, u.intentos, null),
          },
        ]
      : [];
  });
}

function ultimoDe(fallos: FalloEnVivo[]): FalloEnVivo | null {
  return fallos.reduce<FalloEnVivo | null>((m, f) => (m === null || f.en > m.en ? f : m), null);
}

// Solo los tipos que alguna vez trabajaron para una oferta: un tipo sin fallos no puede estar frenado.
function frenosDe(dbNucleo: DbNucleo, id: string, ahoraMs: number): FrenoEnVivo[] {
  const tipos = dbNucleo
    .prepare(
      `SELECT DISTINCT tipo FROM trabajos_ia WHERE dominio = 'licitaciones'
    AND json_extract(payload, '$.id') IS NOT NULL ORDER BY tipo`,
    )
    .all() as { tipo: string }[];
  return tipos.flatMap(({ tipo }) => {
    const hasta = frenadoHasta(dbNucleo, tipo, ahoraMs, id);
    if (hasta === null) return [];
    const alcance = frenadoHasta(dbNucleo, tipo, ahoraMs) === null ? ('oferta' as const) : ('tipo' as const);
    return [{ tipo, nombre: nombreTrabajo(tipo, '{}'), hasta, alcance }];
  });
}

/** Lo que Hermes hace ahora para la oferta `id`, con su último fallo, sus topes y sus frenos. */
export function hermesEnVivo(dbLic: Db, dbNucleo: DbNucleo, id: string, ahoraMs = Date.now()): Result<HermesEnVivo> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const { runsOfertaDia, propuestasDia } = nucleo().config.licitaciones;
  const vivos = vivosDe(dbNucleo, id);
  const pausa = pausaHastaMs(dbNucleo, ahoraMs);
  return ok({
    trabajos: trabajosEnVivo(dbNucleo, id, vivos, ahoraMs),
    ultimo_fallo: ultimoDe([...fallosVivos(vivos), ...fallosFinales(dbLic, dbNucleo, id, ahoraMs)]),
    runs_hoy: runsDeOfertaHoy(dbNucleo, id, ahoraMs, dbLic),
    tope_runs: runsOfertaDia,
    propuestas_auto_hoy: propuestasAutoHoy(dbNucleo, id, ahoraMs),
    tope_propuestas: propuestasDia,
    frenos: frenosDe(dbNucleo, id, ahoraMs),
    pausa_hasta: pausa > ahoraMs ? new Date(pausa).toISOString() : null,
  });
}
