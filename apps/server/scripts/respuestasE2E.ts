// Datos del banco Playwright de la web: guarda en apps/web/e2e/datos/<oferta>.json las respuestas GET de cada oferta.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errorMessage, fail, ok, type Result } from '../src/nucleo/result.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Siembra cada oferta de los fixtures de las comprobaciones (sintéticos) en una base temporal, pide sus GET a las
// rutas de siempre con el reloj en la hora de la captura y escribe un mapa «GET ruta» → { status, body }, más
// `_ahora` (esa hora). La web en e2e responde desde ahí: lo que ve es lo que daría el servidor, sin arrancarlo y
// sin tocar producción. Se regenera con: npm run e2e:datos -w @sobre-abierto/server
export const DIR_DATOS = path.resolve(AQUI, '..', '..', 'web', 'e2e', 'datos');

export type Respuesta = { status: number; body: unknown };
export type MapaRespuestas = Record<string, Respuesta>;
export type Hallazgo = { archivo: string; ruta: string; tipo: 'NIF' | 'correo' | 'teléfono' };

// Lo que piden la ficha, las comprobaciones y los pasos de la oferta de una licitación.
const RUTAS_OFERTA = [
  '',
  '/oferta',
  '/oferta/documentos',
  '/oferta/hoja-datos',
  '/oferta/decisiones',
  '/oferta/decisiones/historial',
  '/oferta/hermes',
  '/oferta/memoria',
  '/propuesta',
  '/equipo',
  '/comprobaciones',
  '/precios',
  '/indices',
  '/antecedentes',
  '/oferta/preguntas',
  '/oferta/hilo',
  '/oferta/generar',
  '/oferta/sobres',
  '/oferta/comparaciones',
  '/preguntas',
] as const;

// Lo que pide la web al abrir Hoy y la barra lateral, calculado con las 5 ofertas sembradas.
const RUTAS_GLOBALES = [
  '/api/licitaciones/mesa',
  '/api/licitaciones/oportunidades',
  '/api/licitaciones/estado',
  '/api/licitaciones/pipeline',
  '/api/licitaciones/revision',
  '/api/licitaciones/filtros',
  '/api/licitaciones/cobertura',
  '/api/licitaciones/calidad',
  '/api/licitaciones/mercado/panorama',
  '/api/licitaciones/mercado/vencimientos',
  '/api/licitaciones/carpeta-unica/ensayo',
  '/api/licitaciones/carpeta-unica/migracion',
  '/api/licitaciones/aprendizaje',
  '/api/plataforma/hoy',
  '/api/plataforma/empresa',
  '/api/plataforma/programado',
  '/api/plataforma/cola/resumen',
] as const;

type Fixture = { id: string; ahora: string; decisiones: { datos: { lotes?: unknown } } | null };
type CasoImpacto = { oferta: string; caso: string; cuerpo: (f: Fixture) => unknown };

const lotesDecididos = (f: Fixture): string[] =>
  Array.isArray(f.decisiones?.datos.lotes) ? f.decisiones.datos.lotes.map(String) : [];

// Los dos cambios tardíos sobre CASO_E: el precio del lote 2 y quitar el lote 6.
const CASOS_IMPACTO: readonly CasoImpacto[] = [
  { oferta: 'casoE', caso: 'precio-lote-2', cuerpo: () => ({ cambio: { decisiones: { precio: { lote: '2' } } } }) },
  {
    oferta: 'casoE',
    caso: 'quitar-lote-6',
    cuerpo: (f) => ({ cambio: { lotes: lotesDecididos(f).filter((l) => l !== '6') } }),
  },
];

// ── Datos personales: el script no escribe nada si los encuentra ──

// NIF de persona (DNI y NIE). Los CIF de órganos y empresas (letra delante) son públicos y la web los enseña.
const PATRONES: readonly { tipo: Hallazgo['tipo']; re: RegExp }[] = [
  { tipo: 'NIF', re: /(?<![\w])(?:\d{8}|[XYZ]\d{7})[A-HJ-NP-TV-Z](?![\w])/g },
  { tipo: 'correo', re: /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g },
  {
    tipo: 'teléfono',
    re: /(?<![\w.,/:-])(?:\+34[\s-]?)?[6789]\d{2}(?:[\s-]?\d{3}[\s-]?\d{3}|(?:[\s-]?\d{2}){3})(?![\w.,/:-])/g,
  },
];

// El NIF de ejemplo de siempre: es el que puso la seudonimización al representante.
const NIF_FICTICIOS: ReadonlySet<string> = new Set(['12345678Z']);

