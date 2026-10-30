// Vista y edición de una nota de la Biblioteca: contenido, metadatos, enlaces, renombrado y borrado.
import { useEffect, useState, useCallback, useRef } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import {
  TINTA,
  TINTA_2,
  ACCION,
  HERMES,
  LIENZO,
  BORDE,
  IMPIDE,
  RIESGO,
  RADIUS,
  RADIUS_PANEL,
  FONT_MONO,
  alpha,
} from '../../lib/tema';
import { engineDown, isNotConfigured, relativeTime } from './bibliotecaAyudas';
import { notasDeCarpeta } from '../../lib/bibliotecaCarpeta';
import { SectionCard, Centered, EmptyState, EngineDown, NotConfigured, ErrorLegible } from './bibliotecaUi';
import { Markdown } from './bibliotecaMarkdown';
import {
  ActionBtn,
  Banner,
  NoteEditor,
  NewNotePanel,
  RenamePanel,
  DeletePanel,
  ConflictCurrentBox,
} from './bibliotecaNotaFormularios';
import {
  BACKUP_DIR,
  useVaultMode,
  queueEditOnOpen,
  takeQueuedEdit,
  describeWriteError,
  isUnsaved,
  peekStashedDraft,
  clearStashedDraft,
  stashDraftIfUnsaved,
  withBackupSpacing,
  isConflict,
  parseWikiName,
  sameLinkTarget,
  normalizeLinks,
  linkTargetToPath,
  stripMd,
} from './bibliotecaNotaAyudas';

function Tag({ children }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        background: alpha(TINTA, 0.06),
        border: `1px solid ${BORDE}`,
        borderRadius: 999,
        color: TINTA_2,
      }}
    >
      {children}
    </span>
  );
}

const linkRowStyle = { fontSize: 13, color: TINTA, padding: '3px 0', cursor: 'pointer', wordBreak: 'break-word' };

// Un enlace saliente. Resuelto → abre su ruta. Roto (el motor no encontró la nota) → tachado,
// "no existe" y, si se puede escribir, "Crear". Sin resolver (no se pudo pedir /links) → por nombre, como antes.
function OutgoingLink({ link, resolved, onOpen, canCreate, creating, busy, onCreate }) {
  const heading = link.heading ? <span style={{ color: TINTA_2 }}> #{link.heading}</span> : null;
  if (link.path) {
    return (
      <div onClick={() => onOpen(link.path)} title={link.path} style={linkRowStyle}>
        → {link.title || link.target || stripMd(link.path)}
        {heading}
      </div>
    );
  }
  if (!resolved) {
    const p = /\.md$/i.test(link.target) ? link.target : `${link.target}.md`;
    return (
      <div onClick={() => onOpen(p)} style={linkRowStyle}>
        → {link.target}
        {heading}
      </div>
    );
  }
  const createPath = canCreate ? linkTargetToPath(link.target) : '';
  return (
    <div
      style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, padding: '3px 0' }}
      title={`No hay ninguna nota «${link.target}» en la Biblioteca`}
    >
      <span style={{ color: TINTA_2, textDecoration: 'line-through', minWidth: 0, wordBreak: 'break-word' }}>
        → {link.target || '(sin nombre)'}
        {heading}
      </span>
      <span style={{ fontSize: 10.5, color: TINTA_2, fontStyle: 'italic', whiteSpace: 'nowrap' }}>no existe</span>
      {createPath && (
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          title={`Crear ${createPath} y abrirla para editar`}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            padding: '1px 7px',
            fontSize: 11,
            color: TINTA,
            background: 'transparent',
            border: `1px solid ${alpha(ACCION, 0.33)}`,
            borderRadius: RADIUS,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy && !creating ? 0.5 : 1,
          }}
        >
          {creating ? 'Creando…' : 'Crear'}
        </button>
      )}
    </div>
  );
}

