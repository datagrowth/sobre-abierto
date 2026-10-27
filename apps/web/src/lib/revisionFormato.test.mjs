import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conDescarteGenerico,
  ordenTarjetas,
  recargaLaRevision,
  textoCabecera,
  versionDeRevisionPrevia,
} from './revisionFormato.js';

const t = (clave, extra = {}) => ({
  clave,
  estado: 'pendiente',
  nueva_para_ti: false,
  acreditacion: false,
  creada_en: '2026-10-14T10:00:00.000Z',
  ...extra,
});

test('should_put_cards_new_for_you_first', () => {
  const r = ordenTarjetas([t('a'), t('b', { nueva_para_ti: true }), t('c', { acreditacion: true })]);
  assert.deepEqual(
    r.map((x) => x.clave),
    ['b', 'c', 'a'],
  );
});

test('should_say_nothing_new_when_all_cards_are_closed', () => {
  const cerradas = [
    t('a', { estado: 'aceptada', nueva_para_ti: true }),
    t('b', { estado: 'descartada', nueva_para_ti: true }),
  ];
  assert.equal(textoCabecera(cerradas), 'Nada nuevo desde tu última revisión');
  assert.deepEqual(ordenTarjetas(cerradas), []);
  assert.equal(textoCabecera([]), 'Nada nuevo desde tu última revisión');
});

test('should_keep_accreditation_cards_before_the_rest', () => {
  const r = ordenTarjetas([
    t('a', { creada_en: '2026-10-14T12:00:00.000Z' }),
    t('b', { acreditacion: true, creada_en: '2026-10-13T12:00:00.000Z' }),
  ]);
  assert.deepEqual(
    r.map((x) => x.clave),
    ['b', 'a'],
  );
});

test('should_count_only_pending_new_cards_in_the_header', () => {
  const r = textoCabecera([
    t('a', { nueva_para_ti: true }),
    t('b', { nueva_para_ti: true }),
    t('c', { nueva_para_ti: true }),
    t('d'),
  ]);
  assert.equal(r, 'Lo que hizo Hermes: 3 nuevas desde tu última revisión');
  assert.equal(
    textoCabecera([t('a', { nueva_para_ti: true })]),
    'Lo que hizo Hermes: 1 nueva desde tu última revisión',
  );
});

test('should_read_the_package_version_from_a_prior_review_card_key', () => {
  assert.equal(versionDeRevisionPrevia('revision_previa:v2'), 2);
  assert.equal(versionDeRevisionPrevia('memoria:v2'), null);
  assert.equal(versionDeRevisionPrevia(null), null);
});

test('should_leave_the_memory_card_with_only_its_own_discard', () => {
  assert.equal(conDescarteGenerico('memoria'), false);
  assert.equal(conDescarteGenerico('propuesta'), true);
  assert.equal(conDescarteGenerico('anexo'), true);
});

test('should_reload_the_tray_when_the_revision_event_arrives', () => {
  assert.equal(
    recargaLaRevision({
      tipo: 'licitacion.revision',
      recurso: 'p-1',
      datos: { clave: 'memoria:v2', accion: 'aceptar' },
    }),
    true,
  );
});

test('should_reload_the_tray_after_reconnecting_or_on_other_tender_events', () => {
  assert.equal(recargaLaRevision({ tipo: 'plataforma-reconectado' }), true);
  assert.equal(recargaLaRevision({ tipo: 'licitacion.oferta' }), true);
});

test('should_not_reload_the_tray_for_unrelated_or_malformed_events', () => {
  assert.equal(recargaLaRevision({ tipo: 'colaborador.cv' }), false);
  assert.equal(recargaLaRevision(null), false);
  assert.equal(recargaLaRevision({}), false);
});
