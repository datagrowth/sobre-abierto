// Carga de un recurso que se repite con los eventos de la plataforma («version» sube con
// ellos) y a mano con `recargar`. Solo vale la respuesta de la última petición: una anterior
// que llegue tarde pisaría la buena con datos viejos. `deps` son las dependencias de `fn`
// (normalmente el id de la ficha), como en useCallback.
import { useCallback, useEffect, useState } from 'react';
import usePeticionVigente from './usePeticionVigente';
import { trasCarga, trasFallo } from '../lib/carga';

export default function useCarga(fn, deps, version = 0) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  const nuevaPeticion = usePeticionVigente();
  // `fn` cambia en cada render; lo que cuenta son sus dependencias, que pasa quien llama.
  const clave = JSON.stringify(deps);
  const recargar = useCallback(() => {
    const vigente = nuevaPeticion();
    // Con la clave de las deps: si falla la carga de otras deps (otro lote, filtro o página), no se enseñan las de antes.
    return fn().then(
      (data) => vigente() && setEstado(trasCarga(data, Date.now(), clave)),
      (e) => vigente() && setEstado((prev) => trasFallo(prev, e.message, Date.now(), clave)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nuevaPeticion, clave]);
  useEffect(() => {
    recargar();
  }, [recargar, version]);
  return { ...estado, recargar };
}
