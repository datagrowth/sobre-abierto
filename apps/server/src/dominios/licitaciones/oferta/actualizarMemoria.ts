// La versión siguiente de una memoria montada, por un cambio tardío o para mejorarla.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { obtenerPersona } from '../../../nucleo/colaboradores/personas.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';
import { evaluacionDeMemoria, apartadosMejorables } from '../propuestas/evaluacion.js';
import { afectadosDeCambios, type Afectados } from './apartadosAfectados.js';
import { decisionesDe } from './decisiones.js';
import { enumerar } from './dependenciasAnexo.js';
import { componerDossier, dossierDe, guardarDossier, type ClaveDossier, type Dossier } from './dossier.js';
import { apartadosDe, copiarApartado, type FilaMemoria } from './ensamblado.js';
import type { GuionGuardado } from './guion.js';
import { apartadosCompatibles } from './guionDiff.js';
import { memoriaValorable } from './guionRevision.js';
import { desfaseMemoria, refirmarDossier } from './huellasMemoria.js';
import { comprobarPedido, siguienteVersion } from './memoria.js';
import { decisionesDelLote } from './memoriaLote.js';
import { avanzarMemoria } from './avanceMemoria.js';
import { duracionMejoraMin, guardaPlazo } from './plazo.js';
import { cambiosEntre } from './rebase.js';

// Dos clases. Por un CAMBIO TARDÍO («Actualizar los
// apartados afectados»): los apartados que dependen del cambio conservan su texto y cambian solo lo
// que depende de él. Para MEJORAR («Nueva versión» de una persona, con o sin indicaciones, o una
// ronda que pide Hermes): los apartados elegidos se reescriben para su tramo máximo con la
// evaluación de la base (mejoraMemoria.ts). En las dos se copian palabra por palabra los apartados
// que no se rehacen (con sus ediciones a mano) y la estrategia de la base sin los hechos que el
// cambio dejó atrás (huellasMemoria.ts), y el dossier se recompone por código: cuesta un run de
// redacción de lo que se rehace más la crítica. Una base montada por el método anterior (sin fase
// ni estrategia) o de un guion anterior compatible entra por el dossier: la máquina de fases lo
// compone con el guion vigente y, si falta, pide la estrategia antes de redactar.

const log = logger('licitaciones.memoria');

// Por un cambio tardío solo cambian los apartados afectados; para mejorarla se reescriben los elegidos.
export const NADA_QUE_ACTUALIZAR = 'Nada de esta memoria depende de lo que cambió: sigue valiendo.';
export const PREFIJO_HECHOS_REHECHOS = 'Hechos que se rehacen por el cambio:';

export type VersionNueva = { memoria: number; version: number; apartados: number[] };

// mejora: «Nueva versión» o una ronda de Hermes (sin ella, un cambio tardío). cambios: los de «qué
// rehace un cambio» (dependencias.ts): sin apartados elegidos deciden cuáles se rehacen, los mismos
// que cobra «Qué cambia». indicaciones: lo que quiere quien lleva la oferta; mandan sobre lo
// calculado. motivo: por qué la pidió un agente (licitaciones_pedir): es contexto, no indicaciones.
export type PedidoActualizar = {
  id: string;
  version: number;
  apartados?: number[] | undefined;
  confirmado?: boolean | undefined;
  cambios?: unknown[] | undefined;
  indicaciones?: string | undefined;
  motivo?: string | undefined;
  porAgente?: boolean | undefined;
  mejora?: boolean | undefined;
};
// forzados: los apartados que cambiaron de puntos, contenido o escala en el guion desde el de la
// base; se rehacen siempre. porDossier: la versión entra por la fase del dossier (la base se montó
// por el método anterior, sin estrategia, o es de otro guion).
type Base = { base: FilaMemoria; forzados: number[]; porDossier: boolean };
type Plan = Base & {
  guion: GuionGuardado;
  apartados: number[];
  hechos: string[];
  indicaciones: string | null;
  motivo: string | null;
  mejora: boolean;
  porAgente: boolean;
};

function memoriaPorVersion(db: Db, id: string, version: number): FilaMemoria | null {
  return (
    (db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, version) as
      FilaMemoria | undefined) ?? null
  );
}

