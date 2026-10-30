// «Actualizar los apartados afectados»: qué apartados rehace un cambio de equipo o de lotes.
import type { Router } from 'express';
import { z } from 'zod';
import { listarPersonas } from '../../../nucleo/colaboradores/personas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fallo, invalido, responder } from '../../../nucleo/http.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { descartarEvaluacionDeVersion } from '../propuestas/evaluacion.js';
import { textoParaCoherencia } from './coherenciaMemoria.js';
import { decisionesDe, lotesDecididos, type DecisionesData } from './decisiones.js';
import { decisionesEn } from './decisionesHistorial.js';
import { enumerar } from './dependenciasAnexo.js';
import {
  CambioImpacto,
  impactoDe,
  type Afectada,
  type ApartadoImpacto,
  type Coste,
  type EstadoImpacto,
  type PersonaImpacto,
  type RehacerApartado,
} from './dependencias.js';
import {
  apartadosDe,
  copiarApartado,
  montarReservada,
  rehechosDe,
  reservarRemontado,
  soltarRemontado,
  type Ensamblada,
  type FilaApartado,
  type FilaMemoria,
} from './ensamblado.js';
import { equipoAnonimo } from './dossier.js';
import { guionPorId, guionVigente } from './guion.js';
import { estadoImpacto } from './impacto.js';
import { dependenciasDe } from './memoria.js';
import { ApartadoDatos, textoDeBloque, type ApartadoDatosData } from './memoriaRevision.js';

const log = logger('licitaciones.memoria');

// Rehace los que nombran lo que cambió en sus dependencias guardadas, con las indicaciones que recibe quien los
// rehace (actualizarMemoria.ts). Luego, por apartado, «Mantener el anterior» vuelve a poner el texto de la base
// y monta la versión sin IA, y el diff enseña los dos textos. Nunca mira el precio: la memoria no lo menciona y
// las dependencias no lo llevan.
// Un apartado que se rehace con el cambio mínimo: un run corto, no el grupo de runs de una mejora.
const COSTE_APARTADO_AFECTADO: Coste = { min: 30, runs: 1 };
/** Lo que cuesta rehacer un apartado afectado: lo mismo en «qué rehace un cambio» que al actualizarlos. */
export const REHACER_AFECTADO: RehacerApartado = { coste: COSTE_APARTADO_AFECTADO, pierde: [] };

// ── Indicaciones (puro) ──

type MiembroCambio = { persona_id: number; rol: string; lotes: string[] };
export type EquipoYLotes = { lotes: string[]; equipo: MiembroCambio[] };
export type PersonaNombre = { persona_id: number; nombre: string };

const mismoRol = (a: string, b: string) => textoComparable(a).trim() === textoComparable(b).trim();
const deLotes = (ls: string[]) => (ls.length === 1 ? `del lote ${ls[0]}` : `de los lotes ${enumerar(ls)}`);
// «Docente principal» con sus lotes, salvo que el rol ya los diga.
const comoRol = (m: MiembroCambio) =>
  m.lotes.length && !/\blotes?\b/i.test(m.rol) ? `${m.rol} ${deLotes(m.lotes)}` : m.rol;

function fraseSale(id: number, antes: EquipoYLotes, despues: EquipoYLotes, nombre: (id: number) => string): string[] {
  const roles = antes.equipo.filter((m) => m.persona_id === id);
  if (!roles.length) return [`${nombre(id)} ya no está en el equipo: quita su nombre`];
  return roles.map((r) => {
    const sustituto = despues.equipo.find((m) => m.persona_id !== id && mismoRol(m.rol, r.rol));
    return sustituto
      ? `${nombre(sustituto.persona_id)} sustituye a ${nombre(id)} como ${comoRol(r)}`
      : `${nombre(id)} ya no está en el equipo (era ${comoRol(r)}): quita su nombre y reparte lo que hacía entre el equipo que queda`;
  });
}

function fraseEntra(id: number, antes: EquipoYLotes, despues: EquipoYLotes, nombre: (id: number) => string): string[] {
  const roles = despues.equipo.filter((m) => m.persona_id === id).map(comoRol);
  if (!roles.length) return [];
  const estaba = antes.equipo.some((m) => m.persona_id === id);
  return [`${nombre(id)} ${estaba ? 'pasa a ser' : 'entra en el equipo como'} ${enumerar(roles)}`];
}

