// Vista «En directo»: estado del agente, grafo de capacidades y lista de actividad de la sesión elegida.
import { useMemo } from 'react';
import useEstadoActividad from '../../estado/actividad';
import useEstadoFlujo from '../../estado/flujo';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import useAhora from '../../hooks/useAhora';
import GrafoEnVivo from './GrafoEnVivo';
import RegistroActividad from './RegistroActividad';
import { agentState, formatAgo, formatElapsed } from '../../lib/enVivoModelo';
import {
  ACCION,
  ACCION_SUAVE,
  LIENZO,
  BORDE,
  BORDE_CONTROL,
  TINTA,
  TINTA_2,
  IMPIDE,
  RADIUS_PANEL,
} from '../../lib/tema';

// Trabajando (verde, con pulso y cronómetro) o en reposo (gris, con cuándo terminó).
function StatePill({ state, now }) {
  const busy = state.phase !== 'idle';
  const detail = busy
    ? formatElapsed(now - state.since)
    : state.endedAt
      ? `terminó ${formatAgo(state.endedAt, now)}`
      : '';
  return (
    <span
      className="flex items-center shrink-0"
      role="status"
      style={{
        gap: 8,
        padding: '5px 12px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        color: busy ? TINTA : TINTA_2,
        background: busy ? ACCION_SUAVE : 'transparent',
        border: `1px solid ${busy ? ACCION : BORDE_CONTROL}`,
      }}
    >
      <span className="relative flex" style={{ width: 8, height: 8 }}>
        {busy && (
          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: ACCION, opacity: 0.6 }} />
        )}
        <span className="relative rounded-full" style={{ width: 8, height: 8, background: busy ? ACCION : TINTA_2 }} />
      </span>
      {busy ? 'Trabajando' : 'En reposo'}
      {detail && (
        <span className="tabular-nums" style={{ fontWeight: 400, color: busy ? TINTA : TINTA_2 }}>
          · {detail}
        </span>
      )}
    </span>
  );
}

function StatusStrip({ state, now, instruction, actions, errors }) {
  return (
    <div
      className="flex items-center"
      style={{
        gap: 16,
        padding: '10px 16px',
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        minWidth: 0,
      }}
    >
      <StatePill state={state} now={now} />
      <span
        className="min-w-0 flex-1 truncate"
        style={{ fontSize: 13, color: instruction ? TINTA : TINTA_2 }}
        title={instruction}
      >
        {instruction || 'Aún no hay peticiones en esta sesión'}
      </span>
      <span className="shrink-0 tabular-nums" style={{ fontSize: 12, color: TINTA_2 }}>
        {actions} acciones{errors ? <span style={{ color: IMPIDE }}>{` · ${errors} con error`}</span> : null}
      </span>
    </div>
  );
}

export default function VistaEnVivo() {
  const itemsById = useEstadoActividad((s) => s.items);
  const executing = useEstadoActividad((s) => s.isExecuting);
  const executingSince = useEstadoActividad((s) => s.executingSince);
  const instruction = useEstadoActividad((s) => s.instruction);
  const loading = useEstadoActividad((s) => s.historyLoading);
  const hasSessions = useEstadoFlujo((s) => s.sessions.length > 0);
  const { isSmall } = useAnchoPantalla();
  // Las capacidades se apagan solas al pasar unos segundos: hace falta la hora.
  const now = useAhora(1000);

  const items = useMemo(() => Object.values(itemsById), [itemsById]);
  const tools = items.filter((i) => i.kind === 'tool');
  const errors = tools.filter((i) => i.status === 'error').length;
  const state = agentState(items, now, { executing, executingSince });

  if (!hasSessions) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ padding: 24, textAlign: 'center', color: TINTA_2, fontSize: 14 }}
      >
        Aún no hay sesiones de Hermes. Escríbele por cualquier canal y su actividad aparecerá aquí.
      </div>
    );
  }

  const graph = (
    <div
      className="min-h-0"
      style={{
        flex: 1,
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        padding: 8,
        minHeight: isSmall ? 320 : 0,
      }}
    >
      <GrafoEnVivo items={items} state={state} now={now} />
    </div>
  );

  return (
    <div
      className="h-full flex flex-col min-h-0"
      style={{ padding: isSmall ? 10 : 16, gap: isSmall ? 10 : 12, overflowY: isSmall ? 'auto' : 'hidden' }}
    >
      <StatusStrip state={state} now={now} instruction={instruction} actions={tools.length} errors={errors} />
      {isSmall ? (
        <>
          {graph}
          <div style={{ height: 520, flexShrink: 0 }}>
            <RegistroActividad items={items} loading={loading} thinking={state.phase === 'thinking'} />
          </div>
        </>
      ) : (
        <div className="flex-1 flex min-h-0" style={{ gap: 12 }}>
          {graph}
          <div className="min-h-0" style={{ width: 420, flexShrink: 0 }}>
            <RegistroActividad items={items} loading={loading} thinking={state.phase === 'thinking'} />
          </div>
        </div>
      )}
    </div>
  );
}
