// Los textos del paquete de presentación (puro): valores a teclear en la sede, lote a lote, e INSTRUCCIONES.md.
import { textoEuros } from '../../../nucleo/empresa.js';
import { eurosEnLetras } from '../../../nucleo/enLetras.js';
import type { DecisionesData } from './decisiones.js';
import { paresDeAutomaticos } from './decisiones.js';
import type { AutomaticoGuion, GuionBaseData, OfertaEconomicaLoteData } from './guion.js';
import { automaticoDe, ofertaDeLote, tramosDe } from './guionLotes.js';
import { impuestoDe } from './hojaDatos.js';
import type { Comprobacion } from './paqueteComprobaciones.js';
import { importeDeLote } from './preciosOferta.js';
import { textoComparable } from '../temas.js';
import { sinImportes } from './comprobacionesCoherencia.js';
import type { Compromiso } from './resumenMemoria.js';

// Los valores van en cifra y en letras. INSTRUCCIONES.md lleva el orden de firma y subida, y la regla de que lo
// tecleado en la PLACSP prevalece sobre los documentos, y el orden de los sobres. El importe solo va en
// VALORES_A_TECLEAR.md, nunca en lo que lee Hermes.
export type ValorATeclear = { lote: string | null; concepto: string; valor: string; donde: string; economico: boolean };
type CarpetaTexto = { ruta: string; firma: string | null; documentos: { archivo: string; nombre: string }[] };
export type DatosInstrucciones = {
  licitacion: { expediente: string; titulo: string; organo: string };
  version: number;
  plazo: string | null;
  canal: string | null;
  carpetas: CarpetaTexto[];
  comprobaciones: Comprobacion[];
  // Las preguntas que quedan en el DEUC preparado (infoDeuc de oferta/deuc.ts; null si no se saben).
  // Lo pasa escribirTextos (paquete.ts): infoDeuc(db, id).sin_responder?.length ?? null.
  deuc?: { sin_responder: number | null } | null;
  // Lo que el código comprobó y lo que no puede comprobar (comprobadoDelPaquete + las comprobaciones).
  comprobado?: string[];
  no_comprobado?: string[];
};

export const SERVICIO_DEUC = 'https://visor.registrodelicitadores.gob.es/espd-web/filter?lang=es';

// El DEUC en XML (DEUC-vN.xml, ya numerado en su carpeta) no se firma tal cual: se importa en el
// servicio, se responde lo que queda y se firma el PDF que da el servicio.
function pasoDeuc(d: DatosInstrucciones): string[] {
  const xml = d.carpetas.flatMap((c) => c.documentos).find((x) => x.archivo.toLowerCase().endsWith('.xml'));
  if (!xml) return [];
  const n = d.deuc?.sin_responder;
  const preguntas =
    n === undefined || n === null
      ? 'las preguntas que quedan'
      : n === 1
        ? 'la pregunta que queda'
        : `las ${n} preguntas que quedan`;
  return [
    `- DEUC: importa «${xml.archivo}» en el servicio DEUC (${SERVICIO_DEUC}), responde ${preguntas} (motivos de exclusión), descarga el PDF y fírmalo con el resto.`,
  ];
}

const mismo = (a: string, b: string) => textoComparable(a.trim()) === textoComparable(b.trim());
const cifraYLetras = (n: number) => `${textoEuros(n)} (${eurosEnLetras(n)})`;
const CIFRA = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

// El impuesto, como en la hoja y los anexos (impuestoDe): lo decidido manda sobre el guion. Solo
// el tipo general sin decidir pide confirmarlo; lo tecleado prevalece y tiene que ser lo firmado.
function valoresImpuesto(
  d: DecisionesData,
  oe: OfertaEconomicaLoteData | null,
  importe: number | null,
  v: (c: string, x: string) => ValorATeclear,
): ValorATeclear[] {
  const { impuesto, tipo, decidido } = impuestoDe(d, oe);
  if (!impuesto) return [];
  if (impuesto === 'exento') return [v('Impuesto', 'Exento')];
  const cuota = importe !== null && tipo !== null ? Math.round(importe * tipo) / 100 : null;
  return [
    v(
      'Impuesto',
      `${impuesto} ${CIFRA.format(tipo ?? 0)} %${decidido ? '' : ' (tipo general: confírmalo en el pliego)'}`,
    ),
    ...(cuota !== null
      ? [v(`Cuota de ${impuesto}`, cifraYLetras(cuota)), v(`Total con ${impuesto}`, cifraYLetras(importe! + cuota))]
      : []),
  ];
}

