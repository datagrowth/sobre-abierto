// Historial y deshacer de las decisiones: cada guardado deja una fila en decisiones_historial.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Rol } from '../../../nucleo/usuarios.js';
import type { Db } from '../store.js';
import { guionVigente } from './guion.js';
import {
  avisarDecisiones,
  avisosDePrecio,
  Decisiones,
  decisionesDe,
  escribirDecisiones,
  MENSAJE_CONFLICTO,
  normalizarDecisiones,
  seccionesCambiadas,
  SECCIONES,
  type DecisionesData,
  type NombreSeccion,
} from './decisiones.js';
import { contextoDe, problemasPorSeccion, todoONada, type Contexto } from './decisionesSecciones.js';
import { avisarLotes, guardarLotesInteres } from '../oportunidades.js';

const log = logger('licitaciones');

export type EntradaHistorial = {
  version: number;
  secciones: NombreSeccion[];
  autor: string | null;
  motivo: string | null;
  creada_en: string;
};

// Deshacer restaura la anterior como una versión nueva (el historial no se reescribe) y no encola nada: si lo
// afectado aún no se ha rehecho, las piezas vuelven a casar con lo que llevan y la vuelta de los anexos no las
// relanza (anexosAuto.ts compara por valores con decisionesEn). El historial no lleva los datos: con ellos irían
// los precios.
const Secciones = z.array(z.enum(SECCIONES));

function seccionesDe(crudo: string): NombreSeccion[] {
  try {
    const s = Secciones.safeParse(JSON.parse(crudo));
    return s.success ? s.data : [];
  } catch {
    return [];
  }
}

/** Las versiones de las decisiones, de la más reciente a la primera: quién, cuándo y qué secciones; sin los datos. */
export function historialDecisiones(dbLic: Db, id: string): Result<EntradaHistorial[]> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const filas = dbLic
    .prepare(
      'SELECT version, secciones, autor, motivo, creada_en FROM decisiones_historial WHERE licitacion_id = ? ORDER BY version DESC',
    )
    .all(id) as {
    version: number;
    secciones: string;
    autor: string | null;
    motivo: string | null;
    creada_en: string;
  }[];
  return ok(filas.map((f) => ({ ...f, secciones: seccionesDe(f.secciones) })));
}

type FilaVersion = { version: number; guion_id: number; datos: string };

// Los datos de una fila del historial en la forma de ahora (como decisionesDe), o null si ya no validan.
function datosDe(dbLic: Db, id: string, f: FilaVersion): DecisionesData | null {
  const d = Decisiones.safeParse(JSON.parse(f.datos));
  if (!d.success) {
    log.warn('versión de las decisiones no válida en el historial', { licitacion: id, version: f.version });
    return null;
  }
  const g = guionVigente(dbLic, id);
  return g ? normalizarDecisiones(d.data, g.datos) : d.data;
}

/** Las decisiones vigentes en un instante (ISO): con ellas se rellenó lo que lleva fecha de entonces. null si no había. */
export function decisionesEn(dbLic: Db, id: string, instante: string): DecisionesData | null {
  const f = dbLic
    .prepare(
      'SELECT version, guion_id, datos FROM decisiones_historial WHERE licitacion_id = ? AND creada_en <= ? ORDER BY version DESC LIMIT 1',
    )
    .get(id, instante) as FilaVersion | undefined;
  return f ? datosDe(dbLic, id, f) : null;
}

const EntradaDeshacer = z.strictObject({
  version: z.number().int().positive().describe('La versión de las decisiones que se leyó (GET /oferta/decisiones)'),
  quien: z.string().trim().min(2).max(60).optional(),
});

export type Deshecho = {
  version: number;
  restaurada: number;
  secciones: NombreSeccion[];
  datos: DecisionesData;
  avisos: string[];
  problemas: string[];
};

