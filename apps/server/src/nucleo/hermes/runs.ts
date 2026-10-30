// Cliente de la API de runs de Hermes (POST /v1/runs, GET /v1/runs/{id}, stop).
// Cada perfil tiene su URL y su API_SERVER_KEY; la clave nunca se registra.
import { z } from 'zod';
import { errorMessage, fail, ok, type Result } from '../result.js';

export type DestinoHermes = { url: string; key: string };
export type EstadoRun = 'en_marcha' | 'completado' | 'fallido' | 'cancelado';

const TIMEOUT_MS = 30_000;

const RunCreado = z.object({ run_id: z.string().min(1) }).loose();
const RunEstado = z.object({ status: z.string().min(1), error: z.unknown().optional() }).loose();
// Campos en los que la API de runs puede traer la respuesta final del agente.
const CAMPOS_SALIDA = ['output', 'final_output', 'final_response', 'result', 'response', 'message'] as const;

// La respuesta final de Hermes (recortada), para saber por qué un run no dejó su resultado.
function salidaDe(run: Record<string, unknown>): string | null {
  const texto = CAMPOS_SALIDA.map((c) => run[c]).find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return texto ? texto.trim().replace(/\s+/g, ' ').slice(0, 300) : null;
}

function cabeceras(destino: DestinoHermes, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${destino.key}`, 'Content-Type': 'application/json', ...extra };
}

async function pedir(url: string, init: RequestInit): Promise<Result<unknown>> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const texto = await res.text();
    if (!res.ok) return fail(`hermes_http_${res.status}`, texto.slice(0, 300) || res.statusText);
    return ok(texto ? JSON.parse(texto) : {});
  } catch (err) {
    return fail('hermes_inalcanzable', errorMessage(err));
  }
}

// La clave de idempotencia evita lanzar dos veces el mismo trabajo si se reintenta.
export async function lanzarRun(
  destino: DestinoHermes,
  input: string,
  idempotencia: string,
): Promise<Result<{ runId: string }>> {
  const r = await pedir(`${destino.url}/v1/runs`, {
    method: 'POST',
    headers: cabeceras(destino, { 'Idempotency-Key': idempotencia.replace(/[^\x21-\x7e]/g, '').slice(0, 255) }),
    body: JSON.stringify({ input }),
  });
  if (r.error) return r;
  const parsed = RunCreado.safeParse(r.data);
  return parsed.success ? ok({ runId: parsed.data.run_id }) : fail('hermes_respuesta', 'Hermes no devolvió run_id.');
}

export function estadoDesde(status: string): EstadoRun {
  const s = status.toLowerCase();
  if (['completed', 'succeeded', 'done'].includes(s)) return 'completado';
  if (['failed', 'error', 'expired'].includes(s)) return 'fallido';
  if (['cancelled', 'canceled', 'stopped'].includes(s)) return 'cancelado';
  return 'en_marcha';
}

// bruto: la respuesta tal cual, de donde salen las métricas si Hermes las da (metricas.ts).
export async function consultarRun(
  destino: DestinoHermes,
  runId: string,
): Promise<Result<{ estado: EstadoRun; error: string | null; salida: string | null; bruto: unknown }>> {
  const r = await pedir(`${destino.url}/v1/runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
    headers: cabeceras(destino),
  });
  if (r.error) return r;
  const parsed = RunEstado.safeParse(r.data);
  if (!parsed.success) return fail('hermes_respuesta', 'Hermes no devolvió el estado del run.');
  const error = parsed.data.error ? JSON.stringify(parsed.data.error).slice(0, 300) : null;
  return ok({ estado: estadoDesde(parsed.data.status), error, salida: salidaDe(parsed.data), bruto: parsed.data });
}

export async function pararRun(destino: DestinoHermes, runId: string): Promise<Result<unknown>> {
  return pedir(`${destino.url}/v1/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
    headers: cabeceras(destino),
    body: '{}',
  });
}
