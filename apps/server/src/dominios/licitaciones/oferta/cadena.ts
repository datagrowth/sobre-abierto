// La cadena de la oferta que no se atasca: ficha, guion, propuesta, anexos y memoria según lo que cambie.
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage } from '../../../nucleo/result.js';
import { agenteDeTipo } from '../../../nucleo/colaTipos.js';
import { encolar, trabajoHecho } from '../../../nucleo/trabajos.js';
import { relanzarColgadosDe } from '../../../nucleo/colaRelanzado.js';
import { trabajoEnCurso } from '../../../nucleo/colaConsultas.js';
import { fichasDe, TIPO_FICHA } from '../ficha.js';
import { idsDelAmbito, lotesDeLicitacion } from '../lotes.js';
import { legibilidadDePliegos, listoParaFicha, type ListoParaFicha } from '../pliegosIndice.js';
import { raicesActuales } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { encolarAnexosAuto } from './anexosAuto.js';
import { TIPO_ANEXO } from './anexosTrabajo.js';
import { CAMBIA_REQUISITOS, fichaDeOtrosLotes } from './coherencia.js';
import { decisionesDe } from './decisiones.js';
import { frenoSeguro, type Freno } from './frenoElegibilidad.js';
import { encolarGuionesAuto, guionVigente, huellaDeLotes, pedidaEnDe, pliegosClaveDesde, TIPO_GUION } from './guion.js';
import { TIPO_MEMORIA_ESTRATEGIA } from './estrategia.js';
import { licitacionesConEnsayo, memoriaAutoQueToca, pedirMemoria } from './memoria.js';
import { TIPO_MEMORIA_CRITICA } from './critica.js';
import { TIPO_LECCIONES } from './lecciones.js';
import { TIPO_EVALUACION } from '../propuestas/evaluacion.js';
import { TIPO_MEMORIA_HECHOS } from './parcheHechos.js';
import { DURACION_MIN, guardaPlazo, licitacionesEnPreparacion } from './plazo.js';
import { claveAutoPropuesta, pedirPropuestaDecisiones, TIPO_PROPUESTA_DECISIONES } from './propuestaDecisiones.js';
import { rebasarMemoriasTardias } from './rebase.js';
import { claveDeRonda, quedanRondas, rondaQueToca } from './rondas.js';
import { quedanPropuestasHoy } from './topes.js';

// Para lo que está en preparación y en plazo, encadena lo que cambia con los pliegos y los lotes: una rectificación o aclaración
// bajada después de la ficha, o unos lotes de interés que la ficha no comprobó, piden la ficha
// otra vez; el guion espera a esa ficha (encolarGuionesAuto, guion.ts) y, con el guion nuevo,
// se pide la propuesta de decisiones aunque ya haya decisiones guardadas: queda como propuesta,
// sin tocarlas, y la web la ofrece para cargarla en el formulario. Cada paso va por rondas
// (rondas.ts) y con la guardia de plazo. Si solo se relanzaran el guion y la ficha, la
// propuesta y las decisiones se quedarían antiguas. Además
// relanza los trabajos de la oferta que llevan en marcha más de lo que suele tardar su tipo: es
// el «¿Colgado? Parar y relanzar» de la web sin esperar a que alguien lo vea. Y pide los anexos
// de las decisiones guardadas (anexosAuto.ts) y, con ellas sin problemas, la memoria. La
// memoria y los anexos esperan al freno de elegibilidad (frenoElegibilidad.ts): con un «impide» de
// elegibilidad abierto no se gasta cuota en ellos.

const log = logger('licitaciones');

