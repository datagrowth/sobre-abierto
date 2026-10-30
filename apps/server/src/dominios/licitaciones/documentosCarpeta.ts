// Documentos de la carpeta de una licitación que, sin ser el PCAP ni el PPT, cambian la oferta.
import path from 'node:path';
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { carpetaPliegos } from './pliegos.js';
import { obtenerLicitacion, type Db } from './store.js';
import { textoComparable } from './temas.js';

// Son las respuestas a dudas, aclaraciones y rectificaciones (forman parte del pliego y mandan sobre él), la
// normativa interna del cliente (código y versión) y el contrato. Muchos no los publica la plataforma: el equipo
// los sube a la carpeta de pliegos en Drive. Al detectarlos (la Biblioteca ya los indexó) se registran con su
// clase en documentos_licitacion, y el dossier de la memoria los lee de ahí. Lo que presenta la empresa (sobres,
// documentación presentada) no es del cliente y no entra.
export type ClaseCarpeta = 'aclaracion' | 'normativa' | 'contrato';
export type DocumentoCarpeta = {
  ruta: string;
  nombre: string;
  clase: ClaseCarpeta;
  fecha: string | null;
  codigo: string | null;
  version: string | null;
  origen: 'carpeta' | 'pliegos';
};

// Subcarpetas con lo de la empresa: «Sobre 2», «Archivo nº 1», «DOCUMENTACION PRESENTADA»…
const NUESTRO = /^(?:sobre|archivo|fichero)\b|^documentacion presentada$|^otros documentos$|^oferta\b/;
// «Respuesta», «preguntas» o «consultas» sueltos no: «Plan de respuesta a incidentes», «Modelo de
// respuesta técnica» o «Consultas preliminares al mercado» no aclaran el pliego. Sí lo que el
// órgano publica para los licitadores: notas informativas, comunicaciones, modificaciones.
const ACLARACION_NOMBRE =
  /^respuestas\b|respuestas? a (?:las )?(?:dudas|consultas|preguntas|cuestiones)|preguntas y respuestas|aclaraci|\bdudas\b|rectificaci|fe de erratas|correccion de errores|nota informativa|comunicacion(?:es)? a (?:los )?licitadores|modificacion (?:del? (?:los )?pliegos?|del pcap|del ppt)/;
const ACLARACION_CABECERA =
  /respuestas? a (?:las )?(?:dudas|consultas|preguntas)|\baclaraciones?\b|\brectificacion\b|correccion de errores|fe de erratas|nota informativa|comunicacion a (?:los )?licitadores|modificacion (?:del? (?:los )?pliegos?|del pcap|del ppt)/;
// Lo que prepara el equipo (borradores, plantillas) no es del órgano aunque hable de dudas.
const PROPIO_NOMBRE = /\bborrador\b|\bplantilla\b/;
const NORMATIVA_CARPETA = /normativ|instrucciones internas|procedimientos internos|politicas internas/;
const CONTRATO_NOMBRE = /\bcontrato\b|\bminuta\b/;
// Código de un documento normativo: «N-010», «I-C-008», «P-APR-001» (no «PCAP-2026»).
const CODIGO = /\b[A-Z]{1,4}(?:-[A-Z]{1,4})*-\d{2,3}\b/;
const VERSION = /\b(?:revisi[oó]n|rev|rv|versi[oó]n|ed(?:ici[oó]n)?)\.?\s*:?\s*(\d{1,3})\b/i;
const CABECERA = 800;

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const dosDigitos = (n: number) => String(n).padStart(2, '0');

function fechaValida(a: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCMonth() === m - 1 ? `${a}-${dosDigitos(m)}-${dosDigitos(d)}` : null;
}

// Una aclaración se publica en los meses de la licitación: más lejos del plazo, las seis cifras
// son otra cosa (un número de expediente, «000412», no es el 12/04/2000).
const MAX_DISTANCIA_MS = 366 * 86_400_000;

// «260925»: AAMMDD o DDMMAA; vale la lectura más cercana a la fecha de referencia (el plazo).
function fechaDeSeisCifras(s: string, referencia: string): string | null {
  const [x, y, z] = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)].map(Number) as [number, number, number];
  const distancia = (f: string) => Math.abs(Date.parse(f) - Date.parse(referencia.slice(0, 10)));
  const lecturas = [fechaValida(2000 + x, y, z), fechaValida(2000 + z, y, x)].filter(
    (f): f is string => f !== null && distancia(f) <= MAX_DISTANCIA_MS,
  );
  return lecturas.sort((a, b) => distancia(a) - distancia(b))[0] ?? null;
}

