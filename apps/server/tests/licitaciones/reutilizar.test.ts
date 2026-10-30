// Reutilizar un documento de la carpeta Empresa o de una oferta anterior sobre
// las ofertas de ejemplo (fixtures/comprobaciones/). La oferta anterior es la
// del Ayuntamiento de Villaejemplo (ficticia, IA para quejas) con sus nombres de archivo, sin personas ni importes; los
// certificados son PDF de prueba.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reutilizar-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { subirDocumentoEmpresa } = await import('../../src/nucleo/carpetaEmpresa.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { documentosDelGuion, filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { candidatosDe, esCopiaPersonal, reutilizar, tipoEmpresaDe } =
  await import('../../src/dominios/licitaciones/oferta/reutilizar.js');
const { propuestasParecidas } = await import('../../src/dominios/licitaciones/propuestas/parecidas.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
const { licitacion } = await import('../helpers/sinteticas.js');
type Reutilizables = import('../../src/dominios/licitaciones/oferta/reutilizar.js').Reutilizables;

iniciarNucleo();
const db = dbLicitaciones();
const fixtures = (['casoB', 'casoC', 'casoD', 'casoF'] as const).map((o) => leerFixtureComprobaciones(o));
for (const f of fixtures) sembrarFixture(db, nucleo().db, f);
const [CASO_B, CASO_C, CASO_D, CASO_F] = fixtures.map((f) => f.id) as [string, string, string, string];
const HOY = '2026-10-14';
const ctx = () => ({ db, dbNucleo: nucleo().db, raices: raicesActuales(), hoy: HOY });

// Villaejemplo: otro objeto (IA para quejas y sugerencias) y otra clase CPV; solo coincide el tipo de contrato o la división 72.
const CASO_G = 'p-91000070';
const CARPETA_CASO_G = 'Licitaciones/Presentadas/2026-10 - Ayuntamiento de Villaejemplo - CAUCE';
const SOBRE_1 = `Conocimiento/${CARPETA_CASO_G}/PLIEGOS/Sobre 1`;
const MEDIOS = `${SOBRE_1}/S1_g_Declaracion_Disponibilidad_Medios.pdf`;
const DOCS_CASO_G = [
  MEDIOS,
  `${SOBRE_1}/S1_c2_Certificado_TGSS_Seguridad_Social.pdf`,
  `${SOBRE_1}/S1_a_Anexo_II_Declaracion_Responsable.pdf`,
];

function escribir(ruta: string, texto: string): void {
  const [raiz, ...resto] = ruta.split('/');
  const abs = path.join(tmp, raiz === 'Salidas' ? 'salidas' : 'conocimiento', ...resto);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
}

function sembrarPropuesta(id: string, datos: { titulo: string; cpv: string; documentos: string[] }): void {
  const base = licitacion({
    titulo: datos.titulo,
    publicada: '2026-09-01',
    cpv: datos.cpv,
    presupuesto: 9_000_000,
    organo: { nombre: `Órgano ${id}`, nif: `Q${id.slice(-7)}` },
  });
  guardarLicitacion(db, { ...base, id, atom_id: `atom-${id}` });
  db.prepare(
    "INSERT INTO propuestas (licitacion_id, presentada_en, documentos, creada_en, actualizada_en) VALUES (?, '2026-10-13', ?, ?, ?)",
  ).run(id, JSON.stringify(datos.documentos), '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z');
}

sembrarPropuesta(CASO_G, {
  titulo: 'Asistente de inteligencia artificial para quejas y sugerencias de la Oficina de Atención Ciudadana (CAUCE)',
  cpv: '72260000',
  documentos: DOCS_CASO_G,
});
db.prepare(
  "INSERT INTO carpetas_presentadas (licitacion_id, nombre, ruta, estado, creada_en, actualizada_en) VALUES (?, 'Ayuntamiento de Villaejemplo', ?, 'hecha', ?, ?)",
).run(CASO_G, CARPETA_CASO_G, '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z');
for (const r of DOCS_CASO_G) escribir(r, `pdf de prueba ${path.basename(r)}`);

const raizBoveda = path.join(tmp, 'conocimiento');
const tgss = await subirDocumentoEmpresa(
  nucleo().db,
  raizBoveda,
  { nombre: 'tgss.pdf', datos: Buffer.from('tgss vigente'), campos: {} },
  { tipo: 'tgss', nombre: 'Certificado TGSS', caduca_en: '2026-11-02' },
);
const tgssCaducado = await subirDocumentoEmpresa(
  nucleo().db,
  raizBoveda,
  { nombre: 'tgss-abril.pdf', datos: Buffer.from('tgss viejo'), campos: {} },
  { tipo: 'tgss', nombre: 'Certificado TGSS de abril', caduca_en: '2026-10-01' },
);
await subirDocumentoEmpresa(
  nucleo().db,
  raizBoveda,
  { nombre: 'aeat.pdf', datos: Buffer.from('aeat'), campos: {} },
  { tipo: 'aeat', nombre: 'Certificado AEAT', caduca_en: '2027-01-10' },
);

/** La clave del primer documento del guion vigente cuyo nombre casa. */
function claveDe(id: string, re: RegExp): string {
  const g = guionVigente(db, id);
  const d = g ? documentosDelGuion(g.datos).find((x) => re.test(x.doc.nombre)) : undefined;
  assert.ok(d, `${id}: no hay documento ${re}`);
  return d.clave;
}

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

test('should_offer_the_valid_tgss_certificate_for_a_tgss_row', () => {
  // Arrange
  const clave = claveDe(CASO_B, /Seguridad Social/);

  // Act
  const r = candidatosDe(ctx(), CASO_B, clave);

  // Assert: solo los de la TGSS, el vigente primero; nada de ofertas anteriores (su vigencia no se sabe).
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.tipo_empresa, 'tgss');
  assert.deepEqual(
    r.data!.empresa.map((d) => [d.ruta, d.estado]),
    [
      [tgss.data!.ruta, 'caduca_pronto'],
      [tgssCaducado.data!.ruta, 'caducado'],
    ],
  );
  assert.deepEqual(r.data!.anteriores, []);
});

