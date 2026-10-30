// Las comprobaciones de la oferta: una sola verdad sobre qué impide presentar, calculada en el servidor.
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { ok, type Result } from '../../../nucleo/result.js';
import { vecesFueraPorClave } from '../barreras.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { leerPlan } from './anexoPlan.js';
import { desdeCoherencia, sinImportes } from './comprobacionesCoherencia.js';
import {
  leerEntradasComprobaciones,
  memoriasDeTrabajo,
  memoriasEvaluadas,
  type EntradasComprobaciones,
  type EstadoGuardado,
  type MemoriaEvaluada,
  type MemoriaLotes,
} from './comprobacionesEntradas.js';
import { fasesDe, hermesEnVivo } from './comprobacionesFases.js';
import { diasHastaPlazo, preciosDecididos, reglasDecisiones } from './comprobacionesReglasDecisiones.js';
import { reglasDesfases } from './comprobacionesReglasDesfases.js';
import { reglasDocumentos } from './comprobacionesReglasDocumentos.js';
import {
  reglaCompromisosCaros,
  REGLA_COMPROMISO_CARO,
  REGLA_COMPROMISOS_CAROS,
  type CosteBloqueo,
} from './comprobacionesReglasCostes.js';
import { comprobadoElegibilidad, reglasElegibilidad } from './comprobacionesReglasElegibilidad.js';
import { reglasFicha } from './comprobacionesReglasFicha.js';
import { reglasGuion } from './comprobacionesReglasGuion.js';
import { reglaLeccionesNoAplicadas } from './comprobacionesReglasLecciones.js';
import { reglaMemoriaReutilizada } from './comprobacionesReglasReutilizacion.js';
import { reglaTribunal } from './comprobacionesReglasTribunal.js';
import { reglaPreguntasPliego } from './comprobacionesReglasPreguntas.js';
import { reglasMedios } from './comprobacionesReglasMedios.js';
import {
  claveBloqueo,
  huellaDe,
  MINUTOS_POR_ACCION,
  ordenarBloqueos,
  type Bloqueo,
  type Comprobaciones,
  type Fase,
  type Gravedad,
} from './comprobacionesTipos.js';
import { reglaMargenPrecio } from './contextoPrecio.js';
import {
  coherenciaCompromisos,
  noPrometerDe,
  type Choque,
  type DatoAnexo,
  type EntradaCompromisos,
  type TipoChoque,
} from './coherenciaCompromisos.js';
import { minutosPersona, veredictoDe } from './comprobacionesVeredicto.js';
import {
  datoDecidido,
  datosQuePide,
  textosDeDocumentos,
  type DatoAnexo as DatoDelAnexo,
  type DatoPedido,
} from './datosAnexo.js';
import type { EstadoMemoria } from './memoria.js';
import { reglasDeMemoria, type FilaMemoria } from './reglasMemoria.js';
import { fasesPendientesDeHermes, horaInternaCierre, limiteParaDecidir } from './horaCierre.js';
import { bloqueosDeHitos, hitosDe } from './hitos.js';
import { DURACION_MIN, duracionMejoraMin } from './plazo.js';
import { medianasVigentes, minutosMedidos } from './telemetria.js';

// La usan las comprobaciones, la Mesa, la lista y el MCP. Es un agregador aditivo y sin escrituras: compone la
// coherencia de siempre con las reglas nuevas, aplica lo que la persona ya decidió sobre cada fila
// (oferta_bloqueos) mientras su huella no cambie y saca una versión (ETag) que solo cambia cuando cambia algo que
// se ve.
const REGLAS: readonly ((e: EntradasComprobaciones) => Bloqueo[])[] = [
  reglasElegibilidad,
  reglasFicha,
  reglasGuion,
  reglasMedios,
  reglasDecisiones,
  documentosSinMemoriaResuelta,
  reglasDesfases,
  reglaMemoriaPromete,
  reglaDatosAnexo,
  reglaMargenPrecio,
  reglaAdjudicacion,
  reglasMemoriaComprobaciones,
  reglaCompromisosCaros,
  reglaLeccionesNoAplicadas,
  reglaMemoriaReutilizada,
  reglaTribunal,
  reglaPreguntasPliego,
];

