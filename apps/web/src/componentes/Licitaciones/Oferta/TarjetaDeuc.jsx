// Tarjeta del DEUC en la fila del documento: la plataforma prepara por código el XML que
// se importa en el servicio DEUC con los datos de la empresa y los lotes; la persona solo responde
// lo que queda (motivos de exclusión), descarga el PDF y lo firma. Sin runs de Hermes.
import { useState } from 'react';
import { FileCode } from 'lucide-react';
import { BORDE, TINTA_2, RADIUS, TINTA, TIPO, RIESGO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { enlaceDocumento } from '../../../lib/propuestasFormato';
import { textoDeuc } from '../../../lib/documentosOfertaFormato';
import { errorDeEmpresa, URL_SERVICIO_DEUC } from '../../../lib/deucFormato';
import { rutaA } from '../../../lib/rutas';
import { Boton } from '../../ui';

const ENLACE = {
  fontSize: TIPO.texto,
  color: TINTA,
  border: `1px solid ${BORDE}`,
  borderRadius: RADIUS,
  padding: '5px 10px',
  textDecoration: 'none',
};

// Datos de la empresa que faltan: se arreglan en Ajustes › Empresa, así que va el enlace (no con
// cualquier 409: una pestaña de antes del despliegue también lo es).
function ErrorPreparar({ error }) {
  return (
    <div role="alert" data-testid="deuc-error" style={{ fontSize: TIPO.pequeno, color: RIESGO }}>
      {error.message}
      {errorDeEmpresa(error) && (
        <>
          {' '}
          <a href={rutaA({ seccion: 'ajustes', vista: 'empresa' })} style={{ color: TINTA }}>
            Ir a Ajustes › Empresa
          </a>
        </>
      )}
    </div>
  );
}

function QuedaPorResponder({ preguntas }) {
  if (!preguntas?.length) return null;
  return (
    <details data-testid="deuc-sin-responder">
      <summary style={{ cursor: 'pointer', fontSize: TIPO.texto, color: TINTA_2 }}>
        Qué queda por responder ({preguntas.length})
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: TIPO.pequeno, color: TINTA }}>
        {preguntas.map((p) => (
          <li key={p.codigo}>{p.nombre}</li>
        ))}
      </ul>
    </details>
  );
}

export default function TarjetaDeuc({ id, d, deuc, onCambio }) {
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const preparar = () => {
    setOcupado(true);
    setError(null);
    licitacionesApi
      .prepararDeuc(id, d.clave)
      .then(() => onCambio?.(), setError)
      .finally(() => setOcupado(false));
  };
  const nombre = deuc?.version ? `DEUC-v${deuc.version}.xml` : null;
  return (
    <div data-testid="tarjeta-deuc" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div data-testid="deuc-texto" style={{ fontSize: TIPO.texto, color: TINTA }}>
        {textoDeuc(deuc)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Boton
          Icono={FileCode}
          escribe
          testid="deuc-preparar"
          cargando={ocupado}
          onClick={preparar}
          title="Prepara el XML con los datos de la empresa y los lotes; no gasta runs de Hermes"
        >
          Preparar el DEUC
        </Boton>
        {nombre && deuc.respuesta && (
          <a data-testid="deuc-descargar" href={enlaceDocumento(deuc.respuesta)} download={nombre} style={ENLACE}>
            Descargar {nombre}
          </a>
        )}
        <a data-testid="deuc-servicio" href={URL_SERVICIO_DEUC} target="_blank" rel="noreferrer" style={ENLACE}>
          Abrir el servicio DEUC
        </a>
      </div>
      {error && <ErrorPreparar error={error} />}
      <QuedaPorResponder preguntas={deuc?.sin_responder} />
    </div>
  );
}
