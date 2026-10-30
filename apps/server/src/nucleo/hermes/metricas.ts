// Métricas de un trabajo de IA: modelo, tokens, llamadas, duración y respuestas de herramientas recortadas.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { Db } from '../db.js';

// Cuenta también cuántas respuestas de herramientas le llegaron recortadas o rechazadas. Sirven para comparar
// modelos y versiones del análisis. Salen de tres sitios, el primero que lo sepa: la respuesta del run (la API
// de Hermes no tiene un formato fijo para esto), la sesión del perfil en su state.db y la auditoría de las
// herramientas MCP. Todo es opcional: lo que no se sabe queda null.
export type MetricasRun = {
  modelo: string | null;
  proveedor: string | null;
  tokens_entrada: number | null;
  tokens_salida: number | null;
  llamadas_api: number | null;
  llamadas_herramientas: number | null;
  respuestas_recortadas: number;
  rechazos: number;
  duracion_s: number | null;
  fuentes: string[];
};

// Cómo se reconoce el trabajo en la auditoría y en Hermes: el agente (su token) y, si se
// sabe, la state.db del perfil que lo ejecuta.
export type OrigenMetricas = { agente: string; stateDb: () => string | null };

type Parcial = Partial<
  Pick<
    MetricasRun,
    'modelo' | 'proveedor' | 'tokens_entrada' | 'tokens_salida' | 'llamadas_api' | 'llamadas_herramientas'
  >
>;

const Num = z.number().nonnegative().optional().catch(undefined);
const Txt = z.string().min(1).optional().catch(undefined);
const Uso = z
  .object({ input_tokens: Num, prompt_tokens: Num, output_tokens: Num, completion_tokens: Num, model: Txt })
  .loose()
  .optional()
  .catch(undefined);
const RunConMetricas = z
  .object({
    model: Txt,
    provider: Txt,
    usage: Uso,
    metadata: z.object({ model: Txt, provider: Txt }).loose().optional().catch(undefined),
    api_call_count: Num,
    tool_call_count: Num,
    tool_calls: z.array(z.unknown()).optional().catch(undefined),
  })
  .loose();

// La API de Hermes responde con el nombre de su servidor («hermes-agent») en el campo del
// modelo: no es el modelo que trabajó, y si se tomara taparía el de la sesión del perfil.
const ALIAS_DEL_SERVIDOR = new Set(['hermes-agent']);

function modeloReal(m: string | undefined): string | undefined {
  return m && !ALIAS_DEL_SERVIDOR.has(m.trim().toLowerCase()) ? m : undefined;
}

/** Lo que diga la respuesta del run (si dice algo). */
export function deRun(bruto: unknown): Parcial {
  const r = RunConMetricas.safeParse(bruto);
  if (!r.success) return {};
  const d = r.data;
  return limpiar({
    modelo: modeloReal(d.model) ?? modeloReal(d.usage?.model) ?? modeloReal(d.metadata?.model),
    proveedor: d.provider ?? d.metadata?.provider,
    tokens_entrada: d.usage?.input_tokens ?? d.usage?.prompt_tokens,
    tokens_salida: d.usage?.output_tokens ?? d.usage?.completion_tokens,
    llamadas_api: d.api_call_count,
    llamadas_herramientas: d.tool_call_count ?? d.tool_calls?.length,
  });
}

function limpiar(p: Record<string, unknown>): Parcial {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null)) as Parcial;
}

