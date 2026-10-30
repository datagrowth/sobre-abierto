// Un apartado de la memoria técnica que envía Hermes (esquema) y su revisión. Pura: sin base de datos.
import { z } from 'zod';
import {
  fraccionDeImagen,
  fraccionDePagina,
  LETRA_MINIMA_PT,
  letraMinimaPt,
  SVG_MAX,
  svgAPng,
  textosDeSvg,
} from '../../../nucleo/documentos/figuras.js';
import { marcasNoAdmitidas, sinMarcas } from '../../../nucleo/documentos/marcas.js';
import { textoComparable } from '../temas.js';
import { detectarFugas, importesSueltos, type ContextoFugas, type Fuga, type TipoFuga } from './fugas.js';
import { puntosTexto } from './guionRevision.js';
import { citasInternas, SIN_TERMINAR } from './textoPliego.js';
import { aplazamientosEn, MAX_RATIFICACIONES, ratificacionesEn } from './aplazamientos.js';
import { DENSIDAD_MINIMA, esTelegrafico, pegadasToleradas, telegrafiaDe } from './telegrafia.js';

export { sinCitasInternas } from './textoPliego.js';

// La memoria se entrega tal cual al órgano de contratación: el apartado debe responder a cada punto de «se
// valorará» del pliego, sin huecos, dentro de su parte del límite de páginas sin quedarse corto y en afirmativo,
// sin una retahíla de matices que restan (problemas blandos: tras dos rechazos entran como aviso), y sin fugas
// al archivo de los criterios automáticos o de la oferta económica (fugas.ts: duros, causa de exclusión; los
// ecos, que son sospechas, blandos).
const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);

const Bloque = z.strictObject({
  subtitulo: Texto(2, 200).optional(),
  parrafos: z
    .array(Texto(20, 3000))
    .max(30)
    .describe('Texto final, en párrafos (admite **negrita** y *cursiva*, nada más)'),
  lista: z.array(Texto(2, 1000)).max(40).optional().describe('Viñetas'),
  lista_numerada: z
    .array(Texto(2, 1000))
    .max(40)
    .optional()
    .describe('Pasos numerados (1, 2, 3…; empiezan en 1 en cada bloque)'),
  apaisado: z
    .boolean()
    .optional()
    .describe('El bloque va en una página horizontal (una tabla de 6 columnas o más ya va así)'),
  tabla: z
    .strictObject({
      cabecera: z.array(Texto(1, 200)).min(1).max(10),
      filas: z.array(z.array(z.string().trim().max(1000)).max(10)).max(60),
    })
    .optional(),
  figura: z
    .strictObject({
      titulo: Texto(5, 200).describe('Pie de la figura, sin «Figura N» (el número lo pone el documento)'),
      svg: z
        .string()
        .trim()
        .min(50)
        .max(SVG_MAX)
        .describe('Un único <svg viewBox="…"> autocontenido: sin scripts, imágenes ni recursos externos'),
    })
    .optional()
    .describe('Diagrama, pantalla o calendario dibujado como SVG; va al final del bloque'),
  imagen: z
    .strictObject({
      ruta: Texto(5, 500).describe(
        'Ruta en Salidas de una imagen de una versión subida a mano (la que trae el texto anterior)',
      ),
      ancho: z.number().int().min(1).max(20_000),
      alto: z.number().int().min(1).max(20_000),
      pie: z.string().trim().max(300).optional(),
    })
    .optional()
    .describe('Imagen de una versión editada a mano, para conservarla; va al final del bloque'),
});

