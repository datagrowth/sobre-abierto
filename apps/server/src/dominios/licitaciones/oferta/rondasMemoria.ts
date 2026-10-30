// Rondas de reescritura de la memoria dentro de la misma versión (docs/como-esta-hecho/memoria-tecnica.md, paso 6).
import { nucleo } from '../../../nucleo/contexto.js';
import { logger } from '../../../nucleo/log.js';
import { EvaluacionDatos } from '../propuestas/evaluacion.js';
import type { Db } from '../store.js';
import { acreditacionesPorComprobar } from './acreditaciones.js';
import { coherenciaDeMemoria, hallazgosDe, hallazgosPorRonda } from './coherenciaMemoria.js';
import { criticasDe, type CriticaApartado } from './critica.js';
import {
  apartadosDe,
  ensamblarMemoria,
  paginasDeCuerpo,
  filaMemoria,
  soloRehechos,
  type FilaMemoria,
} from './ensamblado.js';
import { objetivoDeApartado } from './estrategia.js';
import { tramoMaximo } from './evaluacionMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { memoriaValorable, puntosTexto } from './guionRevision.js';
import { obligaARehacer, textoDeHallazgo, type Hallazgo } from './hechos.js';
import { ApartadoDatos, caracteresDe, esMockup, paginasEstimadasDe, reservaDeGuia } from './memoriaRevision.js';
import { marcarFaltas, marcarMotivos, type FaltaMarcada, type MotivoMarcado } from './motivosRonda.js';
import { contextoDeApartado } from './memoria.js';
import { abrirParche, parchesDe, planearParche, type ParcheHechos, type ParchePlaneado } from './parcheHechos.js';
import { memoriaConTiempo } from './plazo.js';

// Con la crítica de una ronda: si llega al umbral se ensambla; si no, y quedan rondas, plazo y mejora, se
// reescriben solo los apartados flojos con lo que señala el crítico (nunca su nota: se escribe para lo que
// señala, no para el crítico). Un apartado rehecho que baja un tramo o más vuelve a su mejor versión y no se
// vuelve a pedir. Al final, la última crítica se guarda como evaluación: la web, «Mejorar» y «Nueva versión»
// siguen funcionando igual.
const log = logger('licitaciones');

type MemoriaDelGuion = NonNullable<GuionGuardado['datos']['memoria']>;
type ApartadoGuion = MemoriaDelGuion['apartados'][number];
type Motivos = Pick<CriticaApartado, 'cita' | 'motivos_para_bajar' | 'falta'>;
export type FilaRonda = {
  apartado: number;
  ronda: number;
  datos: string;
  puntos: number | null;
  tramo: number | null;
  motivos: string;
};
export type Efectivo = { apartado: number; ronda: number; puntos: number; tramo: number } & Motivos;
// reintentos: apartados de pantallas que bajaron una vez, vuelven a su mejor versión y se pueden
// pedir otra vez (con la instrucción de figura); los demás que bajaron quedan bloqueados.
export type Regresiones = {
  efectivos: Efectivo[];
  restaurar: { apartado: number; ronda: number; datos: string }[];
  bloqueados: number[];
  reintentos: number[];
  avisos: string[];
};
// aviso: el motivo de ensamblar va a los avisos de la memoria (todo menos llegar al umbral).
export type DecisionRonda =
  { tipo: 'ensamblar'; motivo: string; aviso: boolean } | { tipo: 'ronda'; apartados: number[] };

const EPSILON = 0.01;
// El resultado del juicio por pares de una ronda ≥ 1 (criticaPares.ts): qué versión prefirió el
// crítico frente a la conservada de la ronda `contra` y si la fila guarda esa (restaurada).
export type ResultadoPar = {
  contra: number;
  gana: 'nueva' | 'anterior' | 'empate';
  restaurada: boolean;
  diferencia?: string;
};
const parDe = (f: Pick<FilaRonda, 'motivos'>): ResultadoPar | null =>
  (JSON.parse(f.motivos) as { par?: ResultadoPar }).par ?? null;
const motivosDe = (f: FilaRonda): Motivos => {
  const { par: _par, ...motivos } = JSON.parse(f.motivos) as Partial<Motivos> & { par?: unknown };
  return { cita: '', motivos_para_bajar: [], falta: [], ...motivos };
};
const efectivo = (f: FilaRonda): Efectivo => ({
  apartado: f.apartado,
  ronda: f.ronda,
  puntos: f.puntos ?? 0,
  tramo: f.tramo ?? f.puntos ?? 0,
  ...motivosDe(f),
});

