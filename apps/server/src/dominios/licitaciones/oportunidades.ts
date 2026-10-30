// Oportunidades: el flujo de la empresa sobre cada licitación que pasó el prefiltro.
import { contextoEncaje, encajeDe, entradaDeGoNoGo, opinionQueManda, type Encaje, type Opinion } from './encaje.js';
import { citasDeRequisitos, type Comprobacion } from './citasPliego.js';
import type * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { carpetaUnicaEnDb } from './carpetasUnicas.js';
import { responsableDe, type Responsable } from './responsable.js';
import path from 'node:path';
import { z } from 'zod';
import { ESTADOS, nombreDe, PROCEDIMIENTOS, RESULTADOS, TIPOS_CONTRATO } from './placsp/codigos.js';
import type { Db, FilaLicitacion } from './store.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { emitir } from '../../nucleo/eventos.js';
import { leerPerfilEmpresa, zonaEmpresa, type PerfilEmpresaData } from '../../nucleo/empresa.js';
import { idiomaDelTexto } from '../../nucleo/idioma.js';
import { evaluacionesDeFicha, fichasDe, goNoGo, TIPO_FICHA, type FichaGuardada, type GoNoGo } from './ficha.js';
import { anotarDescarte, CATEGORIA_NO_GO } from './gonogo.js';
import { fichaDeOtrosLotes } from './oferta/coherencia.js';
import { guionDeOtrosLotes, guionVigente } from './oferta/guion.js';
import { trabajoEnCurso, type EnCurso } from '../../nucleo/colaConsultas.js';
import {
  leerIds,
  leerLotesInteres,
  lotesDeDatos,
  lotesDeLicitacion,
  TODOS_LOS_LOTES,
  UN_LOTE,
  type LoteDatos,
  type Presentacion,
} from './lotes.js';
import { horaLocalEspana, isoConZonaEspana, type ZonaHoraria } from '../../nucleo/fechas.js';
import { textoPlazo } from './oferta/plazo.js';
import { abrirIndiceLectura } from '../../biblioteca/motor/documentos/servicioIndice.js';
import { estadoEnIndice } from './pliegosIndice.js';
import { resumenOferta, type ResumenOferta } from './oferta/memoria.js';
import { resumenDeComprobaciones, type ResumenComprobaciones } from './oferta/preparacion.js';
import { completitudPliegos, type CompletitudPliegos } from './pliegosCompletitud.js';

// Las personas mueven el triaje (nueva, en preparación, descartada); presentada, ganada y perdida salen de la
// propuesta registrada.
// candidata → (criba) nueva | descartada → en_preparacion → presentada → ganada | perdida.
// La criba no separa «interesa» de «revisar» (las dos son nueva; el veredicto se guarda) y no
// hay «más adelante»: lo que no se va a hacer se descarta con su motivo.
const ESTADOS_OPORTUNIDAD = [
  'candidata',
  'nueva',
  'descartada',
  'en_preparacion',
  'presentada',
  'ganada',
  'perdida',
] as const;
type EstadoOportunidad = (typeof ESTADOS_OPORTUNIDAD)[number];
const ESTADOS_SEGUIDOS: EstadoOportunidad[] = ['nueva', 'en_preparacion', 'presentada'];

// En la lista, «ficha_por_revisar» son las nuevas que ya tienen la ficha de Hermes (y no se
// descartaron solas al llegar): no se guarda como estado, sale de la ficha, así que nunca se
// desincroniza; «nueva» son las que aún la esperan. «descartada» enseña solo lo que sigue en
// plazo: lo cerrado ya no se puede rescatar y solo estorba. «con_error» son las nuevas que el
// proceso automático ya no saca adelante solas (errores.ts): tampoco se guarda como estado.
const FICHA_POR_REVISAR = 'ficha_por_revisar';
const CON_ERROR = 'con_error';
export const ESTADOS_LISTA = [...ESTADOS_OPORTUNIDAD, FICHA_POR_REVISAR, CON_ERROR] as const;
const FICHA_APROBADA =
  "EXISTS (SELECT 1 FROM fichas fi WHERE fi.licitacion_id = o.licitacion_id AND fi.estado = 'aprobada')";
const CON_FICHA = `(o.estado = 'nueva' AND ${FICHA_APROBADA})`;
const ERROR_SQL = `(o.estado = 'nueva' AND o.error_proceso IS NOT NULL AND NOT ${FICHA_APROBADA})`;
const DESCARTADA_EN_PLAZO = "(o.estado = 'descartada' AND l.fecha_limite > ?)";
const DERIVADOS: readonly string[] = [FICHA_POR_REVISAR, CON_ERROR, 'descartada'];

function condicionEstados(estados: readonly string[], hoy: string): { sql: string; args: string[] } {
  const reales = estados.filter((e) => !DERIVADOS.includes(e));
  const partes = reales.length
    ? [`(o.estado IN (${reales.map(() => '?').join(',')}) AND NOT ${CON_FICHA} AND NOT ${ERROR_SQL})`]
    : [];
  const args = [...reales];
  if (estados.includes('descartada')) {
    partes.push(DESCARTADA_EN_PLAZO);
    args.push(hoy);
  }
  if (estados.includes(FICHA_POR_REVISAR)) partes.push(CON_FICHA);
  if (estados.includes(CON_ERROR)) partes.push(ERROR_SQL);
  return { sql: partes.length ? `(${partes.join(' OR ')})` : '0', args };
}

export const Filtro = z.object({
  estados: z.array(z.enum(ESTADOS_LISTA)).max(10).default(['nueva', FICHA_POR_REVISAR, 'en_preparacion']),
  texto: z.string().trim().max(200).optional(),
  pagina: z.number().int().min(1).default(1),
  limite: z.number().int().min(1).max(100).default(20),
  orden: z.enum(['plazo', 'importe', 'llegada']).default('plazo'),
  // Comunidad autónoma por su NUTS 2 (ES70 Canarias…); sin ella, todas.
  comunidad: z
    .string()
    .regex(/^ES[0-9A-Z]{2}$/)
    .optional(),
});
export type FiltroData = z.infer<typeof Filtro>;

// La PLACSP saca del feed una licitación anulada (o cerrada) con un «deleted-entry»: desde ese
// momento no se puede presentar aunque su último plazo publicado siga por delante.
// en: hora peninsular sin zona, como fecha_limite, para que la web añada la de Canarias.
export type Retirada = { en: string; motivo: string | null; etiqueta: string };

