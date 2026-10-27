// Decisiones guardadas por sección: PATCH /oferta/decisiones/:seccion sustituye y valida solo esa sección.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Rol } from '../../../nucleo/usuarios.js';
import type { Db } from '../store.js';
import {
  avisarDecisiones,
  avisosDePrecio,
  decisionesDe,
  DecisionesObjeto,
  escribirDecisiones,
  lotesDecididos,
  MENSAJE_CONFLICTO,
  mensajesParaPersonas,
  normalizarDecisiones,
  presupuestosDeLotes,
  problemasDeAIncorporar,
  problemasDeAutomaticos,
  problemasDeContradictorios,
  problemasDeEquipo,
  problemasDeLotes,
  type DecisionesData,
  type DecisionesGuardadas,
} from './decisiones.js';
import { noPrometerDe, revisarEnfoque } from './enfoque.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { problemasDePrecios } from './preciosOferta.js';
import { avisarLotes, EleccionLotes, guardarLotesInteres } from '../oportunidades.js';
import { sinCitasInternas } from './textoPliego.js';

// Así un problema en el equipo no impide fijar el precio (una persona dada de baja no debe bloquear el anexo
// del precio). Lo que no cuadra en las demás se devuelve como texto (y sale en las comprobaciones), no como un
// 400. Con la versión que se leyó: si otra persona guardó entre medias, 409 y no se escribe nada. Los lotes
// también son una sección: cambian los de interés y podan lo de los lotes quitados, todo o nada.
export const SeccionDecisiones = z.enum([
  'precio',
  'equipo',
  'automaticos',
  'herramientas',
  'enfoque',
  'lotes',
  'datos_anexo',
  'a_incorporar',
]);
export type SeccionDecisiones = z.infer<typeof SeccionDecisiones>;

// El esquema de cada sección es el de Decisiones, sin su valor por defecto: un PATCH sin «valor» no vacía la sección.
const forma = DecisionesObjeto.shape;
const VALORES = {
  precio: forma.ofertas.unwrap(),
  equipo: forma.equipo.unwrap(),
  automaticos: forma.automaticos.unwrap(),
  herramientas: forma.herramientas.unwrap(),
  enfoque: forma.enfoque.unwrap(),
  lotes: forma.lotes.unwrap(),
  datos_anexo: forma.datos_anexo.unwrap(),
  a_incorporar: forma.a_incorporar.unwrap(),
} as const;

const entradaDe = (s: SeccionDecisiones) =>
  z.strictObject({
    version: z.number().int().positive().describe('La versión de las decisiones que se leyó (GET /oferta/decisiones)'),
    valor: VALORES[s],
    quien: z.string().trim().min(2).max(60).optional(),
  });

// La web guarda por secciones: el error nombra la sección («Equipo, fila 2, rol en la oferta:
// falta.»), no el «valor» del cuerpo, ni con el inglés técnico de zod.
function mensajeDeSeccion(s: SeccionDecisiones, error: z.ZodError): string {
  const campo = s === 'precio' ? 'ofertas' : s;
  const issues = error.issues.map((i) => (i.path[0] === 'valor' ? { ...i, path: [campo, ...i.path.slice(1)] } : i));
  return mensajesParaPersonas(new z.ZodError(issues));
}

/** Lo que se quitó al quitar lotes: los lotes cuyo precio se borró, cuántos automáticos y qué personas. */
type Poda = { precios: string[]; automaticos: number; personas: number[] };
export type SeccionGuardada = {
  version: number;
  datos: DecisionesData;
  avisos: string[];
  problemas_otras: string[];
  poda?: Poda;
};

export type Contexto = { dbLic: Db; dbNucleo: DbNucleo; id: string; guion: GuionGuardado };

// Sin decisiones guardadas, se parte de unas vacías con los lotes a los que se va.
function baseDe(c: Contexto, actual: DecisionesGuardadas | null): DecisionesData {
  if (actual) return actual.datos;
  return {
    lotes: lotesDecididos(c.dbLic, c.id, []),
    equipo: [],
    automaticos: [],
    herramientas: [],
    enfoque: '',
    ofertas: [],
  };
}

function conSeccion(base: DecisionesData, s: SeccionDecisiones, valor: unknown): DecisionesData {
  if (s === 'precio') return { ...base, ofertas: valor as DecisionesData['ofertas'] };
  // El enfoque llega al redactor: sin citas del pliego, como en el PUT.
  if (s === 'enfoque') return { ...base, enfoque: sinCitasInternas(valor as string) };
  return { ...base, [s]: valor };
}

// El equipo sin los lotes quitados; quien solo iba en ellos sale (con lotes vacíos va en todos y se queda).
function equipoSin(
  equipo: DecisionesData['equipo'],
  quitados: string[],
): { equipo: DecisionesData['equipo']; personas: number[] } {
  const soloQuitados = (m: DecisionesData['equipo'][number]) =>
    m.lotes.length > 0 && m.lotes.every((l) => quitados.includes(l));
  return {
    equipo: equipo
      .filter((m) => !soloQuitados(m))
      .map((m) => ({ ...m, lotes: m.lotes.filter((l) => !quitados.includes(l)) })),
    personas: equipo.filter(soloQuitados).map((m) => m.persona_id),
  };
}

