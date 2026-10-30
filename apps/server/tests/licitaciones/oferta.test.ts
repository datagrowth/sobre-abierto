// La oferta de punta a punta con el caso A (p-91000710): guion contrastado
// con la ficha y con el pliego indexado, decisiones del equipo, memoria por apartados por MCP
// (revisión con frases exactas, cuota, automáticos) y ensamblado en Salidas como .docx +
// .md + .json (sin LibreOffice: páginas estimadas), con la API web y la revisión por PATCH.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { strFromU8, unzipSync } from 'fflate';
import type { Rubrica } from '../../src/dominios/licitaciones/ficha.js';
import {
  apartadoCasoA,
  CARPETA_PLIEGOS,
  decisionesCasoA,
  FICHA_CASO_A,
  GUION_CASO_A,
  guionCon,
  ID,
  licitacionCasoA,
  otraLicitacion,
  PAGINAS_PCAP,
  type Guion,
  type Numeros,
} from './fixtures/casoA.js';
import { leerSkill } from '../helpers/skill.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
const indexDir = path.join(tmp, 'index');
for (const d of [salidas, conocimiento, agentes]) fs.mkdirSync(d, { recursive: true });
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
const T_CURIOSO = 'k'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
// Un agente que lee licitaciones pero no colaboradores (datos personales).
fs.writeFileSync(path.join(agentes, 'curioso.token'), T_CURIOSO);
fs.writeFileSync(path.join(agentes, 'permisos.json'), JSON.stringify({ curioso: { colaboradores: 'ninguno' } }));
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
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
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { trocearPaginas } = await import('../../src/biblioteca/motor/documentos/trozos.js');
const { extraerDocumento } = await import('../../src/biblioteca/motor/documentos/extraccion.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaEntrada, proponerFicha, rubricasDeFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { detalle } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { exigirRevision } = await import('../../src/dominios/licitaciones/rechazos.js');
const { GuionEntrada, encolarGuionesAuto, guionVigente, proponerGuion } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { completarMarcas, marcaGenerica, marcasDeCriterio, marcasVigilables, memoriaValorable, problemasDeGuion } =
  await import('../../src/dominios/licitaciones/oferta/guionRevision.js');
const { ApartadoEntrada, contextoDeApartado, nombresPropiosDe, pedirMemoria, recibirApartado, resumenOferta } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const {
  ApartadoDatos,
  caracteresDe,
  cuotaDeApartado,
  cuotaIgual,
  erroresDeFiguras,
  problemasDeApartado,
  sinCitasInternas,
} = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const { instruccionesRedaccion } = await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { componerDossier } = await import('../../src/dominios/licitaciones/oferta/dossier.js');
const { leccionesParaRedactar } = await import('../../src/dominios/licitaciones/oferta/leccionesAplicadas.js');
const { ensamblarMemoria, SIN_REDACTAR, subtituloDePortada, recortarPorPalabra } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');
const { LeccionesEntrada, cambiosPorApartado, proponerLecciones, instruccionesLecciones, PayloadLecciones } =
  await import('../../src/dominios/licitaciones/oferta/lecciones.js');
const { hoyLicitaciones } = await import('../../src/dominios/licitaciones/hoy.js');
const {
  PropuestaDecisionesEntrada,
  problemasDePropuesta,
  proponerDecisiones,
  proponerAlLlegarGuion,
  pedirPropuestaDecisiones,
  instruccionesPropuestaDecisiones,
} = await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { opcionesDePrecio } = await import('../../src/dominios/licitaciones/oferta/precioSugerido.js');
const { Decisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { descartarVersionesSinRevisar } = await import('../../src/dominios/licitaciones/propuestas/revision.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const OTRA = 'p-91000730';
const SIN_GUION = 'p-91000720';
const CARPETA_SALIDAS = path.join(salidas, 'Licitaciones', `EXP-2026-0412 (${ID})`);

function oportunidad(id: string): void {
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
  ).run(id, ts, ts);
}

// El PCAP del caso A indexado como lo deja la Biblioteca (sin PDF ni modelo de embeddings).
function pliegoIndexado(id: string): void {
  const ruta = `${CARPETA_PLIEGOS.replace(ID, id)}/PCAP.pdf`;
  const idx = indice.abrirIndice(indexDir);
  indice.reemplazarArchivo(
    idx,
    {
      path: ruta,
      kind: 'document',
      title: 'PCAP',
      mtime_ms: 1,
      size: 1,
      pages: PAGINAS_PCAP.length,
      status: 'ok',
      error: null,
      source: null,
    },
    trocearPaginas(PAGINAS_PCAP, true),
  );
  idx.close();
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en)
    VALUES (?, 'https://contrataciondelestado.es/pcap', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)`,
  ).run(id, ruta, new Date(Date.now() - 10 * 60_000).toISOString());
}

for (const l of [licitacionCasoA(), otraLicitacion(OTRA), otraLicitacion(SIN_GUION)]) {
  guardarLicitacion(db, l);
  oportunidad(l.id);
}
pliegoIndexado(ID);
pliegoIndexado(SIN_GUION);
assert.equal(
  guardarPerfilEmpresa(nucleo().db, {
    nif: 'B12345678',
    nombre: 'Analítica Ejemplo SL',
    domicilio: 'Calle Ejemplo 7, Puerto de Ejemplo',
  }).error,
  null,
);
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
const PERSONAS = [persona('Ana García Pérez', 'cv-ana-garcia.pdf'), persona('Luis Martín Díaz', 'cv-luis-martin.pdf')];
await proponerFicha(db, FichaEntrada.parse(FICHA_CASO_A), 'licitaciones');
await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id: SIN_GUION }), 'licitaciones');

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = { 'content-type': 'application/json' };
const api = (ruta: string, body?: unknown, method = 'POST') =>
  fetch(
    `${base}/api/licitaciones${ruta}`,
    body === undefined && method === 'GET' ? {} : { method, headers: json, body: JSON.stringify(body ?? {}) },
  );
const leer = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';
const olvidarRechazos = () => nucleo().db.prepare('DELETE FROM auditoria_agentes').run();
const eventos = (tipo: string) => ultimosEventos(nucleo().db, 200).filter((e) => e.tipo === tipo);
const guion = (g: unknown, hoy?: Date) =>
  proponerGuion(db, GuionEntrada.parse(g), 'licitaciones', { revisar: true, ...(hoy ? { hoy } : {}) });
const sinPasajes = async () => ({
  data: null,
  error: { code: 'no_indexado', message: 'La Biblioteca aún no tiene índice' },
});

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

type FilaMemoria = {
  id: number;
  version: number;
  guion_id: number;
  estado: string;
  fase: string | null;
  borrador_id: number | null;
  avisos: string;
  error: string | null;
  notas_subida?: string | null;
};
const memoria = (version: number) =>
  db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as
    FilaMemoria | undefined;
const numeros = (m: FilaMemoria): Numeros => ({ memoria_id: m.id, guion_id: m.guion_id, version: m.version });
// La máquina de fases acepta apartados solo en la redacción: aquí se da por hechos el dossier, la
// estrategia y la ficha de solución (sus tests: memoriaDossier, memoriaEstrategia y memoriaFicha).
const enRedaccion = (version: number) =>
  db
    .prepare("UPDATE memorias SET fase = 'redaccion', ronda = 0 WHERE licitacion_id = ? AND version = ?")
    .run(ID, version);

test('should_accept_an_outline_that_matches_the_sheet_and_version_it', async () => {
  const lici = await conectar(T_LICI);
  try {
    const r1 = await lici.callTool({ name: 'licitaciones_guion', arguments: { id: ID, ...GUION_CASO_A } });
    assert.equal(r1.isError, undefined, texto(r1));
    const d1 = JSON.parse(texto(r1)) as { version: number; sustituye: boolean; apartados: number; avisos: string[] };
    assert.deepEqual([d1.version, d1.sustituye, d1.apartados, d1.avisos], [1, false, 4, []]);
    const r2 = JSON.parse(
      texto(await lici.callTool({ name: 'licitaciones_guion', arguments: { id: ID, ...GUION_CASO_A } })),
    ) as { version: number; sustituye: boolean };
    assert.deepEqual([r2.version, r2.sustituye], [2, true]);
  } finally {
    await lici.close();
  }
  const g = guionVigente(db, ID)!;
  assert.equal(g.version, 2);
  assert.deepEqual(
    g.datos.memoria?.apartados.map((a) => a.puntos),
    [8, 7, 6, 4],
  );
  assert.equal(g.ficha_id !== null, true);
  const ev = eventos('licitacion.guion')[0];
  assert.deepEqual(ev?.datos, { accion: 'guion', version: 2, apartados: 4, avisos: 0, cambios_vacio: true });
});

test('should_reject_sections_that_do_not_match_the_sheet_criteria', async () => {
  const tres = await guion(
    guionCon((g) => {
      g.memoria.apartados = g.memoria.apartados.slice(0, 3);
    }),
  );
  assert.match(
    tres.error?.message ?? '',
    /La memoria tiene 3 apartados y la ficha aprobada tiene 4 criterios de juicio de valor \(8, 7, 6 y 4 puntos; 25 en total\): un apartado por criterio, con sus mismos puntos\./,
  );
  const puntos = await guion(
    guionCon((g) => {
      g.memoria.apartados[3]!.puntos = 5;
    }),
  );
  assert.match(
    puntos.error?.message ?? '',
    /Los puntos de los apartados \(8, 7, 6, 5\) no son los de la ficha \(8, 7, 6, 4\)\./,
  );
  const sinMemoria = await guion(
    guionCon((g) => {
      (g as { memoria: unknown }).memoria = null;
    }),
  );
  assert.match(
    sinMemoria.error?.message ?? '',
    /Hay criterios de juicio de valor en la ficha y el guion no trae «memoria»/,
  );
  const desordenado = await guion(
    guionCon((g) => {
      g.memoria.apartados.reverse();
    }),
  );
  assert.equal(desordenado.error, null, 'se comparan los puntos como multiconjunto, no en orden');
});

test('should_reject_an_outline_without_page_limit_when_the_specs_mention_one', async () => {
  const sinLimite = guionCon((g) => {
    g.memoria.limite_paginas = null;
  });
  const r = await guion(sinLimite);
  assert.match(
    r.error?.message ?? '',
    /El pliego habla de un límite de páginas \(«…extensión máxima de 25 páginas…», PCAP pág\. 31\) y el guion trae memoria\.limite_paginas = null: léelo y ponlo, o explica en limite_detalle por qué no aplica\./,
  );
  const explicado = await guion(
    guionCon((g) => {
      g.memoria.limite_paginas = null;
      (g.memoria as { limite_detalle?: string }).limite_detalle =
        'El límite es de la memoria del lote 2, que no presentamos.';
    }),
  );
  assert.equal(explicado.error, null);
  const sinIndice = await proponerGuion(db, GuionEntrada.parse(sinLimite), 'licitaciones', {
    revisar: true,
    pasajes: sinPasajes,
  });
  assert.equal(sinIndice.error, null, 'sin pasajes no se rechaza');
  assert.match(sinIndice.data!.avisos.join(' '), /No se pudo comprobar en el pliego si fija un límite de páginas/);
});

test('should_reject_sections_without_page_and_files_without_documents', async () => {
  const r = await guion(
    guionCon((g) => {
      delete (g.memoria.apartados[1] as { pagina?: number }).pagina;
      g.archivos[1]!.documentos = [];
      g.automaticos[0]!.marcas = [];
      g.automaticos[1]!.marcas = [];
      g.automaticos[1]!.criterio = 'Mejoras';
    }),
  );
  const m = r.error?.message ?? '';
  assert.match(
    m,
    /Cada apartado de la memoria debe citar documento y página del pliego: «Gestión de incidencias y control de calidad»\./,
  );
  assert.match(m, /Cada archivo electrónico debe traer al menos un documento: «Archivo electrónico nº 2»\./);
  assert.match(
    m,
    /Un criterio automático sin «marcas» no se puede vigilar en la memoria: «Mejoras»\./,
    'solo el que no tiene ni marcas ni nombre del que sacarlas',
  );
  assert.doesNotMatch(m, /sin «marcas»[^.]*Certificado ISO 14001/, 'las sacadas del nombre ya no se rechazan');
  const sinArchivo = await guion(
    guionCon((g) => {
      g.memoria.archivo = 'Sobre A';
    }),
  );
  assert.match(sinArchivo.error?.message ?? '', /«Sobre A» no es ninguno de los archivos del guion/);
  const repetido = await guion(
    guionCon((g) => {
      g.archivos[1]!.nombre = 'Archivo electrónico nº 1';
    }),
  );
  assert.match(repetido.error?.message ?? '', /está repetido/);
});

// CASO_E dejó 7 criterios automáticos sin marcas: la plataforma las saca del nombre del criterio.
test('should_derive_marks_from_the_criterion_name_when_hermes_gives_none', () => {
  const de = (criterio: string, como = 'Marcando la casilla del Anexo VI.') =>
    marcasDeCriterio({ criterio, como_se_acredita: como });
  assert.deepEqual(
    de('Formatos de descarga de los registros de actividad'),
    ['Formatos de descarga de los registros de actividad'],
    'sin encabezado le quedan dos palabras con contenido',
  );
  assert.deepEqual(de('2.1. Compromiso de Tiempo de Respuesta Tutorial (Prontitud)'), [
    'Compromiso de Tiempo de Respuesta Tutorial',
    'Tiempo de Respuesta Tutorial',
  ]);
  assert.deepEqual(de('Volumen de Señales Automáticas de Inactividad del Alumnado'), [
    'Volumen de Señales Automáticas de Inactividad del Alumnado',
    'Señales Automáticas de Inactividad del Alumnado',
  ]);
  assert.deepEqual(
    de('Certificado ISO 14001', 'Aportando el certificado ISO 14001:2015 vigente.'),
    ['Certificado ISO 14001', 'ISO 14001'],
    'las normas solo si las dice el nombre',
  );
  assert.deepEqual(de('Mejoras'), [], 'una palabra suelta saldría en una memoria correcta');
  assert.deepEqual(de('Mejora 1: 30 horas'), [], 'ni una cifra suelta');
});

test('should_strip_alphanumeric_numbering_with_attached_separators_from_the_name', () => {
  const de = (criterio: string) => marcasDeCriterio({ criterio, como_se_acredita: '' })[0];
  assert.equal(
    de('2B1.- Personalización de los materiales sin coste adicional'),
    'Personalización de los materiales sin coste adicional',
  );
  assert.equal(de('C1. Años de docencia previa del profesorado'), 'Años de docencia previa del profesorado');
  assert.equal(de('A) Plan de formación continua del personal'), 'Plan de formación continua del personal');
  assert.equal(de('B.2 – Plan de formación continua del personal'), 'Plan de formación continua del personal');
  assert.equal(de('2.1.- Plan de formación continua del personal'), 'Plan de formación continua del personal');
  assert.equal(
    de('Servicio de atención telefónica urgente'),
    'Servicio de atención telefónica urgente',
    'una inicial pegada a una palabra no es numeración',
  );
  assert.equal(de('Atención telefónica urgente'), 'Atención telefónica urgente');
});

test('should_strip_roman_ordinal_and_letter_numbering_but_not_words_that_look_like_it', () => {
  const de = (criterio: string) => marcasDeCriterio({ criterio, como_se_acredita: '' })[0];
  assert.equal(de('III. Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(de('IV.- Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(de('1º Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(de('1.º Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(de('2.a) Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(de('2.a Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(
    de('V.O. subtitulada de las piezas audiovisuales'),
    'V.O. subtitulada de las piezas audiovisuales',
    'unas siglas no son numeración',
  );
  assert.equal(de('E - Plan de calidad del servicio prestado'), 'Plan de calidad del servicio prestado');
  assert.equal(
    de('E-learning para el personal docente'),
    'E-learning para el personal docente',
    'una letra y un guion pegados son una palabra',
  );
  assert.equal(
    de('5G Cobertura de la red del servicio'),
    '5G Cobertura de la red del servicio',
    'dígito con letra pegada no es numeración',
  );
  assert.equal(de('Vigilancia continua del servicio prestado'), 'Vigilancia continua del servicio prestado');
});

test('should_not_make_a_mark_from_a_name_with_fewer_than_three_meaningful_words_nor_from_a_norm_in_the_how_to_prove_it', () => {
  const de = (criterio: string, como = '') => marcasDeCriterio({ criterio, como_se_acredita: como });
  assert.deepEqual(de('Formación del personal'), [], 'una memoria correcta lo diría sin hablar del criterio');
  assert.deepEqual(
    de('3.1. Soporte técnico en remoto'),
    ['Soporte técnico en remoto'],
    'su versión sin encabezado queda corta',
  );
  assert.deepEqual(
    de('Compromiso de sostenibilidad', 'Con certificado ISO 27001 vigente.'),
    [],
    'ISO 27001 no sale del nombre',
  );
  assert.deepEqual(de('Certificación ISO 27001 del servicio'), ['Certificación ISO 27001 del servicio', 'ISO 27001']);
});

test('should_not_reject_marks_that_come_only_from_the_criterion_name', () => {
  const base = {
    ...GUION_CASO_A.automaticos[0]!,
    criterio: 'Asistente virtual de consultas con disponibilidad continua',
  };
  const g = (marcas: string[]) =>
    ({ ...GUION_CASO_A, automaticos: [{ ...base, marcas }] }) as unknown as Parameters<typeof problemasDeGuion>[0];
  const ctx = { rubricas: null, limite: null };
  assert.doesNotMatch(
    problemasDeGuion(g(['Asistente virtual de consultas con disponibilidad continua']), ctx).join(' '),
    /sin «marcas»/,
    'un guion sin marcas se completa, no se rechaza dos veces',
  );
  assert.doesNotMatch(problemasDeGuion(g(['aprendizaje automático']), ctx).join(' '), /sin «marcas»/);
});

test('should_fill_only_criteria_without_marks_and_drop_marks_the_memoria_must_cover', () => {
  const g = completarMarcas({
    memoria: {
      ...GUION_CASO_A.memoria,
      apartados: [{ ...GUION_CASO_A.memoria.apartados[0]!, se_valorara: ['Herramientas de Inteligencia Artificial'] }],
    },
    automaticos: [
      {
        ...GUION_CASO_A.automaticos[0]!,
        criterio: 'Asistente virtual de consultas con disponibilidad continua',
        marcas: [],
      },
      { ...GUION_CASO_A.automaticos[1]!, marcas: ['discapacidad'] },
    ],
  } as unknown as Parameters<typeof completarMarcas>[0]);
  assert.deepEqual(g.automaticos[0]!.marcas, ['Asistente virtual de consultas con disponibilidad continua']);
  assert.deepEqual(g.automaticos[1]!.marcas, ['discapacidad'], 'las de Hermes no se tocan');
});

test('should_give_marks_to_an_outline_saved_without_them_and_drop_its_warning', async () => {
  const r = await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones', {
    pasajes: sinPasajes,
  });
  const viejo = structuredClone(GUION_CASO_A) as unknown as { automaticos: { marcas: string[] }[] };
  viejo.automaticos[0]!.marcas = [];
  db.prepare('UPDATE guiones SET datos = ?, avisos = ? WHERE id = ?').run(
    JSON.stringify(viejo),
    JSON.stringify([
      'Un criterio automático sin «marcas» no se puede vigilar en la memoria: «Certificado ISO 14001».',
      'Otro aviso.',
    ]),
    r.data!.guion,
  );
  const g = guionVigente(db, ID)!;
  assert.deepEqual(g.datos.automaticos[0]!.marcas, ['Certificado ISO 14001', 'ISO 14001']);
  assert.deepEqual(g.avisos, ['Otro aviso.']);
});

test('should_accept_an_outline_with_warnings_after_two_rejections', async () => {
  olvidarRechazos();
  const malo = guionCon((g) => {
    delete (g.memoria.apartados[0] as { pagina?: number }).pagina;
  });
  const lici = await conectar(T_LICI);
  try {
    for (const n of [1, 2])
      assert.equal(
        (await lici.callTool({ name: 'licitaciones_guion', arguments: malo })).isError,
        true,
        `rechazo ${n}`,
      );
    const tercera = await lici.callTool({ name: 'licitaciones_guion', arguments: malo });
    assert.equal(tercera.isError, undefined, 'a la tercera se acepta para no frenar el tipo de trabajo');
    assert.match(texto(tercera), /"avisos": \[\s*"Cada apartado de la memoria debe citar documento y página/);
    assert.equal(guionVigente(db, ID)?.avisos.length, 1);
    const bueno = await lici.callTool({ name: 'licitaciones_guion', arguments: { id: ID, ...GUION_CASO_A } });
    assert.equal(bueno.isError, undefined);
  } finally {
    await lici.close();
    olvidarRechazos();
  }
});

test('should_reject_generic_marks_and_marks_that_the_memoria_is_asked_to_cover', async () => {
  olvidarRechazos();
  const r = await guion(
    guionCon((g) => {
      g.automaticos[2]!.marcas = ['sin coste adicional', '30 horas'];
      g.automaticos[3]!.marcas = ['Asesoría Jurídica'];
    }),
  );
  const m = r.error?.message ?? '';
  assert.match(
    m,
    /Estas marcas son demasiado genéricas: saldrían en una memoria correcta y la plataforma la rechazaría: «sin coste adicional» \(Mejora 1: bolsa de horas adicionales\), «30 horas» \(Mejora 1: bolsa de horas adicionales\)\./,
  );
  assert.match(
    m,
    /Estas marcas salen en lo que el pliego pide valorar en la memoria, así que la memoria tiene que poder decirlas: «Asesoría Jurídica» \(apartado «Organización y metodología del servicio»\)\./,
  );
  olvidarRechazos();
});

test('should_not_watch_generic_marks_or_marks_from_the_rubric_when_writing_a_section', () => {
  assert.deepEqual(
    marcasVigilables(
      ['sin coste adicional', '10 % del personal', '329 alumnas', 'ISO 14001', 'coordinación con la asesoria juridica'],
      GUION_CASO_A.memoria.apartados,
    ),
    ['ISO 14001'],
  );
  assert.equal(marcaGenerica('60 horas de impartición'), true);
  assert.equal(marcaGenerica('tutores adicionales'), false);
});

test('should_check_that_the_points_of_each_rubric_item_add_up_to_the_section', async () => {
  olvidarRechazos();
  const r = await guion(
    guionCon((g) => {
      (g.memoria.apartados[0] as { puntos_se_valorara?: number[] }).puntos_se_valorara = [2, 2, 2, 1, 0.5];
      (g.memoria.apartados[1] as { puntos_se_valorara?: number[] }).puntos_se_valorara = [7];
    }),
  );
  const m = r.error?.message ?? '';
  assert.match(
    m,
    /Los puntos de «se valorará» del apartado «Organización y metodología del servicio» suman 7,5 y el apartado vale 8\./,
  );
  assert.match(
    m,
    /El apartado «Gestión de incidencias y control de calidad» trae \d+ elementos en «se_valorara» y 1 en «puntos_se_valorara»/,
  );
  olvidarRechazos();
});

test('should_use_the_subcriteria_when_the_sheet_has_a_single_judgement_criterion', () => {
  const ficha = FichaEntrada.parse({
    ...FICHA_CASO_A,
    criterios: [
      { descripcion: 'Precio', peso: 75, tipo: 'formula' },
      {
        descripcion: 'Memoria técnica',
        peso: 25,
        tipo: 'juicio_valor',
        subcriterios: [
          { descripcion: 'Organización', peso: 8 },
          { descripcion: 'Incidencias', peso: 7 },
          { descripcion: 'Asesoramiento', peso: 6 },
          { descripcion: 'Mejoras', peso: 4 },
        ],
      },
    ],
  });
  const rubricas = rubricasDeFicha(ficha);
  assert.deepEqual(
    rubricas.map((r) => r.puntos),
    [8, 7, 6, 4],
  );
  assert.deepEqual(problemasDeGuion(GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), { rubricas, limite: null }), []);
  const sinPesos = FichaEntrada.parse({
    ...ficha,
    criterios: [
      {
        descripcion: 'Memoria técnica',
        peso: 25,
        tipo: 'juicio_valor',
        subcriterios: [{ descripcion: 'Organización' }, { descripcion: 'Mejoras' }],
      },
    ],
  });
  assert.deepEqual(
    rubricasDeFicha(sinPesos).map((r) => r.puntos),
    [25],
    'sin pesos, el criterio entero',
  );
});

test('should_accept_a_non_scored_memoria_only_when_the_sheet_has_no_judgement_criteria', () => {
  const noValorable = (g: Guion) => {
    (g.memoria as { valorable?: boolean }).valorable = false;
    g.memoria.apartados = g.memoria.apartados.map((a) => ({ ...a, puntos: 0, escala: [] }));
  };
  const problemas = (g: unknown, rubricas: Rubrica[]) =>
    problemasDeGuion(GuionEntrada.parse(g), { rubricas, limite: null }).join(' ');
  assert.equal(problemas(guionCon(noValorable), []), '');
  assert.match(
    problemas(
      guionCon(() => {}),
      [],
    ),
    /si el pliego exige la memoria sin puntuarla .*envíala con valorable = false y sus apartados con 0 puntos/,
  );
  assert.match(
    problemas(
      guionCon((g) => {
        (g as { memoria: unknown }).memoria = null;
      }),
      [],
    ),
    /Los archivos traen «Memoria técnica» \(tipo memoria\) y el guion no trae «memoria»/,
  );
  assert.match(
    problemas(
      guionCon((g) => {
        noValorable(g);
        g.memoria.apartados[0]!.puntos = 8;
      }),
      [],
    ),
    /La memoria no es valorable: sus apartados van con 0 puntos, sin escala ni puntos_se_valorara: «Organización y metodología del servicio»\./,
  );
  assert.match(
    problemas(
      guionCon((g) => {
        noValorable(g);
        g.memoria.apartados[1]!.se_valorara = [];
      }),
      [],
    ),
    /«se_valorara» es lo que el pliego exige que contenga cada apartado/,
  );
  assert.match(
    problemas(guionCon(noValorable), rubricasDeFicha(FichaEntrada.parse(FICHA_CASO_A))),
    /La ficha aprobada tiene 4 criterios de juicio de valor: la memoria se puntúa/,
  );
});

test('should_not_score_a_memoria_whose_sections_add_up_to_zero_points_even_without_the_valorable_field', () => {
  // CASO_E: la memoria colgaba de un guion anterior al campo, con apartados a 0, y la autoevaluación entraba en bucle.
  assert.equal(memoriaValorable({ apartados: [{ puntos: 0 }, { puntos: 0 }] }), false);
  assert.equal(memoriaValorable({ apartados: [{ puntos: 0 }, { puntos: 5 }] }), true);
  assert.equal(memoriaValorable({ valorable: false, apartados: [{ puntos: 5 }] }), false);
  assert.equal(memoriaValorable({}), true, 'sin apartados que mirar, vale lo que diga el campo');
});

test('should_split_the_page_limit_evenly_and_ask_for_the_required_content_in_a_non_scored_memoria', () => {
  const g = GuionEntrada.parse(
    guionCon((x) => {
      (x.memoria as { valorable?: boolean }).valorable = false;
      x.memoria.apartados = x.memoria.apartados.map((a) => ({ ...a, puntos: 0, escala: [] }));
    }),
  );
  const contexto = contextoDeApartado({ ...guionVigente(db, ID)!, datos: g }, 1)!;
  assert.deepEqual(contexto.cuota, cuotaIgual(25, 4));
  assert.equal(contexto.cuota?.reparto, 'a partes iguales entre los 4 apartados');
  assert.equal(cuotaIgual(null, 4), null);
});

test('should_queue_the_outline_automatically_for_opportunities_in_preparation', async () => {
  const listo = () => 'listo' as const;
  assert.equal(encolarGuionesAuto(nucleo().db, db, Date.now(), { legible: listo }), 1, 'la que tiene ficha y no guion');
  assert.equal(encolarGuionesAuto(nucleo().db, db, Date.now(), { legible: listo }), 0, 'una vez por ficha');
  const pedido = await leer<{ trabajo: number }>(api(`/licitaciones/${SIN_GUION}/oferta/guion`));
  const auto = nucleo()
    .db.prepare('SELECT id FROM trabajos_ia WHERE clave LIKE ?')
    .get(`guion-auto-${SIN_GUION}-f%`) as { id: number };
  assert.equal(pedido.trabajo, auto.id, 'si ya hay uno en curso, devuelve ese');
  assert.equal((await api(`/licitaciones/${OTRA}/oferta/guion`)).status, 400, 'sin ficha');
  await proponerFicha(db, FichaEntrada.parse(FICHA_CASO_A), 'licitaciones');
  const oferta = await leer<{ guion_desfasado: boolean; guion_en_curso: unknown }>(
    api(`/licitaciones/${ID}/oferta`, undefined, 'GET'),
  );
  assert.equal(oferta.guion_desfasado, true, 'la ficha es más nueva que el guion');
  assert.equal(encolarGuionesAuto(nucleo().db, db, Date.now(), { legible: listo }), 1, 'ficha nueva: guion nuevo');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE tipo = 'licitaciones.guion'").run();
  assert.equal((await guion({ id: ID, ...GUION_CASO_A })).error, null);
  assert.equal(
    (await leer<{ guion_desfasado: boolean }>(api(`/licitaciones/${ID}/oferta`, undefined, 'GET'))).guion_desfasado,
    false,
  );
});

test('should_refuse_the_memoria_without_outline_decisions_or_salidas', async () => {
  const sinFicha = await api(`/licitaciones/${OTRA}/oferta/memoria`);
  assert.equal(sinFicha.status, 400);
  const sinGuion = await leer<{ message: string }>(api(`/licitaciones/${SIN_GUION}/oferta/memoria`));
  assert.equal(sinGuion.message, 'Esta licitación aún no tiene guion de la oferta: pídelo primero.');
  const sinDecisiones = await api(`/licitaciones/${ID}/oferta/memoria`);
  assert.equal(sinDecisiones.status, 409);
  assert.match(
    ((await sinDecisiones.json()) as { message: string }).message,
    /^Fija primero las decisiones de la oferta/,
  );
  assert.equal(pedirMemoria(nucleo().db, db, null, ID).error?.code, 'no_configurado');
  assert.equal((await api('/licitaciones/p-0000/oferta/memoria')).status, 404);
});

test('should_store_decisions_only_when_automatics_people_and_lots_exist', async () => {
  const buenas = decisionesCasoA(PERSONAS);
  const put = (d: unknown, id = ID) => api(`/licitaciones/${id}/oferta/decisiones`, d, 'PUT');
  assert.equal((await put(buenas, OTRA)).status, 409, 'sin guion');
  assert.equal((await api(`/licitaciones/${ID}/oferta/decisiones`, undefined, 'GET')).status, 404);
  const faltan = await leer<{ error: string; message: string }>(
    put({ ...buenas, automaticos: buenas.automaticos.slice(2) }),
  );
  assert.equal(faltan.error, 'invalid_input');
  assert.match(
    faltan.message,
    /Falta decidir 2 criterios automáticos: «Certificado ISO 14001», «Plantilla con discapacidad igual o superior al 10 %»\./,
  );
  const otro = await leer<{ message: string }>(
    put({ ...buenas, automaticos: [...buenas.automaticos, { criterio: 'ENS', nos_acogemos: true }] }),
  );
  assert.match(
    otro.message,
    /El criterio «ENS» no está en el guion vigente \(v\d+\): los que hay son «Certificado ISO 14001»/,
  );
  const nadie = await leer<{ message: string }>(
    put({ ...buenas, equipo: [{ persona_id: 999, rol_en_la_oferta: 'Jefa de proyecto' }] }),
  );
  assert.equal(nadie.message, 'No hay ningún colaborador con id 999 (o está inactivo).');
  assert.equal(
    (await leer<{ message: string }>(put({ ...buenas, lotes: ['5'] }))).message,
    'Esta licitación no tiene lotes: la oferta es para el contrato entero (deja «lotes» vacío).',
  );
  assert.equal((await put({ ...buenas, precio: { importe: 40_000, pendiente: true } })).status, 400);
  assert.equal((await put({ ...buenas, extra: 1 })).status, 400, 'esquema estricto');
  const ok = await put(buenas);
  assert.equal(ok.status, 200);
  const guardadas = await leer<{ guion_id: number; datos: { equipo: unknown[]; ofertas: unknown[] } }>(
    api(`/licitaciones/${ID}/oferta/decisiones`, undefined, 'GET'),
  );
  assert.deepEqual([guardadas.guion_id, guardadas.datos.equipo.length], [guionVigente(db, ID)!.id, 2]);
  assert.deepEqual(
    guardadas.datos.ofertas,
    [{ lote: null, pendiente: true, importe: null, coste_estimado: null, unitarios: [] }],
    'el precio de antes se lee como la oferta del contrato entero',
  );
  assert.ok(!JSON.stringify(eventos('licitacion.guion')).includes('Ana'), 'el evento no lleva nombres');
});

test('should_explain_missing_criteria_without_api_jargon', async () => {
  const buenas = decisionesCasoA(PERSONAS);
  const put = (d: unknown) =>
    leer<{ error: string; message: string }>(api(`/licitaciones/${ID}/oferta/decisiones`, d, 'PUT'));

  const falta = await put({ ...buenas, automaticos: buenas.automaticos.slice(1) });
  const mal = await put({
    ...buenas,
    equipo: [{ persona_id: PERSONAS[0], rol_en_la_oferta: 'J' }],
    automaticos: [{ criterio: 'Certificado ISO 14001', nos_acogemos: 'sí' }],
  });
  const sobra = await put({ ...buenas, extra: 1 });

  assert.equal(falta.message, 'Falta decidir 1 criterio automático: «Certificado ISO 14001».');
  assert.equal(mal.error, 'invalid_input', 'se mantiene el código de error');
  assert.equal(
    mal.message,
    'Equipo, fila 1, rol en la oferta: tiene que tener al menos 2 caracteres. Criterios automáticos, fila 1, si nos acogemos: tiene que ser sí o no.',
  );
  assert.equal(sobra.message, 'sobra: extra.');
  for (const m of [falta.message, mal.message]) assert.doesNotMatch(m, /nos_acogemos|true|false|expected|Invalid/);
});

test('should_write_the_offered_value_in_the_data_sheet_and_annex_line', async () => {
  const { hojaDeDatos, hojaEnTexto } = await import('../../src/dominios/licitaciones/oferta/hojaDatos.js');
  const buenas = decisionesCasoA(PERSONAS);
  const bolsa = 'Mejora 1: bolsa de horas adicionales';
  const automaticos = buenas.automaticos.map((a) =>
    a.criterio === bolsa ? { ...a, nos_acogemos: true, valor: 30, evidencia: 'Compromiso de la oferta' } : a,
  );
  const guardadas = await api(`/licitaciones/${ID}/oferta/decisiones`, { ...buenas, automaticos }, 'PUT');
  assert.equal(guardadas.status, 200, await guardadas.clone().text());

  const hoja = hojaDeDatos(db, nucleo().db, ID).data!;

  const campo = hoja.campos.find((c) => c.etiqueta === bolsa);
  assert.match(campo?.valor ?? '', /^Sí, nos acogemos: 30 — /);
  assert.match(
    hojaEnTexto(hoja),
    /- Criterios automáticos · Mejora 1: bolsa de horas adicionales: Sí, nos acogemos: 30 — /,
  );
  assert.equal(
    (await api(`/licitaciones/${ID}/oferta/decisiones`, buenas, 'PUT')).status,
    200,
    'deja las decisiones como estaban',
  );
});

test('should_ask_the_memoria_once_and_give_hermes_the_rubric_names_and_cv_in_the_redaction_instructions', async () => {
  const r = await api(`/licitaciones/${ID}/oferta/memoria`);
  assert.equal(r.status, 202);
  const pedida = (await r.json()) as { memoria: number; version: number; apartados: number };
  assert.deepEqual([pedida.version, pedida.apartados], [1, 4]);
  assert.equal(
    (await leer<{ memoria: number }>(api(`/licitaciones/${ID}/oferta/memoria`))).memoria,
    pedida.memoria,
    'no duplica la que se redacta',
  );
  assert.equal(memoria(1)!.fase, 'dossier', 'empieza por el dossier');
  enRedaccion(1);
  const payload = {
    id: ID,
    memoria_id: pedida.memoria,
    guion_id: memoria(1)!.guion_id,
    version: 1,
    ronda: 0,
    pedida_en: new Date().toISOString(),
  };
  const inst = instruccionesRedaccion(db, nucleo().db, payload);
  assert.match(
    inst,
    /^Tarea de la plataforma de Analítica Ejemplo: redacta la memoria técnica entera \(versión 1, 4 apartados\) de la oferta a la licitación p-91000710 — Servicio de apoyo a la entidad en protección de datos/,
  );
  assert.match(inst, /TE TOCA REDACTAR los apartados 1, 2, 3, 4\./);
  assert.match(
    inst,
    /APARTADO: «Organización y metodología del servicio» \(8 puntos de 25 de la memoria\)\. Extensión objetivo: 16\.900-18\.800 caracteres \(su parte del límite, ≈ 7 páginas de las 25; entre todos los apartados llenan el límite\)\. La plataforma rechaza lo que pase de 21\.600 y lo que no llegue a 15\.100\./,
  );
  assert.match(inst, /\n- Coordinación con la Asesoría Jurídica\n/);
  assert.match(inst, /Escala del pliego: 0 puntos: No aporta contenido operativo\.; 4 puntos/);
  assert.match(
    inst,
    /Ana García Pérez — Responsable del servicio \(50 %\): Grado en Derecho; 8 años de experiencia; certificaciones: CIPP\/E; sectores: administración pública; CV «Colaboradores\/cv-ana-garcia\.pdf» \| Luis Martín Díaz/,
  );
  assert.doesNotMatch(inst, /linkedin/i, 'sin datos de contacto ni perfiles');
  assert.match(
    inst,
    /Frontera con los otros sobres: estas materias se valoran en «Archivo electrónico nº 2» y no aparecen en la memoria, ni para afirmarlas ni para negarlas \(mezclarlas es causa de exclusión\): «Certificado ISO 14001», .*; ni «ISO 14001», ni «gestión ambiental certificada»/,
  );
  assert.doesNotMatch(
    inst,
    /no nos acogemos|honestidad de alcance|Cita en «fuentes»/,
    'nada que empuje a negar o a citar el pliego',
  );
  assert.match(inst, /alcance claro en positivo: qué entregamos, cuándo y cómo se mide/);
  assert.match(inst, /Voz afirmativa, en presente o futuro de compromiso/);
  assert.match(inst, /Prosa que se lee de corrido: párrafos completos, frases con sujeto y verbo/);
  assert.match(
    inst,
    /Instrucciones del equipo \(orientan qué contar y con qué énfasis; no las copies en el texto\): «Servicio cercano/,
  );
  const guardadas = (
    db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(ID) as { datos: string }
  ).datos;
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(
    JSON.stringify({
      ...JSON.parse(guardadas),
      enfoque: 'Describir la analítica y las alertas (Bases, pág. 64) sin superar el Anexo VI (Bases.pdf, §9).',
    }),
    ID,
  );
  try {
    assert.match(
      instruccionesRedaccion(db, nucleo().db, payload),
      /no las copies en el texto\): «Describir la analítica y las alertas sin superar el Anexo VI\.»/,
      'el enfoque llega sin citas al pliego',
    );
  } finally {
    db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(guardadas, ID);
  }
  assert.match(inst, new RegExp(`memoria_id=${pedida.memoria}, guion_id=\\d+, version=1, apartado=N`));
  const oferta = await leer<{ memorias: { apartados: { estado: string }[] }[] }>(
    api(`/licitaciones/${ID}/oferta`, undefined, 'GET'),
  );
  assert.deepEqual(
    oferta.memorias[0]!.apartados.map((a) => a.estado),
    Array(4).fill('pendiente'),
  );
  assert.deepEqual(eventos('licitacion.memoria')[0]?.datos, {
    accion: 'pedida',
    version: 1,
    apartados: 4,
    memoria: pedida.memoria,
  });
});

// Deja el apartado por recibir, como lo está en la redacción: los tests de revisión lo envían una y otra vez.
function reabrir(memoriaId: number, apartado: number): void {
  db.prepare(
    "UPDATE memoria_apartados SET estado = 'pendiente', datos = NULL, caracteres = NULL, paginas_estimadas = NULL, avisos = '[]', rechazos = 0, agente = NULL, recibido_en = NULL, error = NULL WHERE memoria_id = ? AND apartado = ? AND estado <> 'pendiente'",
  ).run(memoriaId, apartado);
}
const enviar = (a: unknown) => {
  const entrada = ApartadoEntrada.parse(a);
  reabrir(entrada.memoria_id, entrada.apartado);
  return recibirApartado(db, entrada, 'licitaciones', { revisar: true });
};
const conTexto = (n: number, extra: string) => {
  const a = apartadoCasoA(n, numeros(memoria(1)!));
  a.bloques[1]!.parrafos.push(extra);
  return a;
};

test('should_reject_pending_marks_prices_and_bid_percentages', () => {
  const huecos = enviar(
    conTexto(1, 'El responsable será [PENDIENTE: confirmar nombre], por confirmar con la entidad.'),
  );
  assert.match(
    huecos.error?.message ?? '',
    /Quita las marcas de texto sin terminar: «\[PENDIENTE», «por confirmar» \(bloque 2\)\. La memoria se entrega tal cual: escribe el dato o quita la frase\./,
  );
  const euros = enviar(conTexto(1, 'El servicio completo tiene un coste de 12.500 € anuales para la entidad.'));
  assert.match(
    euros.error?.message ?? '',
    /La memoria no puede llevar importes ni bajas \(van en el archivo de la oferta económica y mencionarlos aquí es causa de exclusión\): «12\.500 €» \(bloque 2\)\./,
  );
  const baja = enviar(conTexto(1, 'Ofrecemos una baja del 15 % sobre el presupuesto de licitación.'));
  assert.match(baja.error?.message ?? '', /«baja del 15 %» \(bloque 2\)/);
  const fila = db
    .prepare('SELECT rechazos, error, estado FROM memoria_apartados WHERE memoria_id = ? AND apartado = 1')
    .get(memoria(1)!.id) as { rechazos: number; error: string; estado: string };
  assert.deepEqual([fila.rechazos, fila.estado], [3, 'pendiente']);
  assert.match(fila.error, /baja del 15 %/);
});

test('should_reject_internal_citations_of_the_tender_in_the_text', () => {
  olvidarRechazos();
  const r = enviar(
    conTexto(
      1,
      'Cada hallazgo mostrará documento y fragmento de respaldo (ETC ASISTE.docx, §§3.2.2-3.2.5, 4.3) y la regla aplicada según §4.7 y el PCAP.pdf.',
    ),
  );
  assert.match(
    r.error?.message ?? '',
    /Quita del texto las citas internas del pliego: «\(ETC ASISTE\.docx, §§3\.2\.2-3\.2\.5, 4\.3\)», «§4\.7», «PCAP\.pdf» \(bloque 2\)\. Lo que tomes del pliego va en prosa propia/,
  );
  const prosa = enviar(
    conTexto(1, 'Como pide el apartado 4.7 de la ETC, cada hallazgo muestra su documento y fragmento de respaldo.'),
  );
  assert.doesNotMatch(prosa.error?.message ?? '', /citas internas/, 'en prosa sí');
  olvidarRechazos();
});

const FIGURA =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" font-family="Arial, sans-serif"><rect x="20" y="110" width="200" height="80" fill="#F2F4F7" stroke="#5B6B7F"/><text x="120" y="156" font-size="16" text-anchor="middle">Buzón de consultas</text><rect x="300" y="110" width="200" height="80" fill="#1F6FB2"/><text x="400" y="156" font-size="16" text-anchor="middle">Respuesta en 48 h</text></svg>';
const conFigura = (n: number, svg: string, titulo = 'Flujo de una consulta') => {
  const a = apartadoCasoA(n, numeros(memoria(1)!));
  Object.assign(a.bloques[0]!, { figura: { titulo, svg } });
  return a;
};

test('should_reject_figures_that_cannot_be_drawn_or_carry_external_content_every_time', () => {
  olvidarRechazos();
  const script = FIGURA.replace('</svg>', '<script>alert(1)</script></svg>');
  for (let i = 0; i < 4; i += 1) {
    const r = enviar(conFigura(1, script));
    assert.match(
      r.error?.message ?? '',
      /Estas figuras no se pueden dibujar: la del bloque 1 \(«Flujo de una consulta»\): no admite scripts\. Corrige el SVG/,
      `envío ${i + 1}: nunca se acepta con avisos`,
    );
  }
  const externa = enviar(
    conFigura(1, FIGURA.replace('<rect', '<image href="https://ejemplo.com/a.png" width="10" height="10"/><rect')),
  );
  assert.match(externa.error?.message ?? '', /no admite imágenes o recursos externos/);
  const sinViewBox = enviar(conFigura(1, FIGURA.replace(' viewBox="0 0 800 300"', ' width="800" height="300"')));
  assert.match(sinViewBox.error?.message ?? '', /necesita viewBox/);
  olvidarRechazos();
});

test('should_check_the_figure_labels_like_the_text_and_count_the_figure_by_its_size', () => {
  const contexto = contextoDeApartado(guionVigente(db, ID)!, 1, { propios: nombresPropiosDe(db, ID) })!;
  const sinFigura = apartadoCasoA(1, numeros(memoria(1)!));
  const buena = conFigura(1, FIGURA);
  assert.deepEqual(problemasDeApartado(buena, contexto), [], 'una figura correcta no añade problemas');
  assert.ok(
    caracteresDe(buena.bloques) - caracteresDe(sinFigura.bloques) > 600,
    'cuenta lo que ocupa en la página (800×300 ≈ 6 cm de alto)',
  );
  const iso = problemasDeApartado(conFigura(1, FIGURA.replace('Respuesta en 48 h', 'Certificado ISO 14001')), contexto);
  assert.match(iso.join(' '), /criterios automáticos .*«ISO 14001» \(bloque 1\)/);
  const precio = problemasDeApartado(conFigura(1, FIGURA.replace('Respuesta en 48 h', 'Coste: 12.500 €')), contexto);
  assert.match(precio.join(' '), /«12\.500 €» \(bloque 1\)/);
  const pequena = problemasDeApartado(conFigura(1, FIGURA.replace(/font-size="16"/g, 'font-size="9"')), contexto);
  assert.match(pequena.join(' '), /La figura del bloque 1 tiene letra de 5,1 pt una vez en la página/);
  const numerada = problemasDeApartado(conFigura(1, FIGURA, 'Figura 2. Flujo de una consulta'), contexto);
  assert.match(numerada.join(' '), /Quita «Figura N» del pie de la figura del bloque 1/);
  const cinco = {
    ...buena,
    bloques: Array.from({ length: 5 }, (_, i) => ({ ...buena.bloques[0]!, subtitulo: `Parte ${i + 1}` })),
  };
  assert.match(erroresDeFiguras(cinco.bloques) ?? '', /El apartado trae 5 figuras y el máximo es 4/);
});

test('should_reject_uncovered_items_and_cubre_pointing_nowhere', () => {
  const a = apartadoCasoA(2, numeros(memoria(1)!));
  const r = enviar({
    ...a,
    cubre: [
      { item: 'Procedimiento de gestión de incidencias', bloque: 7 },
      { item: 'Indicadores de calidad del servicio', bloque: 2, parrafo: 4 },
      { item: 'Algo que no pide el pliego', bloque: 1 },
    ],
  });
  const m = r.error?.message ?? '';
  assert.match(
    m,
    /Faltan por cubrir estos puntos de «se valorará» del apartado «Gestión de incidencias y control de calidad»: «Mecanismos de control y seguimiento»\. Añade contenido que los trate y decláralos en «cubre» con su bloque\./,
  );
  assert.match(
    m,
    /«Procedimiento de gestión de incidencias» apunta al bloque 7, que no existe \(el apartado tiene 3\)/,
  );
  assert.match(m, /«Indicadores de calidad del servicio» apunta al párrafo 4 del bloque 2, que tiene 1/);
  assert.match(m, /«Algo que no pide el pliego» no es un punto de «se valorará» de este apartado/);
  const titulo = enviar({ ...a, titulo: 'Calidad' });
  assert.match(
    titulo.error?.message ?? '',
    /^El título debe ser el literal del guion: «Gestión de incidencias y control de calidad»\./,
  );
  const flojo = enviar({ ...a, compromisos: [{ que: 'Informe mensual', quien: '', cuando_o_medida: '' }] });
  assert.match(
    flojo.error?.message ?? '',
    /Cada compromiso necesita quién lo asume y cuándo o con qué medida: «Informe mensual»\./,
  );
});

test('should_reject_mentions_of_automatic_criteria_in_another_file', () => {
  const r = enviar(
    conTexto(3, 'Nuestro sistema de gestión ambiental está certificado conforme a la norma ISO-14001 desde hace años.'),
  );
  assert.match(
    r.error?.message ?? '',
    /El apartado menciona criterios automáticos que van en «Archivo electrónico nº 2» y no pueden aparecer en la memoria \(causa de exclusión\): «ISO 14001» \(bloque 2\)\. Quítalos\./,
  );
});

test('should_let_the_section_name_the_contracting_body_even_when_its_name_holds_a_vetoed_mark', () => {
  // El órgano es la «Sociedad Insular de Inclusión de Ejemplo» e
  // «inclusión» delata el criterio automático del plan de inclusión sociolaboral.
  const a = apartadoCasoA(1, numeros(memoria(1)!));
  const conNombre = (frase: string) => ({ ...a, bloques: [...a.bloques, { parrafos: [frase] }] });
  const base = contextoDeApartado(guionVigente(db, ID)!, 1, { propios: nombresPropiosDe(db, ID) })!;
  const contexto = {
    ...base,
    automaticos: [
      ...base.automaticos,
      { criterio: 'Plan de inclusión sociolaboral', archivo: 'Archivo electrónico nº 2', marcas: ['inclusión'] },
    ],
  };
  const automaticos = (frase: string) =>
    problemasDeApartado(conNombre(frase), contexto).filter((p) => p.includes('criterios automáticos'));
  assert.deepEqual(
    automaticos('El servicio se presta a la Sociedad Insular de Inclusión de Ejemplo, S.L. (SIIE) en toda la isla.'),
    [],
  );
  assert.equal(
    automaticos('Adscribiremos al contrato un plan de inclusión sociolaboral en la atención telefónica.').length,
    1,
    'fuera del nombre sigue vetado',
  );
});

test('should_reject_a_section_longer_than_its_quota_and_have_no_quota_without_limit', () => {
  const a = apartadoCasoA(4, numeros(memoria(1)!));
  const largo =
    'La empresa detalla en este párrafo cómo se organiza la mejora, con responsables, plazos e indicadores de seguimiento. '
      .repeat(25)
      .trim();
  a.bloques[0]!.parrafos = Array(5).fill(largo.slice(0, 2900));
  const r = enviar(a);
  assert.match(
    r.error?.message ?? '',
    /El apartado tiene \d{2}\.\d{3} caracteres y le corresponden unos 10\.800 \(≈ 4 páginas de las 25 del límite, por sus 4 puntos de 25\): recorta sin perder los puntos de «se valorará»\./,
  );
  assert.equal(cuotaDeApartado(null, 8, 25), null);
  assert.deepEqual(cuotaDeApartado(25, 8, 25), {
    caracteres: 23_700,
    objetivo: 20_600,
    minimo: 16_600,
    paginas: 8,
    limite: 25,
    reparto: 'por sus 8 puntos de 25',
  });
  assert.equal(cuotaIgual(25, 4)?.minimo, null, 'una memoria que no puntúa no tiene suelo');
});

test('should_aim_every_section_at_its_share_so_the_whole_memoria_fits_the_page_limit', () => {
  // 15 páginas y 3 apartados iguales: llenar cada cuota (con holgura) daba unas 16-17 páginas.
  const cuotas = [1, 2, 3].map(() => cuotaDeApartado(15, 10, 30)!);
  const objetivo = cuotas.reduce((s, q) => s + q.objetivo, 0);
  assert.ok(objetivo <= 13 * 2800, `objetivo total ${objetivo}`);
  assert.ok(
    cuotas.every((q) => q.objetivo < q.caracteres && q.minimo! < q.objetivo * 0.9),
    'la holgura queda solo como tope de rechazo',
  );
});

test('should_reject_a_scored_section_below_seventy_percent_of_its_quota_until_the_third_try', async () => {
  olvidarRechazos();
  const m = memoria(1)!;
  const corto = apartadoCasoA(4, numeros(m));
  corto.bloques = corto.bloques.map((b) => ({ ...b, lista: b.lista.slice(0, 2) }));
  const mensaje =
    /El apartado tiene \d\.\d{3} caracteres y le corresponden unos 10\.800 \(≈ 4 páginas de las 25 del límite, por sus 4 puntos de 25\): se queda corto, por debajo de 7\.600\. Desarrolla cada punto de «se valorará» con más contenido operativo/;
  const lici = await conectar(T_LICI);
  try {
    for (const n of [1, 2]) {
      const r = await lici.callTool({ name: 'licitaciones_memoria_apartado', arguments: corto });
      assert.equal(r.isError, true, `rechazo ${n}`);
      assert.match(texto(r), mensaje);
    }
    const tercera = await lici.callTool({ name: 'licitaciones_memoria_apartado', arguments: corto });
    assert.equal(tercera.isError, undefined, 'a la tercera entra, con aviso');
    assert.match(texto(tercera), /se queda corto/);
  } finally {
    await lici.close();
    // Los demás tests esperan el apartado sin recibir.
    db.prepare(
      "UPDATE memoria_apartados SET estado = 'pendiente', datos = NULL, caracteres = NULL, paginas_estimadas = NULL, avisos = '[]', rechazos = 0, agente = NULL, recibido_en = NULL, error = NULL WHERE memoria_id = ? AND apartado = 4",
    ).run(m.id);
    olvidarRechazos();
  }
  const sinLimite = contextoDeApartado(
    {
      ...guionVigente(db, ID)!,
      datos: GuionEntrada.parse(
        guionCon((g) => {
          g.memoria.limite_paginas = null;
        }),
      ),
    },
    4,
  )!;
  assert.deepEqual(problemasDeApartado(corto, sinLimite), [], 'sin límite de páginas no hay suelo');
});

test('should_reject_a_section_full_of_hedges_but_tolerate_a_couple', () => {
  const contexto = contextoDeApartado(guionVigente(db, ID)!, 2, { propios: nombresPropiosDe(db, ID) })!;
  const con = (frases: string[]) => {
    const a = apartadoCasoA(2, numeros(memoria(1)!));
    a.bloques[0]!.parrafos.push(...frases);
    return problemasDeApartado(a, contexto);
  };
  assert.deepEqual(
    con([
      'El informe incluirá, en su caso, las incidencias abiertas y su responsable.',
      'La reunión se hará en remoto si procede, con acta enviada en 24 horas.',
    ]),
    [],
    'dos sueltos se toleran',
  );
  const matizado = con([
    'El servicio no incluye la atención presencial y no equivale a una auditoría formal de la entidad.',
    'En la medida de lo posible se atenderán las consultas urgentes y, en su caso, se escalarán.',
    'Si procede, se revisará el procedimiento; no se oferta soporte fuera del horario de oficina.',
  ]).join(' ');
  assert.match(
    matizado,
    /El apartado matiza demasiado: 6 expresiones que restan \(«no incluye», «no equivale», «en la medida de lo posible», «en su caso», «si procede», «no se oferta»\) en unas \d+(,\d)? páginas\. Escribe en afirmativo, en presente o futuro de compromiso/,
  );
});

test('should_clean_internal_citations_from_the_team_instructions', () => {
  assert.equal(
    sinCitasInternas(
      'Marcar 1.1-1.3 solo con capturas (Bases, págs. 54-55) y describir la analítica como pide la CT 3.3.B (pág. 64).',
    ),
    'Marcar 1.1-1.3 solo con capturas y describir la analítica como pide la CT 3.3.B.',
  );
  assert.equal(
    sinCitasInternas(
      'Sin papel: lo dice la Memoria justificativa, pág. 13, y el PPT.pdf §4.2 lo repite (Bases, pp. 9 y 10).',
    ),
    'Sin papel: lo dice la Memoria justificativa, y el lo repite.',
  );
  assert.equal(
    sinCitasInternas('Equipo fijo con respuesta en 48 horas (p. ej. consultas de la Unidad Jurídica).'),
    'Equipo fijo con respuesta en 48 horas (p. ej. consultas de la Unidad Jurídica).',
    'un «p. ej.» no es una cita',
  );
});

test('should_accept_a_section_without_sources', () => {
  olvidarRechazos();
  const { fuentes: _fuentes, ...sinFuentes } = apartadoCasoA(3, numeros(memoria(1)!));
  const contexto = contextoDeApartado(guionVigente(db, ID)!, 3, { propios: nombresPropiosDe(db, ID) })!;
  const a = ApartadoEntrada.safeParse(sinFuentes);
  assert.ok(a.success, JSON.stringify(a.error?.issues));
  assert.deepEqual(problemasDeApartado(a.data, contexto), []);
});

test('should_reject_a_section_for_another_memoria_or_version', () => {
  const n = numeros(memoria(1)!);
  assert.equal(
    enviar(apartadoCasoA(1, { ...n, version: 2 })).error?.message,
    `Esa memoria es la v1 con el guion ${n.guion_id}; envía los números que te dio la tarea.`,
  );
  assert.equal(enviar(apartadoCasoA(1, { ...n, memoria_id: 9999 })).error?.code, 'not_found');
  assert.match(enviar({ ...apartadoCasoA(1, n), apartado: 9 }).error?.message ?? '', /«apartado» va de 1 a 4./);
});

test('should_assemble_docx_md_and_json_when_every_section_arrives', async () => {
  const m = memoria(1)!;
  for (const n of [1, 2, 3, 4]) reabrir(m.id, n);
  const lici = await conectar(T_LICI);
  try {
    for (const n of [1, 2, 3, 4]) {
      const r = await lici.callTool({ name: 'licitaciones_memoria_apartado', arguments: apartadoCasoA(n, numeros(m)) });
      assert.equal(r.isError, undefined, texto(r));
      const d = JSON.parse(texto(r)) as { recibidos: number; total: number; ensamblando?: boolean };
      assert.deepEqual([d.recibidos, d.total, d.ensamblando], [n, 4, undefined], 'no ensambla al llegar el último');
    }
  } finally {
    await lici.close();
  }
  assert.equal(memoria(1)!.estado, 'redactando', 'antes pasa por la crítica');
  const montada = await ensamblarMemoria(db, m.id);
  assert.equal(montada.error, null, montada.error?.message);
  const fin = memoria(1)!;
  assert.equal(fin.estado, 'ensamblada', fin.error ?? '');
  for (const ext of ['docx', 'md', 'json'])
    assert.ok(fs.existsSync(path.join(CARPETA_SALIDAS, `memoria-v1.${ext}`)), ext);
  assert.ok(!fs.existsSync(path.join(CARPETA_SALIDAS, 'memoria-v1.pdf')), 'sin LibreOffice no hay PDF');
  const b = db.prepare('SELECT * FROM borradores WHERE id = ?').get(fin.borrador_id) as {
    origen: string;
    agente: string;
    estado: string;
    ruta: string;
    ruta_md: string;
    ruta_pdf: string | null;
    paginas: number | null;
    paginas_estimadas: number;
  };
  assert.deepEqual(
    [b.origen, b.agente, b.estado, b.ruta, b.ruta_pdf, b.paginas],
    ['ensamblado', 'plataforma', 'pendiente', `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v1.docx`, null, null],
  );
  assert.ok(b.paginas_estimadas > 0);
  assert.match(JSON.parse(fin.avisos).join(' '), /LibreOffice está apagado/);
  assert.equal(eventos('licitacion.memoria')[0]?.datos['accion'], 'ensamblada');
  assert.deepEqual(eventos('licitacion.borrador')[0]?.datos, { agente: 'plataforma', borrador: fin.borrador_id });
  const apartado = eventos('licitacion.memoria').find((e) => e.datos['accion'] === 'apartado');
  assert.deepEqual(apartado?.datos, {
    accion: 'apartado',
    version: 1,
    apartado: 4,
    recibidos: 4,
    total: 4,
    memoria: m.id,
  });
});

test('should_write_a_docx_that_reads_back_with_the_literal_titles_in_order', async () => {
  const r = await extraerDocumento(path.join(CARPETA_SALIDAS, 'memoria-v1.docx'));
  assert.equal(r.error, null);
  const textoDocx = r.data!.pages.join('\n');
  const titulos = [
    '1. Organización y metodología del servicio',
    '2. Gestión de incidencias y control de calidad',
    '3. Asesoramiento y acompañamiento',
    '4. Mejoras vinculadas al objeto del contrato',
  ];
  const posiciones = titulos.map((t) => textoDocx.lastIndexOf(t));
  assert.ok(
    posiciones.every((p) => p >= 0),
    'están los cuatro títulos',
  );
  assert.deepEqual(
    [...posiciones].sort((a, b) => a - b),
    posiciones,
    'en el orden del pliego',
  );
  for (const t of [
    'Memoria técnica',
    'Analítica Ejemplo SL',
    'B12345678',
    'Calle Ejemplo 7',
    'EXP-2026-0412',
    'Coordinación con la Asesoría Jurídica',
  ])
    assert.ok(textoDocx.includes(t), t);
  const md = fs.readFileSync(path.join(CARPETA_SALIDAS, 'memoria-v1.md'), 'utf8');
  assert.ok(md.includes('1. Organización y metodología del servicio'));
  const j = JSON.parse(fs.readFileSync(path.join(CARPETA_SALIDAS, 'memoria-v1.json'), 'utf8')) as {
    version: number;
    apartados: { estado: string }[];
  };
  assert.deepEqual([j.version, j.apartados.map((a) => a.estado)], [1, Array(4).fill('recibido')]);
});

test('should_estimate_pages_and_warn_when_over_the_limit', async () => {
  // Los apartados entran con el límite del pliego; el mismo guion con un límite de 1 página hace que el ensamblado avise.
  const g = guionVigente(db, ID)!;
  try {
    const p = pedirMemoria(nucleo().db, db, salidas, ID);
    assert.equal(p.data?.version, 2);
    enRedaccion(2);
    for (const n of [1, 2, 3, 4])
      assert.equal(
        recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(n, numeros(memoria(2)!))), 'licitaciones').error,
        null,
      );
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(
      JSON.stringify({ ...g.datos, memoria: { ...g.datos.memoria, limite_paginas: 1 } }),
      g.id,
    );
    const montada = await ensamblarMemoria(db, memoria(2)!.id);
    assert.equal(montada.error, null, montada.error?.message);
    const fin = memoria(2)!;
    assert.match(
      JSON.parse(fin.avisos).join(' '),
      /La memoria ocupa unas \d+ páginas \(estimadas\) y el pliego limita a 1\./,
    );
    const estado = (
      await leer<{
        memorias: { version: number; paginas: number | null; paginas_estimadas: number; limite_paginas: number }[];
      }>(api(`/licitaciones/${ID}/oferta`, undefined, 'GET'))
    ).memorias[0]!;
    assert.deepEqual([estado.version, estado.paginas, estado.limite_paginas], [2, null, 1]);
    assert.ok(estado.paginas_estimadas >= 2);
  } finally {
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(g.datos), g.id);
  }
});

test('should_assemble_with_a_placeholder_when_a_section_was_never_written', async () => {
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  enRedaccion(3);
  for (const n of [1, 2, 3]) assert.equal(enviar(apartadoCasoA(n, numeros(memoria(3)!))).error, null);
  assert.equal(memoria(3)?.estado, 'redactando', 'espera al cuarto');
  assert.equal((await ensamblarMemoria(db, p.memoria)).error?.code, 'conflicto', 'con un apartado pendiente no monta');
  // El run de redacción terminó sin dejar el apartado 4: la memoria queda fallida y una persona la monta con lo que hay.
  db.prepare(
    "UPDATE memoria_apartados SET estado = 'fallido', error = 'El run terminó sin dejar el apartado.' WHERE memoria_id = ? AND apartado = 4",
  ).run(p.memoria);
  db.prepare("UPDATE memorias SET estado = 'fallida', fase = 'fin' WHERE id = ?").run(p.memoria);

  const e = await ensamblarMemoria(db, p.memoria);

  assert.equal(e.error, null, e.error?.message);
  const fin = memoria(3)!;
  assert.equal(fin.estado, 'ensamblada');
  assert.match(JSON.parse(fin.avisos).join(' '), /El apartado 4 no se redactó\./);
  const md = fs.readFileSync(path.join(CARPETA_SALIDAS, 'memoria-v3.md'), 'utf8');
  assert.ok(md.includes(SIN_REDACTAR));
  assert.equal(fin.borrador_id !== null, true);
});

test('should_not_assemble_the_same_memoria_twice_at_once', async () => {
  const m = memoria(3)!;
  db.prepare("UPDATE memorias SET estado = 'fallida' WHERE id = ?").run(m.id);
  const [a, b] = await Promise.all([ensamblarMemoria(db, m.id), ensamblarMemoria(db, m.id)]);
  assert.equal([a, b].filter((r) => r.error === null).length, 1);
  assert.equal([a, b].find((r) => r.error)?.error?.code, 'conflicto');
  assert.ok(fs.existsSync(path.join(CARPETA_SALIDAS, 'memoria-v3-2.docx')), 'no pisa la anterior');
  assert.equal((await ensamblarMemoria(db, m.id)).error?.message, 'Esa memoria ya está ensamblada (v3).');
  const reintento = await api(`/licitaciones/${ID}/oferta/memoria/3/ensamblar`);
  assert.equal(reintento.status, 409);
  assert.equal((await api(`/licitaciones/${ID}/oferta/memoria/99/ensamblar`)).status, 404);
});

test('should_invalidate_the_decisions_when_the_outline_changes', async () => {
  const antes = guionVigente(db, ID)!.version;
  // Un guion idéntico ya no desfasa nada (rebase.ts): cambian un criterio automático (las decisiones) y lo que se valora en un apartado (la memoria).
  const cambiado = guionCon((g) => {
    g.automaticos[0]!.puntos = 12;
    g.memoria.apartados[1]!.se_valorara.push('Plan de mejora continua');
  });
  assert.equal((await proponerGuion(db, GuionEntrada.parse(cambiado), 'licitaciones')).error, null);
  const oferta = await leer<{ guion_cambiado: boolean; memorias: { guion_cambiado: boolean }[] }>(
    api(`/licitaciones/${ID}/oferta`, undefined, 'GET'),
  );
  assert.equal(oferta.guion_cambiado, true);
  assert.equal(oferta.memorias[0]?.guion_cambiado, true);
  const r = await api(`/licitaciones/${ID}/oferta/memoria`);
  assert.equal(r.status, 409);
  assert.equal(
    ((await r.json()) as { message: string }).message,
    `Las decisiones se fijaron con el guion v${antes} y el vigente es el v${antes + 1}: revísalas y guárdalas otra vez.`,
  );
  assert.equal((await api(`/licitaciones/${ID}/oferta/decisiones`, decisionesCasoA(PERSONAS), 'PUT')).status, 200);
  assert.equal(
    (await leer<{ guion_cambiado: boolean }>(api(`/licitaciones/${ID}/oferta`, undefined, 'GET'))).guion_cambiado,
    false,
  );
});

test('should_offer_the_writing_tools_only_to_agents_that_may_propose_and_names_only_with_colaboradores', async () => {
  const claude = await conectar(T_CLAUDE);
  const curioso = await conectar(T_CURIOSO);
  const lici = await conectar(T_LICI);
  try {
    const nombres = (await claude.listTools()).tools.map((t) => t.name);
    assert.ok(nombres.includes('licitaciones_oferta'));
    assert.ok(!nombres.includes('licitaciones_guion') && !nombres.includes('licitaciones_memoria_apartado'));
    const conNombres = texto(await claude.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }));
    assert.ok(conNombres.includes('Ana García Pérez'));
    const sinNombres = texto(await curioso.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }));
    assert.ok(
      !sinNombres.includes('Ana García') && !sinNombres.includes('Responsable del servicio",\n          "cuando'),
      'ni nombres ni compromisos',
    );
    // «precio» sí sale como categoría de un bloqueo; lo que no sale es ninguna clave con el importe.
    assert.ok(!/"precio":\{|"ofertas"|"importe"/.test(sinNombres), 'el precio no se da');
    const apartado = JSON.parse(
      texto(await lici.callTool({ name: 'licitaciones_oferta', arguments: { id: ID, apartado: 1 } })),
    ) as { apartado: { titulo: string; cuota: { caracteres: number } } };
    assert.deepEqual(
      [apartado.apartado.titulo, apartado.apartado.cuota.caracteres],
      ['Organización y metodología del servicio', 23_700],
    );
    assert.equal(
      (await lici.callTool({ name: 'licitaciones_oferta', arguments: { id: ID, apartado: 9 } })).isError,
      true,
    );
  } finally {
    await Promise.all([claude.close(), curioso.close(), lici.close()]);
  }
});

test('should_read_decisions_saved_before_wave_4_with_null_annex_data_and_cost', () => {
  const vieja = {
    lotes: [],
    equipo: [{ persona_id: 1, rol_en_la_oferta: 'Jefa de proyecto' }],
    ofertas: [{ lote: null, pendiente: false, importe: 1000 }],
  };

  const leida = Decisiones.parse(vieja);

  assert.deepEqual(leida.datos_anexo, { subcontratacion_servidores: null, orden_lotes: null, impuesto: null });
  assert.equal(leida.ofertas[0]!.coste_estimado, null);
  assert.equal(leida.equipo[0]!.origen, undefined);
});

test('should_reject_annex_tax_percentage_above_30', () => {
  const con = (porcentaje: number) => Decisiones.safeParse({ datos_anexo: { impuesto: { tipo: 'IGIC', porcentaje } } });

  assert.equal(con(31).success, false);
  assert.equal(con(7).success, true);
});

test('should_never_send_estimated_cost_to_the_agent', async () => {
  const fila = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(ID) as { datos: string };
  const con = {
    ...JSON.parse(fila.datos),
    ofertas: [{ lote: null, pendiente: false, importe: 1000, coste_estimado: 777_123 }],
  };
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(con), ID);
  const claude = await conectar(T_CLAUDE);
  try {
    const visto = texto(await claude.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }));

    assert.ok(!visto.includes('coste_estimado') && !visto.includes('777123'), 'el coste propio no sale');
  } finally {
    await claude.close();
    db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(fila.datos, ID);
  }
});

test('should_expose_the_outline_in_the_detail_and_the_memorias_in_the_proposal', async () => {
  const d = detalle(db, ID).data!;
  assert.deepEqual(d.oferta.guion && { ...d.oferta.guion }, {
    version: guionVigente(db, ID)!.version,
    apartados: 4,
    limite_paginas: 25,
  });
  assert.deepEqual(
    [d.oferta.decisiones_fijadas, d.oferta.guion_cambiado, d.oferta.memoria?.version, d.oferta.memoria?.estado],
    [true, false, 3, 'ensamblada'],
  );
  assert.ok(!JSON.stringify(d.oferta).includes('Ana'), 'sin datos personales');
  const claude = await conectar(T_CLAUDE);
  try {
    assert.match(
      texto(await claude.callTool({ name: 'licitaciones_ver', arguments: { id: ID } })),
      /"oferta":\{"guion":\{"version":\d+,"apartados":4,"limite_paginas":25\}/,
    );
  } finally {
    await claude.close();
  }
  const p = await leer<{
    guion: { apartados: number };
    memorias: { version: number; borrador: { ruta: string } | null }[];
    borradores: { origen: string }[];
  }>(api(`/licitaciones/${ID}/propuesta`, undefined, 'GET'));
  assert.equal(p.guion.apartados, 4);
  assert.deepEqual(
    p.memorias.map((m) => m.version),
    [3, 2, 1],
  );
  assert.equal(p.memorias[2]?.borrador?.ruta, `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v1.docx`);
  assert.ok(p.borradores.every((b) => b.origen === 'ensamblado'));
  const oferta = await leer<Record<string, unknown>>(api(`/licitaciones/${ID}/oferta`, undefined, 'GET'));
  assert.deepEqual(
    Object.keys(oferta).sort(),
    [
      'coherencia',
      'decisiones',
      'decisiones_problemas',
      'ficha_aprobada',
      'guion',
      'guion_cambiado',
      'guion_desfasado',
      'guion_en_curso',
      'lotes_cambiados',
      'memoria_lotes',
      'memorias',
      'paquete',
      'pliegos_listos',
      'precios_sugeridos',
      'presentada_o_vencida',
      'propuesta_decisiones',
      'propuesta_en_curso',
      'salidas_configurado',
    ].sort(),
  );
  assert.deepEqual(
    [oferta['ficha_aprobada'], oferta['salidas_configurado'], oferta['pliegos_listos'], oferta['coherencia']],
    [true, true, true, []],
  );
  const m = (oferta['memorias'] as Record<string, unknown>[])[0]!;
  assert.deepEqual(
    Object.keys(m).sort(),
    [
      'anonimato',
      'apartados',
      'avisos',
      'borrador',
      'ensamblada_en',
      'ensayo',
      'error',
      'estado',
      'evaluacion',
      'evaluacion_en_curso',
      'fugas',
      'guion_cambiado',
      'guion_id',
      'id',
      'lecciones',
      'lecciones_en_curso',
      'limite_paginas',
      'lote',
      'mejorable',
      'notas_subida',
      'origen',
      'paginas',
      'paginas_estimadas',
      'pedida_en',
      'presentada',
      'presentada_sustituida',
      'sin_repartir',
      'progreso',
      'valorable',
      'version',
    ].sort(),
  );
});

const MOTIVO_ACEPTAR = 'Revisada: el aviso no cambia lo que se presenta.';

test('should_accept_or_discard_the_assembled_memoria_through_the_draft_patch', async () => {
  const b = memoria(1)!.borrador_id!;
  // La v1 trae un aviso: como en «Dar por buena», el PATCH pide el motivo.
  const rr = await api(`/borradores/${b}`, { decision: 'aceptar', motivo: MOTIVO_ACEPTAR }, 'PATCH');
  assert.equal(rr.status, 200, await rr.text());
  const estado = await leer<{ memorias: { version: number; borrador: { estado: string } }[] }>(
    api(`/licitaciones/${ID}/oferta`, undefined, 'GET'),
  );
  assert.equal(estado.memorias.find((m) => m.version === 1)?.borrador.estado, 'aceptada');
  assert.equal((await api(`/borradores/${memoria(2)!.borrador_id}`, { decision: 'descartar' }, 'PATCH')).status, 200);
  const otra = await leer<{ memorias: { version: number; borrador: { estado: string } }[] }>(
    api(`/licitaciones/${ID}/oferta`, undefined, 'GET'),
  );
  assert.equal(
    otra.memorias.find((m) => m.version === 2)?.borrador.estado,
    'descartada',
    'la memoria sigue enseñando su borrador descartado',
  );
});

test('should_discard_older_unreviewed_versions_on_a_new_one_and_every_other_version_on_accepting', async () => {
  const borrador = (v: number) => memoria(v)!.borrador_id!;
  const estado = (v: number) =>
    (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(borrador(v)) as { estado: string }).estado;
  db.prepare("UPDATE borradores SET estado = 'pendiente' WHERE licitacion_id = ? AND origen = 'ensamblado'").run(ID);
  assert.equal(
    (await api(`/borradores/${borrador(1)}`, { decision: 'aceptar', motivo: MOTIVO_ACEPTAR }, 'PATCH')).status,
    200,
  );
  assert.deepEqual(
    [estado(1), estado(2), estado(3)],
    ['aceptada', 'descartada', 'descartada'],
    'aceptar una deja solo esa',
  );
  db.prepare("UPDATE borradores SET estado = 'pendiente' WHERE id = ?").run(borrador(2));
  descartarVersionesSinRevisar(db, ID, borrador(3), 3);
  assert.deepEqual(
    [estado(1), estado(2)],
    ['aceptada', 'descartada'],
    'al llegar la v3, la v2 sin revisar se descarta y la aceptada se queda',
  );
});

test('should_keep_the_rejection_window_shared_by_ficha_guion_and_sections', () => {
  olvidarRechazos();
  const hoy = new Date();
  const fallo = (herramienta: string, recurso: string, haceMin: number) =>
    nucleo()
      .db.prepare(
        `INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en)
    VALUES ('licitaciones', ?, 'licitaciones', ?, 'error', ?)`,
      )
      .run(herramienta, recurso, new Date(hoy.getTime() - haceMin * 60_000).toISOString());
  fallo('licitaciones_ficha', ID, 5);
  assert.equal(exigirRevision(db, 'licitaciones_ficha', ID, hoy), true, 'un rechazo: se sigue exigiendo');
  fallo('licitaciones_ficha', ID, 10);
  assert.equal(exigirRevision(db, 'licitaciones_ficha', ID, hoy), false, 'dos rechazos: se acepta con avisos');
  assert.equal(exigirRevision(db, 'licitaciones_guion', ID, hoy), true, 'cada herramienta cuenta los suyos');
  fallo('licitaciones_memoria_apartado', `${ID}#v1#a1`, 50);
  fallo('licitaciones_memoria_apartado', `${ID}#v1#a1`, 60);
  assert.equal(
    exigirRevision(db, 'licitaciones_memoria_apartado', `${ID}#v1#a1`, hoy),
    true,
    'fuera de la ventana de 40 minutos no cuentan',
  );
  olvidarRechazos();
});

