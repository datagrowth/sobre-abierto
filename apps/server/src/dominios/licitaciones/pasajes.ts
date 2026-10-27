// Pasajes de los pliegos de una licitación por tema (solvencia, medios, criterios…), con documento y página.
import path from 'node:path';
import { CARACTERES_TROZO } from '../../biblioteca/motor/documentos/trozos.js';
import { abrirIndiceLectura, busquedaSemantica } from '../../biblioteca/motor/documentos/servicioIndice.js';
import { consultaFts } from '../../biblioteca/motor/documentos/busquedaHibrida.js';
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import type { Db } from './store.js';
import { estadoEnIndice, type Legibilidad } from './pliegosIndice.js';
import { DEFINICION, marcasDe, TEMAS_FICHA, textoComparable, type Tema } from './temas.js';

// Sustituye a leer cada pliego de principio a fin (un PCAP de 150 páginas eran 14 lecturas): Hermes empieza por
// aquí y lee entera, por páginas, solo la cláusula o el cuadro que necesita. Cada trozo se puntúa por las marcas
// del tema (regex, deterministas) más su puesto en la búsqueda por palabras y por significado.
export type Pasaje = { ruta: string; clase: string; pagina: number | null; texto: string };
type PasajesTema = { tema: Tema; etiqueta: string; encontrado: boolean; pasajes: Pasaje[] };
export type Pasajes = {
  id: string;
  documentos: Legibilidad[];
  temas: PasajesTema[];
  sin_pasajes: Tema[];
  aviso: string | null;
};
export type Semantica = (texto: string, k: number, ids: number[]) => Promise<{ id: number; score: number }[]>;
export type OpcionesPasajes = {
  temas?: readonly Tema[];
  maxPorTema?: number;
  maxCaracteres?: number;
  semantica?: Semantica;
};

const RRF_K = 60;
const POOL = 20;
// Ser el primero en las dos búsquedas de una consulta vale como una marca.
const PESO_BUSQUEDA = 30;
// Sin ninguna marca del tema, un trozo solo entra si la búsqueda por significado lo pone entre
// los primeros y muy parecido (e5 da ≈0,78–0,81 a lo que no tiene relación). La búsqueda por
// palabras no basta: une términos con OR y «empresas» o «servicio» salen en todo el pliego.
const PUESTOS_SIN_MARCAS = 3;
const SIMILITUD_SIN_MARCAS = 0.83;
const ORDEN_CLASE: Record<string, number> = { pcap: 0, ppt: 1 };
// Un trozo del índice es un párrafo (≤ CARACTERES_TROZO): el pasaje sigue con lo que viene detrás en
// el mismo pliego hasta este largo, para que la cláusula o la prestación llegue entera.
export const LARGO_PASAJE = 3000;
// Texto de todos los pasajes de una respuesta (la tool deja sitio aparte para el JSON): con
// muchos temas a la vez, cada pasaje se acorta para que lleguen todos sin recorte.
const PRESUPUESTO_TEXTO = 120_000;

// pos: su sitio en la lista de candidatos, que va por documento y en orden de lectura.
type Candidato = { chunk: indice.AciertoTrozo; clase: string; comparable: string; pos: number };
type Busqueda = { puntos: Map<number, number>; arriba: Set<number> };

function documentosDe(dbLic: Db, id: string, idx: indice.BaseDatos): Legibilidad[] {
  const filas = dbLic
    .prepare(
      "SELECT ruta, clase FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL ORDER BY rowid",
    )
    .all(id) as { ruta: string; clase: string }[];
  return filas.map((f) => ({ ...f, ...estadoEnIndice(idx, f.ruta) }));
}

function porPalabras(idx: indice.BaseDatos, consulta: string, rutas: string[]): number[] {
  const match = consultaFts(consulta);
  if (!match) return [];
  try {
    return indice.buscarFtsEnRutas(idx, match, rutas, POOL).map((c) => c.id);
  } catch {
    return []; // consulta que FTS5 no acepta o índice a medio crear
  }
}

async function buscar(
  idx: indice.BaseDatos,
  tema: Tema,
  rutas: string[],
  ids: number[],
  semantica: Semantica,
): Promise<Busqueda> {
  const puntos = new Map<number, number>();
  const arriba = new Set<number>();
  for (const consulta of DEFINICION[tema].consultas) {
    const parecidos = await semantica(consulta, POOL, ids);
    for (const lista of [porPalabras(idx, consulta, rutas), parecidos.map((h) => h.id)]) {
      lista.forEach((id, puesto) => puntos.set(id, (puntos.get(id) ?? 0) + 1 / (RRF_K + puesto)));
    }
    parecidos
      .slice(0, PUESTOS_SIN_MARCAS)
      .filter((h) => h.score >= SIMILITUD_SIN_MARCAS)
      .forEach((h) => arriba.add(h.id));
  }
  return { puntos, arriba };
}

