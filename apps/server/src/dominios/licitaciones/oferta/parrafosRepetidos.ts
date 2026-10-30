// Contenido que se repite: un párrafo bien usado en 3 ofertas o más se propone como nota de la Biblioteca.
import crypto from 'node:crypto';
import { logger } from '../../../nucleo/log.js';
import { errorMessage } from '../../../nucleo/result.js';
import type { EntradaPropuesta } from '../../../biblioteca/motor/bandeja.js';
import { palabrasSignificativas } from '../propuestas/aprendizaje.js';
import type { Db } from '../store.js';
import { guionPorId } from './guion.js';
import { parrafosDe } from './lecciones.js';
import { temaDeApartado } from './temasApartado.js';

const log = logger('licitaciones');
// «Bien»: la oferta se ganó o el crítico ciego dio a su apartado al menos el 70 % del tramo máximo. Lo detecta el
// código y la propuesta queda pendiente en _Propuestas, como las de Hermes: Drive sigue siendo la fuente de
// verdad y una persona decide. Cada párrafo se propone una vez (parrafos_biblioteca).
const MIN_OFERTAS = 3;
const MIN_CARACTERES = 180;
const PARECIDO = 0.8;
const BIEN = 0.7;

type Uso = { licitacion_id: string; expediente: string; apartado: string; texto: string; palabras: Set<string> };
type Grupo = { texto: string; apartado: string; usos: Uso[] };

// La memoria que cuenta de cada oferta: la presentada o, sin ella, la última dada por buena.
function memoriasFinales(
  db: Db,
): { id: number; licitacion_id: string; guion_id: number; expediente: string; ganada: boolean }[] {
  return db
    .prepare(
      `SELECT m.id, m.licitacion_id, m.guion_id, l.expediente,
      EXISTS (SELECT 1 FROM propuestas p WHERE p.licitacion_id = m.licitacion_id AND p.resultado = 'ganada') AS ganada
    FROM memorias m JOIN licitaciones l ON l.id = m.licitacion_id LEFT JOIN borradores b ON b.id = m.borrador_id
    WHERE m.ensayo = 0 AND (m.presentada = 1 OR (b.estado = 'aceptada' AND NOT EXISTS (SELECT 1 FROM memorias x WHERE x.licitacion_id = m.licitacion_id AND x.presentada = 1)))
      AND m.version = (SELECT MAX(y.version) FROM memorias y LEFT JOIN borradores c ON c.id = y.borrador_id
        WHERE y.licitacion_id = m.licitacion_id AND y.ensayo = 0 AND (y.presentada = 1 OR c.estado = 'aceptada'))`,
    )
    .all()
    .map((f) => ({
      ...(f as { id: number; licitacion_id: string; guion_id: number; expediente: string; ganada: number }),
      ganada: (f as { ganada: number }).ganada === 1,
    }));
}

function apartadosBien(db: Db, memoriaId: number): Set<number> {
  const filas = db
    .prepare(
      `SELECT r.apartado, r.puntos, r.tramo FROM memoria_apartado_rondas r WHERE r.memoria_id = ?
    AND r.ronda = (SELECT MAX(x.ronda) FROM memoria_apartado_rondas x WHERE x.memoria_id = r.memoria_id AND x.apartado = r.apartado)`,
    )
    .all(memoriaId) as { apartado: number; puntos: number; tramo: number }[];
  return new Set(filas.filter((f) => f.tramo > 0 && f.puntos / f.tramo >= BIEN).map((f) => f.apartado));
}

function usosBien(db: Db): Uso[] {
  return memoriasFinales(db).flatMap((m) => {
    const titulos = guionPorId(db, m.guion_id)?.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
    const bien = m.ganada ? null : apartadosBien(db, m.id);
    return [...parrafosDe(db, m.id)].flatMap(([apartado, ps]) =>
      bien && !bien.has(apartado)
        ? []
        : ps
            .filter((t) => t.length >= MIN_CARACTERES)
            .map((texto) => ({
              licitacion_id: m.licitacion_id,
              expediente: m.expediente,
              apartado: titulos[apartado - 1] ?? `Apartado ${apartado}`,
              texto,
              palabras: palabrasSignificativas(texto),
            })),
    );
  });
}

function parecido(a: Set<string>, b: Set<string>): number {
  const comunes = [...a].filter((p) => b.has(p)).length;
  return comunes / Math.max(1, a.size + b.size - comunes);
}

