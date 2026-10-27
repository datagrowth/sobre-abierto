// Las comprobaciones de una oferta (GET /comprobaciones con ETag). Se recarga con los eventos de esa licitación
// y al reconectar el socket; si nada cambió, el servidor responde 304 y no se repinta nada.
// Si una recarga falla, los datos de antes siguen a la vista con el aviso de su hora:
// vaciar las comprobaciones por un fallo de red escondería lo que la persona estaba resolviendo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { licitacionesApi } from '../lib/licitacionesApi';
import { textoFalloRecarga, trasCarga, trasFallo } from '../lib/carga';
import usePeticionVigente from './usePeticionVigente';
import useEventosLicitacion from './useEventosLicitacion';

const recargaLaComprobaciones = (detalle) =>
  String(detalle?.tipo ?? '').startsWith('licitacion') || detalle?.tipo === 'plataforma-reconectado';

// 304: lo que se ve sigue siendo lo vigente (se limpia un fallo anterior y su hora).
const trasNoCambio = (prev) => (prev.kind === 'ready' ? { ...trasCarga(prev.data), para: prev.para } : prev);

export default function useComprobaciones(id) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  const etag = useRef(null);
  const nuevaPeticion = usePeticionVigente();
  const recargar = useCallback(() => {
    const vigente = nuevaPeticion();
    return licitacionesApi.comprobaciones(id, etag.current).then(
      (r) => {
        if (!vigente()) return;
        if (r.noCambio) return setEstado(trasNoCambio);
        etag.current = r.etag;
        setEstado({ ...trasCarga(r.data), para: id });
      },
      (e) => vigente() && setEstado((prev) => ({ ...trasFallo(prev.para === id ? prev : null, e.message), para: id })),
    );
  }, [id, nuevaPeticion]);
  // Otra licitación: sin el ETag de la anterior (daría un 304 que no es suyo).
  useEffect(() => {
    etag.current = null;
    recargar();
  }, [recargar]);
  useEventosLicitacion(id, (detalle) => {
    if (recargaLaComprobaciones(detalle)) recargar();
  });
  // Lo cargado para otra licitación no se enseña mientras llega la de ahora.
  const vista = estado.para === id ? estado : { kind: 'loading' };
  return { ...vista, data: vista.data ?? null, aviso: textoFalloRecarga(vista), recargar };
}
