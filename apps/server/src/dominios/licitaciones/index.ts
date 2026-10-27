// Arranque del dominio Licitaciones: trabajos para Hermes, tools MCP, estado, hilo de ingesta y vuelta de cada minuto.
import { registrarAvisosLicitaciones } from './avisos.js';
import { registrarLectura } from '../../nucleo/apiLectura.js';
import { filasIndices, filasLecciones, filasPipeline, filasPresentadas } from './apiLectura.js';
import { cargarVocabularioCpv } from './clasificacion.js';
import { nucleo } from '../../nucleo/contexto.js';
import { nombreTrabajo } from './oferta/hermesEnVivo.js';
import { alertasIa } from '../../nucleo/colaAlertas.js';
import { fijarEventoTrabajos, fijarNombreTrabajos, registrarTipoTrabajo } from '../../nucleo/colaTipos.js';
import { fijarLimitador } from '../../nucleo/colaOrden.js';
import { encolar } from '../../nucleo/trabajos.js';
import { reactivarTipo } from '../../nucleo/colaFrenos.js';
import type { DestinoHermes } from '../../nucleo/hermes/runs.js';
import { anadirHerramientas } from '../../nucleo/mcp/servidor.js';
import { registrarEstado } from '../../nucleo/estado.js';
import { registrarHoy } from '../../nucleo/hoy.js';
import { registrarTitulos } from '../../nucleo/colaResumen.js';
import { cargarCarpetasUnicas } from './carpetasUnicas.js';
import { registrarCarpetaConFicha } from '../../nucleo/documentos.js';
import { hoyLicitaciones } from './hoy.js';
import { emitir, escuchar } from '../../nucleo/eventos.js';
import { areasFormacion, leerPerfilEmpresa, nombreEmpresa } from '../../nucleo/empresa.js';
import { raicesActuales } from '../../nucleo/salidas.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { logger } from '../../nucleo/log.js';
import { regenerarPaquetesAuto } from './oferta/paqueteAuto.js';
import {
  instruccionesRevisionPrevia,
  PayloadRevisionPrevia,
  revisionesPreviasAuto,
  revisionPreviaHecha,
  TIPO_REVISION_PREVIA,
} from './oferta/revisionPrevia.js';
import { dbLicitaciones } from './db.js';
import { registrarPrioridades } from './prioridadCola.js';
import { descartarPorIdioma, descartarPorImporte } from './prefiltro.js';
import {
  AVISO_SIN_PERFIL,
  crearLotes,
  hayPerfilCriba,
  instruccionesCriba,
  liberarLotesFallidos,
  loteCribado,
  retirarCandidatasCerradas,
  tocaCribar,
  TIPO_CRIBA,
} from './criba.js';
import {
  descargarPendientes,
  descartarSinPliegos,
  encolarPliegosNuevos,
  recuperarConPliegos,
  repararZipsComoPdf,
} from './pliegos.js';
import { revisarExpedientes } from './pliegosExpediente.js';
import { revisarErrores } from './errores.js';
import { pliegosIlegibles } from './pliegosIndice.js';
import { estadoIngesta, iniciarIngesta } from './ingesta.js';
import { herramientasLicitaciones } from './tools.js';
import { revisarRequisitos } from './gonogo.js';
import { resumenHistorico } from './historico.js';
import {
  aplicarFichasPendientes,
  encolarFichasAuto,
  fichaRecibidaDe,
  instruccionesFicha,
  legibles,
  PayloadFicha,
  TIPO_FICHA,
} from './ficha.js';
import { resumenRegeneracion, vueltaRegeneracion } from './fichaRegeneracion.js';
import path from 'node:path';
import type { OrigenMetricas } from '../../nucleo/hermes/metricas.js';
import { fichasRecientes } from './fichaMetricas.js';
import {
  instruccionesResumen,
  PayloadResumen,
  resumenRecibido,
  TIPO_RESUMEN_COMPETIDOR,
} from './competencia/resumen.js';
import { retirarTrabajosBorrador } from './propuestas/borrador.js';
import {
  evaluacionRecibida,
  instruccionesEvaluacion,
  PayloadEvaluacion,
  TIPO_EVALUACION,
} from './propuestas/evaluacion.js';
import { resolverPropuestas } from './propuestas/resolucion.js';
import { carpetasLicitaciones } from './carpetas.js';
import { comprobarSincronizacion, descargaPermitida, leerReorganizacion, reorganizarSiToca } from './reorganizacion.js';
import { contarPresentadas, procesarPresentadas } from './presentadas.js';
import { encolarActasEnVuelta, registrarAprenderActa } from './propuestas/actas.js';
import { z } from 'zod';
import { marcarVuelta } from '../../nucleo/programado.js';
import { registrarProgramadoLicitaciones, VUELTA_RADAR } from './programado.js';
import { vueltaCobertura } from './cobertura.js';
import { guionRecibidoDe, instruccionesGuion, PayloadGuion, TIPO_GUION } from './oferta/guion.js';
import { marcarApartadosFallidos } from './oferta/memoria.js';
import { reanudarEnsamblados } from './oferta/reanudarEnsamblado.js';
import { avanzarMemoria, vueltaMemorias } from './oferta/avanceMemoria.js';
import {
  estrategiaRecibida,
  instruccionesEstrategia,
  PayloadEstrategia,
  TIPO_MEMORIA_ESTRATEGIA,
} from './oferta/estrategia.js';
import {
  instruccionesRedaccion,
  PayloadRedaccion,
  redaccionHecha,
  TIPO_MEMORIA_REDACCION,
} from './oferta/redaccion.js';
import { hechosRecibidos, instruccionesHechos, PayloadHechos, TIPO_MEMORIA_HECHOS } from './oferta/parcheHechos.js';
import { criticaRecibida, PayloadCritica, TIPO_MEMORIA_CRITICA } from './oferta/critica.js';
import { instruccionesDeLaCritica } from './oferta/criticaPares.js';
import { instruccionesJuicio, juicioRecibido, PayloadJuicio, TIPO_EVAL_JUICIO } from './oferta/evalMemorias.js';
import { registrarTipoAnexo } from './oferta/anexosRutas.js';
import {
  instruccionesInterpretar,
  interpretacionRecibida,
  PayloadInterpretar,
  TIPO_INTERPRETAR,
} from './oferta/asistenteInterpretar.js';
import { vueltaIndices } from './indices/index.js';
import { vueltaAcierto } from './indices/acierto.js';
import { vueltaRenovaciones } from './indices/renovaciones.js';
import {
  actaMercadoLeida,
  instruccionesActaMercado,
  PayloadActaMercado,
  TIPO_ACTA_MERCADO,
  vueltaActasMercado,
} from './actasMercado.js';
import { instruccionesPregunta, PayloadPregunta, preguntaRespondida, TIPO_PREGUNTA_PLIEGO } from './preguntasPliego.js';
import { registrarAsignaciones } from '../../nucleo/colaboradores/disponibilidad.js';
import { asignacionesLicitaciones } from './equipoAsignaciones.js';
import { registrarVigenciaIncorporar } from '../../nucleo/colaboradores/aIncorporar.js';
import { ofertaSigue } from './oferta/aIncorporarOferta.js';
import { regenerarAnexosPorCodigo } from './oferta/anexosRegeneracion.js';
import { prepararModelosPdf } from './oferta/modelosPdf.js';
import { deucAuto } from './oferta/deuc.js';
import { vueltaCadena } from './oferta/cadena.js';
import { limitadorLicitaciones } from './oferta/topes.js';
import { solicitudesDeFichas } from './oportunidades.js';
import {
  instruccionesPropuestaDecisiones,
  PayloadPropuestaDecisiones,
  proponerAlLlegarGuion,
  propuestaRecibida,
  TIPO_PROPUESTA_DECISIONES,
} from './oferta/propuestaDecisiones.js';
import { instruccionesLecciones, leccionesRecibidas, PayloadLecciones, TIPO_LECCIONES } from './oferta/lecciones.js';
import { retirarSinUso } from './oferta/aprendizajeVista.js';
import { proponerParrafosSiToca } from './oferta/parrafosRepetidos.js';
import { taparPersonas } from './oferta/ofertaAgente.js';
import { leccionesDeActasAnteriores } from './propuestas/leccionesResultado.js';
import { crearPropuesta } from '../../biblioteca/motor/bandeja.js';
import { registrarSincronizacionDocumentos } from './oferta/documentosSync.js';
import { registrarEventosComprobaciones } from './oferta/comprobacionesEventos.js';
import type { Db as DbNucleo } from '../../nucleo/db.js';
import type { Db } from './store.js';
import { FUENTES, type FuenteId } from './placsp/fuentes.js';

