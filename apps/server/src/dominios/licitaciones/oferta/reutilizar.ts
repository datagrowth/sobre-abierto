// Reutilizar un documento de la checklist: un certificado vigente de Empresa o uno entregado en una oferta anterior.
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import { z } from 'zod';
import { hoyEspana, listarDocumentosEmpresa, type DocumentoEmpresaGuardado } from '../../../nucleo/carpetaEmpresa.js';
import { CARPETA_COLABORADORES, enColaboradores } from '../../../nucleo/colaboradores/cvs.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { responder } from '../../../nucleo/http.js';
import { limpiarNombre } from '../../../nucleo/nombres.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import {
  archivoExistente,
  documentoEnDisco,
  documentosDe as documentosDeCarpeta,
  raicesActuales,
  sinSalirPorEnlaces,
  type Raices,
} from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import { propuestasParecidas, type Parecida } from '../propuestas/parecidas.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { conClave } from './anexosTrabajo.js';
import { decisionesDe } from './decisiones.js';
import { cambiarDocumento, documentoDelGuion, type DocumentoConClave, type DocumentoOferta } from './documentos.js';
import { guionVigente } from './guion.js';

// Puede ser el certificado vigente de la carpeta Empresa (TGSS, AEAT, ROLECE, ENS/ISO, CV…) o el que se entregó
// en una oferta anterior (una declaración de medios, por ejemplo). Se copia a Salidas de la oferta sin pisar
// nada y la fila queda en «borrador»: una persona lo abre y lo da por bueno. Nunca se reutiliza un caducado.
type Anterior = { ruta: string; licitacion: string; titulo: string; parecido: number };
export type Reutilizables = {
  tipo_empresa: string | null;
  empresa: DocumentoEmpresaGuardado[];
  anteriores: Anterior[];
};
export type Reutilizado = { documento: DocumentoOferta; copiado_de: string };
export type ContextoReutilizar = { db: Db; dbNucleo: DbNucleo; raices: Raices; hoy?: string };

const PedidoReutilizar = z.strictObject({
  origen: z.enum(['empresa', 'oferta']),
  ruta: z.string().trim().min(3).max(500),
});

const MAX_PARECIDAS = 20;
const MAX_ANTERIORES = 8;
// Lo que el pliego da con su modelo, la memoria, la oferta económica y el DEUC son de esta oferta.
const TIPOS_SIN_REUTILIZAR = new Set(['memoria', 'oferta_economica', 'deuc']);
// Su vigencia cuenta (un certificado de la TGSS vale seis meses) y la de una oferta anterior no
// se sabe: esos solo salen de la carpeta Empresa, que guarda la fecha de caducidad.
const CON_CADUCIDAD = new Set(['tgss', 'aeat', 'rolece', 'certificado']);

// El orden importa: «certificado de estar al corriente con la Seguridad Social» es TGSS, no un certificado ENS/ISO.
const TIPOS_POR_NOMBRE: [string, RegExp][] = [
  ['rolece', /\brolece\b|registro oficial de licitadores/],
  ['tgss', /\btgss\b|seguridad social/],
  ['aeat', /\baeat\b|agencia tributaria|obligaciones tributarias/],
  ['certificado', /\bens\b|esquema nacional de seguridad|\biso\b/],
  ['cv', /\bcurriculum\b|\bcv\b/],
  ['escritura', /\bescritura\b|\bpoderes\b|bastanteo/],
  ['seguro', /\bseguro\b|\bpoliza\b/],
  ['titulo', /\btitulacion\b|\btitulo academico\b/],
];

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** El tipo de la carpeta Empresa que corresponde a un documento del guion por su nombre, o null. */
export function tipoEmpresaDe(nombre: string): string | null {
  const t = comparable(nombre);
  return TIPOS_POR_NOMBRE.find(([, re]) => re.test(t))?.[0] ?? null;
}

const reutilizable = (d: DocumentoConClave) => !d.doc.origen?.modelo && !TIPOS_SIN_REUTILIZAR.has(d.doc.tipo);

// «ENS» o «ISO 27001»: entre certificados, solo el de lo mismo que pide el pliego.
function mismaNorma(nombre: string, doc: DocumentoEmpresaGuardado): boolean {
  const norma = /\bens\b|\biso \d{4,5}\b|\biso\b/.exec(comparable(nombre))?.[0];
  return !norma || comparable(`${doc.nombre} ${doc.ruta}`).includes(norma);
}

const RANGO_ESTADO: Record<string, number> = { vigente: 0, caduca_pronto: 1, sin_fecha: 2, caducado: 3 };

// Los CV de quien va en el equipo de la oferta, primero.
function documentosEmpresa(
  c: ContextoReutilizar,
  id: string,
  d: DocumentoConClave,
  tipo: string,
): DocumentoEmpresaGuardado[] {
  const equipo = new Set((decisionesDe(c.db, id)?.datos.equipo ?? []).map((m) => m.persona_id));
  const enEquipo = (x: DocumentoEmpresaGuardado) => (x.persona_id !== null && equipo.has(x.persona_id) ? 0 : 1);
  return listarDocumentosEmpresa(c.dbNucleo, c.hoy ?? hoyEspana())
    .filter((x) => x.tipo === tipo && (tipo !== 'certificado' || mismaNorma(d.doc.nombre, x)))
    .sort((a, b) => (RANGO_ESTADO[a.estado] ?? 9) - (RANGO_ESTADO[b.estado] ?? 9) || enEquipo(a) - enEquipo(b));
}

