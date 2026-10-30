// La pestaña Revisión sin React y con tests: el tono y la palabra de cada estado, el del
// veredicto, el resumen de las cuentas y adónde lleva cada acción (a su fila de las comprobaciones o a la
// pieza que la resuelve).

export const ESTADOS = {
  correcto: { texto: 'Correcto', tono: 'ok' },
  riesgo: { texto: 'Riesgo', tono: 'riesgo' },
  impide: { texto: 'Impide', tono: 'impide' },
  pendiente: { texto: 'Pendiente', tono: 'neutro' },
};

export const ESTADOS_DOCUMENTO = {
  pendiente: 'Sin preparar',
  borrador: 'Borrador',
  preparado: 'Preparado',
  no_aplica: 'No aplica',
};

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** «2 impiden · 3 riesgos · 1 pendiente · 7 correctas»: lo que queda, en una línea. */
export function resumenCuentas(c) {
  return (
    [
      c.impide ? plural(c.impide, 'impide', 'impiden') : null,
      c.riesgo ? plural(c.riesgo, 'riesgo', 'riesgos') : null,
      c.pendiente ? plural(c.pendiente, 'pendiente', 'pendientes') : null,
      c.correcto ? plural(c.correcto, 'correcta', 'correctas') : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Sin comprobaciones'
  );
}

/** Los nombres literales del pliego vienen a menudo en mayúsculas: en una lista se leen mejor en minúscula. */
export function nombreLegible(nombre) {
  const n = String(nombre ?? '').trim();
  return n && n === n.toUpperCase() ? n.charAt(0) + n.slice(1).toLowerCase() : n;
}

/** Cuántos documentos se revisan: los de todos los sobres. */
export const totalDocumentos = (r) => r.sobres.reduce((n, s) => n + s.documentos.length, 0);

/**
 * Adónde lleva una acción: a su fila en la Revisión (donde está el botón de verdad) o, sin fila, a la
 * pieza que la resuelve (el paquete con el kit de firma, aquí abajo, o la memoria en la Oferta).
 */
export function destinoDeAccion(accion) {
  if (!accion) return null;
  if (accion.bloqueo) return { bloqueo: accion.bloqueo };
  if (accion.destino === 'kit_firma') return { testid: 'pie-comprobaciones' };
  return { cajon: 'memoria' };
}

// Lo que impide arriba, después los riesgos, lo pendiente y lo correcto: se lee lo urgente primero.
const ORDEN = { impide: 0, riesgo: 1, pendiente: 2, correcto: 3 };
export const ordenar = (comprobaciones) =>
  [...comprobaciones].sort(
    (a, b) => ORDEN[a.aceptado ? 'correcto' : a.estado] - ORDEN[b.aceptado ? 'correcto' : b.estado],
  );

const CUMPLIDA = { true: 'el crítico la ve cumplida', false: 'el crítico no la ve cumplida', null: 'sin comprobar' };

/** Dónde se aplicó una lección y qué dice el crítico: «apartados 2 y 3 · el crítico la ve cumplida». */
export function textoLeccionAplicada(l) {
  const ap =
    l.apartados.length === 1
      ? `apartado ${l.apartados[0]}`
      : `apartados ${l.apartados.slice(0, -1).join(', ')} y ${l.apartados.at(-1)}`;
  return `${ap} · ${CUMPLIDA[String(l.cumplida)]}`;
}
