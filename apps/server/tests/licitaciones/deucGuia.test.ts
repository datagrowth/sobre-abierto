// Guía del DEUC: DEUC_GUIA.md campo a campo desde el perfil, la hoja de datos, las
// decisiones y los criterios de la petición (fixtures/espd-request.xml, recortada, y la completa de
// Villaejemplo, fixtures/documentos/deuc.ts; las dos sintéticas). Lo que falta va «FALTA», nunca
// inventado; nunca lleva el importe ofertado y nunca pisa una guía anterior. Empresa ficticia (Persona A).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARPETA_PLIEGOS, decisionesCasoA, FICHA_CASO_A, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { peticionDeucCasoC } from './fixtures/documentos/deuc.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deuc-guia-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.CONVERSIONES_DIR = path.join(tmp, 'conversiones');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa, PerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { filaDocumento, sincronizarDocumentos } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { criteriosDePeticion, escribirGuiaDeuc, guiaDeuc, leerGuiaDeuc } =
  await import('../../src/dominios/licitaciones/oferta/deucGuia.js');
const { generarPaquete, paqueteVigente } = await import('../../src/dominios/licitaciones/oferta/paquete.js');

iniciarNucleo();
const db = dbLicitaciones();
const dbNucleo = nucleo().db;
const raices = { salidas, conocimiento };
const ahora = '2026-10-15T10:00:00.000Z';
const DEUC = 'a1-d1';
const PRECIO = 12_345;

const fixture = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PETICION = fixture('./fixtures/espd-request.xml');
fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, 'Deuc.xml'), PETICION);
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, tipo, actualizado_en) VALUES (?, ?, 'anexo', 'Deuc.xml', 'descargado', ?, 'deuc', ?)",
).run(ID, 'https://contrataciondelestado.es/Deuc.xml', `${CARPETA_PLIEGOS}/Deuc.xml`, ahora);

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ahora, ahora);
const { id: _id, ...FICHA_BASE } = FICHA_CASO_A;
db.prepare(
  "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?)",
).run(ID, JSON.stringify(FICHA_BASE), ahora, ahora, ahora);
assert.equal((await proponerGuion(db, GuionEntrada.parse(guionCon(() => {})), 'licitaciones')).error, null);
sincronizarDocumentos(db, ID, guionVigente(db, ID)!);

const PERFIL = {
  nif: 'B00000000',
  nombre: 'Empresa Ejemplo, S.L.',
  tamano: 'pequena',
  representante: { nombre: 'Persona A', nif: '00000000T', cargo: 'Administradora única' },
  contacto: { email: 'licitaciones@ejemplo.test' },
  volumen_negocio: [
    { anio: 2024, importe: 150_000 },
    { anio: 2025, importe: 180_000 },
  ],
};
const DOMICILIO = 'Calle Ejemplo 1, 38001 Puerto de Ejemplo';
const PERSONA = crearPersona(dbNucleo, { nombre: 'Persona A', tipo: 'interno', rol: 'Consultora' }).data!.id;
const decidir = (cambio: object = {}) =>
  assert.equal(
    guardarDecisiones(db, dbNucleo, ID, {
      ...decisionesCasoA([PERSONA]),
      precio: { importe: PRECIO, pendiente: false },
      ...cambio,
    }).error,
    null,
  );

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const carpeta = () => path.join(salidas, 'Licitaciones', fs.readdirSync(path.join(salidas, 'Licitaciones'))[0]!);
const guias = () =>
  fs
    .readdirSync(carpeta())
    .filter((n) => n.startsWith('DEUC_GUIA'))
    .sort();
const leer = (ruta: string) => fs.readFileSync(path.join(salidas, ruta.slice('Salidas/'.length)), 'utf8');
const entrada = (cambio: Partial<Parameters<typeof guiaDeuc>[0]> = {}) => ({
  perfil: PerfilEmpresa.parse({ ...PERFIL, domicilio: DOMICILIO }),
  hoja: { campos: [], avisos: [] },
  criterios: [],
  lotes: [],
  licitacion: { expediente: 'EXP-0000/2026', organo: 'Órgano de ejemplo' },
  ...cambio,
});

