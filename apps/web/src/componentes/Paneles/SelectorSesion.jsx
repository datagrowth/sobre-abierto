// Selector de sesión de Hermes: desplegable con búsqueda para elegir qué sesión se ve en directo.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, MessagesSquare } from 'lucide-react';
import { textoConTitulos, useTitulos } from '../../lib/actividadTitulos';
import useEstadoFlujo from '../../estado/flujo';
import {
  compactId,
  etiquetaSesion,
  filterSessions,
  formatRelativeTime,
  getSessionTitle,
} from '../../lib/sesionesHermes';
import {
  LIENZO,
  SUPERFICIE_2,
  BORDE,
  TINTA,
  TINTA_2,
  ACCION,
  RADIUS,
  RADIUS_PANEL,
  alpha,
  SOMBRA_CAPA,
} from '../../lib/tema';

// Selector de la barra lateral (la etiqueta «Sesión» la pone la barra).
export default function SelectorSesion() {
  const sessions = useEstadoFlujo((s) => s.sessions);
  const selectedSessionId = useEstadoFlujo((s) => s.selectedSessionId);
  const selectSession = useEstadoFlujo((s) => s.selectSession);
  const loadSessions = useEstadoFlujo((s) => s.loadSessions);
  const sessionsLoading = useEstadoFlujo((s) => s.sessionsLoading);
  const [open, setOpen] = useState(false);
  const contenedor = useRef(null);
  const boton = useRef(null);
  const popupId = useId();

  const selected = sessions.find((s) => s.id === selectedSessionId) || sessions[0];
  const recent = useMemo(() => filterSessions(sessions).slice(0, 8), [sessions]);

  const textos = useMemo(() => [selected, ...recent].filter(Boolean).map(getSessionTitle), [selected, recent]);
  const titulos = useTitulos(textos);

  // Solo al montar: el estado de carga se lee del store para no volver a cargar
  // cada vez que termina una carga.
  useEffect(() => {
    if (!useEstadoFlujo.getState().sessionsLoading) loadSessions();
  }, [loadSessions]);

  useCerrarFuera(open, contenedor, boton, setOpen);

  return (
    <div ref={contenedor} className="relative w-full">
      <button
        ref={boton}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popupId : undefined}
        className="cursor-pointer flex items-center"
        style={{
          gap: 8,
          width: '100%',
          padding: '8px 10px',
          borderRadius: RADIUS,
          border: `1px solid ${BORDE}`,
          background: open ? SUPERFICIE_2 : LIENZO,
          color: TINTA,
          fontSize: 12.5,
          transition: 'background-color 0.12s ease',
        }}
        title={
          selected
            ? `${getSessionTitle(selected)} · ${etiquetaSesion(selected)} · ${selected.id}`
            : 'Sin sesión seleccionada'
        }
      >
        <MessagesSquare size={14} color={TINTA_2} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span className="truncate text-left" style={{ flex: 1, minWidth: 0, color: TINTA }}>
          {selected ? textoConTitulos(getSessionTitle(selected), titulos) : 'Ninguna'}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: TINTA_2 }}>
          {selected?.profile ? String(selected.profile).replace(/-/g, ' ') : ''}
        </span>
        <ChevronDown
          size={14}
          color={TINTA_2}
          aria-hidden="true"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.12s ease' }}
        />
      </button>

      {open && (
        <div
          id={popupId}
          role="dialog"
          aria-label="Sesiones recientes"
          className="absolute z-[70]"
          style={{
            // Anclado a la derecha: el botón va pegado al borde derecho de la cabecera.
            top: 'calc(100% + 6px)',
            right: 0,
            width: 400,
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            background: LIENZO,
            border: `1px solid ${BORDE}`,
            borderRadius: RADIUS_PANEL,
            boxShadow: SOMBRA_CAPA,
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDE}` }}
          >
            <div>
              <div className="label-xs">Sesiones recientes</div>
              <div style={{ fontSize: 11, color: TINTA_2, marginTop: 3 }}>{sessions.length} detectadas</div>
            </div>
            <button
              type="button"
              onClick={() => loadSessions()}
              disabled={sessionsLoading}
              className="cursor-pointer"
              style={{
                padding: '6px 10px',
                borderRadius: RADIUS,
                color: sessionsLoading ? TINTA_2 : TINTA,
                border: `1px solid ${BORDE}`,
                fontSize: 12,
              }}
            >
              {sessionsLoading ? '…' : 'Refrescar'}
            </button>
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {recent.length === 0 ? (
              <div style={{ padding: 14, color: TINTA_2, fontSize: 12 }}>Aún no hay sesiones cargadas.</div>
            ) : (
              recent.map((session) => {
                const active = session.id === selectedSessionId;
                return (
                  <button
                    type="button"
                    key={session.id}
                    onClick={() => {
                      selectSession(session.id);
                      setOpen(false);
                      boton.current?.focus();
                    }}
                    className="w-full text-left cursor-pointer"
                    style={{
                      display: 'block',
                      padding: '11px 12px',
                      borderBottom: `1px solid ${BORDE}`,
                      background: active ? alpha(ACCION, 0.1) : 'transparent',
                      color: active ? TINTA : TINTA,
                    }}
                  >
                    <div className="flex items-center justify-between" style={{ gap: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{etiquetaSesion(session)}</span>
                      <span className="font-mono" style={{ fontSize: 10, color: TINTA_2 }}>
                        {formatRelativeTime(session.lastActiveMs)}
                      </span>
                    </div>
                    <div className="truncate" style={{ fontSize: 12, marginTop: 5, color: active ? TINTA : TINTA_2 }}>
                      {textoConTitulos(getSessionTitle(session), titulos)}
                    </div>
                    <div className="flex items-center justify-between" style={{ gap: 8, marginTop: 5 }}>
                      <span className="font-mono" style={{ fontSize: 10, color: TINTA_2 }}>
                        {compactId(session.id)}
                      </span>
                      <span className="font-mono" style={{ fontSize: 10, color: TINTA_2 }}>
                        {session.message_count || 0} msg
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cierra el desplegable al pulsar fuera o con Esc. Con Esc el foco vuelve al botón:
 * el elemento que lo tenía desaparece al cerrar y, si no, se perdería.
 */
function useCerrarFuera(abierto, contenedor, boton, setAbierto) {
  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsar = (e) => {
      if (!contenedor.current?.contains(e.target)) setAbierto(false);
    };
    const alTeclear = (e) => {
      if (e.key !== 'Escape') return;
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener('mousedown', alPulsar);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('mousedown', alPulsar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto, contenedor, boton, setAbierto]);
}
