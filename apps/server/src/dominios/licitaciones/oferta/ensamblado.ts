// Ensamblado de la memoria técnica: compone el documento con los apartados recibidos y lo deja como borrador.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { leerPerfilEmpresa, municipioDe, type PerfilEmpresaData } from '../../../nucleo/empresa.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import {
  estimarPaginas,
  memoriaAMarkdown,
  sinNumeracion,
  tituloBloque,
  type Apartado,
  type Firma,
  type Formato,
  type Guia,
  type Imagen,
  type Memoria,
} from '../../../nucleo/documentos/docx.js';
import { generarMemoriaCompleta, type MemoriaGenerada } from '../../../nucleo/documentos/paginas.js';
import { etiquetaLote, lotesDeLicitacion } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import { pedirEvaluacionDeMemoria } from '../propuestas/evaluacion.js';
import { avisoDescartadas, descartarVersionesSinRevisar } from '../propuestas/revision.js';
import { decisionesDe } from './decisiones.js';
import { estrategiaDe, type EstrategiaLeidaData } from './estrategia.js';
import { avisosDeFugas, contextoFugasDe, datosDeFila, fugasDeApartados } from './fugasMemoria.js';
import { guionPorId, guionVigente, type GuionBaseData, type GuionGuardado } from './guion.js';
import { memoriaValorable } from './guionRevision.js';
import { ApartadoDatos, MAX_FILAS_GUIA, paginasDeGuia } from './memoriaRevision.js';
import { apelmazado } from './telegrafia.js';

// Con todos los apartados de una versión recibidos (o fallidos), compone el documento con la estructura literal del guion
// (portada, índice, «N. Título» de cada apartado y, si el pliego lo pide, el cierre con lugar,
// fecha y firma), lo genera en .docx (+ PDF y páginas
// reales si hay LibreOffice: nucleo/documentos) y lo deja en Salidas como
// memoria-vN.{docx,pdf,md,json}, registrado como borrador pendiente («origen» ensamblado)
// para que una persona lo acepte o lo descarte. Hermes no escribe archivos. Cada memoria
// ensamblada se evalúa sola (licitaciones.evaluar con la escala del guion) para poder mejorarla,
// salvo si el pliego no la puntúa (memoria no valorable): no hay nota que sacar.

const log = logger('licitaciones');
// El documento sale en .docx, PDF y .md en Salidas, y queda como borrador pendiente.
export const SIN_REDACTAR =
  '[Apartado sin redactar: el trabajo de IA falló tres veces. Redáctalo a mano o pide la memoria otra vez.]';

type EstadoMemoriaFila = 'redactando' | 'ensamblando' | 'ensamblada' | 'fallida';
export type FilaMemoria = {
  id: number;
  licitacion_id: string;
  guion_id: number;
  version: number;
  estado: EstadoMemoriaFila;
  pedida_en: string;
  ensamblada_en: string | null;
  borrador_id: number | null;
  avisos: string;
  error: string | null;
  version_base: number | null;
  apartados_rehechos: string | null;
  indicaciones?: string | null;
  subida?: string | null;
  notas_subida?: string | null;
  // JSON (AnulacionFugas): quien la dio por buena con fugas detectadas y por qué.
  anulacion_fugas?: string | null;
  // Fase (avanceMemoria.ts; null en una versión subida a mano o montada por el método anterior a las
  // fases), ronda y hallazgos de coherencia (JSON).
  fase: string | null;
  ronda: number;
  coherencia: string;
  // 1: memoria de ensayo, pedida con el plazo vencido para medirla; no es la de la oferta.
  ensayo: number;
  // De qué lote es si el pliego pide una memoria por lote (memoriaLote.ts); null = común.
  lote: string | null;
  // 1: la que se entregó, subida tal cual (memoriaPresentada.ts); 2: presentada que otra sustituyó.
  presentada: number;
  // 1: subida a mano sin los títulos del guion, guardada entera (subidaFlexible.ts).
  sin_repartir?: number;
  // 1: no la pidió una persona (un agente con licitaciones_pedir o la cadena sola): sus fases no
  // levantan el freno de su tipo.
  por_agente?: number;
  // 1: versión para mejorar los apartados elegidos (mejoraMemoria.ts); 0: por un cambio tardío.
  mejora?: number;
  // Por qué pidió Hermes la versión (licitaciones_pedir): contexto, no indicaciones de la persona.
  motivo_agente?: string | null;
  // Ensamblados seguidos que cortó un reinicio (liberarEnsamblados); 0 al acabar bien o mal.
  cortes_ensamblado?: number;
};
export type FilaApartado = {
  memoria_id: number;
  apartado: number;
  estado: 'pendiente' | 'recibido' | 'fallido';
  datos: string | null;
  caracteres: number | null;
  paginas_estimadas: number | null;
  avisos: string;
  rechazos: number;
  trabajo_id: number | null;
  agente: string | null;
  recibido_en: string | null;
  error: string | null;
  ronda: number;
};
type Licitacion = { id: string; expediente: string; titulo: string; organo_nombre: string };
// guia: páginas de la tabla guía, que cuentan para el límite pero no salen en doc.paginas.
type Compuesta = {
  memoria: Memoria;
  avisos: string[];
  apartados: FilaApartado[];
  limite: number | null;
  guion: GuionGuardado;
  guia: number;
};
// descartadas: las versiones sin revisar que la nueva dejó atrás.
export type Ensamblada = {
  memoria: number;
  version: number;
  borrador: number;
  ruta: string;
  paginas: number | null;
  paginas_estimadas: number;
  avisos: string[];
  descartadas: number[];
};

// Memorias que este proceso está montando: una «ensamblando» que no está aquí se quedó a
// medias por un reinicio.
const montando = new Set<number>();

export function filaMemoria(db: Db, memoriaId: number): FilaMemoria | null {
  return (db.prepare('SELECT * FROM memorias WHERE id = ?').get(memoriaId) as FilaMemoria | undefined) ?? null;
}

