// «OK, generar los documentos» del asistente: pide ya la memoria, los anexos y el DEUC de la oferta.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import type { Raices } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { anotarHilo, hiloDe } from './asistenteHilo.js';
import { preguntasDeOferta } from './asistentePreguntas.js';
import { anexosAutoDe } from './anexosAuto.js';
import { deucAutoDe, deucXmlActivo } from './deuc.js';
import { documentosDe, type DocumentoOferta } from './documentos.js';
import { memoriaAutoQueToca, pedirMemoria } from './memoria.js';

const log = logger('licitaciones');

type DocumentoPlan = Pick<DocumentoOferta, 'clave' | 'nombre' | 'tipo' | 'lote' | 'produce' | 'estado' | 'ruta'> & {
  generado: boolean;
};
export type PlanGeneracion = {
  sobres: { archivo: string; documentos: DocumentoPlan[] }[];
  listo: boolean;
  pendientes: number;
  pedida_en: string | null;
};

// Lo que hace la plataforma o Hermes: la memoria, el DEUC y los anexos con modelo que rellenar. Lo
// demás (certificados, declaraciones sin modelo, la UTE que solo va si se concurre en UTE) lo aporta
// una persona y se ve en la Revisión. Un documento que no es obligatorio sale solo si ya está hecho.
const generado = (d: DocumentoOferta) => d.estado === 'preparado' || d.estado === 'borrador' || Boolean(d.ruta);
const loGenera = (d: DocumentoOferta) =>
  d.estado !== 'no_aplica' &&
  (d.tipo === 'memoria' || d.tipo === 'deuc' || Boolean(d.origen?.modelo)) &&
  (d.obligatorio || generado(d));

// Con todas las decisiones tomadas, pide lo que la cadena pediría sola en su vuelta y lo deja en la carpeta de la
// licitación por sobres. El plan enseña los documentos de cada sobre (archivo electrónico del guion) antes y
// después: «Se generará» y, cuando ya está, «Generado».
/** Los documentos por sobre, si ya se puede generar (todas las preguntas respondidas) y cuándo se pidió. */
export async function planDeGeneracion(dbLic: Db, dbNucleo: DbNucleo, id: string): Promise<Result<PlanGeneracion>> {
  const ps = await preguntasDeOferta(dbLic, dbNucleo, id);
  if (ps.error) return ps;
  const { documentos } = documentosDe(dbLic, id);
  const sobres = new Map<string, DocumentoPlan[]>();
  for (const d of documentos.filter(loGenera)) {
    const { clave, nombre, tipo, lote, produce, estado, ruta } = d;
    sobres.set(d.archivo, [
      ...(sobres.get(d.archivo) ?? []),
      { clave, nombre, tipo, lote, produce, estado, ruta, generado: generado(d) },
    ]);
  }
  const pendientes = ps.data.total - ps.data.hechas;
  const pedida =
    hiloDe(dbLic, id)
      .filter((m) => m.tipo === 'generar')
      .at(-1)?.creado_en ?? null;
  return ok({
    sobres: [...sobres].map(([archivo, docs]) => ({ archivo, documentos: docs })),
    listo: ps.data.estado === 'listas',
    pendientes,
    pedida_en: pedida,
  });
}

export type Generacion = { memoria: boolean; anexos: number; deuc: boolean };

function pedirTodo(dbLic: Db, dbNucleo: DbNucleo, raices: Raices, id: string, ahoraMs: number): Generacion {
  const memoria =
    memoriaAutoQueToca(dbLic, dbNucleo, id) && !pedirMemoria(dbNucleo, dbLic, raices.salidas, id, { ahoraMs }).error;
  const anexos = raices.salidas ? anexosAutoDe(dbNucleo, { db: dbLic, raices, id }, ahoraMs) : 0;
  const deuc = deucXmlActivo() && Boolean(raices.salidas) && deucAutoDe({ db: dbLic, dbNucleo, raices }, id, ahoraMs);
  return { memoria, anexos, deuc };
}

function textoGeneracion(g: Generacion): string {
  const partes = [
    g.memoria ? 'la memoria' : null,
    g.anexos ? `${g.anexos === 1 ? 'un anexo' : `${g.anexos} anexos`}` : null,
    g.deuc ? 'el DEUC' : null,
  ].filter(Boolean);
  return partes.length
    ? `Pedido: ${partes.join(', ')}. Hermes los deja en la carpeta de la licitación por sobres; pásate por Revisión antes de firmar.`
    : 'No queda nada por generar: lo que pide el guion ya está o lo genera la cadena cuando cambien las decisiones. Pásate por Revisión.';
}

/** Pide ya los documentos de la oferta. 409 si queda alguna pregunta por responder. */
export async function generarDocumentos(
  dbLic: Db,
  dbNucleo: DbNucleo,
  raices: Raices,
  id: string,
  quien = 'web',
  ahoraMs = Date.now(),
): Promise<Result<Generacion>> {
  const plan = await planDeGeneracion(dbLic, dbNucleo, id);
  if (plan.error) return plan;
  if (!plan.data.listo)
    return fail(
      'conflicto',
      `Faltan ${plan.data.pendientes} ${plan.data.pendientes === 1 ? 'decisión' : 'decisiones'} por tomar antes de generar los documentos.`,
    );
  try {
    const g = pedirTodo(dbLic, dbNucleo, raices, id, ahoraMs);
    anotarHilo(dbLic, id, {
      pregunta: null,
      autor: 'persona',
      tipo: 'generar',
      texto: `OK, generar los documentos (${quien})`,
    });
    anotarHilo(dbLic, id, { pregunta: null, autor: 'plataforma', tipo: 'guardado', texto: textoGeneracion(g) });
    return ok(g);
  } catch (err) {
    log.error('documentos de la oferta sin pedir', { id, error: errorMessage(err).slice(0, 200) });
    return fail('io_error', 'No se pudieron pedir los documentos: vuelve a intentarlo.');
  }
}