// El orden de preferencia sin los lotes quitados (null si no queda ninguno): el anexo no puede nombrar un lote al que no se va.
function conOrdenSin(d: DecisionesData, quitados: string[]): Pick<DecisionesData, 'datos_anexo'> {
  const a = d.datos_anexo;
  if (!a?.orden_lotes) return {};
  const queda = a.orden_lotes.filter((l) => !quitados.includes(l));
  return { datos_anexo: { ...a, orden_lotes: queda.length ? queda : null } };
}

/**
 * Quitar un lote poda su parte de las decisiones (su precio, sus automáticos y las personas que
 * solo van en él); añadirlo deja su precio pendiente y no toca lo demás.
 */
function podarLotes(d: DecisionesData, lotes: string[]): { datos: DecisionesData; poda: Poda } {
  const quitados = d.lotes.filter((l) => !lotes.includes(l));
  const fuera = (l: string | null | undefined) => l != null && quitados.includes(l);
  const automaticos = d.automaticos.filter((a) => !fuera(a.lote));
  const { equipo, personas } = equipoSin(d.equipo, quitados);
  // Sin ningún precio aún, normalizarOfertas deja pendientes todos los lotes: no hace falta añadirlos.
  const nuevos = d.ofertas.length
    ? lotes
        .filter((l) => !d.ofertas.some((o) => o.lote === l))
        .map((lote) => ({ lote, pendiente: true, importe: null, unitarios: [] }))
    : [];
  const ofertas = [...d.ofertas.filter((o) => !fuera(o.lote)), ...nuevos];
  const poda = {
    precios: d.ofertas.filter((o) => fuera(o.lote)).map((o) => o.lote!),
    automaticos: d.automaticos.length - automaticos.length,
    personas,
  };
  return { datos: { ...d, lotes, automaticos, equipo, ofertas, ...conOrdenSin(d, quitados) }, poda };
}

/**
 * Lo que no cuadra, por sección; herramientas y datos del anexo no se cruzan con nada. El enfoque, con su fuga a otro sobre.
 * parcial: los criterios automáticos que faltan no cuentan (el asistente los guarda de uno en uno).
 */
export function problemasPorSeccion(
  c: Contexto,
  d: DecisionesData,
  parcial = false,
): Record<SeccionDecisiones, string[]> {
  const precio = problemasDePrecios(d, c.guion.datos, { presupuestos: presupuestosDeLotes(c.dbLic, c.id) })
    .filter((p) => p.gravedad === 'error')
    .map((p) => p.mensaje);
  return {
    precio,
    equipo: problemasDeEquipo(c.dbNucleo, d),
    automaticos: [
      ...problemasDeAutomaticos(d, c.guion, { parcial }),
      ...problemasDeContradictorios(c.dbLic, c.id, c.guion, d),
    ],
    herramientas: [],
    enfoque: revisarEnfoque(c.dbLic, c.guion, d.enfoque, []).errores,
    lotes: problemasDeLotes(c.dbLic, c.id, d),
    datos_anexo: [],
    a_incorporar: problemasDeAIncorporar(d),
  };
}

// Prometer en el enfoque lo que Hermes dijo no prometer se guarda, pero se avisa (como en el PUT).
const avisosDeEnfoque = (c: Contexto, s: SeccionDecisiones, d: DecisionesData): string[] =>
  s === 'enfoque' ? revisarEnfoque(c.dbLic, c.guion, d.enfoque, noPrometerDe(c.dbLic, c.id)).avisos : [];

/** La licitación con su guion vigente: sin guion no hay decisiones que tocar (409). */
export function contextoDe(dbLic: Db, dbNucleo: DbNucleo, id: string): Result<Contexto> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const guion = guionVigente(dbLic, id);
  if (!guion)
    return fail(
      'conflicto',
      'Esta licitación aún no tiene guion de la oferta: las decisiones se fijan sobre él. Pídelo primero.',
    );
  return ok({ dbLic, dbNucleo, id, guion });
}

