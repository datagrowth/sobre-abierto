// Lógica de los componentes comunes de components/ui (sin React, con tests): orden de las
// tablas, posiciones de la barra de rango y confianza de un indicador.

const comparador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/**
 * Las filas ordenadas por `valor(fila)` en `sentido` ('asc' | 'desc'). Lo vacío (null, undefined,
 * '') va siempre al final, en los dos sentidos: no es «el menor». El orden es estable.
 */
export function ordenarFilas(filas, valor, sentido = 'asc') {
  const vacio = (v) => v === null || v === undefined || v === '';
  const signo = sentido === 'desc' ? -1 : 1;
  return filas
    .map((f, i) => ({ f, i, v: valor(f) }))
    .sort((a, b) => {
      if (vacio(a.v) || vacio(b.v)) return vacio(a.v) - vacio(b.v) || a.i - b.i;
      const c =
        typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : comparador.compare(String(a.v), String(b.v));
      return c * signo || a.i - b.i;
    })
    .map((x) => x.f);
}

/** El orden tras pulsar la cabecera `clave`: la misma columna cambia de sentido; otra empieza ascendente. */
export function siguienteOrden(actual, clave) {
  if (actual?.clave === clave) return { clave, sentido: actual.sentido === 'asc' ? 'desc' : 'asc' };
  return { clave, sentido: 'asc' };
}

/** aria-sort de una cabecera. */
export function ariaOrden(orden, clave) {
  if (orden?.clave !== clave) return 'none';
  return orden.sentido === 'desc' ? 'descending' : 'ascending';
}

/** El porcentaje (0 a 100) de `valor` entre `min` y `max`, sin salirse de la barra. null si no hay valor o escala. */
export function posicionEnRango(valor, min, max) {
  if (![valor, min, max].every(Number.isFinite) || max <= min) return null;
  return Math.min(100, Math.max(0, ((valor - min) / (max - min)) * 100));
}

/**
 * La escala de una barra de rango: de 0 (o el menor valor, si hay negativos) a un poco más del
 * mayor de los que se dibujan, para que ninguna marca quede pegada al borde.
 */
export function escalaRango(valores) {
  const v = valores.filter(Number.isFinite);
  if (!v.length) return null;
  const min = Math.min(0, ...v);
  const max = Math.max(...v);
  return { min, max: max === min ? min + 1 : max + (max - min) * 0.1 };
}

export const TEXTO_CONFIANZA = { alta: 'confianza alta', media: 'confianza media', baja: 'confianza baja' };

/** Con confianza baja la cabecera no enseña la cifra: «pocos datos (n = 7)». */
export function textoPocosDatos(n) {
  return `pocos datos (n = ${Number.isFinite(n) ? n : 0})`;
}

/** Une clases de Tailwind saltándose las vacías: clases('a', cond && 'b'). */
export const clases = (...xs) => xs.filter(Boolean).join(' ');