// Solo frena la versión que se redacta del mismo lote, y nunca un ensayo.
function sinVersionAbierta(db: Db, base: FilaMemoria): Result<null> {
  const abierta = db
    .prepare(
      "SELECT version FROM memorias WHERE licitacion_id = ? AND ensayo = 0 AND lote IS ? AND estado IN ('redactando', 'ensamblando') ORDER BY version DESC LIMIT 1",
    )
    .get(base.licitacion_id, base.lote ?? null) as { version: number } | undefined;
  return abierta
    ? fail('conflicto', `La memoria v${abierta.version} aún se está redactando o ensamblando: espera a que termine.`)
    : ok(null);
}

const CAMBIOS_QUE_REHACEN = new Set(['puntos', 'contenido', 'escala']);

// Una base de un guion anterior vale si sus apartados son los mismos, en el mismo orden y con el
// mismo límite y formato (lo mismo que mira la cadena, memoria.ts › cubre); los que cambiaron de
// puntos, contenido o escala se rehacen. Sin saber qué cambió, no vale.
function forzadosPorGuion(db: Db, base: FilaMemoria, guion: GuionGuardado): Result<number[]> {
  if (base.guion_id === guion.id) return ok([]);
  const c = cambiosEntre(db, base.guion_id, guion.id);
  if (!c || !apartadosCompatibles(c))
    return fail(
      'conflicto',
      `La memoria v${base.version} se redactó con otro guion y el vigente es el v${guion.version}: pide una memoria nueva.`,
    );
  return ok(c.apartados.filter((a) => CAMBIOS_QUE_REHACEN.has(a.cambio)).map((a) => a.n));
}

// Solo la subida a mano (un Word o PDF de una persona: `subida`) no sirve de base: su texto no es de
// la plataforma y rehacerlo perdería su formato. Una montada por el método anterior a las fases sí:
// le falta la estrategia, que se pide antes de redactar.
function rechazoDeBase(base: FilaMemoria): string | null {
  const v = base.version;
  if (base.presentada) return `La memoria v${v} es la presentada: lo entregado no cambia, así que no se rehace.`;
  if (base.subida)
    return `La memoria v${v} se subió a mano: Hermes no la rehace. Corrígela en tu documento o pide una memoria nueva.`;
  if (base.estado !== 'ensamblada')
    return `La memoria v${v} aún no está montada: actualízala cuando termine de ensamblarse.`;
  if (base.ensayo)
    return `La memoria v${v} es de ensayo (no presentada): no se actualiza; pide cambios sobre la memoria de la oferta.`;
  return null;
}

function comprobarBaseActualizar(db: Db, id: string, version: number, guion: GuionGuardado): Result<Base> {
  const base = memoriaPorVersion(db, id, version);
  if (!base) return fail('not_found', `No hay memoria v${version} de esta licitación.`);
  const rechazo = rechazoDeBase(base);
  if (rechazo) return fail('conflicto', rechazo);
  const forzados = forzadosPorGuion(db, base, guion);
  if (forzados.error) return forzados;
  const abierta = sinVersionAbierta(db, base);
  if (abierta.error) return abierta;
  // Una con fases que se redactó sin estrategia (no daba tiempo) sigue sin ella, como se redactó.
  return ok({ base, forzados: forzados.data, porDossier: base.fase === null || base.guion_id !== guion.id });
}

// Una mejora parte de lo que dijo la evaluación de la base salvo que la persona dé sus indicaciones;
// un agente nunca las da: explica su motivo aparte.
function comprobarMejora(db: Db, p: PedidoActualizar, base: FilaMemoria, guion: GuionGuardado): Result<null> {
  if (p.porAgente && p.indicaciones !== undefined)
    return fail('invalid_input', 'Las indicaciones son de quien lleva la oferta: un agente explica su motivo aparte.');
  if (p.indicaciones !== undefined || evaluacionDeMemoria(db, base.licitacion_id, base.version)) return ok(null);
  if (!memoriaValorable(guion.datos.memoria!))
    return fail(
      'invalid_input',
      `El pliego no puntúa esta memoria, así que no tiene nota: escribe tus indicaciones para mejorar la v${base.version}.`,
    );
  return fail(
    'conflicto',
    `La memoria v${base.version} aún no tiene evaluación: espera a la autoevaluación, pide «Volver a evaluar» o escribe tus indicaciones.`,
  );
}