/** Qué tipos de dato personal aparecen en un texto (sin devolver el dato, que no debe ir al log). */
export function datosPersonalesEn(texto: string): Hallazgo['tipo'][] {
  const tipos = new Set<Hallazgo['tipo']>();
  for (const { tipo, re } of PATRONES) {
    const encontrados = [...texto.matchAll(re)].map((m) => m[0]);
    if (encontrados.some((v) => !(tipo === 'NIF' && NIF_FICTICIOS.has(v)))) tipos.add(tipo);
  }
  return [...tipos];
}

function hallazgosDe(mapas: Record<string, unknown>): Hallazgo[] {
  return Object.entries(mapas).flatMap(([archivo, mapa]) =>
    Object.entries(mapa as Record<string, unknown>).flatMap(([ruta, r]) =>
      datosPersonalesEn(JSON.stringify(r)).map((tipo) => ({ archivo, ruta, tipo })),
    ),
  );
}

/**
 * Escribe un JSON por archivo (`casoE` → casoE.json). Comprueba todo antes: si alguno lleva un NIF, un
 * correo o un teléfono no escribe ninguno y devuelve dónde están.
 */
export function escribirMapas(dir: string, mapas: Record<string, unknown>): Result<string[]> {
  const hallazgos = hallazgosDe(mapas);
  if (hallazgos.length) {
    const donde = hallazgos.map((h) => `${h.archivo} ${h.ruta}: ${h.tipo}`).join('; ');
    return fail('datos_personales', `Las respuestas llevan datos personales y no se escribe nada: ${donde}`);
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    return ok(
      Object.entries(mapas).map(([nombre, mapa]) => {
        const destino = path.join(dir, `${nombre}.json`);
        fs.writeFileSync(destino, `${JSON.stringify(mapa, null, 2)}\n`);
        return destino;
      }),
    );
  } catch (e) {
    return fail('escritura', errorMessage(e));
  }
}

// ── Respuestas del servidor sobre la base temporal ──

type Peticion = (metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown) => Promise<Respuesta>;

// GET /comprobaciones y compañía calculan con la hora del reloj: se fija a la de la captura.
async function conReloj<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
  }
}

async function pedirTodas(pedir: Peticion, rutas: readonly string[]): Promise<MapaRespuestas> {
  const mapa: MapaRespuestas = {};
  for (const ruta of rutas) mapa[`GET ${ruta}`] = await pedir('GET', ruta);
  return mapa;
}

async function impactosDe(pedir: Peticion, oferta: string, f: Fixture): Promise<Record<string, Respuesta>> {
  const salida: Record<string, Respuesta> = {};
  for (const c of CASOS_IMPACTO.filter((x) => x.oferta === oferta)) {
    salida[`${oferta}.impacto.${c.caso}`] = await pedir(
      'POST',
      `/api/licitaciones/licitaciones/${f.id}/oferta/impacto`,
      c.cuerpo(f),
    );
  }
  return salida;
}

// Los apartados de Hoy los registran iniciarLicitaciones e iniciarPlataforma, que además arrancan
// colas y temporizadores: aquí solo se registran los de las ofertas, la empresa y el equipo.
async function registrarHoy(): Promise<void> {
  const { registrarHoy: registrar } = await import('../src/nucleo/hoy.js');
  const { hoyEmpresa, hoyEquipo } = await import('../src/nucleo/hoyNucleo.js');
  const { nucleo } = await import('../src/nucleo/contexto.js');
  const { hoyLicitaciones } = await import('../src/dominios/licitaciones/hoy.js');
  const { dbLicitaciones } = await import('../src/dominios/licitaciones/db.js');
  registrar('licitaciones', (desde) => hoyLicitaciones(dbLicitaciones(), desde));
  registrar('empresa', () => hoyEmpresa(nucleo().db));
  registrar('equipo', () => hoyEquipo(nucleo().db));
}

