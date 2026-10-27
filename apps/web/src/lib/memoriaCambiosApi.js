// Cliente de los cambios tardíos en la memoria: «Actualizar los apartados afectados»,
// el diff de un apartado rehecho y «Mantener el anterior» (mismo origen, tras el login del monitor).
import { json, request } from './apiCliente';
import { pedirConPlazo } from './peticiones';

const memoria = (id, version, resto) =>
  `/api/licitaciones/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}${resto}`;
const apartado = (id, version, n, resto) => memoria(id, version, `/apartados/${encodeURIComponent(String(n))}${resto}`);

export const memoriaCambiosApi = {
  // Rehace sobre la vN solo los apartados que nombran lo que cambió (cambio: el mismo de «Qué cambia»);
  // cerca del plazo el servidor avisa y, confirmado, va con «?confirmar=1». Sin ninguno, 400.
  actualizarAfectados: (id, version, cambio) =>
    pedirConPlazo((c) =>
      request(memoria(id, version, `/actualizar-afectados${c ? '?confirmar=1' : ''}`), json('POST', { cambio })),
    ),
  // Vista previa sin escribir: { cambios, afectadas, apartados, indicaciones } de lo que cambió en el
  // equipo y los lotes desde que se pidió la vN (la tarjeta de memoria no conoce el cambio).
  vistaPrevia: (id, version) => request(memoria(id, version, '/afectados')),
  // Lo mismo que actualizarAfectados, con lo de la vista previa: hasta cinco cambios y los apartados
  // afectados (sin ellos, el servidor los calcula).
  actualizarCambios: (id, version, { cambios, apartados }) =>
    pedirConPlazo((c) =>
      request(
        memoria(id, version, `/actualizar-afectados${c ? '?confirmar=1' : ''}`),
        json('POST', { cambios, ...(apartados?.length ? { apartados } : {}) }),
      ),
    ),
  // { antes, despues }: el texto plano del apartado en la versión base y en la nueva.
  diff: (id, version, n) => request(apartado(id, version, n, '/diff')),
  // Vuelve a poner el apartado de la base y monta la versión sin IA (0 runs).
  mantener: (id, version, n) => request(apartado(id, version, n, '/mantener'), { method: 'POST' }),
};
