// Entradas de las comprobaciones: todo lo que miran comprobacionesDe() y sus reglas, leído de una vez.
import { abrirIndiceLectura } from '../../../biblioteca/motor/documentos/servicioIndice.js';
import { citasDeRequisitos, type Comprobacion } from '../citasPliego.js';
import { z } from 'zod';
import { listarPersonas, type PersonaGuardada } from '../../../nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { leerPerfilEmpresa, type PerfilGuardado } from '../../../nucleo/empresa.js';
import { logger } from '../../../nucleo/log.js';
import { leerPerfilCostes, type PerfilCostesData } from '../../../nucleo/perfilCostes.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { medianasDuracion } from '../../../nucleo/colaEstadisticas.js';
import { fichasDe, type FichaDatosData, type FichaGuardada } from '../ficha.js';
import { idsDelAmbito, lotesDeLicitacion, type LotesLicitacion } from '../lotes.js';
import { obtenerLicitacion, type Db } from '../store.js';
import type { Cita, EstadoBloqueo, PropuestaHermes } from './comprobacionesTipos.js';
import { coherenciaOferta, type Incoherencia } from './coherencia.js';
import { hallazgosDe, textoParaCoherencia } from './coherenciaMemoria.js';
import type { CompromisoDeFicha } from './costesCompromisos.js';
import { textoParaCostes } from './costesTexto.js';
import {
  decisionesDe,
  lotesDecididos,
  problemasDeAutomaticos,
  problemasDeEquipo,
  type DecisionesGuardadas,
} from './decisiones.js';
import { documentosDelGuion, type DocumentoConClave, type FilaDocumento } from './documentos.js';
import { apartadosDe, type FilaMemoria } from './ensamblado.js';
import { datosDeFila } from './fugasMemoria.js';
import { estrategiaDe } from './estrategia.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { pedidosPorHermes } from './hermesEnVivo.js';
import { duracionesFases, TIPO_DE_FASE, type DuracionesFase } from './horaCierre.js';
import type { Hallazgo } from './hechos.js';
import { memoriaDeLaOferta, memoriasDe, presentadaDelLote, type EstadoMemoria } from './memoria.js';
import { TIPO_MEMORIA_REDACCION } from './redaccion.js';
import { leccionesNoAplicadas, type LeccionNoAplicada } from './leccionesAplicadas.js';
import { reutilizacionesDe, type Reutilizacion } from './reutilizacionLiteral.js';
import { criticasDe, criticaVigente } from './critica.js';
import { notaTribunal, type NotaTribunal } from './tribunal.js';
import { preguntasEnComprobaciones, type PreguntaPliego } from '../preguntasPliego.js';
import { lotesDeMemoria } from './memoriaLote.js';
import type { ApartadoDatosData } from './memoriaRevision.js';
import { paqueteVigente, type PaqueteVigente } from './paqueteManifiesto.js';
import { pasajesParaCompromisos, type PasajesCompromisos } from './pliegoCompromisos.js';
import { propuestaDecisionesDe, type PropuestaGuardada } from './propuestaDecisiones.js';

// Se lee dentro de una sola transacción de lectura, para que la versión (ETag) no mezcle dos momentos. Aquí no
// se escribe nada: ni se sincroniza la checklist ni se recalculan memorias.
// pedido_por_hermes: solo si lo pidió un agente con licitaciones_pedir (hermesEnVivo.ts).
export type TrabajoEnCurso = {
  id: number;
  tipo: string;
  estado: 'pendiente' | 'lanzado';
  creado_en: string;
  actualizado_en: string;
  lanzado_en: string | null;
  pedido_por_hermes?: true;
};
export type PliegoComprobaciones = { nombre: string; clase: string; estado: string; actualizado_en: string };
type OportunidadComprobaciones = { estado: string; motivo_descarte: string | null; lotes_interes: string | null };
// La última fila de oferta_bloqueos por clave: solo vale mientras su huella sea la de ahora.
export type EstadoGuardado = {
  clave: string;
  huella: string;
  estado: EstadoBloqueo;
  propuesta: PropuestaHermes | null;
  quien: string;
  motivo: string | null;
  en: string;
  // La evidencia de la propuesta (evidencia_json): solo se guarda tras comprobar cada cita literal.
  citas: Cita[];
};

