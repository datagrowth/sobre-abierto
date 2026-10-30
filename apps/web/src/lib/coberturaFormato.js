// La auditoría de cobertura en Ajustes › Fuentes y filtros, sin React y con tests: el
// veredicto de cada comunidad en palabras, lo que le falta a la agregada y la anotación de la
// cifra de la plataforma autonómica.
import { porcentaje } from './preciosFormato.js';

export const VEREDICTOS = {
  anadir_fuente: { texto: 'Añadir fuente directa', tono: 'impide' },
  basta_placsp: { texto: 'Basta la PLACSP', tono: 'ok' },
  sin_dato: { texto: 'Sin cifra autonómica', tono: 'neutro' },
};

/** «falta un 12,5 %» o, sin comparar, «—». */
export function textoFalta(falta) {
  return falta === null || falta === undefined ? '—' : porcentaje(falta);
}

/** Los lunes del informe (las semanas contadas), del más reciente al más antiguo. */
export function semanasDelInforme(informe) {
  const todas = new Set((informe?.comunidades ?? []).flatMap((c) => c.semanas.map((s) => s.semana)));
  return [...todas].sort().reverse();
}

/** El cuerpo de PUT /cobertura/autonomica: { data } o { error } con lo que falta. */
export function cuerpoAnotacion({ semana, comunidad, publicadas, fuente }) {
  const n = Number(String(publicadas ?? '').trim());
  if (!semana) return { data: null, error: 'Elige la semana.' };
  if (!/^ES[0-9A-Z]{2}$/.test(comunidad ?? '')) return { data: null, error: 'Elige la comunidad.' };
  if (String(publicadas ?? '').trim() === '' || !Number.isInteger(n) || n < 0)
    return { data: null, error: 'Escribe cuántas publicó la plataforma esa semana.' };
  if (String(fuente ?? '').trim().length < 3)
    return { data: null, error: 'Di de dónde sale la cifra (el portal de datos abiertos).' };
  return { data: { semana, comunidad, publicadas: n, fuente: fuente.trim() }, error: null };
}
