import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarMarca,
  cargarConfigInstalacion,
  configInstalacion,
  fijarConfigInstalacion,
  NEUTRA,
} from './configInstalacion.js';
import { empresaEnCanarias, segundaHora, textoPlazo } from './formato.js';

const PLAZO = { texto: 'hoy', fecha: 'lun 5 oct', hora: '12:00' };

test('should_start_neutral_with_peninsular_time_only', () => {
  assert.deepEqual(configInstalacion(), NEUTRA);
  assert.equal(segundaHora('12:00'), null);
  assert.equal(textoPlazo(PLAZO, true), 'hoy · lun 5 oct · 12:00');
});

test('should_add_the_canary_hour_once_the_company_is_in_the_canaries', () => {
  fijarConfigInstalacion({ nombre: 'Analítica Ejemplo', zona_horaria: 'Atlantic/Canary' });
  assert.equal(empresaEnCanarias(), true);
  assert.equal(textoPlazo(PLAZO, true), 'hoy · lun 5 oct · 12:00 (11:00 Canarias)');
  fijarConfigInstalacion({ zona_horaria: 'Europe/Madrid' });
  assert.equal(segundaHora('12:00'), null);
});

test('should_drop_what_cannot_be_a_logo_or_a_link_and_keep_the_neutral_name', () => {
  const c = fijarConfigInstalacion({
    nombre: '  ',
    logo: 'javascript:alert(1)',
    fuente: 'ftp://x',
    version: 'latest; rm -rf',
    zona_horaria: 'America/Bogota',
  });
  assert.deepEqual(c, NEUTRA);
  assert.equal(
    fijarConfigInstalacion({ logo: 'data:image/svg+xml;base64,PHN2Zy8+' }).logo,
    'data:image/svg+xml;base64,PHN2Zy8+',
  );
});

test('should_load_the_config_and_stay_neutral_when_the_server_does_not_answer', async () => {
  fijarConfigInstalacion(NEUTRA);
  const sinRed = await cargarConfigInstalacion(async () => {
    throw new Error('sin red');
  });
  assert.deepEqual(sinRed, NEUTRA);
  const conMarca = await cargarConfigInstalacion(async () => ({
    ok: true,
    json: async () => ({
      nombre: 'Acme',
      logo: '/marca/acme.svg',
      fuente: 'https://git.acme.example/sa',
      version: '1.2.0',
      zona_horaria: 'Atlantic/Canary',
    }),
  }));
  assert.deepEqual(conMarca, {
    nombre: 'Acme',
    logo: '/marca/acme.svg',
    fuente: 'https://git.acme.example/sa',
    version: '1.2.0',
    zona_horaria: 'Atlantic/Canary',
  });
  fijarConfigInstalacion(NEUTRA);
});

test('should_apply_a_saved_brand_at_once_without_reloading', () => {
  const props = new Map([['--so-lienzo', '#000000']]);
  let quitado = false;
  const doc = {
    title: '',
    getElementById: (id) =>
      id === 'tema-instalacion'
        ? {
            remove: () => {
              quitado = true;
            },
          }
        : null,
    documentElement: { style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } },
  };
  aplicarMarca({ nombre: 'Acme', tema: { tinta: '#263B4A' }, logo: { tipo: 'image/png', hash: 'abc' } }, doc);
  assert.equal(quitado, true, 'el tema del servidor deja de valer');
  assert.equal(props.get('--so-tinta'), '#263B4A');
  assert.equal(props.has('--so-lienzo'), false, 'lo neutro vuelve al de index.css');
  assert.equal(doc.title, 'Acme');
  assert.deepEqual([configInstalacion().nombre, configInstalacion().logo], ['Acme', '/api/marca/logo?v=abc']);
  fijarConfigInstalacion(NEUTRA);
});