// En cada vuelta: descartes automáticos, criba, carpetas de Conocimiento, pliegos, fichas, guiones y memorias de
// la oferta, y resultado de las propuestas presentadas.
const VUELTA_MS = 60_000;
// Las carpetas de lo presentado se crean salvo con la reorganización sin empezar o moviendo:
// con errores de alguna carpeta (o sin Drive) también, para que un fallo no lo pare todo.
const PUEDE_ARCHIVAR = new Set(['hecha', 'sincronizando', 'sin_drive', 'error']);
const MAX_OMITIDAS_ESTADO = 200;
const PayloadCriba = z.object({ lote: z.number().int().positive() });
const log = logger('licitaciones');

/** Descarta lo que la empresa no puede presentar según el perfil de la empresa o queda fuera de los filtros. */
export function aplicarDescarteAutomatico(): number {
  return (
    revisarRequisitos(dbLicitaciones(), leerPerfilEmpresa(nucleo().db)?.perfil ?? null) +
    descartarPorIdioma(dbLicitaciones()) +
    descartarPorImporte(dbLicitaciones())
  );
}

/**
 * Crea lotes de criba si toca (o si se fuerza) y los encola para Hermes. Antes descarta
 * lo que no cumple: no se gasta IA en lo que la empresa no puede presentar. Sin el perfil de
 * licitaciones no crea lotes: las candidatas esperan y Estado lo avisa.
 */
export function programarCriba(forzar = false): number[] {
  const { config, db } = nucleo();
  const dbLic = dbLicitaciones();
  aplicarDescarteAutomatico();
  liberarLotesFallidos(dbLic);
  retirarCandidatasCerradas(dbLic);
  if (!hayPerfilCriba(raicesActuales().conocimiento)) return [];
  if (forzar) reactivarTipo(db, TIPO_CRIBA);
  const { loteCriba, cribasDia } = config.licitaciones;
  if (!forzar && !tocaCribar(dbLic, loteCriba, cribasDia)) return [];
  const lotes = crearLotes(dbLic, loteCriba);
  for (const lote of lotes)
    encolar(db, { tipo: TIPO_CRIBA, dominio: 'licitaciones', clave: `cribar-lote-${lote}`, payload: { lote } });
  if (lotes.length)
    emitir(db, { tipo: 'licitaciones.lotes', dominio: 'licitaciones', recurso: null, datos: { lotes } });
  return lotes;
}

/** «Cribar ahora»: sin el perfil de licitaciones lo dice, en vez de dar la criba por enviada. */
export function pedirCriba(): Result<{ lotes: number[] }> {
  if (!hayPerfilCriba(raicesActuales().conocimiento)) return fail('no_configurado', `${AVISO_SIN_PERFIL}.`);
  return ok({ lotes: programarCriba(true) });
}

