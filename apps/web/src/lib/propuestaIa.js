// Lo que cambia una propuesta de la IA respecto a lo guardado, campo a campo y en texto
// legible («antes → después»), para revisarla igual en todas las pestañas (sin React, con tests).

/** Valor de formulario → texto corto: listas separadas por «; », vacío como «—». */
export function textoCampo(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(textoCampo).join('; ') : '—';
  if (typeof v === 'object')
    return (
      Object.values(v)
        .filter((x) => x !== null && x !== undefined && x !== '')
        .join(' ') || '—'
    );
  return String(v).trim() || '—';
}

/** [{ campo, antes, despues }] de los campos de `etiquetas` ({clave: nombre visible}) que difieren. */
export function diferencias(antes, despues, etiquetas) {
  return Object.entries(etiquetas)
    .map(([k, campo]) => ({ campo, antes: textoCampo(antes?.[k]), despues: textoCampo(despues?.[k]) }))
    .filter((d) => d.antes !== d.despues);
}
