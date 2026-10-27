// La escala de los rankings de competencia (Ajustes › Fuentes y filtros) ⇄ formulario, sin React y
// con tests: el territorio y la banda de presupuesto con que se abren Competidores y Organismos.
import { COMUNIDADES, numeroONulo } from './formato.js';

const IMPORTE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const importe = (n) => (typeof n === 'number' ? IMPORTE.format(n) : '');

/** Las regiones que se pueden elegir: toda España, cada comunidad y, si está guardado otro prefijo, ese. */
export function opcionesRegion(actual) {
  const otro = actual && !COMUNIDADES.some(([c]) => c === actual) ? [[actual, `NUTS ${actual}`]] : [];
  return [['', 'Toda España'], ...COMUNIDADES, ...otro];
}

export function escalaAFormulario(e) {
  return { region_nuts: e?.region_nuts ?? '', banda_min: importe(e?.banda_min), banda_max: importe(e?.banda_max) };
}

/** Formulario → { escala, errores }, con los importes escritos en español («7.000»). */
export function formularioAEscala(f) {
  const errores = [];
  const leer = (v, etiqueta) => {
    const n = numeroONulo(v);
    if (Number.isNaN(n) || (n !== null && n < 0)) {
      errores.push(`${etiqueta}: escribe un importe en euros.`);
      return null;
    }
    return n;
  };
  const banda_min = leer(f.banda_min, 'Banda desde');
  const banda_max = leer(f.banda_max, 'Banda hasta');
  if (banda_min !== null && banda_max !== null && banda_min > banda_max)
    errores.push('Banda: el importe «desde» no puede ser mayor que el «hasta».');
  return { escala: { region_nuts: f.region_nuts || null, banda_min, banda_max }, errores };
}