function anteriorA(dbLic: Db, id: string, version: number): FilaVersion | null {
  const f = dbLic
    .prepare(
      'SELECT version, guion_id, datos FROM decisiones_historial WHERE licitacion_id = ? AND version < ? ORDER BY version DESC LIMIT 1',
    )
    .get(id, version) as FilaVersion | undefined;
  return f ?? null;
}

type Restauracion = {
  actual: DecisionesData;
  version: number;
  anterior: FilaVersion;
  datos: DecisionesData;
  quien?: string;
  rol?: Rol;
};

// Si la versión restaurada cambia los lotes, los de interés (el ámbito) vuelven con ella, como al
// cambiarlos por PATCH: decisiones y ámbito no pueden quedar distintos. El motivo va en la misma
// transacción: no queda una versión de deshacer sin decir que lo es.
function escribirRestaurada(c: Contexto, x: Restauracion, secciones: NombreSeccion[]): Result<{ version: number }> {
  if (secciones.includes('lotes')) {
    const l = guardarLotesInteres(c.dbLic, c.id, { lotes: x.datos.lotes, quien: x.quien });
    if (l.error) return l;
  }
  const r = escribirDecisiones(c.dbLic, {
    id: c.id,
    guion_id: x.anterior.guion_id,
    datos: x.datos,
    secciones,
    autor: x.quien ?? 'web',
    rol: x.rol,
    esperada: x.version,
  });
  if (!r.error)
    c.dbLic
      .prepare('UPDATE decisiones_historial SET motivo = ? WHERE licitacion_id = ? AND version = ?')
      .run(`deshacer v${x.version}`, c.id, r.data.version);
  return r;
}

// Escribe la versión anterior como una nueva, con el guion contra el que se fijó, y tras el commit avisa a la web y a las comprobaciones.
function restaurar(c: Contexto, x: Restauracion): Result<Deshecho> {
  const secciones = seccionesCambiadas(x.actual, x.datos);
  if (secciones.includes('lotes') && !x.datos.lotes.length) {
    return fail(
      'conflicto',
      `La v${x.anterior.version} no tiene lotes elegidos y deshacer no puede dejar la oferta sin lotes: elige los lotes en Decisiones.`,
    );
  }
  const w = todoONada(c.dbLic, () => escribirRestaurada(c, x, secciones));
  if (w.error) return w;
  if (secciones.includes('lotes')) avisarLotes(c.dbLic, c.id, x.datos.lotes);
  avisarDecisiones(c.dbLic, c.id, { guionVersion: c.guion.version, version: w.data.version, secciones });
  const problemas = Object.values(problemasPorSeccion(c, x.datos)).flat();
  return ok({
    version: w.data.version,
    restaurada: x.anterior.version,
    secciones,
    datos: x.datos,
    avisos: avisosDePrecio(c.dbLic, c.id, c.guion, x.datos),
    problemas,
  });
}

/**
 * Deshace el último cambio de las decisiones: con la versión que se leyó (409 si ya no es la
 * guardada), vuelve a los datos de la versión anterior como una versión nueva. No encola nada.
 */
export function deshacerDecisiones(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  entrada: unknown,
  rol?: Rol,
): Result<Deshecho> {
  const c = contextoDe(dbLic, dbNucleo, id);
  if (c.error) return c;
  const e = EntradaDeshacer.safeParse(entrada);
  if (!e.success) return fail('invalid_input', z.prettifyError(e.error));
  const actual = decisionesDe(dbLic, id);
  if (!actual) return fail('not_found', 'Aún no se han fijado las decisiones de la oferta.');
  if (actual.version !== e.data.version) return fail('conflicto', MENSAJE_CONFLICTO);
  const anterior = anteriorA(dbLic, id, actual.version);
  const datos = anterior ? datosDe(dbLic, id, anterior) : null;
  if (!anterior || !datos)
    return fail('conflicto', `No hay ninguna versión anterior a la v${actual.version} que restaurar.`);
  return restaurar(c.data, {
    actual: actual.datos,
    version: actual.version,
    anterior,
    datos,
    quien: e.data.quien,
    rol,
  });
}
