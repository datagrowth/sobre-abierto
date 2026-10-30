// Grafo de la vista en directo: Hermes en el centro y sus capacidades alrededor, con el estado de cada una.
import { useMemo } from 'react';
import { CAPABILITIES, capabilityOf } from '../../lib/capacidades';
import { capabilityStates, satellites } from '../../lib/enVivoModelo';
import {
  ACCION,
  HERMES,
  LIENZO,
  BORDE,
  BORDE_CONTROL,
  TINTA,
  TINTA_2,
  IMPIDE,
  OK_TEXTO,
  FONT_SANS,
  alpha,
} from '../../lib/tema';

// Lienzo lógico: el SVG escala con viewBox, así que las medidas son fijas.
const W = 1000;
const H = 700;
const CX = 500;
const CY = 280;
const RX = 360;
const RY = 210;
const NODE = 30; // medio lado del cuadrado de cada capacidad
const CORE = 56; // medio lado del cuadrado central
const MAX_SATELLITES = 4;
const SAT_W = 220;
const SAT_H = 58;

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nodePosition(index, total) {
  const angle = (-90 + (360 / total) * index) * (Math.PI / 180);
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
}

// Distancia del centro de un rectángulo a su borde en la dirección (ux, uy).
function toBorder(ux, uy, halfW, halfH) {
  return Math.min(halfW / Math.max(Math.abs(ux), 1e-6), halfH / Math.max(Math.abs(uy), 1e-6));
}

// Recta del borde de un cuadrado al borde del otro, con un pequeño margen.
function link(from, to, fromHalf, toHalf) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const a = toBorder(ux, uy, fromHalf, fromHalf) + 4;
  const b = toBorder(ux, uy, toHalf, toHalf) + 6;
  const x1 = from.x + ux * a;
  const y1 = from.y + uy * a;
  const x2 = to.x - ux * b;
  const y2 = to.y - uy * b;
  return {
    d: `M ${x1} ${y1} L ${x2} ${y2}`,
    marks: [0.3, 0.5, 0.7].map((t) => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t })),
  };
}

// Satélites: la conexión baja por el pasillo libre entre los dos nodos inferiores
// y luego gira hacia su caja, para no atravesar ninguna capacidad.
function satelliteLink(sx, satTop) {
  const top = CY + CORE + 4;
  const bend = 575;
  const end = satTop - 6;
  return {
    d: `M ${CX} ${top} L ${CX} ${bend} C ${CX} ${bend + 30}, ${sx} ${bend + 10}, ${sx} ${end}`,
    marks: [0.3, 0.5, 0.7].map((t) => ({ x: CX, y: top + (bend - top) * t })),
  };
}

// Conexión discontinua, con rombos, punta de flecha y,
// mientras está activa, un rombo que viaja hacia la capacidad.
function Connection({ path, active, failed }) {
  const color = failed ? IMPIDE : active ? ACCION : BORDE_CONTROL;
  const marker = failed ? 'url(#so-arrow-error)' : active ? 'url(#so-arrow-active)' : 'url(#so-arrow)';
  return (
    <g opacity={active || failed ? 1 : 0.8}>
      <path
        d={path.d}
        fill="none"
        stroke={color}
        strokeWidth={active ? 1.6 : 1.1}
        strokeDasharray="4 6"
        strokeLinecap="round"
        markerEnd={marker}
        className={active ? 'so-flow' : undefined}
      />
      {path.marks.map((m, i) => (
        <path
          key={i}
          d={`M ${m.x} ${m.y - 3.2} L ${m.x + 3.2} ${m.y} L ${m.x} ${m.y + 3.2} L ${m.x - 3.2} ${m.y} Z`}
          fill={active ? ACCION : failed ? IMPIDE : HERMES}
          opacity={active || failed ? 0.9 : 0.35}
        />
      ))}
      {active && (
        <path d="M 0 -4.5 L 4.5 0 L 0 4.5 L -4.5 0 Z" fill={ACCION}>
          <animateMotion dur="1.8s" repeatCount="indefinite" path={path.d} />
        </path>
      )}
    </g>
  );
}

function Capability({ cap, pos, state }) {
  const used = Boolean(state);
  const active = state?.active;
  const failed = state?.error;
  const stroke = failed ? IMPIDE : active ? ACCION : used ? HERMES : BORDE_CONTROL;
  const subject = state?.last?.subject || '';
  const { Icon } = cap;
  return (
    <g transform={`translate(${pos.x},${pos.y})`}>
      <title>{subject ? `${cap.label}: ${subject}` : cap.label}</title>
      {active && (
        <rect
          x={-NODE - 8}
          y={-NODE - 8}
          width={(NODE + 8) * 2}
          height={(NODE + 8) * 2}
          rx={14}
          fill={alpha(ACCION, 0.14)}
          className="so-pulse"
        />
      )}
      <rect
        x={-NODE}
        y={-NODE}
        width={NODE * 2}
        height={NODE * 2}
        rx={10}
        fill={LIENZO}
        stroke={stroke}
        strokeWidth={active || failed ? 2 : 1.25}
      />
      <Icon
        x={-11}
        y={-11}
        width={22}
        height={22}
        color={active ? TINTA : failed ? IMPIDE : used ? TINTA : TINTA_2}
        strokeWidth={2}
      />
      <text y={NODE + 20} textAnchor="middle" fill={used ? TINTA : TINTA_2} fontSize={14} fontWeight={600}>
        {cap.label}
        {state?.count ? <tspan fill={TINTA_2} fontWeight={400}>{` · ${state.count}`}</tspan> : null}
      </text>
      {subject && (
        <text y={NODE + 38} textAnchor="middle" fill={active ? TINTA : TINTA_2} fontSize={12}>
          {truncate(subject, 30)}
        </text>
      )}
    </g>
  );
}

