// La memoria presentada (la que se entregó, subida tal cual en PDF o Word): cuál es, qué se
// acepta subir y qué se dice al subirla. La pinta SubirMemoriaPresentada.jsx.
import { plural } from './formato.js';

const EXTENSIONES_PRESENTADA = ['.pdf', '.docx'];
// Coherente con el servidor (MAX_MEMORIA_SUBIDA): así no se sube para nada un archivo que rechazará.
const MAX_BYTES_PRESENTADA = 30 * 1024 * 1024;

/** La memoria presentada vigente de la oferta (las sustituidas van al historial); null si no hay. */
export function memoriaPresentada(memorias = []) {
  return memorias.find((m) => m.presentada) ?? null;
}

/** null si el archivo vale; si no, por qué (extensión o tamaño). */
export function errorArchivoPresentada(archivo) {
  if (!archivo) return 'Elige el PDF o el Word que se presentó.';
  const ext = (archivo.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  if (!EXTENSIONES_PRESENTADA.includes(ext)) return 'Solo PDF o Word (.docx).';
  if (archivo.size > MAX_BYTES_PRESENTADA) return 'El archivo pasa de 30 MB.';
  return null;
}

/** Lo que se dice tras subirla: la versión, si se repartió por apartados, si la sustituye y los avisos. */
export function textoSubidaPresentada(r) {
  const reparto = r.reconocidos ? `repartida en ${r.reconocidos} de ${plural(r.total, 'apartado')}` : 'guardada entera';
  const hace = [r.evalua ? 'la evalúa' : null, r.aprende ? 'saca lecciones' : null].filter(Boolean);
  const partes = [
    `Subida como la memoria presentada (v${r.version}), ${reparto}.`,
    r.sustituye ? 'Sustituye a la presentada anterior, que queda en el historial.' : null,
    hace.length ? `Hermes ${hace.join(' y ')}.` : null,
    ...(r.avisos ?? []),
  ];
  return partes.filter(Boolean).join(' ');
}

/** Los enlaces de una memoria presentada: el archivo entregado, su PDF (si era un Word) y su texto. */
export function rutasPresentada(m) {
  const b = m?.borrador;
  return b ? [b.ruta, b.ruta_pdf, b.ruta_md].filter(Boolean) : [];
}

/**
 * El texto del botón de subida. Con memoria por lote, cada lote sube la suya (`lote`) y la de arriba
 * es la común, que vale para todos los lotes (`porLotes`); sin memoria por lote, la de siempre.
 */
export function textoBotonPresentada(lote = null, porLotes = false) {
  if (lote) return `Subir la memoria presentada del lote ${lote} (PDF o Word)`;
  return porLotes
    ? 'Subir una memoria presentada común a todos los lotes (PDF o Word)'
    : 'Subir la memoria presentada (PDF o Word)';
}
