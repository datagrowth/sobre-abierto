// La memoria técnica como .docx: portada, índice y cuerpo con los títulos literales del pliego.
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LeaderType,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from 'docx';
import { z } from 'zod';
import { fraccionDeImagen, fraccionDePagina, SVG_MAX, svgAPng, tamanoEnPagina, textosDeSvg } from './figuras.js';
import { sinMarcas, trozosMarcados } from './marcas.js';

// Lo que se entrega al órgano es este documento (firmado por una persona), así que la estructura la fija el
// código y el texto llega ya validado apartado a apartado.
export type Formato = {
  fuente?: string;
  tamano?: number;
  interlineado?: number;
  margenes?: { superior?: number; inferior?: number; izquierdo?: number; derecho?: number };
};
type Tabla = { cabecera: string[]; filas: string[][] };
// Figura dibujada como SVG; el número («Figura 3») lo pone el documento, en orden.
type Figura = { titulo: string; svg: string };
// Imagen de una versión subida a mano: su ruta en Salidas y, al montar el documento, sus bytes.
export type Imagen = { ruta: string; ancho: number; alto: number; pie?: string; datos?: Buffer; tipo?: 'png' | 'jpg' };
// lista_numerada: numeración de Word que empieza en 1 en cada bloque. apaisado: el bloque va en
// una sección horizontal (también, sin pedirlo, una tabla de 6 columnas o más).
type Bloque = {
  subtitulo?: string;
  parrafos: string[];
  lista?: string[];
  lista_numerada?: string[];
  tabla?: Tabla;
  figura?: Figura;
  imagen?: Imagen;
  apaisado?: boolean;
};
export type Apartado = { numero: string; titulo: string; bloques: Bloque[] };
type Portada = {
  titulo: string;
  subtitulo?: string;
  expediente: string;
  organo: string;
  licitadora: { nombre: string; nif: string; domicilio?: string };
  fecha: string;
  lotes?: string[];
};
// Cierre «Lugar, fecha y firma del proponente» que piden algunos modelos de memoria; lo que no
// se sabe (lugar, firmante) queda como línea en blanco para escribirlo antes de firmar.
export type Firma = { fecha: string; empresa: string; lugar?: string; firmante?: string; cargo?: string };
// Tabla guía tras el índice («Cómo se responde a cada criterio»): la arma el código.
export type Guia = { titulo: string; tabla: Tabla };
export type Memoria = {
  portada: Portada;
  formato?: Formato;
  apartados: Apartado[];
  pie: { texto: string; numeracion: boolean };
  indice?: { paginas?: Record<string, number>; total_cuerpo?: number };
  firma?: Firma;
  guia?: Guia;
};

const Texto = z.string().trim().min(1).max(20_000);
const Celda = z.string().trim().max(2_000);
const TablaEntrada = z.strictObject({
  cabecera: z.array(Celda).min(1).max(12),
  filas: z.array(z.array(Celda).max(12)).max(200),
});
const BloqueEntrada = z
  .strictObject({
    subtitulo: z.string().trim().min(1).max(300).optional(),
    parrafos: z.array(Texto).max(60),
    lista: z.array(Texto).max(60).optional(),
    lista_numerada: z.array(Texto).max(60).optional(),
    tabla: TablaEntrada.optional(),
    apaisado: z.boolean().optional(),
    figura: z
      .strictObject({ titulo: z.string().trim().min(1).max(300), svg: z.string().trim().min(1).max(SVG_MAX) })
      .optional(),
    imagen: z
      .strictObject({
        ruta: z.string().trim().min(1).max(500),
        ancho: z.number().int().positive(),
        alto: z.number().int().positive(),
        pie: z.string().max(300).optional(),
        datos: z.instanceof(Buffer).optional(),
        tipo: z.enum(['png', 'jpg']).optional(),
      })
      .optional(),
  })
  .refine(
    (b) =>
      b.parrafos.length > 0 ||
      (b.lista?.length ?? 0) > 0 ||
      (b.lista_numerada?.length ?? 0) > 0 ||
      b.tabla !== undefined ||
      b.figura !== undefined ||
      b.imagen !== undefined,
    'un bloque necesita párrafos, lista, tabla, figura o imagen',
  );
