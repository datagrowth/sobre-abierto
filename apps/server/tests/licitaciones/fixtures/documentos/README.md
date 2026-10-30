# Fixtures de documentos de pliego

Todo es sintético salvo la referencia de la UE: no hay ningún documento descargado de la PLACSP ni
de ningún órgano. Los documentos se generan en memoria en cada test (no hay archivos generados en
el repo), con los órganos, expedientes y objetos inventados de los casos de `../comprobaciones/`. Tienen la
forma de los de verdad en lo que miran los tests: páginas, cabeceras, huecos, títulos de los
modelos y rarezas de maquetación.

| Módulo | Genera | Lo usan |
|---|---|---|
| `pdfSintetico.ts` | `pdfDePaginas(paginas)`: un PDF sin campos con una página por lista de líneas (Helvetica; la viñeta «●» en ZapfDingbats con ToUnicode) | los dos siguientes |
| `pcapCasoB.ts` | `pcapModelosCasoB()`: «pcap-modelos.pdf» de CASO_B (EXP-2026-0517), 22 págs.: índice (1-2), Anexos II, III lote 1, III BIS lote 1, V, VI e IX con huecos (3-11) y el Anexo XIV (12-22), una tabla de requisitos sin huecos con la cabecera repetida en cada página, 12 secciones y 31 requisitos | `ofertaModelosPdf`, `ofertaTablaRequisitos` |
| `anexosCasoD.ts` | `anexoCasoD(archivo)`: «Anexo I.pdf» (oferta económica, 3 págs.), «Anexo V.pdf», «Anexo VI.pdf» y «Anexo VII.pdf» (cartas de compromiso con opciones «● … (….)») de CASO_D (CP-0417/2027), sin campos | `ofertaModelosPdf`, `ofertaAnexoPdfTranscrito` |
| `deuc.ts` | `peticionDeucCasoC()` (Villaejemplo, 2026/031, 40 criterios) y `peticionDeucCasoB()` (EXP-2026-0517, 31 criterios): peticiones del DEUC (ESPDRequest 1.0.2) con 24 motivos de exclusión, el lote 0 y, en la de CASO_C, el volumen de negocios en cinco ejercicios | `nucleo/espdRespuesta`, `deucGuia`, `ofertaDeuc` |
| `expedienteCasoE.ts` | `paginaExpedienteCasoE()`: la página del expediente de CASO_E (CAP-27/12) con el marcado de la PLACSP: 3 anuncios con versión anterior y 4 «Otros documentos» | `pliegosExpediente` |

Los PDF de CASO_B y CASO_D no tienen campos de formulario: van por «transcrito» (o por tabla de
requisitos, el Anexo XIV), no por «campos». Los PDF con formulario salen de
`../../../nucleo/fixtures/formularioPdf.ts`.

`espd-referencia/BASIC-ESPDResponse-2.1.1.xml` es la muestra oficial de QualificationApplicationResponse
(ESPD-EDM v2.1.1, https://github.com/OP-TED/ESPD-EDM, antes ESPD/ESPD-EDM), licencia EUPL 1.2. Las
peticiones de `deuc.ts` siguen el modelo anterior (ESPDRequest con criterios 1.0.2), así que la muestra
sirve de referencia de la estructura 2.x.
