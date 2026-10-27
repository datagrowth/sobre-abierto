// Servidor MCP de la plataforma (Streamable HTTP, sin sesión) en /mcp.
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import express, { Router, type Request, type Response } from 'express';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { autenticarAgente, agenteDe, limitarAgente } from '../agentes/autenticacionAgentes.js';
import type { Agente } from '../agentes/registro.js';
import { DOMINIOS, type Accion, type Dominio, type Permisos } from '../agentes/permisos.js';
import { catalogoRegistrado } from './herramienta.js';
import { errorMessage, fail, ok, type Result } from '../result.js';
import { logger } from '../log.js';
import { vigilarListados } from './huellas.js';

// Cada petición crea un McpServer con las tools que el agente que llama puede usar; los dominios añaden las
// suyas con anadirHerramientas().
export type Registrador = (server: McpServer, agente: Agente) => void;

const registradores: Registrador[] = [];
const log = logger('mcp');

let catalogoCacheado: { nombre: string; dominio: Dominio; accion: Accion }[] | null = null;

export function anadirHerramientas(fn: Registrador): void {
  registradores.push(fn);
  catalogoCacheado = null;
}

function crearServidorMcp(agente: Agente): McpServer {
  const server = new McpServer({ name: 'plataforma', version: '1.0.0' });
  for (const registrar of registradores) registrar(server, agente);
  return server;
}

/**
 * Todas las herramientas de la plataforma con el permiso que las da. Se arma una vez con un
 * agente que lo puede todo, para que también se registren las que piden una condición externa
 * (licitaciones_equipo necesita colaboradores:leer). Registrar no deja rastro en la auditoría.
 */
export function catalogoHerramientas(): { nombre: string; dominio: Dominio; accion: Accion }[] {
  if (catalogoCacheado) return catalogoCacheado;
  const permisos = Object.fromEntries(DOMINIOS.map((d) => [d, 'proponer' as const])) as Permisos;
  crearServidorMcp({ nombre: 'catalogo', permisos });
  catalogoCacheado = catalogoRegistrado();
  return catalogoCacheado;
}

// El SDK pasa authInfo tal cual a la fábrica: los permisos viajan como scopes.
function aAuthInfo(agente: Agente) {
  const scopes = Object.entries(agente.permisos).map(([d, a]) => `${d}:${a}`);
  return { token: '', clientId: agente.nombre, scopes };
}

function deAuthInfo(auth: { clientId: string; scopes: string[] } | undefined): Agente {
  const permisos: Permisos = {};
  for (const s of auth?.scopes ?? []) {
    const [d, a] = s.split(':') as [Dominio, Accion];
    permisos[d] = a;
  }
  return { nombre: auth?.clientId ?? 'desconocido', permisos };
}

const handler = createMcpHandler(({ authInfo }) => crearServidorMcp(deAuthInfo(authInfo)), {
  onerror: (err) => log.warn('petición MCP rechazada', { error: err.message }),
});

function aRequestWeb(req: Request): globalThis.Request {
  const url = `http://${req.headers.host ?? 'localhost'}${req.originalUrl}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const conCuerpo = req.method === 'POST' && req.body !== undefined;
  return new globalThis.Request(url, {
    method: req.method,
    headers,
    body: conCuerpo ? JSON.stringify(req.body) : undefined,
  });
}

const CABECERAS_LISTADO = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-06-18',
};

/** Lo que respondería tools/list a `agente`, en proceso y sin red: la base de la huella de sus herramientas. */
export async function listarHerramientas(agente: Agente): Promise<Result<unknown[]>> {
  const cuerpo = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  try {
    const peticion = new globalThis.Request('http://localhost/mcp', {
      method: 'POST',
      headers: CABECERAS_LISTADO,
      body: JSON.stringify(cuerpo),
    });
    const respuesta = await handler.fetch(peticion, { authInfo: aAuthInfo(agente), parsedBody: cuerpo });
    const raw = await respuesta.text();
    // Puede llegar como JSON o como un evento SSE («data: {...}»).
    const datos =
      raw
        .split('\n')
        .find((l) => l.startsWith('data: '))
        ?.slice(6) ?? raw;
    const tools = (JSON.parse(datos) as { result?: { tools?: unknown } }).result?.tools;
    return Array.isArray(tools)
      ? ok(tools)
      : fail('mcp_listado', `tools/list sin lista de herramientas (HTTP ${respuesta.status})`);
  } catch (err) {
    return fail('mcp_listado', errorMessage(err));
  }
}

async function servir(req: Request, res: Response): Promise<void> {
  const agente = agenteDe(res)!;
  const respuesta = await handler.fetch(aRequestWeb(req), { authInfo: aAuthInfo(agente), parsedBody: req.body });
  res.status(respuesta.status);
  respuesta.headers.forEach((value, key) => res.setHeader(key, value));
  if (!respuesta.body) {
    res.end();
    return;
  }
  Readable.fromWeb(respuesta.body as unknown as NodeReadableStream).pipe(res);
}

/**
 * Solo gastan cupo las llamadas a herramientas: el saludo (initialize), los avisos, los
 * listados y el canal de escucha (GET) son baratos, y un cliente que reconecta a menudo
 * (sesiones de Claude Code, el cliente MCP de Hermes) agotaba el cupo sin hacer nada.
 */
export function esLlamadaAHerramienta(req: Pick<Request, 'method' | 'body'>): boolean {
  if (req.method !== 'POST') return false;
  const mensajes: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
  return mensajes.some(
    (m) => typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'tools/call',
  );
}

export function routerMcp(agentesDir: () => string): Router {
  const router = Router();
  router.use(autenticarAgente(agentesDir, false));
  router.use(express.json({ limit: '4mb' }));
  router.use(vigilarListados(listarHerramientas));
  router.use(limitarAgente(esLlamadaAHerramienta));
  router.all('/', (req, res) => {
    servir(req, res).catch((err: unknown) => {
      log.error('fallo sirviendo MCP', { error: errorMessage(err) });
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
      else res.end();
    });
  });
  return router;
}
