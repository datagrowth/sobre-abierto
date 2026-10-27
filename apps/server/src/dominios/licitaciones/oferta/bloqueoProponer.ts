// Hermes propone cómo resolver un bloqueo de las comprobaciones; nunca se aplica solo.
import path from 'node:path';
import { z } from 'zod';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { puede } from '../../../nucleo/agentes/permisos.js';
import { obtenerPersona } from '../../../nucleo/colaboradores/personas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import {
  archivoExistente,
  documentoEnDisco,
  esRutaDocumento,
  RutaDocumento,
  textoDe,
  type Raices,
} from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { comprobacionesDe } from './comprobaciones.js';
import { avisarComprobaciones } from './comprobacionesBloqueos.js';
import type { Bloqueo } from './comprobacionesTipos.js';
import { localizarCitas } from './evaluacionMemoria.js';
import * as indice from '../../../biblioteca/motor/documentos/almacen.js';
import { abrirIndiceLectura } from '../../../biblioteca/motor/documentos/servicioIndice.js';
import { comprobadorDe, type Comprobador } from '../citasPliego.js';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');
const Pagina = z.number().int().min(1).max(5000);

// La propuesta puede ser desmarcar un criterio, asignar a una persona a un rol, vincular un documento, una
// consulta al órgano o un borrador del Anexo XIV. Cada cita se comprueba literal contra su documento, porque
// una cita inventada convence a quien revisa igual que una de verdad. Nunca se aplica: la propuesta queda en
// oferta_bloqueos con la huella de la fila y la aplica una persona desde las comprobaciones.
const CitaPropuesta = z.strictObject({
  documento: z.string().trim().min(3).max(500).describe('Ruta del pliego, Biblioteca o Salidas'),
  pagina: Pagina.nullable(),
  texto: z.string().trim().min(20).max(1000),
});
export type CitaPropuesta = z.infer<typeof CitaPropuesta>;

// Precio, «dar por buena», riesgo aceptado y registro no son tipos: son decisiones de una persona.
const TIPOS_PROPUESTA = [
  'desmarcar_criterio',
  'asignar_persona',
  'vincular_documento',
  'consulta_organo',
  'borrador_anexo_xiv',
] as const;

const DatosPropuesta = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('desmarcar_criterio'),
    criterio: z.string().trim().min(2).max(300),
    lote: z.string().trim().min(1).max(80).nullable(),
  }),
  z.strictObject({
    tipo: z.literal('asignar_persona'),
    persona_id: z.number().int().positive(),
    rol: z.string().trim().min(2).max(200),
    cv_ruta: z.string().trim().min(3).max(500),
    cv_pagina: Pagina.nullable(),
  }),
  z.strictObject({ tipo: z.literal('vincular_documento'), ruta: RutaDocumento, vigente_hasta: Fecha.nullable() }),
  z.strictObject({ tipo: z.literal('consulta_organo'), texto: z.string().trim().min(20).max(4000) }),
  z.strictObject({ tipo: z.literal('borrador_anexo_xiv'), texto: z.string().trim().min(20).max(8000) }),
]);
type DatosPropuesta = z.infer<typeof DatosPropuesta>;

export const BloqueoPropuestaEntrada = z
  .strictObject({
    id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
    clave: z
      .string()
      .trim()
      .min(3)
      .max(300)
      .describe('Clave del bloqueo de las comprobaciones (licitaciones_oferta › bloqueos[].clave)'),
    tipo: z.enum(TIPOS_PROPUESTA),
    resumen: z.string().trim().min(10).max(600),
    citas: z.array(CitaPropuesta).min(1).max(5),
    datos: DatosPropuesta,
  })
  .refine((e) => e.tipo === e.datos.tipo, {
    message: '«datos.tipo» tiene que ser el mismo que «tipo».',
    path: ['datos', 'tipo'],
  });
export type BloqueoPropuestaEntrada = z.infer<typeof BloqueoPropuestaEntrada>;

export type PropuestaGuardadaBloqueo = { clave: string; estado: 'propuesta' };

