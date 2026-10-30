// Telemetría del tiempo de persona: POST /licitaciones/:id/telemetria por HTTP, la
// mediana por tipo de acción que recalibra los minutos de las comprobaciones y el resumen de la medición.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetria-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { MINUTOS_POR_ACCION } = await import('../../src/dominios/licitaciones/oferta/comprobacionesTipos.js');
const { medianasPorTipo, minutosMedidos, registrarTiempo, resumenTelemetria } =
  await import('../../src/dominios/licitaciones/oferta/telemetria.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { nucleo } = await import('../../src/nucleo/contexto.js');
type Bloqueo = import('../../src/dominios/licitaciones/oferta/comprobacionesTipos.js').Bloqueo;

iniciarNucleo();
const db = dbLicitaciones();
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const nueva = (): string => {
  const l = licitacion({ titulo: 'Formación en competencias digitales', publicada: '2026-09-01' });
  guardarLicitacion(db, l);
  return l.id;
};

const enviar = (id: string, cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  fetch(`${base}/api/licitaciones/licitaciones/${id}/telemetria`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabeceras },
    body: JSON.stringify(cuerpo),
  });

// Una fila de verdad de las comprobaciones de esa oferta: la telemetría no acepta claves inventadas.
function tareaDeComprobaciones(id: string): { clave: string; tipo: string; cerrada: boolean } {
  const b = comprobacionesDe(db, nucleo().db, id).data?.bloqueos[0];
  assert.ok(b, 'las comprobaciones de la prueba tiene alguna fila');
  return { clave: b.clave, tipo: b.accion.tipo, cerrada: false };
}

const PERSONA_A = '6f1c2b8e-4d3a-4f5e-9a7b-1c2d3e4f5a6b';

type Fila = Record<string, unknown>;
const filasDe = (id: string): Fila[] =>
  db.prepare('SELECT * FROM telemetria_tareas WHERE licitacion_id = ? ORDER BY id').all(id) as Fila[];

const fila = (tipo: Bloqueo['accion']['tipo'], actor: Bloqueo['actor'] = 'tu'): Bloqueo => ({
  clave: `x:${tipo}`,
  categoria: 'precio',
  lote: '1',
  gravedad: 'impide',
  titulo: 'Precio del lote 1 sin decidir',
  cita: null,
  actor,
  accion: { tipo },
  propuesta: null,
  minutos: MINUTOS_POR_ACCION[tipo],
  estado: 'abierto',
  huella: 'h',
});

// Una tarea cerrada de `minutos` en cada una de `n` ofertas nuevas.
function sembrarCerradas(tipo: string, n: number, minutos: (i: number) => number): void {
  for (let i = 0; i < n; i += 1) {
    registrarTiempo(db, nueva(), {
      clave: `t:${tipo}:${i}`,
      tipo,
      ms_foco: minutos(i) * 60_000,
      cerrada: true,
      persona: null,
    });
  }
}

test('should_store_focus_time_per_task_without_personal_data', async () => {
  // Arrange
  const id = nueva();
  const tarea = tareaDeComprobaciones(id);

  // Act: dos envíos de un minuto y el cierre, con clave de persona; uno con un correo y otro con
  // la parte local de un correo como persona.
  const r1 = await enviar(id, { ...tarea, ms_foco: 60_000 }, { 'X-Persona': PERSONA_A });
  await enviar(id, { ...tarea, ms_foco: 30_000 }, { 'X-Persona': PERSONA_A });
  await enviar(id, { ...tarea, ms_foco: 0, cerrada: true }, { 'X-Persona': PERSONA_A });
  await enviar(id, { ...tarea, ms_foco: 5_000 }, { 'X-Persona': 'alguien@empresa.es' });
  await enviar(id, { ...tarea, ms_foco: 5_000 }, { 'X-Persona': 'luis.prueba' });

  // Assert
  assert.equal(r1.status, 204);
  const filas = filasDe(id);
  assert.equal(filas.length, 2, 'las dos sin persona válida suman en la misma fila sin persona');
  assert.deepEqual(
    { ...filas[0], id: 0, creada_en: '' },
    {
      id: 0,
      licitacion_id: id,
      clave: tarea.clave,
      tipo: tarea.tipo,
      persona: PERSONA_A,
      ms_foco: 90_000,
      cerrada: 1,
      creada_en: '',
    },
  );
  assert.equal(filas[1]!['persona'], null);
  assert.equal(filas[1]!['ms_foco'], 10_000);
  assert.ok(!JSON.stringify(filas).includes('@'));
  assert.ok(!JSON.stringify(filas).includes('paco'));
  assert.deepEqual(
    resumenTelemetria(db).ofertas.find((o) => o.licitacion_id === id),
    {
      licitacion_id: id,
      minutos: 1.7,
      tipos: [{ tipo: tarea.tipo, minutos: 1.7, tareas: 1, cerradas: 1 }],
    },
  );
  const resumen = (await (await fetch(`${base}/api/licitaciones/telemetria/resumen`)).json()) as {
    ofertas: { licitacion_id: string }[];
  };
  assert.ok(resumen.ofertas.some((o) => o.licitacion_id === id));
});

