// «Qué rehace un cambio» de una licitación: aplica un cambio al estado que mira dependencias.ts. Solo lee.
import { z } from 'zod';
import { listarPersonas } from '../../../nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { obtenerLicitacion, type Db } from '../store.js';
import { textoParaCoherencia } from './coherenciaMemoria.js';
import {
  Decisiones,
  decisionesDe,
  lotesDecididos,
  normalizarDecisiones,
  seccionesCambiadas,
  type DecisionesData,
} from './decisiones.js';
import { REHACER_AFECTADO } from './apartadosAfectados.js';
import {
  CambioImpacto,
  impactoDe,
  type ApartadoImpacto,
  type DocumentoImpacto,
  type EstadoImpacto,
  type Impacto,
  type PersonaImpacto,
} from './dependencias.js';
import { DATOS_ANEXO, type DatoAnexo } from './datosAnexo.js';
import { documentosDelGuion, type FilaDocumento } from './documentos.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { ApartadoDatos } from './memoriaRevision.js';
import { leerDependencias } from './memoria.js';
import { cierreDe } from './memoriaPresentada.js';
import { paqueteVigente } from './paqueteManifiesto.js';
import { parrafosDeVersionEntera } from './textoEntero.js';

// Arma el estado que mira el cálculo puro de dependencias.ts (anexos rellenados, apartados de la memoria de la
// oferta con su texto, equipo y paquete) y lo aplica al cambio pedido o a deshacer el último guardado de las
// decisiones. Solo lee, en una transacción de lectura: aplicar el cambio es siempre de una persona. Sin
// importes: ni el cambio los admite ni el resultado los lleva.
const log = logger('licitaciones');

type FilaDoc = Pick<FilaDocumento, 'clave' | 'estado' | 'oculto' | 'anexo_en'> & { con_plan: number };

// Las filas ocultas son de lotes que ya no van: no se presentan, no les afecta nada.
function documentosImpacto(db: Db, id: string, g: GuionGuardado | null, lotes: string[]): DocumentoImpacto[] {
  if (!g) return [];
  const filas = db
    .prepare(
      'SELECT clave, estado, oculto, anexo_en, sustituciones IS NOT NULL AS con_plan FROM oferta_documentos WHERE licitacion_id = ?',
    )
    .all(id) as FilaDoc[];
  const porClave = new Map(filas.map((f) => [f.clave, f]));
  return documentosDelGuion(g.datos, lotes).flatMap((d) => {
    const f = porClave.get(d.clave);
    if (f?.oculto) return [];
    return [
      {
        clave: d.clave,
        nombre: d.doc.nombre,
        tipo: d.doc.tipo,
        lote: d.lote,
        estado: f?.estado ?? 'pendiente',
        anexo_en: f?.anexo_en ?? null,
        con_plan: f?.con_plan === 1,
      },
    ];
  });
}

// Un apartado ilegible queda sin texto: el cálculo lo manda a revisar, nunca lo da por mantenido.
function textoDe(crudo: string | null): string | null {
  if (!crudo) return null;
  try {
    const d = ApartadoDatos.safeParse(JSON.parse(crudo));
    return d.success ? textoParaCoherencia(d.data) : null;
  } catch {
    return null;
  }
}

type MemoriaImpacto = { apartados: ApartadoImpacto[]; ensamblada: boolean };
type FilaMemoriaImpacto = {
  id: number;
  version: number;
  estado: string;
  subida: string | null;
  lote: string | null;
  sin_repartir: number;
};

// La memoria de trabajo de cada lote (la común, lote NULL, es uno más): la última que no es de
// ensayo, si no es la presentada. Lo presentado ya se entregó y un cambio no lo rehace: un lote
// cuya última es la presentada no aporta apartados (ni su borrador anterior), como uno cerrado.
const MEMORIAS_VIGENTES = `SELECT id, version, estado, subida, lote, sin_repartir FROM memorias m WHERE licitacion_id = ? AND ensayo = 0 AND presentada = 0
  AND version = (SELECT MAX(version) FROM memorias x WHERE x.licitacion_id = m.licitacion_id AND x.ensayo = 0 AND x.lote IS m.lote)
  ORDER BY lote`;

