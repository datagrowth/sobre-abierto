// Carpeta Empresa: documentos que valen para cualquier oferta (TGSS, AEAT, ROLECE, escrituras, seguros, títulos y CV).
import path from 'node:path';
import { z } from 'zod';
import { ahora, type Db } from './db.js';
import { guardarDocumentoNuevo } from './documentos.js';
import { fail, ok, type Result } from './result.js';
import { limpiarNombre } from './nombres.js';
import type { ArchivoRecibido } from './subidas.js';
import type { Permisos } from './agentes/permisos.js';
import { CARPETA_COLABORADORES, enColaboradores, puedeVerCvs } from './colaboradores/cvs.js';
import { horaLocalEspana } from './fechas.js';

// Cada documento lleva su caducidad. El archivo vive en la Biblioteca (Conocimiento/Empresa/<tipo>/; los de
// personas, en Colaboradores/Empresa/<tipo>/) y la fila en empresa_documentos; avisa 30 días antes de que venza,
// porque presentar un certificado caducado excluye la oferta.
const CARPETA_EMPRESA = 'Empresa';
const CADUCIDAD_AVISO_DIAS = 30;
export const MAX_DOCUMENTO_EMPRESA = 30 * 1024 * 1024;
export const EXTENSIONES_EMPRESA = ['.pdf', '.docx', '.jpg', '.png'];
const TIPOS_DOCUMENTO_EMPRESA = [
  'certificado',
  'rolece',
  'aeat',
  'tgss',
  'escritura',
  'seguro',
  'titulo',
  'cv',
  'otro',
] as const;
const DIA_MS = 86_400_000;

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');
const Campos = {
  tipo: z.enum(TIPOS_DOCUMENTO_EMPRESA),
  nombre: z.string().trim().min(2).max(200),
  persona_id: z.number().int().positive().nullable(),
  emitido_en: Fecha.nullable(),
  caduca_en: Fecha.nullable(),
  horas_desglosadas: z.boolean(),
  notas: z.string().max(2000),
};
const DocumentoEmpresa = z
  .object({
    ...Campos,
    persona_id: Campos.persona_id.default(null),
    emitido_en: Campos.emitido_en.default(null),
    caduca_en: Campos.caduca_en.default(null),
    horas_desglosadas: Campos.horas_desglosadas.default(false),
    notas: Campos.notas.default(''),
  })
  .strict();
// Sin defaults: lo que no se envía en un cambio se queda como estaba.
const CambioDocumentoEmpresa = z
  .object(Campos)
  .partial()
  .strict()
  .refine((c) => Object.keys(c).length > 0, 'Indica al menos un campo que cambiar.');
type DocumentoEmpresaData = z.infer<typeof DocumentoEmpresa>;

type EstadoCaducidad = 'vigente' | 'caduca_pronto' | 'caducado' | 'sin_fecha';
type Fila = Omit<DocumentoEmpresaData, 'horas_desglosadas'> & {
  id: number;
  ruta: string;
  horas_desglosadas: number;
  actualizado_en: string;
};
export type DocumentoEmpresaGuardado = DocumentoEmpresaData & {
  id: number;
  ruta: string;
  actualizado_en: string;
  estado: EstadoCaducidad;
  dias: number | null;
};
export type AvisoCaducidad = {
  id: number;
  tipo: string;
  nombre: string;
  ruta: string;
  caduca_en: string;
  dias: number;
  texto: string;
};

/** Hoy en España (AAAA-MM-DD): la caducidad se cuenta por días del calendario de aquí. */
export function hoyEspana(ms = Date.now()): string {
  return horaLocalEspana(ms).slice(0, 10);
}

function diasHasta(hoy: string, fecha: string): number {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA_MS);
}

function estadoCaducidad(caducaEn: string | null, hoy: string): { estado: EstadoCaducidad; dias: number | null } {
  if (!caducaEn) return { estado: 'sin_fecha', dias: null };
  const dias = diasHasta(hoy, caducaEn);
  if (dias < 0) return { estado: 'caducado', dias };
  return { estado: dias <= CADUCIDAD_AVISO_DIAS ? 'caduca_pronto' : 'vigente', dias };
}

function deFila(f: Fila, hoy: string): DocumentoEmpresaGuardado {
  return { ...f, horas_desglosadas: f.horas_desglosadas === 1, ...estadoCaducidad(f.caduca_en, hoy) };
}

const SELECT = `SELECT id, tipo, nombre, ruta, persona_id, emitido_en, caduca_en, horas_desglosadas, notas, actualizado_en FROM empresa_documentos`;

/** Todos los documentos, los que caducan antes primero (los que no tienen fecha, al final). */
export function listarDocumentosEmpresa(db: Db, hoy = hoyEspana()): DocumentoEmpresaGuardado[] {
  const filas = db.prepare(`${SELECT} ORDER BY caduca_en IS NULL, caduca_en, tipo, nombre`).all() as Fila[];
  return filas.map((f) => deFila(f, hoy));
}

