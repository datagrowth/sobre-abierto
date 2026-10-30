// Formato y formularios del registro de propuestas (sin React, con tests).
import { euros, lista, numeroONulo, plural } from './formato.js';
import { porcentaje } from './preciosFormato.js';

export const RESULTADOS = [
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'ganada', label: 'Ganada' },
  { key: 'perdida', label: 'Perdida' },
  { key: 'excluida', label: 'Excluida' },
  { key: 'desierta', label: 'Desierta' },
  { key: 'retirada', label: 'Retirada' },
];

export function etiquetaResultadoPropuesta(key) {
  return RESULTADOS.find((r) => r.key === key)?.label ?? key;
}

/**
 * Lista de lo presentado vacía: no es lo mismo no haber presentado nada (total, sin filtros)
 * que no tener ninguna con el resultado o la búsqueda elegidos.
 */
export function textoSinPropuestas({ total = 0, filtro = null, busqueda = '' } = {}) {
  if (!total)
    return 'Aún no hay nada presentado. Se registra desde el pie de las comprobaciones de cada oferta o, si se presentó fuera de Hermes, aquí con «Registrar una presentada fuera de Hermes».';
  const resultado = filtro ? `con el resultado «${etiquetaResultadoPropuesta(filtro)}»` : null;
  if (busqueda) return `Ninguna${resultado ? ` ${resultado}` : ''} coincide con «${busqueda}».`;
  return resultado ? `Ninguna ${resultado}.` : 'Nada que enseñar con estos filtros.';
}

const PCT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** Puntos con su máximo: «70 / 100 (70 %)». */
export function puntosSobre(total, maximo) {
  if (typeof total !== 'number') return '—';
  const pct = typeof maximo === 'number' && maximo > 0 ? ` (${PCT.format((total / maximo) * 100)} %)` : '';
  return `${PCT.format(total)}${typeof maximo === 'number' ? ` / ${PCT.format(maximo)}` : ''}${pct}`;
}