// Lo que se guarda de un apartado (sin los números de la tarea).
export const ApartadoDatos = z.strictObject({
  titulo: Texto(2, 300).describe('El título literal del guion'),
  bloques: z.array(Bloque).min(1).max(40),
  cubre: z
    .array(
      z.strictObject({
        item: Texto(2, 1000).describe('Un punto de «se valorará», literal'),
        bloque: z.number().int().min(1).describe('Bloque que lo trata (1 = el primero)'),
        parrafo: z.number().int().min(1).optional().describe('Párrafo dentro del bloque (1 = el primero)'),
      }),
    )
    .max(40),
  compromisos: z
    .array(
      z.strictObject({
        que: Texto(3, 500),
        quien: z.string().trim().max(200).describe('Persona o rol que lo asume'),
        cuando_o_medida: z.string().trim().max(300).describe('Plazo, frecuencia o indicador'),
      }),
    )
    .max(40),
  // Opcional: pedirlas empujaba a citar el pliego también en el texto que se entrega.
  fuentes: z
    .array(z.strictObject({ documento: Texto(1, 500), pagina: z.number().int().min(1).max(5000).optional() }))
    .max(40)
    .optional()
    .describe('Opcional: documento y página del pliego en que te apoyas (para el equipo; no van al documento)'),
});
export type ApartadoDatosData = z.infer<typeof ApartadoDatos>;

// Calibrado con las memorias presentadas de la empresa: prosa 3.100-3.400 caracteres por página, con
// viñetas o CV 2.300-2.600; media 2.750.
export const CARACTERES_POR_PAGINA = 2800;
// Holgura sobre la parte proporcional: un apartado puede necesitar algo más que otro.
const HOLGURA_CUOTA = 1.15;
// Portada e índice no cuentan, pero títulos, saltos y tablas sí ocupan.
const PAGINAS_FUERA_DE_CUOTA = 2;
// Pasarse más de esto de la cuota ya no se tolera tras dos rechazos: el límite de páginas es del pliego.
const EXCESO_DURO = 1.3;
// La memoria añade «Cómo se responde a cada criterio»: una fila por «se valorará» (hasta MAX_FILAS_GUIA)
// y unas FILAS_GUIA_POR_PAGINA por página. Cuenta para el límite del pliego. Con la columna de
// evidencia (hasta 160 caracteres, unas 6 líneas en su columna) caben unas 8 filas por página.
export const MAX_FILAS_GUIA = 200;
const FILAS_GUIA_POR_PAGINA = 8;
// Más figuras por apartado ya no explican: rellenan páginas.
const FIGURAS_MAX = 4;
// Un apartado de mockup enseña pantallas: cada una es una figura (la memoria que ganó daba 9
// pantallas con su leyenda numerada; con 4 no cabían).
export const FIGURAS_MAX_MOCKUP = 10;
const MOCKUP =
  /\bmock\s*-?\s*ups?\b|\bmaquetas?\b|\bprototipos?\b|\bpantallas?\b|\binterfaz\b|\binterfaces\b|\bwireframes?\b/;

/** ¿El apartado pide pantallas (mockup, maqueta, prototipo, interfaz)? Por su título y su «se valorará». */
export const esMockup = (a: Pick<ApartadoDelGuion, 'titulo' | 'se_valorara'>): boolean =>
  MOCKUP.test(textoComparable([a.titulo, ...a.se_valorara].join(' ')));
export const figurasMaximas = (a: Pick<ApartadoDelGuion, 'titulo' | 'se_valorara'>): number =>
  esMockup(a) ? FIGURAS_MAX_MOCKUP : FIGURAS_MAX;
// Suelo de un apartado que puntúa: por debajo deja espacio que otras ofertas llenan con
// contenido que la mesa valora. Con la holgura, el 70 % de la cuota es ≈ 80 % de su parte.
const SUELO_CUOTA = 0.7;

type BloqueEnviado = z.infer<typeof Bloque>;
type ApartadoEnviado = Pick<ApartadoDatosData, 'titulo' | 'bloques' | 'cubre' | 'compromisos'>;
export type ApartadoDelGuion = { titulo: string; puntos: number; se_valorara: string[] };
// reparto: por qué le toca esa parte del límite («por sus 8 puntos de 25»). minimo: el suelo
// (null si la memoria no puntúa: ahí solo se comprueba lo exigido y alargar sería relleno).
// objetivo: su parte sin la holgura. Si todos los apartados llenan la cuota entera, la suma pasa
// del límite (1,15 × las páginas): la extensión que se pide es la parte, la cuota solo es el tope.
// sinLimite: el pliego no fija páginas y el tope sale de la extensión objetivo de la estrategia.
export type Cuota = {
  caracteres: number;
  objetivo: number;
  minimo: number | null;
  paginas: number;
  limite: number;
  reparto: string;
  sinLimite?: boolean;
};
// Lo que se vigila (criterios automáticos que van en otro archivo, lo decidido en ellos, nombres
// propios…: fugas.ts), la rúbrica y la cuota del apartado.
export type ContextoApartado = ContextoFugas & { apartado: ApartadoDelGuion; cuota: Cuota | null };

