// Hook que carga un estado del motor de la Biblioteca al montar y permite reintentarlo.
import { useCallback, useEffect, useState } from 'react';

/**
 * Estado de una carga del motor de la Biblioteca de Conocimiento. `fetchState` (estable: de módulo
 * o memoizada) devuelve el siguiente estado sin tocarlo. Carga al montar, ignora
 * respuestas que llegan tras desmontar y da `reload` para reintentar o refrescar.
 */
export default function useEstadoCarga(fetchState, initial = { kind: 'loading' }) {
  const [state, setState] = useState(initial);
  const reload = useCallback(() => fetchState().then(setState), [fetchState]);

  useEffect(() => {
    let alive = true;
    fetchState().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [fetchState]);

  return [state, reload, setState];
}