function frasesLotes(lotes: string[], antes: string[]): string[] {
  const quitados = antes.filter((l) => !lotes.includes(l));
  const nuevos = [...new Set(lotes.filter((l) => !antes.includes(l)))];
  return [
    ...(quitados.length
      ? [quitados.length === 1 ? `el lote ${quitados[0]} ya no va` : `los lotes ${enumerar(quitados)} ya no van`]
      : []),
    ...(nuevos.length
      ? [
          nuevos.length === 1
            ? `ahora también va el lote ${nuevos[0]}`
            : `ahora también van los lotes ${enumerar(nuevos)}`,
        ]
      : []),
  ];
}

// Por roles (CV anonimizados): las mismas frases sin el nombre de nadie, como
// textoDelCambioPorRoles. Un nombre en la consigna acabaría en el apartado, y recibirlo se rechaza.
function fraseSalePorRoles(id: number, antes: EquipoYLotes, despues: EquipoYLotes): string[] {
  const roles = antes.equipo.filter((m) => m.persona_id === id);
  if (!roles.length) return ['sale una persona del equipo'];
  return roles.map((r) =>
    despues.equipo.some((m) => m.persona_id !== id && mismoRol(m.rol, r.rol))
      ? `cambia la persona del rol ${comoRol(r)}`
      : `sale del equipo la persona del rol ${comoRol(r)}: reparte lo que hacía entre el equipo que queda`,
  );
}

function fraseEntraPorRoles(id: number, antes: EquipoYLotes, despues: EquipoYLotes): string[] {
  const roles = despues.equipo.filter((m) => m.persona_id === id).map(comoRol);
  if (!roles.length) return [];
  return [
    antes.equipo.some((m) => m.persona_id === id)
      ? `una persona del equipo pasa a ser ${enumerar(roles)}`
      : `entra en el equipo una persona como ${enumerar(roles)}`,
  ];
}

const POR_ROLES = 'El pliego pide el equipo por roles: no escribas el nombre de nadie, solo su rol.';

const BLANDAS = {
  automaticos: 'lo ofrecido en los criterios automáticos',
  herramientas: 'las herramientas',
  enfoque: 'el enfoque',
} as const;

// El precio no da frase: la memoria no puede mencionarlo. nombre null: por roles, sin nombres.
function frasesDecisiones(
  d: NonNullable<CambioImpacto['decisiones']>,
  antes: EquipoYLotes,
  despues: EquipoYLotes,
  nombre: ((id: number) => string) | null,
): string[] {
  const equipo = (d.equipo ?? []).flatMap((c) =>
    nombre
      ? (c.sale ? fraseSale : fraseEntra)(c.persona_id, antes, despues, nombre)
      : (c.sale ? fraseSalePorRoles : fraseEntraPorRoles)(c.persona_id, antes, despues),
  );
  const blandas = (Object.keys(BLANDAS) as (keyof typeof BLANDAS)[])
    .filter((s) => d[s])
    .map((s) => `cambió ${BLANDAS[s]} de las decisiones`);
  return [...equipo, ...blandas];
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Lo que cambió, en una frase para quien redacta: «Persona B sustituye a Persona A como docente
 * principal del lote 2; el lote 6 ya no va.». personas null: el pliego pide el equipo por roles
 * (equipoAnonimo) y las frases solo dicen roles, con la consigna de no nombrar a nadie.
 */
export function indicacionesDeCambio(
  cambio: CambioImpacto,
  antes: EquipoYLotes,
  despues: EquipoYLotes,
  personas: PersonaNombre[] | null,
): string {
  const nombres = new Map((personas ?? []).map((p) => [p.persona_id, p.nombre.trim()]));
  const nombre = personas ? (id: number) => nombres.get(id) || `la persona ${id}` : null;
  const frases = [
    ...(cambio.decisiones ? frasesDecisiones(cambio.decisiones, antes, despues, nombre) : []),
    ...(cambio.lotes ? frasesLotes(cambio.lotes, antes.lotes) : []),
    ...(cambio.empresa ? [`cambiaron datos de la empresa (${enumerar(cambio.empresa)})`] : []),
    ...(cambio.guion ? ['el guion se volvió a extraer del pliego'] : []),
  ];
  if (!frases.length) return 'Ajusta el apartado a las decisiones vigentes de la oferta.';
  const texto = `${capital(frases.join('; '))}.`;
  return !personas && cambio.decisiones?.equipo?.length ? `${texto} ${POR_ROLES}` : texto;
}

// ── Qué apartados se rehacen (puro) ──

/** Los apartados que el cambio obliga a rehacer, cada uno en un run corto. */
export function apartadosARehacer(estado: EstadoImpacto, cambio: CambioImpacto): Afectada[] {
  return impactoDe(estado, cambio, REHACER_AFECTADO).afectadas.filter(
    (a) => a.pieza === 'apartado' && a.accion === 'rehacer',
  );
}

const numeroDeApartado = (a: Afectada): number => Number(a.clave.split('-').at(-1));

// ── Con la base de datos ──

// Subida a mano (subida.ts, subidaFlexible.ts): Hermes no rehace un documento de una persona
// (actualizarMemoria.ts lo rechaza); el cambio se corrige en ese documento.
const SUBIDA = (v: number): string =>
  `La v${v} se subió a mano: Hermes no la rehace. Corrige el cambio en tu documento y súbelo otra vez, o pide una memoria nueva.`;

function memoriaPorVersion(db: Db, id: string, version: number): FilaMemoria | null {
  return (
    (db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, version) as
      FilaMemoria | undefined) ?? null
  );
}

