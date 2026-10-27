import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bloquesGuia,
  enlaceDeucXml,
  errorDeEmpresa,
  rutaDeTarjeta,
  textoFaltan,
  URL_SERVICIO_DEUC,
} from './deucFormato.js';

test('should_build_the_download_link_from_the_deuc_document', () => {
  // Arrange
  const peticion = 'Conocimiento/Licitaciones/Radar/2026/EXP-1 (p-1)/Deuc.xml';

  // Act
  const enlace = enlaceDeucXml(peticion);

  // Assert
  assert.equal(
    enlace,
    `/hermes-vault/api/v1/files/raw?path=${encodeURIComponent('Licitaciones/Radar/2026/EXP-1 (p-1)/Deuc.xml')}`,
  );
  assert.equal(enlaceDeucXml(null), null);
  assert.equal(enlaceDeucXml('  '), null);
});

test('should_point_to_the_deuc_service', () => {
  assert.match(URL_SERVICIO_DEUC, /^https:\/\/visor\.registrodelicitadores\.gob\.es\/espd-web\//);
});

test('should_take_the_guide_path_from_the_card_key', () => {
  assert.equal(
    rutaDeTarjeta('deuc:Salidas/Licitaciones/X (p-1)/DEUC_GUIA-v2.md'),
    'Salidas/Licitaciones/X (p-1)/DEUC_GUIA-v2.md',
  );
  assert.equal(rutaDeTarjeta('anexo:a1-d1:2026'), null);
  assert.equal(rutaDeTarjeta(undefined), null);
});

test('should_split_the_guide_into_titles_fields_and_missing_data', () => {
  // Arrange
  const texto =
    '# Guía del DEUC · X\n1. Descarga Deuc.xml · 2. Impórtalo en el [servicio DEUC](https://x) · 3. Rellena\n\n## Parte II · A. El operador económico\n- **NIF:** B00000000\n- **Dirección postal:** FALTA: domicilio (Ajustes › Empresa)\n';

  // Act
  const bloques = bloquesGuia(texto);

  // Assert
  assert.deepEqual(
    bloques.map((b) => b.tipo),
    ['titulo', 'texto', 'titulo', 'campo', 'campo'],
  );
  assert.equal(bloques[1].texto, '1. Descarga Deuc.xml · 2. Impórtalo en el servicio DEUC · 3. Rellena');
  assert.deepEqual(bloques[3], { tipo: 'campo', etiqueta: 'NIF', valor: 'B00000000', falta: false });
  assert.equal(bloques[4].falta, true);
  assert.equal(textoFaltan(bloques), 'Falta 1 dato: complétalo y vuelve a preparar la guía.');
});

test('should_return_nothing_for_an_empty_guide', () => {
  assert.deepEqual(bloquesGuia(''), []);
  assert.deepEqual(bloquesGuia(null), []);
  assert.equal(textoFaltan([]), null);
});

test('should_link_to_company_settings_only_for_missing_company_data', () => {
  // Arrange
  const faltan = {
    status: 409,
    code: 'conflicto',
    message: 'Faltan datos de la empresa para el DEUC: NIF. Complétalos en Ajustes › Empresa.',
  };
  const versionAntigua = {
    status: 409,
    code: 'version_antigua',
    message: 'Hay una versión nueva de la plataforma: recarga la página.',
  };
  const sinPeticion = {
    status: 409,
    code: 'conflicto',
    message: 'No hay petición del DEUC (Deuc.xml) entre los pliegos: rellénalo en el servicio DEUC.',
  };

  // Act / Assert
  assert.equal(errorDeEmpresa(faltan), true);
  assert.equal(errorDeEmpresa(versionAntigua), false, 'tras un despliegue no faltan datos: hay que recargar');
  assert.equal(errorDeEmpresa(sinPeticion), false);
  assert.equal(errorDeEmpresa(null), false);
});
