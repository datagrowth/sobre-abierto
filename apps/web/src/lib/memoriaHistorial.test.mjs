// Guardia del Historial de la memoria: las versiones antiguas reutilizan la CabeceraVersion, y el aviso
// «rehazla con el guion vigente (unas N h)» es solo para la versión actual. En Villaejemplo salía en
// las dos primeras versiones, ya descartadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CARPETA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'componentes',
  'Licitaciones',
  'Oferta',
  'Memoria',
);
const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre), 'utf8');
const bloque = (fuente, inicio) =>
  fuente.slice(fuente.indexOf(inicio), fuente.indexOf('\n}\n', fuente.indexOf(inicio)));

test('should_not_ask_to_redo_old_versions_in_the_history', () => {
  const historial = bloque(leer('Historial.jsx'), 'function Historial(');

  const cabeceras = [...historial.matchAll(/<CabeceraVersion\b[^>]*>/g)].map((m) => m[0]);

  assert.ok(cabeceras.length > 0, 'el Historial pinta la CabeceraVersion');
  assert.ok(
    cabeceras.every((c) => /\bhistorial\b/.test(c)),
    cabeceras.join(' | '),
  );
});

test('should_show_the_redo_warning_only_outside_the_history', () => {
  const cabecera = bloque(leer('CabeceraVersion.jsx'), 'function CabeceraVersion(');

  assert.match(cabecera, /guion_cambiado && !historial &&[^&]*?rehazla con el guion vigente/s);
});
