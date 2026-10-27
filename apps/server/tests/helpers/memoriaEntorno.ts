// Entorno común de los tests de la memoria técnica con el caso A (p-91000710): la
// licitación en preparación con ficha, guion y decisiones (dos personas del equipo), el PCAP y un
// PPT indexados en la Biblioteca, Salidas, el servidor MCP y la API. Cada archivo de test es un
// proceso: importar este módulo antes que nada fija el entorno de ese proceso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CARPETA_PLIEGOS,
  decisionesCasoA,
  FICHA_CASO_A,
  GUION_CASO_A,
  ID,
  licitacionCasoA,
  PAGINAS_PCAP,
} from '../licitaciones/fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-'));
export const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
const indexDir = path.join(tmp, 'index');
for (const d of [salidas, conocimiento, agentes]) fs.mkdirSync(d, { recursive: true });
export const T_OFERTA = 'o'.repeat(40);
export const T_CRITICO = 'x'.repeat(40);
export const T_CURIOSO = 'k'.repeat(40);
fs.writeFileSync(path.join(agentes, 'oferta-licitaciones.token'), T_OFERTA);
fs.writeFileSync(path.join(agentes, 'critico-licitaciones.token'), T_CRITICO);
// Un agente que lee licitaciones pero no colaboradores (datos personales).
fs.writeFileSync(path.join(agentes, 'curioso.token'), T_CURIOSO);
fs.writeFileSync(path.join(agentes, 'permisos.json'), JSON.stringify({ curioso: { colaboradores: 'ninguno' } }));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = indexDir;
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { comoPersona } = await import('./persona.js');
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { trocearPaginas } = await import('../../src/biblioteca/motor/documentos/trozos.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
export const db = dbLicitaciones();
export { nucleo, ID };

// El PPT del caso A (sintético): lo que el servicio presta, en páginas cortas.
export const PAGINAS_PPT = [
  'Pliego de prescripciones técnicas. 1. Objeto: apoyo en protección de datos personales para la SIIE.',
  '2. Prestaciones: atención de consultas de las áreas de la entidad, registro de actividades de tratamiento y análisis de riesgos.',
  '3. Atención de consultas: de lunes a viernes de 9:00 a 17:00 (hora de Canarias), respuesta en un máximo de 48 horas.',
  '4. Formación: dos sesiones anuales al personal de oficina sobre protección de datos.',
  '5. Coordinación: reunión mensual con la Asesoría Jurídica y acta de acuerdos.',
];

function indexar(ruta: string, titulo: string, paginas: string[]): void {
  const idx = indice.abrirIndice(indexDir);
  indice.reemplazarArchivo(
    idx,
    {
      path: ruta,
      kind: 'document',
      title: titulo,
      mtime_ms: 1,
      size: 1,
      pages: paginas.length,
      status: 'ok',
      error: null,
      source: null,
    },
    trocearPaginas(paginas, true),
  );
  idx.close();
}

/** Indexa un documento suelto de la Biblioteca (lo que el equipo sube a la carpeta de pliegos). */
export const documentoIndexado = (ruta: string, paginas: string[]): void =>
  indexar(ruta, ruta.split('/').pop()!, paginas);

/** Lo quita del índice. */
export function sinDocumentoIndexado(ruta: string): void {
  const idx = indice.abrirIndice(indexDir);
  indice.quitarArchivo(idx, ruta);
  idx.close();
}

/** Indexa un pliego de la licitación y lo da por descargado. */
export function pliegoIndexado(id: string, clase: 'pcap' | 'ppt', nombre: string, paginas: string[]): string {
  const ruta = `${CARPETA_PLIEGOS.replace(ID, id)}/${nombre}`;
  indexar(ruta, nombre, paginas);
  db.prepare(
    `INSERT OR IGNORE INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en)
    VALUES (?, ?, ?, ?, 'descargado', ?, ?)`,
  ).run(
    id,
    `https://contrataciondelestado.es/${clase}/${nombre}`,
    clase,
    nombre,
    ruta,
    new Date(Date.now() - 10 * 60_000).toISOString(),
  );
  return ruta;
}

const ts = new Date().toISOString();
guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ts, ts);
pliegoIndexado(ID, 'pcap', 'PCAP.pdf', PAGINAS_PCAP);
pliegoIndexado(ID, 'ppt', 'PPT.pdf', PAGINAS_PPT);
if (
  guardarPerfilEmpresa(nucleo().db, {
    nif: 'B12345678',
    nombre: 'Analítica Ejemplo SL',
    domicilio: 'Calle Ejemplo 7, 38001 Puerto de Ejemplo',
  }).error
)
  throw new Error('perfil');
