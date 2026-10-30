// Citas comprobadas: busca la cita literal de un pliego en los pliegos descargados de la licitación.
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { consultaFts } from './buscador.js';
import { localizarCitas } from './oferta/evaluacionMemoria.js';
import type { Db } from './store.js';

// Se busca en el índice de la Biblioteca (FTS5 con página) y queda «comprobada» con su documento y su página o
// «no localizada». Sin índice o sin pliegos indexados no se puede decir nada: «sin_indice». Las usan la ficha
// (cada requisito con su cita literal), las filas de las comprobaciones que salen de ella y las propuestas de
// Hermes sobre un bloqueo. Lo literal se compara como en la evaluación de memorias (localizarCitas): sin
// acentos, mayúsculas ni signos, y con «…» para saltar un trozo.
type EstadoCita = 'comprobada' | 'no_localizada' | 'sin_indice';
export type Comprobacion = { estado: EstadoCita; documento: string | null; pagina: number | null };

// Para buscar candidatos basta el trozo más largo de la cita (entre «…»): el resto se comprueba literal.
const CANDIDATOS = 30;
const MAX_PALABRAS = 10;

function trozoMasLargo(cita: string): string {
  return (
    cita
      .split(/…|\.\.\./)
      .map((t) => t.trim())
      .sort((a, b) => b.length - a.length)[0] ?? ''
  );
}

// Los candidatos, por las palabras más largas del trozo (las cortas casan en todo el pliego) unidas
// con OR: una cita que cae entre dos trozos del índice no tiene todas sus palabras en ninguno.
// bm25 pone primero los que tienen más; lo literal se comprueba después.
function consultaDe(cita: string): string | null {
  const palabras = (trozoMasLargo(cita).match(/[\p{L}\p{N}]+/gu) ?? [])
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_PALABRAS);
  return consultaFts(palabras.join(' '))?.replaceAll(' AND ', ' OR ') ?? null;
}

/** Los pliegos descargados de una licitación que están leídos en el índice. */
function pliegosIndexados(dbLic: Db, idx: indice.BaseDatos, id: string): string[] {
  const rutas = (
    dbLic
      .prepare("SELECT ruta FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL")
      .all(id) as { ruta: string }[]
  ).map((f) => f.ruta);
  if (!rutas.length) return [];
  const ok = idx
    .prepare(
      `SELECT path FROM files WHERE status = 'ok' AND chunks > 0 AND path IN (${rutas.map(() => '?').join(',')})`,
    )
    .all(...rutas) as { path: string }[];
  return ok.map((f) => f.path);
}

export type Comprobador = (cita: string, documento?: string | null) => Comprobacion;

/**
 * Un comprobador para las citas de una licitación (lee la lista de pliegos una vez). `documento`:
 * la ruta de un pliego para buscar solo en él; sin ella, en todos.
 */
export function comprobadorDe(dbLic: Db, idx: indice.BaseDatos | null, id: string): Comprobador {
  const rutas = idx ? pliegosIndexados(dbLic, idx, id) : [];
  const vecinos = idx?.prepare('SELECT id, text FROM chunks WHERE path = ? AND id IN (?, ?)');
  return (cita, documento = null) => {
    const en = documento ? rutas.filter((r) => r === documento) : rutas;
    if (!idx || !vecinos || !en.length) return { estado: 'sin_indice', documento: null, pagina: null };
    const match = consultaDe(cita);
    let trozos: indice.AciertoTrozo[] = [];
    try {
      trozos = match ? indice.buscarFtsEnRutas(idx, match, en, CANDIDATOS) : [];
    } catch {
      trozos = [];
    }
    for (const t of trozos) {
      // Con el trozo de antes y el de después: una cita puede caer entre dos párrafos del índice.
      const alrededor = vecinos.all(t.path, t.id - 1, t.id + 1) as { id: number; text: string }[];
      const texto = (n: number) => alrededor.find((x) => x.id === n)?.text ?? '';
      if (localizarCitas([[texto(t.id - 1), t.text, texto(t.id + 1)].join(' ')], [cita])[0] !== null) {
        return { estado: 'comprobada', documento: t.path, pagina: t.page };
      }
    }
    return { estado: 'no_localizada', documento: null, pagina: null };
  };
}

/** La comprobación de la cita literal de cada requisito, por orden; null en el que no trae cita. */
export function citasDeRequisitos(
  dbLic: Db,
  idx: indice.BaseDatos | null,
  id: string,
  requisitos: readonly { cita?: string }[],
): (Comprobacion | null)[] {
  if (!requisitos.some((r) => r.cita)) return requisitos.map(() => null);
  const comprobar = comprobadorDe(dbLic, idx, id);
  return requisitos.map((r) => (r.cita ? comprobar(r.cita) : null));
}
