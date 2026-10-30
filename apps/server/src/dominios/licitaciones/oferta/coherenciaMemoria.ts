// Coherencia de una memoria guardada contra su hoja de hechos (hechos.ts).
import { nucleo } from '../../../nucleo/contexto.js';
import { nombreGuardado } from '../../../nucleo/empresa.js';
import type { Db } from '../store.js';
import { decisionesDe, equipoParaRedactar } from './decisiones.js';
import { dossierDe } from './dossier.js';
import { compromisosDeLaMemoria, compromisosSinDeclarar, type CompromisoMemoria } from './compromisosMemoria.js';
import { apartadosDe, filaMemoria, type FilaMemoria } from './ensamblado.js';
import { estrategiaDe } from './estrategia.js';
import { datosDeFila } from './fugasMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { decisionesDelLote } from './memoriaLote.js';
import {
  contradiccionesEntreApartados,
  hallazgosDeCoherencia,
  textoDeHallazgo,
  type Hallazgo,
  type HechoCoherencia,
  type OpcionesCoherencia,
} from './hechos.js';
import { textoDeBloque, type ApartadoDatosData } from './memoriaRevision.js';
import { repeticionesEn } from './repeticion.js';
import { compromisosNoListados, problemaDeNoListados } from './compromisosSolucion.js';
import { textosDeSolucion } from './solucion.js';

// Se comprueba al recibir cada apartado (una contradicción se rechaza hasta el tercer envío; un nombre del
// equipo cuando va por roles, siempre, porque arriesga la exclusión) y sobre el documento entero al acabar la
// redacción, cuyos hallazgos se guardan en memorias.coherencia y entran en la ronda siguiente.
// compromisos: lo que se acredita en esta memoria y tiene que salir en ella con su valor.
export type ContextoCoherencia = {
  hechos: HechoCoherencia[];
  op: OpcionesCoherencia;
  guion?: GuionGuardado['datos'] | undefined;
  compromisos?: CompromisoMemoria[];
};
export type CoherenciaApartado = { duros: string[]; blandos: string[]; avisos: string[] };

/**
 * La hoja de hechos, el equipo, si va por roles y las herramientas de una memoria (null en una
 * versión subida a mano); en la de un lote (memoriaLote.ts), los de su lote. Por roles se buscan todos los nombres:
 * nombrar a quien va en otro lote también identifica al equipo.
 */
export function contextoCoherencia(db: Db, m: FilaMemoria): ContextoCoherencia | null {
  if (m.fase === null) return null;
  const todas = decisionesDe(db, m.licitacion_id)?.datos ?? null;
  const d = todas ? decisionesDelLote(todas, m.lote ?? null) : null;
  const guion = guionPorId(db, m.guion_id)?.datos;
  const porRoles = dossierDe(db, m.id)?.equipo_por_roles ?? false;
  const equipo = porRoles ? todas : d;
  return {
    guion,
    compromisos: guion ? compromisosDeLaMemoria(guion, d?.automaticos ?? []) : [],
    hechos: estrategiaDe(db, m.id)?.datos.hechos ?? [],
    op: {
      equipo: equipo ? equipoParaRedactar(nucleo().db, equipo).map((p) => p.nombre) : [],
      porRoles,
      herramientas: d?.herramientas ?? [],
    },
  };
}

/** El texto de un apartado para buscar en él: título y todo lo que se lee en sus bloques. */
export const textoParaCoherencia = (d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>): string =>
  [d.titulo, ...d.bloques.map(textoDeBloque)].join('\n');

/** Lo que no casa con la hoja de hechos en un apartado que llega, por gravedad. */
export function coherenciaDeApartado(
  db: Db,
  m: FilaMemoria,
  apartado: number,
  d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>,
): CoherenciaApartado {
  const c = contextoCoherencia(db, m);
  if (!c) return { duros: [], blandos: [], avisos: [] };
  const textos = Array.from({ length: apartado }, (_, i) => (i === apartado - 1 ? textoParaCoherencia(d) : ''));
  const hs = hallazgosDeCoherencia(textos, c.hechos, c.op);
  const de = (tipo: Hallazgo['tipo']) => hs.filter((h) => h.tipo === tipo).map((h) => textoDeHallazgo(h, c.hechos));
  return {
    duros: de('nombre'),
    blandos: [...de('contradiccion'), ...compromisosFueraDeLista(db, m, d)],
    avisos: de('herramienta'),
  };
}

// Lo que el apartado compromete con frecuencia, cantidad, horas, material o disponibilidad y no
// está en la lista de compromisos, la hoja de hechos ni la solución: una memoria puede
// prometer guardias, kits o entrevistas individuales que nadie había decidido. Sin solución
// (estrategia anterior a la ficha), no hay lista con que comparar. Lo que la persona quitó en
// la ficha cuenta como no listado aunque lo repita la hoja de hechos.
function compromisosFueraDeLista(db: Db, m: FilaMemoria, d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>): string[] {
  const e = estrategiaDe(db, m.id)?.datos;
  if (!e?.solucion) return [];
  const listados = [
    ...textosDeSolucion(e.solucion),
    ...e.hechos.map((h) => `${h.sobre}: ${h.valor}${h.unidad ? ` ${h.unidad}` : ''}`),
  ];
  const quitados = (e.solucion.compromisos ?? []).filter((c) => c.quitado).map((c) => c.texto);
  const p = problemaDeNoListados(compromisosNoListados(textoParaCoherencia(d), listados, quitados, nombreGuardado(db)));
  return p ? [p] : [];
}