// Cuántos tramos de la escala hay entre dos notas (sin escala, cuartos de los puntos del apartado).
function tramosEntre(a: ApartadoGuion, mejor: number, actual: number): number {
  const escala = [...new Set(a.escala.map((t) => t.puntos))].sort((x, y) => x - y);
  if (!escala.length) return a.puntos > 0 ? Math.floor((mejor - actual) / (a.puntos / 4) + EPSILON) : 0;
  const indice = (v: number) => escala.filter((t) => t <= v + EPSILON).length - 1;
  return indice(mejor) - indice(actual);
}

// Una versión que dice el valor de antes de un hecho que un parche corrigió después ya no vale:
// restaurarla volvía a poner el valor viejo en la memoria (y, bloqueado el apartado, nadie lo
// rehacía), así que no cuenta como «mejor versión» a partir de esa ronda.
export type Obsoleta = (f: FilaRonda, ronda: number) => boolean;
const nunca: Obsoleta = () => false;

/** Las versiones que dejó atrás un parche de hechos: llevan un valor que una ronda posterior (hasta `ronda`) cambió. */
export function obsoletasPorParches(parches: Pick<ParcheHechos, 'ronda' | 'estado' | 'cambios'>[]): Obsoleta {
  const recibidos = parches.filter((p) => p.estado === 'recibido' && p.cambios.length);
  if (!recibidos.length) return nunca;
  return (f, ronda) =>
    recibidos.some(
      (p) =>
        p.ronda > f.ronda &&
        p.ronda <= ronda &&
        p.cambios.some((c) => f.datos.includes(JSON.stringify(c.antes).slice(1, -1))),
    );
}
export const obsoletasDe = (db: Db, memoriaId: number): Obsoleta => obsoletasPorParches(parchesDe(db, memoriaId));

// La mejor versión de un apartado antes de una ronda (más puntos; a igualdad, la más reciente).
const mejorAntes = (filas: FilaRonda[], ronda: number, obsoleta: Obsoleta): FilaRonda | undefined =>
  filas
    .filter((f) => f.ronda < ronda && !obsoleta(f, ronda))
    .reduce<FilaRonda | undefined>((m, f) => (!m || (f.puntos ?? 0) >= (m.puntos ?? 0) ? f : m), undefined);

// Solo cuenta si se reescribió: el mismo texto con otra nota es ruido del crítico.
const bajo = (a: ApartadoGuion, filas: FilaRonda[], f: FilaRonda, obsoleta: Obsoleta): FilaRonda | null => {
  const mejor = mejorAntes(filas, f.ronda, obsoleta);
  return mejor && mejor.datos !== f.datos && tramosEntre(a, mejor.tramo ?? 0, f.tramo ?? 0) >= 1 ? mejor : null;
};

// Un apartado de pantallas baja a menudo porque la reescritura pierde figuras, no porque el
// enfoque sea malo: bloquearlo a la primera lo dejaba para siempre sin sus pantallas. Tiene un
// reintento más; los demás, ninguno.
const bajadasPermitidas = (a: ApartadoGuion): number => (esMockup(a) ? 1 : 0);

// La fila de una ronda por pares ya es la versión que el crítico prefirió: si es la anterior, se
// devuelve al texto de la memoria.
function conservarPar(r: Regresiones, n: number, a: ApartadoGuion, f: FilaRonda, par: ResultadoPar): void {
  r.efectivos.push(efectivo(f));
  if (!par.restaurada) return;
  r.restaurar.push({ apartado: n, ronda: f.ronda, datos: f.datos });
  r.avisos.push(
    `${n}. ${a.titulo}: en la ronda ${f.ronda} el crítico prefirió la versión anterior (ronda ${par.contra}); se conserva esa.`,
  );
}

/**
 * Un apartado rehecho que baja un tramo o más frente a su mejor versión vuelve a ella y ya no
 * se vuelve a pedir (uno de pantallas, a la segunda bajada). Devuelve lo que vale de cada
 * apartado tras la ronda `ronda`. `obsoleta`: las versiones que un parche de hechos dejó atrás.
 */
