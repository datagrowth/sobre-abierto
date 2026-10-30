// Lo que se aprende de cómo acabó una oferta, en el mismo libro que las lecciones de la edición.
import { OpcionesPrecios, preciosDeLicitacion } from '../precios/index.js';
import {
  insertarLecciones,
  soltarPendientes,
  type EvidenciaData,
  type NuevaLeccion,
} from '../oferta/libroLecciones.js';
import { temaDeApartado } from '../oferta/temasApartado.js';
import type { Db } from '../store.js';
import { aprendizajesDe, palabrasSignificativas, type AprendizajeDatosData } from './aprendizaje.js';

const MAX_EVIDENCIA = 600;
// Hay tres orígenes:
// - mesa: las lecciones de un acta leída por Hermes, cada una con el criterio que más se le parece como
//   evidencia (puntos de la empresa y del ganador y el comentario literal);
// - decisión y precio: las saca el código del resultado, sin IA. Decisión: la empresa perdió contra quien ya
//   había ganado varias veces en ese órgano. Precio: la baja de la empresa frente a la ganadora y a la mediana
//   del segmento.
// Entran pendientes; una persona las acepta, ajusta su alcance o las descarta. Volver a leer el acta o a
// resolver la propuesta sustituye solo las pendientes.
// Como LICITACIONES_PRECIOS_MINIMO por defecto, para quien no tiene la configuración a mano.
export const MINIMO_PRECIOS = 20;
const pct = (x: number) => `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;

// ── Mesa ──

type Criterio = AprendizajeDatosData['criterios'][number];

// El criterio con más palabras en común con la lección; sin ninguna, el en el que la empresa perdió más puntos.
function criterioDe(texto: string, criterios: readonly Criterio[]): Criterio | null {
  const suyas = palabrasSignificativas(texto);
  const comunes = (c: Criterio) => [...palabrasSignificativas(c.criterio)].filter((p) => suyas.has(p)).length;
  const perdidos = (c: Criterio) => (c.ganador ?? 0) - (c.nuestros ?? 0);
  return [...criterios].sort((a, b) => comunes(b) - comunes(a) || perdidos(b) - perdidos(a))[0] ?? null;
}

function evidenciaDeCriterio(c: Criterio): string {
  const ganador = c.ganador !== null ? ` (ganador ${c.ganador})` : '';
  const dijo = c.comentario_mesa ? ` La mesa: «${c.comentario_mesa}»` : '';
  return `${c.nuestros ?? '?'}/${c.puntos_max}${ganador}.${dijo}`.slice(0, MAX_EVIDENCIA);
}

export type ActaParaLecciones = {
  id: number;
  licitacion_id: string | null;
  organo: string | null;
  documento: string;
  datos: AprendizajeDatosData;
  agente: string;
};

/**
 * Las lecciones de un acta, en el libro: las pendientes de esa acta se sustituyen. `tapar`: los
 * nombres de Colaboradores, que salen de la evidencia (el comentario de la mesa es literal y puede
 * nombrar a quien propusimos).
 */
export function leccionesDeActa(db: Db, a: ActaParaLecciones, tapar: ((t: string) => string) | null = null): number {
  soltarPendientes(db, 'aprendizaje_id = ?', a.id, (e) => e.documento === a.documento);
  return insertarLecciones(
    db,
    a.datos.lecciones.map((texto): NuevaLeccion => {
      const c = criterioDe(texto, a.datos.criterios);
      const ubicacion = c ? `criterio «${c.criterio}»${c.pagina ? `, pág. ${c.pagina}` : ''}` : null;
      return {
        licitacion_id: a.licitacion_id,
        aprendizaje_id: a.id,
        origen: 'mesa',
        alcance: a.organo ? 'organo' : 'general',
        alcance_valor: a.organo,
        tema: temaDeApartado(c?.criterio) ?? temaDeApartado(texto),
        texto,
        agente: a.agente,
        evidencias: [
          {
            licitacion_id: a.licitacion_id,
            memoria_id: null,
            documento: a.documento,
            ubicacion,
            texto: c ? (tapar ?? ((t: string) => t))(evidenciaDeCriterio(c)) : '',
          },
        ],
      };
    }),
  );
}

/**
 * Las actas leídas antes de que hubiera libro dejan sus lecciones, pendientes, al arrancar.
 * Una vez: un acta cuya lección ya está en el libro (propia o sumada a otra) no se vuelve a pasar.
 */
export function leccionesDeActasAnteriores(db: Db, tapar: ((t: string) => string) | null): number {
  const yaEsta = db.prepare('SELECT 1 FROM lecciones WHERE aprendizaje_id = ? OR instr(evidencias, ?) > 0 LIMIT 1');
  const sin = aprendizajesDe(db).filter(
    (a) => a.datos.lecciones.length && !yaEsta.get(a.id, JSON.stringify(a.documento)),
  );
  for (const a of sin) leccionesDeActa(db, a, tapar);
  return sin.length;
}

// ── Decisión y precio ──

type Resuelta = {
  id: number;
  licitacion_id: string;
  lote: string;
  resultado: string;
  baja_ofertada: number | null;
  baja_ganadora: number | null;
  ganador_nif: string | null;
  organo_nombre: string;
  organo_nif: string | null;
  organo_norm: string | null;
  cpvs: string;
  tipo_contrato: string | null;
};

const AÑOS_ANTECEDENTES = 5;
const MIN_VICTORIAS_PREVIAS = 2;
const MARGEN_PRECIO = 0.03;
const MARGEN_REGALADO = 0.05;

const ubicacionDe = (r: Resuelta) => (r.lote ? `lote ${r.lote}` : 'contrato entero');
const DOCUMENTO_RESOLUCION = 'Resolución publicada en la PLACSP';
const evidencia = (r: Resuelta, texto: string): EvidenciaData[] => [
  {
    licitacion_id: r.licitacion_id,
    memoria_id: null,
    documento: DOCUMENTO_RESOLUCION,
    ubicacion: ubicacionDe(r),
    texto,
  },
];
const cpvDe = (r: Resuelta) => r.cpvs.split(',').find(Boolean)?.slice(0, 4) ?? null;

// Cuántas veces ganó antes el adjudicatario en el mismo órgano (por NIF o, sin él, por nombre).
function victoriasPrevias(db: Db, r: Resuelta): number {
  if (!r.ganador_nif) return 0;
  const desde = `${new Date().getUTCFullYear() - AÑOS_ANTECEDENTES}-01-01`;
  const mismo = r.organo_nif ? 'a.organo_nif = @nif' : 'l.organo_norm = @norm';
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT a.licitacion_id) AS n FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id
    WHERE a.adjudicatario_nif = @ganador AND a.licitacion_id <> @id AND ${mismo} AND a.fecha_ref >= @desde`,
      )
      .get({ ganador: r.ganador_nif, id: r.licitacion_id, nif: r.organo_nif, norm: r.organo_norm, desde }) as {
      n: number;
    }
  ).n;
}

