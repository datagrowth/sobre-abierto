// Banco de 30 respuestas libres del asistente de la oferta, para medir a Hermes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepararEntorno } from './respuestasE2E.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BANCO = path.resolve(AQUI, '..', 'tests', 'licitaciones', 'fixtures', 'asistente', 'respuestasLibres.json');

async function sembrar() {
  const { iniciarNucleo, nucleo } = await import('../src/nucleo/contexto.js');
  const { dbLicitaciones } = await import('../src/dominios/licitaciones/db.js');
  const { OFERTAS_COMPROBACIONES, leerFixtureComprobaciones, sembrarFixture } =
    await import('../tests/helpers/comprobacionesFixtures.js');
  const { CasoBanco } = await import('../src/dominios/licitaciones/oferta/asistenteBanco.js');
  iniciarNucleo();
  const ofertas = OFERTAS_COMPROBACIONES.map((o) => leerFixtureComprobaciones(o));
  for (const f of ofertas) sembrarFixture(dbLicitaciones(), nucleo().db, f);
  const casos = (JSON.parse(fs.readFileSync(BANCO, 'utf8')) as unknown[]).map((c) => CasoBanco.parse(c));
  return {
    casos,
    idDe: (oferta: string) =>
      ofertas[OFERTAS_COMPROBACIONES.indexOf(oferta as (typeof OFERTAS_COMPROBACIONES)[number])]!.id,
  };
}

async function preparar(dir: string): Promise<number> {
  const { casos, idDe } = await sembrar();
  const { nucleo } = await import('../src/nucleo/contexto.js');
  const { dbLicitaciones } = await import('../src/dominios/licitaciones/db.js');
  const { anotarHilo } = await import('../src/dominios/licitaciones/oferta/asistenteHilo.js');
  const { instruccionesInterpretar } = await import('../src/dominios/licitaciones/oferta/asistenteInterpretar.js');
  fs.mkdirSync(dir, { recursive: true });
  for (const c of casos) {
    const id = idDe(c.oferta);
    const m = anotarHilo(dbLicitaciones(), id, {
      pregunta: c.pregunta,
      autor: 'persona',
      tipo: 'libre',
      texto: c.texto,
      estado: 'interpretando',
    });
    fs.writeFileSync(
      path.join(dir, `${c.caso}.txt`),
      await instruccionesInterpretar(dbLicitaciones(), nucleo().db, { id, mensaje: m.id, pregunta: c.pregunta }),
    );
  }
  process.stdout.write(
    `${casos.length} tareas en ${dir}: deja en <caso>.json lo que Hermes mande a licitaciones_oferta_interpretar.\n`,
  );
  return 0;
}

async function puntuar(dir: string): Promise<number> {
  const { casos, idDe } = await sembrar();
  const { nucleo } = await import('../src/nucleo/contexto.js');
  const { dbLicitaciones } = await import('../src/dominios/licitaciones/db.js');
  const { obtenerPersona } = await import('../src/nucleo/colaboradores/personas.js');
  const { preguntasDeOferta } = await import('../src/dominios/licitaciones/oferta/asistentePreguntas.js');
  const { puntuarBanco } = await import('../src/dominios/licitaciones/oferta/asistenteBanco.js');
  const porOferta = new Map<string, Awaited<ReturnType<typeof preguntasDeOferta>>>();
  for (const o of new Set(casos.map((c) => c.oferta)))
    porOferta.set(o, await preguntasDeOferta(dbLicitaciones(), nucleo().db, idDe(o)));
  const leer = (caso: string) => {
    const f = path.join(dir, `${caso}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
  };
  const respuestas = Object.fromEntries(casos.map((c) => [c.caso, leer(c.caso)]).filter(([, r]) => r !== undefined));
  const r = puntuarBanco(
    casos,
    respuestas,
    (c) => porOferta.get(c.oferta)?.data?.preguntas.find((p) => p.clave === c.pregunta) ?? null,
    (pid) => obtenerPersona(nucleo().db, pid).data?.nombre ?? null,
  );
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  return r.aprobado ? 0 : 1;
}

// Uso: npm run banco:respuestas -w @sobre-abierto/server -- preparar <dir>
//   siembra las 5 ofertas de las comprobaciones en una base temporal y escribe en <dir>/<caso>.txt la tarea
//   licitaciones.interpretar_respuesta de cada caso, tal como la recibiría Hermes.
// Uso: npm run banco:respuestas -w @sobre-abierto/server -- puntuar <dir>
//   lee <dir>/<caso>.json (lo que Hermes mandó a licitaciones_oferta_interpretar: entendido, opcion
//   o accion) y dice cuántos acierta; hacen falta 27 de 30.
async function main(): Promise<number> {
  const [orden, dir] = process.argv.slice(2);
  if ((orden !== 'preparar' && orden !== 'puntuar') || !dir) {
    process.stderr.write('Uso: banco:respuestas preparar <dir> | puntuar <dir>\n');
    return 2;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-respuestas-'));
  prepararEntorno(tmp);
  try {
    return orden === 'preparar' ? await preparar(path.resolve(dir)) : await puntuar(path.resolve(dir));
  } finally {
    const { cerrarDbLicitaciones } = await import('../src/dominios/licitaciones/db.js');
    const { cerrarNucleo } = await import('../src/nucleo/contexto.js');
    cerrarDbLicitaciones();
    cerrarNucleo();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