const ApartadoEntrada = z.strictObject({
  numero: z.string().trim().min(1).max(5),
  titulo: z.string().trim().min(1).max(300),
  bloques: z.array(BloqueEntrada).min(1).max(40),
});
const Corto = z.string().trim().min(1).max(300);
const PortadaEntrada = z.strictObject({
  titulo: Corto,
  subtitulo: Corto.optional(),
  expediente: Corto,
  organo: Corto,
  licitadora: z.strictObject({ nombre: Corto, nif: z.string().trim().min(1).max(20), domicilio: Corto.optional() }),
  fecha: Corto,
  lotes: z.array(Corto).max(50).optional(),
});
const Cm = z.number().min(1).max(5);
const FormatoEntrada = z.strictObject({
  fuente: z.string().trim().min(1).max(60).optional(),
  tamano: z.number().min(8).max(14).optional(),
  interlineado: z.number().min(1).max(2).optional(),
  margenes: z
    .strictObject({
      superior: Cm.optional(),
      inferior: Cm.optional(),
      izquierdo: Cm.optional(),
      derecho: Cm.optional(),
    })
    .optional(),
});
export const MemoriaEntrada: z.ZodType<Memoria> = z.strictObject({
  portada: PortadaEntrada,
  formato: FormatoEntrada.optional(),
  apartados: z.array(ApartadoEntrada).min(1).max(30),
  pie: z.strictObject({ texto: z.string().trim().max(200), numeracion: z.boolean() }),
  indice: z
    .strictObject({
      paginas: z.record(z.string(), z.number().int().positive()).optional(),
      total_cuerpo: z.number().int().positive().optional(),
    })
    .optional(),
  firma: z
    .strictObject({
      fecha: Corto,
      empresa: Corto,
      lugar: Corto.optional(),
      firmante: Corto.optional(),
      cargo: Corto.optional(),
    })
    .optional(),
  guia: z.strictObject({ titulo: Corto, tabla: TablaEntrada }).optional(),
});

type Margenes = { superior: number; inferior: number; izquierdo: number; derecho: number };
type FormatoCompleto = { fuente: string; tamano: number; interlineado: number; margenes: Margenes };
// Lo que un pliego da por bueno cuando no fija nada (y lo que mejor pagina igual en Word y LibreOffice).
const FORMATO_POR_DEFECTO: FormatoCompleto = {
  fuente: 'Arial',
  tamano: 11,
  interlineado: 1,
  margenes: { superior: 2.5, inferior: 2.5, izquierdo: 2.5, derecho: 2.5 },
};

function formatoDe(f?: Formato): FormatoCompleto {
  return {
    fuente: f?.fuente ?? FORMATO_POR_DEFECTO.fuente,
    tamano: f?.tamano ?? FORMATO_POR_DEFECTO.tamano,
    interlineado: f?.interlineado ?? FORMATO_POR_DEFECTO.interlineado,
    margenes: {
      ...FORMATO_POR_DEFECTO.margenes,
      ...Object.fromEntries(Object.entries(f?.margenes ?? {}).filter(([, v]) => v !== undefined)),
    },
  };
}

const cm = (n: number) => convertMillimetersToTwip(n * 10);
// Word mide la letra en medios puntos y el interlineado en 240avos de línea.
const medioPunto = (pt: number) => Math.round(pt * 2);

// Apaisada: el mismo A4 con la orientación horizontal (docx gira el ancho y el alto).
function pagina(f: FormatoCompleto, apaisada = false) {
  return {
    size: { width: cm(21), height: cm(29.7), ...(apaisada ? { orientation: PageOrientation.LANDSCAPE } : {}) },
    margin: {
      top: cm(f.margenes.superior),
      bottom: cm(f.margenes.inferior),
      left: cm(f.margenes.izquierdo),
      right: cm(f.margenes.derecho),
    },
  };
}

