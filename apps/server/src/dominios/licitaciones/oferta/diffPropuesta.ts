// La propuesta de Hermes frente a lo guardado, campo a campo.
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { invalido, responder } from '../../../nucleo/http.js';
import { actorDe } from '../../../nucleo/permisos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Rol } from '../../../nucleo/usuarios.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { decisionesDe, type DecisionesData, type DecisionesGuardadas, type DecisionesRecibidas } from './decisiones.js';
import { contextoDe, guardarSeccion, todoONada, type Contexto } from './decisionesSecciones.js';
import type { GuionBaseData } from './guion.js';
import { automaticoDe, claveCriterio, criterioDelGuion, tramosDe } from './guionLotes.js';
import { pideEvidencia, propuestaDecisionesDe, type PropuestaGuardada } from './propuestaDecisiones.js';
import { sinCitasInternas } from './textoPliego.js';

// Lo guardado puede decir «desde la puesta en marcha» y la propuesta «a contar desde una fecha»; cargarla
// entera en el formulario lo pisaría todo. Por eso cada campo se aplica por separado, con el guardado por
// sección, y lo aplicado queda con su origen: lo propuso Hermes y lo aplicó una persona, con el motivo de Hermes
// aparte de la nota de la persona. El precio no está: la propuesta no lo trae.
type SeccionDiff = 'lotes' | 'equipo' | 'automaticos' | 'herramientas' | 'enfoque';
export type CampoDiff = {
  /** 'lotes' | `equipo:${persona_id}` | `automatico:${claveCriterio(criterio)}|${lote ?? ''}` | 'herramientas' | 'enfoque' */
  campo: string;
  seccion: SeccionDiff;
  guardado: unknown;
  propuesto: unknown;
  motivo_hermes: string | null;
  acreditacion: boolean;
  igual: boolean;
};

type Propuesta = PropuestaGuardada['datos'];
type AutoPropuesto = Propuesta['automaticos'][number];
type AutoGuardado = DecisionesData['automaticos'][number];
type Miembro = DecisionesData['equipo'][number];
type MiembroPropuesto = Propuesta['equipo'][number];