// Un apartado que no llegó a redactarse no se puede copiar: se rehace siempre con los elegidos, y
// también los que cambiaron en el guion.
function elegirApartados(db: Db, b: Base, total: number, elegidos: number[]): Result<number[]> {
  if (elegidos.some((n) => n > total))
    return fail('invalid_input', `La memoria tiene ${total} apartados: elige entre 1 y ${total}.`);
  if (!elegidos.length && !b.forzados.length) return fail('invalid_input', NADA_QUE_ACTUALIZAR);
  const sinTexto = apartadosDe(db, b.base.id)
    .filter((f) => f.estado !== 'recibido')
    .map((f) => f.apartado);
  return ok([...new Set([...elegidos, ...sinTexto, ...b.forzados])].sort((x, y) => x - y));
}

// ── Lo que se dice a Hermes ──

const QUE_CAMBIO: Partial<Record<ClaveDossier, string>> = {
  equipo: 'el equipo',
  herramientas: 'las herramientas',
  empresa: 'los datos de la empresa',
  identificacion: 'los datos de la licitación',
  frontera: 'lo que se acredita en otros archivos',
};

export type PersonaCambio = { nombre: string; rol: string };

/** «Cambió el equipo: Persona A ya no está; Docente principal del lote 2: Persona B.» (puro). */
export function textoDelCambio(secciones: ClaveDossier[], salen: string[], entran: PersonaCambio[]): string {
  const que = secciones.map((s) => QUE_CAMBIO[s] ?? s);
  const frases = [...salen.map((n) => `${n} ya no está`), ...entran.map((e) => `${e.rol}: ${e.nombre}`)];
  return `Cambió ${que.length ? enumerar(que) : 'lo decidido para la oferta'}${frases.length ? `: ${frases.join('; ')}` : ''}.`;
}

/**
 * Lo mismo sin nombres, para un equipo por roles (CV anonimizados): el texto va al
 * redactor y a la web, y un nombre ahí acabaría en la memoria (causa de exclusión). Puro.
 */
export function textoDelCambioPorRoles(secciones: ClaveDossier[], roles: string[], salen: number): string {
  const que = secciones.map((s) => QUE_CAMBIO[s] ?? s);
  const sinRol = salen - roles.length;
  const frases = [
    ...roles.map((r) => `cambia la persona del rol ${r}`),
    ...(sinRol > 0 ? [sinRol === 1 ? 'sale una persona del equipo' : `salen ${sinRol} personas del equipo`] : []),
  ];
  const cambio = `Cambió ${que.length ? enumerar(que) : 'lo decidido para la oferta'}${frases.length ? `: ${frases.join('; ')}` : ''}.`;
  return frases.length
    ? `${cambio} El pliego pide el equipo por roles: no escribas el nombre de nadie, solo su rol.`
    : cambio;
}

const nombreDe = (dbNucleo: DbNucleo, id: number): string | null => {
  const p = obtenerPersona(dbNucleo, id);
  return p.error ? null : p.data.nombre;
};

// Quién salió y quién entró: el equipo con el que se compuso el dossier de la base frente al del
// lote ahora. Por roles, solo los roles.
function textoPorDefecto(dbLic: Db, dbNucleo: DbNucleo, base: FilaMemoria, secciones: ClaveDossier[]): string {
  const dossier = dossierDe(dbLic, base.id);
  const antes = dossier?.equipo_ids ?? [];
  const todas = decisionesDe(dbLic, base.licitacion_id)?.datos;
  const equipo = todas ? decisionesDelLote(todas, base.lote ?? null).equipo : [];
  const salenIds = antes.filter((id) => !equipo.some((m) => m.persona_id === id));
  const entranMiembros = equipo.filter((m) => !antes.includes(m.persona_id));
  if (dossier?.equipo_por_roles)
    return textoDelCambioPorRoles(
      secciones,
      entranMiembros.map((m) => m.rol_en_la_oferta),
      salenIds.length,
    );
  const salen = salenIds.flatMap((id) => nombreDe(dbNucleo, id) ?? []);
  const entran = entranMiembros.flatMap((m) => {
    const n = nombreDe(dbNucleo, m.persona_id);
    return n ? [{ nombre: n, rol: m.rol_en_la_oferta }] : [];
  });
  return textoDelCambio(secciones, salen, entran);
}