// La ruta de la fila si es la memoria propia de su lote: la aceptada de ese lote o un documento
// puesto a mano. La común (lote null) o la de otro lote no valen: documentos.ts pone la común en
// la fila del lote que aún no tiene la suya, y esa memoria promete cosas de los dos.
function rutaPropia(
  ml: MemoriaLotes,
  lote: string,
  f: EntradasComprobaciones['documentos']['filas'][number] | undefined,
): string | null {
  if (f?.estado !== 'preparado' || !f.ruta) return null;
  const propias = ml.por_lote.find((x) => x.lote === lote)?.aceptadas ?? [];
  return propias.includes(f.ruta) || !ml.rutas_memoria.includes(f.ruta) ? f.ruta : null;
}

// «El pliego pide una memoria por lote»: deja de impedir cuando cada lote decidido tiene en la
// checklist su propia memoria, un archivo distinto por lote. Si un lote lleva la común, sigue.
function cadaLoteConSuMemoria(e: EntradasComprobaciones): boolean {
  const ml = e.memoria_lotes;
  if (!ml) return false;
  const filas = new Map(e.documentos.filas.map((f) => [f.clave, f]));
  const memorias = e.documentos.del_guion.filter((d) => d.doc.tipo === 'memoria');
  if (memorias.length < 2 || memorias.some((d) => d.lote === null)) return false;
  const rutas = memorias.map((d) => rutaPropia(ml, d.lote!, filas.get(d.clave)));
  return rutas.every((r) => r !== null) && new Set(rutas).size === rutas.length;
}

function documentosSinMemoriaResuelta(e: EntradasComprobaciones): Bloqueo[] {
  const filas = reglasDocumentos(e);
  return cadaLoteConSuMemoria(e) ? filas.filter((b) => !b.clave.startsWith('memoria_por_lote:')) : filas;
}

// Una fila por clave. Si una regla nueva y la coherencia ven lo mismo, manda la regla nueva:
// trae cita, actor y acción más finos.
function sinDuplicados(nuevas: readonly Bloqueo[], deCoherencia: readonly Bloqueo[]): Bloqueo[] {
  const porClave = new Map<string, Bloqueo>();
  for (const b of nuevas) if (!porClave.has(b.clave)) porClave.set(b.clave, b);
  for (const b of deCoherencia) if (!porClave.has(b.clave)) porClave.set(b.clave, b);
  return [...porClave.values()];
}

// Lo guardado solo vale para lo que se vio: si la fila cambió (otra rectificación, otro guion), vuelve a abrirse.
function conEstado(b: Bloqueo, guardado: EstadoGuardado | undefined): Bloqueo {
  if (!guardado || guardado.huella !== b.huella) return { ...b, estado: 'abierto' };
  const propuesta =
    guardado.propuesta && guardado.citas.length ? { ...guardado.propuesta, citas: guardado.citas } : guardado.propuesta;
  return { ...b, estado: guardado.estado, propuesta: propuesta ?? b.propuesta };
}

// Los minutos de cada fila: la mediana medida de su acción cuando ya hay bastantes
// ofertas y, si no, la tabla fija de su regla.
function bloqueosDe(e: EntradasComprobaciones, medianas: ReadonlyMap<string, number>): Bloqueo[] {
  const filas = sinDuplicados(
    REGLAS.flatMap((regla) => regla(e)),
    desdeCoherencia(e.coherencia),
  );
  return ordenarBloqueos(filas.map((b) => minutosMedidos(conEstado(b, e.guardados.get(b.clave)), medianas)));
}

const abierta = (b: Bloqueo): boolean => b.estado === 'abierto' || b.estado === 'propuesta';
const sinAbiertas = (bs: readonly Bloqueo[], categoria: Bloqueo['categoria']): boolean =>
  !bs.some((b) => b.categoria === categoria && abierta(b));

