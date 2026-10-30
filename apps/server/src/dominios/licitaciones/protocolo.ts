// Mensajes entre el servidor y el hilo de ingesta de licitaciones.
import type { FuenteId } from './placsp/fuentes.js';
import type { SyncEstado } from './store.js';

// historicoTodo: el histórico guarda también lo que no es del sector.
export type DatosIngesta = {
  dataDir: string;
  fuentes: FuenteId[];
  maxPaginas: number;
  syncMinutos: number;
  historicoTodo: boolean;
};

export type ResumenVuelta = {
  en: string;
  paginas: number;
  entradas: number;
  errores: number;
  cambiadas: number;
  error: string | null;
};

export type EstadoIngesta = {
  fase: 'esperando' | `sincronizando ${FuenteId}`;
  fuentes: Record<string, SyncEstado & { ultima: ResumenVuelta | null }>;
  contadores: { total: number; abiertas: number; adjudicaciones: number };
};

export type HaciaIngesta = { type: 'sync' } | { type: 'prefiltrar' } | { type: 'historico' };

export type DesdeIngesta =
  { type: 'estado'; estado: EstadoIngesta } | { type: 'candidatas'; nuevas: number } | { type: 'fatal'; error: string };
