// Las fugas entre sobres (fugas.ts) de una memoria guardada, con el guion de su versión y lo decidido ahora.
import { nombreGuardado } from '../../../nucleo/empresa.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { decisionesDe } from './decisiones.js';
import { contextoDeFugas, descripcionDeFuga, detectarFugas, type ContextoFugas, type Fuga } from './fugas.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { ApartadoDatos, fugasDeApartado, type ApartadoDatosData } from './memoriaRevision.js';
import { parrafosDeVersionEntera } from './textoEntero.js';

// También se miran los nombres propios de la licitación. Las usan el apartado que llega, el documento ensamblado
// o subido, la web y «Dar por buena». Solo lee la base.
// apartado 0: una versión subida entera, sin apartados (subidaFlexible.ts); la fuga está en el texto entero.
export type FugaEnMemoria = Fuga & { apartado: number; titulo: string; descripcion: string };
// Lo que dijo quien la dio por buena con fugas detectadas, y cuáles anuló. heredada_de: la
// versión de la que se copió la anulación porque sus frases siguen igual (fugasHeredadas).
export type AnulacionFugas = {
  motivo: string;
  en: string;
  fugas: Pick<FugaEnMemoria, 'apartado' | 'tipo' | 'marca' | 'criterio' | 'cita'>[];
  heredada_de?: number;
};

const PREFIJO_AVISO_FUGA = 'Fuga entre sobres';

/**
 * El nombre del órgano, el título de la licitación y el de la empresa: se pueden citar aunque
 * contengan una marca, y el de la empresa sale en casi todas las frases sin decir de qué hablan.
 */
export function nombresPropiosDe(db: Db, id: string): string[] {
  const l = db.prepare('SELECT titulo, organo_nombre FROM licitaciones WHERE id = ?').get(id) as
    { titulo: string; organo_nombre: string } | undefined;
  return l ? [l.organo_nombre, l.titulo, nombreGuardado(db) ?? ''].filter(Boolean) : [];
}