function contar(sql: string): Record<string, number> {
  const filas = dbLicitaciones().prepare(sql).all() as { k: string; n: number }[];
  return Object.fromEntries(filas.map((f) => [f.k, f.n]));
}

// «al día» solo si de verdad llegan novedades: la fase «esperando» lo decía también
// con la ingesta trayendo 0 entradas desde hacía un día. Se mira cada fuente con su ritmo
// (FUENTES.sinNovedadesHoras): con la más reciente de las dos, un lote de agregadas de
// madrugada tapaba que perfiles llevaba dos días sin publicar.
const HORA_MS = 3_600_000;
const SEMANA_MS = 7 * 86_400_000;
const MAX_FALLO_CRIBA = 0.2;

export type AlertaOperacion =
  | {
      motivo: 'ingesta_sin_novedades';
      desde: string;
      fuente: FuenteId;
      nombre: string;
      horas: number;
      al_dia: string[];
    }
  | { motivo: 'criba_con_fallos'; fallidos: number; total: number };

/** La entrada más reciente que ha traído la ingesta (la marca `hasta` de sus fuentes); null si nunca trajo nada. */
export function alDiaHasta(db: Db): string | null {
  const filas = db.prepare('SELECT hasta FROM sync_estado WHERE hasta IS NOT NULL').all() as { hasta: string }[];
  const ms = filas.map((f) => Date.parse(f.hasta)).filter(Number.isFinite);
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null;
}

function cribaConFallos(db: Db, ahoraMs: number): AlertaOperacion | null {
  const f = db
    .prepare(
      `SELECT COALESCE(SUM(estado = 'fallido'), 0) AS fallidos, COUNT(*) AS total FROM lotes_criba
    WHERE estado IN ('cribado', 'fallido') AND creado_en >= ?`,
    )
    .get(new Date(ahoraMs - SEMANA_MS).toISOString()) as { fallidos: number; total: number };
  return f.total > 0 && f.fallidos / f.total > MAX_FALLO_CRIBA ? { motivo: 'criba_con_fallos', ...f } : null;
}

type HastaFuente = { fuente: FuenteId; hasta: string; parada: boolean };

// Lo más nuevo que trajo cada fuente conocida y si lleva más de su umbral sin traer nada.
function fuentesSinNovedades(db: Db, ahoraMs: number): HastaFuente[] {
  const filas = db.prepare('SELECT fuente, hasta FROM sync_estado WHERE hasta IS NOT NULL').all() as {
    fuente: string;
    hasta: string;
  }[];
  return filas
    .filter(
      (f): f is { fuente: FuenteId; hasta: string } => f.fuente in FUENTES && Number.isFinite(Date.parse(f.hasta)),
    )
    .map((f) => ({ ...f, parada: ahoraMs - Date.parse(f.hasta) > FUENTES[f.fuente].sinNovedadesHoras * HORA_MS }));
}

/**
 * Avisos de operación: cada fuente de la ingesta en marcha que lleva más de su umbral sin
 * novedades (con las que siguen al día, para ver que es la PLACSP) y más de un 20 % de lotes
 * de criba fallidos en 7 días.
 */
export function alertasOperacion(db: Db, ingestaActiva: boolean, ahoraMs = Date.now()): AlertaOperacion[] {
  const fuentes = ingestaActiva ? fuentesSinNovedades(db, ahoraMs) : [];
  const alDia = fuentes.filter((f) => !f.parada).map((f) => FUENTES[f.fuente].corto);
  const out: AlertaOperacion[] = fuentes
    .filter((f) => f.parada)
    .map((f) => ({
      motivo: 'ingesta_sin_novedades',
      desde: new Date(Date.parse(f.hasta)).toISOString(),
      fuente: f.fuente,
      nombre: FUENTES[f.fuente].corto,
      horas: FUENTES[f.fuente].sinNovedadesHoras,
      al_dia: alDia,
    }));
  const criba = cribaConFallos(db, ahoraMs);
  return criba ? [...out, criba] : out;
}

function estadoCarpetas(): Record<string, unknown> {
  const r = leerReorganizacion();
  const reorganizacion = {
    ...r,
    omitidas: r.omitidas.slice(0, MAX_OMITIDAS_ESTADO),
    total_omitidas: r.omitidas.length,
    descarga_en_espera: !descargaPermitida(r.estado),
  };
  return { ...carpetasLicitaciones(), reorganizacion, carpetas_presentadas: contarPresentadas(dbLicitaciones()) };
}