test('should_refuse_an_expired_document', () => {
  // Arrange
  const clave = claveDe(CASO_B, /Seguridad Social/);

  // Act
  const r = reutilizar(ctx(), CASO_B, clave, { origen: 'empresa', ruta: tgssCaducado.data!.ruta });

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(r.error?.message, 'Ese documento caducó el 01/10/2026: sube uno vigente');
  assert.equal(filaDocumento(db, CASO_B, clave)?.ruta ?? null, null);
});

test('should_copy_without_overwriting_and_leave_the_row_as_draft', () => {
  // Arrange: alguien ya dejó un tgss.pdf en la carpeta de documentos de la oferta.
  const clave = claveDe(CASO_B, /Seguridad Social/);
  const l = db.prepare('SELECT expediente FROM licitaciones WHERE id = ?').get(CASO_B) as { expediente: string };
  const carpeta = `Salidas/Licitaciones/${l.expediente.replace(/\//g, '-')} (${CASO_B})/documentos`;
  escribir(`${carpeta}/tgss.pdf`, 'el de otra persona');

  // Act
  const r = reutilizar(ctx(), CASO_B, clave, { origen: 'empresa', ruta: tgss.data!.ruta });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.documento.ruta, `${carpeta}/tgss-v2.pdf`);
  assert.equal(
    fs.readFileSync(path.join(tmp, 'salidas', ...carpeta.split('/').slice(1), 'tgss.pdf'), 'utf8'),
    'el de otra persona',
  );
  assert.equal(
    fs.readFileSync(path.join(tmp, 'salidas', ...carpeta.split('/').slice(1), 'tgss-v2.pdf'), 'utf8'),
    'tgss vigente',
  );
  const f = filaDocumento(db, CASO_B, clave);
  assert.deepEqual(
    [f?.estado, f?.nota, f?.anexo_en],
    ['borrador', 'Copiado de la carpeta Empresa (vigente hasta 02/11/2026)', null],
  );
});

