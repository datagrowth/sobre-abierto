// Evidencia en el CV de una persona: si su CV menciona una materia y en qué página.
import { z } from 'zod';
import type { Db } from '../db.js';
import { abrirIndiceLectura } from '../../biblioteca/motor/documentos/servicioIndice.js';
import { trozosDeArchivo } from '../../biblioteca/motor/documentos/almacen.js';
import { errorMessage, fail, ok, type Result } from '../result.js';
import { logger } from '../log.js';
import { obtenerPersona } from './personas.js';

// La matriz de equipo enlaza la celda ✗ con «#/equipo/<id>#campo=topografía» y la ficha pregunta aquí para
// añadirlo a su experiencia con un clic. Solo se lee el CV de ESA persona (su cv_ruta en el índice de la
// Biblioteca), nunca una búsqueda sobre Colaboradores/: así no se cuela un CV ajeno.
const ConsultaEvidencia = z.strictObject({ materia: z.string().trim().min(2).max(80) });
export type Trozo = { page: number | null; text: string };
export type Fragmento = { ruta: string; pagina: number | null; texto: string };

/** Los trozos indexados de un archivo de la Biblioteca. Es la frontera con el índice (en tests, un doble). */
export type LectorCv = (ruta: string) => Result<Trozo[]>;

const MAX_FRAGMENTOS = 5;
const CONTEXTO = 110;
const log = logger('colaboradores');

const leerCvIndexado: LectorCv = (ruta) => {
  try {
    const db = abrirIndiceLectura();
    if (!db) return fail('biblioteca_no_disponible', 'La Biblioteca aún no tiene índice: no se puede leer el CV.');
    return ok(trozosDeArchivo(db, ruta));
  } catch (err) {
    // Solo el mensaje: la ruta de un CV lleva el nombre de la persona.
    log.warn('CV sin leer del índice', { error: errorMessage(err).slice(0, 200) });
    return fail('biblioteca_no_disponible', 'No se ha podido leer el CV ahora.');
  }
};

// Letra a letra, sin acentos ni mayúsculas, guardando dónde empieza cada una en el texto original.
function plano(texto: string): { texto: string; origen: number[] } {
  const letras = Array.from(texto);
  const origen: number[] = [];
  let out = '';
  let pos = 0;
  for (const l of letras) {
    const n = l
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    for (let i = 0; i < n.length; i++) origen.push(pos);
    out += n;
    pos += l.length;
  }
  return { texto: out, origen };
}

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «Topografía y jardinería» → la frase entera, sin acentos ni mayúsculas y con plurales («jardinerías»). */
function patronMateria(materia: string): RegExp {
  const palabras = plano(materia)
    .texto.split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => `${escapar(w)}(?:e?s)?`);
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${palabras.join('[^\\p{L}\\p{N}]+')})(?=$|[^\\p{L}\\p{N}])`, 'u');
}

/** ¿Nombra el texto la materia como frase entera? */
export const mencionaMateria = (texto: string, materia: string) => patronMateria(materia).test(plano(texto).texto);

function fragmentoDe(t: Trozo, patron: RegExp): string | null {
  const p = plano(t.text);
  const m = patron.exec(p.texto);
  if (!m) return null;
  const inicio = p.origen[m.index + m[1]!.length] ?? 0;
  const desde = Math.max(0, inicio - CONTEXTO);
  const hasta = Math.min(t.text.length, inicio + m[2]!.length + CONTEXTO);
  const trozo = t.text.slice(desde, hasta).replace(/\s+/g, ' ').trim();
  return `${desde > 0 ? '…' : ''}${trozo}${hasta < t.text.length ? '…' : ''}`;
}

/** Dónde menciona el CV de la persona `id` la materia, con su página; vacío si no tiene CV o no la nombra. */
export function evidenciaEnCv(
  db: Db,
  id: number,
  entrada: unknown,
  lector: LectorCv = leerCvIndexado,
): Result<{ fragmentos: Fragmento[] }> {
  const c = ConsultaEvidencia.safeParse(entrada);
  if (!c.success) return fail('invalid_input', z.prettifyError(c.error));
  const persona = obtenerPersona(db, id);
  if (persona.error) return persona;
  const ruta = persona.data.cv_ruta;
  if (!ruta) return ok({ fragmentos: [] });
  const trozos = lector(ruta);
  if (trozos.error) return trozos;
  const patron = patronMateria(c.data.materia);
  const fragmentos: Fragmento[] = [];
  for (const t of trozos.data) {
    const texto = fragmentoDe(t, patron);
    if (texto) fragmentos.push({ ruta, pagina: t.page, texto });
    if (fragmentos.length >= MAX_FRAGMENTOS) break;
  }
  return ok({ fragmentos });
}