async function servidorDePrueba(): Promise<{ pedir: Peticion; cerrar: () => void }> {
  const express = (await import('express')).default;
  const { rutasLicitaciones } = await import('../src/dominios/licitaciones/rutas.js');
  const { rutasPlataforma } = await import('../src/nucleo/rutas.js');
  await registrarHoy();
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  app.use('/api/plataforma', rutasPlataforma());
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pedir: Peticion = async (metodo, ruta, cuerpo) => {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return {
    pedir,
    cerrar: () => {
      server.close();
    },
  };
}

type Modulos = {
  nucleo: typeof import('../src/nucleo/contexto.js');
  db: typeof import('../src/dominios/licitaciones/db.js');
  fixtures: typeof import('../tests/helpers/comprobacionesFixtures.js');
};
type OfertaComprobaciones = Modulos['fixtures']['OFERTAS_COMPROBACIONES'][number];

// Como en comprobacionesFixtures.test.ts: perfil sin certificados (la verdad de hoy) y solo las personas de esta oferta.
function sembrar(m: Modulos, oferta: OfertaComprobaciones): Fixture {
  const capturado = m.fixtures.leerFixtureComprobaciones(oferta);
  const f = { ...capturado, perfil: { ...capturado.perfil, certificados: [] } };
  m.nucleo.nucleo().db.prepare('DELETE FROM personas').run();
  m.fixtures.sembrarFixture(m.db.dbLicitaciones(), m.nucleo.nucleo().db, f);
  return f;
}

// Cada oferta se pide antes de sembrar la siguiente (perfil y personas son del núcleo, uno para
// todas); lo global, con las 5 ya sembradas y a la hora de la última captura.
async function respuestasDe(m: Modulos, pedir: Peticion): Promise<Record<string, unknown>> {
  const mapas: Record<string, unknown> = {};
  const ofertas: Record<string, MapaRespuestas> = {};
  let ultima = '';
  for (const oferta of m.fixtures.OFERTAS_COMPROBACIONES) {
    const f = sembrar(m, oferta);
    ofertas[oferta] = await conReloj(f.ahora, () =>
      pedirTodas(
        pedir,
        RUTAS_OFERTA.map((r) => `/api/licitaciones/licitaciones/${f.id}${r}`),
      ),
    );
    Object.assign(mapas, await conReloj(f.ahora, () => impactosDe(pedir, oferta, f)));
    if (f.ahora > ultima) ultima = f.ahora;
  }
  const globales = await conReloj(ultima, () => pedirTodas(pedir, RUTAS_GLOBALES));
  // `_ahora`: la web en e2e pone el reloj del navegador a esa hora (las cuentas atrás casan con las respuestas).
  for (const [oferta, mapa] of Object.entries(ofertas)) mapas[oferta] = { _ahora: ultima, ...globales, ...mapa };
  return mapas;
}

/**
 * Los mapas de las 5 ofertas y los impactos de los cambios tardíos. Necesita el entorno ya apuntando a un
 * directorio temporal (PLATAFORMA_DATA_DIR…): lo prepara main() o el test.
 */
export async function generarRespuestas(): Promise<Result<Record<string, unknown>>> {
  try {
    const m: Modulos = {
      nucleo: await import('../src/nucleo/contexto.js'),
      db: await import('../src/dominios/licitaciones/db.js'),
      fixtures: await import('../tests/helpers/comprobacionesFixtures.js'),
    };
    m.nucleo.iniciarNucleo();
    const { pedir, cerrar } = await servidorDePrueba();
    try {
      return ok(await respuestasDe(m, pedir));
    } finally {
      cerrar();
      m.db.cerrarDbLicitaciones();
      m.nucleo.cerrarNucleo();
    }
  } catch (e) {
    return fail('generacion', errorMessage(e));
  }
}

/** Entorno aislado en un directorio temporal: sin ingesta ni LibreOffice y nada de los datos locales. */
export function prepararEntorno(tmp: string): void {
  for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
  Object.assign(process.env, {
    PLATAFORMA_DATA_DIR: path.join(tmp, 'datos'),
    AGENTES_DIR: path.join(tmp, '.agentes'),
    SALIDAS_DIR: path.join(tmp, 'salidas'),
    VAULT_PATH: path.join(tmp, 'conocimiento'),
    LICITACIONES_ACTIVO: '0',
    LIBREOFFICE_ACTIVO: '0',
    HERMES_VAULT_CONFIG_PATH: path.join(tmp, '__no_config__.json'),
    BIBLIOTECA_INDEX_DIR: path.join(tmp, 'index'),
    HERMES_HOME: path.join(tmp, 'hermes'),
    HOME: tmp,
  });
}

async function main(): Promise<number> {
  const { logger } = await import('../src/nucleo/log.js');
  const log = logger('e2e');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'respuestas-e2e-'));
  prepararEntorno(tmp);
  try {
    const mapas = await generarRespuestas();
    const escritos = mapas.error ? mapas : escribirMapas(DIR_DATOS, mapas.data);
    if (escritos.error) {
      log.error('no se generaron los datos e2e', { codigo: escritos.error.code, motivo: escritos.error.message });
      return 1;
    }
    log.info('datos e2e generados', { archivos: escritos.data.length, dir: DIR_DATOS });
    return 0;
  } finally {
    // Windows tarda en soltar los ficheros de SQLite recién cerrados.
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
