// Contrato del asistente de la oferta: preguntas, respuestas rápidas y la acción que guarda cada una.
import { z } from 'zod';
import { DATOS_ANEXO } from './datosAnexo.js';

// Las preguntas salen por código de las decisiones pendientes; cada respuesta rápida lleva la acción que la
// guarda en su sección de las decisiones. Una acción la elige la persona (respuesta rápida) o la propone Hermes
// al interpretar un texto libre, y siempre la confirma una persona antes de guardarla.
export const SECCIONES_ASISTENTE = [
  'lotes',
  'equipo',
  'incorporar',
  'precio',
  'automaticos',
  'datos_anexo',
  'enfoque',
] as const;
export type SeccionAsistente = (typeof SECCIONES_ASISTENTE)[number];

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Lote = Texto(1, 20);
const Cita = z.strictObject({
  documento: Texto(1, 200),
  pagina: z.number().int().positive().nullable(),
  texto: Texto(1, 600),
});

// «contratar» no guarda nada: abre la repregunta del perfil a incorporar. «nombrar» la cierra y
// vuelve a preguntar a quién se pone.
export const Accion = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('lotes'), lotes: z.array(Lote).max(100) }),
  z.strictObject({
    tipo: z.literal('persona'),
    persona_id: z.number().int().positive(),
    rol: Texto(2, 120),
    lotes: z.array(Lote).max(100).default([]),
  }),
  z.strictObject({ tipo: z.literal('contratar'), rol: Texto(2, 120), lotes: z.array(Lote).max(100).default([]) }),
  z.strictObject({ tipo: z.literal('nombrar'), rol: Texto(2, 120), lotes: z.array(Lote).max(100).default([]) }),
  z.strictObject({
    tipo: z.literal('incorporar'),
    rol: Texto(2, 120),
    lotes: z.array(Lote).max(100).default([]),
    requisitos: Texto(3, 2000),
    acreditar_antes: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    plazo: Texto(2, 300).nullable(),
    cita: Cita.nullable(),
  }),
  // concepto: el precio es por unidad («alumno»), la única línea de precios unitarios del lote.
  z.strictObject({
    tipo: z.literal('precio'),
    lote: Lote.nullable(),
    importe: z.number().finite().positive(),
    concepto: Texto(2, 200).optional(),
  }),
  z.strictObject({
    tipo: z.literal('automatico'),
    criterio: Texto(2, 300),
    lote: Lote.nullable(),
    nos_acogemos: z.boolean(),
    tramo: Texto(2, 500).nullable(),
    valor: z.number().finite().nonnegative().optional(),
    evidencia: Texto(3, 600).optional(),
  }),
  z.strictObject({ tipo: z.literal('dato_anexo'), dato: z.enum(DATOS_ANEXO), valor: z.unknown() }),
  z.strictObject({ tipo: z.literal('enfoque'), texto: Texto(3, 8000) }),
]);
export type AccionData = z.infer<typeof Accion>;

// pide: la opción necesita un dato más antes de guardarse (el importe de «Otro precio», con qué se
// acredita un criterio). hermes: es lo que propuso Hermes en sus decisiones.
type Tono = 'ok' | 'riesgo' | 'impide' | 'neutro';
export type Opcion = {
  clave: string;
  texto: string;
  detalle: string | null;
  tono: Tono;
  hermes: boolean;
  accion: AccionData | null;
  pide?: 'importe' | 'evidencia';
  enlace?: string;
  concepto?: string;
};

type CitaPregunta = { documento: string; pagina: number | null; texto?: string };

// libre: qué hace con el texto libre — «hermes» lo interpreta (trabajo de cola) y «codigo» lo lee
// el código (un importe, unos lotes, el propio enfoque); null, solo respuestas rápidas.
export type Pregunta = {
  clave: string;
  seccion: SeccionAsistente;
  lote: string | null;
  titulo: string;
  texto: string;
  citas: CitaPregunta[];
  opciones: Opcion[];
  libre: 'hermes' | 'codigo' | null;
  estado: 'pendiente' | 'hecha';
  respuesta: string | null;
  deriva_de?: string;
};

export type Preguntas = {
  id: string;
  estado: 'sin_guion' | 'preguntando' | 'listas';
  preguntas: Pregunta[];
  hechas: number;
  total: number;
  avisos: string[];
  version: number | null;
};

/** La sección de las decisiones que guarda cada tipo de acción (null: no guarda nada). */
export function seccionDeAccion(
  a: AccionData,
): 'lotes' | 'equipo' | 'a_incorporar' | 'precio' | 'automaticos' | 'datos_anexo' | 'enfoque' | null {
  switch (a.tipo) {
    case 'lotes':
      return 'lotes';
    case 'persona':
      return 'equipo';
    case 'incorporar':
      return 'a_incorporar';
    case 'precio':
      return 'precio';
    case 'automatico':
      return 'automaticos';
    case 'dato_anexo':
      return 'datos_anexo';
    case 'enfoque':
      return 'enfoque';
    default:
      return null;
  }
}

// Qué acciones vale para cada pregunta: Hermes no puede contestar al precio con un equipo.
const ACCIONES_DE: Record<SeccionAsistente, AccionData['tipo'][]> = {
  lotes: ['lotes'],
  equipo: ['persona', 'contratar'],
  incorporar: ['incorporar', 'nombrar'],
  precio: ['precio'],
  automaticos: ['automatico'],
  datos_anexo: ['dato_anexo'],
  enfoque: ['enfoque'],
};

export const accionValePara = (s: SeccionAsistente, a: AccionData): boolean => ACCIONES_DE[s].includes(a.tipo);