const deApartados = (ns: number[]): string =>
  ns.length === 1 ? `del apartado ${ns[0]}` : `de los apartados ${enumerar(ns.map(String))}`;

// Lo que se cuenta del cambio tardío. Las indicaciones de la persona mandan. Si no, las del cambio
// («Persona B sustituye a Persona A como…»); sin él, lo que dicen las huellas; y lo que cambió en el
// guion. Por roles nunca las del cambio: nombran a las personas. Sin nada que contar, null: no se
// inventa un «Cambió lo decidido» que no pasó.
type Contexto = { b: Base; secciones: ClaveDossier[]; afectados: Afectados | null };
function indicacionesDelCambio(dbNucleo: DbNucleo, dbLic: Db, p: PedidoActualizar, c: Contexto): string | null {
  if (p.indicaciones !== undefined) return p.indicaciones;
  const { base, forzados } = c.b;
  const guion = forzados.length
    ? `El guion vigente cambió los puntos, el contenido o la escala ${deApartados(forzados)}: ajústalo a su rúbrica de ahora.`
    : null;
  const porRoles = dossierDe(dbLic, base.id)?.equipo_por_roles === true;
  const cambio =
    c.afectados && !porRoles
      ? c.afectados.indicaciones
      : c.secciones.length || p.cambios?.length
        ? textoPorDefecto(dbLic, dbNucleo, base, c.secciones)
        : null;
  return [cambio, guion].filter((t) => t).join(' ') || null;
}

// ── Con la base de datos ──