// La memoria que cuenta de un lote (la aceptada de su lote o, si no hay, la última) con lo que se
// mira de ella; aceptadas: las rutas de las aceptadas de ese lote (docx y PDF); textos: su texto
// apartado a apartado, como textos_memoria (vacío si no está ensamblada).
type MemoriaDelLote = {
  lote: string;
  memoria: EstadoMemoria | null;
  hallazgos: Hallazgo[];
  fugas: EstadoMemoria['fugas'] | null;
  aceptadas: string[];
  textos: string[];
};
// rutas_memoria: las de todas las memorias montadas o subidas, para distinguir un documento puesto a mano.
export type MemoriaLotes = { lotes: string[]; por_lote: MemoriaDelLote[]; rutas_memoria: string[] };
// Una memoria que se evalúa en las comprobaciones (fase, obsoleta, portada, lo que promete, extensión,
// anonimato, fugas y hechos).
export type MemoriaEvaluada = Pick<MemoriaDelLote, 'memoria' | 'hallazgos' | 'fugas' | 'textos'> & {
  lote: string | null;
};
// El texto de una memoria como lo leen los compromisos con coste (textoParaCostes): con sus tablas y subtítulos.
// ficha: los compromisos de la solución de la estrategia (con lo que la persona quitó o justificó en
// la ficha): lo que ya se decidió no vuelve a salir como fila por suavizar.
type TextosCostes = { memoria_id: number; textos: string[]; ficha?: CompromisoDeFicha[] };

export type EntradasComprobaciones = {
  id: string;
  ahoraMs: number;
  licitacion: {
    fecha_limite: string | null;
    fecha_solicitud: string | null;
    borrada_en: string | null;
    borrada_motivo: string | null;
    presupuesto_sin_iva?: number | null;
  };
  oportunidad: OportunidadComprobaciones | null;
  lotes: LotesLicitacion;
  // Los ids de los lotes a los que se va (vacío si la licitación no va por lotes).
  ambito: string[];
  ficha: FichaGuardada | null;
  guion: GuionGuardado | null;
  decisiones: DecisionesGuardadas | null;
  decisiones_version: number | null;
  propuesta: PropuestaGuardada | null;
  // La memoria de la oferta: la presentada o, sin ella, la última que no es de ensayo (memoriaDeLaOferta).
  // Con memoria por lote, la que cuenta del lote más reciente aún sin entregar (memoriaDeTrabajo).
  memoria: EstadoMemoria | null;
  hallazgos: Hallazgo[];
  fugas: EstadoMemoria['fugas'] | null;
  // El texto de la memoria de la oferta (textos_memoria[i]: el apartado i+1), leído en la misma
  // transacción: las comprobaciones, Hoy, la lista y el MCP ven las mismas filas de «lo que promete la memoria».
  textos_memoria: string[];
  documentos: { filas: FilaDocumento[]; del_guion: DocumentoConClave[] };
  perfil: PerfilGuardado | null;
  personas: PersonaGuardada[];
  pliegos: PliegoComprobaciones[];
  trabajos: TrabajoEnCurso[];
  paquete: PaqueteVigente | null;
  coherencia: Incoherencia[];
  guardados: Map<string, EstadoGuardado>;
  // Lo que tarda Hermes en cada fase, con las medianas reales de la cola: la Mesa y las comprobaciones dan
  // así el mismo «decide antes de».
  duraciones: DuracionesFase;
  // La cita literal de cada requisito de la ficha, buscada en los pliegos. Sin ella, las
  // filas que salen de un requisito citan su descripción, sin comprobar.
  citas_requisitos?: Map<FichaDatosData['requisitos'][number], Comprobacion>;
  // Lo que las decisiones del guion vigente aún no deciden o no cuadra (automáticos sin decidir,
  // personas que ya no están): lo mismo que un PUT rechazaría. Vacío sin decisiones o de otro guion.
  decisiones_incompletas: string[];
  // Si el pliego pide una memoria por lote (memoriaLote.ts): la de cada lote. null o ausente: una común.
  memoria_lotes?: MemoriaLotes | null;
  // Lo que cuesta cumplir lo que promete cada memoria con trabajo (comprobacionesReglasCostes.ts), leído en la
  // misma transacción: el texto de cada una, el perfil de costes (solo web: lleva euros) y los
  // pasajes del pliego para cotejar. Ausentes: la regla no saca filas.
  textos_costes?: TextosCostes[];
  // Por cada memoria con trabajo (ensamblada, sin entregar), las lecciones de fuerza alta que no
  // se le pasaron o el crítico no ve cumplidas (leccionesAplicadas.ts). Ausente: la regla no saca filas.
  lecciones_no_aplicadas?: { lote: string | null; version: number; lecciones: LeccionNoAplicada[] }[];
  // Por cada memoria con trabajo, los apartados que copian literal una presentada a otro órgano
  // (reutilizacionLiteral.ts). Ausente: la regla no saca filas.
  reutilizaciones?: { lote: string | null; memoria_id: number; version: number; apartados: Reutilizacion[] }[];
  // Por cada memoria con trabajo y crítica, la nota del crítico ciego con su margen (tribunal.ts).
  tribunal?: { lote: string | null; memoria_id: number; version: number; nota: NotaTribunal }[];
  // Las respuestas de «Preguntar al pliego» que una persona pasó a las comprobaciones.
  preguntas_comprobaciones?: PreguntaPliego[];
  perfil_costes?: PerfilCostesData;
  pliego_costes?: PasajesCompromisos;
  // Lo que tarda un apartado de memoria (mediana medida, minutos); null con pocas muestras: limite_suavizar.
  ronda_memoria_min?: number | null;
};

