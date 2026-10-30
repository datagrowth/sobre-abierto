// Máquina de estados pura de las fases de la memoria técnica (docs/como-esta-hecho/memoria-tecnica.md).
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { encolar } from '../../../nucleo/trabajos.js';
import type { Db } from '../store.js';
import { coherenciaDeMemoria } from './coherenciaMemoria.js';
import { TIPO_MEMORIA_CRITICA, type PayloadCriticaData } from './critica.js';
import { componerDossier, guardarDossier } from './dossier.js';
import { filaMemoria, type FilaMemoria } from './ensamblado.js';
import { estrategiaDe, TIPO_MEMORIA_ESTRATEGIA, type PayloadEstrategiaData } from './estrategia.js';
import { abrirFicha, estadoFicha, fichaDe, vencerFicha, type EstadoFicha } from './fichaSolucion.js';
import {
  claveDeFase,
  faseDe,
  FASES_CON_TRABAJO,
  FASES_MEMORIA,
  type FaseConTrabajo,
  type FaseMemoria,
} from './fasesMemoria.js';
import {
  parcheDe,
  saltarParche,
  TIPO_MEMORIA_HECHOS,
  type EstadoParche,
  type PayloadHechosData,
} from './parcheHechos.js';
import { TIPO_MEMORIA_REDACCION, type PayloadRedaccionData } from './redaccion.js';
import { claveDeRonda, REINTENTO_RONDA_MS, RONDAS } from './rondas.js';
import { anadirAvisos, decidirYAplicar, finalizarMemoria, recuperarApartadosConTexto } from './rondasMemoria.js';
import { memoriaConTiempo } from './plazo.js';

// El código compone el dossier (todo lo que hace falta para escribirla), Hermes
// piensa la estrategia (temas, estructura, mapa criterio → sección y hoja de hechos), redacta la
// memoria entera en un run, el código comprueba la coherencia con la hoja de hechos, un crítico
// ciego la puntúa y, si no llega al umbral, los apartados flojos se reescriben en rondas. Entre la
// estrategia y la redacción, una persona revisa la ficha de solución (fichaSolucion.ts): la
// redacción espera su aprobación hasta 24 h; en una memoria de ensayo no espera. Si el crítico
// cita el valor de un hecho, entre la crítica y la reescritura se corrigen esos hechos (fase
// «hechos», parcheHechos.ts).
// Una máquina de estados pura (siguientePaso) decide la acción; la aplican la vuelta de la
// oferta y la llegada de cada resultado, así que nada se queda parado si se pierde un evento.

const log = logger('licitaciones');

export { claveDeFase } from './fasesMemoria.js';

// La memoria pasa por fases (dossier, estrategia, ficha, redacción, coherencia, crítica y rondas) y esta máquina
// decide la siguiente.
// El trabajo de IA de la fase en curso, con sus rondas de reintento (rondas.ts): `reintento` es
// la ronda que toca pedir ya; `agotado`, que no quedan (o alguien lo canceló).
export type TrabajoFase = {
  estado: 'ninguno' | 'en_curso' | 'hecho' | 'fallido';
  reintento: number | null;
  agotado: boolean;
};

export type EstadoAvance = {
  fase: FaseMemoria;
  // Lo que ya existe: el dossier, la estrategia de esta memoria y la crítica de la ronda en curso.
  dossier: boolean;
  estrategia: boolean;
  critica: boolean;
  pendientes: number;
  recibidos: number;
  trabajo: TrabajoFase;
  // ¿Da tiempo a reintentar el trabajo de esta fase antes del plazo de la oferta?
  plazo: boolean;
  // La ficha de solución (vencida: pendiente con su plazo pasado) y si es de ensayo (no espera).
  ficha: EstadoFicha;
  ensayo: boolean;
  // El parche de hechos de la ronda en curso.
  parche: 'ninguno' | EstadoParche;
};

