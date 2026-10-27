// Guardia de plazo de la oferta: no se pide a Hermes un trabajo que llegaría tarde.
import { nucleo } from '../../../nucleo/contexto.js';
import { zonaEmpresa } from '../../../nucleo/empresa.js';
import { horaLocalEspana, instanteDeHoraEspana, ZONA_PENINSULAR, type ZonaHoraria } from '../../../nucleo/fechas.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';

// El plazo de la PLACSP es hora peninsular sin zona: se pasa a instante con la zona de Madrid, nunca con la del
// proceso ni la del navegador (en Canarias va una hora por detrás). A lo que tarda cada trabajo se suma un
// margen para revisar, firmar y subir la oferta (LICITACIONES_MARGEN_FIRMA_HORAS, 2 h por defecto): un guion
// que llega diez minutos antes del cierre no sirve de nada. Los trabajos automáticos no se piden si no caben;
// lo que pide una persona se avisa y, si lo confirma, se pide igualmente: en las últimas horas es cuando más
// falta la ayuda y la PLACSP acepta hasta el último minuto.
export type TrabajoOferta =
  | 'ficha'
  | 'guion'
  | 'decisiones'
  | 'memoria'
  | 'ronda'
  | 'mejora'
  | 'anexo'
  | 'evaluacion'
  | 'lecciones'
  | 'revision_previa';

// De pedirlo a tenerlo (minutos), con la cola y algún reintento. La memoria encadena estrategia,
// redacción entera y crítica; cada ronda, una redacción y una crítica; la mejora rehace solo los
// apartados elegidos.
export const DURACION_MIN: Record<TrabajoOferta, number> = {
  ficha: 40,
  guion: 45,
  decisiones: 30,
  memoria: 180,
  ronda: 60,
  mejora: 90,
  anexo: 20,
  evaluacion: 30,
  lecciones: 20,
  revision_previa: 30,
};
const QUE: Record<TrabajoOferta, string> = {
  ficha: 'la ficha',
  guion: 'el guion',
  decisiones: 'la propuesta de decisiones',
  memoria: 'la memoria técnica (plan y crítico)',
  ronda: 'otra ronda de reescritura de la memoria',
  mejora: 'la nueva versión de la memoria',
  anexo: 'el relleno del anexo',
  evaluacion: 'la nota de la memoria',
  lecciones: 'las lecciones de tus cambios',
  revision_previa: 'la revisión previa del paquete',
};
const HORA_MS = 3_600_000;
// Una mejora rehace solo los apartados elegidos: grupos de unos pocos runs a la vez (unos 20 min
// cada una) más el ensamblado, sin pasar de lo que tarda una memoria rehecha entera.
const MIN_POR_GRUPO_DE_RUNS = 20;
const APARTADOS_POR_GRUPO_DE_RUNS = 3;
const ENSAMBLADO_MIN = 10;

/** Lo que tarda una mejora que rehace `apartados` apartados (minutos). */
export function duracionMejoraMin(apartados: number): number {
  return Math.min(
    DURACION_MIN.mejora,
    ENSAMBLADO_MIN + MIN_POR_GRUPO_DE_RUNS * Math.ceil(Math.max(1, apartados) / APARTADOS_POR_GRUPO_DE_RUNS),
  );
}

// aMano: lo pide una persona (se avisa en vez de rechazar, y pasa con «confirmado»);
// duracionMin: lo que tarda este pedido si no es lo típico de su tipo (una mejora de un apartado).
export type OpcionesPlazo = {
  ahoraMs?: number | undefined;
  margenMs?: number;
  aMano?: boolean;
  confirmado?: boolean | undefined;
  duracionMin?: number | undefined;
};
export type LicitacionEnPreparacion = {
  id: string;
  titulo: string;
  organo_nombre: string;
  presupuesto_sin_iva: number | null;
  fecha_limite: string | null;
};

/** El plazo de presentación como se guarda (hora peninsular) y como instante; null si no tiene. */
export function plazoDe(db: Db, id: string): { fecha: string; vence: number } | null {
  const f = db.prepare('SELECT fecha_limite FROM licitaciones WHERE id = ?').get(id) as
    { fecha_limite: string | null } | undefined;
  const vence = f?.fecha_limite ? instanteDeHoraEspana(f.fecha_limite) : null;
  return f?.fecha_limite && vence !== null ? { fecha: f.fecha_limite, vence } : null;
}

export type EstadoPlazo = { vencido: boolean; restante_ms: number; texto: string };

