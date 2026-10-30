// Actas de mesa de lo presentado: detectarlas por el nombre y encolar un run de Hermes por carpeta.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { leerPerfilEmpresa, nombreDelPerfil } from '../../../nucleo/empresa.js';
import type { DestinoHermes } from '../../../nucleo/hermes/runs.js';
import type { OrigenMetricas } from '../../../nucleo/hermes/metricas.js';
import { encolar } from '../../../nucleo/trabajos.js';
import { registrarTipoTrabajo } from '../../../nucleo/colaTipos.js';
import { leerDocumento, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { abrirIndiceLectura } from '../../../biblioteca/motor/documentos/servicioIndice.js';
import * as indice from '../../../biblioteca/motor/documentos/almacen.js';
import { carpetasLicitaciones } from '../carpetas.js';
import { SUBCARPETAS_UNICA } from '../carpetasUnicas.js';
import { dbLicitaciones } from '../db.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';

// En cada carpeta de Conocimiento/…/Presentadas el equipo deja el acta de valoración, el informe técnico o la
// resolución de adjudicación. Se detectan por el nombre (en el disco, que drive-sync mantiene al día), se
// encola un run de Hermes por carpeta (licitaciones.aprender_acta) y se lee el texto del documento para
// comprobar que lo que Hermes cita de la mesa es literal.
export const TIPO_APRENDER_ACTA = 'licitaciones.aprender_acta';
export const PayloadActa = z.object({
  carpeta: z.string().min(10),
  documento: z.string().min(10),
  pedida_en: z.string().min(10),
});
export type PayloadActaData = z.infer<typeof PayloadActa>;

const CARPETA_PRESENTADA = 'DOCUMENTACION PRESENTADA';
const EXTENSIONES = new Set(['.pdf', '.docx', '.doc', '.odt', '.rtf']);
// Lo que bajó el radar y lo que entregamos no son la valoración de la mesa.
const NO_SON_ACTAS = new Set(['pliegos', 'documentacion presentada']);
const PROFUNDIDAD = 2;
// Del más útil al menos: el acta con la valoración trae los puntos criterio a criterio (la de
// constitución de la mesa o apertura de sobres, no).
const RANGOS: RegExp[] = [
  /^(?!.*\b(constitucion|apertura)\b).*(\bacta\b.*\b(mesa|valoracion|puntuacion|propuesta de adjudicacion)\b|\b(mesa|valoracion)\b.*\bacta\b)/,
  /\binforme\b.*\b(valoracion|tecnico)\b|\bvaloracion\b.*\b(ofertas|propuestas)\b/,
  /\bacta\b/,
  /\b(resolucion|decreto)\b.*\badjudica|\badjudicacion\b/,
  /\bdecreto\b/,
];

const nombreComparable = (n: string) => textoComparable(path.parse(n).name).replace(/[_\-.]+/g, ' ');

/** Rango de un nombre como acta, sin mirar la extensión (los de la PLACSP no siempre la llevan). */
export function rangoActaDeNombre(nombre: string): number | null {
  const n = nombreComparable(nombre);
  const i = RANGOS.findIndex((re) => re.test(n));
  return i < 0 ? null : i;
}

/** Rango del nombre de un archivo como acta (0 = acta de valoración); null si no lo parece. */
export function rangoActa(nombre: string): number | null {
  return EXTENSIONES.has(path.extname(nombre).toLowerCase()) ? rangoActaDeNombre(nombre) : null;
}

function entradas(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

// Archivos de la carpeta y sus subcarpetas (rutas relativas a ella), sin PLIEGOS ni lo entregado.
function archivosDe(dir: string, rel: string, profundidad: number, out: string[]): void {
  for (const e of entradas(dir)) {
    const hijo = rel ? `${rel}/${e.name}` : e.name;
    if (e.isFile()) out.push(hijo);
    else if (e.isDirectory() && profundidad > 0 && !NO_SON_ACTAS.has(textoComparable(e.name)))
      archivosDe(path.join(dir, e.name), hijo, profundidad - 1, out);
  }
}

/** El documento de la carpeta que mejor sirve para aprender (ruta relativa a la carpeta), o null. */
export function actaDeCarpeta(dirCarpeta: string): string | null {
  const archivos: string[] = [];
  archivosDe(dirCarpeta, '', PROFUNDIDAD, archivos);
  const conRango = archivos
    .map((a) => ({ a, r: rangoActa(path.posix.basename(a)) }))
    .filter((x): x is { a: string; r: number } => x.r !== null);
  // A igual rango, la más reciente: los nombres llevan la fecha detrás.
  conRango.sort((x, y) => x.r - y.r || y.a.localeCompare(x.a));
  return conRango[0]?.a ?? null;
}

export type ActaPendiente = { carpeta: string; documento: string };

// Rango 0 y 1: el acta o el informe de valoración. Entre los pliegos (lo que publica la PLACSP,
// también tras resolver) solo cuentan esos: el resto de actas son de apertura o constitución.
export const RANGO_EN_PLIEGOS = 1;

/**
 * En la carpeta única de una licitación: el acta de `Resolución/` (cualquier documento que
 * lo parezca) o, si la PLACSP la publicó y se bajó con los pliegos, la de `Pliegos/`. Relativa a la carpeta.
 */
export function actaDeCarpetaUnica(dirCarpeta: string): string | null {
  const enResolucion = actaDeCarpeta(path.join(dirCarpeta, SUBCARPETAS_UNICA.resolucion));
  if (enResolucion) return `${SUBCARPETAS_UNICA.resolucion}/${enResolucion}`;
  const pliegos = entradas(path.join(dirCarpeta, SUBCARPETAS_UNICA.pliegos))
    .filter((e) => e.isFile())
    .map((e) => ({ a: e.name, r: rangoActa(e.name) }))
    .filter((x): x is { a: string; r: number } => x.r !== null && x.r <= RANGO_EN_PLIEGOS)
    .sort((x, y) => x.r - y.r || y.a.localeCompare(x.a));
  return pliegos[0] ? `${SUBCARPETAS_UNICA.pliegos}/${pliegos[0].a}` : null;
}

/** Carpetas de Presentadas y carpetas únicas con un acta y sin aprendizaje (rutas «Conocimiento/…»). */
export function actasSinAprendizaje(db: Db, conocimiento: string): ActaPendiente[] {
  const { presentadas } = carpetasLicitaciones();
  const raiz = path.join(conocimiento, ...presentadas.split('/'));
  const hechas = new Set(
    (db.prepare('SELECT carpeta FROM aprendizajes').all() as { carpeta: string }[]).map((f) => f.carpeta),
  );
  const out: ActaPendiente[] = [];
  for (const e of entradas(raiz)
    .filter((x) => x.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const carpeta = `Conocimiento/${presentadas}/${e.name}`;
    if (hechas.has(carpeta)) continue;
    const acta = actaDeCarpeta(path.join(raiz, e.name));
    if (acta) out.push({ carpeta, documento: `${carpeta}/${acta}` });
  }
  for (const { ruta } of db.prepare('SELECT ruta FROM carpetas_unicas ORDER BY ruta').all() as { ruta: string }[]) {
    const carpeta = `Conocimiento/${ruta}`;
    if (hechas.has(carpeta)) continue;
    const acta = actaDeCarpetaUnica(path.join(conocimiento, ...ruta.split('/')));
    if (acta) out.push({ carpeta, documento: `${carpeta}/${acta}` });
  }
  return out;
}

// Carpetas con un trabajo de aprendizaje: en curso (pendiente o lanzado) o cualquiera.
function carpetasConTrabajo(dbNucleo: DbNucleo, soloEnCurso: boolean): Set<string> {
  const filas = dbNucleo
    .prepare(
      `SELECT json_extract(payload, '$.carpeta') AS carpeta FROM trabajos_ia WHERE tipo = ?
    ${soloEnCurso ? "AND estado IN ('pendiente', 'lanzado')" : ''}`,
    )
    .all(TIPO_APRENDER_ACTA) as { carpeta: string }[];
  return new Set(filas.map((f) => f.carpeta));
}

export type PedidoActas = { conocimiento: string | null; max: number; aMano: boolean };

/**
 * Encola la lectura de las actas sin aprendizaje. A mano (la web) se repiten las que
 * fallaron; en la vuelta, cada carpeta se intenta una sola vez para no gastar el modelo
 * en un acta escaneada que nunca se podrá leer.
 */
export function pedirLecturaActas(dbNucleo: DbNucleo, dbLic: Db, p: PedidoActas): number {
  if (!p.conocimiento) return 0;
  const conTrabajo = carpetasConTrabajo(dbNucleo, p.aMano);
  const pendientes = actasSinAprendizaje(dbLic, p.conocimiento)
    .filter((a) => !conTrabajo.has(a.carpeta))
    .slice(0, p.max);
  const pedida = new Date().toISOString();
  for (const a of pendientes) {
    // La clave viaja como Idempotency-Key: la carpeta va como hash.
    const hash = crypto.createHash('sha256').update(a.carpeta).digest('hex').slice(0, 16);
    const payload: PayloadActaData = { ...a, pedida_en: pedida };
    encolar(dbNucleo, {
      tipo: TIPO_APRENDER_ACTA,
      dominio: 'licitaciones',
      clave: `aprender-acta-${hash}${p.aMano ? `-${pedida}` : ''}`,
      payload,
      aMano: p.aMano,
    });
  }
  return pendientes.length;
}

/** Cuántas carpetas tienen acta sin aprendizaje y cuántas de ellas se están leyendo ya. */
export function resumenActas(
  dbNucleo: DbNucleo,
  dbLic: Db,
  conocimiento: string | null,
): { pendientes_de_leer: number; leyendo: number } {
  if (!conocimiento) return { pendientes_de_leer: 0, leyendo: 0 };
  const enCurso = carpetasConTrabajo(dbNucleo, true);
  const sin = actasSinAprendizaje(dbLic, conocimiento);
  const leyendo = sin.filter((a) => enCurso.has(a.carpeta)).length;
  return { pendientes_de_leer: sin.length - leyendo, leyendo };
}

// ── Literalidad ──

const MARCA_PAGINA = /\[pág\. \d+\]/g;
const PALABRAS_POR_TROZO = 8;
const MIN_PALABRAS = 3;

/** Texto para comparar citas: sin tildes, mayúsculas, puntuación, guiones de fin de línea ni marcas de página. */
export function textoPlano(t: string): string {
  return textoComparable(t.replace(MARCA_PAGINA, ' '))
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Trozos de ocho palabras de cada tramo de la cita: un «…» separa tramos copiados de sitios distintos.
function trozos(cita: string): string[] {
  return cita.split(/…|\.\.\.|\[\s*…\s*\]/).flatMap((tramo) => {
    const palabras = textoPlano(tramo).split(' ').filter(Boolean);
    if (palabras.length < MIN_PALABRAS) return [];
    const out: string[] = [];
    for (let i = 0; i < palabras.length; i += PALABRAS_POR_TROZO) {
      const resto = palabras.length - i;
      out.push(
        (resto < MIN_PALABRAS && i > 0
          ? palabras.slice(-PALABRAS_POR_TROZO)
          : palabras.slice(i, i + PALABRAS_POR_TROZO)
        ).join(' '),
      );
    }
    return out;
  });
}

/** Los trozos de una cita que no están en el documento (ya pasado por textoPlano). */
export function trozosNoLiterales(cita: string, documentoPlano: string): string[] {
  const doc = ` ${documentoPlano} `;
  return trozos(cita).filter((t) => !doc.includes(` ${t} `));
}

async function textoDelDisco(raices: Raices, ruta: string): Promise<string | null> {
  const partes: string[] = [];
  for (let desde = 0; ;) {
    const r = await leerDocumento(raices, ruta, desde);
    if (r.error) return null;
    partes.push(r.data.texto);
    if (r.data.hasta >= r.data.total) return partes.join('');
    desde = r.data.hasta;
  }
}

/** Texto entero de un documento «Conocimiento/…»: el del índice de la Biblioteca (lo que lee Hermes) o, sin él, extraído del disco. */
export async function textoDeDocumento(
  raices: Raices,
  ruta: string,
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): Promise<string | null> {
  const trozosIndice = idx ? indice.trozosDeArchivo(idx, ruta.slice('Conocimiento/'.length)) : [];
  if (trozosIndice.length) return trozosIndice.map((c) => c.text).join('\n');
  return textoDelDisco(raices, ruta).catch(() => null);
}

// ── Instrucciones del run ──

const ENTREGADO = new Set([CARPETA_PRESENTADA, SUBCARPETAS_UNICA.presentada].map(textoComparable));

/** Documentos de lo que entregamos (DOCUMENTACION PRESENTADA o, en la carpeta única, Presentada), la memoria primero. */
export function documentosEntregados(conocimiento: string, carpeta: string): string[] {
  const dir = path.join(conocimiento, ...carpeta.slice('Conocimiento/'.length).split('/'));
  const sub = entradas(dir).find((e) => e.isDirectory() && ENTREGADO.has(textoComparable(e.name)));
  if (!sub) return [];
  const archivos: string[] = [];
  archivosDe(path.join(dir, sub.name), '', 1, archivos);
  const docs = archivos
    .filter((a) => EXTENSIONES.has(path.extname(a).toLowerCase()))
    .map((a) => `${carpeta}/${sub.name}/${a}`);
  const esMemoria = (r: string) => (/memoria/.test(textoComparable(path.posix.basename(r))) ? 0 : 1);
  return docs.sort((a, b) => esMemoria(a) - esMemoria(b) || a.localeCompare(b)).slice(0, 10);
}

// La razón social y el NIF para encontrarnos en el acta; el nombre comercial, si lo hay, para la cabecera.
export type Empresa = { nombre: string; nif: string; nombre_comercial?: string | null } | null;

const enBiblioteca = (ruta: string) => `«${ruta.slice('Conocimiento/'.length)}»`;

export function instruccionesActa(p: PayloadActaData, empresa: Empresa, entregados: string[]): string {
  const quien = empresa
    ? `${empresa.nombre} (NIF ${empresa.nif})`
    : 'la empresa que presentó la oferta (no hay perfil de empresa: sácalo de la memoria presentada)';
  const nombre = empresa
    ? nombreDelPerfil({ nombre: empresa.nombre, nombre_comercial: empresa.nombre_comercial ?? null })
    : 'la empresa';
  const memoria = entregados.length
    ? `Lo que entregamos está en: ${entregados.map(enBiblioteca).join(', ')}.`
    : `No hay ${CARPETA_PRESENTADA} con documentos: busca la memoria con biblioteca_buscar (carpeta ${enBiblioteca(p.carpeta)}) o sigue sin ella.`;
  return [
    `Tarea de la plataforma de ${nombre}: aprende de la valoración de la mesa en una licitación que presentamos (lector de actas). Sigue la skill «licitaciones» (sección «Aprender de un acta de mesa»). No modifiques nada.`,
    `Carpeta: «${p.carpeta}». Documento: «${p.documento}».`,
    `1. Lee el documento entero con biblioteca_leer (ruta ${enBiblioteca(p.documento)}), por páginas (pagina_desde/pagina_hasta, hasta 15 por llamada) y hasta la última. Nosotros somos ${quien}; en el acta podemos salir en mayúsculas, sin la forma jurídica o solo por el NIF.`,
    '2. Localiza la valoración de NUESTRA oferta y la del adjudicatario (o la mejor valorada), criterio a criterio: puntos máximos, nuestros y del ganador, y lo que la mesa dice de nuestra oferta copiado LITERAL del documento (sin resumir ni corregir; si cortas, une los tramos literales con «…»), con su página. Si el documento no trae puntos por criterio (una resolución), deja criterios vacío y pon lo que sepas.',
    `3. Lee nuestra memoria presentada. ${memoria} Compara lo que la mesa valoró o echó en falta con lo que escribimos.`,
    '4. Saca hasta 10 lecciones concretas para la próxima memoria: qué puntuó y qué no, y por qué (p. ej. «la mesa quiere cifras: la memoria no cuantificaba el volumen de datos ni los plazos»). Nada genérico.',
    `5. Envía licitaciones_aprendizaje (carpeta=«${p.carpeta}», documento=«${p.documento}») con resultado (ganada, perdida, excluida, desierta o desconocido), ganador (nombre o null), puntos_nuestros, puntos_ganador, criterios (criterio, puntos_max, nuestros, ganador, comentario_mesa literal y pagina) y lecciones. Si responde con un error, corrige lo que indique y vuelve a enviarlo.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}

// ── Cola ──

const ACTAS_POR_VUELTA = 2;

/** Comprobación «hecho» del trabajo: llegó el aprendizaje de esa carpeta desde que se pidió (o ya hay uno aceptado). */
export function aprendizajeRecibido(db: Db, carpeta: string, desde: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM aprendizajes WHERE carpeta = ? AND (creado_en >= ? OR estado = 'aceptada')")
      .get(carpeta, desde),
  );
}

/** En la vuelta: como mucho dos actas nuevas por minuto, para no llenar la cola de golpe. */
export function encolarActasEnVuelta(conocimiento: string): number {
  return pedirLecturaActas(nucleo().db, dbLicitaciones(), { conocimiento, max: ACTAS_POR_VUELTA, aMano: false });
}

export function registrarAprenderActa(destino: () => DestinoHermes | null, metricas: OrigenMetricas): void {
  registrarTipoTrabajo(TIPO_APRENDER_ACTA, {
    destino,
    metricas,
    instrucciones: (p) => {
      const a = PayloadActa.parse(p);
      const perfil = leerPerfilEmpresa(nucleo().db)?.perfil;
      const conocimiento = raicesActuales().conocimiento;
      return instruccionesActa(a, perfil ?? null, conocimiento ? documentosEntregados(conocimiento, a.carpeta) : []);
    },
    hecho: (p) => {
      const { carpeta, pedida_en } = PayloadActa.parse(p);
      return aprendizajeRecibido(dbLicitaciones(), carpeta, pedida_en);
    },
  });
}
