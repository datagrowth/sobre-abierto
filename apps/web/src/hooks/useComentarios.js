// Los comentarios de una licitación, leídos una vez para toda la pestaña y al día con los
// eventos: «de(entidad, clave)» da el hilo de un sitio, y publicar o resolver recargan. Al ver los
// hilos, las menciones a quien mira se dan por leídas.
import { useCallback, useEffect, useState } from 'react';
import { plataformaApi } from '../lib/plataformaApi';
import useEventosLicitacion from './useEventosLicitacion';
import useUsuario from './useUsuario';

const DOMINIO = 'licitaciones';
const TIPO = 'plataforma.comentario';

export default function useComentarios(id) {
  const yo = useUsuario();
  const [comentarios, setComentarios] = useState([]);
  const cargar = useCallback(
    () =>
      plataformaApi.comentarios(DOMINIO, id).then(
        (r) => setComentarios(r.comentarios),
        () => undefined,
      ),
    [id],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);
  useEventosLicitacion(id, (d) => {
    if (d?.tipo === TIPO || d?.tipo === 'plataforma-reconectado') cargar();
  });
  // Las menciones a quien mira, ya vistas aquí: dejan de contar en la barra lateral.
  const mias = comentarios
    .filter((c) => yo && c.menciones.some((m) => m.id === yo.id))
    .map((c) => c.id)
    .join(',');
  useEffect(() => {
    if (!mias) return;
    plataformaApi.leerMenciones(mias.split(',').map(Number)).then(
      () => window.dispatchEvent(new Event('menciones-leidas')),
      () => undefined,
    );
  }, [mias]);
  const de = useCallback(
    (entidad, clave = '') => comentarios.filter((c) => c.entidad === entidad && c.entidad_id === clave),
    [comentarios],
  );
  const publicar = async (entidad, clave, texto) => {
    await plataformaApi.comentar({ dominio: DOMINIO, recurso: id, entidad, entidad_id: clave, texto });
    await cargar();
  };
  const resolver = async (comentario, resuelto) => {
    await plataformaApi.resolverComentario(comentario, resuelto);
    await cargar();
  };
  return { de, publicar, resolver };
}