export function estadoLicitaciones(): Record<string, unknown> {
  const { config } = nucleo();
  return {
    activo: config.licitaciones.activo,
    hermes: config.hermesLicitaciones
      ? 'configurado'
      : 'sin configurar (HERMES_LICITACIONES_URL y HERMES_LICITACIONES_KEY)',
    hermes_oferta: textoPerfilOferta(),
    hermes_critico: textoPerfilCritico(),
    // La web lo avisa en todas las vistas de Licitaciones.
    aviso_hermes: hayPerfilCriba(raicesActuales().conocimiento) ? null : AVISO_SIN_PERFIL,
    alertas_ia: alertasIa(nucleo().db, 'licitaciones'),
    ingesta: estadoIngesta(),
    al_dia_hasta: alDiaHasta(dbLicitaciones()),
    alertas_operacion: alertasOperacion(dbLicitaciones(), config.licitaciones.activo && estadoIngesta().activa),
    oportunidades: contar('SELECT estado AS k, COUNT(*) AS n FROM oportunidades GROUP BY estado'),
    pliegos: contar('SELECT estado AS k, COUNT(*) AS n FROM pliegos GROUP BY estado'),
    pliegos_ilegibles: pliegosIlegibles(dbLicitaciones()),
    lotes: contar('SELECT estado AS k, COUNT(*) AS n FROM lotes_criba GROUP BY estado'),
    fichas: contar('SELECT estado AS k, COUNT(*) AS n FROM fichas GROUP BY estado'),
    fichas_hermes: fichasRecientes(dbLicitaciones()),
    regeneracion_fichas: resumenRegeneracion(nucleo().db, dbLicitaciones()),
    propuestas: contar('SELECT resultado AS k, COUNT(*) AS n FROM propuestas GROUP BY resultado'),
    guiones: (dbLicitaciones().prepare('SELECT COUNT(DISTINCT licitacion_id) AS n FROM guiones').get() as { n: number })
      .n,
    memorias: contar('SELECT estado AS k, COUNT(*) AS n FROM memorias GROUP BY estado'),
    salidas: config.salidasDir
      ? 'configurada'
      : 'sin configurar (SALIDAS_DIR): sin borradores ni documentos de Salidas',
    ficha_automatica: config.licitaciones.fichaAuto,
    historico: {
      ...resumenHistorico(dbLicitaciones()),
      desde_por_defecto: config.licitaciones.historicoDesde,
      guarda_todo: config.licitaciones.historicoTodo,
    },
    carpetas: estadoCarpetas(),
  };
}

/** Crea las carpetas de lo presentado que se han pedido, si la reorganización no está a medias. */
export async function crearCarpetasPresentadas(): Promise<number> {
  const conocimiento = raicesActuales().conocimiento;
  if (!conocimiento || !PUEDE_ARCHIVAR.has(leerReorganizacion().estado)) return 0;
  return procesarPresentadas(dbLicitaciones(), conocimiento);
}

const avisarFallo = (que: string) => (err: unknown) => {
  log.error(que, { error: errorMessage(err) });
};

// Una vez por arranque y en segundo plano: los ZIP que se guardaron como «.pdf» se descomprimen
// solos. Con las carpetas a medio mover espera al siguiente arranque, como la descarga.
async function repararPliegosGuardados(): Promise<void> {
  const conocimiento = raicesActuales().conocimiento;
  if (!conocimiento || !descargaPermitida(leerReorganizacion().estado)) return;
  const r = await repararZipsComoPdf(dbLicitaciones(), conocimiento);
  if (r.error) log.warn('reparación de ZIP guardados como PDF fallida', { codigo: r.error.code });
}

// Devuelve si la descarga de pliegos puede seguir: espera mientras la reorganización está
// pendiente, en curso o sin llegar al disco, para no escribir en carpetas a medio mover.
// Corre cada minuto aunque la ingesta esté desactivada: reintentos y espera a drive-sync.
async function vueltaCarpetas(conocimiento: string): Promise<boolean> {
  reorganizarSiToca().catch(avisarFallo('reorganización de carpetas fallida'));
  const estado = comprobarSincronizacion(conocimiento);
  await crearCarpetasPresentadas();
  // Las actas de mesa que el equipo deja en lo presentado se leen solas (dos por vuelta).
  encolarActasEnVuelta(conocimiento);
  // Lo aceptado que lleva un año sin pasar a ninguna memoria deja de aplicarse.
  retirarSinUso(dbLicitaciones());
  // Los párrafos que se repiten en memorias que funcionaron se proponen a la Biblioteca (una vez al día).
  proponerParrafosSiToca(dbLicitaciones(), taparPersonas(nucleo().db), crearPropuesta).catch(
    avisarFallo('párrafos repetidos sin proponer'),
  );
  return descargaPermitida(estado);
}

/** Marca ganada, perdida o desierta lo presentado cuya adjudicación ya publicó la PLACSP. */
export function resolverPresentadas(): number {
  return resolverPropuestas(
    dbLicitaciones(),
    leerPerfilEmpresa(nucleo().db)?.perfil.nif ?? null,
    nucleo().config.licitaciones.preciosMinimo,
  );
}

/**
 * La oferta en cada vuelta: los modelos PDF sin analizar (modelosPdf.ts), el DEUC en XML (deuc.ts), la cadena (cadena.ts) —fichas desfasadas por pliegos o lotes nuevos,
 * guiones de lo que pasó a «En preparación» (o tiene ficha nueva, o cuyo guion automático falló),
 * propuestas de decisiones que faltan y trabajos colgados—, anexos cuyo dato cambió (regenerados
 * por código, anexosRegeneracion.ts), apartados cuyo trabajo falló del todo
 * (la memoria se ensambla sin ellos) y memorias que ya no esperan ningún apartado. Espera a los
 * ensamblados (los de una vuelta son pocos).
 */
