// La Biblioteca filtrada por una carpeta: «Documentos de esta oferta» del Expediente
// abre #/biblioteca/carpeta/<carpeta>, que enseña solo las notas de esa carpeta y sus subcarpetas.
// Sin React, con tests.

const VISTA_CARPETA = 'carpeta';

const limpiar = (carpeta) =>
  String(carpeta ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

// Una carpeta de la dirección se lee tal cual: nada de «..» ni trozos vacíos que salgan de Conocimiento.
const valida = (carpeta) => carpeta.length > 0 && carpeta.split('/').every((t) => t && t !== '.' && t !== '..');

/** La carpeta pedida en la ruta de la Biblioteca ({ seccion, vista, id }) o null si no filtra por carpeta. */
export function leerCarpetaBiblioteca(ruta) {
  if (ruta?.seccion !== 'biblioteca' || ruta?.vista !== VISTA_CARPETA) return null;
  const carpeta = limpiar(ruta.id);
  return valida(carpeta) ? carpeta : null;
}

/** La ruta de la Biblioteca filtrada por esa carpeta (para useRuta().ir / rutaA). */
export function rutaCarpetaBiblioteca(carpeta) {
  return { seccion: 'biblioteca', vista: VISTA_CARPETA, id: limpiar(carpeta) };
}

/** Las notas de esa carpeta y de sus subcarpetas (no las de una hermana que empiece igual). */
export function notasDeCarpeta(notas, carpeta) {
  const base = limpiar(carpeta);
  if (!base) return Array.isArray(notas) ? notas : [];
  return (Array.isArray(notas) ? notas : []).filter((n) => limpiar(n?.path).startsWith(`${base}/`));
}

/** La carpeta de los pliegos descargados de una licitación (la de su primer pliego con ruta), o null. */
export function carpetaDeOferta(pliegos) {
  const ruta = (Array.isArray(pliegos) ? pliegos : []).map((p) => limpiar(p?.ruta)).find((r) => r.includes('/'));
  return ruta ? ruta.slice(0, ruta.lastIndexOf('/')) : null;
}
