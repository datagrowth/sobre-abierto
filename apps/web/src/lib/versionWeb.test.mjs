import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esVersionNueva, versionPropia } from './versionWeb.js';

const doc = (src) => ({ querySelector: () => (src ? { getAttribute: () => src } : null) });

test('should_flag_new_version_when_server_hash_differs', () => {
  assert.equal(esVersionNueva('index-aaa.js', 'index-bbb.js'), true);
});

test('should_not_flag_when_either_is_missing', () => {
  assert.equal(esVersionNueva(null, 'index-bbb.js'), false);
  assert.equal(esVersionNueva('index-aaa.js', null), false);
  assert.equal(esVersionNueva('index-aaa.js', ''), false);
});

test('should_not_flag_when_equal', () => {
  assert.equal(esVersionNueva('index-aaa.js', 'index-aaa.js'), false);
});

test('should_read_own_entry_from_module_script', () => {
  assert.equal(versionPropia(doc('/assets/index-Ab12.js')), 'index-Ab12.js');
  assert.equal(versionPropia(doc(null)), null);
  assert.equal(versionPropia(null), null);
});

import { cabeceraVersion, esVersionAntigua, comprobarVersion, EVENTO_VERSION_NUEVA } from './versionWeb.js';

test('should_build_version_header_from_entry_bundle', () => {
  assert.deepEqual(cabeceraVersion(doc('/assets/index-Ab12.js')), { 'X-Web-Version': 'index-Ab12.js' });
});

test('should_send_no_version_header_in_dev', () => {
  assert.deepEqual(cabeceraVersion(doc(null)), {});
});

test('should_detect_version_antigua_only_on_409_with_that_code', () => {
  assert.equal(esVersionAntigua(409, { error: 'version_antigua' }), true);
  assert.equal(esVersionAntigua(409, { error: 'conflict' }), false);
  assert.equal(esVersionAntigua(400, { error: 'version_antigua' }), false);
  assert.equal(esVersionAntigua(409, null), false);
});

test('should_warn_when_api_version_differs', async () => {
  const eventos = [];
  globalThis.window = { dispatchEvent: (e) => eventos.push(e.type) };
  globalThis.document = doc('/assets/index-aaa.js');
  const fetchFalso = async () => ({ ok: true, json: async () => ({ version: 'index-bbb.js' }) });
  const r = await comprobarVersion(fetchFalso);
  delete globalThis.window;
  delete globalThis.document;
  assert.equal(r.error, null);
  assert.deepEqual(eventos, [EVENTO_VERSION_NUEVA]);
});

test('should_return_error_not_throw_when_version_check_fails', async () => {
  const r = await comprobarVersion(async () => {
    throw new Error('red');
  });
  assert.equal(r.data, null);
  assert.equal(r.error.message, 'red');
});