/** El plazo de presentación de una licitación: si venció, lo que queda y cómo se dice (con la hora de la empresa); null sin plazo. */
export function estadoPlazo(db: Db, id: string, ahoraMs = Date.now()): EstadoPlazo | null {
  const p = plazoDe(db, id);
  if (!p) return null;
  const restante = p.vence - ahoraMs;
  return { vencido: restante <= 0, restante_ms: restante, texto: textoPlazo(p.fecha, zonaEmpresa(db)) };
}

/** Las licitaciones en preparación, vivas y con el plazo sin vencer (o sin plazo): la que vence antes, primero. */
export function licitacionesEnPreparacion(db: Db, ahoraMs = Date.now()): LicitacionEnPreparacion[] {
  return db
    .prepare(
      `SELECT l.id, l.titulo, l.organo_nombre, l.presupuesto_sin_iva, l.fecha_limite FROM oportunidades o
    JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'en_preparacion' AND l.borrada_en IS NULL AND (l.fecha_limite IS NULL OR l.fecha_limite > ?)
    ORDER BY l.fecha_limite IS NULL, l.fecha_limite, l.id`,
    )
    .all(horaLocalEspana(ahoraMs)) as LicitacionEnPreparacion[];
}

/** «2 d 5 h», «3 h 20 min», «45 min». */
export function duracionTexto(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const [d, h, m] = [Math.floor(min / 1440), Math.floor((min % 1440) / 60), min % 60];
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

// «el 15/10/2026 a las 08:00 hora peninsular» y, si la empresa está en Canarias, «(07:00 en
// Canarias)»: va siempre una hora por detrás, también en verano. Se escribe desde el texto
// guardado, sin pasar por ninguna zona.
export function textoPlazo(fechaLimite: string, zona: ZonaHoraria): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(fechaLimite);
  if (!m) return fechaLimite;
  const [, a, mes, d, h, min] = m;
  const peninsular = `el ${d}/${mes}/${a} a las ${h}:${min} hora peninsular`;
  if (zona === ZONA_PENINSULAR) return peninsular;
  return `${peninsular} (${String((Number(h) + 23) % 24).padStart(2, '0')}:${min} en Canarias)`;
}

const margenFirmaMs = (): number => nucleo().config.licitaciones.margenFirmaHoras * HORA_MS;

/**
 * ¿Da tiempo a pedir este trabajo? Error «plazo_vencido» si el plazo ya pasó. Si lo que tarda
 * más el margen de firma no cabe antes del cierre: «plazo_insuficiente» para lo automático y,
 * para lo que pide una persona, «plazo_justo» (un aviso que pasa con `confirmado`). Sin plazo
 * conocido no hay nada que guardar. Devuelve lo que queda (ms).
 */
export function guardaPlazo(
  db: Db,
  id: string,
  tipo: TrabajoOferta,
  op: OpcionesPlazo = {},
): Result<{ restante_ms: number | null }> {
  const plazo = plazoDe(db, id);
  if (!plazo) return ok({ restante_ms: null });
  const restante = plazo.vence - (op.ahoraMs ?? Date.now());
  if (restante <= 0)
    return fail(
      'plazo_vencido',
      `El plazo de presentación acabó ${textoPlazo(plazo.fecha, zonaEmpresa(db))}: ya no se pide ${QUE[tipo]}.`,
    );
  const tarda = (op.duracionMin ?? DURACION_MIN[tipo]) * 60_000;
  const margen = op.margenMs ?? margenFirmaMs();
  if (restante >= tarda + margen || (op.aMano && op.confirmado)) return ok({ restante_ms: restante });
  const conMargen = margen > 0 ? `, más ${duracionTexto(margen)} de margen para firmar y presentar` : '';
  const cuenta = `Quedan ${duracionTexto(restante)} para el plazo (${textoPlazo(plazo.fecha, zonaEmpresa(db))}) y ${QUE[tipo]} tarda unos ${duracionTexto(tarda)}${conMargen}`;
  return op.aMano
    ? fail(
        'plazo_justo',
        `${cuenta}: puede que Hermes no lo termine a tiempo. Si lo pides igualmente, confírmalo; si no, hazlo a mano.`,
      )
    : fail('plazo_insuficiente', `${cuenta}: no da tiempo a que lo prepare Hermes. Hazlo a mano.`);
}

/**
 * ¿Da tiempo a otro trabajo de esta memoria (reintentar una fase, otra ronda)? Una memoria de
 * ensayo se pide con el plazo ya vencido a propósito (para medirla contra la presentada): el
 * plazo no la frena en ninguna fase, o saldría sin estrategia, sin crítica y sin rondas.
 */
export function memoriaConTiempo(
  db: Db,
  m: { licitacion_id: string; ensayo: number },
  tipo: TrabajoOferta,
  ahoraMs?: number,
): boolean {
  return m.ensayo === 1 || guardaPlazo(db, m.licitacion_id, tipo, { ahoraMs }).error === null;
}
