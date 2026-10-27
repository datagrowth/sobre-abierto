// Las versiones anteriores de la memoria y «Volver a esta versión».
import { useState } from 'react';
import { History } from 'lucide-react';
import { BORDE } from '../../../../lib/tema';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { estadoVersion, revisionDeVersion, textoArriba, versionSiguiente } from '../../../../lib/memoriaFormato';
import useAccionAviso from '../../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../../ui';
import Confirmacion from '../../../comun/Confirmacion';
import { plegador } from './compartido';
import CabeceraVersion from './CabeceraVersion';
import EnlaceDoc from './EnlaceDoc';

// Lo que se pierde o se deja atrás al volver a una versión, dicho antes de confirmar.
function detalleRestaurar(m, siguiente, actual) {
  const pendiente =
    actual && !actual.ensayo && estadoVersion(actual).clave === 'pendiente'
      ? ` La v${actual.version} pendiente pasa a descartada.`
      : '';
  const word = m.origen?.subida
    ? ` La v${m.version} es un Word subido: se monta con su texto, sin el formato de ese Word.`
    : '';
  return `Se crea la v${siguiente} igual que la v${m.version}, sin Hermes (0 runs).${pendiente}${word}`;
}

// «Volver a esta versión»: una copia nueva, montada sin IA; lo que deja atrás lo dice la respuesta.
function Restaurar({ id, m, o, actual, onCambio, onAviso }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  const [pide, setPide] = useState(false);
  if (m.ensayo || m.estado !== 'ensamblada') return null;
  const siguiente = versionSiguiente(o.memorias);
  const si = () => {
    setPide(false);
    hacer(
      () => licitacionesApi.restaurarMemoria(id, m.version),
      textoArriba(onAviso, (r) => r.mensaje),
    );
  };
  return (
    <div style={{ marginTop: 6 }}>
      {!pide && (
        <Boton
          Icono={History}
          testid={`memoria-restaurar-${m.version}`}
          escribe
          onClick={() => setPide(true)}
          title="Crea una versión nueva igual que esta, sin gastar Hermes"
        >
          Volver a esta versión
        </Boton>
      )}
      {pide && (
        <Confirmacion
          pregunta={`¿Volver a la v${m.version}?`}
          detalle={detalleRestaurar(m, siguiente, actual)}
          textoSi={`Crear la v${siguiente}`}
          onSi={si}
          onNo={() => setPide(false)}
        />
      )}
      {aviso?.texto && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}

export default function Historial({ id, memorias, o, actual, onCambio, onAviso }) {
  if (!memorias.length) return null;
  return (
    <details style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${BORDE}` }}>
      <summary style={plegador}>
        Historial: {memorias.map((m) => `v${m.version} ${estadoVersion(m).texto.toLowerCase()}`).join(' · ')}
      </summary>
      {memorias.map((m) => (
        <div key={m.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDE}` }}>
          <CabeceraVersion m={m} historial />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {(revisionDeVersion(m)?.rutas ?? []).map((r) => (
              <EnlaceDoc key={r} ruta={r} />
            ))}
          </div>
          <Restaurar id={id} m={m} o={o} actual={actual} onCambio={onCambio} onAviso={onAviso} />
        </div>
      ))}
    </details>
  );
}
