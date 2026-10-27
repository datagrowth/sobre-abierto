// Cliente de la bandeja «Revisar lo que hizo Hermes» (mismo origen, tras el login del monitor).
import { json, request } from './apiCliente';

const oferta = (id, resto) => `/api/licitaciones/licitaciones/${encodeURIComponent(id)}/oferta${resto}`;
const ruta = (id, resto = '') => oferta(id, `/revision${resto}`);

// El borrador de un anexo con sus valores resaltados y su aceptación, de uno o de varios.
export const anexoApi = {
  vista: (id, clave) => request(oferta(id, `/documentos/${encodeURIComponent(clave)}/vista`)),
  aceptar: (id, claves) => request(oferta(id, '/documentos/aceptar'), json('POST', { claves })),
};

export const revisionApi = {
  tarjetas: (id) => request(ruta(id)),
  // La revisión previa de un paquete (la de su tarjeta); sin versión, la última.
  revisionPrevia: (id, version = null) =>
    request(oferta(id, `/revision-previa${version ? `?paquete_version=${encodeURIComponent(String(version))}` : ''}`)),
  // accion: 'aceptar' | 'descartar' | 'vista'; el motivo solo se exige al descartar.
  cerrar: (id, clave, accion, motivo) =>
    request(ruta(id, `/${encodeURIComponent(clave)}`), json('POST', motivo ? { accion, motivo } : { accion })),
  // La propuesta de Hermes frente a lo guardado, campo a campo.
  diff: (id) => request(oferta(id, '/decisiones/propuesta/diff')),
  // Las de acreditación van de una en una: el servidor rechaza mezclarlas con otras.
  aplicar: (id, campos) => request(oferta(id, '/decisiones/propuesta/aplicar'), json('POST', { campos })),
  // Lo que hay que leer de la memoria vN; lote null: la memoria entera.
  resumenMemoria: (id, version, lote = null) =>
    request(oferta(id, `/memoria/${version}/resumen${lote ? `?lote=${encodeURIComponent(lote)}` : ''}`)),
  // Con algo marcado, el servidor exige motivo; anularFugas, solo si la versión tiene fugas.
  aceptarMemoria: (id, version, { motivo, anularFugas } = {}) =>
    request(
      oferta(id, `/memoria/${version}/aceptar`),
      json('POST', {
        ...(motivo ? { motivo } : {}),
        ...(anularFugas ? { anular_fugas: anularFugas } : {}),
      }),
    ),
};
