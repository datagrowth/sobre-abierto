// Propuestas de una licitación de un vistazo: registro, borradores, evaluaciones y oferta en curso.
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { documentosDe, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { carpetaDe } from '../carpetas.js';
import { carpetaPresentadaDe } from '../presentadas.js';
import { fichasDe } from '../ficha.js';
import type { Db, FilaLicitacion } from '../store.js';
import { borradoresDe, carpetaSalidas, type Borrador } from './borrador.js';
import {
  evaluacionesDe,
  resumenEvaluacionMemoria,
  type Evaluacion,
  type ResumenEvaluacionMemoria,
} from './evaluacion.js';
import { aprendizajesParecidos, propuestasParecidas, type AprendizajeParecido, type Parecida } from './parecidas.js';
import { propuestasDe, type Propuesta } from './registro.js';
import { guionVigente } from '../oferta/guion.js';
import { memoriasDe, type EstadoMemoria } from '../oferta/memoria.js';

const log = logger('licitaciones.propuestas');

export function raicesDocumentos(): Raices {
  return raicesActuales();
}

// Reúne lo registrado, los borradores, las evaluaciones, las propuestas anteriores parecidas, los documentos que
// se pueden evaluar y la oferta en curso (guion vigente y memorias por apartados).
export type PropuestaLicitacion = {
  id: string;
  propuestas: Propuesta[];
  borradores: Borrador[];
  evaluaciones: Evaluacion[];
  parecidas: Parecida[];
  // Lo aprendido de las actas de mesa (aceptado) en el mismo órgano o CPV.
  aprendizajes: AprendizajeParecido[];
  documentos: string[];
  carpeta_salidas: string;
  ficha_aprobada: boolean;
  salidas_configurado: boolean;
  // Carpeta de lo presentado en Conocimiento (PLIEGOS, DOCUMENTACION PRESENTADA, OTROS DOCUMENTOS) y su estado.
  carpeta_presentada: { ruta: string | null; estado: string; error: string | null } | null;
  guion: { id: number; version: number; apartados: number; limite_paginas: number | null } | null;
  memorias: EstadoMemoria[];
};

// Lo que se puede evaluar: lo que hay en su carpeta de Salidas y en la de lo presentado (con
// sus pliegos y lo entregado) o, sin ella, en la de sus pliegos (donde el equipo deja a veces
// la propuesta), más los documentos ya registrados.
function documentosCandidatos(
  raices: Raices,
  l: FilaLicitacion,
  presentada: string | null,
  propuestas: Propuesta[],
  borradores: Borrador[],
): string[] {
  const enCarpetas = [
    ...documentosDe(raices, carpetaSalidas(l)),
    ...documentosDe(raices, `Conocimiento/${presentada ?? carpetaDe(l)}`),
  ];
  return [...new Set([...propuestas.flatMap((p) => p.documentos), ...borradores.map((b) => b.ruta), ...enCarpetas])];
}

function resumenGuion(db: Db, id: string): PropuestaLicitacion['guion'] {
  const g = guionVigente(db, id);
  return g
    ? {
        id: g.id,
        version: g.version,
        apartados: g.datos.memoria?.apartados.length ?? 0,
        limite_paginas: g.datos.memoria?.limite_paginas ?? null,
      }
    : null;
}

export function propuestaDeLicitacion(
  db: Db,
  raices: Raices,
  id: string,
  limiteParecidas = 10,
): Result<PropuestaLicitacion> {
  const l = db.prepare('SELECT * FROM licitaciones WHERE id = ?').get(id) as FilaLicitacion | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const propuestas = propuestasDe(db, id);
  const borradores = borradoresDe(db, id);
  const parecidas = propuestasParecidas(db, id, limiteParecidas);
  const carpeta = carpetaPresentadaDe(db, id);
  const presentada = carpeta?.estado === 'hecha' ? carpeta.ruta : null;
  return ok({
    id,
    propuestas,
    borradores,
    evaluaciones: evaluacionesDe(db, id),
    parecidas: parecidas.data ?? [],
    aprendizajes: aprendizajesParecidos(db, id, limiteParecidas),
    documentos: documentosCandidatos(raices, l, presentada, propuestas, borradores),
    carpeta_salidas: carpetaSalidas(l),
    ficha_aprobada: fichasDe(db, id).aprobada !== null,
    salidas_configurado: raices.salidas !== null,
    carpeta_presentada: carpeta ? { ruta: carpeta.ruta, estado: carpeta.estado, error: carpeta.error } : null,
    guion: resumenGuion(db, id),
    memorias: memoriasDe(db, id),
  });
}

const MAX_RESUMEN_EVALUACION = 600;

type EvaluacionResumida = ResumenEvaluacionMemoria & { documento: string; creada_en: string; resumen: string };

function evaluacionResumida(ev: Evaluacion): EvaluacionResumida {
  const r = ev.datos.resumen;
  const resumen = r.length > MAX_RESUMEN_EVALUACION ? `${r.slice(0, MAX_RESUMEN_EVALUACION)}…` : r;
  return { ...resumenEvaluacionMemoria(ev), documento: ev.documento, creada_en: ev.creada_en, resumen };
}

type RaizDocumento = 'Conocimiento' | 'Salidas';

// El agente copia la ruta tal cual a biblioteca_leer o salidas_leer: sin raíz no sabe a cuál.
function conRaiz(ruta: string, raiz: RaizDocumento): string {
  return ruta === raiz || ruta.startsWith(`${raiz}/`) ? ruta : `${raiz}/${ruta}`;
}

function conRaizAny(ruta: string): string {
  return ruta.startsWith('Conocimiento/') || ruta.startsWith('Salidas/') ? ruta : conRaiz(ruta, 'Salidas');
}

function apartadosDe(json: string | null, borradorId: number): unknown {
  if (json === null) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    log.warn('apartados_json del borrador no es JSON', { borrador: borradorId });
    return null;
  }
}

