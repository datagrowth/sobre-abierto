// El encaje 0-100 de una licitación para la web: el número nunca va solo, siempre
// con su desglose. Sin React, con tests.

/** «Encaje 82», «Encaje 20 · no elegible»; null si no hay número (faltan datos). */
export function textoEncaje(e) {
  if (!e || e.valor === null || e.valor === undefined) return null;
  return e.elegible ? `Encaje ${e.valor}` : `Encaje ${e.valor} · ${e.etiqueta ?? 'no elegible'}`;
}

/** El peso con coma decimal: 0,30. */
export const textoPeso = (p) => p.toFixed(2).replace('.', ',');

/** Las filas del desglose: la elegibilidad (cierra, no pesa) y cada componente con su barra o «sin datos». */
export function filasEncaje(e) {
  if (!e) return [];
  const elegibilidad = {
    clave: 'elegibilidad',
    etiqueta: 'Elegibilidad',
    peso: 'cierre',
    valor: null,
    chip: e.elegible ? { texto: 'Cumple', tono: 'ok' } : { texto: 'No elegible', tono: 'impide' },
    detalle: e.elegible ? null : 'Un excluyente que no cumplimos: el encaje se queda en 20 como mucho.',
    de_hermes: false,
  };
  return [
    elegibilidad,
    ...e.componentes.map((c) => ({
      ...c,
      peso: textoPeso(c.peso),
      chip: c.valor === null ? { texto: 'Sin datos', tono: 'neutro' } : null,
    })),
  ];
}

/** El desglose en una línea, para el título de la celda de la lista: «Temática 92 · Economía sin datos · …». */
export function resumenEncaje(e) {
  if (!e) return '';
  return e.componentes.map((c) => `${c.etiqueta} ${c.valor ?? 'sin datos'}`).join(' · ');
}