export function guardaRegresiones(
  filas: FilaRonda[],
  mem: MemoriaDelGuion,
  ronda: number,
  obsoleta: Obsoleta = nunca,
): Regresiones {
  const r: Regresiones = { efectivos: [], restaurar: [], bloqueados: [], reintentos: [], avisos: [] };
  mem.apartados.forEach((a, i) => {
    const suyas = filas.filter((f) => f.apartado === i + 1).sort((x, y) => x.ronda - y.ronda);
    const actual = suyas.filter((f) => f.ronda <= ronda).at(-1);
    if (!actual) return;
    // Por pares, perder es que el crítico prefiriera la versión anterior; sin par (ronda 0 o
    // críticas de antes), bajar un tramo frente a la mejor.
    const bajadas = suyas.filter(
      (f) => f.ronda <= ronda && (parDe(f) ? parDe(f)!.restaurada : bajo(a, suyas, f, obsoleta)),
    ).length;
    if (bajadas > bajadasPermitidas(a)) r.bloqueados.push(i + 1);
    else if (bajadas > 0) r.reintentos.push(i + 1);
    const par = parDe(actual);
    if (par) return conservarPar(r, i + 1, a, actual, par);
    const mejor = bajo(a, suyas, actual, obsoleta);
    r.efectivos.push(efectivo(mejor ?? actual));
    if (!mejor) return;
    r.restaurar.push({ apartado: i + 1, ronda: mejor.ronda, datos: mejor.datos });
    r.avisos.push(
      `${i + 1}. ${a.titulo}: la ronda ${actual.ronda} bajó de ${puntosTexto(mejor.puntos ?? 0)} a ${puntosTexto(actual.puntos ?? 0)}; se conserva la ronda ${mejor.ronda}.`,
    );
  });
  return r;
}

// Extensión: páginas que ocupa la memoria entera (con portada, índice y guía) frente al límite del
// pliego, y los apartados que pasan de su cuota, el que más se pasa primero.
export type Extension = { limite: number | null; paginas: number; excesos: number[] };

export type EntradaDecision = {
  mem: MemoriaDelGuion;
  efectivos: Efectivo[];
  bloqueados: number[];
  hallazgos: Hallazgo[];
  totales: number[];
  ronda: number;
  umbral: number;
  maxRondas: number;
  plazo: boolean;
  // Hallazgos que obligan a rehacer, por ronda (el índice es la ronda).
  bloqueantes?: number[];
  extension?: Extension;
  // En una ronda por pares, los apartados en que el crítico prefirió la versión nueva (null: crítica absoluta).
  ganadas?: number | null;
  // Lo mismo por ronda (el índice es la ronda): por pares, el progreso es ganar, no subir el total.
  ganadasPorRonda?: (number | null)[];
};

const sinBloqueantes = (hs: Hallazgo[]): boolean => !hs.some(obligaARehacer);

/** ¿Llega a la nota? Valorable: total ≥ umbral × máximo y ningún apartado a más de un tramo del máximo. No valorable: todos cumplen. */
function llegaALaNota(e: Pick<EntradaDecision, 'mem' | 'efectivos' | 'umbral'>): boolean {
  if (!memoriaValorable(e.mem))
    return e.efectivos.length === e.mem.apartados.length && e.efectivos.every((x) => Math.abs(x.tramo - 1) < EPSILON);
  const maximo = e.mem.apartados.reduce((s, a) => s + tramoMaximo(a), 0);
  const total = e.efectivos.reduce((s, x) => s + x.puntos, 0);
  const cerca = e.efectivos.every(
    (x) => tramosEntre(e.mem.apartados[x.apartado - 1]!, tramoMaximo(e.mem.apartados[x.apartado - 1]!), x.tramo) <= 1,
  );
  return total >= e.umbral * maximo - EPSILON && cerca;
}

/** ¿Llega al umbral? La nota no basta: sin contradicciones con la hoja de hechos ni nombres que el pliego prohíbe. */
const llegaAlUmbral = (e: Pick<EntradaDecision, 'mem' | 'efectivos' | 'umbral' | 'hallazgos'>): boolean =>
  llegaALaNota(e) && sinBloqueantes(e.hallazgos);

// Con bloqueantes en pie solo cuenta como progreso que bajen (la nota puede subir y la memoria
// seguir con las mismas contradicciones); sin ellos, en una ronda por pares que la versión nueva
// gane en algún apartado (el total reevalúa al preferido y se queda igual aunque el texto mejore,
// y no se compara con la nota absoluta de la ronda 0); si no, que suba el mejor total de antes.
type Serie = { totales: number[]; bloqueantes: number[]; ganadas: (number | null)[] };
function huboProgreso(i: number, s: Serie): boolean {
  const ahora = s.bloqueantes[i] ?? 0;
  if (ahora > 0) return ahora < Math.min(...s.bloqueantes.slice(0, i));
  const ganadas = s.ganadas[i];
  if (ganadas !== null && ganadas !== undefined) return ganadas > 0;
  return s.totales[i]! > Math.max(...s.totales.slice(0, i)) + EPSILON;
}

