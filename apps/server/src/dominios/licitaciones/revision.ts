// Oportunidades: lo que puede encajar y aún no está en el Pipeline, para decidir Aplicar o Descartar.
import { encajeOrdena } from './encajeCalibracion.js';
import { leerPerfilEmpresa } from '../../nucleo/empresa.js';
import { contextoEncaje, encajeDe, entradaDeGoNoGo, opinionQueManda, type Encaje } from './encaje.js';
import { goNoGo } from './ficha.js';
import { Bandera } from '../../nucleo/http.js';
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { consultaFts, enPliegos, rowidsPorTexto, type EnPliego } from './buscador.js';
import { z } from 'zod';
import type { Db } from './store.js';
import { IDIOMAS_DETECTABLES } from '../../nucleo/idioma.js';
import { logger } from '../../nucleo/log.js';
import { errorMessage } from '../../nucleo/result.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { ESTADOS, PROCEDIMIENTOS, nombreDe } from './placsp/codigos.js';
import { evaluarConLotes, pasaSinTema, type FiltrosData } from './prefiltro.js';
import { leerLotesInteres } from './lotes.js';
import { SQL_CON_ERROR, tituloCorto } from './pipeline.js';

// Por fecha de cierre, la más cercana primero. Lo que descartó Hermes (criba «descartar» o ficha «No go») va a
// «Descartadas», apagado y con su motivo, junto a lo que descartó una persona, y se puede aplicar igual. Los
// filtros son los del prefiltro (Ajustes › Fuentes y filtros) a la vista: la lista se afina sin tocar la
// ingesta.
const log = logger('licitaciones');

const PESTANAS_REVISION = ['por_revisar', 'sin_cribar', 'errores', 'descartadas'] as const;
type PestanaRevision = (typeof PESTANAS_REVISION)[number];
const OPINIONES = ['interesa', 'revisar', 'descartar'] as const;
type Opinion = (typeof OPINIONES)[number];

const lista = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(item).max(200).optional());
const importe = z.coerce.number().nonnegative().max(1e12).optional();

/** La consulta de la web (todo llega como texto; las listas, separadas por comas). */
export const FiltroRevision = z.object({
  pestana: z.enum(PESTANAS_REVISION).default('por_revisar'),
  texto: z.string().trim().max(200).optional(),
  // Con texto: buscarlo también en los pliegos descargados (índice de la Biblioteca).
  pliegos: Bandera,
  opinion: lista(z.enum(OPINIONES)),
  comunidad: lista(z.string().regex(/^ES[0-9A-Z]{2}$/)),
  importe_min: importe,
  importe_max: importe,
  cpv: lista(z.string().regex(/^\d{2,8}$/)),
  palabras: lista(z.string().min(2).max(80)),
  excluir: lista(z.string().min(2).max(80)),
  tipos: lista(z.string().regex(/^\d{1,3}$/)),
  idiomas: lista(z.enum(IDIOMAS_DETECTABLES)),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
  // Solo las que llegaron a la lista desde entonces (ISO): las nuevas de una búsqueda guardada.
  creada_desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T/)
    .max(40)
    .optional(),
});
export type FiltroRevisionData = z.infer<typeof FiltroRevision>;

export type ItemRevision = {
  id: string;
  expediente: string;
  titulo: string;
  titulo_corto: string;
  organo: string;
  procedimiento: string | null;
  estado_placsp: string;
  importe: number | null;
  fecha_limite: string | null;
  fecha_solicitud: string | null;
  estado: string;
  opinion: Opinion;
  motivo: string | null;
  apagada: boolean;
  con_ficha: boolean;
  lotes_interes: string[];
  error_proceso: string | null;
  creada_en: string | null;
  // Buscando en los pliegos, dónde aparece (solo si no aparece ya en el título).
  en_pliego: EnPliego | null;
  // El encaje 0-100 con su desglose; null sin datos para calcularlo.
  encaje: Encaje | null;
  // El contrato que vencía y que alguien seguía (Mercado › Vencimientos): «renovación que seguías».
  renovacion_de: string | null;
};
export type ListaRevision = {
  total: number;
  items: ItemRevision[];
  cuentas: Record<PestanaRevision, number>;
  opiniones: Record<Opinion, number>;
  // Por fecha de cierre, salvo que la calibración diga que el encaje ordena como decidimos (encajeOrdena).
  orden: 'plazo' | 'encaje';
};