/** Los párrafos usados bien en MIN_OFERTAS ofertas distintas o más, agrupados por parecido. */
function parrafosRepetidos(db: Db): Grupo[] {
  const grupos: { rep: Uso; usos: Uso[] }[] = [];
  for (const u of usosBien(db)) {
    const g = grupos.find((x) => parecido(x.rep.palabras, u.palabras) >= PARECIDO);
    if (g) g.usos.push(u);
    else grupos.push({ rep: u, usos: [u] });
  }
  return grupos
    .filter((g) => new Set(g.usos.map((u) => u.licitacion_id)).size >= MIN_OFERTAS)
    .map((g) => ({ texto: g.usos.at(-1)!.texto, apartado: g.rep.apartado, usos: g.usos }));
}

const huellaDe = (palabras: Set<string>) =>
  crypto
    .createHash('sha256')
    .update([...palabras].sort().join(' '))
    .digest('hex')
    .slice(0, 16);

function yaPropuesto(db: Db, palabras: Set<string>): boolean {
  const previos = db.prepare('SELECT palabras FROM parrafos_biblioteca').all() as { palabras: string }[];
  return previos.some((p) => parecido(new Set(p.palabras.split(' ')), palabras) >= PARECIDO);
}

function propuestaDe(g: Grupo): EntradaPropuesta {
  const tema = temaDeApartado(g.apartado);
  const tipo = tema === 'metodologia' || tema === 'planificacion' || tema === 'calidad' ? 'metodologia' : 'plantilla';
  const expedientes = [...new Set(g.usos.map((u) => u.expediente))];
  const titulo = `${g.apartado}: ${g.texto.split(/[.:;]/)[0]!.slice(0, 80)}`;
  const hoy = new Date().toISOString().slice(0, 10);
  const body = [
    `---\ntipo: ${tipo}\norigen_tipo: parrafo\nrevisada_en: ${hoy}\n---`,
    '',
    g.texto,
    '',
    `Usado en ${expedientes.length} memorias que funcionaron (ganadas o bien puntuadas por el crítico): ${expedientes.join(', ')}.`,
  ].join('\n');
  return {
    title: titulo,
    body,
    folder: tipo === 'metodologia' ? 'Metodologías' : 'Plantillas',
    reason: `Párrafo que se repite en ${expedientes.length} ofertas que funcionaron`,
    origin: 'plataforma',
  };
}

/**
 * Propone los párrafos repetidos que aún no se propusieron. `tapar`: los nombres de Colaboradores;
 * un párrafo que nombra a alguien no va a la Biblioteca. `crear`: crearPropuesta (la frontera).
 */
export async function proponerParrafosRepetidos(
  db: Db,
  tapar: ((t: string) => string) | null,
  crear: (p: EntradaPropuesta) => Promise<{ path: string }>,
): Promise<number> {
  let n = 0;
  for (const g of parrafosRepetidos(db)) {
    const palabras = palabrasSignificativas(g.texto);
    if (yaPropuesto(db, palabras) || (tapar && tapar(g.texto) !== g.texto)) continue;
    try {
      const p = propuestaDe(g);
      const { path } = await crear(p);
      db.prepare(
        'INSERT OR IGNORE INTO parrafos_biblioteca (huella, titulo, palabras, propuesta, licitaciones, creada_en) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        huellaDe(palabras),
        p.title,
        [...palabras].join(' '),
        path,
        JSON.stringify([...new Set(g.usos.map((u) => u.licitacion_id))]),
        new Date().toISOString(),
      );
      n += 1;
    } catch (err) {
      log.warn('párrafo repetido sin proponer', { error: errorMessage(err).slice(0, 200) });
    }
  }
  return n;
}

const DIA_MS = 86_400_000;
let ultimaVez = 0;

/** En la vuelta: una vez al día como mucho (recorre los párrafos de todas las memorias finales). */
export async function proponerParrafosSiToca(
  db: Db,
  tapar: ((t: string) => string) | null,
  crear: (p: EntradaPropuesta) => Promise<{ path: string }>,
  ahoraMs = Date.now(),
): Promise<number> {
  if (ahoraMs - ultimaVez < DIA_MS) return 0;
  ultimaVez = ahoraMs;
  return proponerParrafosRepetidos(db, tapar, crear);
}