export async function vueltaOferta(dbNucleo: DbNucleo, dbLic: Db): Promise<void> {
  // Los modelos PDF se analizan antes de la cadena para que sus anexos ya se puedan pedir; un fallo no la para.
  await prepararModelosPdf(dbLic, raicesActuales()).catch((err: unknown) =>
    log.error('modelos PDF sin analizar', { error: errorMessage(err) }),
  );
  // El DEUC es código (0 runs): sale de la petición y del perfil; un fallo no para la cadena.
  try {
    deucAuto(dbNucleo, dbLic, raicesActuales());
  } catch (err) {
    log.error('DEUC sin preparar', { error: errorMessage(err) });
  }
  // Un fallo de la cadena no deja sin ensamblar las memorias de esta vuelta.
  try {
    vueltaCadena(dbNucleo, dbLic);
  } catch (err) {
    log.error('cadena de la oferta fallida', { error: errorMessage(err) });
  }
  // Los ensamblados que cortó un reinicio (un despliegue) se vuelven a montar solos.
  const reanudados = reanudarEnsamblados(dbLic);
  // El anexo cuyo dato de la hoja cambió se rehace por código (0 runs); un fallo no frena el resto de la vuelta.
  await regenerarAnexosPorCodigo({ db: dbLic, dbNucleo, raices: raicesActuales() }).catch((err: unknown) =>
    log.error('anexos sin regenerar por código', { error: errorMessage(err) }),
  );
  // El paquete ya generado y desfasado se rehace por código tras los anexos; nunca crea el primero.
  await regenerarPaquetesAuto({ db: dbLic, dbNucleo, raices: raicesActuales() }).catch((err: unknown) =>
    log.error('paquete sin regenerar por código', { error: errorMessage(err) }),
  );
  // Tras el paquete, su revisión previa (una por versión; nunca con el freno puesto); un fallo no para la vuelta.
  try {
    revisionesPreviasAuto(dbNucleo, dbLic);
  } catch (err) {
    log.error('revisión previa sin pedir', { error: errorMessage(err) });
  }
  marcarApartadosFallidos(dbLic);
  await vueltaMemorias(dbNucleo, dbLic).catch((err: unknown) =>
    log.error('memorias sin avanzar', { error: errorMessage(err) }),
  );
  await reanudados;
}

// La memoria avanza también al llegar cada resultado (pedida, estrategia, apartado, crítica),
// sin esperar a la vuelta del minuto.
function escucharMemorias(): void {
  escuchar('licitacion.memoria', (e) => {
    const memoria = e.datos['memoria'];
    if (typeof memoria !== 'number') return;
    avanzarMemoria(nucleo().db, dbLicitaciones(), memoria).catch((err: unknown) =>
      log.error('memoria sin avanzar', { error: errorMessage(err) }),
    );
  });
}

async function vuelta(): Promise<void> {
  marcarVuelta(VUELTA_RADAR);
  const { config, db } = nucleo();
  programarCriba();
  resolverPresentadas();
  recuperarConPliegos(dbLicitaciones());
  encolarPliegosNuevos(dbLicitaciones());
  await revisarExpedientes(dbLicitaciones());
  // Actas de expedientes ajenos: un fallo no para la vuelta.
  await vueltaActasMercado(dbLicitaciones(), db, config.licitaciones.actasMercadoDia).catch((err: unknown) =>
    log.error('actas de mercado sin leer', { error: errorMessage(err) }),
  );
  descartarSinPliegos(dbLicitaciones());
  solicitudesDeFichas(dbLicitaciones());
  const conocimiento = raicesActuales().conocimiento;
  if (conocimiento && (await vueltaCarpetas(conocimiento))) await descargarPendientes(dbLicitaciones(), conocimiento);
  if (config.licitaciones.fichaAuto) {
    encolarFichasAuto(db, dbLicitaciones());
    vueltaRegeneracion(db, dbLicitaciones(), legibles(dbLicitaciones()));
  }
  revisarErrores(dbLicitaciones());
  vueltaCobertura(dbLicitaciones());
  // Índices de mercado de lo que sigue la empresa, cada noche: un fallo no para la vuelta.
  try {
    vueltaIndices(dbLicitaciones());
  } catch (err) {
    log.error('índices de mercado sin rehacer', { error: errorMessage(err) });
  }
  // La prueba hacia atrás de los índices, una vez al mes.
  try {
    vueltaAcierto(dbLicitaciones());
  } catch (err) {
    log.error('prueba hacia atrás sin hacer', { error: errorMessage(err) });
  }
  // La nueva licitación de los contratos que alguien sigue en Mercado › Vencimientos.
  try {
    vueltaRenovaciones(dbLicitaciones());
  } catch (err) {
    log.error('renovaciones sin buscar', { error: errorMessage(err) });
  }
  await vueltaOferta(db, dbLicitaciones());
}

// Con la ingesta desactivada no hay vuelta completa, pero las carpetas siguen su curso.
async function soloCarpetas(): Promise<void> {
  marcarVuelta(VUELTA_RADAR);
  const conocimiento = raicesActuales().conocimiento;
  if (conocimiento) await vueltaCarpetas(conocimiento);
  await vueltaOferta(nucleo().db, dbLicitaciones());
}

// El perfil de Hermes que hace el trabajo: «/p/<perfil>» en la URL (gateway con varios
// perfiles) o, con un gateway propio, el de su nombre. Su state.db da modelo y tokens; el
// agente es el de la auditoría de las tools (el token del perfil lleva su nombre).
const PERFIL = 'licitaciones';
const PERFIL_OFERTA = 'oferta-licitaciones';

function origenMetricas(perfil: () => string, destino: () => DestinoHermes | null): OrigenMetricas {
  const perfilDe = () => /\/p\/([\w-]+)/.exec(destino()?.url ?? '')?.[1] ?? perfil();
  return {
    get agente() {
      return perfilDe();
    },
    stateDb: () => (destino() ? path.join(nucleo().config.hermesHome, 'profiles', perfilDe(), 'state.db') : null),
  };
}

const METRICAS = origenMetricas(
  () => PERFIL,
  () => nucleo().config.hermesLicitaciones,
);

// La preparación de la oferta (guion, memoria, anexos y evaluación) va al perfil «oferta-licitaciones»,
// con un modelo mejor, si está configurado; si no, al de licitaciones como todo lo demás.
const destinoOferta = (): DestinoHermes | null => nucleo().config.hermesOferta ?? nucleo().config.hermesLicitaciones;
/** A qué perfil va la preparación de ofertas, para Estado. */
export function textoPerfilOferta(): string {
  const { config } = nucleo();
  return (
    config.hermesOfertaAviso ??
    (config.hermesOferta
      ? `perfil propio (${PERFIL_OFERTA})`
      : 'usa el perfil de licitaciones (sin HERMES_OFERTA_LICITACIONES_URL y HERMES_OFERTA_LICITACIONES_KEY)')
  );
}

