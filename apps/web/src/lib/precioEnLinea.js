// El precio de un lote fijado en la propia fila de las comprobaciones. Puro, con tests.
// Un sugerido nunca cuenta como decidido: solo lo guardado por una persona lo es (el sugerido
// sale de la estadística y no ha visto el pliego entero). Un precio vacío es pendiente.
import { numeroONulo } from './formato.js';
import {
  importeFormulario,
  referenciaPrecio,
  textoBajaPrecio,
  textoPrecio,
  textoUmbralPrecio,
} from './ofertaFormato.js';

const PORCENTAJE = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export const ETIQUETA_ESTADO_PRECIO = {
  sugerido: 'Sugerido (sin guardar)',
  decidido: 'Decidido',
  pendiente: 'Pendiente',
};

const conImporte = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Lo guardado de un lote lleva algún precio (y no está marcado pendiente). */
function tienePrecio(guardado) {
  if (!guardado || guardado.pendiente) return false;
  return conImporte(guardado.importe) || (guardado.unitarios ?? []).some((u) => conImporte(u.precio));
}

const opciones = (sugerido) => ['equilibrio', 'maxima'].map((k) => sugerido?.[k]).filter(Boolean);

// Lo escrito en la fila: el importe total o los precios por concepto, como textos del formulario.
const textosDe = (borrador) =>
  [borrador?.importe ?? '', ...(borrador?.unitarios ?? []).map((u) => u.precio ?? '')].map((t) => String(t).trim());

/**
 * 'decidido' solo si hay precio guardado; 'sugerido' si lo único que hay es una sugerencia (sin
 * escribir nada o con la sugerencia puesta con «Usar», que aún no se ha guardado); si no, 'pendiente'.
 */
export function estadoPrecio({ guardado = null, borrador = null, sugerido = null } = {}) {
  if (tienePrecio(guardado)) return 'decidido';
  const ops = opciones(sugerido);
  if (!ops.length) return 'pendiente';
  const escritos = textosDe(borrador).filter(Boolean);
  if (!escritos.length) return 'sugerido';
  const esSugerencia = escritos.length === 1 && ops.some((o) => numeroONulo(escritos[0]) === o.importe);
  return esSugerencia ? 'sugerido' : 'pendiente';
}

/**
 * Las sugerencias que se enseñan: una sola si equilibrio y máxima probabilidad dan el mismo
 * importe (dos líneas iguales hacen pensar que hay que elegir entre ellas).
 */
export function sugerenciasUnicas(sugerido) {
  const { equilibrio = null, maxima = null } = sugerido ?? {};
  if (equilibrio && maxima && equilibrio.importe === maxima.importe)
    return [{ clave: 'equilibrio', nombre: 'Equilibrio y máxima probabilidad', opcion: equilibrio }];
  return [
    equilibrio ? { clave: 'equilibrio', nombre: 'Equilibrio', opcion: equilibrio } : null,
    maxima ? { clave: 'maxima', nombre: 'Máxima probabilidad', opcion: maxima } : null,
  ].filter(Boolean);
}

/** «Equilibrio y máxima probabilidad: 5.604,00 €» */
export function textoSugerencia(s, unidad = null) {
  return `${s.nombre}: ${textoPrecio(s.opcion.importe, unidad)}`;
}

/** La baja a partir de la cual el pliego (si la fija como baja) o la estimación la tienen por anormal; null si no se sabe. */
export function umbralBaja(sugerido, oe) {
  if (typeof oe?.umbral_baja === 'number') return oe.umbral_baja;
  return typeof sugerido?.umbral_anormal === 'number' ? sugerido.umbral_anormal : null;
}

const dondeDe = (oe) => (oe?.documento ? ` · ${oe.documento}${oe.pagina != null ? ` pág. ${oe.pagina}` : ''}` : '');

/**
 * El umbral de anormalidad que se ve al teclear: manda el del pliego si lo fija como baja; si no,
 * el estimado (art. 85 RGLCAP); si el pliego lo fija de otro modo (sobre la media), se dice dónde.
 */
export function textoUmbral(sugerido, oe = null) {
  if (typeof oe?.umbral_baja === 'number')
    return `Baja máxima sin anormalidad: ${PORCENTAJE.format(oe.umbral_baja * 100)} %${dondeDe(oe)}`;
  const estimado = textoUmbralPrecio(sugerido);
  if (estimado) return estimado;
  if (oe?.umbral_anormalidad)
    return `Umbral de anormalidad: el del pliego${dondeDe(oe)}, que depende de las demás ofertas; compruébalo antes de bajar mucho.`;
  return 'Umbral de anormalidad: el del art. 85 RGLCAP, sin estimar (no hay adjudicaciones parecidas).';
}

/**
 * La baja que da lo tecleado sobre su máximo, con su texto y si pasa del umbral; null sin
 * importe legible o sin máximo con el que compararlo.
 */
export function bajaEnVivo(importe, base, { unidad = null, umbral = null } = {}) {
  if (!conImporte(importe) || !conImporte(base)) return null;
  const baja = (base - importe) / base;
  const pasa = typeof umbral === 'number' && baja > umbral;
  const texto = textoBajaPrecio(importe, base, unidad);
  return { baja, pasa, texto: pasa ? `${texto} Pasa del umbral de anormalidad: habría que justificarla.` : texto };
}