type Comprobacion = {
  clave: string;
  texto: string;
  vale: (e: EntradasComprobaciones, bs: readonly Bloqueo[]) => boolean;
};

// El precio se mira en las decisiones y no en la falta de filas: una regla que aún no existe no es una comprobación.
const COMPROBACIONES: readonly Comprobacion[] = [
  {
    clave: 'precio',
    texto: 'Precio de todos los lotes decidido',
    vale: (e, bs) => preciosDecididos(e) && sinAbiertas(bs, 'precio'),
  },
  {
    clave: 'fugas',
    texto: 'Sin fugas entre sobres en la memoria',
    vale: (e, bs) =>
      memoriasEvaluadas(e).every(
        (m) => m.memoria?.estado === 'ensamblada' && m.fugas !== null && !m.fugas.hallazgos.length,
      ) && sinAbiertas(bs, 'fugas'),
  },
  {
    clave: 'coherencia',
    texto: 'Lotes, ficha, pliegos, guion y decisiones casan entre sí',
    vale: (e, bs) => e.guion !== null && !desdeCoherencia(e.coherencia).length && !hayDesfase(bs),
  },
];

// Decisiones, propuesta o memoria de otro guion: el guion y lo demás no casan, aunque la coherencia calle.
const DESFASES: ReadonlySet<string> = new Set(['propuesta_obsoleta', 'decisiones_obsoletas', 'memoria_obsoleta']);
const hayDesfase = (bs: readonly Bloqueo[]): boolean =>
  bs.some((b) => abierta(b) && DESFASES.has(b.clave.split(':')[0]!));

// Con las certificaciones que el pliego exige y el perfil cubre («ENS BÁSICA: la tenemos, vigente hasta …»).
const comprobadoDe = (e: EntradasComprobaciones, bs: readonly Bloqueo[]): Comprobaciones['comprobado'] => [
  ...COMPROBACIONES.filter((c) => c.vale(e, bs)).map(({ clave, texto }) => ({ clave, texto })),
  ...comprobadoElegibilidad(e),
];

const horaCorta = (iso: string): string => horaLocalEspana(Date.parse(iso)).slice(11, 16);

function veredicto(
  e: EntradasComprobaciones,
  bloqueos: readonly Bloqueo[],
  fases: readonly Fase[],
): Comprobaciones['veredicto'] {
  const eta = fases.find((f) => f.eta)?.eta ?? null;
  const retirada = e.licitacion.borrada_en !== null;
  return veredictoDe({
    descartada: e.oportunidad?.estado === 'descartada',
    retirada,
    bloqueos,
    enCurso: e.trabajos.length > 0,
    motivo: retirada
      ? (e.licitacion.borrada_motivo ?? 'retirada de la plataforma')
      : (e.oportunidad?.motivo_descarte ?? null),
    eta: eta ? { desde: horaCorta(eta.desde), hasta: horaCorta(eta.hasta) } : null,
  });
}

// ── Cuántas veces dejó fuera a la empresa la barrera de una fila ──

export type BarreraDeFila = { clave: string; veces_fuera: number };
export type BloqueoConBarrera = Bloqueo & { barrera?: BarreraDeFila };
/** Veces que una barrera de «Qué nos falta» dejó fuera a la empresa, por su clave. */
export type VecesFuera = (clave: string) => number;

// La fila de elegibilidad y su barrera: el certificado de «excluyente_vs_perfil:<lote>:<cert>» y la
// materia de «medios:<lote>:<materia>» (las dos claves usan el mismo sujeto que «Qué nos falta»).
export function claveDeBarrera(b: Bloqueo): string | null {
  const [regla, , ...sujeto] = b.clave.split(':');
  if (b.categoria !== 'elegibilidad' || !sujeto.length) return null;
  if (regla === 'excluyente_vs_perfil') return sujeto.join(':');
  return regla === 'medios' ? `experiencia_personal:${sujeto.join(':')}` : null;
}

