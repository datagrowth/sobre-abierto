// Regla de medios por rol y materia de las comprobaciones sobre los fixtures sintéticos de
// Villaejemplo (lote 3: nadie tiene registrada la docencia en topografía y jardinería y el Sobre A trae el
// DEUC y el compromiso de adscripción) y CASO_D (la empresa va al lote 2; los medios son del lote 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PersonaGuardada } from '../../src/nucleo/colaboradores/personas.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import { reglasMedios } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasMedios.js';
import { documentosDelGuion } from '../../src/dominios/licitaciones/oferta/documentos.js';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');

type PersonaFixture = Omit<PersonaGuardada, 'id' | 'creada_en' | 'actualizada_en'> & { persona_id: number };
type Fixture = {
  id: string;
  oportunidad: { lotes_interes: string[] };
  ficha: { datos: unknown };
  guiones: { datos: GuionBaseData }[];
  decisiones: { datos: { equipo: { persona_id: number; rol_en_la_oferta: string; lotes: string[] }[] } } | null;
  personas: PersonaFixture[];
};

const leer = (nombre: string): Fixture =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${nombre}.json`), 'utf8')) as Fixture;

const personaDe = (p: PersonaFixture): PersonaGuardada => {
  const { persona_id, ...resto } = p;
  return {
    ...resto,
    id: persona_id,
    creada_en: '2026-01-01T00:00:00Z',
    actualizada_en: '2026-01-01T00:00:00Z',
  } as PersonaGuardada;
};

// Solo lo que miran las reglas de medios: ficha, ámbito, decisiones, Colaboradores y documentos del guion.
function entradas(f: Fixture): EntradasComprobaciones {
  const guion = f.guiones.at(-1)!;
  const ambito = f.oportunidad.lotes_interes;
  return {
    id: f.id,
    ambito,
    ficha: f.ficha,
    guion,
    decisiones: f.decisiones,
    personas: f.personas.map(personaDe),
    documentos: { filas: [], del_guion: documentosDelGuion(guion.datos, ambito) },
  } as unknown as EntradasComprobaciones;
}

const deMedios = (e: EntradasComprobaciones) => reglasMedios(e).filter((b) => b.clave.startsWith('medios:'));

test('should_block_casoC_when_nobody_has_gardening_and_surveying_and_the_deuc_is_declared', () => {
  // Arrange
  const e = entradas(leer('casoC'));

  // Act
  const filas = deMedios(e);

  // Assert
  const topografía = filas.find((b) => b.clave === 'medios:3:topografia');
  assert.ok(topografía, `sin fila de topografía: ${filas.map((b) => b.clave).join(', ')}`);
  assert.equal(topografía.gravedad, 'impide');
  assert.equal(topografía.actor, 'negocio');
  assert.equal(topografía.categoria, 'elegibilidad');
  assert.match(topografía.titulo, /topografía \(lote 3\): nadie del equipo lo tiene registrado$/);
  assert.deepEqual(topografía.cita && { documento: topografía.cita.documento, pagina: topografía.cita.pagina }, {
    documento: 'PPT.pdf',
    pagina: 3,
  });
  const jardinería = filas.find((b) => b.clave.startsWith('medios:3:jardineria'));
  assert.equal(jardinería?.gravedad, 'impide', 'la jardinería tampoco la tiene nadie');
  assert.equal(jardinería?.actor, 'negocio');
});

test('should_ask_to_assign_the_role_as_a_risk_when_someone_registered_has_the_subject', () => {
  // Arrange
  const f = leer('casoC');
  const base = f.personas[0]!;
  f.personas.push({
    ...base,
    persona_id: 2001,
    nombre: 'Persona X',
    sectores: ['topografía'],
    tecnologias: [],
    certificaciones: [],
    titulaciones: [],
  });

  // Act
  const topografía = deMedios(entradas(f)).find((b) => b.clave === 'medios:3:topografia');

  // Assert
  assert.ok(topografía);
  assert.equal(topografía.actor, 'tu');
  assert.equal(topografía.accion.tipo, 'asignar_rol');
  assert.equal(topografía.accion.destino, 'equipo:tutor');
  assert.match(topografía.titulo, /: Persona X lo tiene, asígnala al rol$/);
  assert.equal(topografía.gravedad, 'riesgo', 'se resuelve en un clic en Decisiones: no impide');
});

test('should_flag_communication_and_electronic_administration_as_a_risk_to_assign_and_not_as_a_blocker', () => {
  // Arrange: la tutora no los tiene registrados; otras dos personas del equipo sí.
  const e = entradas(leer('casoC'));

  // Act
  const filas = deMedios(e).filter(
    (b) => b.clave === 'medios:3:comunicacion_institucional' || b.clave === 'medios:3:administracion_electronica',
  );

  // Assert
  assert.equal(filas.length, 2, filas.map((b) => b.clave).join(', '));
  for (const b of filas) {
    assert.equal(b.gravedad, 'riesgo', b.clave);
    assert.equal(b.actor, 'tu', b.clave);
    assert.match(b.titulo, /: Persona \w lo tiene, asígnala al rol$/);
  }
});

test('should_cover_data_analysis_with_the_tutor_data_evidence', () => {
  // Arrange: alguien del equipo tiene registradas tecnologías de análisis de datos.
  const e = entradas(leer('casoC'));

  // Act
  const claves = deMedios(e).map((b) => b.clave);

  // Assert
  assert.ok(!claves.includes('medios:3:analisis_de_datos'), claves.join(', '));
});

test('should_block_data_analysis_when_nobody_has_any_data_evidence', () => {
  // Arrange
  const f = leer('casoC');
  const sinDatos = (xs: string[]) =>
    xs.filter((x) => !/(?:an[aá]lisis|an[aá]lit|analytics|datos|data|estad[ií]stic|business intelligence)/i.test(x));
  f.personas = f.personas.map((p) => ({
    ...p,
    sectores: sinDatos(p.sectores),
    tecnologias: sinDatos(p.tecnologias),
    certificaciones: sinDatos(p.certificaciones),
    titulaciones: sinDatos(p.titulaciones),
  }));

  // Act
  const ia = deMedios(entradas(f)).find((b) => b.clave === 'medios:3:analisis_de_datos');

  // Assert
  assert.equal(ia?.gravedad, 'impide');
  assert.equal(ia?.actor, 'negocio');
  assert.match(ia?.titulo ?? '', /^Tutor de análisis de datos \(lote 3\): nadie del equipo lo tiene registrado$/);
});

test('should_block_a_required_role_with_nobody_in_the_decisions', () => {
  // Arrange
  const f = leer('casoC');
  f.decisiones!.datos.equipo = f.decisiones!.datos.equipo.filter((m) => !/^Coordinadora/.test(m.rol_en_la_oferta));

  // Act
  const filas = deMedios(entradas(f));

  // Assert
  const rol = filas.find((b) => b.clave === 'medios:3:rol_coordinador');
  assert.ok(rol, `sin fila de rol: ${filas.map((b) => b.clave).join(', ')}`);
  assert.equal(rol.gravedad, 'impide');
  assert.equal(rol.actor, 'tu');
  assert.equal(rol.accion.destino, 'equipo:coordinador');
  assert.ok(
    filas.some((b) => b.clave === 'medios:3:topografia'),
    'las materias son de los tutores, que siguen en el equipo',
  );
});

test('should_check_each_subject_against_the_role_it_belongs_to', () => {
  // Arrange: la coordinadora no tiene nada; la tutora (otra persona) sí tiene topografía y jardinería.
  const f = leer('casoC');
  const base = f.personas[0]!;
  f.personas.push({
    ...base,
    persona_id: 2002,
    nombre: 'Persona Y',
    sectores: ['topografía', 'jardinería'],
    tecnologias: [],
    certificaciones: [],
    titulaciones: [],
  });
  f.decisiones!.datos.equipo = f.decisiones!.datos.equipo.map((m) =>
    /^Tutora/.test(m.rol_en_la_oferta) ? { ...m, persona_id: 2002 } : m,
  );

  // Act
  const claves = deMedios(entradas(f)).map((b) => b.clave);

  // Assert
  assert.ok(!claves.includes('medios:3:topografia'), claves.join(', '));
  assert.ok(!claves.some((k) => k.startsWith('medios:3:jardineria')), claves.join(', '));
});

test('should_look_in_colaboradores_when_nobody_has_the_role_of_the_subject', () => {
  // Arrange: sin tutora en el equipo, el topografía lo tiene alguien de Colaboradores.
  const f = leer('casoC');
  const base = f.personas[0]!;
  f.personas.push({
    ...base,
    persona_id: 2003,
    nombre: 'Persona Z',
    sectores: ['topografía'],
    tecnologias: [],
    certificaciones: [],
    titulaciones: [],
  });
  f.decisiones!.datos.equipo = f.decisiones!.datos.equipo.filter((m) => !/^Tutora/.test(m.rol_en_la_oferta));

  // Act
  const claves = deMedios(entradas(f)).map((b) => b.clave);

  // Assert
  assert.ok(!claves.includes('medios:3:topografia'), claves.join(', '));
  assert.ok(
    claves.some((k) => k.startsWith('medios:3:jardineria')),
    'la jardinería no la tiene nadie',
  );
});

test('should_write_titles_with_the_tender_wording', () => {
  // Arrange
  const e = entradas(leer('casoC'));

  // Act
  const filas = deMedios(e);

  // Assert
  assert.match(
    filas.find((b) => b.clave === 'medios:3:administracion_electronica')?.titulo ?? '',
    /^Tutor de administración electrónica \(lote 3\)/,
  );
  const casoF = deMedios(entradas(leer('casoF'))).find((b) => b.clave.startsWith('medios:-:auditoria'));
  assert.match(casoF?.titulo ?? '', /^Técnico de auditoría de accesibilidad web o evaluación de usabilidad:/);
  assert.equal(casoF?.accion.destino, 'equipo:tecnico', 'el rol entero, no su raíz');
});

test('should_not_block_the_online_hours_that_colaboradores_does_not_record', () => {
  // Arrange
  const e = entradas(leer('casoC'));

  // Act
  const horas = deMedios(e).find((b) => b.clave.startsWith('medios:3:teleformacion'));

  // Assert
  assert.equal(horas?.gravedad, 'no_comprobado');
  assert.match(
    horas?.titulo ?? '',
    /teleformación\/TIC o 60 h de impartición online.*las horas no constan en Colaboradores/,
  );
});

test('should_not_block_an_experience_related_to_nothing_named', () => {
  // Arrange: CASO_B pide «2 años de experiencia profesional no docente relacionada».
  const e = entradas(leer('casoB'));

  // Act
  const fila = deMedios(e).find((b) => b.clave === 'medios:-:experiencia_profesional_no_docente_relacionada');

  // Assert
  assert.equal(fila?.gravedad, 'no_comprobado');
  assert.match(fila?.titulo ?? '', /el pliego no nombra la materia/);
});

test('should_only_warn_when_neither_annex_vii_nor_deuc_is_presented', () => {
  // Arrange
  const f = leer('casoC');
  const guion = f.guiones.at(-1)!;
  guion.datos.archivos = guion.datos.archivos.map((a) => ({
    ...a,
    documentos: a.documentos.filter((d) => d.tipo !== 'deuc' && !/ADSCRIPCI/i.test(d.nombre)),
  }));

  // Act
  const filas = deMedios(entradas(f));

  // Assert
  assert.ok(filas.length > 0);
  assert.ok(
    filas.every((b) => b.gravedad !== 'impide'),
    filas.map((b) => `${b.clave}:${b.gravedad}`).join(', '),
  );
  assert.equal(filas.find((b) => b.clave === 'medios:3:topografia')?.gravedad, 'riesgo');
});

test('should_not_block_casoD_for_personal_means_of_a_lot_we_do_not_go_to', () => {
  // Arrange
  const e = entradas(leer('casoD'));

  // Act
  const filas = deMedios(e);

  // Assert
  assert.deepEqual(
    filas.filter((b) => b.gravedad === 'impide').map((b) => b.clave),
    [],
  );
});

test('should_not_count_a_doubtful_requirement_as_accredited', () => {
  // Arrange
  const f = leer('casoC');
  const ficha = f.ficha.datos as { requisitos: { tipo: string; cumple: string }[] };
  for (const r of ficha.requisitos) if (r.tipo === 'medios_personales') r.cumple = 'dudoso';

  // Act
  const topografía = deMedios(entradas(f)).find((b) => b.clave === 'medios:3:topografia');

  // Assert
  assert.equal(topografía?.gravedad, 'impide');
});

test('should_give_no_rows_without_a_ficha', () => {
  // Arrange
  const e = { ...entradas(leer('casoC')), ficha: null };

  // Act
  const filas = reglasMedios(e);

  // Assert
  assert.deepEqual(filas, []);
});