// Solo sobre el documento entero: un apartado suelto no tiene por qué llevar cada compromiso.
const sinDeclarar = (c: ContextoCoherencia, textos: string[]): Hallazgo[] =>
  c.guion ? compromisosSinDeclarar(textos, c.guion, c.compromisos ?? []) : [];

/** Los hallazgos del documento entero (hoja de hechos, entre apartados y compromisos sin declarar): se guardan en la memoria. */
export function coherenciaDeMemoria(db: Db, memoriaId: number): Hallazgo[] {
  const m = filaMemoria(db, memoriaId);
  const c = m ? contextoCoherencia(db, m) : null;
  if (!m || !c) return [];
  const filas = apartadosDe(db, m.id);
  const total = Math.max(0, ...filas.map((f) => f.apartado));
  const textos = Array.from({ length: total }, (_, i) => {
    const d = datosDeFila(filas.find((f) => f.apartado === i + 1));
    return d ? textoParaCoherencia(d) : '';
  });
  const hallazgos = [
    ...hallazgosDeCoherencia(textos, c.hechos, c.op),
    ...contradiccionesEntreApartados(textos),
    ...sinDeclarar(c, textos),
    ...repetidas(textos),
  ];
  db.prepare('UPDATE memorias SET coherencia = ? WHERE id = ?').run(JSON.stringify(hallazgos), m.id);
  return hallazgos;
}

// Solo sobre el documento entero, como aviso para la persona: no obliga a reescribir.
const repetidas = (textos: string[]): Hallazgo[] =>
  repeticionesEn(textos).map((r) => ({
    apartado: r.apartado,
    hecho: '',
    cita: r.frase,
    encontrado: `${r.veces} veces`,
    esperado: '',
    tipo: 'repeticion' as const,
  }));

type FilaDeRonda = { apartado: number; ronda: number; datos: string };

/**
 * El documento tal como quedó tras la ronda r: de cada apartado, la versión restaurada si la
 * guarda de regresiones la devolvió a una anterior y, si no, la última hasta r. Con la última a
 * secas, un compromiso declarado solo en la versión descartada contaba como resuelto.
 */
export function versionesVigentes(
  filas: FilaDeRonda[],
  apartados: number,
  r: number,
  restauradas: { apartado: number; ronda: number }[] = [],
): (FilaDeRonda | undefined)[] {
  return Array.from({ length: apartados }, (_, i) => {
    const vuelta = restauradas.find((x) => x.apartado === i + 1);
    if (vuelta) return filas.find((x) => x.apartado === i + 1 && x.ronda === vuelta.ronda);
    return filas.filter((x) => x.apartado === i + 1 && x.ronda <= r).sort((a, b) => b.ronda - a.ronda)[0];
  });
}

/**
 * Los hallazgos de cada ronda (el índice es la ronda), recalculados con el texto que se criticó
 * en ella: así la serie no necesita columnas nuevas y se sabe si los bloqueantes bajan.
 * restauradasEn(r): lo que la guarda de regresiones devolvió a una versión anterior en la ronda r.
 */
export function hallazgosPorRonda(
  db: Db,
  m: FilaMemoria,
  filas: FilaDeRonda[],
  apartados: number,
  restauradasEn?: (r: number) => { apartado: number; ronda: number }[],
): Hallazgo[][] {
  const c = contextoCoherencia(db, m);
  if (!c) return [];
  const texto = (f: { datos: string } | undefined) => {
    const d = f ? datosDeFila({ estado: 'recibido', datos: f.datos }) : null;
    return d ? textoParaCoherencia(d) : '';
  };
  return Array.from({ length: m.ronda + 1 }, (_, r) => {
    const textos = Array.from({ length: apartados }, (_, i) =>
      texto(filas.find((x) => x.apartado === i + 1 && x.ronda === r)),
    );
    // Un compromiso se busca en el documento vigente en esa ronda: lo último de cada apartado,
    // también de los que no se reescribieron, salvo lo que la guarda restauró.
    const documento = versionesVigentes(filas, apartados, r, restauradasEn?.(r)).map(texto);
    return [...hallazgosDeCoherencia(textos, c.hechos, c.op), ...sinDeclarar(c, documento)];
  });
}

/** Los hallazgos guardados de una memoria. */
export const hallazgosDe = (m: Pick<FilaMemoria, 'coherencia'>): Hallazgo[] =>
  JSON.parse(m.coherencia || '[]') as Hallazgo[];
