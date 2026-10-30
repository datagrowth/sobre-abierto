// Cliente de la subida de pliegos a mano (mismo origen, tras el login del monitor).
import { request } from './apiCliente';

/** Sube un pliego que falta a la carpeta de pliegos de la licitación; la Biblioteca lo indexa después. Quién lo sube lo dice la sesión. */
export function subirPliego(id, archivo) {
  const form = new FormData();
  form.append('archivo', archivo, archivo.name);
  return request(`/api/licitaciones/licitaciones/${encodeURIComponent(id)}/pliegos`, { method: 'POST', body: form });
}
