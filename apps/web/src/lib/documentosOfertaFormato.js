// Formato y lógica de los documentos de la presentación: «Rellenar con Hermes» un anexo, su vista
// previa, el DEUC y la hoja de datos, sin React y con tests.
import { enlaceDocumento } from './propuestasFormato.js';
import { lotesDeDocumento } from './documentosVista.js';
import { enumerar, textoEnCurso } from './memoriaFormato.js';

/** «Rellenar con Hermes» de un documento: null sin datos del anexo; si no, si se puede, por qué no, en curso y avisos. */
export function estadoAnexo(d) {
  const a = d?.anexo;
  if (!a) return null;
  const enCurso = textoEnCurso(a.en_curso, 'Hermes lo está rellenando…', 'En cola para rellenar…');
  return {
    rellenable: Boolean(a.rellenable),
    motivo: a.rellenable ? null : (a.motivo ?? null),
    enCurso,
    avisos: a.avisos ?? [],
    modelo: modeloDelAnexo(a.modelo),
    deuc: a.deuc ?? null,
  };
}

// «Abrir el modelo original» en su página: los visores de PDF del navegador entienden «#page=N».
function modeloDelAnexo(m) {
  if (!m?.ruta) return null;
  const pagina = Number.isInteger(m.pagina) && m.pagina > 0 ? m.pagina : null;
  return {
    tipo: m.tipo,
    url: `${enlaceDocumento(m.ruta)}${pagina ? `#page=${pagina}` : ''}`,
    pagina,
    hasta: Number.isInteger(m.hasta_pagina) ? m.hasta_pagina : null,
  };
}

const textoPaginas = (desde, hasta) => {
  if (!desde) return '';
  return hasta && hasta !== desde ? ` (págs. ${desde}-${hasta})` : ` (pág. ${desde})`;
};

/** Qué es el borrador según el modelo del que sale (con campos, transcrito o Word); null sin borrador. */
export function textoTipoBorrador(d) {
  if (!d?.ruta) return null;
  const m = modeloDelAnexo(d.anexo?.modelo);
  if (m?.tipo === 'campos') return 'Borrador relleno por Hermes (PDF con campos)';
  if (m?.tipo === 'transcrito')
    return `Borrador transcrito del PDF del pliego${textoPaginas(m.pagina, m.hasta)}: compáralo con el original`;
  return 'Borrador relleno por Hermes';
}

const esPdf = (r) => typeof r === 'string' && /\.pdf$/i.test(r);

/** La vista previa del borrador: la ruta del PDF (el propio o la conversión del Word) o, si no la hay, por qué. */
export function vistaPreviaAnexo(d) {
  if (!d?.ruta) return null;
  if (esPdf(d.ruta)) return { ruta: d.ruta, texto: null };
  if (esPdf(d.ruta_pdf)) return { ruta: d.ruta_pdf, texto: null };
  return { ruta: null, texto: 'Sin vista previa: abre el Word' };
}

// Un campo de la hoja es de otro lote si su grupo («Oferta · Lote 2») o su etiqueta («… (lote 2)») lo dicen.
function loteDeCampo(c) {
  const m = /· Lote (\S+)$/.exec(c.grupo ?? '') ?? /\(lote (\S+)\)$/.exec(c.etiqueta ?? '');
  return m ? m[1] : null;
}

/** Los valores de la hoja para copiar en un anexo a mano: los del lote del documento (y los comunes) que no faltan. */
export function valoresDelAnexo(hoja, d) {
  const lotes = lotesDeDocumento(d);
  return (hoja?.campos ?? []).filter((c) => {
    if (c.falta || !c.valor) return false;
    const l = loteDeCampo(c);
    return l === null || !lotes.length || lotes.includes(l);
  });
}

/** «Etiqueta: valor» por línea, para «Copiar todo». */
export const textoValoresAnexo = (valores = []) => valores.map((c) => `${c.etiqueta}: ${c.valor}`).join('\n');

/** «DEUC preparado para importar (v2) · quedan 15 preguntas por responder en el servicio» o que aún no hay. */
export function textoDeuc(deuc) {
  if (!deuc?.version || !deuc.respuesta) return 'Aún no hay DEUC preparado';
  const base = `DEUC preparado para importar (v${deuc.version})`;
  const n = deuc.sin_responder?.length;
  if (n === undefined) return base;
  if (n === 0) return `${base} · no queda ninguna pregunta por responder en el servicio`;
  return `${base} · ${n === 1 ? 'queda 1 pregunta' : `quedan ${n} preguntas`} por responder en el servicio`;
}

/**
 * Ruta y nota de un documento → cambio para PATCH (solo lo que cambió), o el error. Una
 * ruta vacía va como null (quitarla); la nota vacía, como texto vacío.
 */
export function leerCambioDocumento({ ruta = '', nota = '' }, fila) {
  const r = String(ruta).trim();
  const n = String(nota).trim();
  if (r && !/^(Salidas|Conocimiento)\/./.test(r))
    return { error: 'La ruta va con su carpeta en Drive: «Salidas/…» o «Conocimiento/…».' };
  if (n.length > 1000) return { error: 'La nota tiene como mucho 1.000 caracteres.' };
  const body = {};
  if (r !== (fila.ruta ?? '')) body.ruta = r || null;
  if (n !== (fila.nota ?? '')) body.nota = n;
  return Object.keys(body).length ? { body } : { error: 'No hay cambios que guardar.' };
}

const GRUPOS_HOJA = {
  empresa: 'Empresa',
  licitacion: 'Licitación',
  oferta: 'Oferta',
  automaticos: 'Criterios automáticos',
};

/** Los campos de la hoja de datos por grupo, en su orden, con el título del grupo legible. */
export function gruposHojaDatos(campos = []) {
  const grupos = new Map();
  for (const c of campos) {
    if (!grupos.has(c.grupo)) grupos.set(c.grupo, []);
    grupos.get(c.grupo).push(c);
  }
  return [...grupos].map(([grupo, items]) => ({ grupo, titulo: GRUPOS_HOJA[grupo] ?? grupo, campos: items }));
}

/** «Faltan 2 datos: teléfono y correo.»; null si no falta ninguno. */
export function textoFaltasHoja(campos = []) {
  const faltan = campos.filter((c) => c.falta).map((c) => c.etiqueta);
  if (!faltan.length) return null;
  return `${faltan.length === 1 ? 'Falta 1 dato' : `Faltan ${faltan.length} datos`}: ${enumerar(faltan)}.`;
}
