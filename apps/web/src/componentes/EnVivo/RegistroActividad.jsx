// Lista de la actividad de la sesión en directo, agrupada por turnos, con llamadas a herramientas y errores.
import { createContext, useContext, useMemo, useState } from 'react';
import { CircleUserRound, MessageSquareText, LoaderCircle, CornerDownRight } from 'lucide-react';
import { capabilityOf } from '../../lib/capacidades';
import { rutaFicha } from '../../lib/rutas';
import { conTitulos, explicarError, idsEnTexto, useTitulos } from '../../lib/actividadTitulos';
import { groupByTurn, formatDuration, MAIN_ACTOR } from '../../lib/enVivoModelo';
import {
  ACCION,
  ACCION_SUAVE,
  LIENZO,
  SUPERFICIE_2,
  BORDE,
  TINTA,
  TINTA_2,
  IMPIDE,
  RADIUS,
  FONT_MONO,
  HERMES_PUNTO,
} from '../../lib/tema';

const TitulosContext = createContext({});

// Los ids con título conocido se leen como «título»; con `enlaces`, llevan a la ficha
// (dentro de un botón no se pueden poner enlaces, por eso es opcional).
function TextoConTitulos({ texto, enlaces = false }) {
  const mapa = useContext(TitulosContext);
  return conTitulos(texto, mapa).map((t, i) => {
    if (t.tipo === 'texto') return <span key={i}>{t.texto}</span>;
    if (!enlaces) return <span key={i}>«{t.texto}»</span>;
    return (
      <a
        key={i}
        href={rutaFicha(t.id)}
        data-testid="actividad-enlace-ficha"
        style={{ color: TINTA, textDecoration: 'underline' }}
      >
        «{t.texto}»
      </a>
    );
  });
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString('es-ES', { hour12: false });
}

function actorName(actor, delegations) {
  if (!actor || actor === MAIN_ACTOR) return '';
  if (actor.startsWith('profile:')) return `Perfil ${actor.slice('profile:'.length)}`;
  return delegations.get(actor) ? `Subagente: ${delegations.get(actor)}` : 'Subagente';
}

function Status({ item }) {
  if (item.status === 'running') {
    return <LoaderCircle size={14} color={HERMES_PUNTO} className="so-spin" aria-label="En marcha" />;
  }
  if (item.status === 'error') return <span style={{ color: IMPIDE, fontSize: 12, fontWeight: 600 }}>Error</span>;
  return <span style={{ color: TINTA_2, fontSize: 12 }}>{formatDuration(item)}</span>;
}

function ToolRow({ item, delegations }) {
  const [open, setOpen] = useState(false);
  const cap = capabilityOf(item.category);
  const actor = actorName(item.actor, delegations);
  const iconColor = item.status === 'running' ? ACCION : item.status === 'error' ? IMPIDE : TINTA_2;
  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left cursor-pointer"
        style={{
          display: 'grid',
          gridTemplateColumns: '18px minmax(0, 1fr) auto',
          gap: 10,
          alignItems: 'start',
          padding: '7px 10px',
          borderRadius: RADIUS,
          background: open ? SUPERFICIE_2 : 'transparent',
        }}
      >
        <cap.Icon size={16} color={iconColor} style={{ marginTop: 2 }} aria-hidden="true" />
        <span className="min-w-0">
          <span
            className={open ? '' : 'truncate'}
            style={{ display: 'block', fontSize: 13, color: TINTA, overflowWrap: 'anywhere' }}
          >
            <span style={{ color: TINTA_2 }}>{cap.label}</span>
            {item.subject ? (
              <>
                : <TextoConTitulos texto={item.subject} />
              </>
            ) : null}
          </span>
          {actor && (
            <span
              className="flex items-center truncate"
              style={{ gap: 4, fontSize: 11.5, color: TINTA_2, marginTop: 1 }}
            >
              <CornerDownRight size={11} aria-hidden="true" />
              {actor}
            </span>
          )}
        </span>
        <span className="flex flex-col items-end" style={{ gap: 2 }}>
          <Status item={item} />
          <span className="tabular-nums" style={{ fontSize: 11, color: TINTA_2 }}>
            {clock(item.at)}
          </span>
        </span>
      </button>
      {open && (
        <div style={{ margin: '2px 10px 8px 38px', fontSize: 12, color: TINTA, lineHeight: 1.55 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: TINTA_2 }}>{item.tool}</div>
          {item.status === 'error' && explicarError(item.result) && (
            <div data-testid="actividad-explicacion-error" style={{ marginTop: 4, color: IMPIDE }}>
              {explicarError(item.result)}
            </div>
          )}
          {item.subject && idsEnTexto(item.subject).length > 0 && (
            <div data-testid="actividad-fichas" style={{ marginTop: 4 }}>
              <TextoConTitulos texto={item.subject} enlaces />
            </div>
          )}
          {item.result && (
            <div
              style={{
                marginTop: 4,
                color: item.status === 'error' ? IMPIDE : TINTA,
                overflowWrap: 'anywhere',
              }}
            >
              {item.result}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ReplyRow({ item }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 10, padding: '7px 10px' }}>
      <MessageSquareText size={16} color={TINTA_2} style={{ marginTop: 2 }} aria-hidden="true" />
      <span style={{ fontSize: 13, color: TINTA, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
        <span style={{ color: TINTA_2 }}>Respuesta: </span>
        <TextoConTitulos texto={item.subject} />
      </span>
    </li>
  );
}

// Hermes no está usando ninguna herramienta pero el turno sigue abierto.
function ThinkingRow() {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 10, padding: '7px 10px' }}>
      <LoaderCircle size={16} color={HERMES_PUNTO} className="so-spin" style={{ marginTop: 2 }} aria-hidden="true" />
      <span style={{ fontSize: 13, color: TINTA }}>Pensando la siguiente acción…</span>
    </li>
  );
}

function TurnGroup({ group, delegations, thinking }) {
  return (
    <section style={{ borderBottom: `1px solid ${BORDE}`, padding: '10px 6px' }}>
      {group.turn && (
        <header className="flex items-start" style={{ gap: 10, padding: '4px 10px 6px' }}>
          <CircleUserRound size={16} color={HERMES_PUNTO} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
          <div
            className="min-w-0 flex-1"
            style={{ fontSize: 13, color: TINTA, lineHeight: 1.45, overflowWrap: 'anywhere' }}
          >
            <TextoConTitulos texto={group.turn.subject} />
          </div>
          <span className="tabular-nums shrink-0" style={{ fontSize: 11, color: TINTA_2 }}>
            {clock(group.turn.at)}
          </span>
        </header>
      )}
      <ul>
        {group.items.map((item) =>
          item.kind === 'reply' ? (
            <ReplyRow key={item.id} item={item} />
          ) : (
            <ToolRow key={item.id} item={item} delegations={delegations} />
          ),
        )}
        {thinking && <ThinkingRow />}
      </ul>
    </section>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="cursor-pointer whitespace-nowrap"
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        // El verde marca el elegido de fondo y borde; el texto, siempre en tinta (contraste).
        color: active ? TINTA : TINTA_2,
        background: active ? ACCION_SUAVE : 'transparent',
        border: `1px solid ${active ? ACCION : BORDE}`,
      }}
    >
      {label}
    </button>
  );
}