// Escribe sin avisar: los avisos van después, cuando ya no hay transacción que pueda deshacerse.
function escribir(
  c: Contexto,
  x: {
    s: SeccionDecisiones;
    datos: DecisionesData;
    actual: DecisionesGuardadas | null;
    version: number;
    quien?: string;
    rol?: Rol;
    parcial?: boolean;
  },
): Result<SeccionGuardada> {
  const por = problemasPorSeccion(c, x.datos, x.parcial);
  if (por[x.s].length) return fail('invalid_input', por[x.s].join(' '));
  // Guardar una sección no da por revisadas las demás contra un guion nuevo: el guion de las decisiones se queda.
  const guion_id = x.actual?.guion_id ?? c.guion.id;
  const w = escribirDecisiones(c.dbLic, {
    id: c.id,
    guion_id,
    datos: x.datos,
    secciones: [x.s],
    autor: x.quien ?? 'web',
    rol: x.rol,
    esperada: x.version,
  });
  if (w.error) return w;
  const problemas_otras = Object.entries(por).flatMap(([s, ps]) => (s === x.s ? [] : ps));
  return ok({
    version: w.data.version,
    datos: x.datos,
    avisos: [...avisosDeEnfoque(c, x.s, x.datos), ...avisosDePrecio(c.dbLic, c.id, c.guion, x.datos)],
    problemas_otras,
  });
}

const avisar = (c: Contexto, s: SeccionDecisiones, version: number): void =>
  avisarDecisiones(c.dbLic, c.id, { guionVersion: c.guion.version, version, secciones: [s] });

// Deshace la transacción cuando algo falla a mitad: se lanza y se recoge aquí mismo.
class Revertida extends Error {
  constructor(readonly resultado: Result<unknown>) {
    super(resultado.error?.message);
  }
}

/** Ejecuta f en una transacción que se deshace entera si f devuelve un error (o lanza). */
export function todoONada<T>(db: Db, f: () => Result<T>): Result<T> {
  try {
    return db.transaction(() => {
      const r = f();
      if (r.error) throw new Revertida(r);
      return r;
    })();
  } catch (err) {
    if (err instanceof Revertida) return err.resultado as Result<T>;
    throw err;
  }
}

type CambioLotes = { actual: DecisionesGuardadas | null; lotes: string[]; version: number; quien?: string };

function lotesEnTransaccion(c: Contexto, x: CambioLotes): Result<SeccionGuardada> {
  // La base antes de elegir: sin decisiones guardadas, sus lotes son los de interés de antes.
  const base = baseDe(c, x.actual);
  const l = guardarLotesInteres(c.dbLic, c.id, { lotes: x.lotes, quien: x.quien });
  if (l.error) return l;
  const { datos, poda } = podarLotes(base, l.data.lotes);
  const r = escribir(c, {
    s: 'lotes',
    datos: normalizarDecisiones(datos, c.guion.datos),
    actual: x.actual,
    version: x.version,
    quien: x.quien,
  });
  return r.error ? r : ok({ ...r.data, poda });
}

/**
 * Cambia los lotes a los que se va (los de interés) y poda las decisiones en una sola transacción.
 * Los avisos (lotes y decisiones) salen tras el commit: un cambio que se deshace no se anuncia.
 */
function guardarLotes(c: Contexto, x: CambioLotes): Result<SeccionGuardada> {
  const e = EleccionLotes.safeParse({ lotes: x.lotes });
  if (!e.success) return fail('invalid_input', mensajesParaPersonas(e.error));
  const r = todoONada(c.dbLic, () => lotesEnTransaccion(c, x));
  if (r.error) return r;
  avisarLotes(c.dbLic, c.id, r.data.datos.lotes);
  avisar(c, 'lotes', r.data.version);
  return r;
}

/**
 * Guarda una sola sección de las decisiones, con la versión que se leyó (409 si ya no es la guardada).
 * parcial: lo guarda el asistente de la oferta, una respuesta cada vez (ver problemasPorSeccion).
 * rol: el de la persona que guarda desde la web (el precio solo lo guarda un admin).
 */
export function guardarSeccion(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  seccion: unknown,
  entrada: unknown,
  op: { parcial?: boolean; rol?: Rol } = {},
): Result<SeccionGuardada> {
  const s = SeccionDecisiones.safeParse(seccion);
  if (!s.success)
    return fail(
      'invalid_input',
      `No hay ninguna sección «${String(seccion)}» en las decisiones: ${SeccionDecisiones.options.join(', ')}.`,
    );
  const c = contextoDe(dbLic, dbNucleo, id);
  if (c.error) return c;
  const e = entradaDe(s.data).safeParse(entrada);
  if (!e.success) return fail('invalid_input', mensajeDeSeccion(s.data, e.error));
  const actual = decisionesDe(dbLic, id);
  if (actual && actual.version !== e.data.version) return fail('conflicto', MENSAJE_CONFLICTO);
  if (s.data === 'lotes')
    return guardarLotes(c.data, {
      actual,
      lotes: e.data.valor as string[],
      version: e.data.version,
      quien: e.data.quien,
    });
  const datos = normalizarDecisiones(conSeccion(baseDe(c.data, actual), s.data, e.data.valor), c.data.guion.datos);
  const r = escribir(c.data, {
    s: s.data,
    datos,
    actual,
    version: e.data.version,
    quien: e.data.quien,
    rol: op.rol,
    parcial: op.parcial,
  });
  if (!r.error) avisar(c.data, s.data, r.data.version);
  return r;
}
