// UI compartida de los paneles nativos de Hermes Vault.
import { TINTA, TINTA_2, LIENZO, BORDE, BORDE_CONTROL, ACCION, RADIUS, RADIUS_PANEL, FONT_MONO } from '../../lib/tema';
import { Aviso } from '../ui';

export function KPI({ label, value, hint, accent }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 150,
        padding: '14px 16px',
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
      }}
    >
      <div
        className="brand-text"
        style={{ fontSize: 10.5, color: TINTA_2, letterSpacing: '0.1em', textTransform: 'uppercase' }}
      >
        {label}
      </div>
      <div
        className="tabular-nums"
        style={{
          fontSize: 24,
          fontWeight: 650,
          color: accent || TINTA,
          marginTop: 6,
          lineHeight: 1.1,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: TINTA_2, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function SectionCard({ title, right, children, style }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 280,
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${BORDE}` }}>
        <span className="brand-text" style={{ fontSize: 11.5, color: TINTA_2 }}>
          {title}
        </span>
        {right && <span style={{ marginLeft: 'auto', fontSize: 11, color: TINTA_2 }}>{right}</span>}
      </div>
      <div style={{ padding: '10px 14px' }}>{children}</div>
    </div>
  );
}

export function Centered({ children }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

// Estado vacío reutilizable
export function EmptyState({ title, children, tone = 'muted' }) {
  const color = tone === 'gold' ? TINTA : TINTA_2;
  return (
    <div style={{ padding: '16px 14px', color: TINTA_2, fontSize: 13, lineHeight: 1.6 }}>
      {title && <div style={{ color, fontWeight: 700, marginBottom: 6, fontSize: 13.5 }}>{title}</div>}
      {children}
    </div>
  );
}

export function Code({ children }) {
  return <code style={{ color: TINTA, fontFamily: FONT_MONO, fontSize: 12 }}>{children}</code>;
}

// Estado "sin carpeta vinculada": en vez del error crudo del motor, cómo vincularla.
export function NotConfigured() {
  return (
    <Centered>
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 15, color: TINTA, fontWeight: 600, marginBottom: 8 }}>Biblioteca no configurada</div>
        <div style={{ fontSize: 13, color: TINTA_2, lineHeight: 1.6 }}>
          Aún no has vinculado tu carpeta de notas. Ve a <b style={{ color: TINTA }}>Ajustes › Biblioteca</b> (en la
          barra lateral) y apunta a la carpeta de notas de la Biblioteca para ver tus notas, el grafo y el análisis.
        </div>
      </div>
    </Centered>
  );
}

// Estado "motor no disponible" — la pestaña sigue, pero sin backend.
export function EngineDown() {
  return (
    <Centered>
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 15, color: TINTA, fontWeight: 600, marginBottom: 8 }}>
          Motor de la Biblioteca de Conocimiento no disponible
        </div>
        <div style={{ fontSize: 13, color: TINTA_2, lineHeight: 1.6 }}>
          El monitor arranca el motor de la Biblioteca de Conocimiento automáticamente; parece que aún no responde o no
          pudo iniciarse. El resto del monitor funciona con normalidad. Se reintenta solo cada pocos segundos.
        </div>
      </div>
    </Centered>
  );
}

// Error para personas: qué ha pasado en español y, plegado, el mensaje técnico para quien lo tenga que arreglar.
export function ErrorLegible({ texto, detalle }) {
  return (
    <Aviso tono="error">
      {texto}
      {detalle && detalle !== texto && (
        <details style={{ marginTop: 6, color: TINTA_2 }}>
          <summary style={{ cursor: 'pointer' }}>Detalle técnico</summary>
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, overflowWrap: 'anywhere' }}>{detalle}</span>
        </details>
      )}
    </Aviso>
  );
}

// Enlace con aspecto de Boton: navegar es un <a> (abrir en pestaña nueva, copiar el enlace), no un botón.
export function BotonEnlace({ href, children, variante, Icono, nuevaPestana = false }) {
  return (
    <a
      href={href}
      target={nuevaPestana ? '_blank' : undefined}
      rel={nuevaPestana ? 'noreferrer' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: 12.5,
        fontWeight: 600,
        minHeight: 32,
        borderRadius: RADIUS,
        textDecoration: 'none',
        flexShrink: 0,
        boxSizing: 'border-box',
        background: variante === 'principal' ? ACCION : 'transparent',
        color: TINTA,
        border: `1px solid ${variante === 'principal' ? ACCION : BORDE_CONTROL}`,
      }}
    >
      {Icono && <Icono size={14} aria-hidden="true" />}
      {children}
    </a>
  );
}