export default function RegistroActividad({ items, loading, thinking = false }) {
  const [filter, setFilter] = useState(null);
  const textos = useMemo(() => items.map((i) => i.subject || '').filter(Boolean), [items]);
  const titulos = useTitulos(textos);

  const delegations = useMemo(
    () => new Map(items.filter((i) => i.category === 'delegation' && i.agent).map((i) => [i.agent, i.subject])),
    [items],
  );

  const categories = useMemo(() => {
    const present = new Set(items.filter((i) => i.kind === 'tool').map((i) => i.category));
    return [...present].map((key) => capabilityOf(key));
  }, [items]);

  const groups = useMemo(() => {
    const visible = filter
      ? items.filter((i) => i.kind === 'turn' || (i.kind === 'tool' && i.category === filter))
      : items;
    return groupByTurn(visible).filter((g) => !filter || g.items.length);
  }, [items, filter]);

  return (
    <TitulosContext.Provider value={titulos}>
      <section
        data-testid="actividad"
        className="flex flex-col h-full min-h-0"
        style={{ background: LIENZO, border: `1px solid ${BORDE}`, borderRadius: 14, overflow: 'hidden' }}
      >
        <header style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${BORDE}` }}>
          <div className="flex items-baseline justify-between">
            <h2 style={{ fontSize: 15, fontWeight: 600, color: TINTA }}>Actividad</h2>
            <span style={{ fontSize: 12, color: TINTA_2 }}>
              {items.filter((i) => i.kind === 'tool').length} acciones
            </span>
          </div>
          {categories.length > 1 && (
            <div className="flex" style={{ gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
              <FilterChip label="Todas" active={!filter} onClick={() => setFilter(null)} />
              {categories.map((cap) => (
                <FilterChip
                  key={cap.key}
                  label={cap.label}
                  active={filter === cap.key}
                  onClick={() => setFilter(filter === cap.key ? null : cap.key)}
                />
              ))}
            </div>
          )}
        </header>
        <div className="flex-1 min-h-0" style={{ overflowY: 'auto' }}>
          {groups.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: TINTA_2, lineHeight: 1.6 }}>
              {loading
                ? 'Cargando la actividad de la sesión…'
                : 'Todavía no hay actividad en esta sesión. En cuanto Hermes haga algo, aparecerá aquí.'}
            </p>
          ) : (
            groups.map((group, i) => (
              <TurnGroup
                key={group.turn?.id || `sin-turno-${i}`}
                group={group}
                delegations={delegations}
                thinking={thinking && !filter && i === 0}
              />
            ))
          )}
        </div>
      </section>
    </TitulosContext.Provider>
  );
}
