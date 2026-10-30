// La memoria que se entregó de verdad, hecha fuera de la plataforma (PDF o Word).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { contenidoDocx, type ElementoDocx, type ParrafoDocx } from '../../../nucleo/documentos/leerDocx.js';
import { paginasDe } from '../../../nucleo/documentos/paginas.js';
import { emitir } from '../../../nucleo/eventos.js';
import { responder } from '../../../nucleo/http.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { recibirArchivo, type ArchivoRecibido } from '../../../nucleo/subidas.js';
import { extraerDocumento } from '../../../biblioteca/motor/documentos/extraccion.js';
import { dbLicitaciones } from '../db.js';
import { fichasDe } from '../ficha.js';
import { conId } from '../http.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { autoevaluar, filaMemoria, memoriaSePuntua } from './ensamblado.js';
import { decisionesDe, lotesDecididos } from './decisiones.js';
import { contextoFugasDe } from './fugasMemoria.js';
import { descripcionDeFuga, detectarFugas } from './fugas.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { compararEntero, compararParrafos, crearComparacion } from './comparacionMemoria.js';
import { parrafosDe, pedirLecciones } from './lecciones.js';
import { lotesDeMemoria } from './memoriaLote.js';
import { caracteresDe, paginasEstimadasDe, type ApartadoDatosData } from './memoriaRevision.js';
import { apartadosDeTexto, localizarTitulos } from './memoriaTexto.js';
import { cambiosEnTextoEntero, parrafosDeElementos } from './textoEntero.js';
import { MAX_MEMORIA_SUBIDA } from './subida.js';

// No es una versión de trabajo: no se revisa, no se mejora ni se piden
// cambios sobre ella (lo presentado no cambia). Se guarda entera en Salidas
// (memoria-vN-presentada/<su nombre>, con su texto en .md y .json) y su texto se reparte por los
// apartados del guion solo si se encuentran sus títulos; si no, queda entera, sin error. Cuenta
// para la evaluación (Hermes la puntúa), las lecciones (frente a la última versión de Hermes),
// lo presentado y, de las fugas entre sobres, solo como aviso: ya no se puede corregir.
// Subir otra la sustituye como presentada (DECISIÓN: la anterior queda en el historial marcada
// presentada = 2, con su borrador descartado: una equivocación de archivo se arregla subiendo el
// bueno, sin borrar nada). Volver a subir el mismo archivo que ya es la presentada no crea otra.
// Si el pliego pide una memoria por lote (memoriaLote.ts), la presentada es POR LOTE: la de un lote
// solo sustituye a la de ese lote y la oferta no se da por cerrada hasta que cada lote tiene la suya
// (o hay una presentada común, sin lote, que vale para todos).

// Se sube tal cual y pasa a ser LA memoria de la oferta.
const log = logger('licitaciones.memoria');
export const EXTENSIONES_PRESENTADA = ['.pdf', '.docx'];

// Lo que acompaña al archivo: la nota (sin límite práctico, como al subir una versión) y el lote.
const Campos = z.object({
  notas: z.string().trim().optional(),
  lote: z.string().trim().max(80, '«lote» admite hasta 80 caracteres.').optional(),
});

export type MemoriaPresentada = {
  memoria: number;
  version: number;
  borrador: number;
  ruta: string;
  reconocidos: number;
  total: number;
  paginas: number | null;
  avisos: string[];
  aprende: boolean;
  evalua: boolean;
  sustituye: number | null;
};
type Licitacion = { id: string; expediente: string };
// texto: null si no se pudo sacar (escaneado, cifrado…): se guarda igual, pero nadie puede leerlo.
export type Lectura = {
  texto: string | null;
  paginas: string[];
  elementos: ElementoDocx[];
  numPaginas: number | null;
  aviso: string | null;
};
type Reparto = { datos: (ApartadoDatosData | null)[]; reconocidos: number } | null;
type Rutas = { ruta: string; ruta_pdf: string | null; ruta_md: string; ruta_json: string };
type Carpeta = { rel: string; abs: string };

const normal = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Los lotes con memoria propia (la oferta va por lotes y el pliego pide una por lote); null: una común. */
export function lotesDeLaMemoria(db: Db, id: string): string[] | null {
  const g = guionVigente(db, id);
  return g ? lotesDeMemoria(g.datos, lotesDecididos(db, id, decisionesDe(db, id)?.datos.lotes ?? [])) : null;
}

