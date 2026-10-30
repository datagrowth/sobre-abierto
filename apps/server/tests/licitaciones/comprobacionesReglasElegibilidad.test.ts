// Reglas de elegibilidad de las comprobaciones sobre entradas sacadas de los fixtures sintéticos de
// CASO_E, CASO_B y CASO_D (requisitos de la ficha y documentos del guion literales). Puras, sin BD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  comprobadoElegibilidad,
  documentosDeElegibilidad,
  reglasElegibilidad,
} from '../../src/dominios/licitaciones/oferta/comprobacionesReglasElegibilidad.js';
import { documentosDelGuion } from '../../src/dominios/licitaciones/oferta/documentos.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import type { CertificadoData } from '../../src/nucleo/empresa.js';

type Fixture = {
  licitacion: { fecha_limite: string };
  oportunidad: { lotes_interes: string[] };
  ficha: { datos: unknown };
  guiones: { datos: Parameters<typeof documentosDelGuion>[0] }[];
  decisiones: { datos: { lotes: string[] } };
};

function fixture(nombre: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/comprobaciones/${nombre}.json`, import.meta.url), 'utf8'),
  ) as Fixture;
}

function entradas(nombre: string, certificados: CertificadoData[] | null): EntradasComprobaciones {
  const f = fixture(nombre);
  const guion = f.guiones[f.guiones.length - 1]!;
  return {
    id: nombre,
    ahoraMs: Date.parse('2027-10-13T20:34:44.000Z'),
    licitacion: { fecha_limite: f.licitacion.fecha_limite },
    ambito: f.oportunidad.lotes_interes,
    ficha: f.ficha,
    documentos: { filas: [], del_guion: documentosDelGuion(guion.datos, f.decisiones.datos.lotes) },
    perfil: { perfil: { certificados }, actualizado_en: '2027-10-13T00:00:00.000Z' },
  } as unknown as EntradasComprobaciones;
}

const impide = (r: ReturnType<typeof reglasElegibilidad>) => r.filter((b) => b.gravedad === 'impide');

test('should_block_casoE_when_the_outline_demands_the_ens_basic_declaration_and_the_profile_has_none', () => {
  const e = entradas('casoE', []);

  const r = reglasElegibilidad(e);

  assert.deepEqual(
    r.map((b) => b.clave),
    ['excluyente_vs_perfil:-:ens'],
  );
  const b = r[0]!;
  assert.equal(b.gravedad, 'impide');
  assert.equal(b.categoria, 'elegibilidad');
  assert.equal(b.actor, 'negocio');
  assert.equal(b.titulo, 'Exigen ENS BÁSICA y el perfil no lo tiene');
  assert.equal(b.accion.tipo, 'subir_certificado');
  assert.deepEqual(b.cita, {
    documento: 'Rectificación de errores materiales del pliego 27-09-2027 1032.pdf',
    pagina: 1,
    texto: 'Declaración de conformidad con el Esquema Nacional de Seguridad (ENS), categoría BÁSICA',
    comprobada: false,
  });
  assert.deepEqual([...documentosDeElegibilidad(e)], ['a1-d11']);
});

test('should_block_casoB_when_ens_medium_is_required_and_we_only_have_basic', () => {
  const e = entradas('casoB', [{ nombre: 'ENS', nivel: 'basica', caduca: null }]);

  const r = reglasElegibilidad(e);

  const ens = r.filter((b) => b.clave === 'excluyente_vs_perfil:-:ens');
  assert.equal(ens.length, 1);
  assert.equal(ens[0]!.gravedad, 'impide');
  assert.equal(ens[0]!.titulo, 'Exigen ENS MEDIA y el perfil no lo tiene');
  assert.equal(ens[0]!.cita?.documento, 'PCAP firmado.pdf');
  assert.equal(ens[0]!.cita?.pagina, 18);
  // La ISO 27001 es una vía para el ENS, no otra exigencia.
  assert.equal(impide(r).filter((b) => b.categoria === 'elegibilidad').length, 1);
  assert.ok(documentosDeElegibilidad(e).has('a1-d20'));
});

test('should_make_annex_xiv_mandatory_when_it_is_the_alternative_to_a_missing_ens', () => {
  const e = entradas('casoB', []);

  const r = reglasElegibilidad(e);

  const anexo = r.filter((b) => b.categoria === 'documentos');
  assert.equal(anexo.length, 1);
  assert.equal(anexo[0]!.clave, 'excluyente_alternativa:-:a1-d21');
  assert.equal(anexo[0]!.gravedad, 'impide');
  assert.equal(anexo[0]!.actor, 'tu');
  assert.equal(anexo[0]!.accion.tipo, 'preparar_documento');
  assert.equal(anexo[0]!.titulo, 'El Anexo XIV pasa a obligatorio: no tenemos ENS MEDIA');
  assert.equal(impide(r).length, 2);
});

test('should_not_block_casoD_where_the_tender_says_no_iso_or_ens_is_required', () => {
  const e = entradas('casoD', []);

  const r = reglasElegibilidad(e);

  assert.deepEqual(r, []);
  assert.equal(documentosDeElegibilidad(e).size, 0);
});

test('should_say_not_checked_when_the_profile_certificates_are_unset', () => {
  const e = entradas('casoE', null);

  const r = reglasElegibilidad(e);

  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'no_comprobado');
  assert.equal(r[0]!.actor, 'tu');
  assert.equal(r[0]!.titulo, 'No se puede comprobar «ENS BÁSICA»: el perfil de empresa no tiene sus certificaciones');
  assert.deepEqual(r[0]!.accion, { tipo: 'completar_empresa', destino: 'empresa.certificados' });
  assert.equal(documentosDeElegibilidad(e).size, 0);
});

test('should_block_a_certificate_that_expires_before_the_deadline', () => {
  const e = entradas('casoE', [{ nombre: 'ENS', nivel: 'media', caduca: '2027-10-09' }]);

  const r = reglasElegibilidad(e);

  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'impide');
  assert.equal(r[0]!.titulo, 'El certificado ENS BÁSICA caduca el 09/10/2027 antes del plazo');
});

test('should_pass_and_report_checked_when_a_higher_valid_level_covers_the_requirement', () => {
  const e = entradas('casoE', [{ nombre: 'ENS', nivel: 'media', caduca: '2028-03-29' }]);

  const r = reglasElegibilidad(e);

  assert.deepEqual(r, []);
  assert.deepEqual(comprobadoElegibilidad(e), [
    { clave: 'excluyente_vs_perfil:-:ens', texto: 'ENS BÁSICA: la tenemos, vigente hasta 29/03/2028' },
  ]);
});

test('should_change_the_fingerprint_when_the_profile_certificates_change', () => {
  const antes = reglasElegibilidad(entradas('casoE', []))[0]!;

  const despues = reglasElegibilidad(entradas('casoE', [{ nombre: 'ISO 9001', nivel: null, caduca: null }]))[0]!;

  assert.equal(antes.clave, despues.clave);
  assert.notEqual(antes.huella, despues.huella);
});
