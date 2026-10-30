// El hilo del asistente de la oferta: respuestas de la persona, lo que guardó el código y la interpretación de Hermes.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import type { Db } from '../store.js';
import { Accion } from './asistenteTipos.js';

// Incluye el texto libre que interpreta Hermes y su interpretación por confirmar. Lo lee la web y, sin importes,
// Hermes por MCP (licitaciones_oferta_hilo).
// respuesta: una respuesta rápida o confirmada; guardado y error: lo que hizo el código con ella;
// aviso: lo guardado vale, pero conviene revisarlo (un precio por debajo del umbral de anormalidad),
// y se repregunta; libre: texto libre para Hermes; interpretacion: lo que entendió Hermes; generar: «OK, generar».
export const TIPOS_HILO = ['respuesta', 'guardado', 'aviso', 'error', 'libre', 'interpretacion', 'generar'] as const;
type TipoHilo = (typeof TIPOS_HILO)[number];
export type EstadoHilo =
  'interpretando' | 'interpretada' | 'fallida' | 'por_confirmar' | 'confirmada' | 'rechazada' | null;

// En «datos»: la pregunta tal como se vio (título), la opción elegida y la acción; o la interpretación.
const DatosHilo = z
  .object({
    titulo: z.string().optional(),
    seccion: z.string().optional(),
    opcion: z.string().nullable().optional(),
    accion: Accion.nullable().optional(),
    explicacion: z.string().optional(),
    repregunta: z.string().optional(),
    libre: z.number().int().optional(),
  })
  .catch({});
type DatosHiloData = z.infer<typeof DatosHilo>;

export type MensajeHilo = {
  id: number;
  pregunta: string | null;
  autor: 'persona' | 'hermes' | 'plataforma';
  tipo: TipoHilo;
  texto: string;
  datos: DatosHiloData;
  estado: EstadoHilo;
  creado_en: string;
};
type Fila = Omit<MensajeHilo, 'datos'> & { licitacion_id: string; datos: string | null };

const aMensaje = (f: Fila): MensajeHilo => {
  let datos: unknown = {};
  try {
    datos = f.datos ? JSON.parse(f.datos) : {};
  } catch {
    datos = {};
  }
  return {
    id: f.id,
    pregunta: f.pregunta,
    autor: f.autor,
    tipo: f.tipo,
    texto: f.texto,
    datos: DatosHilo.parse(datos),
    estado: f.estado,
    creado_en: f.creado_en,
  };
};

export type NuevoMensaje = {
  pregunta: string | null;
  autor: MensajeHilo['autor'];
  tipo: TipoHilo;
  texto: string;
  datos?: DatosHiloData;
  estado?: EstadoHilo;
};

/** Añade un mensaje al hilo y avisa a la web (el evento solo lleva el id: el texto puede nombrar a alguien). */
export function anotarHilo(db: Db, id: string, m: NuevoMensaje): MensajeHilo {
  const r = db
    .prepare(
      'INSERT INTO oferta_hilo (licitacion_id, pregunta, autor, tipo, texto, datos, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      m.pregunta,
      m.autor,
      m.tipo,
      m.texto,
      m.datos ? JSON.stringify(m.datos) : null,
      m.estado ?? null,
      new Date().toISOString(),
    );
  emitir(db, {
    tipo: 'licitacion.asistente',
    dominio: 'licitaciones',
    recurso: id,
    datos: { id, mensaje: Number(r.lastInsertRowid) },
  });
  return mensajeDe(db, id, Number(r.lastInsertRowid))!;
}

export function mensajeDe(db: Db, id: string, mensaje: number): MensajeHilo | null {
  const f = db.prepare('SELECT * FROM oferta_hilo WHERE licitacion_id = ? AND id = ?').get(id, mensaje) as
    Fila | undefined;
  return f ? aMensaje(f) : null;
}

export function hiloDe(db: Db, id: string): MensajeHilo[] {
  return (db.prepare('SELECT * FROM oferta_hilo WHERE licitacion_id = ? ORDER BY id').all(id) as Fila[]).map(aMensaje);
}

export function cambiarEstado(db: Db, id: string, mensaje: number, estado: EstadoHilo): void {
  db.prepare('UPDATE oferta_hilo SET estado = ? WHERE licitacion_id = ? AND id = ?').run(estado, id, mensaje);
}
