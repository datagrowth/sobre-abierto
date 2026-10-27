// Aviso de que una recarga falló pero los datos de antes siguen a la vista.
import { textoFalloRecarga } from '../../lib/carga';
import { Aviso } from '../ui';
import { Enlace } from './listas';

/** carga: lo que devuelve useCarga; no pinta nada si no hay fallo. */
export default function AvisoRecarga({ carga }) {
  const texto = textoFalloRecarga(carga);
  if (!texto) return null;
  return (
    <div data-testid="aviso-recarga">
      <Aviso tono="aviso">
        {texto} · <Enlace onClick={carga.recargar}>Reintentar</Enlace>
      </Aviso>
    </div>
  );
}