// Palabras que salen en casi cualquier documento de una oferta: no dicen cuál es.
const GENERICAS = new Set(
  `anexo modelo declaracion responsable certificado documento sobre archivo del de la las los el en por para con que una uno
y o a al pdf docx firmado firma v1 v2 v3 s1 s2 s3`.split(/\s+/),
);
const singular = (t: string) =>
  t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
const palabras = (t: string) =>
  new Set(
    comparable(t)
      .split(' ')
      .filter((p) => p.length > 2 && !GENERICAS.has(p) && !/^\d+$/.test(p))
      .map(singular),
  );

/** Palabras del documento del guion que también están en el nombre del archivo; 0 si son menos de un 30 %. */
function coincidencia(nombreDoc: string, ruta: string): number {
  const pide = palabras(nombreDoc);
  const archivo = palabras(
    path
      .basename(ruta)
      .replace(/\.[a-z0-9]+(\.[a-z0-9]+)?$/i, '')
      .replace(/_/g, ' '),
  );
  const comunes = [...pide].filter((p) => archivo.has(p)).length;
  return comunes >= Math.max(1, Math.ceil(pide.size * 0.3)) ? comunes : 0;
}

function rutasDeParecida(raices: Raices, p: Parecida): string[] {
  const enCarpeta = p.carpeta ? documentosDeCarpeta(raices, `Conocimiento/${p.carpeta}`) : [];
  return [...new Set([...p.documentos, ...enCarpeta])];
}

function anterioresDe(c: ContextoReutilizar, id: string, d: DocumentoConClave): Anterior[] {
  const parecidas = propuestasParecidas(c.db, id, MAX_PARECIDAS);
  if (parecidas.error) return [];
  const vistas = new Set<string>();
  // Una parecida débil (una de IA en compras para una formación) no se ofrece: la web tampoco la enseña.
  const salen = parecidas.data
    .filter((p) => !p.debil)
    .flatMap((p) => rutasDeParecida(c.raices, p).map((ruta) => ({ ruta, p, puntos: coincidencia(d.doc.nombre, ruta) })))
    .filter((x) => x.puntos > 0 && !vistas.has(x.ruta) && vistas.add(x.ruta));
  salen.sort((a, b) => b.puntos - a.puntos || b.p.puntos_parecido - a.p.puntos_parecido);
  return salen
    .slice(0, MAX_ANTERIORES)
    .map((x) => ({ ruta: x.ruta, licitacion: x.p.licitacion_id, titulo: x.p.titulo, parecido: x.p.puntos_parecido }));
}

/** Lo que se puede reutilizar para un documento de la checklist: de la carpeta Empresa (vigentes primero) y de ofertas anteriores. */
export function candidatosDe(c: ContextoReutilizar, id: string, clave: string): Result<Reutilizables> {
  const g = guionVigente(c.db, id);
  const d = g ? documentoDelGuion(g.datos, clave) : null;
  if (!d) return fail('not_found', `El guion vigente no tiene el documento «${clave}».`);
  if (!reutilizable(d)) return ok({ tipo_empresa: null, empresa: [], anteriores: [] });
  const tipo = tipoEmpresaDe(d.doc.nombre);
  return ok({
    tipo_empresa: tipo,
    empresa: tipo ? documentosEmpresa(c, id, d, tipo) : [],
    anteriores: tipo && CON_CADUCIDAD.has(tipo) ? [] : anterioresDe(c, id, d),
  });
}

const fechaEs = (iso: string) => iso.split('-').reverse().join('/');

// personal: un CV o un documento de una persona (de Colaboradores/): su copia va a una subcarpeta
// que salidas_listar y salidas_leer ocultan a quien no puede leer colaboradores (esCopiaPersonal).
type Origen = { abs: string; nota: string; personal: boolean };

const SUBCARPETA_PERSONAL = CARPETA_COLABORADORES;
export const MOTIVO_COPIA_PERSONAL =
  'Es la copia de un CV o de un documento de una persona: solo la lee quien puede ver colaboradores.';

/** ¿Es la copia en Salidas de un documento personal de la carpeta Empresa (…/documentos/Colaboradores/…)? */
export const esCopiaPersonal = (ruta: string): boolean =>
  ruta.toLowerCase().includes(`/documentos/${SUBCARPETA_PERSONAL.toLowerCase()}/`);

