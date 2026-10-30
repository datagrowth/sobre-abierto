// Prefiltro determinista: amplio a propósito (no perder nada); la IA criba después.
import { z } from 'zod';
import { IDIOMAS, IDIOMAS_DETECTABLES, idiomaDelTexto } from '../../nucleo/idioma.js';
import { ESTADOS_ABIERTOS } from './placsp/codigos.js';
import { cpvsTexto, type Db, type FilaLicitacion } from './store.js';
import {
  eurosTexto,
  leerIds,
  leerLotesInteres,
  lotesDeDatos,
  TODOS_LOS_LOTES,
  UN_LOTE,
  type LoteDatos,
} from './lotes.js';
import { descartarSola } from './gonogo.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';

// Pasa una licitación abierta que case por CPV o por palabra clave, dentro del rango de importe, del tipo y del
// territorio configurados. El importe es el de cada lote cuando se puede ir a lotes sueltos, o el del contrato
// si no (o si ningún lote suelto encaja pero se puede ir a todos).
export const Filtros = z.object({
  cpv_prefijos: z.array(z.string().regex(/^\d{2,8}$/)).max(200),
  palabras: z.array(z.string().trim().min(2).max(80)).max(200),
  excluir_palabras: z.array(z.string().trim().min(2).max(80)).max(200),
  importe_min: z.number().nonnegative().nullable(),
  importe_max: z.number().nonnegative().nullable(),
  tipos_contrato: z.array(z.string().regex(/^\d{1,3}$/)).max(20),
  nuts_prefijos: z.array(z.string().regex(/^ES[0-9A-Z]{0,3}$/)).max(50),
  // Lenguas cooficiales cuyas licitaciones no pasan (se deduce del título; ver nucleo/idioma.ts).
  excluir_idiomas: z.array(z.enum(IDIOMAS_DETECTABLES)).max(3).default([]),
});
export type FiltrosData = z.infer<typeof Filtros>;

// Punto de partida (una consultora de datos y tecnología) mientras nadie guarde los suyos: la web
// lo dice en Oportunidades y en Ajustes › Fuentes y filtros (filtrosDeEjemplo).
export const FILTROS_INICIALES: FiltrosData = {
  cpv_prefijos: ['72', '48', '73', '79311', '79330'],
  palabras: [
    'datos',
    'analítica',
    'inteligencia artificial',
    'business intelligence',
    'big data',
    'cuadro de mando',
    'gobierno del dato',
  ],
  excluir_palabras: [],
  importe_min: null,
  importe_max: null,
  tipos_contrato: ['2'],
  nuts_prefijos: [],
  excluir_idiomas: [],
};

export function leerFiltros(db: Db): FiltrosData {
  const row = db.prepare('SELECT datos FROM filtros WHERE id = 1').get() as { datos: string } | undefined;
  const parsed = row ? Filtros.safeParse(JSON.parse(row.datos)) : null;
  return parsed?.success ? parsed.data : FILTROS_INICIALES;
}

/** ¿Son aún los filtros de ejemplo (nadie ha guardado los de la empresa)? */
export function filtrosDeEjemplo(db: Db): boolean {
  return !db.prepare('SELECT 1 FROM filtros WHERE id = 1').get();
}

