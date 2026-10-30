// Lo que envía Hermes con licitaciones_anexo y cómo se guarda el anexo rellenado: en Salidas, sin
// pisar nada, y en su fila de la checklist con lo que lleva.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { limpiarNombre } from '../../../nucleo/nombres.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, RutaDocumento, type Raices } from '../../../nucleo/salidas.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import type { Db } from '../store.js';
import { decisionesDe } from './decisiones.js';
import type { PlanAnexoData } from './anexoPlan.js';
import { SeccionesAnexo, seccionesDeAnexo } from './dependenciasAnexo.js';
import type { DocumentoConClave } from './documentos.js';
import { CLAVE, TIPO_ANEXO } from './anexosTrabajo.js';

const Sustitucion = z.strictObject({
  parrafo: z.number().int().min(1).describe('Número del párrafo en la tarea'),
  original: z
    .string()
    .min(1)
    .max(1000)
    .describe('Trozo literal del párrafo con la etiqueta y el hueco, p. ej. «con NIF ……»'),
  nuevo: z.string().max(1000).describe('El mismo trozo con el dato en el hueco, p. ej. «con NIF B12345678»'),
  dato: z.string().trim().min(1).max(120).describe('Campo de la hoja de datos del que sale, p. ej. «NIF»'),
  fuentes: z
    .array(z.strictObject({ ruta: RutaDocumento, pagina: z.number().int().min(1).optional() }))
    .max(5)
    .optional()
    .describe('Solo con dato «Redacción»: documentos de Biblioteca o Salidas de los que sale el texto'),
});
const CampoRelleno = z.strictObject({
  nombre: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Nombre exacto del campo del formulario PDF, como en la lista de la tarea'),
  valor: z
    .union([z.string().max(1000), z.boolean()])
    .describe('Texto; true o false en una casilla; una de las opciones en un grupo de opciones o un desplegable'),
  dato: z.string().trim().min(1).max(120).describe('Campo de la hoja de datos del que sale, p. ej. «NIF»'),
});
// Un modelo Word se rellena con rango y sustituciones; un PDF con formulario, con campos.
export const AnexoEntrada = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  clave: z
    .string()
    .regex(CLAVE, 'clave «a<archivo>-d<documento>», p. ej. «a2-d1»')
    .describe('La clave del documento que dio la tarea'),
  desde_parrafo: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Solo en un modelo Word: párrafo con el título del modelo («ANEXO …»)'),
  hasta_parrafo: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Solo en un modelo Word: último párrafo del modelo, antes del siguiente anexo'),
  sustituciones: z.array(Sustitucion).max(200).optional().describe('Solo en un modelo Word: una por hueco'),
  campos: z
    .array(CampoRelleno)
    .max(300)
    .optional()
    .describe('Solo en un modelo PDF con formulario: uno por campo que se rellena'),
});
export type AnexoEntradaData = z.infer<typeof AnexoEntrada>;
export type SustitucionData = NonNullable<AnexoEntradaData['sustituciones']>[number];

export const digitos = (t: string) => t.replace(/\D/g, '');

export type Escrito = { ruta: string; ruta_pdf: string | null; version: number };

/** La carpeta de Salidas donde van los anexos rellenados de una licitación. */
export const carpetaAnexos = (l: { id: string; expediente: string }): string => `${carpetaSalidas(l)}/anexos`;
/** El nombre del archivo del anexo, sin versión ni extensión («Anexo VI lote 2»). */
export const archivoDeAnexo = (d: DocumentoConClave): string =>
  d.lote ? `${d.doc.nombre} lote ${d.lote}` : d.doc.nombre;

// «wx»: nunca se pisa lo que ya está en Salidas (alguien pudo editarlo y firmarlo en Drive).
// Con un modelo Word va el .docx y, si se pudo, su PDF; con un PDF con formulario, solo el PDF rellenado como principal.
export function escribirAnexo(
  raices: Raices,
  carpeta: string,
  nombre: string,
  a: { docx: Buffer | null; pdf: Buffer | null },
): Result<Escrito> {
  const dir = documentoEnDisco(raices, carpeta);
  if (dir.error) return dir;
  const limpio = limpiarNombre(nombre, 80).replace(/[.\s]+$/, '') || 'anexo';
  try {
    fs.mkdirSync(dir.data, { recursive: true });
    let v = 1;
    while (['.docx', '.pdf'].some((ext) => fs.existsSync(path.join(dir.data, `${limpio}-v${v}${ext}`)))) v += 1;
    const poner = (ext: string, b: Buffer) => {
      fs.writeFileSync(path.join(dir.data, `${limpio}-v${v}${ext}`), b, { flag: 'wx' });
      return `${carpeta}/${limpio}-v${v}${ext}`;
    };
    const docx = a.docx ? poner('.docx', a.docx) : null;
    const pdf = a.pdf ? poner('.pdf', a.pdf) : null;
    const ruta = docx ?? pdf;
    return ruta === null
      ? fail('invalid_input', 'No hay nada que guardar.')
      : ok({ ruta, ruta_pdf: docx ? pdf : null, version: v });
  } catch (err) {
    return fail('io_error', `No se pudo guardar el anexo en Salidas: ${errorMessage(err).slice(0, 300)}`);
  }
}

export type AnexoRecibido = {
  clave: string;
  ruta: string;
  ruta_pdf: string | null;
  version: number;
  aplicadas: number;
  avisos: string[];
};
export type OpcionesAnexo = { revisar?: boolean; hoy?: Date };

// Lo que lleva el anexo recibido: lo guardado al pedirlo si su run está en marcha (las decisiones
// pudieron cambiar mientras corría) y, si no, lo de las decisiones de ahora (null sin decisiones).
function dependenciasAlRecibir(db: Db, e: AnexoEntradaData, d: DocumentoConClave): SeccionesAnexo | null {
  const t = db
    .prepare(
      `SELECT json_extract(payload, '$.dependencias') AS dep FROM nucleo.trabajos_ia WHERE tipo = ? AND estado = 'lanzado'
    AND json_extract(payload, '$.id') = ? AND json_extract(payload, '$.clave') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(TIPO_ANEXO, e.id, e.clave) as { dep: string | null } | undefined;
  const pedidas = t?.dep ? SeccionesAnexo.safeParse(JSON.parse(t.dep)) : null;
  if (pedidas?.success) return pedidas.data;
  const dec = decisionesDe(db, e.id);
  return dec ? seccionesDeAnexo(d.doc.tipo, d.lote, dec.datos) : null;
}

// El plan va en `sustituciones`; `cambios_huecos` se vacía porque el anexo nuevo ya parte de los datos de ahora.
export function guardarAnexo(
  db: Db,
  e: AnexoEntradaData,
  r: { w: Escrito; avisos: string[]; d: DocumentoConClave; plan: PlanAnexoData },
): void {
  const { w, avisos } = r;
  const ts = new Date().toISOString();
  const dep = dependenciasAlRecibir(db, e, r.d);
  db.prepare(
    `UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, ruta_pdf = ?, avisos = ?, anexo_en = ?, actualizado_en = ?, anexo_dependencias = ?,
    sustituciones = ?, cambios_huecos = NULL WHERE licitacion_id = ? AND clave = ?`,
  ).run(
    w.ruta,
    w.ruta_pdf,
    JSON.stringify(avisos),
    ts,
    ts,
    dep ? JSON.stringify(dep) : null,
    JSON.stringify(r.plan),
    e.id,
    e.clave,
  );
  emitir(db, {
    tipo: 'licitacion.documentos',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { accion: 'anexo', clave: e.clave, version: w.version, avisos: avisos.length },
  });
}
