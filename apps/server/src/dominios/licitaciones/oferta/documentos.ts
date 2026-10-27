// Checklist de la presentación: una fila por documento que pide el guion vigente, con su estado, dónde está y una nota.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { RutaDocumento } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { decisionesDe, lotesDecididos } from './decisiones.js';
import { guionVigente, type GuionBaseData, type GuionGuardado } from './guion.js';
import { lotesDeMemoria } from './memoriaLote.js';

// Clave estable «a<i>-d<j>»; «a<i>-d<j>-l<lote>», una por lote decidido, si el archivo va «por_lote» o el documento cita sus lotes.
// Leerla no escribe: lo que aún no tiene fila sale
// «pendiente» sin guardarse. Se sincroniza al escribir y cuando cambian el guion, los lotes o
// un borrador (documentosSync.ts): los documentos nuevos del guion entran pendientes y los que
// ya no están se ocultan (no se borran: si vuelven, vuelven con lo que tenían). Cada fila guarda
// su identidad (nombre, modelo y lote): si el guion nuevo mueve un documento de posición, su
// fila nueva hereda lo que tenía. La memoria pasa sola a «preparado» cuando una persona acepta
// la memoria ensamblada. Marcar «preparado» es cosa de una persona: nada se presenta solo.

// Hay una fila por cada documento de cada archivo electrónico del guion.
const ESTADOS_DOCUMENTO = ['pendiente', 'borrador', 'preparado', 'no_aplica'] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];
type DocumentoGuion = GuionBaseData['archivos'][number]['documentos'][number];
export type DocumentoConClave = { clave: string; archivo: string; doc: DocumentoGuion; lote: string | null };

export type FilaDocumento = {
  licitacion_id: string;
  clave: string;
  nombre: string;
  estado: EstadoDocumento;
  ruta: string | null;
  ruta_pdf: string | null;
  nota: string | null;
  avisos: string;
  oculto: number;
  anexo_en: string | null;
  anexo_modelo: string | null;
  actualizado_en: string;
  identidad: string | null;
  anexo_dependencias?: string | null;
  sustituciones: string | null;
  cambios_huecos: string | null;
};

export type DocumentoOferta = {
  clave: string;
  archivo: string;
  lote: string | null;
  nombre: string;
  tipo: DocumentoGuion['tipo'];
  obligatorio: boolean;
  produce: DocumentoGuion['produce'];
  origen: DocumentoGuion['origen'] | null;
  estado: EstadoDocumento;
  ruta: string | null;
  ruta_pdf: string | null;
  nota: string | null;
  actualizado_en: string;
  avisos: string[];
};

export type ResumenDocumentos = { total: number; preparados: number; pendientes_obligatorios: number };

const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

type Archivo = GuionBaseData['archivos'][number];

// Los lotes con fila propia: los decididos de los que cita el documento o, en un archivo que
// va «por_lote», todos los decididos. La memoria, una fila por lote si el pliego pide una por lote
// aunque vaya en un archivo único (memoriaPorLote = los lotes con memoria propia). null: una sola fila, sin lote.
function lotesDeFila(
  a: Archivo,
  doc: DocumentoGuion,
  lotes: string[],
  memoriaPorLote: string[] | null,
): string[] | null {
  if (doc.lotes?.length) return doc.lotes.filter((l) => lotes.includes(l));
  if (doc.tipo === 'memoria' && memoriaPorLote) return memoriaPorLote;
  return a.ambito === 'por_lote' && lotes.length ? lotes : null;
}

/**
 * Los documentos del guion con su clave «a<archivo>-d<documento>» (1-based) y, con lotes
 * (`lotes`: los decididos), una fila por lote con «-l<lote>» donde va por lote.
 */
export function documentosDelGuion(g: GuionBaseData, lotes: string[] = g.lotes ?? []): DocumentoConClave[] {
  const memoriaPorLote = lotesDeMemoria(g, lotes);
  return g.archivos.flatMap((a, i) =>
    a.documentos.flatMap((doc, j): DocumentoConClave[] => {
      const clave = `a${i + 1}-d${j + 1}`;
      const deFila = lotesDeFila(a, doc, lotes, memoriaPorLote);
      return deFila === null
        ? [{ clave, archivo: a.nombre, doc, lote: null }]
        : deFila.map((lote) => ({ clave: `${clave}-l${lote}`, archivo: a.nombre, doc, lote }));
    }),
  );
}

const CLAVE_LOTE = /^(a(\d{1,2})-d(\d{1,2}))(?:-l([A-Za-z0-9._-]{1,20}))?$/;