test('should_list_the_criteria_of_an_espd_request', () => {
  // Arrange
  const v2 =
    '<q:QualificationApplicationRequest xmlns:q="urn:x" xmlns:a="urn:a" xmlns:b="urn:b"><a:TenderingCriterion><b:ID>1</b:ID>' +
    '<b:CriterionTypeCode>CRITERION.EXCLUSION.CONVICTIONS.FRAUD</b:CriterionTypeCode><b:Name>Fraud</b:Name>' +
    '<a:TenderingCriterionPropertyGroup><a:TenderingCriterionProperty><b:Name>Your answer?</b:Name></a:TenderingCriterionProperty></a:TenderingCriterionPropertyGroup>' +
    '</a:TenderingCriterion></q:QualificationApplicationRequest>';

  // Act
  const sintetica = criteriosDePeticion(PETICION);
  const casoC = criteriosDePeticion(peticionDeucCasoC());
  const modelo2 = criteriosDePeticion(v2);

  // Assert
  assert.deepEqual(
    sintetica.map((c) => c.codigo),
    [
      'CRITERION.EXCLUSION.CONVICTIONS.PARTICIPATION_IN_CRIMINAL_ORGANISATION',
      'CRITERION.EXCLUSION.CONTRIBUTIONS.PAYMENT_OF_TAXES',
      'CRITERION.EXCLUSION.NATIONAL.OTHER',
      'CRITERION.SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY',
      'CRITERION.OTHER.EO_DATA.LOTS_TENDERED',
    ],
  );
  assert.equal(sintetica[2]!.nombre, 'Purely national exclusion grounds & others');
  assert.equal(casoC.length, 40);
  assert.equal(casoC.filter((c) => c.codigo.startsWith('CRITERION.EXCLUSION.')).length, 24);
  assert.deepEqual(modelo2, [{ codigo: 'CRITERION.EXCLUSION.CONVICTIONS.FRAUD', nombre: 'Fraud' }]);
});

test('should_return_no_criteria_for_an_unparseable_xml', () => {
  // Arrange
  const malos = [
    '',
    'esto no es XML',
    '<ccv:Criterion><cbc:TypeCode>CRITERION.X',
    '<!DOCTYPE x [<!ENTITY e "y">]><ccv:Criterion><cbc:TypeCode>CRITERION.A</cbc:TypeCode></ccv:Criterion>',
    '<ccv:Criterion><cbc:TypeCode>no es un código</cbc:TypeCode></ccv:Criterion>',
    null as unknown as string,
  ];

  // Act
  const resultados = malos.map((x) => criteriosDePeticion(x));

  // Assert
  for (const r of resultados) assert.deepEqual(r, []);
});

