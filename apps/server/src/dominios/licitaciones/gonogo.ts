// Go/no-go: semáforo de una licitación y descarte automático cuando un requisito excluyente no se cumple.
import { z } from 'zod';
import type { PerfilEmpresaData } from '../../nucleo/empresa.js';
import { emitir } from '../../nucleo/eventos.js';
import { evaluarRequisitos, type Evaluacion } from './evaluador.js';
import type { Db } from './store.js';
import {
  COLUMNAS_LOTES,
  lotesDeFila,
  sqlReglaFicha,
  TODOS_LOS_LOTES,
  type Ambito,
  type FilaLotes,
  type Presentacion,
} from './lotes.js';

export type Semaforo = { color: 'verde' | 'ambar' | 'rojo'; motivo: string; bloqueos: string[] };

// Nunca pisa lo que haya decidido una persona: solo mueve oportunidades candidata o nueva que nadie haya
// cambiado a mano.
const ESTADOS_AUTOMATICOS = ['candidata', 'nueva'] as const;
export const EVENTO_DESCARTE = 'licitacion.descarte_automatico';

const corto = (e: Evaluacion) =>
  `${e.etiqueta}${e.lote ? ` (lote ${e.lote})` : ''}${e.exigido ? ` ${e.exigido}` : ''}: ${e.motivo}`;

/**
 * Requisitos excluyentes no cumplidos que dejan fuera. Uno de un lote solo deja
 * fuera si todos los lotes en juego (los de interés o, sin ellos, todos) tienen alguno:
 * aún se puede ir a los demás. Si hay que presentarse a todos los lotes (`todos`),
 * cualquiera deja fuera.
 */
export function bloqueos(evals: Evaluacion[], lotes: string[], todos = false): string[] {
  const duros = evals.filter((e) => e.resultado === 'no_cumple' && e.excluyente);
  if (todos && duros.length) return duros.map(corto);
  const generales = duros.filter((e) => e.lote === null);
  if (generales.length) return generales.map(corto);
  const conLote = lotes.length ? lotes : [...new Set(evals.map((e) => e.lote).filter((l): l is string => l !== null))];
  const bloqueados = new Set(duros.map((e) => e.lote));
  return conLote.length && conLote.every((l) => bloqueados.has(l)) ? duros.map(corto) : [];
}

/**
 * Con una ficha aprobada que trae requisitos, una persona ya revisó el pliego: lo que
 * la PLACSP dejó «desconocido» queda resuelto en la ficha y deja de contar como duda.
 */
export function resolverConFicha(evals: Evaluacion[], deFicha: Evaluacion[]): Evaluacion[] {
  if (!deFicha.length) return evals;
  return evals.map((e) => (e.origen === 'placsp' && e.resultado === 'desconocido' ? { ...e, en_ficha: true } : e));
}

export function semaforo(todas: Evaluacion[], lotes: string[], todos = false): Semaforo {
  // Lo leído ya en la ficha y lo que no afecta a la empresa (no_aplica) no cuenta.
  const evals = todas.filter((e) => !e.en_ficha && e.resultado !== 'no_aplica');
  const b = bloqueos(evals, lotes, todos);
  if (b.length)
    return {
      color: 'rojo',
      motivo: `No cumplimos ${b.length === 1 ? 'un requisito excluyente' : `${b.length} requisitos excluyentes`}.`,
      bloqueos: b,
    };
  if (!evals.length)
    return {
      color: 'ambar',
      motivo: 'Sin requisitos evaluables en los datos de la PLACSP: genera la ficha para leerlos del pliego.',
      bloqueos: [],
    };
  const dudas = evals.filter((e) => e.resultado === 'desconocido').length;
  const fallos = evals.filter((e) => e.resultado === 'no_cumple').length;
  if (!dudas && !fallos)
    return { color: 'verde', motivo: `Cumplimos los ${evals.length} requisitos evaluados.`, bloqueos: [] };
  const partes = [
    dudas ? `${dudas} por confirmar` : '',
    fallos ? `${fallos} sin cumplir pero no excluyentes o en algún lote` : '',
  ].filter(Boolean);
  return { color: 'ambar', motivo: `${partes.join(' y ')}.`, bloqueos: [] };
}

export type OrigenDescarte = 'requisitos' | 'ficha' | 'placsp' | 'filtros' | 'pliegos' | 'no_go';

/** Un descarte del código: motivo, de dónde sale, su tipo y de qué estados puede sacar la oportunidad. */
export type DescarteSolo = {
  motivo: string;
  origen: OrigenDescarte;
  categoria?: string | null;
  estados?: readonly string[];
};