// Lo que descartó Hermes (y una persona no tocó): la criba o la ficha «No go».
const DE_HERMES = "(o.cambiada_a_mano = 0 AND (o.veredicto_ia = 'descartar' OR o.descarte_automatico = 1))";
const FICHA = "EXISTS (SELECT 1 FROM fichas fi WHERE fi.licitacion_id = o.licitacion_id AND fi.estado = 'aprobada')";
const PESTANA_SQL = `CASE
  WHEN o.estado = 'candidata' THEN 'sin_cribar'
  WHEN ${SQL_CON_ERROR} THEN 'errores'
  WHEN o.estado = 'nueva' THEN 'por_revisar'
  WHEN o.estado = 'descartada' THEN 'descartadas' END`;
const ULTIMA_FICHA = (campo: string) => `(SELECT json_extract(fi.datos, '${campo}') FROM fichas fi
  WHERE fi.licitacion_id = o.licitacion_id AND fi.estado = 'aprobada' ORDER BY fi.id DESC LIMIT 1)`;

type Fila = {
  rowid: number;
  id: string;
  expediente: string;
  titulo: string;
  organo_nombre: string;
  organo_nif: string | null;
  valor_estimado: number | null;
  lotes_prefiltro: string | null;
  max_lotes_adjudicacion: number | null;
  procedimiento: string | null;
  estado: string;
  presupuesto_sin_iva: number | null;
  fecha_limite: string | null;
  fecha_solicitud: string | null;
  cpvs: string;
  tipo_contrato: string | null;
  nuts: string | null;
  borrada_en: string | null;
  datos: string;
  presentacion_lotes: string | null;
  max_lotes_oferta: number | null;
  op_estado: string;
  veredicto_ia: string | null;
  motivo_ia: string | null;
  motivo_descarte: string | null;
  de_hermes: number;
  con_ficha: number;
  decision_ficha: string | null;
  motivo_ficha: string | null;
  titulo_ficha: string | null;
  lotes_interes: string | null;
  error_proceso: string | null;
  creada_en: string | null;
  pestana: PestanaRevision;
  renovacion_de: string | null;
};

function filtrosDe(f: FiltroRevisionData): FiltrosData {
  return {
    cpv_prefijos: f.cpv ?? [],
    palabras: f.palabras ?? [],
    excluir_palabras: f.excluir ?? [],
    importe_min: f.importe_min ?? null,
    importe_max: f.importe_max ?? null,
    tipos_contrato: f.tipos ?? [],
    nuts_prefijos: [],
    excluir_idiomas: f.idiomas ?? [],
  };
}

/**
 * Pasa los filtros con las reglas del prefiltro (abierta, tipo, palabras que descartan, idioma,
 * importe por lote y CPV o palabra). Sin CPV ni palabras, vale cualquier tema.
 */
function pasaFiltros(f: FiltrosData, l: Parameters<typeof evaluarConLotes>[1], ahoraMs: number): boolean {
  if (!f.cpv_prefijos.length && !f.palabras.length) return pasaSinTema(f, l, ahoraMs);
  return evaluarConLotes(f, l, ahoraMs) !== null;
}

const opinionDe = (r: Fila): Opinion =>
  opinionQueManda({ de_hermes: Boolean(r.de_hermes), decision_ficha: r.decision_ficha, veredicto_ia: r.veredicto_ia });

