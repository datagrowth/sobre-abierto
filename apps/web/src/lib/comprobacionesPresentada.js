// La oferta con la memoria ya entregada (FF-01): lo presentado no se arregla. La web no
// enseña filas de memoria de un lote ya presentado, aunque llegaran del servidor. Sin React, con tests.
import { memoriaDeLaOferta } from './memoriaFormato.js';

// Lo que se arregla en la memoria: su coherencia, sus fugas y «revisar la memoria».
const esDeMemoria = (b) =>
  b?.categoria === 'coherencia' || b?.categoria === 'fugas' || b?.accion?.tipo === 'revisar_memoria';

/**
 * Cada lote con memoria propia (o null, la común) y si ya tiene su presentada (la suya o la común,
 * que vale para todos). null sin la respuesta de /oferta.
 */
export function presentadasPorLote(o) {
  if (!o) return null;
  const lotes = o.memoria_lotes?.length ? o.memoria_lotes.map(String) : [null];
  return lotes.map((lote) => ({ lote, presentada: Boolean(memoriaDeLaOferta(o, lote ?? undefined)?.presentada) }));
}

// Un lote que no tiene memoria propia cuenta con la común; la oferta entera (lote null), con todos.
function entregado(porLote, lote) {
  if (lote === null) return porLote.every((x) => x.presentada);
  return (porLote.find((x) => x.lote === lote) ?? porLote.find((x) => x.lote === null))?.presentada ?? false;
}

/** Las filas sin lo que pide arreglar una memoria ya presentada (de su lote o de toda la oferta). */
export function sinSugerenciasEnLoPresentado(filas, o) {
  const porLote = presentadasPorLote(o);
  if (!porLote?.some((x) => x.presentada)) return filas;
  return (filas ?? []).filter((b) => !(esDeMemoria(b) && entregado(porLote, b.lote ?? null)));
}
