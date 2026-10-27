// Formato del bloque «Antecedentes» (sin React, con tests): nivel de indicios, duración,
// periodo del contrato y la línea de tiempo agrupada por edición.

export const NIVELES = {
  bajo: { etiqueta: 'Bajo', texto: 'Pocos indicios de licitación con nombre' },
  medio: { etiqueta: 'Medio', texto: 'Algunos indicios de licitación con nombre' },
  alto: { etiqueta: 'Alto', texto: 'Varios indicios de licitación con nombre' },
  sin_datos: { etiqueta: 'Sin datos', texto: 'Sin datos para valorar: ni ediciones anteriores ni indicios' },
};

/**
 * Nivel que se enseña. Sin ediciones anteriores ni indicios con puntos, el «bajo» del
 * servidor es falta de datos, no una buena señal: «sin_datos».
 */
export function nivelVisible(indicios, ediciones) {
  if (!ediciones?.length && !((indicios?.puntos ?? 0) > 0)) return 'sin_datos';
  return indicios?.nivel ?? 'sin_datos';
}

/** Ediciones distintas (la línea tiene una fila por adjudicación: una edición de 4 lotes son 4 filas). */
function contarEdiciones(hitos = []) {
  return new Set(hitos.map((h) => h.licitacion_id)).size;
}

/**
 * Las adjudicaciones del mismo órgano (las de Precios → Adjudicaciones parecidas con «Solo este
 * órgano»), repartidas: de objeto parecido y de otro objeto (el servidor marca otro_objeto).
 */
export function repartirDelOrgano(comparables = []) {
  const delOrgano = comparables.filter((c) => c.mismo_organo);
  return { parecidas: delOrgano.filter((c) => !c.otro_objeto), otro_objeto: delOrgano.filter((c) => c.otro_objeto) };
}

const cuantas = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;

// Hay adjudicaciones del mismo órgano: «no hay ediciones del mismo órgano» contradiría la tabla
// de Precios, que las marca «mismo órgano». Se dice por qué ninguna cuenta como edición.
function motivoConAdjudicaciones(por, { parecidas, otro_objeto: otras }) {
  const partes = [
    parecidas.length
      ? `${cuantas(parecidas.length, 'adjudicación suya de objeto parecido no cumple', 'adjudicaciones suyas de objeto parecido no cumplen')} las reglas de edición (publicada al menos seis meses antes, en el mismo sitio y con un importe parecido): ${parecidas.length === 1 ? 'está' : 'están'} en Precios → Adjudicaciones parecidas`
      : null,
    otras.length
      ? `${cuantas(otras.length, 'adjudicación es', 'adjudicaciones son')} de otro objeto y ${otras.length === 1 ? 'va plegada' : 'van plegadas'} debajo`
      : null,
  ].filter(Boolean);
  return `Ninguna licitación anterior del mismo órgano (${por}) cuenta como edición de esta: ${partes.join('; ')}.`;
}

/** Por qué no hay ediciones, para decirlo a la vista y no solo en el plegable. */
export function motivoSinEdiciones(datos, delOrgano = null) {
  const por = datos?.licitacion?.organo_por;
  if (!por)
    return 'No se puede identificar el órgano (la licitación no trae NIF, DIR3 ni un nombre reconocible): no se buscan ediciones anteriores.';
  if (delOrgano && (delOrgano.parecidas.length || delOrgano.otro_objeto.length))
    return motivoConAdjudicaciones(por, delOrgano);
  const sinNif = /DIR3/.test(por)
    ? ' Si el órgano no tiene NIF y el histórico se cargó antes, «Volver a cargar los años hechos» trae su órgano superior.'
    : '';
  return `No hay ediciones anteriores del mismo órgano (${por}) en el histórico cargado. Si esperabas alguna, carga más años en Ajustes › Fuentes y filtros › Histórico.${sinNif}`;
}

/** Título del plegable: «Otro objeto del mismo órgano (3)». */
export function tituloOtroObjeto(n) {
  return `Otro objeto del mismo órgano (${n})`;
}

export function etiquetaNivel(nivel) {
  return NIVELES[nivel]?.etiqueta ?? nivel ?? '—';
}

const UNIDADES = { DAY: ['día', 'días'], WEE: ['semana', 'semanas'], MON: ['mes', 'meses'], ANN: ['año', 'años'] };

