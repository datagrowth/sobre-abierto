import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisoMigracion, dentroDeDestino, resumenEnsayo, tamano } from './carpetaUnicaFormato.js';

test('should_print_sizes_with_spanish_decimals', () => {
  assert.equal(tamano(512), '512 B');
  assert.equal(tamano(3.4 * 1024 * 1024), '3,4 MB');
  assert.equal(tamano(null), '0 B');
});

test('should_summarise_the_dry_run_in_one_line', () => {
  assert.equal(
    resumenEnsayo({ licitaciones: 1, archivos: 1, bytes: 2048, filas: 1, avisos: 0 }),
    '1 licitación · 1 archivo (2 KB) · 1 fila guardada que cambiarían de ruta',
  );
  assert.match(
    resumenEnsayo({ licitaciones: 3, archivos: 41, bytes: 10, filas: 57, avisos: 2 }),
    /3 licitaciones · 41 archivos \(10 B\) · 57 filas guardadas .* · 2 avisos$/,
  );
  assert.match(resumenEnsayo({ licitaciones: 0 }), /Ninguna/);
});

test('should_show_the_path_inside_the_single_folder', () => {
  assert.equal(dentroDeDestino('L/O/X (p-1)', 'L/O/X (p-1)/Oferta/m.docx'), 'Oferta/m.docx');
  assert.equal(dentroDeDestino('L/O/X (p-1)', 'otra/cosa'), 'otra/cosa');
});

test('should_say_how_the_migration_went', () => {
  assert.equal(avisoMigracion({ estado: 'sin_lanzar' }).tono, 'info');
  assert.deepEqual(avisoMigracion({ estado: 'hecha', mensaje: '3 licitaciones en su carpeta única.' }), {
    tono: 'ok',
    texto: 'Migración hecha. 3 licitaciones en su carpeta única.',
  });
  assert.equal(avisoMigracion({ estado: 'error' }).tono, 'aviso');
  assert.match(avisoMigracion(null).texto, /Aún no/);
});