const persona = (nombre: string, cv: string) =>
  crearPersona(nucleo().db, {
    nombre,
    tipo: 'interno',
    rol: 'Consultora',
    cv_ruta: `Colaboradores/${cv}`,
    certificaciones: ['CIPP/E'],
    titulaciones: ['Grado en Derecho'],
    anios_experiencia: 8,
    sectores: ['administración pública'],
    linkedin: 'https://www.linkedin.com/in/ana-ejemplo',
  }).data!.id;
export const PERSONAS = [
  persona('Ana García Pérez', 'cv-ana-garcia.pdf'),
  persona('Luis Martín Díaz', 'cv-luis-martin.pdf'),
];
await proponerFicha(db, FichaEntrada.parse(FICHA_CASO_A), 'licitaciones');
if ((await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones')).error)
  throw new Error('guion');
if (guardarDecisiones(db, nucleo().db, ID, decisionesCasoA(PERSONAS)).error) throw new Error('decisiones');

let server: http.Server | null = null;
export let base = '';

/** Arranca la API y el MCP (en el before de cada archivo). */
export async function arrancar(): Promise<void> {
  const app = express();
  app.use(comoPersona);
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  app.use('/api/licitaciones', rutasLicitaciones());
  const s = http.createServer(app);
  // Solo el cliente cierra las conexiones inactivas. Las respuestas MCP llegan con «connection:
  // keep-alive» y fetch guarda la conexión; un test que tarda (la suite en paralelo) dejaba el bucle
  // ocupado más de 5 s y, al volver, el servidor la cerraba por inactiva en el mismo turno en que el
  // cliente la reutilizaba: ECONNRESET en la primera petición del test siguiente, que el servidor
  // nunca veía. Sin temporizador en el servidor no hay carrera; cerrar() corta las que queden.
  s.keepAliveTimeout = 0;
  server = s;
  await new Promise<void>((listo) => s.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

/** Cierra todo (en el after de cada archivo). */
export function cerrar(): void {
  server?.closeAllConnections();
  server?.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
}

export async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const json = { 'content-type': 'application/json' };
export const api = (ruta: string, body?: unknown, method = 'POST', headers: Record<string, string> = {}) =>
  fetch(
    `${base}/api/licitaciones${ruta}`,
    body === undefined && method === 'GET'
      ? {}
      : { method, headers: { ...json, ...headers }, body: JSON.stringify(body ?? {}) },
  );
export const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';

export type FilaMemoriaTest = {
  id: number;
  version: number;
  guion_id: number;
  estado: string;
  fase: string | null;
  ronda: number;
  error: string | null;
  coherencia: string;
  pedida_en: string;
};
export const memoriaPorId = (id: number) =>
  db.prepare('SELECT * FROM memorias WHERE id = ?').get(id) as FilaMemoriaTest;
export const trabajosDe = (tipo: string) =>
  nucleo().db.prepare('SELECT * FROM trabajos_ia WHERE tipo = ? ORDER BY id').all(tipo) as {
    id: number;
    clave: string;
    payload: string;
    estado: string;
    intentos: number;
    actualizado_en: string;
  }[];
/**
 * Tras guardar la estrategia: la memoria pasa a la ficha de solución, una persona la aprueba sin
 * cambios y la memoria sigue a la redacción (lo que hacían los tests antes de la ficha).
 */
export async function trasLaEstrategia(memoriaId: number): Promise<void> {
  const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
  const { aprobarFicha } = await import('../../src/dominios/licitaciones/oferta/fichaSolucion.js');
  const { filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
  await avanzarMemoria(nucleo().db, db, memoriaId);
  const m = filaMemoria(db, memoriaId)!;
  if (m.fase === 'ficha' && aprobarFicha(db, m, { revisado_por: 'Equipo de pruebas' }).error) throw new Error('ficha');
  await avanzarMemoria(nucleo().db, db, memoriaId);
}

/** Borra las memorias, trabajos y Salidas de los tests anteriores: cada test empieza sin memoria en curso. */
export function sinMemorias(): void {
  db.exec(
    'DELETE FROM memoria_apartados; DELETE FROM memorias; DELETE FROM memoria_dossiers; DELETE FROM memoria_estrategias; DELETE FROM memoria_fichas_solucion; DELETE FROM memoria_criticas; DELETE FROM memoria_apartado_rondas; DELETE FROM memoria_parches_hechos;',
  );
  nucleo().db.exec('DELETE FROM trabajos_ia; DELETE FROM auditoria_agentes;');
  fs.rmSync(path.join(salidas, 'Licitaciones'), { recursive: true, force: true });
}
