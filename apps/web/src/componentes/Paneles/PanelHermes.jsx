// Panel que incrusta el dashboard de Hermes en un iframe, con recarga y enlace para abrirlo aparte.
import { useRef } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, LIENZO, RADIUS_PANEL } from '../../lib/tema';
import useUsuario from '../../hooks/useUsuario';
import { esAdmin } from '../../lib/usuarioActual';
import { Aviso, Boton } from '../ui';
import { BotonEnlace } from '../Biblioteca/bibliotecaUi';

// Se entra directo en el chat: la raíz de Hermes redirige a /sessions y en el
// iframe esa redirección deja la página en blanco.
const PANEL_URL = '/hermes-panel/chat';

// Dashboard oficial de Hermes servido por el proxy del monitor (/hermes-panel/).
// Se queda montado aunque cambies de pestaña para no perder el chat ni la terminal. Es una terminal
// con las claves de Hermes: solo para admin (el servidor la niega a los demás).
export default function PanelHermes({ visible }) {
  const frameRef = useRef(null);
  const admin = esAdmin(useUsuario());

  const reload = () => {
    if (frameRef.current) frameRef.current.src = PANEL_URL;
  };

  return (
    <div
      style={{
        flex: 1,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '14px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: TINTA, margin: 0 }}>Consola de Hermes</h1>
        <span style={{ fontSize: 12.5, color: TINTA_2 }}>
          el panel oficial: chat, canales, modelos, perfiles, skills, MCP, cron…
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Boton Icono={RotateCw} onClick={reload}>
            Recargar
          </Boton>
          <BotonEnlace href={PANEL_URL} Icono={ExternalLink} nuevaPestana>
            Abrir en pestaña nueva
          </BotonEnlace>
        </div>
      </div>
      {!admin && (
        <Aviso>
          La Consola es una terminal con las claves de Hermes: solo la abre un admin. Lo que hace Hermes se ve en
          Actividad.
        </Aviso>
      )}
      {admin && (
        <iframe
          ref={frameRef}
          src={PANEL_URL}
          title="Consola de Hermes"
          allow="clipboard-read; clipboard-write; microphone"
          style={{
            flex: 1,
            width: '100%',
            border: `1px solid ${BORDE}`,
            borderRadius: RADIUS_PANEL,
            background: LIENZO,
          }}
        />
      )}
    </div>
  );
}