export type Resumen = {
  id: string;
  titulo: string;
  organo: string;
  estado_placsp: string;
  estado: EstadoOportunidad;
  importe: number | null;
  fecha_limite: string | null;
  cpvs: string[];
  tipo: string | null;
  motivo_prefiltro: string | null;
  // Fin de la solicitud de participación (procedimientos en dos fases), antes que la oferta.
  fecha_solicitud: string | null;
  veredicto_ia: string | null;
  motivo_ia: string | null;
  confianza_ia: number | null;
  url: string | null;
  fuente: string;
  lotes_interes: LoteDeInteres[];
  lotes_prefiltro: string[];
  retirada: Retirada | null;
  // Por qué el proceso automático no la saca adelante (pestaña «Errores»), o null.
  error_proceso: { codigo: string; detalle: string | null } | null;
  // El contrato que vencía y que alguien seguía en Mercado › Vencimientos, si esta es su renovación.
  renovacion_de: string | null;
};

const ETIQUETA_RETIRADA: Record<string, string> = { ANULADA: 'Anulada', CERRADA: 'Cerrada' };

export function retiradaDe(f: Pick<FilaLicitacion, 'borrada_en' | 'borrada_motivo'>): Retirada | null {
  if (!f.borrada_en) return null;
  const ms = Date.parse(f.borrada_en);
  const en = Number.isNaN(ms) ? f.borrada_en : horaLocalEspana(ms);
  const motivo = f.borrada_motivo?.trim() || null;
  return { en, motivo, etiqueta: ETIQUETA_RETIRADA[motivo?.toUpperCase() ?? ''] ?? 'Retirada de la PLACSP' };
}

// Lote elegido en la criba, con su nombre e importe para la lista.
type LoteDeInteres = { id: string; nombre: string | null; importe: number | null; motivo: string };

export type FilaResumen = FilaLicitacion & {
  op_estado: EstadoOportunidad;
  op_creada_en?: string;
  motivo_prefiltro: string | null;
  veredicto_ia: string | null;
  motivo_ia: string | null;
  confianza_ia: number | null;
  lotes_interes: string | null;
  lotes_prefiltro: string | null;
  error_proceso?: string | null;
  error_detalle?: string | null;
  renovacion_de?: string | null;
};

export function cpvsDe(texto: string): string[] {
  return texto.split(',').filter(Boolean);
}

function lotesDeInteres(lotes: LoteDatos[], texto: string | null): LoteDeInteres[] {
  return leerLotesInteres(texto).map((i) => {
    const lote = lotes.find((l) => l.id === i.id);
    return { id: i.id, nombre: lote?.nombre ?? null, importe: lote?.presupuesto_sin_iva ?? null, motivo: i.motivo };
  });
}

function aResumen(f: FilaResumen): Resumen {
  const retirada = retiradaDe(f);
  return {
    lotes_interes: lotesDeInteres(lotesDeDatos(f.datos), f.lotes_interes),
    lotes_prefiltro: leerIds(f.lotes_prefiltro),
    retirada,
    id: f.id,
    titulo: f.titulo,
    organo: f.organo_nombre,
    estado_placsp: retirada?.etiqueta ?? nombreDe(ESTADOS, f.estado) ?? f.estado,
    estado: f.op_estado,
    importe: f.presupuesto_sin_iva,
    fecha_limite: f.fecha_limite,
    fecha_solicitud: f.fecha_solicitud ?? null,
    cpvs: cpvsDe(f.cpvs),
    tipo: nombreDe(TIPOS_CONTRATO, f.tipo_contrato),
    motivo_prefiltro: f.motivo_prefiltro,
    veredicto_ia: f.veredicto_ia,
    motivo_ia: f.motivo_ia,
    confianza_ia: f.confianza_ia,
    url: f.url,
    fuente: f.fuente,
    error_proceso: f.error_proceso ? { codigo: f.error_proceso, detalle: f.error_detalle ?? null } : null,
    renovacion_de: f.renovacion_de ?? null,
  };
}

export const SELECT_RESUMEN = `SELECT l.*, o.estado AS op_estado, o.motivo_prefiltro, o.veredicto_ia, o.motivo_ia, o.confianza_ia,
  o.lotes_interes, o.lotes_prefiltro, o.error_proceso, o.error_detalle, o.renovacion_de, COALESCE(o.reaparecida_en, o.creada_en) AS op_creada_en FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id`;

// El próximo plazo que hay que cumplir: en dos fases, la solicitud de participación mientras no
// haya pasado (cierra antes que la oferta); si no, la oferta. El «?» es la hora de ahora.
const PROXIMO_PLAZO_SQL = 'CASE WHEN l.fecha_solicitud >= ? THEN l.fecha_solicitud ELSE l.fecha_limite END';

// Por plazo, lo que sigue abierto primero (lo más urgente arriba, por su próximo plazo) y lo
// vencido al final: arriba no sirve de nada. Los «?» son la hora de ahora (ver argsOrden).
const ORDEN: Record<FiltroData['orden'], string> = {
  plazo: `CASE WHEN l.fecha_limite < ? THEN 1 ELSE 0 END, COALESCE(${PROXIMO_PLAZO_SQL}, '9999') ASC, l.actualizada_en DESC`,
  importe: 'COALESCE(l.presupuesto_sin_iva, -1) DESC, l.id',
  llegada: 'COALESCE(o.reaparecida_en, o.creada_en) DESC, l.id',
};

// Lo que la lista enseña para decidir sin abrir la ficha: semáforo de requisitos (sin
// las cifras del perfil, que solo están en el detalle), si ya tiene la ficha de Hermes y
// cuándo entró la oportunidad (la web marca lo nuevo desde la última visita) y lo que espera
// tu revisión («Memoria técnica v5: dala por buena…»). La recomendación de la ficha manda sobre
// la de la criba en la lista: es la opinión de Hermes con los pliegos leídos (sin cifras). Las
// que la empresa prepara llevan además el veredicto y el primer bloqueo de las comprobaciones: los mismos
// que dan Hoy, la cabecera y el MCP. Las demás, null. excluyentes_por_confirmar: los excluyentes
// dudosos de los lotes en juego, para que «Requisitos» diga cuántos deciden esta oferta.
// categoria_descarte: el tipo del descarte vigente de una descartada («hermes_no_go»: la ficha dijo
// «No go»), para que Descartadas diga por qué sin abrirla; null si no está descartada.
export type ResumenLista = Resumen & {
  semaforo: { color: 'verde' | 'ambar' | 'rojo'; motivo: string };
  con_ficha: boolean;
  creada_en: string | null;
  excluyentes_por_confirmar: number;
  idioma: string | null;
  pendiente: string | null;
  recomendacion_ficha: FichaGuardada['datos']['recomendacion'] | null;
  veredicto: ResumenComprobaciones['veredicto'] | null;
  primer_bloqueo: ResumenComprobaciones['primer_bloqueo'];
  categoria_descarte: CategoriaDescarte | null;
};

type DeLaOferta = Pick<ResumenLista, 'pendiente' | 'veredicto' | 'primer_bloqueo'>;

function deLaOferta(db: Db, f: FilaResumen, pendiente: string | null, ahoraMs: number): DeLaOferta {
  const c = f.op_estado === 'en_preparacion' ? resumenDeComprobaciones(db, f.id, ahoraMs) : null;
  return { pendiente, veredicto: c?.veredicto ?? null, primer_bloqueo: c?.primer_bloqueo ?? null };
}

