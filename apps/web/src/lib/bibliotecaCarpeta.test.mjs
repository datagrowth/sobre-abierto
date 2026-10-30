import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpetaDeOferta, leerCarpetaBiblioteca, notasDeCarpeta, rutaCarpetaBiblioteca } from './bibliotecaCarpeta.js';
import { leerRuta, rutaA } from './rutas.js';

const CARPETA = 'Licitaciones/Radar/2026/p-91000770';

test('should_read_the_folder_from_the_library_route', () => {
  const ruta = leerRuta(rutaA(rutaCarpetaBiblioteca(CARPETA)));

  assert.equal(leerCarpetaBiblioteca(ruta), CARPETA);
});

test('should_not_filter_when_the_route_is_another_view_or_the_folder_is_malformed', () => {
  assert.equal(leerCarpetaBiblioteca({ seccion: 'biblioteca', vista: 'notas', id: CARPETA }), null);
  assert.equal(leerCarpetaBiblioteca({ seccion: 'licitaciones', vista: 'carpeta', id: CARPETA }), null);
  assert.equal(leerCarpetaBiblioteca({ seccion: 'biblioteca', vista: 'carpeta', id: null }), null);
  assert.equal(leerCarpetaBiblioteca({ seccion: 'biblioteca', vista: 'carpeta', id: '../Empresa' }), null);
  assert.equal(leerCarpetaBiblioteca({ seccion: 'biblioteca', vista: 'carpeta', id: 'Licitaciones//Radar' }), null);
});

test('should_keep_only_the_notes_of_the_folder_and_its_subfolders', () => {
  const notas = [
    { path: `${CARPETA}/ficha.md` },
    { path: `${CARPETA}/anexos/Anexo VI.md` },
    { path: 'Licitaciones/Radar/2026/p-205939761/ficha.md' },
    { path: 'Empresa/perfil.md' },
  ];

  const r = notasDeCarpeta(notas, CARPETA);

  assert.deepEqual(
    r.map((n) => n.path),
    [`${CARPETA}/ficha.md`, `${CARPETA}/anexos/Anexo VI.md`],
  );
});

test('should_return_no_notes_when_the_list_is_empty_or_malformed', () => {
  assert.deepEqual(notasDeCarpeta([], CARPETA), []);
  assert.deepEqual(notasDeCarpeta(null, CARPETA), []);
});

test('should_take_the_offer_folder_from_its_downloaded_tender_documents', () => {
  const pliegos = [
    { nombre: 'Anuncio', ruta: null },
    { nombre: 'PCAP', ruta: `${CARPETA}/0-PCAP.pdf` },
    { nombre: 'PPT', ruta: `${CARPETA}/1-PPT.pdf` },
  ];

  assert.equal(carpetaDeOferta(pliegos), CARPETA);
  assert.equal(carpetaDeOferta([{ ruta: null }]), null);
  assert.equal(carpetaDeOferta(undefined), null);
});
