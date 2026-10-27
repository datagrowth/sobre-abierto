// Cliente de la Biblioteca de Conocimiento. Las rutas bajo /hermes-vault/api/v1 son las del
// motor de la bóveda (apps/server/src/vault), que atiende el mismo proceso tras el login; el
// resto son las del núcleo y de Licitaciones: documentos sin nota, «Pedir nota», uso de cada
// nota y huecos (salen de los pliegos).
import { json, request } from './apiCliente.js';

const PREFIJO_MOTOR = '/hermes-vault/api/v1';
const pedir = (ruta, init) => request(`${PREFIJO_MOTOR}${ruta}`, init);
const jsonPost = (cuerpo) => json('POST', cuerpo);

function encodeNotePath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

const motor = {
  health: () => pedir('/health'),
  config: () => pedir('/config'),

  vault: {
    stats: () => pedir('/vault/stats'),
    recent: (limit = 10) => pedir(`/vault/recent?limit=${limit}`),
    notes: () => pedir('/vault/notes'),
    folders: () => pedir('/vault/folders'),
  },

  notes: {
    get: (relPath) => pedir(`/notes/${encodeNotePath(relPath)}`),
    // Enlaces [[…]] resueltos: { path, outgoing: [{ target, heading, path|null, title }], incoming: [{ path, title }] }.
    links: (relPath) => pedir(`/notes/${encodeNotePath(relPath)}/links`),
    // Edición (solo en modo local; en modo servidor el motor responde read_only).
    // raw → { path, content, hash }. save con baseHash: si el archivo cambió en disco desde
    // entonces, el motor responde 409 'conflict' y no escribe nada; sin baseHash sobrescribe.
    raw: (relPath) => pedir(`/notes/${encodeNotePath(relPath)}/raw`),
    save: (relPath, content, baseHash) =>
      pedir(
        `/notes/${encodeNotePath(relPath)}`,
        json('PUT', baseHash ? { content, base_hash: baseHash } : { content }),
      ),
    create: (relPath, content = '') => pedir('/notes', jsonPost({ path: relPath, content })),
    // → { from, to, links_updated: [rutas de otras notas cuyos [[enlaces]] se reescribieron] }
    rename: (relPath, to, { updateLinks = true } = {}) =>
      pedir(`/notes/${encodeNotePath(relPath)}/rename`, jsonPost({ to, update_links: updateLinks })),
    remove: (relPath) => pedir(`/notes/${encodeNotePath(relPath)}`, { method: 'DELETE' }),
  },

  inbox: {
    list: () => pedir('/inbox'),
    approve: (fileName) => pedir(`/inbox/${encodeURIComponent(fileName)}/approve`, { method: 'POST' }),
    reject: (fileName) => pedir(`/inbox/${encodeURIComponent(fileName)}/reject`, { method: 'POST' }),
    // «Editar antes» de aprobar: { title, body, frontmatter } y se guarda con { title, body }.
    get: (fileName) => pedir(`/inbox/${encodeURIComponent(fileName)}`),
    edit: (fileName, cambio) => pedir(`/inbox/${encodeURIComponent(fileName)}`, json('PUT', cambio)),
  },

  search: (q, limit = 20) => pedir(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  documents: {
    status: () => pedir('/documents/status'),
    rawUrl: (relPath) => `${PREFIJO_MOTOR}/files/raw?path=${encodeURIComponent(relPath)}`,
  },

  settings: {
    get: () => pedir('/settings'),
    check: (vaultPath) => pedir('/settings/check', jsonPost({ path: vaultPath })),
    saveVault: (vaultPath) => pedir('/settings/vault', jsonPost({ path: vaultPath })),
    createVault: (vaultPath) => pedir('/settings/vault/create', jsonPost({ path: vaultPath })),
    clearVault: () => pedir('/settings/vault', { method: 'DELETE' }),
  },
};

export const bibliotecaApi = {
  ...motor,
  sinNota: () => request('/api/plataforma/biblioteca/sin-nota'),
  usos: () => request('/api/plataforma/biblioteca/usos'),
  // { rutas: [...] } (uno o en bloque) o { tema } (el borrador de un hueco).
  pedirNota: (pedido) => request('/api/plataforma/biblioteca/pedir-nota', json('POST', pedido)),
  huecos: () => request('/api/licitaciones/biblioteca/huecos'),
};