// Lo de otros lotes no decide esta oferta (p. ej. casi todo es del lote 1 y se va al 2). Lo
// que la PLACSP dejó en duda y la ficha ya leyó (en_ficha) no cuenta dos veces, como en el semáforo.
function excluyentesPorConfirmar(g: GoNoGo): number {
  const enJuego = g.ambito.por_lotes ? new Set(g.ambito.lotes.map((l) => l.id)) : null;
  const deFicha = g.ficha.aprobada ? evaluacionesDeFicha(g.ficha.aprobada.datos) : [];
  return [...g.requisitos, ...deFicha].filter(
    (e) =>
      e.excluyente &&
      e.resultado === 'desconocido' &&
      !e.en_ficha &&
      (e.lote === null || !enJuego || enJuego.has(e.lote)),
  ).length;
}

function aResumenLista(db: Db, f: FilaResumen, perfil: PerfilEmpresaData | null, oferta: DeLaOferta): ResumenLista {
  const g = goNoGo(db, f, perfil);
  return {
    ...aResumen(f),
    semaforo: { color: g.semaforo.color, motivo: g.semaforo.motivo },
    con_ficha: g.ficha.aprobada !== null,
    excluyentes_por_confirmar: excluyentesPorConfirmar(g),
    categoria_descarte: descarteVigente(db, f.id, f.op_estado).categoria_descarte,
    recomendacion_ficha: g.ficha.aprobada?.datos.recomendacion ?? null,
    creada_en: f.op_creada_en ?? null,
    idioma: idiomaDelTexto(f.titulo),
    ...oferta,
  };
}

// Una licitación descartada no avisa de nada: lo suyo que quedó pendiente vuelve a contar si
// se recupera. Las evaluaciones de una versión de la memoria no se revisan: explican su nota.
// Una memoria de ensayo tampoco: se mide contra la presentada, no se da por buena.
const NO_DESCARTADA =
  "NOT EXISTS (SELECT 1 FROM oportunidades o WHERE o.licitacion_id = l.id AND o.estado = 'descartada')";
const PENDIENTES = `
  SELECT 'borrador' AS tipo, b.licitacion_id AS id, l.titulo, b.registrado_en AS fecha, b.origen, b.version, NULL AS documento, 1 AS n,
    b.guion_id AS guion_id, (SELECT g.id FROM guiones g WHERE g.licitacion_id = b.licitacion_id ORDER BY g.version DESC LIMIT 1) AS guion_vigente
    FROM borradores b JOIN licitaciones l ON l.id = b.licitacion_id WHERE b.estado = 'pendiente' AND ${NO_DESCARTADA}
      AND NOT EXISTS (SELECT 1 FROM memorias m WHERE m.id = b.memoria_id AND m.ensayo = 1)
  UNION ALL SELECT 'evaluacion', e.licitacion_id, l.titulo, e.creada_en, NULL, NULL, e.documento, 1, NULL, NULL
    FROM evaluaciones e JOIN licitaciones l ON l.id = e.licitacion_id
    WHERE e.estado = 'pendiente' AND json_extract(e.datos, '$.memoria.version') IS NULL AND ${NO_DESCARTADA}
  UNION ALL SELECT 'lecciones', le.licitacion_id, l.titulo, MAX(le.creada_en), NULL, m.version, NULL, COUNT(*), NULL, NULL
    FROM lecciones le JOIN licitaciones l ON l.id = le.licitacion_id JOIN memorias m ON m.id = le.memoria_id
    WHERE le.estado = 'pendiente' AND ${NO_DESCARTADA} GROUP BY le.memoria_id`;

export type Pendiente = {
  tipo: 'borrador' | 'evaluacion' | 'lecciones';
  id: string;
  titulo: string;
  fecha: string;
  texto: string;
  corto: string;
  donde: string;
};
type FilaPendiente = {
  tipo: Pendiente['tipo'];
  id: string;
  titulo: string;
  fecha: string;
  origen: string | null;
  version: number | null;
  documento: string | null;
  n: number;
  guion_id: number | null;
  guion_vigente: number | null;
};

// Una memoria ensamblada de un guion que ya no es el vigente no se da por buena: se pide otra.
function pendienteDeMemoria(f: FilaPendiente, base: Omit<Pendiente, 'texto' | 'corto' | 'donde'>): Pendiente {
  const v = f.version ?? '?';
  const desfasada = f.guion_vigente !== null && f.guion_id !== f.guion_vigente;
  if (desfasada)
    return {
      ...base,
      texto: `Memoria técnica v${v}: es de un guion anterior; pide una nueva con el guion vigente`,
      corto: `Memoria v${v} desfasada`,
      donde: 'Preparación › Memoria',
    };
  return {
    ...base,
    texto: `Memoria técnica v${v}: dala por buena o pide cambios`,
    corto: `Memoria v${v} por revisar`,
    donde: 'Preparación › Memoria',
  };
}

function aPendiente(f: FilaPendiente): Pendiente {
  const base = { tipo: f.tipo, id: f.id, titulo: f.titulo, fecha: f.fecha };
  if (f.tipo === 'lecciones')
    return {
      ...base,
      texto: `${f.n === 1 ? '1 lección' : `${f.n} lecciones`} de tu edición de la v${f.version ?? '?'} por aceptar o descartar`,
      corto: 'Lecciones por revisar',
      donde: 'Preparación › Memoria',
    };
  if (f.tipo === 'evaluacion')
    return {
      ...base,
      texto: `Evaluación de «${path.basename(f.documento ?? '')}» por revisar`,
      corto: 'Evaluación por revisar',
      donde: 'Preparación › Memoria › Más opciones',
    };
  if (f.origen === 'ensamblado') return pendienteDeMemoria(f, base);
  return {
    ...base,
    texto: 'Borrador antiguo de Hermes por aceptar o descartar',
    corto: 'Borrador por revisar',
    donde: 'Preparación › Memoria › Más opciones',
  };
}

/** Lo que espera la revisión de una persona, lo más reciente primero (de una licitación, o de todas). */
export function pendientesDeRevisar(db: Db, limite: number, id: string | null = null): Pendiente[] {
  const filas = db
    .prepare(`SELECT * FROM (${PENDIENTES}) ${id ? 'WHERE id = ?' : ''} ORDER BY fecha DESC LIMIT ?`)
    .all(...(id ? [id] : []), limite) as FilaPendiente[];
  return filas.map(aPendiente);
}

// Lo pendiente de cada licitación de la lista, en una sola consulta: «Memoria técnica v5…».
function pendientesPorLicitacion(db: Db, ids: string[]): Map<string, string> {
  if (!ids.length) return new Map();
  const filas = db
    .prepare(`SELECT * FROM (${PENDIENTES}) WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY fecha DESC`)
    .all(...ids) as FilaPendiente[];
  const m = new Map<string, string>();
  for (const f of filas) if (!m.has(f.id)) m.set(f.id, aPendiente(f).texto);
  return m;
}