export function guardarFiltros(db: Db, filtros: FiltrosData): void {
  db.prepare(
    `INSERT INTO filtros (id, datos, actualizado_en) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
  ).run(JSON.stringify(filtros), new Date().toISOString());
}

/** Minúsculas y sin tildes, para comparar palabras sin depender de cómo se escribieron. */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

type Candidata = Pick<
  FilaLicitacion,
  'titulo' | 'estado' | 'cpvs' | 'presupuesto_sin_iva' | 'tipo_contrato' | 'nuts' | 'fecha_limite' | 'borrada_en'
> &
  Partial<Pick<FilaLicitacion, 'datos' | 'presentacion_lotes' | 'max_lotes_oferta'>>;

export function dentroDeImporte(f: FiltrosData, importe: number | null): boolean {
  if (importe === null) return true;
  return (f.importe_min === null || importe >= f.importe_min) && (f.importe_max === null || importe <= f.importe_max);
}

// Sin fecha límite no se sabe si sigue abierta y casi siempre es una antigua que nadie
// cerró en la PLACSP; si publica su plazo, llega como cambio y entra entonces. El plazo
// está en hora local de España: se compara con «ahora» en esa misma hora.
export function sigueAbierta(
  l: Pick<FilaLicitacion, 'estado' | 'fecha_limite' | 'borrada_en'>,
  ahoraMs: number,
): boolean {
  if (!ESTADOS_ABIERTOS.has(l.estado) || l.borrada_en || !l.fecha_limite) return false;
  return l.fecha_limite > horaLocalEspana(ahoraMs);
}

function admisible(f: FiltrosData, l: Candidata, ahoraMs: number): boolean {
  if (!sigueAbierta(l, ahoraMs)) return false;
  if (f.tipos_contrato.length && !f.tipos_contrato.includes(l.tipo_contrato ?? '')) return false;
  if (f.nuts_prefijos.length && !f.nuts_prefijos.some((p) => (l.nuts ?? '').startsWith(p))) return false;
  const titulo = normalizar(l.titulo);
  if (f.excluir_palabras.some((p) => titulo.includes(normalizar(p)))) return false;
  const idioma = f.excluir_idiomas.length ? idiomaDelTexto(l.titulo) : null;
  return !(idioma && (f.excluir_idiomas as string[]).includes(idioma));
}

// Por CPV (prefijo sobre «,cpv,cpv,») o por palabra clave en alguno de los textos.
function encaje(f: FiltrosData, cpvs: string, textos: string[]): string | null {
  const normalizados = textos.map(normalizar);
  const cpv = f.cpv_prefijos.find((p) => cpvs.includes(`,${p}`));
  const palabra = f.palabras.find((p) => normalizados.some((t) => t.includes(normalizar(p))));
  if (!cpv && !palabra) return null;
  return [cpv ? `CPV ${cpv}…` : null, palabra ? `palabra «${palabra}»` : null].filter(Boolean).join(' · ');
}

export type Encaje = { motivo: string; lotes: string[] | null };

// Lotes que se citan en el motivo: el resto, contados («y N más»).
const LOTES_EN_MOTIVO = 4;

// Un lote sin importe publicado vale como mucho el total del contrato: si el total no
// llega al mínimo, ese lote tampoco.
function loteEnRango(f: FiltrosData, lote: LoteDatos, total: number | null): boolean {
  if (lote.presupuesto_sin_iva !== null) return dentroDeImporte(f, lote.presupuesto_sin_iva);
  return total === null || f.importe_min === null || total >= f.importe_min;
}

const SIN_CONFIRMAR = 'presentación por lotes sin confirmar';

function encajePorLotes(f: FiltrosData, l: Candidata, lotes: LoteDatos[]): Encaje | null {
  const total = l.presupuesto_sin_iva ?? null;
  const encajan = lotes.flatMap((lote) => {
    if (!loteEnRango(f, lote, total)) return [];
    // Un lote sin CPV propio hereda los del contrato.
    const motivo = encaje(f, lote.cpvs.length ? cpvsTexto(lote.cpvs) : l.cpvs, [l.titulo, lote.nombre ?? '']);
    return motivo ? [{ lote, motivo }] : [];
  });
  if (!encajan.length) return null;
  const citados = encajan
    .slice(0, LOTES_EN_MOTIVO)
    .map((e) => `Lote ${e.lote.id} (${eurosTexto(e.lote.presupuesto_sin_iva)}): ${e.motivo}`);
  const resto = encajan.length > LOTES_EN_MOTIVO ? [`y ${encajan.length - LOTES_EN_MOTIVO} lotes más`] : [];
  // La criba sabe así cuánto puede valer como mucho un lote sin importe.
  const cota =
    total !== null && encajan.some((e) => e.lote.presupuesto_sin_iva === null)
      ? [`total del contrato ${eurosTexto(total)}`]
      : [];
  const aviso = l.presentacion_lotes ? [] : [SIN_CONFIRMAR];
  return { motivo: [...citados, ...resto, ...cota, ...aviso].join(' · '), lotes: encajan.map((e) => e.lote.id) };
}

// El contrato entero: por su importe total y por CPV o palabra del contrato.
function encajeTotal(f: FiltrosData, l: Candidata, nota: string | null): Encaje | null {
  if (!dentroDeImporte(f, l.presupuesto_sin_iva)) return null;
  const motivo = encaje(f, l.cpvs, [l.titulo]);
  if (!motivo) return null;
  return { motivo: nota ? `${motivo} · ${nota} (total ${eurosTexto(l.presupuesto_sin_iva)})` : motivo, lotes: null };
}

// Sin lotes sueltos que encajen, todavía se puede ir a todos salvo que la regla lo
// impida (a un solo lote, o un máximo de lotes por oferta menor que los que hay).
function cabenTodos(l: Candidata, lotes: LoteDatos[]): boolean {
  if (l.presentacion_lotes === UN_LOTE) return false;
  return l.max_lotes_oferta == null || l.max_lotes_oferta >= lotes.length;
}

/**
 * Por qué pasa el prefiltro (y qué lotes encajan), o null si no pasa. Con lotes a los
 * que se puede ir sueltos (código 1 o 3, o sin código: las agregadas no lo publican),
 * pasa si algún lote encaja por importe y por CPV o palabra; si ninguno encaja y se
 * puede ir a todos, se mira el total. Si hay que ir a todos (código 2) o no hay lotes,
 * se mira el total del contrato.
 */
export function evaluarConLotes(f: FiltrosData, l: Candidata, ahoraMs = Date.now()): Encaje | null {
  if (!admisible(f, l, ahoraMs)) return null;
  const lotes = l.datos ? lotesDeDatos(l.datos) : [];
  if (!lotes.length) return encajeTotal(f, l, null);
  if (l.presentacion_lotes === TODOS_LOS_LOTES) return encajeTotal(f, l, 'hay que presentarse a todos los lotes');
  const porLotes = encajePorLotes(f, l, lotes);
  if (porLotes || !cabenTodos(l, lotes)) return porLotes;
  const nota = `ningún lote suelto encaja: a todos los lotes${l.presentacion_lotes ? '' : ` (${SIN_CONFIRMAR})`}`;
  return encajeTotal(f, l, nota);
}

/**
 * Las mismas reglas sin exigir CPV ni palabra (la lista de Oportunidades sin tema elegido):
 * admisible y, por importe, algún lote suelto o el contrato entero.
 */
export function pasaSinTema(f: FiltrosData, l: Candidata, ahoraMs = Date.now()): boolean {
  if (!admisible(f, l, ahoraMs)) return false;
  const lotes = l.datos ? lotesDeDatos(l.datos) : [];
  const total = l.presupuesto_sin_iva ?? null;
  if (!lotes.length || l.presentacion_lotes === TODOS_LOS_LOTES) return dentroDeImporte(f, total);
  return lotes.some((lote) => loteEnRango(f, lote, total)) || (cabenTodos(l, lotes) && dentroDeImporte(f, total));
}

/** Motivo por el que pasa el prefiltro, o null si no pasa. */
export function evaluar(f: FiltrosData, l: Candidata, ahoraMs = Date.now()): string | null {
  return evaluarConLotes(f, l, ahoraMs)?.motivo ?? null;
}

// Una consulta por id con el statement preparado una sola vez (prefiltrar recibe lotes de ids).
function filasDe(db: Db, sql: string, ids: string[]): FilaLicitacion[] {
  const porId = db.prepare(sql);
  return ids.flatMap((id) => porId.all(id) as FilaLicitacion[]);
}

/**
 * Pasa el prefiltro a licitaciones abiertas sin oportunidad y crea las candidatas.
 * Devuelve cuántas entraron.
 */
export function prefiltrar(db: Db, ids: string[] | 'todas', ahoraMs = Date.now()): number {
  const f = leerFiltros(db);
  const sql = `SELECT l.* FROM licitaciones l LEFT JOIN oportunidades o ON o.licitacion_id = l.id
    WHERE o.licitacion_id IS NULL AND l.estado IN ('PUB', 'PRE') AND l.borrada_en IS NULL`;
  const filas = ids === 'todas' ? (db.prepare(sql).all() as FilaLicitacion[]) : filasDe(db, `${sql} AND l.id = ?`, ids);
  const insertar =
    db.prepare(`INSERT OR IGNORE INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_prefiltro, creada_en, actualizada_en)
    VALUES (?, 'candidata', ?, ?, ?, ?)`);
  let n = 0;
  const ts = new Date(ahoraMs).toISOString();
  db.transaction(() => {
    for (const l of filas) {
      const e = evaluarConLotes(f, l, ahoraMs);
      if (e) n += insertar.run(l.id, e.motivo, e.lotes ? JSON.stringify(e.lotes) : null, ts, ts).changes;
    }
  })();
  return n;
}

// Candidatas guardadas antes del prefiltro por lote: sin lotes_prefiltro, la criba no
// sabe qué lotes encajaron. Se recalculan con los lotes ya guardados en datos.
function recalcularCandidatas(db: Db, f: FiltrosData, ahoraMs: number): void {
  const filas = db
    .prepare(
      `SELECT l.* FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'candidata' AND o.lotes_prefiltro IS NULL`,
    )
    .all() as FilaLicitacion[];
  const actualizar = db.prepare(
    'UPDATE oportunidades SET motivo_prefiltro = ?, lotes_prefiltro = ? WHERE licitacion_id = ? AND lotes_prefiltro IS NULL',
  );
  db.transaction(() => {
    for (const l of filas) {
      const e = evaluarConLotes(f, l, ahoraMs);
      if (e?.lotes) actualizar.run(e.motivo, JSON.stringify(e.lotes), l.id);
    }
  })();
}

/**
 * «Descartar las escritas en» vale también para lo que ya pasó la criba: lo que está en
 * nueva sin cambios a mano y escrito en una de esas lenguas se descarta con el
 * motivo. Devuelve cuántas.
 */
export function descartarPorIdioma(db: Db): number {
  const excluir = leerFiltros(db).excluir_idiomas as string[];
  if (!excluir.length) return 0;
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'nueva' AND o.cambiada_a_mano = 0`,
    )
    .all() as { id: string; titulo: string }[];
  let n = 0;
  for (const l of filas) {
    const idioma = idiomaDelTexto(l.titulo);
    if (!idioma || idioma === 'es' || !excluir.includes(idioma)) continue;
    if (
      descartarSola(
        db,
        l.id,
        `Escrita en ${IDIOMAS[idioma]}: Ajustes › Filtros › «Descartar las escritas en».`,
        'filtros',
      )
    )
      n += 1;
  }
  return n;
}