/** Los apartados que una versión rehízo sobre su base (apartados_rehechos); [] si no lo dice o no se lee. */
export function rehechosDe(m: Pick<FilaMemoria, 'apartados_rehechos'>): number[] {
  try {
    const r: unknown = JSON.parse(m.apartados_rehechos ?? '[]');
    return Array.isArray(r) ? r.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/**
 * Lo único que puede reescribir una ronda de una memoria que sale de otra («Actualizar», actualizarMemoria.ts):
 * lo que dependía del cambio. El resto se copió palabra por palabra de la base. null = sin límite.
 */
export const soloRehechos = (m: Pick<FilaMemoria, 'version_base' | 'apartados_rehechos' | 'fase'>): number[] | null =>
  m.fase !== null && m.version_base !== null ? rehechosDe(m) : null;

/** ¿Es de ensayo (pedida con el plazo vencido para medirla contra la presentada)? Para lo que solo lleva su id. */
export function memoriaDeEnsayo(db: Db, memoriaId: unknown): boolean {
  return (
    typeof memoriaId === 'number' &&
    db.prepare('SELECT 1 FROM memorias WHERE id = ? AND ensayo = 1').get(memoriaId) !== undefined
  );
}

export function apartadosDe(db: Db, memoriaId: number): FilaApartado[] {
  return db
    .prepare('SELECT * FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(memoriaId) as FilaApartado[];
}

// Lo que se conserva sigue siendo el mismo texto: lleva sus dependencias y si lo editó una persona.
export function copiarApartado(db: Db, f: FilaApartado, memoria: number, version: number, cuando: string): void {
  db.prepare(
    `INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, avisos, agente, recibido_en, dependencias, editado)
    SELECT ?, apartado, 'recibido', datos, caracteres, paginas_estimadas, avisos, ?, ?, dependencias, editado FROM memoria_apartados WHERE memoria_id = ? AND apartado = ?`,
  ).run(memoria, `copiado-v${version}`, cuando, f.memoria_id, f.apartado);
}

const FECHA = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
});
const entre = (n: number | undefined, min: number, max: number) =>
  n === undefined ? undefined : Math.min(max, Math.max(min, n));

// El formato del pliego, dentro de lo que el generador sabe maquetar.
function formatoDelGuion(g: GuionGuardado): Formato {
  const f = g.datos.memoria?.formato;
  const tamano = entre(f?.tamano_letra, 8, 14);
  const interlineado = entre(f?.interlineado, 1, 2);
  return {
    ...(f?.fuente ? { fuente: f.fuente } : {}),
    ...(tamano ? { tamano } : {}),
    ...(interlineado ? { interlineado } : {}),
  };
}

/** Los lotes de la portada: los decididos o, en una memoria de un lote (memoriaLote.ts), solo el suyo. */
export function lotesDePortada(db: Db, id: string, lote: string | null = null): string[] {
  const elegidos = lote !== null ? [lote] : (decisionesDe(db, id)?.datos.lotes ?? []);
  const lotes = lotesDeLicitacion(db, id)?.lotes ?? [];
  return elegidos.map((l) => etiquetaLote(l, lotes.find((x) => x.id === l)?.nombre));
}

export const AVISO_SIN_PERFIL =
  'Falta el perfil de la empresa (Ajustes › Empresa): la portada va sin NIF ni domicilio.';
export const PREFIJO_AVISO_FIRMA = 'El pliego pide «Lugar, fecha y firma del proponente»';
const PREFIJO_AVISO_LARGO = 'Bloquea la entrega. La memoria ocupa';

function licitadora(perfil: PerfilEmpresaData | undefined): {
  datos: Memoria['portada']['licitadora'];
  aviso: string | null;
} {
  if (!perfil) return { datos: { nombre: 'Empresa sin indicar', nif: 'NIF sin indicar' }, aviso: AVISO_SIN_PERFIL };
  return {
    datos: { nombre: perfil.nombre, nif: perfil.nif, ...(perfil.domicilio ? { domicilio: perfil.domicilio } : {}) },
    aviso: null,
  };
}

type MemoriaDelGuion = NonNullable<GuionBaseData['memoria']>;

// Algunos modelos de memoria terminan en «Lugar, fecha y firma del proponente»: el guion lo
// trae en el formato (o en sus advertencias o el detalle del límite) y la memoria cierra con
// ese bloque.
const LUGAR_FECHA_FIRMA = /lugar\s*,?\s*(?:y\s+)?fecha\s*,?\s*y\s+firma/i;

export function pideFirmaFinal(g: MemoriaDelGuion): boolean {
  return [g.formato?.otros, g.limite_detalle, ...g.advertencias].some(
    (t) => t !== undefined && LUGAR_FECHA_FIRMA.test(t),
  );
}

// Firma el representante del perfil, el mismo de los anexos; lo que no se sabe queda en blanco
// y se avisa para escribirlo en el Word antes de firmar.
function firmaFinal(
  g: MemoriaDelGuion,
  perfil: PerfilEmpresaData | undefined,
  base: Pick<Firma, 'fecha' | 'empresa'>,
): { firma: Firma; aviso: string | null } | null {
  if (!pideFirmaFinal(g)) return null;
  const lugar = municipioDe(perfil?.domicilio);
  const rep = perfil?.representante;
  const firma: Firma = {
    ...base,
    ...(lugar ? { lugar } : {}),
    ...(rep ? { firmante: rep.nombre, ...(rep.cargo ? { cargo: rep.cargo } : {}) } : {}),
  };
  const falta = [
    lugar ? null : 'el lugar (el domicilio del perfil no trae código postal y municipio)',
    rep ? null : 'quién firma (el perfil no tiene representante)',
  ].filter((f): f is string => f !== null);
  return {
    firma,
    aviso: falta.length
      ? `${PREFIJO_AVISO_FIRMA} al final de la memoria: escribe en el Word ${falta.join(' y ')} antes de firmar.`
      : null,
  };
}

// Los bytes de una imagen de una versión subida a mano, desde Salidas; sin ellos, el documento
// deja una marca visible en su sitio.
function conDatos(raices: Raices, i: Imagen): Imagen {
  const abs = documentoEnDisco(raices, i.ruta);
  if (abs.error || !fs.existsSync(abs.data)) return i;
  return { ...i, datos: fs.readFileSync(abs.data), tipo: /\.jpe?g$/i.test(i.ruta) ? 'jpg' : 'png' };
}

function apartadoCompuesto(
  numero: number,
  titulo: string,
  fila: FilaApartado | undefined,
  raices: Raices | null,
): Apartado {
  const datos = fila?.estado === 'recibido' && fila.datos ? ApartadoDatos.safeParse(JSON.parse(fila.datos)) : null;
  if (!datos?.success) return { numero: String(numero), titulo, bloques: [{ parrafos: [SIN_REDACTAR] }] };
  const bloques = datos.data.bloques.map((b) => ({
    parrafos: b.parrafos,
    ...(b.subtitulo ? { subtitulo: b.subtitulo } : {}),
    ...(b.lista ? { lista: b.lista } : {}),
    ...(b.tabla ? { tabla: b.tabla } : {}),
    ...(b.lista_numerada ? { lista_numerada: b.lista_numerada } : {}),
    ...(b.apaisado ? { apaisado: true } : {}),
    ...(b.figura ? { figura: b.figura } : {}),
    ...(b.imagen ? { imagen: raices ? conDatos(raices, b.imagen) : b.imagen } : {}),
  }));
  return { numero: String(numero), titulo, bloques };
}

// La memoria abre con «Cómo se responde a cada criterio»: una fila por «se valorará», con el número
// real del bloque del cuerpo que lo trata («2.3 Plan de formación», como lo numera docx.ts) y la
// evidencia, sacados del mapa de su estrategia (por código, no lo escribe Hermes). Las cuotas
// le reservan sus páginas (paginasDeGuia). Nunca repite «N. Título» (como el índice y el
// cuerpo) para que localizarApartados no tome la guía por el principio del cuerpo.
const claveSeccion = (t: string) =>
  textoComparable(sinNumeracion(t))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const casan = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a)));

