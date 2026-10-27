// Dónde viven los CV de los colaboradores (Biblioteca, Colaboradores/) y cómo se citan sin nombrar a nadie.
import crypto from 'node:crypto';
import path from 'node:path';
import { puede, type Permisos } from '../agentes/permisos.js';

// El nombre del archivo suele llevar el de la persona: fuera de esa carpeta (auditoría, claves de trabajos,
// datos de una persona ya borrada) la ruta solo viaja como hash.
export const CARPETA_COLABORADORES = 'Colaboradores';
export const TIPO_PERFIL_CV = 'colaboradores.perfil_cv';

/** Los CV son datos de personas: en la Biblioteca solo los ve quien puede leer colaboradores. */
export function puedeVerCvs(permisos: Permisos): boolean {
  return puede(permisos, 'colaboradores', 'leer');
}

/** Carpetas de la Biblioteca que no se muestran a un agente con estos permisos. */
export function carpetasOcultas(permisos: Permisos): string[] {
  return puedeVerCvs(permisos) ? [] : [CARPETA_COLABORADORES];
}

/** Identificador estable de un CV que no deja leer su nombre. */
export function hashCv(ruta: string): string {
  return crypto.createHash('sha256').update(ruta).digest('hex').slice(0, 16);
}

function relativa(ruta: string): string {
  return path.posix
    .normalize(ruta.trim().replace(/\\/g, '/'))
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+$/, '');
}

/**
 * ¿La ruta (relativa a la Biblioteca) es la carpeta Colaboradores o algo dentro de ella?
 * Sin distinguir mayúsculas: en Windows y en Drive es la misma carpeta.
 */
export function enColaboradores(ruta: string): boolean {
  // La copia de un Google Doc baja a .gdocs/<misma ruta>: un CV en Google Docs también es un CV.
  const rel = relativa(ruta)
    .toLowerCase()
    .replace(/^\.gdocs\//, '');
  const carpeta = CARPETA_COLABORADORES.toLowerCase();
  return rel === carpeta || rel.startsWith(`${carpeta}/`);
}

/** La ruta tal cual o, si está dentro de Colaboradores/, «Colaboradores/<hash>». */
export function rutaAuditable(ruta: string | null | undefined): string | null {
  if (!ruta) return null;
  if (!enColaboradores(ruta)) return ruta;
  const rel = relativa(ruta);
  return rel.toLowerCase() === CARPETA_COLABORADORES.toLowerCase()
    ? CARPETA_COLABORADORES
    : `${CARPETA_COLABORADORES}/${hashCv(rel)}`;
}

/** Ruta en disco de un CV dentro de la Biblioteca (`raiz`), o null si saldría de ella. */
export function cvEnDisco(raiz: string, cvRuta: string): string | null {
  const base = path.resolve(raiz);
  const destino = path.resolve(base, ...cvRuta.split('/'));
  return destino.startsWith(base + path.sep) ? destino : null;
}
