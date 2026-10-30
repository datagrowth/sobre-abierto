// La página del expediente de CASO_E en la PLACSP (detalle_licitacion: CAP-27/12, Servicios
// Sanitarios de Ejemplo, S.A.), inventada con el marcado que lee placsp/expediente.ts: la tabla de
// anuncios (cada uno en html, xml y pdf, con su versión anterior desplegada y un pliego histórico
// sin enlaces) y la de «Otros documentos» (DOC_GEN, un enlace «Ver» por fila), con comentarios,
// una tabla antigua comentada y el «sello de tiempo» de cada fila (href="#").
const DOC = 'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?cifrado=anonimo&amp;DocumentIdParam=';
const FORM = 'viewns_Z7_EJEMPLO000000000000000000_:form1';

const icono = (doc: string, tipo: string) =>
  `<a class="" href="${DOC}${doc}" title="Este documento se abrir&#225; en una nueva ventana" target="_blank"><img src="/wps/PA_PortletsPlace/imagenes/${tipo}-icon.png" alt="Documento ${tipo}" /></a>`;
const sello = (id: string, params: string) =>
  `<a href="#" onclick="return myfaces.oam.submitForm('${FORM}','${FORM}:${id}',null,[${params}]);" id="${FORM}:${id}" title="Sello de Tiempo" class=""><img src="/wps/PA_PortletsPlace/imagenes/stamp-icon.png" alt="Sello de Tiempo" title="Sello de Tiempo" /></a>`;

type Anuncio = { fecha: string; tipo: string; docs: string[] | null; clase: string; sello: string };

// Un anuncio y, desplegada debajo, su versión anterior (docs null: publicada sin enlaces).
function filaAnuncio(a: Anuncio, n: number, historica: boolean): string {
  const fecha = historica
    ? `<img id="imgLinea${n}0" class="graphicImageExCollapse border0 " alt="Abiertos documentos hist&#243;ricos" src="/wps/PA_PortletsPlace/imgs/line2.gif" />${a.fecha}`
    : `<img id="imgMasColapsable${n}" class="graphicImageExCollapse border0 " src="/wps/PA_PortletsPlace/imagenes/mostrarMas.gif" title="Mostrar M&#225;s" alt="Mostrar M&#225;s" onclick="abrir_Colapsable(${n});" />${a.fecha}`;
  const enlaces = (a.docs ?? []).map((d, i) => icono(d, ['html', 'xml', 'pdf'][i]!)).join('');
  return `<tr${historica ? ` id="desplegable_${n}_0"` : ''} class="${historica ? `desplegado ${a.clase}` : `${a.clase} `}"><td class="fechaPubLeft padding0punto2"><div style="margin-left:8.4em;">${fecha}</div></td>`
    + `<td class="tipoDocumento padding0punto2"><div class="">${a.tipo}</div></td><td class=""><div class="flex-inline-xxs">${enlaces}${a.sello}</div></td></tr>`;
}

function filaOtro(n: number, fecha: string, tipo: string, doc: string): string {
  const id = `${FORM}:TableEx1_Aux:${n}`;
  return `<tr class="rowClass${(n % 2) + 1}" ><td >
								<div class="cell-order-small start">
											<span id="${id}:textSfecha1PadreGen" class="m-0">${fecha}</span>
								</div>
							</td>
<td ><span id="${id}:textStipo1PadreGen" class="m-0">${tipo}</span></td>
<td >
								<div class="flex-inline-xxs">
											<a href="${DOC}${doc}" id="${id}:linkVerDocPadreGen" name="${id}:linkVerDocPadreGen" target="_blank" class="celdaTam2" title="Este documento se abrira en nueva ventana"><img src="/wps/PA_PortletsPlace/imagenes/lupa-icon.png" title="Ver" /></a>${sello(`TableEx1_Aux:${n}:buttonTSPadreGen`, `['idDocumento','${n}'],['tipoDoc','DOC_GEN']`)}
								</div>
							</td>
</tr>`;
}