function propuestaCasoA(
  cambio: (
    p: Record<string, unknown> & {
      enfoque: string;
      automaticos: {
        criterio: string;
        tipo: string;
        nos_acogemos: boolean;
        capacidad?: string;
        cumple?: string;
        evidencia?: string;
        motivo: string;
      }[];
    },
  ) => void = () => undefined,
) {
  const p = {
    id: ID,
    guion_id: guionVigente(db, ID)!.id,
    lotes: [],
    equipo: [
      {
        persona_id: PERSONAS[0]!,
        rol_en_la_oferta: 'Responsable del servicio',
        motivo: 'Ocho años de contratación pública en su CV.',
      },
    ],
    automaticos: GUION_CASO_A.automaticos.map((a) =>
      a.criterio.startsWith('Mejora')
        ? {
            criterio: a.criterio,
            tipo: 'compromiso',
            nos_acogemos: true,
            tramo: a.criterio,
            capacidad: 'demostrada',
            evidencia: 'Perfil de la empresa: turnos de soporte de 2025.',
            motivo: 'Compromiso de prestación: cabe en los turnos actuales.',
          }
        : {
            criterio: a.criterio,
            tipo: 'acreditacion',
            cumple: 'no',
            nos_acogemos: false,
            motivo: 'No consta en el perfil de la empresa.',
          },
    ),
    herramientas: ['PLACSP'],
    enfoque: 'Equipo fijo que responde en plazo, coordinación semanal con la Asesoría Jurídica y formación práctica.',
    resumen: 'Dos personas y las tres mejoras, que caben en los turnos; confirma la plantilla.',
  };
  cambio(p);
  return PropuestaDecisionesEntrada.parse(p);
}

