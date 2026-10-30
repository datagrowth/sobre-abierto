import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisarLicencias } from './licencias.mjs';

const lock = (packages) => ({ packages: { '': { name: 'raiz' }, ...packages } });

test('should_accept_permissive_and_weak_copyleft_licenses', () => {
  const r = revisarLicencias(
    lock({
      'node_modules/express': { license: 'MIT' },
      'node_modules/@resvg/resvg-js': { license: 'MPL-2.0' },
      'node_modules/@img/sharp-libvips-linux-x64': { license: 'LGPL-3.0-or-later' },
      'node_modules/jszip': { license: '(MIT OR GPL-3.0-or-later)' },
      'node_modules/g': { license: 'GPL-2.0-or-later' },
      'node_modules/h': { license: 'LGPL-2.1' },
      'node_modules/i': { license: '(GPL-2.0 OR MIT)' },
    }),
  );
  assert.deepEqual(r, []);
});

test('should_fail_when_gpl_2_0_only_has_no_compatible_alternative', () => {
  const r = revisarLicencias(
    lock({
      'node_modules/a': { license: 'GPL-2.0-only' },
      'node_modules/b': { license: 'GPL-2.0' },
      'node_modules/c': { license: '(GPL-2.0-only OR SSPL-1.0)' },
    }),
  );
  assert.deepEqual(r, ['a: GPL-2.0-only', 'b: GPL-2.0', 'c: (GPL-2.0-only OR SSPL-1.0)']);
});

test('should_fail_when_a_dependency_is_not_open_source', () => {
  const r = revisarLicencias(
    lock({
      'node_modules/a': { license: 'SSPL-1.0' },
      'node_modules/b': { license: 'BUSL-1.1' },
      'node_modules/c': { license: 'MIT AND Commons Clause' },
      'node_modules/d': { license: 'CC-BY-NC-4.0' },
      'node_modules/e/node_modules/f': { license: 'UNLICENSED' },
    }),
  );
  assert.deepEqual(r, ['a: SSPL-1.0', 'b: BUSL-1.1', 'c: MIT AND Commons Clause', 'd: CC-BY-NC-4.0', 'f: UNLICENSED']);
});

test('should_read_installed_package_when_lockfile_has_no_license', () => {
  const r = revisarLicencias(lock({ 'node_modules/busboy': {}, 'node_modules/raro': {} }), (ruta) =>
    ruta === 'node_modules/busboy' ? 'MIT' : null,
  );
  assert.deepEqual(r, ['raro: sin licencia declarada']);
});

test('should_skip_workspaces_and_links', () => {
  const r = revisarLicencias(
    lock({ 'apps/web': {}, 'node_modules/@sobre-abierto/web': { link: true, resolved: 'apps/web' } }),
  );
  assert.deepEqual(r, []);
});
