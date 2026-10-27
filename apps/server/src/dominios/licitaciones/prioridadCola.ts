// Orden de la cola de IA para licitaciones: lo que se prepara o presenta, antes y por plazo más cercano.
import { nucleo } from '../../nucleo/contexto.js';
import type { Db } from '../../nucleo/db.js';
import { instanteDeHoraEspana } from '../../nucleo/fechas.js';
import { fijarCupo, fijarPrioridad } from '../../nucleo/colaOrden.js';
import type { Trabajo } from '../../nucleo/colaTipos.js';
import { TIPO_ANEXO } from './oferta/anexosTrabajo.js';
import { TIPO_MEMORIA_CRITICA } from './oferta/critica.js';
import { TIPO_MEMORIA_ESTRATEGIA } from './oferta/estrategia.js';
import { TIPO_EVAL_JUICIO } from './oferta/evalMemorias.js';
import { TIPO_GUION } from './oferta/guion.js';
import { TIPO_LECCIONES } from './oferta/lecciones.js';
import { memoriaDeEnsayo } from './oferta/ensamblado.js';
import { TIPO_PROPUESTA_DECISIONES } from './oferta/propuestaDecisiones.js';
import { DURACION_MIN } from './oferta/plazo.js';
import { TIPO_MEMORIA_REDACCION } from './oferta/redaccion.js';
import { DURACION_REVISION_MIN, TIPO_REVISION_PREVIA } from './oferta/revisionPrevia.js';
import { TIPO_MEMORIA_HECHOS } from './oferta/parcheHechos.js';
import { TIPO_EVALUACION } from './propuestas/evaluacion.js';
import { TIPO_APRENDER_ACTA } from './propuestas/actas.js';
import { TIPO_RESUMEN_COMPETIDOR } from './competencia/resumen.js';
import { TIPO_CRIBA } from './criba.js';
import { TIPO_FICHA } from './ficha.js';
import { TIPO_ACTA_MERCADO } from './actasMercado.js';

// Después va lo pedido para una licitación nueva (la ficha) y, al final, el trabajo de fondo. Así una ficha o
// una criba nuevas no se quedan delante de la memoria de una oferta con el plazo a la vuelta de la esquina
// (varias fichas nuevas podrían ir delante de la de una oferta cercana al plazo).
const ESCALA_NIVEL = 1_000_000;
const MAX_HORAS = 999_999;
const HORA_MS = 3_600_000;
const NIVEL_OFERTA = 0;
const NIVEL_NUEVA = 1;
const NIVEL_FONDO = 2;
const CUPO_FICHA = 3;
// Lo que pide una persona en la web va por delante de lo automático de la misma licitación:
// alguien está esperando delante de la pantalla.
const BONO_A_MANO_H = 24;
// Lo que espera mucho sube poco a poco (media hora por hora, hasta 24 h de ventaja) para que un
// plazo lejano no se quede atrás para siempre; nunca sale de su nivel.
const ENVEJECIMIENTO_MAX_H = 48;
const ENVEJECIMIENTO_FACTOR = 0.5;
// La regeneración masiva de fichas (clave «-regen-v») va detrás de todo el fondo: rehace lo que ya
// existe, así que no le quita el hueco a nada que falte.
const RANGO_REGENERACION = NIVEL_FONDO * ESCALA_NIVEL + 900_000;
const MARCA_REGENERACION = '-regen-v';
// Las actas de expedientes ajenos son lo último del fondo, delante solo de la regeneración.
const RANGO_ACTAS_MERCADO = NIVEL_FONDO * ESCALA_NIVEL + 800_000;
// Minutos que tarda cada tipo (de pedirlo a tenerlo): lo que importa es cuándo hay que empezarlo,
// no cuándo cierra. Los que no tienen guardia de plazo propia (evaluar) usan media hora.
const MIN_SIN_GUARDIA = 30;
const DURACION_TIPO: Record<string, number> = {
  [TIPO_FICHA]: DURACION_MIN.ficha,
  [TIPO_GUION]: DURACION_MIN.guion,
  [TIPO_PROPUESTA_DECISIONES]: DURACION_MIN.decisiones,
  [TIPO_MEMORIA_ESTRATEGIA]: DURACION_MIN.memoria,
  [TIPO_MEMORIA_REDACCION]: DURACION_MIN.memoria,
  [TIPO_MEMORIA_CRITICA]: DURACION_MIN.memoria,
  [TIPO_MEMORIA_HECHOS]: DURACION_MIN.memoria,
  [TIPO_ANEXO]: DURACION_MIN.anexo,
  [TIPO_EVALUACION]: MIN_SIN_GUARDIA,
  [TIPO_REVISION_PREVIA]: DURACION_REVISION_MIN,
};

type Situacion = { nivel: number; limite: number | null };

function situacion(db: Db, id: unknown): Situacion {
  const fila =
    typeof id !== 'string'
      ? undefined
      : (db
          .prepare(
            `SELECT o.estado, l.fecha_limite FROM oportunidades o
    JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.licitacion_id = ?`,
          )
          .get(id) as { estado: string; fecha_limite: string | null } | undefined);
  const nivel = fila && ['en_preparacion', 'presentada'].includes(fila.estado) ? NIVEL_OFERTA : NIVEL_NUEVA;
  return { nivel, limite: fila?.fecha_limite ? instanteDeHoraEspana(fila.fecha_limite) : null };
}

