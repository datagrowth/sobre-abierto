// Cliente de /api/colaboradores (mismo origen, tras el login del monitor). Los CV se
// suben a la Biblioteca, carpeta Colaboradores, con la subida de documentos.
import { json, request, subirDocumento } from './apiCliente';

const BASE = '/api/colaboradores';
const CARPETA_CV = 'Colaboradores';

export const colaboradoresApi = {
  personas: ({ tipo, texto, inactivos = false } = {}) => {
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (texto?.trim()) q.set('texto', texto.trim());
    if (inactivos) q.set('inactivos', '1');
    return request(`${BASE}?${q}`);
  },
  persona: (id) => request(`${BASE}/${id}`),
  crear: (persona) => request(BASE, json('POST', persona)),
  guardar: (id, persona) => request(`${BASE}/${id}`, json('PUT', persona)),
  borrar: (id) => request(`${BASE}/${id}`, { method: 'DELETE' }),
  // Hermes lee el CV y propone el perfil; con personaId actualiza a alguien que ya existe.
  desdeCv: (cvRuta, personaId) =>
    request(
      `${BASE}/desde-cv`,
      json('POST', personaId ? { cv_ruta: cvRuta, persona_id: personaId } : { cv_ruta: cvRuta }),
    ),
  // Dónde menciona su CV una materia (la ficha abierta desde la matriz de equipo): { fragmentos: [{ ruta, pagina, texto }] }.
  evidencia: (id, materia) => request(`${BASE}/personas/${id}/evidencia?${new URLSearchParams({ materia })}`),
  propuestas: () => request(`${BASE}/propuestas`),
  // version: la que se ha visto (409 si Hermes la reenvió); persona: la ficha corregida, si se tocó.
  revisar: (id, { decision, version, persona }) =>
    request(
      `${BASE}/propuestas/${id}/revision`,
      json('POST', persona ? { decision, version, persona } : { decision, version }),
    ),
  // Perfiles que una oferta se comprometió a incorporar; el cambio apunta el candidato ({ candidato_id }) o lo da por cubierto ({ estado }).
  aIncorporar: () => request(`${BASE}/a-incorporar`),
  cambiarIncorporar: (id, cambio) => request(`${BASE}/a-incorporar/${id}`, json('PATCH', cambio)),
  buscar: ({ texto, cpvs, tipo, limite = 5 }) =>
    request(
      `${BASE}/buscar`,
      json('POST', { texto, limite, ...(cpvs?.length ? { cpvs } : {}), ...(tipo ? { tipo } : {}) }),
    ),
};

/** Sube el CV a Colaboradores/ y pide a Hermes que lo lea. */
export async function altaDesdeCv(archivo, personaId) {
  const subido = await subirDocumento(archivo, CARPETA_CV);
  await colaboradoresApi.desdeCv(subido.ruta, personaId);
  return subido.ruta;
}
