// Los índices de mercado de una licitación (GET …/indices: competencia, baja, licitadores
// probables y concentración), para la cabecera de la ficha y la pestaña Mercado; null mientras no hay o si falla.
import { useEffect, useState } from 'react';
import { licitacionesApi } from '../lib/licitacionesApi';
import { indicesDeMercado } from '../lib/fichaFormato';

export default function useIndices(id, version) {
  const [indices, setIndices] = useState(null);
  useEffect(() => {
    let vivo = true;
    licitacionesApi.indices(id).then(
      (i) => {
        if (vivo) setIndices(indicesDeMercado(i));
      },
      () => {
        if (vivo) setIndices(null);
      },
    );
    return () => {
      vivo = false;
    };
  }, [id, version]);
  return indices;
}