export type AccionAvance =
  | { tipo: 'componer_dossier' }
  // aviso: lo que se salta para llegar a tiempo (va a los avisos de la memoria).
  | { tipo: 'pasar'; fase: FaseMemoria; aviso?: string }
  | { tipo: 'encolar'; reintento: number }
  | { tipo: 'cerrar_redaccion' }
  | { tipo: 'decidir_ronda' }
  | { tipo: 'ensamblar'; aviso: string | null }
  // La ficha de solución se cierra sin revisar (24 h o sin tiempo antes del plazo) y se redacta con lo propuesto.
  | { tipo: 'vencer_ficha'; sinPlazo: boolean }
  // El parche de hechos no llegó (o no da tiempo): la ronda se reescribe con la hoja como estaba.
  | { tipo: 'saltar_parche'; aviso: string }
  | { tipo: 'fallar'; motivo: string }
  | { tipo: 'esperar' };

const ESPERAR: AccionAvance = { tipo: 'esperar' };

// Lo común a las fases con trabajo de IA: pedirlo, esperarlo o reintentarlo por rondas.
function porTrabajo(t: TrabajoFase, siAgota: AccionAvance): AccionAvance {
  if (t.estado === 'ninguno') return { tipo: 'encolar', reintento: 0 };
  if (t.estado !== 'fallido') return ESPERAR;
  if (t.reintento !== null) return { tipo: 'encolar', reintento: t.reintento };
  return t.agotado ? siAgota : ESPERAR;
}

// La redacción reintentada vuelve a pedir solo lo que falta; agotada, la memoria sigue con lo
// que llegó (los apartados fallidos salen marcados en el Word), o falla si no llegó nada.
function pasoRedaccion(e: EstadoAvance): AccionAvance {
  const conLoQueHay: AccionAvance =
    e.recibidos > 0
      ? { tipo: 'cerrar_redaccion' }
      : { tipo: 'fallar', motivo: 'La redacción falló en todas sus rondas y no llegó ningún apartado.' };
  if (e.trabajo.estado === 'fallido') return e.plazo ? porTrabajo(e.trabajo, conLoQueHay) : conLoQueHay;
  if (e.pendientes === 0) return conLoQueHay;
  return porTrabajo(e.trabajo, conLoQueHay);
}

// Sin tiempo para reintentar, la estrategia que falló se salta (la redacción sigue la rúbrica):
// una memoria sin plan es mejor que ninguna al llegar el plazo.
function pasoEstrategia(e: EstadoAvance): AccionAvance {
  if (e.estrategia) return { tipo: 'pasar', fase: 'ficha' };
  if (e.trabajo.estado === 'fallido' && !e.plazo)
    return {
      tipo: 'pasar',
      fase: 'redaccion',
      aviso:
        'No daba tiempo a reintentar la estrategia antes del plazo: la memoria se redactó sin ella, siguiendo la rúbrica.',
    };
  return porTrabajo(e.trabajo, { tipo: 'fallar', motivo: 'La estrategia de la memoria falló en todas sus rondas.' });
}

// La redacción espera a que una persona apruebe la ficha; si pasan 24 h o ya no da tiempo antes
// del plazo, sigue con lo propuesto (marcado como no revisado). Sin ficha (ensayo, o una
// estrategia sin solución) no hay nada que esperar.
function pasoFicha(e: EstadoAvance): AccionAvance {
  if (e.ensayo || e.ficha === 'ninguna' || e.ficha === 'aprobada') return { tipo: 'pasar', fase: 'redaccion' };
  if (e.ficha === 'vencida') return { tipo: 'vencer_ficha', sinPlazo: false };
  return e.plazo ? ESPERAR : { tipo: 'vencer_ficha', sinPlazo: true };
}

// Igual con la crítica: el texto ya está escrito, así que se ensambla sin ella.
function pasoCritica(e: EstadoAvance): AccionAvance {
  if (e.critica) return { tipo: 'decidir_ronda' };
  if (e.trabajo.estado === 'fallido' && !e.plazo)
    return {
      tipo: 'ensamblar',
      aviso: 'No daba tiempo a reintentar la crítica antes del plazo: se ensambló sin ella.',
    };
  return porTrabajo(e.trabajo, {
    tipo: 'ensamblar',
    aviso: 'La crítica de la memoria falló en todas sus rondas: se ensambla sin ella.',
  });
}