const delLote = (lote) => (lote != null ? `del lote ${lote}` : 'del contrato');

/**
 * Por qué no hay sugerencia, con la causa de verdad: si el guion no trae el máximo del lote
 * (por unidad o el presupuesto), es eso y no «falta el presupuesto de la licitación». null si la hay.
 */
export function causaSinSugerencia(oe, lote = null, sugerido = null) {
  const ref = referenciaPrecio(oe);
  if (ref.base == null)
    return ref.unidad
      ? `No consta el máximo por ${ref.unidad} ${delLote(lote)}: sin él no se puede sugerir un precio.`
      : `No consta el importe máximo ${delLote(lote)}: sin él no se puede sugerir un precio.`;
  if (!sugerido) return `Sin precio sugerido ${delLote(lote)}.`;
  if (!opciones(sugerido).length) return 'Sin precio sugerido: no hay adjudicaciones parecidas con las que compararlo.';
  return null;
}

const ERROR_NUMERO =
  'Escribe el precio en € sin impuestos (p. ej. 95.000 o 1,50), o déjalo vacío si aún no está decidido.';

/**
 * Un precio tecleado: número mayor que 0 y no más que el máximo del lote (por encima, la
 * oferta se excluye). Vacío → data null (pendiente).
 * @returns {{ data: number | null, error: string | null }}
 */
export function leerPrecio(texto, { maximo = null, unidad = null } = {}) {
  const n = numeroONulo(texto);
  if (n === null) return { data: null, error: null };
  if (Number.isNaN(n) || n <= 0) return { data: null, error: ERROR_NUMERO };
  if (conImporte(maximo) && n > maximo)
    return {
      data: null,
      error: `${textoPrecio(n, unidad)} pasa del máximo ${unidad ? `por ${unidad} ` : ''}del lote (${textoPrecio(maximo, unidad)}): la oferta se excluiría.`,
    };
  return { data: n, error: null };
}

/**
 * La fila del formulario (ofertasIniciales) → la oferta del lote que se guarda, o el error. Sin
 * ningún precio queda pendiente.
 * @returns {{ data: object | null, error: string | null }}
 */
export function leerPreciosLote(fila, oe) {
  const lineas = oe?.precios_unitarios ?? [];
  if (!lineas.length) {
    const r = leerPrecio(fila.importe, { maximo: referenciaPrecio(oe).base });
    return r.error
      ? r
      : { data: { lote: fila.lote, pendiente: r.data === null, importe: r.data, unitarios: [] }, error: null };
  }
  const leidos = fila.unitarios.map((u, i) => ({
    concepto: u.concepto,
    r: leerPrecio(u.precio, { maximo: lineas[i]?.maximo ?? null, unidad: lineas[i]?.unidad ?? null }),
  }));
  const mal = leidos.find((x) => x.r.error);
  if (mal) return { data: null, error: `${mal.concepto}: ${mal.r.error}` };
  const unitarios = leidos.filter((x) => x.r.data !== null).map((x) => ({ concepto: x.concepto, precio: x.r.data }));
  return { data: { lote: fila.lote, pendiente: !unitarios.length, importe: null, unitarios }, error: null };
}

/**
 * La fila del formulario de un lote a partir de lo guardado: un precio por concepto de su oferta
 * en el guion (o el importe total), como texto. Gemela de ofertasIniciales para un solo lote.
 */
export function filaInicial(oe, lote, guardado = null) {
  const lineas = oe?.precios_unitarios ?? [];
  const solo =
    lineas.length === 1 && !guardado?.unitarios?.length && conImporte(guardado?.importe) ? guardado.importe : null;
  const unitarios = lineas.map((l) => ({
    concepto: l.concepto,
    precio: importeFormulario(guardado?.unitarios?.find((u) => u.concepto === l.concepto)?.precio ?? solo),
  }));
  return { lote, importe: lineas.length ? '' : importeFormulario(guardado?.importe), unitarios };
}

/** Lo guardado del lote: el suyo o, de unas decisiones de antes sin lotes, el único. */
export function guardadoDeLote(ofertas = [], lote = null) {
  const unica = ofertas.length === 1 && ofertas[0].lote == null ? ofertas[0] : null;
  return ofertas.find((o) => (o.lote ?? null) === lote) ?? unica;
}

/** Las ofertas guardadas con la de este lote puesta (o añadida): la sección «precio» va entera en el PATCH. */
export function ofertasConLote(guardadas = [], oferta) {
  const esEste = (o) => (o.lote ?? null) === (oferta.lote ?? null);
  // El coste estimado se guarda desde el contexto del precio: guardar el precio no lo borra.
  const conCoste = (o) =>
    o.coste_estimado !== undefined && oferta.coste_estimado === undefined
      ? { ...oferta, coste_estimado: o.coste_estimado }
      : oferta;
  return guardadas.some(esEste) ? guardadas.map((o) => (esEste(o) ? conCoste(o) : o)) : [...guardadas, oferta];
}
