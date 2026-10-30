// Conexión con Google Drive: OAuth con el cliente propio, selector de carpeta y drive.json para drive-sync.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';

type ErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'INVALID_STATE'
  | 'ACCESS_DENIED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'REVOKED'
  | 'GOOGLE_ERROR'
  | 'STORAGE_ERROR';
// El cliente OAuth es el propio de la instalación (GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET) y drive.json lo lee
// el servicio drive-sync del volumen compartido. Las funciones públicas devuelven { data, error } y nunca
// lanzan.
export type Result<T> = { data: T; error: null } | { data: null; error: { code: ErrorCode; message: string } };

interface RcloneToken {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expiry: string;
}
export interface Folder {
  id: string;
  name: string;
}
export interface DriveConfig {
  token: RcloneToken;
  account: string | null;
  folder: (Folder & { path: string }) | null;
  connectedAt: string;
}
export interface DriveStatus {
  configured: boolean;
  redirectUri: string;
  connected: boolean;
  account: string | null;
  folder: DriveConfig['folder'];
  sync: unknown;
  copia: CopiaDrive | null;
}

// Estado de la copia de seguridad que drive-sync deja en status.json (copia_json de sync.sh).
// Los campos que vienen de variables de entorno (hora, días, motivo) se toleran campo a
// campo: un valor raro no debe ocultar en el panel que la copia está desactivada ni por qué.
const CopiaSchema = z.object({
  activa: z.boolean(),
  motivo: z
    .string()
    .nullable()
    .catch(null)
    .transform((s) => s?.slice(0, 200) ?? null),
  hora: z.number().int().nullable().catch(null),
  conservarDias: z.number().int().nullable().catch(null),
  plataforma: z.enum(['diaria', 'semanal', 'no']),
  ultima: z.iso.datetime().nullable(),
  ultimaPlataforma: z.iso.datetime().nullable(),
});
type CopiaDrive = z.infer<typeof CopiaSchema>;

/** La copia de status.json validada; null si drive-sync aún no la escribe (versión antigua) o viene mal. */
function copiaDe(sync: unknown): CopiaDrive | null {
  const copia = sync && typeof sync === 'object' && 'copia' in sync ? sync.copia : undefined;
  const parsed = CopiaSchema.safeParse(copia);
  return parsed.success ? parsed.data : null;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const STATE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type GoogleBody = Record<string, unknown> & { error?: unknown };

const pendingStates = new Map<string, { redirectUri: string; sesion: string | null; expires: number }>();
let accessCache: { refreshToken: string; token: string; expires: number } | null = null;

// Se leen en cada llamada: el entorno manda y los tests pueden cambiarlo.
function settings() {
  const clientId = process.env.GDRIVE_CLIENT_ID || '';
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET || '';
  const stateDir = process.env.DRIVE_STATE_DIR || path.join(os.tmpdir(), 'hermes-drive-state');
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && clientSecret),
    configFile: path.join(stateDir, 'drive.json'),
    statusFile: path.join(stateDir, 'status.json'),
    stateDir,
  };
}

const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({ data: null, error: { code, message } });

