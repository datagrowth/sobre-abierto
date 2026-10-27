// Textos y escalas de Mercado › Panorama y Vencimientos.

/** «2026-T3» → «T3 26», el formato del eje del gráfico. */
export function etiquetaTrimestre(trimestre) {
  const m = /^(\d{4})-T(\d)$/.exec(trimestre ?? '');
  return m ? `T${m[2]} ${m[1].slice(2)}` : String(trimestre ?? '');
}

/** Barras del importe por trimestre: alto en % del mayor (0 si no hay ninguno). */
export function barrasTrimestres(trimestres = []) {
  const max = Math.max(0, ...trimestres.map((t) => t.importe));
  return trimestres.map((t) => ({
    ...t,
    etiqueta: etiquetaTrimestre(t.trimestre),
    alto: max ? Math.round((t.importe / max) * 1000) / 10 : 0,
  }));
}

/** Millones con un decimal: 1.250.000 → «1,3». */
export function millones(importe) {
  return Number.isFinite(importe)
    ? (importe / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
    : '—';
}

const MES = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** «2027-03-31» → «mar 2027». */
export function mesAnio(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fecha ?? '')) return '—';
  return MES.format(new Date(`${fecha.slice(0, 10)}T00:00:00Z`))
    .replace('.', '')
    .replace(' de ', ' ');
}

export const TONO_CONFIANZA = { alta: 'ok', media: 'neutro', baja: 'neutro' };
export const TEXTO_CONFIANZA_SALIDA = { alta: 'Alta', media: 'Media', baja: 'Baja' };

/** Por qué la salida esperada tiene esa confianza: de cuántas ediciones anteriores del órgano sale. */
export function textoSalida(v) {
  if (!v.ediciones) return `Sin historial del órgano: ${v.antelacion_meses} meses antes del fin`;
  return `${v.antelacion_meses.toLocaleString('es-ES')} meses antes del fin, como en ${v.ediciones === 1 ? 'su edición anterior' : `sus ${v.ediciones} ediciones anteriores`}`;
}

/** Las prórrogas, si se conocen; la PLACSP no las publica en el CODICE. */
export function textoProrrogas(v) {
  if (v.prorrogas_max === null || v.prorrogas_max === undefined) return 'prórrogas sin publicar';
  if (!v.prorrogas_max) return 'sin prórrogas';
  return `${v.prorrogas_usadas ?? 0} de ${v.prorrogas_max} prórrogas usadas`;
}
