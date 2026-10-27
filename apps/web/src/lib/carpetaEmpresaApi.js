// Cliente de /api/plataforma/empresa/documentos (carpeta Empresa, con caducidad) y de su
// reutilización en un documento de la oferta (copia a Salidas y deja la fila en borrador).
import { json, request } from './apiCliente';

const BASE = '/api/plataforma/empresa/documentos';
const documentoOferta = (id, clave) =>
  `/api/licitaciones/licitaciones/${encodeURIComponent(id)}/oferta/documentos/${encodeURIComponent(clave)}`;

export const carpetaEmpresaApi = {
  documentos: () => request(BASE),
  // El archivo y un solo campo «datos» (JSON), como espera el servidor.
  subir: (archivo, datos) => {
    const form = new FormData();
    form.append('archivo', archivo, archivo.name);
    form.append('datos', JSON.stringify(datos));
    return request(BASE, { method: 'POST', body: form });
  },
  cambiar: (id, cambios) => request(`${BASE}/${id}`, json('PATCH', cambios)),
  borrar: (id) => request(`${BASE}/${id}`, { method: 'DELETE' }),
  // { tipo_empresa, empresa: [...], anteriores: [{ ruta, licitacion, titulo, parecido }] }
  reutilizables: (id, clave) => request(`${documentoOferta(id, clave)}/reutilizables`),
  // origen: 'empresa' | 'oferta'; ruta: la del candidato elegido.
  reutilizar: (id, clave, origen, ruta) =>
    request(`${documentoOferta(id, clave)}/reutilizar`, json('POST', { origen, ruta })),
};