type ParecidaAgente = Omit<Parecida, 'documentos' | 'carpeta'> & { documentos_n: number; carpeta: string | null };
type VersionAgente = {
  id: number;
  version: number | null;
  estado: string;
  guion_id: number | null;
  ruta: string | null;
  ruta_md: string | null;
  fugas: EstadoMemoria['fugas'] | null;
};
type BorradorAgente = VersionAgente | (Omit<Borrador, 'apartados_json'> & { apartados: unknown });
type MemoriaAgente = VersionAgente & { ensayo: boolean };

function parecidaParaAgente({ documentos, carpeta, ...resto }: Parecida): ParecidaAgente {
  return {
    ...resto,
    documentos_n: documentos.length,
    carpeta: carpeta === null ? null : conRaiz(carpeta, 'Conocimiento'),
  };
}

// Lo ensamblado ya está entero en licitaciones_oferta: aquí solo dónde está y sus fugas, que
// no tienen otro sitio con su historia.
function borradorParaAgente(b: Borrador, memorias: EstadoMemoria[]): BorradorAgente {
  const { apartados_json, ...resto } = b;
  if (b.origen !== 'ensamblado')
    return { ...resto, ruta: conRaizAny(b.ruta), apartados: apartadosDe(apartados_json, b.id) };
  const fugas = memorias.find((m) => m.id === b.memoria_id)?.fugas ?? null;
  return {
    id: b.id,
    version: b.version,
    estado: b.estado,
    guion_id: b.guion_id,
    ruta: conRaizAny(b.ruta),
    ruta_md: b.ruta_md && conRaizAny(b.ruta_md),
    fugas,
  };
}

function memoriaParaAgente(m: EstadoMemoria): MemoriaAgente {
  const b = m.borrador;
  return {
    id: m.id,
    version: m.version,
    estado: m.estado,
    guion_id: m.guion_id,
    ruta: b && conRaizAny(b.ruta),
    ruta_md: b?.ruta_md ? conRaizAny(b.ruta_md) : null,
    fugas: m.fugas,
    ensayo: m.ensayo,
  };
}

type PropuestaAgente = Omit<PropuestaLicitacion, 'evaluaciones' | 'parecidas' | 'borradores' | 'memorias'> & {
  parecidas: ParecidaAgente[];
  borradores: BorradorAgente[];
  memorias: MemoriaAgente[];
  evaluaciones: EvaluacionResumida[];
};

/**
 * Lo mismo para Hermes: primero lo que reutiliza al redactar (parecidas y aprendizajes) y las
 * evaluaciones en resumen. Enteras (justificaciones, sugerencias, genéricos), diez evaluaciones
 * llenaban la respuesta y el recorte se comía justo lo que el redactor necesitaba. Sin repetir la
 * memoria (compromisos, apartados): eso es licitaciones_oferta. Toda ruta lleva su raíz.
 */
export function propuestaParaAgente(p: PropuestaLicitacion): PropuestaAgente {
  const { id, parecidas, aprendizajes, evaluaciones, borradores, memorias, carpeta_presentada, ...resto } = p;
  return {
    id,
    parecidas: parecidas.map(parecidaParaAgente),
    aprendizajes,
    ...resto,
    carpeta_presentada: carpeta_presentada && {
      ...carpeta_presentada,
      ruta: carpeta_presentada.ruta && conRaiz(carpeta_presentada.ruta, 'Conocimiento'),
    },
    borradores: borradores.map((b) => borradorParaAgente(b, memorias)),
    memorias: memorias.map(memoriaParaAgente),
    evaluaciones: evaluaciones.map(evaluacionResumida),
  };
}