// Los subtítulos de un apartado recibido con su número en el cuerpo.
function bloquesNumerados(numero: number, fila: FilaApartado | undefined): { clave: string; titulo: string }[] {
  const subtitulos = (datosDeFila(fila)?.bloques ?? []).flatMap((b) => (b.subtitulo ? [b.subtitulo] : []));
  return subtitulos.map((s, i) => ({ clave: claveSeccion(s), titulo: tituloBloque(String(numero), i + 1, s) }));
}

function dondeSeTrata(x: { apartado: number; seccion: string }, bloques: { clave: string; titulo: string }[]): string {
  const clave = claveSeccion(x.seccion);
  return bloques.find((b) => casan(b.clave, clave))?.titulo ?? `Apartado ${x.apartado}`;
}

// La reserva de páginas de la guía (paginasDeGuia) se calcula antes de que haya estrategia, con
// filas de altura fija: una evidencia de 1.000 caracteres, o varias concatenadas, la triplicaba
// y la memoria se pasaba del límite con cada apartado dentro de su cuota. El detalle está en el
// cuerpo; aquí, una pista corta por «se valorará» (un criterio con varios, hasta 3 pistas).
const EVIDENCIA_GUIA = 160;
const PISTAS_POR_FILA = 3;

// Una versión mandó la evidencia sin espacios («Figura2perfiles», «4roles,dedicación», «funcionalETC3»)
// y la tabla salía ilegible. La estrategia ya la rechaza (apelmazado); lo que pase igualmente se
// separa aquí: tras una coma o un punto y coma y antes de una sigla pegada a una minúscula
// («modelosS2»), siempre; entre palabra y cifra, solo si el texto va apelmazado (en una evidencia
// legible, «base64», «python3» o «word2vec» son nombres y se quedan). Solo añade espacios, nunca
// los quita: «24h», «S2» o «SharePoint» quedan como están.
export function legible(t: string): string {
  const siempre = t.replace(/([,;])(?=\p{L})/gu, '$1 ').replace(/(\p{Ll}{4})(?=\p{Lu}[\p{Lu}\d])/gu, '$1 ');
  const separado = apelmazado(t)
    ? siempre.replace(/(\p{Ll}{4})(?=\d)/gu, '$1 ').replace(/(\d)(?=\p{Ll}{3})/gu, '$1 ')
    : siempre;
  return separado.replace(/\s+/g, ' ').trim();
}

// Lo que ni separado se lee («yexclusiónintegraciónfuncional», «yFIP/IIP/IEP07/10p.2.») no va a
// la tabla de la mesa: la estrategia lo acepta con aviso al tercer envío, y en la celda se dice
// dónde está el detalle. Una palabra española no llega a 22 letras seguidas; y en lo que venía
// apelmazado, un retazo de 4 trozos o más unidos por barras o guiones («I-C-008pp.4-5») o una
// conjunción pegada a una sigla («yFIP») tampoco se lee.
const PALABRAS_PEGADAS = /\p{L}{22,}/u;
const CONJUNCION_PEGADA = /^[yeo]\p{Lu}/u;
const retazo = (token: string): boolean =>
  CONJUNCION_PEGADA.test(token) || token.split(/[/\-.;,]+/).filter(Boolean).length >= 4;
const ilegible = (original: string, separado: string): boolean =>
  apelmazado(separado) ||
  PALABRAS_PEGADAS.test(separado) ||
  (apelmazado(original) && separado.split(/\s+/).some(retazo));
export const SIN_EVIDENCIA_LEGIBLE = 'El detalle está en la sección indicada.';

// Cada pista, sin su puntuación final, separada de la siguiente por «; »: unidas con un espacio,
// las que el modelo escribe sin punto se leían como una sola frase.
const pista = (t: string) => t.trim().replace(/[\s.;,:]+$/u, '');

/** La evidencia de una fila de la guía, legible y en una pista de como mucho `tope` caracteres (con elipsis si se corta). */
export function evidenciaDeGuia(evidencias: string[], tope = EVIDENCIA_GUIA): string {
  const legibles = evidencias
    .flatMap((e) => {
      const l = legible(e);
      return l && !ilegible(e, l) ? [pista(l)] : [];
    })
    .filter(Boolean);
  if (!legibles.length) return SIN_EVIDENCIA_LEGIBLE;
  const t = `${legibles.join('; ')}.`;
  if (t.length <= tope) return t;
  const corte = t.lastIndexOf(' ', tope - 1);
  return `${t.slice(0, corte > tope / 2 ? corte : tope - 1).replace(/[\s,;:.]+$/, '')}…`;
}

// El pliego trocea a veces una sola frase («se valorará el diseño funcional: la solución concreta
// ofertada, sus mecanismos de ejecución, entregables…») y el guion la guarda trozo a trozo. Una
// fila por trozo daba filas que no se entienden solas («entregables», «la solución concreta
// ofertada»): un trozo en minúscula que empieza por artículo o posesivo, o de 1 o 2 palabras, va
// en la fila del criterio que lo precede en su apartado, si ese criterio es un encabezado (empieza
// en mayúscula). «Se valorará la metodología…, el plan de calidad…, la organización…» se guarda
// todo en minúscula: son criterios autónomos y cada uno lleva su fila.
const DETERMINANTE = /^(?:el|la|los|las|lo|un|una|unos|unas|su|sus|este|esta|estos|estas|cada|otros?|otras?)\s/u;
export function esFragmento(item: string): boolean {
  const t = item.trim();
  return /^\p{Ll}/u.test(t) && (DETERMINANTE.test(t) || t.split(/\s+/).length <= 2);
}
const encabeza = (item: string): boolean => /^\p{Lu}/u.test(item.trim());