type FilaImporte = Pick<FilaLicitacion, 'id' | 'datos' | 'presupuesto_sin_iva' | 'presentacion_lotes'> & {
  lotes_interes: string | null;
  lotes_prefiltro: string | null;
};

// Lo que se mide: los lotes de interés (o, sin ellos, los del prefiltro); sin lotes elegidos,
// el total y, si se puede ir a lotes sueltos, cada lote (basta que quepa uno). null: algún
// importe sin publicar, no se decide.
function importesDelAmbito(f: FilaImporte): number[] | null {
  const interes = leerLotesInteres(f.lotes_interes).map((l) => l.id);
  const ids = interes.length ? interes : leerIds(f.lotes_prefiltro);
  const todos = lotesDeDatos(f.datos);
  const sueltos = ids.length
    ? todos.filter((l) => ids.includes(l.id))
    : f.presentacion_lotes === TODOS_LOS_LOTES
      ? []
      : todos;
  const importes = [...(ids.length ? [] : [f.presupuesto_sin_iva]), ...sueltos.map((l) => l.presupuesto_sin_iva)];
  return importes.some((i) => i === null) ? null : (importes as number[]);
}

/**
 * El rango de importe de los filtros vale también para lo ya cribado: lo que pasó el prefiltro
 * sin importe publicado (las agregadas lo publican a veces después) o antes de bajar el máximo
 * (a-20430425: 691.000 € en «Ficha por revisar»). Se descarta lo que está en nueva sin
 * cambios a mano y cuyo ámbito (lotes de interés o contrato) queda entero fuera. Devuelve cuántas.
 */