const ANUNCIOS: [Anuncio, Anuncio][] = [
  [
    { fecha: '29/09/2027 12:05:10', tipo: 'Rectificaci&#243;n de Anuncio de Licitaci&#243;n', docs: ['doc-01', 'doc-02', 'doc-03'], clase: 'rowClass1', sello: sello('enlaceSelloTiempo_0', "['idDocumento','0'],['tipoDoc','DOC_CN']") },
    { fecha: '22/09/2027 10:15:30', tipo: 'Anuncio de Licitaci&#243;n', docs: ['doc-04', 'doc-05', 'doc-06'], clase: 'rowClass1', sello: sello('enlaceSelloTiempoHist_0_0', "['idDocumentoPadre','0'],['idDocumento','0']") },
  ],
  [
    { fecha: '29/09/2027 12:10:45', tipo: 'Rectificaci&#243;n de Pliego', docs: ['doc-07', 'doc-08', 'doc-09'], clase: 'rowClass2', sello: sello('enlaceSelloTiempo_1', "['idDocumento','1'],['tipoDoc','DOC_CD']") },
    { fecha: '22/09/2027 10:20:05', tipo: 'Pliego', docs: null, clase: 'rowClass2', sello: sello('enlaceSelloTiempoHist_1_0', "['idDocumentoPadre','1'],['idDocumento','0']") },
  ],
];
const OTROS: [string, string, string][] = [
  ['22/09/2027 10:25:12', 'Documento de aprobaci&#243;n del expediente', 'doc-10'],
  ['22/09/2027 10:26:40', 'Composici&#243;n de la mesa de contrataci&#243;n', 'doc-11'],
  ['22/09/2027 10:27:55', 'Memoria justificativa', 'doc-12'],
  ['29/09/2027 11:55:20', 'Rectificaci&#243;n de errores materiales del pliego', 'doc-13'],
];

const CABECERA = ['Post on platform', 'Document', 'Veure documents'];

/** El HTML de la página del expediente de CASO_E. */
export function paginaExpedienteCasoE(): string {
  const anuncios = ANUNCIOS.flatMap(([a, anterior], n) => [filaAnuncio(a, n, false), filaAnuncio(anterior, n, true)]).join('');
  const cabecera = CABECERA.map((c) => `<th scope="col" class=""><div class="cell-order"><span dir="ltr" class="cl-blue-dark p-0 bold" lang="en">${c}</div></span></th>`).join('');
  const cabeceraOtros = CABECERA.map((c, i) => `<th class="" scope="col" ><span id="${FORM}:TableEx1_Aux:text${i + 2}Aux" title="${c}" class="cl-blue-dark p-0 bold">${c}</span></th>`).join('');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Detalle de licitación</title></head><body>
<!-- Página del expediente inventada para los tests: solo la cabecera y la sección de anuncios y documentos. -->
<span id="${FORM}:text_expediente" class="outputText">CAP-27/12</span>
<span id="${FORM}:text_organo" class="outputText">Gerencia de Servicios Sanitarios de Ejemplo, S.A.</span>
<span id="${FORM}:text30_1" title="Advertisements and documents" class="title-section-subtitle bold">Advertisements and documents</span>
				<!-- Inicio tabla documentos VIS_UOE -->
				<!-- tabla documentos sin publicaciones BOE y DOUE -->
					<table id="myTablaDetalleVISUOE" class="" summary="Tabla de documentos publicados de la licitaci&#243;n"><thead ><tr>${cabecera}</tr></thead><tbody class="tabla-detalle">${anuncios}</tbody></table>
				<!-- Fin tabla documentos -->
				<span id="${FORM}:text30Aux" title="Otros Documentos" class="title-section-subtitle">Otros Documentos</span>
<!-- 					<table class="ancho100"> -->
<!-- 						<tr><td><a href="${DOC}antiguo">tabla de cabecera antigua</a></td></tr> -->
<!-- 					</table> -->
						<table id="${FORM}:TableEx1_Aux" class="tabla-detalle" summary="Resumen Licitaci&#239;&#191;&#189;n" ><thead ><tr >${cabeceraOtros}</tr>
</thead><tbody >
${OTROS.map(([fecha, tipo, doc], n) => filaOtro(n, fecha, tipo, doc)).join('\n')}
</tbody>
</table>
</body></html>
`;
}
