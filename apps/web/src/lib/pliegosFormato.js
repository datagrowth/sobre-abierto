// Textos de «Subir un pliego que falta» y de la lista de pliegos subidos a mano (sin React, con tests).

export const AYUDA_SUBIDA = 'PDF, Word, Excel, ZIP o el XML del DEUC; hasta 60 MB.';
const MAX_SUBIDA = 60 * 1024 * 1024;
const EXTENSIONES = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.odt', '.ods', '.zip', '.xml'];

/** Revisa el archivo antes de enviarlo: el servidor repite la comprobación, aquí solo se ahorra la espera. */
export function errorArchivo(archivo) {
  if (!archivo) return 'Elige un archivo.';
  const nombre = String(archivo.name ?? '').toLowerCase();
  if (!EXTENSIONES.some((e) => nombre.endsWith(e))) return `Ese formato no vale. ${AYUDA_SUBIDA}`;
  if (archivo.size > MAX_SUBIDA) return 'Pesa más de 60 MB.';
  return null;
}

/** El texto bajo el botón: recién subido (indexándose) o ya indexado. */
export function textoTrasSubir({ indexado, duplicado = null }) {
  if (duplicado) return `Ya estaba subido («${duplicado}»): no se ha duplicado.`;
  return indexado ? 'indexado ✓ · si es una rectificación, la ficha se rehace sola' : 'Subido · indexándose…';
}

/** Un pliego subido a mano ya está indexado cuando la Biblioteca lo lee (estado_indice «ok»). */
export function subidosSinIndexar(pliegos = []) {
  return pliegos.filter((p) => p.origen === 'manual' && p.estado_indice !== 'ok').length;
}

/** «Subido a mano por Ana» (o «por la web» si no se dijo quién); null si lo trajo la plataforma. */
export function etiquetaOrigen(p) {
  if (p?.origen !== 'manual') return null;
  return `Subido a mano por ${p.subido_por && p.subido_por !== 'web' ? p.subido_por : 'la web'}`;
}