const log = logger('licitaciones');
const MARCA_PAGINA = /\[pág\. (\d+)\]/g;
const ABIERTOS: ReadonlySet<Bloqueo['estado']> = new Set(['abierto', 'propuesta']);
const comparable = (t: string) => textoComparable(t).trim();

const noConocido = (documento: string) =>
  `No conozco ese documento: «${documento}». Cita un pliego de la licitación (su nombre o su ruta), un documento de la Biblioteca («Conocimiento/…») o de Salidas («Salidas/…»).`;

// Un pliego se cita por su nombre, su ruta en Conocimiento o el nombre del archivo.
function pliegoCitado(db: Db, id: string, documento: string): string | null {
  const filas = db
    .prepare(
      "SELECT nombre, ruta FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL ORDER BY rowid",
    )
    .all(id) as { nombre: string; ruta: string }[];
  const buscado = comparable(documento.replace(/\\/g, '/').replace(/^Conocimiento\//, ''));
  return (
    filas.find((f) => [f.nombre, f.ruta, path.posix.basename(f.ruta)].some((x) => comparable(x) === buscado))?.ruta ??
    null
  );
}

/** La ruta en disco del documento citado: un pliego de la licitación, de la Biblioteca o de Salidas; si no, null. */
function documentoCitado(db: Db, raices: Raices, id: string, documento: string): string | null {
  const pliego = pliegoCitado(db, id, documento);
  if (pliego) return documentoEnDisco(raices, `Conocimiento/${pliego}`).data;
  return esRutaDocumento(documento) ? archivoExistente(raices, documento).data : null;
}

/** El texto de la página `n` (marcas [pág. N]); un documento sin páginas se lee entero. Null si no tiene esa página. */
export function paginaDe(texto: string, n: number): string | null {
  const marcas = [...texto.matchAll(MARCA_PAGINA)];
  if (!marcas.length) return texto;
  const i = marcas.findIndex((m) => Number(m[1]) === n);
  if (i < 0) return null;
  const desde = marcas[i]!.index + marcas[i]![0].length;
  return texto.slice(desde, marcas[i + 1]?.index ?? texto.length);
}

async function leerTexto(abs: string, documento: string): Promise<Result<string>> {
  const r = await textoDe(abs).catch((err: unknown) => fail<string>('read_error', errorMessage(err)));
  return r.error ? fail('read_error', `No pude leer «${documento}»: ${r.error.message}`) : r;
}

function problemaDeCita(texto: string, c: CitaPropuesta): string | null {
  const donde = c.pagina === null ? texto : paginaDe(texto, c.pagina);
  if (donde === null) return `«${c.documento}» no tiene página ${c.pagina}.`;
  if (localizarCitas([donde], [c.texto])[0] !== null) return null;
  const pagina = c.pagina === null ? '' : ` (pág. ${c.pagina})`;
  const inicio = c.texto.length > 40 ? `${c.texto.slice(0, 40)}…` : c.texto;
  return `La cita «${inicio}» no está en «${c.documento}»${pagina}: copia la frase literal.`;
}

// Un pliego ya leído en el índice de la Biblioteca se comprueba ahí, sin volver a leer el
// PDF, y la cita tiene que estar en la página que dice. null: el índice no lo tiene, se lee el archivo.
function problemaEnIndice(comprobar: Comprobador, ruta: string, c: CitaPropuesta): string | null | undefined {
  const r = comprobar(c.texto, ruta);
  if (r.estado === 'sin_indice') return undefined;
  const inicio = c.texto.length > 40 ? `${c.texto.slice(0, 40)}…` : c.texto;
  if (r.estado === 'no_localizada') return `La cita «${inicio}» no está en «${c.documento}»: copia la frase literal.`;
  if (c.pagina !== null && r.pagina !== null && r.pagina !== c.pagina)
    return `La cita «${inicio}» está en la página ${r.pagina} de «${c.documento}», no en la ${c.pagina}: corrige la página.`;
  return null;
}

/** Por cada cita que no está literal en su documento (o cuyo documento no conozco), el porqué. Vacío si todas están. */
export async function comprobarCitas(
  db: Db,
  raices: Raices,
  id: string,
  citas: readonly CitaPropuesta[],
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): Promise<string[]> {
  const leidos = new Map<string, Result<string>>();
  const problemas: string[] = [];
  const comprobar = comprobadorDe(db, idx, id);
  for (const c of citas) {
    const pliego = pliegoCitado(db, id, c.documento);
    const enIndice = pliego ? problemaEnIndice(comprobar, pliego, c) : undefined;
    if (enIndice !== undefined) {
      if (enIndice) problemas.push(enIndice);
      continue;
    }
    const abs = documentoCitado(db, raices, id, c.documento);
    if (!abs) {
      problemas.push(noConocido(c.documento));
      continue;
    }
    if (!leidos.has(abs)) leidos.set(abs, await leerTexto(abs, c.documento));
    const texto = leidos.get(abs)!;
    const p = texto.error ? texto.error.message : problemaDeCita(texto.data, c);
    if (p) problemas.push(p);
  }
  return problemas;
}

// Lo que la propuesta nombra tiene que existir: una persona activa o un documento que se pueda abrir.
function problemasDeDatos(raices: Raices, d: DatosPropuesta): string[] {
  if (d.tipo === 'asignar_persona' && obtenerPersona(nucleo().db, d.persona_id).error)
    return [`No hay ningún colaborador con id ${d.persona_id}.`];
  if (d.tipo === 'vincular_documento' && archivoExistente(raices, d.ruta).error)
    return [`No existe el documento «${d.ruta}» en la Biblioteca ni en Salidas.`];
  return [];
}

function bloqueoAbierto(db: Db, id: string, clave: string): Result<Bloqueo> {
  const c = comprobacionesDe(db, nucleo().db, id);
  if (c.error) return c;
  const b = c.data.bloqueos.find((x) => x.clave === clave);
  if (!b)
    return fail(
      'not_found',
      `«${clave}» no es un bloqueo de las comprobaciones de ahora: usa una clave de licitaciones_oferta › bloqueos.`,
    );
  return ABIERTOS.has(b.estado)
    ? ok(b)
    : fail('conflicto', `El bloqueo «${clave}» ya está cerrado (${b.estado}): no hace falta proponer nada.`);
}

// `campos` es lo que cuenta la fila de las comprobaciones (PropuestaHermes): cuántos datos cambiaría.
function guardar(db: Db, e: BloqueoPropuestaEntrada, b: Bloqueo, quien: string): Result<null> {
  const propuesta = { tipo: e.tipo, resumen: e.resumen, datos: e.datos, campos: Object.keys(e.datos).length - 1 };
  try {
    db.prepare(
      'INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, propuesta_json, evidencia_json, quien, motivo, en) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
    ).run(
      e.id,
      b.clave,
      b.huella,
      'propuesta',
      JSON.stringify(propuesta),
      JSON.stringify(e.citas),
      quien,
      new Date().toISOString(),
    );
    return ok(null);
  } catch (err) {
    log.error('propuesta de bloqueo sin guardar', { id: e.id, clave: b.clave, error: errorMessage(err) });
    return fail('io_error', 'No se pudo guardar la propuesta.');
  }
}

/** Guarda la propuesta de Hermes para un bloqueo abierto si todas sus citas están literales. Nunca la aplica. */
export async function proponerBloqueo(
  db: Db,
  raices: Raices,
  e: BloqueoPropuestaEntrada,
  agente: Agente,
): Promise<Result<PropuestaGuardadaBloqueo>> {
  if (e.datos.tipo === 'asignar_persona' && !puede(agente.permisos, 'colaboradores', 'leer')) {
    return fail('forbidden', 'Asignar a una persona necesita permiso para leer colaboradores.');
  }
  const b = bloqueoAbierto(db, e.id, e.clave);
  if (b.error) return b;
  const problemas = [...(await comprobarCitas(db, raices, e.id, e.citas)), ...problemasDeDatos(raices, e.datos)];
  if (problemas.length) return fail('invalid_input', problemas.join('\n'));
  const g = guardar(db, e, b.data, agente.nombre);
  if (g.error) return g;
  const nueva = comprobacionesDe(db, nucleo().db, e.id);
  if (nueva.data) avisarComprobaciones(e.id, nueva.data.version);
  return ok({ clave: b.data.clave, estado: 'propuesta' });
}