function leccionDeDecision(db: Db, r: Resuelta): NuevaLeccion | null {
  if (r.resultado !== 'perdida') return null;
  const n = victoriasPrevias(db, r);
  if (n < MIN_VICTORIAS_PREVIAS) return null;
  return {
    licitacion_id: r.licitacion_id,
    origen: 'decision',
    alcance: 'organo',
    alcance_valor: r.organo_nombre,
    tema: null,
    agente: 'plataforma',
    texto: `En este órgano, el adjudicatario ya había ganado ${n} contratos: no vayas sin una relación previa o un diferencial claro.`,
    evidencias: evidencia(
      r,
      `Perdida. El adjudicatario ganó ${n} contratos más de ${r.organo_nombre} en los últimos ${AÑOS_ANTECEDENTES} años.`,
    ),
  };
}

function medianaDelSegmento(db: Db, r: Resuelta, minimo: number): number | null {
  const p = preciosDeLicitacion(db, r.licitacion_id, OpcionesPrecios.parse(r.lote ? { lote: r.lote } : {}), minimo);
  return p.data?.estadistica.n ? p.data.estadistica.percentiles.p50 : null;
}

function leccionDePrecio(db: Db, r: Resuelta, minimo: number): NuevaLeccion | null {
  if (r.baja_ofertada === null) return null;
  const base = { licitacion_id: r.licitacion_id, origen: 'precio' as const, tema: null, agente: 'plataforma' };
  const nuestra = r.baja_ofertada;
  if (r.resultado === 'perdida' && r.baja_ganadora !== null) {
    const datos = `Nuestra baja ${pct(nuestra)}, la ganadora ${pct(r.baja_ganadora)}.`;
    if (r.baja_ganadora - nuestra >= MARGEN_PRECIO) {
      return {
        ...base,
        alcance: 'cpv',
        alcance_valor: cpvDe(r),
        evidencias: evidencia(r, datos),
        texto: `En contratos de este CPV la ganadora bajó un ${pct(r.baja_ganadora)}: con un ${pct(nuestra)} perdimos por precio; acércate si el margen lo permite.`,
      };
    }
    if (nuestra - r.baja_ganadora >= MARGEN_PRECIO) {
      return {
        ...base,
        alcance: 'organo',
        alcance_valor: r.organo_nombre,
        evidencias: evidencia(r, datos),
        texto: `En este órgano perdimos con más baja que la ganadora (${pct(nuestra)} frente a ${pct(r.baja_ganadora)}): la parte técnica pesa más que el precio.`,
      };
    }
    return null;
  }
  const mediana = r.resultado === 'ganada' ? medianaDelSegmento(db, r, minimo) : null;
  if (mediana === null || nuestra - mediana < MARGEN_REGALADO) return null;
  return {
    ...base,
    alcance: 'cpv',
    alcance_valor: cpvDe(r),
    evidencias: evidencia(r, `Ganada con una baja del ${pct(nuestra)}; la mediana del segmento es un ${pct(mediana)}.`),
    texto: `Ganamos bajando un ${pct(nuestra)} cuando la mediana del segmento es un ${pct(mediana)}: prueba una baja más cerca de la mediana.`,
  };
}

/** Al resolverse una propuesta (PLACSP o a mano): sus lecciones de decisión y de precio, pendientes. */
export function leccionesDeResolucion(db: Db, propuestaId: number, minimoPrecios = MINIMO_PRECIOS): number {
  const r = db
    .prepare(
      `SELECT p.id, p.licitacion_id, p.lote, p.resultado, p.baja_ofertada, p.baja_ganadora, p.ganador_nif,
      l.organo_nombre, l.organo_nif, l.organo_norm, l.cpvs, l.tipo_contrato
    FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id WHERE p.id = ?`,
    )
    .get(propuestaId) as Resuelta | undefined;
  if (!r) return 0;
  const deEsta = (e: EvidenciaData) =>
    e.licitacion_id === r.licitacion_id && e.ubicacion === ubicacionDe(r) && e.documento === DOCUMENTO_RESOLUCION;
  soltarPendientes(db, "origen IN ('decision', 'precio') AND evidencias LIKE ?", `%${r.licitacion_id}%`, deEsta);
  const nuevas = [leccionDeDecision(db, r), leccionDePrecio(db, r, minimoPrecios)].filter(
    (x): x is NuevaLeccion => x !== null,
  );
  return insertarLecciones(db, nuevas);
}