const veces = (n: number): string => (n === 1 ? '1 vez' : `${n} veces`);

function conBarrera(b: Bloqueo, fuera: VecesFuera): BloqueoConBarrera {
  const clave = claveDeBarrera(b);
  const n = clave ? fuera(clave) : 0;
  if (!clave || n <= 0) return b;
  return {
    ...b,
    titulo: `${b.titulo}. Esta barrera ya nos dejó fuera ${veces(n)}`,
    barrera: { clave, veces_fuera: n },
  };
}

/** Las veces fuera de la base, calculadas una sola vez y solo si alguna fila las pide. */
export function vecesFueraDe(db: Db, id: string): VecesFuera {
  let mapa: Map<string, number> | null = null;
  return (clave) => (mapa ??= vecesFueraPorClave(db, id)).get(clave) ?? 0;
}

// ── Compromisos caros: hasta cuándo da tiempo a suavizarlos ──

/** Una fila con lo que cuesta cumplir un compromiso de la memoria (comprobacionesReglasCostes.ts). Lleva euros: solo web. */
export type BloqueoConCoste = Bloqueo & { coste?: CosteBloqueo };

const REVISION_SUAVIZAR_MIN = 30;
const MIN_MS = 60_000;
// Como duracionMejoraMin (plazo.ts): una ronda es un solo run de redacción de lo que se rehace y
// luego se ensambla.
const ENSAMBLADO_MIN = 10;

/** Lo que tarda una ronda que rehace `apartados` apartados: con la mediana medida de un run de redacción o, sin ella, lo presupuestado. */
export function duracionRondaMin(apartados: number, medianaRedaccionMin: number | null): number {
  if (medianaRedaccionMin === null) return duracionMejoraMin(apartados);
  return Math.min(DURACION_MIN.mejora, ENSAMBLADO_MIN + medianaRedaccionMin);
}
const esDeCoste = (b: Bloqueo): boolean =>
  [REGLA_COMPROMISO_CARO, REGLA_COMPROMISOS_CAROS].includes(b.clave.split(':')[0]!);

/**
 * La hora interna de cierre menos una ronda de memoria con los apartados de los compromisos caros
 * abiertos (con la mediana medida de un run de redacción más el ensamblado o, sin muestras, lo
 * presupuestado para una mejora) y 30 min para revisarla. null sin cierre o sin compromisos caros abiertos.
 */
export function limiteSuavizar(
  cierre: string | null,
  bloqueos: readonly BloqueoConCoste[],
  rondaMedidaMin: number | null = null,
): string | null {
  const abiertos = bloqueos.filter((b) => esDeCoste(b) && abierta(b));
  const fin = cierre ? Date.parse(cierre) : NaN;
  if (!abiertos.length || Number.isNaN(fin)) return null;
  const apartados = new Set(
    abiertos.flatMap((b) => (b.coste?.apariciones ?? []).flatMap((a) => (a.apartado === null ? [] : [a.apartado]))),
  );
  const ronda = duracionRondaMin(apartados.size, rondaMedidaMin);
  return new Date(fin - (ronda + REVISION_SUAVIZAR_MIN) * MIN_MS).toISOString();
}

