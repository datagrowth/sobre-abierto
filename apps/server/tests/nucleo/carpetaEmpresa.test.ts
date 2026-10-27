// Carpeta Empresa: documentos fijos de la empresa con su caducidad, guardados sin
// pisar nada en la Biblioteca, con aviso en «Hoy» y lectura para los agentes.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import {
  avisosCaducidad,
  borrarDocumentoEmpresa,
  cambiarDocumentoEmpresa,
  documentosParaAgente,
  listarDocumentosEmpresa,
  subirDocumentoEmpresa,
} from '../../src/nucleo/carpetaEmpresa.js';
import { hoyEmpresa } from '../../src/nucleo/hoyNucleo.js';
import { carpetasOcultas, enColaboradores } from '../../src/nucleo/colaboradores/cvs.js';
import { esRutaDocumento } from '../../src/nucleo/salidas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carpeta-empresa-'));
const raiz = path.join(tmp, 'conocimiento');
const db = abrirNucleo(path.join(tmp, 'datos'));
const HOY = '2026-10-14';

after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM empresa_documentos; DELETE FROM documentos; DELETE FROM personas');
  fs.rmSync(raiz, { recursive: true, force: true });
});

const archivo = (nombre: string, texto = 'pdf de prueba') => ({ nombre, datos: Buffer.from(texto), campos: {} });

async function subir(nombre: string, datos: Record<string, unknown>, texto?: string) {
  const r = await subirDocumentoEmpresa(db, raiz, archivo(nombre, texto), datos);
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}

test('should_mark_a_document_expiring_in_30_days_or_less', async () => {
  await subir('tgss.pdf', { tipo: 'tgss', nombre: 'Certificado TGSS', caduca_en: '2026-11-13' });
  await subir('aeat.pdf', { tipo: 'aeat', nombre: 'Certificado AEAT', caduca_en: '2026-11-14' });
  await subir('escritura.pdf', { tipo: 'escritura', nombre: 'Escritura de constitución' });

  const lista = listarDocumentosEmpresa(db, HOY);

  assert.deepEqual(
    lista.map((d) => [d.tipo, d.estado, d.dias]),
    [
      ['tgss', 'caduca_pronto', 30],
      ['aeat', 'vigente', 31],
      ['escritura', 'sin_fecha', null],
    ],
  );
});

test('should_mark_an_expired_document', async () => {
  await subir('rolece.pdf', { tipo: 'rolece', nombre: 'Inscripción ROLECE', caduca_en: '2026-10-13' });

  const [d] = listarDocumentosEmpresa(db, HOY);
  const [aviso] = avisosCaducidad(db, HOY);

  assert.equal(d?.estado, 'caducado');
  assert.equal(aviso?.texto, 'La inscripción en el ROLECE caducó el 13/10/2026 (hace 1 día)');
});

test('should_never_overwrite_an_existing_file_in_the_company_folder', async () => {
  fs.mkdirSync(path.join(raiz, 'Empresa/tgss'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'Empresa/tgss/certificado.pdf'), 'puesto a mano en Drive');

  const d = await subir('certificado.pdf', { tipo: 'tgss', nombre: 'Certificado TGSS' }, 'el nuevo');
  const otraVez = await subirDocumentoEmpresa(db, raiz, archivo('certificado.pdf', 'el nuevo'), {
    tipo: 'tgss',
    nombre: 'Certificado TGSS',
  });

  assert.equal(d.ruta, 'Empresa/tgss/certificado-1.pdf');
  assert.equal(fs.readFileSync(path.join(raiz, 'Empresa/tgss/certificado.pdf'), 'utf8'), 'puesto a mano en Drive');
  assert.equal(otraVez.error?.code, 'conflicto');
});

test('should_reject_an_unsupported_extension', async () => {
  const r = await subirDocumentoEmpresa(db, raiz, archivo('macro.exe'), { tipo: 'otro', nombre: 'Algo' });

  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(fs.existsSync(path.join(raiz, 'Empresa')), false);
});

test('should_reject_invalid_form_data_before_saving_the_file', async () => {
  const r = await subirDocumentoEmpresa(db, raiz, archivo('tgss.pdf'), {
    tipo: 'tgss',
    nombre: 'X',
    caduca_en: '02/11/2026',
  });

  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(fs.existsSync(path.join(raiz, 'Empresa')), false);
});

test('should_hide_cvs_from_an_agent_without_colaboradores_permission', async () => {
  db.prepare(
    `INSERT INTO personas (id, nombre, tipo, datos, creada_en, actualizada_en) VALUES (7, 'Persona A', 'interno', '{}', ?, ?)`,
  ).run(HOY, HOY);
  await subir('cv.pdf', { tipo: 'cv', nombre: 'CV Persona A', persona_id: 7, horas_desglosadas: true });
  await subir('titulo.pdf', { tipo: 'titulo', nombre: 'Título Persona A', persona_id: 7 });
  await subir('tgss.pdf', { tipo: 'tgss', nombre: 'Certificado TGSS', caduca_en: '2026-11-03' });

  const sinPermiso = documentosParaAgente(db, { plataforma: 'leer' }, HOY);
  const conPermiso = documentosParaAgente(db, { plataforma: 'leer', colaboradores: 'leer' }, HOY);

  assert.deepEqual(sinPermiso, [
    {
      tipo: 'tgss',
      nombre: 'Certificado TGSS',
      ruta: 'Empresa/tgss/tgss.pdf',
      caduca_en: '2026-11-03',
      estado: 'caduca_pronto',
    },
  ]);
  assert.equal(conPermiso.length, 3);
});

