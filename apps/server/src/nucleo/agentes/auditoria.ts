// Registro de qué agente usó qué herramienta y sobre qué recurso. Nunca guarda
// argumentos ni contenidos: solo nombres, ids y si salió bien.
import { ahora, type Db } from '../db.js';

// «recortada»: salió bien, pero la respuesta pasó del tope y el agente no la vio entera.
export type Uso = {
  agente: string;
  herramienta: string;
  dominio: string;
  recurso: string | null;
  resultado: 'ok' | 'error' | 'recortada';
};

const CONSERVAR = 50_000;
let escrituras = 0;

export function registrarUso(db: Db, uso: Uso): void {
  db.prepare(
    'INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(uso.agente, uso.herramienta, uso.dominio, uso.recurso?.slice(0, 300) ?? null, uso.resultado, ahora());
  escrituras += 1;
  if (escrituras % 1000 === 0) {
    db.prepare('DELETE FROM auditoria_agentes WHERE id <= (SELECT MAX(id) FROM auditoria_agentes) - ?').run(CONSERVAR);
  }
}

/**
 * ¿Algún agente usó bien esta herramienta sobre un recurso que empieza por `prefijo`
 * desde `desde`? Sirve de comprobación «hecho» a los trabajos cuyo resultado es una
 * llamada a una tool (p. ej. proponer una nota en una carpeta).
 */
export function usadaDesde(db: Db, herramienta: string, prefijo: string, desde: string): boolean {
  const patron = `${prefijo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM auditoria_agentes WHERE herramienta = ? AND resultado IN ('ok', 'recortada')
    AND recurso LIKE ? ESCAPE '\\' AND creado_en >= ? LIMIT 1`,
      )
      .get(herramienta, patron, desde),
  );
}

export function usosRecientes(db: Db, limite: number, agente?: string): (Uso & { creado_en: string })[] {
  const sql = agente
    ? 'SELECT agente, herramienta, dominio, recurso, resultado, creado_en FROM auditoria_agentes WHERE agente = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT agente, herramienta, dominio, recurso, resultado, creado_en FROM auditoria_agentes ORDER BY id DESC LIMIT ?';
  const args = agente ? [agente, limite] : [limite];
  return db.prepare(sql).all(...args) as (Uso & { creado_en: string })[];
}