/** Las comprobaciones ya compuestas a partir de sus entradas. Pura: la usan comprobacionesDe y los tests de reglas. */
export function componerComprobaciones(
  e: EntradasComprobaciones,
  margenHoras: number,
  medianas: ReadonlyMap<string, number> = new Map(),
  fuera: VecesFuera = () => 0,
): Comprobaciones {
  const deReglas: (BloqueoConBarrera & BloqueoConCoste)[] = bloqueosDe(e, medianas).map((b) => conBarrera(b, fuera));
  const fases = fasesDe(e, deReglas);
  const cierre = horaInternaCierre(e.licitacion.fecha_limite, margenHoras);
  // Los hitos salen de las fases, así que sus filas van después y no las mueven; sí cuentan en el veredicto.
  const hitos = e.oportunidad?.estado === 'en_preparacion' ? hitosDe(cierre, fases, e.ahoraMs) : [];
  const deHitos = bloqueosDeHitos(hitos).map((b) => minutosMedidos(conEstado(b, e.guardados.get(b.clave)), medianas));
  const bloqueos: (BloqueoConBarrera & BloqueoConCoste)[] = ordenarBloqueos([...deReglas, ...deHitos]);
  const v = veredicto(e, bloqueos, fases);
  // Toda la cadena que falta (cada fase sin hacer lleva su run) con las duraciones reales, como la Mesa.
  const limite = limiteParaDecidir(cierre, fasesPendientesDeHermes(fases), e.duraciones);
  return {
    id: e.id,
    veredicto: v,
    hora_interna_cierre: cierre ?? '',
    limite_decidir: limite,
    limite_suavizar: limiteSuavizar(cierre, bloqueos, e.ronda_memoria_min ?? null),
    minutos_persona: minutosPersona(bloqueos),
    bloqueos,
    comprobado: comprobadoDe(e, bloqueos),
    fases,
    hitos,
    hermes: hermesEnVivo(e),
    version: huellaDe(
      v,
      bloqueos.map((b) => [b.clave, b.gravedad, b.estado, b.huella, ...(b.barrera ? [b.barrera.veces_fuera] : [])]),
      fases,
      hitos.map((h) => [h.clave, h.fecha, h.estado]),
    ),
  };
}

/**
 * Las comprobaciones de unas entradas ya leídas con lo que lee de la base (minutos medidos y veces fuera):
 * la usan comprobacionesDe, el MCP de la oferta y «Hoy», para que los tres digan lo mismo.
 */
export const comprobacionesDeEntradas = (db: Db, e: EntradasComprobaciones): Comprobaciones =>
  componerComprobaciones(
    e,
    nucleo().config.licitaciones.margenFirmaHoras,
    medianasVigentes(db),
    vecesFueraDe(db, e.id),
  );

/** Qué impide presentar una oferta, sin escribir nada. not_found si la licitación no existe. */
export function comprobacionesDe(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs: number = Date.now(),
): Result<Comprobaciones> {
  const e = leerEntradasComprobaciones(db, dbNucleo, id, ahoraMs);
  if (e.error) return e;
  return ok(comprobacionesDeEntradas(db, e.data));
}

// ── Lo que promete la memoria ──

// Lo que llevó cada anexo rellenado, dato a dato (el valor de la hoja o, sin él, lo que se escribió).
function anexosDe(e: EntradasComprobaciones): DatoAnexo[] {
  return e.documentos.filas.flatMap((f) => {
    const plan = leerPlan(f.sustituciones);
    if (!plan) return [];
    if (plan.formato === 'docx')
      return plan.items.map((x) => ({ clave: f.clave, dato: x.dato, valor: x.valor ?? x.nuevo }));
    return plan.campos
      .filter((c) => typeof c.valor === 'string')
      .map((c) => ({ clave: f.clave, dato: c.dato, valor: c.valor_hoja ?? String(c.valor) }));
  });
}

function entradaCompromisos(e: EntradasComprobaciones, m: MemoriaEvaluada): EntradaCompromisos | null {
  const { memoria, textos } = m;
  // Lo que promete la presentada ya está entregado: no hay nada que revisar.
  if (!memoria || memoria.presentada || !e.guion || !textos.length) return null;
  const nombres = new Map(e.personas.map((p) => [p.id, p.nombre]));
  const p = e.propuesta;
  return {
    textos,
    compromisos: memoria.apartados.flatMap((a) => a.compromisos.map((c) => ({ apartado: a.apartado, ...c }))),
    decisiones: e.decisiones?.datos ?? null,
    personas: [...nombres.values()],
    guion: e.guion.datos,
    anexos: anexosDe(e),
    nombresEquipo: (e.decisiones?.datos.equipo ?? []).flatMap((m) => nombres.get(m.persona_id) ?? []),
    plazos: (e.ficha?.datos.hitos ?? []).map((h) => ({
      texto: [h.hito, h.detalle].filter(Boolean).join(': '),
      pagina: h.pagina ?? null,
    })),
    noPrometer: p ? noPrometerDe([p.datos.enfoque, p.datos.resumen, ...p.avisos]) : [],
  };
}