export function redirectUriFor(req: IncomingMessage & { secure?: boolean }): string {
  // La dirección pública configurada manda: las cabeceras X-Forwarded-* las puede poner cualquiera.
  const publica = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (publica && /^https?:\/\//i.test(publica)) return `${publica}/api/drive/callback`;
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  };
  const proto = header('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const host = header('x-forwarded-host') || header('host') || '';
  return `${proto}://${host}/api/drive/callback`;
}

function isFolderId(id: unknown): id is string {
  return id === 'root' || (typeof id === 'string' && ID_RE.test(id));
}

function cleanFolderName(name: unknown, maxLength = 100): string {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  // eslint-disable-next-line no-control-regex
  return trimmed.length <= maxLength && !/[\u0000-\u001f]/.test(trimmed) ? trimmed : '';
}

function googleError(body: GoogleBody): string {
  const err = body.error;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return err ? String(err) : 'sin respuesta';
}

// rclone guarda el token con el formato de golang.org/x/oauth2.Token.
function toRcloneToken(resp: GoogleBody, now = Date.now()): RcloneToken {
  return {
    access_token: String(resp.access_token),
    token_type: typeof resp.token_type === 'string' ? resp.token_type : 'Bearer',
    refresh_token: String(resp.refresh_token),
    expiry: new Date(now + Number(resp.expires_in || 0) * 1000).toISOString(),
  };
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readConfig(): DriveConfig | null {
  return readJson<DriveConfig>(settings().configFile);
}

function writeConfig(cfg: DriveConfig): Result<DriveConfig> {
  const { stateDir, configFile } = settings();
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    // Escritura atómica: drive-sync nunca debe leer un drive.json a medias.
    const tmp = `${configFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
    fs.renameSync(tmp, configFile);
    return ok(cfg);
  } catch (err) {
    return fail('STORAGE_ERROR', `No se pudo guardar la conexión: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function httpJson(url: string, init: RequestInit = {}): Promise<{ res: Response | null; body: GoogleBody }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as GoogleBody;
    return { res, body };
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError';
    return { res: null, body: { error: timeout ? 'timeout' : err instanceof Error ? err.message : String(err) } };
  }
}

function postForm(url: string, params: Record<string, string>) {
  return httpJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

export function startAuth(redirectUri: string, sesion: string | null = null): Result<string> {
  const { configured, clientId } = settings();
  if (!configured) return fail('NOT_CONFIGURED', 'Faltan GDRIVE_CLIENT_ID y GDRIVE_CLIENT_SECRET');
  const now = Date.now();
  for (const [key, entry] of pendingStates) if (entry.expires < now) pendingStates.delete(key);
  const state = crypto.randomBytes(24).toString('base64url');
  pendingStates.set(state, { redirectUri, sesion, expires: now + STATE_TTL_MS });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent: Google solo entrega refresh_token si se fuerza el consentimiento.
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return ok(`${AUTH_URL}?${params}`);
}

async function accountEmail(accessToken: string): Promise<string | null> {
  const { res, body } = await httpJson(`${API}/about?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = body.user as { emailAddress?: string } | undefined;
  return res?.ok ? user?.emailAddress || null : null;
}

export async function finishAuth(
  query: { code?: string; state?: string; error?: string },
  sesion: string | null = null,
): Promise<Result<DriveConfig>> {
  const pending = query.state ? pendingStates.get(query.state) : undefined;
  if (query.state) pendingStates.delete(query.state);
  if (!pending || pending.expires < Date.now() || pending.sesion !== sesion)
    return fail('INVALID_STATE', 'La autorización caducó; vuelve a conectar');
  if (query.error) return fail('ACCESS_DENIED', 'No se concedió acceso a Drive');
  if (!query.code) return fail('INVALID_INPUT', 'Google no devolvió el código');

  const { clientId, clientSecret } = settings();
  const { res, body } = await postForm(TOKEN_URL, {
    code: query.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: pending.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!res?.ok || !body.access_token) return fail('GOOGLE_ERROR', `Google rechazó el código (${googleError(body)})`);
  if (!body.refresh_token) return fail('GOOGLE_ERROR', 'Google no entregó un token permanente; vuelve a conectar');

  const token = toRcloneToken(body);
  accessCache = { refreshToken: token.refresh_token, token: token.access_token, expires: Date.parse(token.expiry) };
  const account = await accountEmail(token.access_token);
  return writeConfig({ token, account, folder: null, connectedAt: new Date().toISOString() });
}

async function accessToken(cfg: DriveConfig): Promise<Result<string>> {
  const refreshToken = cfg.token.refresh_token;
  if (accessCache?.refreshToken === refreshToken && accessCache.expires > Date.now() + 60000) {
    return ok(accessCache.token);
  }
  const { clientId, clientSecret } = settings();
  const { res, body } = await postForm(TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (body.error === 'invalid_grant') return fail('REVOKED', 'Google retiró el permiso; vuelve a conectar Drive');
  if (!res?.ok || typeof body.access_token !== 'string')
    return fail('GOOGLE_ERROR', `No se pudo renovar el acceso (${googleError(body)})`);
  accessCache = { refreshToken, token: body.access_token, expires: Date.now() + Number(body.expires_in || 0) * 1000 };
  return ok(body.access_token);
}

interface ApiCall {
  method?: string;
  query?: Record<string, string>;
  json?: unknown;
}

async function driveApi(pathname: string, { method = 'GET', query, json }: ApiCall = {}): Promise<Result<GoogleBody>> {
  const cfg = readConfig();
  if (!settings().configured || !cfg?.token?.refresh_token) return fail('NOT_CONNECTED', 'Drive no está conectado');
  const token = await accessToken(cfg);
  if (token.error) return token;
  const url = `${API}${pathname}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token.data}` };
  if (json) headers['Content-Type'] = 'application/json';
  const { res, body } = await httpJson(url, { method, headers, body: json ? JSON.stringify(json) : undefined });
  if (res?.status === 404) return fail('NOT_FOUND', 'Esa carpeta ya no existe en Drive');
  if (!res?.ok) return fail('GOOGLE_ERROR', `Drive respondió con error (${googleError(body)})`);
  return ok(body);
}

export async function listFolders(parentId: unknown): Promise<Result<Folder[]>> {
  if (!isFolderId(parentId)) return fail('INVALID_INPUT', 'Carpeta no válida');
  const result = await driveApi('/files', {
    query: {
      q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: '200',
      spaces: 'drive',
    },
  });
  if (result.error) return result;
  const files = (result.data.files || []) as Folder[];
  return ok(files.map((f) => ({ id: f.id, name: f.name })));
}

export async function createFolder(parentId: unknown, rawName: unknown): Promise<Result<Folder>> {
  const name = cleanFolderName(rawName);
  if (!isFolderId(parentId) || !name) return fail('INVALID_INPUT', 'Nombre de carpeta no válido');
  const result = await driveApi('/files', {
    method: 'POST',
    query: { fields: 'id,name' },
    json: { name, mimeType: FOLDER_MIME, parents: [parentId] },
  });
  if (result.error) return result;
  return ok({ id: String(result.data.id), name: String(result.data.name) });
}

export interface DriveItem {
  id: string;
  name: string;
  folder: boolean;
}

const ItemSchema = z.object({ id: z.string().regex(ID_RE), name: z.string(), mimeType: z.string() });
const PageSchema = z.object({ files: z.array(ItemSchema).default([]), nextPageToken: z.string().optional() });
const MAX_PAGES = 50;
const toItem = (f: z.infer<typeof ItemSchema>): DriveItem => ({
  id: f.id,
  name: f.name,
  folder: f.mimeType === FOLDER_MIME,
});

/** Carpeta elegida (la raíz que sincroniza drive-sync) si Drive está conectado; null si no. */
export function connectedFolder(): Folder | null {
  const cfg = readConfig();
  if (!settings().configured || !cfg?.token?.refresh_token || !cfg.folder?.id || !isFolderId(cfg.folder.id))
    return null;
  return { id: cfg.folder.id, name: cfg.folder.name };
}

/**
 * ¿Tiene drive-sync al día el par `pair` (p. ej. «Conocimiento») con la carpeta elegida?
 * Lo dicen sus marcas en el volumen compartido: active-folder (la carpeta con la que creó su
 * estado) y bisync-ready-<par>, que quita cuando la siguiente vuelta debe unir ambos lados
 * con --resync. Un --resync une sin borrar: devolvería al sitio viejo lo que se mueva en Drive.
 */
export function syncReady(pair: string): boolean {
  const cfg = readConfig();
  const { stateDir } = settings();
  const slug = pair.replace(/[^A-Za-z0-9]/g, '_');
  try {
    const active = fs.readFileSync(path.join(stateDir, 'active-folder'), 'utf8').trim();
    return (
      Boolean(cfg?.folder?.id) &&
      active === cfg?.folder?.id &&
      fs.existsSync(path.join(stateDir, `bisync-ready-${slug}`))
    );
  } catch {
    return false;
  }
}

/** Cuándo terminó drive-sync su última vuelta (su marca last-round), o null si no hay ninguna. */
export function lastSyncRound(): Date | null {
  try {
    return fs.statSync(path.join(settings().stateDir, 'last-round')).mtime;
  } catch {
    return null;
  }
}

/** Carpetas y archivos (no en la papelera) dentro de una carpeta, todas las páginas. */
export async function listChildren(parentId: unknown): Promise<Result<DriveItem[]>> {
  if (!isFolderId(parentId)) return fail('INVALID_INPUT', 'Carpeta no válida');
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const result = await driveApi('/files', {
      query: {
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '1000',
        spaces: 'drive',
        ...(pageToken ? { pageToken } : {}),
      },
    });
    if (result.error) return result;
    const page = PageSchema.safeParse(result.data);
    if (!page.success) return fail('GOOGLE_ERROR', 'Drive devolvió un listado inesperado');
    items.push(...page.data.files.map(toItem));
    pageToken = page.data.nextPageToken;
    if (!pageToken) return ok(items);
  }
  return fail('GOOGLE_ERROR', 'La carpeta tiene demasiados elementos para listarla');
}

/**
 * Mueve un archivo o una carpeta (con todo lo que tenga dentro, Google Docs incluidos) de
 * una carpeta a otra y, si se indica, le cambia el nombre. Es files.update con
 * addParents/removeParents: el id no cambia y nada se copia ni se borra.
 */
export async function moveItem(id: unknown, from: unknown, to: unknown, newName?: unknown): Promise<Result<DriveItem>> {
  const name = newName === undefined ? null : cleanFolderName(newName, 200);
  if (![id, from, to].every(isFolderId) || id === 'root' || name === '')
    return fail('INVALID_INPUT', 'Movimiento no válido');
  const result = await driveApi(`/files/${String(id)}`, {
    method: 'PATCH',
    query: { addParents: String(to), removeParents: String(from), fields: 'id,name,mimeType' },
    json: name ? { name } : {},
  });
  if (result.error) return result;
  const item = ItemSchema.safeParse(result.data);
  return item.success
    ? ok(toItem(item.data))
    : fail('GOOGLE_ERROR', 'Drive devolvió una respuesta inesperada al mover');
}

export async function selectFolder(id: unknown, rawPath?: unknown): Promise<Result<DriveConfig>> {
  if (!isFolderId(id) || id === 'root') return fail('INVALID_INPUT', 'Elige una carpeta dentro de Mi unidad');
  const result = await driveApi(`/files/${id}`, { query: { fields: 'id,name,mimeType,trashed' } });
  if (result.error) return result;
  const file = result.data;
  if (file.mimeType !== FOLDER_MIME || file.trashed) return fail('INVALID_INPUT', 'Eso no es una carpeta de Drive');
  const cfg = readConfig();
  if (!cfg) return fail('NOT_CONNECTED', 'Drive no está conectado');
  // La ruta solo se muestra; drive-sync trabaja con el id, que no cambia al renombrar.
  const name = String(file.name);
  const displayPath = cleanFolderName(rawPath, 500) || name;
  return writeConfig({ ...cfg, folder: { id: String(file.id), name, path: displayPath } });
}

export async function disconnect(): Promise<Result<true>> {
  const cfg = readConfig();
  if (cfg?.token?.refresh_token) {
    // Mejor esfuerzo: aunque Google no conteste, la conexión local se borra igual.
    await postForm(REVOKE_URL, { token: cfg.token.refresh_token });
  }
  accessCache = null;
  try {
    fs.rmSync(settings().configFile, { force: true });
    return ok(true);
  } catch (err) {
    return fail('STORAGE_ERROR', `No se pudo borrar la conexión: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function getStatus(redirectUri: string): DriveStatus {
  const { configured, statusFile } = settings();
  const cfg = readConfig();
  const connected = Boolean(configured && cfg?.token?.refresh_token);
  const sync = connected ? readJson<unknown>(statusFile) : null;
  return {
    configured,
    redirectUri,
    connected,
    account: connected ? cfg?.account || null : null,
    folder: connected ? cfg?.folder || null : null,
    sync,
    copia: copiaDe(sync),
  };
}
