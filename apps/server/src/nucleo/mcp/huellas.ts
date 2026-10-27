// Huella de las herramientas MCP de cada agente y la de la última lista que pidió.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ahora, type Db } from '../db.js';
import { nucleo } from '../contexto.js';
import { agenteDe } from '../agentes/autenticacionAgentes.js';
import type { Agente } from '../agentes/registro.js';
import { errorMessage, type Result } from '../result.js';
import { logger } from '../log.js';

export type Listador = (agente: Agente) => Promise<Result<unknown[]>>;
// Hermes solo pide la lista (tools/list) al arrancar: si se despliega un cambio de esquema y no se reinicia,
// sigue llamando con la lista vieja. Así un guion puede gastar sus tres intentos porque la tool vieja rechaza un
// campo nuevo, y frenar todos los guiones 6 h. Un agente está desfasado si lo que se le sirvió en su último
// tools/list no tiene la huella de sus herramientas de ahora: así cuenta también un cambio de permisos en
// caliente, y un rollback a la lista que Hermes ya tiene lo desbloquea en vez de bloquearlo.
// desde: cuándo cambiaron sus herramientas (null si no se las ha visto cambiar); listado_en: su último tools/list.
export type Desfase = { agente: string; desde: string | null; listado_en: string | null };

const log = logger('mcp');

// JSON con las claves ordenadas: el orden en que el SDK escribe un esquema no debe cambiar la huella.
function estable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estable);
  if (typeof v !== 'object' || v === null) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, estable((v as Record<string, unknown>)[k])]),
  );
}

/** sha256 de lo que el agente ve de cada herramienta (nombre, descripción y esquema de entrada), ordenadas por nombre. */
export function huellaDe(herramientas: unknown[]): string {
  const vistas = herramientas
    .map((h) => {
      const { name, description, inputSchema } = (h ?? {}) as {
        name?: unknown;
        description?: unknown;
        inputSchema?: unknown;
      };
      return { name: String(name ?? ''), description: description ?? null, inputSchema: inputSchema ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(estable(vistas)))
    .digest('hex');
}

/**
 * Guarda la huella de ahora de un agente. Si cambió, `desde` = `marca`; si es la misma, no se
 * toca. La primera vez que se ve a un agente (primer arranque con esto, o un perfil nuevo) se da
 * por hecho que Hermes tiene esa lista, salvo que ya conste un listado suyo: no hay forma de saber
 * qué lista cargó antes, y bloquear todo el primer despliegue sería peor que dejarlo como antes.
 */
export function guardarHuella(db: Db, agente: string, huella: string, marca: string): 'nueva' | 'cambiada' | 'igual' {
  const previa = db.prepare('SELECT huella FROM mcp_huellas WHERE agente = ?').get(agente) as
    { huella: string } | undefined;
  if (!previa) {
    db.prepare('INSERT INTO mcp_huellas (agente, huella, desde) VALUES (?, ?, NULL)').run(agente, huella);
    db.prepare(
      'INSERT INTO mcp_listados (agente, huella, listado_en) VALUES (?, ?, NULL) ON CONFLICT(agente) DO NOTHING',
    ).run(agente, huella);
    return 'nueva';
  }
  if (previa.huella === huella) return 'igual';
  db.prepare('UPDATE mcp_huellas SET huella = ?, desde = ? WHERE agente = ?').run(huella, marca, agente);
  return 'cambiada';
}

/**
 * La huella de las herramientas de cada agente: al arrancar, con todas ya registradas, y cada
 * minuto, porque los permisos se releen en caliente. Un agente cuya lista no se puede calcular
 * se deja como estaba (no bloquea ni desbloquea).
 */
export async function anotarHuellas(db: Db, agentes: Agente[], listar: Listador, marca = ahora()): Promise<string[]> {
  const cambiadas: string[] = [];
  for (const agente of agentes) {
    const lista = await listar(agente);
    if (lista.error) {
      log.warn('huella de herramientas sin calcular', { agente: agente.nombre, codigo: lista.error.code });
      continue;
    }
    if (guardarHuella(db, agente.nombre, huellaDe(lista.data), marca) === 'cambiada') cambiadas.push(agente.nombre);
  }
  if (cambiadas.length)
    log.info('herramientas MCP cambiadas: esos perfiles de Hermes deben volver a pedir la lista', {
      agentes: cambiadas.join(', '),
    });
  return cambiadas;
}

/** Si la última lista que pidió el agente no es la de sus herramientas de ahora. Sin datos de alguna de las dos, no. */
export function desfaseDe(db: Db, agente: string): Desfase | null {
  const f = db
    .prepare(
      `SELECT h.huella AS actual, h.desde, l.huella AS listada, l.listado_en FROM mcp_huellas h
    JOIN mcp_listados l ON l.agente = h.agente WHERE h.agente = ?`,
    )
    .get(agente) as { actual: string; desde: string | null; listada: string; listado_en: string | null } | undefined;
  if (!f || f.actual === f.listada) return null;
  return { agente, desde: f.desde, listado_en: f.listado_en };
}

/** Los desfasados de entre esos agentes (los que ejecutan trabajos de la cola), por nombre. */
export function desfasados(db: Db, agentes: Iterable<string>): Desfase[] {
  return [...new Set(agentes)]
    .sort()
    .map((a) => desfaseDe(db, a))
    .filter((d): d is Desfase => d !== null);
}

/**
 * ¿El cuerpo (un mensaje JSON-RPC o un lote) pide la lista de herramientas? Solo tools/list
 * como petición (con id): un initialize no demuestra nada, porque el cliente MCP de Hermes
 * reconecta a menudo sin volver a cargar su registro de herramientas.
 */
export function esListado(body: unknown): boolean {
  const mensajes: unknown[] = Array.isArray(body) ? body : [body];
  return mensajes.some(
    (m) => typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'tools/list' && 'id' in m,
  );
}

export function anotarListado(db: Db, agente: string, huella: string, cuando = ahora()): void {
  db.prepare(
    `INSERT INTO mcp_listados (agente, huella, listado_en) VALUES (?, ?, ?)
    ON CONFLICT(agente) DO UPDATE SET huella = excluded.huella, listado_en = excluded.listado_en`,
  ).run(agente, huella, cuando);
}

// Lo servido es lo que da `listar` para ese agente en ese momento (mismo servidor y permisos).
// Si no da una lista (p. ej. un agente sin herramientas: el SDK responde 200 con un error
// JSON-RPC), Hermes tampoco la recibió y no se anota.
async function anotarLoServido(agente: Agente, listar: Listador, cuando: string): Promise<void> {
  const lista = await listar(agente);
  if (lista.error) return;
  anotarListado(nucleo().db, agente.nombre, huellaDe(lista.data), cuando);
}

/**
 * Middleware de /mcp (tras autenticar y leer el JSON): anota cada tools/list con la huella de lo
 * que se sirvió. Cuenta por token, no por proceso: un `hermes -p <perfil> mcp test` también
 * anota, por eso docs/operacion.md pide reiniciar Hermes y no probar con él. Nunca corta la petición.
 */
export function vigilarListados(listar: Listador) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const agente = agenteDe(res);
    if (req.method === 'POST' && agente && esListado(req.body)) {
      const cuando = ahora();
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        anotarLoServido(agente, listar, cuando).catch((err: unknown) =>
          log.warn('listado de herramientas sin anotar', { agente: agente.nombre, error: errorMessage(err) }),
        );
      });
    }
    next();
  };
}