/** El documento de una clave (con su lote, si la clave lo lleva), aunque el lote ya no esté decidido. */
export function documentoDelGuion(g: GuionBaseData, clave: string): DocumentoConClave | null {
  const m = CLAVE_LOTE.exec(clave);
  const a = m ? g.archivos[Number(m[2]) - 1] : undefined;
  const doc = a?.documentos[Number(m![3]) - 1];
  return a && doc ? { clave, archivo: a.nombre, doc, lote: m![4] ?? null } : null;
}

export function filaDocumento(db: Db, id: string, clave: string): FilaDocumento | null {
  return (
    (db.prepare('SELECT * FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?').get(id, clave) as
      FilaDocumento | undefined) ?? null
  );
}

/** Lo que identifica a un documento aunque el guion lo cambie de posición: nombre, modelo y lote. */
function identidadDe(d: DocumentoConClave): string {
  return `${comparable(d.doc.nombre)}|${comparable(d.doc.origen?.modelo ?? '')}|${d.lote ?? ''}`;
}

// La fila común («a2-d1») de la que nace una fila por lote («a2-d1-l2»): un guion que antes no
// separaba por lote y ahora sí no debe perder lo ya hecho.
function filaComun(d: DocumentoConClave, filas: Map<string, FilaDocumento>): FilaDocumento | undefined {
  if (d.lote === null) return undefined;
  const comun = filas.get(d.clave.slice(0, d.clave.length - `-l${d.lote}`.length));
  return comun &&
    comparable(comun.nombre) === comparable(d.doc.nombre) &&
    (comun.ruta !== null || comun.estado !== 'pendiente')
    ? comun
    : undefined;
}

const archivoDe = (clave: string): string | null => /^a(\d{1,2})-/.exec(clave)?.[1] ?? null;

// La fila que tenía este mismo documento en otra posición del guion anterior. Solo si esa
// posición ya no lo tiene, mejor la del mismo archivo y ninguna dos veces: dos documentos iguales
// en dos archivos que se mueven a la vez no se copian el uno al otro (a1-d1 → a1-d2, a2-d1 → a2-d2).
function filaMovida(d: DocumentoConClave, ctx: Contexto): FilaDocumento | undefined {
  const id = identidadDe(d);
  const libres = [...ctx.filas.values()].filter(
    (f) =>
      f.clave !== d.clave && f.identidad === id && ctx.identidades.get(f.clave) !== id && !ctx.heredadas.has(f.clave),
  );
  const elegida = libres.find((f) => archivoDe(f.clave) === archivoDe(d.clave)) ?? libres[0];
  if (elegida) ctx.heredadas.add(elegida.clave);
  return elegida;
}

// El plan del anexo (sustituciones) y sus huecos cambiados viajan con el documento movido; la fila
// común no los pasa a sus lotes, como sus dependencias: su plan es de otro lote.
type Contenido = Pick<
  FilaDocumento,
  'estado' | 'ruta' | 'ruta_pdf' | 'nota' | 'avisos' | 'anexo_en' | 'anexo_modelo' | 'sustituciones' | 'cambios_huecos'
> & { anexo_dependencias: string | null };
// identidades: la de cada clave del guion nuevo; heredadas: las filas que ya copió otra posición.
type Contexto = {
  filas: Map<string, FilaDocumento>;
  identidades: Map<string, string>;
  hermanas: number;
  heredadas: Set<string>;
};

// Con más de un lote heredero, lo «preparado» pasa a borrador: valía para el contrato entero, no se sabe si para este lote.
function deLaComun(d: DocumentoConClave, c: FilaDocumento, hermanas: number): Contenido {
  const varias = hermanas > 1;
  const aviso = varias
    ? [`Viene del documento común, de antes de separar por lotes: compruébalo para el lote ${d.lote}.`]
    : [];
  return {
    estado: varias && c.estado === 'preparado' ? 'borrador' : c.estado,
    ruta: c.ruta,
    ruta_pdf: c.ruta_pdf,
    nota: c.nota,
    avisos: JSON.stringify([...(JSON.parse(c.avisos) as string[]), ...aviso]),
    anexo_en: c.anexo_en,
    anexo_modelo: c.anexo_modelo,
    anexo_dependencias: null,
    sustituciones: null,
    cambios_huecos: null,
  };
}