export function listarOportunidades(
  db: Db,
  f: FiltroData,
  ahoraMs = Date.now(),
): { total: number; items: ResumenLista[]; cuentas: Record<string, number> } {
  const hoy = horaLocalEspana(ahoraMs);
  const estados = condicionEstados(f.estados, hoy);
  const texto = f.texto ? `%${f.texto.replace(/[%_]/g, '')}%` : null;
  const buscar = `${texto ? ' AND (l.titulo LIKE ? OR l.organo_nombre LIKE ? OR l.expediente LIKE ?)' : ''}${f.comunidad ? ' AND l.nuts LIKE ?' : ''}`;
  const argsTexto = [...(texto ? [texto, texto, texto] : []), ...(f.comunidad ? [`${f.comunidad}%`] : [])];
  const where = `WHERE ${estados.sql}${buscar}`;
  const args = [...estados.args, ...argsTexto];
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id ${where}`)
      .get(...args) as { n: number }
  ).n;
  const argsOrden = f.orden === 'plazo' ? [hoy, hoy] : [];
  const filas = db
    .prepare(`${SELECT_RESUMEN} ${where} ORDER BY ${ORDEN[f.orden]} LIMIT ? OFFSET ?`)
    .all(...args, ...argsOrden, f.limite, (f.pagina - 1) * f.limite) as FilaResumen[];
  // Las descartadas fuera de plazo no se cuentan: la lista no las enseña.
  const porEstado = db
    .prepare(
      `SELECT CASE WHEN ${CON_FICHA} THEN '${FICHA_POR_REVISAR}' WHEN ${ERROR_SQL} THEN '${CON_ERROR}' ELSE o.estado END AS k, COUNT(*) AS n
    FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE (o.estado <> 'descartada' OR l.fecha_limite > ?)${buscar} GROUP BY k`,
    )
    .all(hoy, ...argsTexto) as { k: string; n: number }[];
  const perfil = leerPerfilEmpresa(db)?.perfil ?? null;
  const pendientes = pendientesPorLicitacion(
    db,
    filas.map((x) => x.id),
  );
  return {
    total,
    items: filas.map((fila) =>
      aResumenLista(db, fila, perfil, deLaOferta(db, fila, pendientes.get(fila.id) ?? null, ahoraMs)),
    ),
    cuentas: Object.fromEntries(porEstado.map((c) => [c.k, c.n])),
  };
}

/** Oportunidades que sigue la empresa con plazo en los próximos `dias` días (una anulada ya no tiene plazo). */
/** Lo que vence en los próximos `dias`: la oferta o, en dos fases, la solicitud de participación. Por el plazo más cercano. */
export function plazos(db: Db, dias: number, ahoraMs = Date.now()): Resumen[] {
  return filasDePlazos(db, dias, ahoraMs).map(aResumen);
}

function filasDePlazos(db: Db, dias: number, ahoraMs: number): FilaResumen[] {
  const marcas = ESTADOS_SEGUIDOS.map(() => '?').join(',');
  const hasta = horaLocalEspana(ahoraMs + dias * 86_400_000);
  const desde = horaLocalEspana(ahoraMs);
  return db
    .prepare(
      `${SELECT_RESUMEN} WHERE o.estado IN (${marcas}) AND l.borrada_en IS NULL
      AND (l.fecha_limite BETWEEN ? AND ? OR l.fecha_solicitud BETWEEN ? AND ?) ORDER BY ${PROXIMO_PLAZO_SQL}`,
    )
    .all(...ESTADOS_SEGUIDOS, desde, hasta, desde, hasta, desde) as FilaResumen[];
}

// Hora peninsular sin zona → ISO con su desfase; una fecha sin hora (un hito de la ficha) se deja.
const conZona = (f: string | null): string | null => (f === null ? null : (isoConZonaEspana(f) ?? f));

/**
 * Un resumen tal como lo lee un agente: los plazos en ISO con la zona de Madrid y dicho en texto
 * con la hora de la empresa. Sin zona, un agente los toma por UTC o por su hora y se equivoca de
 * una o dos horas justo en el cierre. La web sigue con la hora peninsular sin zona.
 */
export function resumenParaAgente<T extends Pick<Resumen, 'fecha_limite' | 'fecha_solicitud'>>(
  r: T,
  zona: ZonaHoraria,
): T & { plazo_texto: string | null } {
  return {
    ...r,
    fecha_limite: conZona(r.fecha_limite),
    fecha_solicitud: conZona(r.fecha_solicitud),
    plazo_texto: r.fecha_limite ? textoPlazo(r.fecha_limite, zona) : null,
  };
}

export type PlazoAgente = Resumen & {
  plazo_texto: string | null;
  semaforo: ResumenLista['semaforo'];
  pendiente: string | null;
};

/** Los plazos de los próximos `dias` para un agente: con el semáforo y lo que espera revisión, como la lista. */
export function plazosParaAgente(db: Db, dias: number, ahoraMs = Date.now()): PlazoAgente[] {
  const filas = filasDePlazos(db, dias, ahoraMs);
  const perfil = leerPerfilEmpresa(db)?.perfil ?? null;
  const pendientes = pendientesPorLicitacion(
    db,
    filas.map((x) => x.id),
  );
  const zona = zonaEmpresa(db);
  return filas.map((f) => {
    const { color, motivo } = goNoGo(db, f, perfil).semaforo;
    return {
      ...resumenParaAgente(aResumen(f), zona),
      semaforo: { color, motivo },
      pendiente: pendientes.get(f.id) ?? null,
    };
  });
}

// Una solicitud de participación entre los hitos de la ficha (para lo guardado antes de leer
// ese plazo del feed): un hito con fecha anterior a la oferta que hable de participar.
const HITO_SOLICITUD = /particip|solicitud|invitaci/i;

/**
 * Lo que sigue la empresa sin plazo de solicitud del feed y con ficha que lo trae en sus hitos: se
 * guarda en la columna para que la lista, «Hoy» y el resumen diario también lo vean.
 */
export function solicitudesDeFichas(db: Db): number {
  const filas = db
    .prepare(
      `SELECT l.id, l.fecha_limite, f.datos FROM licitaciones l
      JOIN oportunidades o ON o.licitacion_id = l.id
      JOIN fichas f ON f.id = (SELECT MAX(x.id) FROM fichas x WHERE x.licitacion_id = l.id AND x.estado = 'aprobada')
    WHERE l.fecha_solicitud IS NULL AND o.estado IN ('nueva', 'en_preparacion')`,
    )
    .all() as { id: string; fecha_limite: string | null; datos: string }[];
  const poner = db.prepare('UPDATE licitaciones SET fecha_solicitud = ? WHERE id = ? AND fecha_solicitud IS NULL');
  let n = 0;
  for (const f of filas) {
    const hitos = (JSON.parse(f.datos) as { hitos?: { hito: string; fecha?: string }[] }).hitos ?? [];
    const fecha = solicitudDeHitos(hitos, f.fecha_limite);
    if (fecha) n += poner.run(fecha, f.id).changes;
  }
  return n;
}

export function solicitudDeHitos(
  hitos: { hito: string; fecha?: string | undefined }[],
  fechaLimite: string | null,
): string | null {
  const h = hitos.find((x) => x.fecha && HITO_SOLICITUD.test(x.hito) && (!fechaLimite || x.fecha < fechaLimite));
  return h?.fecha ?? null;
}

export type Detalle = Resumen & {
  expediente: string;
  procedimiento: string | null;
  valor_estimado: number | null;
  nuts: string | null;
  lugar: string | null;
  organo_nif: string | null;
  notas: string | null;
  rescatada: boolean;
  datos: Record<string, unknown>;
  adjudicaciones: Record<string, unknown>[];
  pliegos: Record<string, unknown>[];
  completitud_pliegos: CompletitudPliegos | null;
  cambiada_a_mano: boolean;
  motivo_descarte: string | null;
  categoria_descarte: CategoriaDescarte | null;
  descartada_en: string | null;
  descarte_automatico: boolean;
  idioma: string | null;
  go_no_go: GoNoGo;
  lotes: LoteDetalle[];
  ficha_en_curso: EnCurso | null;
  // La cita literal de cada requisito de la ficha aprobada buscada en los pliegos, en su
  // mismo orden: null en el que no trae cita.
  citas_requisitos: (Comprobacion | null)[];
  // El encaje 0-100 con su desglose.
  encaje: Encaje;
  // La carpeta única en Drive, relativa a Conocimiento, o null si aún no la tiene.
  carpeta_unica: string | null;
  // Guion, decisiones y memoria de la oferta en números (sin datos personales).
  oferta: ResumenOferta;
  // Quién lleva la oferta, solo el nombre; null si nadie.
  responsable: Responsable | null;
};

// Cada lote con si encajó en el prefiltro y si la criba lo eligió (y por qué).
type LoteDetalle = LoteDatos & { prefiltro: boolean; interes: boolean; motivo_interes: string | null };

function lotesDelDetalle(f: FilaResumen): LoteDetalle[] {
  const prefiltro = new Set(leerIds(f.lotes_prefiltro));
  const interes = leerLotesInteres(f.lotes_interes);
  return lotesDeDatos(f.datos).map((l) => {
    const elegido = interes.find((i) => i.id === l.id);
    return { ...l, prefiltro: prefiltro.has(l.id), interes: Boolean(elegido), motivo_interes: elegido?.motivo ?? null };
  });
}

function adjudicaciones(db: Db, id: string): Record<string, unknown>[] {
  const filas = db.prepare('SELECT * FROM adjudicaciones WHERE licitacion_id = ? ORDER BY ord').all(id) as Record<
    string,
    unknown
  >[];
  return filas.map((a) => ({
    ...a,
    resultado_nombre: nombreDe(RESULTADOS, (a['resultado'] as string | null) ?? null),
  }));
}

type FilaDetalle = FilaResumen & {
  notas: string | null;
  rescatada: number | null;
  cambiada_a_mano: number | null;
  motivo_descarte: string | null;
  descarte_automatico: number | null;
};

// Cada pliego bajado dice si la Biblioteca lo puede leer (sin índice, solo lo de la descarga).
// La petición del DEUC no se lee: se importa en el servicio DEUC.
function pliegosDe(db: Db, id: string): Record<string, unknown>[] {
  const filas = unaPorArchivo(
    db
      .prepare(
        'SELECT clase, nombre, estado, ruta, error, origen, tipo, subido_por FROM pliegos WHERE licitacion_id = ? ORDER BY rowid',
      )
      .all(id) as Record<string, unknown>[],
  );
  const idx = abrirIndiceLectura();
  if (!idx) return filas;
  return filas.map((p) =>
    p['estado'] === 'descargado' && typeof p['ruta'] === 'string' && p['tipo'] !== 'deuc'
      ? { ...p, ...estadoEnIndice(idx, p['ruta']) }
      : p,
  );
}

type PliegoArchivo = Record<string, unknown> & { clases: string[]; tambien_como: string[] };

// El feed publica a veces el mismo archivo como pcap y como ppt, y el expediente enlaza dos
// documentos que son el mismo archivo (mismo sha, una sola ruta): listarlos aparte hacía creer
// que había más pliegos. Una entrada por archivo, con todas sus clases y sus otros nombres. Lo
// que no se bajó (sin ruta) se deja tal cual: cada fila es un documento por conseguir.
function unaPorArchivo(filas: Record<string, unknown>[]): Record<string, unknown>[] {
  const porRuta = new Map<string, PliegoArchivo>();
  return filas.flatMap((p) => {
    const ruta = p['estado'] === 'descargado' && typeof p['ruta'] === 'string' ? p['ruta'] : null;
    if (ruta === null) return [p];
    const previa = porRuta.get(ruta);
    if (previa) {
      sumarAlArchivo(previa, p);
      return [];
    }
    const nueva: PliegoArchivo = { ...p, clases: [String(p['clase'])], tambien_como: [] };
    porRuta.set(ruta, nueva);
    return [nueva];
  });
}

function sumarAlArchivo(archivo: PliegoArchivo, p: Record<string, unknown>): void {
  const clase = String(p['clase']);
  const nombre = String(p['nombre']);
  if (!archivo.clases.includes(clase)) archivo.clases.push(clase);
  if (nombre !== archivo['nombre'] && !archivo.tambien_como.includes(nombre)) archivo.tambien_como.push(nombre);
}

// Como en la lista de Oportunidades; sin criba ni ficha, ninguna (la temática sale solo de los CPV).
function opinionDelDetalle(f: FilaDetalle, g: GoNoGo): Opinion | null {
  const de_hermes = !f.cambiada_a_mano && (f.veredicto_ia === 'descartar' || Boolean(f.descarte_automatico));
  const decision_ficha = g.ficha.aprobada?.datos.recomendacion.decision ?? null;
  return de_hermes || decision_ficha || f.veredicto_ia
    ? opinionQueManda({ de_hermes, decision_ficha, veredicto_ia: f.veredicto_ia })
    : null;
}

/** idx: el índice de la Biblioteca, donde se buscan las citas de la ficha. */
export function detalle(
  db: Db,
  id: string,
  hoy = new Date(),
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): Result<Detalle> {
  const f = db
    .prepare(
      `SELECT l.*, COALESCE(o.estado, 'sin_oportunidad') AS op_estado, o.motivo_prefiltro, o.veredicto_ia, o.motivo_ia,
      o.confianza_ia, o.notas, o.rescatada, o.cambiada_a_mano, o.motivo_descarte, o.descarte_automatico, o.lotes_interes, o.lotes_prefiltro,
      o.error_proceso, o.error_detalle FROM licitaciones l LEFT JOIN oportunidades o ON o.licitacion_id = l.id WHERE l.id = ?`,
    )
    .get(id) as FilaDetalle | undefined;
  if (!f) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const pliegos = pliegosDe(db, id);
  const perfil = leerPerfilEmpresa(db)?.perfil ?? null;
  const go_no_go = goNoGo(db, f, perfil, hoy);
  const fecha_solicitud =
    f.fecha_solicitud ?? solicitudDeHitos(go_no_go.ficha?.aprobada?.datos.hitos ?? [], f.fecha_limite);
  return ok({
    ...aResumen(f),
    fecha_solicitud,
    expediente: f.expediente,
    procedimiento: nombreDe(PROCEDIMIENTOS, f.procedimiento),
    valor_estimado: f.valor_estimado,
    nuts: f.nuts,
    lugar: f.lugar,
    organo_nif: f.organo_nif,
    notas: f.notas ?? null,
    rescatada: Boolean(f.rescatada),
    datos: JSON.parse(f.datos) as Record<string, unknown>,
    adjudicaciones: adjudicaciones(db, id),
    pliegos,
    completitud_pliegos: completitudPliegos(db, id),
    cambiada_a_mano: Boolean(f.cambiada_a_mano),
    motivo_descarte: f.motivo_descarte ?? null,
    ...descarteVigente(db, id, f.op_estado),
    descarte_automatico: Boolean(f.descarte_automatico),
    idioma: idiomaDelTexto(f.titulo),
    go_no_go,
    citas_requisitos: citasDeRequisitos(db, idx, id, go_no_go.ficha?.aprobada?.datos.requisitos ?? []),
    encaje: encajeDe(
      contextoEncaje(db, perfil, hoy.getTime()),
      entradaDeGoNoGo(f, go_no_go, opinionDelDetalle(f, go_no_go)),
    ),
    lotes: lotesDelDetalle(f),
    ficha_en_curso: trabajoEnCurso(db, TIPO_FICHA, id),
    oferta: resumenOferta(db, id),
    carpeta_unica: carpetaUnicaEnDb(db, id),
    responsable: responsableDe(db, id),
  });
}

// Lo que un agente no necesita de los datos de la PLACSP: las URL de los documentos (ya
// están bajados, con su ruta en «pliegos»), los resultados (van en «adjudicaciones») y los
// lotes (van enteros en «lotes»). Los saltos de línea como entidad (&#xD;) son ruido.
function datosParaAgente(datos: Record<string, unknown>): Record<string, unknown> {
  const {
    documentos,
    resultados: _r,
    lotes: _l,
    ...resto
  } = datos as { documentos?: { clase?: string; nombre?: string }[]; resultados?: unknown; lotes?: unknown };
  const limpio = JSON.parse(JSON.stringify(resto).replace(/&#x?[dDaA];/g, '')) as Record<string, unknown>;
  return { ...limpio, documentos: (documentos ?? []).map((d) => ({ clase: d.clase, nombre: d.nombre })) };
}

/**
 * El detalle tal como lo lee un agente: primero lo que necesita para decidir (go/no-go con la
 * ficha y el ámbito, lotes, pliegos con su ruta y si se leen, antecedentes) y al final los
 * datos en bruto de la PLACSP, aligerados. Antes iban primero y, en una licitación grande, el
 * recorte de la respuesta se llevaba justo lo importante.
 */
export function detalleParaAgente(d: Detalle, antecedentes: unknown, zona: ZonaHoraria): Record<string, unknown> {
  // El encaje no va: su temática sale de la opinión de Hermes y se la daría de vuelta.
  const { go_no_go, lotes, pliegos, datos, adjudicaciones: adj, encaje: _e, ...resto } = resumenParaAgente(d, zona);
  const { id, titulo, organo, expediente, estado, fecha_limite, plazo_texto, importe, idioma, ...demas } = resto;
  return {
    id,
    titulo,
    organo,
    expediente,
    estado,
    fecha_limite,
    plazo_texto,
    importe,
    idioma,
    go_no_go,
    lotes,
    pliegos,
    antecedentes,
    ...demas,
    adjudicaciones: adj,
    datos: datosParaAgente(datos),
  };
}

// Los motivos del evaluador citan cifras del perfil de empresa (dominio plataforma):
// un agente sin permiso para leer plataforma ve el resultado, pero no las cifras.
const RESERVADO = 'Comparado con el perfil de la empresa (cifras reservadas: el agente no puede leer plataforma).';

// En la ficha, Hermes compara con el perfil en la justificación de cada requisito, el
// motivo de la recomendación y los riesgos: se reservan igual; lo que dice el pliego, no.
function fichaSinCifras(ficha: FichaGuardada | null): FichaGuardada | null {
  if (!ficha) return null;
  const d = ficha.datos;
  return {
    ...ficha,
    datos: {
      ...d,
      requisitos: d.requisitos.map((r) => ({
        ...r,
        justificacion: RESERVADO,
        ...(r.fuente ? { fuente: RESERVADO } : {}),
      })),
      recomendacion: { ...d.recomendacion, motivo: RESERVADO },
      riesgos: d.riesgos.map((r) => ({ ...r, descripcion: RESERVADO })),
      ...(d.verificaciones
        ? {
            verificaciones: d.verificaciones.map((v) => ({
              ...v,
              fuente: RESERVADO,
              detalle: v.detalle === null ? null : RESERVADO,
            })),
          }
        : {}),
      ...(d.calidad ? { calidad: { ...d.calidad, avisos: d.calidad.avisos.map(() => RESERVADO) } } : {}),
    },
  };
}

// El motivo de la recomendación también compara con el perfil: se reserva como en la ficha.
const motivoAutomaticoParaAgente = (d: Detalle) =>
  d.categoria_descarte === CATEGORIA_NO_GO
    ? `Descartada sola: la ficha de Hermes dice «No go». ${RESERVADO}`
    : `Descartada sola por un requisito excluyente. ${RESERVADO}`;

export function sinCifrasDelPerfil(d: Detalle): Detalle {
  const g = d.go_no_go;
  const requisitos = g.requisitos.map((r) =>
    r.origen === 'placsp' && r.resultado !== 'desconocido' ? { ...r, motivo: RESERVADO } : r,
  );
  const semaforo = {
    ...g.semaforo,
    bloqueos: g.semaforo.bloqueos.map(() => `Requisito excluyente no cumplido. ${RESERVADO}`),
  };
  const motivo =
    d.descarte_automatico && d.motivo_descarte !== null ? motivoAutomaticoParaAgente(d) : d.motivo_descarte;
  return {
    ...d,
    motivo_descarte: motivo,
    go_no_go: { ...g, semaforo, requisitos, ficha: { aprobada: fichaSinCifras(g.ficha.aprobada) } },
  };
}

// Lo que una persona fija a mano es el triaje. Presentada, ganada y perdida salen de la
// propuesta registrada y de su resultado (propuestas/oportunidad.ts): así la oportunidad y
// su propuesta no pueden contradecirse. Descartar pide el motivo.
const ESTADOS_A_MANO = ['nueva', 'en_preparacion', 'descartada'] as const;
const SALEN_DE_LA_PROPUESTA =
  'Presentada, ganada y perdida salen de la propuesta: regístrala en la ficha (Preparación) o anota su resultado.';

// Las que elige una persona; «hermes_no_go» solo la pone el código (ficha «No go» de Hermes).
export const CATEGORIAS_DESCARTE = ['solvencia', 'certificacion', 'plazo', 'precio', 'encaje', 'otro'] as const;
export type CategoriaDescarte = (typeof CATEGORIAS_DESCARTE)[number] | typeof CATEGORIA_NO_GO;

export type EntradaDescarte = {
  id: number;
  accion: 'descartada' | 'recuperada';
  categoria: CategoriaDescarte | null;
  motivo: string | null;
  automatico: boolean;
  quien: string | null;
  en: string;
};

/** Descartes y recuperaciones de una licitación, de la más antigua a la más reciente: «motivo_descarte» se borra al recuperar y esto no. */
export function historialDescartes(db: Db, id: string): EntradaDescarte[] {
  const filas = db
    .prepare(
      'SELECT id, accion, categoria, motivo, automatico, quien, en FROM descartes_historial WHERE licitacion_id = ? ORDER BY id',
    )
    .all(id) as (Omit<EntradaDescarte, 'automatico'> & { automatico: number })[];
  return filas.map((f) => ({ ...f, automatico: Boolean(f.automatico) }));
}

type DescarteVigente = { categoria_descarte: CategoriaDescarte | null; descartada_en: string | null };

// El tipo y la fecha solo valen mientras siga descartada: tras recuperarla no describen nada.
function descarteVigente(db: Db, id: string, estado: string): DescarteVigente {
  if (estado !== 'descartada') return { categoria_descarte: null, descartada_en: null };
  const f = db
    .prepare(
      "SELECT categoria, en FROM descartes_historial WHERE licitacion_id = ? AND accion = 'descartada' ORDER BY id DESC LIMIT 1",
    )
    .get(id) as { categoria: CategoriaDescarte | null; en: string } | undefined;
  return { categoria_descarte: f?.categoria ?? null, descartada_en: f?.en ?? null };
}

export const Cambio = z
  .object({
    estado: z.enum(ESTADOS_A_MANO, { error: SALEN_DE_LA_PROPUESTA }).optional(),
    notas: z.string().max(5000).optional(),
    motivo_descarte: z.string().trim().min(3, 'Escribe en pocas palabras por qué se descarta.').max(300).optional(),
    // Opcional aquí: los descartes de código y del MCP pueden no traerla (caen en «otro» al contar).
    categoria_descarte: z.enum(CATEGORIAS_DESCARTE).optional(),
    // Quién llevará la oferta si pasa a preparación (responsable.ts). Lo pone la ruta con la persona
    // de la sesión, nunca el cuerpo de la petición; si ya tenía responsable, se queda.
    responsable_id: z.number().int().positive().nullable().optional(),
  })
  .refine((c) => c.estado !== undefined || c.notas !== undefined, 'Indica estado o notas.')
  .refine((c) => c.estado !== 'descartada' || c.motivo_descarte !== undefined, {
    message: 'Al descartar, elige el motivo y dilo en pocas palabras.',
    path: ['motivo_descarte'],
  });

// Desde la web el descarte siempre es tipificado: sin tipo, «Qué nos falta» no lo cuenta.
export const CambioWeb = Cambio.refine((c) => c.estado !== 'descartada' || c.categoria_descarte !== undefined, {
  message: 'Al descartar, elige el tipo de motivo.',
  path: ['categoria_descarte'],
});

const DE_LA_PROPUESTA: ReadonlySet<string> = new Set(['presentada', 'ganada', 'perdida']);
const NO_SE_MUEVE_A_MANO =
  'Esta oportunidad ya está presentada (o resuelta): su estado sale de la propuesta registrada y de su resultado, no se cambia a mano. Las notas sí.';

/**
 * Cambio hecho por una persona en la web. Sacar una de «descartada» queda marcado como
 * rescate (y pierde el motivo del descarte), y un estado puesto a mano ya no lo cambia el
 * código (los descartes automáticos). Lo presentado no se mueve a mano: lo lleva su propuesta.
 * Pedir el estado que ya tiene no es un cambio: no escribe ni la marca como puesta a mano
 * (si no, un doble clic congelaba una oportunidad que el código aún debía poder mover).
 */
export function cambiarOportunidad(
  db: Db,
  id: string,
  cambio: z.infer<typeof Cambio>,
  quien: string | null = null,
): Result<{ estado: string }> {
  const op = db.prepare('SELECT estado, motivo_descarte FROM oportunidades WHERE licitacion_id = ?').get(id) as
    FilaCambio | undefined;
  if (!op) return fail('not_found', 'Esa licitación no es una oportunidad.');
  const cambiaEstado = cambio.estado !== undefined && cambio.estado !== op.estado;
  if (cambiaEstado && DE_LA_PROPUESTA.has(op.estado)) return fail('invalid_input', NO_SE_MUEVE_A_MANO);
  if (!cambiaEstado && cambio.notas === undefined) return ok({ estado: op.estado });
  const estado = cambiaEstado ? cambio.estado! : op.estado;
  db.transaction(() => aplicarCambio(db, id, op, { estado, cambio, quien }))();
  return ok({ estado });
}

type FilaCambio = { estado: EstadoOportunidad; motivo_descarte: string | null };
type CambioAplicado = { estado: EstadoOportunidad; cambio: z.infer<typeof Cambio>; quien: string | null };

function aplicarCambio(db: Db, id: string, op: FilaCambio, { estado, cambio, quien }: CambioAplicado): void {
  const rescate = op.estado === 'descartada' && estado !== 'descartada' ? 1 : 0;
  const aMano = estado !== op.estado ? 1 : 0;
  const motivo = estado === 'descartada' ? (cambio.motivo_descarte ?? null) : null;
  const ts = new Date().toISOString();
  db.prepare(
    `UPDATE oportunidades SET estado = @estado, notas = COALESCE(@notas, notas), rescatada = MAX(rescatada, @rescate),
    cambiada_a_mano = MAX(cambiada_a_mano, @aMano),
    motivo_descarte = CASE WHEN @estado = 'descartada' THEN COALESCE(@motivo, motivo_descarte) ELSE NULL END,
    descarte_automatico = CASE WHEN @aMano = 1 THEN 0 ELSE descarte_automatico END,
    responsable_id = CASE WHEN @estado = 'en_preparacion' THEN COALESCE(responsable_id, @responsable) ELSE responsable_id END,
    actualizada_en = @ts WHERE licitacion_id = @id`,
  ).run({
    estado,
    notas: cambio.notas ?? null,
    rescate,
    aMano,
    motivo,
    ts,
    id,
    responsable: cambio.responsable_id ?? null,
  });
  if (op.estado !== 'descartada' && estado === 'descartada')
    anotarDescarte(db, id, {
      accion: 'descartada',
      categoria: cambio.categoria_descarte ?? null,
      motivo,
      automatico: false,
      quien,
      ts,
    });
  if (rescate === 1)
    anotarDescarte(db, id, {
      accion: 'recuperada',
      categoria: null,
      motivo: op.motivo_descarte,
      automatico: false,
      quien,
      ts,
    });
}

export const EleccionLotes = z.object({
  lotes: z.array(z.string().trim().min(1).max(20)).min(1, 'Elige al menos un lote.').max(500),
  quien: z.string().trim().min(2).max(60).optional(),
});
const MOTIVO_A_MANO = 'Elegido a mano';

// Lo que la regla de presentación no deja elegir (null si se puede).
function loteNoElegible(
  ids: string[],
  lotes: LoteDatos[],
  regla: Pick<Presentacion, 'codigo' | 'maximo_lotes'> | null,
): string | null {
  const ajenos = ids.filter((i) => !lotes.some((l) => l.id === i));
  if (ajenos.length)
    return `Esta licitación no tiene ${ajenos.length === 1 ? 'el lote' : 'los lotes'} ${ajenos.join(', ')} (lotes: ${lotes.map((l) => l.id).join(', ')}).`;
  if (regla?.codigo === TODOS_LOS_LOTES) return 'Hay que presentarse a todos los lotes: no se eligen.';
  const maximo = regla?.codigo === UN_LOTE ? 1 : (regla?.maximo_lotes ?? null);
  return maximo !== null && ids.length > maximo
    ? `La regla de presentación permite ${maximo === 1 ? 'un solo lote' : `${maximo} lotes`} por oferta.`
    : null;
}

export type ResultadoLotes = {
  lotes: string[];
  anadidos: string[];
  quitados: string[];
  rehace: { ficha: boolean; guion: boolean };
};

// Qué volverá a hacer Hermes con la elección ya guardada: solo en preparación, y solo si la ficha
// o el guion vigentes se hicieron para otros lotes (quitar lotes no obliga a rehacerlos).
function loQueSeRehace(db: Db, id: string, estado: string, ids: string[]): ResultadoLotes['rehace'] {
  if (estado !== 'en_preparacion') return { ficha: false, guion: false };
  return {
    ficha: fichaDeOtrosLotes(fichasDe(db, id).aprobada?.datos ?? null, ids),
    guion: guionDeOtrosLotes(db, guionVigente(db, id)),
  };
}

/**
 * Guarda a qué lotes se va sin avisar a nadie: para quien lo hace dentro de una transacción que
 * aún puede deshacerse (las decisiones por sección, deshacer) y avisa con avisarLotes tras el commit.
 */
export function guardarLotesInteres(
  db: Db,
  id: string,
  eleccion: z.infer<typeof EleccionLotes>,
): Result<ResultadoLotes> {
  const op = db.prepare('SELECT lotes_interes, estado FROM oportunidades WHERE licitacion_id = ?').get(id) as
    { lotes_interes: string | null; estado: string } | undefined;
  const l = lotesDeLicitacion(db, id);
  if (!op || !l) return fail('not_found', 'Esa licitación no es una oportunidad.');
  if (!l.lotes.length) return fail('invalid_input', 'Esta licitación no tiene lotes.');
  const ids = [...new Set(eleccion.lotes)];
  const problema = loteNoElegible(ids, l.lotes, l.presentacion);
  if (problema) return fail('invalid_input', problema);
  const previos = leerLotesInteres(op.lotes_interes);
  const elegidos = l.lotes
    .filter((x) => ids.includes(x.id))
    .map((x) => ({ id: x.id, motivo: previos.find((p) => p.id === x.id)?.motivo ?? MOTIVO_A_MANO }));
  const lotes = elegidos.map((x) => x.id);
  const antes = previos.map((p) => p.id);
  const cambio = {
    anadidos: lotes.filter((x) => !antes.includes(x)),
    quitados: antes.filter((x) => !lotes.includes(x)),
  };
  guardarEleccion(db, id, {
    elegidos,
    autor: eleccion.quien ?? 'web',
    cambia: cambio.anadidos.length + cambio.quitados.length > 0,
  });
  return ok({ lotes, ...cambio, rehace: loQueSeRehace(db, id, op.estado, lotes) });
}

/** El aviso de que cambiaron los lotes de interés: recarga la web y las comprobaciones. Solo con lo ya guardado. */
export function avisarLotes(db: Db, id: string, lotes: string[]): void {
  emitir(db, { tipo: 'licitacion.lotes', dominio: 'licitaciones', recurso: id, datos: { lotes } });
}

/**
 * Una persona elige a qué lotes se va: pasan a ser los de interés (el ámbito de requisitos,
 * precios y guion). Los que ya eran de interés conservan el motivo de la criba. El evento
 * recarga la web; el guion de otros lotes se vuelve a pedir solo (encolarGuionesAuto).
 * Devuelve también qué lotes se añaden o quitan y qué rehará Hermes, para avisar con verdad.
 */
export function elegirLotesInteres(
  db: Db,
  id: string,
  eleccion: z.infer<typeof EleccionLotes>,
): Result<ResultadoLotes> {
  const r = guardarLotesInteres(db, id, eleccion);
  if (!r.error) avisarLotes(db, id, r.data.lotes);
  return r;
}

// La elección y, si cambia, su fila de historial: desde el Resumen o desde las
// decisiones, cada cambio de lotes deja quién y cuándo. Solo ids de lote: nada personal.
function guardarEleccion(
  db: Db,
  id: string,
  e: { elegidos: { id: string; motivo: string }[]; autor: string; cambia: boolean },
): void {
  const ts = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE oportunidades SET lotes_interes = ?, actualizada_en = ? WHERE licitacion_id = ?').run(
      JSON.stringify(e.elegidos),
      ts,
      id,
    );
    if (!e.cambia) return;
    db.prepare('INSERT INTO lotes_interes_historial (licitacion_id, lotes, autor, creada_en) VALUES (?, ?, ?, ?)').run(
      id,
      JSON.stringify(e.elegidos.map((x) => x.id)),
      e.autor,
      ts,
    );
  })();
}

/** Una licitación cualquiera (aunque el prefiltro no la cogiera) pasa a seguirse a mano. */
export function seguirLicitacion(db: Db, id: string): Result<{ estado: string }> {
  const existe = db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id);
  if (!existe) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, rescatada, cambiada_a_mano, creada_en, actualizada_en)
    VALUES (?, 'nueva', 'añadida a mano', 1, 1, ?, ?) ON CONFLICT(licitacion_id) DO NOTHING`,
  ).run(id, ts, ts);
  return ok({ estado: 'nueva' });
}