// Rondas seguidas al final sin progreso.
function rondasSinMejora(s: Serie): number {
  let n = 0;
  for (let i = s.totales.length - 1; i > 0; i -= 1) {
    if (huboProgreso(i, s)) break;
    n += 1;
  }
  return n;
}

const bajaronBloqueantes = (b: number[]): boolean => b.length >= 2 && b.at(-1)! < b.at(-2)!;

const claveDe = (h: Hallazgo): string => `${h.apartado}|${h.tipo}|${h.hecho}|${h.encontrado}`;

/** Los hallazgos que obligan a rehacer y siguen idénticos en las dos últimas rondas: ya no se reescriben, los resuelve una persona. */
export function hallazgosRepetidos(porRonda: Hallazgo[][]): Hallazgo[] {
  if (porRonda.length < 2) return [];
  const antes = new Set(porRonda.at(-2)!.filter(obligaARehacer).map(claveDe));
  return porRonda.at(-1)!.filter((h) => obligaARehacer(h) && antes.has(claveDe(h)));
}

const sobreLimite = (x: Extension | undefined): x is Extension =>
  x !== undefined && x.limite !== null && x.paginas > x.limite;

/**
 * Qué apartados se rehacen: por debajo del tramo máximo con motivos, con cosas que faltan o con
 * hallazgos de coherencia contra la hoja de hechos o por encima de su cuota de páginas (salvo los
 * restaurados). Un tramo bajo sin motivos no va al reescritor, que no tendría qué arreglar: es un
 * hueco de la crítica, y la crítica que lo trae se rechaza (revisarCritica) y vuelve al crítico.
 */
export function apartadosARehacer(
  e: Pick<EntradaDecision, 'mem' | 'efectivos' | 'bloqueados' | 'hallazgos' | 'extension'>,
): number[] {
  const conHallazgos = new Set(e.hallazgos.filter(obligaARehacer).map((h) => h.apartado));
  const pasados = new Set(e.extension?.excesos ?? []);
  return e.efectivos
    .filter((x) => {
      const a = e.mem.apartados[x.apartado - 1]!;
      const maximo = memoriaValorable(e.mem) ? tramoMaximo(a) : 1;
      const bajoConMotivos = x.tramo < maximo - EPSILON && x.motivos_para_bajar.length > 0;
      return bajoConMotivos || x.falta.length > 0 || conHallazgos.has(x.apartado) || pasados.has(x.apartado);
    })
    .map((x) => x.apartado)
    .filter((n) => !e.bloqueados.includes(n))
    .sort((a, b) => a - b);
}

// Lo que queda sin resolver al ensamblar sin llegar al umbral, para el aviso.
function pendientesDe(e: EntradaDecision): string {
  const n = e.hallazgos.filter(obligaARehacer).length;
  const largo = sobreLimite(e.extension)
    ? ` La memoria ocupa unas ${Math.ceil(e.extension.paginas)} páginas y el límite es ${e.extension.limite}.`
    : '';
  return `${n ? ` Quedan ${n} hallazgos de coherencia sin resolver: revisión humana.` : ''}${largo}`;
}

/** Ensamblar o hacer otra ronda (pura). */
export function decidirRonda(e: EntradaDecision): DecisionRonda {
  const ensamblar = (motivo: string) => ({ tipo: 'ensamblar' as const, motivo: motivo + pendientesDe(e), aviso: true });
  const pasados = sobreLimite(e.extension) ? e.extension.excesos.filter((n) => !e.bloqueados.includes(n)) : [];
  const nota = llegaALaNota(e);
  if (llegaAlUmbral(e) && !pasados.length) {
    const motivo = `La crítica de la ronda ${e.ronda} llega al umbral (${Math.round(e.umbral * 100)} % de los puntos).`;
    // Los que se pasan están bloqueados (se restauraron): no se pueden recortar más, pero la
    // memoria no se entrega por encima del límite del pliego sin decirlo.
    return sobreLimite(e.extension)
      ? ensamblar(`${motivo} Los apartados que se pasan de su cuota no se pueden recortar más en esta versión.`)
      : { tipo: 'ensamblar', motivo, aviso: false };
  }
  if (e.ronda >= e.maxRondas)
    return ensamblar(
      `Se hicieron ${e.maxRondas} rondas de reescritura sin ${nota ? 'resolver todo lo pendiente' : 'llegar al umbral'}: se ensambla con lo mejor de cada apartado.`,
    );
  if (!e.plazo)
    return ensamblar('No da tiempo a otra ronda antes del plazo: se ensambla con lo mejor de cada apartado.');
  const bloqueantes = e.bloqueantes ?? [];
  // Si la versión nueva no gana en ningún apartado, otra ronda solo gasta cuota. Sigue si bajan
  // los bloqueantes de coherencia o si ya llega a la nota y solo falta caber en las páginas.
  if (e.ganadas === 0 && !nota && !bajaronBloqueantes(bloqueantes)) {
    return ensamblar(
      `En la ronda ${e.ronda} el crítico no prefirió la versión nueva en ningún apartado frente a la anterior: se ensambla con lo mejor de cada apartado.`,
    );
  }
  if (rondasSinMejora({ totales: e.totales, bloqueantes, ganadas: e.ganadasPorRonda ?? [] }) >= 2) {
    const n = bloqueantes.at(-1) ?? 0;
    return ensamblar(
      n
        ? `Dos rondas sin subir la nota ni bajar los ${n} bloqueantes de coherencia: revisión humana.`
        : 'Dos rondas seguidas sin subir la nota: se ensambla con lo mejor de cada apartado.',
    );
  }
  const soloExtension = nota && pasados.length > 0;
  const apartados = soloExtension ? [...pasados].sort((a, b) => a - b) : apartadosARehacer(e);
  return apartados.length
    ? { tipo: 'ronda', apartados }
    : ensamblar('No queda ningún apartado que reescribir y no llega al umbral: se ensambla.');
}

