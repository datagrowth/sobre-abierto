// Comentarios con menciones, sin React para probarlo: la clave de cada requisito, el texto
// del botón, cómo se inserta una mención y cómo se parte un comentario para resaltar las menciones.

/** La clave de un requisito para colgarle comentarios: su lote y su texto, estable si la ficha se rehace igual. */
export function claveRequisito(r) {
  const texto = String(r?.descripcion ?? r?.texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${r?.lote ?? '-'}:${texto}`.slice(0, 200);
}

/** «Comentar» sin ninguno; si los hay, cuántos y cuántos siguen abiertos. */
export function textoBotonComentarios(hilo = []) {
  if (!hilo.length) return 'Comentar';
  const abiertos = hilo.filter((c) => !c.resuelto).length;
  const total = hilo.length === 1 ? '1 comentario' : `${hilo.length} comentarios`;
  return abiertos && abiertos < hilo.length ? `${total} · ${abiertos} sin resolver` : total;
}

/** El texto con «@Nombre » añadido al final (con un espacio delante si hace falta). */
export function insertarMencion(texto, nombre) {
  const base = String(texto ?? '');
  const separador = base && !/\s$/.test(base) ? ' ' : '';
  return `${base}${separador}@${nombre} `;
}

/** El comentario en trozos { texto, mencion } para pintar las menciones resaltadas. */
export function partesComentario(texto, menciones = []) {
  const nombres = menciones.map((m) => `@${m.nombre}`).sort((a, b) => b.length - a.length);
  if (!nombres.length) return [{ texto, mencion: false }];
  const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = new RegExp(`(${nombres.map(escapar).join('|')})`, 'gi');
  return String(texto)
    .split(patron)
    .filter(Boolean)
    .map((t) => ({ texto: t, mencion: nombres.some((n) => n.toLowerCase() === t.toLowerCase()) }));
}

/** El texto de la lista de menciones de la barra lateral: «Elisa en «Formación en IA»». */
export const textoMencion = (m) => `${m.autor} en «${m.titulo}»`;
