// Formato de las vistas Competidores y Organismos (sin React, con tests).

export const PERIODOS = [
  { meses: 12, label: '12 meses' },
  { meses: 24, label: '24 meses' },
  { meses: 36, label: '3 años' },
  { meses: 0, label: 'Todo' },
];

export const ORDEN_COMPETIDORES = [
  { key: 'importe', label: 'Importe ganado' },
  { key: 'contratos', label: 'Contratos' },
  { key: 'coincidencias', label: 'Coinciden con lo que seguimos' },
];

export const ORDEN_ORGANISMOS = [
  { key: 'interes', label: 'Interés' },
  { key: 'importe', label: 'Importe licitado' },
  { key: 'licitaciones', label: 'Licitaciones' },
];

const ENTERO = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const UN_DECIMAL = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** 1234567 → «1,2 M€»; 45300 → «45 mil €»; para cifras que se leen de un vistazo. */
export function eurosCortos(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${UN_DECIMAL.format(n / 1e6)} M€`;
  if (Math.abs(n) >= 1e3) return `${ENTERO.format(n / 1e3)} mil €`;
  return `${ENTERO.format(n)} €`;
}

/** Ofertas medias: 3.333 → «3,3»; sin dato «—». */
export function ofertasMedias(n) {
  return typeof n === 'number' && Number.isFinite(n) ? UN_DECIMAL.format(n) : '—';
}

/** Proporción de contratos ganados como pyme: «pyme» (≥ 50 %), «no pyme» o sin dato. */
export function textoPyme(proporcion) {
  if (typeof proporcion !== 'number') return null;
  return proporcion >= 0.5 ? 'pyme' : 'no pyme';
}

/** Nivel de la puntuación de interés de un órgano, para el color del chip. */
export function nivelInteres(puntos) {
  if (typeof puntos !== 'number') return 'bajo';
  if (puntos >= 60) return 'alto';
  return puntos >= 35 ? 'medio' : 'bajo';
}

/** «1 en órganos donde licitas · 3 en tus CPV», o null si no coincide en nada. */
export function textoCoincidencias(c) {
  if (!c?.total) return null;
  const partes = [];
  if (c.mismo_organo) partes.push(`${c.mismo_organo} en órganos donde licitas`);
  if (c.mismo_cpv) partes.push(`${c.mismo_cpv} en tus CPV`);
  return partes.join(' · ');
}

/** Barras por año: ancho en % respecto al mayor valor del campo (mínimo visible del 2 %). */
export function barrasAnio(grupos = [], campo = 'contratos') {
  const max = Math.max(0, ...grupos.map((g) => g[campo] ?? 0));
  return grupos.map((g) => ({ ...g, ancho: max > 0 ? Math.max(2, Math.round(((g[campo] ?? 0) / max) * 100)) : 0 }));
}

/** El nombre si lo hay; si no, el NIF. */
export function nombreONif(item) {
  return item?.nombre || item?.clave || item?.nif || '—';
}

// La PLACSP publica a veces NIF de relleno para UTE y empresas extranjeras («TEMP00996»,
// «B00000000»): no se enseñan como si fueran un NIF.
const NIF_RELLENO = /^(TEMP|UTE)|^[A-Z]?0{7,}[A-Z0-9]?$/i;

/** «NIF B12345678», o «sin NIF publicado» si es de relleno o falta. */
export function textoNif(nif) {
  const n = String(nif ?? '').trim();
  return !n || NIF_RELLENO.test(n) || n.length !== 9 ? 'sin NIF publicado' : `NIF ${n}`;
}

// El servidor deja abierto el máximo con 10.000 millones: no es un límite que se enseñe.
const SIN_MAXIMO = 1e10;
const MILES = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** 7000 → «7»; 7500 → «7,5»; en miles de euros. */
const enMiles = (n) => MILES.format(n / 1000);

function textoImporte(banda) {
  if (!banda) return 'Todos los importes';
  if (banda.max >= SIN_MAXIMO) return `Desde ${enMiles(banda.min)} k€`;
  if (!banda.min) return `Hasta ${enMiles(banda.max)} k€`;
  return `Banda ${enMiles(banda.min)}-${enMiles(banda.max)} k€`;
}

/** Ámbito de un ranking a la vista: «Banda 7-130 k€ · Canarias», «Todos los importes · Toda España». */
export function textoBanda(ambito) {
  if (!ambito) return '';
  const territorio = ambito.nuts ? (ambito.territorio ?? `NUTS ${ambito.nuts}`) : 'Toda España';
  return `${textoImporte(ambito.banda)} · ${territorio}`;
}

/** De dónde sale la banda, para el title del chip. */
export function origenBanda(banda) {
  if (!banda) return 'Sin filtro de importe';
  if (banda.origen === 'propia') return 'Percentiles 10-90 del presupuesto de tus ofertas presentadas';
  if (banda.origen === 'ajuste')
    return 'Aún hay menos de 5 presentadas: la banda de la escala de los rankings (Ajustes › Fuentes y filtros)';
  return 'Banda pedida';
}

/** «Ver más»: la página siguiente se añade a la que ya se ve, sin repetir un NIF. */
export function unirPagina(anterior, pagina) {
  const vistos = new Set((anterior?.items ?? []).map((i) => i.nif));
  const nuevos = (pagina?.items ?? []).filter((i) => !vistos.has(i.nif));
  return { ...anterior, ...pagina, items: [...(anterior?.items ?? []), ...nuevos] };
}
