// Lo propio de cada instalación sale del perfil de la empresa, no del código: el nombre en los
// prompts, la zona horaria de los avisos y de la segunda hora de los plazos, la región y la banda
// de los rankings. Sin perfil todo queda neutro: «la empresa», hora peninsular, toda España.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNucleo } from '../../src/nucleo/db.js';
import {
  areasFormacion,
  guardarPerfilEmpresa,
  nombreDelPerfil,
  nombreEmpresa,
  nombreGuardado,
  PerfilEmpresa,
  zonaEmpresa,
} from '../../src/nucleo/empresa.js';
import { instruccionesNota } from '../../src/nucleo/bibliotecaGestion.js';
import { instruccionesPerfilCv } from '../../src/nucleo/colaboradores/propuestas.js';
import { instruccionesCriba } from '../../src/dominios/licitaciones/criba.js';
import { instruccionesFicha } from '../../src/dominios/licitaciones/ficha.js';
import { instruccionesActaMercado } from '../../src/dominios/licitaciones/actasMercado.js';
import { instruccionesResumen } from '../../src/dominios/licitaciones/competencia/resumen.js';
import { instruccionesGuion } from '../../src/dominios/licitaciones/oferta/guion.js';
import { instruccionesPropuestaDecisiones } from '../../src/dominios/licitaciones/oferta/propuestaDecisiones.js';
import { instruccionesRevisionPrevia } from '../../src/dominios/licitaciones/oferta/revisionPrevia.js';
import { instruccionesActa } from '../../src/dominios/licitaciones/propuestas/actas.js';
import { instruccionesEvaluacion } from '../../src/dominios/licitaciones/propuestas/evaluacion.js';
import { REGLAS_REDACCION } from '../../src/dominios/licitaciones/oferta/memoriaInstrucciones.js';
import { DECISIONES_DE_DISENO } from '../../src/dominios/licitaciones/oferta/estrategia.js';
import { textoPlazo } from '../../src/dominios/licitaciones/oferta/plazo.js';
import { compromisosNoListados } from '../../src/dominios/licitaciones/oferta/compromisosSolucion.js';
import { EMPRESA_EJEMPLO } from '../fixtures/empresaEjemplo.js';

const PEDIDA = '2026-10-26T09:00:00Z';
// El nombre de la empresa que estaba escrito en el código, escrito así para que este test no
// salga en el grep de control del repo.
const NOMBRE_ANTERIOR = /datagr[o]wth/i;
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function nucleoVacio() {
  return abrirNucleo(fs.mkdtempSync(path.join(os.tmpdir(), 'empresa-config-')));
}