test('should_write_FALTA_for_a_missing_address_and_never_invent_it', () => {
  // Arrange
  assert.equal(guardarPerfilEmpresa(dbNucleo, PERFIL).error, null);
  decidir();

  // Act
  const r = escribirGuiaDeuc({ db, dbNucleo, raices }, ID);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.match(r.data!.ruta, /^Salidas\/Licitaciones\/.+\/DEUC_GUIA\.md$/);
  const guia = leer(r.data!.ruta);
  assert.match(guia, /^# Guía del DEUC/);
  assert.match(
    guia,
    /1\. Descarga Deuc\.xml · 2\. Impórtalo en el \[servicio DEUC\]\(https:\/\/visor\.registrodelicitadores\.gob\.es\/espd-web\/filter\?lang=es\) · 3\. Rellena con esta guía/,
  );
  assert.match(guia, /\*\*Dirección postal:\*\* FALTA: domicilio \(Ajustes › Empresa\)/);
  assert.match(guia, /\*\*Lugar:\*\* FALTA: domicilio \(Ajustes › Empresa\)/);
  assert.match(guia, /\*\*Teléfono de contacto:\*\* FALTA: teléfono de contacto \(Ajustes › Empresa\)/);
  assert.match(guia, /\*\*NIF:\*\* B00000000/);
  assert.match(guia, /\*\*¿Es una PYME\?:\*\* Sí \(pequeña empresa\)/);
  assert.match(guia, /\*\*Nombre y apellidos:\*\* Persona A/);
  assert.match(guia, /\*\*¿Se basa en la capacidad de otras entidades\?:\*\* No/);
  assert.match(guia, /\*\*Participación en una organización delictiva:\*\* No/);
  assert.match(guia, /\*\*Pago de impuestos:\*\* No/);
  assert.match(guia, /\*\*Volumen de negocios anual \(«general»\):\*\* 2025: 180\.000,00 € · 2024: 150\.000,00 €/);
  assert.doesNotMatch(guia, /38001|Puerto de Ejemplo/, 'ningún domicilio inventado');
  const f = filaDocumento(db, ID, DEUC)!;
  assert.equal(f.ruta, r.data!.ruta, 'la bandeja encuentra la guía por la fila del DEUC');
  assert.equal(f.estado, 'borrador');
});

test('should_answer_subcontracting_from_annex_decisions', () => {
  // Arrange
  const pregunta = /\*\*¿Tiene intención de subcontratar alguna parte del contrato\?:\*\* (.+)/;

  // Act
  const si = pregunta.exec(guiaDeuc(entrada({ subcontratacion_servidores: true })))?.[1];
  const no = pregunta.exec(guiaDeuc(entrada({ subcontratacion_servidores: false })))?.[1];
  const sinDecidir = pregunta.exec(guiaDeuc(entrada({ subcontratacion_servidores: null })))?.[1];
  decidir({ datos_anexo: { subcontratacion_servidores: false } });
  const delServidor = escribirGuiaDeuc({ db, dbNucleo, raices }, ID);

  // Assert
  assert.match(si!, /^Sí/);
  assert.equal(no, 'No');
  assert.equal(
    sinDecidir,
    'FALTA: decide si subcontratas los servidores o servicios asociados (Decisiones › Datos del anexo)',
  );
  assert.equal(delServidor.error, null, delServidor.error?.message);
  assert.equal(pregunta.exec(leer(delServidor.data!.ruta))?.[1], 'No');
});

test('should_never_overwrite_an_existing_guide', () => {
  // Arrange
  const antes = guias().map((n) => [n, fs.readFileSync(path.join(carpeta(), n), 'utf8')] as const);
  assert.equal(guardarPerfilEmpresa(dbNucleo, { ...PERFIL, domicilio: DOMICILIO }).error, null);

  // Act
  const nueva = escribirGuiaDeuc({ db, dbNucleo, raices }, ID);
  const igual = escribirGuiaDeuc({ db, dbNucleo, raices }, ID);
  fs.appendFileSync(path.join(salidas, nueva.data!.ruta.slice('Salidas/'.length)), '\nNota de Persona A.\n');
  const trasEditar = escribirGuiaDeuc({ db, dbNucleo, raices }, ID);

  // Assert
  assert.deepEqual(guias(), ['DEUC_GUIA-v2.md', 'DEUC_GUIA-v3.md', 'DEUC_GUIA-v4.md', 'DEUC_GUIA.md']);
  for (const [n, texto] of antes)
    assert.equal(fs.readFileSync(path.join(carpeta(), n), 'utf8'), texto, `${n} sigue igual`);
  assert.match(nueva.data!.ruta, /DEUC_GUIA-v3\.md$/);
  assert.equal(igual.data!.ruta, nueva.data!.ruta, 'sin cambios no se escribe otra');
  assert.match(leer(nueva.data!.ruta), /Nota de Persona A/, 'la edición de la persona se conserva');
  assert.match(trasEditar.data!.ruta, /DEUC_GUIA-v4\.md$/);
  assert.match(leer(trasEditar.data!.ruta), /\*\*Dirección postal:\*\* Calle Ejemplo 1, 38001 Puerto de Ejemplo/);
  assert.equal(leerGuiaDeuc(db, raices, ID).data!.ruta, trasEditar.data!.ruta);
  assert.equal(leerGuiaDeuc(db, raices, ID).data!.peticion, `Conocimiento/${CARPETA_PLIEGOS}/Deuc.xml`);
});

test('should_include_no_offered_amount', () => {
  // Arrange
  const conTodo = entrada({
    hoja: {
      campos: [{ grupo: 'Oferta', etiqueta: 'Importe sin impuestos', valor: '12.345,00 €', falta: false }],
      avisos: [],
    },
  });

  // Act
  const pura = guiaDeuc(conTodo);
  const escrita = leer(escribirGuiaDeuc({ db, dbNucleo, raices }, ID).data!.ruta);

  // Assert
  for (const texto of [pura, escrita]) {
    for (const forma of ['12345', '12.345', '12 345'])
      assert.ok(!texto.includes(forma), `sin el importe ofertado (${forma})`);
  }
});

test('should_write_the_guide_with_the_package_and_never_upload_it', async () => {
  // Arrange
  const versiones = guias().length;
  assert.equal(
    guardarPerfilEmpresa(dbNucleo, {
      ...PERFIL,
      domicilio: DOMICILIO,
      contacto: { email: 'licitaciones@ejemplo.test', telefono: '600000000' },
    }).error,
    null,
  );

  // Act
  const p = await generarPaquete({ db, dbNucleo, raices }, ID);

  // Assert
  assert.equal(p.error, null, p.error?.message);
  assert.equal(guias().length, versiones + 1, 'el paquete prepara la guía con lo que cambió');
  const subidos = p.data!.manifiesto.carpetas.flatMap((c) => c.documentos.map((d) => d.archivo));
  assert.ok(!subidos.some((a) => /DEUC_GUIA|\.md$/i.test(a)), 'la guía no va al sobre');
});

test('should_not_leave_the_new_package_outdated_by_its_own_guide', async () => {
  // Arrange: el perfil cambia, así que el paquete prepara una guía nueva y la apunta en la fila del DEUC.
  const versiones = guias().length;
  assert.equal(
    guardarPerfilEmpresa(dbNucleo, {
      ...PERFIL,
      domicilio: DOMICILIO,
      contacto: { email: 'ofertas@ejemplo.test', telefono: '600000001' },
    }).error,
    null,
  );

  // Act
  const p = await generarPaquete({ db, dbNucleo, raices }, ID, Date.now());

  // Assert
  assert.equal(p.error, null, p.error?.message);
  assert.equal(guias().length, versiones + 1, 'la guía cambió con el perfil');
  assert.match(filaDocumento(db, ID, DEUC)?.ruta ?? '', /DEUC_GUIA/, 'la fila del DEUC apunta a la guía');
  assert.equal(paqueteVigente(db, ID)?.desfasado, false);
});
