// La cabecera de una versión de la memoria: su número, estado, origen y si es de otro guion.
import { TINTA, TINTA_2 } from '../../../../lib/tema';
import { fechaHora } from '../../../../lib/formato';
import { estadoVersion, etiquetaEnsayo } from '../../../../lib/memoriaFormato';
import { Aviso, Chip } from '../../../ui';
import { texto, apagado, TONO_VERSION, origenDe } from './compartido';

// historial: una versión que ya no es la actual no se rehace; solo se dice de qué guion era.
export default function CabeceraVersion({ m, historial = false }) {
  const e = estadoVersion(m);
  const origen = origenDe(m);
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: TINTA }}>Memoria v{m.version}</span>
        <Chip tono={TONO_VERSION[e.clave]} punto={false}>
          {e.texto}
        </Chip>
        {e.clave !== 'ensayo' && etiquetaEnsayo(m) && <Chip>{etiquetaEnsayo(m)}</Chip>}
        <span style={apagado}>
          pedida {fechaHora(m.pedida_en)}
          {m.ensamblada_en ? ` · lista ${fechaHora(m.ensamblada_en)}` : ''}
        </span>
      </div>
      {origen && <div style={{ ...texto, color: TINTA_2, marginTop: 2 }}>{origen}</div>}
      {m.guion_cambiado && historial && (
        <div data-testid="memoria-historial-otro-guion" style={{ ...texto, color: TINTA_2, marginTop: 2 }}>
          De un guion anterior.
        </div>
      )}
      {m.guion_cambiado && !historial && (
        <div data-testid="memoria-aviso-otro-guion" style={{ marginTop: 6 }}>
          <Aviso tono="aviso">
            La v{m.version} es de otro guion: rehazla con el guion vigente (unas 3 h). «Pedir cambios» no sirve con otro
            guion.
          </Aviso>
        </div>
      )}
    </>
  );
}