/** Las memorias que las comprobaciones evalúan: con memoria por lote, la que cuenta de cada lote; si no, la de la oferta. */
export function memoriasEvaluadas(
  e: Pick<EntradasComprobaciones, 'memoria' | 'hallazgos' | 'fugas' | 'memoria_lotes' | 'textos_memoria'>,
): MemoriaEvaluada[] {
  return e.memoria_lotes
    ? e.memoria_lotes.por_lote
    : [{ lote: null, memoria: e.memoria, hallazgos: e.hallazgos, fugas: e.fugas, textos: e.textos_memoria ?? [] }];
}

/**
 * Las memorias con trabajo por revisar (obsoleta, portada, lo que promete): las de cada lote y,
 * si ningún lote tiene aún la suya sin entregar, la común que se hizo antes (sigue siendo la
 * memoria de la oferta que se ve y que se podría dar por buena).
 */
export function memoriasDeTrabajo(
  e: Pick<EntradasComprobaciones, 'memoria' | 'hallazgos' | 'fugas' | 'memoria_lotes' | 'textos_memoria'>,
): MemoriaEvaluada[] {
  const evaluadas = memoriasEvaluadas(e);
  if (!e.memoria_lotes || !e.memoria || (e.memoria.lote ?? null) !== null) return evaluadas;
  return [
    { lote: null, memoria: e.memoria, hallazgos: e.hallazgos, fugas: e.fugas, textos: e.textos_memoria ?? [] },
    ...evaluadas,
  ];
}

type FilaBloqueo = {
  clave: string;
  huella: string;
  estado: EstadoBloqueo;
  propuesta_json: string | null;
  evidencia_json: string | null;
  quien: string;
  motivo: string | null;
  en: string;
};

const log = logger('licitaciones');

function oportunidadDe(db: Db, id: string): OportunidadComprobaciones | null {
  return (
    (db.prepare('SELECT estado, motivo_descarte, lotes_interes FROM oportunidades WHERE licitacion_id = ?').get(id) as
      OportunidadComprobaciones | undefined) ?? null
  );
}

