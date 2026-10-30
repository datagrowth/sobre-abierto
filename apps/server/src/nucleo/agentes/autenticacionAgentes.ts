// Entrada de los agentes (MCP y API antigua de la Biblioteca): token Bearer →
// agente con sus permisos. Sin ningún token configurado, cerrado (503).
import type { NextFunction, Request, Response } from 'express';
import { agentePorToken, agentesConocidos, type Agente } from './registro.js';
import { puede, type Accion, type Dominio } from './permisos.js';
import { crearLimitador, type Limitador } from './limite.js';
import { leerConfig } from '../config.js';
import { logger } from '../log.js';

// Se crea con la primera petición, no al importar: el arranque ya validó la config y los
// tests la fijan antes de llamar. Solo la config, sin abrir nucleo.db.
let limitador: Limitador | null = null;
const log = logger('agentes');
const avisado = new Map<string, number>();

/** Peticiones que ha gastado cada agente del cupo en el último minuto. */
export function usoAgentes(): Record<string, number> {
  return limitador?.uso() ?? {};
}

function permitir(nombre: string): boolean {
  limitador ??= crearLimitador(leerConfig().agentesPeticionesMinuto);
  return limitador(nombre);
}

// Quién llega al límite queda en el log (una vez por minuto y agente): sin esto, un cliente
// en bucle con el token de otro solo se ve como «Demasiadas peticiones».
function limitado(nombre: string, res: Response): void {
  if (Date.now() - (avisado.get(nombre) ?? 0) > 60_000) {
    avisado.set(nombre, Date.now());
    log.warn('agente sin cupo de peticiones', { agente: nombre });
  }
  res.status(429).json({ error: 'rate_limited', message: 'Demasiadas peticiones; espera un minuto.' });
}

export function agenteDe(res: Response): Agente | null {
  return (res.locals['agente'] as Agente | undefined) ?? null;
}

function tokenBearer(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/**
 * Token → agente. Con `limitar` (por defecto) cada petición gasta cupo; el MCP lo desactiva
 * y limita después con `limitarAgente`, cuando ya sabe qué mensaje es.
 */
export function autenticarAgente(directorio: () => string, limitar = true) {
  return (req: Request, res: Response, siguiente: NextFunction): void => {
    if (agentesConocidos(directorio()).length === 0) {
      res.status(503).json({ error: 'agent_api_disabled', message: 'No hay ningún token de agente configurado.' });
      return;
    }
    const token = tokenBearer(req);
    const agente = token ? agentePorToken(directorio(), token) : null;
    if (!agente) {
      res.status(401).json({ error: 'unauthorized', message: 'Token no válido.' });
      return;
    }
    if (limitar && !permitir(agente.nombre)) return limitado(agente.nombre, res);
    res.locals['agente'] = agente;
    siguiente();
  };
}

/** Gasta cupo del agente ya autenticado solo en las peticiones que `cuesta` dice. */
export function limitarAgente(cuesta: (req: Request) => boolean) {
  return (req: Request, res: Response, siguiente: NextFunction): void => {
    const agente = agenteDe(res);
    if (agente && cuesta(req) && !permitir(agente.nombre)) return limitado(agente.nombre, res);
    siguiente();
  };
}

export function requiere(dominio: Dominio, accion: Accion) {
  return (_req: Request, res: Response, siguiente: NextFunction): void => {
    const agente = agenteDe(res);
    if (!agente || !puede(agente.permisos, dominio, accion)) {
      res.status(403).json({ error: 'forbidden', message: `Sin permiso para ${accion} en ${dominio}.` });
      return;
    }
    siguiente();
  };
}
