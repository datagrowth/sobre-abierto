// Reglas de la ficha de las comprobaciones sobre entradas sintéticas (puras, sin BD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reglasFicha } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasFicha.js';
import { VERSION_PROMPT_FICHA } from '../../src/dominios/licitaciones/ficha.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';

type Parcial = {
  ficha?: { creada_en: string; version_prompt: number } | null;
  pliegos?: { nombre: string; estado?: string; actualizado_en: string }[];
  trabajos?: { tipo: string }[];
};

function entradas(p: Parcial): EntradasComprobaciones {
  const ficha =
    p.ficha === undefined ? { creada_en: '2026-09-27T10:00:00.000Z', version_prompt: VERSION_PROMPT_FICHA } : p.ficha;
  return {
    ficha,
    pliegos: (p.pliegos ?? []).map((x) => ({ clase: 'adicional', estado: 'descargado', ...x })),
    trabajos: p.trabajos ?? [],
  } as unknown as EntradasComprobaciones;
}

const NOTA = 'Nota de rectificación ENS.pdf';

test('should_block_when_a_rectification_arrived_after_the_sheet_was_requested', () => {
  const r = reglasFicha(entradas({ pliegos: [{ nombre: NOTA, actualizado_en: '2026-09-28T13:28:00.000Z' }] }));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'impide');
  assert.equal(r[0]!.actor, 'tu');
  assert.equal(r[0]!.categoria, 'elegibilidad');
  assert.equal(r[0]!.accion.tipo, 'rehacer_ficha');
  assert.equal(r[0]!.titulo, `La ficha es anterior a «${NOTA}»: rehazla`);
  assert.equal(r[0]!.cita?.documento, NOTA);
  assert.match(r[0]!.clave, /^ficha_anterior_rectificacion:-:[0-9a-f]{8}$/);
});

test('should_only_warn_for_other_key_documents_after_the_sheet', () => {
  const r = reglasFicha(
    entradas({ pliegos: [{ nombre: 'Anexo II modelo de oferta.docx', actualizado_en: '2026-09-28T13:28:00.000Z' }] }),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'riesgo');
});

test('should_ignore_documents_older_than_the_sheet_or_not_downloaded_or_not_key', () => {
  const r = reglasFicha(
    entradas({
      pliegos: [
        { nombre: NOTA, actualizado_en: '2026-09-26T10:00:00.000Z' },
        { nombre: 'Otra rectificación.pdf', estado: 'pendiente', actualizado_en: '2026-09-28T10:00:00.000Z' },
        { nombre: 'Memoria justificativa.pdf', actualizado_en: '2026-09-28T10:00:00.000Z' },
      ],
    }),
  );
  assert.deepEqual(r, []);
});

test('should_warn_when_the_sheet_was_made_with_an_older_rule', () => {
  const r = reglasFicha(entradas({ ficha: { creada_en: '2026-09-27T10:00:00.000Z', version_prompt: 2 } }));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'riesgo');
  assert.equal(r[0]!.titulo, 'La ficha se hizo con una regla anterior (v2): rehazla');
  assert.equal(r[0]!.clave, 'ficha_regla_anterior:-:v2');
});

test('should_say_hermes_is_working_when_the_sheet_job_is_running', () => {
  const r = reglasFicha(entradas({ ficha: null, trabajos: [{ tipo: 'licitaciones.ficha' }] }));
  assert.equal(r[0]!.actor, 'hermes');
  assert.equal(r[0]!.titulo, 'Hermes está haciendo la ficha');
  assert.equal(r[0]!.clave, 'ficha_falta:-');
});

test('should_ask_the_person_for_the_sheet_when_nothing_is_running', () => {
  const r = reglasFicha(entradas({ ficha: null, trabajos: [{ tipo: 'licitaciones.guion' }] }));
  assert.equal(r[0]!.actor, 'tu');
  assert.equal(r[0]!.titulo, 'Falta la ficha: pídela');
});