export type EntradaGuia = { apartado: number; item: string; donde: string; evidencia: string };
type EstrategiaMapa = EstrategiaLeidaData['mapa'];
type FilaGuia = {
  apartado: number;
  clave: string;
  item: string;
  fragmentos: string[];
  donde: string[];
  evidencia: string[];
};

const anadir = (xs: string[], x: string) => {
  if (!xs.includes(x)) xs.push(x);
};
const enumeracion = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
const sinPuntoFinal = (t: string) => t.trim().replace(/[\s.;,:]+$/u, '');

// Un trozo va a la fila de su encabezado, la anterior en el orden del guion: con el mismo trozo
// en dos criterios del apartado («entregables»), buscarlo en cualquier fila lo pegaba al primero.
function filaDe(filas: FilaGuia[], x: EntradaGuia): FilaGuia {
  const clave = claveSeccion(x.item);
  const previa = filas.at(-1);
  if (esFragmento(x.item) && previa?.apartado === x.apartado && encabeza(previa.item)) {
    if (!previa.fragmentos.some((t) => claveSeccion(t) === clave)) previa.fragmentos.push(x.item);
    return previa;
  }
  const igual = filas.find((f) => f.apartado === x.apartado && f.clave === clave);
  if (igual) return igual;
  const nueva = { apartado: x.apartado, clave, item: x.item, fragmentos: [], donde: [], evidencia: [] };
  filas.push(nueva);
  return nueva;
}

/**
 * Las filas de «Cómo se responde a cada criterio»: una por criterio del pliego, con sus trozos sueltos
 * dentro («Diseño funcional: la solución concreta ofertada y entregables»), dónde se trata y la
 * evidencia legible. Las entradas, en el orden del guion.
 */
export function filasDeGuia(entradas: EntradaGuia[]): string[][] {
  const filas: FilaGuia[] = [];
  for (const x of entradas) {
    const f = filaDe(filas, x);
    anadir(f.donde, x.donde);
    anadir(f.evidencia, x.evidencia);
  }
  return filas
    .slice(0, MAX_FILAS_GUIA)
    .map((f) => [
      f.fragmentos.length ? `${sinPuntoFinal(f.item)}: ${enumeracion(f.fragmentos.map(sinPuntoFinal))}` : f.item,
      f.donde.join('; '),
      evidenciaDeGuia(f.evidencia, EVIDENCIA_GUIA * Math.min(f.evidencia.length, PISTAS_POR_FILA)),
    ]);
}

// El mapa en el orden del guion (cada «se valorará» en su sitio): los trozos van tras su criterio
// aunque la estrategia los mande en otro orden. Lo que no casa con ninguno, al final del apartado.
// Un trozo repetido en el apartado («entregables» tras dos criterios): la k-ésima entrada del mapa
// va a la k-ésima vez que sale en el guion (las de más, a la última), no todas a la primera.
function posicionesDelMapa(mapa: EstrategiaMapa, g: MemoriaDelGuion): number[] {
  const vistas = new Map<string, number>();
  return mapa.map((x) => {
    const clave = claveSeccion(x.item);
    const veces = (g.apartados[x.apartado - 1]?.se_valorara ?? []).flatMap((s, i) =>
      claveSeccion(s) === clave ? [i] : [],
    );
    const k = vistas.get(`${x.apartado}|${clave}`) ?? 0;
    vistas.set(`${x.apartado}|${clave}`, k + 1);
    return x.apartado * 1000 + (veces.length ? veces[Math.min(k, veces.length - 1)]! : 999);
  });
}

function entradasDeGuia(
  mapa: EstrategiaMapa,
  g: MemoriaDelGuion,
  bloques: { clave: string; titulo: string }[][],
): EntradaGuia[] {
  const posiciones = posicionesDelMapa(mapa, g);
  return mapa
    .map((x, i) => ({ x, p: posiciones[i]! }))
    .sort((a, b) => a.p - b.p)
    .map(({ x }) => x)
    .map((x) => ({
      apartado: x.apartado,
      item: x.item,
      donde: dondeSeTrata(x, bloques[x.apartado - 1] ?? []),
      evidencia: x.evidencia,
    }));
}

function guiaDe(db: Db, m: FilaMemoria, g: MemoriaDelGuion, apartados: FilaApartado[]): Guia | null {
  const e = estrategiaDe(db, m.id);
  if (!e?.datos.mapa.length) return null;
  const bloques = g.apartados.map((_, i) =>
    bloquesNumerados(
      i + 1,
      apartados.find((a) => a.apartado === i + 1),
    ),
  );
  const filas = filasDeGuia(entradasDeGuia(e.datos.mapa, g, bloques));
  return {
    titulo: 'Cómo se responde a cada criterio',
    tabla: { cabecera: ['Lo que se valora', 'Dónde se trata', 'Con qué evidencia'], filas },
  };
}

/**
 * Páginas del cuerpo con el mismo estimador que el ensamblado (líneas, listas, tablas, figuras),
 * sobre los apartados ya recibidos. No cuenta la guía: quien llama le suma la suya.
 */
export function paginasDeCuerpo(db: Db, m: FilaMemoria, g: GuionGuardado): number {
  const mem = g.datos.memoria;
  if (!mem) return 0;
  const filas = apartadosDe(db, m.id);
  const apartados = mem.apartados.map((a, i) => apartadoCompuesto(i + 1, a.titulo, filas[i], null));
  return estimarPaginas({ formato: formatoDelGuion(g), apartados }).paginas;
}