function estilos(f: FormatoCompleto) {
  const titulo = (id: string, name: string, pt: number, before: number, outlineLevel: number) => ({
    id,
    name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { font: f.fuente, size: medioPunto(pt), bold: true },
    paragraph: {
      spacing: { before, after: 160, line: Math.round(240 * f.interlineado) },
      keepNext: true,
      outlineLevel,
    },
  });
  return {
    default: {
      document: {
        run: { font: f.fuente, size: medioPunto(f.tamano) },
        paragraph: { spacing: { line: Math.round(240 * f.interlineado), after: 120 } },
      },
    },
    paragraphStyles: [
      titulo('Heading1', 'Heading 1', f.tamano + 5, 360, 0),
      titulo('Heading2', 'Heading 2', f.tamano + 2, 240, 1),
    ],
  };
}

const parrafo = (
  texto: string,
  opciones: {
    bold?: boolean;
    size?: number;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    after?: number;
  } = {},
) =>
  new Paragraph({
    alignment: opciones.alignment ?? AlignmentType.LEFT,
    spacing: opciones.after !== undefined ? { after: opciones.after } : undefined,
    children: [
      new TextRun({
        text: texto,
        bold: opciones.bold ?? false,
        size: opciones.size === undefined ? undefined : medioPunto(opciones.size),
      }),
    ],
  });

/** El texto con su **negrita** y *cursiva* como TextRun (el resto de marcas, literal). */
function runsDe(texto: string, base: { bold?: boolean } = {}): TextRun[] {
  return trozosMarcados(texto).map(
    (t) =>
      new TextRun({
        text: t.texto,
        ...(base.bold || t.negrita ? { bold: true } : {}),
        ...(t.cursiva ? { italics: true } : {}),
      }),
  );
}

export const tituloApartado = (a: Pick<Apartado, 'numero' | 'titulo'>) => `${a.numero}. ${a.titulo}`;
// Un subtítulo que ya trae «1.1», «1.», «1)», «II.1» o «I.» (la estrategia numera sus secciones)
// saldría «1.1 1.1 …»: el número lo pone el documento. Una cifra no es numeración: «2026 en
// cifras», «1.500 usuarios» (el punto separa miles) o «24.7 horas»; por eso cada nivel tiene una
// o dos cifras y detrás va el título, en mayúscula.
const NUMERACION_PROPIA = /^\s*(?:\d{1,2}|[IVXLC]{1,6})(?:(?:\.\d{1,2})+\.?|[.)])\s+(?=\p{Lu})/u;
export const sinNumeracion = (subtitulo: string): string => subtitulo.replace(NUMERACION_PROPIA, '');
/** ¿El subtítulo trae su propia numeración? */
export const llevaNumeracion = (subtitulo: string): boolean => NUMERACION_PROPIA.test(subtitulo);
export const tituloBloque = (numero: string, n: number, subtitulo: string) =>
  `${numero}.${n} ${sinNumeracion(subtitulo)}`;

// Un lote llega ya con su etiqueta («Lote 3: Acciones formativas») o solo con su número
// («3»): «Lote» sale una sola vez.
const etiquetaPortada = (lote: string) => (/^lotes?\b/i.test(lote.trim()) ? lote.trim() : `Lote ${lote.trim()}`);

function lineasPortada(p: Portada): string[] {
  const lotes = (p.lotes ?? []).map(etiquetaPortada);
  const domicilio = p.licitadora.domicilio ? [p.licitadora.domicilio] : [];
  return [
    `Expediente ${p.expediente}`,
    p.organo,
    '',
    `Presentada por ${p.licitadora.nombre} (NIF ${p.licitadora.nif})`,
    ...domicilio,
    ...lotes,
    '',
    p.fecha,
  ];
}

export const EN_BLANCO = '____________________';

/** Las tres líneas del cierre: «En <lugar>, a <fecha>.», «Fdo.: <firmante>» y «<cargo> de <empresa>». */
function lineasFirma(f: Firma): [string, string, string] {
  return [
    `En ${f.lugar ?? EN_BLANCO}, a ${f.fecha}.`,
    `Fdo.: ${f.firmante ?? EN_BLANCO}`,
    f.cargo ? `${f.cargo} de ${f.empresa}` : f.empresa,
  ];
}

