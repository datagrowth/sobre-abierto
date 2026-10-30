// Sección «Revisar lo que hizo Hermes» de las comprobaciones: una tarjeta por cosa que Hermes dejó
// y una persona debe aceptar o descartar. Abrir una la marca como vista; descartar pide motivo
// en un diálogo de la app. Aceptar vive en la vista de cada tipo (cada una aplica lo suyo); la
// memoria también se descarta en la suya, que además descarta el borrador.
import { useState } from 'react';
import { BORDE, TINTA_2, LIENZO, RADIUS, TINTA, RIESGO } from '../../../../lib/tema';
import { anexoApi, revisionApi } from '../../../../lib/revisionApi';
import { conDescarteGenerico, ordenTarjetas, recargaLaRevision, textoCabecera } from '../../../../lib/revisionFormato';
import { aceptablesEnBloque, claveDocumento, textoAceptarBloque } from '../../../../lib/vistaAnexoFormato';
import useCarga from '../../../../hooks/useCarga';
import useEventosLicitacion from '../../../../hooks/useEventosLicitacion';
import { Aviso, Boton } from '../../../ui';
import Confirmacion from '../../../comun/Confirmacion';
import DiffPropuesta from './DiffPropuesta';
import ResumenMemoria from './ResumenMemoria';
import VistaAnexo from './VistaAnexo';
import GuiaDeuc from './GuiaDeuc';
import RevisionPrevia from './RevisionPrevia';

const POR_TIPO = {
  propuesta: DiffPropuesta,
  memoria: ResumenMemoria,
  anexo: VistaAnexo,
  deuc: GuiaDeuc,
  revision_previa: RevisionPrevia,
};

function Tarjeta({ id, t, onCambio }) {
  const [descartando, setDescartando] = useState(false);
  const [error, setError] = useState(null);
  const Vista = POR_TIPO[t.tipo];
  const lanzar = (accion, motivo) =>
    revisionApi.cerrar(id, t.clave, accion, motivo).then(onCambio, (e) => setError(e.message));
  const descartar = (motivo) => {
    setDescartando(false);
    lanzar('descartar', motivo);
  };
  return (
    <li
      data-testid={`tarjeta-revision-${t.clave}`}
      style={{
        listStyle: 'none',
        padding: 12,
        background: LIENZO,
        borderRadius: RADIUS,
        border: `1px solid ${t.acreditacion ? RIESGO : BORDE}`,
      }}
    >
      {Vista && <Vista id={id} tarjeta={t} onAbrir={() => lanzar('vista')} onCambio={onCambio} />}
      {error && <Aviso tono="error">{error}</Aviso>}
      {conDescarteGenerico(t.tipo) &&
        (descartando ? (
          <Confirmacion
            pregunta="¿Descartar lo que propuso Hermes?"
            textoSi="Descartar"
            destructiva
            conMotivo
            onSi={descartar}
            onNo={() => setDescartando(false)}
          />
        ) : (
          <div style={{ marginTop: 8 }}>
            <Boton testid={`descartar-${t.clave}`} escribe onClick={() => setDescartando(true)}>
              Descartar con motivo
            </Boton>
          </div>
        ))}
    </li>
  );
}

function AceptarBloque({ id, tarjetas, onCambio }) {
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const aceptables = aceptablesEnBloque(tarjetas);
  if (!aceptables.length) return null;
  const aceptar = () => {
    setTrabajando(true);
    anexoApi
      .aceptar(
        id,
        aceptables.map((t) => claveDocumento(t.clave)),
      )
      .then(onCambio, (e) => setError(e.message))
      .finally(() => setTrabajando(false));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <Boton testid="aceptar-borradores" variante="principal" escribe cargando={trabajando} onClick={aceptar}>
          {textoAceptarBloque(aceptables.length)}
        </Boton>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}

export default function RevisionHermes({ id, onCambio }) {
  const [version, setVersion] = useState(0);
  // Lo que cierra otra persona o el agente (evento 'licitacion.revision') y las tarjetas nuevas
  // de Hermes llegan sin que nadie toque esta bandeja.
  useEventosLicitacion(id, (d) => {
    if (recargaLaRevision(d)) setVersion((v) => v + 1);
  });
  const c = useCarga(() => revisionApi.tarjetas(id), [id], version);
  if (c.kind === 'error') return <Aviso tono="error">{c.message}</Aviso>;
  if (!c.data) return null;
  const tarjetas = ordenTarjetas(c.data.tarjetas);
  const tras = () => {
    c.recargar();
    onCambio?.();
  };
  return (
    <section
      data-testid="revision-hermes"
      aria-label="Revisar lo que hizo Hermes"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <h3 data-testid="revision-hermes-cabecera" style={{ margin: 0, fontSize: 14, color: TINTA }}>
        {textoCabecera(c.data.tarjetas)}
      </h3>
      {tarjetas.length === 0 && <div style={{ fontSize: 12.5, color: TINTA_2 }}>No hay nada pendiente de revisar.</div>}
      <AceptarBloque id={id} tarjetas={tarjetas} onCambio={tras} />
      <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tarjetas.map((t) => (
          <Tarjeta key={t.clave} id={id} t={t} onCambio={tras} />
        ))}
      </ul>
    </section>
  );
}
