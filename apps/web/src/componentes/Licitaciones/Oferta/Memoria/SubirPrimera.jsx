// Sin versión: subir el Word escrito a mano como la primera (o la siguiente).
import { useState } from 'react';
import { PanelSubida } from '../SubirVersion';
import { apagado } from './compartido';
import { BotonSubirWord } from './Acciones';

// Sin versión: el Word escrito a mano entra como la siguiente (la primera si no hay ninguna), con el mismo ciclo que el resto.
export default function SubirPrimera({ id, o, onCambio, onAviso, siguiente = 1, lote = null }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span data-testid="memoria-ciclo-word" style={apagado}>
          ¿Ya la tienes escrita en Word o en PDF? Súbela con «Subir mi Word» (hasta 30 MB): queda como la v{siguiente}
          {lote ? ` del lote ${lote}` : ''} y Hermes no la toca.
        </span>
        <BotonSubirWord siguiente={siguiente} abierto={abierto} onAbrir={() => setAbierto(true)} />
      </div>
      {abierto && (
        <PanelSubida
          id={id}
          o={o}
          siguiente={siguiente}
          lote={lote}
          onCambio={onCambio}
          onCerrar={() => setAbierto(false)}
          onAviso={onAviso}
        />
      )}
    </div>
  );
}