const copia = (f: FilaDocumento): Contenido => ({
  estado: f.estado,
  ruta: f.ruta,
  ruta_pdf: f.ruta_pdf,
  nota: f.nota,
  avisos: f.avisos,
  anexo_en: f.anexo_en,
  anexo_modelo: f.anexo_modelo,
  anexo_dependencias: f.anexo_dependencias ?? null,
  sustituciones: f.sustituciones,
  cambios_huecos: f.cambios_huecos,
});
const VACIA: Contenido = {
  estado: 'pendiente',
  ruta: null,
  ruta_pdf: null,
  nota: null,
  avisos: '[]',
  anexo_en: null,
  anexo_modelo: null,
  anexo_dependencias: null,
  sustituciones: null,
  cambios_huecos: null,
};

// Lo que hereda una posición que no tiene ya este documento: el mismo documento movido, la fila común de antes de los lotes o nada.
function heredado(d: DocumentoConClave, ctx: Contexto): Contenido | null {
  const movida = filaMovida(d, ctx);
  if (movida) return copia(movida);
  const comun = ctx.filas.has(d.clave) ? undefined : filaComun(d, ctx.filas);
  return comun ? deLaComun(d, comun, ctx.hermanas) : null;
}

function escribirFila(db: Db, id: string, d: DocumentoConClave, c: Contenido): void {
  db.prepare(
    `INSERT INTO oferta_documentos (licitacion_id, clave, nombre, estado, ruta, ruta_pdf, nota, avisos, oculto, anexo_en, anexo_modelo, anexo_dependencias, actualizado_en, identidad, sustituciones, cambios_huecos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (licitacion_id, clave) DO UPDATE SET nombre = excluded.nombre, estado = excluded.estado,
    ruta = excluded.ruta, ruta_pdf = excluded.ruta_pdf, nota = excluded.nota, avisos = excluded.avisos, oculto = 0, anexo_en = excluded.anexo_en,
    anexo_modelo = excluded.anexo_modelo, anexo_dependencias = excluded.anexo_dependencias, actualizado_en = excluded.actualizado_en, identidad = excluded.identidad,
    sustituciones = excluded.sustituciones, cambios_huecos = excluded.cambios_huecos`,
  ).run(
    id,
    d.clave,
    d.doc.nombre,
    c.estado,
    c.ruta,
    c.ruta_pdf,
    c.nota,
    c.avisos,
    c.anexo_en,
    c.anexo_modelo,
    c.anexo_dependencias,
    new Date().toISOString(),
    identidadDe(d),
    c.sustituciones,
    c.cambios_huecos,
  );
}

// Si en la misma posición el guion nuevo trae otro documento, la fila toma lo del mismo documento
// en su posición anterior o empieza de cero.
function sincronizarFila(db: Db, id: string, d: DocumentoConClave, ctx: Contexto): void {
  const fila = ctx.filas.get(d.clave);
  if (fila && comparable(fila.nombre) === comparable(d.doc.nombre)) {
    if (fila.oculto || fila.identidad !== identidadDe(d)) {
      db.prepare('UPDATE oferta_documentos SET oculto = 0, identidad = ? WHERE licitacion_id = ? AND clave = ?').run(
        identidadDe(d),
        id,
        d.clave,
      );
    }
    return;
  }
  escribirFila(db, id, d, heredado(d, ctx) ?? VACIA);
}

// Una versión subida en PDF (subidaFlexible.ts) también es de la plataforma, no puesta a mano.
const RUTA_MEMORIA = /\/memoria-v\d+(?:-\d+)?\.(?:docx|pdf)$/;

type MemoriaAceptada = { ruta: string; ruta_pdf: string | null };

// La aceptada más reciente; en la fila de un lote, la de su lote o, si aún no hay, la común
// (lote null; un borrador sin memoria cuenta como común). Si la común va en dos lotes, el
// paquete lo bloquea (paqueteComprobaciones.ts, deMemoriaPorLote).
function memoriaAceptada(db: Db, id: string, lote: string | null): MemoriaAceptada | undefined {
  const sql = (
    delLote: string,
  ) => `SELECT b.ruta, b.ruta_pdf FROM borradores b LEFT JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND b.estado = 'aceptada' ${delLote} ORDER BY b.version DESC, b.id DESC LIMIT 1`;
  if (lote === null) return db.prepare(sql('')).get(id) as MemoriaAceptada | undefined;
  return (db.prepare(sql('AND m.lote = ?')).get(id, lote) ?? db.prepare(sql('AND m.lote IS NULL')).get(id)) as
    MemoriaAceptada | undefined;
}