/**
 * Descarta una oportunidad que la empresa no puede presentar (un excluyente que la empresa no cumple o un
 * total fuera de los filtros) si sigue en un estado automático y nadie la tocó. Queda en
 * Descartadas con el motivo; una persona puede volver a revisarla.
 */
export function descartarSola(db: Db, id: string, motivo: string, origen: OrigenDescarte): boolean {
  return descartarTipificada(db, id, { motivo, origen });
}

/** Como descartarSola, con su tipo y sus estados; avisa con el evento de los descartes automáticos. */
export function descartarTipificada(db: Db, id: string, d: DescarteSolo): boolean {
  const de = descartarSinAviso(db, id, d);
  if (de === null) return false;
  // El motivo del «No go» compara con el perfil de la empresa (cifras) y los eventos llegan a
  // agentes sin perfil (plataforma_actividad): ese evento va sin él, con su tipo y su origen.
  const motivo = d.origen === 'no_go' ? {} : { motivo: d.motivo.slice(0, 600) };
  emitir(db, {
    tipo: EVENTO_DESCARTE,
    dominio: 'licitaciones',
    recurso: id,
    datos: { de, origen: d.origen, ...motivo, categoria: d.categoria ?? null },
  });
  return true;
}

/**
 * El descarte y su fila de historial, sin evento: el arreglo al arrancar la usa antes de adjuntar
 * el núcleo (donde viven los eventos). Devuelve el estado del que salió, o null si no la movió.
 */
export function descartarSinAviso(db: Db, id: string, d: DescarteSolo): string | null {
  const estados = d.estados ?? ESTADOS_AUTOMATICOS;
  const op = db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ? AND cambiada_a_mano = 0').get(id) as
    { estado: string } | undefined;
  if (!op || !estados.includes(op.estado)) return null;
  const texto = d.motivo.slice(0, 600);
  const ts = new Date().toISOString();
  // El descarte y su fila de historial, juntos: el historial no puede perder un descarte de Hermes.
  const cambiada = db.transaction(() => {
    const r = db
      .prepare(
        `UPDATE oportunidades SET estado = 'descartada', motivo_descarte = ?, descarte_automatico = 1, actualizada_en = ?
      WHERE licitacion_id = ? AND estado = ? AND cambiada_a_mano = 0`,
      )
      .run(texto, ts, id, op.estado);
    if (r.changes > 0)
      anotarDescarte(db, id, {
        accion: 'descartada',
        categoria: d.categoria ?? null,
        motivo: texto,
        automatico: true,
        quien: QUIEN_AUTOMATICO,
        ts,
      });
    return r.changes > 0;
  })();
  return cambiada ? op.estado : null;
}

// Ficha «No go»: Hermes leyó los pliegos y dice que no se va. Solo saca lo que está por
// decidir (nueva, con o sin ficha a la vista): lo que se prepara, lo presentado y lo que una
// persona movió o recuperó (cambiada_a_mano) no se toca, así que tras «Recuperar» no vuelve.
export const CATEGORIA_NO_GO = 'hermes_no_go';
const ESTADOS_NO_GO = ['nueva'] as const;
const MAX_MOTIVO_NO_GO = 280;

/** «Hermes: no go — <motivo de la recomendación, recortado>». */
export function motivoNoGo(motivo: string): string {
  const t = motivo.trim().replace(/\s+/g, ' ');
  return `Hermes: no go — ${t.length > MAX_MOTIVO_NO_GO ? `${t.slice(0, MAX_MOTIVO_NO_GO - 1).trimEnd()}…` : t}`;
}

export function descarteNoGo(motivo: string): DescarteSolo {
  return { motivo: motivoNoGo(motivo), origen: 'no_go', categoria: CATEGORIA_NO_GO, estados: ESTADOS_NO_GO };
}

const MOTIVO_RECUPERADA_NO_GO = 'La ficha nueva de Hermes ya no dice «No go».';

/**
 * La ficha nueva ya no dice «No go»: la descartada solo por la anterior vuelve a Nuevas (con su
 * fila en el historial, como recuperarConPliegos). Lo que descartó o recuperó una persona, o otro
 * motivo del código, no se toca. Devuelve si la movió.
 */