const METRICAS_OFERTA = origenMetricas(() => (nucleo().config.hermesOferta ? PERFIL_OFERTA : PERFIL), destinoOferta);

// El crítico ciego de la memoria va a su propio perfil (otro modelo: el mismo se pone nota
// alta); sin él, al de oferta, y la crítica queda marcada como no independiente.
const PERFIL_CRITICO = 'critico-licitaciones';
const destinoCritico = (): DestinoHermes | null => nucleo().config.hermesCritico ?? destinoOferta();
const METRICAS_CRITICO = origenMetricas(
  () => (nucleo().config.hermesCritico ? PERFIL_CRITICO : METRICAS_OFERTA.agente),
  destinoCritico,
);
/** De qué perfil sale la crítica de la memoria, para Estado. */
export function textoPerfilCritico(): string {
  const { config } = nucleo();
  return (
    config.hermesCriticoAviso ??
    (config.hermesCritico
      ? `perfil propio (${PERFIL_CRITICO})`
      : 'la hace el perfil de oferta, el mismo que redacta: tiende a sobrevalorar (sin HERMES_OFERTA_CRITICO_URL y HERMES_OFERTA_CRITICO_KEY)')
  );
}

function registrarTiposOferta(destino: () => DestinoHermes | null = destinoOferta): void {
  registrarTipoTrabajo(TIPO_GUION, {
    destino,
    metricas: METRICAS_OFERTA,
    instrucciones: (p) => instruccionesGuion(PayloadGuion.parse(p).id, nombreEmpresa(nucleo().db)),
    hecho: (p, t) => {
      const { id, pedida_en } = PayloadGuion.parse(p);
      return guionRecibidoDe(dbLicitaciones(), id, pedida_en, t.id);
    },
  });
  registrarTiposMemoria(destino);
  registrarTipoAnexo(destino, METRICAS_OFERTA);
  registrarTipoTrabajo(TIPO_PROPUESTA_DECISIONES, {
    destino,
    metricas: METRICAS_OFERTA,
    instrucciones: (p) => {
      const { id, guion_id } = PayloadPropuestaDecisiones.parse(p);
      return instruccionesPropuestaDecisiones(id, guion_id, nombreEmpresa(nucleo().db));
    },
    hecho: (p, t) => {
      const { id, pedida_en } = PayloadPropuestaDecisiones.parse(p);
      return propuestaRecibida(dbLicitaciones(), id, pedida_en, t.id);
    },
  });
  // Lo que se aprende de una versión retocada a mano.
  registrarTipoTrabajo(TIPO_LECCIONES, {
    destino,
    metricas: METRICAS_OFERTA,
    instrucciones: (p) => instruccionesLecciones(dbLicitaciones(), PayloadLecciones.parse(p)),
    hecho: (p) => leccionesRecibidas(dbLicitaciones(), PayloadLecciones.parse(p).memoria_id),
  });
  registrarRevisionPrevia(destino);
  registrarTipoTrabajo(TIPO_INTERPRETAR, {
    destino,
    instrucciones: (p) => instruccionesInterpretar(dbLicitaciones(), nucleo().db, PayloadInterpretar.parse(p)),
    hecho: (p) => interpretacionRecibida(dbLicitaciones(), PayloadInterpretar.parse(p)),
    // Hay una persona esperando delante del chat: va antes que todo lo demás de la cola.
    prioridad: () => 0,
  });
}

// La revisión previa al envío: lee las comprobaciones y propone con citas; la cierra licitaciones_revision_previa.
function registrarRevisionPrevia(destino: () => DestinoHermes | null): void {
  registrarTipoTrabajo(TIPO_REVISION_PREVIA, {
    destino,
    metricas: METRICAS_OFERTA,
    maxMs: 30 * 60_000,
    instrucciones: (p) => instruccionesRevisionPrevia(PayloadRevisionPrevia.parse(p), nombreEmpresa(nucleo().db)),
    hecho: (p) => revisionPreviaHecha(dbLicitaciones(), PayloadRevisionPrevia.parse(p)),
  });
}

// La estrategia y la crítica leen mucho y luego escriben un JSON grande en una sola llamada, sin
// latido: 10 min sin tools es pensar, no estar colgado.
const INACTIVO_PLAN_MS = 30 * 60_000;