function apartadosDe(db: Db, m: FilaMemoriaImpacto, titulos: string[]): ApartadoImpacto[] {
  // Subida entera (subidaFlexible.ts): sin apartados, una pieza con todo su texto que solo se revisa.
  if (m.sin_repartir) {
    const texto = parrafosDeVersionEntera(db, m.id).join('\n');
    return [
      {
        memoria_version: m.version,
        lote: m.lote,
        n: 0,
        titulo: 'Memoria entera',
        texto: texto || null,
        dependencias: null,
        entera: true,
      },
    ];
  }
  const filas = db
    .prepare(
      "SELECT apartado, datos, dependencias FROM memoria_apartados WHERE memoria_id = ? AND estado = 'recibido' ORDER BY apartado",
    )
    .all(m.id) as { apartado: number; datos: string | null; dependencias: string | null }[];
  // Con las dependencias guardadas el cálculo no adivina por el texto; sin ellas (null), lo mira.
  // Los de una versión subida a mano solo se revisan: Hermes no la rehace.
  return filas.map((f) => ({
    memoria_version: m.version,
    lote: m.lote,
    n: f.apartado,
    titulo: titulos[f.apartado - 1] ?? `Apartado ${f.apartado}`,
    texto: textoDe(f.datos),
    dependencias: leerDependencias(f.dependencias),
    ...(m.subida ? { subida: true } : {}),
  }));
}

// La memoria de la oferta, calculada por lote cuando el pliego pide una por lote.
function memoriaImpacto(db: Db, id: string, g: GuionGuardado | null): MemoriaImpacto {
  const cerrado = cierreDe(db, id);
  const memorias = (db.prepare(MEMORIAS_VIGENTES).all(id) as FilaMemoriaImpacto[]).filter((m) => !cerrado(m.lote));
  const titulos = g?.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
  return {
    apartados: memorias.flatMap((m) => apartadosDe(db, m, titulos)),
    ensamblada: memorias.some((m) => m.estado === 'ensamblada'),
  };
}

// Cada persona una vez, con la unión de los lotes de sus roles (un rol sin lotes va en todos). Sin
// nombre conocido no se la puede buscar en los textos: se deja fuera y el cálculo revisa la memoria.
function equipoImpacto(dbNucleo: DbNucleo, d: DecisionesData | null): PersonaImpacto[] {
  if (!d) return [];
  const nombres = new Map(listarPersonas(dbNucleo, { inactivos: true }).map((p) => [p.id, p.nombre]));
  const porId = new Map<number, PersonaImpacto>();
  for (const m of d.equipo) {
    const nombre = nombres.get(m.persona_id);
    if (!nombre) continue;
    const previa = porId.get(m.persona_id);
    const todos = !m.lotes.length || (previa !== undefined && !previa.lotes.length);
    porId.set(m.persona_id, {
      persona_id: m.persona_id,
      nombre,
      lotes: todos ? [] : [...new Set([...(previa?.lotes ?? []), ...m.lotes])],
    });
  }
  return [...porId.values()];
}

// Los mismos lotes que la checklist: los decididos o, sin ellos, los del guion.
function lotesDeLaOferta(db: Db, id: string, g: GuionGuardado | null, d: DecisionesData | null): string[] {
  const decididos = lotesDecididos(db, id, d?.lotes ?? []);
  return decididos.length ? decididos : (g?.datos.lotes ?? []);
}

function leerEstado(db: Db, dbNucleo: DbNucleo, id: string): Result<EstadoImpacto> {
  if (!obtenerLicitacion(db, id)) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const g = guionVigente(db, id);
  const d = decisionesDe(db, id)?.datos ?? null;
  const lotes = lotesDeLaOferta(db, id, g, d);
  const memoria = memoriaImpacto(db, id, g);
  const paquete = paqueteVigente(db, id);
  return ok({
    lotes,
    documentos: documentosImpacto(db, id, g, lotes),
    apartados: memoria.apartados,
    equipo: equipoImpacto(dbNucleo, d),
    paquete: paquete ? { version: paquete.version } : null,
    memoria_ensamblada: memoria.ensamblada,
  });
}

/** Lo que mira el cálculo del impacto, leído de una vez y sin escribir. not_found si la licitación no existe. */
export function estadoImpacto(db: Db, dbNucleo: DbNucleo, id: string): Result<EstadoImpacto> {
  try {
    return db.transaction(() => leerEstado(db, dbNucleo, id)).deferred();
  } catch (err) {
    log.error('no se pudo leer el estado para el impacto', { id, error: errorMessage(err) });
    return fail('io_error', 'No se pudo leer el estado de la oferta.');
  }
}

// ── Entrada ──

