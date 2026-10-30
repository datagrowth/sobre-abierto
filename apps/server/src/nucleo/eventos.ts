// Eventos entre dominios (p. ej. «licitacion.adjudicada»): se guardan en nucleo.db
// y se avisan en el proceso a quien escuche. Un dominio no importa a otro.
import { EventEmitter } from 'node:events';
import { ahora, type Db } from './db.js';

export type Evento = { tipo: string; dominio: string; recurso: string | null; datos: Record<string, unknown> };

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitir(db: Db, evento: Evento): void {
  db.prepare('INSERT INTO eventos (tipo, dominio, recurso, datos, creado_en) VALUES (?, ?, ?, ?, ?)').run(
    evento.tipo,
    evento.dominio,
    evento.recurso,
    JSON.stringify(evento.datos),
    ahora(),
  );
  bus.emit(evento.tipo, evento);
  bus.emit('*', evento);
}

export function escuchar(tipo: string, fn: (evento: Evento) => void): () => void {
  bus.on(tipo, fn);
  return () => bus.off(tipo, fn);
}

export function ultimosEventos(db: Db, limite: number): (Evento & { id: number; creado_en: string })[] {
  const rows = db.prepare('SELECT * FROM eventos ORDER BY id DESC LIMIT ?').all(limite) as {
    id: number;
    tipo: string;
    dominio: string;
    recurso: string | null;
    datos: string;
    creado_en: string;
  }[];
  return rows.map((r) => ({ ...r, datos: JSON.parse(r.datos) as Record<string, unknown> }));
}
