// Núcleo de la cola de trabajos de IA (tabla trabajos_ia): encolar, lanzar cada trabajo como un
// run de Hermes, seguirlo hasta que deja su resultado y reintentar o dar por fallido lo que no.
import { ahora, type Db } from './db.js';
import {
  CODIGO_DESFASE,
  esLimite,
  ESPERA_LIMITE,
  esperarHerramienta,
  esperarLimite,
  faltaHerramienta,
  LIMITE_EN_ERROR,
  marcarDesfases,
  pausaHastaMs,
} from './colaEsperas.js';
import { avisarFrenosNuevos, frenoDeVuelta, reanudarTipo } from './colaFrenos.js';
import { aplicarCupos, limiteDeVuelta, MAX_PENDIENTES_VUELTA, porPrioridad } from './colaOrden.js';
import { cancelarZombis, RELANZADO, retenidoEnLaVuelta } from './colaRelanzado.js';
import {
  actualizar,
  avisar,
  esDominioPersonal,
  MAX_INTENTOS,
  obtenerTrabajo,
  tipoDe,
  type Fallo,
  type TipoTrabajo,
  type Trabajo,
} from './colaTipos.js';
import { consultarRun, lanzarRun, pararRun, type DestinoHermes } from './hermes/runs.js';
import { recogerMetricas } from './hermes/metricas.js';
import { logger } from './log.js';

const log = logger('trabajos');
// Runs a la vez de la última vuelta: la hora estimada reparte la espera entre ellos sin leer la config.
let runsALaVez = 2;
// Recorte del error al comparar dos `sin_resultado`: la cola de la salida de Hermes puede variar.
const MISMA_CAUSA_CARACTERES = 300;
const RUN_MAX_MS = 30 * 60_000;
// Un run vivo usa las herramientas de la plataforma cada poco. Si Hermes se reinicia, el run
// muere pero Hermes lo sigue dando «en marcha»: sin ninguna llamada de su agente en este
// tiempo, se da por muerto y se reintenta (antes que esperar al tiempo máximo).
const INACTIVO_MAX_MS = 10 * 60_000;

