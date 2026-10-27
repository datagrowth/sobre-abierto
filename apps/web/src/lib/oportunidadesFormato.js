// Oportunidades, sin React y con tests: las pestañas, los filtros del prefiltro a la
// vista (empiezan con los de Ajustes › Fuentes y filtros y se afinan sin tocarlos) y la consulta
// de GET /revision que salen de ellos.
import { euros, instanteLocal, plural } from './formato.js';

// Mientras nadie guarde los suyos, el prefiltro usa los de ejemplo (prefiltro.ts, FILTROS_INICIALES).
export const AJUSTA_TUS_CPV = 'Ajusta tus CPV: estos filtros son un ejemplo para una consultora de datos y tecnología.';

export const PESTANAS_OPORTUNIDADES = [
  { key: 'por_revisar', label: 'Por revisar' },
  { key: 'sin_cribar', label: 'Sin cribar' },
  { key: 'errores', label: 'Errores' },
  { key: 'descartadas', label: 'Descartadas' },
];
export const PESTANA_INICIAL = 'por_revisar';

export const OPINIONES = [
  { key: 'interesa', label: 'Interesa' },
  { key: 'revisar', label: 'Revisar' },
  { key: 'descartar', label: 'Descarta' },
];
export const TIPOS_CONTRATO = [
  { key: '2', label: 'Servicios' },
  { key: '1', label: 'Suministros' },
  { key: '3', label: 'Obras' },
];
export const IDIOMAS = [
  { key: 'ca', label: 'Catalán' },
  { key: 'eu', label: 'Euskera' },
  { key: 'gl', label: 'Gallego' },
];

/** Los filtros a la vista con los del prefiltro (GET /filtros) de partida; sin prefiltro, sin filtros. */
export function filtrosIniciales(prefiltro) {
  return {
    opinion: OPINIONES.map((o) => o.key),
    comunidades: [],
    importe_min: prefiltro?.importe_min ?? null,
    importe_max: prefiltro?.importe_max ?? null,
    cpv: prefiltro?.cpv_prefijos ?? [],
    palabras: prefiltro?.palabras ?? [],
    excluir: prefiltro?.excluir_palabras ?? [],
    tipos: prefiltro?.tipos_contrato ?? [],
    idiomas: prefiltro?.excluir_idiomas ?? [],
  };
}

/** «15.000 €», «15000» o «15.000,50» → 15000 (o 15000.5); vacío o no numérico, null. */
export function leerImporte(texto) {
  const limpio = String(texto ?? '')
    .replace(/[€\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Un importe para el campo: «15.000 €», o vacío. */
export const textoImporte = (n) => (n === null || n === undefined ? '' : euros(n));

/**
 * La consulta de GET /revision: solo lo que filtra (las listas vacías y lo nulo no se mandan). La
 * opinión solo cuenta en «Por revisar». Sin comunidades marcadas, todas.
 */
export function consultaRevision({
  pestana = PESTANA_INICIAL,
  texto = '',
  pliegos = false,
  filtros,
  pagina = 1,
  limite = 50,
}) {
  const q = new URLSearchParams({ pestana, pagina: String(pagina), limite: String(limite) });
  if (texto.trim()) q.set('texto', texto.trim());
  if (texto.trim() && pliegos) q.set('pliegos', '1');
  const f = filtros ?? filtrosIniciales(null);
  if (pestana === 'por_revisar' && f.opinion.length < OPINIONES.length) q.set('opinion', f.opinion.join(','));
  if (f.comunidades?.length) q.set('comunidad', f.comunidades.join(','));
  if (f.importe_min !== null) q.set('importe_min', String(f.importe_min));
  if (f.importe_max !== null) q.set('importe_max', String(f.importe_max));
  for (const k of ['cpv', 'palabras', 'excluir', 'tipos', 'idiomas']) if (f[k].length) q.set(k, f[k].join(','));
  return q.toString();
}

/** Añade un valor a una lista de etiquetas (sin repetirlo ni dejar vacíos). */
export function anadirEtiqueta(lista, valor) {
  const v = String(valor ?? '').trim();
  return v && !lista.includes(v) ? [...lista, v] : lista;
}

/** «Hermes: Interesa» o «Descarta» para la columna Hermes. */
export function textoOpinion(opinion) {
  return OPINIONES.find((o) => o.key === opinion)?.label ?? 'Revisar';
}

/** «12 de 40 oportunidades» al pie de la lista. */
export function textoPieOportunidades(vistas, total) {
  return vistas === total
    ? plural(total, 'oportunidad', 'oportunidades')
    : `${vistas} de ${plural(total, 'oportunidad', 'oportunidades')}`;
}

/** La misma consulta pidiendo otra página. */
export function conPagina(consulta, pagina) {
  const q = new URLSearchParams(consulta);
  q.set('pagina', String(pagina));
  return q.toString();
}

/** Las páginas pedidas en una sola respuesta: cuentas y total de la última, filas en orden y sin repetir. */
export function unirPaginas(paginas) {
  const vistas = new Set();
  const items = paginas.flatMap((p) => p.items).filter((x) => !vistas.has(x.id) && vistas.add(x.id));
  return { ...paginas[paginas.length - 1], items };
}

/**
 * El plazo que ordena la fila (como GET /revision): en un procedimiento en dos fases, la solicitud
 * de participación mientras siga abierta; si no, la presentación de la oferta.
 */
export function plazoQueManda(fila, ahora = Date.now()) {
  const solicitud = instanteLocal(fila.fecha_solicitud);
  return solicitud !== null && solicitud >= ahora
    ? { fecha: fila.fecha_solicitud, solicitud: true }
    : { fecha: fila.fecha_limite, solicitud: false };
}

const LARGO_ETIQUETA_CPV = 30;

/**
 * La etiqueta de un prefijo CPV con su descripción oficial, corta («72 · Servicios TI:
 * consultoría…»); la entera va en el título. Sin descripción, el prefijo solo.
 */
export function etiquetaCpv(prefijo, descripcion) {
  if (!descripcion) return { texto: prefijo, titulo: undefined };
  const corta =
    descripcion.length <= LARGO_ETIQUETA_CPV
      ? descripcion
      : `${descripcion.slice(0, LARGO_ETIQUETA_CPV).replace(/[\s,;:]+\S*$/, '')}…`;
  return { texto: `${prefijo} · ${corta}`, titulo: `${prefijo} · ${descripcion}` };
}

const NOMBRE_PLIEGO = {
  pcap: 'el PCAP',
  ppt: 'el PPT',
  adicional: 'un documento adicional',
  otro: 'otro documento',
  anuncio: 'un anuncio',
};

/** Dónde aparece lo buscado en los pliegos: «En el PPT, pág. 2: «…»». Nada si no viene de un pliego. */
export function textoEnPliego(enPliego) {
  if (!enPliego) return null;
  const donde = `${NOMBRE_PLIEGO[enPliego.clase] ?? 'un pliego'}${enPliego.pagina ? `, pág. ${enPliego.pagina}` : ''}`;
  return `En ${donde}: «${enPliego.texto}»`;
}