test('should_propose_decisions_with_proven_tiers_without_touching_the_saved_ones', async () => {
  olvidarRechazos();
  const flojo = proponerDecisiones(
    db,
    nucleo().db,
    propuestaCasoA((p) => {
      p.automaticos[2]!.capacidad = 'parcial';
      delete p.automaticos[3]!.evidencia;
    }),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.match(
    flojo.error?.message ?? '',
    /^Solo nos acogemos al tramo que podemos demostrar hoy: «Mejora 1: bolsa de horas adicionales» van con capacidad «demostrada» o con nos_acogemos false/,
  );
  assert.match(
    flojo.error?.message ?? '',
    /Di dónde consta que podemos cumplirlo \(«evidencia»: perfil de la empresa, CV de quién o documento de la Biblioteca\): «Mejora 2: formación adicional»\./,
  );
  const incoherente = proponerDecisiones(
    db,
    nucleo().db,
    propuestaCasoA((p) => {
      p.automaticos[0] = {
        ...p.automaticos[0]!,
        cumple: 'falta_dato',
        nos_acogemos: true,
        capacidad: 'demostrada',
        evidencia: 'Lo dice alguien.',
      } as never;
      delete (p.automaticos[1] as { cumple?: string }).cumple;
    }),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.match(
    incoherente.error?.message ?? '',
    /Cada acreditación, y cada compromiso que el pliego pide acreditar con un documento o un hecho \(dossier, certificado, plataforma existente\), lleva «cumple» \(si, no o falta_dato\): «Plantilla con discapacidad igual o superior al 10 %»\./,
  );
  assert.match(
    incoherente.error?.message ?? '',
    /Con cumple «no» o «falta_dato» va nos_acogemos false: «Certificado ISO 14001»\./,
  );
  const enNegativo = proponerDecisiones(
    db,
    nucleo().db,
    propuestaCasoA((p) => {
      p.enfoque = `${p.enfoque} No prometer presencia diaria (Bases, pp. 12).`;
    }),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.match(enNegativo.error?.message ?? '', /Quita del enfoque las citas del pliego \(«\(Bases, pp\. 12\)»\)/);
  assert.match(enNegativo.error?.message ?? '', /Escribe el enfoque en positivo/);
  olvidarRechazos();
  olvidarRechazos();
  const viejo = proponerDecisiones(
    db,
    nucleo().db,
    propuestaCasoA((p) => {
      p['guion_id'] = 1;
    }),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.match(
    viejo.error?.message ?? '',
    /^El guion vigente es el \d+ \(v\d+\): vuelve a leerlo con licitaciones_oferta/,
  );
  const guardadas = (
    await leer<{ decisiones: { actualizada_en: string } }>(api(`/licitaciones/${ID}/oferta`, undefined, 'GET'))
  ).decisiones.actualizada_en;
  assert.equal(
    proponerDecisiones(db, nucleo().db, propuestaCasoA(), 'oferta-licitaciones', { revisar: true }).error,
    null,
  );
  const o = await leer<{
    decisiones: { actualizada_en: string };
    propuesta_decisiones: {
      decisiones: {
        automaticos: { criterio: string; nos_acogemos: boolean; nota: string }[];
        ofertas: { pendiente: boolean }[];
      };
    };
    precios_sugeridos: unknown;
  }>(api(`/licitaciones/${ID}/oferta`, undefined, 'GET'));
  assert.equal(o.decisiones.actualizada_en, guardadas, 'la propuesta no pisa las decisiones');
  const mejora = o.propuesta_decisiones.decisiones.automaticos.find((a) => a.criterio.startsWith('Mejora 2'))!;
  assert.deepEqual(
    [mejora.nos_acogemos, mejora.nota],
    [true, 'Compromiso de prestación: cabe en los turnos actuales.'],
  );
  assert.ok(
    o.propuesta_decisiones.decisiones.ofertas.every((x) => x.pendiente),
    'el precio no lo propone Hermes',
  );
  assert.ok('precios_sugeridos' in o);
  const cc = await conectar(T_CLAUDE);
  try {
    const leida = JSON.parse(texto(await cc.callTool({ name: 'licitaciones_oferta', arguments: { id: ID } }))) as {
      propuesta_decisiones: { resumen: string; equipo: { motivo?: string }[] };
    };
    assert.equal(
      leida.propuesta_decisiones.resumen,
      'Dos personas y las tres mejoras, que caben en los turnos; confirma la plantilla.',
    );
    assert.ok(leida.propuesta_decisiones.equipo[0]?.motivo, 'con permiso de colaboradores, con el motivo');
  } finally {
    await cc.close();
  }
  olvidarRechazos();
});

test('should_reject_an_approach_that_leaks_an_automatic_criterion', () => {
  olvidarRechazos();
  const fuga = propuestaCasoA((p) => {
    p.enfoque = `${p.enfoque} Destacar la gestión ambiental certificada con ISO 14001.`;
  });
  for (let i = 0; i < 4; i += 1) {
    const r = proponerDecisiones(db, nucleo().db, fuga, 'oferta-licitaciones', { revisar: true });
    assert.match(
      r.error?.message ?? '',
      /^El enfoque delata lo que va en otro sobre: .*ISO 14001/,
      'ni al cuarto envío: es un error duro',
    );
  }
  olvidarRechazos();
});

test('should_ask_for_evidence_before_marking_a_commitment_the_tender_accredits_with_a_document', () => {
  // CASO_E, criterios 2.3 y 2.4: exigen el dossier técnico homologado del fabricante, que la empresa no tiene.
  const guion = {
    memoria: null,
    automaticos: [
      {
        ...GUION_CASO_A.automaticos[0]!,
        criterio: '2.3 Indicadores de riesgo',
        como_se_acredita: 'Se acredita con el Dossier Técnico Homologado del fabricante.',
      },
    ],
  } as never;
  const propuesta = (a: Record<string, unknown>) =>
    ({
      lotes: [],
      equipo: [],
      herramientas: [],
      enfoque: 'x'.repeat(60),
      resumen: 'Resumen de prueba.',
      automaticos: [
        { criterio: '2.3 Indicadores de riesgo', tipo: 'compromiso', motivo: 'Lo ofrece la plataforma.', ...a },
      ],
    }) as never;
  assert.match(
    problemasDePropuesta(
      propuesta({
        nos_acogemos: true,
        tramo: '5 indicadores',
        capacidad: 'demostrada',
        evidencia: 'Consta en el perfil de la empresa.',
      }),
      guion,
    ).join(' '),
    /lleva «cumple» \(si, no o falta_dato\): «2\.3 Indicadores de riesgo»/,
  );
  assert.match(
    problemasDePropuesta(
      propuesta({
        nos_acogemos: true,
        tramo: '5 indicadores',
        capacidad: 'demostrada',
        evidencia: 'Consta en el perfil de la empresa.',
        cumple: 'falta_dato',
      }),
      guion,
    ).join(' '),
    /Con cumple «no» o «falta_dato» va nos_acogemos false/,
  );
  assert.deepEqual(
    problemasDePropuesta(propuesta({ nos_acogemos: false, cumple: 'no' }), guion),
    [],
    'sin el dossier, false con su motivo',
  );
});

test('should_queue_the_proposal_on_a_new_outline_unless_the_decisions_were_saved_on_it', () => {
  const contar = () =>
    (
      nucleo().db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = 'licitaciones.decisiones'").get() as {
        n: number;
      }
    ).n;
  const antes = contar();
  proponerAlLlegarGuion(nucleo().db, db, ID);
  assert.equal(contar(), antes, 'decisiones guardadas sobre este guion: no se pide');
  const r = pedirPropuestaDecisiones(nucleo().db, db, ID, true);
  assert.equal(contar(), antes + 1, 'a mano, sí');
  assert.ok(r.data!.trabajo > 0);
  assert.equal(pedirPropuestaDecisiones(nucleo().db, db, SIN_GUION, true).error?.code, 'invalid_input');
  const inst = instruccionesPropuestaDecisiones(ID, 7, 'Analítica Ejemplo');
  assert.match(inst, /EL TRAMO MÁS ALTO CON CAPACIDAD DEMOSTRADA/);
  assert.doesNotMatch(inst, /SIEMPRE con nos_acogemos true/);
  assert.match(inst, /una persona por categoría/);
  assert.match(inst, /ya trae «decisiones» guardadas, son de un guion anterior y no se tocan/);
  assert.match(inst, /licitaciones_decisiones con id=p-91000710, guion_id=7/);
});

test('should_suggest_a_balanced_and_a_maximum_price_below_the_abnormal_threshold', () => {
  const ganadoras = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.22, 0.25, 0.3, 0.4];
  const r = opcionesDePrecio(ganadoras, 0.35, 100_000);
  assert.deepEqual(r.equilibrio, { baja: 0.25, importe: 75_000, ganadas: 0.8 });
  assert.deepEqual(r.maxima, { baja: 0.34, importe: 66_000, ganadas: 0.9 });
  assert.deepEqual(
    opcionesDePrecio(ganadoras, 0.2, 100_000).equilibrio,
    { baja: 0.19, importe: 81_000, ganadas: 0.5 },
    'el equilibrio nunca pasa el umbral',
  );
  assert.equal(opcionesDePrecio(ganadoras, null, 100_000).maxima?.baja, 0.4, 'sin umbral, la mayor baja ganadora');
  assert.deepEqual(opcionesDePrecio(ganadoras, 0.35, 1.54, true).equilibrio, {
    baja: 0.25,
    importe: 1.155,
    ganadas: 0.8,
  });
  assert.deepEqual(opcionesDePrecio([], 0.35, 100_000), { equilibrio: null, maxima: null });
});

test('should_keep_the_outline_and_section_examples_of_the_hermes_skill_valid', () => {
  const md = leerSkill();
  const ejemplo = (seccion: string) => {
    const inicio = md.indexOf('```json', md.indexOf(seccion)) + '```json'.length;
    return JSON.parse(md.slice(inicio, md.indexOf('```', inicio))) as unknown;
  };
  const g = GuionEntrada.safeParse(ejemplo('## Guion de la oferta'));
  assert.ok(g.success, JSON.stringify(g.error?.issues));
  const a = ApartadoEntrada.safeParse(ejemplo('## Reglas de cada apartado'));
  assert.ok(a.success, JSON.stringify(a.error?.issues));
  // El ejemplo enseña la forma, recortado: la extensión se mide aparte (suelo de la cuota).
  const conCuota = contextoDeApartado({ ...guionVigente(db, ID)!, datos: g.data }, a.data.apartado)!;
  assert.deepEqual(
    problemasDeApartado(a.data, conCuota).map((p) => /se queda corto/.test(p)),
    [true],
    'solo le falta extensión',
  );
  const contexto = { ...conCuota, cuota: null };
  assert.deepEqual(problemasDeApartado(a.data, contexto), [], 'el ejemplo se acepta a la primera');
  const f = ApartadoDatos.shape.bloques.element.safeParse(ejemplo('### Figuras'));
  assert.ok(f.success, JSON.stringify(f.error?.issues));
  assert.equal(erroresDeFiguras([f.data]), null, 'la figura de ejemplo se dibuja');
  assert.deepEqual(
    problemasDeApartado({ ...a.data, bloques: [...a.data.bloques, f.data] }, contexto),
    [],
    'y no añade problemas',
  );
  const d = PropuestaDecisionesEntrada.safeParse(ejemplo('## Proponer las decisiones de la oferta'));
  assert.ok(d.success, JSON.stringify(d.error?.issues));
  assert.deepEqual(problemasDePropuesta(d.data, g.data), []);
  assert.deepEqual(
    d.data.automaticos.map((x) => x.criterio),
    g.data.automaticos.map((x) => x.criterio),
    'un criterio por cada uno del guion',
  );
  const l = LeccionesEntrada.safeParse(ejemplo('## Aprender de una versión editada a mano'));
  assert.ok(l.success, JSON.stringify(l.error?.issues));
});

test('should_store_a_hand_edited_word_as_the_next_version_split_by_the_outline_sections', async () => {
  db.prepare(
    "UPDATE memorias SET estado = 'fallida' WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando')",
  ).run(ID);
  // Los tests anteriores ya gastaron el tope diario de autoevaluaciones de esta oferta: se dan por de ayer.
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET creado_en = ? WHERE clave LIKE 'evaluacion-memoria-%'")
    .run(new Date(Date.now() - 2 * 86_400_000).toISOString());
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const texto =
    'La empresa revisó a mano este apartado: responsables, plazos e indicadores quedan como los acordó el equipo.';
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '12 de octubre de 2026',
    },
    apartados: titulos.slice(0, 3).map((t, i) => ({
      numero: String(i + 1),
      titulo: t,
      bloques: [{ parrafos: [texto] }, { subtitulo: 'Equipo', parrafos: [texto] }],
    })),
    pie: { texto: '', numeracion: true },
  });
  const subir = (datos: Buffer, nombre: string) => {
    const form = new FormData();
    form.append('archivo', new Blob([new Uint8Array(datos)]), nombre);
    return fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, { method: 'POST', body: form });
  };
  const antes = (db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(ID) as { v: number })
    .v;
  const r = await subir(docx, 'memoria-revisada-paco.docx');
  assert.equal(r.status, 201, await r.clone().text());
  const s = await leer<{ version: number; reconocidos: number; total: number; avisos: string[]; ruta: string }>(r);
  assert.deepEqual([s.version, s.reconocidos, s.total], [antes + 1, 3, titulos.length]);
  assert.match(s.avisos.join(' '), /No encuentro en el Word el apartado 4/);
  assert.ok(
    fs.existsSync(path.join(salidas, s.ruta.replace(/^Salidas\//, ''))),
    'el Word subido se guarda tal cual en Salidas',
  );
  const m = memoria(s.version)!;
  assert.equal(m.estado, 'ensamblada');
  const a1 = db
    .prepare('SELECT estado, agente, datos FROM memoria_apartados WHERE memoria_id = ? AND apartado = 1')
    .get(m.id) as { estado: string; agente: string; datos: string };
  assert.deepEqual(
    [
      a1.estado,
      a1.agente,
      (JSON.parse(a1.datos) as { bloques: { subtitulo?: string }[] }).bloques.map((b) => b.subtitulo ?? null),
    ],
    ['recibido', 'persona', [null, 'Equipo']],
  );
  const b = db.prepare('SELECT origen, agente, estado FROM borradores WHERE id = ?').get(m.borrador_id) as {
    origen: string;
    agente: string;
    estado: string;
  };
  assert.deepEqual(
    b,
    { origen: 'ensamblado', agente: 'persona', estado: 'pendiente' },
    'se revisa como cualquier versión',
  );
  assert.ok(
    nucleo().db.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?').get(`evaluacion-memoria-${ID}-v${s.version}`),
    'Hermes la evalúa sola',
  );
  const e = (
    await leer<{
      memorias: { version: number; origen: { subida: string | null; version_base: number | null } | null }[];
    }>(api('/licitaciones/' + ID + '/oferta/memoria', undefined, 'GET'))
  ).memorias[0]!;
  assert.deepEqual(
    [e.version, e.origen?.subida, e.origen?.version_base],
    [s.version, 'memoria-revisada-paco.docx', antes],
  );
  // Un PDF o un Word sin los títulos del guion ya no se rechazan: memoriaSubidaFlexible.test.ts.
  const txt = await subir(Buffer.from('hola'), 'memoria.txt');
  assert.deepEqual(
    [txt.status, (await leer<{ message: string }>(txt)).message],
    [400, 'Formato no admitido: sube un archivo .pdf o .docx.'],
  );
});

test('should_learn_from_a_hand_edited_version_with_the_persons_notes_and_the_changed_paragraphs', async () => {
  db.prepare(
    "UPDATE memorias SET estado = 'fallida' WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando')",
  ).run(ID);
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const nuevo =
    'Paco Ejemplo Gómez, responsable de proyecto, tendrá el entorno listo en la semana 2 y lo revisará cada lunes con la entidad.';
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '12 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({ numero: String(i + 1), titulo: t, bloques: [{ parrafos: [nuevo] }] })),
    pie: { texto: '', numeracion: true },
  });
  const form = new FormData();
  const notas =
    `He quitado los condicionales y he puesto a Paco como responsable en todos los apartados. ${'Detalle de lo cambiado en cada apartado. '.repeat(400)}`.trim();
  form.append('notas', notas);
  form.append('archivo', new Blob([new Uint8Array(docx)]), 'memoria-paco.docx');
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, {
    method: 'POST',
    body: form,
  });
  const s = await leer<{ version: number; memoria: number; aprende: boolean }>(r);
  assert.equal(r.status, 201);
  assert.equal(s.aprende, true, 'hay nota: Hermes aprende de ella');
  assert.equal(memoria(s.version)!.notas_subida, notas, `la nota entera, sin cortar (${notas.length} caracteres)`);
  const t = nucleo()
    .db.prepare('SELECT payload FROM trabajos_ia WHERE clave = ?')
    .get(`lecciones-${ID}-v${s.version}`) as { payload: string };
  const inst = instruccionesLecciones(db, PayloadLecciones.parse(JSON.parse(t.payload)));
  assert.match(
    inst,
    /LO QUE DICE QUIEN LA EDITÓ \(manda: es lo que quiere que aprendas\):\nHe quitado los condicionales/,
  );
  if (JSON.parse(t.payload).base_id)
    assert.match(
      inst,
      /CAMBIOS POR APARTADO \(v\d+ de Hermes → v\d+ editada a mano; solo lo que cambió\):\n## 1\. [\s\S]*\+ Paco Ejemplo Gómez/,
    );
  const leccion = (texto: string, alcance: 'general' | 'licitacion', apartado: number | null) => ({
    texto,
    alcance,
    apartado,
    evidencia: '+ Paco Ejemplo Gómez…',
  });
  const entrada = LeccionesEntrada.parse({
    id: ID,
    memoria_id: s.memoria,
    lecciones: [
      leccion('Escribe los compromisos en afirmativo y con plazo, sin condicionales.', 'general', null),
      leccion('Nombra a Paco Ejemplo como responsable del proyecto en cada apartado.', 'licitacion', 2),
    ],
  });
  assert.equal(
    proponerLecciones(db, { ...entrada, memoria_id: memoria(1)!.id }, 'licitaciones').error?.code,
    'conflicto',
    'solo de versiones subidas a mano',
  );
  assert.match(
    proponerLecciones(
      db,
      { ...entrada, lecciones: [leccion('Una lección de un apartado que no existe.', 'general', 9)] },
      'licitaciones',
    ).error?.message ?? '',
    /«apartado» 9 no existe/,
  );
  const tapar = (t: string) => t.split('Paco Ejemplo').join('la persona 1');
  assert.match(
    proponerLecciones(db, entrada, 'licitaciones', tapar).error?.message ?? '',
    /La lección 2 nombra a una persona del equipo/,
    'el libro no guarda nombres',
  );
  assert.deepEqual(
    proponerLecciones(db, { ...entrada, lecciones: entrada.lecciones.slice(0, 1) }, 'licitaciones', tapar).data,
    { guardadas: 1 },
  );
  const guardada = db.prepare('SELECT origen, tema, evidencias FROM lecciones WHERE memoria_id = ?').get(s.memoria) as {
    origen: string;
    tema: string | null;
    evidencias: string;
  };
  assert.deepEqual(
    [guardada.origen, JSON.parse(guardada.evidencias)[0]],
    [
      'edicion',
      {
        licitacion_id: ID,
        memoria_id: s.memoria,
        documento: 'memoria-paco.docx',
        ubicacion: 'toda la memoria',
        texto: '+ la persona 1 Gómez…',
      },
    ],
    'la evidencia apunta al Word y tapa los nombres',
  );
  assert.deepEqual(proponerLecciones(db, entrada, 'licitaciones').data, { guardadas: 2 });
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z');
  assert.ok(
    h.por_aprobar.some(
      (p) =>
        p.detalle ===
        `2 lecciones de tu edición de la v${s.version} por aceptar o descartar · en Preparación › Memoria`,
    ),
    'esperan en Hoy',
  );
  const e = (
    await leer<{
      memorias: {
        version: number;
        notas_subida: string;
        lecciones: { id: number; estado: string; alcance: string }[];
      }[];
    }>(api(`/licitaciones/${ID}/oferta/memoria`, undefined, 'GET'))
  ).memorias[0]!;
  assert.deepEqual(
    [e.version, e.notas_subida.slice(0, 24), e.lecciones.map((x) => [x.alcance, x.estado])],
    [
      s.version,
      'He quitado los condicion',
      [
        ['licitacion', 'pendiente'],
        ['general', 'pendiente'],
      ],
    ],
  );
  for (const x of e.lecciones)
    assert.equal(
      (await api(`/licitaciones/${ID}/oferta/lecciones/${x.id}`, { decision: 'aceptar' }, 'PATCH')).status,
      200,
    );
  const dossier = await componerDossier(db, nucleo().db, s.memoria);
  assert.equal(dossier.error, null, dossier.error?.message);
  assert.match(
    dossier.data!.secciones.find((x) => x.clave === 'lecciones')!.texto,
    /2\. Gestión de incidencias y control de calidad:\n- Nombra a Paco Ejemplo[^\n]*\n- Escribe los compromisos en afirmativo/,
    'la del apartado primero, luego la general',
  );
  const apartado2 = guionVigente(db, ID)!.datos.memoria!.apartados[1]!;
  const deOtra = leccionesParaRedactar(db, {
    licitacion_id: OTRA,
    apartado: 2,
    titulo: apartado2.titulo,
    se_valorara: apartado2.se_valorara,
  });
  assert.ok(
    deOtra.every((l) => !l.texto.includes('Nombra a Paco Ejemplo')),
    'la de esta licitación no pasa a otra',
  );
});

