// Apartados de la memoria con acciones: «Otra ronda con estos motivos» abre
// «Pedir cambios» con los apartados que hay que rehacer ya marcados y la cita de cada fuga en las
// indicaciones; y un rechazo del revisor es un reintento de Hermes, no un error de la persona.
import { fugasDe } from './fugasFormato.js';

// El mensaje del revisor va dirigido a Hermes: a la persona no le dice nada que pueda hacer.
const PARA_HERMES = /\s*Corrige y vuelve a enviar el apartado entero\.?\s*$/;

/** Los apartados que «Otra ronda» marca: con fuga, fallidos o flojos (por debajo de su tramo), en orden y sin repetir. */
export function motivosPrecargados(m) {
  const existen = new Set((m?.apartados ?? []).map((a) => a.apartado));
  const conFuga = fugasDe(m).hallazgos.map((h) => h.apartado);
  const fallidos = (m?.apartados ?? []).filter((a) => a.estado === 'fallido').map((a) => a.apartado);
  const flojos = m?.mejorable ?? [];
  return [...new Set([...conFuga, ...fallidos, ...flojos])].filter((n) => existen.has(n)).sort((a, b) => a - b);
}

// «Sobre “C” - Criterios cuantificables…» → «Sobre C»; si el archivo no dice su sobre, su nombre.
function destinoDeFuga(h) {
  const sobre = /sobre\s*[“"«'(]?\s*([a-z0-9]{1,3})\b/i.exec(h.archivo ?? '');
  if (sobre) return `del Sobre ${sobre[1].toUpperCase()}`;
  return h.archivo ? `hacia «${h.archivo}»` : 'entre sobres';
}

/** Una línea por fuga para las indicaciones: «Apartado 2: quita «…» (fuga del Sobre C).»; '' sin fugas. */
export function indicacionesDeFugas(m) {
  return fugasDe(m)
    .hallazgos.map((h) => `Apartado ${h.apartado}: quita «${h.cita}» (fuga ${destinoDeFuga(h)}).`)
    .join('\n');
}

/**
 * Cómo se pinta un apartado rechazado o fallido: el rechazo, «ronda N · reintentando» en gris; el
 * fallo, en rojo. detalle: el motivo sin la orden dirigida a Hermes. null en el resto de estados.
 */
export function estadoApartado(a) {
  const detalle = a?.error ? a.error.replace(PARA_HERMES, '').trim() || null : null;
  if (a?.estado === 'fallido') return { texto: 'fallido', tono: 'peligro', detalle };
  if (a?.estado !== 'recibido' && a?.rechazos > 0)
    return { texto: `ronda ${a.rechazos + 1} · reintentando`, tono: 'neutro', detalle };
  return null;
}