const comparable = (t: string | null | undefined) =>
  textoComparable(t ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const mismoTexto = (a: string | null | undefined, b: string | null | undefined) => comparable(a) === comparable(b);
const mismaLista = (a: string[], b: string[]) =>
  JSON.stringify(a.map(comparable).sort()) === JSON.stringify(b.map(comparable).sort());

/** La clave del campo de un criterio automático: su nombre sin el código del pliego y su lote. */
export const claveAutomatico = (criterio: string, lote: string | null | undefined): string =>
  `automatico:${claveCriterio(criterio)}|${lote ?? ''}`;

// El tramo con que se compara: el decidido o, en un criterio de un solo tramo, ese (como normalizarDecisiones).
function tramoDe(
  a: { criterio: string; lote?: string | null; nos_acogemos: boolean; tramo?: string | null },
  g: GuionBaseData,
): string | null {
  if (!a.nos_acogemos) return null;
  if (a.tramo) return a.tramo;
  const delGuion = automaticoDe(g, a.criterio, a.lote ?? null);
  const tramos = delGuion ? tramosDe(delGuion) : [];
  return tramos.length === 1 ? tramos[0]!.descripcion : null;
}

// Lo que se confirma uno a uno: lo que hay que tener (o el pliego pide acreditar con un documento o un hecho).
function esAcreditacion(p: AutoPropuesto, g: GuionBaseData): boolean {
  if (p.tipo === 'acreditacion') return true;
  const a = automaticoDe(g, p.criterio, p.lote ?? null);
  return Boolean(a && (a.tipo === 'acreditacion' || a.exige_documento || pideEvidencia(a.como_se_acredita)));
}

// Las propuestas anteriores traen el nivel aparte («seis meses a contar desde…»): cuenta como
// recogido si ya está en la nota de la persona o en el motivo de Hermes que se aplicó.
const nivelRecogido = (gu: AutoGuardado, nivel: string | undefined) =>
  !nivel || [gu.nota, gu.motivo_hermes].some((t) => t !== undefined && comparable(t).includes(comparable(nivel)));

function mismoAutomatico(gu: AutoGuardado | undefined, p: AutoPropuesto, g: GuionBaseData): boolean {
  if (!gu || gu.nos_acogemos !== p.nos_acogemos) return false;
  if (!mismoTexto(tramoDe(gu, g), tramoDe(p, g))) return false;
  return (!p.evidencia || mismoTexto(gu.evidencia, p.evidencia)) && nivelRecogido(gu, p.nivel);
}

function camposAutomaticos(guardados: AutoGuardado[], p: Propuesta, g: GuionBaseData): CampoDiff[] {
  return p.automaticos.map((a) => {
    const gu = guardados.find((x) => claveAutomatico(x.criterio, x.lote) === claveAutomatico(a.criterio, a.lote));
    return {
      campo: claveAutomatico(a.criterio, a.lote),
      seccion: 'automaticos',
      guardado: gu
        ? {
            criterio: gu.criterio,
            lote: gu.lote ?? null,
            nos_acogemos: gu.nos_acogemos,
            tramo: tramoDe(gu, g),
            evidencia: gu.evidencia ?? null,
            nota: gu.nota ?? null,
          }
        : null,
      propuesto: {
        criterio: a.criterio,
        lote: a.lote,
        nos_acogemos: a.nos_acogemos,
        tramo: tramoDe(a, g),
        evidencia: a.evidencia ?? null,
        nivel: a.nivel ?? null,
      },
      motivo_hermes: a.motivo,
      acreditacion: esAcreditacion(a, g),
      igual: mismoAutomatico(gu, a, g),
    };
  });
}

const vistaMiembro = (m: Miembro | MiembroPropuesto) => ({
  persona_id: m.persona_id,
  rol_en_la_oferta: m.rol_en_la_oferta,
  dedicacion: m.dedicacion ?? null,
});

// Un campo por persona de la propuesta o de lo guardado: la que Hermes no propone sale con propuesto null.
function camposEquipo(guardado: Miembro[], propuesto: MiembroPropuesto[]): CampoDiff[] {
  const ids = [...new Set([...propuesto, ...guardado].map((m) => m.persona_id))];
  return ids.map((id) => {
    const gu = guardado.find((m) => m.persona_id === id);
    const p = propuesto.find((m) => m.persona_id === id);
    const igual =
      gu && p
        ? mismoTexto(gu.rol_en_la_oferta, p.rol_en_la_oferta) && mismoTexto(gu.dedicacion, p.dedicacion)
        : !gu && !p;
    return {
      campo: `equipo:${id}`,
      seccion: 'equipo',
      guardado: gu ? vistaMiembro(gu) : null,
      propuesto: p ? vistaMiembro(p) : null,
      motivo_hermes: p?.motivo ?? null,
      acreditacion: false,
      igual,
    };
  });
}

const campoSimple = (
  seccion: 'lotes' | 'herramientas' | 'enfoque',
  guardado: unknown,
  propuesto: unknown,
  igual: boolean,
): CampoDiff => ({ campo: seccion, seccion, guardado, propuesto, motivo_hermes: null, acreditacion: false, igual });

/** Lo guardado frente a lo propuesto, campo a campo; sin decisiones guardadas, todo es nuevo. */
export function diffPropuesta(
  guardadas: DecisionesData | null,
  propuesta: PropuestaGuardada,
  g: GuionBaseData,
): CampoDiff[] {
  const p = propuesta.datos;
  return [
    campoSimple('lotes', guardadas?.lotes ?? null, p.lotes, Boolean(guardadas && mismaLista(guardadas.lotes, p.lotes))),
    ...camposEquipo(guardadas?.equipo ?? [], p.equipo),
    ...camposAutomaticos(guardadas?.automaticos ?? [], p, g),
    campoSimple(
      'herramientas',
      guardadas?.herramientas ?? null,
      p.herramientas,
      Boolean(guardadas && mismaLista(guardadas.herramientas, p.herramientas)),
    ),
    // Al guardar, el enfoque pierde las citas del pliego (sinCitasInternas): aplicado, ya es «Sin cambios».
    campoSimple(
      'enfoque',
      guardadas?.enfoque ?? null,
      p.enfoque,
      Boolean(guardadas && mismoTexto(guardadas.enfoque, sinCitasInternas(p.enfoque))),
    ),
  ];
}

export type DiffDeLicitacion = {
  campos: CampoDiff[];
  guion_version: number | null;
  guion_vigente: number;
  propuesta_creada_en: string;
};

const versionDeGuion = (db: Db, guionId: number): number | null =>
  (db.prepare('SELECT version FROM guiones WHERE id = ?').get(guionId) as { version: number } | undefined)?.version ??
  null;

function propuestaDe(c: Contexto): Result<PropuestaGuardada> {
  const p = propuestaDecisionesDe(c.dbLic, c.id);
  return p
    ? ok(p)
    : fail('not_found', 'Esta licitación no tiene propuesta de Hermes para las decisiones: pídela primero.');
}

/** El diff de la propuesta de una licitación contra sus decisiones guardadas. */
export function diffDeLicitacion(dbLic: Db, dbNucleo: DbNucleo, id: string): Result<DiffDeLicitacion> {
  const c = contextoDe(dbLic, dbNucleo, id);
  if (c.error) return c;
  const p = propuestaDe(c.data);
  if (p.error) return p;
  const campos = diffPropuesta(decisionesDe(dbLic, id)?.datos ?? null, p.data, c.data.guion.datos);
  return ok({
    campos,
    guion_version: versionDeGuion(dbLic, p.data.guion_id),
    guion_vigente: c.data.guion.version,
    propuesta_creada_en: p.data.creada_en,
  });
}

export type Aplicacion = { campos: string[]; quien: string; rol?: Rol };
type Aplicar = { c: Contexto; p: PropuestaGuardada; pedidos: CampoDiff[]; quien: string; rol?: Rol; en: string };

const ORDEN: SeccionDiff[] = ['lotes', 'equipo', 'automaticos', 'herramientas', 'enfoque'];
const origenDe = (x: Aplicar) => ({ propuesto_por: 'hermes' as const, aplicado_por: x.quien.slice(0, 80), en: x.en });

function equipoAplicado(actual: Miembro[], x: Aplicar): Miembro[] {
  const ids = new Set(
    x.pedidos.filter((f) => f.seccion === 'equipo').map((f) => Number(f.campo.slice('equipo:'.length))),
  );
  const propuestos = x.p.datos.equipo
    .filter((m) => ids.has(m.persona_id))
    .map((m): Miembro => ({
      persona_id: m.persona_id,
      rol_en_la_oferta: m.rol_en_la_oferta,
      ...(m.dedicacion ? { dedicacion: m.dedicacion } : {}),
      // Los lotes de cada persona no los propone Hermes: se quedan los que tenía.
      lotes: actual.find((a) => a.persona_id === m.persona_id)?.lotes ?? [],
      origen: origenDe(x),
      motivo_hermes: m.motivo,
    }));
  return [...actual.filter((m) => !ids.has(m.persona_id)), ...propuestos];
}

// La nota de la persona se queda; el nivel y el motivo de Hermes van a motivo_hermes.
function automaticoAplicado(p: AutoPropuesto, antes: AutoGuardado | undefined, x: Aplicar): AutoGuardado {
  const evidencia = p.evidencia ?? antes?.evidencia;
  return {
    criterio: p.criterio,
    lote: p.lote,
    nos_acogemos: p.nos_acogemos,
    tramo: p.nos_acogemos ? p.tramo : null,
    ...(evidencia ? { evidencia } : {}),
    ...(antes?.nota ? { nota: antes.nota } : {}),
    origen: origenDe(x),
    motivo_hermes: (p.nivel ? `${p.nivel}. ${p.motivo}` : p.motivo).slice(0, 600),
  };
}

// Lo de un guion anterior no se puede guardar con el vigente: se quita al tocar la sección, y se avisa.
function automaticosAplicados(actual: AutoGuardado[], x: Aplicar): { valor: AutoGuardado[]; avisos: string[] } {
  const g = x.c.guion.datos;
  const claves = new Set(x.pedidos.filter((f) => f.seccion === 'automaticos').map((f) => f.campo));
  const viejos = actual.filter((a) => criterioDelGuion(g, a.criterio) === null);
  const quedan = actual.filter((a) => criterioDelGuion(g, a.criterio) !== null);
  const aplicados = x.p.datos.automaticos
    .filter((a) => claves.has(claveAutomatico(a.criterio, a.lote)))
    .map((a) =>
      automaticoAplicado(
        a,
        quedan.find((q) => claveAutomatico(q.criterio, q.lote) === claveAutomatico(a.criterio, a.lote)),
        x,
      ),
    );
  const valor = [...quedan.filter((q) => !claves.has(claveAutomatico(q.criterio, q.lote))), ...aplicados];
  const avisos = viejos.length
    ? [
        `Se quitan ${viejos.length} criterios que ya no están en el guion vigente (v${x.c.guion.version}): ${viejos.map((v) => `«${v.criterio}»`).join(', ')}.`,
      ]
    : [];
  return { valor, avisos };
}

function valorDe(s: SeccionDiff, actual: DecisionesData | null, x: Aplicar): { valor: unknown; avisos: string[] } {
  if (s === 'equipo') return { valor: equipoAplicado(actual?.equipo ?? [], x), avisos: [] };
  if (s === 'automaticos') return automaticosAplicados(actual?.automaticos ?? [], x);
  return { valor: x.p.datos[s], avisos: [] };
}

// Una sección tras otra, cada una sobre lo que dejó la anterior (quitar un lote poda su parte).
function guardarPorSecciones(x: Aplicar): Result<{ guardadas: DecisionesGuardadas; avisos: string[] }> {
  const avisos: string[] = [];
  for (const s of ORDEN.filter((o) => x.pedidos.some((f) => f.seccion === o))) {
    const actual = decisionesDe(x.c.dbLic, x.c.id);
    const v = valorDe(s, actual?.datos ?? null, x);
    const r = guardarSeccion(
      x.c.dbLic,
      x.c.dbNucleo,
      x.c.id,
      s,
      { version: actual?.version ?? 1, valor: v.valor, quien: x.quien },
      { rol: x.rol },
    );
    if (r.error) return r;
    avisos.push(...v.avisos, ...r.data.avisos);
  }
  const guardadas = decisionesDe(x.c.dbLic, x.c.id);
  return guardadas
    ? ok({ guardadas, avisos })
    : fail('internal_error', 'Las decisiones aplicadas no se pudieron volver a leer.');
}

function elegirCampos(diff: CampoDiff[], campos: string[]): Result<CampoDiff[]> {
  const faltan = campos.filter((c) => !diff.some((f) => f.campo === c));
  if (faltan.length)
    return fail(
      'invalid_input',
      `La propuesta no tiene ${faltan.length === 1 ? 'el campo' : 'los campos'} ${faltan.map((f) => `«${f}»`).join(', ')}: vuelve a leer el diff.`,
    );
  const pedidos = diff.filter((f) => campos.includes(f.campo));
  // Una acreditación es una declaración: se confirma sola, nunca con «Aplicar todo».
  const acreditaciones = pedidos.filter((f) => f.acreditacion);
  if (acreditaciones.length && pedidos.length > 1)
    return fail(
      'invalid_input',
      `Lo que hay que acreditar se aplica de uno en uno: ${acreditaciones.map((f) => `«${f.campo}»`).join(', ')}.`,
    );
  return ok(pedidos);
}

function propuestaVigente(c: Contexto): Result<PropuestaGuardada> {
  const p = propuestaDe(c);
  if (p.error || p.data.guion_id === c.guion.id) return p;
  const v = versionDeGuion(c.dbLic, p.data.guion_id);
  return fail(
    'invalid_input',
    `La propuesta es del guion ${v === null ? 'anterior' : `v${v}`} y el vigente es el v${c.guion.version}: espera a la nueva.`,
  );
}

/** Aplica los campos elegidos de la propuesta de Hermes, todo o nada, sección a sección. */
export function aplicarPropuesta(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  a: Aplicacion,
): Result<DecisionesRecibidas> {
  const c = contextoDe(dbLic, dbNucleo, id);
  if (c.error) return c;
  const p = propuestaVigente(c.data);
  if (p.error) return p;
  const pedidos = elegirCampos(diffPropuesta(decisionesDe(dbLic, id)?.datos ?? null, p.data, c.data.guion.datos), [
    ...new Set(a.campos),
  ]);
  if (pedidos.error) return pedidos;
  const r = todoONada(dbLic, () =>
    guardarPorSecciones({
      c: c.data,
      p: p.data,
      pedidos: pedidos.data,
      quien: a.quien,
      rol: a.rol,
      en: new Date().toISOString(),
    }),
  );
  return r.error ? r : ok({ ...r.data.guardadas, avisos: [...new Set(r.data.avisos)] });
}

const AplicarEntrada = z.strictObject({
  campos: z.array(z.string().min(3).max(400)).min(1).max(200),
  quien: z.string().trim().min(2).max(60).optional(),
});

function aplicar(id: string, req: Request, res: Response): void {
  const e = AplicarEntrada.safeParse(req.body ?? {});
  if (!e.success) return invalido(res, e.error);
  const actor = actorDe(req);
  responder(
    res,
    aplicarPropuesta(dbLicitaciones(), nucleo().db, id, { campos: e.data.campos, quien: actor.nombre, rol: actor.rol }),
  );
}

export function rutasDiffPropuesta(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/decisiones/propuesta/diff',
    conId((id, _req, res) => responder(res, diffDeLicitacion(dbLicitaciones(), nucleo().db, id))),
  );
  r.post('/licitaciones/:id/oferta/decisiones/propuesta/aplicar', conId(aplicar));
}