const MILES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const comillas = (xs: string[]) => xs.map((x) => `«${x}»`).join(', ');
const normal = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const centenas = (n: number) => Math.round(n / 100) * 100;

type ConApartados = { apartados: { se_valorara: string[] }[] };

/** Páginas de la tabla guía (0 sin «se valorará»): enteras, porque empieza en página nueva y el cuerpo también. */
export function paginasDeGuia(mem: ConApartados): number {
  const filas = Math.min(
    MAX_FILAS_GUIA,
    mem.apartados.reduce((n, a) => n + a.se_valorara.length, 0),
  );
  return Math.ceil(filas / FILAS_GUIA_POR_PAGINA);
}

/** Las páginas que se reservan a la guía de la memoria. */
export const reservaDeGuia = (mem: ConApartados | null | undefined): number => (mem ? paginasDeGuia(mem) : 0);

function cuota(limite: number, parte: number, reparto: string, conSuelo: boolean, reservadas: number): Cuota {
  const suya = Math.max(1, limite - PAGINAS_FUERA_DE_CUOTA - reservadas) * CARACTERES_POR_PAGINA * parte;
  const caracteres = centenas(suya * HOLGURA_CUOTA);
  const minimo = conSuelo ? centenas(caracteres * SUELO_CUOTA) : null;
  return {
    caracteres,
    objetivo: centenas(suya),
    minimo,
    paginas: Math.max(1, Math.round(caracteres / CARACTERES_POR_PAGINA)),
    limite,
    reparto,
  };
}

/** La parte del límite de páginas que corresponde a un apartado por sus puntos, con su suelo (null sin límite). */
export function cuotaDeApartado(limite: number | null, puntos: number, total: number, reservadas = 0): Cuota | null {
  if (limite === null || total <= 0) return null;
  return cuota(
    limite,
    puntos / total,
    `por sus ${puntosTexto(puntos)} puntos de ${puntosTexto(total)}`,
    true,
    reservadas,
  );
}

/**
 * Sin límite de páginas, el tope de un apartado es la extensión objetivo de su estrategia
 * con la misma holgura: un techo, no un objetivo, así que sin suelo (sin él, la memoria salió un 63 %
 * más larga que su plan y los jueces lo leyeron como relleno).
 */
export function cuotaDeObjetivo(objetivo: number): Cuota {
  const caracteres = centenas(objetivo * HOLGURA_CUOTA);
  return {
    caracteres,
    objetivo: centenas(objetivo),
    minimo: null,
    paginas: Math.max(1, Math.round(caracteres / CARACTERES_POR_PAGINA)),
    limite: 0,
    reparto: 'la extensión objetivo de la estrategia',
    sinLimite: true,
  };
}

/** Dónde sale la cuota, para los mensajes: la parte del límite del pliego o el objetivo de la estrategia. */
export const origenDeCuota = (q: Cuota): string =>
  q.sinLimite
    ? `${q.reparto} más un 15 %; el pliego no limita las páginas`
    : `≈ ${q.paginas} páginas de las ${q.limite} del límite, ${q.reparto}`;

/** En una memoria que no se puntúa, el límite se reparte a partes iguales, sin suelo (null sin límite). */
export function cuotaIgual(limite: number | null, apartados: number, reservadas = 0): Cuota | null {
  if (limite === null || apartados <= 0) return null;
  return cuota(limite, 1 / apartados, `a partes iguales entre los ${apartados} apartados`, false, reservadas);
}