function leerDocumento(db: Db, id: number, hoy: string): DocumentoEmpresaGuardado | null {
  const f = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Fila | undefined;
  return f ? deFila(f, hoy) : null;
}

function comprobarPersona(db: Db, personaId: number | null | undefined): Result<true> {
  if (personaId === null || personaId === undefined) return ok(true);
  const existe = db.prepare('SELECT 1 FROM personas WHERE id = ?').get(personaId);
  return existe ? ok(true) : fail('invalid_input', `No hay ninguna persona con id ${personaId} en Equipo.`);
}

function comprobarArchivo(archivo: ArchivoRecibido): Result<string> {
  const nombre = limpiarNombre(path.basename(archivo.nombre.replace(/\\/g, '/')), 150);
  if (!EXTENSIONES_EMPRESA.includes(path.extname(nombre).toLowerCase()))
    return fail('invalid_input', `Formato no admitido: sube un archivo ${EXTENSIONES_EMPRESA.join(', ')}.`);
  if (!archivo.datos.length) return fail('invalid_input', 'El archivo está vacío.');
  if (archivo.datos.length > MAX_DOCUMENTO_EMPRESA) return fail('too_large', 'El archivo pasa de 30 MB.');
  return ok(nombre);
}

// Los CV y lo ligado a una persona son datos personales: van bajo Colaboradores/, la carpeta que la
// Biblioteca, la búsqueda y las citas ya ocultan a quien no puede leer colaboradores.
function carpetaDe(d: Pick<DocumentoEmpresaData, 'tipo' | 'persona_id'>): string {
  const personal = d.tipo === 'cv' || d.persona_id !== null;
  return personal ? `${CARPETA_COLABORADORES}/${CARPETA_EMPRESA}/${d.tipo}` : `${CARPETA_EMPRESA}/${d.tipo}`;
}

/**
 * Guarda el archivo en Empresa/<tipo>/ de la Biblioteca (o en Colaboradores/Empresa/<tipo>/ si es de una persona) (sin pisar nunca otro: el nuevo lleva
 * sufijo) y registra la fila. El mismo archivo subido dos veces es un conflicto, no un duplicado.
 */
export async function subirDocumentoEmpresa(
  db: Db,
  raiz: string,
  archivo: ArchivoRecibido,
  datos: unknown,
): Promise<Result<DocumentoEmpresaGuardado>> {
  const d = DocumentoEmpresa.safeParse(datos);
  if (!d.success) return fail('invalid_input', z.prettifyError(d.error));
  const nombre = comprobarArchivo(archivo);
  if (nombre.error) return nombre;
  const persona = comprobarPersona(db, d.data.persona_id);
  if (persona.error) return persona;
  const g = await guardarDocumentoNuevo(db, raiz, {
    rel: `${carpetaDe(d.data)}/${nombre.data}`,
    bytes: archivo.datos,
    dominio: 'plataforma',
    origenUrl: null,
  });
  if (g.error) return g;
  const v = d.data;
  const r = db
    .prepare(
      `INSERT INTO empresa_documentos (tipo, nombre, ruta, persona_id, emitido_en, caduca_en, horas_desglosadas, notas, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ruta) DO NOTHING`,
    )
    .run(
      v.tipo,
      v.nombre,
      g.data.ruta,
      v.persona_id,
      v.emitido_en,
      v.caduca_en,
      v.horas_desglosadas ? 1 : 0,
      v.notas,
      ahora(),
    );
  if (r.changes === 0) return fail('conflicto', `Ese archivo ya está en la carpeta Empresa (${g.data.ruta}).`);
  return ok(leerDocumento(db, Number(r.lastInsertRowid), hoyEspana()) as DocumentoEmpresaGuardado);
}

const COLUMNAS_CAMBIO = [
  'tipo',
  'nombre',
  'persona_id',
  'emitido_en',
  'caduca_en',
  'horas_desglosadas',
  'notas',
] as const;

// El archivo no se mueve al cambiar la fila: un documento que pasa a ser personal (CV, o ligado a
// una persona) fuera de Colaboradores/ quedaría a la vista de quien no puede leer colaboradores.
function comprobarCarpeta(db: Db, id: number, c: z.infer<typeof CambioDocumentoEmpresa>): Result<true> {
  const f = db.prepare('SELECT tipo, persona_id, ruta FROM empresa_documentos WHERE id = ?').get(id) as
    Pick<Fila, 'tipo' | 'persona_id' | 'ruta'> | undefined;
  if (!f) return fail('not_found', 'No existe ese documento de la carpeta Empresa.');
  const tras = { tipo: c.tipo ?? f.tipo, persona_id: c.persona_id === undefined ? f.persona_id : c.persona_id };
  const personal = tras.tipo === 'cv' || tras.persona_id !== null;
  if (!personal || enColaboradores(f.ruta)) return ok(true);
  return fail(
    'invalid_input',
    'Un CV o un documento de una persona va en la carpeta de Colaboradores, que solo ve quien puede ver el equipo: bórralo y vuelve a subirlo como CV o con su persona.',
  );
}

