// Búsqueda de la Biblioteca: caja de consulta con resultados de notas y documentos y fragmentos resaltados.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import { ApiError } from '../../lib/apiCliente';
import {
  ACCION,
  HERMES,
  TINTA,
  TINTA_2,
  BORDE,
  BORDE_CONTROL,
  LIENZO,
  RADIUS,
  RADIUS_PANEL,
  FONT_MONO,
  alpha,
  SOMBRA_CAPA,
  VELO,
} from '../../lib/tema';
import { Chip } from '../ui';
import { engineDown } from './bibliotecaAyudas';
import { ErrorLegible } from './bibliotecaUi';

// Búsqueda global en la Biblioteca (modal). El atajo para abrirla (Ctrl/Cmd+K) lo registra
// PanelBiblioteca; aquí solo se escuchan ↑/↓/Enter/Esc mientras está abierta.

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2; // el motor ignora consultas más cortas
const LIMIT = 20;

const FIELD_LABEL = {
  title: 'título',
  path: 'ruta',
  body: 'contenido',
  frontmatter: 'frontmatter',
  semantic: 'significado',
};
const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const CLAMP_2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

function describeError(err) {
  // not_configured llega como 503: comprobarlo ANTES que engineDown().
  if (err instanceof ApiError && err.code === 'not_configured') {
    return {
      kind: 'not_configured',
      message: 'Configura la carpeta de notas de la Biblioteca en Ajustes › Biblioteca para poder buscar.',
    };
  }
  if (engineDown(err)) {
    return {
      kind: 'engine_down',
      message:
        'El motor de la Biblioteca de Conocimiento no responde. Se reintenta solo; prueba de nuevo en unos segundos.',
    };
  }
  return {
    kind: 'error',
    message: 'No se pudo completar la búsqueda. Prueba de nuevo en unos segundos.',
    detalle: err?.message,
  };
}

export default function BibliotecaBusqueda({ open, onClose, onOpenNote }) {
  if (!open || typeof document === 'undefined') return null;
  // El diálogo se monta al abrir y se desmonta al cerrar: consulta y selección
  // empiezan siempre de cero.
  return createPortal(<SearchDialog onClose={onClose} onOpenNote={onOpenNote} />, document.body);
}

