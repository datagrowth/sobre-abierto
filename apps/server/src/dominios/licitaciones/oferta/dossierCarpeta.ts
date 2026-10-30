// Secciones del dossier que salen de la carpeta de la licitación y del cuadro resumen del PCAP.
import { consultaFts } from '../../../biblioteca/motor/documentos/busquedaHibrida.js';
import * as indice from '../../../biblioteca/motor/documentos/almacen.js';
import type { DocumentoCarpeta } from '../documentosCarpeta.js';
import { textoComparable } from '../temas.js';
import { comoLeer, paginasDe, recortar, textoPaginas, type DocumentoLeido, type Parte } from './dossierTexto.js';

const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : 'sin fecha');

// ── Aclaraciones ──

// Las aclaraciones (texto íntegro y fechado: mandan sobre el pliego), el cuadro resumen (inicio, duración, lo
// negociable, la subcontratación y los criterios automáticos con su archivo) y la normativa del cliente (índice
// con código y versión, y los pasajes que tocan a cada apartado).
/** Las aclaraciones enteras, de la más reciente a la más antigua (si no caben, se cae lo más viejo). */
export function seccionAclaraciones(
  docs: DocumentoCarpeta[],
  idx: indice.BaseDatos | null,
  carpeta: string,
  tope: number,
): Parte {
  const aclaraciones = docs
    .filter((d) => d.clase === 'aclaracion')
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
  if (!aclaraciones.length || !idx) {
    return {
      truncado: false,
      texto: `No hay respuestas a dudas, aclaraciones ni rectificaciones en la carpeta de la licitación («${carpeta}»). Si el órgano publicó alguna, súbela allí antes de redactar: lo que aclara manda sobre el pliego.`,
    };
  }
  const bloques = aclaraciones.map((d) => {
    const leido: DocumentoLeido = {
      ruta: d.ruta,
      etiqueta: `Aclaración ${fechaCorta(d.fecha)}`,
      paginas: paginasDe(idx, d.ruta),
    };
    return [
      `### ${fechaCorta(d.fecha)} — «${d.nombre}»`,
      `Ruta: ${d.ruta}`,
      '',
      textoPaginas(
        leido,
        [...leido.paginas.keys()].sort((a, b) => a - b),
      ),
    ].join('\n');
  });
  const texto = [
    'Respuestas del órgano a las dudas de los licitadores, aclaraciones y rectificaciones, de la más reciente a la más antigua. Forman parte del pliego: si contradicen al PCAP o al PPT, mandan; entre dos, la más reciente. Cítalas por su fecha.',
    '',
    bloques.join('\n\n'),
  ].join('\n');
  return recortar(
    texto,
    tope,
    `lee las aclaraciones enteras con biblioteca_leer: ${aclaraciones.map((d) => `«${d.ruta}»`).join(', ')}`,
  );
}

// ── Cuadro resumen ──

const TEMAS_CUADRO: [string, RegExp][] = [
  ['inicio', /(?:fecha|plazo) (?:prevista|previsto|estimada) de inicio|inicio previsto|fecha de inicio/],
  ['duración', /duracion del contrato|plazo de ejecucion|plazo de duracion|prorrogas?\b/],
  ['negociación', /negociab|aspectos? (?:objeto )?de (?:la )?negociacion/],
  ['subcontratación', /subcontrat/],
  [
    'criterios automáticos',
    /mediante formula|por formula|evaluables? (?:de forma )?automatica|criterios? (?:cuantificables|objetivos)/,
  ],
];
const CUADRO = /cuadro (?:resumen|de caracteristicas)/;
type PaginaCuadro = { p: DocumentoLeido; n: number; temas: string[]; puntos: number };

function paginasDelCuadro(
  pcaps: DocumentoLeido[],
  yaEnCriterios: (p: DocumentoLeido, n: number) => boolean,
): PaginaCuadro[] {
  return pcaps
    .flatMap((p) =>
      [...p.paginas.entries()].flatMap(([n, t]) => {
        const c = textoComparable(t);
        const temas = TEMAS_CUADRO.filter(([, re]) => re.test(c)).map(([nombre]) => nombre);
        return temas.length && !yaEnCriterios(p, n)
          ? [{ p, n, temas, puntos: temas.length + (CUADRO.test(c) ? 2 : 0) }]
          : [];
      }),
    )
    .sort((a, b) => b.puntos - a.puntos || a.n - b.n);
}

export type EntradaCuadro = {
  pcaps: DocumentoLeido[];
  yaEnCriterios: (p: DocumentoLeido, n: number) => boolean;
  automaticos: { criterio: string; archivo: string; casilla_en: string }[];
  tope: number;
};

