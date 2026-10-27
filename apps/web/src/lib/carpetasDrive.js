// Qué carpetas de Drive se ofrecen en la cabecera de la ficha de una licitación.
import { conComprobaciones } from './licitacionesFormato.js';

const CON_OFERTA = new Set(['presentada', 'ganada', 'perdida']);

/**
 * Con carpeta única, solo esa: lo tiene todo dentro. Sin ella, pliegos: con algún pliego
 * descargado en Drive; oferta: la carpeta de Salidas existe desde que se prepara la oferta (en
 * preparación, descartada tras empezar, presentada o resuelta).
 */
export function carpetasDrive(f, ahora = Date.now()) {
  if (f?.carpeta_unica) return { unica: true, pliegos: false, oferta: false };
  const pliegos = (f?.pliegos ?? []).some((p) => Boolean(p?.ruta));
  const oferta =
    f?.estado === 'en_preparacion' ||
    CON_OFERTA.has(f?.estado) ||
    (f?.estado === 'descartada' && conComprobaciones(f, ahora));
  return { unica: false, pliegos, oferta };
}