function textoEscrito(b: BloqueEnviado): string[] {
  const tabla = b.tabla ? [b.tabla.cabecera.join(' '), ...b.tabla.filas.map((f) => f.join(' '))] : [];
  return [b.subtitulo ?? '', ...b.parrafos, ...(b.lista ?? []), ...(b.lista_numerada ?? []), ...tabla]
    .filter(Boolean)
    .map(sinMarcas);
}

/** Todo el texto que se lee en el bloque, incluidos el pie y los rótulos de su figura. */
export function textoDeBloque(b: BloqueEnviado): string {
  const figura = b.figura ? [`Figura: ${b.figura.titulo}`, ...textosDeSvg(b.figura.svg)] : [];
  const imagen = b.imagen?.pie ? [`Imagen: ${b.imagen.pie}`] : [];
  return [...textoEscrito(b), ...figura, ...imagen].join('\n');
}

// Una figura cuenta por lo que ocupa en la página, no por sus rótulos.
export function caracteresDe(bloques: BloqueEnviado[]): number {
  return bloques.reduce(
    (n, b) =>
      n +
      textoEscrito(b).join('\n').length +
      (b.figura ? Math.round(fraccionDePagina(b.figura.svg) * CARACTERES_POR_PAGINA) : 0) +
      (b.imagen ? Math.round(fraccionDeImagen(b.imagen.ancho, b.imagen.alto) * CARACTERES_POR_PAGINA) : 0),
    0,
  );
}

/**
 * Lo que impide aceptar las figuras de un apartado, siempre (sin aceptación con avisos: una
 * figura que no se dibuja o que trae contenido externo no puede ir al documento). Null si valen.
 */
export function erroresDeFiguras(bloques: BloqueEnviado[], maximo = FIGURAS_MAX): string | null {
  const con = bloques.flatMap((b, i) => (b.figura ? [{ i: i + 1, f: b.figura }] : []));
  if (con.length > maximo)
    return `El apartado trae ${con.length} figuras y el máximo es ${maximo}: deja las que expliquen algo que el texto no puede.`;
  const malas = con.flatMap(({ i, f }) => {
    const r = svgAPng(f.svg);
    return r.error ? [`la del bloque ${i} («${f.titulo}»): ${r.error.message}`] : [];
  });
  return malas.length
    ? `Estas figuras no se pueden dibujar: ${malas.join('; ')}. Corrige el SVG y reenvía el apartado entero.`
    : null;
}

export const paginasEstimadasDe = (caracteres: number): number =>
  Math.round((caracteres / CARACTERES_POR_PAGINA) * 10) / 10;

// Quita «1. » o «2.3) » delante: la numeración la pone el documento.
const sinNumero = (t: string) => t.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '');

function problemaDeTitulo(e: ApartadoEnviado, c: ContextoApartado): string | null {
  return normal(sinNumero(e.titulo)) === normal(c.apartado.titulo)
    ? null
    : `El título debe ser el literal del guion: «${c.apartado.titulo}».`;
}

function problemasDeCubre(e: ApartadoEnviado, c: ContextoApartado): string[] {
  const items = new Map(c.apartado.se_valorara.map((s) => [normal(s), s]));
  const ajenos = e.cubre.filter((x) => !items.has(normal(x.item))).map((x) => x.item);
  const malos = e.cubre
    .filter((x) => items.has(normal(x.item)))
    .flatMap((x) => {
      const b = e.bloques[x.bloque - 1];
      if (!b)
        return [
          `En «cubre», «${x.item}» apunta al bloque ${x.bloque}, que no existe (el apartado tiene ${e.bloques.length}).`,
        ];
      if (x.parrafo !== undefined && !b.parrafos[x.parrafo - 1])
        return [
          `En «cubre», «${x.item}» apunta al párrafo ${x.parrafo} del bloque ${x.bloque}, que tiene ${b.parrafos.length}.`,
        ];
      return [];
    });
  const cubiertos = new Set(e.cubre.map((x) => normal(x.item)));
  const faltan = c.apartado.se_valorara.filter((s) => !cubiertos.has(normal(s)));
  return [
    ...(faltan.length
      ? [
          `Faltan por cubrir estos puntos de «se valorará» del apartado «${c.apartado.titulo}»: ${comillas(faltan)}. Añade contenido que los trate y decláralos en «cubre» con su bloque.`,
        ]
      : []),
    ...malos,
    ...(ajenos.length
      ? [
          `En «cubre», ${comillas(ajenos)} no es un punto de «se valorará» de este apartado: usa el texto literal de la lista.`,
        ]
      : []),
  ];
}

