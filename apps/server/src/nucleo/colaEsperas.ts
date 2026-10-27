// Las esperas que no gastan intento: el uso del modelo agotado (pausa de toda la cola), una
// herramienta que Hermes no tiene y la lista de herramientas de antes de un despliegue.
import { ahora, type Db } from './db.js';
import { leerMarca, MARCA_PAUSA_LIMITE, ponerMarca, quitarMarca } from './colaMarcas.js';
import { actualizar, avisar, tipoDe, tiposRegistrados, type Fallo, type Trabajo } from './colaTipos.js';
import { logger } from './log.js';
import { desfaseDe, desfasados, type Desfase } from './mcp/huellas.js';
import type { AppError } from './result.js';

// Uso del modelo agotado: toda la cola espera sin gastar intentos. Se reconoce por el HTTP 429
// de Hermes o por el error del propio run, nunca por la respuesta del agente: un «1.429,00 €»
// en ella pararía toda la cola.
const PAUSA_LIMITE_MS = 30 * 60_000;
export const LIMITE_EN_ERROR =
  /usage limit|rate[ _-]?limit|too many requests|\b(?:status_code|status|code)\W{1,3}429\b/i;
// Prefijo del error de un trabajo que espera al límite: al relanzarlo hace falta clave nueva.
export const ESPERA_LIMITE = 'Uso del modelo agotado';
// Hermes sin una herramienta de la plataforma (se desplegó una nueva y no se reinició): leer
// los pliegos y reintentar solo gasta uso del modelo en runs que no pueden acabar bien. El
// trabajo espera sin gastar intento, su tipo se para y una persona lo reanuda pidiéndolo a mano.
export const ESPERA_HERRAMIENTA = 'Falta una herramienta en Hermes';
const ESPERA_HERRAMIENTA_MS = 24 * 60 * 60_000;
const SIN_HERRAMIENTA = /herramienta\b[^.]{0,100}?\bno (?:est[aá] (?:disponible|habilitada)|aparece|existe)/i;
// Hermes con la lista de herramientas de antes de un despliegue (solo la pide al arrancar): las
// instrucciones nuevas piden campos que la tool vieja rechaza y cada run gasta un intento para
// nada, hasta agotarlos y frenar el tipo entero. El trabajo
// espera sin gastar intento ni hueco y sale solo en cuanto ese perfil vuelva a pedir la lista.
export const ESPERA_DESFASE = 'Hermes tiene la lista de herramientas de antes del despliegue';
const ERROR_DESFASE = `${ESPERA_DESFASE}: reinicia Hermes (con la cola quieta: un reinicio mata los runs en curso). Sale solo en cuanto Hermes vuelva a pedir la lista, sin gastar intento.`;
const NOMBRE_HERRAMIENTA =
  /\b((?:licitaciones|biblioteca|plataforma|colaboradores|salidas|competidores|organismos)_[a-z_]+)\b/;

// Un aviso por agente y arranque: la comprobación se repite en cada vuelta de la cola.
const avisadosDesfase = new Set<string>();
const log = logger('trabajos');

export const CODIGO_LIMITE = 'limite_uso';
export const CODIGO_HERRAMIENTA = 'sin_herramienta';
export const CODIGO_DESFASE = 'herramientas_desfasadas';

// Sin uso del modelo no es culpa del trabajo: vuelve a la cola sin gastar un intento.
export function esperarLimite(db: Db, t: Trabajo, f: Fallo): void {
  const hasta = new Date(Date.now() + PAUSA_LIMITE_MS).toISOString();
  // Una vez por pausa: con la marca ya activa, los demás trabajos que topan con el límite no repiten el aviso.
  const nueva = pausaHastaMs(db) === 0;
  ponerMarca(db, MARCA_PAUSA_LIMITE, hasta);
  actualizar(db, t.id, {
    estado: 'pendiente',
    error: `${ESPERA_LIMITE}: ${f.error}`,
    codigo: CODIGO_LIMITE,
    run_id: null,
    proximo_intento_en: hasta,
  });
  if (nueva) avisar(db, t, 'esperando', { codigo: CODIGO_LIMITE, proximo_intento_en: hasta });
  log.warn('uso del modelo agotado: la cola espera', {
    id: t.id,
    tipo: t.tipo,
    codigo: f.codigo,
    minutos: PAUSA_LIMITE_MS / 60_000,
  });
}

/** Hasta cuándo espera toda la cola por el límite de uso del modelo (ms); 0 si no espera. Sobrevive a un reinicio. */
export function pausaHastaMs(db: Db, ahoraMs = Date.now()): number {
  const marca = leerMarca(db, MARCA_PAUSA_LIMITE);
  if (marca === null) return 0;
  const hasta = Date.parse(marca);
  if (Number.isFinite(hasta) && hasta > ahoraMs) return hasta;
  // Pasada (o ilegible): se borra para que la próxima lectura no la vuelva a interpretar.
  quitarMarca(db, MARCA_PAUSA_LIMITE);
  return 0;
}