const TITULO_CHOQUE: Record<TipoChoque, (n: number, que: string, esperado: string) => string> = {
  persona_fuera: (n, que) =>
    `La memoria nombra en el apartado ${n} a ${que}, que no está en el equipo de las decisiones`,
  plazo_guion: (n, que, esperado) => `El apartado ${n} de la memoria pone ${que} y el pliego dice «${esperado}»`,
  automatico_no_acogido: (n, que) =>
    `El apartado ${n} de la memoria promete ${que}, de un criterio automático al que no nos acogemos`,
  no_prometer: (n, que) => `El apartado ${n} de la memoria promete ${que}, y Hermes dijo no prometerlo`,
  anexo_distinto: (n, que, esperado) => `El apartado ${n} de la memoria dice ${que} y el anexo lleva ${esperado}`,
};

// Una fila por apartado y tipo (y lote, con memoria por lote: «-l<lote>»); la cita es la primera
// frase. Riesgo y nunca impide: son sospechas.
function filaPromete(m: MemoriaEvaluada, cs: Choque[]): Bloqueo {
  const { apartado, tipo, cita, esperado } = cs[0]!;
  const que = [...new Set(cs.map((c) => `«${c.encontrado}»`))].join(', ');
  const lote = m.lote;
  return {
    clave: `memoria_promete:${apartado}:${tipo}${lote ? `-l${lote}` : ''}`,
    categoria: 'coherencia',
    lote,
    gravedad: 'riesgo',
    titulo: sinImportes(`${TITULO_CHOQUE[tipo](apartado, que, esperado)}${lote ? ` (memoria del lote ${lote})` : ''}`),
    cita: {
      documento: `Memoria v${m.memoria?.version ?? ''}, apartado ${apartado}`,
      pagina: null,
      texto: cita,
      comprobada: false,
    },
    actor: 'tu',
    accion: { tipo: 'revisar_memoria', destino: `memoria.apartado.${apartado}` },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.revisar_memoria,
    estado: 'abierto',
    huella: huellaDe('memoria_promete', m.memoria?.id ?? null, cs),
  };
}

// Una marca que ya es fuga entre sobres tiene su fila (impide): no se repite como riesgo.
const yaEsFuga = (m: MemoriaEvaluada, c: Choque): boolean =>
  c.tipo === 'automatico_no_acogido' &&
  (m.fugas?.hallazgos ?? []).some(
    (f) => f.apartado === c.apartado && textoComparable(f.marca) === textoComparable(c.encontrado),
  );