// started_at de Hermes: segundos o milisegundos desde 1970, o una fecha ISO.
function aMs(v: unknown): number | null {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const Sesion = z
  .object({
    started_at: z.unknown(),
    model: Txt,
    billing_provider: Txt,
    input_tokens: Num,
    output_tokens: Num,
    api_call_count: Num,
    tool_call_count: Num,
  })
  .loose();

/** La sesión del perfil que empezó con el run (la más cercana tras el lanzamiento). */
export function deSesion(ruta: string | null, desdeMs: number, hastaMs: number): Parcial {
  if (!ruta || !fs.existsSync(ruta)) return {};
  let db: Database.Database | null = null;
  try {
    db = new Database(ruta, { readonly: true, fileMustExist: true });
    const filas = db
      .prepare(
        'SELECT started_at, model, billing_provider, input_tokens, output_tokens, api_call_count, tool_call_count FROM sessions ORDER BY started_at DESC LIMIT 50',
      )
      .all();
    const sesion = filas
      .map((f) => Sesion.safeParse(f))
      .flatMap((p) => (p.success ? [p.data] : []))
      .map((s) => ({ s, inicio: aMs(s.started_at) }))
      .filter(
        (x): x is { s: z.infer<typeof Sesion>; inicio: number } =>
          x.inicio !== null && x.inicio >= desdeMs - 60_000 && x.inicio <= hastaMs,
      )
      .sort((a, b) => a.inicio - b.inicio)[0]?.s;
    if (!sesion) return {};
    return limpiar({
      modelo: sesion.model,
      proveedor: sesion.billing_provider,
      tokens_entrada: sesion.input_tokens,
      tokens_salida: sesion.output_tokens,
      llamadas_api: sesion.api_call_count,
      llamadas_herramientas: sesion.tool_call_count,
    });
  } catch {
    return {}; // state.db de otra versión de Hermes o bloqueada: sin métricas de sesión
  } finally {
    db?.close();
  }
}

type Auditoria = Pick<MetricasRun, 'llamadas_herramientas' | 'respuestas_recortadas' | 'rechazos'>;

/**
 * Llamadas del agente a las herramientas durante el run. Con `recurso` (el id de lo que se
 * pidió), solo las que lo tocan: con varios runs a la vez del mismo agente se mezclarían.
 */
export function deAuditoria(db: Db, agente: string, desde: string, hasta: string, recurso: string | null): Auditoria {
  const filtro = recurso ? "AND recurso LIKE '%' || ? || '%'" : '';
  const args = [agente, desde, hasta, ...(recurso ? [recurso] : [])];
  const filas = db
    .prepare(
      `SELECT resultado, COUNT(*) AS n FROM auditoria_agentes WHERE agente = ? AND creado_en >= ? AND creado_en <= ? ${filtro} GROUP BY resultado`,
    )
    .all(...args) as { resultado: string; n: number }[];
  const n = (r: string) => filas.find((f) => f.resultado === r)?.n ?? 0;
  return {
    llamadas_herramientas: filas.reduce((s, f) => s + f.n, 0),
    respuestas_recortadas: n('recortada'),
    rechazos: n('error'),
  };
}

export type DatosTrabajo = { lanzado_en: string | null; payload: string };

/** Las métricas de un trabajo que acaba de terminar (bien o mal). */
export function recogerMetricas(
  db: Db,
  t: DatosTrabajo,
  bruto: unknown,
  origen: OrigenMetricas | undefined,
  ahoraMs = Date.now(),
): MetricasRun {
  const desdeMs = t.lanzado_en ? Date.parse(t.lanzado_en) : null;
  const run = deRun(bruto);
  const sesion = origen && desdeMs !== null ? deSesion(origen.stateDb(), desdeMs, ahoraMs) : {};
  const recurso = z.object({ id: z.string() }).safeParse(JSON.parse(t.payload)).data?.id ?? null;
  const audit =
    origen && t.lanzado_en
      ? deAuditoria(db, origen.agente, t.lanzado_en, new Date(ahoraMs).toISOString(), recurso)
      : null;
  const fuentes = [
    Object.keys(run).length ? 'run' : null,
    Object.keys(sesion).length ? 'sesion' : null,
    audit ? 'auditoria' : null,
  ].filter((f): f is string => f !== null);
  const v = <K extends keyof Parcial>(k: K) => run[k] ?? sesion[k] ?? null;
  return {
    modelo: v('modelo') as string | null,
    proveedor: v('proveedor') as string | null,
    tokens_entrada: v('tokens_entrada') as number | null,
    tokens_salida: v('tokens_salida') as number | null,
    llamadas_api: v('llamadas_api') as number | null,
    llamadas_herramientas: (v('llamadas_herramientas') as number | null) ?? audit?.llamadas_herramientas ?? null,
    respuestas_recortadas: audit?.respuestas_recortadas ?? 0,
    rechazos: audit?.rechazos ?? 0,
    duracion_s: desdeMs !== null ? Math.round((ahoraMs - desdeMs) / 1000) : null,
    fuentes,
  };
}
