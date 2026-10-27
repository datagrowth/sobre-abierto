// Una propuesta de la IA pendiente de revisar, igual en todas las pestañas: quién la hace
// y cuándo, qué trae o qué cambia (antes → después), el contenido y, separados para no
// confundirlos, Aprobar como acción principal y Rechazar aparte.
import { Check, X } from 'lucide-react';
import { TINTA, TINTA_2, RIESGO, alpha, TIPO } from '../../lib/tema';
import { fechaHora, nombreAgente } from '../../lib/formato';
import { Boton } from '../ui';

function Cambios({ cambios }) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: TIPO.texto,
      }}
    >
      {cambios.map((c) => (
        <li key={c.campo} style={{ color: TINTA, overflowWrap: 'anywhere' }}>
          <b style={{ fontWeight: 600 }}>{c.campo}:</b>{' '}
          <span style={{ color: TINTA_2, textDecoration: c.antes === '—' ? 'none' : 'line-through' }}>{c.antes}</span> →{' '}
          {c.despues}
        </li>
      ))}
    </ul>
  );
}

/**
 * resumen: lo que trae (lista de textos); cambios: [{campo, antes, despues}];
 * aprobar / rechazar: { texto, onClick, cargando?, disabled? } (sin ellos, solo el marco).
 */
export default function PropuestaIA({
  titulo = 'Propuesta de la IA',
  agente,
  fecha,
  nota,
  resumen = [],
  cambios = [],
  aprobar,
  rechazar,
  children,
}) {
  return (
    <section
      aria-label={titulo}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        background: alpha(RIESGO, 0.07),
        border: `1px solid ${alpha(RIESGO, 0.4)}`,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: TIPO.base, fontWeight: 700, color: TINTA }}>{titulo}</span>
        {agente && (
          <span style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
            de {nombreAgente(agente)}
            {fecha ? ` · ${fechaHora(fecha)}` : ''}
          </span>
        )}
      </div>
      {nota && <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>{nota}</div>}
      {resumen.length > 0 && <div style={{ fontSize: TIPO.texto, color: TINTA }}>Trae: {resumen.join(' · ')}</div>}
      {cambios.length > 0 && <Cambios cambios={cambios} />}
      {children}
      {(aprobar || rechazar) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {aprobar && (
            <Boton
              variante="principal"
              Icono={Check}
              cargando={aprobar.cargando}
              disabled={aprobar.disabled}
              onClick={aprobar.onClick}
            >
              {aprobar.texto}
            </Boton>
          )}
          {rechazar && (
            <span style={{ marginLeft: 'auto' }}>
              <Boton variante="peligro" Icono={X} cargando={rechazar.cargando} onClick={rechazar.onClick}>
                {rechazar.texto}
              </Boton>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