function versionDecisiones(db: Db, id: string): number | null {
  return (
    (
      db.prepare('SELECT version FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as
        { version: number } | undefined
    )?.version ?? null
  );
}

function leidaDe(
  db: Db,
  memoria: EstadoMemoria | null,
): Pick<EntradasComprobaciones, 'memoria' | 'hallazgos' | 'fugas'> {
  if (!memoria) return { memoria: null, hallazgos: [], fugas: null };
  const fila = db.prepare('SELECT coherencia FROM memorias WHERE id = ?').get(memoria.id) as
    Pick<FilaMemoria, 'coherencia'> | undefined;
  return { memoria, hallazgos: fila ? hallazgosDe(fila) : [], fugas: memoria.fugas };
}

type Leida = Pick<EntradasComprobaciones, 'memoria' | 'hallazgos' | 'fugas'>;

// Las memorias de ensayo se miden contra la presentada: no son la memoria de la oferta. Con memoria
// por lote, la presentada de un lote ya no se arregla: las reglas de la memoria de la oferta
// (promete, obsoleta, portada) miran la del lote que sigue abierto, la más reciente si hay varios.
function memoriaDeTrabajo(db: Db, memorias: EstadoMemoria[], ml: MemoriaLotes | null): Leida {
  const version = (x: MemoriaDelLote): number => (x.memoria && !x.memoria.presentada ? x.memoria.version : 0);
  const reciente = [...(ml?.por_lote ?? [])].sort((a, b) => version(b) - version(a))[0];
  if (!reciente || !version(reciente)) return leidaDe(db, memoriaDeLaOferta(memorias));
  return { memoria: reciente.memoria, hallazgos: reciente.hallazgos, fugas: reciente.fugas };
}

// La de un lote: la presentada de ese lote o la común (lo entregado manda); sin ella, la aceptada (la
// que irá en el paquete) y, si no hay, la última que no es de ensayo, como memoriaDeLaOferta.
function memoriaQueCuenta(memorias: EstadoMemoria[], lote: string): EstadoMemoria | null {
  const aceptada = memorias.find((m) => !m.ensayo && m.lote === lote && m.borrador?.estado === 'aceptada');
  return presentadaDelLote(memorias, lote) ?? aceptada ?? memoriaDeLaOferta(memorias, lote);
}

type RutaMemoria = { ruta: string; ruta_pdf: string | null; estado: string; lote: string | null };
const rutasDe = (f: RutaMemoria): string[] => (f.ruta_pdf ? [f.ruta, f.ruta_pdf] : [f.ruta]);

// Con los lotes decididos, como el pedido de la memoria (memoria.ts) y la regla memoria_por_lote.
function memoriaLotesDe(
  db: Db,
  id: string,
  x: { g: GuionGuardado | null; d: DecisionesGuardadas | null; memorias: EstadoMemoria[] },
): MemoriaLotes | null {
  const lotes = x.g ? lotesDeMemoria(x.g.datos, lotesDecididos(db, id, x.d?.datos.lotes ?? [])) : null;
  if (!lotes) return null;
  const rutas = db
    .prepare(
      `SELECT b.ruta, b.ruta_pdf, b.estado, m.lote FROM borradores b LEFT JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado'`,
    )
    .all(id) as RutaMemoria[];
  const por_lote = lotes.map((lote) => {
    const leida = leidaDe(db, memoriaQueCuenta(x.memorias, lote));
    const aceptadas = rutas.filter((f) => f.estado === 'aceptada' && f.lote === lote).flatMap(rutasDe);
    return { lote, ...leida, aceptadas, textos: textosDeMemoria(db, { id, memoria: leida.memoria }) };
  });
  return { lotes, por_lote, rutas_memoria: rutas.flatMap(rutasDe) };
}

/** El texto de la memoria de la oferta, apartado a apartado. Solo la ensamblada: mientras se redacta, cada apartado que llega movería las filas. */
function textosDeMemoria(db: Db, e: Pick<EntradasComprobaciones, 'id' | 'memoria'>): string[] {
  if (e.memoria?.estado !== 'ensamblada') return [];
  try {
    const filas = apartadosDe(db, e.memoria.id);
    const total = Math.max(0, ...filas.map((f) => f.apartado));
    return Array.from({ length: total }, (_, i) => {
      const d = datosDeFila(filas.find((f) => f.apartado === i + 1));
      return d ? textoParaCoherencia(d) : '';
    });
  } catch (err) {
    log.error('no se pudo leer el texto de la memoria para las comprobaciones', { id: e.id, error: errorMessage(err) });
    return [];
  }
}

// Como textosDeMemoria, pero con las tablas y los subtítulos: la dedicación fija vive en una tabla.
function textosParaCostes(db: Db, id: string, memoria: EstadoMemoria): string[] {
  try {
    const filas = apartadosDe(db, memoria.id);
    const total = Math.max(0, ...filas.map((f) => f.apartado));
    return Array.from({ length: total }, (_, i) => {
      const d: ApartadoDatosData | null = datosDeFila(filas.find((f) => f.apartado === i + 1));
      return d ? textoParaCostes(d, i + 1) : '';
    });
  } catch (err) {
    log.error('no se pudo leer el texto de la memoria para sus costes', { id, error: errorMessage(err) });
    return [];
  }
}

// Los compromisos de la solución; una versión subida a mano no tiene ficha. Si no se lee, la regla sale sin ella.
function fichaDeCostes(db: Db, memoriaId: number): CompromisoDeFicha[] {
  try {
    return (estrategiaDe(db, memoriaId)?.datos.solucion?.compromisos ?? []).map(
      ({ texto, clase, compensa, quitado }) => ({ texto, clase, compensa, quitado }),
    );
  } catch (err) {
    log.warn('no se pudo leer la ficha de solución para los costes', { memoria: memoriaId, error: errorMessage(err) });
    return [];
  }
}

// Las memorias con trabajo ensambladas y sin entregar: lo presentado ya no se suaviza.
function textosCostesDe(db: Db, e: EntradasComprobaciones): TextosCostes[] {
  const vistas = new Set<number>();
  return memoriasDeTrabajo(e).flatMap(({ memoria }) => {
    if (memoria?.estado !== 'ensamblada' || memoria.presentada || vistas.has(memoria.id)) return [];
    vistas.add(memoria.id);
    return [
      { memoria_id: memoria.id, textos: textosParaCostes(db, e.id, memoria), ficha: fichaDeCostes(db, memoria.id) },
    ];
  });
}

// El perfil de costes (con LICITACIONES_PRECIO_HORA por defecto), el pliego para cotejar y la
// mediana de un apartado: solo si hay alguna memoria que mirar, para no leer el índice en balde.
function costesDe(db: Db, dbNucleo: DbNucleo, e: EntradasComprobaciones): Partial<EntradasComprobaciones> {
  const textos_costes = textosCostesDe(db, e);
  if (!textos_costes.length) return { textos_costes };
  return {
    textos_costes,
    perfil_costes: leerPerfilCostes(dbNucleo, nucleo().config.licitaciones.precioHora).perfil,
    pliego_costes: pasajesParaCompromisos(db, e.id),
    ronda_memoria_min:
      medianasDuracion(dbNucleo, [TIPO_MEMORIA_REDACCION], undefined, e.ahoraMs)[TIPO_MEMORIA_REDACCION] ?? null,
  };
}

function leccionesDe(db: Db, e: EntradasComprobaciones): Partial<EntradasComprobaciones> {
  const vistas = new Set<number>();
  const lecciones_no_aplicadas = memoriasDeTrabajo(e).flatMap(({ memoria, lote }) => {
    if (memoria?.estado !== 'ensamblada' || memoria.presentada || vistas.has(memoria.id)) return [];
    vistas.add(memoria.id);
    const lecciones = leccionesNoAplicadas(db, memoria.id);
    return lecciones.length ? [{ lote, version: memoria.version, lecciones }] : [];
  });
  return { lecciones_no_aplicadas };
}

// Como las lecciones: solo las memorias con trabajo, ensambladas y sin entregar, una vez cada una.
function reutilizacionesEn(db: Db, e: EntradasComprobaciones): Partial<EntradasComprobaciones> {
  const vistas = new Set<number>();
  const reutilizaciones = memoriasDeTrabajo(e).flatMap(({ memoria, lote, textos }) => {
    if (memoria?.estado !== 'ensamblada' || memoria.presentada || vistas.has(memoria.id)) return [];
    vistas.add(memoria.id);
    const apartados = reutilizacionesDe(db, e.id, textos);
    return apartados.length ? [{ lote, memoria_id: memoria.id, version: memoria.version, apartados }] : [];
  });
  return { reutilizaciones };
}

// La última crítica de cada memoria con trabajo, contra la memoria del guion vigente.
function tribunalDe(db: Db, e: EntradasComprobaciones): Partial<EntradasComprobaciones> {
  const vistas = new Set<number>();
  const tribunal = memoriasDeTrabajo(e).flatMap(({ memoria, lote }) => {
    if (memoria?.estado !== 'ensamblada' || memoria.presentada || vistas.has(memoria.id)) return [];
    vistas.add(memoria.id);
    // Una crítica de un texto anterior no dice nada del de ahora: no saca fila (la Revisión lo dice).
    const c = criticasDe(db, memoria.id).at(-1);
    const nota = c && criticaVigente(db, memoria.id, c) ? notaTribunal(c, e.guion?.datos.memoria ?? null) : null;
    return nota ? [{ lote, memoria_id: memoria.id, version: memoria.version, nota }] : [];
  });
  return { tribunal };
}

// Los mismos lotes que la checklist (documentos.ts): los decididos o, sin ellos, los del guion.
function documentosDe(
  db: Db,
  id: string,
  g: GuionGuardado | null,
  d: DecisionesGuardadas | null,
): EntradasComprobaciones['documentos'] {
  const filas = db.prepare('SELECT * FROM oferta_documentos WHERE licitacion_id = ?').all(id) as FilaDocumento[];
  if (!g) return { filas, del_guion: [] };
  const decididos = lotesDecididos(db, id, d?.datos.lotes ?? []);
  return { filas, del_guion: documentosDelGuion(g.datos, decididos.length ? decididos : (g.datos.lotes ?? [])) };
}

function pliegosDe(db: Db, id: string): PliegoComprobaciones[] {
  return db
    .prepare(
      'SELECT nombre, clase, estado, actualizado_en FROM pliegos WHERE licitacion_id = ? ORDER BY actualizado_en, nombre',
    )
    .all(id) as PliegoComprobaciones[];
}

function trabajosEnCurso(dbNucleo: DbNucleo, id: string): TrabajoEnCurso[] {
  const filas = dbNucleo
    .prepare(
      `SELECT id, tipo, estado, creado_en, actualizado_en, lanzado_en FROM trabajos_ia
    WHERE dominio = 'licitaciones' AND estado IN ('pendiente', 'lanzado') AND json_extract(payload, '$.id') = ? ORDER BY id`,
    )
    .all(id) as TrabajoEnCurso[];
  if (!filas.length) return filas;
  const deHermes = pedidosPorHermes(dbNucleo, id);
  return filas.map((t) => (deHermes.has(t.id) ? { ...t, pedido_por_hermes: true as const } : t));
}

// Una propuesta guardada ilegible no tumba las comprobaciones: la fila sigue, sin propuesta.
function propuestaDe(f: FilaBloqueo, id: string): PropuestaHermes | null {
  if (!f.propuesta_json) return null;
  try {
    return JSON.parse(f.propuesta_json) as PropuestaHermes;
  } catch (err) {
    log.warn('propuesta de bloqueo ilegible', { id, clave: f.clave, error: errorMessage(err) });
    return null;
  }
}

const CitaGuardada = z.array(
  z.object({ documento: z.string(), pagina: z.number().int().nullable(), texto: z.string() }),
);

// Como la propuesta: una evidencia ilegible no tumba la fila, solo se queda sin citas.
function citasDe(f: FilaBloqueo, id: string): Cita[] {
  if (!f.evidencia_json) return [];
  try {
    const c = CitaGuardada.safeParse(JSON.parse(f.evidencia_json));
    if (c.success)
      return c.data.map((x) => ({ documento: x.documento, pagina: x.pagina, texto: x.texto, comprobada: true }));
    log.warn('evidencia de bloqueo ilegible', { id, clave: f.clave });
  } catch (err) {
    log.warn('evidencia de bloqueo ilegible', { id, clave: f.clave, error: errorMessage(err) });
  }
  return [];
}

function estadosGuardados(db: Db, id: string): Map<string, EstadoGuardado> {
  const filas = db
    .prepare(
      'SELECT clave, huella, estado, propuesta_json, evidencia_json, quien, motivo, en FROM oferta_bloqueos WHERE licitacion_id = ? ORDER BY id',
    )
    .all(id) as FilaBloqueo[];
  const porClave = new Map<string, EstadoGuardado>();
  for (const f of filas)
    porClave.set(f.clave, {
      clave: f.clave,
      huella: f.huella,
      estado: f.estado,
      propuesta: propuestaDe(f, id),
      quien: f.quien,
      motivo: f.motivo,
      en: f.en,
      citas: citasDe(f, id),
    });
  return porClave;
}

// Guardar una sola sección no exige las demás (decisionesSecciones.ts): lo que falta sale aquí.
function incompletas(dbNucleo: DbNucleo, g: GuionGuardado | null, d: DecisionesGuardadas | null): string[] {
  if (!g || !d || d.guion_id !== g.id) return [];
  return [...problemasDeAutomaticos(d.datos, g), ...problemasDeEquipo(dbNucleo, d.datos)];
}

function citasDeFicha(
  db: Db,
  id: string,
  ficha: FichaGuardada | null,
): Map<FichaDatosData['requisitos'][number], Comprobacion> {
  const requisitos = ficha?.datos.requisitos ?? [];
  const c = citasDeRequisitos(db, abrirIndiceLectura(), id, requisitos);
  return new Map(requisitos.flatMap((r, i) => (c[i] ? [[r, c[i]] as const] : [])));
}

const TIPOS_CON_MEDIANA = Object.values(TIPO_DE_FASE).filter((t): t is string => !!t);
const duracionesDe = (dbNucleo: DbNucleo, ahoraMs: number): DuracionesFase =>
  duracionesFases(medianasDuracion(dbNucleo, TIPOS_CON_MEDIANA, undefined, ahoraMs));

function leer(db: Db, dbNucleo: DbNucleo, id: string, ahoraMs: number): Result<EntradasComprobaciones> {
  const lic = obtenerLicitacion(db, id);
  const lotes = lotesDeLicitacion(db, id);
  if (!lic || !lotes) return fail('not_found', 'No existe esa licitación.');
  const guion = guionVigente(db, id);
  const decisiones = decisionesDe(db, id);
  const memorias = memoriasDe(db, id);
  const memoria_lotes = memoriaLotesDe(db, id, { g: guion, d: decisiones, memorias });
  const memoria = memoriaDeTrabajo(db, memorias, memoria_lotes);
  const ficha = fichasDe(db, id).aprobada;
  const e: EntradasComprobaciones = {
    id,
    ahoraMs,
    lotes,
    guion,
    decisiones,
    ambito: idsDelAmbito(lotes.ambito),
    licitacion: {
      fecha_limite: lic.fecha_limite,
      fecha_solicitud: lic.fecha_solicitud,
      borrada_en: lic.borrada_en,
      borrada_motivo: lic.borrada_motivo,
      presupuesto_sin_iva: lic.presupuesto_sin_iva,
    },
    oportunidad: oportunidadDe(db, id),
    ficha,
    citas_requisitos: citasDeFicha(db, id, ficha),
    decisiones_version: versionDecisiones(db, id),
    propuesta: propuestaDecisionesDe(db, id),
    ...memoria,
    textos_memoria: textosDeMemoria(db, { id, memoria: memoria.memoria }),
    documentos: documentosDe(db, id, guion, decisiones),
    perfil: leerPerfilEmpresa(dbNucleo),
    personas: listarPersonas(dbNucleo),
    pliegos: pliegosDe(db, id),
    trabajos: trabajosEnCurso(dbNucleo, id),
    paquete: paqueteVigente(db, id),
    coherencia: coherenciaOferta(db, id, { ahoraMs }),
    guardados: estadosGuardados(db, id),
    duraciones: duracionesDe(dbNucleo, ahoraMs),
    decisiones_incompletas: incompletas(dbNucleo, guion, decisiones),
    memoria_lotes,
    preguntas_comprobaciones: preguntasEnComprobaciones(db, id),
  };
  return ok({
    ...e,
    ...costesDe(db, dbNucleo, e),
    ...leccionesDe(db, e),
    ...reutilizacionesEn(db, e),
    ...tribunalDe(db, e),
  });
}

/** Lo que necesita las comprobaciones de una licitación, sin escribir nada. not_found si no existe. */
export function leerEntradasComprobaciones(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs: number,
): Result<EntradasComprobaciones> {
  try {
    return db.transaction(() => leer(db, dbNucleo, id, ahoraMs)).deferred();
  } catch (err) {
    log.error('no se pudieron leer las entradas de las comprobaciones', { id, error: errorMessage(err) });
    return fail('io_error', 'No se pudo leer el estado de la oferta.');
  }
}
