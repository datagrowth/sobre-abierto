// Borradores de la propuesta en Salidas/Licitaciones/<expediente> (<id>)/.
import { ahora, type Db as DbNucleo } from '../../../nucleo/db.js';
import { limpiarNombre } from '../../../nucleo/nombres.js';
import { guardarOperacion, leerOperacion } from '../../../nucleo/operaciones.js';
import type { Db } from '../store.js';
import { carpetaUnicaDe, ofertaEnUnica } from '../carpetasUnicas.js';
import type { EstadoRevision } from './revision.js';

// Los monta la plataforma (oferta/ensamblado.ts, origen «ensamblado»); las filas «hermes» son del Redactor
// retirado en la 3.0.0 de la skill y se siguen enseñando y revisando (revision.ts).
// El tipo de trabajo del Redactor ya no se registra: solo queda para cancelar lo que estaba en cola.
const TIPO_RETIRADO = 'licitaciones.borrador';
const CLAVE_RETIRADA = 'licitaciones.borrador_retirado';
export const ERROR_RETIRADO = 'Flujo retirado: la memoria la redacta la oferta';

type Licitacion = { id: string; expediente: string };

/**
 * Dónde se escribe lo que genera la oferta: con su carpeta única, su Oferta/ en
 * Conocimiento; si no, su carpeta de Salidas.
 */
export function carpetaSalidas(l: Licitacion): string {
  const unica = carpetaUnicaDe(l.id);
  return unica ? ofertaEnUnica(unica) : carpetaEnSalidas(l);
}

/** Carpeta de la licitación dentro de Salidas (sin año: lo que se entrega se busca por expediente). */
export function carpetaEnSalidas(l: Licitacion): string {
  const expediente = limpiarNombre(l.expediente.replace(/\//g, '-'), 80) || 'sin-expediente';
  return `Salidas/Licitaciones/${expediente} (${l.id})`;
}

// origen 'ensamblado': memoria .docx montada por la plataforma (oferta/ensamblado.ts), con su
// PDF, Markdown y JSON al lado; 'hermes': lo que Hermes escribió y registró.
export type Borrador = {
  id: number;
  licitacion_id: string;
  ruta: string;
  sha256: string;
  bytes: number;
  resumen: string | null;
  agente: string;
  registrado_en: string;
  estado: EstadoRevision;
  revisado_en: string | null;
  origen: 'hermes' | 'ensamblado';
  guion_id: number | null;
  version: number | null;
  memoria_id: number | null;
  apartados_json: string | null;
  paginas_estimadas: number | null;
  paginas: number | null;
  ruta_pdf: string | null;
  ruta_md: string | null;
  ruta_json: string | null;
};

/** Los borradores de una licitación salvo los descartados. */
export function borradoresDe(db: Db, licitacionId: string): Borrador[] {
  return db
    .prepare("SELECT * FROM borradores WHERE licitacion_id = ? AND estado <> 'descartada' ORDER BY registrado_en DESC")
    .all(licitacionId) as Borrador[];
}

/**
 * Una sola vez: cancela los trabajos del Redactor que quedaron en cola o lanzados, porque su
 * tipo ya no está registrado y ninguna vuelta los cerraría. Devuelve cuántos canceló.
 */
export function retirarTrabajosBorrador(db: DbNucleo): number {
  if (leerOperacion(db, CLAVE_RETIRADA, () => null)) return 0;
  const r = db
    .prepare(
      `UPDATE trabajos_ia SET estado = 'cancelado', error = ?, run_id = NULL, actualizado_en = ?
    WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')`,
    )
    .run(ERROR_RETIRADO, ahora(), TIPO_RETIRADO);
  guardarOperacion(db, CLAVE_RETIRADA, 'hecha', { canceladas: r.changes });
  return Number(r.changes);
}