export function descartarPorImporte(db: Db): number {
  const f = leerFiltros(db);
  if (f.importe_min === null && f.importe_max === null) return 0;
  const filas = db
    .prepare(
      `SELECT l.id, l.datos, l.presupuesto_sin_iva, l.presentacion_lotes, o.lotes_interes, o.lotes_prefiltro FROM oportunidades o
    JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.estado = 'nueva' AND o.cambiada_a_mano = 0`,
    )
    .all() as FilaImporte[];
  let n = 0;
  for (const l of filas) {
    const importes = importesDelAmbito(l);
    if (!importes?.length || importes.some((i) => dentroDeImporte(f, i))) continue;
    const texto = importes.map((i) => eurosTexto(i)).join(', ');
    if (
      descartarSola(
        db,
        l.id,
        `Importe (${texto}) fuera del rango de Ajustes › Filtros: lo cribado antes de conocerlo o de cambiar los filtros también se mide.`,
        'filtros',
      )
    )
      n += 1;
  }
  return n;
}

/**
 * Al cambiar los filtros, las candidatas que aún no han ido a la criba se vuelven a
 * pasar por el prefiltro: las que ya no pasan salen de «Sin cribar» (si los filtros
 * vuelven a admitirlas, prefiltrar las crea de nuevo) y las que siguen actualizan su
 * motivo y sus lotes. No toca lo cambiado a mano ni lo que ya está en un lote de Hermes.
 * Devuelve cuántas salieron.
 */
