// Textos y filtros de la Biblioteca: sin React, con tests.

export const TIPOS_NOTA = {
  caso_exito: 'Caso de éxito',
  metodologia: 'Metodología',
  ficha_servicio: 'Ficha de servicio',
  normativa_cliente: 'Normativa del cliente',
  oferta_presentada: 'Oferta presentada',
  plantilla: 'Plantilla',
};

const carpetaDe = (ruta) => ruta.split('/').slice(0, -1).join('/');

/** Las notas con su uso en ofertas (de /biblioteca/usos), listas para la tabla. */
export function filasDeNotas(notas = [], usos = {}) {
  return notas.map((n) => ({ ...n, carpeta: carpetaDe(n.path), usos: usos[n.path] ?? 0 }));
}

/** Filtros de Explorar: tipos marcados (vacío = todos), sector, estado (al_dia/revisar) y texto. */
export function filtrarNotas(filas, f = {}) {
  const texto = (f.texto ?? '').trim().toLowerCase();
  return filas.filter(
    (n) =>
      (!f.tipos?.length || f.tipos.includes(n.tipo ?? 'sin_tipo')) &&
      (!f.sector || n.sector === f.sector) &&
      (!f.estado || (f.estado === 'revisar') === Boolean(n.revisar)) &&
      (!texto || `${n.title} ${n.path}`.toLowerCase().includes(texto)),
  );
}

/** Cuántas notas hay de cada tipo (para las casillas) y los sectores que aparecen. */
export function recuentos(filas) {
  const tipos = {};
  for (const n of filas) tipos[n.tipo ?? 'sin_tipo'] = (tipos[n.tipo ?? 'sin_tipo'] ?? 0) + 1;
  const sectores = [...new Set(filas.map((n) => n.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  return { tipos, sectores, revisar: filas.filter((n) => n.revisar).length };
}

export const textoUsos = (n) => (n === 0 ? '—' : n === 1 ? '1 oferta' : `${n} ofertas`);

// Con punto de miles también en 1.284 (el español de Intl no agrupa los de cuatro cifras).
const MILES = new Intl.NumberFormat('es-ES', { useGrouping: 'always' });

/** La línea del indexador: «Búsqueda al día: 1.284 documentos y 312 notas leídos. 3 PDF escaneados sin texto.». */
export function lineaIndexador(estado) {
  const s = estado?.status;
  if (!s) return estado?.error ? `El índice no responde: ${estado.error}` : 'El índice aún no ha arrancado.';
  const n = (x) => MILES.format(Number(x ?? 0));
  const base = s.phase === 'idle' ? 'Búsqueda al día' : 'Leyendo la Biblioteca';
  const escaneados = s.scanned ? ` ${n(s.scanned)} PDF escaneados sin texto.` : '';
  return `${base}: ${n(s.documents)} documentos y ${n(s.notes)} notas leídos.${escaneados}`;
}

/** De dónde sale una propuesta de Hermes: un documento, un párrafo que se repite o un acta. */
export function origenDePropuesta(fm = {}) {
  if (fm.origen_tipo === 'parrafo') return 'Párrafo que se repite';
  const fuente = typeof fm.fuente === 'string' ? fm.fuente : '';
  if (/\bacta\b|valoraci[oó]n|resoluci[oó]n/i.test(fuente.split('/').pop() ?? '')) return 'Desde un acta';
  if (fuente) return 'Desde un documento';
  return 'Propuesta de Hermes';
}

export const LEIBLE = (d) => d.estado === 'ok';

/** El texto de un documento que no se puede leer: escaneado o con texto ilegible. */
export function motivoIlegible(d) {
  if (d.estado === 'scanned') return 'PDF escaneado sin texto: necesita OCR';
  return d.error ? `No se puede leer: ${d.error}` : 'No se puede leer';
}

export const TENEMOS = {
  nada: { texto: 'Nada', tono: 'impide' },
  solo_documentos: { texto: 'Solo documentos, sin nota', tono: 'riesgo' },
  nota_antigua: { texto: 'Nota sin revisar', tono: 'riesgo' },
};
