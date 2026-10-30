// Detector de reutilización literal: un apartado que copia más del 30 % de una memoria presentada a otro órgano.
import { claveOrgano, esDelOrgano, type FilaOrgano } from '../antecedentes/organo.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { parrafosDe } from './lecciones.js';
import { parrafosDeVersionEntera } from './textoEntero.js';

// Las mesas reconocen el texto de plantilla y una copia puede arrastrar el nombre de otro cliente. Se compara
// por secuencias de 8 palabras: un párrafo reescrito no casa, uno pegado sí. Las presentadas ya no cambian, así
// que su huella se calcula una vez por proceso.
const PALABRAS_SECUENCIA = 8;
const UMBRAL_REUTILIZACION = 0.3;
// Un apartado de unas pocas frases no se juzga: dos frases hechas ya serían un 30 %.
const MIN_SECUENCIAS = 40;

export type Reutilizacion = {
  apartado: number;
  fraccion: number;
  licitacion_id: string;
  expediente: string;
  organo: string;
};
type Presentada = FilaOrgano & { memoria_id: number; licitacion_id: string; expediente: string; organo: string };

const palabras = (t: string): string[] =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Las secuencias de PALABRAS_SECUENCIA palabras de unos textos. */
export function secuencias(textos: readonly string[], n = PALABRAS_SECUENCIA): Set<string> {
  const out = new Set<string>();
  for (const t of textos) {
    const ws = palabras(t);
    for (let k = 0; k + n <= ws.length; k += 1) out.add(ws.slice(k, k + n).join(' '));
  }
  return out;
}

/** Qué parte de las secuencias de un texto sale literal en otro (0 sin secuencias). */
export function fraccionCopiada(texto: ReadonlySet<string>, otro: ReadonlySet<string>): number {
  if (!texto.size) return 0;
  let n = 0;
  for (const s of texto) if (otro.has(s)) n += 1;
  return n / texto.size;
}

// Por id y una firma barata de sus apartados: SQLite puede reutilizar el id de una memoria borrada.
const huellas = new Map<number, { firma: string; secuencias: Set<string> }>();

function huellaDePresentada(db: Db, memoriaId: number): Set<string> {
  const f = db
    .prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(datos)), 0) AS largo FROM memoria_apartados WHERE memoria_id = ?',
    )
    .get(memoriaId) as { n: number; largo: number };
  const firma = `${f.n}:${f.largo}`;
  const guardada = huellas.get(memoriaId);
  if (guardada?.firma === firma) return guardada.secuencias;
  const porApartado = [...parrafosDe(db, memoriaId).values()].flat();
  const s = secuencias(porApartado.length ? porApartado : parrafosDeVersionEntera(db, memoriaId));
  huellas.set(memoriaId, { firma, secuencias: s });
  return s;
}

// Las presentadas de otras licitaciones (presentada = 1: la entregada de cada lote; 2 son las
// anteriores), de un órgano distinto al de esta.
function presentadasDeOtrosOrganos(db: Db, id: string): Presentada[] {
  const propia = db.prepare('SELECT organo_nif, organo_dir3, organo_norm FROM licitaciones WHERE id = ?').get(id) as
    FilaOrgano | undefined;
  const clave = propia ? claveOrgano(propia) : null;
  const filas = db
    .prepare(
      `SELECT m.id AS memoria_id, m.licitacion_id, l.expediente, l.organo_nombre AS organo, l.organo_nif, l.organo_dir3, l.organo_norm
    FROM memorias m JOIN licitaciones l ON l.id = m.licitacion_id
    WHERE m.presentada = 1 AND m.ensayo = 0 AND m.licitacion_id <> ?`,
    )
    .all(id) as Presentada[];
  return filas.filter((f) => !esDelOrgano(clave, f));
}

/** Los apartados (1, 2…) de unos textos que copian más del umbral de una presentada a otro órgano: la que más. */
export function reutilizacionesDe(db: Db, id: string, textos: readonly string[]): Reutilizacion[] {
  const apartados = textos.map((t) => secuencias([t]));
  if (!apartados.some((s) => s.size >= MIN_SECUENCIAS)) return [];
  const presentadas = presentadasDeOtrosOrganos(db, id).map((p) => ({
    p,
    huella: huellaDePresentada(db, p.memoria_id),
  }));
  return apartados.flatMap((s, i) => {
    if (s.size < MIN_SECUENCIAS) return [];
    const mejor = presentadas
      .map((x) => ({ ...x, fraccion: fraccionCopiada(s, x.huella) }))
      .sort((a, b) => b.fraccion - a.fraccion)[0];
    if (!mejor || mejor.fraccion <= UMBRAL_REUTILIZACION) return [];
    const { licitacion_id, expediente, organo } = mejor.p;
    return [{ apartado: i + 1, fraccion: mejor.fraccion, licitacion_id, expediente, organo }];
  });
}