/** Cabe entero o se corta en el último espacio antes del límite y acaba en «…»: nunca a media palabra. */
export function recortarPorPalabra(t: string, max: number): string {
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > 0 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

// El título del pliego manda sobre el nombre del archivo: si juntos no caben, se prescinde del archivo.
export const subtituloDePortada = (archivo: string, titulo: string) =>
  recortarPorPalabra(`${archivo} · ${titulo}`.length <= 300 ? `${archivo} · ${titulo}` : titulo, 300);

// Sin raíces (la lectura del crítico), las imágenes subidas a mano van sin sus bytes: en el
// Markdown solo sale su pie.
// `datos`: el texto de algunos apartados en lugar del actual (la versión anterior de una ronda,
// para que el crítico por pares la vea como la verá la mesa).
function componer(
  db: Db,
  m: FilaMemoria,
  hoy: Date,
  raices: Raices | null,
  datos?: ReadonlyMap<number, string>,
): Result<Compuesta> {
  const l = db
    .prepare('SELECT id, expediente, titulo, organo_nombre FROM licitaciones WHERE id = ?')
    .get(m.licitacion_id) as Licitacion | undefined;
  const guion = guionPorId(db, m.guion_id);
  if (!l || !guion?.datos.memoria)
    return fail('not_found', 'La licitación o su guion ya no están: no se puede componer la memoria.');
  const g = guion.datos.memoria;
  const apartados = apartadosDe(db, m.id).map((f) =>
    datos?.has(f.apartado) ? { ...f, estado: 'recibido' as const, datos: datos.get(f.apartado)! } : f,
  );
  const perfil = leerPerfilEmpresa(db)?.perfil;
  const empresa = licitadora(perfil);
  const lotes = lotesDePortada(db, l.id, m.lote ?? null);
  const fecha = FECHA.format(hoy);
  const cierre = firmaFinal(g, perfil, { fecha, empresa: empresa.datos.nombre });
  const guia = guiaDe(db, m, g, apartados);
  const memoria: Memoria = {
    portada: {
      titulo: g.titulo_documento,
      subtitulo: subtituloDePortada(g.archivo, l.titulo),
      expediente: l.expediente,
      organo: l.organo_nombre.slice(0, 300),
      licitadora: empresa.datos,
      fecha,
      ...(lotes.length ? { lotes } : {}),
    },
    formato: formatoDelGuion(guion),
    apartados: g.apartados.map((a, i) => apartadoCompuesto(i + 1, a.titulo, apartados[i], raices)),
    pie: { texto: recortarPorPalabra(`${g.titulo_documento} · Expediente ${l.expediente}`, 200), numeracion: true },
    ...(cierre ? { firma: cierre.firma } : {}),
    ...(guia ? { guia } : {}),
  };
  const sinRedactar = g.apartados.flatMap((_, i) =>
    apartados[i]?.estado === 'recibido' ? [] : [`El apartado ${i + 1} no se redactó.`],
  );
  const avisos = [empresa.aviso, cierre?.aviso ?? null, ...sinRedactar].filter((a): a is string => a !== null);
  return ok({ memoria, avisos, apartados, limite: g.limite_paginas, guion, guia: guia ? paginasDeGuia(g) : 0 });
}

// El documento entero, también lo que no pasó por la revisión de cada apartado (los que una
// mejora copia de la versión anterior, o los que entraron antes de fijar las decisiones).
function avisosDeFugasDelDocumento(db: Db, c: Compuesta, m: FilaMemoria): string[] {
  const fugas = fugasDeApartados(
    c.guion,
    c.guion.datos.memoria!.apartados.map((_, i) => datosDeFila(c.apartados[i])),
    contextoFugasDe(db, c.guion),
  );
  if (fugas.length)
    log.warn('memoria con fugas entre sobres', { memoria: m.id, version: m.version, fugas: fugas.length });
  return avisosDeFugas(fugas);
}

function avisosDelDocumento(db: Db, c: Compuesta, m: FilaMemoria, doc: MemoriaGenerada): string[] {
  const ocupa = (doc.paginas ?? Math.ceil(doc.paginas_estimadas)) + c.guia;
  const sobra = c.limite !== null && ocupa > c.limite;
  const largo = !sobra
    ? null
    : doc.paginas !== null
      ? `${PREFIJO_AVISO_LARGO} ${ocupa} páginas y el pliego limita a ${c.limite}.`
      : `${PREFIJO_AVISO_LARGO} unas ${ocupa} páginas (estimadas) y el pliego limita a ${c.limite}.`;
  const vigente = guionVigente(db, m.licitacion_id);
  const cambio =
    vigente && vigente.id !== m.guion_id
      ? `El guion cambió a la v${vigente.version} mientras se redactaba con la v${c.guion.version}.`
      : null;
  // Los de la memoria al ensamblar: las rondas, las regresiones y la coherencia.
  // Al volver a montar, los previos ya traen los del documento anterior: sin repetirlos.
  const previos = JSON.parse(m.avisos) as string[];
  return [
    ...new Set(
      [...previos, ...avisosDeFugasDelDocumento(db, c, m), largo, cambio, ...c.avisos, doc.aviso].filter(
        (a): a is string => a !== null,
      ),
    ),
  ];
}

/**
 * El documento tal como quedaría al ensamblarlo ahora (portada, índice, guía, numeración y el
 * contenido de las figuras), en Markdown: lo que lee el crítico ciego. Null si no se puede componer.
 */
export function documentoEnMarkdown(
  db: Db,
  memoriaId: number,
  hoy = new Date(),
  datos?: ReadonlyMap<number, string>,
): string | null {
  const m = filaMemoria(db, memoriaId);
  const c = m ? componer(db, m, hoy, null, datos) : null;
  return c?.data ? memoriaAMarkdown(c.data.memoria) : null;
}

const EXTENSIONES = ['.docx', '.pdf', '.md', '.json'] as const;
export type Archivos = { docx: Buffer; pdf: Buffer | null; md: string; json: string };
type Rutas = { ruta: string; ruta_pdf: string | null; ruta_md: string; ruta_json: string };

// memoria-vN o, si ya hay algo con ese nombre (p. ej. de una base anterior), memoria-vN-2…
// Una de ensayo lleva «-ensayo» (memoria-vN-ensayo): junto a la presentada, sin confundirse
// con ella ni pasar por la memoria de la oferta (documentos.ts solo reconoce memoria-vN).
export function nombreLibre(dir: string, version: number, sufijo: string): string {
  for (let k = 1; ; k += 1) {
    const base = k === 1 ? `memoria-v${version}${sufijo}` : `memoria-v${version}${sufijo}-${k}`;
    if (!EXTENSIONES.some((ext) => fs.existsSync(path.join(dir, base + ext)))) return base;
  }
}

// «wx»: nunca se pisa un documento que ya esté en Salidas (alguien pudo editarlo en Drive).
export function escribir(raices: Raices, carpeta: string, version: number, a: Archivos, sufijo = ''): Result<Rutas> {
  const dir = documentoEnDisco(raices, carpeta);
  if (dir.error) return dir;
  fs.mkdirSync(dir.data, { recursive: true });
  const base = nombreLibre(dir.data, version, sufijo);
  const poner = (ext: string, contenido: Buffer | string) => {
    fs.writeFileSync(path.join(dir.data, base + ext), contenido, { flag: 'wx' });
    return `${carpeta}/${base}${ext}`;
  };
  const ruta = poner('.docx', a.docx);
  const ruta_pdf = a.pdf ? poner('.pdf', a.pdf) : null;
  return ok({ ruta, ruta_pdf, ruta_md: poner('.md', a.md), ruta_json: poner('.json', a.json) });
}

function resumenApartados(
  c: Compuesta,
): { apartado: number; titulo: string; estado: string; caracteres: number | null; paginas_estimadas: number | null }[] {
  return c.memoria.apartados.map((a, i) => {
    const f = c.apartados[i];
    return {
      apartado: i + 1,
      titulo: a.titulo,
      estado: f?.estado ?? 'pendiente',
      caracteres: f?.caracteres ?? null,
      paginas_estimadas: f?.paginas_estimadas ?? null,
    };
  });
}

type Cierre = { c: Compuesta; doc: MemoriaGenerada; rutas: Rutas; avisos: string[] };
// remontar: volver a montar una ya ensamblada sin IA (portada y firma con el perfil de ahora).
type Modo = { remontar: boolean };
const NORMAL: Modo = { remontar: false };

function registrarBorrador(db: Db, m: FilaMemoria, r: Cierre): number {
  const { c, doc, rutas } = r;
  const sha = crypto.createHash('sha256').update(doc.docx).digest('hex');
  const recibidos = c.apartados.filter((a) => a.estado === 'recibido').length;
  const paginas = doc.paginas ?? Math.ceil(doc.paginas_estimadas);
  const resumen = `Memoria técnica v${m.version}${m.ensayo ? ' (ensayo, no presentada)' : ''}: ${recibidos} de ${c.memoria.apartados.length} apartados redactados, ${paginas} páginas${doc.paginas === null ? ' estimadas' : ''}.`;
  return Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, memoria_id,
      apartados_json, paginas_estimadas, paginas, ruta_pdf, ruta_md, ruta_json)
    VALUES (?, ?, ?, ?, ?, 'plataforma', ?, 'ensamblado', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.licitacion_id,
        rutas.ruta,
        sha,
        doc.docx.length,
        resumen,
        new Date().toISOString(),
        m.guion_id,
        m.version,
        m.id,
        JSON.stringify(resumenApartados(c)),
        doc.paginas_estimadas,
        doc.paginas,
        rutas.ruta_pdf,
        rutas.ruta_md,
        rutas.ruta_json,
      ).lastInsertRowid,
  );
}

