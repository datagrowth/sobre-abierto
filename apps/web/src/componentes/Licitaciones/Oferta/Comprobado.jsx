// Lo que Hermes comprobó (plegado: da confianza, no pide nada) y lo que no pudo comprobar
// (abierto: falta un dato y nunca cuenta como «ok»). «Lo he comprobado» es un riesgo aceptado
// con motivo, fila a fila: no hay «comprobado todo».
import { useState } from 'react';
import { TINTA, TINTA_2, ACCION, LIENZO, BORDE, RADIUS_PANEL } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { bloqueo as testidBloqueo } from '../../../lib/idsPrueba';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../ui';
import Confirmacion from '../../comun/Confirmacion';
import { HiloDeFila } from './FilaBloqueo';

const caja = {
  background: LIENZO,
  border: `1px solid ${BORDE}`,
  borderRadius: RADIUS_PANEL,
  padding: '10px 14px',
  fontSize: 13,
  color: TINTA,
};

function FilaNoComprobada({ b, idLicitacion, soloLectura, resaltada, recargar, comentarios = null }) {
  const [pidiendo, setPidiendo] = useState(false);
  const [aviso, hacer, ocupado] = useAccionAviso(recargar);
  const guardar = (motivo) => {
    setPidiendo(false);
    hacer(
      () => licitacionesApi.accionBloqueo(idLicitacion, b.clave, { accion: 'aceptar_riesgo', motivo }),
      'Guardado.',
    );
  };
  return (
    <li
      data-testid={testidBloqueo(b.clave)}
      data-estado={b.gravedad}
      data-categoria={b.categoria}
      tabIndex={-1}
      style={{
        padding: '6px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        outline: resaltada ? `2px solid ${ACCION}` : undefined,
      }}
    >
      <div>
        {b.titulo}
        {b.lote ? ` · Lote ${b.lote}` : ''}
      </div>
      {!soloLectura && !pidiendo && (
        <div>
          <Boton escribe cargando={ocupado} testid="no-comprobado-confirmar" onClick={() => setPidiendo(true)}>
            Lo he comprobado
          </Boton>
        </div>
      )}
      {pidiendo && (
        <Confirmacion
          pregunta={`¿Lo has comprobado tú? «${b.titulo}»`}
          textoSi="Lo he comprobado"
          conMotivo
          onSi={guardar}
          onNo={() => setPidiendo(false)}
        />
      )}
      {aviso?.tono === 'error' && <Aviso tono="error">{aviso.texto}</Aviso>}
      {comentarios && <HiloDeFila b={b} comentarios={comentarios} />}
    </li>
  );
}

/** comprobado: c.comprobado; noComprobadas: las filas no_comprobado del modo. */
export default function Comprobado({ comprobado = [], noComprobadas = [], resaltada = null, ...fila }) {
  return (
    <>
      {noComprobadas.length > 0 && (
        <details open data-testid="no-comprobado" style={caja}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>No comprobado ({noComprobadas.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {noComprobadas.map((b) => (
              <FilaNoComprobada key={b.clave} b={b} resaltada={resaltada === b.clave} {...fila} />
            ))}
          </ul>
        </details>
      )}
      <details data-testid="comprobado" style={caja}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Comprobado ({comprobado.length})</summary>
        {comprobado.length === 0 ? (
          <div style={{ color: TINTA_2, marginTop: 6 }}>Aún no hay nada comprobado.</div>
        ) : (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {comprobado.map((x) => (
              <li key={x.clave}>{x.texto}</li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
