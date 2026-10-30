// Versión de la web compilada: se extrae del index.html de Vite y el servidor rechaza escrituras de una web antigua con 409.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import express from 'express';
import { escucharLocal } from '../helpers/servidorLocal.js';
import {
  leerVersionWeb,
  versionWeb,
  exigirVersionWeb,
  rutaVersion,
  CABECERA_VERSION_WEB,
} from '../../src/nucleo/versionWeb.js';

const HTML_VITE =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-Ab12Cd.js"></script>' +
  '<link rel="stylesheet" crossorigin href="/assets/index-Zz9.css"></head><body><div id="root"></div></body></html>';

test('should_extract_entry_bundle_name_from_vite_index_html', () => {
  assert.equal(leerVersionWeb(HTML_VITE), 'index-Ab12Cd.js');
});

test('should_return_null_when_html_is_empty_malformed_or_dev_entry', () => {
  assert.equal(leerVersionWeb(''), null);
  assert.equal(leerVersionWeb('<script type="module" src='), null);
  assert.equal(leerVersionWeb('<script type="module" src="/src/main.jsx"></script>'), null);
});

test('should_read_version_from_dist_and_null_when_dist_is_missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dist-'));
  assert.deepEqual(versionWeb(dir), { data: null, error: null });
  writeFileSync(path.join(dir, 'index.html'), HTML_VITE);
  assert.deepEqual(versionWeb(dir), { data: 'index-Ab12Cd.js', error: null });
});

async function conApp<T>(actual: string | null, fn: (base: string, escrito: { v: boolean }) => Promise<T>): Promise<T> {
  const escrito = { v: false };
  const app = express();
  app.use('/api/version', rutaVersion(actual));
  app.use('/api', exigirVersionWeb(actual));
  app.get('/api/x', (_req, res) => {
    res.json({ ok: true });
  });
  app.post('/api/x', (_req, res) => {
    escrito.v = true;
    res.json({ ok: true });
  });
  const server = escucharLocal(http.createServer(app));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, escrito);
  } finally {
    server.close();
  }
}
const post = (base: string, version?: string) =>
  fetch(`${base}/api/x`, { method: 'POST', headers: version ? { [CABECERA_VERSION_WEB]: version } : {} });

test('should_reject_write_with_old_web_version_with_409_and_not_write', async () => {
  await conApp('index-A.js', async (base, escrito) => {
    const r = await post(base, 'index-B.js');
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { error: string }).error, 'version_antigua');
    assert.equal(escrito.v, false);
  });
});

test('should_let_reads_through_with_old_web_version', async () => {
  await conApp('index-A.js', async (base) => {
    const r = await fetch(`${base}/api/x`, { headers: { [CABECERA_VERSION_WEB]: 'index-B.js' } });
    assert.equal(r.status, 200);
  });
});

test('should_let_writes_without_version_header_through', async () => {
  await conApp('index-A.js', async (base, escrito) => {
    assert.equal((await post(base)).status, 200);
    assert.equal(escrito.v, true);
  });
});

test('should_let_writes_with_current_version_through', async () => {
  await conApp('index-A.js', async (base) => {
    assert.equal((await post(base, 'index-A.js')).status, 200);
  });
});

test('should_skip_check_when_server_has_no_version', async () => {
  await conApp(null, async (base) => {
    assert.equal((await post(base, 'index-B.js')).status, 200);
  });
});

test('should_return_current_version_from_get_api_version', async () => {
  await conApp('index-A.js', async (base) => {
    const r = await fetch(`${base}/api/version`);
    assert.deepEqual(await r.json(), { version: 'index-A.js' });
  });
});
