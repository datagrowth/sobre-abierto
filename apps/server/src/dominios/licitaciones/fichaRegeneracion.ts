// Regeneración de las fichas hechas con una versión anterior del análisis (VERSION_PROMPT_FICHA).
import { z } from 'zod';
import type { Db as DbNucleo } from '../../nucleo/db.js';
import { encolar } from '../../nucleo/trabajos.js';
import { guardarOperacion, leerOperacion } from '../../nucleo/operaciones.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import type { Db } from './store.js';
import { TIPO_FICHA, VERSION_PROMPT_FICHA } from './ficha.js';
import type { ListoParaFicha } from './pliegosIndice.js';

// Al desplegar una versión nueva, las oportunidades vivas (nuevas o en preparación, en plazo) cuya ficha es
// antigua vuelven a pedirse solas, las que vencen antes primero, unas pocas por vuelta para no acaparar la cola
// ni el uso del modelo. Se puede pausar desde Estado. Cada licitación se pide una sola vez por versión: si
// falla, queda «Volver a generar».
export const CLAVE_REGENERACION = `licitaciones.fichas_v${VERSION_PROMPT_FICHA}`;
// Como mucho tantas fichas en cola o en marcha a la vez por la regeneración, y tantas nuevas
// por vuelta. Es trabajo de fondo: con 5 a la vez gastó ~10 M de tokens por media
// hora y agotó el uso del modelo; con 2 deja hueco a lo que pide una persona.
const MAX_EN_COLA = 2;
const POR_VUELTA = 2;

export type EstadoRegeneracion = 'en_curso' | 'pausada' | 'hecha';
const Datos = z
  .object({ total: z.number().int().catch(0), encoladas: z.number().int().catch(0) })
  .catch({ total: 0, encoladas: 0 });
type DatosRegeneracion = z.infer<typeof Datos>;

const claveTrabajo = (id: string) => `ficha-${id}-regen-v${VERSION_PROMPT_FICHA}`;

/** Oportunidades vivas con una ficha de una versión anterior que aún no se han vuelto a pedir. */
export function candidatasARegenerar(dbLic: Db, ahoraMs = Date.now()): string[] {
  const filas = dbLic
    .prepare(
      `SELECT o.licitacion_id AS id FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado IN ('nueva', 'en_preparacion') AND (l.fecha_limite IS NULL OR l.fecha_limite > @hoy)
      AND EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id AND f.estado = 'aprobada')
      AND NOT EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id AND f.estado = 'aprobada' AND f.version_prompt >= @version)
      AND NOT EXISTS (SELECT 1 FROM nucleo.trabajos_ia t WHERE t.clave = 'ficha-' || o.licitacion_id || '-regen-v' || @version)
      AND NOT EXISTS (SELECT 1 FROM nucleo.trabajos_ia t WHERE t.tipo = @tipo AND t.estado IN ('pendiente', 'lanzado') AND json_extract(t.payload, '$.id') = o.licitacion_id)
    ORDER BY COALESCE(l.fecha_limite, '9999'), o.licitacion_id`,
    )
    .all({ hoy: horaLocalEspana(ahoraMs), version: VERSION_PROMPT_FICHA, tipo: TIPO_FICHA }) as { id: string }[];
  return filas.map((f) => f.id);
}

function leer(dbNucleo: DbNucleo): { estado: EstadoRegeneracion; datos: DatosRegeneracion } | null {
  const op = leerOperacion(dbNucleo, CLAVE_REGENERACION, (raw) => Datos.parse(raw));
  return op ? { estado: op.estado as EstadoRegeneracion, datos: op.datos } : null;
}

function enCola(dbNucleo: DbNucleo): number {
  return (
    dbNucleo
      .prepare(
        "SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado') AND clave LIKE '%-regen-v%'",
      )
      .get(TIPO_FICHA) as { n: number }
  ).n;
}

/**
 * Una vuelta: arranca la regeneración la primera vez (sola, al desplegar la versión), encola
 * hasta POR_VUELTA fichas si hay hueco y la da por hecha cuando no queda ninguna. Solo pide
 * las que se pueden leer ya (`legible`). Devuelve cuántas encoló.
 */
export function vueltaRegeneracion(
  dbNucleo: DbNucleo,
  dbLic: Db,
  legible: (id: string) => ListoParaFicha,
  ahoraMs = Date.now(),
): number {
  const actual = leer(dbNucleo);
  if (actual?.estado === 'pausada' || actual?.estado === 'hecha') return 0;
  const candidatas = candidatasARegenerar(dbLic, ahoraMs);
  const datos = actual?.datos ?? { total: candidatas.length, encoladas: 0 };
  if (!candidatas.length) {
    guardarOperacion(dbNucleo, CLAVE_REGENERACION, 'hecha', datos);
    return 0;
  }
  const hueco = Math.min(POR_VUELTA, MAX_EN_COLA - enCola(dbNucleo));
  const elegidas = hueco > 0 ? candidatas.filter((id) => legible(id) === 'listo').slice(0, hueco) : [];
  const pedida = new Date(ahoraMs).toISOString();
  for (const id of elegidas)
    encolar(dbNucleo, {
      tipo: TIPO_FICHA,
      dominio: 'licitaciones',
      clave: claveTrabajo(id),
      payload: { id, pedida_en: pedida },
    });
  guardarOperacion(dbNucleo, CLAVE_REGENERACION, 'en_curso', {
    ...datos,
    encoladas: datos.encoladas + elegidas.length,
  });
  return elegidas.length;
}

export type ResumenRegeneracion = {
  version: number;
  estado: EstadoRegeneracion | 'sin_empezar';
  total: number;
  encoladas: number;
  quedan: number;
};

export function resumenRegeneracion(dbNucleo: DbNucleo, dbLic: Db): ResumenRegeneracion {
  const actual = leer(dbNucleo);
  return {
    version: VERSION_PROMPT_FICHA,
    estado: actual?.estado ?? 'sin_empezar',
    total: actual?.datos.total ?? 0,
    encoladas: actual?.datos.encoladas ?? 0,
    quedan: candidatasARegenerar(dbLic).length,
  };
}

export const AccionRegeneracion = z.object({ accion: z.enum(['pausar', 'reanudar']) });

/** Pausar o reanudar desde Estado. Reanudar una ya hecha la reabre (p. ej. si entraron fichas antiguas). */
export function cambiarRegeneracion(
  dbNucleo: DbNucleo,
  accion: z.infer<typeof AccionRegeneracion>['accion'],
): Result<{ estado: EstadoRegeneracion }> {
  const actual = leer(dbNucleo);
  if (accion === 'pausar' && actual?.estado === 'hecha')
    return fail('invalid_input', 'La regeneración ya terminó: no hay nada que pausar.');
  const estado: EstadoRegeneracion = accion === 'pausar' ? 'pausada' : 'en_curso';
  guardarOperacion(dbNucleo, CLAVE_REGENERACION, estado, actual?.datos ?? { total: 0, encoladas: 0 });
  return ok({ estado });
}