// Hallazgos por bloque: «a», «b» (bloque 2); «c» (bloque 3).
function enBloques(e: ApartadoEnviado, buscar: (texto: string) => string[]): string | null {
  const partes = e.bloques.flatMap((b, i) => {
    const hallados = [...new Set(buscar(textoDeBloque(b)))];
    return hallados.length ? [`${comillas(hallados)} (bloque ${i + 1})`] : [];
  });
  return partes.length ? partes.join('; ') : null;
}

const hallar = (re: RegExp) => (t: string) => [...t.matchAll(re)].map((m) => m[0].trim());

function problemasDeContenido(e: ApartadoEnviado): string[] {
  const huecos = enBloques(e, hallar(SIN_TERMINAR));
  const importes = enBloques(e, importesSueltos);
  const citas = enBloques(e, citasInternas);
  const marcas = enBloques(e, marcasNoAdmitidas);
  return [
    ...(marcas
      ? [
          `Solo se admiten **negrita** y *cursiva*: estas marcas saldrían tal cual en el Word: ${marcas}. Quítalas (una lista va en «lista» o «lista_numerada»; un título, en «subtitulo»).`,
        ]
      : []),
    ...(huecos
      ? [
          `Quita las marcas de texto sin terminar: ${huecos}. La memoria se entrega tal cual: escribe el dato o quita la frase.`,
        ]
      : []),
    ...(importes
      ? [
          `Revisa estos importes: la frase no habla de nuestra oferta, pero si fueran de ella, mencionarlos aquí sería causa de exclusión; quítalos o, si son un ejemplo del método, que se vea en la frase: ${importes}.`,
        ]
      : []),
    ...(citas
      ? [
          `Quita del texto las citas internas del pliego: ${citas}. Lo que tomes del pliego va en prosa propia (la referencia, si quieres, en «fuentes»); si hace falta nombrarlo en el texto, en prosa («como pide el apartado 4.1 de la ETC»).`,
        ]
      : []),
  ];
}

export type FugaEnBloque = Fuga & { bloque: number };

/** Las fugas de un apartado, bloque a bloque (también en los rótulos y el pie de sus figuras). */
export function fugasDeApartado(e: Pick<ApartadoEnviado, 'bloques'>, c: ContextoFugas): FugaEnBloque[] {
  return e.bloques.flatMap((b, i) => detectarFugas(textoDeBloque(b), c).map((f) => ({ ...f, bloque: i + 1 })));
}

