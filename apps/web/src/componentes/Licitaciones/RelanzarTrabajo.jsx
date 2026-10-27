// «¿Colgado? Parar y relanzar»: para el trabajo de IA en marcha de una licitación (su run en
// Hermes, si lo hay) y lo vuelve a poner en la cola ya, sin gastar intento. Dentro de las comprobaciones
// no sale: allí solo HermesEnVivo ofrece «Relanzar», y solo pasado el p90 sin actividad,
// para no invitar a relanzar un run que va bien.
import { useContext, useState } from 'react';
import { CambiosContext } from '../../hooks/useCambiosSinGuardar';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { TINTA_2, RIESGO } from '../../lib/tema';
import { Enlace } from '../comun/listas';

function Relanzar({ id, tipo, onHecho }) {
  const [estado, setEstado] = useState({ ocupado: false, texto: null, error: false });
  const relanzar = async () => {
    if (estado.ocupado) return;
    setEstado({ ocupado: true, texto: null, error: false });
    try {
      await licitacionesApi.relanzarTrabajo(id, tipo);
      setEstado({ ocupado: false, texto: 'Parado y relanzado: vuelve a la cola.', error: false });
      onHecho?.();
    } catch (e) {
      setEstado({ ocupado: false, texto: e.message, error: true });
    }
  };
  return (
    <span style={{ fontSize: 12, display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <Enlace onClick={relanzar} title="Si lleva un buen rato sin avanzar: para el run en Hermes y lo lanza de nuevo">
        ¿Colgado? Parar y relanzar
      </Enlace>
      {estado.texto && (
        <span role={estado.error ? 'alert' : 'status'} style={{ color: estado.error ? RIESGO : TINTA_2 }}>
          {estado.texto}
        </span>
      )}
    </span>
  );
}

export default function RelanzarTrabajo(props) {
  // Solo las comprobaciones dan pedirSalida: las secciones de Decisiones también ponen el contexto.
  const enComprobaciones = Boolean(useContext(CambiosContext)?.pedirSalida);
  return enComprobaciones ? null : <Relanzar {...props} />;
}