function prometeDe(e: EntradasComprobaciones, m: MemoriaEvaluada): Bloqueo[] {
  const entrada = entradaCompromisos(e, m);
  if (!entrada) return [];
  const grupos = new Map<string, Choque[]>();
  for (const c of coherenciaCompromisos(entrada).filter((x) => !yaEsFuga(m, x))) {
    const k = `${c.apartado}:${c.tipo}`;
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  return [...grupos.values()].map((cs) => filaPromete(m, cs));
}

// Con memoria por lote, lo que promete la de cada lote (memoriasDeTrabajo).
function reglaMemoriaPromete(e: EntradasComprobaciones): Bloqueo[] {
  return memoriasDeTrabajo(e).flatMap((m) => prometeDe(e, m));
}

// ── Lo que el anexo pide decidir ──

const TITULO_DATO: Record<DatoDelAnexo, string> = {
  subcontratacion_servidores: 'El anexo pide si subcontratas los servidores o servicios asociados',
  orden_lotes: 'El anexo pide el orden de preferencia de los lotes',
  impuesto: 'Decide el impuesto de la oferta (IVA, IGIC o exento) y su tipo',
};
// Mismo umbral que el precio (comprobacionesReglasDecisiones.ts): a menos de 5 días, sin decidir ya no da tiempo.
const DIAS_PARA_IMPEDIR = 5;
function filaDato(p: DatoPedido, gravedad: Gravedad): Bloqueo {
  return {
    clave: `dato_anexo:-:${p.dato}`,
    categoria: 'decisiones',
    lote: null,
    gravedad,
    titulo: TITULO_DATO[p.dato],
    cita: { ...p.cita, comprobada: false },
    actor: 'tu',
    accion: { tipo: 'campo', destino: `decisiones.datos_anexo.${p.dato}` },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.campo,
    estado: 'abierto',
    huella: huellaDe('dato_anexo', p.dato, gravedad, p.cita.texto),
  };
}

/** Una fila «tú» por dato que el anexo pide y aún no está decidido. Riesgo; impide a menos de 5 días del plazo. */
export function reglaDatosAnexo(e: EntradasComprobaciones): Bloqueo[] {
  if (!e.guion) return [];
  const dias = diasHastaPlazo(e.licitacion.fecha_limite, e.ahoraMs);
  const gravedad: Gravedad = dias !== null && dias < DIAS_PARA_IMPEDIR ? 'impide' : 'riesgo';
  return datosQuePide(e.guion.datos, textosDeDocumentos(e.documentos.filas))
    .filter((p) => !datoDecidido(e.decisiones?.datos, p.dato))
    .map((p) => filaDato(p, gravedad));
}

// ── Lo que se entrega solo si proponen a la empresa como adjudicatarios ──

/** Una fila «tú» por documento de adjudicación del guion, solo con la oferta ya presentada: antes no hay nada que hacer. */
export function reglaAdjudicacion(e: EntradasComprobaciones): Bloqueo[] {
  if (e.oportunidad?.estado !== 'presentada' || !e.guion) return [];
  return (e.guion.datos.documentos_adjudicacion ?? []).map((d) => ({
    clave: claveBloqueo('adjudicacion', null, d.nombre),
    categoria: 'documentos',
    lote: null,
    gravedad: 'riesgo',
    titulo: sinImportes(`Si nos proponen: ${d.nombre} (${d.cuando})`),
    cita: { documento: d.documento, pagina: d.pagina, texto: d.nombre, comprobada: false },
    actor: 'tu',
    accion: { tipo: 'preparar_documento', destino: 'documentos' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.preparar_documento,
    estado: 'abierto',
    huella: huellaDe('adjudicacion', d),
  }));
}

// ── Extensión y anonimato de la memoria ──

function filaMemoria(e: EntradasComprobaciones, m: EstadoMemoria, f: FilaMemoria): Bloqueo {
  const documento = `Memoria v${m.version}`;
  return {
    clave: f.clave,
    categoria: 'coherencia',
    lote: f.lote,
    gravedad: f.gravedad,
    titulo: `${f.titulo}. ${f.detalle}`,
    cita: f.cita
      ? {
          documento: e.guion?.datos.memoria?.documento ?? documento,
          pagina: e.guion?.datos.memoria?.pagina ?? null,
          texto: f.cita,
          comprobada: false,
        }
      : null,
    actor: 'tu',
    accion: { tipo: 'revisar_memoria', destino: 'memoria' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION.revisar_memoria,
    estado: 'abierto',
    huella: huellaDe(f.clave, m.id, f.detalle),
  };
}

// Con memoria por lote, una fila por lote (la clave lleva «-l<lote>»): la que cuenta de cada uno.
function reglasMemoriaComprobaciones(e: EntradasComprobaciones): Bloqueo[] {
  const cita = e.guion?.datos.memoria?.limite_detalle ?? null;
  return memoriasEvaluadas(e).flatMap(({ memoria, lote }) =>
    memoria ? reglasDeMemoria({ ...memoria, lote }, cita).map((f) => filaMemoria(e, memoria, f)) : [],
  );
}