// La memoria aceptada pasa a la fila de la memoria (con memoria por lote, la de su lote), salvo
// que una persona haya puesto ahí otro documento o la haya marcado «no aplica».
function memoriaPreparada(db: Db, id: string, docs: DocumentoConClave[], ts: string): void {
  for (const d of docs.filter((x) => x.doc.tipo === 'memoria')) {
    const b = memoriaAceptada(db, id, d.lote);
    if (!b) continue;
    const f = filaDocumento(db, id, d.clave);
    const deMano = f?.estado === 'preparado' && f.ruta !== null && !RUTA_MEMORIA.test(f.ruta);
    if (!f || f.estado === 'no_aplica' || f.ruta === b.ruta || deMano) continue;
    db.prepare(
      "UPDATE oferta_documentos SET estado = 'preparado', ruta = ?, ruta_pdf = ?, actualizado_en = ? WHERE licitacion_id = ? AND clave = ?",
    ).run(b.ruta, b.ruta_pdf, ts, id, d.clave);
  }
}

const identidadesDe = (docs: DocumentoConClave[]) => new Map(docs.map((d) => [d.clave, identidadDe(d)]));
const hermanasDe = (docs: DocumentoConClave[], d: DocumentoConClave) => docs.filter((x) => x.doc === d.doc).length;
const filasDe = (db: Db, id: string) =>
  new Map(
    (db.prepare('SELECT * FROM oferta_documentos WHERE licitacion_id = ?').all(id) as FilaDocumento[]).map((f) => [
      f.clave,
      f,
    ]),
  );

/** Pone la checklist al día con el guion: documentos nuevos pendientes, los que ya no están ocultos, la memoria aceptada. */
export function sincronizarDocumentos(db: Db, id: string, g: GuionGuardado): void {
  const docs = documentosDelGuion(g.datos, lotesDeChecklist(db, id, g.datos));
  const ts = new Date().toISOString();
  db.transaction(() => {
    const filas = filasDe(db, id);
    const identidades = identidadesDe(docs);
    const heredadas = new Set<string>();
    for (const d of docs) sincronizarFila(db, id, d, { filas, identidades, hermanas: hermanasDe(docs, d), heredadas });
    const claves = new Set(docs.map((d) => d.clave));
    for (const f of filas.values()) {
      if (!claves.has(f.clave) && !f.oculto)
        db.prepare('UPDATE oferta_documentos SET oculto = 1 WHERE licitacion_id = ? AND clave = ?').run(id, f.clave);
    }
    memoriaPreparada(db, id, docs, ts);
  })();
}

// Los lotes de la checklist: los de las decisiones o, sin ellas, los de interés (el ámbito).
function lotesDeChecklist(db: Db, id: string, g: GuionBaseData): string[] {
  const lotes = lotesDecididos(db, id, decisionesDe(db, id)?.datos.lotes ?? []);
  return lotes.length ? lotes : (g.lotes ?? []);
}

function aDocumento(d: DocumentoConClave, f: FilaDocumento): DocumentoOferta {
  return {
    clave: d.clave,
    archivo: d.archivo,
    lote: d.lote,
    nombre: d.doc.nombre,
    tipo: d.doc.tipo,
    obligatorio: d.doc.obligatorio,
    produce: d.doc.produce,
    origen: d.doc.origen ?? null,
    estado: f.estado,
    ruta: f.ruta,
    ruta_pdf: f.ruta_pdf,
    nota: f.nota,
    actualizado_en: f.actualizado_en,
    avisos: JSON.parse(f.avisos) as string[],
  };
}

// Lo que la sincronización dejaría en la fila, sin escribirla: la fila guardada si ya es de este
// documento y, si no, lo heredado o «pendiente» con la fecha del guion.
function filaVista(d: DocumentoConClave, ctx: Contexto & { id: string; desde: string }): FilaDocumento {
  const fila = ctx.filas.get(d.clave);
  if (fila && comparable(fila.nombre) === comparable(d.doc.nombre)) return fila;
  const c = heredado(d, ctx) ?? VACIA;
  return {
    ...c,
    licitacion_id: ctx.id,
    clave: d.clave,
    nombre: d.doc.nombre,
    oculto: 0,
    actualizado_en: ctx.desde,
    identidad: identidadDe(d),
  };
}

/** La checklist del guion vigente (vacía si aún no hay guion). Solo lee: no escribe ninguna fila. */
export function documentosDe(db: Db, id: string): { guion: GuionGuardado | null; documentos: DocumentoOferta[] } {
  const g = guionVigente(db, id);
  if (!g) return { guion: null, documentos: [] };
  const docs = documentosDelGuion(g.datos, lotesDeChecklist(db, id, g.datos));
  const ctx = {
    filas: filasDe(db, id),
    identidades: identidadesDe(docs),
    id,
    desde: g.creado_en,
    heredadas: new Set<string>(),
  };
  const documentos = docs.map((d) => aDocumento(d, filaVista(d, { ...ctx, hermanas: hermanasDe(docs, d) })));
  return { guion: g, documentos };
}