// La memoria en el perfil de oferta: estrategia (hasta 60 min; tarda 27-30) y redacción entera (hasta 90
// min; su latido es cada apartado enviado, así que aguanta 15 sin llamar a ninguna tool). Sin
// Salidas, esperan.
function registrarTiposMemoria(destino: () => DestinoHermes | null): void {
  const conSalidas = () => (nucleo().config.salidasDir ? destino() : null);
  registrarTipoTrabajo(TIPO_MEMORIA_ESTRATEGIA, {
    destino: conSalidas,
    metricas: METRICAS_OFERTA,
    maxMs: 60 * 60_000,
    inactivoMs: INACTIVO_PLAN_MS,
    instrucciones: (p) => instruccionesEstrategia(dbLicitaciones(), PayloadEstrategia.parse(p)),
    hecho: (p) => estrategiaRecibida(dbLicitaciones(), PayloadEstrategia.parse(p)),
  });
  registrarTipoTrabajo(TIPO_MEMORIA_REDACCION, {
    destino: conSalidas,
    metricas: METRICAS_OFERTA,
    maxMs: 90 * 60_000,
    inactivoMs: 15 * 60_000,
    instrucciones: (p) => instruccionesRedaccion(dbLicitaciones(), nucleo().db, PayloadRedaccion.parse(p)),
    hecho: (p) => redaccionHecha(dbLicitaciones(), PayloadRedaccion.parse(p)),
  });
  // La corrección de hechos de una ronda: pocos hechos y un envío; lee la estrategia, así que va
  // al perfil de oferta, nunca al del crítico.
  registrarTipoTrabajo(TIPO_MEMORIA_HECHOS, {
    destino: conSalidas,
    metricas: METRICAS_OFERTA,
    maxMs: 30 * 60_000,
    inactivoMs: INACTIVO_PLAN_MS,
    instrucciones: (p) => instruccionesHechos(dbLicitaciones(), PayloadHechos.parse(p)),
    hecho: (p) => hechosRecibidos(dbLicitaciones(), PayloadHechos.parse(p)),
  });
  registrarTipoTrabajo(TIPO_MEMORIA_CRITICA, {
    destino: destinoCritico,
    metricas: METRICAS_CRITICO,
    maxMs: 45 * 60_000,
    inactivoMs: INACTIVO_PLAN_MS,
    instrucciones: (p) => instruccionesDeLaCritica(dbLicitaciones(), PayloadCritica.parse(p)),
    hecho: (p) => criticaRecibida(dbLicitaciones(), PayloadCritica.parse(p)),
  });
  // El juez del banco de pruebas, también en el perfil del crítico.
  registrarTipoTrabajo(TIPO_EVAL_JUICIO, {
    destino: destinoCritico,
    metricas: METRICAS_CRITICO,
    maxMs: 45 * 60_000,
    instrucciones: (p) => instruccionesJuicio(PayloadJuicio.parse(p), nombreEmpresa(nucleo().db)),
    hecho: (p) => juicioRecibido(dbLicitaciones(), PayloadJuicio.parse(p)),
  });
}

function registrarTiposPropuestas(destino: () => DestinoHermes | null = destinoOferta): void {
  registrarTipoTrabajo(TIPO_EVALUACION, {
    destino,
    metricas: METRICAS_OFERTA,
    instrucciones: (p) => {
      const { id, documento } = PayloadEvaluacion.parse(p);
      return instruccionesEvaluacion(id, documento, dbLicitaciones());
    },
    hecho: (p) => {
      const { id, documento, pedida_en } = PayloadEvaluacion.parse(p);
      return evaluacionRecibida(dbLicitaciones(), id, documento, pedida_en);
    },
  });
}

/** Registra los tipos de trabajo de IA de licitaciones (exportado para los tests). */
export function registrarTrabajos(): void {
  const destino = () => nucleo().config.hermesLicitaciones;
  registrarTipoTrabajo(TIPO_CRIBA, {
    destino,
    metricas: METRICAS,
    instrucciones: (p) =>
      instruccionesCriba(PayloadCriba.parse(p).lote, nombreEmpresa(nucleo().db), areasFormacion(nucleo().db)),
    hecho: (p) => loteCribado(dbLicitaciones(), PayloadCriba.parse(p).lote),
  });
  registrarTipoTrabajo(TIPO_FICHA, {
    destino,
    metricas: METRICAS,
    instrucciones: (p) =>
      instruccionesFicha(PayloadFicha.parse(p).id, nombreEmpresa(nucleo().db), areasFormacion(nucleo().db)),
    hecho: (p, t) => {
      const { id, pedida_en } = PayloadFicha.parse(p);
      return fichaRecibidaDe(dbLicitaciones(), id, pedida_en, t.id);
    },
  });
  // Preguntar al pliego: el mismo perfil que lee los pliegos para la ficha; hay una persona esperando.
  registrarTipoTrabajo(TIPO_PREGUNTA_PLIEGO, {
    destino,
    metricas: METRICAS,
    instrucciones: (p) => instruccionesPregunta(dbLicitaciones(), PayloadPregunta.parse(p)),
    hecho: (p) => preguntaRespondida(dbLicitaciones(), PayloadPregunta.parse(p)),
    prioridad: () => 0,
  });
  registrarTiposPropuestas();
  registrarAprenderActa(destino, METRICAS);
  registrarTiposOferta();
  registrarTipoTrabajo(TIPO_ACTA_MERCADO, {
    destino,
    metricas: METRICAS,
    instrucciones: (p) => instruccionesActaMercado(PayloadActaMercado.parse(p).id, nombreEmpresa(nucleo().db)),
    hecho: (p) => actaMercadoLeida(dbLicitaciones(), PayloadActaMercado.parse(p).id),
  });
  registrarTipoTrabajo(TIPO_RESUMEN_COMPETIDOR, {
    destino,
    metricas: METRICAS,
    instrucciones: (p) => instruccionesResumen(PayloadResumen.parse(p).nif, nombreEmpresa(nucleo().db)),
    hecho: (p) => resumenRecibido(nucleo().db, PayloadResumen.parse(p).pedida_en),
  });
  registrarPrioridades(dbLicitaciones);
  fijarLimitador('licitaciones', limitadorLicitaciones);
  fijarEventoTrabajos('licitaciones', 'licitacion.trabajo');
  fijarNombreTrabajos('licitaciones', nombreTrabajo);
  registrarTitulos('licitaciones', titulosLicitaciones);
}

