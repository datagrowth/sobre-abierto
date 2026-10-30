// Piezas de UI de la gestión de notas: botones, avisos, editor y formularios de
// nueva nota / renombrar-mover / eliminar. Confirmaciones siempre en la página (sin window.confirm).
import { useState } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import {
  TINTA,
  TINTA_2,
  ACCION,
  HERMES,
  HERMES_PUNTO,
  LIENZO,
  BORDE,
  BORDE_CONTROL,
  IMPIDE,
  RADIUS,
  RADIUS_PANEL,
  FONT_MONO,
  alpha,
} from '../../lib/tema';
import { Markdown } from './bibliotecaMarkdown';
import {
  BACKUP_DIR,
  useVaultFolders,
  describeWriteError,
  splitNotePath,
  stripMd,
  joinNotePath,
  folderLabel,
  cleanFileName,
  stripFrontmatter,
  withBackupSpacing,
} from './bibliotecaNotaAyudas';

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  fontSize: 13,
  color: TINTA,
  background: LIENZO,
  border: `1px solid ${BORDE_CONTROL}`,
  borderRadius: RADIUS,
  fontFamily: FONT_MONO,
};
const hintStyle = { fontSize: 12, color: TINTA_2, lineHeight: 1.55 };
const codeStyle = { color: TINTA_2, fontFamily: FONT_MONO, fontSize: 11.5, wordBreak: 'break-all' };

export function ActionBtn({ label, onClick, disabled, tone = 'default', active = false, title }) {
  const color = tone === 'gold' ? ACCION : tone === 'danger' ? IMPIDE : HERMES;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '5px 11px',
        fontSize: 12,
        fontWeight: tone === 'gold' ? 600 : 400,
        color,
        borderRadius: RADIUS,
        flexShrink: 0,
        background: active ? alpha(TINTA, 0.072) : 'transparent',
        border: `1px solid ${alpha(color, 0.33)}`,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

const TONES = {
  ok: { color: TINTA, bg: alpha(TINTA, 0.048), border: BORDE },
  warn: { color: TINTA, bg: alpha(TINTA, 0.072), border: alpha(HERMES, 0.6) },
  error: { color: IMPIDE, bg: alpha(IMPIDE, 0.08), border: alpha(IMPIDE, 0.4) },
};

// Aviso en línea (guardado, error, confirmación…) con acciones opcionales.
export function Banner({ tone = 'ok', children, actions, onClose }) {
  const t = TONES[tone] || TONES.ok;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '8px 12px',
        fontSize: 12.5,
        lineHeight: 1.5,
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: RADIUS,
      }}
    >
      <div style={{ flex: '1 1 260px', minWidth: 0, wordBreak: 'break-word' }}>{children}</div>
      {actions && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{actions}</div>}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          title="Cerrar"
          style={{
            background: 'transparent',
            border: 'none',
            color: TINTA_2,
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function FormCard({ title, danger = false, children }) {
  return (
    <div
      style={{
        background: LIENZO,
        border: `1px solid ${danger ? alpha(IMPIDE, 0.4) : BORDE}`,
        borderRadius: RADIUS_PANEL,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        className="brand-text"
        style={{ fontSize: 12, fontWeight: 700, color: danger ? IMPIDE : HERMES_PUNTO, letterSpacing: '0.08em' }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, wide = false, children }) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: wide ? '2 1 240px' : '1 1 180px',
        minWidth: 0,
        fontSize: 11,
        color: TINTA_2,
        letterSpacing: '0.04em',
      }}
    >
      {label}
      {children}
    </label>
  );
}

function FolderSelect({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...inputStyle, fontFamily: 'inherit' }}
    >
      {options.map((f) => (
        <option key={`f:${f}`} value={f}>
          {folderLabel(f)}
        </option>
      ))}
    </select>
  );
}

// Editor de markdown en crudo (textarea monoespaciada) con vista previa.
// edit = { loading, draft, preview, error }
export function NoteEditor({ edit, onChange, onPreview, onWiki }) {
  if (edit.loading) return <div style={{ padding: '30px 0', color: TINTA_2, fontSize: 13 }}>Cargando contenido…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <ActionBtn label="Markdown" active={!edit.preview} onClick={() => onPreview(false)} />
        <ActionBtn label="Vista previa" active={!!edit.preview} onClick={() => onPreview(true)} />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: TINTA_2 }}>
          Markdown en crudo · Ctrl/⌘+S guarda sin salir del editor
        </span>
      </div>
      {edit.preview ? (
        <div style={{ minHeight: 420, padding: '4px 2px' }}>
          {edit.draft.trim() ? (
            <Markdown text={stripFrontmatter(edit.draft)} onWiki={onWiki} />
          ) : (
            <span style={{ color: TINTA_2, fontSize: 12.5 }}>(nota vacía)</span>
          )}
        </div>
      ) : (
        <textarea
          value={edit.draft}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            minHeight: 420,
            height: '60vh',
            resize: 'vertical',
            padding: '12px 14px',
            fontFamily: FONT_MONO,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: TINTA,
            tabSize: 2,
            background: LIENZO,
            border: `1px solid ${BORDE_CONTROL}`,
            borderRadius: RADIUS,
          }}
        />
      )}
      {edit.error && <div style={{ fontSize: 12.5, color: IMPIDE }}>Error al guardar: {edit.error}</div>}
    </div>
  );
}

