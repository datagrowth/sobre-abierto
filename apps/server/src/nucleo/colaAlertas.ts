// Lo que tiene parada la IA de un dominio, para el aviso de la web: el límite de uso del modelo,
// herramientas que Hermes no tiene o tiene viejas, o un tipo frenado por fallos.
import type { Db } from './db.js';
import { desfaseDeTipo, esperaHerramienta, pausaIso } from './colaEsperas.js';
import { frenadosDeTipo, recursosConFallos } from './colaFrenos.js';
import { nombreDe } from './colaTipos.js';

// hasta: null en «desfase», que no acaba a una hora sino cuando Hermes vuelva a pedir la lista.
// En «fallos»: alcance (el tipo entero o solo unas ofertas) y recursos, las ofertas frenadas (con
// el tipo entero, las que fallaron en las últimas horas).
export type AlertaIa = {
  motivo: 'limite' | 'fallos' | 'herramienta' | 'desfase';
  tipo: string | null;
  hasta: string | null;
  error: string | null;
  alcance?: 'tipo' | 'recurso';
  recursos?: string[];
  // El nombre del tipo en español (fijarNombreTrabajos); null en la pausa por límite, que es de toda la cola.
  nombre?: string | null;
};

function alertaFallos(db: Db, tipo: string): AlertaIa | null {
  const frenados = frenadosDeTipo(db, tipo);
  if (!frenados.length) return null;
  const global = frenados.find((f) => f.recurso === null);
  const recursos = global ? recursosConFallos(db, tipo, Date.now()) : frenados.map((f) => f.recurso as string);
  const hasta =
    global?.hasta ??
    frenados
      .map((f) => f.hasta)
      .sort()
      .at(-1)!;
  const ultimo = db
    .prepare("SELECT error FROM trabajos_ia WHERE tipo = ? AND estado = 'fallido' ORDER BY actualizado_en DESC LIMIT 1")
    .get(tipo) as { error: string | null } | undefined;
  return {
    motivo: 'fallos',
    tipo,
    hasta,
    error: ultimo?.error?.slice(0, 200) ?? null,
    alcance: global ? 'tipo' : 'recurso',
    recursos,
  };
}

function alertaDesfase(db: Db, tipo: string): AlertaIa | null {
  const d = desfaseDeTipo(db, tipo);
  if (!d) return null;
  const espera = db.prepare("SELECT 1 FROM trabajos_ia WHERE tipo = ? AND estado = 'pendiente' LIMIT 1").get(tipo);
  const cuando = d.desde ? ` el ${d.desde}` : '';
  return espera
    ? {
        motivo: 'desfase',
        tipo,
        hasta: null,
        error: `Perfil ${d.agente}: sus herramientas cambiaron${cuando} y no ha vuelto a pedir la lista.`,
      }
    : null;
}

/** Lo que tiene parada la IA de un dominio: el límite de uso del modelo, herramientas que Hermes no tiene o tiene viejas, o un tipo frenado por fallos. */
export function alertasIa(db: Db, dominio: string): AlertaIa[] {
  const out: AlertaIa[] = [];
  const pausa = pausaIso(db);
  if (pausa) out.push({ motivo: 'limite', tipo: null, hasta: pausa, error: null });
  const delDominio = db.prepare('SELECT DISTINCT tipo FROM trabajos_ia WHERE dominio = ?').all(dominio) as {
    tipo: string;
  }[];
  for (const { tipo } of delDominio) {
    const espera = esperaHerramienta(db, tipo);
    if (espera) out.push({ motivo: 'herramienta', tipo, hasta: espera.hasta, error: espera.error.slice(0, 200) });
    const desfase = alertaDesfase(db, tipo);
    if (desfase) out.push(desfase);
    const fallos = alertaFallos(db, tipo);
    if (fallos) out.push(fallos);
  }
  return out.map((a) => ({ ...a, nombre: a.tipo ? nombreDe(dominio, a.tipo) : null }));
}
