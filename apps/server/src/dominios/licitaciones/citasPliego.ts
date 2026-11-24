// Citas comprobadas: busca la cita literal de un pliego en los pliegos descargados de la licitación.
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { localizarCitasEn, textosParaLocalizar } from './oferta/evaluacionMemoria.js';
import type { Db } from './store.js';

// Se busca en los trozos del índice de la Biblioteca (con su página) de los pliegos de la licitación y queda
// «comprobada» con su documento y su página o «no localizada». Sin índice o sin pliegos indexados no se puede
// decir nada: «sin_indice». Las usan la ficha (cada requisito con su cita literal), las filas de las
// comprobaciones que salen de ella y las propuestas de Hermes sobre un bloqueo. Lo literal se compara como en
// la evaluación de memorias (localizarCitas): sin acentos, mayúsculas ni signos, y con «…» para saltar un trozo.
//
// Sin FTS a propósito: una consulta con las palabras de la cita recorre el índice entero (todas las listas de
// esas palabras en toda la Biblioteca) y costaba lo mismo filtrara o no por pliego; con una por requisito y
// oferta, las listas bloqueaban el servidor. Los pliegos de una licitación son unos cientos o miles de trozos:
// se leen una vez por comprobador y cada cita se mira en todos, no solo en los mejores por bm25.
type EstadoCita = 'comprobada' | 'no_localizada' | 'sin_indice';
export type Comprobacion = { estado: EstadoCita; documento: string | null; pagina: number | null };

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

// Cada trozo solo, con el siguiente y con los dos vecinos del mismo documento: una cita puede caer entre dos
// (o tres) párrafos del índice. Se mira en ese orden para dar la página del trozo donde está la cita y no la del
// anterior, cuya ventana también la contiene. En orden de lectura (ruta y orden del trozo): una cita repetida da
// su primera aparición.
type Ventana = {
  path: string;
  page: number | null;
  textos: readonly [solo: string, conSiguiente: string, conVecinos: string];
};

function ventanasDe(idx: indice.BaseDatos, rutas: string[]): Ventana[] {
  const trozos = indice.trozosDeRutas(idx, rutas);
  const del = (i: number, ruta: string) => (trozos[i]?.path === ruta ? trozos[i].text : '');
  const [solo, conSiguiente, conVecinos] = [
    trozos.map((t) => t.text),
    trozos.map((t, i) => [t.text, del(i + 1, t.path)].join(' ')),
    trozos.map((t, i) => [del(i - 1, t.path), t.text, del(i + 1, t.path)].join(' ')),
  ].map(textosParaLocalizar);
  return trozos.map((t, i) => ({
    path: t.path,
    page: t.page,
    textos: [solo?.[i] ?? '', conSiguiente?.[i] ?? '', conVecinos?.[i] ?? ''],
  }));
}

export type Comprobador = (cita: string, documento?: string | null) => Comprobacion;

/**
 * Un comprobador para las citas de una licitación (lee sus pliegos del índice una vez). `documento`:
 * la ruta de un pliego para buscar solo en él; sin ella, en todos.
 */
export function comprobadorDe(dbLic: Db, idx: indice.BaseDatos | null, id: string): Comprobador {
  const rutas = idx ? pliegosIndexados(dbLic, idx, id) : [];
  const ventanas = idx && rutas.length ? ventanasDe(idx, rutas) : [];
  return (cita, documento = null) => {
    const en = documento ? ventanas.filter((v) => v.path === documento) : ventanas;
    if (!en.length) return { estado: 'sin_indice', documento: null, pagina: null };
    for (const pasada of [0, 1, 2] as const) {
      const i = localizarCitasEn(
        en.map((v) => v.textos[pasada]),
        [cita],
      )[0];
      const v = i ? en[i - 1] : undefined;
      if (v) return { estado: 'comprobada', documento: v.path, pagina: v.page };
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