// Conflicto al guardar → "Ver versión actual": lo que hay ahora en disco, de solo lectura, bajo el
// editor para copiar de ahí. onAdopt = seguir editando encima de esa versión (el borrador no cambia).
export function ConflictCurrentBox({ content, onAdopt, disabled }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        marginTop: 14,
        paddingTop: 12,
        borderTop: `1px dashed ${HERMES}66`,
      }}
    >
      <div className="brand-text" style={{ fontSize: 12, fontWeight: 700, color: TINTA_2, letterSpacing: '0.08em' }}>
        VERSIÓN ACTUAL EN DISCO · SOLO LECTURA
      </div>
      <div style={hintStyle}>
        Es lo que hay ahora mismo en el archivo. Copia a tu borrador (arriba) lo que quieras conservar y, cuando
        termines, pulsa «Seguir editando sobre esta versión»: al guardar, tu borrador sustituirá a esta versión, que
        quedará copiada en <code style={codeStyle}>{BACKUP_DIR}</code>.
      </div>
      <textarea
        readOnly
        value={content}
        spellCheck={false}
        aria-label="Versión actual en disco (solo lectura)"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          minHeight: 220,
          height: '35vh',
          resize: 'vertical',
          padding: '12px 14px',
          fontFamily: FONT_MONO,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: TINTA_2,
          tabSize: 2,
          background: LIENZO,
          border: `1px dashed ${BORDE_CONTROL}`,
          borderRadius: RADIUS,
        }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <ActionBtn
          label="Seguir editando sobre esta versión"
          tone="gold"
          onClick={onAdopt}
          disabled={disabled}
          title="Tu borrador se queda como está; al guardar sustituirá a esta versión (y si vuelve a cambiar fuera, se avisará otra vez)"
        />
      </div>
    </div>
  );
}