// Ruta de nota compacta y clicable (lista de notas actualizadas tras renombrar).
function NotePathLink({ path, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      title={path}
      style={{
        padding: 0,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px dotted ${HERMES}`,
        borderRadius: RADIUS,
        color: TINTA,
        fontFamily: FONT_MONO,
        fontSize: 11.5,
        cursor: 'pointer',
        wordBreak: 'break-all',
        textAlign: 'left',
      }}
    >
      {stripMd(path)}
    </button>
  );
}

// Índice navegable de TODA la bóveda — se muestra cuando no hay nota abierta.
// «Documentos de esta oferta»: la lista solo enseña esa carpeta, con la vuelta a todas.
function CabeceraCarpeta({ carpeta, n, onQuitarCarpeta }) {
  return (
    <div data-testid="biblioteca-carpeta" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: TINTA }}>
        Notas de la carpeta <span style={{ color: TINTA_2, fontWeight: 400 }}>({n})</span>
      </span>
      <span data-testid="biblioteca-carpeta-ruta" style={{ fontSize: 11.5, color: TINTA_2, fontFamily: FONT_MONO }}>
        {carpeta}
      </span>
      {onQuitarCarpeta && (
        <span data-testid="biblioteca-quitar-carpeta">
          <ActionBtn label="Ver todas las notas" onClick={onQuitarCarpeta} />
        </span>
      )}
    </div>
  );
}

// Si se puede escribir (modo local), incluye "Nueva nota". Con `carpeta`, solo las notas de esa carpeta.
function NotesList({ onOpenNote, writable, onCreated, onReadOnly, carpeta = null, onQuitarCarpeta = null }) {
  const [st, setSt] = useState({ kind: 'loading' });
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await bibliotecaApi.vault.notes();
        if (alive) setSt({ kind: 'ready', items: Array.isArray(r.items) ? r.items : [] });
      } catch (err) {
        if (!alive) return;
        if (isNotConfigured(err)) setSt({ kind: 'not_configured' });
        else
          setSt(
            engineDown(err) ? { kind: 'engine_down' } : { kind: 'error', message: (err && err.message) || 'Error' },
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (st.kind === 'loading')
    return (
      <Centered>
        <span style={{ color: TINTA_2, fontSize: 13 }}>Cargando notas…</span>
      </Centered>
    );
  if (st.kind === 'not_configured') return <NotConfigured />;
  if (st.kind === 'engine_down') return <EngineDown />;
  if (st.kind === 'error')
    return (
      <Centered>
        <ErrorLegible
          texto="No se pudo cargar la lista de notas. Prueba de nuevo en unos segundos."
          detalle={st.message}
        />
      </Centered>
    );

  const newNoteBtn =
    writable && !creating ? <ActionBtn label="+ Nueva nota" tone="gold" onClick={() => setCreating(true)} /> : null;
  const newNoteForm =
    writable && creating ? (
      <NewNotePanel onCreated={onCreated} onCancel={() => setCreating(false)} onReadOnly={onReadOnly} />
    ) : null;

  const items = carpeta ? notasDeCarpeta(st.items, carpeta) : st.items;
  const cabeceraCarpeta = carpeta ? (
    <CabeceraCarpeta carpeta={carpeta} n={items.length} onQuitarCarpeta={onQuitarCarpeta} />
  ) : null;
  if (carpeta && items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cabeceraCarpeta}
        <EmptyState title="Esta carpeta no tiene notas todavía">
          Hermes las crea al leer los documentos de la carpeta; mientras, ábrela en Drive desde el Expediente.
        </EmptyState>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <EmptyState title="La Biblioteca no tiene notas todavía">
          Crea archivos <code style={{ color: TINTA_2 }}>.md</code> en tu carpeta de notas (o súbelos a Google Drive) y
          aparecerán aquí. Configura la carpeta en <b>Ajustes › Biblioteca</b>.
          {writable && ' También puedes crear la primera aquí mismo.'}
        </EmptyState>
        {newNoteBtn && <div style={{ padding: '0 14px' }}>{newNoteBtn}</div>}
        {newNoteForm}
      </div>
    );
  }
  const needle = q.trim().toLowerCase();
  const filtered = needle ? items.filter((n) => `${n.title} ${n.path}`.toLowerCase().includes(needle)) : items;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {cabeceraCarpeta}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!carpeta && (
          <span style={{ fontSize: 15, fontWeight: 700, color: TINTA }}>
            Todas las notas <span style={{ color: TINTA_2, fontWeight: 400 }}>({items.length})</span>
          </span>
        )}
        <input
          className="input-field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por título o ruta…"
          aria-label="Filtrar notas"
          style={{ marginLeft: 'auto', flex: '1 1 220px', maxWidth: 360, padding: '7px 10px' }}
        />
        {newNoteBtn}
      </div>
      {newNoteForm}
      {filtered.length === 0 ? (
        <span style={{ color: TINTA_2, fontSize: 12.5 }}>Ninguna nota coincide con “{q}”.</span>
      ) : (
        <div
          style={{ background: LIENZO, border: `1px solid ${BORDE}`, borderRadius: RADIUS_PANEL, overflow: 'hidden' }}
        >
          {filtered.map((n, i) => (
            <div
              key={n.path}
              onClick={() => onOpenNote && onOpenNote(n.path)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '9px 14px',
                cursor: 'pointer',
                borderTop: i === 0 ? 'none' : `1px solid ${BORDE}`,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = alpha(TINTA, 0.036))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13.5, color: TINTA, fontWeight: 600 }}>{n.title || n.path}</span>
              <span style={{ fontSize: 11, color: TINTA_2, fontFamily: FONT_MONO }}>{n.path}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: TINTA_2, whiteSpace: 'nowrap' }}>
                {relativeTime(n.mtime)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BibliotecaNota({ path, onOpenNote, carpeta = null, onQuitarCarpeta = null }) {
  const [state, setState] = useState({ kind: 'loading' });
  const [mode, setMode] = useVaultMode();
  const writable = mode === 'local'; // en modo servidor (o mientras no se sabe) no se ofrece escribir
  // Edición: { path, loading, original, draft, preview, saving, error, baseHash, conflict } | null.
  // baseHash: hash de la versión del disco sobre la que se edita (se manda como base_hash al guardar).
  // conflict (tras un 409): { exit, busy: null|'view'|'discard', error, current: { content, hash } | null }.
  // Arranca con el borrador sin guardar de una visita anterior, si lo hay.
  const [edit, setEdit] = useState(peekStashedDraft);
  const [panel, setPanel] = useState(null); // 'rename' | 'delete' | null
  const [guard, setGuard] = useState(null); // cambios sin guardar: { kind: 'cancel' } | { kind: 'nav', target }
  // Aviso { path, tone, text, links?, createTarget? } ligado a una ruta (null = índice).
  const [flash, setFlash] = useState(() => {
    const s = peekStashedDraft();
    return s ? { path: s.path, tone: 'ok', text: 'Recuperado tu borrador sin guardar de esta nota.' } : null;
  });
  const [creatingLink, setCreatingLink] = useState(null); // destino del enlace roto que se está creando
  const reqRef = useRef(0);
  const saveRef = useRef(null);
  const savingRef = useRef(false);
  const editRef = useRef(null);
  const pathRef = useRef(path);

  const editing = !!edit && edit.path === path;
  const dirty = editing && isUnsaved(edit);
  // Cambios sin guardar de OTRA nota: se abrió una nota desde fuera de esta vista
  // (buscador, otra pestaña…) mientras se editaba. No se pierden: se ofrece volver.
  const orphan = !editing && isUnsaved(edit) ? edit : null;
  // Crear la nota de un enlace roto la abre en el editor: solo sin cambios pendientes en ninguna nota.
  const canCreate = writable && !dirty && !orphan;

  // quiet: refresco tras guardar, sin pasar por "Cargando…" y sin tumbar la vista si falla.
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const req = ++reqRef.current;
      if (!path) {
        setState({ kind: 'empty' });
        return;
      }
      if (!quiet) setState({ kind: 'loading' });
      try {
        const [note, links] = await Promise.all([
          bibliotecaApi.notes.get(path),
          // Si /links falla, la nota se ve igual (los wikilinks quedan como salientes sin resolver).
          bibliotecaApi.notes.links(path).catch(() => null),
        ]);
        if (req !== reqRef.current) return; // respuesta antigua: ya se pidió otra nota
        setState({ kind: 'ready', note, links });
        // Recién creada desde el índice → directa al editor (sin pisar un borrador pendiente de otra nota).
        const queued = takeQueuedEdit(path);
        if (queued) {
          setEdit((e) =>
            isUnsaved(e) ? e : { path, original: queued.content, draft: queued.content, baseHash: queued.hash },
          );
          if (!queued.hash) {
            // El motor no dio el hash al crearla: se pide ahora para poder detectar cambios externos al guardar.
            bibliotecaApi.notes
              .raw(path)
              .then((r) => {
                if (!r || !r.hash || r.content !== queued.content) return;
                setEdit((e) =>
                  e && e.path === path && !e.baseHash && e.original === queued.content ? { ...e, baseHash: r.hash } : e,
                );
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        if (req !== reqRef.current || quiet) return;
        if (isNotConfigured(err)) setState({ kind: 'not_configured' });
        else if (engineDown(err)) setState({ kind: 'engine_down' });
        else setState({ kind: 'error', message: (err && err.message) || 'Error' });
      }
    },
    [path],
  );
  useEffect(() => {
    load();
  }, [load]);

  const markReadOnly = () => setMode('server');

  // ── Navegación ──
  // Salir a otra nota (o al índice con null) desde dentro de la vista. Cierra la edición de
  // la nota actual, pero conserva el borrador pendiente de otra nota (ver `orphan`).
  const leave = (target) => {
    setEdit((e) => (isUnsaved(e) && e.path !== path ? e : null));
    setPanel(null);
    setGuard(null);
    setFlash(null);
    if (onOpenNote) onOpenNote(target);
  };
  // Igual, pero con cambios sin guardar pregunta antes (en la página, no con window.confirm).
  // Un enlace a la propia nota no hace nada (no cierra el editor ni los paneles).
  const go = (target) => {
    if (target && target === path) return;
    if (dirty) setGuard({ kind: 'nav', target });
    else leave(target);
  };

  // ── Edición ──
  // Carga el markdown crudo (con frontmatter) para editarlo tal cual está en disco, y su hash
  // (baseHash) para que el motor avise si el archivo cambia fuera mientras se edita.
  const startEdit = async () => {
    if (!writable || editing || orphan) return;
    const p = path;
    setPanel(null);
    setGuard(null);
    setFlash(null);
    setEdit({ path: p, loading: true });
    try {
      const r = await bibliotecaApi.notes.raw(p);
      const content = r && typeof r.content === 'string' ? r.content : '';
      const baseHash = (r && r.hash) || null;
      setEdit((e) => (e && e.path === p && e.loading ? { path: p, original: content, draft: content, baseHash } : e));
    } catch (err) {
      if (err && err.code === 'read_only') markReadOnly();
      setEdit((e) => (e && e.path === p && e.loading ? null : e));
      setFlash({ path: p, tone: 'error', text: `No se pudo abrir el editor: ${describeWriteError(err)}` });
    }
  };

  const setDraft = (draft) => {
    setGuard(null); // seguir escribiendo = seguir editando
    setFlash((f) => (f && f.tone === 'ok' ? null : f));
    setEdit((e) => (e ? { ...e, draft } : e));
  };
  const setPreview = (preview) => setEdit((e) => (e ? { ...e, preview } : e));

  // Guarda el borrador (el motor copia antes la versión anterior). exit=true vuelve a la lectura;
  // Ctrl/⌘+S guarda sin salir. Devuelve true si quedó guardado.
  // Se manda baseHash: si el archivo cambió en disco desde entonces, el motor responde 409 y no
  // escribe; el borrador se conserva y se muestra el aviso de conflicto. force=true guarda sin
  // baseHash ("Sobrescribir igualmente"): la versión del disco queda en la copia de seguridad.
  const save = async ({ exit = false, force = false } = {}) => {
    // savingRef bloquea en el acto (doble clic, Ctrl+S repetido) antes de que llegue el estado.
    if (!editing || edit.loading || edit.saving || !writable || savingRef.current) return false;
    const p = path;
    const content = edit.draft;
    if (content === edit.original && !force) {
      if (exit) setEdit(null);
      return true;
    }
    const baseHash = force ? null : edit.baseHash;
    savingRef.current = true;
    setEdit((e) => (e ? { ...e, saving: true, error: null } : e));
    try {
      const r = await withBackupSpacing(() => bibliotecaApi.notes.save(p, content, baseHash));
      const newHash = (r && r.hash) || null;
      setGuard(null);
      // Si se siguió escribiendo durante el guardado, no se sale: lo nuevo queda como cambio pendiente.
      setEdit((e) =>
        e && e.path === p
          ? exit && e.draft === content
            ? null
            : { ...e, original: content, baseHash: newHash, conflict: null, saving: false }
          : e,
      );
      setFlash({
        path: p,
        tone: 'ok',
        text: force
          ? `Guardado sobrescribiendo la versión que había en disco; esa versión quedó copiada en ${BACKUP_DIR} (carpeta con fecha y hora).`
          : `Guardado. La versión anterior quedó copiada en ${BACKUP_DIR} (carpeta con fecha y hora).`,
      });
      load({ quiet: true }); // refresca título, etiquetas, cuerpo y enlaces
      return true;
    } catch (err) {
      if (err && err.code === 'read_only') markReadOnly();
      if (isConflict(err)) {
        setGuard(null); // el aviso de conflicto sustituye a la pregunta de salir
        setEdit((e) =>
          e && e.path === p
            ? {
                ...e,
                saving: false,
                error: null,
                conflict: { exit, busy: null, error: null, current: (e.conflict && e.conflict.current) || null },
              }
            : e,
        );
        return false;
      }
      setEdit((e) => (e && e.path === p ? { ...e, saving: false, error: describeWriteError(err) } : e));
      return false;
    } finally {
      savingRef.current = false;
    }
  };

  // ── Conflicto al guardar (la nota cambió fuera del editor) ──
  const patchConflict = (p, patch) =>
    setEdit((e) => (e && e.path === p && e.conflict ? { ...e, conflict: { ...e.conflict, ...patch } } : e));
  const conflictIdle = editing && !!edit.conflict && !edit.conflict.busy && !edit.saving;

  const overwrite = () => {
    if (conflictIdle) save({ exit: !!edit.conflict.exit, force: true });
  };

  // "Ver versión actual": lee el disco y lo muestra, de solo lectura, bajo el editor. El borrador y
  // su baseHash no cambian hasta que se elige "Seguir editando sobre esta versión" (adoptCurrent).
  const viewCurrent = async () => {
    if (!conflictIdle) return;
    const p = path;
    patchConflict(p, { busy: 'view', error: null });
    try {
      const r = await bibliotecaApi.notes.raw(p);
      patchConflict(p, {
        busy: null,
        current: { content: r && typeof r.content === 'string' ? r.content : '', hash: (r && r.hash) || null },
      });
      load({ quiet: true }); // título y enlaces de la vista pasan a los de la versión del disco
    } catch (err) {
      if (err && err.code === 'read_only') markReadOnly();
      patchConflict(p, { busy: null, error: `No se pudo leer la versión actual: ${describeWriteError(err)}` });
    }
  };

  // Seguir con el borrador tal cual, pero tomando como base la versión del disco que se acaba de ver:
  // "Sin cambios" / "Cambios sin guardar" pasa a compararse con ella y el próximo guardado la sustituye
  // (si vuelve a cambiar fuera antes de guardar, el motor avisará de nuevo).
  const adoptCurrent = () => {
    const p = path;
    setGuard(null);
    setEdit((e) =>
      e && e.path === p && e.conflict && e.conflict.current && !e.conflict.busy
        ? { ...e, original: e.conflict.current.content, baseHash: e.conflict.current.hash, conflict: null, error: null }
        : e,
    );
    setFlash({
      path: p,
      tone: 'ok',
      text: `Sigues con tu borrador sobre la versión actual del disco. Al guardar la sustituirá (quedará copiada en ${BACKUP_DIR}).`,
    });
  };

  // "Descartar mis cambios": el editor pasa a mostrar la versión actual del disco.
  const discardMine = async () => {
    if (!conflictIdle) return;
    const p = path;
    patchConflict(p, { busy: 'discard', error: null });
    try {
      const r = await bibliotecaApi.notes.raw(p);
      const content = r && typeof r.content === 'string' ? r.content : '';
      setGuard(null);
      setEdit((e) =>
        e && e.path === p
          ? { path: p, original: content, draft: content, baseHash: (r && r.hash) || null, preview: e.preview }
          : e,
      );
      setFlash({
        path: p,
        tone: 'ok',
        text: 'Cambios descartados: el editor muestra ahora la versión actual del disco.',
      });
      load({ quiet: true });
    } catch (err) {
      if (err && err.code === 'read_only') markReadOnly();
      patchConflict(p, { busy: null, error: `No se pudo cargar la versión actual: ${describeWriteError(err)}` });
    }
  };

  const cancelEdit = () => {
    if (dirty) {
      setGuard({ kind: 'cancel' });
      return;
    }
    setEdit(null);
    setGuard(null);
  };
  const discard = () => {
    const g = guard;
    if (g && g.kind === 'nav') leave(g.target);
    else {
      setEdit(null);
      setGuard(null);
    }
  };
  const saveThenContinue = async () => {
    const g = guard;
    const ok = await save({ exit: true });
    if (ok && g && g.kind === 'nav') {
      leave(g.target);
      setFlash({
        path: g.target,
        tone: 'ok',
        text: `Cambios guardados antes de salir (copia de la versión anterior en ${BACKUP_DIR}).`,
      });
    }
  };

  // ── Gestión (renombrar / eliminar / crear) ──
  // El aviso va ligado a la ruta nueva, así que sobrevive a la navegación (igual que el de eliminar).
  const onRenamed = ({ to, linksUpdated = [], updateLinks = true }) => {
    setPanel(null);
    const n = linksUpdated.length;
    let text = `Renombrada: ahora es ${to}. El original quedó copiado en ${BACKUP_DIR}.`;
    if (!updateLinks) text += ' Los enlaces de otras notas no se han tocado.';
    else if (n === 0) text += ' Ninguna otra nota necesitaba cambiar sus enlaces.';
    else
      text += ` ${n === 1 ? '1 nota actualizada' : `${n} notas actualizadas`} con el nuevo enlace (cada una copiada antes)${n <= 10 ? ':' : '.'}`;
    setFlash({ path: to, tone: 'ok', text, links: updateLinks && n > 0 && n <= 10 ? linksUpdated : null });
    if (onOpenNote) onOpenNote(to);
  };
  const onDeleted = (deletedPath) => {
    setPanel(null);
    setFlash({
      path: null,
      tone: 'ok',
      text: `Nota eliminada: ${deletedPath}. Queda una copia en ${BACKUP_DIR} por si hay que recuperarla.`,
    });
    if (onOpenNote) onOpenNote(null);
  };
  const onCreated = (created) => {
    queueEditOnOpen(created.path, created.content, created.hash);
    setFlash({
      path: created.path,
      tone: 'ok',
      text: `Nota creada: ${created.path}. Escribe y pulsa Guardar (o Ctrl/⌘+S).`,
    });
    if (onOpenNote) onOpenNote(created.path);
  };

  // Enlace roto [[target]] → crea <target>.md (ruta desde la raíz de la bóveda) y la abre en el editor.
  const createFromLink = async (target) => {
    if (!canCreate || creatingLink) return;
    const from = path;
    const rel = linkTargetToPath(target);
    if (!rel) {
      setFlash({ path: from, tone: 'error', text: `«${target}» no sirve como nombre de archivo para crear la nota.` });
      return;
    }
    const heading = String(target).split('/').pop().trim().replace(/\s+/g, ' ') || stripMd(rel);
    const content = `# ${heading}\n\n`;
    setCreatingLink(target);
    try {
      const r = await bibliotecaApi.notes.create(rel, content);
      const created = {
        path: (r && r.path) || rel,
        content: r && typeof r.content === 'string' ? r.content : content,
        hash: (r && r.hash) || null,
      };
      if (pathRef.current !== from) {
        // se navegó a otra parte mientras tanto: no se arrastra al usuario
        setFlash({ path: pathRef.current || null, tone: 'ok', text: `Nota creada: ${created.path}.` });
        return;
      }
      setEdit((e) => (isUnsaved(e) && e.path !== from ? e : null));
      setPanel(null);
      setGuard(null);
      onCreated(created);
    } catch (err) {
      if (err && err.code === 'read_only') markReadOnly();
      if (err && err.code === 'exists') {
        // ya hay un archivo con ese nombre: se abre
        if (pathRef.current === from) {
          leave(rel);
          setFlash({ path: rel, tone: 'ok', text: `Ya existía ${rel}; aquí la tienes.` });
        }
        return;
      }
      setFlash({ path: from, tone: 'error', text: `No se pudo crear ${rel}: ${describeWriteError(err)}` });
    } finally {
      setCreatingLink(null);
    }
  };

  // Ctrl/⌘+S mientras se edita: guarda sin salir del editor (y evita el "Guardar página" del navegador).
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        if (saveRef.current) saveRef.current({ exit: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  // Cerrar o recargar la pestaña del navegador con cambios sin guardar → aviso nativo.
  const unsaved = isUnsaved(edit);
  useEffect(() => {
    if (!unsaved) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  // Si la vista se desmonta (cambio de pestaña del panel) con cambios sin guardar, el
  // borrador se guarda en memoria y se recupera al volver.
  useEffect(() => {
    editRef.current = edit;
    pathRef.current = path;
  });
  useEffect(() => {
    clearStashedDraft(); // ya está en el estado de esta vista
    return () => stashDraftIfUnsaved(editRef);
  }, []);

  const flashHere = flash && (flash.path || null) === (path || null) ? flash : null;
  const flashLinks = flashHere && Array.isArray(flashHere.links) && flashHere.links.length > 0 ? flashHere.links : null;
  const flashBanner = flashHere ? (
    <Banner
      tone={flashHere.tone}
      onClose={() => setFlash(null)}
      actions={
        flashHere.createTarget && canCreate && linkTargetToPath(flashHere.createTarget) ? (
          <ActionBtn
            label={creatingLink ? 'Creando…' : 'Crear la nota'}
            tone="gold"
            disabled={!!creatingLink}
            onClick={() => createFromLink(flashHere.createTarget)}
            title={`Crear ${linkTargetToPath(flashHere.createTarget)} y abrirla para editar`}
          />
        ) : null
      }
    >
      {flashHere.text}
      {flashLinks && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px', marginTop: 4 }}>
          {flashLinks.map((p) => (
            <NotePathLink key={p} path={p} onOpen={go} />
          ))}
        </span>
      )}
    </Banner>
  ) : null;
  const conflict = editing ? edit.conflict : null;
  const conflictBanner = conflict ? (
    <Banner
      tone="warn"
      actions={
        <>
          <ActionBtn
            label={edit.saving ? 'Guardando…' : 'Sobrescribir igualmente'}
            tone="gold"
            onClick={overwrite}
            disabled={!writable || !conflictIdle}
            title={`Guarda tu versión encima de la del disco; esa otra versión queda copiada en ${BACKUP_DIR}`}
          />
          <ActionBtn
            label={
              conflict.busy === 'view'
                ? 'Cargando…'
                : conflict.current
                  ? 'Recargar versión actual'
                  : 'Ver versión actual'
            }
            onClick={viewCurrent}
            disabled={!conflictIdle}
            title="Muestra lo que hay ahora en el archivo, de solo lectura, bajo el editor"
          />
          <ActionBtn
            label={conflict.busy === 'discard' ? 'Cargando…' : 'Descartar mis cambios'}
            tone="danger"
            onClick={discardMine}
            disabled={!conflictIdle}
            title="Tira tu borrador y carga en el editor la versión actual del disco"
          />
        </>
      }
    >
      La nota ha cambiado fuera del editor (p. ej. al sincronizar desde Google Drive) desde que empezaste a editar. Tu
      borrador sigue aquí, sin guardar.
      <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: TINTA_2 }}>
        «Sobrescribir igualmente» guarda tu versión encima; la otra queda copiada en {BACKUP_DIR}.
        {conflict.current
          ? ' Debajo del editor tienes la versión actual para copiar de ella.'
          : ' «Ver versión actual» la muestra debajo del editor para que copies lo que necesites.'}
      </span>
      {conflict.error && <span style={{ display: 'block', marginTop: 2, color: IMPIDE }}>{conflict.error}</span>}
    </Banner>
  ) : null;
  const orphanBanner = orphan ? (
    <Banner
      tone="warn"
      actions={
        <>
          <ActionBtn
            label="Volver a esa nota"
            tone="gold"
            onClick={() => {
              setPanel(null);
              setGuard(null);
              if (onOpenNote) onOpenNote(orphan.path);
            }}
          />
          <ActionBtn label="Descartar cambios" tone="danger" onClick={() => setEdit(null)} />
        </>
      }
    >
      Tienes cambios sin guardar en <b>{orphan.path}</b>. Vuelve a esa nota para guardarlos, o descártalos.
    </Banner>
  ) : null;

  // Sin nota seleccionada → índice de toda la carpeta.
  if (!path)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orphanBanner}
        {flashBanner}
        <NotesList
          onOpenNote={leave}
          writable={writable && !orphan}
          onCreated={onCreated}
          onReadOnly={markReadOnly}
          carpeta={carpeta}
          onQuitarCarpeta={onQuitarCarpeta}
        />
      </div>
    );
  if (state.kind === 'loading' || state.kind === 'empty')
    return (
      <Centered>
        <span style={{ color: TINTA_2, fontSize: 13 }}>Cargando nota…</span>
      </Centered>
    );
  if (state.kind === 'not_configured') return <NotConfigured />;
  if (state.kind === 'engine_down') return <EngineDown />;
  if (state.kind === 'error')
    return (
      <div>
        <BackToList onBack={() => leave(null)} />
        <Centered>
          <ErrorLegible texto="No se pudo abrir la nota. Prueba de nuevo en unos segundos." detalle={state.message} />
        </Centered>
      </div>
    );

  const { note, links } = state;
  const fm = note.frontmatter || {};
  const tags = Array.isArray(fm.tags)
    ? fm.tags
    : typeof fm.tags === 'string'
      ? fm.tags.split(',').map((t) => t.trim())
      : [];
  const linkInfo = normalizeLinks(links, note);
  const { outgoing, incoming } = linkInfo;
  const broken = linkInfo.resolved ? outgoing.filter((o) => !o.path).length : 0;
  const notePath = note.path || path;

  // [[wikilink]] pulsado en el cuerpo (o en la vista previa del editor): se busca en los enlaces
  // salientes ya resueltos por el motor (por destino, sin mayúsculas ni #sección) y se abre su ruta.
  // Si el motor sabe que está roto → aviso con "Crear la nota". Si no aparece (enlace nuevo del
  // borrador, o /links no respondió) → como antes, por nombre: <destino>.md.
  const openWiki = (name) => {
    const { target } = parseWikiName(name);
    if (!target) return; // [[#Sección]]: enlace dentro de esta misma nota
    const hit = outgoing.find((o) => sameLinkTarget(o.target, target));
    if (hit && hit.path) {
      go(hit.path);
      return;
    }
    if (hit && linkInfo.resolved) {
      setFlash({
        path,
        tone: 'warn',
        text: `«${target}» no existe todavía en la Biblioteca (enlace roto).`,
        createTarget: target,
      });
      return;
    }
    go(/\.md$/i.test(target) ? target : `${target}.md`);
  };
  // Mientras se edita, la barra de acciones queda fija arriba (notas largas).
  const stickyBar = editing
    ? { position: 'sticky', top: 0, zIndex: 5, background: LIENZO, paddingTop: 6, paddingBottom: 6 }
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Barra: volver + acciones + avisos */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...stickyBar }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <BackToList onBack={() => go(null)} />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {editing ? (
              <>
                <span style={{ fontSize: 11.5, color: dirty ? RIESGO : TINTA_2, marginRight: 4 }}>
                  {edit.loading ? 'Cargando…' : dirty ? '● Cambios sin guardar' : 'Sin cambios'}
                </span>
                <ActionBtn label="Cancelar" onClick={cancelEdit} disabled={edit.saving} />
                <ActionBtn
                  label={edit.saving ? 'Guardando…' : 'Guardar'}
                  tone="gold"
                  onClick={() => save({ exit: true })}
                  disabled={!writable || edit.loading || edit.saving || !dirty}
                  title="Guardar y volver a la lectura (Ctrl/⌘+S guarda sin salir)"
                />
              </>
            ) : writable ? (
              <>
                <ActionBtn
                  label="Editar"
                  onClick={startEdit}
                  disabled={!!orphan}
                  title={orphan ? 'Primero guarda o descarta los cambios pendientes de la otra nota' : undefined}
                />
                <ActionBtn
                  label="Renombrar / mover"
                  active={panel === 'rename'}
                  onClick={() => setPanel(panel === 'rename' ? null : 'rename')}
                />
                <ActionBtn
                  label="Eliminar"
                  tone="danger"
                  active={panel === 'delete'}
                  onClick={() => setPanel(panel === 'delete' ? null : 'delete')}
                />
              </>
            ) : mode === 'server' ? (
              <span style={{ fontSize: 11.5, color: TINTA_2 }}>Solo lectura · modo servidor</span>
            ) : null}
          </div>
        </div>
        {guard && dirty && (
          <Banner
            tone="warn"
            actions={
              <>
                <ActionBtn
                  label={guard.kind === 'nav' ? 'Guardar y salir' : 'Guardar y cerrar'}
                  tone="gold"
                  onClick={saveThenContinue}
                  disabled={!writable || edit.saving}
                />
                <ActionBtn label="Descartar cambios" tone="danger" onClick={discard} disabled={edit.saving} />
                <ActionBtn label="Seguir editando" onClick={() => setGuard(null)} />
              </>
            }
          >
            {guard.kind === 'nav'
              ? 'Tienes cambios sin guardar en esta nota. ¿Qué hago antes de salir?'
              : '¿Descartar los cambios sin guardar?'}
          </Banner>
        )}
        {conflictBanner}
        {orphanBanner}
        {flashBanner}
      </div>

      {!editing && writable && panel === 'rename' && (
        <RenamePanel
          notePath={notePath}
          onRenamed={onRenamed}
          onCancel={() => setPanel(null)}
          onReadOnly={markReadOnly}
        />
      )}
      {!editing && writable && panel === 'delete' && (
        <DeletePanel
          notePath={notePath}
          title={note.title || notePath}
          onDeleted={onDeleted}
          onCancel={() => setPanel(null)}
          onReadOnly={markReadOnly}
        />
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Cuerpo (lectura o editor) */}
        <div style={{ flex: 2, minWidth: 320, background: LIENZO, border: `1px solid ${BORDE}`, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: TINTA }}>{note.title || note.path}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: TINTA_2 }}>{relativeTime(note.mtime)}</span>
          </div>
          {editing ? (
            <>
              <NoteEditor edit={edit} onChange={setDraft} onPreview={setPreview} onWiki={openWiki} />
              {edit.conflict && edit.conflict.current && (
                <ConflictCurrentBox
                  content={edit.conflict.current.content}
                  onAdopt={adoptCurrent}
                  disabled={!conflictIdle}
                />
              )}
            </>
          ) : (
            <>
              {tags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {tags.map((t) => (
                    <Tag key={t}>#{t}</Tag>
                  ))}
                </div>
              )}
              <Markdown text={note.body} onWiki={openWiki} />
            </>
          )}
        </div>

        {/* Enlaces [[…]] resueltos por el motor */}
        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionCard
            title={`ENLACES SALIENTES (${outgoing.length})`}
            right={
              !linkInfo.resolved && outgoing.length > 0
                ? 'sin comprobar'
                : broken > 0
                  ? `${broken} ${broken === 1 ? 'roto' : 'rotos'}`
                  : null
            }
          >
            {outgoing.length === 0 ? (
              <span style={{ color: TINTA_2, fontSize: 12 }}>Ninguno.</span>
            ) : (
              outgoing.map((x, i) => (
                <OutgoingLink
                  key={`${i}:${x.target}#${x.heading || ''}`}
                  link={x}
                  resolved={linkInfo.resolved}
                  onOpen={go}
                  canCreate={canCreate}
                  creating={creatingLink === x.target}
                  busy={!!creatingLink}
                  onCreate={() => createFromLink(x.target)}
                />
              ))
            )}
            {!linkInfo.resolved && outgoing.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: TINTA_2, lineHeight: 1.5 }}>
                No se pudo comprobar a qué notas apuntan; se abren por nombre.
              </div>
            )}
          </SectionCard>
          <SectionCard title={linkInfo.resolved ? `ENLACES ENTRANTES (${incoming.length})` : 'ENLACES ENTRANTES'}>
            {!linkInfo.resolved ? (
              <span style={{ color: TINTA_2, fontSize: 12 }}>No disponibles ahora mismo.</span>
            ) : incoming.length === 0 ? (
              <span style={{ color: TINTA_2, fontSize: 12 }}>Ninguna nota enlaza a esta.</span>
            ) : (
              incoming.map((x) => (
                <div key={x.path} onClick={() => go(x.path)} title={x.path} style={linkRowStyle}>
                  ← {x.title || stripMd(x.path)}
                </div>
              ))
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function BackToList({ onBack }) {
  return (
    <button
      onClick={onBack}
      style={{
        alignSelf: 'flex-start',
        padding: '5px 11px',
        fontSize: 12,
        color: TINTA_2,
        background: 'transparent',
        border: `1px solid ${HERMES}55`,
        borderRadius: RADIUS,
        cursor: 'pointer',
      }}
    >
      ← Todas las notas
    </button>
  );
}