export const SOLO_LO_AFECTADO =
  'Lo que queda por mejorar está en apartados que no dependen del cambio: se conservan palabra por palabra de la versión base y se ensambla.';

/**
 * En una memoria que sale de otra («Actualizar», actualizarMemoria.ts) una ronda solo reescribe lo que se
 * rehizo por el cambio (`rehechos`; null = sin límite): el resto se copió de la base y debe
 * quedar palabra por palabra. Si no queda nada que reescribir, se ensambla avisando. Pura.
 */
export function limitarARehechos(d: DecisionRonda, rehechos: number[] | null): DecisionRonda {
  if (d.tipo !== 'ronda' || rehechos === null) return d;
  const apartados = d.apartados.filter((n) => rehechos.includes(n));
  return apartados.length ? { tipo: 'ronda', apartados } : { tipo: 'ensamblar', motivo: SOLO_LO_AFECTADO, aviso: true };
}

// ── Aplicar ──

// Las dependencias guardadas eran del texto que se descarta: con '{}' quien las lea mira el texto restaurado.
function restaurar(db: Db, memoriaId: number, rs: Regresiones['restaurar']): void {
  const poner = db.prepare(
    "UPDATE memoria_apartados SET estado = 'recibido', datos = ?, caracteres = ?, paginas_estimadas = ?, error = NULL, dependencias = '{}' WHERE memoria_id = ? AND apartado = ?",
  );
  for (const r of rs) {
    const d = ApartadoDatos.safeParse(JSON.parse(r.datos));
    if (!d.success) continue;
    const caracteres = caracteresDe(d.data.bloques);
    poner.run(r.datos, caracteres, paginasEstimadasDe(caracteres), memoriaId, r.apartado);
  }
}

/**
 * Una ronda de reescritura cuyo trabajo se agotó deja «fallido» o «pendiente» un apartado que
 * ya tenía texto de la ronda anterior: vuelve a «recibido» con ese texto (el Word no puede
 * perder un apartado bueno por una reescritura que no llegó). Devuelve los apartados rescatados.
 */
export function recuperarApartadosConTexto(db: Db, m: FilaMemoria): number[] {
  if (m.ronda === 0) return [];
  const filas = db
    .prepare(
      "SELECT apartado FROM memoria_apartados WHERE memoria_id = ? AND estado <> 'recibido' AND datos IS NOT NULL",
    )
    .all(m.id) as { apartado: number }[];
  const poner = db.prepare(
    "UPDATE memoria_apartados SET estado = 'recibido', error = NULL WHERE memoria_id = ? AND apartado = ?",
  );
  for (const f of filas) poner.run(m.id, f.apartado);
  if (filas.length)
    anadirAvisos(db, m, [
      `La ronda ${m.ronda} no devolvió los apartados ${filas.map((f) => f.apartado).join(', ')}: se conserva su texto anterior.`,
    ]);
  return filas.map((f) => f.apartado);
}

/**
 * Los apartados elegidos vuelven a «pendiente» en la ronda siguiente y la memoria vuelve a la
 * redacción; con `parche`, antes pasa por la fase «hechos». Los apartados que usan un hecho se
 * rehacen al recibir el parche y solo si el hecho cambió (aunque estuvieran bloqueados: con la
 * hoja cambiada, su texto la contradiría); marcarlos aquí reescribía también los del máximo
 * cuando el run de hechos mantenía el valor.
 */