// Al final del cuerpo y sin partirse entre páginas; con sitio para la firma sobre «Fdo.:».
function firma(f: Firma): Paragraph[] {
  const [lugar, fdo, empresa] = lineasFirma(f);
  const junto = (texto: string, before: number) =>
    new Paragraph({ keepNext: true, keepLines: true, spacing: { before }, children: [new TextRun(texto)] });
  return [junto(lugar, 480), junto(fdo, 960), new Paragraph({ children: [new TextRun(empresa)] })];
}

function portada(p: Portada, f: FormatoCompleto): Paragraph[] {
  const centrado = { alignment: AlignmentType.CENTER };
  return [
    parrafo('', { after: cm(6) }),
    parrafo(p.titulo, { ...centrado, bold: true, size: f.tamano + 9, after: 240 }),
    ...(p.subtitulo
      ? [parrafo(p.subtitulo, { ...centrado, size: f.tamano + 3, after: 480 })]
      : [parrafo('', { after: 240 })]),
    ...lineasPortada(p).map((l) => parrafo(l, centrado)),
  ];
}

function indice(m: Memoria, ancho: number): (Paragraph | Table)[] {
  const paginas = m.indice?.paginas ?? {};
  const entradas = m.apartados.map((a) => {
    const pag = paginas[a.numero];
    return new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: LeaderType.DOT }],
      children: [
        new TextRun(tituloApartado(a)),
        new TextRun({ children: [new Tab(), pag === undefined ? '' : String(pag)] }),
      ],
    });
  });
  const guia = m.guia
    ? [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true,
          children: [new TextRun(m.guia.titulo)],
        }),
        tabla(m.guia.tabla, ancho),
      ]
    : [];
  return [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Índice')] }), ...entradas, ...guia];
}

/**
 * Ancho de cada columna (en twips) repartiendo el ancho útil según lo que contiene: la raíz
 * del texto más largo, para que una columna con mucho texto no deje a las demás sin sitio, y al
 * menos un 12 % para cada una.
 */
function anchosColumnas(t: Tabla, total: number): number[] {
  const peso = t.cabecera.map((c, i) => Math.sqrt(Math.max(c.length, ...t.filas.map((f) => (f[i] ?? '').length), 1)));
  const suma = peso.reduce((a, b) => a + b, 0);
  const brutos = peso.map((p) => Math.max(total * 0.12, (total * p) / suma));
  const k = total / brutos.reduce((a, b) => a + b, 0);
  return brutos.map((b) => Math.floor(b * k));
}

// Con el ancho de cada celda y maquetación fija: Google Docs, sin ancho por celda, deja las
// columnas estrechas o descolocadas aunque Word y LibreOffice las pinten bien.
function tabla(t: Tabla, total: number): Table {
  const anchos = anchosColumnas(t, total);
  const celda = (texto: string, i: number, cab: boolean) =>
    new TableCell({
      width: { size: anchos[i]!, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      ...(cab ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EDF2' } } : {}),
      children: [new Paragraph({ spacing: { after: 0 }, children: runsDe(texto, { bold: cab }) })],
    });
  const cabecera = new TableRow({ tableHeader: true, children: t.cabecera.map((c, i) => celda(c, i, true)) });
  const filas = t.filas.map(
    (fila) => new TableRow({ cantSplit: true, children: t.cabecera.map((_, i) => celda(fila[i] ?? '', i, false)) }),
  );
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: anchos,
    layout: TableLayoutType.FIXED,
    rows: [cabecera, ...filas],
  });
}

// Una imagen del Word subido, centrada a todo el ancho útil; sin sus bytes, una marca visible.
function imagen(i: Imagen): Paragraph[] {
  if (!i.datos) return [parrafo(`[Imagen no disponible: ${i.pie ?? i.ruta}]`, { alignment: AlignmentType.CENTER })];
  const run = new ImageRun({
    type: i.tipo ?? 'png',
    data: i.datos,
    transformation: tamanoEnPagina(i.ancho, i.alto),
    altText: { name: 'Imagen', description: i.pie ?? '' },
  });
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [run],
    }),
  ];
}

const pieFigura = (n: number, f: Figura) => `Figura ${n}. ${f.titulo}`;

