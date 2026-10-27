// Lo último que devolvió un PATCH de las decisiones de cada oferta, hasta que llega la oferta
// recargada. Varias piezas guardan secciones de las mismas decisiones (las filas de precio de las
// comprobaciones, el coste, el cajón Decisiones, la Mesa) y cada una tenía la versión y las ofertas de su
// última lectura: la segunda en guardar iba con la versión vieja y el servidor respondía 409, y la
// web decía «otra persona guardó» cuando fue la misma. Sin React, para poder probarlo.

const recientes = new Map();

/** Apunta la versión y los datos que devolvió un guardado (res: { version, datos }). */
export function apuntarDecisiones(id, res) {
  if (!id || !Number.isInteger(res?.version)) return;
  const previa = recientes.get(id);
  if (!previa || res.version > previa.version) recientes.set(id, { version: res.version, datos: res.datos ?? null });
}

/**
 * Las decisiones con las que guardar: las leídas o, si un guardado posterior aún no llegó con la
 * oferta recargada, su versión y sus datos (las ofertas de los demás lotes incluidas).
 */
export function decisionesAlDia(id, decisiones) {
  const r = recientes.get(id);
  if (!r || (decisiones?.version ?? 0) >= r.version) return decisiones;
  return { ...(decisiones ?? {}), version: r.version, datos: r.datos ?? decisiones?.datos ?? null };
}

/** Solo para las pruebas: olvida lo apuntado. */
export function olvidarDecisiones() {
  recientes.clear();
}