function aplicarRonda(db: Db, m: FilaMemoria, apartados: number[], parche: ParchePlaneado | null = null): boolean {
  return db.transaction(() => {
    const fase = parche ? 'hechos' : 'redaccion';
    const cambio = db
      .prepare("UPDATE memorias SET ronda = ronda + 1, fase = ? WHERE id = ? AND fase = 'critica' AND ronda = ?")
      .run(fase, m.id, m.ronda).changes;
    if (!cambio) return false;
    const pendiente = db.prepare(
      "UPDATE memoria_apartados SET estado = 'pendiente', ronda = ?, rechazos = 0, error = NULL, avisos = '[]', trabajo_id = NULL WHERE memoria_id = ? AND apartado = ?",
    );
    for (const n of new Set(apartados)) pendiente.run(m.ronda + 1, m.id, n);
    if (parche) abrirParche(db, m.id, m.ronda + 1, parche);
    return true;
  })();
}

// Los motivos de la crítica de esta ronda que citan el valor de un hecho piden corregirlo antes de reescribir.
function parcheDeLaRonda(db: Db, m: FilaMemoria): ParchePlaneado | null {
  const c = criticasDe(db, m.id).find((x) => x.ronda === m.ronda);
  return c ? planearParche(db, m, c.datos.apartados) : null;
}

export const anadirAvisos = (db: Db, m: FilaMemoria, avisos: string[]) => {
  const actuales = JSON.parse(filaMemoria(db, m.id)?.avisos ?? '[]') as string[];
  db.prepare('UPDATE memorias SET avisos = ? WHERE id = ?').run(
    JSON.stringify([...new Set([...actuales, ...avisos])]),
    m.id,
  );
};

export type Decidido = { decision: DecisionRonda; avisos: string[] };

function avisosDeRepetidos(mem: MemoriaDelGuion, repetidos: Hallazgo[], ronda: number): string[] {
  return repetidos.map(
    (h) =>
      `${h.apartado}. ${mem.apartados[h.apartado - 1]?.titulo ?? ''}: sigue igual en las rondas ${ronda - 1} y ${ronda} y no se reescribe más, lo resuelve una persona: ${textoDeHallazgo(h)}`,
  );
}

/** La cuota de caracteres de cada apartado (Infinity si no tiene). */
export function cuotaDeCaracteres(db: Db, m: FilaMemoria, g: GuionGuardado): (n: number) => number {
  const reservadas = reservaDeGuia(g.datos.memoria!);
  return (n) =>
    contextoDeApartado(g, n, {}, null, reservadas, objetivoDeApartado(db, m, n))?.cuota?.caracteres ?? Infinity;
}

/** Páginas que ocupa la memoria con lo recibido y los apartados que pasan de su cuota (el que más se pasa, primero). */
export function extensionDe(db: Db, m: FilaMemoria, g: GuionGuardado): Extension {
  const mem = g.datos.memoria!;
  const reservadas = reservaDeGuia(mem);
  const filas = apartadosDe(db, m.id);
  const cuota = cuotaDeCaracteres(db, m, g);
  const sobra = (n: number, caracteres: number) => caracteres - cuota(n);
  const excesos = filas
    .filter((f) => sobra(f.apartado, f.caracteres ?? 0) > 0)
    .sort((a, b) => sobra(b.apartado, b.caracteres ?? 0) - sobra(a.apartado, a.caracteres ?? 0))
    .map((f) => f.apartado);
  // Mismo estimador que el ensamblado (contar caracteres/2.800 + 2 páginas de margen daba más
  // que el borrador real) y la guía con sus páginas físicas: es parte de la memoria y cuenta
  // para el límite del pliego, igual que en el control del ensamblado.
  const paginas = paginasDeCuerpo(db, m, g) + reservadas;
  return { limite: mem.limite_paginas, paginas, excesos };
}

/** Lo puntuado de cada apartado en cada ronda de una memoria. */
export const filasDeRondas = (db: Db, memoriaId: number): FilaRonda[] =>
  db
    .prepare('SELECT apartado, ronda, datos, puntos, tramo, motivos FROM memoria_apartado_rondas WHERE memoria_id = ?')
    .all(memoriaId) as FilaRonda[];

export type MotivosMarcados = { motivos: MotivoMarcado[]; falta: FaltaMarcada[] };

/**
 * Los motivos de la crítica de una fila, marcados si la crítica anterior del mismo apartado ya
 * los dijo sobre otro texto (se reescribió y no se resolvió). Sin reescritura no cuentan como
 * repetidos: el crítico vuelve a ver el mismo texto.
 */