function aItem(r: Fila, enPliego: EnPliego | null, encaje: Encaje | null): ItemRevision {
  const opinion = opinionDe(r);
  return {
    id: r.id,
    expediente: r.expediente,
    titulo: r.titulo,
    titulo_corto: r.titulo_ficha?.trim() || tituloCorto(r.titulo),
    organo: r.organo_nombre,
    procedimiento: nombreDe(PROCEDIMIENTOS, r.procedimiento),
    estado_placsp: nombreDe(ESTADOS, r.estado) ?? r.estado,
    importe: r.presupuesto_sin_iva,
    fecha_limite: r.fecha_limite,
    fecha_solicitud: r.fecha_solicitud,
    estado: r.op_estado,
    opinion,
    motivo:
      (r.de_hermes || r.op_estado === 'descartada'
        ? (r.motivo_descarte ?? r.motivo_ia)
        : (r.motivo_ficha ?? r.motivo_ia)) ?? null,
    apagada: Boolean(r.de_hermes),
    con_ficha: Boolean(r.con_ficha),
    lotes_interes: leerLotesInteres(r.lotes_interes).map((x) => x.id),
    error_proceso: r.error_proceso,
    creada_en: r.creada_en,
    en_pliego: enPliego,
    encaje,
    renovacion_de: r.renovacion_de,
  };
}

// Por el próximo plazo: la solicitud de participación mientras siga abierta; si no, la oferta.
function proximoPlazo(r: Fila, ahora: string): string {
  return (r.fecha_solicitud && r.fecha_solicitud >= ahora ? r.fecha_solicitud : r.fecha_limite) ?? '9999';
}

function filasCandidatas(db: Db, f: FiltroRevisionData): Fila[] {
  const comunidades = f.comunidad ?? [];
  const donde = [
    `(${PESTANA_SQL}) IS NOT NULL`,
    comunidades.length ? `(${comunidades.map(() => 'l.nuts LIKE ?').join(' OR ')})` : null,
    f.creada_desde ? 'COALESCE(o.reaparecida_en, o.creada_en) >= ?' : null,
  ].filter(Boolean);
  const args = [...comunidades.map((c) => `${c}%`), ...(f.creada_desde ? [f.creada_desde] : [])];
  return db
    .prepare(
      `SELECT l.rowid, l.id, l.organo_nif, l.valor_estimado, l.max_lotes_adjudicacion, o.lotes_prefiltro, l.expediente, l.titulo, l.organo_nombre, l.procedimiento, l.estado, l.presupuesto_sin_iva, l.fecha_limite,
      l.fecha_solicitud, l.cpvs, l.tipo_contrato, l.nuts, l.borrada_en, l.datos, l.presentacion_lotes, l.max_lotes_oferta,
      o.estado AS op_estado, o.veredicto_ia, o.motivo_ia, o.motivo_descarte, o.lotes_interes, o.error_proceso, o.renovacion_de,
      COALESCE(o.reaparecida_en, o.creada_en) AS creada_en, ${DE_HERMES} AS de_hermes, ${FICHA} AS con_ficha,
      ${ULTIMA_FICHA('$.recomendacion.decision')} AS decision_ficha, ${ULTIMA_FICHA('$.recomendacion.motivo')} AS motivo_ficha,
      ${ULTIMA_FICHA('$.titulo_corto')} AS titulo_ficha, ${PESTANA_SQL} AS pestana
    FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE ${donde.join(' AND ')}`,
    )
    .all(...args) as Fila[];
}

