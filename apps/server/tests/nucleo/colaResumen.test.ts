// La pastilla «Hermes»: lo que corre, espera y falla, separado por dominio, con
// un dominio «en pausa» si no tiene perfil y los zombis contados. La tabla se siembra a mano.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-resumen-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;
// Licitaciones con perfil (no se lanza nada: solo cuenta que lo tiene); un dominio «expedientes» sin el suyo.
process.env.HERMES_LICITACIONES_URL = 'http://127.0.0.1:9';
process.env.HERMES_LICITACIONES_KEY = 'clave-de-hermes-de-prueba';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { registrarTrabajos } = await import('../../src/dominios/licitaciones/index.js');
const { registrarTipoTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { MARCA_PAUSA_LIMITE, ponerMarca, quitarMarca } = await import('../../src/nucleo/colaMarcas.js');
const { resumenPorDominio } = await import('../../src/nucleo/colaResumen.js');
const { rutasPlataforma } = await import('../../src/nucleo/rutas.js');

const { db } = iniciarNucleo();
registrarTrabajos();
registrarTipoTrabajo('expedientes.ficha', { destino: () => null, instrucciones: () => 'haz', hecho: () => true });
registrarTipoTrabajo('colaboradores.perfil_cv', {
  destino: () => ({ url: 'http://127.0.0.1:9', key: 'k' }),
  instrucciones: () => 'haz',
  hecho: () => true,
});
guardarLicitacion(dbLicitaciones(), {
  ...licitacion({ titulo: 'Memoria técnica de Villaejemplo', publicada: '2026-09-20' }),
  id: 'p-casoC',
  atom_id: 'atom-casoC',
});

const HORA = 3_600_000;
const AHORA = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

type Fila = {
  tipo: string;
  dominio: string;
  estado: string;
  id?: string;
  creado?: number;
  actualizado?: number;
  lanzado?: number;
};
let n = 0;
function sembrar(f: Fila): void {
  n += 1;
  db.prepare(
    `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, lanzado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.tipo,
    f.dominio,
    `clave-${n}`,
    JSON.stringify(f.id ? { id: f.id } : { lote: n }),
    f.estado,
    iso(f.creado ?? AHORA - HORA),
    iso(f.actualizado ?? AHORA - HORA),
    f.lanzado === undefined ? null : iso(f.lanzado),
  );
}

const delDominio = (dominio: string) => resumenPorDominio(db, AHORA).dominios.find((d) => d.dominio === dominio);

let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.use('/api/plataforma', rutasPlataforma());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  db.prepare('DELETE FROM trabajos_ia').run();
  quitarMarca(db, MARCA_PAUSA_LIMITE);
});

test('should_summarise_running_queued_and_failed_jobs_by_domain', () => {
  sembrar({
    tipo: 'licitaciones.memoria_apartado',
    dominio: 'licitaciones',
    estado: 'lanzado',
    id: 'p-casoC',
    lanzado: AHORA - 600_000,
  });
  sembrar({ tipo: 'licitaciones.guion', dominio: 'licitaciones', estado: 'pendiente', id: 'p-casoC' });
  sembrar({ tipo: 'licitaciones.ficha', dominio: 'licitaciones', estado: 'pendiente', id: 'p-otra' });
  sembrar({
    tipo: 'licitaciones.ficha',
    dominio: 'licitaciones',
    estado: 'fallido',
    id: 'p-otra',
    actualizado: AHORA - 2 * HORA,
  });
  sembrar({
    tipo: 'licitaciones.ficha',
    dominio: 'licitaciones',
    estado: 'fallido',
    id: 'p-vieja',
    actualizado: AHORA - 30 * HORA,
  });
  sembrar({ tipo: 'licitaciones.ficha', dominio: 'licitaciones', estado: 'completado', id: 'p-hecha' });

  const r = resumenPorDominio(db, AHORA);

  assert.deepEqual(
    r.dominios.map((d) => d.dominio),
    ['licitaciones'],
    'sin dominios sin nada que contar',
  );
  const l = r.dominios[0]!;
  assert.deepEqual(
    { en_cola: l.en_cola, fallos: l.fallos_24h, zombis: l.zombis, pausa: l.en_pausa, motivo: l.motivo_pausa },
    { en_cola: 2, fallos: 1, zombis: 0, pausa: false, motivo: null },
    'el fallo de hace 30 h no cuenta',
  );
  assert.equal(l.en_marcha.length, 1);
});

test('should_mark_a_domain_as_paused_when_it_has_no_hermes_profile', () => {
  sembrar({ tipo: 'licitaciones.guion', dominio: 'licitaciones', estado: 'pendiente', id: 'p-casoC' });
  sembrar({ tipo: 'expedientes.ficha', dominio: 'expedientes', estado: 'pendiente', id: 'exp-1' });

  assert.deepEqual(
    { ...delDominio('expedientes'), en_marcha: undefined },
    {
      dominio: 'expedientes',
      en_marcha: undefined,
      en_cola: 1,
      fallos_24h: 0,
      zombis: 0,
      en_pausa: true,
      motivo_pausa: 'sin_perfil',
    },
  );
  assert.equal(
    delDominio('licitaciones')?.en_pausa,
    false,
    'Licitaciones sigue: no la arrastra la pausa del otro dominio',
  );
});

test('should_mark_every_domain_with_hermes_as_paused_while_the_usage_limit_lasts', () => {
  sembrar({ tipo: 'licitaciones.guion', dominio: 'licitaciones', estado: 'pendiente', id: 'p-casoC' });
  ponerMarca(db, MARCA_PAUSA_LIMITE, iso(AHORA + HORA));

  assert.deepEqual([delDominio('licitaciones')?.en_pausa, delDominio('licitaciones')?.motivo_pausa], [true, 'limite']);
});

test('should_count_pending_jobs_never_launched_for_48_hours_as_zombies', () => {
  sembrar({
    tipo: 'expedientes.ficha',
    dominio: 'expedientes',
    estado: 'pendiente',
    id: 'exp-1',
    creado: AHORA - 50 * HORA,
    actualizado: AHORA - 50 * HORA,
  });
  sembrar({
    tipo: 'expedientes.ficha',
    dominio: 'expedientes',
    estado: 'pendiente',
    id: 'exp-2',
    creado: AHORA - 72 * HORA,
    actualizado: AHORA - 72 * HORA,
  });
  sembrar({
    tipo: 'expedientes.ficha',
    dominio: 'expedientes',
    estado: 'pendiente',
    id: 'exp-3',
    creado: AHORA - 10 * HORA,
  });
  // Ya salió una vez y espera su reintento: no es un zombi aunque sea viejo.
  sembrar({
    tipo: 'expedientes.ficha',
    dominio: 'expedientes',
    estado: 'pendiente',
    id: 'exp-4',
    creado: AHORA - 60 * HORA,
    lanzado: AHORA - 59 * HORA,
  });
  // Relanzado a mano hace una hora (o con el reloj reiniciado por un freno): como en cancelarZombis, no lo es.
  sembrar({
    tipo: 'expedientes.ficha',
    dominio: 'expedientes',
    estado: 'pendiente',
    id: 'exp-5',
    creado: AHORA - 80 * HORA,
    actualizado: AHORA - HORA,
  });

  assert.equal(delDominio('expedientes')?.zombis, 2);
  assert.equal(delDominio('expedientes')?.en_cola, 5);
});

test('should_name_a_running_job_with_its_payload_like_hermes_en_vivo', () => {
  db.prepare(
    `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, lanzado_en) VALUES (?, ?, ?, ?, 'lanzado', ?, ?, ?)`,
  ).run(
    'licitaciones.memoria_apartado',
    'licitaciones',
    'clave-apartado-3',
    JSON.stringify({ id: 'p-casoC', apartado: 3 }),
    iso(AHORA - HORA),
    iso(AHORA - HORA),
    iso(AHORA - 60_000),
  );

  const enMarcha = delDominio('licitaciones')?.en_marcha;

  assert.deepEqual(
    enMarcha?.map((e) => e.nombre),
    ['Memoria: apartado 3'],
  );
});

test('should_name_the_tender_of_a_running_job', async () => {
  sembrar({
    tipo: 'licitaciones.memoria_apartado',
    dominio: 'licitaciones',
    estado: 'lanzado',
    id: 'p-casoC',
    lanzado: AHORA - 600_000,
  });
  sembrar({ tipo: 'licitaciones.cribar', dominio: 'licitaciones', estado: 'lanzado', lanzado: AHORA - 300_000 });
  sembrar({
    tipo: 'colaboradores.perfil_cv',
    dominio: 'colaboradores',
    estado: 'lanzado',
    id: 'persona-1',
    lanzado: AHORA - 300_000,
  });

  const r = await fetch(`${base}/api/plataforma/cola/resumen`);

  assert.equal(r.status, 200);
  const { dominios } = (await r.json()) as { dominios: { dominio: string; en_marcha: unknown[] }[] };
  const por = Object.fromEntries(dominios.map((d) => [d.dominio, d.en_marcha]));
  assert.deepEqual(por['licitaciones'], [
    {
      tipo: 'licitaciones.memoria_apartado',
      nombre: 'Memoria: apartados',
      recurso: 'p-casoC',
      titulo: 'Memoria técnica de Villaejemplo',
    },
    { tipo: 'licitaciones.cribar', nombre: 'Criba', recurso: null, titulo: null },
  ]);
  assert.deepEqual(
    por['colaboradores'],
    [{ tipo: 'colaboradores.perfil_cv', nombre: 'colaboradores.perfil_cv', recurso: null, titulo: null }],
    'de quién es un CV no sale',
  );
});