function datosDe(f: Pick<FilaApartado, 'estado' | 'datos'> | undefined): ApartadoDatosData | null {
  if (f?.estado !== 'recibido' || !f.datos) return null;
  try {
    const d = ApartadoDatos.safeParse(JSON.parse(f.datos));
    return d.success ? d.data : null;
  } catch {
    return null;
  }
}

// Los apartados de la versión base (no de la última): es sobre ellos donde se aplica el cambio.
function apartadosDeLaBase(db: Db, m: FilaMemoria): ApartadoImpacto[] {
  const titulos = guionPorId(db, m.guion_id)?.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
  return apartadosDe(db, m.id)
    .filter((f) => f.estado === 'recibido')
    .map((f) => {
      const d = datosDe(f);
      return {
        memoria_version: m.version,
        n: f.apartado,
        titulo: titulos[f.apartado - 1] ?? `Apartado ${f.apartado}`,
        texto: d ? textoParaCoherencia(d) : null,
        dependencias: dependenciasDe(db, m.id, f.apartado),
      };
    });
}

const equipoYLotes = (db: Db, id: string, d: DecisionesData | null): EquipoYLotes => ({
  lotes: lotesDecididos(db, id, d?.lotes ?? []),
  equipo: (d?.equipo ?? []).map((m) => ({ persona_id: m.persona_id, rol: m.rol_en_la_oferta, lotes: m.lotes })),
});

type AntesDespues = { antes: EquipoYLotes; despues: EquipoYLotes };

// Antes: las decisiones con las que se pidió la base. Así el cambio se ve igual guardado o no.
function antesYDespues(db: Db, base: FilaMemoria): AntesDespues {
  const actual = decisionesDe(db, base.licitacion_id)?.datos ?? null;
  const entonces = decisionesEn(db, base.licitacion_id, base.pedida_en) ?? actual;
  return {
    antes: equipoYLotes(db, base.licitacion_id, entonces),
    despues: equipoYLotes(db, base.licitacion_id, actual),
  };
}

// Si las decisiones ya se guardaron, el estado de ahora no tiene el lote quitado ni a quien sale:
// se suman los de la base para que la regla los encuentre.
function estadoConLaBase(
  e: EstadoImpacto,
  apartados: ApartadoImpacto[],
  ad: AntesDespues,
  personas: PersonaNombre[],
): EstadoImpacto {
  const lotesDeps = apartados.flatMap((a) => a.dependencias?.['ambito.lotes'] ?? []);
  const lotes = [...new Set([...e.lotes, ...ad.antes.lotes, ...lotesDeps])];
  const conocidas = new Set(e.equipo.map((p) => p.persona_id));
  const nombres = new Map(personas.map((p) => [p.persona_id, p.nombre]));
  const salidas: PersonaImpacto[] = ad.antes.equipo
    .filter((m) => !conocidas.has(m.persona_id) && nombres.get(m.persona_id))
    .map((m) => ({ persona_id: m.persona_id, nombre: nombres.get(m.persona_id)!, lotes: m.lotes }));
  return { ...e, lotes, apartados, equipo: [...e.equipo, ...new Map(salidas.map((p) => [p.persona_id, p])).values()] };
}