/** «6 de 9 preparados · faltan 2 obligatorios»: lo que no aplica no cuenta. */
export function resumenDocumentos(docs: Pick<DocumentoOferta, 'estado' | 'obligatorio'>[]): ResumenDocumentos {
  const cuentan = docs.filter((d) => d.estado !== 'no_aplica');
  return {
    total: cuentan.length,
    preparados: cuentan.filter((d) => d.estado === 'preparado').length,
    pendientes_obligatorios: cuentan.filter((d) => d.obligatorio && d.estado !== 'preparado').length,
  };
}

/** Límites del motivo de «No aplica»; la web los repite para avisar antes de enviar. */
const MOTIVO_NO_APLICA = { min: 10, max: 500, error: 'Di por qué no aplica (al menos 10 caracteres).' } as const;

const motivoValido = (nota: string | null | undefined): boolean =>
  (nota ?? '').length >= MOTIVO_NO_APLICA.min && (nota ?? '').length <= MOTIVO_NO_APLICA.max;

const Enlace = z.url({ protocol: /^https$/ }).max(1000);
const CambioDocumento = z
  .strictObject({
    estado: z.enum(ESTADOS_DOCUMENTO).optional(),
    ruta: z
      .union([RutaDocumento, Enlace])
      .nullable()
      .optional()
      .describe('Documento en Salidas o Conocimiento, o enlace https; null lo quita'),
    nota: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (c) => c.estado !== undefined || c.ruta !== undefined || c.nota !== undefined,
    'Nada que cambiar: manda estado, ruta o nota.',
  )
  // «No aplica» saca el documento de lo que se presenta: sin un porqué, nadie podrá revisarlo después.
  .refine((c) => c.estado !== 'no_aplica' || motivoValido(c.nota), {
    message: MOTIVO_NO_APLICA.error,
    path: ['nota'],
  });

/** Una persona cambia el estado, la ruta o la nota de un documento de la checklist. */
export function cambiarDocumento(db: Db, id: string, clave: string, entrada: unknown): Result<DocumentoOferta> {
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const c = CambioDocumento.safeParse(entrada);
  if (!c.success) {
    // El motivo que falta se dice tal cual: es lo que la web enseña bajo el campo.
    const sinMotivo = c.error.issues.some((i) => i.message === MOTIVO_NO_APLICA.error);
    return fail('invalid_input', sinMotivo ? MOTIVO_NO_APLICA.error : z.prettifyError(c.error));
  }
  const guion = guionVigente(db, id);
  if (guion) sincronizarDocumentos(db, id, guion);
  const d = guion ? documentoDelGuion(guion.datos, clave) : null;
  const f = filaDocumento(db, id, clave);
  if (!d || !f || f.oculto) return fail('not_found', `El guion vigente no tiene el documento «${clave}».`);
  const ruta = c.data.ruta === undefined ? f.ruta : c.data.ruta;
  const nueva = {
    estado: c.data.estado ?? f.estado,
    ruta,
    ruta_pdf: ruta === f.ruta ? f.ruta_pdf : null,
    deAnexo: ruta === f.ruta,
    nota: c.data.nota === undefined ? f.nota : c.data.nota || null,
    ts: new Date().toISOString(),
  };
  // Con otra ruta el documento es de una persona: ya no es el anexo que rellenó Hermes.
  db.prepare(
    `UPDATE oferta_documentos SET estado = ?, ruta = ?, ruta_pdf = ?, nota = ?, actualizado_en = ?,
    anexo_en = CASE WHEN ? THEN anexo_en ELSE NULL END, anexo_modelo = CASE WHEN ? THEN anexo_modelo ELSE NULL END WHERE licitacion_id = ? AND clave = ?`,
  ).run(
    nueva.estado,
    nueva.ruta,
    nueva.ruta_pdf,
    nueva.nota,
    nueva.ts,
    Number(nueva.deAnexo),
    Number(nueva.deAnexo),
    id,
    clave,
  );
  emitir(db, {
    tipo: 'licitacion.documentos',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'cambiado', clave, estado: nueva.estado },
  });
  return ok(aDocumento(d, filaDocumento(db, id, clave)!));
}
