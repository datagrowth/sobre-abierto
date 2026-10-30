import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bloqueoDeRequisito,
  fiabilidadFicha,
  filtrarPorLotes,
  idsInteres,
  resumenExcluyentes,
} from './expedienteFormato.js';
import { requisitosALaVista, requisitosDeFicha } from './licitacionesFormato.js';
import { rutaComprobaciones } from './rutas.js';

// Las respuestas reales del servidor (seudonimizadas) que usa también Playwright.
const datos = (oferta, id) => {
  const d = JSON.parse(readFileSync(new URL(`../../e2e/datos/${oferta}.json`, import.meta.url), 'utf8'));
  return {
    f: d[`GET /api/licitaciones/licitaciones/${id}`].body,
    comprobaciones: d[`GET /api/licitaciones/licitaciones/${id}/comprobaciones`].body,
  };
};
const requisitosDe = (f) =>
  requisitosALaVista(f.go_no_go.requisitos, requisitosDeFicha(f.go_no_go.ficha.aprobada)).lista;

const CASO_D = datos('casoD', 'p-91000880');
const CASO_B = datos('casoB', 'p-91000740');

test('should_show_only_requirements_of_lots_of_interest_by_default', () => {
  // Arrange
  const requisitos = requisitosDe(CASO_D.f);

  // Act
  const vistos = filtrarPorLotes(requisitos, idsInteres(CASO_D.f), false);

  // Assert
  assert.deepEqual(idsInteres(CASO_D.f), ['2']);
  assert.equal(vistos.filter((r) => r.lote === '1').length, 0);
  assert.equal(vistos.filter((r) => r.lote === '2').length, requisitos.filter((r) => r.lote === '2').length);
  assert.equal(vistos.filter((r) => !r.lote).length, requisitos.filter((r) => !r.lote).length);
});

test('should_filter_criteria_and_documents_by_the_lot_named_in_their_text', () => {
  // Arrange
  const datosFicha = CASO_D.f.go_no_go.ficha.aprobada.datos;

  // Act
  const criterios = filtrarPorLotes(datosFicha.criterios, ['2']);
  const documentos = filtrarPorLotes(datosFicha.documentacion, ['2']);

  // Assert
  assert.ok(criterios.length > 0 && criterios.every((c) => /^Lote 2:/.test(c.descripcion)));
  assert.ok(documentos.every((d) => !/\blote 1\b/i.test(d.documento)));
  assert.ok(documentos.some((d) => d.documento.startsWith('Anexo I:')));
});

test('should_show_every_lot_when_asked', () => {
  // Arrange
  const requisitos = requisitosDe(CASO_D.f);

  // Act
  const todos = filtrarPorLotes(requisitos, ['2'], true);
  const sinInteres = filtrarPorLotes(requisitos, [], false);

  // Assert
  assert.equal(todos.length, requisitos.length);
  assert.equal(sinInteres.length, requisitos.length);
});

test('should_link_each_exclusion_requirement_to_its_comprobaciones_row', () => {
  // Arrange
  const requisitos = filtrarPorLotes(requisitosDe(CASO_B.f), idsInteres(CASO_B.f));

  // Act
  const r = resumenExcluyentes(requisitos, CASO_B.comprobaciones.bloqueos, CASO_B.f.id);

  // Assert
  const de = (texto) => r.items.find((x) => x.etiqueta.startsWith(texto));
  assert.equal(r.n, r.items.length);
  assert.equal(de('Una persona formadora').clave, 'medios:-:experiencia_profesional_no_docente_relacionada');
  assert.equal(
    de('Garantizar la conformidad con el ENS').ruta,
    rutaComprobaciones(CASO_B.f.id, 'excluyente_vs_perfil:-:ens'),
  );
  assert.equal(
    de('Nombrar una persona coordinadora').clave,
    'medios:-:gestion',
    'la fila «Coordinador de gestión: … lo tiene, asígnala al rol»',
  );
  assert.equal(de('Nombrar una persona coordinadora').ruta, rutaComprobaciones(CASO_B.f.id, 'medios:-:gestion'));
});

test('should_leave_an_exclusion_without_link_when_its_subject_matches_several_rows', () => {
  // Arrange
  const r = { descripcion: 'Certificación ENS e ISO 27001', lote: null, excluyente: true, resultado: 'desconocido' };
  const bloqueos = [
    { clave: 'excluyente_vs_perfil:-:ens', categoria: 'elegibilidad', lote: null, estado: 'abierto', cita: null },
    { clave: 'otra:-:ens', categoria: 'elegibilidad', lote: null, estado: 'abierto', cita: null },
    { clave: 'excluyente_vs_perfil:1:ens', categoria: 'elegibilidad', lote: '1', estado: 'abierto', cita: null },
  ];

  // Act
  const pareja = bloqueoDeRequisito(r, bloqueos);
  const unica = bloqueoDeRequisito(r, bloqueos.slice(0, 1));

  // Assert
  assert.equal(pareja, null);
  assert.equal(unica.clave, 'excluyente_vs_perfil:-:ens');
});

test('should_join_profile_age_coverage_and_quality_warnings_in_one_line', () => {
  // Arrange
  const f = {
    go_no_go: {
      perfil_empresa: null,
      version_ficha_actual: 4,
      ficha: {
        aprobada: {
          version_prompt: 2,
          datos: {
            cobertura: [
              { tema: 'habilitacion', estado: 'no_encontrado' },
              { tema: 'seguro', estado: 'no_lo_pide' },
            ],
            calidad: { puntuacion: 72, dudosos_pct: 15 },
          },
        },
      },
    },
  };

  // Act
  const linea = fiabilidadFicha(f);

  // Assert
  assert.equal(linea.avisa, true);
  assert.match(linea.texto, /^Fiabilidad de la ficha: sin el perfil de la empresa/);
  assert.match(linea.texto, /regla anterior \(v2; la vigente es la v4\)/);
  assert.match(linea.texto, /no encontrado en los pliegos: habilitación/);
  assert.match(linea.texto, /calidad 72\/100, 15 % por confirmar\.$/);
  assert.doesNotMatch(linea.texto, /seguro/);
});

test('should_not_warn_when_only_quality_is_known', () => {
  // Arrange
  const f = {
    go_no_go: {
      perfil_empresa: {},
      version_ficha_actual: 4,
      ficha: { aprobada: { version_prompt: 4, datos: { calidad: { puntuacion: 91, dudosos_pct: 0 } } } },
    },
  };

  // Act
  const linea = fiabilidadFicha(f);
  const sinFicha = fiabilidadFicha({});

  // Assert
  assert.deepEqual(linea, { texto: 'Fiabilidad de la ficha: calidad 91/100.', avisa: false });
  assert.equal(sinFicha, null);
});