// Si falla al volver a montarla, la memoria sigue ensamblada con su documento de antes.
function fallarRemontado(db: Db, m: FilaMemoria, error: string): Result<never> {
  db.prepare(
    "UPDATE memorias SET estado = 'ensamblada', cortes_ensamblado = 0 WHERE id = ? AND estado = 'ensamblando'",
  ).run(m.id);
  log.error('memoria sin volver a montar', { memoria: m.id, version: m.version });
  return fail('io_error', error);
}

const fallarSegun = (modo: Modo) => (modo.remontar ? fallarRemontado : fallar);

function fallar(db: Db, m: FilaMemoria, error: string): Result<never> {
  db.prepare("UPDATE memorias SET estado = 'fallida', error = ?, cortes_ensamblado = 0 WHERE id = ?").run(error, m.id);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: m.licitacion_id,
    datos: { accion: 'fallida', version: m.version },
  });
  log.error('memoria sin ensamblar', { memoria: m.id, version: m.version });
  return fail('io_error', error);
}

// El documento vuelto a montar hereda la revisión del anterior de su versión, que queda
// descartado: si estaba dada por buena lo sigue estando (el paquete se desfasa por su huella).
function heredarRevision(db: Db, m: FilaMemoria, nuevo: number): void {
  const previo = db.prepare('SELECT estado FROM borradores WHERE id = ?').get(m.borrador_id) as
    { estado: string } | undefined;
  const ts = new Date().toISOString();
  if (previo && previo.estado !== 'pendiente')
    db.prepare('UPDATE borradores SET estado = ?, revisado_en = ? WHERE id = ?').run(previo.estado, ts, nuevo);
  db.prepare(
    "UPDATE borradores SET estado = 'descartada', revisado_en = ? WHERE id = ? AND estado <> 'descartada'",
  ).run(ts, m.borrador_id);
}

type Cerrada = { borrador: number; avisos: string[]; descartadas: number[] };

// Lo que deja atrás la versión nueva: el anterior de su versión al volver a montarla o, si
// no, las que nadie revisó. Una de ensayo no deja atrás a la de la oferta.
function dejarAtras(db: Db, m: FilaMemoria, b: number, modo: Modo): number[] {
  if (modo.remontar) {
    heredarRevision(db, m, b);
    return [];
  }
  return m.ensayo ? [] : descartarVersionesSinRevisar(db, m.licitacion_id, b, m.version);
}

// El borrador y la memoria ensamblada van juntos: uno sin la otra dejaría la web sin enlace.
// Las versiones que se descartan quedan dichas en los avisos de la nueva.
function cerrar(db: Db, m: FilaMemoria, r: Cierre, modo: Modo): Cerrada {
  const cerrada = db.transaction((): Cerrada => {
    const borrador = registrarBorrador(db, m, r);
    const descartadas = dejarAtras(db, m, borrador, modo);
    const dicho = avisoDescartadas(m.version, descartadas);
    const avisos = dicho ? [...r.avisos, dicho] : r.avisos;
    db.prepare(
      "UPDATE memorias SET estado = 'ensamblada', ensamblada_en = ?, borrador_id = ?, avisos = ?, error = NULL, cortes_ensamblado = 0 WHERE id = ?",
    ).run(new Date().toISOString(), borrador, JSON.stringify(avisos), m.id);
    return { borrador, avisos, descartadas };
  })();
  const paginas = r.doc.paginas ?? r.doc.paginas_estimadas;
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: m.licitacion_id,
    datos: {
      accion: modo.remontar ? 'remontada' : 'ensamblada',
      version: m.version,
      paginas,
      avisos: cerrada.avisos.length,
      descartadas: cerrada.descartadas,
    },
  });
  emitir(db, {
    tipo: 'licitacion.borrador',
    dominio: 'licitaciones',
    recurso: m.licitacion_id,
    datos: { agente: 'plataforma', borrador: cerrada.borrador },
  });
  return cerrada;
}