test('should_hide_company_cvs_from_library_search_without_colaboradores_permission', async () => {
  db.prepare(
    `INSERT INTO personas (id, nombre, tipo, datos, creada_en, actualizada_en) VALUES (7, 'Persona A', 'interno', '{}', ?, ?)`,
  ).run(HOY, HOY);
  const cv = await subir('cv.pdf', { tipo: 'cv', nombre: 'CV Persona A' });
  const titulo = await subir('titulo.pdf', { tipo: 'titulo', nombre: 'Título Persona A', persona_id: 7 });
  const tgss = await subir('tgss.pdf', { tipo: 'tgss', nombre: 'Certificado TGSS' });

  const ocultas = carpetasOcultas({ plataforma: 'leer' });

  assert.equal(cv.ruta, 'Colaboradores/Empresa/cv/cv.pdf');
  assert.equal(titulo.ruta, 'Colaboradores/Empresa/titulo/titulo.pdf');
  assert.equal(fs.existsSync(path.join(raiz, 'Colaboradores/Empresa/cv/cv.pdf')), true);
  // Lo que biblioteca_buscar excluye y biblioteca_leer y las citas rechazan sin permiso.
  assert.deepEqual(ocultas, ['Colaboradores']);
  assert.ok([cv, titulo].every((d) => enColaboradores(d.ruta) && !esRutaDocumento(`Conocimiento/${d.ruta}`)));
  assert.equal(tgss.ruta, 'Empresa/tgss/tgss.pdf');
  assert.equal(enColaboradores(tgss.ruta), false);
});

test('should_reject_turning_a_company_document_into_a_personal_one_outside_colaboradores', async () => {
  // Arrange: un título subido sin persona (en Empresa/titulo/) y un CV ya en Colaboradores/.
  db.prepare(
    `INSERT OR IGNORE INTO personas (id, nombre, tipo, datos, creada_en, actualizada_en) VALUES (7, 'Persona A', 'interno', '{}', ?, ?)`,
  ).run(HOY, HOY);
  const titulo = await subir('titulo-sin-persona.pdf', { tipo: 'titulo', nombre: 'Título' });
  const cv = await subir('cv-persona.pdf', { tipo: 'cv', nombre: 'CV' });

  // Act
  const conPersona = cambiarDocumentoEmpresa(db, titulo.id, { persona_id: 7 });
  const comoCv = cambiarDocumentoEmpresa(db, titulo.id, { tipo: 'cv' });
  const cvConPersona = cambiarDocumentoEmpresa(db, cv.id, { persona_id: 7 });

  // Assert
  assert.equal(titulo.ruta, 'Empresa/titulo/titulo-sin-persona.pdf');
  assert.equal(conPersona.error?.code, 'invalid_input');
  assert.match(conPersona.error!.message, /vuelve a subirlo/);
  assert.equal(comoCv.error?.code, 'invalid_input');
  assert.equal(listarDocumentosEmpresa(db, HOY).find((d) => d.id === titulo.id)?.persona_id, null, 'la fila no cambia');
  assert.equal(cvConPersona.error, null, 'ya está en Colaboradores/');
});

test('should_add_an_expiry_warning_to_today', async () => {
  const d = await subir('tgss.pdf', { tipo: 'tgss', nombre: 'Certificado TGSS', caduca_en: '2026-11-03' });
  await subir('aeat.pdf', { tipo: 'aeat', nombre: 'Certificado AEAT', caduca_en: '2027-03-01' });

  const hoy = hoyEmpresa(db, HOY);

  assert.equal(hoy.vence.length, 1);
  assert.equal(hoy.vence[0]?.detalle, 'El certificado de la TGSS caduca el 03/11/2026 (en 20 días)');
  assert.deepEqual(hoy.vence[0]?.enlace, { seccion: 'ajustes', vista: 'empresa', id: String(d.id) });
});

test('should_change_and_delete_only_the_row_never_the_file', async () => {
  const d = await subir('seguro.pdf', { tipo: 'seguro', nombre: 'Póliza RC', caduca_en: '2026-12-31' });

  const cambiado = cambiarDocumentoEmpresa(db, d.id, { caduca_en: '2027-12-31', notas: 'renovada' });
  const borrado = borrarDocumentoEmpresa(db, d.id);

  assert.equal(cambiado.data?.caduca_en, '2027-12-31');
  assert.equal(cambiado.data?.nombre, 'Póliza RC');
  assert.equal(borrado.error, null);
  assert.equal(listarDocumentosEmpresa(db, HOY).length, 0);
  assert.equal(fs.existsSync(path.join(raiz, d.ruta)), true);
  assert.equal(borrarDocumentoEmpresa(db, d.id).error?.code, 'not_found');
});

test('should_reject_an_empty_change_or_an_unknown_person', async () => {
  const d = await subir('cv.pdf', { tipo: 'cv', nombre: 'CV' });

  assert.equal(cambiarDocumentoEmpresa(db, d.id, {}).error?.code, 'invalid_input');
  assert.equal(cambiarDocumentoEmpresa(db, d.id, { persona_id: 999 }).error?.code, 'invalid_input');
  assert.equal(cambiarDocumentoEmpresa(db, 12345, { notas: 'x' }).error?.code, 'not_found');
});
