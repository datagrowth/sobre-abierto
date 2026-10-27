// La plantilla de variables (.env.example, la de la instalación con Docker) tiene que nombrar
// exactamente las variables que lee su Compose, y sin comentar las obligatorias (las de «:?»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INSTALACIONES = [
  // El override de Caddy lee DOMINIO: tiene que estar en la plantilla aunque el Compose base no lo use.
  {
    nombre: 'instalacion',
    compose: ['docker-compose.yml'],
    plantilla: ['.env.example'],
    extras: [['deploy', 'docker-compose.caddy.yml']],
  },
];

for (const { nombre, compose: rutaCompose, plantilla: rutaPlantilla, extras } of INSTALACIONES) {
  const compose = [rutaCompose, ...extras].map((r) => fs.readFileSync(path.join(RAIZ, ...r), 'utf8')).join('\n');
  const plantilla = fs.readFileSync(path.join(RAIZ, ...rutaPlantilla), 'utf8');
  const archivo = rutaPlantilla.join('/');
  const delCompose = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!));
  const lineas = plantilla.split(/\r?\n/);
  const activas = new Set(lineas.map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter((v): v is string => Boolean(v)));
  const comentadas = new Set(
    lineas.map((l) => /^#\s*([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter((v): v is string => Boolean(v)),
  );
  const deLaPlantilla = new Set([...activas, ...comentadas]);

  test(`should_list_in_the_template_every_variable_the_compose_reads_${nombre}`, () => {
    assert.deepEqual([...delCompose].filter((v) => !deLaPlantilla.has(v)).sort(), [], `faltan en ${archivo}`);
  });

  // El compose declara cada variable una a una (sin env_file): una que lea la configuración del
  // servidor y no esté ahí no llega al proceso (LICITACIONES_DEUC_XML=1 en Dokploy no encendía nada).
  test(`should_pass_to_the_container_every_licitaciones_variable_the_server_config_reads_${nombre}`, () => {
    const config = fs.readFileSync(path.join(RAIZ, 'apps', 'server', 'src', 'nucleo', 'config.ts'), 'utf8');
    const leidas = [...config.matchAll(/^\s+(LICITACIONES_[A-Z0-9_]+):/gm)].map((m) => m[1]!);
    assert.ok(leidas.includes('LICITACIONES_DEUC_XML'));
    assert.deepEqual(
      leidas.filter((v) => !delCompose.has(v)),
      [],
      'faltan en el environment de hermes-monitor',
    );
  });

  test(`should_not_list_variables_the_compose_does_not_read_${nombre}`, () => {
    assert.deepEqual([...deLaPlantilla].filter((v) => !delCompose.has(v)).sort(), [], `sobran en ${archivo}`);
  });

  test(`should_leave_uncommented_the_variables_the_compose_requires_${nombre}`, () => {
    // DOMINIO solo lo exige el override de Caddy: en la plantilla va comentada (install.sh la rellena).
    const base = fs.readFileSync(path.join(RAIZ, ...rutaCompose), 'utf8');
    const obligatorias = [...base.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1]!);
    assert.ok(obligatorias.length > 0);
    assert.deepEqual(
      obligatorias.filter((v) => !activas.has(v)),
      [],
    );
  });

  test(`should_not_put_any_secret_value_in_the_template_${nombre}`, () => {
    const secretas = lineas.filter((l) => /^[A-Z0-9_]*(KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*=\S/.test(l));
    assert.deepEqual(secretas, []);
  });
}

// Las plantillas de Coolify y Easypanel son el Compose de la raíz con dos retoques: si alguien cambia el
// Compose y no regenera, el panel desplegaría una versión vieja.
test('should_keep_the_panel_templates_in_sync_with_the_root_compose', () => {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'deploy', 'generar.mjs'), '--comprobar'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
});
