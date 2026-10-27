// Histórico de la PLACSP (ZIP por año, o por mes desde 2018): qué años se han pedido, cómo van y qué se guarda.
import { z } from 'zod';
import { leerPerfilEmpresa } from '../../nucleo/empresa.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { borradas, entradas } from './placsp/atom.js';
import { ESTADOS_ABIERTOS } from './placsp/codigos.js';
import { FUENTES, type Fuente, type FuenteId } from './placsp/fuentes.js';
import { mapearEntrada, type LicitacionData } from './placsp/mapper.js';
import { leerFiltros, normalizar } from './prefiltro.js';
import { guardarOrganizaciones } from './sincronizar.js';
import { guardarLicitacion, marcarBorrada, type Db } from './store.js';

// Para no llenar el disco solo entra lo del sector (CPV de los filtros o del perfil de empresa, o palabra
// clave), salvo que se pida guardarlo todo. Lo cerrado sirve para precios y competidores; lo que sigue abierto
// y en plazo pasa por el prefiltro igual que lo del feed (el filtro de estado y plazo ya deja fuera lo cerrado).
// Antes de 2018 la PLACSP solo publica el ZIP anual.
const MENSUALES_DESDE = 2018;

export const ESTADOS_HISTORICO = ['pendiente', 'descargando', 'procesando', 'hecho', 'error'] as const;
type EstadoHistorico = (typeof ESTADOS_HISTORICO)[number];

export type FilaHistorico = {
  fuente: FuenteId;
  anio: number;
  estado: EstadoHistorico;
  piezas_total: number;
  piezas_hechas: number;
  atoms_hechos: number;
  bytes: number;
  entradas: number;
  guardadas: number;
  fuera_de_sector: number;
  errores: number;
  error: string | null;
  pedido_en: string;
  actualizado_en: string;
  terminado_en: string | null;
};

const anioActual = (hoy: Date) => hoy.getUTCFullYear();

export const PedidoHistorico = z
  .object({
    desde: z.number().int().min(2012).max(2100),
    hasta: z.number().int().min(2012).max(2100).optional(),
    fuentes: z
      .array(z.enum(['perfiles', 'agregadas']))
      .min(1)
      .max(2)
      .default(['perfiles', 'agregadas']),
    repetir: z.boolean().default(false).describe('Volver a cargar también los años ya hechos'),
  })
  .refine((p) => p.hasta === undefined || p.hasta >= p.desde, 'hasta debe ser igual o posterior a desde');
export type PedidoHistoricoData = z.infer<typeof PedidoHistorico>;

/**
 * URLs de los ZIP de un año: uno por mes o el anual. Del año en curso, solo los meses
 * cerrados: el ZIP del mes en curso se rehace cada madrugada (y el día 1 puede no existir
 * aún), y lo de este mes ya lo trae el feed en vivo.
 */
export function piezasDe(fuente: Fuente, anio: number, hoy = new Date()): string[] {
  if (anio < MENSUALES_DESDE) return [fuente.zipAnual(anio)];
  const meses = anio === anioActual(hoy) ? hoy.getUTCMonth() : 12;
  return Array.from({ length: meses }, (_, i) => fuente.zipMensual(anio, i + 1));
}

function aniosPedidos(p: PedidoHistoricoData, fuente: Fuente, hoy: Date): number[] {
  const hasta = Math.min(p.hasta ?? anioActual(hoy), anioActual(hoy));
  const desde = Math.max(p.desde, fuente.primerAnio);
  return Array.from({ length: Math.max(0, hasta - desde + 1) }, (_, i) => desde + i);
}

// Contadores de progreso de un año: al reabrirlo se conservan, salvo con `repetir`
// sobre un año hecho, que empieza de cero.
const PROGRESO = ['piezas_hechas', 'atoms_hechos', 'bytes', 'entradas', 'guardadas', 'fuera_de_sector', 'errores'];
const REINICIAR = "historico_estado.estado = 'hecho' AND @repetir = 1";
const PEDIR = `INSERT INTO historico_estado (fuente, anio, estado, piezas_total, pedido_en, actualizado_en)
  VALUES (@fuente, @anio, 'pendiente', @piezas, @ts, @ts) ON CONFLICT(fuente, anio) DO UPDATE SET estado = 'pendiente',
    piezas_total = excluded.piezas_total, error = NULL, pedido_en = excluded.pedido_en,
    actualizado_en = excluded.actualizado_en, terminado_en = NULL,
    ${PROGRESO.map((c) => `${c} = CASE WHEN ${REINICIAR} THEN 0 ELSE ${c} END`).join(', ')}
  WHERE historico_estado.estado = 'error'
    OR (historico_estado.estado = 'hecho' AND (@repetir = 1 OR excluded.piezas_total > historico_estado.piezas_total))`;