/** Cambia los datos de la fila; el archivo se queda donde está aunque cambie el tipo (salvo que pase a ser personal: comprobarCarpeta). */
export function cambiarDocumentoEmpresa(db: Db, id: number, cambios: unknown): Result<DocumentoEmpresaGuardado> {
  const c = CambioDocumentoEmpresa.safeParse(cambios);
  if (!c.success) return fail('invalid_input', z.prettifyError(c.error));
  const persona = comprobarPersona(db, c.data.persona_id);
  if (persona.error) return persona;
  const carpeta = comprobarCarpeta(db, id, c.data);
  if (carpeta.error) return carpeta;
  // Los nombres de columna salen de una lista fija del código; los valores van parametrizados.
  const cols = COLUMNAS_CAMBIO.filter((k) => c.data[k] !== undefined);
  const valores = cols.map((k) => (k === 'horas_desglosadas' ? (c.data[k] ? 1 : 0) : c.data[k]));
  const r = db
    .prepare(`UPDATE empresa_documentos SET ${cols.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
    .run(...valores, ahora(), id);
  if (r.changes === 0) return fail('not_found', 'No existe ese documento de la carpeta Empresa.');
  return ok(leerDocumento(db, id, hoyEspana()) as DocumentoEmpresaGuardado);
}

/** Quita el documento de la carpeta Empresa; el archivo de Drive no se borra nunca. */
export function borrarDocumentoEmpresa(db: Db, id: number): Result<{ borrado: true; ruta: string }> {
  const f = db.prepare('SELECT ruta FROM empresa_documentos WHERE id = ?').get(id) as { ruta: string } | undefined;
  if (!f) return fail('not_found', 'No existe ese documento de la carpeta Empresa.');
  db.prepare('DELETE FROM empresa_documentos WHERE id = ?').run(id);
  return ok({ borrado: true, ruta: f.ruta });
}

const ETIQUETA: Record<string, string> = {
  tgss: 'El certificado de la TGSS',
  aeat: 'El certificado de la AEAT',
  rolece: 'La inscripción en el ROLECE',
  certificado: 'El certificado',
  escritura: 'La escritura',
  seguro: 'El seguro',
  titulo: 'El título',
  cv: 'El CV',
  otro: 'El documento',
};

function fechaEs(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function textoAviso(tipo: string, caducaEn: string, dias: number): string {
  const que = ETIQUETA[tipo] ?? 'El documento';
  if (dias < 0) return `${que} caducó el ${fechaEs(caducaEn)} (hace ${-dias} ${-dias === 1 ? 'día' : 'días'})`;
  if (dias === 0) return `${que} caduca hoy, ${fechaEs(caducaEn)}`;
  return `${que} caduca el ${fechaEs(caducaEn)} (en ${dias} ${dias === 1 ? 'día' : 'días'})`;
}

/** Lo caducado y lo que caduca en 30 días o menos, para «Hoy». */
export function avisosCaducidad(db: Db, hoy = hoyEspana()): AvisoCaducidad[] {
  return listarDocumentosEmpresa(db, hoy)
    .filter((d) => (d.estado === 'caduca_pronto' || d.estado === 'caducado') && d.caduca_en !== null && d.dias !== null)
    .map((d) => ({
      id: d.id,
      tipo: d.tipo,
      nombre: d.nombre,
      ruta: d.ruta,
      caduca_en: d.caduca_en as string,
      dias: d.dias as number,
      texto: textoAviso(d.tipo, d.caduca_en as string, d.dias as number),
    }));
}

export type DocumentoParaAgente = {
  tipo: string;
  nombre: string;
  ruta: string;
  caduca_en: string | null;
  estado: EstadoCaducidad;
};

/**
 * Lo que ve un agente en plataforma_empresa. Los CV y lo que va ligado a una persona (sus
 * títulos) son datos personales: solo los ve quien puede leer colaboradores, como en la Biblioteca.
 */
export function documentosParaAgente(db: Db, permisos: Permisos, hoy = hoyEspana()): DocumentoParaAgente[] {
  const verPersonas = puedeVerCvs(permisos);
  return listarDocumentosEmpresa(db, hoy)
    .filter((d) => verPersonas || (d.tipo !== 'cv' && d.persona_id === null))
    .map((d) => ({ tipo: d.tipo, nombre: d.nombre, ruta: d.ruta, caduca_en: d.caduca_en, estado: d.estado }));
}