// La imagen, centrada y pegada a su pie. El SVG ya se comprobó al recibir el apartado; si aun
// así no se dibuja, queda el pie para que quien revise el documento lo vea.
function figura(f: Figura, n: number): Paragraph[] {
  const png = svgAPng(f.svg);
  const pieDe = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: pieFigura(n, f), italics: true })],
  });
  if (png.error) return [pieDe];
  const imagen = new ImageRun({
    type: 'png',
    data: png.data.png,
    transformation: tamanoEnPagina(png.data.ancho, png.data.alto),
    altText: { name: `Figura ${n}`, title: pieFigura(n, f), description: f.titulo },
  });
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [imagen],
    }),
    pieDe,
  ];
}

type Contador = { figuras: number; listas: number };
const NUMERACION = 'memoria-numerada';
const COLUMNAS_APAISADO = 6;

/** ¿El bloque va en horizontal? Si lo pide o si su tabla tiene 6 columnas o más. */
const esApaisado = (b: Bloque): boolean => b.apaisado === true || (b.tabla?.cabecera.length ?? 0) >= COLUMNAS_APAISADO;

function bloque(b: Bloque, numero: string, n: number, c: Contador, ancho: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (b.subtitulo)
    out.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(tituloBloque(numero, n, b.subtitulo))] }),
    );
  for (const p of b.parrafos) out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: runsDe(p) }));
  for (const item of b.lista ?? []) out.push(new Paragraph({ bullet: { level: 0 }, children: runsDe(item) }));
  // Cada lista numerada es una instancia propia: empieza en 1.
  const instancia = b.lista_numerada?.length ? ++c.listas : 0;
  for (const item of b.lista_numerada ?? [])
    out.push(
      new Paragraph({ numbering: { reference: NUMERACION, level: 0, instance: instancia }, children: runsDe(item) }),
    );
  if (b.tabla) out.push(tabla(b.tabla, ancho), parrafo(''));
  if (b.figura) out.push(...figura(b.figura, ++c.figuras));
  if (b.imagen) out.push(...imagen(b.imagen));
  return out;
}

// Ancho útil de la página en twips (A4 menos los márgenes izquierdo y derecho; apaisada, el alto).
const anchoUtil = (f: FormatoCompleto, apaisada = false) =>
  cm((apaisada ? 29.7 : 21) - f.margenes.izquierdo - f.margenes.derecho);

type TramoCuerpo = { apaisado: boolean; hijos: (Paragraph | Table)[] };

// Lo que va seguido en la misma orientación, junto; cada cambio abre una sección.
function anadir(tramos: TramoCuerpo[], apaisado: boolean, hijos: (Paragraph | Table)[]): void {
  const ultimo = tramos.at(-1);
  if (ultimo && ultimo.apaisado === apaisado) ultimo.hijos.push(...hijos);
  else tramos.push({ apaisado, hijos });
}

/** El cuerpo en tramos de una orientación (vertical, salvo los bloques apaisados). */
function tramosDelCuerpo(m: Memoria): TramoCuerpo[] {
  const c: Contador = { figuras: 0, listas: 0 };
  const f = formatoDe(m.formato);
  const tramos: TramoCuerpo[] = [];
  for (const a of m.apartados) {
    let n = 0;
    // Sin salto de página por apartado: con límite de páginas cada media página en blanco cuenta.
    anadir(tramos, false, [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(tituloApartado(a))] }),
    ]);
    for (const b of a.bloques)
      anadir(tramos, esApaisado(b), bloque(b, a.numero, b.subtitulo ? ++n : n, c, anchoUtil(f, esApaisado(b))));
  }
  if (m.firma) anadir(tramos, false, firma(m.firma));
  return tramos;
}

// El total va literal: TOTAL_PAGES_IN_SECTION sale vacío con varias secciones (apaisadas) y en
// LibreOffice. Sin total conocido, «Página N» a secas, sin « de » colgando.
function pie(texto: string, numerado: boolean, total?: number): Footer | undefined {
  if (!texto && !numerado) return undefined;
  const numeracion = numerado
    ? [
        new TextRun(`${texto ? `${texto} — ` : ''}Página `),
        new TextRun({ children: [PageNumber.CURRENT] }),
        ...(total ? [new TextRun(` de ${total}`)] : []),
      ]
    : [new TextRun(texto)];
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: numeracion })] });
}