// Las rutas de la carpeta Empresa son de la bóveda (sin «Conocimiento/»); los CV, bajo
// Colaboradores/, que documentoEnDisco no deja elegir: aquí la ruta sale de la tabla, no del usuario.
// Aun así, con realpath (sinSalirPorEnlaces): un enlace simbólico o una unión de Windows dentro de
// Conocimiento no puede llevar a Salidas, donde lo leen Hermes y la web, algo de fuera de la bóveda.
function origenEmpresa(c: ContextoReutilizar, r: Reutilizables, ruta: string): Result<Origen> {
  const doc = r.empresa.find((x) => x.ruta === ruta);
  if (!doc) return fail('invalid_input', 'Ese documento no es de la carpeta Empresa para esta fila.');
  if (doc.estado === 'caducado')
    return fail('invalid_input', `Ese documento caducó el ${fechaEs(doc.caduca_en as string)}: sube uno vigente`);
  if (!c.raices.conocimiento)
    return fail('no_configurado', 'La carpeta Conocimiento no está configurada en el servidor (VAULT_PATH).');
  const base = path.resolve(c.raices.conocimiento);
  const abs = path.resolve(base, ...doc.ruta.split('/'));
  if (!abs.startsWith(base + path.sep) || !fs.existsSync(abs))
    return fail('not_found', `No encuentro «${doc.ruta}» en la Biblioteca.`);
  if (!sinSalirPorEnlaces(base, abs))
    return fail('invalid_input', `«${doc.ruta}» apunta fuera de la Biblioteca: no se copia.`);
  const vigencia = doc.caduca_en ? `vigente hasta ${fechaEs(doc.caduca_en)}` : 'sin fecha de caducidad';
  return ok({ abs, nota: `Copiado de la carpeta Empresa (${vigencia})`, personal: enColaboradores(doc.ruta) });
}

function origenOferta(c: ContextoReutilizar, r: Reutilizables, ruta: string): Result<Origen> {
  const a = r.anteriores.find((x) => x.ruta === ruta);
  if (!a) return fail('invalid_input', 'Ese documento no es de una oferta anterior parecida para esta fila.');
  const abs = archivoExistente(c.raices, a.ruta);
  if (abs.error) return abs;
  return ok({
    abs: abs.data,
    nota: `Copiado de la oferta anterior «${a.titulo.slice(0, 120)}» (${a.licitacion})`,
    personal: false,
  });
}

// «-v2», «-v3»…: nunca se pisa lo que ya está en Salidas (alguien pudo editarlo o firmarlo en Drive).
function copiarSinPisar(c: ContextoReutilizar, carpeta: string, abs: string): Result<string> {
  const dir = documentoEnDisco(c.raices, carpeta);
  if (dir.error) return dir;
  const ext = path.extname(abs).toLowerCase();
  const base = limpiarNombre(path.basename(abs, path.extname(abs)), 100).replace(/[.\s]+$/, '') || 'documento';
  try {
    fs.mkdirSync(dir.data, { recursive: true });
    let v = 1;
    while (fs.existsSync(path.join(dir.data, `${base}${v === 1 ? '' : `-v${v}`}${ext}`))) v += 1;
    const nombre = `${base}${v === 1 ? '' : `-v${v}`}${ext}`;
    fs.copyFileSync(abs, path.join(dir.data, nombre), fs.constants.COPYFILE_EXCL);
    return ok(`${carpeta}/${nombre}`);
  } catch (err) {
    return fail('io_error', `No se pudo copiar el documento a Salidas: ${errorMessage(err).slice(0, 300)}`);
  }
}

/** Copia el documento elegido a Salidas de la oferta y deja la fila en «borrador» para que una persona lo revise. */
export function reutilizar(c: ContextoReutilizar, id: string, clave: string, entrada: unknown): Result<Reutilizado> {
  const p = PedidoReutilizar.safeParse(entrada);
  if (!p.success) return fail('invalid_input', z.prettifyError(p.error));
  const l = c.db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(id) as
    { id: string; expediente: string } | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  if (!c.raices.salidas)
    return fail('no_configurado', 'Falta SALIDAS_DIR en el servidor: el documento se copia a Salidas.');
  const r = candidatosDe(c, id, clave);
  if (r.error) return r;
  const o = p.data.origen === 'empresa' ? origenEmpresa(c, r.data, p.data.ruta) : origenOferta(c, r.data, p.data.ruta);
  if (o.error) return o;
  const carpeta = `${carpetaSalidas(l)}/documentos${o.data.personal ? `/${SUBCARPETA_PERSONAL}` : ''}`;
  const destino = copiarSinPisar(c, carpeta, o.data.abs);
  if (destino.error) return destino;
  const doc = cambiarDocumento(c.db, id, clave, { estado: 'borrador', ruta: destino.data, nota: o.data.nota });
  return doc.error ? doc : ok({ documento: doc.data, copiado_de: p.data.ruta });
}

const contexto = (): ContextoReutilizar => ({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() });

export function rutasReutilizar(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/documentos/:clave/reutilizables',
    conId(conClave((id, clave, _req, res) => responder(res, candidatosDe(contexto(), id, clave)))),
  );
  r.post(
    '/licitaciones/:id/oferta/documentos/:clave/reutilizar',
    conId(conClave((id, clave, req, res) => responder(res, reutilizar(contexto(), id, clave, req.body ?? {})))),
  );
}