// Se encadenan según lo que cambie en los pliegos y los lotes.
// Lo que suele tardar un run de cada tipo de la oferta (minutos). Por encima de lo normal, para
// no cortar uno que va bien, y por debajo del máximo de la cola (30 min), para no esperar a que
// el run agote su tiempo cuando Hermes sigue trabajando pero no termina. La estrategia es la
// excepción: tarda 27-30 min y a los 30 se relanzaría una que ya había entregado;
// va con 50, por debajo de su tope propio en la cola.
export const TIEMPO_ESPERADO_MIN: Record<string, number> = {
  [TIPO_FICHA]: 28,
  [TIPO_GUION]: 25,
  [TIPO_PROPUESTA_DECISIONES]: 20,
  [TIPO_ANEXO]: 15,
  // La redacción no está: manda apartados uno a uno (cada uno es su latido) y tiene tope y
  // límite de inactividad propios en la cola (index.ts, 90 y 15 min); por tiempo desde el
  // lanzamiento se pararía un run sano que sigue enviando apartados.
  [TIPO_MEMORIA_ESTRATEGIA]: 50,
  [TIPO_MEMORIA_CRITICA]: 15,
  [TIPO_MEMORIA_HECHOS]: 20,
  [TIPO_EVALUACION]: 20,
  [TIPO_LECCIONES]: 15,
};

// Cuánto sin que el agente llame a ninguna herramienta sobre esa oferta, pasado el tiempo esperado,
// para darlo por colgado: una ficha lenta que sigue leyendo pliegos no se corta.
const LATIDO_MAX_MIN = 10;

export type VueltaCadena = {
  fichas: number;
  guiones: number;
  propuestas: number;
  relanzados: number;
  anexos: number;
  memorias: number;
  frenadas: number;
};
type Legible = (id: string) => ListoParaFicha;
type OpcionesVuelta = { ahoraMs: number; legible: Legible };

/**
 * La clave base de la ficha que hay que rehacer, o null si la vigente sigue valiendo: se hizo
 * para otros lotes que los de interés de ahora o llegó una rectificación o aclaración después
 * (cambian los requisitos). «ficha-auto-<id>-v<ficha>[-l<lotes>][-p<n>]»: una vez por ficha,
 * lotes y documentos nuevos; cae en el rango de las automáticas de pedirFicha y nunca empieza
 * por «-r», que es el de las rondas de encolarFichasAuto.
 */
export function fichaPorRehacer(dbLic: Db, id: string): string | null {
  const ficha = fichasDe(dbLic, id).aprobada;
  const l = lotesDeLicitacion(dbLic, id);
  if (!ficha || !l) return null;
  const otrosLotes = fichaDeOtrosLotes(ficha.datos, idsDelAmbito(l.ambito));
  const pliegos = pliegosClaveDesde(
    dbLic,
    id,
    pedidaEnDe(dbLic, ficha.trabajo_id, ficha.creada_en),
    CAMBIA_REQUISITOS,
  ).length;
  if (!otrosLotes && !pliegos) return null;
  const lotes = otrosLotes ? huellaDeLotes(dbLic, id) : null;
  return `ficha-auto-${id}-v${ficha.id}${lotes ? `-l${lotes}` : ''}${pliegos ? `-p${pliegos}` : ''}`;
}

// Tiene que dar tiempo a la ficha y al guion que va detrás; si no, el guion sale con la ficha que hay.
const daTiempoFicha = (dbLic: Db, id: string, ahoraMs: number): boolean =>
  !guardaPlazo(dbLic, id, 'ficha', { ahoraMs, duracionMin: DURACION_MIN.ficha + DURACION_MIN.guion }).error;

/** Pide otra vez la ficha de lo que la tiene desfasada (si se puede leer y da tiempo). Devuelve cuántas. */
function rehacerFichas(dbNucleo: DbNucleo, dbLic: Db, ids: string[], op: OpcionesVuelta): number {
  let n = 0;
  for (const id of ids) {
    const base = fichaPorRehacer(dbLic, id);
    const ronda = base === null ? null : rondaQueToca(dbNucleo, base, op.ahoraMs);
    if (base === null || ronda === null || trabajoEnCurso(dbLic, TIPO_FICHA, id)) continue;
    if (op.legible(id) !== 'listo' || !daTiempoFicha(dbLic, id, op.ahoraMs)) continue;
    encolar(dbNucleo, {
      tipo: TIPO_FICHA,
      dominio: 'licitaciones',
      clave: claveDeRonda(base, ronda),
      payload: { id, pedida_en: new Date(op.ahoraMs).toISOString() },
    });
    log.info('ficha pedida otra vez: pliegos o lotes nuevos', { licitacion: id, ronda });
    n += 1;
  }
  return n;
}

