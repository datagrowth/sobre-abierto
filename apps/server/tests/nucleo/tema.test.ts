// Los tokens de color que valida el servidor son los de la web: la misma paleta neutra y los
// mismos pares de contraste que apps/web/src/lib/tema.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contraste, PALETA_NEUTRA, PARES_CONTRASTE, problemasDeContraste } from '../../src/nucleo/tema.js';

const THEME = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'src', 'lib', 'tema.js'),
  'utf8',
);

test('should_have_the_same_neutral_palette_as_the_web', () => {
  const paleta = /export const PALETA = \{([\s\S]*?)\};/.exec(THEME)?.[1] ?? '';
  const web = Object.fromEntries(
    [...paleta.matchAll(/'--so-([a-z0-9-]+)':\s*'(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]!.toUpperCase()]),
  );
  assert.deepEqual(web, PALETA_NEUTRA);
});

test('should_check_the_same_contrast_pairs_as_the_web', () => {
  const pares = /export const PARES_CONTRASTE = \[([\s\S]*?)\];/.exec(THEME)?.[1] ?? '';
  const web = [...pares.matchAll(/texto: '--so-([a-z0-9-]+)', fondo: '--so-([a-z0-9-]+)', minimo: ([\d.]+)/g)].map(
    (m) => ({ texto: m[1], fondo: m[2], minimo: Number(m[3]) }),
  );
  assert.deepEqual(web, PARES_CONTRASTE);
});

test('should_pass_the_neutral_palette_and_flag_a_theme_without_contrast', () => {
  assert.deepEqual(problemasDeContraste({}), []);
  assert.equal(contraste('#FFFFFF', '#000000').toFixed(0), '21');
  assert.deepEqual(problemasDeContraste({ accion: '#263B4A' }), ['«tinta» sobre «accion»: 1,26:1 (mínimo 4,5:1)']);
});
