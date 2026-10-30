// Mensajes entre el servidor y el hilo del indexador.
import type { EstadisticasIndice } from './almacen.js';
import type { ResumenConversor } from '../../../nucleo/documentos/libreoffice.js';

export type DatosWorker = { raiz: string; carpetaIndice: string; carpetaModelos: string };

export type FaseIndexador = 'scanning' | 'reading' | 'embedding' | 'idle';

// `conversor`: LibreOffice visto desde el hilo (sus contadores son los de las conversiones del índice).
export type EstadoIndexador = EstadisticasIndice & {
  phase: FaseIndexador;
  model: string;
  modelError: string | null;
  conversor: ResumenConversor;
};

export type HaciaWorker = { type: 'query'; id: number; text: string; k: number; ids?: number[] } | { type: 'rescan' };

export type DesdeWorker =
  | { type: 'status'; status: EstadoIndexador }
  | { type: 'result'; id: number; hits: { id: number; score: number }[]; error: string | null }
  | { type: 'fatal'; error: string };
