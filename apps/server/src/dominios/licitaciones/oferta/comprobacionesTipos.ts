// Contrato de las comprobaciones: tipos y helpers puros compartidos con la web.
// Sin E/S: el agregador comprobacionesDe() vive aparte y solo rellena estas estructuras.
import crypto from 'node:crypto';
import type { BloqueoPropuestaEntrada } from './bloqueoProponer.js';
import type { Hito } from './hitos.js';

export type Gravedad = 'impide' | 'riesgo' | 'ok' | 'no_comprobado';
export type Categoria =
  'elegibilidad' | 'precio' | 'decisiones' | 'coherencia' | 'fugas' | 'documentos' | 'empresa' | 'firma' | 'plazo';
export type Actor = 'tu' | 'hermes' | 'negocio' | 'fuera';
export type AccionBloqueo =
  | 'vamos'
  | 'descartar'
  | 'aceptar_riesgo'
  | 'fijar_precio'
  | 'aplicar_diff'
  | 'asignar_rol'
  | 'desmarcar_criterio'
  | 'subir_certificado'
  | 'consulta_organo'
  | 'completar_empresa'
  | 'rehacer_ficha'
  | 'extraer_guion'
  | 'revisar_memoria'
  | 'preparar_documento'
  | 'rehacer_anexo'
  | 'esperar_hermes'
  | 'campo'
  | 'suavizar';
export type EstadoBloqueo = 'abierto' | 'propuesta' | 'riesgo_aceptado' | 'vamos' | 'resuelto';

export type Cita = { documento: string; pagina: number | null; texto: string; comprobada: boolean };
// tipo y datos: lo que propuso Hermes con licitaciones_bloqueo_proponer (lo aplica una persona);
// citas: su evidencia, comprobada literal antes de guardarla.
export type PropuestaHermes = {
  resumen: string;
  campos: number;
  tipo?: BloqueoPropuestaEntrada['tipo'];
  datos?: BloqueoPropuestaEntrada['datos'];
  citas?: Cita[];
};

export type Bloqueo = {
  clave: string;
  categoria: Categoria;
  lote: string | null;
  gravedad: Gravedad;
  titulo: string;
  cita: Cita | null;
  actor: Actor;
  accion: { tipo: AccionBloqueo; destino?: string };
  propuesta: PropuestaHermes | null;
  minutos: number;
  estado: EstadoBloqueo;
  huella: string;
};

export type NombreFase =
  'decidir' | 'pliegos' | 'guion' | 'decisiones' | 'memoria' | 'documentos' | 'paquete' | 'presentar';
export type Fase = {
  nombre: NombreFase;
  estado: 'hecho' | 'en_curso' | 'te_toca' | 'pendiente' | 'no_aplica' | 'bloqueado';
  actor: Actor;
  eta: { desde: string; hasta: string } | null;
};

// pedido_por_hermes: la web lo dice como «pedido por Hermes» (licitaciones_pedir); sin él, lo pidió una persona o la cadena.
export type EnVivo = { tipo: string; estado: 'en_cola' | 'generando'; desde: string; pedido_por_hermes?: true };

type TipoVeredicto =
  | 'descartada'
  | 'no_presentable'
  | 'faltan_decisiones'
  | 'hermes_trabajando'
  | 'presentable_con_riesgos'
  | 'lista_para_firmar';

export type Comprobaciones = {
  id: string;
  veredicto: { tipo: TipoVeredicto; texto: string };
  hora_interna_cierre: string;
  limite_decidir: string | null;
  // Hasta cuándo da tiempo a una ronda de memoria que suavice los compromisos caros (null sin cierre o sin ellos).
  limite_suavizar: string | null;
  minutos_persona: number;
  bloqueos: Bloqueo[];
  comprobado: { clave: string; texto: string }[];
  fases: Fase[];
  // Los hitos hacia atrás desde la hora interna de cierre (hitos.ts); vacío sin cierre.
  hitos: Hito[];
  hermes: EnVivo | null;
  version: string;
};

const ORDEN_CATEGORIAS: readonly Categoria[] = [
  'elegibilidad',
  'precio',
  'decisiones',
  'coherencia',
  'fugas',
  'documentos',
  'empresa',
  'firma',
  'plazo',
];

// Tabla fija; la telemetría la recalibrará, por eso vive en un solo sitio.
export const MINUTOS_POR_ACCION: Record<AccionBloqueo, number> = {
  vamos: 1,
  descartar: 1,
  aceptar_riesgo: 1,
  fijar_precio: 1,
  aplicar_diff: 1,
  asignar_rol: 0.5,
  desmarcar_criterio: 0.5,
  subir_certificado: 1,
  consulta_organo: 1,
  completar_empresa: 1,
  rehacer_ficha: 0,
  extraer_guion: 0,
  revisar_memoria: 5,
  preparar_documento: 0.5,
  rehacer_anexo: 0.5,
  esperar_hermes: 0,
  campo: 0.5,
  suavizar: 1,
};

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Clave estable entre recálculos: la misma regla sobre el mismo lote o sujeto da la misma fila.
export function claveBloqueo(regla: string, lote: string | null, sujeto?: string): string {
  const fin = sujeto ? `:${normalizar(sujeto)}` : '';
  return `${regla}:${lote ?? '-'}${fin}`;
}

export function huellaDe(...partes: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 16);
}

const PESO_GRAVEDAD: Record<Gravedad, number> = { impide: 0, riesgo: 1, no_comprobado: 2, ok: 3 };

export function ordenarBloqueos(bloqueos: readonly Bloqueo[]): Bloqueo[] {
  return [...bloqueos].sort(
    (a, b) =>
      ORDEN_CATEGORIAS.indexOf(a.categoria) - ORDEN_CATEGORIAS.indexOf(b.categoria) ||
      PESO_GRAVEDAD[a.gravedad] - PESO_GRAVEDAD[b.gravedad] ||
      (a.lote ?? '').localeCompare(b.lote ?? '', 'es', { numeric: true }),
  );
}
