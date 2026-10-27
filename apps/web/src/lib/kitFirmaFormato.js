// El kit de firma: del manifiesto del paquete vigente, las carpetas en el orden en que
// se suben, lote a lote, con sus archivos numerados como en INSTRUCCIONES.md. Puro.
import { enlaceDocumento } from './propuestasFormato.js';

export const FIRMA_POR_LOTES =
  'Firma todos los archivos de una vez con AutoFirma (Firma por lotes: selecciona la carpeta) y súbelos en este orden.';

// Lo común (lote null) va antes: se sube una vez, antes de los sobres de cada lote.
const ordenLote = (lote) => (lote === null || lote === undefined ? '' : String(lote));

function carpetaDelKit(c) {
  const docs = [...(c.documentos ?? [])].sort((a, b) => a.orden - b.orden);
  return {
    ruta: c.ruta,
    lote: c.lote ?? null,
    sobre: c.archivo,
    firma: c.firma ?? null,
    archivos: docs.map((d, i) => ({ n: i + 1, archivo: d.archivo, nombre: d.nombre })),
  };
}

/**
 * vigente: el paquete vigente de GET …/oferta/paquete (con su manifiesto). null sin paquete.
 * Devuelve las carpetas por lote y sobre, y los enlaces a VALORES_A_TECLEAR.md e INSTRUCCIONES.md.
 */
export function kitDeFirma(vigente) {
  const carpetas = vigente?.manifiesto?.carpetas;
  if (!vigente?.ruta || !Array.isArray(carpetas)) return null;
  const conIndice = carpetas.map((c, i) => ({ c, i }));
  conIndice.sort(
    (a, b) => ordenLote(a.c.lote).localeCompare(ordenLote(b.c.lote), 'es', { numeric: true }) || a.i - b.i,
  );
  return {
    version: vigente.version,
    carpetas: conIndice.map(({ c }) => carpetaDelKit(c)).filter((c) => c.archivos.length),
    valores: enlaceDocumento(`${vigente.ruta}/VALORES_A_TECLEAR.md`),
    instrucciones: enlaceDocumento(`${vigente.ruta}/INSTRUCCIONES.md`),
  };
}