test('should_reject_negative_or_huge_focus_time', async () => {
  // Arrange
  const id = nueva();
  const tarea = tareaDeComprobaciones(id);

  // Act
  const negativo = await enviar(id, { ...tarea, ms_foco: -1 });
  const enorme = await enviar(id, { ...tarea, ms_foco: 14_400_001 });
  const masDeDosLatidos = await enviar(id, { ...tarea, ms_foco: 120_001 });
  const conTexto = await enviar(id, { ...tarea, ms_foco: 1_000, titulo: 'Precio del lote 1' });
  const sinLicitacion = await enviar('p-noexiste', { ...tarea, ms_foco: 1_000 });

  // Assert
  assert.equal(negativo.status, 400);
  assert.equal(enorme.status, 400);
  assert.equal(masDeDosLatidos.status, 400, 'un envío es un latido de un minuto, no cuatro horas');
  assert.equal(conTexto.status, 400);
  assert.equal(sinLicitacion.status, 404);
  assert.deepEqual(filasDe(id), []);
});

test('should_reject_telemetry_for_an_unknown_task_or_action_type', async () => {
  // Arrange
  const id = nueva();
  const tarea = tareaDeComprobaciones(id);

  // Act
  const claveInventada = await enviar(id, { ...tarea, clave: 'x', ms_foco: 60_000 });
  const tipoInventado = await enviar(id, { ...tarea, tipo: 'abrir_cajon', ms_foco: 60_000 });

  // Assert
  assert.equal(claveInventada.status, 400);
  assert.match(((await claveInventada.json()) as { message: string }).message, /no está en las comprobaciones/);
  assert.equal(tipoInventado.status, 400);
  assert.deepEqual(filasDe(id), [], 'nada falsea las medianas de todo el equipo');
});

test('should_compute_median_minutes_per_action_type_only_after_10_offers', () => {
  // Arrange: 9 ofertas de revisar_memoria; luego la décima. Una abierta larga no cuenta.
  sembrarCerradas('revisar_memoria', 9, (i) => i + 1);
  registrarTiempo(db, nueva(), {
    clave: 'abierta',
    tipo: 'revisar_memoria',
    ms_foco: 120 * 60_000,
    cerrada: false,
    persona: null,
  });
  const antes = medianasPorTipo(db).get('revisar_memoria');

  // Act
  sembrarCerradas('revisar_memoria', 1, () => 10);
  const despues = medianasPorTipo(db).get('revisar_memoria');

  // Assert: 1..10 minutos → mediana 5,5.
  assert.equal(antes, undefined);
  assert.equal(despues, 5.5);
  assert.equal(minutosMedidos(fila('revisar_memoria'), medianasPorTipo(db)).minutos, 5.5);
  assert.equal(
    minutosMedidos(fila('revisar_memoria', 'fuera'), medianasPorTipo(db)).minutos,
    MINUTOS_POR_ACCION.revisar_memoria,
  );
});

test('should_keep_fixed_minutes_before_10_offers', () => {
  // Arrange: asignar_rol medido en 9 ofertas, con una tarea larga en cada una.
  sembrarCerradas('asignar_rol', 9, () => 30);

  // Act
  const b = minutosMedidos(fila('asignar_rol'), medianasPorTipo(db));

  // Assert
  assert.equal(b.minutos, MINUTOS_POR_ACCION.asignar_rol);
});