/** Enlace para abrir un documento: los de Conocimiento por la Biblioteca, los de Salidas por Licitaciones. */
export function enlaceDocumento(ruta) {
  if (ruta.startsWith('Conocimiento/'))
    return `/hermes-vault/api/v1/files/raw?path=${encodeURIComponent(ruta.slice('Conocimiento/'.length))}`;
  return `/api/licitaciones/salidas/documento?ruta=${encodeURIComponent(ruta)}`;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ERROR_IMPORTE = 'El importe ofertado es un número mayor que 0 (sin IVA).';

function documentoMalo(docs) {
  const malo = docs.find((d) => !/^(Salidas|Conocimiento)\/./.test(d));
  return malo ? `Los documentos van con su ruta en Drive: «Salidas/…» o «Conocimiento/…» (${malo}).` : null;
}

/** Formulario «Registrar presentación» → cuerpo de la petición, o el error para la persona. */
export function leerPresentacion({ lote = '', fecha = '', importe = '', documentos = [], otros = '', notas = '' }) {
  const importeNum = numeroONulo(importe);
  if (Number.isNaN(importeNum) || importeNum === 0) return { error: ERROR_IMPORTE };
  if (fecha && !FECHA.test(fecha)) return { error: 'La fecha va como AAAA-MM-DD.' };
  const docs = [...new Set([...documentos, ...lista(otros)])];
  const malo = documentoMalo(docs);
  if (malo) return { error: malo };
  const body = { lote: lote.trim(), importe_ofertado: importeNum, documentos: docs, notas };
  return { body: fecha ? { ...body, presentada_en: fecha } : body };
}

// Corregir la oferta ya registrada: fecha, importe y documentos (uno por línea).
function leerOferta({ fecha = '', importe = '', documentos = '' }) {
  const importeNum = numeroONulo(importe);
  if (Number.isNaN(importeNum) || importeNum === 0) return { error: ERROR_IMPORTE };
  if (!FECHA.test(fecha)) return { error: 'La fecha va como AAAA-MM-DD.' };
  const docs = [
    ...new Set(
      String(documentos)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const malo = documentoMalo(docs);
  return malo ? { error: malo } : { body: { presentada_en: fecha, importe_ofertado: importeNum, documentos: docs } };
}

// Los puntos no llevan separador de miles: «70.5» y «70,5» son lo mismo.
function puntosONulo(texto) {
  const t = String(texto ?? '')
    .trim()
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : NaN;
}

const CAMPOS_PUNTOS = ['puntos_tecnica', 'puntos_economica', 'puntos_total', 'puntos_ganador'];

function leerPuntos(campos) {
  const puntos = {};
  for (const c of CAMPOS_PUNTOS) {
    const n = puntosONulo(campos[c]);
    if (Number.isNaN(n)) return { error: 'Las puntuaciones son números de 0 a 1000.' };
    puntos[c] = n;
  }
  const posicion = String(campos.posicion ?? '').trim();
  const pos = posicion ? Number(posicion) : null;
  if (pos !== null && !(Number.isInteger(pos) && pos >= 1 && pos <= 500))
    return { error: 'La posición es un entero de 1 a 500.' };
  return { body: { ...puntos, posicion: pos } };
}

/**
 * Formulario de la propuesta registrada (oferta, resultado, puntos, notas) → cambio para
 * PATCH, o el error. El resultado solo va si cambió: reenviarlo lo daría por puesto a mano
 * y la PLACSP dejaría de actualizarlo.
 */
export function leerResultado(campos, resultadoGuardado) {
  const oferta = leerOferta(campos);
  if (oferta.error) return oferta;
  const puntos = leerPuntos(campos);
  if (puntos.error) return puntos;
  const resultado = campos.resultado !== resultadoGuardado ? { resultado: campos.resultado } : {};
  return {
    body: {
      ...oferta.body,
      ...resultado,
      notas: campos.notas ?? '',
      lecciones: campos.lecciones ?? '',
      ...puntos.body,
    },
  };
}

/** Valores iniciales del formulario a partir de la propuesta guardada. */
export function camposDeResultado(p) {
  const texto = (n) => (typeof n === 'number' ? String(n).replace('.', ',') : '');
  return {
    resultado: p.resultado,
    notas: p.notas ?? '',
    lecciones: p.lecciones ?? '',
    posicion: texto(p.posicion),
    fecha: p.presentada_en ?? '',
    importe: texto(p.importe_ofertado),
    documentos: (p.documentos ?? []).join('\n'),
    ...Object.fromEntries(CAMPOS_PUNTOS.map((c) => [c, texto(p[c])])),
  };
}

export const ETIQUETA_REVISION = { pendiente: 'Pendiente de revisar', aceptada: 'Aceptada' };

/** «Ningún párrafo genérico», «1 párrafo genérico», «3 párrafos genéricos». */
export function textoGenericos(n) {
  if (!n) return 'Ningún párrafo genérico';
  return n === 1 ? '1 párrafo genérico' : `${n} párrafos genéricos`;
}

// --- Aprendido de las actas (lo que dijo la mesa de lo que presentamos) ---

export function etiquetaResultadoActa(resultado) {
  return resultado === 'desconocido' ? 'Sin resultado claro' : etiquetaResultadoPropuesta(resultado);
}

const cifra = (n) => (typeof n === 'number' ? PCT.format(n) : '—');

/** «Nosotros 62,5 · ganador 78 (Empresa X)»; null si el acta no trae puntos ni ganador. */
export function textoPuntosActa(d) {
  if (!d) return null;
  const partes = [];
  if (typeof d.puntos_nuestros === 'number') partes.push(`Tu empresa ${cifra(d.puntos_nuestros)}`);
  if (typeof d.puntos_ganador === 'number' || d.ganador) {
    const g = typeof d.puntos_ganador === 'number' ? ` ${cifra(d.puntos_ganador)}` : '';
    partes.push(`ganador${g}${d.ganador ? ` (${d.ganador})` : ''}`);
  }
  if (!partes.length) return null;
  const texto = partes.join(' · ');
  return texto[0].toUpperCase() + texto.slice(1);
}

/** Filas de la tabla de criterios de un acta: puntos nuestros y del ganador sobre el máximo. */
export function filasCriteriosActa(criterios = []) {
  return criterios.map((c, i) => ({
    clave: `${i}-${c.criterio}`,
    criterio: c.criterio,
    nuestros: `${cifra(c.nuestros)} / ${cifra(c.puntos_max)}`,
    ganador: typeof c.ganador === 'number' ? `${cifra(c.ganador)} / ${cifra(c.puntos_max)}` : '—',
    comentario: c.comentario_mesa ?? '',
    pagina: typeof c.pagina === 'number' ? `pág. ${c.pagina}` : null,
  }));
}

/** Los aprendizajes que se enseñan: sin los descartados, primero los pendientes de revisar y luego los más nuevos. */
export function aprendizajesVisibles(items = []) {
  const orden = (a) => (a.estado === 'pendiente' ? 0 : 1);
  return items
    .filter((a) => a.estado !== 'descartada')
    .sort((a, b) => orden(a) - orden(b) || String(b.creado_en ?? '').localeCompare(String(a.creado_en ?? '')));
}

/** Título de un aprendizaje: expediente (o la carpeta de Presentadas) y órgano. */
export function tituloAprendizaje(a) {
  const nombre =
    a.expediente ||
    String(a.carpeta ?? '')
      .split('/')
      .filter(Boolean)
      .at(-1) ||
    `Aprendizaje ${a.id}`;
  return a.organo ? `${nombre} · ${a.organo}` : nombre;
}

/** Botón «Leer actas pendientes (N)» con el motivo si no hay ninguna. */
export function textoLeerActas(pendientes) {
  const n = typeof pendientes === 'number' ? pendientes : 0;
  return { texto: `Leer actas pendientes (${n})`, motivo: n ? null : 'No hay actas sin leer en Presentadas.' };
}

// --- Presentadas que cuadran (KPI, avisos y muestra mínima) ---

// Una baja de más del 40 % suele ser una errata al registrar o una oferta en temeridad: se revisa.
const BAJA_A_REVISAR = 0.4;
// Con menos decididas, una tasa por sector, banda u órgano es ruido (1 de 1 = 100 %).
const DECIDIDAS_MINIMAS = 5;
const DECIDIDAS = ['ganada', 'perdida', 'excluida'];

/** «Revisa: baja del 57,7 % sobre 100.000 €» con una baja de más del 40 %; null si no. */
export function avisoBaja(p) {
  if (typeof p?.baja_ofertada !== 'number' || p.baja_ofertada <= BAJA_A_REVISAR) return null;
  const sobre = typeof p.presupuesto === 'number' ? ` sobre ${euros(p.presupuesto)}` : '';
  return `Revisa: baja del ${porcentaje(p.baja_ofertada)}${sobre}`;
}

/** Las tablas por sector, banda y órgano, plegadas hasta tener una muestra mínima de decididas. */
export function estadisticasVisibles(e) {
  const decididas = DECIDIDAS.reduce((n, r) => n + (e?.por_resultado?.[r] ?? 0), 0);
  const visibles = decididas >= DECIDIDAS_MINIMAS;
  return { visibles, decididas, texto: visibles ? null : `Con ${plural(decididas, 'decidida')} aún no dicen nada` };
}

/** «1 pendiente de resultado» / «3 pendientes de resultado». */
export function textoPendientes(e) {
  return `${plural(e?.por_resultado?.pendiente ?? 0, 'pendiente')} de resultado`;
}

function deActas(nombres) {
  if (!nombres.length) return 'de las actas';
  if (nombres.length === 1) return `del acta de ${nombres[0]}`;
  return `de las actas de ${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ''}`;
}

/**
 * KPI «Ganadas»: registradas más las que solo constan en las actas, diciendo de dónde salen
 * («1 · del acta de PSTD_2-2026»). Sin `ganadas` (servidor anterior), solo las registradas.
 */
export function textoGanadas(e) {
  const g = e?.ganadas ?? {
    total: e?.por_resultado?.ganada ?? 0,
    registradas: e?.por_resultado?.ganada ?? 0,
    de_actas: 0,
    lista: [],
  };
  const actas = g.lista.filter((x) => x.fuente === 'acta').map((x) => x.nombre);
  const partes = [];
  if (g.registradas) partes.push(`${plural(g.registradas, 'registrada')} (${euros(e?.importe_ganado ?? 0)})`);
  if (g.de_actas) partes.push(g.registradas ? `${g.de_actas} ${deActas(actas)}` : deActas(actas));
  return { valor: g.total, texto: partes.length ? partes.join(' · ') : 'ninguna aún' };
}

/**
 * Las propuestas anteriores que se enseñan como parecidas: sin las débiles (una de IA en
 * compras, salía como parecida de la formación de otras ofertas).
 */
export function parecidasFuertes(items) {
  return (items ?? []).filter((p) => !p.debil);
}