const EntradaImpacto = z
  .strictObject({
    cambio: z.unknown().optional().describe('Lo que cambiaría: decisiones, lotes, empresa o guion'),
    deshacer: z.literal(true).optional().describe('Qué rehace deshacer el último guardado de las decisiones'),
  })
  .refine(
    (e) => (e.cambio !== undefined) !== (e.deshacer !== undefined),
    'Manda «cambio» (lo que cambiaría) o «deshacer»: true; una de las dos.',
  );

const CLAVES_CAMBIO = Object.keys(CambioImpacto.shape);
const CLAVES_DECISIONES = Object.keys(CambioImpacto.shape.decisiones.unwrap().shape);

const enumerarO = (t: string[]): string => (t.length > 1 ? `${t.slice(0, -1).join(', ')} o ${t.at(-1)}` : t.join(''));

// Zod solo diría «clave no reconocida»: se dice cuáles valen, que es lo que hace falta para corregirla.
function claveDesconocida(v: unknown, permitidas: string[], donde: string): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const otra = Object.keys(v).find((k) => !permitidas.includes(k));
  return otra === undefined ? null : `«${otra}» no es un cambio conocido${donde}: usa ${enumerarO(permitidas)}.`;
}

function cambioPedido(v: unknown): Result<CambioImpacto[]> {
  const desconocida =
    claveDesconocida(v, CLAVES_CAMBIO, '') ??
    claveDesconocida((v as { decisiones?: unknown } | null)?.decisiones, CLAVES_DECISIONES, ' de las decisiones');
  if (desconocida) return fail('invalid_input', desconocida);
  const c = CambioImpacto.safeParse(v);
  return c.success ? ok([c.data]) : fail('invalid_input', z.prettifyError(c.error));
}

// ── Deshacer ──

function anteriorA(db: Db, id: string, actual: number, g: GuionGuardado | null): DecisionesData | null {
  const f = db
    .prepare(
      'SELECT datos FROM decisiones_historial WHERE licitacion_id = ? AND version < ? ORDER BY version DESC LIMIT 1',
    )
    .get(id, actual) as { datos: string } | undefined;
  if (!f) return null;
  try {
    const d = Decisiones.safeParse(JSON.parse(f.datos));
    if (d.success) return g ? normalizarDecisiones(d.data, g.datos) : d.data;
  } catch (err) {
    log.warn('versión de las decisiones ilegible en el historial', { licitacion: id, error: errorMessage(err) });
  }
  return null;
}

// Un solo lote si solo cambió el de uno; si no, todos (lote null).
function loteDelPrecio(a: DecisionesData, b: DecisionesData): string | null {
  const porLote = (d: DecisionesData) => new Map(d.ofertas.map((o) => [o.lote, JSON.stringify(o)]));
  const x = porLote(a);
  const y = porLote(b);
  const lotes = [...new Set([...x.keys(), ...y.keys()])].filter((l) => x.get(l) !== y.get(l));
  return lotes.length === 1 ? lotes[0]! : null;
}

// Los datos del anexo (impuesto, orden de los lotes, subcontratación) que cambian al deshacer.
function datosAnexoDistintos(actual: DecisionesData, anterior: DecisionesData): DatoAnexo[] {
  return DATOS_ANEXO.filter(
    (k) => JSON.stringify(actual.datos_anexo?.[k] ?? null) !== JSON.stringify(anterior.datos_anexo?.[k] ?? null),
  );
}

// Quien está ahora y no estaba antes sale al deshacer; quien vuelve o cambia de rol, se revisa.
function cambiosDeEquipo(actual: DecisionesData, anterior: DecisionesData): { persona_id: number; sale: boolean }[] {
  const roles = (d: DecisionesData, id: number) =>
    d.equipo
      .filter((m) => m.persona_id === id)
      .map((m) => JSON.stringify([m.rol_en_la_oferta, m.dedicacion ?? null, m.lotes]))
      .sort()
      .join('|');
  const ids = [...new Set([...actual.equipo, ...anterior.equipo].map((m) => m.persona_id))];
  return ids
    .filter((id) => roles(actual, id) !== roles(anterior, id))
    .map((id) => ({ persona_id: id, sale: !anterior.equipo.some((m) => m.persona_id === id) }))
    .slice(0, 50);
}