async function generarYGuardar(
  db: Db,
  m: FilaMemoria,
  raices: Raices,
  hoy: Date,
  modo: Modo,
): Promise<Result<Ensamblada>> {
  const fallo = fallarSegun(modo);
  const c = componer(db, m, hoy, raices);
  if (c.error) return fallo(db, m, c.error.message);
  const doc = await generarMemoriaCompleta(c.data.memoria);
  if (!doc.docx.length) return fallo(db, m, doc.aviso ?? 'No se pudo generar el documento.');
  const conIndice: Memoria = { ...c.data.memoria, indice: doc.indice ? { paginas: doc.indice } : {} };
  // Sin los bytes de las imágenes: en el .json basta su ruta.
  // (JSON.stringify ya ha pasado el Buffer por su toJSON: llega como { type: 'Buffer', data }.)
  const sinBytes = (k: string, v: unknown) =>
    k === 'datos' && (Buffer.isBuffer(v) || (v as { type?: string } | null)?.type === 'Buffer') ? undefined : v;
  const json = JSON.stringify(
    {
      licitacion: m.licitacion_id,
      version: m.version,
      guion_id: m.guion_id,
      memoria: conIndice,
      apartados: resumenApartados(c.data),
    },
    sinBytes,
    2,
  );
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(m.licitacion_id) as {
    id: string;
    expediente: string;
  };
  const rutas = escribir(
    raices,
    carpetaSalidas(l),
    m.version,
    { docx: doc.docx, pdf: doc.pdf, md: memoriaAMarkdown(conIndice), json },
    m.ensayo ? '-ensayo' : '',
  );
  if (rutas.error) return fallo(db, m, rutas.error.message);
  const avisos = avisosDelDocumento(db, c.data, m, doc);
  const { borrador, avisos: finales, descartadas } = cerrar(db, m, { c: c.data, doc, rutas: rutas.data, avisos }, modo);
  // Volver a montar no gasta Hermes: el texto es el mismo y su evaluación sigue valiendo.
  if (!modo.remontar) autoevaluar(db, m, rutas.data.ruta);
  return ok({
    memoria: m.id,
    version: m.version,
    borrador,
    ruta: rutas.data.ruta,
    paginas: doc.paginas,
    paginas_estimadas: doc.paginas_estimadas,
    avisos: finales,
    descartadas,
  });
}

/**
 * ¿Puntúa la mesa esta memoria? Manda el guion vigente: un guion posterior puede haberla dado
 * por no valorable (o haber quitado la memoria, y entonces tampoco hay nota que sacar). Sin
 * guion vigente se mira el de la versión.
 */
export function memoriaSePuntua(db: Db, m: { licitacion_id: string; guion_id: number }): boolean {
  const vigente = guionVigente(db, m.licitacion_id);
  if (vigente) return vigente.datos.memoria ? memoriaValorable(vigente.datos.memoria) : false;
  const mem = guionPorId(db, m.guion_id)?.datos.memoria;
  return !mem || memoriaValorable(mem);
}

// La memoria ya está guardada: si no se puede encolar su evaluación, se pide a mano. Una memoria
// con fases no se autoevalúa: su última crítica ciega se guarda como evaluación (rondasMemoria.ts).
export function autoevaluar(db: Db, m: FilaMemoria, ruta: string): void {
  if (!memoriaSePuntua(db, m) || m.fase !== null) return;
  try {
    pedirEvaluacionDeMemoria(nucleo().db, db, m, ruta);
  } catch (err) {
    log.warn('autoevaluación sin encolar', {
      memoria: m.id,
      version: m.version,
      error: errorMessage(err).slice(0, 200),
    });
  }
}

// Nunca lanza: cualquier fallo deja la memoria «fallida» con su error, para reintentarla.
async function montar(db: Db, m: FilaMemoria, raices: Raices, hoy: Date, modo = NORMAL): Promise<Result<Ensamblada>> {
  montando.add(m.id);
  try {
    return await generarYGuardar(db, m, raices, hoy, modo);
  } catch (err) {
    return fallarSegun(modo)(db, m, `No se pudo guardar la memoria en Salidas: ${errorMessage(err).slice(0, 300)}`);
  } finally {
    montando.delete(m.id);
  }
}

/**
 * Pasa la memoria a «ensamblando» si toca (redactando sin apartados pendientes, o fallida):
 * la guardia en el UPDATE impide que dos ensamblen la misma.
 */
export function reservarEnsamblado(db: Db, memoriaId: number): Result<FilaMemoria> {
  const m = filaMemoria(db, memoriaId);
  if (!m) return fail('not_found', `No hay ninguna memoria con id ${memoriaId}.`);
  const pendientes = apartadosDe(db, memoriaId).filter((a) => a.estado === 'pendiente').length;
  if (m.estado === 'redactando' && pendientes)
    return fail(
      'conflicto',
      `Quedan ${pendientes} apartados por redactar: la memoria se ensambla sola al terminar su redacción.`,
    );
  // Una memoria que falló antes del fin (dossier, estrategia o redacción) no tiene nada que montar.
  if (m.fase !== null && m.fase !== 'fin' && m.estado === 'fallida')
    return fail(
      'conflicto',
      `La v${m.version} falló antes de redactarse: no hay nada que montar; empieza otra versión desde cero.`,
    );
  const r = db
    .prepare(
      "UPDATE memorias SET estado = 'ensamblando', error = NULL WHERE id = ? AND estado IN ('redactando', 'fallida')",
    )
    .run(memoriaId);
  if (r.changes === 0)
    return fail(
      'conflicto',
      m.estado === 'ensamblada'
        ? `Esa memoria ya está ensamblada (v${m.version}).`
        : 'Esa memoria ya se está ensamblando.',
    );
  return ok({ ...m, estado: 'ensamblando' });
}

/** Ensambla una memoria y espera al documento. */
export async function ensamblarMemoria(
  db: Db,
  memoriaId: number,
  raices: Raices = raicesActuales(),
  hoy = new Date(),
): Promise<Result<Ensamblada>> {
  const m = reservarEnsamblado(db, memoriaId);
  if (m.error) return m;
  return montar(db, m.data, raices, hoy);
}

/** Ensambla en segundo plano (LibreOffice tarda): responde en cuanto la memoria queda reservada. */
export function ensamblarEnFondo(
  db: Db,
  memoriaId: number,
  raices: Raices = raicesActuales(),
): Result<{ memoria: number; version: number }> {
  const m = reservarEnsamblado(db, memoriaId);
  if (m.error) return m;
  void montar(db, m.data, raices, new Date());
  return ok({ memoria: m.data.id, version: m.data.version });
}