export type PedidoAfectados = { id: string; version: number; cambio: unknown };
export type Afectados = { afectadas: Afectada[]; apartados: number[]; indicaciones: string };

/** Qué apartados de la versión `version` rehace un cambio, con su coste, lo que se pierde y las indicaciones que recibirá Hermes. No escribe. */
export function apartadosAfectadosDe(dbNucleo: DbNucleo, dbLic: Db, p: PedidoAfectados): Result<Afectados> {
  const cambio = CambioImpacto.safeParse(p.cambio);
  if (!cambio.success) return fail('invalid_input', z.prettifyError(cambio.error));
  const base = memoriaPorVersion(dbLic, p.id, p.version);
  if (!base) return fail('not_found', `No hay memoria v${p.version} de esta licitación.`);
  if (base.subida) return fail('conflicto', SUBIDA(p.version));
  const estado = estadoImpacto(dbLic, dbNucleo, p.id);
  if (estado.error) return estado;
  const personas = listarPersonas(dbNucleo, { inactivos: true }).map((x) => ({ persona_id: x.id, nombre: x.nombre }));
  const ad = antesYDespues(dbLic, base);
  const afectadas = apartadosARehacer(
    estadoConLaBase(estado.data, apartadosDeLaBase(dbLic, base), ad, personas),
    cambio.data,
  );
  // Con el equipo por roles las indicaciones no nombran a nadie: van a Hermes y se guardan en la memoria.
  const guion = guionVigente(dbLic, p.id) ?? guionPorId(dbLic, base.guion_id);
  const indicaciones = indicacionesDeCambio(
    cambio.data,
    ad.antes,
    ad.despues,
    guion && equipoAnonimo(guion.datos) ? null : personas,
  );
  return ok({ afectadas, apartados: afectadas.map(numeroDeApartado), indicaciones });
}

// Un cambio de equipo y otro de lotes a la vez: cada apartado una vez, con todo lo que lo rehace.
function unirAfectados(partes: Afectados[]): Afectados {
  const porClave = new Map<string, Afectada>();
  for (const a of partes.flatMap((x) => x.afectadas)) {
    const previa = porClave.get(a.clave);
    porClave.set(a.clave, previa ? { ...previa, por: [...new Set([...previa.por, ...a.por])] } : a);
  }
  const afectadas = [...porClave.values()].sort((a, b) => numeroDeApartado(a) - numeroDeApartado(b));
  return {
    afectadas,
    apartados: afectadas.map(numeroDeApartado),
    indicaciones: partes.map((x) => x.indicaciones).join(' '),
  };
}

/** Qué apartados de la versión `version` rehacen varios cambios juntos (cada uno validado como CambioImpacto). No escribe. */
export function afectadosDeCambios(
  dbNucleo: DbNucleo,
  dbLic: Db,
  p: { id: string; version: number; cambios: unknown[] },
): Result<Afectados> {
  const partes: Afectados[] = [];
  for (const cambio of p.cambios) {
    const a = apartadosAfectadosDe(dbNucleo, dbLic, { id: p.id, version: p.version, cambio });
    if (a.error) return a;
    partes.push(a.data);
  }
  return ok(unirAfectados(partes));
}

// ── Vista previa para la tarjeta de memoria (no conoce el cambio: lo deduce) ──

const huellaMiembro = (m: MiembroCambio): string => `${textoComparable(m.rol).trim()}|${[...m.lotes].sort().join(',')}`;
const rolesDe = (e: EquipoYLotes, id: number): string =>
  e.equipo
    .filter((m) => m.persona_id === id)
    .map(huellaMiembro)
    .sort()
    .join(';');
const mismosLotes = (a: string[], b: string[]): boolean =>
  new Set(a).size === new Set(b).size && a.every((l) => b.includes(l));

/**
 * Lo que cambió en el equipo y en los lotes de `antes` a `despues`, como cambios de «qué rehace un
 * cambio» (puro). Se montan ya con su forma, sin parse que lance: cada uno se valida después como
 * CambioImpacto (apartadosAfectadosDe) y un fallo vuelve como Result, no como un 500.
 */