/** Las páginas del cuadro resumen que tratan esos temas (sin repetir las de los criterios), con los criterios automáticos y su archivo. */
export function seccionCuadroResumen(e: EntradaCuadro): Parte {
  const automaticos = e.automaticos.length
    ? [
        'Criterios automáticos y dónde se acreditan:',
        ...e.automaticos.map((a) => `- «${a.criterio}»: en «${a.archivo}» (${a.casilla_en}).`),
      ]
    : ['El guion no tiene criterios automáticos aparte del precio.'];
  const elegidas: PaginaCuadro[] = [];
  let largo = automaticos.join('\n').length + 400;
  for (const x of paginasDelCuadro(e.pcaps, e.yaEnCriterios)) {
    const t = textoPaginas(x.p, [x.n]).length + 2;
    if (largo + t > e.tope) continue;
    elegidas.push(x);
    largo += t;
  }
  if (!elegidas.length)
    return {
      truncado: false,
      texto: [
        ...automaticos,
        '',
        'El PCAP no tiene páginas sobre inicio, duración, negociación o subcontratación fuera de las de los criterios (o no está indexado): búscalo con licitaciones_pliegos (plazos_hitos, subcontratacion).',
      ].join('\n'),
    };
  const orden = [...elegidas].sort((a, b) => a.n - b.n);
  const fuera = e.pcaps.flatMap((p) => {
    const ns = [...p.paginas.keys()].filter((n) => !orden.some((x) => x.p === p && x.n === n));
    return ns.length ? [comoLeer(p, ns)] : [];
  });
  const texto = [
    ...automaticos,
    '',
    `Páginas del cuadro resumen y del PCAP que fijan el inicio, la duración, lo negociable y la subcontratación: ${orden.map((x) => `${x.p.etiqueta} p. ${x.n} (${x.temas.join(', ')})`).join('; ')}.`,
    '',
    orden.map((x) => textoPaginas(x.p, [x.n])).join('\n\n'),
    ...(fuera.length ? ['', `[el resto del PCAP: ${fuera.join('; ')}]`] : []),
  ].join('\n');
  return { texto, truncado: elegidas.length < paginasDelCuadro(e.pcaps, e.yaEnCriterios).length };
}

// ── Normativa del cliente ──

const PASAJES_POR_APARTADO = 3;
const LARGO_PASAJE = 900;

const etiquetaNorma = (d: DocumentoCarpeta) =>
  d.clase === 'contrato' ? 'Contrato' : (d.codigo ?? d.nombre.replace(/\.[a-z0-9]{2,5}$/i, ''));
const lineaIndice = (d: DocumentoCarpeta) =>
  `- ${etiquetaNorma(d)}${d.version ? ` (revisión ${d.version})` : ''}: «${d.nombre}» — ${d.ruta}`;

function pasajesDeApartado(
  idx: indice.BaseDatos,
  docs: DocumentoCarpeta[],
  consulta: string,
  usados: Set<number>,
): string[] {
  const match = consultaFts(consulta);
  if (!match) return [];
  let hits: indice.AciertoTrozo[];
  try {
    hits = indice.buscarFtsEnRutas(
      idx,
      match,
      docs.map((d) => d.ruta),
      PASAJES_POR_APARTADO * 4,
    );
  } catch {
    return []; // consulta que FTS5 no acepta
  }
  const porRuta = new Map(docs.map((d) => [d.ruta, d]));
  return hits
    .filter((h) => !usados.has(h.id))
    .slice(0, PASAJES_POR_APARTADO)
    .map((h) => {
      usados.add(h.id);
      return `[${etiquetaNorma(porRuta.get(h.path)!)}${h.page ? ` p. ${h.page}` : ''}] ${h.text
        .replace(/\s*\n\s*/g, ' ')
        .trim()
        .slice(0, LARGO_PASAJE)}`;
    });
}

/** Cómo empieza la sección cuando no hay normativa: la estrategia no pide entonces catálogo normativo. */
export const SIN_NORMATIVA = 'No hay normativa interna del cliente';

export type EntradaNormativa = {
  docs: DocumentoCarpeta[];
  idx: indice.BaseDatos | null;
  apartados: { titulo: string; se_valorara: string[] }[];
  tope: number;
};

/** El índice de la normativa del cliente y del contrato, y los pasajes que tocan a cada apartado. */
export function seccionNormativa(e: EntradaNormativa): Parte {
  const docs = e.docs.filter((d) => d.clase === 'normativa' || d.clase === 'contrato');
  if (!docs.length)
    return {
      truncado: false,
      texto: `${SIN_NORMATIVA} ni contrato en la carpeta de la licitación: no cites normas del cliente por su código.`,
    };
  const usados = new Set<number>();
  const porApartado = e.idx
    ? e.apartados.flatMap((a, i) => {
        const pasajes = pasajesDeApartado(e.idx!, docs, `${a.titulo} ${a.se_valorara.join(' ')}`, usados);
        return pasajes.length ? [`### ${i + 1}. ${a.titulo}`, ...pasajes, ''] : [];
      })
    : [];
  const texto = [
    'Documentos del cliente en la carpeta de la licitación (normativa interna y contrato). Cita una norma por su código y revisión solo con lo que dice aquí; lo demás, léelo antes con biblioteca_leer.',
    ...docs.map(lineaIndice),
    '',
    ...(porApartado.length
      ? ['Pasajes que tocan a cada apartado de la memoria:', '', ...porApartado]
      : [
          'Ningún pasaje casa con los apartados de la memoria: búscalos con biblioteca_buscar en la carpeta de la licitación.',
        ]),
  ]
    .join('\n')
    .trimEnd();
  return recortar(texto, e.tope, 'busca más con biblioteca_buscar en la carpeta de la licitación');
}