/**
 * Deja pendientes los años pedidos. Lo que falló se reintenta siempre y sigue por la
 * pieza en la que se quedó; lo hecho se reabre si han salido meses nuevos (sigue por
 * ellos) o con `repetir` (de cero); lo que está en marcha no se toca.
 */
export function pedirHistorico(db: Db, p: PedidoHistoricoData, hoy = new Date()): Result<{ pedidos: number }> {
  if (p.desde > anioActual(hoy)) return fail('invalid_input', `No hay histórico de ${p.desde} todavía.`);
  const ts = hoy.toISOString();
  const insertar = db.prepare(PEDIR);
  let pedidos = 0;
  db.transaction(() => {
    for (const fuente of p.fuentes) {
      for (const anio of aniosPedidos(p, FUENTES[fuente], hoy)) {
        const piezas = piezasDe(FUENTES[fuente], anio, hoy).length;
        // En enero el año en curso aún no tiene ningún mes cerrado.
        if (piezas > 0) pedidos += insertar.run({ fuente, anio, piezas, ts, repetir: Number(p.repetir) }).changes;
      }
    }
  })();
  return ok({ pedidos });
}

export function listarHistorico(db: Db): FilaHistorico[] {
  return db.prepare('SELECT * FROM historico_estado ORDER BY anio DESC, fuente').all() as FilaHistorico[];
}

/** Lo que quedó a medias primero (se reanuda); después lo pendiente, del año más reciente al más antiguo. */
export function siguienteHistorico(db: Db): FilaHistorico | null {
  const fila = db
    .prepare(
      `SELECT * FROM historico_estado WHERE estado IN ('descargando', 'procesando', 'pendiente')
    ORDER BY CASE estado WHEN 'pendiente' THEN 1 ELSE 0 END, anio DESC, fuente LIMIT 1`,
    )
    .get() as FilaHistorico | undefined;
  return fila ?? null;
}

export function resumenHistorico(db: Db): { anios: FilaHistorico[]; por_estado: Record<string, number> } {
  const anios = listarHistorico(db);
  const por_estado: Record<string, number> = {};
  for (const a of anios) por_estado[a.estado] = (por_estado[a.estado] ?? 0) + 1;
  return { anios, por_estado };
}

export type Sector = { todo: boolean; cpvs: string[]; palabras: string[] };

/** Qué es «del sector»: CPV de los filtros y del perfil de empresa, y las palabras clave. */
export function sectorActual(db: Db, todo: boolean): Sector {
  const filtros = leerFiltros(db);
  const perfil = leerPerfilEmpresa(db)?.perfil;
  const cpvs = [...new Set([...filtros.cpv_prefijos, ...(perfil?.cpv_experiencia ?? [])])];
  return { todo, cpvs, palabras: filtros.palabras.map(normalizar) };
}

export function esDelSector(s: Sector, l: Pick<LicitacionData, 'cpvs' | 'lotes' | 'titulo'>): boolean {
  if (s.todo) return true;
  const cpvs = [...l.cpvs, ...l.lotes.flatMap((x) => x.cpvs)];
  if (s.cpvs.some((p) => cpvs.some((c) => c.startsWith(p)))) return true;
  const titulo = normalizar(l.titulo);
  return s.palabras.some((p) => titulo.includes(p));
}

export type Cuenta = { entradas: number; guardadas: number; fuera_de_sector: number; errores: number };
/** abiertas: ids guardados que siguen publicados, para pasarles el prefiltro. */
export type AtomProcesado = Cuenta & { abiertas: string[] };

/**
 * Guarda las entradas de un .atom del histórico (gana la versión más reciente). Lo que ya
 * está en la base se actualiza aunque no sea del sector: puede ser una que sigue la empresa.
 */
export function procesarAtomHistorico(db: Db, fuente: Fuente, xml: string, sector: Sector): AtomProcesado {
  const c: AtomProcesado = { entradas: 0, guardadas: 0, fuera_de_sector: 0, errores: 0, abiertas: [] };
  const existe = db.prepare('SELECT 1 FROM licitaciones WHERE id = ?');
  db.transaction(() => {
    for (const xmlEntrada of entradas(xml)) {
      c.entradas += 1;
      const m = mapearEntrada(fuente.id, xmlEntrada);
      if (!m.data) {
        c.errores += 1;
        continue;
      }
      if (!esDelSector(sector, m.data) && !existe.get(m.data.id)) {
        c.fuera_de_sector += 1;
        continue;
      }
      guardarLicitacion(db, m.data, 'historico');
      guardarOrganizaciones(db, m.data);
      c.guardadas += 1;
      if (ESTADOS_ABIERTOS.has(m.data.estado)) c.abiertas.push(m.data.id);
    }
    for (const b of borradas(xml)) marcarBorrada(db, b.atomId, b.cuando, b.motivo);
  })();
  return c;
}
