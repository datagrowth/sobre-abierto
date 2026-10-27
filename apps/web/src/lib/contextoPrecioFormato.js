// Formato del contexto del precio de un lote (sin React, con tests): qué suele pasar en
// este órgano, el escenario «un solo licitador» y el aviso de margen frente al coste estimado. El
// coste es solo de la persona: se guarda con el precio (ofertas[].coste_estimado) y no va a ningún agente.
import { euros, numeroONulo, plural } from './formato.js';
import { porcentaje } from './preciosFormato.js';

const DECIMAL = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const ofertas = (n) => `${DECIMAL.format(n)} ${n === 1 ? 'oferta' : 'ofertas'}`;

/** «Este órgano: 1 oferta, 0,0 % de baja (2022) · ganó X», con la media si hay más de una adjudicación. */
export function lineaOrgano(organo) {
  const u = organo?.ultima;
  if (!organo?.n || !u) return 'Este órgano: sin adjudicaciones publicadas en el histórico cargado.';
  const datos = [u.ofertas != null ? ofertas(u.ofertas) : 'ofertas sin publicar', `${porcentaje(u.baja)} de baja`].join(
    ', ',
  );
  const linea = `Este órgano: ${datos} (${u.anio}) · ganó ${u.ganador}`;
  if (organo.n === 1) return linea;
  const medias = [
    organo.ofertas_media != null ? ofertas(organo.ofertas_media) : null,
    organo.baja_media != null ? `${porcentaje(organo.baja_media)} de baja` : null,
  ].filter(Boolean);
  return medias.length
    ? `${linea} · media de ${plural(organo.n, 'adjudicación', 'adjudicaciones')}: ${medias.join(', ')}`
    : linea;
}

/** El escenario de un solo licitador, o null si la fórmula del pliego no lo deja saber. */
export function textoUnLicitador(contexto) {
  return contexto?.un_licitador?.texto ?? null;
}

const INDICIOS = {
  bajo: 'Indicios de licitación con nombre: bajo',
  medio: 'Indicios de licitación con nombre: medio',
  alto: 'Indicios de licitación con nombre: alto',
};

export function textoIndicios(nivel) {
  return INDICIOS[nivel] ?? null;
}

const comparable = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * El importe del lote, con la misma cuenta que el servidor (importeDeLote): sin líneas de precio
 * en el guion, el total; con ellas, Σ precio × cantidad, casando el concepto sin mayúsculas ni
 * tildes (null si falta un precio o una cantidad). Así el margen no sale de otra cuenta.
 */
export function importeDeOferta(oferta, oe) {
  if (!oferta) return null;
  const lineas = oe?.precios_unitarios ?? [];
  if (!lineas.length) return typeof oferta.importe === 'number' ? oferta.importe : null;
  let total = 0;
  for (const l of lineas) {
    const p = (oferta.unitarios ?? []).find((u) => comparable(u.concepto) === comparable(l.concepto));
    if (!p || l.cantidad == null) return null;
    total += p.precio * l.cantidad;
  }
  return Math.round(total * 100) / 100;
}

/** «Margen estimado: 1.400 € (20,0 %)» o el aviso de margen negativo; null sin importe o sin coste. */
export function avisoMargen(importe, coste) {
  if (typeof importe !== 'number' || typeof coste !== 'number') return null;
  const margen = Math.round((importe - coste) * 100) / 100;
  if (margen < 0)
    return { negativo: true, texto: `El precio queda por debajo del coste estimado: pierdes ${euros(-margen)}.` };
  const sobre = importe > 0 ? ` (${porcentaje(margen / importe)})` : '';
  return { negativo: false, texto: `Margen estimado: ${euros(margen)}${sobre}.` };
}

/** Lo tecleado en «Coste estimado»: vacío es «sin coste» (null); lo que no es un número, error. */
export function leerCoste(texto) {
  const n = numeroONulo(texto);
  if (Number.isNaN(n)) return { data: null, error: 'Escribe el coste en euros, sin impuestos (p. ej. 4.500).' };
  return { data: n, error: null };
}

/** Las ofertas guardadas con el coste del lote puesto; sin oferta del lote, una pendiente que solo lleva el coste. */
export function ofertasConCoste(guardadas = [], lote, coste) {
  const esEste = (o) => (o.lote ?? null) === (lote ?? null);
  if (guardadas.some(esEste)) return guardadas.map((o) => (esEste(o) ? { ...o, coste_estimado: coste } : o));
  return [...guardadas, { lote: lote ?? null, pendiente: true, importe: null, unitarios: [], coste_estimado: coste }];
}

/** El coste guardado del lote, como texto del campo. */
export function costeGuardado(guardadas = [], lote) {
  const o = guardadas.find((x) => (x.lote ?? null) === (lote ?? null));
  return typeof o?.coste_estimado === 'number' ? String(o.coste_estimado).replace('.', ',') : '';
}