function SearchDialog({ onClose, onOpenNote }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null); // { q, items } | { q, error: { kind, message } }
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const q = query.trim();
  const tooShort = q.length < MIN_CHARS;

  // Foco en el input al abrir; al cerrar, se devuelve a donde estaba (si sigue en pantalla).
  useEffect(() => {
    const prev = document.activeElement;
    if (inputRef.current) inputRef.current.focus();
    return () => {
      if (prev instanceof HTMLElement && prev !== document.body && document.contains(prev))
        prev.focus({ preventScroll: true });
    };
  }, []);

  // Esc cierra aunque el foco no esté en el input.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Búsqueda con debounce; al cambiar la consulta se descarta la respuesta anterior.
  useEffect(() => {
    if (tooShort) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await bibliotecaApi.search(q, LIMIT);
        if (cancelled) return;
        setResult({ q, items: r && Array.isArray(r.items) ? r.items : [] });
        setActive(0);
      } catch (err) {
        if (!cancelled) setResult({ q, error: describeError(err) });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, tooShort]);

  // Mientras llega la respuesta de la consulta nueva se siguen viendo los resultados
  // anteriores; los errores solo se muestran si son de la consulta actual.
  const pending = !tooShort && (!result || result.q !== q);
  const hits = !tooShort && result && result.items ? result.items : null;
  const error = !tooShort && result && result.error && result.q === q ? result.error : null;
  const activeIdx = hits && hits.length ? Math.min(active, hits.length - 1) : 0;

  // Los documentos (PDF, Word…) no se editan aquí: se abren en otra pestaña.
  const openHit = (hit) => {
    if (hit.kind === 'document') window.open(bibliotecaApi.documents.rawUrl(hit.path), '_blank', 'noopener');
    else if (onOpenNote) onOpenNote(hit.path);
    if (onClose) onClose();
  };

  const move = (delta) => {
    const next = Math.max(0, Math.min(hits.length - 1, activeIdx + delta));
    setActive(next);
    const el = listRef.current && listRef.current.querySelector(`[data-idx="${next}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing || !hits || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[activeIdx];
      if (hit) openHit(hit);
    }
  };

  let body;
  if (tooShort) body = <Message>Escribe al menos {MIN_CHARS} caracteres.</Message>;
  else if (error?.kind === 'error')
    body = (
      <div style={{ padding: '12px 14px' }}>
        <ErrorLegible texto={error.message} detalle={error.detalle} />
      </div>
    );
  else if (error) body = <Message color={error.kind === 'not_configured' ? TINTA : TINTA_2}>{error.message}</Message>;
  else if (hits && hits.length > 0) {
    body = (
      <div role="listbox" aria-label="Resultados">
        {hits.map((hit, i) => {
          const isActive = i === activeIdx;
          return (
            <div
              key={hit.path}
              data-idx={i}
              role="option"
              aria-selected={isActive}
              onClick={() => openHit(hit)}
              onMouseMove={() => {
                if (!isActive) setActive(i);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '10px 14px 10px 12px',
                cursor: 'pointer',
                borderTop: i === 0 ? 'none' : `1px solid ${BORDE}`,
                borderLeft: `2px solid ${isActive ? ACCION : 'transparent'}`,
                background: isActive ? alpha(TINTA, 0.048) : 'transparent',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: TINTA, ...ELLIPSIS }}>
                  {hit.title || hit.path}
                </div>
                <div style={{ fontSize: 11, color: TINTA_2, fontFamily: FONT_MONO, marginTop: 1, ...ELLIPSIS }}>
                  {hit.path}
                </div>
                {hit.snippet && hit.snippet !== hit.path && (
                  <div style={{ ...CLAMP_2, fontSize: 12, color: TINTA_2, marginTop: 5, lineHeight: 1.45 }}>
                    {hit.snippet}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                {hit.kind === 'document' && (
                  <Chip tono="ok" punto={false}>
                    documento
                  </Chip>
                )}
                {(hit.matched_in || []).map((m) => (
                  <Chip key={m} tono="hermes" punto={false}>
                    {FIELD_LABEL[m] || m}
                  </Chip>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (pending) body = <Message>Buscando…</Message>;
  else body = <Message>Sin resultados para “{q}”.</Message>;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: VELO,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '10vh 16px 24px',
      }}
    >
      {/* mousedown fuera del input no le quita el foco (↑/↓/Enter siguen funcionando);
          se exceptúa el contenedor de la lista para no bloquear su barra de scroll */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en la Biblioteca"
        onMouseDown={(e) => {
          if (e.target !== inputRef.current && e.target !== listRef.current) e.preventDefault();
        }}
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: LIENZO,
          border: `1px solid ${BORDE_CONTROL}`,
          borderRadius: RADIUS_PANEL,
          boxShadow: SOMBRA_CAPA,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 48,
            padding: '0 14px',
            borderBottom: `1px solid ${BORDE}`,
            flexShrink: 0,
          }}
        >
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar en notas y documentos, por palabras o por significado…"
            aria-label="Buscar en la Biblioteca"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              height: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: TINTA,
              fontSize: 14,
              fontFamily: 'inherit',
            }}
          />
          {pending && hits && hits.length > 0 && (
            <span style={{ fontSize: 11, color: TINTA_2, flexShrink: 0 }}>buscando…</span>
          )}
          <Kbd>ESC</Kbd>
        </div>

        <div ref={listRef} style={{ flex: 1, minHeight: 0, maxHeight: '60vh', overflowY: 'auto' }}>
          {body}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            padding: '7px 14px',
            borderTop: `1px solid ${BORDE}`,
            fontSize: 11,
            color: TINTA_2,
            flexShrink: 0,
          }}
        >
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navegar
          </span>
          <span>
            <Kbd>↵</Kbd> abrir
          </span>
          <span>
            <Kbd>esc</Kbd> cerrar
          </span>
          {hits && hits.length > 0 && (
            <span style={{ marginLeft: 'auto' }}>
              {hits.length} {hits.length === 1 ? 'resultado' : 'resultados'}
              {hits.length >= LIMIT ? ' (máx.)' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Message({ children, color = TINTA_2 }) {
  return (
    <div style={{ padding: '14px 16px', fontSize: 13, color, lineHeight: 1.5, wordBreak: 'break-word' }}>
      {children}
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10.5,
        color: TINTA_2,
        padding: '1px 5px',
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS / 2,
        background: LIENZO,
        flexShrink: 0,
      }}
    >
      {children}
    </kbd>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={HERMES}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
