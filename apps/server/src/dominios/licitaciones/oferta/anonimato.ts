// El equipo sin nombres cuando el pliego lo pide (CV anonimizados), en cualquier versión de la memoria.
import type { Db } from '../store.js';
import { equipoAnonimo } from './dossier.js';
import { datosDeFila, nombresDelEquipo } from './fugasMemoria.js';
import { guionPorId, guionVigente } from './guion.js';
import { nombresDelEquipoEn } from './hechos.js';
import { textoDeBloque, type ApartadoDatosData } from './memoriaRevision.js';

// Vale tanto la memoria redactada como la subida a mano (sus apartados se guardan igual). Solo lee la base; lo
// que devuelve no lleva nombres, porque también lo leen la web y licitaciones_oferta.
export type AnonimatoMemoria = { exige: boolean; apartados: number[]; personas: number };

/** Los apartados (1-based, textos[i] es el i+1) que nombran a alguien del equipo y a cuántas personas distintas. */
export function apartadosQueNombran(textos: string[], equipo: string[]): { apartado: number; personas: number }[] {
  return textos.flatMap((t, i) => {
    const personas = new Set(nombresDelEquipoEn(t, equipo)).size;
    return personas ? [{ apartado: i + 1, personas }] : [];
  });
}

// Todo lo que se lee de un apartado: el título y sus bloques con figuras e imágenes. No es el
// textoDeApartado de redaccion.ts (el que va a Hermes): este es solo para buscar nombres.
function textoLeidoDeApartado(d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>): string {
  return [d.titulo, ...d.bloques.map(textoDeBloque)].join('\n');
}

/**
 * Lo que dice de anonimato una memoria ensamblada (null si aún se redacta). El pliego se lee en el
 * guion VIGENTE: una versión hecha con un guion que no lo pedía tampoco puede presentarse con nombres.
 */
export function anonimatoDeMemoria(db: Db, memoriaId: number): AnonimatoMemoria | null {
  const m = db.prepare('SELECT licitacion_id, guion_id, estado FROM memorias WHERE id = ?').get(memoriaId) as
    { licitacion_id: string; guion_id: number; estado: string } | undefined;
  if (m?.estado !== 'ensamblada') return null;
  const guion = guionVigente(db, m.licitacion_id) ?? guionPorId(db, m.guion_id);
  if (!guion) return null;
  if (!equipoAnonimo(guion.datos)) return { exige: false, apartados: [], personas: 0 };
  const filas = db
    .prepare('SELECT apartado, estado, datos FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(memoriaId) as { apartado: number; estado: string; datos: string | null }[];
  const total = Math.max(0, ...filas.map((f) => f.apartado));
  const textos = Array.from({ length: total }, (_, i) => {
    const d = datosDeFila(filas.find((f) => f.apartado === i + 1));
    return d ? textoLeidoDeApartado(d) : '';
  });
  const equipo = nombresDelEquipo(db, m.licitacion_id);
  return {
    exige: true,
    apartados: apartadosQueNombran(textos, equipo).map((a) => a.apartado),
    personas: new Set(textos.flatMap((t) => nombresDelEquipoEn(t, equipo))).size,
  };
}