// La hoja de hechos de la base sin lo que dejó atrás el cambio: el aviso deja a la vista que la
// coherencia ya no comprueba esos hechos en los apartados que se rehacen.
function copiarEstrategia(db: Db, base: FilaMemoria, memoria: number, hechos: string[], cuando: string): void {
  const f = db.prepare('SELECT datos, avisos, ruta_md FROM memoria_estrategias WHERE memoria_id = ?').get(base.id) as
    { datos: string; avisos: string; ruta_md: string | null } | undefined;
  if (!f) return;
  const datos = JSON.parse(f.datos) as { hechos?: { clave: string }[] } & Record<string, unknown>;
  const sinAfectados = { ...datos, hechos: (datos.hechos ?? []).filter((h) => !hechos.includes(h.clave)) };
  const avisos = [
    ...(JSON.parse(f.avisos) as string[]),
    ...(hechos.length ? [`${PREFIJO_HECHOS_REHECHOS} ${hechos.join(', ')}.`] : []),
  ];
  db.prepare(
    'INSERT INTO memoria_estrategias (memoria_id, datos, avisos, agente, ruta_md, creada_en) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(memoria, JSON.stringify(sinAfectados), JSON.stringify(avisos), `copiado-v${base.version}`, f.ruta_md, cuando);
}

// Entra en la redacción (ronda 0) con los afectados pendientes: la máquina de fases encola un
// único run de redacción y sigue sola con la crítica y las rondas. Por el dossier, la máquina lo
// compone antes con el guion de la versión (y pide la estrategia si la base no tenía).
function crearVersion(db: Db, p: Plan): VersionNueva {
  const { base, apartados } = p;
  return db.transaction(() => {
    const cuando = new Date().toISOString();
    const version = siguienteVersion(db, base.licitacion_id);
    const memoria = Number(
      db
        .prepare(
          `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, version_base, apartados_rehechos, indicaciones, lote, fase, ronda, por_agente, mejora, motivo_agente)
      VALUES (?, ?, ?, 'redactando', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          base.licitacion_id,
          p.guion.id,
          version,
          cuando,
          base.version,
          JSON.stringify(apartados),
          p.indicaciones,
          base.lote ?? null,
          p.porDossier ? 'dossier' : 'redaccion',
          p.porAgente ? 1 : 0,
          p.mejora ? 1 : 0,
          p.motivo,
        ).lastInsertRowid,
    );
    const pendiente = db.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, ?, 'pendiente')",
    );
    for (const f of apartadosDe(db, base.id)) {
      if (apartados.includes(f.apartado)) pendiente.run(memoria, f.apartado);
      else copiarApartado(db, f, memoria, base.version, cuando);
    }
    copiarEstrategia(db, base, memoria, p.hechos, cuando);
    // La ficha de solución revisada por una persona sigue protegiendo sus valores en las rondas (planearParche).
    db.prepare(
      `INSERT INTO memoria_fichas_solucion (memoria_id, estado, campos, creada_en, vence_en, revisada_en, revisada_por, editados)
      SELECT ?, estado, campos, creada_en, vence_en, revisada_en, revisada_por, editados FROM memoria_fichas_solucion WHERE memoria_id = ?`,
    ).run(memoria, base.id);
    return { memoria, version, apartados };
  })();
}

// El dossier se compone antes de crear la versión (es lo único lento): así la vuelta de las memorias
// nunca encola la redacción de una versión sin dossier. Si no se puede guardar, la versión falla con el motivo.
function guardarDossierDe(db: Db, d: Dossier, r: VersionNueva): Result<null> {
  const g = guardarDossier(db, { ...d, memoria_id: r.memoria, version: r.version });
  if (!g.error) return ok(null);
  const motivo = `No se pudo componer el dossier de la memoria: ${g.error.message}`;
  db.prepare("UPDATE memorias SET estado = 'fallida', error = ? WHERE id = ? AND estado = 'redactando'").run(
    motivo,
    r.memoria,
  );
  return fail(g.error.code, motivo);
}

// Cambió algo del dossier y ningún apartado depende de ello: la memoria sigue valiendo y se vuelve
// a firmar el dossier con las huellas de ahora, para que el desfase no se quede para siempre.
function nadaQueActualizar(dbNucleo: DbNucleo, dbLic: Db, base: FilaMemoria, secciones: ClaveDossier[]): Result<never> {
  if (secciones.length) {
    const r = refirmarDossier(dbLic, dbNucleo, base.id);
    if (r.error) log.warn('dossier sin volver a firmar', { memoria: base.id, motivo: r.error.code });
  }
  return fail('invalid_input', NADA_QUE_ACTUALIZAR);
}

/// Los que se rehacen en un cambio tardío sin apartados elegidos: con los cambios, los mismos que
// calcula «Qué cambia» (apartadosAfectados.ts); sin ellos, los que dicen las huellas del dossier.
function afectadosDelCambio(
  dbNucleo: DbNucleo,
  dbLic: Db,
  p: PedidoActualizar,
  desfase: number[],
): Result<{ apartados: number[]; afectados: Afectados | null }> {
  if (!p.cambios?.length) return ok({ apartados: desfase, afectados: null });
  const a = afectadosDeCambios(dbNucleo, dbLic, { id: p.id, version: p.version, cambios: p.cambios });
  return a.error ? a : ok({ apartados: a.data.apartados, afectados: a.data });
}

// Una mejora sin apartados elegidos rehace los que la evaluación deja por debajo de su tramo máximo.
function elegidosMejora(db: Db, b: Base, guion: GuionGuardado, p: PedidoActualizar): Result<number[]> {
  if (p.apartados) return ok(p.apartados);
  const ev = evaluacionDeMemoria(db, b.base.licitacion_id, b.base.version);
  if (!ev && !b.forzados.length) return fail('invalid_input', 'Sin evaluación, elige qué apartados rehacer.');
  const mejorables = ev ? apartadosMejorables(ev, guion) : [];
  if (!mejorables.length && !b.forzados.length)
    return fail(
      'invalid_input',
      'Según la evaluación, todos los apartados están en su tramo máximo: elige cuáles rehacer.',
    );
  return ok(mejorables);
}

type Eleccion = { apartados: number[]; indicaciones: string | null };

function eleccionMejora(db: Db, b: Base, guion: GuionGuardado, p: PedidoActualizar): Result<Eleccion> {
  const m = comprobarMejora(db, p, b.base, guion);
  if (m.error) return m;
  const e = elegidosMejora(db, b, guion, p);
  return e.error ? e : ok({ apartados: e.data, indicaciones: p.indicaciones ?? null });
}

// Si nada depende de lo que cambió (ni cambió el guion), no hay nada que actualizar.
function eleccionCambio(
  dbNucleo: DbNucleo,
  dbLic: Db,
  p: PedidoActualizar,
  b: Base,
  d: { secciones: ClaveDossier[]; apartados: number[] },
): Result<Eleccion> {
  const a = afectadosDelCambio(dbNucleo, dbLic, p, d.apartados);
  if (a.error) return a;
  const elegidos = p.apartados ?? a.data.apartados;
  if (!elegidos.length && !b.forzados.length) return nadaQueActualizar(dbNucleo, dbLic, b.base, d.secciones);
  const contexto = { b, secciones: d.secciones, afectados: a.data.afectados };
  return ok({ apartados: elegidos, indicaciones: indicacionesDelCambio(dbNucleo, dbLic, p, contexto) });
}

// Lo que se comprueba sin escribir: pedido, base, qué cambió y el plazo con lo que se rehace. Un agente no
// puede confirmar un plazo justo: como en sus otras fases, recibe «plazo_insuficiente» y no gasta el run.
function planificar(dbNucleo: DbNucleo, dbLic: Db, salidasDir: string | null, p: PedidoActualizar): Result<Plan> {
  const aMano = p.porAgente !== true;
  const guion = comprobarPedido(dbNucleo, dbLic, salidasDir, p.id, {
    tipo: 'mejora',
    aMano,
    confirmado: p.confirmado,
    duracionMin: duracionMejoraMin(1),
  });
  if (guion.error) return guion;
  const b = comprobarBaseActualizar(dbLic, p.id, p.version, guion.data);
  if (b.error) return b;
  const desfase = desfaseMemoria(dbLic, dbNucleo, b.data.base.id);
  if (desfase.error) return desfase;
  const d = desfase.data ?? { secciones: [], hechos: [], apartados: [] };
  const e = p.mejora ? eleccionMejora(dbLic, b.data, guion.data, p) : eleccionCambio(dbNucleo, dbLic, p, b.data, d);
  if (e.error) return e;
  const apartados = elegirApartados(dbLic, b.data, guion.data.datos.memoria!.apartados.length, e.data.apartados);
  if (apartados.error) return apartados;
  const plazo = guardaPlazo(dbLic, p.id, 'mejora', {
    aMano,
    confirmado: p.confirmado,
    duracionMin: duracionMejoraMin(apartados.data.length),
  });
  if (plazo.error) return plazo;
  return ok({
    ...b.data,
    guion: guion.data,
    apartados: apartados.data,
    hechos: d.hechos,
    indicaciones: e.data.indicaciones,
    motivo: p.motivo ?? null,
    mejora: p.mejora === true,
    porAgente: p.porAgente === true,
  });
}

/**
 * Crea la versión siguiente de una memoria montada rehaciendo solo los apartados elegidos (por
 * defecto, en un cambio tardío los que dependen de lo que cambió; en una mejora, los mejorables) y
 * los que cambiaron en el guion. Los errores del pedido o del plazo se devuelven tal cual.
 */
export async function actualizarMemoria(
  dbNucleo: DbNucleo,
  dbLic: Db,
  salidasDir: string | null,
  p: PedidoActualizar,
): Promise<Result<VersionNueva>> {
  const plan = planificar(dbNucleo, dbLic, salidasDir, p);
  if (plan.error) return plan;
  // Por el dossier lo compone la máquina de fases con el guion de la versión nueva.
  const dossier = plan.data.porDossier ? null : await componerDossier(dbLic, dbNucleo, plan.data.base.id);
  if (dossier?.error)
    return fail(dossier.error.code, `No se pudo componer el dossier de la memoria: ${dossier.error.message}`);
  // Mientras se componía pudo empezar otra versión del mismo lote.
  const abierta = sinVersionAbierta(dbLic, plan.data.base);
  if (abierta.error) return abierta;
  const r = crearVersion(dbLic, plan.data);
  const g = dossier ? guardarDossierDe(dbLic, dossier.data, r) : ok(null);
  if (g.error) return g;
  const { base } = plan.data;
  emitir(dbLic, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: p.id,
    datos: {
      accion: 'actualizada',
      version: r.version,
      version_base: base.version,
      apartados: r.apartados.length,
      ...(base.lote ? { lote: base.lote } : {}),
    },
  });
  log.info('memoria actualizada', {
    licitacion: p.id,
    version_base: base.version,
    version: r.version,
    apartados: r.apartados.join(','),
    hechos: plan.data.hechos.length,
  });
  await avanzarMemoria(dbNucleo, dbLic, r.memoria).catch((err: unknown) =>
    log.error('memoria sin avanzar tras actualizarla', {
      memoria: r.memoria,
      clase: err instanceof Error ? err.name : typeof err,
    }),
  );
  return ok(r);
}
