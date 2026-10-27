// Conexión con Google Drive (OAuth y selector de carpeta) con las respuestas de Google simuladas.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as drive from '../../src/nucleo/driveGoogle.js';

const realFetch = globalThis.fetch;
type Route = [status: number, body: unknown];

// Respuestas de Google por URL (sin query); registra cada llamada.
function mockGoogle(routes: Record<string, Route>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const key = `${init.method || 'GET'} ${String(url).split('?')[0]}`;
    calls.push(key);
    const [status, body] = routes[key] ?? [500, { error: 'unexpected' }];
    return { ok: status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return calls;
}

const TOKEN_OK: Route = [200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer' }];
const ABOUT_OK: Route = [200, { user: { emailAddress: 'yo@example.com' } }];
const FOLDER = 'application/vnd.google-apps.folder';

let stateDir: string;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-test-'));
  process.env.DRIVE_STATE_DIR = stateDir;
  process.env.GDRIVE_CLIENT_ID = 'cid';
  process.env.GDRIVE_CLIENT_SECRET = 'csecret';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function stateOf(url: string | null): string {
  return new URL(url ?? '').searchParams.get('state') ?? '';
}

async function connect() {
  mockGoogle({
    'POST https://oauth2.googleapis.com/token': TOKEN_OK,
    'GET https://www.googleapis.com/drive/v3/about': ABOUT_OK,
  });
  return drive.finishAuth({
    code: 'c',
    state: stateOf(drive.startAuth('https://m.example.com/api/drive/callback').data),
  });
}

const readConfig = () => JSON.parse(fs.readFileSync(path.join(stateDir, 'drive.json'), 'utf8'));

test('should_return_not_configured_when_client_credentials_are_missing', () => {
  process.env.GDRIVE_CLIENT_ID = '';
  assert.equal(drive.startAuth('https://x/api/drive/callback').error?.code, 'NOT_CONFIGURED');
  assert.equal(drive.getStatus('u').configured, false);
});

test('should_request_offline_consent_with_drive_scope', () => {
  const url = new URL(drive.startAuth('https://m.example.com/api/drive/callback').data ?? '');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://m.example.com/api/drive/callback');
});

test('should_build_redirect_uri_from_forwarded_headers', () => {
  const req = { headers: { 'x-forwarded-proto': 'https,http', host: 'hermes.example.com' }, secure: false };
  assert.equal(drive.redirectUriFor(req as never), 'https://hermes.example.com/api/drive/callback');
});

test('should_prefer_the_configured_public_url_over_forwarded_headers', () => {
  const antes = process.env.APP_URL;
  process.env.APP_URL = 'https://publica.example.com/';
  try {
    const req = { headers: { 'x-forwarded-host': 'atacante.example.net', 'x-forwarded-proto': 'http' } };
    assert.equal(drive.redirectUriFor(req as never), 'https://publica.example.com/api/drive/callback');
  } finally {
    if (antes === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = antes;
  }
});

test('should_reject_a_callback_whose_state_was_started_by_another_session', async () => {
  const calls = mockGoogle({});
  const state = stateOf(drive.startAuth('https://m/api/drive/callback', 'sesion-a').data);
  const { error } = await drive.finishAuth({ code: 'c', state }, 'sesion-b');
  assert.equal(error?.code, 'INVALID_STATE');
  assert.equal(calls.length, 0);
});

test('should_reject_callback_when_state_is_unknown', async () => {
  const calls = mockGoogle({});
  const { error } = await drive.finishAuth({ code: 'c', state: 'forged' });
  assert.equal(error?.code, 'INVALID_STATE');
  assert.equal(calls.length, 0);
});

test('should_consume_state_when_user_denies_access', async () => {
  const state = stateOf(drive.startAuth('https://m/api/drive/callback').data);
  assert.equal((await drive.finishAuth({ error: 'access_denied', state })).error?.code, 'ACCESS_DENIED');
  assert.equal((await drive.finishAuth({ code: 'c', state })).error?.code, 'INVALID_STATE');
});

test('should_save_rclone_token_without_folder_when_authorization_succeeds', async () => {
  const { error } = await connect();
  assert.equal(error, null);
  const cfg = readConfig();
  assert.equal(cfg.token.refresh_token, 'rt');
  assert.ok(!Number.isNaN(Date.parse(cfg.token.expiry)));
  assert.equal(cfg.folder, null);
  const status = drive.getStatus('u');
  assert.equal(status.connected, true);
  assert.equal(status.account, 'yo@example.com');
});

test('should_not_save_anything_when_google_omits_refresh_token', async () => {
  mockGoogle({ 'POST https://oauth2.googleapis.com/token': [200, { access_token: 'at', expires_in: 3600 }] });
  const state = stateOf(drive.startAuth('https://m/api/drive/callback').data);
  assert.equal((await drive.finishAuth({ code: 'c', state })).error?.code, 'GOOGLE_ERROR');
  assert.equal(fs.existsSync(path.join(stateDir, 'drive.json')), false);
});

test('should_reject_malformed_folder_id_without_calling_google', async () => {
  await connect();
  const calls = mockGoogle({});
  assert.equal((await drive.listFolders("x' or '1'='1")).error?.code, 'INVALID_INPUT');
  assert.equal((await drive.createFolder('root', '   ')).error?.code, 'INVALID_INPUT');
  assert.equal((await drive.selectFolder('root')).error?.code, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('should_store_folder_id_when_selected_folder_exists', async () => {
  await connect();
  mockGoogle({
    'GET https://www.googleapis.com/drive/v3/files/f1': [
      200,
      { id: 'f1', name: 'Hermes', mimeType: FOLDER, trashed: false },
    ],
  });
  const { error } = await drive.selectFolder('f1', 'Trabajo/Hermes');
  assert.equal(error, null);
  assert.deepEqual(drive.getStatus('u').folder, { id: 'f1', name: 'Hermes', path: 'Trabajo/Hermes' });
});

test('should_ask_to_reconnect_when_refresh_token_was_revoked', async () => {
  await connect();
  // Otro refresh token: el acceso en memoria no vale y hay que renovar con Google.
  fs.writeFileSync(
    path.join(stateDir, 'drive.json'),
    JSON.stringify({ ...readConfig(), token: { ...readConfig().token, refresh_token: 'rt2' } }),
  );
  mockGoogle({ 'POST https://oauth2.googleapis.com/token': [400, { error: 'invalid_grant' }] });
  assert.equal((await drive.listFolders('root')).error?.code, 'REVOKED');
});

test('should_delete_connection_even_when_revoke_fails', async () => {
  await connect();
  mockGoogle({ 'POST https://oauth2.googleapis.com/revoke': [500, {}] });
  assert.equal((await drive.disconnect()).error, null);
  assert.equal(drive.getStatus('u').connected, false);
});

test('should_reject_malformed_moves_without_calling_google', async () => {
  await connect();
  const calls = mockGoogle({});
  assert.equal((await drive.moveItem("x' or '1'='1", 'a', 'b')).error?.code, 'INVALID_INPUT');
  assert.equal((await drive.moveItem('root', 'a', 'b')).error?.code, 'INVALID_INPUT');
  assert.equal((await drive.moveItem('f1', 'a', 'b', '   ')).error?.code, 'INVALID_INPUT');
  assert.equal((await drive.listChildren('../x')).error?.code, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('should_move_with_add_and_remove_parents_and_validate_the_answer', async () => {
  await connect();
  const calls = mockGoogle({
    'PATCH https://www.googleapis.com/drive/v3/files/f1': [200, { id: 'f1', name: 'Nuevo', mimeType: FOLDER }],
  });
  const r = await drive.moveItem('f1', 'viejo', 'nuevo', 'Nuevo');
  assert.deepEqual(r.data, { id: 'f1', name: 'Nuevo', folder: true });
  assert.ok(calls.includes('PATCH https://www.googleapis.com/drive/v3/files/f1'));
  mockGoogle({ 'PATCH https://www.googleapis.com/drive/v3/files/f1': [200, { raro: true }] });
  assert.equal(
    (await drive.moveItem('f1', 'viejo', 'nuevo')).error?.code,
    'GOOGLE_ERROR',
    'una respuesta sin forma no se da por buena',
  );
});

test('should_report_sync_ready_only_with_drive_sync_marks_for_the_chosen_folder', async () => {
  await connect();
  assert.equal(drive.connectedFolder(), null, 'sin carpeta elegida no hay raíz');
  fs.writeFileSync(
    path.join(stateDir, 'drive.json'),
    JSON.stringify({ ...readConfig(), folder: { id: 'f1', name: 'Hermes', path: 'Hermes' } }),
  );
  assert.deepEqual(drive.connectedFolder(), { id: 'f1', name: 'Hermes' });
  assert.equal(drive.syncReady('Conocimiento'), false);
  fs.writeFileSync(path.join(stateDir, 'active-folder'), 'otra\n');
  fs.writeFileSync(path.join(stateDir, 'bisync-ready-Conocimiento'), '');
  assert.equal(drive.syncReady('Conocimiento'), false, 'el estado de bisync es de otra carpeta');
  fs.writeFileSync(path.join(stateDir, 'active-folder'), 'f1\n');
  assert.equal(drive.syncReady('Conocimiento'), true);
  assert.equal(drive.syncReady('Agent Studio/skills'), false);
});

// status.json tal como lo escribe drive-sync (write_status + copia_json de sync.sh).
const escribirStatus = (copia: unknown) =>
  fs.writeFileSync(
    path.join(stateDir, 'status.json'),
    JSON.stringify({ at: '2026-10-03T02:00:00Z', failed: [], errors: {}, copia }),
  );
const COPIA_ACTIVA = {
  activa: true,
  motivo: null,
  hora: 4,
  conservarDias: 30,
  plataforma: 'semanal',
  ultima: '2026-10-03T02:01:00Z',
  ultimaPlataforma: '2026-09-28T02:01:00Z',
};

test('should_report_backup_state_from_drive_sync_status', async () => {
  await connect();
  escribirStatus(COPIA_ACTIVA);
  assert.deepEqual(drive.getStatus('u').copia, COPIA_ACTIVA);
});

test('should_report_backup_disabled_with_its_reason', async () => {
  await connect();
  const desactivada = {
    ...COPIA_ACTIVA,
    activa: false,
    motivo: 'GDRIVE_BACKUP_HOUR=99, fuera de 0-23',
    hora: 99,
    ultima: null,
    ultimaPlataforma: null,
  };
  escribirStatus(desactivada);
  assert.deepEqual(drive.getStatus('u').copia, desactivada);
});

test('should_keep_backup_state_when_hour_or_days_are_not_integers', async () => {
  await connect();
  const motivo = `GDRIVE_BACKUP_HOUR=${'9'.repeat(300)}, fuera de 0-23`;
  escribirStatus({ ...COPIA_ACTIVA, activa: false, motivo, hora: 4.5, conservarDias: 7.5 });
  const copia = drive.getStatus('u').copia;
  assert.equal(copia?.activa, false);
  assert.equal(copia?.hora, null);
  assert.equal(copia?.conservarDias, null);
  assert.equal(copia?.motivo, motivo.slice(0, 200));
});

test('should_return_null_backup_when_status_is_old_or_malformed', async () => {
  await connect();
  assert.equal(drive.getStatus('u').copia, null, 'sin status.json');
  fs.writeFileSync(
    path.join(stateDir, 'status.json'),
    JSON.stringify({ at: '2026-10-03T02:00:00Z', failed: [], errors: {} }),
  );
  assert.equal(drive.getStatus('u').copia, null, 'drive-sync anterior, sin copia');
  escribirStatus({ ...COPIA_ACTIVA, plataforma: 'mensual' });
  assert.equal(drive.getStatus('u').copia, null, 'modo desconocido');
  escribirStatus({ ...COPIA_ACTIVA, ultima: 'ayer' });
  assert.equal(drive.getStatus('u').copia, null, 'fecha no ISO');
});

test('should_hide_backup_state_when_drive_is_disconnected', () => {
  escribirStatus(COPIA_ACTIVA);
  assert.equal(drive.getStatus('u').copia, null);
});
