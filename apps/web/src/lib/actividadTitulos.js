// Actividad legible: los ids de licitación del texto se cambian por su título y los
// errores técnicos se acompañan de una explicación en castellano.
import { useEffect, useMemo, useState } from 'react';

const ID_EN_TEXTO = /\b[pa]-[A-Za-z0-9_-]{1,30}\b/g;
const MAX_IDS = 50;

/** Ids de licitación («p-123», «a-9») que aparecen en un texto, sin repetir y como mucho 50. */
export function idsEnTexto(texto) {
  if (typeof texto !== 'string') return [];
  return [...new Set(texto.match(ID_EN_TEXTO) ?? [])].slice(0, MAX_IDS);
}

/**
 * Parte el texto en trozos { tipo: 'texto', texto } y { tipo: 'enlace', id, texto: titulo }.
 * Un id sin título conocido se queda como texto: no se inventa nada.
 */
export function conTitulos(texto, mapa = {}) {
  const base = typeof texto === 'string' ? texto : '';
  const trozos = [];
  let desde = 0;
  for (const m of base.matchAll(ID_EN_TEXTO)) {
    const titulo = mapa[m[0]];
    if (!titulo) continue;
    if (m.index > desde) trozos.push({ tipo: 'texto', texto: base.slice(desde, m.index) });
    trozos.push({ tipo: 'enlace', id: m[0], texto: titulo });
    desde = m.index + m[0].length;
  }
  if (desde < base.length) trozos.push({ tipo: 'texto', texto: base.slice(desde) });
  return trozos;
}

const EXPLICACION_ERROR = [
  [/invalid_input/i, 'Hermes envió un dato que la plataforma no acepta.'],
  [/not_found/i, 'Lo que Hermes buscó ya no existe o no es de esta licitación.'],
  [/conflicto/i, 'Alguien cambió lo mismo a la vez; hay que revisar y repetir.'],
  [/forbidden|unauthorized|401|403/i, 'Hermes no tiene permiso para hacer esto.'],
  [/no_configurado/i, 'Falta configurar algo en la plataforma para poder hacerlo.'],
  [/too_large/i, 'El archivo es demasiado grande.'],
  [/io_error/i, 'La plataforma no pudo leer o guardar un archivo.'],
  [/timeout|timed out|ETIMEDOUT/i, 'Tardó demasiado y se cortó.'],
  [/rate.?limit|429|limite/i, 'Se alcanzó el límite de uso del modelo; se reintenta más tarde.'],
];

/** Explicación en castellano de un resultado de error, o null si no se reconoce (se enseña solo el texto). */
export function explicarError(texto) {
  if (typeof texto !== 'string' || !texto) return null;
  return EXPLICACION_ERROR.find(([re]) => re.test(texto))?.[1] ?? null;
}

/** El texto con cada id de título conocido leído como «título» (para sitios sin enlaces). */
export function textoConTitulos(texto, mapa = {}) {
  return conTitulos(texto, mapa)
    .map((t) => (t.tipo === 'enlace' ? `«${t.texto}»` : t.texto))
    .join('');
}

// Lo ya preguntado vive entre montajes: cada id se pide una sola vez ('' = sin título).
const CACHE_TITULOS = new Map();

/** { id: título } de los ids de licitación de los textos; si el servidor falla, quedan los ids. */
export function useTitulos(textos) {
  const [version, setVersion] = useState(0);
  const ids = useMemo(() => idsEnTexto(textos.join(' ')), [textos]);
  useEffect(() => {
    const faltan = ids.filter((id) => !CACHE_TITULOS.has(id));
    if (faltan.length === 0) return undefined;
    let vivo = true;
    // Import perezoso: el cliente HTTP necesita el navegador y las pruebas de las funciones puras no.
    import('./apiCliente')
      .then(({ request }) => request(`/api/licitaciones/titulos?ids=${faltan.map(encodeURIComponent).join(',')}`))
      .then((res) => faltan.forEach((id) => CACHE_TITULOS.set(id, res?.[id] ?? '')))
      .catch(() => {
        /* sin títulos se ven los ids tal cual */
      })
      .finally(() => {
        if (vivo) setVersion((v) => v + 1);
      });
    return () => {
      vivo = false;
    };
  }, [ids]);
  // `version` fuerza releer la caché cuando llegan títulos nuevos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(ids.map((id) => [id, CACHE_TITULOS.get(id) ?? ''])), [ids, version]);
}