// Sin el parche (agotado o sin tiempo), la ronda se reescribe con la hoja de hechos como estaba:
// es lo que se hacía antes, y los apartados ya esperan pendientes.
function pasoHechos(e: EstadoAvance): AccionAvance {
  if (e.parche !== 'pendiente') return { tipo: 'pasar', fase: 'redaccion' };
  const saltar = (porque: string): AccionAvance => ({
    tipo: 'saltar_parche',
    aviso: `${porque}: la ronda se reescribió sin corregir los hechos que citaba el crítico.`,
  });
  if (e.trabajo.estado === 'fallido' && !e.plazo)
    return saltar('No daba tiempo a reintentar la corrección de hechos antes del plazo');
  return porTrabajo(e.trabajo, saltar('La corrección de hechos falló en todas sus rondas'));
}

/** La acción que toca para una memoria en su estado actual (pura). */
export function siguientePaso(e: EstadoAvance): AccionAvance {
  switch (e.fase) {
    case 'dossier':
      return e.dossier ? { tipo: 'pasar', fase: 'estrategia' } : { tipo: 'componer_dossier' };
    case 'estrategia':
      return pasoEstrategia(e);
    case 'ficha':
      return pasoFicha(e);
    case 'redaccion':
      return pasoRedaccion(e);
    case 'critica':
      return pasoCritica(e);
    case 'hechos':
      return pasoHechos(e);
    case 'fin':
      return ESPERAR;
  }
}

// ── Estado desde la base ──

/** El trabajo de una fase y sus reintentos, como lo necesita siguientePaso. */
export function trabajoDeFase(dbNucleo: DbNucleo, base: string, ahoraMs = Date.now()): TrabajoFase {
  const filas = dbNucleo
    .prepare(
      `SELECT estado, actualizado_en FROM trabajos_ia
    WHERE clave = @base OR (clave >= @desde AND clave < @hasta) ORDER BY id DESC`,
    )
    .all({ base, desde: `${base}-r`, hasta: `${base}-s` }) as { estado: string; actualizado_en: string }[];
  const ultima = filas[0];
  if (!ultima) return { estado: 'ninguno', reintento: null, agotado: false };
  if (ultima.estado === 'pendiente' || ultima.estado === 'lanzado')
    return { estado: 'en_curso', reintento: null, agotado: false };
  if (ultima.estado === 'completado') return { estado: 'hecho', reintento: null, agotado: false };
  const agotado = ultima.estado === 'cancelado' || filas.length >= RONDAS;
  const toca = !agotado && Date.parse(ultima.actualizado_en) <= ahoraMs - REINTENTO_RONDA_MS;
  return { estado: 'fallido', reintento: toca ? filas.length : null, agotado };
}

const existe = (db: Db, sql: string, ...args: (string | number)[]): boolean =>
  db.prepare(sql).get(...args) !== undefined;

const TRABAJO_NINGUNO: TrabajoFase = { estado: 'ninguno', reintento: null, agotado: false };

function trabajoActual(dbNucleo: DbNucleo, m: FilaMemoria, fase: FaseMemoria, ahoraMs: number): TrabajoFase {
  if (!FASES_CON_TRABAJO.includes(fase)) return TRABAJO_NINGUNO;
  return trabajoDeFase(dbNucleo, claveDeFase(m, fase as FaseConTrabajo), ahoraMs);
}