/** La primera fecha de un texto (dd/mm/aaaa, dd.mm.aaaa, AAAA-MM-DD o «15 de noviembre de 2026»), en AAAA-MM-DD. */
export function fechaEnTexto(t: string): string | null {
  const num = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/.exec(t);
  if (num) return fechaValida(Number(num[3]), Number(num[2]), Number(num[1]));
  const isoF = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (isoF) return fechaValida(Number(isoF[1]), Number(isoF[2]), Number(isoF[3]));
  const larga = new RegExp(String.raw`\b(\d{1,2}) de (${MESES.join('|')}) de (\d{4})\b`).exec(textoComparable(t));
  return larga ? fechaValida(Number(larga[3]), MESES.indexOf(larga[2]!) + 1, Number(larga[1])) : null;
}

/**
 * La fecha de un documento (AAAA-MM-DD): la de su nombre, que pone quien lo sube («… 260925.pdf»,
 * «… 07.10.2026.pdf»); si no, la primera de su cabecera. null si no hay ninguna.
 */
export function fechaDeDocumento(nombre: string, cabecera: string, referencia: string): string | null {
  const base = path.posix.basename(nombre).replace(/\.[a-z0-9]{2,5}$/i, '');
  const enNombre = fechaEnTexto(base);
  if (enNombre) return enNombre;
  const ocho = /(?<!\d)(\d{8})(?!\d)/.exec(base)?.[1];
  const deOcho = ocho
    ? (fechaValida(Number(ocho.slice(0, 4)), Number(ocho.slice(4, 6)), Number(ocho.slice(6))) ??
      fechaValida(Number(ocho.slice(4)), Number(ocho.slice(2, 4)), Number(ocho.slice(0, 2))))
    : null;
  if (deOcho) return deOcho;
  const seis = /(?<!\d)(\d{6})(?!\d)/.exec(base)?.[1];
  return (seis ? fechaDeSeisCifras(seis, referencia) : null) ?? fechaEnTexto(cabecera.slice(0, CABECERA));
}

/** Código y versión de un documento: del nombre y, si no, de su cabecera. */
export function codigoYVersion(nombre: string, cabecera: string): { codigo: string | null; version: string | null } {
  const base = path.posix.basename(nombre);
  const cab = cabecera.slice(0, CABECERA);
  return {
    codigo: CODIGO.exec(base)?.[0] ?? CODIGO.exec(cab)?.[0] ?? null,
    version: VERSION.exec(base)?.[1] ?? VERSION.exec(cab)?.[1] ?? null,
  };
}

/**
 * La clase de un documento de la carpeta por su nombre, sus subcarpetas (relativas a la de
 * pliegos) y su cabecera; null si no es ninguna de las que interesan.
 */
export function clasificarDocumento(rutaRelativa: string, cabecera: string): ClaseCarpeta | null {
  const partes = rutaRelativa.split('/');
  const nombre = textoComparable(partes[partes.length - 1]!);
  const carpetas = partes.slice(0, -1).map((p) => textoComparable(p).trim());
  if (carpetas.some((c) => NUESTRO.test(c))) return null;
  // En la carpeta de normativa, todo es normativa: «Instrucción de respuesta a incidentes» no es una aclaración.
  if (carpetas.some((c) => NORMATIVA_CARPETA.test(c))) return 'normativa';
  const aclara = ACLARACION_NOMBRE.test(nombre) || ACLARACION_CABECERA.test(textoComparable(cabecera.slice(0, 200)));
  if (aclara && !PROPIO_NOMBRE.test(nombre)) return 'aclaracion';
  if (CODIGO.test(partes[partes.length - 1]!.split(/\s/)[0] ?? '')) return 'normativa';
  return CONTRATO_NOMBRE.test(nombre) ? 'contrato' : null;
}

const cabeceraDe = (idx: indice.BaseDatos, ruta: string) =>
  indice
    .trozosIniciales(idx, ruta, 2)
    .map((c) => c.text)
    .join('\n');