function decisionesDeshechas(actual: DecisionesData, anterior: DecisionesData): Record<string, unknown> {
  const secciones = seccionesCambiadas(actual, anterior);
  const equipo = secciones.includes('equipo') ? cambiosDeEquipo(actual, anterior) : [];
  const blandas = (['automaticos', 'herramientas', 'enfoque'] as const).filter((s) => secciones.includes(s));
  const datos = secciones.includes('datos_anexo') ? datosAnexoDistintos(actual, anterior) : [];
  return {
    ...(secciones.includes('precio') ? { precio: { lote: loteDelPrecio(actual, anterior) } } : {}),
    ...(equipo.length ? { equipo } : {}),
    ...Object.fromEntries(blandas.map((s) => [s, true])),
    ...(datos.length ? { datos_anexo: datos } : {}),
  };
}

/** El paso de la versión vigente de las decisiones a la anterior, como cambios del cálculo (uno por tipo). */
function cambiosDeDeshacer(db: Db, id: string): Result<CambioImpacto[]> {
  const actual = decisionesDe(db, id);
  if (!actual) return fail('not_found', 'Aún no se han fijado las decisiones de la oferta.');
  const anterior = anteriorA(db, id, actual.version, guionVigente(db, id));
  if (!anterior) return fail('conflicto', `No hay ninguna versión anterior a la v${actual.version} que deshacer.`);
  const decisiones = decisionesDeshechas(actual.datos, anterior);
  const lotes = seccionesCambiadas(actual.datos, anterior).includes('lotes')
    ? lotesDecididos(db, id, anterior.lotes)
    : null;
  const crudos = [Object.keys(decisiones).length ? { decisiones } : null, lotes ? { lotes } : null].filter(
    (c) => c !== null,
  );
  const cambios = crudos.map((c) => CambioImpacto.safeParse(c));
  const malo = cambios.find((c) => !c.success);
  if (malo?.error) return fail('invalid_input', z.prettifyError(malo.error));
  return ok(cambios.flatMap((c) => (c.success ? [c.data] : [])));
}

// Varios cambios (deshacer un guardado que tocó lotes y otra sección): cada pieza una vez y solo
// se mantiene lo que se mantiene en todos.
function juntar(impactos: Impacto[]): Impacto {
  if (impactos.length === 1) return impactos[0]!;
  if (!impactos.length) return { afectadas: [], se_mantiene: [], resumen: 'No cambia nada de lo hecho.' };
  const porPieza = new Map<string, Impacto['afectadas'][number]>();
  for (const a of impactos.flatMap((i) => i.afectadas))
    if (!porPieza.has(`${a.pieza}#${a.clave}`)) porPieza.set(`${a.pieza}#${a.clave}`, a);
  const afectadas = [...porPieza.values()];
  const se_mantiene = impactos[0]!.se_mantiene.filter((m) => impactos.every((i) => i.se_mantiene.includes(m)));
  return { afectadas, se_mantiene, resumen: impactos.map((i) => i.resumen).join(' ') };
}

/**
 * Qué rehace un cambio antes de hacerlo: `{ cambio }` (decisiones, lotes, empresa o guion) o
 * `{ deshacer: true }` (volver a la versión anterior de las decisiones). No escribe nada.
 */
export function impactoDeLicitacion(db: Db, dbNucleo: DbNucleo, id: string, entrada: unknown): Result<Impacto> {
  const e = EntradaImpacto.safeParse(entrada ?? {});
  if (!e.success) return fail('invalid_input', z.prettifyError(e.error));
  const estado = estadoImpacto(db, dbNucleo, id);
  if (estado.error) return estado;
  const cambios = e.data.deshacer ? cambiosDeDeshacer(db, id) : cambioPedido(e.data.cambio);
  if (cambios.error) return cambios;
  // Un apartado que hay que rehacer se rehace con «Actualizar los apartados afectados»: mismo coste
  // que esa acción.
  return ok(juntar(cambios.data.map((c) => impactoDe(estado.data, c, REHACER_AFECTADO))));
}

/** El impacto sin los nombres del equipo (para quien no puede leer colaboradores): cada persona, por su id. */
export function impactoSinNombres(dbNucleo: DbNucleo, i: Impacto): Impacto {
  const personas = listarPersonas(dbNucleo, { inactivos: true }).filter((p) => p.nombre.trim());
  const tapar = (t: string) => personas.reduce((s, p) => s.split(p.nombre).join(`la persona ${p.id}`), t);
  return {
    ...i,
    resumen: tapar(i.resumen),
    afectadas: i.afectadas.map((a) => ({ ...a, nombre: tapar(a.nombre), pierde: a.pierde.map(tapar) })),
  };
}