/** El estado de una memoria para siguientePaso. */
export function estadoAvance(dbNucleo: DbNucleo, db: Db, m: FilaMemoria, ahoraMs = Date.now()): EstadoAvance {
  const fase = faseDe(m);
  // «recibidos» cuenta los que tienen texto: en una ronda ≥ 1, el que no se devolvió conserva el anterior.
  const cuenta = db
    .prepare(
      `SELECT SUM(estado = 'pendiente') AS pendientes, SUM(estado = 'recibido' OR datos IS NOT NULL) AS recibidos FROM memoria_apartados WHERE memoria_id = ?`,
    )
    .get(m.id) as { pendientes: number | null; recibidos: number | null };
  return {
    fase,
    dossier: existe(db, 'SELECT 1 FROM memoria_dossiers WHERE memoria_id = ?', m.id),
    estrategia: existe(db, 'SELECT 1 FROM memoria_estrategias WHERE memoria_id = ?', m.id),
    critica: existe(db, 'SELECT 1 FROM memoria_criticas WHERE memoria_id = ? AND ronda = ?', m.id, m.ronda),
    pendientes: cuenta.pendientes ?? 0,
    recibidos: cuenta.recibidos ?? 0,
    trabajo: trabajoActual(dbNucleo, m, fase, ahoraMs),
    // Mientras espera la ficha queda por delante casi toda la memoria: se mide como al pedirla.
    plazo: memoriaConTiempo(db, m, fase === 'estrategia' || fase === 'ficha' ? 'memoria' : 'ronda', ahoraMs),
    ficha: estadoFicha(fichaDe(db, m.id), ahoraMs),
    ensayo: m.ensayo === 1,
    parche: parcheDe(db, m.id, m.ronda)?.estado ?? 'ninguno',
  };
}

// ── Aplicar ──

/** Pasa la memoria de una fase a otra; la guardia en el UPDATE impide que dos vueltas la muevan a la vez. */
function pasarFase(db: Db, memoriaId: number, de: FaseMemoria, a: FaseMemoria): boolean {
  return (
    db.prepare("UPDATE memorias SET fase = ? WHERE id = ? AND fase = ? AND estado = 'redactando'").run(a, memoriaId, de)
      .changes === 1
  );
}

function fallarMemoria(db: Db, m: FilaMemoria, motivo: string): void {
  db.prepare("UPDATE memorias SET estado = 'fallida', error = ? WHERE id = ? AND estado = 'redactando'").run(
    motivo,
    m.id,
  );
  log.warn('memoria fallida', { memoria: m.id, version: m.version, fase: m.fase });
}

// El dossier se compone por código; si no se puede guardar (p. ej. sin Salidas), la memoria falla con el motivo.
async function dossier(dbNucleo: DbNucleo, db: Db, m: FilaMemoria): Promise<boolean> {
  const d = await componerDossier(db, dbNucleo, m.id);
  const g = d.error ? d : guardarDossier(db, d.data);
  if (g.error) {
    fallarMemoria(db, m, `No se pudo componer el dossier de la memoria: ${g.error.message}`);
    return false;
  }
  return true;
}