export function reevaluarCandidatas(db: Db, ahoraMs = Date.now()): number {
  const f = leerFiltros(db);
  const filas = db
    .prepare(
      `SELECT l.* FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'candidata' AND o.lote_criba IS NULL AND o.cambiada_a_mano = 0`,
    )
    .all() as FilaLicitacion[];
  const borrar = db.prepare(
    "DELETE FROM oportunidades WHERE licitacion_id = ? AND estado = 'candidata' AND lote_criba IS NULL",
  );
  const actualizar = db.prepare(
    'UPDATE oportunidades SET motivo_prefiltro = ?, lotes_prefiltro = ? WHERE licitacion_id = ?',
  );
  let fuera = 0;
  db.transaction(() => {
    for (const l of filas) {
      const e = evaluarConLotes(f, l, ahoraMs);
      if (e) actualizar.run(e.motivo, e.lotes ? JSON.stringify(e.lotes) : null, l.id);
      else fuera += borrar.run(l.id).changes;
    }
  })();
  return fuera;
}

/**
 * Al arrancar la ingesta: pone al día con el prefiltro por lote lo ya guardado (las
 * candidatas sin lotes del prefiltro y las licitaciones abiertas que se rechazaron por
 * el total). Idempotente. Devuelve cuántas candidatas nuevas entraron.
 */
export function reprocesarLotes(db: Db, ahoraMs = Date.now()): number {
  recalcularCandidatas(db, leerFiltros(db), ahoraMs);
  return prefiltrar(db, 'todas', ahoraMs);
}

/**
 * Hay que presentarse a todos los lotes y la oportunidad se midió por lotes: sus lotes
 * de interés dejan de valer y cuenta el total. Si queda fuera del rango de importe de
 * los filtros, se descarta con `motivo` y el total. Devuelve si se descartó.
 */
export function exigirTotal(db: Db, id: string, motivo: string, origen: 'ficha' | 'placsp'): boolean {
  const l = db.prepare('SELECT presupuesto_sin_iva FROM licitaciones WHERE id = ?').get(id) as
    { presupuesto_sin_iva: number | null } | undefined;
  if (!l) return false;
  db.prepare('UPDATE oportunidades SET lotes_interes = NULL WHERE licitacion_id = ?').run(id);
  if (dentroDeImporte(leerFiltros(db), l.presupuesto_sin_iva)) return false;
  return descartarSola(
    db,
    id,
    `${motivo} y el total (${eurosTexto(l.presupuesto_sin_iva)}) queda fuera del rango de importe de los filtros.`,
    origen,
  );
}

/**
 * La PLACSP publica después que hay que ir a todos los lotes (código 2) en oportunidades
 * que entraron por lotes: se miden con el total. Los lotes del prefiltro se borran
 * porque se eligieron con una regla que no era. Devuelve cuántas se descartaron.
 */
export function revisarTodosLosLotes(db: Db, ids: string[]): number {
  const buscar = db.prepare(`SELECT 1 FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.licitacion_id = ? AND l.presentacion_lotes = '2' AND (o.lotes_interes IS NOT NULL OR o.lotes_prefiltro IS NOT NULL)`);
  const limpiar = db.prepare('UPDATE oportunidades SET lotes_prefiltro = NULL WHERE licitacion_id = ?');
  let movidas = 0;
  for (const id of ids.filter((i) => buscar.get(i))) {
    limpiar.run(id);
    if (exigirTotal(db, id, 'La PLACSP publica que hay que presentarse a todos los lotes', 'placsp')) movidas += 1;
  }
  return movidas;
}
