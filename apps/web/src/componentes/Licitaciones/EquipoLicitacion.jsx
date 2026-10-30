// Bloque «Equipo» del detalle de una licitación: por cada requisito de medios personales
// de la ficha, los colaboradores (equipo y externos) que mejor encajan. Sin ficha
// todavía, se puede buscar con un requisito escrito a mano.
import { useCallback, useEffect, useState } from 'react';
import { TINTA, TINTA_2, BORDE } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import Candidatos from '../Colaboradores/Candidatos';
import BuscarCandidatos from '../Colaboradores/BuscarCandidatos';
import { Aviso, Chip } from '../ui';
import { Bloque } from '../comun/ui';

function Requisito({ r }) {
  return (
    <div style={{ padding: '10px 0', borderTop: `1px solid ${BORDE}` }}>
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
          fontSize: 13,
          color: TINTA,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {r.descripcion}
        {r.valor_exigido && <span style={{ color: TINTA_2, fontWeight: 400 }}>{r.valor_exigido}</span>}
        {r.excluyente && (
          <Chip tono="impide" punto={false}>
            excluyente
          </Chip>
        )}
        {r.pagina && <span style={{ color: TINTA_2, fontWeight: 400, fontSize: 11.5 }}>pág. {r.pagina}</span>}
      </div>
      <Candidatos resultado={r} />
    </div>
  );
}

function Contenido({ e }) {
  return (
    <>
      {e.ambito?.startsWith('Lote') && (
        <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 6 }}>
          Para {e.ambito.toLowerCase()} (afinidad con su CPV).
        </div>
      )}
      {e.aviso && <div style={{ fontSize: 11.5, color: TINTA_2, marginBottom: 6 }}>{e.aviso}</div>}
      {e.requisitos.map((r, i) => (
        <Requisito key={`${i}-${r.texto}`} r={r} />
      ))}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 6 }}>Otro requisito (copiado del pliego):</div>
        <BuscarCandidatos cpvs={e.cpvs} />
      </div>
    </>
  );
}

// sinMarco: dentro de otro bloque (las decisiones de la oferta), sin su propio panel ni título.
function Marco({ sinMarco, children }) {
  return sinMarco ? <div>{children}</div> : <Bloque titulo="EQUIPO">{children}</Bloque>;
}

// equipo: la respuesta ya cargada por quien lo incluye; si no llega, se carga aquí.
export default function EquipoLicitacion({ id, version, sinMarco = false, equipo = null }) {
  const [estado, setEstado] = useState({ kind: 'loading' });
  const cargar = useCallback(
    () =>
      (equipo ? Promise.resolve(equipo) : licitacionesApi.equipo(id)).then(
        (e) => setEstado({ kind: 'ready', e }),
        (err) => setEstado({ kind: 'error', message: err.message }),
      ),
    [id, equipo],
  );
  useEffect(() => {
    cargar();
  }, [cargar, version]);

  if (estado.kind === 'loading')
    return (
      <Marco sinMarco={sinMarco}>
        <div style={{ fontSize: 12.5, color: TINTA_2 }}>Cargando…</div>
      </Marco>
    );
  if (estado.kind === 'error')
    return (
      <Marco sinMarco={sinMarco}>
        <Aviso tono="error">{estado.message}</Aviso>
      </Marco>
    );
  return (
    <Marco sinMarco={sinMarco}>
      <Contenido e={estado.e} />
    </Marco>
  );
}
