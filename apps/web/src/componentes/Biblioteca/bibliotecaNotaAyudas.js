// Utilidades de la gestión de notas (editar, crear, renombrar, eliminar) de Hermes Vault.
import { useEffect, useState } from 'react';
import { bibliotecaApi } from '../../lib/bibliotecaApi';
import { engineDown } from './bibliotecaAyudas';

// Carpeta (dentro de la bóveda) donde el motor copia la versión anterior antes de escribir.
export const BACKUP_DIR = '.hermes-vault/backups/';

// Modo del motor: 'local' (se puede escribir) | 'server' (solo lectura) | null (aún no se sabe).
// Si el motor no responde, reintenta cada 5 s mientras la vista siga montada.
export function useVaultMode() {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer = null;
    const fetchMode = () => {
      bibliotecaApi
        .config()
        .then((c) => {
          if (alive) setMode(c && c.mode === 'server' ? 'server' : 'local');
        })
        .catch((err) => {
          if (!alive) return;
          if (engineDown(err)) timer = setTimeout(fetchMode, 5000);
          else setMode('unknown'); // sin modo fiable → las acciones de escritura quedan ocultas
        });
    };
    fetchMode();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return [mode, setMode];
}

// El motor agrupa las copias por segundo (carpeta AAAA-MM-DD/HHMMSS): dos escrituras de la
// misma nota dentro del mismo segundo pisarían la copia de la versión original. Por eso las
// escrituras con copia (guardar, renombrar, eliminar) van en fila y separadas al menos 1,1 s.
let writeChain = Promise.resolve();
let lastWriteAt = 0;
export function withBackupSpacing(fn) {
  const run = writeChain.then(async () => {
    const wait = lastWriteAt + 1100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await fn();
    } finally {
      lastWriteAt = Date.now();
    }
  });
  writeChain = run.catch(() => {});
  return run;
}

// Carpetas de la bóveda para los selectores ('' = raíz). Si falla, ofrece solo la raíz.
export function useVaultFolders() {
  const [st, setSt] = useState({ loading: true, list: [''], error: null });
  useEffect(() => {
    let alive = true;
    bibliotecaApi.vault
      .folders()
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r && r.folders) ? r.folders.filter((f) => typeof f === 'string') : [];
        setSt({ loading: false, list: list.includes('') ? list : ['', ...list], error: null });
      })
      .catch((err) => {
        if (alive) setSt({ loading: false, list: [''], error: (err && err.message) || 'Error' });
      });
    return () => {
      alive = false;
    };
  }, []);
  return st;
}

// Nota recién creada que debe abrirse directamente en modo edición. Vive a nivel de
// módulo para sobrevivir aunque el panel padre vuelva a montar la vista de nota.
// hash: el que devolvió el motor al crearla, si lo dio (base para detectar cambios externos).
let queuedEdit = null;
export function queueEditOnOpen(path, content, hash = null) {
  queuedEdit = { path, content, hash: hash || null, at: Date.now() };
}
export function takeQueuedEdit(path) {
  if (!queuedEdit || queuedEdit.path !== path) return null;
  const q = queuedEdit;
  queuedEdit = null;
  return Date.now() - q.at < 60000 ? q : null; // caduca: no reabrir el editor por sorpresa más tarde
}

// ¿El borrador tiene cambios sin guardar?
export function isUnsaved(edit) {
  return !!edit && !edit.loading && typeof edit.draft === 'string' && edit.draft !== edit.original;
}

// Borrador sin guardar que sobrevive a que se desmonte la vista (p. ej. al cambiar de
// pestaña en el panel): se recupera al volver a "Notas". Conserva su baseHash (la versión
// del disco sobre la que se empezó a editar) y un conflicto pendiente, sin peticiones en curso.
let stashedDraft = null;
export function peekStashedDraft() {
  return stashedDraft;
}
export function clearStashedDraft() {
  stashedDraft = null;
}
export function stashDraftIfUnsaved(editRef) {
  const e = editRef.current;
  stashedDraft = isUnsaved(e)
    ? {
        ...e,
        baseHash: e.baseHash || null,
        conflict: e.conflict ? { ...e.conflict, busy: null } : null,
        saving: false,
        error: null,
      }
    : null;
}

// 409 del motor al guardar con base_hash: el archivo cambió en disco desde que se abrió el editor.
export function isConflict(err) {
  return !!err && (err.code === 'conflict' || err.status === 409);
}