type Candidato = { ruta: string; origen: DocumentoCarpeta['origen'] };

// Lo publicado como «adicional» (nunca PCAP ni PPT) y lo que está en la carpeta sin registrar.
function candidatos(db: Db, id: string, carpeta: string, idx: indice.BaseDatos): Candidato[] {
  const pliegos = db
    .prepare("SELECT ruta, clase FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL")
    .all(id) as { ruta: string; clase: string }[];
  const principales = new Set(pliegos.filter((p) => p.clase === 'pcap' || p.clase === 'ppt').map((p) => p.ruta));
  const publicados = new Set(pliegos.map((p) => p.ruta));
  const enCarpeta = indice
    .archivosBajo(idx, carpeta, 'document')
    .filter((f) => f.status === 'ok' && !publicados.has(f.path));
  return [
    ...pliegos.filter((p) => !principales.has(p.ruta)).map((p) => ({ ruta: p.ruta, origen: 'pliegos' as const })),
    ...enCarpeta.map((f) => ({ ruta: f.path, origen: 'carpeta' as const })),
  ];
}

function detectar(c: Candidato, carpeta: string, idx: indice.BaseDatos, referencia: string): DocumentoCarpeta | null {
  const cabecera = cabeceraDe(idx, c.ruta);
  const relativa = c.ruta.startsWith(`${carpeta}/`) ? c.ruta.slice(carpeta.length + 1) : path.posix.basename(c.ruta);
  const clase = clasificarDocumento(relativa, cabecera);
  if (!clase) return null;
  const nombre = path.posix.basename(c.ruta);
  return {
    ruta: c.ruta,
    nombre,
    clase,
    fecha: fechaDeDocumento(nombre, cabecera, referencia),
    ...codigoYVersion(nombre, cabecera),
    origen: c.origen,
  };
}

/**
 * Detecta en la carpeta de pliegos (y entre los «adicionales» publicados) las aclaraciones, la
 * normativa del cliente y el contrato, y los registra con su clase; lo que ya no está, se olvida.
 * Devuelve lo registrado. Sin índice de la Biblioteca, lo que ya estaba.
 */
export function registrarDocumentosDeCarpeta(
  db: Db,
  id: string,
  idx: indice.BaseDatos | null,
  ahora = new Date().toISOString(),
): DocumentoCarpeta[] {
  const l = obtenerLicitacion(db, id);
  if (!l || !idx) return documentosDeLicitacion(db, id);
  const carpeta = carpetaPliegos(db, l);
  const hallados = candidatos(db, id, carpeta, idx)
    .map((c) => detectar(c, carpeta, idx, l.fecha_limite ?? ahora))
    .filter((d): d is DocumentoCarpeta => d !== null);
  const guardar =
    db.prepare(`INSERT INTO documentos_licitacion (licitacion_id, ruta, clase, nombre, fecha, codigo, version, origen, detectado_en)
    VALUES (@id, @ruta, @clase, @nombre, @fecha, @codigo, @version, @origen, @ahora)
    ON CONFLICT(licitacion_id, ruta) DO UPDATE SET clase = excluded.clase, nombre = excluded.nombre, fecha = excluded.fecha,
      codigo = excluded.codigo, version = excluded.version, origen = excluded.origen`);
  db.transaction(() => {
    const rutas = new Set(hallados.map((d) => d.ruta));
    const antes = db.prepare('SELECT ruta FROM documentos_licitacion WHERE licitacion_id = ?').all(id) as {
      ruta: string;
    }[];
    for (const r of antes)
      if (!rutas.has(r.ruta))
        db.prepare('DELETE FROM documentos_licitacion WHERE licitacion_id = ? AND ruta = ?').run(id, r.ruta);
    for (const d of hallados) guardar.run({ id, ...d, ahora });
  })();
  return documentosDeLicitacion(db, id);
}

/** Lo registrado de una licitación: por clase y fecha. */
function documentosDeLicitacion(db: Db, id: string): DocumentoCarpeta[] {
  return db
    .prepare(
      `SELECT ruta, nombre, clase, fecha, codigo, version, origen FROM documentos_licitacion WHERE licitacion_id = ?
    ORDER BY clase, fecha IS NULL, fecha, ruta`,
    )
    .all(id) as DocumentoCarpeta[];
}