const corto = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 3)}…` : t);

// «a», «b» (bloque 2); «c» (bloque 3), como el resto de problemas.
function porBloques(fs: FugaEnBloque[]): string {
  return [...new Set(fs.map((f) => f.bloque))]
    .map((b) => `${comillas([...new Set(fs.filter((f) => f.bloque === b).map((f) => f.marca))])} (bloque ${b})`)
    .join('; ');
}

const archivosDe = (fs: FugaEnBloque[]) => comillas([...new Set(fs.map((f) => f.archivo))]);

function mensajesDeFugas(fs: FugaEnBloque[]): string[] {
  const de = (t: TipoFuga) => fs.filter((f) => f.tipo === t);
  const [importes, marcas, documentos, decididos] = [de('importe'), de('marca'), de('documento'), de('decidido')];
  const enCita = (f: FugaEnBloque) =>
    `«${f.marca}» en «${f.cita}» (bloque ${f.bloque}; criterio «${corto(f.criterio)}»)`;
  return [
    ...(importes.length
      ? [
          `La memoria no puede llevar importes ni bajas (van en el archivo de la oferta económica y mencionarlos aquí es causa de exclusión): ${porBloques(importes)}.`,
        ]
      : []),
    ...(marcas.length
      ? [
          `El apartado menciona criterios automáticos que van en ${archivosDe(marcas)} y no pueden aparecer en la memoria (causa de exclusión): ${porBloques(marcas)}. Quítalos.`,
        ]
      : []),
    ...(documentos.length
      ? [
          `El apartado nombra documentos que van en ${archivosDe(documentos)} (causa de exclusión): ${porBloques(documentos)}. Quítalos.`,
        ]
      : []),
    ...(decididos.length
      ? [
          `El apartado dice lo que ofrecemos en criterios automáticos que van en ${archivosDe(decididos)} (causa de exclusión): ${decididos.map(enCita).join('; ')}. Quítalo o dilo sin esa cifra ni esa herramienta.`,
        ]
      : []),
  ];
}

// Un eco es una sospecha (dice algo parecido a una declaración con otras palabras): si la
// rúbrica obliga a decirlo, rechazarlo siempre quitaba contenido que puntúa y agotaba el trabajo.
function mensajeDeEcos(fs: FugaEnBloque[]): string | null {
  const ecos = fs.filter((f) => f.tipo === 'eco');
  if (!ecos.length) return null;
  const eco = (f: FugaEnBloque) =>
    `«${f.cita}» (bloque ${f.bloque}) dice lo mismo que «${f.marca}» («${corto(f.criterio)}»)`;
  return `El apartado parece repetir con otras palabras lo que se declara en criterios automáticos que van en ${archivosDe(ecos)} (puede ser causa de exclusión): ${ecos.map(eco).join('; ')}. Reescríbelo sin esa idea; si la rúbrica pide justo eso, descríbelo con lo propio del apartado.`;
}

function problemaDeExtension(e: ApartadoEnviado, c: ContextoApartado): string | null {
  const q = c.cuota;
  if (!q) return null;
  const caracteres = caracteresDe(e.bloques);
  const tiene = `El apartado tiene ${MILES.format(caracteres)} caracteres y le corresponden unos ${MILES.format(q.caracteres)} (${origenDeCuota(q)})`;
  if (caracteres > q.caracteres) return `${tiene}: recorta sin perder los puntos de «se valorará».`;
  if (q.minimo === null || caracteres >= q.minimo) return null;
  return `${tiene}: se queda corto, por debajo de ${MILES.format(q.minimo)}. Desarrolla cada punto de «se valorará» con más contenido operativo (quién, cómo, cuándo, con qué herramienta y con qué medida) hasta acercarte a la cuota, sin relleno ni repetir el pliego.`;
}

// Matices que restan: en una memoria se leen como «esto no lo haremos» y la mesa puntúa lo que
// se compromete. Alguno suelto se tolera; más de uno cada dos páginas ya es el tono del texto.
const MATICES =
  /\bno se ofert[ae]n?\b|\bno equivalen?\b|\bno incluyen?\b|\ben la medida de lo posible\b|\bsiempre que sea posible\b|\bsi procede\b|\ben su caso\b|\bno se garantiza\b/gi;
const MATICES_TOLERADOS = 2;
const PAGINAS_POR_MATIZ = 2;

function problemaDeTono(e: ApartadoEnviado): string | null {
  const texto = e.bloques.map(textoDeBloque).join('\n');
  const hallados = hallar(MATICES)(texto).map((m) => m.toLowerCase());
  const tolerados = Math.max(MATICES_TOLERADOS, Math.floor(texto.length / (CARACTERES_POR_PAGINA * PAGINAS_POR_MATIZ)));
  if (hallados.length <= tolerados) return null;
  return `El apartado matiza demasiado: ${hallados.length} expresiones que restan (${comillas([...new Set(hallados)])}) en unas ${String(paginasEstimadasDe(texto.length)).replace('.', ',')} páginas. Escribe en afirmativo, en presente o futuro de compromiso, lo que entregaremos, cuándo y cómo se mide; lo que no se ofrece no se menciona.`;
}

// En un apartado de mockup, cada pantalla lleva sus llamadas 1-n y, debajo, la lista numerada que
// las explica; con varias, una tabla de pantallas (qué es cada una y quién la usa). Sin leyenda,
// los jueces leían un dibujo sin saber qué mirar.
function problemasDeMockup(e: ApartadoEnviado, c: ContextoApartado): string[] {
  if (!esMockup(c.apartado)) return [];
  const conFigura = e.bloques.flatMap((b, i) => (b.figura ? [{ b, i: i + 1 }] : []));
  const sinLeyenda = conFigura.filter(({ b }) => !b.lista_numerada?.length).map(({ i }) => i);
  const sinTabla = conFigura.length >= 2 && !e.bloques.some((b) => b.tabla);
  return [
    ...(sinLeyenda.length
      ? [
          `Cada pantalla lleva sus llamadas numeradas (1, 2, 3…) dentro del SVG y, en el mismo bloque, la lista numerada que las explica: falta en los bloques ${sinLeyenda.join(', ')}.`,
        ]
      : []),
    ...(sinTabla
      ? ['Con varias pantallas, añade una tabla de pantallas (pantalla, para qué sirve, quién la usa).']
      : []),
  ];
}

// Aplazamientos («a acordar», «sujeto a validación», «T0»…): alguno suelto puede ser lo que el
// pliego reserva al órgano; más de uno cada dos páginas es una memoria que no decide.
const PAGINAS_POR_APLAZAMIENTO = 2;

function problemaDeAplazamientos(e: ApartadoEnviado): string | null {
  const texto = e.bloques.map(textoDeBloque).join('\n');
  const hallados = aplazamientosEn(texto);
  const tolerados = Math.max(1, Math.floor(texto.length / (CARACTERES_POR_PAGINA * PAGINAS_POR_APLAZAMIENTO)));
  if (hallados.length <= tolerados) return null;
  const citas = hallados
    .slice(0, 4)
    .map((f) => `«${corto(f)}»`)
    .join('; ');
  return `APLAZAMIENTOS: el apartado deja ${hallados.length} valores sin fijar (${citas}) y se tolera uno cada ${PAGINAS_POR_APLAZAMIENTO} páginas. Escribe el valor como hecho («La solución usa…», «El servicio se presta de 9:00 a 18:00 h») y las fechas absolutas desde el inicio previsto, nunca relativas a T0.`;
}

// «X propone…; el órgano lo ratifica en el acta» repetido se lee como aplazamiento aunque lleve
// fecha: una por apartado (lo que el pliego reserva al órgano) y lo demás, como hecho.
function problemaDeRatificaciones(e: ApartadoEnviado): string | null {
  const hallados = ratificacionesEn(e.bloques.map(textoDeBloque).join('\n'));
  if (hallados.length <= MAX_RATIFICACIONES) return null;
  const citas = hallados
    .slice(0, 3)
    .map((f) => `«${corto(f)}»`)
    .join('; ');
  return `RATIFICACIONES: el apartado deja ${hallados.length} decisiones a que el órgano las ratifique (${citas}) y se tolera ${MAX_RATIFICACIONES}. Lo decidido se escribe como hecho («La solución usa…», «El servicio se presta…»); «se ratifica en…» solo para lo que el pliego reserva expresamente al órgano.`;
}

// Prosa telegráfica (telegrafia.ts): los jueces la leyeron como «difícil de leer» aunque tuviera
// todas las cifras. Solo los párrafos: las listas y las tablas son fragmentos por naturaleza.
const PORCENTAJE = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

function problemaDeTelegrafia(e: ApartadoEnviado): string | null {
  const t = telegrafiaDe(e.bloques.flatMap((b) => b.parrafos.map(sinMarcas)));
  if (!esTelegrafico(t)) return null;
  const densidad =
    t.densidad < DENSIDAD_MINIMA
      ? ` solo el ${PORCENTAJE.format(t.densidad * 100)} % de las palabras de los párrafos son artículos, preposiciones o conjunciones (la prosa que se lee bien pasa del ${PORCENTAJE.format(DENSIDAD_MINIMA * 100)} %);`
      : '';
  const pegadas =
    t.pegadas.length > pegadasToleradas(t.palabras)
      ? ` ${t.pegadas.length} palabras pegadas con barras o a una cifra (${comillas([...new Set(t.pegadas)].slice(0, 4))});`
      : '';
  const ejemplos = t.ejemplos.length
    ? ` Frases sin verbo o en retahíla: ${t.ejemplos
        .slice(0, 2)
        .map((f) => `«${corto(f)}»`)
        .join('; ')}.`
    : '';
  return `PROSA TELEGRÁFICA:${densidad}${pegadas}${ejemplos} Escribe párrafos completos, con frases de sujeto y verbo, sus artículos y conectores («por eso», «además», «para ello»), sin unir palabras con barras; los datos y las enumeraciones largas, en tabla o lista. Si no cabe, quita lo secundario: no comprimas la sintaxis.`;
}

function problemasDeFiguras(e: ApartadoEnviado): string[] {
  return e.bloques.flatMap((b, i) => {
    if (!b.figura) return [];
    const letra = letraMinimaPt(b.figura.svg);
    return [
      ...(letra !== null && letra < LETRA_MINIMA_PT
        ? [
            `La figura del bloque ${i + 1} tiene letra de ${String(letra).replace('.', ',')} pt una vez en la página (ancho útil de 16 cm): agranda font-size o reduce el ancho del viewBox para que no baje de ${LETRA_MINIMA_PT} pt.`,
          ]
        : []),
      ...(/^\s*fig(?:ura)?\.?\s*\d/i.test(b.figura.titulo)
        ? [`Quita «Figura N» del pie de la figura del bloque ${i + 1}: el número lo pone el documento.`]
        : []),
    ];
  });
}

function problemasDeForma(e: ApartadoEnviado): string[] {
  const flojos = e.compromisos.filter((x) => !x.quien.trim() || !x.cuando_o_medida.trim()).map((x) => x.que);
  const sinParrafos = e.bloques.every((b) => !b.parrafos.length);
  return [
    ...(flojos.length
      ? [`Cada compromiso necesita quién lo asume y cuándo o con qué medida: ${comillas(flojos)}.`]
      : []),
    ...(sinParrafos
      ? [
          'El apartado no tiene ningún párrafo: la rúbrica se responde con texto redactado, no solo con listas o tablas.',
        ]
      : []),
    ...problemasDeFiguras(e),
  ];
}

export type RevisionApartado = { duros: string[]; blandos: string[] };

/**
 * Lo que no se acepta de un apartado. Duros, las fugas: excluyen la oferta y nunca entran con
 * avisos. Blandos, en orden: los ecos (sospechas de fuga, que al dar la memoria por buena piden
 * motivo), título, cobertura, contenido, extensión, tono y forma. Un exceso de más de un 30 % sobre
 * la cuota también es duro, pero solo con `excesoDuroActivo`, para cuotas que ya descuentan la tabla guía.
 */
export function revisarApartado(e: ApartadoEnviado, c: ContextoApartado, excesoDuroActivo = false): RevisionApartado {
  const fugas = fugasDeApartado(e, c);
  const largo = problemaDeExtension(e, c);
  const excesoDuro =
    excesoDuroActivo &&
    largo !== null &&
    c.cuota !== null &&
    caracteresDe(e.bloques) > c.cuota.caracteres * EXCESO_DURO;
  const blandos = [
    mensajeDeEcos(fugas),
    problemaDeTitulo(e, c),
    ...problemasDeCubre(e, c),
    ...problemasDeContenido(e),
    excesoDuro ? null : largo,
    problemaDeTono(e),
    problemaDeAplazamientos(e),
    problemaDeRatificaciones(e),
    problemaDeTelegrafia(e),
    ...problemasDeForma(e),
    ...problemasDeMockup(e, c),
  ];
  return {
    duros: [...mensajesDeFugas(fugas), ...(excesoDuro && largo !== null ? [largo] : [])],
    blandos: blandos.filter((p): p is string => p !== null),
  };
}

/** Todo lo que no se acepta de un apartado: primero las fugas, luego lo demás. */
export function problemasDeApartado(e: ApartadoEnviado, c: ContextoApartado): string[] {
  const r = revisarApartado(e, c);
  return [...r.duros, ...r.blandos];
}