function valoresDeLote(o: DecisionesData['ofertas'][number], d: DecisionesData, g: GuionBaseData): ValorATeclear[] {
  const oe = ofertaDeLote(g, o.lote);
  const donde = oe?.modelo ? `${oe.modelo} y la sede` : 'la sede';
  const v = (concepto: string, valor: string): ValorATeclear => ({
    lote: o.lote,
    concepto,
    valor,
    donde,
    economico: true,
  });
  if (o.pendiente) return [v('Precio', 'PENDIENTE: fíjalo en Decisiones antes de presentar')];
  const lineas = (oe?.precios_unitarios ?? []).flatMap((l) => {
    const p = o.unitarios.find((u) => mismo(u.concepto, l.concepto));
    return p
      ? [
          v(
            `Precio por ${l.unidad}${(oe?.precios_unitarios.length ?? 0) > 1 ? ` · ${l.concepto}` : ''}`,
            cifraYLetras(p.precio),
          ),
        ]
      : [];
  });
  const importe = importeDeLote(o, oe);
  return [
    ...lineas,
    ...(importe !== null ? [v('Importe total sin impuestos', cifraYLetras(importe))] : []),
    ...valoresImpuesto(d, oe, importe, v),
    ...(oe?.redondeo ? [v('Redondeo', oe.redondeo)] : []),
  ];
}

// Lo que se teclea en la casilla: la cifra ofertada si la hay (como en la hoja de datos) antes que el valor del tramo, que sería el mínimo del tramo y no lo ofertado.
function valorAutomatico(x: DecisionesData['automaticos'][number], a: AutomaticoGuion): string {
  if (x.valor !== undefined) return CIFRA.format(x.valor);
  const t = tramosDe(a).find((y) => x.tramo && mismo(y.descripcion, x.tramo));
  return t?.valor ?? (t && a.tramos?.length ? t.descripcion : 'Sí');
}

function valoresAutomaticos(d: DecisionesData, g: GuionBaseData): ValorATeclear[] {
  return paresDeAutomaticos(g, d.lotes).flatMap((p) => {
    const x = d.automaticos.find((y) => mismo(y.criterio, p.criterio) && (y.lote ?? null) === p.lote);
    const a = automaticoDe(g, p.criterio, p.lote);
    if (!x?.nos_acogemos || !a) return [];
    return [
      { lote: p.lote, concepto: a.criterio, valor: valorAutomatico(x, a), donde: a.casilla_en, economico: false },
    ];
  });
}

/** Lo que se teclea o marca en la sede, lote a lote: precios e importes en cifra y en letras, y los automáticos a los que se acoge la empresa. */
export function valoresATeclear(d: DecisionesData, g: GuionBaseData): ValorATeclear[] {
  return [...d.ofertas.flatMap((o) => valoresDeLote(o, d, g)), ...valoresAutomaticos(d, g)];
}

/** VALORES_A_TECLEAR.md: un bloque por lote. */
export function textoValores(valores: ValorATeclear[]): string {
  const lotes = [...new Set(valores.map((v) => v.lote))];
  const bloque = (lote: string | null) => [
    `## ${lote ? `Lote ${lote}` : 'Contrato entero'}`,
    '',
    ...valores.filter((v) => v.lote === lote).map((v) => `- **${v.concepto}**: ${v.valor} — en ${v.donde}`),
    '',
  ];
  return [
    '# Valores a teclear en la sede',
    '',
    'Lo tecleado en la sede prevalece sobre los documentos: teclea exactamente estos valores y comprueba que coinciden con los anexos firmados.',
    '',
    ...lotes.flatMap(bloque),
  ].join('\n');
}

const listaComprobaciones = (cs: Comprobacion[]) => cs.map((c) => `- ${c.mensaje}${c.donde ? ` (${c.donde})` : ''}`);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export type RecuentoPaquete = { criterios: number; archivos: number };

/**
 * Lo que las comprobaciones del paquete dan por bueno, dicho en positivo: sin una
 * comprobación de su tipo, ninguna fuga, ningún hueco; los archivos van todos sin firmar.
 */
export function comprobadoDelPaquete(cs: readonly Comprobacion[], n: RecuentoPaquete): string[] {
  const hay = (...tipos: Comprobacion['tipo'][]) => cs.some((c) => tipos.includes(c.tipo));
  return [
    ...(n.criterios && !hay('fuga') ? [`0 fugas contra ${plural(n.criterios, 'criterio', 'criterios')}`] : []),
    ...(!hay('huecos', 'sin_cerrar') ? ['0 huecos sin rellenar'] : []),
    ...(n.archivos ? [`Firma en blanco en ${plural(n.archivos, 'archivo', 'archivos')}`] : []),
  ];
}