const numeracion = {
  config: [
    {
      reference: NUMERACION,
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        },
      ],
    },
  ],
};

/**
 * Portada sin pie, índice (y la tabla guía) con el pie sin numerar y el cuerpo numerado desde 1;
 * cada tramo apaisado del cuerpo es su propia sección, con el mismo pie y la numeración seguida.
 */
export async function generarDocx(m: Memoria): Promise<Buffer> {
  const f = formatoDe(m.formato);
  const page = pagina(f);
  const pieIndice = pie(m.pie.texto, false);
  const pieCuerpo = pie(m.pie.texto, m.pie.numeracion, m.indice?.total_cuerpo);
  const cuerpo = tramosDelCuerpo(m).map((t, i) => ({
    properties: {
      type: SectionType.NEXT_PAGE,
      page: { ...pagina(f, t.apaisado), ...(i === 0 ? { pageNumbers: { start: 1 } } : {}) },
    },
    footers: pieCuerpo ? { default: pieCuerpo } : {},
    children: t.hijos,
  }));
  const doc = new Document({
    creator: m.portada.licitadora.nombre,
    title: m.portada.titulo,
    styles: estilos(f),
    numbering: numeracion,
    sections: [
      { properties: { page }, children: portada(m.portada, f) },
      {
        properties: { type: SectionType.NEXT_PAGE, page },
        footers: pieIndice ? { default: pieIndice } : {},
        children: indice(m, anchoUtil(f)),
      },
      ...cuerpo,
    ],
  });
  return Packer.toBuffer(doc);
}

const celdaMd = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function tablaMd(t: Tabla): string[] {
  return [
    `| ${t.cabecera.map(celdaMd).join(' | ')} |`,
    `| ${t.cabecera.map(() => '---').join(' | ')} |`,
    ...t.filas.map((f) => `| ${t.cabecera.map((_, i) => celdaMd(f[i] ?? '')).join(' | ')} |`),
  ];
}

// Quien lee el .md (la web, los jueces, el crítico) no ve el dibujo: va su pie y sus rótulos,
// hasta un tope, para que una pantalla o un flujo se juzguen por lo que dicen.
const MAX_CONTENIDO_FIGURA = 600;

function figuraMd(f: Figura, n: number): string[] {
  const textos = textosDeSvg(f.svg).join(' · ');
  if (!textos) return [`*${pieFigura(n, f)}* (dibujo en el .docx)`, ''];
  const contenido =
    textos.length > MAX_CONTENIDO_FIGURA ? `${textos.slice(0, MAX_CONTENIDO_FIGURA - 1).trimEnd()}…` : textos;
  return [`*${pieFigura(n, f)}*`, '', `Contenido: ${contenido}`, ''];
}

function bloqueMd(b: Bloque, numero: string, n: number, c: Contador): string[] {
  return [
    ...(b.subtitulo ? [`### ${tituloBloque(numero, n, b.subtitulo)}`, ''] : []),
    ...b.parrafos.flatMap((p) => [p, '']),
    ...(b.lista?.length ? [...b.lista.map((i) => `- ${i}`), ''] : []),
    ...(b.lista_numerada?.length ? [...b.lista_numerada.map((x, i) => `${i + 1}. ${x}`), ''] : []),
    ...(b.tabla ? [...tablaMd(b.tabla), ''] : []),
    ...(b.figura ? figuraMd(b.figura, ++c.figuras) : []),
    ...(b.imagen ? [`*[Imagen${b.imagen.pie ? `: ${b.imagen.pie}` : ''}]* (en el .docx)`, ''] : []),
  ];
}