/** Horas (≥ 0) entre `ahora + resta` y el plazo; sin plazo, el máximo. */
function horasUtiles(limite: number | null, ahoraMs: number, restaMs = 0): number {
  // Un plazo ya pasado no es menos urgente que uno de ahora mismo: cuenta como 0 horas.
  return limite === null ? MAX_HORAS : Math.min(MAX_HORAS, Math.max(0, (limite - ahoraMs - restaMs) / HORA_MS));
}

const ajusteAMano = (t: Pick<Trabajo, 'a_mano'>): number => (t.a_mano ? BONO_A_MANO_H : 0);

function envejecimiento(t: Pick<Trabajo, 'creado_en'>, ahoraMs: number): number {
  const espera = (ahoraMs - Date.parse(t.creado_en)) / HORA_MS;
  return Number.isFinite(espera) ? Math.min(Math.max(0, espera), ENVEJECIMIENTO_MAX_H) * ENVEJECIMIENTO_FACTOR : 0;
}

function payloadDe(t: Pick<Trabajo, 'payload'>): unknown {
  try {
    return JSON.parse(t.payload) as unknown;
  } catch {
    // Un payload ilegible no tiene licitación: cae en el nivel de lo nuevo sin parar la cola.
    return null;
  }
}

/**
 * Rango de un trabajo de una oferta o de una licitación nueva: horas hasta el momento en que hay
 * que empezarlo (plazo − lo que tarda − el margen de firma), menos la ventaja de lo pedido a mano
 * y de lo que lleva esperando, sin bajar nunca del suelo de su nivel.
 */
export function prioridadTrabajo(db: Db, t: Trabajo, ahoraMs = Date.now()): number {
  if (t.clave.includes(MARCA_REGENERACION)) return RANGO_REGENERACION;
  const payload = payloadDe(t);
  if (trabajoDeEnsayo(db, payload) || trabajoDePresentada(db, payload)) return NIVEL_FONDO * ESCALA_NIVEL;
  const { nivel, limite } = situacion(db, (payload as { id?: unknown } | null)?.id);
  const restaMs =
    (DURACION_TIPO[t.tipo] ?? MIN_SIN_GUARDIA) * 60_000 + nucleo().config.licitaciones.margenFirmaHoras * HORA_MS;
  const horas = horasUtiles(limite, ahoraMs, restaMs) - ajusteAMano(t) - envejecimiento(t, ahoraMs);
  return nivel * ESCALA_NIVEL + Math.max(0, horas);
}

/**
 * ¿Es un trabajo de una memoria de ensayo? Su licitación tiene el plazo vencido (cuenta como lo
 * más urgente), pero no se presenta: va de fondo, detrás de las ofertas vivas. Los de la memoria
 * traen memoria_id; la autoevaluación, el documento (su Word con «-ensayo»).
 */
export function trabajoDeEnsayo(db: Db, payload: unknown): boolean {
  const p = (payload ?? {}) as { memoria_id?: unknown; documento?: unknown };
  if (memoriaDeEnsayo(db, p.memoria_id)) return true;
  return (
    typeof p.documento === 'string' &&
    db
      .prepare(
        `SELECT 1 FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.ruta = ? AND m.ensayo = 1`,
      )
      .get((p as { id?: unknown }).id ?? null, p.documento) !== undefined
  );
}

/**
 * ¿Es la autoevaluación de una memoria presentada (memoriaPresentada.ts)? Se sube con el plazo
 * vencido, lo normal, y contaría como lo más urgente; pero ya está entregada: va de fondo, detrás
 * de las ofertas que siguen en plazo.
 */
export function trabajoDePresentada(db: Db, payload: unknown): boolean {
  const p = (payload ?? {}) as { id?: unknown; documento?: unknown };
  return (
    typeof p.documento === 'string' &&
    db
      .prepare(
        `SELECT 1 FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.ruta = ? AND m.presentada > 0`,
      )
      .get(p.id ?? null, p.documento) !== undefined
  );
}

/** Reparte el gancho de prioridad entre los tipos de licitaciones ya registrados. */
export function registrarPrioridades(db: () => Db): void {
  const deLicitacion = (_p: unknown, t: Trabajo) => prioridadTrabajo(db(), t);
  // La memoria (estrategia, redacción, crítica y corrección de hechos) es de la oferta; su payload trae el id.
  const deOferta = [
    TIPO_GUION,
    TIPO_MEMORIA_ESTRATEGIA,
    TIPO_MEMORIA_REDACCION,
    TIPO_MEMORIA_CRITICA,
    TIPO_MEMORIA_HECHOS,
    TIPO_PROPUESTA_DECISIONES,
    TIPO_ANEXO,
    TIPO_EVALUACION,
    TIPO_FICHA,
    TIPO_REVISION_PREVIA,
  ];
  for (const tipo of deOferta) fijarPrioridad(tipo, deLicitacion);
  // El juez del banco de pruebas de memorias no es de ninguna oferta: fondo.
  for (const tipo of [TIPO_CRIBA, TIPO_LECCIONES, TIPO_APRENDER_ACTA, TIPO_RESUMEN_COMPETIDOR, TIPO_EVAL_JUICIO])
    fijarPrioridad(tipo, () => NIVEL_FONDO * ESCALA_NIVEL);
  fijarPrioridad(TIPO_ACTA_MERCADO, () => RANGO_ACTAS_MERCADO);
  // La ficha de lo nuevo es lo único que ve quien revisa candidatas: 1 de cada 3 lanzamientos,
  // aunque haya trabajo de oferta delante (el 14/10 ocho fichas esperaron horas tras una memoria).
  // La regeneración masiva no: rehace fichas que ya existen y va detrás de todo el fondo.
  fijarCupo(TIPO_FICHA, CUPO_FICHA, (t) => !t.clave.includes(MARCA_REGENERACION));
}