export const pausaIso = (db: Db): string | null => {
  const ms = pausaHastaMs(db);
  return ms ? new Date(ms).toISOString() : null;
};

/** Si la respuesta de Hermes dice que no tiene una herramienta de la plataforma. */
export const faltaHerramienta = (salida: string | null): salida is string =>
  salida !== null && SIN_HERRAMIENTA.test(salida);

// Espera larga sin gastar intento: hasta que alguien reinicie Hermes y lo pida a mano.
export function esperarHerramienta(db: Db, t: Trabajo, salida: string): void {
  const herramienta = NOMBRE_HERRAMIENTA.exec(salida)?.[1] ?? 'de la plataforma';
  const hasta = new Date(Date.now() + ESPERA_HERRAMIENTA_MS).toISOString();
  actualizar(db, t.id, {
    estado: 'pendiente',
    run_id: null,
    proximo_intento_en: hasta,
    codigo: CODIGO_HERRAMIENTA,
    error: `${ESPERA_HERRAMIENTA} (${herramienta}): reinicia Hermes para que la cargue y vuelve a pedirlo a mano.`,
  });
  log.warn('hermes sin la herramienta: el tipo espera', { id: t.id, tipo: t.tipo, herramienta });
  avisar(db, t, 'esperando', { codigo: CODIGO_HERRAMIENTA, proximo_intento_en: hasta });
}

export function esLimite(e: AppError): boolean {
  return e.code === 'hermes_http_429' || LIMITE_EN_ERROR.test(e.message);
}

/** Hasta cuándo espera un tipo a que Hermes cargue una herramienta, y por qué (null si no espera). */
export function esperaHerramienta(db: Db, tipo: string): { hasta: string; error: string } | null {
  const t = db
    .prepare(
      `SELECT proximo_intento_en AS hasta, error FROM trabajos_ia WHERE tipo = ? AND estado = 'pendiente'
    AND error LIKE ? AND proximo_intento_en > ? ORDER BY proximo_intento_en DESC LIMIT 1`,
    )
    .get(tipo, `${ESPERA_HERRAMIENTA}%`, ahora()) as { hasta: string; error: string } | undefined;
  return t ?? null;
}

/**
 * Si el perfil de Hermes que ejecuta el tipo tiene la lista de herramientas de antes del
 * despliegue. Sin agente o sin perfil configurado, nunca: no hay a quién reiniciar.
 */
export function desfaseDeTipo(db: Db, tipo: string): Desfase | null {
  const def = tipoDe(tipo);
  const agente = def?.metricas?.agente;
  return agente && def.destino() ? desfaseDe(db, agente) : null;
}

/** Los perfiles de Hermes que ejecutan trabajos de la cola y están desfasados (no claude-code ni tokens sin tipos). */
export function desfasadosDeLaCola(db: Db): Desfase[] {
  const agentes = tiposRegistrados().flatMap((tipo) => {
    const def = tipoDe(tipo);
    return def?.metricas?.agente && def.destino() ? [def.metricas.agente] : [];
  });
  return desfasados(db, agentes);
}

function avisarDesfase(d: Desfase): void {
  if (avisadosDesfase.has(d.agente)) return;
  avisadosDesfase.add(d.agente);
  log.warn('hermes con la lista de herramientas de antes del despliegue: sus trabajos esperan', {
    agente: d.agente,
    desde: d.desde,
    listado_en: d.listado_en,
  });
}

/**
 * En cada vuelta, haya o no huecos: los pendientes que tocaría lanzar de un tipo desfasado llevan
 * el código herramientas_desfasadas (sin tocar intentos ni run); los de un tipo que ya no lo está
 * lo pierden aunque aún no se lancen. Devuelve los tipos desfasados.
 */
export function marcarDesfases(db: Db): Set<string> {
  const desfasadosAhora = new Set<string>();
  const marca = ahora();
  for (const tipo of tiposRegistrados()) {
    const d = desfaseDeTipo(db, tipo);
    if (!d) {
      db.prepare(
        `UPDATE trabajos_ia SET codigo = NULL, error = NULL, actualizado_en = ? WHERE tipo = ? AND estado = 'pendiente' AND codigo = ?`,
      ).run(marca, tipo, CODIGO_DESFASE);
      continue;
    }
    avisarDesfase(d);
    desfasadosAhora.add(tipo);
    db.prepare(
      `UPDATE trabajos_ia SET codigo = ?, error = ?, proximo_intento_en = ?, actualizado_en = ? WHERE tipo = ? AND estado = 'pendiente'
      AND (proximo_intento_en IS NULL OR proximo_intento_en <= ?) AND (codigo IS NULL OR codigo != ?)`,
    ).run(CODIGO_DESFASE, ERROR_DESFASE, marca, marca, tipo, marca, CODIGO_DESFASE);
  }
  return desfasadosAhora;
}