// Cómo se encola el trabajo de cada fase (la clave ya trae la ronda de reintento).
// `aMano`: el primer intento de cada fase levanta el freno de su tipo (lo pidió una persona al pedir
// la memoria; una pedida por un agente o por la cadena sola, marcada por_agente, no lo levanta en
// ninguna fase); los reintentos no, que ya tienen su propio límite de rondas.
type Encolador = (dbNucleo: DbNucleo, db: Db, m: FilaMemoria, clave: string, aMano: boolean) => void;
const ENCOLAR: Partial<Record<FaseConTrabajo, Encolador>> = {
  estrategia: (dbNucleo, _db, m, clave, aMano) => {
    const payload: PayloadEstrategiaData = {
      id: m.licitacion_id,
      memoria_id: m.id,
      version: m.version,
      pedida_en: m.pedida_en,
    };
    encolar(dbNucleo, { tipo: TIPO_MEMORIA_ESTRATEGIA, dominio: 'licitaciones', clave, payload, aMano });
  },
  // Un único trabajo para todos los apartados pendientes: su trabajo_id es el mismo, así que si
  // falla del todo, marcarApartadosFallidos los marca a todos. Al reintentar, lo que falló vuelve
  // a pendiente y la tarea pide solo eso.
  redaccion: (dbNucleo, db, m, clave, aMano) => {
    const payload: PayloadRedaccionData = {
      id: m.licitacion_id,
      memoria_id: m.id,
      guion_id: m.guion_id,
      version: m.version,
      ronda: m.ronda,
      pedida_en: m.pedida_en,
    };
    db.transaction(() => {
      db.prepare(
        "UPDATE memoria_apartados SET estado = 'pendiente', error = NULL WHERE memoria_id = ? AND estado = 'fallido'",
      ).run(m.id);
      const trabajo = encolar(dbNucleo, {
        tipo: TIPO_MEMORIA_REDACCION,
        dominio: 'licitaciones',
        clave,
        payload,
        aMano,
      });
      db.prepare("UPDATE memoria_apartados SET trabajo_id = ? WHERE memoria_id = ? AND estado = 'pendiente'").run(
        trabajo,
        m.id,
      );
    })();
  },
  // Al perfil del crítico si está configurado (independiente); si no, al de oferta, y queda marcado.
  critica: (dbNucleo, _db, m, clave, aMano) => {
    const payload: PayloadCriticaData = {
      id: m.licitacion_id,
      memoria_id: m.id,
      version: m.version,
      ronda: m.ronda,
      pedida_en: m.pedida_en,
      independiente: nucleo().config.hermesCritico !== null,
    };
    encolar(dbNucleo, { tipo: TIPO_MEMORIA_CRITICA, dominio: 'licitaciones', clave, payload, aMano });
  },
  hechos: (dbNucleo, _db, m, clave, aMano) => {
    const payload: PayloadHechosData = {
      id: m.licitacion_id,
      memoria_id: m.id,
      version: m.version,
      ronda: m.ronda,
      pedida_en: m.pedida_en,
    };
    encolar(dbNucleo, { tipo: TIPO_MEMORIA_HECHOS, dominio: 'licitaciones', clave, payload, aMano });
  },
};

function encolarFase(dbNucleo: DbNucleo, db: Db, m: FilaMemoria, reintento: number): false {
  const fase = m.fase as FaseConTrabajo;
  const encolador = ENCOLAR[fase];
  if (encolador)
    encolador(dbNucleo, db, m, claveDeRonda(claveDeFase(m, fase), reintento), reintento === 0 && !m.por_agente);
  return false;
}

// Otra ronda vuelve a la redacción (y se sigue en esta vuelta); si no, se ensambla.
async function decidir(db: Db, m: FilaMemoria): Promise<boolean> {
  const d = decidirYAplicar(db, m);
  if (!d) return false;
  if (d.decision.tipo === 'ronda') return true;
  await finalizarMemoria(db, m, d.decision.aviso ? d.decision.motivo : null);
  return false;
}

function pasar(db: Db, m: FilaMemoria, a: Extract<AccionAvance, { tipo: 'pasar' }>, ahoraMs: number): boolean {
  // La ficha se abre al entrar en su fase: desde ahí cuentan sus 24 h (y un reinicio no las reinicia).
  if (a.fase === 'ficha') abrirFicha(db, m, estrategiaDe(db, m.id)?.datos.solucion, ahoraMs);
  const pasada = pasarFase(db, m.id, m.fase as FaseMemoria, a.fase);
  if (pasada && a.aviso) anadirAvisos(db, m, [a.aviso]);
  return pasada;
}

// En una transacción: cerrar la ficha sin su aviso dejaría valores sin revisar sin marcar.
function vencer(db: Db, m: FilaMemoria, sinPlazo: boolean): boolean {
  return db.transaction(() => {
    const aviso = vencerFicha(db, m.id, sinPlazo);
    const pasada = pasarFase(db, m.id, 'ficha', 'redaccion');
    if (pasada && aviso) anadirAvisos(db, m, [aviso]);
    return pasada;
  })();
}

function saltar(db: Db, m: FilaMemoria, aviso: string): boolean {
  return db.transaction(() => {
    saltarParche(db, m.id, m.ronda);
    const pasada = pasarFase(db, m.id, 'hechos', 'redaccion');
    if (pasada) anadirAvisos(db, m, [aviso]);
    return pasada;
  })();
}