/**
 * ¿Espera el guion a una ficha nueva? Sí mientras esté en curso (y dé tiempo) o mientras la
 * desfasada se vaya a pedir (o a reintentar). No si no se puede leer, si no da tiempo, si se
 * gastaron sus rondas o si alguien la canceló: entonces el guion sale con la ficha que hay, que es mejor que ninguno.
 */
export function esperaFicha(dbNucleo: DbNucleo, dbLic: Db, id: string, op: OpcionesVuelta): boolean {
  if (trabajoEnCurso(dbLic, TIPO_FICHA, id)) return daTiempoFicha(dbLic, id, op.ahoraMs);
  const base = fichaPorRehacer(dbLic, id);
  return (
    base !== null && quedanRondas(dbNucleo, base) && op.legible(id) === 'listo' && daTiempoFicha(dbLic, id, op.ahoraMs)
  );
}

// La ronda de la propuesta automática que toca para el guion vigente; null si no hace falta:
// sin guion, con las decisiones ya guardadas sobre este guion, con propuesta para este guion o
// con una propuesta, una ficha o un guion en curso (la propuesta irá sobre el guion que traigan).
// Las decisiones guardadas sobre un guion anterior no la frenan: la propuesta no las pisa.
function rondaDePropuesta(dbNucleo: DbNucleo, dbLic: Db, id: string, ahoraMs: number): number | null {
  const guion = guionVigente(dbLic, id);
  if (!guion || decisionesDe(dbLic, id)?.guion_id === guion.id) return null;
  const propuesta = dbLic.prepare('SELECT guion_id FROM propuestas_decisiones WHERE licitacion_id = ?').get(id) as
    { guion_id: number } | undefined;
  const enCurso = [TIPO_PROPUESTA_DECISIONES, TIPO_GUION, TIPO_FICHA].some((t) => trabajoEnCurso(dbLic, t, id));
  if (propuesta?.guion_id === guion.id || enCurso) return null;
  return rondaQueToca(dbNucleo, claveAutoPropuesta(id, guion.id), ahoraMs);
}

/** Vuelve a pedir las propuestas de decisiones automáticas que faltan (si da tiempo y queda tope hoy). Devuelve cuántas. */
export function repedirPropuestas(dbNucleo: DbNucleo, dbLic: Db, ids: string[], ahoraMs = Date.now()): number {
  let n = 0;
  for (const id of ids) {
    const ronda = rondaDePropuesta(dbNucleo, dbLic, id, ahoraMs);
    if (ronda === null) continue;
    if (!quedanPropuestasHoy(dbNucleo, id, ahoraMs)) {
      log.info('propuesta automática no pedida: tope del día', { licitacion: id });
      continue;
    }
    if (pedirPropuestaDecisiones(dbNucleo, dbLic, id, false, { ronda, ahoraMs }).error) continue;
    log.info('propuesta de decisiones pedida sola', { licitacion: id, ronda });
    n += 1;
  }
  return n;
}

type EnMarcha = {
  trabajo: number;
  tipo: string;
  id: string;
  expediente: string | null;
  lanzado_en: string | null;
  error: string | null;
};

/**
 * La última llamada del agente del tipo a una herramienta sobre esta oferta desde `desde`
 * (ms), o null. El recurso de la auditoría es el id, «id#algo» o una ruta con el expediente
 * (biblioteca_leer); las llamadas sobre otra licitación no cuentan. El expediente se compara por
 * tramos enteros de la ruta: «2026/1» no casa con «…/2026/10/…».
 */
export function ultimoLatido(
  dbLic: Db,
  agente: string,
  t: Pick<EnMarcha, 'id' | 'expediente'>,
  desde: string,
): number | null {
  const u = dbLic
    .prepare(
      `SELECT MAX(creado_en) AS u FROM nucleo.auditoria_agentes WHERE agente = ? AND creado_en >= ?
    AND (recurso = ? OR substr(recurso, 1, length(?) + 1) = ? || '#' OR instr('/' || recurso || '/', '/' || ? || '/') > 0)`,
    )
    .get(agente, desde, t.id, t.id, t.id, t.expediente || null) as { u: string | null };
  return u.u ? Date.parse(u.u) : null;
}