export function motivosMarcados(filas: FilaRonda[], f: FilaRonda): MotivosMarcados {
  const ahora = motivosDe(f);
  const antes = filas
    .filter((x) => x.apartado === f.apartado && x.ronda < f.ronda)
    .sort((x, y) => x.ronda - y.ronda)
    .at(-1);
  const previos = antes && antes.datos !== f.datos ? motivosDe(antes) : { motivos_para_bajar: [], falta: [] };
  return {
    motivos: marcarMotivos(ahora.motivos_para_bajar, previos.motivos_para_bajar),
    falta: marcarFaltas(ahora.falta, previos.falta),
  };
}

// La versión que se reescribe en la ronda siguiente a `ronda` (la restaurada, si bajó), sus
// motivos marcados y si es el reintento de un apartado de pantallas que bajó.
export type ApartadoEnRonda = MotivosMarcados & {
  datos: string;
  ronda: number;
  restaurado: boolean;
  reintento: boolean;
};

/** Lo que el reescritor necesita del apartado `n` tras la crítica de la ronda `ronda`. */
export function apartadoEnRonda(
  filas: FilaRonda[],
  mem: MemoriaDelGuion,
  ronda: number,
  n: number,
  obsoleta: Obsoleta = nunca,
): ApartadoEnRonda | null {
  const reg = guardaRegresiones(filas, mem, ronda, obsoleta);
  const ef = reg.efectivos.find((x) => x.apartado === n);
  const f = ef ? filas.find((x) => x.apartado === n && x.ronda === ef.ronda) : undefined;
  if (!f) return null;
  // Por pares, la fila de la ronda ya guarda la versión anterior que ganó: es una restauración.
  const par = parDe(f);
  const restaurado = f.ronda < ronda || par?.restaurada === true;
  return {
    ...motivosMarcados(filas, f),
    datos: f.datos,
    ronda: par?.restaurada ? par.contra : f.ronda,
    restaurado,
    reintento: reg.reintentos.includes(n),
  };
}

/** En una ronda por pares, los apartados en que ganó la versión nueva; null si su crítica fue absoluta. */
function ganadasEn(filas: FilaRonda[], ronda: number): number | null {
  const pares = filas
    .filter((f) => f.ronda === ronda)
    .map(parDe)
    .filter((p): p is ResultadoPar => p !== null);
  return pares.length ? pares.filter((p) => p.gana === 'nueva').length : null;
}

/** Con la crítica de la ronda en curso: restaura las regresiones y decide (y, si toca, aplica la ronda). */
export function decidirYAplicar(db: Db, m: FilaMemoria): Decidido | null {
  const g = guionPorId(db, m.guion_id);
  const mem = g?.datos.memoria;
  if (!g || !mem) return null;
  const filas = filasDeRondas(db, m.id);
  const obsoleta = obsoletasDe(db, m.id);
  const reg = guardaRegresiones(filas, mem, m.ronda, obsoleta);
  restaurar(db, m.id, reg.restaurar);
  // memorias.coherencia se calculó al cerrar la redacción sobre el texto nuevo: con algo
  // restaurado ya no es el texto que se ensamblaría.
  const hallazgos = reg.restaurar.length ? coherenciaDeMemoria(db, m.id) : hallazgosDe(m);
  const porRonda = hallazgosPorRonda(
    db,
    m,
    filas,
    mem.apartados.length,
    (r) => guardaRegresiones(filas, mem, r, obsoleta).restaurar,
  );
  const repetidos = hallazgosRepetidos(porRonda);
  const bloqueados = [...new Set([...reg.bloqueados, ...repetidos.map((h) => h.apartado)])];
  const avisos = [...reg.avisos, ...avisosDeRepetidos(mem, repetidos, m.ronda)];
  const { config } = nucleo();
  const criticas = criticasDe(db, m.id);
  const decision = limitarARehechos(
    decidirRonda({
      mem,
      efectivos: reg.efectivos,
      bloqueados,
      hallazgos,
      ronda: m.ronda,
      totales: criticas.map((c) => c.total),
      umbral: config.licitaciones.memoriaUmbral,
      maxRondas: config.licitaciones.memoriaRondas,
      plazo: memoriaConTiempo(db, m, 'ronda'),
      bloqueantes: porRonda.map((hs) => hs.filter(obligaARehacer).length),
      extension: extensionDe(db, m, g),
      ganadas: ganadasEn(filas, m.ronda),
      ganadasPorRonda: criticas.map((c) => ganadasEn(filas, c.ronda)),
    }),
    soloRehechos(m),
  );
  anadirAvisos(db, m, avisos);
  if (decision.tipo === 'ronda' && !aplicarRonda(db, m, decision.apartados, parcheDeLaRonda(db, m))) return null;
  log.info('memoria: ronda decidida', { memoria: m.id, ronda: m.ronda, decision: decision.tipo });
  return { decision, avisos };
}