test('should_not_promise_to_learn_when_the_daily_lessons_cap_was_reached', async () => {
  // Arrange: dos lecciones automáticas de esta oferta en las últimas 24 h (el tope).
  db.prepare(
    "UPDATE memorias SET estado = 'fallida' WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando')",
  ).run(ID);
  const ahoraIso = new Date().toISOString();
  for (const n of [1, 2]) {
    nucleo()
      .db.prepare(
        `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, a_mano)
      VALUES ('licitaciones.lecciones', 'licitaciones', ?, ?, 'completado', ?, ?, 0)`,
      )
      .run(`lecciones-tope-${n}-${ahoraIso}`, JSON.stringify({ id: ID }), ahoraIso, ahoraIso);
  }
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '13 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({
      numero: String(i + 1),
      titulo: t,
      bloques: [{ parrafos: ['El equipo revisará el avance cada semana con la entidad.'] }],
    })),
    pie: { texto: '', numeracion: true },
  });
  const form = new FormData();
  form.append('notas', 'He reescrito el seguimiento.');
  form.append('archivo', new Blob([new Uint8Array(docx)]), 'memoria-tope.docx');
  // Act
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, {
    method: 'POST',
    body: form,
  });
  const s = await leer<{ version: number; aprende: boolean }>(r);
  // Assert
  assert.equal(r.status, 201);
  assert.equal(s.aprende, false, 'no se encoló ninguna lección: la web no puede anunciarlo');
  assert.equal(
    nucleo().db.prepare('SELECT 1 FROM trabajos_ia WHERE clave = ?').get(`lecciones-${ID}-v${s.version}`),
    undefined,
  );
});