// Para la pastilla «Hermes»: «memoria Ejemplo» en vez de «p-…». Solo los ids en marcha, pocos.
function titulosLicitaciones(ids: string[]): Record<string, string> {
  const huecos = ids.map(() => '?').join(', ');
  const filas = dbLicitaciones()
    .prepare(`SELECT id, titulo FROM licitaciones WHERE id IN (${huecos})`)
    .all(...ids) as { id: string; titulo: string }[];
  return Object.fromEntries(filas.map((f) => [f.id, f.titulo]));
}

export function iniciarLicitaciones(): void {
  const { config } = nucleo();
  registrarTrabajos();
  anadirHerramientas(herramientasLicitaciones);
  registrarEstado('licitaciones', estadoLicitaciones);
  registrarProgramadoLicitaciones();
  registrarHoy('licitaciones', (desde) => hoyLicitaciones(dbLicitaciones(), desde));
  registrarAsignaciones('licitaciones', () => asignacionesLicitaciones(dbLicitaciones()));
  registrarVigenciaIncorporar('licitaciones', (id) => ofertaSigue(dbLicitaciones(), id));
  registrarCarpetaConFicha(config.licitaciones.carpetaRadar, 'Licitaciones');
  // Su parte de los avisos por email: el resumen semanal, el plazo a 48 h, resoluciones y búsquedas guardadas.
  registrarAvisosLicitaciones(() => ({ db: dbLicitaciones(), dbNucleo: nucleo().db }));
  // La API de lectura para BI: pipeline, presentadas, índices por segmento y lecciones.
  registrarLectura('pipeline', 'Las ofertas en curso, con su columna del Pipeline y su cierre', () =>
    filasPipeline(dbLicitaciones()),
  );
  registrarLectura('presentadas', 'Lo presentado, con su resultado, puntos y ganador', () =>
    filasPresentadas(dbLicitaciones()),
  );
  registrarLectura(
    'indices',
    'Los índices de mercado de cada segmento (tipo, CPV, importe, procedimiento y órgano)',
    () => filasIndices(dbLicitaciones()),
  );
  registrarLectura('lecciones', 'Las lecciones aceptadas del libro de lecciones', () =>
    filasLecciones(dbLicitaciones()),
  );
  // El vocabulario CPV oficial, una vez: los filtros y los índices lo leen de la tabla.
  try {
    cargarVocabularioCpv(dbLicitaciones());
  } catch (err) {
    log.error('vocabulario CPV sin cargar', { error: errorMessage(err) });
  }
  // Dónde está la carpeta única de cada licitación: carpetaSalidas(l) la consulta sin base.
  try {
    cargarCarpetasUnicas(dbLicitaciones());
  } catch (err) {
    log.error('carpetas únicas sin cargar', { error: errorMessage(err) });
  }
  // Las actas leídas antes del libro de lecciones dejan sus lecciones por revisar.
  try {
    leccionesDeActasAnteriores(dbLicitaciones(), taparPersonas(nucleo().db));
  } catch (err) {
    log.error('lecciones de actas anteriores sin pasar', { error: errorMessage(err) });
  }
  // Las fichas que quedaron pendientes con el flujo anterior (con paso de aprobación) se aplican ya.
  try {
    aplicarFichasPendientes(dbLicitaciones());
  } catch (err) {
    log.error('fichas pendientes sin aplicar', { error: errorMessage(err) });
  }
  // Con cada guion nuevo, Hermes propone las decisiones (si nadie las ha fijado aún).
  escuchar('licitacion.guion', (e) => {
    if (e.datos['accion'] !== 'guion' || !e.recurso) return;
    try {
      proponerAlLlegarGuion(nucleo().db, dbLicitaciones(), e.recurso);
    } catch (err) {
      log.error('propuesta de decisiones sin pedir', { error: errorMessage(err) });
    }
  });
  escucharMemorias();
  // La checklist de la presentación se sincroniza al cambiar el guion, los lotes o un borrador (leerla no escribe).
  registrarSincronizacionDocumentos();
  // Cada cambio de una licitación avisa a las comprobaciones con su versión nueva (licitacion.comprobaciones).
  registrarEventosComprobaciones();
  // Con el perfil cambia lo que se puede presentar y, si cambia el NIF, quién es la empresa en las adjudicaciones.
  escuchar('plataforma.empresa', () => {
    try {
      aplicarDescarteAutomatico();
      resolverPresentadas();
    } catch (err) {
      log.error('revisión tras cambiar el perfil fallida', { error: errorMessage(err) });
    }
  });
  // Una sola vez: cancela lo que quedó en cola del Redactor retirado (la memoria la redacta la oferta).
  try {
    retirarTrabajosBorrador(nucleo().db);
  } catch (err) {
    log.error('trabajos del Redactor sin cancelar', { error: errorMessage(err) });
  }
  // Una sola vez: separa lo presentado del radar en Conocimiento (si no se hizo ya).
  reorganizarSiToca().catch(avisarFallo('reorganización de carpetas fallida'));
  repararPliegosGuardados().catch((err: unknown) =>
    log.warn('reparación de ZIP guardados como PDF fallida', { error: errorMessage(err) }),
  );
  if (!config.licitaciones.activo) {
    log.info('ingesta de licitaciones desactivada (LICITACIONES_ACTIVO=0)');
    setInterval(() => {
      soloCarpetas().catch(avisarFallo('vuelta de carpetas fallida'));
    }, VUELTA_MS).unref();
    return;
  }
  const { maxPaginas, syncMinutos, historicoTodo } = config.licitaciones;
  iniciarIngesta(
    { dataDir: config.dataDir, fuentes: ['perfiles', 'agregadas'], maxPaginas, syncMinutos, historicoTodo },
    () => {
      programarCriba();
    },
  );
  setInterval(() => {
    vuelta().catch((err: unknown) => log.error('vuelta fallida', { error: errorMessage(err) }));
  }, VUELTA_MS).unref();
}