// Trozos enteros (nada cortado a media frase) y de la misma página: la página del pasaje vale
// para todo su texto (el guion la cita). Lo que siga en la página siguiente, por páginas.
function textoDelPasaje(candidatos: Candidato[], desde: Candidato, max: number): string {
  let texto = desde.chunk.text;
  for (let i = desde.pos + 1; i < candidatos.length; i += 1) {
    const sig = candidatos[i]!.chunk;
    if (sig.path !== desde.chunk.path || sig.page !== desde.chunk.page || texto.length + 2 + sig.text.length > max)
      break;
    texto += `\n\n${sig.text}`;
  }
  return texto.slice(0, max);
}

function elegir(
  tema: Tema,
  candidatos: Candidato[],
  b: Busqueda,
  op: Required<Pick<OpcionesPasajes, 'maxPorTema' | 'maxCaracteres'>>,
): Pasaje[] {
  return candidatos
    .map((c) => ({ c, marcas: marcasDe(tema, c.comparable), busqueda: b.puntos.get(c.chunk.id) ?? 0 }))
    .filter((x) => x.marcas > 0 || b.arriba.has(x.c.chunk.id))
    .map((x) => ({ ...x, puntos: x.marcas + PESO_BUSQUEDA * x.busqueda }))
    .sort(
      (a, b2) =>
        b2.puntos - a.puntos ||
        (ORDEN_CLASE[a.c.clase] ?? 2) - (ORDEN_CLASE[b2.c.clase] ?? 2) ||
        (a.c.chunk.page ?? 0) - (b2.c.chunk.page ?? 0),
    )
    .slice(0, op.maxPorTema)
    .map(({ c }) => ({
      ruta: c.chunk.path,
      clase: c.clase,
      pagina: c.chunk.page,
      texto: textoDelPasaje(candidatos, c, op.maxCaracteres),
    }));
}

/** Largo de cada pasaje: el pedido, sin pasar del presupuesto de la respuesta (y nunca menos de un trozo). */
export function largoDePasaje(pedido: number, temas: number, maxPorTema: number): number {
  return Math.min(pedido, Math.max(CARACTERES_TROZO, Math.floor(PRESUPUESTO_TEXTO / Math.max(1, temas * maxPorTema))));
}

function rechazo(documentos: Legibilidad[]): Result<never> {
  if (!documentos.length) return fail('sin_pliegos', 'Aún no hay pliegos descargados de esta licitación.');
  if (documentos.some((d) => d.estado_indice === 'sin_indexar'))
    return fail('no_indexado', 'Los pliegos aún no están en el índice de la Biblioteca: prueba en unos minutos.');
  return fail(
    'ilegible',
    `Ningún pliego se puede leer: ${documentos.map((d) => `${path.posix.basename(d.ruta)} (${d.error_indice ?? d.estado_indice})`).join('; ')}.`,
  );
}

/** Pasajes por tema de los pliegos ya indexados de una licitación. */
export async function pasajesDeLicitacion(
  dbLic: Db,
  id: string,
  op: OpcionesPasajes = {},
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): Promise<Result<Pasajes>> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  if (!idx) return fail('no_indexado', 'La Biblioteca aún no tiene índice: prueba en unos minutos.');
  const documentos = documentosDe(dbLic, id, idx);
  const legibles = documentos.filter((d) => d.estado_indice === 'ok');
  if (!legibles.length) return rechazo(documentos);
  const clase = new Map(legibles.map((d) => [d.ruta, d.clase]));
  const chunks = indice.trozosDeRutas(idx, [...clase.keys()]);
  const candidatos = chunks.map((c, pos) => ({
    chunk: c,
    clase: clase.get(c.path) ?? 'adicional',
    comparable: textoComparable(c.text),
    pos,
  }));
  const pedidos = op.temas?.length ? op.temas : TEMAS_FICHA;
  const maxPorTema = op.maxPorTema ?? 4;
  const opciones = {
    maxPorTema,
    maxCaracteres: largoDePasaje(op.maxCaracteres ?? LARGO_PASAJE, pedidos.length, maxPorTema),
  };
  const semantica = op.semantica ?? busquedaSemantica;
  const temas: PasajesTema[] = [];
  for (const tema of pedidos) {
    const pasajes = elegir(
      tema,
      candidatos,
      await buscar(
        idx,
        tema,
        [...clase.keys()],
        chunks.map((c) => c.id),
        semantica,
      ),
      opciones,
    );
    temas.push({ tema, etiqueta: DEFINICION[tema].etiqueta, encontrado: pasajes.length > 0, pasajes });
  }
  const noLeidos = documentos
    .filter((d) => d.estado_indice !== 'ok')
    .map((d) => `${path.posix.basename(d.ruta)} (${d.error_indice ?? d.estado_indice})`);
  const aviso = noLeidos.length
    ? `Estos pliegos no se pueden leer y no están en los pasajes: ${noLeidos.join('; ')}.`
    : null;
  return ok({ id, documentos, temas, sin_pasajes: temas.filter((t) => !t.encontrado).map((t) => t.tema), aviso });
}