const oportunidadCerrada = (db: Db, id: string): boolean =>
  db
    .prepare("SELECT 1 FROM oportunidades WHERE licitacion_id = ? AND estado IN ('presentada', 'ganada', 'perdida')")
    .get(id) !== undefined;

// lote undefined: cualquiera; null: la común (sin lote).
function hayPresentada(db: Db, id: string, lote?: string | null): boolean {
  const delLote = lote === undefined ? '' : 'AND lote IS ?';
  return (
    db
      .prepare(`SELECT 1 FROM memorias WHERE licitacion_id = ? AND presentada = 1 ${delLote} LIMIT 1`)
      .get(id, ...(lote === undefined ? [] : [lote])) !== undefined
  );
}

/**
 * ¿Ya está entregado lo de ese lote (null: lo de toda la oferta)? Lo de antes ya no se arregla.
 * Sí si la oportunidad está presentada o resuelta. Sin memoria por lote, si hay presentada. Con
 * memoria por lote: la común vale para todos; un lote, con la suya; la oferta, con la de cada lote.
 * Se lee una vez por llamada: quien pregunta por varios lotes reutiliza la función que devuelve.
 */
export function cierreDe(db: Db, id: string): (lote: string | null) => boolean {
  if (oportunidadCerrada(db, id)) return () => true;
  const lotes = lotesDeLaMemoria(db, id);
  if (!lotes) {
    const cerrada = hayPresentada(db, id);
    return () => cerrada;
  }
  if (hayPresentada(db, id, null)) return () => true;
  const porLote = new Map(lotes.map((l) => [l, hayPresentada(db, id, l)]));
  return (lote) =>
    lote === null ? [...porLote.values()].every(Boolean) : (porLote.get(lote) ?? hayPresentada(db, id, lote));
}

/** ¿La oferta ya se presentó entera (su estado, o la memoria presentada de cada lote al que se va)? */
export const ofertaCerrada = (db: Db, id: string): boolean => cierreDe(db, id)(null);

// La extensión ya la filtró la recepción; la firma dice si el contenido es lo que dice ser.
export function comprobarFirma(a: ArchivoRecibido): Result<null> {
  const ext = path.extname(a.nombre).toLowerCase();
  if (ext === '.pdf' && a.datos.subarray(0, 1024).includes('%PDF-')) return ok(null);
  if (ext === '.docx' && a.datos.subarray(0, 2).toString('latin1') === 'PK') return ok(null);
  return fail(
    'invalid_input',
    `«${a.nombre}» no es un ${ext === '.pdf' ? 'PDF' : 'Word (.docx)'} válido: guárdalo otra vez desde su programa y vuelve a subirlo.`,
  );
}

const parrafo = (texto: string): ParrafoDocx => ({
  tipo: 'parrafo',
  texto,
  marcado: '',
  lista: false,
  numerada: false,
  titulo: false,
  imagenes: [],
});

// El PDF trae líneas, no párrafos: se juntan hasta un punto final o un título del guion, que va
// solo (así se reconocen igual que en un Word). Las líneas vacías y el cambio de página cortan.
export function parrafosDePdf(paginas: string[], titulos: string[]): ParrafoDocx[] {
  const esTitulo = (l: string) =>
    titulos.some((t, k) => normal(l) === normal(`${k + 1}. ${t}`) || normal(l) === normal(t));
  const out: ParrafoDocx[] = [];
  let actual: string[] = [];
  const cerrar = () => {
    if (actual.length) out.push(parrafo(actual.join(' ')));
    actual = [];
  };
  for (const pagina of paginas) {
    for (const linea of pagina.split('\n').map((l) => l.trim())) {
      if (!linea || esTitulo(linea)) {
        cerrar();
        if (linea) out.push(parrafo(linea));
        continue;
      }
      actual.push(linea);
      if (/[.!?:;]$/.test(linea)) cerrar();
    }
    cerrar();
  }
  return out;
}

const textoDeElementos = (es: ElementoDocx[]) =>
  es
    .map((e) => (e.tipo === 'parrafo' ? e.texto : e.filas.map((f) => f.join(' | ')).join('\n')))
    .filter(Boolean)
    .join('\n\n');