/** El `id` de un payload sin serializar (la oferta), si lo lleva. */
const idDePayload = (payload: unknown): string | undefined => {
  const id = (payload as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
};

/**
 * Encola un trabajo; si ya hay uno con la misma clave no duplica. Devuelve su id.
 * «aMano» (lo pidió una persona en la web) levanta el freno de su tipo para su oferta (o del tipo
 * entero si no es de ninguna, como la criba).
 */
export function encolar(
  db: Db,
  t: { tipo: string; dominio: string; clave: string; payload: unknown; aMano?: boolean },
): number {
  if (t.aMano) reanudarTipo(db, t.tipo, idDePayload(t.payload));
  db.prepare(
    `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, a_mano)
    VALUES (?, ?, ?, ?, 'pendiente', ?, ?, ?) ON CONFLICT(clave) DO NOTHING`,
  ).run(t.tipo, t.dominio, t.clave, JSON.stringify(t.payload), ahora(), ahora(), t.aMano ? 1 : 0);
  return (db.prepare('SELECT id FROM trabajos_ia WHERE clave = ?').get(t.clave) as { id: number }).id;
}

// Rango `base#`…`base$` ('$' sigue a '#' en ASCII): todas las claves `base#n` de esa base.
const EN_RANGO = `clave >= ? || '#' AND clave < ? || '$'`;

/**
 * Encola por `base` sin duplicar el trabajo que sigue en cola o en marcha (un doble clic encola un
 * solo run); si el anterior ya terminó, crea otro con clave `${base}#${n}`. Síncrona y en una
 * transacción: dos peticiones casi a la vez reciben el mismo trabajo.
 */
export function encolarUnico(
  db: Db,
  t: { tipo: string; dominio: string; base: string; payload: unknown; aMano?: boolean },
): { id: number; nuevo: boolean } {
  return db
    .transaction(() => {
      const vivo = db
        .prepare(
          `SELECT id FROM trabajos_ia WHERE ${EN_RANGO} AND estado IN ('pendiente', 'lanzado')
      ORDER BY id DESC LIMIT 1`,
        )
        .get(t.base, t.base) as { id: number } | undefined;
      if (vivo) {
        // Pedirlo otra vez a mano reanuda su tipo, como encolar con una clave ya en cola, y lo marca
        // como pedido por una persona: si lo encoló un agente, el limitador y la prioridad lo tratarían como automático.
        if (t.aMano) {
          reanudarTipo(db, t.tipo, idDePayload(t.payload));
          db.prepare("UPDATE trabajos_ia SET a_mano = 1 WHERE id = ? AND estado = 'pendiente'").run(vivo.id);
        }
        return { id: vivo.id, nuevo: false };
      }
      const existe = db.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?');
      let n =
        1 +
        (db.prepare(`SELECT COUNT(*) AS n FROM trabajos_ia WHERE ${EN_RANGO}`).get(t.base, t.base) as { n: number }).n;
      // Con algún trabajo borrado a mano, el recuento puede caer en una clave ya usada.
      while (existe.get(`${t.base}#${n}`)) n += 1;
      const id = encolar(db, {
        tipo: t.tipo,
        dominio: t.dominio,
        clave: `${t.base}#${n}`,
        payload: t.payload,
        aMano: t.aMano,
      });
      return { id, nuevo: true };
    })
    .immediate();
}

// Dos runs seguidos que acaban sin resultado por lo mismo volverán a hacerlo: reintentar solo gasta
// uso del modelo. En los dominios con datos personales el error no lleva la salida de Hermes (es
// siempre la misma frase), así que no se puede saber si la causa es la misma: se reintenta.
function mismaCausa(t: Trabajo, f: Fallo): boolean {
  if (f.codigo !== 'sin_resultado' || t.codigo !== 'sin_resultado' || t.error === null || esDominioPersonal(t.dominio))
    return false;
  return t.error.slice(0, MISMA_CAUSA_CARACTERES) === f.error.slice(0, MISMA_CAUSA_CARACTERES);
}

// Reintento con espera creciente (2, 4, 8 min); al tercer fallo, o sin resultado dos veces por lo mismo, queda fallido.
function fallar(db: Db, t: Trabajo, f: Fallo): void {
  if (f.limite) return esperarLimite(db, t, f);
  const intentos = t.intentos + 1;
  const repetido = mismaCausa(t, f);
  if (intentos >= MAX_INTENTOS || repetido) {
    const error = repetido ? `${f.error} Misma causa dos veces seguidas: no se reintenta.` : f.error;
    actualizar(db, t.id, { estado: 'fallido', intentos, error, codigo: f.codigo, run_id: null });
    log.warn('trabajo fallido', { id: t.id, tipo: t.tipo, codigo: f.codigo, repetido });
    avisar(db, t, 'fallido', { codigo: f.codigo, intentos });
    return;
  }
  const espera = new Date(Date.now() + 2 ** intentos * 60_000).toISOString();
  actualizar(db, t.id, {
    estado: 'pendiente',
    intentos,
    error: f.error,
    codigo: f.codigo,
    run_id: null,
    proximo_intento_en: espera,
  });
}

const maxDe = (def: TipoTrabajo): number => def.maxMs ?? RUN_MAX_MS;
const inactivoDe = (def: TipoTrabajo): number => def.inactivoMs ?? INACTIVO_MAX_MS;

function caducado(t: Trabajo, def: TipoTrabajo): boolean {
  return Date.now() - Date.parse(t.actualizado_en) > maxDe(def);
}

// Hermes olvida sus runs al reiniciar: un 404 es un run perdido. Otro fallo de la consulta
// puede ser pasajero, pero si dura más que un run entero el trabajo deja de ocupar hueco.
// Un run que se sabe acabado (Hermes lo dio por terminado o confirmó pararlo) ya no guarda nada:
// si era el más antiguo que podía seguir vivo, el siguiente lanzamiento marca desde dónde.
// «todos»: Hermes se reinició y olvidó todos sus runs.
function runAcabado(db: Db, t: Trabajo, todos = false): void {
  if (todos || t.run_vivo_desde === t.lanzado_en) actualizar(db, t.id, { run_vivo_desde: null });
}

async function pararYAnotar(db: Db, t: Trabajo, destino: DestinoHermes): Promise<void> {
  if (!t.run_id) return;
  const r = await pararRun(destino, t.run_id);
  if (!r.error) runAcabado(db, t);
}

async function consultaFallida(
  db: Db,
  t: Trabajo,
  def: TipoTrabajo,
  destino: DestinoHermes,
  codigo: string,
): Promise<void> {
  if (codigo === 'hermes_http_404') {
    runAcabado(db, t, true);
    return fallar(db, t, { codigo: 'run_perdido', error: 'Hermes ya no conoce el run (¿se reinició?).' });
  }
  if (!caducado(t, def)) return log.warn('no se pudo consultar el run', { id: t.id, tipo: t.tipo, codigo });
  await pararYAnotar(db, t, destino);
  fallar(db, t, {
    codigo: 'consulta_fallida',
    error: `No se pudo consultar el run en ${maxDe(def) / 60_000} min (${codigo}).`,
  });
}

// Desde la última llamada a una herramienta del agente que ejecuta el tipo (o desde que se
// lanzó); sin agente conocido no se mide.
function inactivo(db: Db, t: Trabajo, def: TipoTrabajo): boolean {
  const agente = def.metricas?.agente;
  if (!agente || !t.lanzado_en) return false;
  const u = db
    .prepare('SELECT MAX(creado_en) AS u FROM auditoria_agentes WHERE agente = ? AND creado_en >= ?')
    .get(agente, t.lanzado_en) as { u: string | null };
  return Date.now() - Date.parse(u.u ?? t.lanzado_en) > inactivoDe(def);
}

async function vigilarDuracion(db: Db, t: Trabajo, def: TipoTrabajo, destino: DestinoHermes): Promise<void> {
  const parado = !caducado(t, def) && inactivo(db, t, def);
  if (!caducado(t, def) && !parado) return;
  await pararYAnotar(db, t, destino);
  fallar(
    db,
    t,
    parado
      ? {
          codigo: 'run_inactivo',
          error: `Hermes lleva ${inactivoDe(def) / 60_000} min sin usar ninguna herramienta en este run (¿se reinició?): se reintenta.`,
        }
      : { codigo: 'run_tiempo_maximo', error: 'El run superó el tiempo máximo.' },
  );
}

// La respuesta de Hermes explica por qué no dejó el resultado, salvo donde puede citar datos personales.
function sinResultado(t: Trabajo, salida: string | null): string {
  const base = 'El run terminó sin dejar el resultado esperado.';
  return salida && !esDominioPersonal(t.dominio) ? `${base} Hermes respondió: «${salida}»` : base;
}

// Las métricas nunca tumban la cola: si algo falla al recogerlas, el trabajo sigue sin ellas.
function guardarMetricas(db: Db, t: Trabajo, bruto: unknown, def: TipoTrabajo): void {
  try {
    actualizar(db, t.id, { metricas: JSON.stringify(recogerMetricas(db, t, bruto, def.metricas)) });
  } catch (err) {
    log.warn('métricas del run no recogidas', {
      id: t.id,
      tipo: t.tipo,
      clase: err instanceof Error ? err.name : typeof err,
    });
  }
}

async function seguir(db: Db, t: Trabajo): Promise<void> {
  const def = tipoDe(t.tipo);
  const destino = def?.destino();
  if (!def || !destino || !t.run_id)
    return fallar(db, t, { codigo: 'sin_destino', error: 'Sin destino de Hermes configurado.' });
  const r = await consultarRun(destino, t.run_id);
  if (r.error) return consultaFallida(db, t, def, destino, r.error.code);
  if (r.data.estado === 'en_marcha') return vigilarDuracion(db, t, def, destino);
  guardarMetricas(db, t, r.data.bruto, def);
  if (r.data.estado === 'completado' && def.hecho(JSON.parse(t.payload), t))
    return actualizar(db, t.id, { estado: 'completado', error: null, codigo: null });
  runAcabado(db, t);
  if (r.data.estado !== 'completado') {
    return fallar(db, t, {
      codigo: `run_${r.data.estado}`,
      error: r.data.error ?? `Run ${r.data.estado}.`,
      limite: LIMITE_EN_ERROR.test(r.data.error ?? ''),
    });
  }
  if (faltaHerramienta(r.data.salida)) return esperarHerramienta(db, t, r.data.salida);
  fallar(db, t, { codigo: 'sin_resultado', error: sinResultado(t, r.data.salida) });
}

// Tras esperar al límite de uso, o relanzado a mano, clave nueva: con la misma, Hermes
// devolvería el run que falló o el colgado. (Con «hermes_http_429» al principio: errores
// guardados antes de que existiera el prefijo.)
function vieneDeLimite(t: Trabajo): boolean {
  return Boolean(t.error && [ESPERA_LIMITE, 'hermes_http_429', RELANZADO].some((p) => t.error!.startsWith(p)));
}

// La espera por herramientas desfasadas tapa el error anterior (que podía pedir clave nueva) y
// pone proximo_intento_en a cuando empezó; al resolverse se borra el error y queda esa hora. Así
// lo que pasó por ella sale siempre con `clave#intentos#<inicio de la espera>`: una clave nueva
// no repite ningún run, porque mientras esperaba no se lanzó ninguno.
function vieneDeDesfase(t: Trabajo): boolean {
  return t.codigo === CODIGO_DESFASE || (t.error === null && t.proximo_intento_en !== null);
}

// Los topes miran las últimas 24 h: lo de hace más de dos días ya no cuenta para nada.
const VIDA_LANZAMIENTOS_MS = 2 * 86_400_000;

function apuntarLanzamiento(db: Db, id: number, lanzado: string): void {
  db.prepare('INSERT INTO trabajos_lanzamientos (trabajo_id, lanzado_en) VALUES (?, ?)').run(id, lanzado);
  db.prepare('DELETE FROM trabajos_lanzamientos WHERE lanzado_en < ?').run(
    new Date(Date.now() - VIDA_LANZAMIENTOS_MS).toISOString(),
  );
}

// Devuelve si el trabajo ocupa ahora un hueco de la cola (se lanzó un run).
async function lanzar(db: Db, t: Trabajo): Promise<boolean> {
  const def = tipoDe(t.tipo);
  if (!def) {
    fallar(db, t, { codigo: 'tipo_desconocido', error: `Tipo de trabajo desconocido: ${t.tipo}` });
    return false;
  }
  const destino = def.destino();
  if (!destino) return false; // sin perfil de Hermes configurado: espera sin gastar intentos ni hueco
  const tras = vieneDeLimite(t) || vieneDeDesfase(t) ? `#${t.proximo_intento_en}` : '';
  // Un relanzamiento no gasta intento: sin su número en la clave, Hermes devolvería el run colgado.
  const rel = t.relanzamientos ? `#r${t.relanzamientos}` : '';
  const r = await lanzarRun(
    destino,
    await def.instrucciones(JSON.parse(t.payload), t),
    `${t.clave}#${t.intentos}${rel}${tras}`,
  );
  if (r.error) {
    fallar(db, t, { codigo: r.error.code, error: `${r.error.code}: ${r.error.message}`, limite: esLimite(r.error) });
    return false;
  }
  const lanzado = ahora();
  // Con el run en marcha, la espera por desfase ya no vale: no puede seguir diciendo «reinicia Hermes».
  const sinDesfase = t.codigo === CODIGO_DESFASE ? { codigo: null, error: null } : {};
  actualizar(db, t.id, {
    estado: 'lanzado',
    run_id: r.data.runId,
    lanzado_en: lanzado,
    run_vivo_desde: t.run_vivo_desde ?? lanzado,
    ...sinDesfase,
  });
  apuntarLanzamiento(db, t.id, lanzado);
  log.info('trabajo lanzado', { id: t.id, tipo: t.tipo });
  return true;
}

// Un tipo que lanza (p. ej. su payload ya no valida) no puede atascar la cola en el mismo
// trabajo cada vuelta: ese trabajo falla y los demás siguen. Al log solo va la clase del
// error: su mensaje puede citar el payload.
async function aislado<T>(db: Db, t: Trabajo, fn: () => Promise<T>): Promise<T | false> {
  try {
    return await fn();
  } catch (err) {
    log.error('error interno en un trabajo', {
      id: t.id,
      tipo: t.tipo,
      clase: err instanceof Error ? err.name : typeof err,
    });
    fallar(db, t, { codigo: 'error_interno', error: 'Error interno al preparar o comprobar el trabajo.' });
    return false;
  }
}

/** Runs a la vez de la última vuelta, para estimar horas fuera de este módulo con el mismo reparto. */
export const runsALaVezActual = (): number => runsALaVez;

/** Una vuelta de la cola: sigue los runs en marcha y lanza pendientes hasta el máximo. */
export async function vueltaCola(db: Db, maxEnMarcha = 2): Promise<void> {
  runsALaVez = maxEnMarcha;
  const lanzados = db.prepare("SELECT * FROM trabajos_ia WHERE estado = 'lanzado' ORDER BY id").all() as Trabajo[];
  for (const t of lanzados) await aislado(db, t, () => seguir(db, t));
  const desfases = marcarDesfases(db);
  const frenado = frenoDeVuelta(db);
  const limite = limiteDeVuelta();
  cancelarZombis(db, Date.now(), retenidoEnLaVuelta({ desfases, frenado, limite }));
  avisarFrenosNuevos(db);
  if (pausaHastaMs(db)) return;
  const enMarcha = (db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE estado = 'lanzado'").get() as { n: number })
    .n;
  let libres = Math.max(0, maxEnMarcha - enMarcha);
  if (libres === 0) return;
  const pendientes = db
    .prepare(
      `SELECT * FROM trabajos_ia WHERE estado = 'pendiente'
    AND (proximo_intento_en IS NULL OR proximo_intento_en <= ?) ORDER BY id LIMIT ?`,
    )
    .all(ahora(), MAX_PENDIENTES_VUELTA) as Trabajo[];
  for (const t of aplicarCupos(db, porPrioridad(pendientes))) {
    if (libres === 0 || pausaHastaMs(db)) return;
    if (frenado(t) || desfases.has(t.tipo) || limite.limitado(t)) continue;
    // Solo cuenta lo que de verdad lanzó un run: un trabajo sin perfil de Hermes configurado
    // no puede bloquear a los que vienen detrás.
    if (!(await aislado(db, t, () => lanzar(db, t)))) continue;
    libres -= 1;
    limite.lanzado(t);
  }
}

/**
 * Si el trabajo ya dejó lo que tenía que dejar según el `hecho` de su tipo, aunque la cola aún
 * no lo haya dado por completado: quien lo vea pasado de tiempo no debe relanzarlo (gastaría
 * otro run entero). Sin tipo registrado o si `hecho` falla, no: se trata como no hecho.
 */
export function trabajoHecho(db: Db, id: number): boolean {
  const t = obtenerTrabajo(db, id);
  const def = t ? tipoDe(t.tipo) : undefined;
  if (!t || !def) return false;
  try {
    return def.hecho(JSON.parse(t.payload), t);
  } catch (e) {
    log.warn('no se pudo comprobar si el trabajo está hecho', {
      tipo: t.tipo,
      id,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