// "Nueva nota" desde el índice: carpeta + título → crea <carpeta>/<título>.md y la abre en edición.
export function NewNotePanel({ onCreated, onCancel, onReadOnly }) {
  const folders = useVaultFolders();
  const [folder, setFolder] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fileName = cleanFileName(title, { strict: true });
  const target = fileName ? joinNotePath(folder, fileName) : '';

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    const heading = title.trim().replace(/\s+/g, ' ') || fileName;
    const content = `# ${heading}\n\n`;
    try {
      const r = await bibliotecaApi.notes.create(target, content);
      onCreated({
        path: (r && r.path) || target,
        content: r && typeof r.content === 'string' ? r.content : content,
        hash: (r && r.hash) || null,
      });
    } catch (err) {
      if (err && err.code === 'read_only' && onReadOnly) onReadOnly();
      setError(
        err && err.code === 'exists'
          ? `Ya existe una nota en «${target}». Elige otro título o carpeta.`
          : describeWriteError(err),
      );
      setBusy(false);
    }
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') onCancel();
  };

  return (
    <FormCard title="NUEVA NOTA">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Carpeta">
          <FolderSelect value={folder} onChange={setFolder} options={folders.list} disabled={busy} />
        </Field>
        <Field label="Título" wide>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            autoFocus
            placeholder="p. ej. Ideas para el proyecto"
            style={inputStyle}
          />
        </Field>
      </div>
      <div style={hintStyle}>
        Se creará <code style={codeStyle}>{target || '…'}</code> y se abrirá en el editor.
        {folders.loading && ' Cargando carpetas…'}
        {folders.error && ` (No se pudieron cargar las carpetas: ${folders.error}.)`}
      </div>
      {error && <div style={{ fontSize: 12.5, color: IMPIDE }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <ActionBtn
          label={busy ? 'Creando…' : 'Crear y editar'}
          tone="gold"
          onClick={submit}
          disabled={!target || busy}
        />
        <ActionBtn label="Cancelar" onClick={onCancel} disabled={busy} />
      </div>
    </FormCard>
  );
}

// Renombrar y/o mover a otra carpeta. El motor copia antes el archivo original a la carpeta de copias
// y, si se pide, reescribe los [[wikilinks]] de las otras notas que apuntaban a ella (también con copia).
// onRenamed({ to, linksUpdated: string[], updateLinks })
export function RenamePanel({ notePath, onRenamed, onCancel, onReadOnly }) {
  const { folder: curFolder, file: curFile } = splitNotePath(notePath);
  const folders = useVaultFolders();
  const [folder, setFolder] = useState(curFolder);
  const [name, setName] = useState(stripMd(curFile));
  const [updateLinks, setUpdateLinks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // La carpeta actual siempre como opción, aunque el listado no la incluya.
  const options = folders.list.includes(curFolder) ? folders.list : [curFolder, ...folders.list];
  const clean = cleanFileName(name);
  const target = clean ? joinNotePath(folder, clean) : '';
  const unchanged = target === notePath;
  const canSubmit = !!target && !unchanged && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await withBackupSpacing(() => bibliotecaApi.notes.rename(notePath, target, { updateLinks }));
      const linksUpdated =
        r && Array.isArray(r.links_updated) ? r.links_updated.filter((p) => typeof p === 'string' && p) : [];
      onRenamed({ to: (r && r.to) || target, linksUpdated, updateLinks });
    } catch (err) {
      if (err && err.code === 'read_only' && onReadOnly) onReadOnly();
      if (err && err.code === 'exists' && target.toLowerCase() === notePath.toLowerCase()) {
        // Sistemas de archivos que no distinguen mayúsculas (Windows/macOS): el motor ve el destino como "ya existe".
        setError('Cambiar solo mayúsculas/minúsculas no es posible aquí: renómbrala primero a un nombre intermedio.');
      } else {
        setError(err && err.code === 'exists' ? `Ya existe una nota en «${target}».` : describeWriteError(err));
      }
      setBusy(false);
    }
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') onCancel();
  };

  return (
    <FormCard title="RENOMBRAR / MOVER">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Carpeta">
          <FolderSelect value={folder} onChange={setFolder} options={options} disabled={busy} />
        </Field>
        <Field label="Nombre (sin .md)" wide>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            autoFocus
            style={inputStyle}
          />
        </Field>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12.5,
          color: TINTA,
          cursor: busy ? 'default' : 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        <input
          type="checkbox"
          checked={updateLinks}
          onChange={(e) => setUpdateLinks(e.target.checked)}
          disabled={busy}
          style={{ accentColor: ACCION, margin: 0, cursor: 'inherit' }}
        />
        Actualizar los enlaces [[…]] en otras notas
      </label>
      <div style={hintStyle}>
        Nueva ruta: <code style={codeStyle}>{target || '…'}</code>
        {unchanged && ' (sin cambios)'}
        {folders.loading && ' · cargando carpetas…'}
        <br />
        Antes de mover, el motor guarda una copia en <code style={codeStyle}>{BACKUP_DIR}</code>.
        {updateLinks
          ? ' Las notas que enlazan a esta se reescriben para apuntar a la nueva ruta (cada una se copia antes).'
          : ' Las demás notas no se tocan: sus [[wikilinks]] al nombre o ruta antiguos pueden quedar rotos.'}
      </div>
      {error && <div style={{ fontSize: 12.5, color: IMPIDE }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <ActionBtn
          label={busy ? 'Moviendo…' : 'Renombrar / mover'}
          tone="gold"
          onClick={submit}
          disabled={!canSubmit}
        />
        <ActionBtn label="Cancelar" onClick={onCancel} disabled={busy} />
      </div>
    </FormCard>
  );
}

// Confirmación de borrado en la propia página.
export function DeletePanel({ notePath, title, onDeleted, onCancel, onReadOnly }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await withBackupSpacing(() => bibliotecaApi.notes.remove(notePath));
      onDeleted(notePath);
    } catch (err) {
      if (err && err.code === 'read_only' && onReadOnly) onReadOnly();
      setError(describeWriteError(err));
      setBusy(false);
    }
  };

  return (
    <FormCard title="ELIMINAR NOTA" danger>
      <div style={{ fontSize: 13, color: TINTA, lineHeight: 1.6 }}>
        ¿Eliminar <b>«{title}»</b>? Se borrará <code style={codeStyle}>{notePath}</code> de la Biblioteca.
      </div>
      <div style={hintStyle}>
        Antes de borrar, el motor guarda una copia en <code style={codeStyle}>{BACKUP_DIR}</code> (carpeta con fecha y
        hora), así que se puede recuperar a mano. Los [[wikilinks]] que apunten a esta nota quedarán rotos.
      </div>
      {error && <div style={{ fontSize: 12.5, color: IMPIDE }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <ActionBtn label={busy ? 'Eliminando…' : 'Sí, eliminar'} tone="danger" onClick={submit} disabled={busy} />
        <ActionBtn label="Cancelar" onClick={onCancel} disabled={busy} />
      </div>
    </FormCard>
  );
}