test('should_list_only_the_paragraphs_that_changed_between_two_versions', () => {
  const c = cambiosPorApartado(
    ['Igual.', 'Se quita.', 'Cambia de  espacios.'],
    ['Igual.', 'Cambia de espacios.', 'Nuevo párrafo.'],
  );
  assert.deepEqual(c, { quitados: ['Se quita.'], anadidos: ['Nuevo párrafo.'] });
});

test('should_keep_the_tables_and_images_of_a_hand_edited_word_in_the_next_assembled_version', async () => {
  db.prepare(
    "UPDATE memorias SET estado = 'fallida' WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando')",
  ).run(ID);
  const { svgAPng } = await import('../../src/nucleo/documentos/figuras.js');
  const png = svgAPng(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect x="10" y="10" width="300" height="100" fill="#1F6FB2"/></svg>',
  ).data!.png;
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const texto =
    'La empresa comprueba cada expediente con las reglas acordadas antes de elevarlo a la mesa de contratación.';
  const tabla = {
    cabecera: ['ID', 'Comprobación', 'Severidad'],
    filas: [
      ['R01', 'El coste del informe coincide con el presupuesto', 'Alta'],
      ['R02', 'El procedimiento es coherente con el importe', 'Alta'],
    ],
  };
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '12 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({
      numero: String(i + 1),
      titulo: t,
      bloques: i
        ? [{ parrafos: [texto] }]
        : [
            { parrafos: [texto], tabla },
            { parrafos: [], imagen: { ruta: 'x', ancho: 1600, alto: 800, datos: png, tipo: 'png' as const } },
            { parrafos: [texto] },
          ],
    })),
    pie: { texto: '', numeracion: true },
  });
  const form = new FormData();
  form.append('archivo', new Blob([new Uint8Array(docx)]), 'con-tablas.docx');
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, {
    method: 'POST',
    body: form,
  });
  const s = await leer<{ version: number; memoria: number }>(r);
  assert.equal(r.status, 201);
  const a1 = JSON.parse(
    (
      db.prepare('SELECT datos FROM memoria_apartados WHERE memoria_id = ? AND apartado = 1').get(s.memoria) as {
        datos: string;
      }
    ).datos,
  ) as { bloques: { tabla?: unknown; imagen?: { ruta: string } }[] };
  assert.deepEqual(a1.bloques.find((b) => b.tabla)?.tabla, tabla, 'la tabla del Word es una tabla, no viñetas');
  const ruta = a1.bloques.find((b) => b.imagen)!.imagen!.ruta;
  assert.match(ruta, new RegExp(`/memoria-v${s.version}-imagenes/imagen-1\\.png$`));
  assert.ok(
    fs.existsSync(path.join(salidas, ruta.replace(/^Salidas\//, ''))),
    'la imagen se guarda junto a la versión',
  );
  // La versión siguiente copia los apartados que no se rehacen: se monta con su tabla y su imagen.
  const v = s.version + 1;
  const nueva = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, ?, 'redactando', ?)",
      )
      .run(ID, memoria(s.version)!.guion_id, v, new Date().toISOString()).lastInsertRowid,
  );
  db.prepare(
    'INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres) SELECT ?, apartado, estado, datos, caracteres FROM memoria_apartados WHERE memoria_id = ?',
  ).run(nueva, s.memoria);
  const e = await ensamblarMemoria(db, nueva);
  assert.equal(e.error, null, e.error?.message);
  const montado = unzipSync(
    new Uint8Array(fs.readFileSync(path.join(salidas, e.data!.ruta.replace(/^Salidas\//, '')))),
  );
  assert.ok(
    Object.keys(montado).some((n) => /^word\/media\/.+\.png$/.test(n)),
    'la imagen vuelve a estar en el Word',
  );
  assert.match(strFromU8(montado['word/document.xml']!), /<w:tbl>[\s\S]*R02[\s\S]*<\/w:tbl>/, 'y la tabla, como tabla');
  const json = fs.readFileSync(
    path.join(salidas, e.data!.ruta.replace(/^Salidas\//, '').replace(/\.docx$/, '.json')),
    'utf8',
  );
  assert.doesNotMatch(json, /"datos":\s*\{\s*"type":\s*"Buffer"/, 'el .json lleva la ruta de la imagen, no sus bytes');
});

test('should_accept_only_images_saved_from_an_upload_of_this_tender_when_hermes_rewrites_a_section', () => {
  const guardada = (
    db.prepare("SELECT datos FROM memoria_apartados WHERE datos LIKE '%imagen-1.png%' LIMIT 1").get() as {
      datos: string;
    }
  ).datos;
  const ruta = (JSON.parse(guardada) as { bloques: { imagen?: { ruta: string } }[] }).bloques.find((b) => b.imagen)!
    .imagen!.ruta;
  const v =
    (db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(ID) as { v: number }).v + 1;
  const g = guionVigente(db, ID)!;
  const id = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, ?, 'redactando', ?, 'redaccion', 0)",
      )
      .run(ID, g.id, v, new Date().toISOString()).lastInsertRowid,
  );
  g.datos.memoria!.apartados.forEach((_, i) =>
    db
      .prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, ?, 'pendiente')")
      .run(id, i + 1),
  );
  const conImagen = (r: string) => {
    const a = apartadoCasoA(1, { memoria_id: id, guion_id: g.id, version: v });
    Object.assign(a.bloques[0]!, { imagen: { ruta: r, ancho: 1600, alto: 800 } });
    return a;
  };
  olvidarRechazos();
  assert.match(
    enviar(conImagen('Salidas/Licitaciones/otra (p-1)/imagen.png')).error?.message ?? '',
    /no son de una versión subida a mano de esta licitación o ya no están: «Salidas\/Licitaciones\/otra \(p-1\)\/imagen\.png» \(bloque 1\)/,
  );
  assert.match(
    enviar(conImagen(ruta.replace('imagen-1', 'imagen-9'))).error?.message ?? '',
    /ya no están/,
    'una ruta de la carpeta que no existe, tampoco',
  );
  assert.equal(enviar(conImagen(ruta)).error, null, 'la que trae el texto anterior, sí');
  db.prepare("UPDATE memorias SET estado = 'fallida' WHERE id = ?").run(id);
  olvidarRechazos();
});

// Villaejemplo (p-91000770): el Anexo IV acaba en «Lugar, fecha y firma del proponente» y la portada
// salía con «Lote 3: Lote 3:» porque el nombre de la PLACSP ya traía el número.
test('should_close_the_memoria_with_place_date_and_signature_when_the_outline_asks_and_name_the_lot_once', async () => {
  db.prepare(
    "UPDATE memorias SET estado = 'fallida' WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando')",
  ).run(ID);
  const g = guionVigente(db, ID)!;
  const datosLici = (db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(ID) as { datos: string }).datos;
  const decisiones = (
    db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(ID) as { datos: string }
  ).datos;
  const perfil = { nif: 'B12345678', nombre: 'Analítica Ejemplo SL', domicilio: 'Calle Ejemplo 7, Puerto de Ejemplo' };
  const otros = 'Formato A4. El documento termina con «Lugar, fecha y firma del proponente».';
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(
    JSON.stringify({ ...g.datos, memoria: { ...g.datos.memoria, formato: { otros } } }),
    g.id,
  );
  db.prepare("UPDATE licitaciones SET datos = json_set(datos, '$.lotes', json(?)) WHERE id = ?").run(
    JSON.stringify([
      { id: '3', nombre: 'Lote 3: Acciones formativas en teleformación', presupuesto_sin_iva: 18_557, cpvs: [] },
    ]),
    ID,
  );
  db.prepare(
    "UPDATE decisiones_oferta SET datos = json_set(datos, '$.lotes', json('[\"3\"]')) WHERE licitacion_id = ?",
  ).run(ID);
  const representante = { nombre: 'Paco Ejemplo Gómez', nif: '12345678Z', cargo: 'Administrador solidario' };
  assert.equal(
    guardarPerfilEmpresa(nucleo().db, {
      ...perfil,
      domicilio: 'Calle Ejemplo 7, 38001 Puerto de Ejemplo (Provincia de Ejemplo)',
      representante,
    }).error,
    null,
  );
  const montar = async () => {
    const v =
      (db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(ID) as { v: number }).v + 1;
    const id = Number(
      db
        .prepare(
          "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, ?, 'redactando', ?)",
        )
        .run(ID, g.id, v, new Date().toISOString()).lastInsertRowid,
    );
    db.prepare(
      'INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres) SELECT ?, apartado, estado, datos, caracteres FROM memoria_apartados WHERE memoria_id = ?',
    ).run(id, memoria(1)!.id);
    const e = await ensamblarMemoria(db, id, undefined, new Date('2026-10-14T10:00:00Z'));
    assert.equal(e.error, null, e.error?.message);
    return {
      ...e.data!,
      md: fs.readFileSync(path.join(salidas, e.data!.ruta.replace(/^Salidas\//, '').replace(/\.docx$/, '.md')), 'utf8'),
    };
  };
  try {
    const conTodo = await montar();
    const cierre =
      'En Puerto de Ejemplo, a 14 de octubre de 2026.\n\nFdo.: Paco Ejemplo Gómez\n\nAdministrador solidario de Analítica Ejemplo SL\n';
    assert.ok(conTodo.md.endsWith(cierre), conTodo.md.slice(-300));
    assert.deepEqual(
      [conTodo.md.match(/Lote 3/g)?.length, conTodo.md.includes(' · Lote 3: Acciones formativas en teleformación · ')],
      [1, true],
    );
    const textoDocx = (
      await extraerDocumento(path.join(salidas, conTodo.ruta.replace(/^Salidas\//, '')))
    ).data!.pages.join('\n');
    assert.ok(textoDocx.includes('Fdo.: Paco Ejemplo Gómez') && !/Lotes?: Lote/.test(textoDocx));
    assert.ok(
      !conTodo.avisos.some((a) => a.includes('Lugar, fecha y firma')),
      'con lugar y firmante no hay nada que escribir a mano',
    );

    assert.equal(guardarPerfilEmpresa(nucleo().db, perfil).error, null);
    const sinDatos = await montar();
    assert.ok(
      sinDatos.md.includes(
        'En ____________________, a 14 de octubre de 2026.\n\nFdo.: ____________________\n\nAnalítica Ejemplo SL\n',
      ),
    );
    assert.ok(
      sinDatos.avisos.includes(
        'El pliego pide «Lugar, fecha y firma del proponente» al final de la memoria: escribe en el Word el lugar (el domicilio del perfil no trae código postal y municipio) y quién firma (el perfil no tiene representante) antes de firmar.',
      ),
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(CARPETA_SALIDAS, 'memoria-v1.md'), 'utf8'),
      /Fdo\.:/,
      'si el guion no lo pide, no hay cierre',
    );
  } finally {
    db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(g.datos), g.id);
    db.prepare('UPDATE licitaciones SET datos = ? WHERE id = ?').run(datosLici, ID);
    db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(decisiones, ID);
    guardarPerfilEmpresa(nucleo().db, perfil);
  }
});

// Al final del archivo: guarda un guion para SIN_GUION, que las pruebas anteriores necesitan sin él.
test('should_expose_guion_automatic_criteria_caps_without_amounts', async () => {
  olvidarRechazos();
  const conTramos = guionCon((g) => {
    const horas = g.automaticos[2] as Guion['automaticos'][number] & { tramos?: unknown };
    horas.tramos = [
      { descripcion: 'De 10 a 19 horas adicionales', puntos: 3, valor: '10' },
      { descripcion: '30 horas adicionales o más', puntos: 7, valor: '30' },
    ];
    const formacion = g.automaticos[3] as Guion['automaticos'][number] & { tramos?: unknown };
    formacion.tramos = [{ descripcion: 'Un curso adicional', puntos: 6 }];
  });
  assert.equal((await guion({ ...conTramos, id: SIN_GUION })).error, null);

  const r = resumenOferta(db, SIN_GUION);

  assert.deepEqual(r.automaticos.slice(1, 4), [
    { criterio: 'Plantilla con discapacidad igual o superior al 10 %', puntos: 15, tope: null, lotes: [] },
    { criterio: 'Mejora 1: bolsa de horas adicionales', puntos: 7, tope: '30', lotes: [] },
    { criterio: 'Mejora 2: formación adicional', puntos: 6, tope: 'Un curso adicional', lotes: [] },
  ]);
  assert.ok(!JSON.stringify(r.automaticos).includes('51480'), 'los topes, sin importes');
  // El presupuesto base es público y la ficha lo enseña junto al máximo por lote.
  assert.deepEqual(
    r.precios_maximos?.map((x) => x.presupuesto),
    [51_480],
  );
  assert.deepEqual(resumenOferta(db, OTRA).automaticos, []);
});

const TITULO_LARGO =
  'Servicio de consultoría y asistencia técnica para la implantación, el seguimiento y la mejora del sistema de gestión de la seguridad de la información y del plan de continuidad de negocio de la Empresa Pública de Servicios Generales de Ejemplo, Sociedad Anónima, S.A.';

test('should_not_cut_title_mid_word_in_cover_subtitle', () => {
  const s = subtituloDePortada('Memoria técnica de la oferta', TITULO_LARGO);
  assert.ok(s.length <= 300);
  assert.ok(s.endsWith('S.A.') || s.endsWith('…'), s);
  const corto = recortarPorPalabra('uno dos tres cuatro', 12);
  assert.equal(corto, 'uno dos…');
  assert.equal(recortarPorPalabra('uno dos', 12), 'uno dos');
});

test('should_drop_file_name_from_subtitle_when_title_does_not_fit', () => {
  const archivo = 'Memoria técnica '.repeat(10).trim();
  const s = subtituloDePortada(archivo, TITULO_LARGO);
  assert.equal(s, TITULO_LARGO);
  assert.equal(subtituloDePortada('Memoria', 'Título corto'), 'Memoria · Título corto');
});
