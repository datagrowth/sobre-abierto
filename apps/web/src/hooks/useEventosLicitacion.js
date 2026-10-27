// Eventos de la plataforma de una sola licitación: `alEvento(detalle)` se llama con los que
// son de `id` (por su recurso o sus datos) y, al reconectar el socket, con
// { tipo: 'plataforma-reconectado' }, porque lo que pasó mientras tanto no llegó como evento.
import { useEffect, useRef } from 'react';
import { esEventoDe } from '../lib/comprobacionesFormato';

const RECONECTADO = { tipo: 'plataforma-reconectado' };

export default function useEventosLicitacion(id, alEvento) {
  // La función cambia en cada render: se lee la última sin volver a suscribirse.
  const ultimo = useRef(alEvento);
  useEffect(() => {
    ultimo.current = alEvento;
  });
  useEffect(() => {
    if (!id) return undefined;
    const enPlataforma = (e) => {
      if (esEventoDe(e.detail, id)) ultimo.current(e.detail);
    };
    const enReconexion = () => ultimo.current(RECONECTADO);
    window.addEventListener('plataforma', enPlataforma);
    window.addEventListener('plataforma-reconectado', enReconexion);
    return () => {
      window.removeEventListener('plataforma', enPlataforma);
      window.removeEventListener('plataforma-reconectado', enReconexion);
    };
  }, [id]);
}