// ── Fin: ensamblar y guardar la última crítica como evaluación ──

function sugerencia(n: number, a: ApartadoGuion, que: string): { referencia: string; que: string } {
  return { referencia: `${n}. ${a.titulo}`.slice(0, 200), que: que.slice(0, 1000) };
}

/**
 * La crítica como evaluación (EvaluacionDatos), con lo que vale de cada apartado (el restaurado,
 * con su nota): un criterio por apartado con su tramo; motivos en «modificar» y faltas en «reforzar».
 */
function criticaComoEvaluacion(
  resumen: string,
  efectivos: Efectivo[],
  mem: MemoriaDelGuion,
  m: Pick<FilaMemoria, 'version' | 'guion_id'>,
): unknown {
  const criterios = efectivos.map((x) => {
    const a = mem.apartados[x.apartado - 1]!;
    const justificacion = x.cita ? `«${x.cita}»` : `Tramo ${puntosTexto(x.tramo)} según la crítica ciega.`;
    return {
      criterio: a.titulo,
      peso: a.puntos,
      tipo: 'juicio_valor',
      puntuacion: Math.min(x.puntos, a.puntos),
      justificacion: justificacion.slice(0, 1500),
      referencia: `${x.apartado}. ${a.titulo}`.slice(0, 200),
      apartado: x.apartado,
      tramo: x.tramo,
    };
  });
  const total = Math.round(criterios.reduce((s, x) => s + x.puntuacion, 0) * 100) / 100;
  return {
    resumen,
    puntuacion_total: total,
    puntuacion_maxima: mem.apartados.reduce((s, a) => s + a.puntos, 0),
    criterios,
    eliminar: [],
    modificar: efectivos
      .flatMap((x) =>
        x.motivos_para_bajar.map((mo) =>
          sugerencia(x.apartado, mem.apartados[x.apartado - 1]!, `${mo.motivo} ${mo.arreglo} («${mo.cita}»)`),
        ),
      )
      .slice(0, 30),
    reforzar: efectivos
      .flatMap((x) => x.falta.map((f) => sugerencia(x.apartado, mem.apartados[x.apartado - 1]!, f)))
      .slice(0, 30),
    comparables: [],
    riesgos: [],
    memoria: { version: m.version, guion_id: m.guion_id },
  };
}

/** La última crítica de una memoria ensamblada como su evaluación (también al reanudar un ensamblado cortado). */
export function guardarEvaluacion(db: Db, m: FilaMemoria, ruta: string): void {
  const c = criticasDe(db, m.id).at(-1);
  const mem = guionPorId(db, m.guion_id)?.datos.memoria;
  if (!c || !mem || !memoriaValorable(mem)) return;
  const { efectivos } = guardaRegresiones(filasDeRondas(db, m.id), mem, c.ronda, obsoletasDe(db, m.id));
  const datos = EvaluacionDatos.safeParse(criticaComoEvaluacion(c.datos.resumen, efectivos, mem, m));
  if (!datos.success)
    return log.warn('crítica final sin guardar como evaluación', {
      memoria: m.id,
      campos: datos.error.issues
        .map((i) => i.path.join('.'))
        .slice(0, 5)
        .join(','),
    });
  db.prepare(
    'INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, ?, ?, ?, ?)',
  ).run(m.licitacion_id, ruta, JSON.stringify(datos.data), c.agente, new Date().toISOString());
}

/** Cierra la memoria: pasa la coherencia del documento entero, la ensambla y guarda la última crítica como evaluación. */
export async function finalizarMemoria(db: Db, m: FilaMemoria, aviso: string | null): Promise<void> {
  recuperarApartadosConTexto(db, m);
  const hallazgos = coherenciaDeMemoria(db, m.id);
  anadirAvisos(db, m, [
    ...(aviso ? [aviso] : []),
    ...hallazgos.map((h) => `Coherencia: ${textoDeHallazgo(h)}`),
    ...acreditacionesPorComprobar(db, m),
  ]);
  if (
    db.prepare("UPDATE memorias SET fase = 'fin' WHERE id = ? AND estado = 'redactando' AND fase <> 'fin'").run(m.id)
      .changes === 0
  )
    return;
  const r = await ensamblarMemoria(db, m.id);
  if (r.error) return log.warn('memoria sin ensamblar', { memoria: m.id, codigo: r.error.code });
  guardarEvaluacion(db, m, r.data.ruta);
}