// Una oferta anterior de formación (misma clase CPV 8000 que CASO_B): parecida de verdad, no débil.
const FORMACION = 'p-91000060';
const MEDIOS_FORMACION =
  'Conocimiento/Licitaciones/Presentadas/2025-11 - Formación en ciberseguridad/Sobre 1/S1_g_Declaracion_Disponibilidad_Medios.pdf';

test('should_offer_the_previous_offer_declaration_of_means_for_casoB', async () => {
  // Arrange
  sembrarPropuesta(FORMACION, {
    titulo: 'Servicios de formación especializada en ciberseguridad',
    cpv: '80000000',
    documentos: [MEDIOS_FORMACION],
  });
  escribir(MEDIOS_FORMACION, 'pdf de prueba de medios');
  const clave = claveDe(CASO_B, /medios materiales/);

  // Act: por la ruta de la web, ida y vuelta.
  const lista = await fetch(`${base}/api/licitaciones/licitaciones/${CASO_B}/oferta/documentos/${clave}/reutilizables`);
  const d = (await lista.json()) as Reutilizables;
  const copia = await fetch(`${base}/api/licitaciones/licitaciones/${CASO_B}/oferta/documentos/${clave}/reutilizar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origen: 'oferta', ruta: d.anteriores[0]?.ruta }),
  });

  // Assert: la de la oferta de formación; la de Villaejemplo (parecida débil) ya no se ofrece.
  assert.equal(lista.status, 200);
  assert.deepEqual(
    d.anteriores.map((a) => [a.ruta, a.licitacion]),
    [[MEDIOS_FORMACION, FORMACION]],
  );
  assert.equal(copia.status, 200);
  const f = filaDocumento(db, CASO_B, clave);
  assert.equal(f?.estado, 'borrador');
  assert.match(f?.ruta ?? '', /\/documentos\/S1_g_Declaracion_Disponibilidad_Medios\.pdf$/);
  assert.match(f?.nota ?? '', /^Copiado de la oferta anterior «Servicios de formación especializada/);
});

test('should_not_offer_documents_of_a_weak_similar_offer', () => {
  // Arrange: para CASO_D, Villaejemplo solo comparte la división CPV 72 (débil).
  const clave = claveDe(CASO_D, /medios|declaraci/i);

  // Act
  const r = candidatosDe(ctx(), CASO_D, clave);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(
    r.data!.anteriores.some((a) => a.licitacion === CASO_G),
    false,
  );
});

test('should_refuse_a_company_folder_document_that_links_outside_the_vault', () => {
  // Arrange: Empresa/enlazada es una unión (enlace a carpeta) a una carpeta de fuera de Conocimiento.
  const fuera = path.join(tmp, 'fuera');
  fs.mkdirSync(fuera, { recursive: true });
  fs.writeFileSync(path.join(fuera, 'tgss.pdf'), 'fuera de la bóveda');
  fs.mkdirSync(path.join(raizBoveda, 'Empresa'), { recursive: true });
  fs.symlinkSync(fuera, path.join(raizBoveda, 'Empresa', 'enlazada'), 'junction');
  nucleo()
    .db.prepare(
      `INSERT INTO empresa_documentos (tipo, nombre, ruta, persona_id, emitido_en, caduca_en, horas_desglosadas, notas, actualizado_en)
    VALUES ('tgss', 'Certificado TGSS enlazado', 'Empresa/enlazada/tgss.pdf', NULL, NULL, '2027-02-01', 0, '', ?)`,
    )
    .run(new Date().toISOString());
  const clave = claveDe(CASO_B, /Seguridad Social/);

  // Act
  const r = reutilizar(ctx(), CASO_B, clave, { origen: 'empresa', ruta: 'Empresa/enlazada/tgss.pdf' });

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.match(r.error!.message, /fuera de la Biblioteca/);
});

test('should_copy_a_company_cv_to_the_personal_subfolder_of_the_offer', async () => {
  // Arrange: el guion de CASO_B pide además el CV del coordinador, y la carpeta Empresa tiene uno.
  const g = guionVigente(db, CASO_B)!;
  const datos = structuredClone(g.datos);
  datos.archivos[0]!.documentos.push({
    tipo: 'acreditacion',
    nombre: 'Currículum de la persona coordinadora del contrato',
    obligatorio: true,
    produce: 'persona',
  } as never);
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(datos), g.id);
  const cv = await subirDocumentoEmpresa(
    nucleo().db,
    raizBoveda,
    { nombre: 'cv-coordinadora.pdf', datos: Buffer.from('cv'), campos: {} },
    { tipo: 'cv', nombre: 'CV coordinadora' },
  );
  assert.equal(cv.error, null, cv.error?.message);
  const clave = claveDe(CASO_B, /Currículum/);

  // Act
  const r = reutilizar(ctx(), CASO_B, clave, { origen: 'empresa', ruta: cv.data!.ruta });

  // Assert
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(g.datos), g.id);
  assert.equal(r.error, null, r.error?.message);
  assert.match(r.data!.documento.ruta!, /\/documentos\/Colaboradores\/cv-coordinadora\.pdf$/);
  assert.equal(
    esCopiaPersonal(r.data!.documento.ruta!),
    true,
    'salidas_listar y salidas_leer la ocultan sin permiso de colaboradores',
  );
  assert.equal(esCopiaPersonal(`Salidas/Licitaciones/x (${CASO_B})/documentos/tgss.pdf`), false);
});

test('should_reject_a_path_that_is_not_among_the_candidates', async () => {
  // Arrange
  const clave = claveDe(CASO_B, /medios materiales/);

  // Act
  const fuera = reutilizar(ctx(), CASO_B, clave, {
    origen: 'oferta',
    ruta: 'Conocimiento/Colaboradores/cv-secreto.pdf',
  });
  const malformado = await fetch(
    `${base}/api/licitaciones/licitaciones/${CASO_B}/oferta/documentos/${clave}/reutilizar`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origen: 'drive', ruta: 'x' }),
    },
  );

  // Assert
  assert.equal(fuera.error?.code, 'invalid_input');
  assert.equal(malformado.status, 400);
});

test('should_map_guion_names_to_company_folder_types', () => {
  assert.deepEqual(
    [
      'Certificado de estar al corriente en el cumplimiento de las obligaciones con la Seguridad Social',
      'Certificado de estar al corriente en el cumplimiento de las obligaciones tributarias',
      'Certificado de inscripción en el Registro Oficial de Licitadores y Empresas Clasificadas del Sector Público (ROLECE)',
      'Certificado de Conformidad con el ENS de categoría MEDIA',
      'Currículum de la persona coordinadora del contrato',
      'Declaración responsable de los medios materiales',
    ].map(tipoEmpresaDe),
    ['tgss', 'aeat', 'rolece', 'certificado', 'cv', null],
  );
});

test('should_mark_casoG_as_weak_for_casoC_when_only_contract_type_matches', () => {
  // Act
  const casoG = [CASO_C, CASO_D, CASO_B, CASO_F].map((id) =>
    propuestasParecidas(db, id, 10).data?.find((p) => p.licitacion_id === CASO_G),
  );

  // Assert: CASO_D comparte además la división CPV 72, pero el objeto no se parece.
  assert.deepEqual(
    casoG.map((p) => p?.debil),
    [true, true, true, true],
  );
  assert.ok(casoG[1]?.motivos.includes('misma división CPV 72'));
});

test('should_keep_a_real_similar_offer_above_threshold', () => {
  // Arrange: una edición anterior del programa de capacitación documental de la isla (misma clase CPV 8052).
  const ANTERIOR = 'p-91000050';
  sembrarPropuesta(ANTERIOR, {
    titulo:
      'Programa de capacitación en conservación y gestión documental del personal de archivos y bibliotecas de Isla Muestra',
    cpv: '80521000',
    documentos: [],
  });

  // Act
  const p = propuestasParecidas(db, CASO_D, 10).data?.find((x) => x.licitacion_id === ANTERIOR);

  // Assert
  assert.equal(p?.debil, false);
  assert.equal(propuestasParecidas(db, CASO_D, 10).data?.[0]?.licitacion_id, ANTERIOR, 'las fuertes, delante');
});
