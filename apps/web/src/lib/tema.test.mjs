import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCION, PALETA, PARES_CONTRASTE, alpha } from './tema.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Luminancia relativa y contraste de WCAG 2.x.
function luminancia(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}
function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

test('should_meet_wcag_contrast_in_every_text_and_background_pair', () => {
  // Arrange
  const fallan = [];

  // Act
  for (const { texto, fondo, minimo } of PARES_CONTRASTE) {
    const r = contraste(PALETA[texto], PALETA[fondo]);
    if (!(r >= minimo)) fallan.push(`${texto} sobre ${fondo}: ${r.toFixed(2)}:1 (mínimo ${minimo}:1)`);
  }

  // Assert
  assert.deepEqual(fallan, []);
});

test('should_measure_contrast_like_wcag', () => {
  assert.equal(contraste('#FFFFFF', '#000000').toFixed(0), '21');
  assert.equal(contraste(PALETA['--so-tinta'], '#FFFFFF').toFixed(1), '14.7', 'la tinta sobre blanco');
  assert.ok(contraste(PALETA['--so-accion'], '#FFFFFF') < 3, 'el verde no sirve de texto sobre blanco');
});

test('should_declare_in_index_css_the_same_tokens_as_the_palette', () => {
  // Arrange
  const css = readFileSync(path.join(SRC, 'index.css'), 'utf8');
  const raiz = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  // Act
  const declarados = Object.fromEntries(
    [...raiz.matchAll(/(--so-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toUpperCase()]),
  );

  // Assert
  assert.deepEqual(declarados, Object.fromEntries(Object.entries(PALETA).map(([k, v]) => [k, v.toUpperCase()])));
});

test('should_not_write_colors_by_hand_outside_tema_js', () => {
  // Arrange: un color escrito a mano en un componente no cambia con el tema ni pasa el test de contraste.
  const COLOR = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b|\brgba?\(/;
  const fuentes = archivos(SRC).filter((p) => /\.(js|jsx)$/.test(p) && !p.endsWith(`${path.sep}tema.js`));

  // Act
  const conColor = fuentes.flatMap((p) =>
    readFileSync(p, 'utf8')
      .split('\n')
      .map((l, i) => ({ l, i }))
      // Las rutas con almohadilla («#/licitaciones») y las anclas de página no son colores.
      .filter(({ l }) => COLOR.test(l.replace(/#\/|#page=/g, '')))
      .map(({ i }) => `${path.relative(SRC, p)}:${i + 1}`),
  );

  // Assert
  assert.deepEqual(conColor, []);
});

test('should_mix_transparency_into_a_css_variable', () => {
  assert.equal(alpha(ACCION, 0.14), 'color-mix(in srgb, var(--so-accion) 14%, transparent)');
  assert.equal(alpha('#1F2937', 0.5), 'color-mix(in srgb, #1F2937 50%, transparent)');
});

test('should_never_use_green_or_lavender_as_text_color', () => {
  // Arrange: el verde de los botones y el lavanda de Hermes no llegan al contraste como letra.
  const texto = /\bcolor:\s*[^,}\n]*\b(ACTION|ACCION|HERMES)\b(?!_)|\btext-(accion|hermes)\b/;

  // Act
  const fallan = archivos(path.join(SRC, 'componentes'))
    .filter((f) => f.endsWith('.jsx'))
    .flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => [f, i + 1, l])
        .filter(([, , l]) => texto.test(l)),
    )
    .map(([f, n]) => `${path.relative(SRC, f)}:${n}`);

  // Assert
  assert.deepEqual(fallan, []);
});