/** Los nombres del equipo de las decisiones (personas de nucleo.db, adjunta). */
export function nombresDelEquipo(db: Db, id: string): string[] {
  const ids = decisionesDe(db, id)?.datos.equipo.map((m) => m.persona_id) ?? [];
  if (!ids.length) return [];
  return (
    db
      .prepare('SELECT nombre FROM nucleo.personas WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as { nombre: string }[]
  ).map((p) => p.nombre);
}

/** Lo que se vigila en una memoria de este guion: con las decisiones de ahora (lo que la empresa ha ofrecido). */
export function contextoFugasDe(db: Db, guion: GuionGuardado): ContextoFugas {
  const id = guion.licitacion_id;
  const d = decisionesDe(db, id)?.datos;
  return contextoDeFugas({
    guion: guion.datos,
    decididos: d?.automaticos,
    herramientas: d?.herramientas,
    nombresPropios: nombresPropiosDe(db, id),
    equipo: nombresDelEquipo(db, id),
  });
}

/** Lo redactado de un apartado guardado (null si no llegó o ya no valida). */
export function datosDeFila(f: { estado: string; datos: string | null } | undefined): ApartadoDatosData | null {
  if (f?.estado !== 'recibido' || !f.datos) return null;
  const d = ApartadoDatos.safeParse(JSON.parse(f.datos));
  return d.success ? d.data : null;
}

/** Las fugas de una memoria entera, apartado a apartado (en el orden del guion). */
export function fugasDeApartados(
  guion: GuionGuardado,
  apartados: (ApartadoDatosData | null)[],
  ctx: ContextoFugas,
): FugaEnMemoria[] {
  const titulos = guion.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
  return apartados.flatMap((d, i) =>
    (d ? fugasDeApartado(d, ctx) : []).map(({ bloque: _bloque, ...f }) => ({
      ...f,
      apartado: i + 1,
      titulo: titulos[i] ?? `Apartado ${i + 1}`,
      descripcion: descripcionDeFuga(f),
    })),
  );
}

const TEXTO_ENTERO = 'Texto entero';

/** Las fugas de un texto sin apartados (una versión subida entera), como apartado 0. */
export function fugasDeTexto(texto: string, ctx: ContextoFugas): FugaEnMemoria[] {
  return detectarFugas(texto, ctx).map((f) => ({
    ...f,
    apartado: 0,
    titulo: TEXTO_ENTERO,
    descripcion: descripcionDeFuga(f),
  }));
}

/** «apartado N» o, de una versión entera, «texto». */
export const lugarDeFuga = (f: Pick<FugaEnMemoria, 'apartado'>): string =>
  f.apartado > 0 ? `apartado ${f.apartado}` : 'texto';

/**
 * Las fugas de una memoria ensamblada (vacío si aún se redacta o su guion ya no está). Una
 * versión subida entera no tiene apartados: se buscan en su texto, el mismo que lee el paquete,
 * para que «Dar por buena» pida el motivo y su anulación desbloquee el paquete.
 */
export function fugasDeMemoria(db: Db, memoriaId: number): FugaEnMemoria[] {
  const m = db.prepare('SELECT guion_id, estado, sin_repartir FROM memorias WHERE id = ?').get(memoriaId) as
    { guion_id: number; estado: string; sin_repartir: number } | undefined;
  const guion = m?.estado === 'ensamblada' ? guionPorId(db, m.guion_id) : null;
  if (!guion) return [];
  if (m!.sin_repartir)
    return fugasDeTexto(parrafosDeVersionEntera(db, memoriaId).join('\n'), contextoFugasDe(db, guion));
  const filas = db
    .prepare('SELECT apartado, estado, datos FROM memoria_apartados WHERE memoria_id = ?')
    .all(memoriaId) as { apartado: number; estado: string; datos: string | null }[];
  const total = guion.datos.memoria?.apartados.length ?? 0;
  const datos = Array.from({ length: total }, (_, i) => datosDeFila(filas.find((f) => f.apartado === i + 1)));
  return fugasDeApartados(guion, datos, contextoFugasDe(db, guion));
}

/** Las de la memoria de un borrador (vacío si el borrador no es una memoria ensamblada). */
export function fugasDeBorrador(db: Db, borradorId: number): FugaEnMemoria[] {
  const b = db.prepare("SELECT memoria_id FROM borradores WHERE id = ? AND origen = 'ensamblado'").get(borradorId) as
    { memoria_id: number | null } | undefined;
  return b?.memoria_id ? fugasDeMemoria(db, b.memoria_id) : [];
}

/** Los avisos del borrador: qué y dónde, sin la cita (puede nombrar a personas del equipo). */
export function avisosDeFugas(fugas: FugaEnMemoria[]): string[] {
  return [
    ...new Set(
      fugas.map(
        (f) =>
          `${PREFIJO_AVISO_FUGA} en el ${lugarDeFuga(f)}: ${f.descripcion}. Es causa de exclusión: corrígelo antes de darla por buena.`,
      ),
    ),
  ];
}

// La frase, sin tildes, mayúsculas ni espacios de más: un retoque de formato no es otra frase.
const frase = (cita: string): string => textoComparable(cita).replace(/\s+/g, ' ').trim();

/**
 * Lo anulado que vale para una versión nueva: las fugas nuevas cuya frase es la misma que una
 * anulada en la versión de la que parte (desde). Si la frase cambió, se vuelve a revisar. null
 * si no hereda ninguna.
 */
export function fugasHeredadas(
  anulacion: AnulacionFugas | null,
  nuevas: FugaEnMemoria[],
  desde: number,
): AnulacionFugas | null {
  if (!anulacion) return null;
  const anuladas = new Set(anulacion.fugas.map((f) => frase(f.cita)));
  const fugas = nuevas
    .filter((f) => anuladas.has(frase(f.cita)))
    .map(({ apartado, tipo, marca, criterio, cita }) => ({ apartado, tipo, marca, criterio, cita }));
  return fugas.length ? { motivo: anulacion.motivo, en: anulacion.en, fugas, heredada_de: desde } : null;
}

/** Copia a una memoria ensamblada lo anulado en la versión de la que parte; devuelve cuántas fugas heredó. */
export function heredarAnulacion(db: Db, memoriaId: number, desde: { id: number; version: number }): number {
  const previa = db.prepare('SELECT anulacion_fugas AS a FROM memorias WHERE id = ?').get(desde.id) as
    { a: string | null } | undefined;
  const heredada = fugasHeredadas(
    previa?.a ? (JSON.parse(previa.a) as AnulacionFugas) : null,
    fugasDeMemoria(db, memoriaId),
    desde.version,
  );
  if (!heredada) return 0;
  db.prepare('UPDATE memorias SET anulacion_fugas = ? WHERE id = ? AND anulacion_fugas IS NULL').run(
    JSON.stringify(heredada),
    memoriaId,
  );
  return heredada.fugas.length;
}