export function recuperarNoGo(db: Db, id: string): boolean {
  const vigente = db
    .prepare(
      `SELECT h.categoria, h.automatico FROM oportunidades o JOIN descartes_historial h ON h.licitacion_id = o.licitacion_id
    WHERE o.licitacion_id = ? AND o.estado = 'descartada' AND o.descarte_automatico = 1 AND o.cambiada_a_mano = 0 AND h.accion = 'descartada'
    ORDER BY h.id DESC LIMIT 1`,
    )
    .get(id) as { categoria: string | null; automatico: number } | undefined;
  if (vigente?.categoria !== CATEGORIA_NO_GO || vigente.automatico !== 1) return false;
  const ts = new Date().toISOString();
  return db.transaction(() => {
    const r = db
      .prepare(
        `UPDATE oportunidades SET estado = 'nueva', motivo_descarte = NULL, descarte_automatico = 0, actualizada_en = ?
      WHERE licitacion_id = ? AND estado = 'descartada' AND cambiada_a_mano = 0`,
      )
      .run(ts, id);
    if (r.changes > 0)
      anotarDescarte(db, id, {
        accion: 'recuperada',
        categoria: CATEGORIA_NO_GO,
        motivo: MOTIVO_RECUPERADA_NO_GO,
        automatico: true,
        quien: QUIEN_AUTOMATICO,
        ts,
      });
    return r.changes > 0;
  })();
}

/** Quién firma en el historial lo que descarta o recupera el código solo. */
export const QUIEN_AUTOMATICO = 'hermes';

export type HechoDescarte = {
  accion: 'descartada' | 'recuperada';
  categoria: string | null;
  motivo: string | null;
  automatico: boolean;
  quien: string | null;
  ts: string;
};

/** Una fila de descartes_historial: a mano (cambiarOportunidad) o automática (go/no-go, pliegos). */
export function anotarDescarte(db: Db, id: string, e: HechoDescarte): void {
  db.prepare(
    'INSERT INTO descartes_historial (licitacion_id, accion, categoria, motivo, automatico, quien, en) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, e.accion, e.categoria, e.motivo, Number(e.automatico), e.quien, e.ts);
}

const DatosRequisitos = z.object({ requisitos: z.unknown() }).catch({ requisitos: [] });

export type FilaEvaluable = FilaLotes & { tipo_contrato: string | null; valor_estimado: number | null };

export type Evaluada = {
  evals: Evaluacion[];
  lotes: string[];
  todos: boolean;
  ambito: Ambito;
  presentacion: Presentacion | null;
};

/**
 * Requisitos evaluados contra el ámbito de la licitación: con lotes de interés, solo los
 * generales y los de esos lotes, y la clasificación obligatoria con su importe (lo que
 * se licita son esos lotes); si la criba no eligió, los del prefiltro; si hay que ir a todos
 * los lotes o no hay lotes en juego, el total.
 */
export function evaluarFila(f: FilaEvaluable, perfil: PerfilEmpresaData | null, hoy = new Date()): Evaluada {
  const { requisitos } = DatosRequisitos.parse(JSON.parse(f.datos));
  const { lotes, presentacion, ambito } = lotesDeFila(f);
  const enJuego = ambito.por_lotes ? ambito.lotes.map((l) => l.id) : null;
  const valor = ambito.por_lotes && ambito.importe !== null ? ambito.importe : f.valor_estimado;
  const evals = evaluarRequisitos(
    { tipo_contrato: f.tipo_contrato, valor_estimado: valor, requisitos, lotes_en_juego: enJuego },
    perfil,
    hoy,
  );
  return {
    evals,
    lotes: enJuego ?? lotes.map((l) => l.id),
    todos: presentacion?.codigo === TODOS_LOS_LOTES,
    ambito,
    presentacion,
  };
}

/** Revisa las oportunidades automáticas contra el perfil y descarta las que la empresa no puede presentar. */
export function revisarRequisitos(db: Db, perfil: PerfilEmpresaData | null, hoy = new Date()): number {
  if (!perfil) return 0;
  const marcas = ESTADOS_AUTOMATICOS.map(() => '?').join(',');
  const filas = db
    .prepare(
      `SELECT l.id, l.tipo_contrato, l.valor_estimado, ${COLUMNAS_LOTES}, o.lotes_interes, o.lotes_prefiltro,
    ${sqlReglaFicha('l')} FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.estado IN (${marcas}) AND o.cambiada_a_mano = 0`,
    )
    .all(...ESTADOS_AUTOMATICOS) as (FilaEvaluable & { id: string })[];
  let movidas = 0;
  for (const f of filas) {
    const { evals, lotes, todos } = evaluarFila(f, perfil, hoy);
    const b = bloqueos(evals, lotes, todos);
    if (b.length && descartarSola(db, f.id, `Requisito excluyente no cumplido: ${b.join(' · ')}`, 'requisitos'))
      movidas += 1;
  }
  return movidas;
}
