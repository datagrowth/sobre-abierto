// La evaluación orientativa de Hermes de una versión, plegada.
import { ScanSearch } from 'lucide-react';
import { TINTA_2 } from '../../../../lib/tema';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { estadoEvaluacionMemoria } from '../../../../lib/memoriaFormato';
import useAccionAviso from '../../../../hooks/useAccionAviso';
import EvaluacionPropuesta from '../../EvaluacionPropuesta';
import { Aviso, Boton } from '../../../ui';
import RelanzarTrabajo from '../../RelanzarTrabajo';
import { texto, apagado, plegador } from './compartido';

export default function EvaluacionOrientativa({ id, m, valorable, evaluaciones, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const e = estadoEvaluacionMemoria(m);
  if (!e || (!valorable && !e.evaluacion)) return null;
  const completa = e.evaluacion ? evaluaciones.find((x) => x.id === e.evaluacion.id) : null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={plegador}>
        Evaluación orientativa de Hermes con la escala del pliego (no es la nota: suele salir 6-8 puntos alta)
      </summary>
      {e.enCurso && (
        <div role="status" style={{ ...texto, color: TINTA_2, marginTop: 4 }}>
          {e.enCurso} <RelanzarTrabajo id={id} tipo="evaluar" onHecho={onCambio} />
        </div>
      )}
      {completa ? (
        <EvaluacionPropuesta evaluacion={completa} sinRevision />
      ) : (
        !e.enCurso && <div style={{ ...apagado, marginTop: 4 }}>Aún no hay evaluación completa de esta versión.</div>
      )}
      <div style={{ marginTop: 6 }}>
        <Boton
          Icono={ScanSearch}
          disabled={Boolean(e.enCurso)}
          cargando={ocupado}
          title="Hermes la puntúa otra vez como la mesa (un run)"
          onClick={() =>
            hacer(
              () => licitacionesApi.evaluarMemoria(id, m.version),
              'Hermes vuelve a evaluar la memoria; la nota aparecerá aquí.',
            )
          }
        >
          {e.evaluacion ? 'Volver a evaluar' : 'Evaluar'}
        </Boton>
      </div>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </details>
  );
}
