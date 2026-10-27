// Para cargas que se repiten (búsqueda, filtros, eventos): devuelve `nueva()`, que abre una
// petición y da la función que dice si su respuesta sigue siendo la vigente al llegar.
import { useState } from 'react';
import { crearTurnos } from '../lib/peticiones';

export default function usePeticionVigente() {
  const [nueva] = useState(crearTurnos);
  return nueva;
}