export function cambiosEntre(antes: EquipoYLotes, despues: EquipoYLotes): CambioImpacto[] {
  const ids = [...new Set([...antes.equipo, ...despues.equipo].map((m) => m.persona_id))];
  const equipo = ids
    .filter((id) => rolesDe(antes, id) !== rolesDe(despues, id))
    .map((id) => ({ persona_id: id, sale: !despues.equipo.some((m) => m.persona_id === id) }));
  const cambios: CambioImpacto[] = equipo.length ? [{ decisiones: { equipo } }] : [];
  return mismosLotes(antes.lotes, despues.lotes) ? cambios : [...cambios, { lotes: [...new Set(despues.lotes)] }];
}

export type VistaPreviaAfectados = Afectados & { cambios: CambioImpacto[] };

/**
 * Qué apartados de la versión `version` rehace lo que cambió en el equipo y los lotes desde que se
 * pidió, con su coste y las indicaciones; sin escribir. `cambios` es lo que luego se manda a
 * «actualizar-afectados». La presentada y las de ensayo no se rehacen por cambios tardíos.
 */
export function vistaPreviaAfectados(
  dbNucleo: DbNucleo,
  dbLic: Db,
  p: { id: string; version: number },
): Result<VistaPreviaAfectados> {
  const base = memoriaPorVersion(dbLic, p.id, p.version);
  if (!base) return fail('not_found', `No hay memoria v${p.version} de esta licitación.`);
  if (base.presentada)
    return fail(
      'conflicto',
      `La memoria v${p.version} es la presentada: lo entregado no se rehace por cambios tardíos.`,
    );
  if (base.ensayo)
    return fail(
      'conflicto',
      `La memoria v${p.version} es de ensayo: no se rehace; los cambios van sobre la memoria de la oferta.`,
    );
  if (base.subida) return fail('conflicto', SUBIDA(p.version));
  const ad = antesYDespues(dbLic, base);
  const cambios = cambiosEntre(ad.antes, ad.despues);
  if (!cambios.length) return ok({ cambios, afectadas: [], apartados: [], indicaciones: '' });
  const a = afectadosDeCambios(dbNucleo, dbLic, { ...p, cambios });
  return a.error ? a : ok({ ...a.data, cambios });
}

// ── Mantener el anterior y diff ──

export type ApartadoDeVersion = { id: string; version: number; n: number };
type Par = { nueva: FilaMemoria; base: FilaMemoria };

function parDeVersiones(db: Db, p: ApartadoDeVersion): Result<Par> {
  const nueva = memoriaPorVersion(db, p.id, p.version);
  if (!nueva) return fail('not_found', `No hay memoria v${p.version} de esta licitación.`);
  if (nueva.version_base === null)
    return fail('conflicto', `La v${p.version} no sale de otra versión: no hay apartado anterior.`);
  const base = memoriaPorVersion(db, p.id, nueva.version_base);
  return base
    ? ok({ nueva, base })
    : fail('not_found', `Ya no está la v${nueva.version_base}, de la que sale la v${p.version}.`);
}

function comprobarMantener(db: Db, p: ApartadoDeVersion): Result<Par & { fila: FilaApartado }> {
  const par = parDeVersiones(db, p);
  if (par.error) return par;
  const { nueva, base } = par.data;
  const borrador =
    nueva.borrador_id === null
      ? undefined
      : (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(nueva.borrador_id) as
          { estado: string } | undefined);
  if (borrador?.estado === 'aceptada')
    return fail('conflicto', `La v${p.version} ya se dio por buena: para volver atrás, pide otra versión.`);
  if (nueva.estado !== 'ensamblada')
    return fail('conflicto', `La v${p.version} aún no está montada: espera a que termine.`);
  if (!rehechosDe(nueva).includes(p.n))
    return fail(
      'invalid_input',
      `El apartado ${p.n} no se rehízo en la v${p.version}: ya es el de la v${base.version}.`,
    );
  const fila = apartadosDe(db, base.id).find((f) => f.apartado === p.n && f.estado === 'recibido');
  if (!fila)
    return fail('conflicto', `La v${base.version} no tiene texto en el apartado ${p.n}: no hay nada que mantener.`);
  return ok({ ...par.data, fila });
}