// Lo que ningún código puede verificar: lo firma la empresa y responde de ello.
export const NO_COMPROBABLE = 'La veracidad de las declaraciones (anexos, DEUC): la confirma quien firma';

const bloqueLista = (titulo: string, xs: readonly string[] | undefined) =>
  xs?.length ? [`## ${titulo}`, '', ...xs.map((x) => `- ${x}`), ''] : [];

// AutoFirma firma una carpeta entera de una vez (Firma por lotes): firmar archivo a archivo era lo lento.
const FIRMA_POR_LOTES =
  'Firma todos los archivos de una vez con AutoFirma (Firma por lotes: selecciona la carpeta) y súbelos en este orden:';

/** INSTRUCCIONES.md: plazo, antes de empezar, cada carpeta en orden con su firma, y al terminar. */
export function textoInstrucciones(d: DatosInstrucciones): string {
  const bloqueos = d.comprobaciones.filter((c) => c.gravedad === 'bloquea');
  const avisos = d.comprobaciones.filter((c) => c.gravedad === 'aviso');
  const carpeta = (c: CarpetaTexto, i: number) => [
    `### ${i + 1}. ${c.ruta}`,
    '',
    ...c.documentos.map((x, j) => `${j + 1}. ${x.archivo} — ${x.nombre}`),
    ...(c.firma ? ['', `Firma del sobre: ${c.firma}`] : []),
    '',
  ];
  return [
    ...(bloqueos.length
      ? [
          '# NO PRESENTABLE TODAVÍA',
          '',
          'Antes de presentar hay que resolver:',
          '',
          ...listaComprobaciones(bloqueos),
          '',
        ]
      : []),
    `# Presentación v${d.version}: ${d.licitacion.titulo}`,
    '',
    `Expediente ${d.licitacion.expediente} · ${d.licitacion.organo}`,
    '',
    '## 1. Plazo',
    '',
    `${d.plazo ? `Hasta ${d.plazo}` : 'Sin plazo conocido: compruébalo en la PLACSP'}${d.canal ? ` · ${d.canal}` : ''}.`,
    '',
    '## 2. Antes de empezar',
    '',
    '- Entra en la sede con el certificado de la empresa y comprueba que el registro de licitador está al día.',
    ...pasoDeuc(d),
    '',
    '## 3. Carpetas, en orden',
    '',
    FIRMA_POR_LOTES,
    '',
    ...d.carpetas.flatMap(carpeta),
    '## 4. Valores',
    '',
    'Lo tecleado en la sede prevalece sobre los documentos: teclea exactamente VALORES_A_TECLEAR.md.',
    '',
    '## 5. Al terminar',
    '',
    'Descarga el justificante de presentación y pulsa «Registrar presentación» en la plataforma.',
    '',
    ...(avisos.length ? ['## Avisos', '', ...listaComprobaciones(avisos), ''] : []),
    ...bloqueLista('Comprobado', d.comprobado),
    ...bloqueLista('No comprobado', d.no_comprobado),
  ].join('\n');
}

export type CompromisosDeLote = { lote: string | null; compromisos: readonly Compromiso[] };

const lineaCompromiso = (x: Compromiso) => {
  const donde = x.apartado ? ` (apartado ${x.apartado})` : '';
  const quien = x.quien ? ` · ${x.quien}` : '';
  return `- **${sinImportes(x.que)}**: ${sinImportes(x.valor)}${quien}${donde}${x.choca ? ` — no casa: ${sinImportes(x.choca)}` : ''}`;
};

/**
 * memoria-vN-compromisos.md: lo que la memoria promete, lote a lote, para firmar sabiendo a qué
 * se compromete la empresa. Sin importes: viaja junto a la memoria, que no puede llevarlos.
 */
export function textoCompromisos(version: number, lotes: readonly CompromisosDeLote[]): string {
  const bloque = ({ lote, compromisos }: CompromisosDeLote) => [
    `## ${lote ? `Lote ${lote}` : 'Toda la oferta'}`,
    '',
    ...(compromisos.length
      ? compromisos.map(lineaCompromiso)
      : ['La memoria no recoge compromisos con plazo, frecuencia o medida.']),
    '',
  ];
  return [
    `# Compromisos de la memoria v${version}`,
    '',
    'Lo que la empresa promete al firmar la memoria. Comprueba que se puede cumplir.',
    '',
    ...lotes.flatMap(bloque),
  ].join('\n');
}