// Colgado: pasó lo que suele tardar su tipo y el agente lleva LATIDO_MAX_MIN sin tocar nada de
// esta oferta (o, sin latido, desde que se lanzó). El tope de relanzamientos vive en la cola.
function colgado(dbLic: Db, t: EnMarcha, ahoraMs: number): boolean {
  if (t.lanzado_en === null) return false;
  const lanzado = Date.parse(t.lanzado_en);
  if (lanzado >= ahoraMs - (TIEMPO_ESPERADO_MIN[t.tipo] ?? 0) * 60_000) return false;
  const agente = agenteDeTipo(t.tipo);
  const latido = agente ? ultimoLatido(dbLic, agente, t, t.lanzado_en) : null;
  return Math.max(lanzado, latido ?? 0) < ahoraMs - LATIDO_MAX_MIN * 60_000;
}

// Los trabajos de la oferta en marcha de estas licitaciones, por tipo y licitación. Va por dbLic:
// ve el núcleo (adjuntado) y la tabla de licitaciones, de donde sale el expediente.
function enMarchaPorGrupo(dbLic: Db, ids: string[]): EnMarcha[][] {
  const tipos = Object.keys(TIEMPO_ESPERADO_MIN);
  const filas = dbLic
    .prepare(
      `SELECT t.id AS trabajo, t.tipo, json_extract(t.payload, '$.id') AS id, l.expediente, t.lanzado_en, t.error
    FROM nucleo.trabajos_ia t LEFT JOIN licitaciones l ON l.id = json_extract(t.payload, '$.id')
    WHERE t.estado = 'lanzado' AND t.tipo IN (${tipos.map(() => '?').join(', ')})`,
    )
    .all(...tipos) as EnMarcha[];
  const vivas = new Set(ids);
  const grupos = new Map<string, EnMarcha[]>();
  for (const f of filas) {
    if (!vivas.has(f.id)) continue;
    const k = `${f.tipo}
${f.id}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  return [...grupos.values()];
}

/**
 * Relanza (para su run y vuelve a la cola gastando un intento) los trabajos de la oferta de
 * estas licitaciones colgados (sin gastar intento hasta el tope de la cola). relanzarColgadosDe actúa sobre todos los que están en marcha de
 * ese tipo y licitación, así que solo se hace si todos están colgados: nunca corta uno que va
 * bien. Tampoco si alguno ya entregó lo suyo (su `hecho`) y la cola aún no lo ha dado por
 * completado: la vuelta normal de la cola lo completa; relanzarlo gastaría otro run entero. No
 * quita el freno del tipo ni toca los pendientes: eso lo hace solo una persona.
 */
export function relanzarColgados(dbNucleo: DbNucleo, dbLic: Db, ids: string[], ahoraMs = Date.now()): number {
  let n = 0;
  for (const g of enMarchaPorGrupo(dbLic, ids)) {
    if (!g.every((t) => colgado(dbLic, t, ahoraMs)) || g.some((t) => trabajoHecho(dbNucleo, t.trabajo))) continue;
    const { tipo, id } = g[0]!;
    log.warn('trabajo de la oferta colgado: se relanza', { licitacion: id, tipo });
    n += relanzarColgadosDe(dbNucleo, tipo, id);
  }
  return n;
}

// La última huella del freno anotada por oferta: el log sale una vez por oferta y por motivo, no en cada vuelta.
const frenosAnotados = new Map<string, string>();

function anotarFreno(id: string, f: Freno): void {
  const huella = f.bloqueos
    .map((b) => b.clave)
    .sort()
    .join('|');
  if (frenosAnotados.get(id) === huella) return;
  frenosAnotados.set(id, huella);
  log.info('freno de elegibilidad: no se pide memoria ni anexos', {
    licitacion: id,
    bloqueos: huella.replaceAll('|', ', '),
  });
}

/** Las ofertas frenadas por elegibilidad (frenoElegibilidad.ts) de estas, una vez por vuelta. */
export function ofertasFrenadas(
  dbNucleo: DbNucleo,
  dbLic: Db,
  ids: readonly string[],
  ahoraMs = Date.now(),
): Set<string> {
  const frenadas = new Set<string>();
  for (const id of ids) {
    const f = frenoSeguro(dbLic, dbNucleo, id, ahoraMs);
    if (!f.frenada) {
      frenosAnotados.delete(id);
      continue;
    }
    anotarFreno(id, f);
    frenadas.add(id);
  }
  return frenadas;
}

// Con una ficha o un guion en camino, la memoria irá sobre el guion que traigan.
const esperaGuion = (dbLic: Db, id: string): boolean =>
  [TIPO_GUION, TIPO_FICHA].some((t) => trabajoEnCurso(dbLic, t, id));

type OpcionesMemorias = { ahoraMs: number; frenadas: ReadonlySet<string> };

// Una oferta que lanza (SQLITE_BUSY, una clave repetida) no deja sin memoria ni anexos a las demás de la vuelta.
function pedirMemoriaAuto(dbNucleo: DbNucleo, dbLic: Db, id: string, op: OpcionesMemorias): boolean {
  try {
    rebasarMemoriasTardias(dbLic, id);
    if (op.frenadas.has(id) || esperaGuion(dbLic, id) || !memoriaAutoQueToca(dbLic, dbNucleo, id)) return false;
    const r = pedirMemoria(dbNucleo, dbLic, nucleo().config.salidasDir, id, { automatica: true, ahoraMs: op.ahoraMs });
    // En debug: sin tiempo, se repetiría en cada vuelta.
    if (r.error) {
      log.debug('memoria automática no pedida', { licitacion: id, motivo: r.error.code });
      return false;
    }
    log.info('memoria pedida sola tras las decisiones', {
      licitacion: id,
      version: r.data.version,
    });
    return true;
  } catch (err) {
    log.error('memoria automática sin pedir: error al crearla', { licitacion: id, error: errorMessage(err) });
    return false;
  }
}

/**
 * Pide sola la memoria de las ofertas no frenadas a las que les toca (memoriaAutoQueToca), por el
 * camino de una persona pero como automática: la guardia de plazo rechaza en vez de avisar y, si
 * la memoria no cabe, no se pide. Antes pasa al guion vigente las memorias que se
 * ensamblaron después de que llegara, si sus cambios no las tocan. Devuelve cuántas pidió.
 */
function pedirMemoriasAuto(dbNucleo: DbNucleo, dbLic: Db, ids: readonly string[], op: OpcionesMemorias): number {
  return ids.filter((id) => pedirMemoriaAuto(dbNucleo, dbLic, id, op)).length;
}

/**
 * Una vuelta de la cadena sobre lo que está en preparación y en plazo, en su orden: fichas
 * desfasadas, guiones (que esperan a esas fichas), propuestas, trabajos colgados, memorias y
 * anexos (estos dos, salvo en las frenadas por elegibilidad). Los colgados, también los de una
 * memoria de ensayo, que se redacta con el plazo ya vencido.
 */
export function vueltaCadena(dbNucleo: DbNucleo, dbLic: Db, ahoraMs = Date.now(), legible?: Legible): VueltaCadena {
  const ids = licitacionesEnPreparacion(dbLic, ahoraMs).map((l) => l.id);
  const op = { ahoraMs, legible: legible ?? ((id: string) => listoParaFicha(legibilidadDePliegos(dbLic, id))) };
  const fichas = rehacerFichas(dbNucleo, dbLic, ids, op);
  const guiones = encolarGuionesAuto(dbNucleo, dbLic, ahoraMs, {
    legible: op.legible,
    esperaFicha: (id) => esperaFicha(dbNucleo, dbLic, id, op),
  });
  const propuestas = repedirPropuestas(dbNucleo, dbLic, ids, ahoraMs);
  const relanzados = relanzarColgados(
    dbNucleo,
    dbLic,
    [...new Set([...ids, ...licitacionesConEnsayo(dbLic)])],
    ahoraMs,
  );
  const frenadas = ofertasFrenadas(dbNucleo, dbLic, ids, ahoraMs);
  const memorias = pedirMemoriasAuto(dbNucleo, dbLic, ids, { ahoraMs, frenadas });
  const anexos = encolarAnexosAuto(dbNucleo, dbLic, ahoraMs, raicesActuales(), { omitir: frenadas });
  return { fichas, guiones, propuestas, relanzados, anexos, memorias, frenadas: frenadas.size };
}
