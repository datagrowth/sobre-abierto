// Recorridos de los anexos en el detalle de la Oferta: la vista
// previa de los borradores PDF con el enlace al modelo original, la tarjeta de un anexo «a mano» y
// la del DEUC. Sobre las capturas de CASO_D y Villaejemplo (e2e/datos), con la fila de cada anexo como
// la da el servidor una vez analizado el modelo (la captura es anterior a ese análisis). Nunca hay servidor detrás.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const ID = { casoD: 'p-91000880', casoC: 'p-91000770' };
const api = (oferta, resto = '') => `/api/licitaciones/licitaciones/${ID[oferta]}${resto}`;
const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const esRuta = (ruta) => (url) => url.pathname === ruta;
const documentosDe = (oferta) => leerDatos(oferta)[`GET ${api(oferta, '/oferta/documentos')}`].body;

async function abrirDocumentos(page, oferta) {
  await page.goto(`/#/licitaciones/oportunidades/${ID[oferta]}/oferta`);
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await page.getByTestId('abrir-cajon-documentos').click();
  await expect(page.getByTestId('documentos')).toBeVisible();
}

// CASO_D: los 4 anexos son PDF del pliego; tras analizarlos, uno con campos y tres transcritos, todos con borrador.
function casoDConBorradores() {
  const body = documentosDe('casoD');
  const pliego = 'Conocimiento/Licitaciones/Radar/2026/p-91000880/PCAP.pdf';
  const documentos = body.documentos.map((d, i) => {
    const tipo = i === 0 ? 'campos' : 'transcrito';
    const ruta = `Salidas/Licitaciones/p-91000880/anexos/Anexo-${i + 1}-v1.${tipo === 'campos' ? 'pdf' : 'docx'}`;
    return {
      ...d,
      estado: 'borrador',
      ruta,
      ruta_pdf: tipo === 'campos' ? null : ruta.replace(/\.docx$/, '.pdf'),
      anexo: { ...d.anexo, rellenable: true, motivo: null, modelo: { tipo, ruta: pliego, pagina: 20 + i } },
    };
  });
  return { ...body, documentos };
}

test('should_preview_each_casoD_annex_and_link_its_original_model', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoD');
  const docs = casoDConBorradores();
  await page.route(esRuta(api('casoD', '/oferta/documentos')), (route) => json(route, docs));
  await page.route(
    (url) => url.pathname === '/api/licitaciones/salidas/documento',
    (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }),
  );
  await abrirDocumentos(page, 'casoD');

  for (const d of docs.documentos) {
    const fila = page.getByTestId(`documento-${d.clave}`);
    // Act
    await fila.getByTestId('ver-vista-previa').click();
    // Assert
    await expect(fila.getByTestId('vista-previa-anexo')).toBeVisible();
    await expect(fila.getByTestId('abrir-modelo')).toHaveAttribute(
      'href',
      new RegExp(`PCAP\\.pdf#page=${d.anexo.modelo.pagina}$`),
    );
  }
  await expect(page.getByTestId(`documento-${docs.documentos[1].clave}`).getByTestId('tipo-borrador')).toContainText(
    'compáralo con el original',
  );
});

test('should_show_a_by_hand_annex_with_its_model_page_and_the_values_to_copy', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoD');
  const body = documentosDe('casoD');
  const motivo = 'El modelo es un PDF escaneado: rellénalo a mano.';
  const aMano = {
    ...body.documentos[0],
    anexo: {
      ...body.documentos[0].anexo,
      rellenable: false,
      motivo,
      modelo: { tipo: 'a_mano', ruta: 'Conocimiento/x/PCAP.pdf', pagina: 23 },
    },
  };
  await page.route(esRuta(api('casoD', '/oferta/documentos')), (route) =>
    json(route, { ...body, documentos: [aMano] }),
  );

  // Act
  await abrirDocumentos(page, 'casoD');

  // Assert
  const tarjeta = page.getByTestId(`documento-${aMano.clave}`).getByTestId('tarjeta-a-mano');
  await expect(tarjeta).toContainText('Hay que rellenarlo a mano (PDF)');
  await expect(tarjeta).toContainText(motivo);
  await expect(tarjeta.getByTestId('abrir-modelo')).toHaveText('Abrir el modelo (pág. 23)');
  await expect(tarjeta.getByTestId('copiar-valores-anexo')).toBeVisible();
  await expect(tarjeta.getByTestId('valores-anexo')).not.toBeEmpty();
});

test('should_prepare_and_download_the_casoC_deuc_saying_what_is_left', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoC');
  const body = documentosDe('casoC');
  const preguntas = [
    { codigo: 'EXCL-1', nombre: 'Condenas por participación en una organización delictiva' },
    { codigo: 'EXCL-2', nombre: 'Corrupción' },
  ];
  let preparado = false;
  const conDeuc = () => ({
    ...body,
    documentos: body.documentos.map((d) =>
      d.tipo !== 'deuc'
        ? d
        : {
            ...d,
            anexo: {
              ...d.anexo,
              deuc: preparado
                ? {
                    peticion: null,
                    respuesta: 'Salidas/Licitaciones/p-91000770/anexos/DEUC-v1.xml',
                    version: 1,
                    sin_responder: preguntas,
                  }
                : d.anexo.deuc,
            },
          },
    ),
  });
  await page.route(esRuta(api('casoC', '/oferta/documentos')), (route) => json(route, conDeuc()));
  await page.route(esRuta(api('casoC', '/oferta/documentos/a1-d1/deuc')), (route) => {
    preparado = true;
    return json(route, { ruta: 'Salidas/Licitaciones/p-91000770/anexos/DEUC-v1.xml', version: 1, sin_responder: 2 });
  });
  await abrirDocumentos(page, 'casoC');
  const tarjeta = page.getByTestId('documento-a1-d1').getByTestId('tarjeta-deuc');
  await expect(tarjeta).toContainText('Aún no hay DEUC preparado');

  // Act
  await tarjeta.getByTestId('deuc-preparar').click();

  // Assert
  await expect(tarjeta.getByTestId('deuc-descargar')).toHaveText('Descargar DEUC-v1.xml');
  await expect(tarjeta.getByTestId('deuc-descargar')).toHaveAttribute(
    'href',
    /salidas\/documento\?ruta=.*DEUC-v1\.xml$/,
  );
  await expect(tarjeta).toContainText('quedan 2 preguntas por responder en el servicio');
  await expect(tarjeta.getByTestId('deuc-servicio')).toHaveAttribute('rel', 'noreferrer');
});

test('should_link_to_company_settings_when_the_deuc_lacks_company_data', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoC');
  const mensaje = 'Faltan datos de la empresa para el DEUC: NIF. Complétalos en Ajustes › Empresa.';
  await page.route(esRuta(api('casoC', '/oferta/documentos/a1-d1/deuc')), (route) =>
    json(route, { error: 'conflicto', message: mensaje }, 409),
  );
  await abrirDocumentos(page, 'casoC');

  // Act
  await page.getByTestId('documento-a1-d1').getByTestId('deuc-preparar').click();

  // Assert
  const error = page.getByTestId('deuc-error');
  await expect(error).toContainText(mensaje);
  await expect(error.getByRole('link', { name: 'Ir a Ajustes › Empresa' })).toHaveAttribute(
    'href',
    '#/ajustes/empresa',
  );
});
