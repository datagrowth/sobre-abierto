// Tarjeta «guía del DEUC» de la bandeja de revisión: los tres pasos (descargar
// Deuc.xml, importarlo en el servicio DEUC, rellenar con la guía) y la guía campo a campo, con lo
// que falta señalado. «Preparar de nuevo» escribe otra versión sin pisar la anterior.
import { useState } from 'react';
import { BORDE, TINTA_2, TINTA, TIPO, RIESGO } from '../../../../lib/tema';
import { json, request } from '../../../../lib/apiCliente';
import { revisionApi } from '../../../../lib/revisionApi';
import { bloquesGuia, enlaceDeucXml, textoFaltan, URL_SERVICIO_DEUC } from '../../../../lib/deucFormato';
import useCarga from '../../../../hooks/useCarga';
import { Aviso, Boton } from '../../../ui';

const rutaGuia = (id) => `/api/licitaciones/licitaciones/${encodeURIComponent(id)}/oferta/deuc/guia`;
const ENLACE = {
  fontSize: TIPO.texto,
  color: TINTA,
  border: `1px solid ${BORDE}`,
  borderRadius: 6,
  padding: '4px 10px',
  textDecoration: 'none',
};

function Bloque({ b }) {
  if (b.tipo === 'titulo')
    return (
      <div style={{ margin: '8px 0 2px', fontSize: b.nivel === 1 ? 13.5 : 13, fontWeight: 600, color: TINTA }}>
        {b.texto}
      </div>
    );
  if (b.tipo === 'texto') return <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>{b.texto}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) 2fr', gap: 12, fontSize: TIPO.texto }}>
      <span style={{ color: TINTA_2 }}>{b.etiqueta}</span>
      <span
        data-testid={b.falta ? 'guia-deuc-falta' : undefined}
        style={{ color: b.falta ? RIESGO : TINTA, userSelect: 'all' }}
      >
        {b.valor}
      </span>
    </div>
  );
}

function Pasos({ peticion, onAbrir }) {
  const xml = enlaceDeucXml(peticion);
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {xml ? (
        <a data-testid="guia-deuc-descargar" href={xml} download="Deuc.xml" style={ENLACE}>
          Descargar Deuc.xml
        </a>
      ) : (
        <span style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
          No hay Deuc.xml entre los pliegos: el DEUC se rellena desde cero en el servicio.
        </span>
      )}
      <a
        data-testid="guia-deuc-servicio"
        href={URL_SERVICIO_DEUC}
        target="_blank"
        rel="noreferrer"
        onClick={onAbrir}
        style={ENLACE}
      >
        Abrir el servicio DEUC
      </a>
    </div>
  );
}

export default function GuiaDeuc({ id, tarjeta, onAbrir, onCambio }) {
  const c = useCarga(() => request(rutaGuia(id)), [id, tarjeta.huella]);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(null);
  const lanzar = (que, fn) => {
    setTrabajando(que);
    fn()
      .then(
        () => {
          c.recargar();
          onCambio?.();
        },
        (e) => setError(e.message),
      )
      .finally(() => setTrabajando(null));
  };
  const bloques = bloquesGuia(c.data?.texto);
  const faltan = textoFaltan(bloques);
  return (
    <div data-testid="guia-deuc" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>{tarjeta.titulo}</div>
      <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>{tarjeta.resumen}</div>
      {c.kind === 'error' && <Aviso tono="error">{c.message}</Aviso>}
      {c.data && <Pasos peticion={c.data.peticion} onAbrir={onAbrir} />}
      {faltan && <Aviso tono="aviso">{faltan}</Aviso>}
      {bloques.length > 0 && (
        <div
          data-testid="guia-deuc-texto"
          style={{
            maxWidth: 760,
            padding: '4px 12px',
            borderLeft: `3px solid ${BORDE}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {bloques.map((b, i) => (
            <Bloque key={i} b={b} />
          ))}
        </div>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton
          testid="guia-deuc-aceptar"
          variante="principal"
          escribe
          disabled={!bloques.length}
          cargando={trabajando === 'aceptar'}
          onClick={() => lanzar('aceptar', () => revisionApi.cerrar(id, tarjeta.clave, 'aceptar'))}
        >
          Aceptar la guía
        </Boton>
        <Boton
          testid="guia-deuc-preparar"
          escribe
          cargando={trabajando === 'preparar'}
          onClick={() => lanzar('preparar', () => request(rutaGuia(id), json('POST', {})))}
        >
          Preparar de nuevo
        </Boton>
        <Boton testid={`abrir-${tarjeta.clave}`} onClick={onAbrir}>
          Marcar como vista
        </Boton>
      </div>
    </div>
  );
}