/** La misma memoria en Markdown (para leerla por MCP y en la web sin abrir Word). */
export function memoriaAMarkdown(m: Memoria): string {
  const p = m.portada;
  const paginas = m.indice?.paginas ?? {};
  const cabecera = [
    `# ${p.titulo}`,
    ...(p.subtitulo ? [p.subtitulo] : []),
    '',
    `**Expediente:** ${p.expediente} · **Órgano:** ${p.organo} · **Licitadora:** ${p.licitadora.nombre} (NIF ${p.licitadora.nif})${p.licitadora.domicilio ? `, ${p.licitadora.domicilio}` : ''}${p.lotes?.length ? ` · ${p.lotes.map(etiquetaPortada).join('; ')}` : ''} · **Fecha:** ${p.fecha}`,
    '',
    '## Índice',
    '',
    ...m.apartados.map(
      (a) => `- ${tituloApartado(a)}${paginas[a.numero] === undefined ? '' : ` (pág. ${paginas[a.numero]})`}`,
    ),
    '',
    ...(m.guia ? [`## ${m.guia.titulo}`, '', ...tablaMd(m.guia.tabla), ''] : []),
  ];
  const c: Contador = { figuras: 0, listas: 0 };
  const apartados = m.apartados.flatMap((a) => {
    let n = 0;
    return [
      `## ${tituloApartado(a)}`,
      '',
      ...a.bloques.flatMap((b) => bloqueMd(b, a.numero, b.subtitulo ? ++n : n, c)),
    ];
  });
  const cierre = m.firma ? lineasFirma(m.firma).flatMap((l) => [l, '']) : [];
  return `${[...cabecera, ...apartados, ...cierre]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

// Calibrado con las memorias presentadas de la empresa (Arial 11, sencillo, 2,5 cm): prosa 3.100-3.400
// caracteres por página, con viñetas y cuadros 2.300-2.600; media 2.750.
export const CARACTERES_POR_PAGINA = 2_800;
const CARACTERES_POR_LINEA = 85;
const MIN_ITEM = 60;
const LINEAS_TITULO = 3;
const LINEAS_SUBTITULO = 2;
const FACTOR_TABLA = 1.3;

const aLineas = (caracteres: number) => Math.ceil(caracteres / CARACTERES_POR_LINEA) * CARACTERES_POR_LINEA;

// Las marcas de negrita y cursiva no ocupan.
function caracteresDeBloque(b: Bloque): number {
  const parrafos = b.parrafos.reduce((n, p) => n + aLineas(sinMarcas(p).length), 0);
  const lista = [...(b.lista ?? []), ...(b.lista_numerada ?? [])].reduce(
    (n, i) => n + aLineas(Math.max(sinMarcas(i).length, MIN_ITEM)),
    0,
  );
  const filas = b.tabla ? [b.tabla.cabecera, ...b.tabla.filas] : [];
  const tabla = filas.reduce((n, f) => n + aLineas(sinMarcas(f.join(' ')).length) * FACTOR_TABLA, 0);
  const figura = b.figura
    ? fraccionDePagina(b.figura.svg) * CARACTERES_POR_PAGINA + LINEAS_SUBTITULO * CARACTERES_POR_LINEA
    : 0;
  const img = b.imagen ? fraccionDeImagen(b.imagen.ancho, b.imagen.alto) * CARACTERES_POR_PAGINA : 0;
  return (b.subtitulo ? LINEAS_SUBTITULO * CARACTERES_POR_LINEA : 0) + parrafos + lista + tabla + figura + img;
}

/** Páginas que ocupará el cuerpo (sin portada ni índice) a partir de su texto y formato. */
export function estimarPaginas(m: Pick<Memoria, 'formato' | 'apartados'>): {
  paginas: number;
  caracteres: number;
  base_por_pagina: number;
} {
  const f = formatoDe(m.formato);
  const base = Math.round((CARACTERES_POR_PAGINA * (11 / f.tamano) ** 2) / f.interlineado);
  const caracteres = m.apartados.reduce(
    (n, a) => n + LINEAS_TITULO * CARACTERES_POR_LINEA + a.bloques.reduce((k, b) => k + caracteresDeBloque(b), 0),
    0,
  );
  return {
    paginas: Math.max(0.1, Math.round((caracteres / base) * 10) / 10),
    caracteres: Math.round(caracteres),
    base_por_pagina: base,
  };
}