function archivos(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? archivos(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('should_say_la_empresa_and_peninsular_time_without_a_profile', () => {
  const db = nucleoVacio();
  assert.equal(nombreEmpresa(db), 'la empresa');
  assert.equal(nombreGuardado(db), null);
  assert.equal(zonaEmpresa(db), 'Europe/Madrid');
  db.close();
});

test('should_use_the_trade_name_or_the_legal_name_without_its_legal_form', () => {
  assert.equal(nombreDelPerfil({ nombre: 'Analítica Ejemplo, S.L.', nombre_comercial: null }), 'Analítica Ejemplo');
  assert.equal(nombreDelPerfil({ nombre: 'ANALITICA EJEMPLO SLU', nombre_comercial: null }), 'ANALITICA EJEMPLO');
  assert.equal(nombreDelPerfil({ nombre: 'Analítica Ejemplo, S.L.', nombre_comercial: 'Analitix' }), 'Analitix');
  assert.equal(nombreDelPerfil({ nombre: 'S.L.', nombre_comercial: null }), 'S.L.', 'nunca vacío');
});

test('should_read_name_and_time_zone_from_the_saved_profile', () => {
  const db = nucleoVacio();
  assert.equal(guardarPerfilEmpresa(db, { ...EMPRESA_EJEMPLO, zona_horaria: 'Atlantic/Canary' }).error, null);
  assert.equal(nombreEmpresa(db), 'Analítica Ejemplo');
  assert.equal(zonaEmpresa(db), 'Atlantic/Canary');
  db.close();
});

test('should_have_no_training_areas_by_default_and_read_the_saved_ones', () => {
  const db = nucleoVacio();
  assert.deepEqual(areasFormacion(db), [], 'sin perfil, ninguna');
  guardarPerfilEmpresa(db, EMPRESA_EJEMPLO);
  assert.deepEqual(areasFormacion(db), [], 'un perfil sin el campo, ninguna');
  const areas = ['inteligencia artificial', 'dato (analítica, gobierno del dato)'];
  assert.equal(guardarPerfilEmpresa(db, { ...EMPRESA_EJEMPLO, areas_formacion: areas }).error, null);
  assert.deepEqual(areasFormacion(db), areas);
  assert.equal(guardarPerfilEmpresa(db, { ...EMPRESA_EJEMPLO, areas_formacion: ['x'] }).error?.code, 'invalid_input');
  db.close();
});

test('should_validate_trade_name_and_time_zone_of_the_profile', () => {
  const sinCampos = PerfilEmpresa.parse(EMPRESA_EJEMPLO);
  assert.deepEqual(
    [sinCampos.nombre_comercial, sinCampos.zona_horaria],
    [null, 'Europe/Madrid'],
    'un perfil guardado antes sigue valiendo y queda neutro',
  );
  assert.equal(
    PerfilEmpresa.parse({ ...EMPRESA_EJEMPLO, nombre_comercial: '' }).nombre_comercial,
    null,
    'en blanco es sin nombre comercial',
  );
  assert.equal(PerfilEmpresa.safeParse({ ...EMPRESA_EJEMPLO, zona_horaria: 'America/Bogota' }).success, false);
  assert.equal(
    PerfilEmpresa.safeParse({ ...EMPRESA_EJEMPLO, region_nuts: 'ES7' }).success,
    false,
    'la región va en la escala de Licitaciones',
  );
});

test('should_read_a_profile_saved_with_the_retired_region_and_band', () => {
  const db = nucleoVacio();
  db.prepare("INSERT INTO perfil_empresa (id, datos, actualizado_en) VALUES (1, ?, '2026-10-26')").run(
    JSON.stringify({ ...EMPRESA_EJEMPLO, region_nuts: 'ES7', banda_importe_min: 7000, banda_importe_max: 130000 }),
  );
  assert.equal(nombreEmpresa(db), 'Analítica Ejemplo');
  db.close();
});

test('should_add_the_canary_hour_to_a_deadline_only_for_a_canary_company', () => {
  assert.equal(textoPlazo('2026-10-15T08:00:00', 'Europe/Madrid'), 'el 15/10/2026 a las 08:00 hora peninsular');
  assert.equal(
    textoPlazo('2026-10-15T08:00:00', 'Atlantic/Canary'),
    'el 15/10/2026 a las 08:00 hora peninsular (07:00 en Canarias)',
  );
  assert.equal(
    textoPlazo('2026-10-15T00:30:00', 'Atlantic/Canary'),
    'el 15/10/2026 a las 00:30 hora peninsular (23:30 en Canarias)',
  );
});

test('should_not_count_the_company_name_as_what_a_commitment_is_about', () => {
  // «Analitix» sale en las dos frases: sin quitarlo, la frase de las entrevistas parecería cubierta.
  const texto = 'Analitix hará una entrevista con cada alumna cada semana.';
  const listados = ['Analitix revisará cada semana los indicadores.'];
  assert.deepEqual(compromisosNoListados(texto, listados, [], 'Analitix'), [texto]);
});

test('should_never_write_the_previous_company_name_in_a_prompt_with_another_profile', () => {
  const db = nucleoVacio();
  guardarPerfilEmpresa(db, EMPRESA_EJEMPLO);
  const empresa = nombreEmpresa(db);

  const prompts = [
    instruccionesCriba(3, empresa),
    instruccionesFicha('p-1', empresa),
    instruccionesActaMercado('p-1', empresa),
    instruccionesResumen('B00000001', empresa),
    instruccionesGuion('p-1', empresa),
    instruccionesPropuestaDecisiones('p-1', 2, empresa),
    instruccionesRevisionPrevia({ id: 'p-1', paquete_version: 1, pedida_en: PEDIDA }, empresa),
    instruccionesNota({ ruta: 'Casos/informe.pdf', tema: null, pedida_en: PEDIDA }, empresa),
    instruccionesPerfilCv({ cv_ruta: 'Colaboradores/cv.md', persona_id: null, pedida_en: PEDIDA }, empresa),
    instruccionesActa(
      {
        carpeta: 'Licitaciones/Presentadas/x',
        documento: 'Conocimiento/Licitaciones/Presentadas/x/acta.pdf',
        pedida_en: PEDIDA,
      },
      EMPRESA_EJEMPLO,
      [],
    ),
  ];
  // Sin la base de licitaciones, la evaluación no lee el perfil: va con «la empresa».
  const otros = [instruccionesEvaluacion('p-1', 'Salidas/x.md'), REGLAS_REDACCION.voz(empresa), DECISIONES_DE_DISENO];

  for (const p of [...prompts, ...otros]) assert.doesNotMatch(p, NOMBRE_ANTERIOR);
  assert.ok(
    prompts.every(
      (p) =>
        p.includes('Tarea automática de la plataforma de Analítica Ejemplo:') ||
        p.includes('Tarea de la plataforma de Analítica Ejemplo'),
    ),
  );
  assert.match(REGLAS_REDACCION.voz(empresa), /«Analítica Ejemplo implanta…»/);
  db.close();
});

test('should_not_write_the_previous_company_name_anywhere_in_the_server_code', () => {
  const conNombre = archivos(SRC)
    .filter((f) => NOMBRE_ANTERIOR.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f));
  assert.deepEqual(conNombre, []);
});