// Los que componer vuelve a calcular con el perfil y las páginas de ahora.
const RECALCULADOS = [AVISO_SIN_PERFIL, PREFIJO_AVISO_FIRMA, PREFIJO_AVISO_LARGO];

/**
 * Pasa a «ensamblando» una versión ya ensamblada para volver a montarla. Solo frena una versión
 * del mismo lote y del mismo tipo (ensayo o no) que se esté redactando o montando, como mejorar
 * y la subida: un ensayo en curso o la memoria de otro lote no impiden montar esta.
 */
export function reservarRemontado(db: Db, id: string, version: number): Result<FilaMemoria> {
  const m = db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, version) as
    FilaMemoria | undefined;
  if (!m) return fail('not_found', `No hay memoria v${version} de esta licitación.`);
  if (m.estado !== 'ensamblada') return fail('conflicto', 'Solo se vuelve a montar una memoria ya ensamblada.');
  if (m.subida)
    return fail(
      'conflicto',
      `La v${m.version} es un Word subido a mano: corrige la portada en tu Word y súbelo otra vez.`,
    );
  const enCurso = db
    .prepare(
      `SELECT version FROM memorias WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando') AND ensayo = ? AND lote IS ? LIMIT 1`,
    )
    .get(id, m.ensayo, m.lote) as { version: number } | undefined;
  if (enCurso)
    return fail('conflicto', `La v${enCurso.version} se está redactando o montando: vuelve a montar cuando termine.`);
  const r = db.prepare("UPDATE memorias SET estado = 'ensamblando' WHERE id = ? AND estado = 'ensamblada'").run(m.id);
  if (r.changes === 0) return fail('conflicto', 'Esa memoria ya se está montando.');
  const avisos = (JSON.parse(m.avisos) as string[]).filter((a) => !RECALCULADOS.some((p) => a.startsWith(p)));
  return ok({ ...m, estado: 'ensamblando', avisos: JSON.stringify(avisos) });
}

/**
 * Vuelve a montar una versión ya ensamblada con el mismo texto y la portada y la firma del
 * perfil de empresa de ahora, sin ningún trabajo de IA. Deja memoria-vN-2.* junto a lo anterior.
 */
export async function remontarMemoria(
  db: Db,
  id: string,
  version: number,
  raices: Raices = raicesActuales(),
): Promise<Result<Ensamblada>> {
  const m = reservarRemontado(db, id, version);
  if (m.error) return m;
  return montarReservada(db, m.data, raices);
}

/** Monta sin IA una memoria que reservarRemontado ya dejó en «ensamblando». */
export function montarReservada(
  db: Db,
  m: FilaMemoria,
  raices: Raices = raicesActuales(),
): Promise<Result<Ensamblada>> {
  log.info('memoria vuelta a montar', { memoria: m.id, version: m.version });
  return montar(db, m, raices, new Date(), { remontar: true });
}

/** Deja como estaba (ensamblada, con su documento) una memoria reservada que al final no se monta. */
export function soltarRemontado(db: Db, m: FilaMemoria): void {
  db.prepare("UPDATE memorias SET estado = 'ensamblada' WHERE id = ? AND estado = 'ensamblando'").run(m.id);
}

// Solo «Volver a montar sin IA» pone en 'ensamblando' una memoria que ya tuvo documento: el
// ensamblado normal parte de 'redactando' o 'fallida', sin borrador ni fecha de ensamblado.
export const esRemontado = (m: FilaMemoria) => m.borrador_id !== null && m.ensamblada_en !== null;

/**
 * Vuelve a montar una memoria que ya está «ensamblando» (la que liberarEnsamblados devolvió para
 * reanudarla), con su lote y su modo: la cortada al volver a montarla sin IA se vuelve a montar igual.
 */
export function remontarEnsamblado(
  db: Db,
  m: FilaMemoria,
  raices: Raices = raicesActuales(),
  hoy = new Date(),
): Promise<Result<Ensamblada>> {
  return montar(db, m, raices, hoy, esRemontado(m) ? { remontar: true } : NORMAL);
}

// Un reinicio a mitad del ensamblado (cada despliegue reinicia el servidor) no es un fallo de la
// memoria: se vuelve a montar sola. Si se corta MAX_CORTES_ENSAMBLADO veces seguidas, algo la
// tumba cada vez (p. ej. LibreOffice agota la memoria del contenedor) y queda fallida para que
// una persona lo mire (la que se volvía a montar sigue ensamblada con su documento de antes).
export const MAX_CORTES_ENSAMBLADO = 3;
export const ENSAMBLADO_INTERRUMPIDO =
  'El ensamblado se interrumpió (¿se reinició el servidor?): vuelve a ensamblar la memoria.';

function rendirse(db: Db, m: FilaMemoria): void {
  if (esRemontado(m)) fallarRemontado(db, m, 'Se interrumpió al volver a montarla.');
  else fallar(db, m, ENSAMBLADO_INTERRUMPIDO);
}

/**
 * Las «ensamblando» que ningún proceso está montando (las cortó un reinicio). Cada una suma un
 * corte y sigue «ensamblando», con sus avisos, su lote su fase y su ronda: se
 * devuelve para que quien llama la vuelva a montar (remontarEnsamblado). Al corte
 * MAX_CORTES_ENSAMBLADO se rinde (rendirse) y no se devuelve.
 */
export function liberarEnsamblados(db: Db): FilaMemoria[] {
  const colgadas = (db.prepare("SELECT * FROM memorias WHERE estado = 'ensamblando'").all() as FilaMemoria[]).filter(
    (m) => !montando.has(m.id),
  );
  return colgadas.flatMap((m) => {
    const cortes = (m.cortes_ensamblado ?? 0) + 1;
    if (cortes >= MAX_CORTES_ENSAMBLADO) {
      log.warn('ensamblado cortado demasiadas veces seguidas: se deja de reanudar', {
        memoria: m.id,
        version: m.version,
        cortes,
      });
      rendirse(db, m);
      return [];
    }
    db.prepare("UPDATE memorias SET cortes_ensamblado = ? WHERE id = ? AND estado = 'ensamblando'").run(cortes, m.id);
    log.warn('ensamblado cortado por un reinicio: se vuelve a montar', {
      memoria: m.id,
      version: m.version,
      lote: m.lote,
      cortes,
    });
    return [{ ...m, cortes_ensamblado: cortes }];
  });
}
