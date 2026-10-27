// Formato del bloque «Precios» y del histórico (sin React, con tests).

const PCT = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 0.153 → «15,3 %»; null → «—». */
export function porcentaje(fraccion) {
  return typeof fraccion === 'number' && Number.isFinite(fraccion) ? `${PCT.format(fraccion * 100)} %` : '—';
}

/** Puntos porcentuales con signo: 0.012 → «+1,2 pp». */
export function puntos(fraccion) {
  if (typeof fraccion !== 'number' || !Number.isFinite(fraccion)) return '—';
  const signo = fraccion > 0 ? '+' : fraccion < 0 ? '−' : '';
  return `${signo}${PCT.format(Math.abs(fraccion) * 100)} pp`;
}

/**
 * Baja escrita por una persona en porcentaje («15», «15,5 %») → fracción (0.155).
 * Vacío → null; fuera de 0–95 % o ilegible → NaN.
 */
export function leerBaja(texto) {
  const t = String(texto ?? '')
    .replace('%', '')
    .trim()
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 95) return NaN;
  return Math.round(n * 10) / 1000;
}

/** Número de ofertas escrito a mano: entero de 1 a 500, vacío → null, otra cosa → NaN. */
export function leerOfertas(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : NaN;
}

export const ETIQUETAS_PERCENTIL = {
  p10: 'P10',
  p25: 'P25',
  p50: 'Mediana',
  p75: 'P75',
  p90: 'P90',
  propuesta: 'Tu baja',
};

/** «En 15 de 20 (75 %)» para la proporción de adjudicaciones ganadas con una baja igual o menor. */
export function textoProporcion(proporcion, n) {
  if (typeof proporcion !== 'number' || !n) return '—';
  return `${Math.round(proporcion * n)} de ${n} (${Math.round(proporcion * 100)} %)`;
}

/** Progreso de un año del histórico: «3/12 meses · 41 MB» o el estado final. */
export function progresoHistorico(f) {
  if (f.estado === 'hecho') return `${f.guardadas} guardadas de ${f.entradas}`;
  if (f.estado === 'error') return f.error ?? 'error';
  if (f.estado === 'pendiente') return 'en cola';
  const piezas = f.piezas_total > 1 ? `${f.piezas_hechas}/${f.piezas_total} meses` : `${f.piezas_hechas}/1 archivo`;
  const mb = f.bytes ? ` · ${Math.round(f.bytes / 1_048_576)} MB` : '';
  return `${piezas}${mb} · ${f.entradas} entradas`;
}

export const ESTADOS_HISTORICO = {
  pendiente: 'En cola',
  descargando: 'Descargando',
  procesando: 'Procesando',
  hecho: 'Hecho',
  error: 'Error',
};

// euros() redondea a la unidad; un precio por alumno (93,71 €) necesita los céntimos.
const EUROS_UNIDAD = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
});

/** 93.7125, «alumno» → «93,71 € por alumno»; sin número → «—». */
export function eurosPorUnidad(n, unidad) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${EUROS_UNIDAD.format(n)}${unidad ? ` por ${unidad}` : ''}`;
}

/** Cabecera de la columna de anormalidad: la regla con la que el servidor la calculó. */
export function columnaAnormal(e) {
  if (e?.regla === 'pliego') return 'Umbral del pliego';
  return e?.regla === 'literal' ? 'Art. 85 RGLCAP (estimado)' : 'Art. 85 RGLCAP';
}

/** Cabeceras de los escenarios: con precio por unidad, una columna más en esa unidad. */
export function cabeceraEscenarios(e) {
  const unidad = e?.unidad ? [[`Por ${e.unidad.nombre}`, 'd']] : [];
  return [
    ['Escenario'],
    ['Baja', 'd'],
    ['Importe sin IVA', 'd'],
    ...unidad,
    ['Ganada con baja ≤', 'd'],
    [columnaAnormal(e)],
  ];
}

const recorte = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

/**
 * Cómo se decide «posible anormal», bajo la tabla. Con el umbral del pliego, en la unidad de la
 * oferta y con su cita; con solo el literal, el literal y que se estima; sin nada, el art. 85.
 */
export function textoUmbral(e) {
  const unidad = e.unidad && e.umbral_unidad !== null ? ` (${eurosPorUnidad(e.umbral_unidad, e.unidad.nombre)})` : '';
  const cita = e.cita ? ` (${e.cita})` : '';
  if (e.regla === 'pliego')
    return `Umbral del pliego: una baja de más del ${porcentaje(e.umbral_anormal)}${unidad} es anormalmente baja${cita}.`;
  const ofertas = `Con ${e.ofertas_esperadas} ${e.ofertas_esperadas === 1 ? 'oferta' : 'ofertas'} y el resto a la baja mediana (${porcentaje(e.baja_resto)}),`;
  const art85 =
    e.umbral_anormal === null
      ? `${ofertas} ninguna baja razonable sería anormal.`
      : `${ofertas} a partir de una baja del ${porcentaje(e.umbral_anormal)}${unidad} la oferta podría ser anormalmente baja.`;
  if (e.regla !== 'literal') return art85;
  return `El pliego fija su propio umbral («${recorte(e.umbral_literal, 300)}»${cita}): el aviso se estima con el art. 85 RGLCAP y manda el pliego. ${art85}`;
}
