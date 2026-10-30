import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpetasDrive } from './carpetasDrive.js';

const conRuta = [{ ruta: 'Licitaciones/Radar/p-1/a.pdf' }];

test('should_offer_both_folders_when_in_preparation_with_downloaded_pliegos', () => {
  assert.deepEqual(carpetasDrive({ estado: 'en_preparacion', pliegos: conRuta }), {
    unica: false,
    pliegos: true,
    oferta: true,
  });
});

test('should_not_offer_oferta_folder_when_opportunity_is_new', () => {
  assert.deepEqual(carpetasDrive({ estado: 'nueva', pliegos: conRuta }), {
    unica: false,
    pliegos: true,
    oferta: false,
  });
});

test('should_not_offer_pliegos_folder_when_nothing_was_downloaded', () => {
  assert.deepEqual(carpetasDrive({ estado: 'presentada', pliegos: [{ ruta: null }] }), {
    unica: false,
    pliegos: false,
    oferta: true,
  });
  assert.deepEqual(carpetasDrive(null), { unica: false, pliegos: false, oferta: false });
});

test('should_offer_oferta_folder_when_discarded_after_starting_the_offer', () => {
  assert.equal(carpetasDrive({ estado: 'descartada', oferta: { guion: {} } }).oferta, true);
  assert.equal(carpetasDrive({ estado: 'descartada' }).oferta, false);
});

test('should_offer_only_the_single_folder_once_it_exists', () => {
  assert.deepEqual(
    carpetasDrive({ estado: 'en_preparacion', pliegos: conRuta, carpeta_unica: 'Licitaciones/Ofertas/X (p-1)' }),
    { unica: true, pliegos: false, oferta: false },
  );
});