/** { valor: 24, unidad: 'MON' } → «24 meses»; null → «—». */
export function textoDuracion(d) {
  if (!d || typeof d.valor !== 'number') return '—';
  const [uno, varios] = UNIDADES[d.unidad] ?? [d.unidad, d.unidad];
  return `${d.valor} ${d.valor === 1 ? uno : varios}`;
}

const FECHA = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/**
 * «2024-01-01» → «01/01/2024»; vacía o ilegible → null. Numérica y sin zona horaria: en los
 * periodos de contratos se compara mejor que la fechaCorta de formato.js («lun 1 ene»).
 */
export function fechaNumerica(iso) {
  if (!iso) return null;
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : FECHA.format(new Date(t));
}

/** Inicio y fin del contrato: «01/01/2024 – 31/12/2024», con «≈» si el fin es estimado. */
export function textoPeriodo({ inicio, fin, fin_estimado: estimado }) {
  const i = fechaNumerica(inicio);
  const f = fechaNumerica(fin);
  if (!i && !f) return '—';
  return `${i ?? '?'} – ${f ? `${estimado ? '≈ ' : ''}${f}` : '?'}`;
}

/** Parecido 0–1 → «87 %». */
export function textoParecido(p) {
  return typeof p === 'number' && Number.isFinite(p) ? `${Math.round(p * 100)} %` : '—';
}

/**
 * Filas de la línea de tiempo agrupadas por edición (en el orden en que llegan, de la más
 * reciente a la más antigua), para pintar el año y el expediente una sola vez.
 */
export function agruparPorEdicion(hitos = []) {
  const grupos = [];
  for (const h of hitos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.licitacion_id === h.licitacion_id) ultimo.filas.push(h);
    else
      grupos.push({
        licitacion_id: h.licitacion_id,
        anio: h.anio,
        expediente: h.expediente,
        titulo: h.titulo,
        url: h.url,
        similitud: h.similitud,
        filas: [h],
      });
  }
  return grupos;
}

/** Opciones del selector: el contrato y cada lote con ediciones o indicios. */
export function vistasAntecedentes(datos) {
  const lotes = (datos?.lotes ?? []).map((l) => ({
    clave: `lote-${l.id}`,
    etiqueta: `Lote ${l.id}`,
    nivel: nivelVisible(l.indicios, l.ediciones),
    n: contarEdiciones(l.ediciones),
  }));
  const ediciones = datos?.ediciones ?? [];
  return [
    {
      clave: 'contrato',
      etiqueta: 'Contrato',
      nivel: nivelVisible(datos?.indicios, ediciones),
      n: contarEdiciones(ediciones),
    },
    ...lotes,
  ];
}

/** La línea y los indicios de la vista elegida («contrato» o «lote-<id>»). */
export function vistaElegida(datos, clave) {
  const lote = (datos?.lotes ?? []).find((l) => `lote-${l.id}` === clave);
  if (lote)
    return {
      titulo: `Lote ${lote.id}${lote.nombre ? ` · ${lote.nombre}` : ''}`,
      ediciones: lote.ediciones,
      indicios: lote.indicios,
    };
  return {
    titulo: 'Contrato entero',
    ediciones: datos?.ediciones ?? [],
    indicios: datos?.indicios ?? { nivel: 'bajo', puntos: 0, indicios: [], sin_datos: [] },
  };
}

// Señales de pliego a medida que propone Hermes en la ficha (senales_pliego).
const SENALES = {
  experiencia_especifica: 'Experiencia muy específica',
  tecnologia_especifica: 'Tecnología o herramienta concreta',
  marca_o_compatibilidad: 'Marca o compatibilidad obligatoria',
  juicio_valor_favorece: 'Juicio de valor que favorece a quien ya lo presta',
  solvencia_a_medida: 'Solvencia a medida',
  otra: 'Otra señal',
};

/** «Marca o compatibilidad obligatoria (lote 2): … «cita» (PCAP.pdf, pág. 12)». */
export function textoSenal(s) {
  const donde = [s.documento, s.pagina ? `pág. ${s.pagina}` : null].filter(Boolean).join(', ');
  return `${SENALES[s.tipo] ?? s.tipo}${s.lote ? ` (lote ${s.lote})` : ''}: ${s.descripcion}${s.cita ? ` «${s.cita}»` : ''}${donde ? ` (${donde})` : ''}`;
}