// Aplica una acción. Devuelve si cambió algo (para seguir avanzando en la misma vuelta).
async function aplicar(dbNucleo: DbNucleo, db: Db, m: FilaMemoria, a: AccionAvance, ahoraMs: number): Promise<boolean> {
  switch (a.tipo) {
    case 'componer_dossier':
      return dossier(dbNucleo, db, m);
    case 'pasar':
      return pasar(db, m, a, ahoraMs);
    case 'vencer_ficha':
      return vencer(db, m, a.sinPlazo);
    case 'saltar_parche':
      return saltar(db, m, a.aviso);
    case 'encolar':
      return encolarFase(dbNucleo, db, m, a.reintento);
    case 'cerrar_redaccion':
      recuperarApartadosConTexto(db, m);
      coherenciaDeMemoria(db, m.id);
      return pasarFase(db, m.id, 'redaccion', 'critica');
    case 'fallar':
      fallarMemoria(db, m, a.motivo);
      return false;
    case 'decidir_ronda':
      return decidir(db, m);
    case 'ensamblar':
      await finalizarMemoria(db, m, a.aviso);
      return false;
    default:
      return false;
  }
}

// Como mucho tantos pasos seguidos por memoria y vuelta (dossier → estrategia → … sin esperar).
const MAX_PASOS = FASES_MEMORIA.length;

// Una memoria que se está moviendo ahora (el dossier tarda): otra vuelta o evento no la mueve a la vez.
const moviendo = new Set<number>();

/** Avanza una memoria todo lo que se pueda sin esperar a Hermes. Devuelve la última acción. */
export async function avanzarMemoria(
  dbNucleo: DbNucleo,
  db: Db,
  memoriaId: number,
  ahoraMs = Date.now(),
): Promise<AccionAvance> {
  if (moviendo.has(memoriaId)) return ESPERAR;
  moviendo.add(memoriaId);
  try {
    let accion: AccionAvance = ESPERAR;
    for (let i = 0; i < MAX_PASOS; i += 1) {
      const m = filaMemoria(db, memoriaId);
      if (!m || m.estado !== 'redactando') return ESPERAR;
      accion = siguientePaso(estadoAvance(dbNucleo, db, m, ahoraMs));
      if (!(await aplicar(dbNucleo, db, m, accion, ahoraMs))) return accion;
    }
    return accion;
  } finally {
    moviendo.delete(memoriaId);
  }
}

/**
 * A petición de una persona: ensambla ya una memoria cuyo texto está escrito y espera a la crítica
 * (con lo que haya, restaurando lo que una ronda no devolvió). Responde al reservarla; el
 * documento se monta en segundo plano.
 */
export function ensamblarYa(db: Db, memoriaId: number): Result<{ memoria: number; version: number }> {
  const m = filaMemoria(db, memoriaId);
  if (!m) return fail('not_found', `No hay ninguna memoria con id ${memoriaId}.`);
  if (m.estado !== 'redactando' || faseDe(m) !== 'critica')
    return fail('conflicto', 'Solo se puede ensamblar ya una memoria con el texto escrito que espera a la crítica.');
  void finalizarMemoria(
    db,
    m,
    'Se ensambló sin esperar a que acabaran las rondas de la crítica, a petición de una persona.',
  ).catch((err: unknown) =>
    log.error('memoria sin ensamblar a petición', {
      memoria: m.id,
      clase: err instanceof Error ? err.name : typeof err,
    }),
  );
  return ok({ memoria: m.id, version: m.version });
}

/** Una vuelta sobre todas las memorias que se están redactando. Un fallo en una no para las demás. */
export async function vueltaMemorias(dbNucleo: DbNucleo, db: Db, ahoraMs = Date.now()): Promise<number> {
  const ids = (
    db.prepare("SELECT id FROM memorias WHERE fase IS NOT NULL AND estado = 'redactando' ORDER BY id").all() as {
      id: number;
    }[]
  ).map((f) => f.id);
  for (const id of ids) {
    try {
      await avanzarMemoria(dbNucleo, db, id, ahoraMs);
    } catch (err) {
      log.error('memoria sin avanzar', { memoria: id, clase: err instanceof Error ? err.name : typeof err });
    }
  }
  return ids.length;
}