/** La lista de una pestaña, afinada con los filtros, por fecha de cierre, con las cuentas de cada pestaña y opinión. */
/** porEncaje: ordenar por encaje (por defecto, lo que diga la calibración); si no, por fecha de cierre. */
export function listaRevision(
  db: Db,
  f: FiltroRevisionData,
  ahoraMs = Date.now(),
  idx: indice.BaseDatos | null = null,
  porEncaje = encajeOrdena(db, ahoraMs),
): ListaRevision {
  const ahora = horaLocalEspana(ahoraMs);
  const filtros = filtrosDe(f);
  const candidatas = filasCandidatas(db, f);
  const texto = coincidencias(db, f, candidatas, idx);
  const pasan = candidatas.filter(
    (r) =>
      (!texto || texto.titulo.has(r.rowid) || texto.pliego.has(r.id)) &&
      (r.renovacion_de !== null || pasaFiltros(filtros, r, ahoraMs)),
  );
  const cuentas = Object.fromEntries(
    PESTANAS_REVISION.map((p) => [p, pasan.filter((r) => r.pestana === p).length]),
  ) as Record<PestanaRevision, number>;
  const deLaPestana = pasan.filter((r) => r.pestana === f.pestana);
  const opiniones = Object.fromEntries(
    OPINIONES.map((o) => [o, deLaPestana.filter((r) => opinionDe(r) === o).length]),
  ) as Record<Opinion, number>;
  const elegidas = f.opinion ?? OPINIONES;
  const porPlazo = deLaPestana
    .filter((r) => elegidas.includes(opinionDe(r)))
    .sort((a, b) => proximoPlazo(a, ahora).localeCompare(proximoPlazo(b, ahora)));
  const desde = (f.pagina - 1) * f.limite;
  const enPliego = (r: Fila) => (texto && !texto.titulo.has(r.rowid) ? (texto.pliego.get(r.id) ?? null) : null);
  // Por encaje hay que calcularlo en todas las de la pestaña; por plazo, solo en la página.
  const encaje = encajesDe(db, porEncaje ? porPlazo : porPlazo.slice(desde, desde + f.limite), ahoraMs);
  const vistas = porEncaje
    ? porPlazo
        .map((r) => ({ r, e: encaje(r) }))
        .sort((a, b) => (b.e?.valor ?? -1) - (a.e?.valor ?? -1))
        .map((x) => x.r)
    : porPlazo;
  const pagina = vistas.slice(desde, desde + f.limite);
  return {
    total: vistas.length,
    items: pagina.map((r) => aItem(r, enPliego(r), encaje(r))),
    cuentas,
    opiniones,
    orden: porEncaje ? 'encaje' : 'plazo',
  };
}

// El encaje de las filas de una página (con el go/no-go de cada una, como la lista de antes): el
// contexto (perfil, presentadas, comparables) se calcula una vez. Un fallo deja la fila sin encaje.
function encajesDe(db: Db, filas: Fila[], ahoraMs: number): (r: Fila) => Encaje | null {
  if (!filas.length) return () => null;
  const perfil = leerPerfilEmpresa(db)?.perfil ?? null;
  const ctx = contextoEncaje(db, perfil, ahoraMs);
  const hechos = new Map<string, Encaje | null>();
  const calcular = (r: Fila): Encaje | null => {
    try {
      return encajeDe(ctx, entradaDeGoNoGo(r, goNoGo(db, r, perfil, new Date(ahoraMs)), opinionDe(r)));
    } catch (err) {
      // Una fila sin encaje no tumba la lista; queda en el log para ver por qué.
      log.error('encaje sin calcular', { id: r.id, error: errorMessage(err) });
      return null;
    }
  };
  return (r) => {
    if (!hechos.has(r.id)) hechos.set(r.id, calcular(r));
    return hechos.get(r.id)!;
  };
}

// Lo que casa con el texto (búsqueda de texto de buscador.ts): en el título, el órgano, el
// expediente o los lotes y, si se pide, en los pliegos. null sin texto que buscar.
function coincidencias(
  db: Db,
  f: FiltroRevisionData,
  filas: Fila[],
  idx: indice.BaseDatos | null,
): { titulo: Set<number>; pliego: Map<string, EnPliego> } | null {
  if (!f.texto || !consultaFts(f.texto)) return null;
  const titulo = new Set(rowidsPorTexto(db, f.texto, 100_000));
  const pliego = f.pliegos
    ? enPliegos(
        db,
        idx,
        f.texto,
        filas.map((r) => r.id),
      )
    : new Map<string, EnPliego>();
  return { titulo, pliego };
}