// Mensaje legible para un fallo de escritura (ApiError con .code).
export function describeWriteError(err) {
  const code = err && err.code;
  const msg = (err && err.message) || '';
  if (code === 'read_only') return 'Modo servidor: las notas son de solo lectura.';
  if (code === 'exists') return 'Ya existe una nota en esa ruta. Elige otro nombre o carpeta.';
  if (code === 'unsafe_path') return 'Ruta no permitida: tiene que ser un archivo .md dentro de la bóveda.';
  if (code === 'not_found')
    return 'La nota ya no existe en disco (¿se movió o se borró fuera de la Biblioteca de Conocimiento?).';
  if (code === 'invalid_content')
    return /límite/i.test(msg) ? 'La nota supera el límite de 2 MB.' : msg || 'Contenido no válido.';
  if (/too large/i.test(msg)) return 'La nota es demasiado grande para guardarla (límite 2 MB).';
  if (code === 'not_configured') return msg || 'La bóveda no está configurada (ve a Ajustes).';
  if (engineDown(err))
    return 'El motor de la Biblioteca de Conocimiento no responde. Inténtalo de nuevo en unos segundos.';
  return msg || 'Error desconocido';
}

// 'a/b/nota.md' → { folder: 'a/b', file: 'nota.md' }
export function splitNotePath(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? { folder: s.slice(0, i), file: s.slice(i + 1) } : { folder: '', file: s };
}

export function stripMd(name) {
  return String(name || '').replace(/\.md$/i, '');
}

export function joinNotePath(folder, name) {
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

export function folderLabel(folder) {
  return folder || '(raíz de la bóveda)';
}

// Nombre de archivo seguro (sin extensión) a partir de lo que escribe el usuario.
// Siempre sustituye lo prohibido en Windows/macOS/Linux; con strict también lo que
// rompe los wikilinks [[…]] (# ^ [ ]). Sin puntos al inicio (archivo oculto)
// ni al final (Windows), y con una longitud razonable.
const FS_INVALID = /[\\/:*?"<>|]/g;
const LINK_INVALID = /[\\/:*?"<>|#^[\]]/g;
export function cleanFileName(input, { strict = false } = {}) {
  let s = Array.from(String(input || ''))
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 && c !== 127;
    })
    .join('');
  s = s.trim().replace(/\.md$/i, '');
  s = s.replace(strict ? LINK_INVALID : FS_INVALID, '-');
  s = s
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, 120)
    .replace(/[.\s]+$/, '');
  return s;
}

// Texto de un [[wikilink]] tal cual lo pasa el renderizador ('Nota#Sección|alias') →
// { target: 'Nota', heading: 'Sección' | null }.
export function parseWikiName(name) {
  const s = String(name || '').split('|')[0];
  const i = s.indexOf('#');
  const target = (i >= 0 ? s.slice(0, i) : s).trim();
  const heading = i >= 0 ? s.slice(i + 1).trim() || null : null;
  return { target, heading };
}

// ¿Dos destinos de enlace son el mismo? (sin distinguir mayúsculas ni la extensión .md)
export function sameLinkTarget(a, b) {
  const norm = (x) => stripMd(String(x || '').trim()).toLowerCase();
  return norm(a) === norm(b);
}

// Respuesta de notes.links → { resolved, outgoing, incoming }. Si no llegó (motor antiguo o
// fallo), se usan los note.wikilinks como salientes sin resolver y no hay entrantes.
export function normalizeLinks(links, note) {
  if (links && Array.isArray(links.outgoing)) {
    return {
      resolved: true,
      outgoing: links.outgoing
        .filter((o) => o && typeof o === 'object')
        .map((o) => ({
          target: String(o.target || ''),
          heading: o.heading ? String(o.heading) : null,
          path: typeof o.path === 'string' && o.path ? o.path : null,
          title: o.title ? String(o.title) : null,
        })),
      incoming: Array.isArray(links.incoming)
        ? links.incoming
            .filter((x) => x && typeof x.path === 'string' && x.path)
            .map((x) => ({ path: x.path, title: x.title ? String(x.title) : null }))
        : [],
    };
  }
  const seen = new Set();
  const outgoing = [];
  for (const w of note && Array.isArray(note.wikilinks) ? note.wikilinks : []) {
    const { target, heading } = parseWikiName(w);
    const key = `${target.toLowerCase()}#${(heading || '').toLowerCase()}`;
    if (!target || seen.has(key)) continue;
    seen.add(key);
    outgoing.push({ target, heading, path: null, title: null });
  }
  return { resolved: false, outgoing, incoming: [] };
}

// Ruta (desde la raíz de la bóveda) de la nota que satisface un enlace roto [[target]]:
// 'Idea' → 'Idea.md', 'carpeta/Idea' → 'carpeta/Idea.md'. '' si el nombre no sirve.
export function linkTargetToPath(target) {
  const segs = String(target || '')
    .split('/')
    .map((s) => cleanFileName(s, { strict: true }))
    .filter(Boolean);
  if (segs.length === 0) return '';
  const file = segs.pop();
  return joinNotePath(segs.join('/'), file);
}

// Quita el bloque YAML inicial para la vista previa (el guardado escribe el markdown tal cual).
// [^\S\r\n]? admite un BOM inicial (en JS, \s incluye el BOM).
export function stripFrontmatter(raw) {
  return String(raw || '').replace(/^[^\S\r\n]?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
}