const CORE_CAPTION = { tool: 'Trabajando', thinking: 'Pensando…', idle: 'En reposo' };

// Nodo central: cuadrado con el monograma «H», a juego con el cuadrado de la barra lateral plegada.
// Verde con pulso mientras trabaja (y un marco que gira mientras piensa), gris en reposo.
function Core({ phase }) {
  const busy = phase !== 'idle';
  const ring = CORE + 12;
  return (
    <g transform={`translate(${CX},${CY})`}>
      <title>{`Hermes: ${CORE_CAPTION[phase].toLowerCase()}`}</title>
      {busy && (
        <rect
          x={-ring}
          y={-ring}
          width={ring * 2}
          height={ring * 2}
          rx={22}
          fill={alpha(ACCION, 0.12)}
          className="so-pulse"
        />
      )}
      {phase === 'thinking' && (
        <rect
          x={-ring}
          y={-ring}
          width={ring * 2}
          height={ring * 2}
          rx={22}
          fill="none"
          stroke={ACCION}
          strokeWidth={1.5}
          strokeDasharray="10 14"
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur="8s"
            repeatCount="indefinite"
          />
        </rect>
      )}
      <rect
        x={-CORE}
        y={-CORE}
        width={CORE * 2}
        height={CORE * 2}
        rx={16}
        fill={busy ? alpha(ACCION, 0.08) : LIENZO}
        stroke={busy ? ACCION : BORDE_CONTROL}
        strokeWidth={busy ? 2.5 : 1.5}
      />
      <text
        y={-6}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={busy ? TINTA : TINTA_2}
        fontFamily={FONT_SANS}
        fontSize={48}
        fontWeight={600}
      >
        H
      </text>
      <text y={36} textAnchor="middle" fill={busy ? TINTA : TINTA_2} fontSize={12} fontWeight={600}>
        {CORE_CAPTION[phase]}
      </text>
    </g>
  );
}

function Satellite({ sat, x, y }) {
  const running = sat.status === 'running';
  const failed = sat.status === 'error';
  const color = failed ? IMPIDE : running ? ACCION : OK_TEXTO;
  const action = sat.lastAction
    ? `${capabilityOf(sat.lastAction.category).label}${sat.lastAction.subject ? `: ${sat.lastAction.subject}` : ''}`
    : running
      ? 'Empezando…'
      : 'Terminado';
  return (
    <g transform={`translate(${x - SAT_W / 2},${y - SAT_H / 2})`}>
      <title>{`${sat.label}\n${action}`}</title>
      <rect width={SAT_W} height={SAT_H} rx={10} fill={LIENZO} stroke={running ? alpha(ACCION, 0.6) : BORDE} />
      <rect x={12} y={16} width={8} height={8} rx={2} fill={color} className={running ? 'so-pulse' : undefined} />
      <text x={28} y={24} fill={TINTA} fontSize={13} fontWeight={600}>
        {truncate(sat.label, 26)}
      </text>
      <text x={12} y={44} fill={TINTA_2} fontSize={12}>
        {truncate(action, 32)}
      </text>
    </g>
  );
}

function ArrowMarker({ id, color }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
    </marker>
  );
}

export default function GrafoEnVivo({ items, state, now }) {
  const states = useMemo(() => capabilityStates(items, now), [items, now]);
  const sats = useMemo(() => satellites(items, now), [items, now]);
  const shown = sats.slice(-MAX_SATELLITES);
  const satY = H - 50;
  const satX = (i) => CX + (i - (shown.length - 1) / 2) * 240;
  const core = { x: CX, y: CY };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="Capacidades de Hermes en uso"
    >
      <defs>
        <ArrowMarker id="so-arrow" color={BORDE_CONTROL} />
        <ArrowMarker id="so-arrow-active" color={ACCION} />
        <ArrowMarker id="so-arrow-error" color={IMPIDE} />
      </defs>
      {CAPABILITIES.map((cap, i) => (
        <Connection
          key={`e-${cap.key}`}
          path={link(core, nodePosition(i, CAPABILITIES.length), CORE, NODE)}
          active={states[cap.key]?.active}
          failed={states[cap.key]?.error}
        />
      ))}
      {shown.map((sat, i) => (
        <Connection
          key={`s-${sat.id}`}
          path={satelliteLink(satX(i), satY - SAT_H / 2)}
          active={sat.status === 'running'}
          failed={sat.status === 'error'}
        />
      ))}
      <Core phase={state.phase} />
      {CAPABILITIES.map((cap, i) => (
        <Capability key={cap.key} cap={cap} pos={nodePosition(i, CAPABILITIES.length)} state={states[cap.key]} />
      ))}
      {shown.map((sat, i) => (
        <Satellite key={sat.id} sat={sat} x={satX(i)} y={satY} />
      ))}
      {sats.length > MAX_SATELLITES && (
        <text
          x={W - 16}
          y={H - 12}
          textAnchor="end"
          fill={TINTA_2}
          fontSize={12}
        >{`+${sats.length - MAX_SATELLITES} agentes más`}</text>
      )}
    </svg>
  );
}
