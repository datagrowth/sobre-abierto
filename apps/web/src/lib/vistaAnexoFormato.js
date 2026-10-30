// Lo que la web decide al mostrar un anexo que rellenó Hermes sin tocar el servidor: cortar cada
// párrafo en texto y valores resaltados, qué tarjetas se aceptan en bloque y qué clave de
// documento lleva cada tarjeta.

/**
 * Corta un párrafo en trozos de texto y de valor. Los desplazamientos que se salen del texto, están
 * vacíos o pisan a otro anterior se descartan: preferimos perder un resaltado a romper la vista.
 */
export function trozos(parrafo) {
  const texto = String(parrafo?.texto ?? '');
  const valores = [...(parrafo?.valores ?? [])].sort((a, b) => a.desde - b.desde);
  const out = [];
  let cursor = 0;
  for (const v of valores) {
    const desde = Math.max(0, Math.floor(v.desde));
    const hasta = Math.min(texto.length, Math.floor(v.hasta));
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde || desde < cursor) continue;
    if (desde > cursor) out.push({ texto: texto.slice(cursor, desde) });
    out.push({ texto: texto.slice(desde, hasta), valor: v });
    cursor = hasta;
  }
  if (cursor < texto.length) out.push({ texto: texto.slice(cursor) });
  return out;
}

/** El dato del que sale un valor, para el title («Importe sin impuestos · lote 2»). */
export const tituloValor = (v) =>
  [v?.dato, v?.cambiado ? 'cambió frente a la versión anterior' : null].filter(Boolean).join(' · ');

/** Las tarjetas «anexo» que se pueden aceptar a la vez: pendientes y sin acreditación, y solo si son dos o más. */
export function aceptablesEnBloque(tarjetas) {
  const libres = (tarjetas ?? []).filter((t) => t.tipo === 'anexo' && t.estado === 'pendiente' && !t.acreditacion);
  return libres.length >= 2 ? libres : [];
}

/** La clave del documento (la que lleva la API de anexos) dentro de la clave de la tarjeta «anexo:<documento>:<fecha>». */
export const claveDocumento = (claveTarjeta) => String(claveTarjeta).split(':')[1] ?? '';

export const textoAceptarBloque = (n) => `Aceptar los ${n} borradores sin evidencia exigida`;
