// Datos de anexo como decisiones: lo que el anexo pide y el pliego no fija
// (subcontratar los servidores, el orden de preferencia de los lotes y el impuesto). Lo que
// pide cada oferta lo dicen las comprobaciones (filas «dato_anexo:-:<dato>», con su cita); aquí, puro.

const DATOS_ANEXO = ['subcontratacion_servidores', 'orden_lotes', 'impuesto'];
export const ETIQUETA_DATO = {
  subcontratacion_servidores: 'Subcontratación de servidores',
  orden_lotes: 'Orden de preferencia de lotes',
  impuesto: 'Impuesto de la oferta',
};
export const TIPOS_IMPUESTO = ['IVA', 'IGIC', 'exento'];
// Tipo general de cada impuesto, como la hoja de datos del servidor: el pliego puede fijar otro.
export const TIPO_GENERAL = { IVA: 21, IGIC: 7, exento: 0 };
export const VACIOS = { subcontratacion_servidores: null, orden_lotes: null, impuesto: null };

const PREFIJO = 'dato_anexo:-:';

/**
 * Los datos que hay que enseñar, en orden fijo: los que las comprobaciones piden (con su cita) y los ya
 * decididos (para poder cambiarlos; su fila ya no está, así que van sin cita).
 */
export function datosPedidos(bloqueos, decididos) {
  const filas = new Map(
    (bloqueos ?? []).filter((b) => b?.clave?.startsWith(PREFIJO)).map((b) => [b.clave.slice(PREFIJO.length), b]),
  );
  return DATOS_ANEXO.filter((d) => filas.has(d) || (decididos?.[d] ?? null) !== null).map((dato) => ({
    dato,
    cita: filas.get(dato)?.cita ?? null,
    gravedad: filas.get(dato)?.gravedad ?? null,
  }));
}

/** «ANEXO V.docx, pág. 108: «…»», o null sin cita. */
export function textoCita(cita) {
  if (!cita?.texto) return null;
  const donde = [cita.documento, cita.pagina ? `pág. ${cita.pagina}` : null].filter(Boolean).join(', ');
  return `${donde ? `${donde}: ` : ''}«${cita.texto}»`;
}

/**
 * Los lotes del campo de orden: solo los decididos. Se respeta el orden guardado de los que
 * siguen y los decididos que faltan van al final.
 */
export function lotesParaOrden(orden, decididos) {
  const lotes = (decididos ?? []).map(String);
  const guardados = (orden ?? []).map(String).filter((l, i, xs) => lotes.includes(l) && xs.indexOf(l) === i);
  return [...guardados, ...lotes.filter((l) => !guardados.includes(l))];
}

/** La lista con el elemento i movido un puesto arriba (-1) o abajo (+1); igual si no se puede. */
export function mover(lista, i, delta) {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return lista;
  const copia = [...lista];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

/** «sí» | «no» | «» (sin decidir) del selector, a lo que se guarda. */
const subcontrataDe = (v) => (v === 'si' ? true : v === 'no' ? false : null);
const valorSubcontrata = (b) => (b === true ? 'si' : b === false ? 'no' : '');

function impuestoDe(tipo, porcentaje) {
  if (!tipo) return { data: null, error: null };
  if (!TIPOS_IMPUESTO.includes(tipo)) return { data: null, error: `«${tipo}» no es un impuesto: IVA, IGIC o exento.` };
  if (tipo === 'exento') return { data: { tipo, porcentaje: 0 }, error: null };
  const texto = String(porcentaje ?? '')
    .trim()
    .replace(',', '.');
  const n = texto === '' ? TIPO_GENERAL[tipo] : Number(texto);
  if (!Number.isFinite(n) || n < 0 || n > 30) return { data: null, error: 'El tipo del impuesto va de 0 a 30 %.' };
  return { data: { tipo, porcentaje: n }, error: null };
}

/**
 * Lo que se guarda (PATCH /oferta/decisiones/datos_anexo) a partir del formulario: lo que no se
 * enseña se queda como estaba. { data, error }.
 */
export function datosAnexoDeFormulario(form, guardados, pedidos) {
  const ver = new Set(pedidos.map((p) => p.dato));
  const imp = impuestoDe(form.impuesto_tipo, form.impuesto_porcentaje);
  if (imp.error) return { data: null, error: imp.error };
  const base = { ...VACIOS, ...(guardados ?? {}) };
  return {
    data: {
      subcontratacion_servidores: ver.has('subcontratacion_servidores')
        ? subcontrataDe(form.subcontratacion)
        : base.subcontratacion_servidores,
      orden_lotes: ver.has('orden_lotes') ? (form.orden_lotes?.length ? form.orden_lotes : null) : base.orden_lotes,
      impuesto: ver.has('impuesto') ? imp.data : base.impuesto,
    },
    error: null,
  };
}

/** El formulario de partida con lo guardado; el orden, con los lotes decididos. */
export function formularioInicial(guardados, lotesDecididos) {
  const g = { ...VACIOS, ...(guardados ?? {}) };
  return {
    subcontratacion: valorSubcontrata(g.subcontratacion_servidores),
    orden_lotes: lotesParaOrden(g.orden_lotes, lotesDecididos),
    impuesto_tipo: g.impuesto?.tipo ?? '',
    impuesto_porcentaje: g.impuesto && g.impuesto.tipo !== 'exento' ? String(g.impuesto.porcentaje ?? '') : '',
  };
}