function copiarDeLaBase(dbLic: Db, c: Par & { fila: FilaApartado }, n: number): Result<null> {
  const { nueva, base, fila } = c;
  try {
    dbLic.transaction(() => {
      dbLic.prepare('DELETE FROM memoria_apartados WHERE memoria_id = ? AND apartado = ?').run(nueva.id, n);
      copiarApartado(dbLic, fila, nueva.id, base.version, new Date().toISOString());
      dbLic
        .prepare('UPDATE memorias SET apartados_rehechos = ? WHERE id = ?')
        .run(JSON.stringify(rehechosDe(nueva).filter((x) => x !== n)), nueva.id);
    })();
    return ok(null);
  } catch (err) {
    log.error('apartado anterior sin copiar', {
      licitacion: nueva.licitacion_id,
      version: nueva.version,
      apartado: n,
      error: errorMessage(err),
    });
    return fail('io_error', `No se pudo volver al apartado ${n} de la v${base.version}: inténtalo otra vez.`);
  }
}

/**
 * «Mantener el anterior»: vuelve a poner en la versión nueva (aún sin dar por buena) el apartado
 * `n` de su base, con sus dependencias y si lo editó una persona, y la monta sin IA. Primero se
 * reserva el montaje: si otra versión del lote se está montando, no se toca el texto. Si el
 * montaje falla, el texto ya está copiado y basta con volver a montarla. 0 runs: la evaluación
 * de la versión puntuaba el apartado rehecho, así que se da por desfasada (se evalúa otra vez a mano).
 */
export async function mantenerAnterior(
  dbLic: Db,
  p: ApartadoDeVersion,
  raices: Raices = raicesActuales(),
): Promise<Result<Ensamblada>> {
  const c = comprobarMantener(dbLic, p);
  if (c.error) return c;
  const reservada = reservarRemontado(dbLic, p.id, p.version);
  if (reservada.error) return reservada;
  const copia = copiarDeLaBase(dbLic, c.data, p.n);
  if (copia.error) {
    soltarRemontado(dbLic, reservada.data);
    return copia;
  }
  log.info('apartado anterior mantenido', {
    licitacion: p.id,
    version: p.version,
    apartado: p.n,
    version_base: c.data.base.version,
  });
  const r = await montarReservada(dbLic, reservada.data, raices);
  if (!r.error && descartarEvaluacionDeVersion(dbLic, p.id, p.version))
    log.info('evaluación desfasada al mantener el apartado anterior', {
      licitacion: p.id,
      version: p.version,
      apartado: p.n,
    });
  return r;
}

const textoPlano = (d: ApartadoDatosData | null): string => (d ? d.bloques.map(textoDeBloque).join('\n\n') : '');

/** El texto plano del apartado `n` en la base y en la versión nueva, para el diff palabra a palabra de la web. */
export function diffApartado(dbLic: Db, p: ApartadoDeVersion): Result<{ antes: string; despues: string }> {
  const par = parDeVersiones(dbLic, p);
  if (par.error) return par;
  const de = (m: FilaMemoria) => textoPlano(datosDe(apartadosDe(dbLic, m.id).find((f) => f.apartado === p.n)));
  return ok({ antes: de(par.data.base), despues: de(par.data.nueva) });
}

// ── Rutas ──

const Version = z.coerce.number().int().positive();
const Numero = z.coerce.number().int().min(1).max(20);
const Params = z.object({ version: Version, n: Numero });

export function rutasApartadosAfectados(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/memoria/:version/afectados',
    conId((id, req, res) => {
      const v = Version.safeParse(req.params['version']);
      if (!v.success) return invalido(res, v.error);
      responder(res, vistaPreviaAfectados(nucleo().db, dbLicitaciones(), { id, version: v.data }));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/memoria/:version/apartados/:n/mantener',
    conId((id, req, res) => {
      const q = Params.safeParse(req.params);
      if (!q.success) return invalido(res, q.error);
      mantenerAnterior(dbLicitaciones(), { id, ...q.data }).then(
        (x) => responder(res, x),
        fallo(res, 'apartado anterior sin mantener', 'licitaciones'),
      );
    }),
  );
  r.get(
    '/licitaciones/:id/oferta/memoria/:version/apartados/:n/diff',
    conId((id, req, res) => {
      const q = Params.safeParse(req.params);
      if (!q.success) return invalido(res, q.error);
      responder(res, diffApartado(dbLicitaciones(), { id, ...q.data }));
    }),
  );
}