export function leerDocx(datos: Buffer): Result<Lectura> {
  const c = contenidoDocx(datos);
  if (c.error) return fail('invalid_input', `No se puede leer el Word: ${c.error.message}`);
  const texto = textoDeElementos(c.data.elementos);
  return ok({
    texto: texto || null,
    paginas: [texto],
    elementos: c.data.elementos,
    numPaginas: null,
    aviso: texto ? null : 'El Word no tiene texto: se guarda tal cual.',
  });
}

// El extractor lee de disco: una copia temporal, para no escribir en Salidas antes de tener versión.
async function extraerPdf(datos: Buffer): ReturnType<typeof extraerDocumento> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'presentada-'));
  try {
    const abs = path.join(dir, 'memoria.pdf');
    await fs.promises.writeFile(abs, datos);
    return await extraerDocumento(abs);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

export async function leerPdf(datos: Buffer, titulos: string[]): Promise<Lectura> {
  const r = await extraerPdf(datos);
  const paginas = r.data?.pages ?? [];
  const texto = paginas.join('\n\n').trim();
  if (r.error || r.data?.scanned || !texto) {
    const motivo = r.error ?? 'parece escaneado';
    return {
      texto: null,
      paginas,
      elementos: [],
      numPaginas: r.data?.paged ? paginas.length : null,
      aviso: `No se pudo sacar el texto del PDF (${motivo}): se guarda tal cual, pero Hermes no podrá leerlo ni evaluarlo.`,
    };
  }
  return { texto, paginas, elementos: parrafosDePdf(paginas, titulos), numPaginas: paginas.length, aviso: null };
}

// Solo si aparece algún título del guion: un documento con otra estructura se guarda entero.
function repartir(l: Lectura, guion: GuionGuardado | null): Reparto {
  const titulos = guion?.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
  if (!titulos.length || !l.elementos.length || !localizarTitulos(l.elementos, titulos).some((x) => x !== null))
    return null;
  const datos = apartadosDeTexto(l.elementos, titulos).datos;
  return { datos, reconocidos: datos.filter(Boolean).length };
}

// Una carpeta propia por versión, con el archivo con su nombre; nunca se pisa nada (alguien pudo editarlo en Drive).
function carpetaLibre(raices: Raices, carpeta: string, version: number): Result<Carpeta> {
  for (let k = 1; ; k += 1) {
    const rel = `${carpeta}/memoria-v${version}-presentada${k === 1 ? '' : `-${k}`}`;
    const abs = documentoEnDisco(raices, rel);
    if (abs.error) return abs;
    if (!fs.existsSync(abs.data)) {
      fs.mkdirSync(abs.data, { recursive: true });
      return ok({ rel, abs: abs.data });
    }
  }
}

function poner(dir: Carpeta, nombre: string, contenido: Buffer | string): string {
  fs.writeFileSync(path.join(dir.abs, nombre), contenido, { flag: 'wx' });
  return `${dir.rel}/${nombre}`;
}

// lote: el que dijo quien la sube (va en su texto y su resumen); propio: el de memorias.lote, solo
// con memoria por lote (sin ella, la presentada es la común aunque se diga el lote al que se presentó).
type Base = {
  l: Licitacion;
  guion: GuionGuardado | null;
  version: number;
  nombre: string;
  notas: string | null;
  lote: string | null;
  propio: string | null;
};
type Datos = Omit<Base, 'version'> & { sha256: string };
type Conversion = { pdf: Buffer | null; paginas: number | null };

function markdown(b: Base, l: Lectura): string {
  const lote = b.lote ? ` (lote ${b.lote})` : '';
  const cuerpo =
    l.texto === null
      ? '[Sin texto: el archivo no lo deja sacar.]'
      : l.paginas.map((p, i) => (l.paginas.length > 1 ? `[pág. ${i + 1}]\n\n${p}` : p)).join('\n\n');
  return [
    `# Memoria técnica v${b.version} (presentada)${lote}`,
    '',
    `La que se entregó, subida tal cual («${b.nombre}»).`,
    '',
    cuerpo,
  ].join('\n');
}

async function pdfDeWord(datos: Buffer): Promise<Conversion> {
  const r = await paginasDe(datos);
  return r.error ? { pdf: null, paginas: null } : { pdf: r.data.pdf, paginas: r.data.paginas };
}

// En su carpeta: el original, su PDF (de un Word, si hay LibreOffice), su texto (.md) y su reparto (.json).
function escribirArchivos(dir: Carpeta, b: Base, a: ArchivoRecibido, l: Lectura, t: Reparto, conv: Conversion): Rutas {
  const ruta = poner(dir, b.nombre, a.datos);
  const ruta_pdf = conv.pdf ? poner(dir, `${path.basename(b.nombre, path.extname(b.nombre))}.pdf`, conv.pdf) : null;
  const json = JSON.stringify(
    {
      licitacion: b.l.id,
      version: b.version,
      presentada: true,
      subida: b.nombre,
      lote: b.lote,
      apartados: t?.datos ?? null,
    },
    null,
    2,
  );
  const ruta_md = poner(dir, `memoria-v${b.version}-presentada.md`, markdown(b, l));
  return { ruta, ruta_pdf, ruta_md, ruta_json: poner(dir, `memoria-v${b.version}-presentada.json`, json) };
}

// Ya está entregada: lo que delataría el archivo de los automáticos o el económico se dice, sin bloquear nada.
function avisosDeFugas(db: Db, guion: GuionGuardado | null, texto: string | null): string[] {
  if (!guion || !texto) return [];
  const fugas = detectarFugas(texto, contextoFugasDe(db, guion));
  return [
    ...new Set(
      fugas.map((f) => `Ya presentada (solo informativo): posible fuga entre sobres: ${descripcionDeFuga(f)}.`),
    ),
  ];
}

function avisosDe(db: Db, b: Base, l: Lectura, t: Reparto): string[] {
  const total = b.guion?.datos.memoria?.apartados.length ?? 0;
  const reparto = !l.texto
    ? null
    : t
      ? `Repartida por los apartados del guion: ${t.reconocidos} de ${total} reconocidos.`
      : total
        ? 'No se encontraron los títulos de los apartados del guion: se guarda entera, sin repartir.'
        : null;
  return [l.aviso, reparto, ...avisosDeFugas(db, b.guion, l.texto)].filter((x): x is string => x !== null);
}

function insertarApartados(db: Db, memoria: number, t: Reparto, ahora: string): void {
  const ins =
    db.prepare(`INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, agente, recibido_en, error)
    VALUES (?, ?, ?, ?, ?, ?, 'persona', ?, ?)`);
  (t?.datos ?? []).forEach((d, i) => {
    const c = d ? caracteresDe(d.bloques) : null;
    ins.run(
      memoria,
      i + 1,
      d ? 'recibido' : 'fallido',
      d ? JSON.stringify(d) : null,
      c,
      c === null ? null : paginasEstimadasDe(c),
      ahora,
      d ? null : 'No se encontró en el documento presentado.',
    );
  });
}

// La anterior presentada del mismo lote (o la común, sin lote) pasa al historial (2) y su borrador,
// como las versiones de trabajo de ese lote, se descarta. Las de otro lote no se tocan: son otra memoria.
// Un borrador sin memoria cuenta como común (lote null), como en la checklist (documentos.ts).
function sustituir(db: Db, id: string, lote: string | null, ahora: string): { id: number; ruta: string | null } | null {
  const prev = db
    .prepare(
      `SELECT m.id, b.ruta FROM memorias m LEFT JOIN borradores b ON b.id = m.borrador_id
    WHERE m.licitacion_id = ? AND m.presentada = 1 AND m.lote IS ?`,
    )
    .get(id, lote) as { id: number; ruta: string | null } | undefined;
  db.prepare('UPDATE memorias SET presentada = 2 WHERE licitacion_id = ? AND presentada = 1 AND lote IS ?').run(
    id,
    lote,
  );
  db.prepare(
    `UPDATE borradores SET estado = 'descartada', revisado_en = ? WHERE licitacion_id = ? AND origen = 'ensamblado' AND estado <> 'descartada'
    AND NOT EXISTS (SELECT 1 FROM memorias m WHERE m.id = borradores.memoria_id AND m.ensayo = 1)
    AND (SELECT m.lote FROM memorias m WHERE m.id = borradores.memoria_id) IS ?`,
  ).run(ahora, id, lote);
  return prev ?? null;
}

type Registro = {
  b: Base;
  t: Reparto;
  avisos: string[];
  rutas: Rutas;
  paginas: number | null;
  datos: Buffer;
  sha256: string;
};

// Todo junto: la memoria, sus apartados y su borrador, ya dado por bueno (es lo que se entregó).
function registrar(db: Db, r: Registro): { memoria: number; borrador: number; sustituye: number | null } {
  const { b, rutas } = r;
  const ahora = new Date().toISOString();
  return db.transaction(() => {
    const prev = sustituir(db, b.l.id, b.propio, ahora);
    const memoria = Number(
      db
        .prepare(
          `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, avisos, apartados_rehechos, subida, notas_subida, presentada, lote)
      VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, '[]', ?, ?, 1, ?)`,
        )
        .run(b.l.id, b.guion?.id ?? 0, b.version, ahora, ahora, JSON.stringify(r.avisos), b.nombre, b.notas, b.propio)
        .lastInsertRowid,
    );
    insertarApartados(db, memoria, r.t, ahora);
    const resumen = `Memoria técnica v${b.version} presentada («${b.nombre}»)${b.lote ? `, lote ${b.lote}` : ''}.`;
    const borrador = Number(
      db
        .prepare(
          `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, estado, revisado_en, guion_id, version, memoria_id,
        paginas, ruta_pdf, ruta_md, ruta_json) VALUES (?, ?, ?, ?, ?, 'persona', ?, 'ensamblado', 'aceptada', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          b.l.id,
          rutas.ruta,
          r.sha256,
          r.datos.length,
          resumen,
          ahora,
          ahora,
          b.guion?.id ?? null,
          b.version,
          memoria,
          r.paginas,
          rutas.ruta_pdf,
          rutas.ruta_md,
          rutas.ruta_json,
        ).lastInsertRowid,
    );
    db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(borrador, memoria);
    // La checklist que apuntaba a la presentada anterior pasa a la nueva (la sincronización no toca lo puesto a mano).
    if (prev?.ruta)
      db.prepare(
        'UPDATE oferta_documentos SET ruta = ?, ruta_pdf = ?, actualizado_en = ? WHERE licitacion_id = ? AND ruta = ?',
      ).run(rutas.ruta, rutas.ruta_pdf, ahora, b.l.id, prev.ruta);
    return { memoria, borrador, sustituye: prev?.id ?? null };
  })();
}

// La memoria final de Hermes de ese lote: la última suya con texto, la dada por buena antes que
// las demás. Una versión retocada a mano no cuenta: sus lecciones salieron al subirla.
function finalDeHermes(db: Db, b: Base): { id: number; version: number } | undefined {
  return db
    .prepare(
      `SELECT m.id, m.version FROM memorias m LEFT JOIN borradores x ON x.id = m.borrador_id
    WHERE m.licitacion_id = ? AND m.ensayo = 0 AND m.presentada = 0 AND m.subida IS NULL AND m.version < ? AND m.lote IS ?
      AND EXISTS (SELECT 1 FROM memoria_apartados a WHERE a.memoria_id = m.id AND a.estado = 'recibido')
    ORDER BY x.estado = 'aceptada' DESC, m.version DESC LIMIT 1`,
    )
    .get(b.l.id, b.version, b.propio) as { id: number; version: number } | undefined;
}

// Por apartado si se pudo repartir (lo de antes del primer título, portada e índice, no cuenta);
// si no, el texto entero.
function compararConHermes(
  db: Db,
  b: Base,
  memoria: number,
  x: { t: Reparto; elementos: ElementoDocx[] },
  hermes: { id: number; version: number },
): void {
  const titulos = b.guion?.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
  const deHermes = parrafosDe(db, hermes.id);
  const cambios = x.t?.reconocidos
    ? compararParrafos(deHermes, parrafosDe(db, memoria), titulos)
    : compararEntero(cambiosEnTextoEntero([...deHermes.values()].flat(), parrafosDeElementos(x.elementos)));
  crearComparacion(db, {
    licitacion_id: b.l.id,
    lote: b.propio,
    hermes,
    presentada: { id: memoria, version: b.version },
    cambios,
    por_apartado: Boolean(x.t?.reconocidos),
  });
}

// Hermes aprende de lo presentado frente a su memoria final de ese lote (con la comparación) o de la nota.
function aprender(db: Db, b: Base, memoria: number, x: { t: Reparto; elementos: ElementoDocx[] }): boolean {
  const hermes = x.elementos.length ? finalDeHermes(db, b) : undefined;
  if (!hermes && !b.notas) return false;
  try {
    if (hermes) compararConHermes(db, b, memoria, x, hermes);
    pedirLecciones(nucleo().db, { id: memoria, licitacion_id: b.l.id, version: b.version }, hermes?.id ?? null);
    return true;
  } catch (err) {
    log.warn('lecciones de la presentada sin pedir', {
      licitacion: b.l.id,
      version: b.version,
      error: errorMessage(err).slice(0, 200),
    });
    return false;
  }
}

// Un segundo clic tras subirla (el mismo archivo otra vez, para el mismo lote) no crea otra presentada
// ni repite evaluación y lecciones. Para otro lote sí vale: un archivo único puede llevar las de varios.
function yaEsLaPresentada(db: Db, id: string, propio: string | null, sha256: string): Result<null> {
  const m = db
    .prepare(
      `SELECT m.version FROM memorias m JOIN borradores b ON b.id = m.borrador_id
    WHERE m.licitacion_id = ? AND m.presentada = 1 AND m.lote IS ? AND b.sha256 = ?`,
    )
    .get(id, propio, sha256) as { version: number } | undefined;
  return m
    ? fail('conflicto', `Ese archivo ya es la memoria presentada (v${m.version}): no hace falta subirlo otra vez.`)
    : ok(null);
}

// Con memoria por lote, el lote dicho debe ser uno de ellos; sin lote, es la común (vale para todos).
function loteMemoriaDe(db: Db, id: string, lote: string | null): Result<string | null> {
  const lotes = lotesDeLaMemoria(db, id);
  if (!lotes || lote === null) return ok(null);
  return lotes.includes(lote)
    ? ok(lote)
    : fail(
        'invalid_input',
        `El lote «${lote}» no es de esta oferta: las memorias son de los lotes ${lotes.join(', ')}.`,
      );
}

function datosDe(db: Db, id: string, a: ArchivoRecibido): Result<Datos> {
  const campos = Campos.safeParse(a.campos);
  if (!campos.success) return fail('invalid_input', z.prettifyError(campos.error));
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(id) as Licitacion | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id ${id}.`);
  const lote = campos.data.lote || null;
  const propio = loteMemoriaDe(db, id, lote);
  if (propio.error) return propio;
  const firma = comprobarFirma(a);
  if (firma.error) return firma;
  const sha256 = crypto.createHash('sha256').update(a.datos).digest('hex');
  const repetida = yaEsLaPresentada(db, id, propio.data, sha256);
  if (repetida.error) return repetida;
  return ok({
    l,
    guion: guionVigente(db, id),
    nombre: a.nombre,
    notas: campos.data.notas || null,
    lote,
    propio: propio.data,
    sha256,
  });
}

type Leida = { leida: Lectura; conv: Conversion };

// Lo lento (leer el PDF, convertir el Word con LibreOffice) va antes de fijar la versión: mientras
// tarda, otra petición puede crear una memoria, y la versión cogida antes chocaría con la suya.
async function leer(d: Datos, a: ArchivoRecibido, titulos: string[]): Promise<Result<Leida>> {
  if (path.extname(d.nombre).toLowerCase() !== '.docx') {
    const leida = await leerPdf(a.datos, titulos);
    return ok({ leida, conv: { pdf: null, paginas: leida.numPaginas } });
  }
  const word = leerDocx(a.datos);
  return word.error ? word : ok({ leida: word.data, conv: await pdfDeWord(a.datos) });
}

type Fijada = { b: Base; t: Reparto; avisos: string[]; rutas: Rutas; r: ReturnType<typeof registrar> };

// Sin ningún await: versión, archivos y filas van seguidos y ninguna otra petición se cuela. Si el
// registro falla, la carpeta se quita: en Salidas no queda nada que no sea de una memoria.
function fijar(db: Db, d: Datos, a: ArchivoRecibido, raices: Raices, x: Leida): Result<Fijada> {
  const version =
    ((db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(d.l.id) as { v: number | null })
      .v ?? 0) + 1;
  const b: Base = { l: d.l, guion: d.guion, version, nombre: d.nombre, notas: d.notas, lote: d.lote, propio: d.propio };
  const t = repartir(x.leida, b.guion);
  const avisos = avisosDe(db, b, x.leida, t);
  const dir = carpetaLibre(raices, carpetaSalidas(b.l), version);
  if (dir.error) return dir;
  try {
    const rutas = escribirArchivos(dir.data, b, a, x.leida, t, x.conv);
    return ok({
      b,
      t,
      avisos,
      rutas,
      r: registrar(db, { b, t, avisos, rutas, paginas: x.conv.paginas, datos: a.datos, sha256: d.sha256 }),
    });
  } catch (err) {
    fs.rmSync(dir.data.abs, { recursive: true, force: true });
    throw err;
  }
}

async function guardar(db: Db, d: Datos, a: ArchivoRecibido, raices: Raices): Promise<Result<MemoriaPresentada>> {
  const titulos = d.guion?.datos.memoria?.apartados.map((x) => x.titulo) ?? [];
  const x = await leer(d, a, titulos);
  if (x.error) return x;
  const f = fijar(db, d, a, raices, x.data);
  if (f.error) return f;
  const { b, t, avisos, rutas, r } = f.data;
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: b.l.id,
    datos: { accion: 'presentada', version: b.version },
  });
  emitir(db, {
    tipo: 'licitacion.borrador',
    dominio: 'licitaciones',
    recurso: b.l.id,
    datos: { agente: 'persona', borrador: r.borrador },
  });
  // Sin texto no hay nada que puntuar; sin ficha, la evaluación no tiene vara; y si el pliego no
  // puntúa la memoria, autoevaluar no encola nada: no se anuncia una nota que no llegará.
  const evalua =
    x.data.leida.texto !== null &&
    fichasDe(db, b.l.id).aprobada !== null &&
    memoriaSePuntua(db, { licitacion_id: b.l.id, guion_id: b.guion?.id ?? 0 });
  if (evalua) autoevaluar(db, filaMemoria(db, r.memoria)!, rutas.ruta);
  const aprende = aprender(db, b, r.memoria, { t, elementos: x.data.leida.elementos });
  return ok({
    memoria: r.memoria,
    borrador: r.borrador,
    sustituye: r.sustituye,
    version: b.version,
    ruta: rutas.ruta,
    reconocidos: t?.reconocidos ?? 0,
    total: titulos.length,
    paginas: x.data.conv.paginas,
    avisos,
    aprende,
    evalua,
  });
}

/** Guarda la memoria presentada (PDF o Word) como LA memoria de la oferta; no mira el plazo. */
export async function subirMemoriaPresentada(
  db: Db,
  id: string,
  archivo: ArchivoRecibido,
  raices: Raices = raicesActuales(),
): Promise<Result<MemoriaPresentada>> {
  const d = datosDe(db, id, archivo);
  if (d.error) return d;
  try {
    return await guardar(db, d.data, archivo, raices);
  } catch (err) {
    log.error('memoria presentada sin guardar', { licitacion: id, error: errorMessage(err).slice(0, 200) });
    return fail(
      'internal_error',
      'No se pudo guardar la memoria presentada: vuelve a intentarlo; si se repite, mira el log del servidor.',
    );
  }
}

// Un solo archivo por petición, procesado al momento; sin guardaPlazo: se sube después de entregarla.
async function subir(id: string, req: Request, res: Response): Promise<void> {
  const a = await recibirArchivo(req, { maxBytes: MAX_MEMORIA_SUBIDA, extensiones: EXTENSIONES_PRESENTADA });
  if (a.error) return responder(res, a);
  responder(res, await subirMemoriaPresentada(dbLicitaciones(), id, a.data), 201);
}

export function rutasMemoriaPresentada(r: Router): void {
  r.post(
    '/licitaciones/:id/oferta/memoria/presentada',
    conId((id, req, res) => {
      void subir(id, req, res);
    }),
  );
}
