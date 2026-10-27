// El título que se lee en una tarjeta (Pipeline, Equipo › A incorporar), sin el arranque habitual de la PLACSP.

// Se recorta en palabra. Sin dependencias: lo usan módulos de la oferta que no pueden cargar el Pipeline (ciclo
// con las comprobaciones).
const MAX_TITULO_CORTO = 60;
// Lo que repiten casi todos los títulos de la PLACSP y no dice de qué va. Solo con su «de» o «para»
// detrás: «Servicio Canario de la Salud» o «Servicios sociales» se quedan como están.
const ARRANQUES = [
  /^contrataci[oó]n\s+(anticipada,?\s+)?(por\s+lotes,?\s+)?(de\s+(los\s+|las\s+|la\s+|el\s+)?|del\s+)/i,
  /^(servicios?|suministros?)\s+(necesarios?\s+para\s+(la\s+|el\s+)?|para\s+(la\s+|el\s+)?|de\s+(la\s+|el\s+|los\s+|las\s+)?)/i,
  /^(prestaci[oó]n|ejecuci[oó]n|realizaci[oó]n)\s+del?\s+(servicio\s+de\s+|servicios\s+de\s+)?(la\s+|el\s+|los\s+|las\s+)?/i,
];

/** Un título que se lee en la tarjeta: sin el arranque de siempre, con mayúscula y recortado en palabra. */
export function tituloCorto(titulo: string, maximo = MAX_TITULO_CORTO): string {
  let t = titulo.trim().replace(/\s+/g, ' ');
  for (const re of ARRANQUES) t = t.replace(re, '');
  if (!t) t = titulo.trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= maximo) return t.replace(/[.,;:]$/, '');
  const corte = t.slice(0, maximo - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > maximo / 2 ? corte.slice(0, espacio) : corte).replace(/[.,;:]$/, '')}…`;
}
