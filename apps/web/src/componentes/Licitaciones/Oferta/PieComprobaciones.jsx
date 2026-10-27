// El pie de las comprobaciones: el paquete de presentación y su registro, una sola vez.
// Las comprobaciones del paquete no se repiten (ya son filas de las comprobaciones) y el registro se apaga
// mientras alguna fila abierta impida presentar: las comprobaciones son la única verdad sobre eso.
import { bloqueosAbiertos } from '../../../lib/comprobacionesFormato';
import PaqueteOferta from './PaqueteOferta';

/** f: la ficha; o: la oferta; c: las comprobaciones; onCambio: tras generar o registrar. */
export default function PieComprobaciones({ f, o, c, onCambio }) {
  const impiden = bloqueosAbiertos(c).filter((b) => b.gravedad === 'impide');
  return (
    <div data-testid="pie-comprobaciones">
      <PaqueteOferta f={f} o={o} onCambio={onCambio} impiden={impiden} />
    </div>
  );
}
