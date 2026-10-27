// Formato de la guía del DEUC (DEUC_GUIA.md) en la bandeja de revisión: el enlace al
// servicio DEUC, «Descargar Deuc.xml» desde la petición del órgano y la guía en bloques para
// leerla sin abrir el Markdown, con lo que falta señalado. Sin React, con tests.
import { enlaceDocumento } from './propuestasFormato.js';

// El mismo que da el servidor (paqueteTextos.ts, SERVICIO_DEUC) en INSTRUCCIONES.md.
export const URL_SERVICIO_DEUC = 'https://visor.registrodelicitadores.gob.es/espd-web/filter?lang=es';

/** «Descargar Deuc.xml»: la petición del órgano (Conocimiento/…) por la Biblioteca; null si no hay. */
export function enlaceDeucXml(peticion) {
  return typeof peticion === 'string' && peticion.trim() ? enlaceDocumento(peticion) : null;
}

/** La ruta de la guía desde la clave de su tarjeta («deuc:Salidas/…/DEUC_GUIA.md»). */
export function rutaDeTarjeta(clave) {
  return typeof clave === 'string' && clave.startsWith('deuc:') ? clave.slice('deuc:'.length) : null;
}

const CAMPO = /^- \*\*(.+?):\*\* (.*)$/;

// Una línea de la guía: título de parte, campo «Etiqueta: valor» (con falta si dice FALTA) o texto.
function bloqueDe(l) {
  if (l.startsWith('#')) return { tipo: 'titulo', texto: l.replace(/^#+\s*/, ''), nivel: l.startsWith('## ') ? 2 : 1 };
  const m = CAMPO.exec(l);
  if (m) return { tipo: 'campo', etiqueta: m[1], valor: m[2], falta: m[2].startsWith('FALTA:') };
  return { tipo: 'texto', texto: l.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') };
}

/** La guía en bloques para la vista; [] si no hay texto. */
export function bloquesGuia(texto) {
  if (typeof texto !== 'string') return [];
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(bloqueDe);
}

/** «Faltan 2 datos: complétalos y vuelve a preparar la guía» o null si no falta nada. */
export function textoFaltan(bloques) {
  const n = bloques.filter((b) => b.tipo === 'campo' && b.falta).length;
  if (!n) return null;
  return n === 1
    ? 'Falta 1 dato: complétalo y vuelve a preparar la guía.'
    : `Faltan ${n} datos: complétalos y vuelve a preparar la guía.`;
}

/**
 * ¿Se arregla en Ajustes › Empresa? Solo el conflicto de datos de la empresa que faltan o no valen
 * (el servidor lo dice así); un 409 version_antigua (pestaña de antes del despliegue) o la falta del
 * Deuc.xml entre los pliegos no se arreglan ahí.
 */
export function errorDeEmpresa(error) {
  return error?.status === 409 && error.code === 'conflicto' && /Ajustes › Empresa/.test(error.message ?? '');
}
