// La respuesta de licitaciones_oferta: el agente ve lo mismo que la persona, sacado de las comprobaciones.
import { z } from 'zod';
import { listarPersonas } from '../../../nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { zonaEmpresa } from '../../../nucleo/empresa.js';
import { isoConZonaEspana, type ZonaHoraria } from '../../../nucleo/fechas.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { historialDescartes, type CategoriaDescarte } from '../oportunidades.js';
import type { Db } from '../store.js';
import { comprobacionesDeEntradas, type BloqueoConCoste } from './comprobaciones.js';
import {
  leerEntradasComprobaciones,
  memoriasDeTrabajo,
  memoriasEvaluadas,
  type EntradasComprobaciones,
} from './comprobacionesEntradas.js';
import type { CosteBloqueo, ResumenCompromisos } from './comprobacionesReglasCostes.js';
import { precioDecidido, preciosDecididos } from './comprobacionesReglasDecisiones.js';
import { desfasesDe } from './comprobacionesReglasDesfases.js';
import type { Bloqueo, Comprobaciones } from './comprobacionesTipos.js';
import { decisionesDe, equipoParaRedactar, type DecisionesData, type DecisionesGuardadas } from './decisiones.js';
import { evaluacionPorId, type Evaluacion } from '../propuestas/evaluacion.js';
import { sinImportes } from './compromisosSolucion.js';
import { criticasDe } from './critica.js';
import { progresoSinNombres } from './progresoMemoria.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { contextoDeApartado, memoriaDeLaOferta, memoriasDe, memoriasPorLote, type EstadoMemoria } from './memoria.js';
import { lotesDeLaMemoria } from './memoriaPresentada.js';
import { textoPlazo } from './plazo.js';
import { propuestaDecisionesDe } from './propuestaDecisiones.js';

// Lo accionable va primero: un recorte por el final se lleva lo que menos falta. Va por secciones, para no
// repetir el guion entero en cada llamada. Ningún importe ofertado: la memoria no puede llevarlos y así no hay
// tentación; sí si cada lote tiene precio fijado.
const SECCIONES_OFERTA = [
  'estado',
  'bloqueos',
  'guion',
  'decisiones',
  'propuesta',
  'memoria',
  'memoria_historial',
  'apartado',
] as const;
type SeccionOferta = (typeof SECCIONES_OFERTA)[number];

export const ConsultaOferta = z.object({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  apartado: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Número del apartado de la memoria: su rúbrica y su cuota'),
  lote: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Si el pliego pide una memoria por lote (memorias_por_lote no es null): el lote cuya memoria trae la sección «memoria»',
    ),
  secciones: z
    .array(z.enum(SECCIONES_OFERTA))
    .min(1)
    .max(8)
    .optional()
    .describe(
      'Qué partes devolver. Sin ella, todas salvo memoria_historial; con «apartado», estado, bloqueos y apartado',
    ),
});
export type ConsultaOfertaData = z.infer<typeof ConsultaOferta>;

const POR_DEFECTO: readonly SeccionOferta[] = ['estado', 'bloqueos', 'guion', 'decisiones', 'propuesta', 'memoria'];
const CON_APARTADO: readonly SeccionOferta[] = ['estado', 'bloqueos', 'apartado'];

/** Las secciones que se devuelven: las pedidas o, si no, las de por defecto. */
function seccionesDe(a: Pick<ConsultaOfertaData, 'apartado' | 'secciones'>): Set<SeccionOferta> {
  if (a.secciones) return new Set(a.secciones);
  return new Set(a.apartado !== undefined ? CON_APARTADO : POR_DEFECTO);
}

export type EstadoOferta = {
  descartada: { motivo: string | null; categoria: CategoriaDescarte | null } | null;
  retirada: { motivo: string } | null;
  veredicto: Comprobaciones['veredicto'];
  vence_en: string | null;
  vence_texto: string | null;
  hora_interna_cierre: string | null;
  siguiente: { clave: string; titulo: string; accion: Bloqueo['accion'] } | null;
  precio_fijado: Record<string, boolean>;
  memoria_aprobada: boolean;
  paquete_vigente: { version: number; desfasado: boolean } | null;
  propuesta_obsoleta: boolean;
  decisiones_obsoletas: boolean;
  memoria_obsoleta: boolean;
  desfases: { pieza: string; por: string; accion: string }[];
};

type Vista = { e: EntradasComprobaciones; comprobaciones: Comprobaciones };

// Lo mismo que comprobacionesDe, pero quedándose con las entradas: el bloque estado sale de la misma lectura.
function vistaComprobaciones(db: Db, dbNucleo: DbNucleo, id: string, ahoraMs: number): Result<Vista> {
  const e = leerEntradasComprobaciones(db, dbNucleo, id, ahoraMs);
  if (e.error) return e;
  return ok({ e: e.data, comprobaciones: comprobacionesDeEntradas(db, e.data) });
}

// Con el mismo criterio que el veredicto: lo cerrado o aceptado no es lo siguiente.
const pendiente = (b: Bloqueo): boolean =>
  (b.estado === 'abierto' || b.estado === 'propuesta') && (b.gravedad === 'impide' || b.gravedad === 'riesgo');

/** El primer bloqueo abierto de las comprobaciones, en su orden: lo siguiente que hay que hacer. */
export function primerBloqueoAbierto(bloqueos: readonly Bloqueo[]): Bloqueo | null {
  return bloqueos.find(pendiente) ?? null;
}

// Por lote del ámbito (o «contrato» si no va por lotes): fijado o no, nunca cuánto. Con el mismo
// predicado que la fila de precio de las comprobaciones: «pendiente» desmarcado sin importe no está fijado.
function preciosFijados(e: EntradasComprobaciones): Record<string, boolean> {
  if (!e.ambito.length) return { contrato: precioDecidido(e, null) };
  return Object.fromEntries(e.ambito.map((lote) => [lote, precioDecidido(e, lote)]));
}

function descarteDe(db: Db, e: EntradasComprobaciones): EstadoOferta['descartada'] {
  if (e.oportunidad?.estado !== 'descartada') return null;
  const ultimo = historialDescartes(db, e.id)
    .filter((h) => h.accion === 'descartada')
    .at(-1);
  return { motivo: e.oportunidad.motivo_descarte, categoria: ultimo?.categoria ?? null };
}

const deOtroGuion = (pieza: { guion_id: number } | null, g: GuionGuardado | null): boolean =>
  pieza !== null && g !== null && pieza.guion_id !== g.id;

function memoriaAprobada(m: EstadoMemoria | null): boolean {
  return m !== null && m.estado === 'ensamblada' && !m.guion_cambiado && m.borrador?.estado === 'aceptada';
}

// Con memoria por lote, las de todos los lotes, como las comprobaciones (memoriasEvaluadas). La presentada
// no se rehace aunque el guion cambie después: no es obsoleta.
const memoriasAprobadas = (e: EntradasComprobaciones): boolean =>
  memoriasEvaluadas(e).every((x) => memoriaAprobada(x.memoria));
const memoriaObsoleta = (e: EntradasComprobaciones): boolean =>
  memoriasDeTrabajo(e).some((x) => x.memoria !== null && !x.memoria.presentada && deOtroGuion(x.memoria, e.guion));

function plazoDe(fecha: string | null, zona: ZonaHoraria): Pick<EstadoOferta, 'vence_en' | 'vence_texto'> {
  return { vence_en: fecha ? isoConZonaEspana(fecha) : null, vence_texto: fecha ? textoPlazo(fecha, zona) : null };
}

/**
 * El bloque estado: lo que el agente lee antes de trabajar. Descartada o retirada (el mismo
 * criterio que veredictoDe) no hay nada que preparar: siguiente es null y en las comprobaciones solo queda
 * «Recuperar».
 */
function estadoDe(db: Db, { e, comprobaciones }: Vista): EstadoOferta {
  const retirada = e.licitacion.borrada_en !== null;
  const siguiente =
    comprobaciones.veredicto.tipo === 'descartada' ? null : primerBloqueoAbierto(comprobaciones.bloqueos);
  return {
    descartada: descarteDe(db, e),
    retirada: retirada ? { motivo: e.licitacion.borrada_motivo ?? 'retirada de la plataforma' } : null,
    veredicto: comprobaciones.veredicto,
    ...plazoDe(e.licitacion.fecha_limite, zonaEmpresa(db)),
    hora_interna_cierre: comprobaciones.hora_interna_cierre || null,
    siguiente: siguiente ? { clave: siguiente.clave, titulo: siguiente.titulo, accion: siguiente.accion } : null,
    precio_fijado: preciosFijados(e),
    memoria_aprobada: memoriasAprobadas(e),
    paquete_vigente: e.paquete ? { version: e.paquete.version, desfasado: e.paquete.desfasado } : null,
    propuesta_obsoleta: deOtroGuion(e.propuesta, e.guion),
    decisiones_obsoletas: deOtroGuion(e.decisiones, e.guion),
    memoria_obsoleta: memoriaObsoleta(e),
    desfases: desfasesDe(e).map(({ pieza, por, accion }) => ({ pieza, por, accion })),
  };
}

export type Tapar = (texto: string) => string;

/**
 * Sin permiso de colaboradores, cada nombre de Colaboradores pasa a «la persona <id>», como en el
 * impacto. De los más largos a los más cortos, para que un nombre no parta otro que lo contiene.
 */
export function taparPersonas(dbNucleo: DbNucleo): Tapar {
  const personas = listarPersonas(dbNucleo, { inactivos: true })
    .filter((p) => p.nombre.trim())
    .sort((a, b) => b.nombre.length - a.nombre.length);
  return (t) => personas.reduce((s, p) => s.split(p.nombre).join(`la persona ${p.id}`), t);
}

// Las citas de las fugas y de los hechos de la memoria son texto de la memoria: pueden nombrar a
// cualquiera, también a quien no está en Colaboradores (y por su nombre corto, que taparPersonas
// no reconoce). Sin permiso no salen. Las de los compromisos caros también son de la memoria.
const CITA_DE_MEMORIA = /^(?:fuga|hecho|compromiso_caro|compromisos_caros):/;
const ES_DE_COSTE = /^(?:compromiso_caro|compromisos_caros):/;
// Las citas de la memoria dentro de la instrucción de suavizar («sustituye «…» por: …»).
const CITA_EN_INSTRUCCION = /«[^»]*»/g;
const CITA_TAPADA = '«la frase de la memoria»';

// El supuesto del material lleva el precio por persona sin «€» («× (18 + 7) por alumna: material y
// envío»): sigue siendo un importe, y un agente no puede ver ninguno (una cifra que
// lee el agente puede acabar en la memoria). Se queda en unidades.
const PRECIO_POR_PERSONA = /\s*×\s*\(\s*\d[\d.,]*\s*\+\s*\d[\d.,]*\s*\)\s*por\s+([^\s:]+):\s*material y envío/g;

/** El supuesto de un coste sin importes: lo que lee un agente (MCP, bloqueos de las comprobaciones). */
export const supuestoParaAgente = (supuesto: string): string =>
  sinImportes(supuesto.replace(PRECIO_POR_PERSONA, ' × 1 envío de material por $1'));

// Del resumen de los añadidos, el agente ve cuántos y sus horas: con el % y el presupuesto base
// (público) podría sacar los euros.
type CosteParaAgente = Omit<CosteBloqueo, 'euros' | 'resumen' | 'pct_presupuesto'> & {
  resumen: Omit<ResumenCompromisos, 'euros' | 'presupuesto_pct'>;
};

/**
 * El coste de una fila de las comprobaciones para un agente: sin euros ni % del presupuesto, sin importes en
 * el supuesto, la instrucción ni las citas y, sin permiso de colaboradores, sin las citas de la memoria.
 */
function costeParaAgente(
  { euros: _euros, resumen, pct_presupuesto: _pct, ...c }: CosteBloqueo,
  tapar: Tapar | null,
): CosteParaAgente {
  const instruccion = sinImportes(
    tapar ? tapar(c.instruccion.replace(CITA_EN_INSTRUCCION, CITA_TAPADA)) : c.instruccion,
  );
  return {
    ...c,
    supuesto: tapar ? tapar(supuestoParaAgente(c.supuesto)) : supuestoParaAgente(c.supuesto),
    instruccion,
    apariciones: c.apariciones.map((a) => ({ ...a, cita: tapar ? '' : sinImportes(a.cita) })),
    resumen: { anadidos: resumen.anadidos, caros: resumen.caros, horas: resumen.horas },
  };
}

export type BloqueoParaAgente = Omit<Bloqueo, 'huella' | 'minutos'> & { coste?: CosteParaAgente };

// La huella y los minutos son de la web (acciones y estimación); al agente no le dicen nada. Los
// euros del coste, tampoco: van solo a la web, como decisiones.coste_estimado.
function bloqueoParaAgente(
  { huella: _h, minutos: _m, coste, ...b }: BloqueoConCoste,
  tapar: Tapar | null,
): BloqueoParaAgente {
  if (!coste) return b;
  const cita = b.cita && ES_DE_COSTE.test(b.clave) ? { ...b.cita, texto: sinImportes(b.cita.texto) } : b.cita;
  return { ...b, cita, coste: costeParaAgente(coste, tapar) };
}

/** Los bloqueos para el agente: sin huella, minutos ni euros y, sin permiso de colaboradores, sin nombres. */
export function bloqueosParaAgente(bloqueos: readonly BloqueoConCoste[], tapar: Tapar | null): BloqueoParaAgente[] {
  return bloqueos.map((b) => {
    const x = bloqueoParaAgente(b, tapar);
    if (!tapar) return x;
    const cita = x.cita && !CITA_DE_MEMORIA.test(x.clave) ? { ...x.cita, texto: tapar(x.cita.texto) } : null;
    return { ...x, titulo: tapar(x.titulo), cita };
  });
}

type ResumenConComprobaciones = {
  veredicto: Comprobaciones['veredicto'] | null;
  primer_bloqueo: { clave: string; titulo: string } | null;
};

/** El veredicto y el primer bloqueo de una fila de la lista, sin nombres si hace falta taparlos. */
export function resumenSinNombres<T extends ResumenConComprobaciones>(r: T, tapar: Tapar | null): T {
  if (!tapar) return r;
  return {
    ...r,
    veredicto: r.veredicto ? { ...r.veredicto, texto: tapar(r.veredicto.texto) } : null,
    primer_bloqueo: r.primer_bloqueo ? { ...r.primer_bloqueo, titulo: tapar(r.primer_bloqueo.titulo) } : null,
  };
}

function estadoParaAgente(c: Contexto): EstadoOferta {
  const estado = estadoDe(c.db, c.vista!);
  if (c.verPersonas) return estado;
  const tapar = c.tapar();
  return {
    ...estado,
    veredicto: { ...estado.veredicto, texto: tapar(estado.veredicto.texto) },
    siguiente: estado.siguiente ? { ...estado.siguiente, titulo: tapar(estado.siguiente.titulo) } : null,
  };
}

// Cada persona una vez (con su CV, solo con permiso de colaboradores) y los roles que cubre por id:
// la misma persona en tres roles no repite su perfil tres veces.
function equipoParaAgente(dbNucleo: DbNucleo, datos: DecisionesData, verPersonas: boolean): Record<string, unknown> {
  const roles = datos.equipo.map((m) => ({
    rol: m.rol_en_la_oferta,
    persona_id: m.persona_id,
    lotes: m.lotes,
    ...(m.dedicacion ? { dedicacion: m.dedicacion } : {}),
  }));
  if (!verPersonas) return { roles };
  const perfiles = equipoParaRedactar(dbNucleo, datos).map(({ rol_en_la_oferta: _r, dedicacion: _d, ...p }) => p);
  return { personas: [...new Map(perfiles.map((p) => [p.persona_id, p])).values()], roles };
}

function decisionesParaAgente(
  dbNucleo: DbNucleo,
  d: DecisionesGuardadas | null,
  verPersonas: boolean,
): Record<string, unknown> | null {
  if (!d) return null;
  const { ofertas: _ofertas, equipo: _equipo, ...resto } = d.datos;
  const precio_fijado = preciosDecididos({ decisiones: d, ambito: d.datos.lotes });
  return {
    guion_id: d.guion_id,
    actualizada_en: d.actualizada_en,
    ...resto,
    ...equipoParaAgente(dbNucleo, d.datos, verPersonas),
    precio_fijado,
  };
}

// La propuesta de Hermes, sin el porqué de cada persona si el agente no puede leer colaboradores.
function propuestaParaAgente(db: Db, id: string, verPersonas: boolean): Record<string, unknown> | null {
  const p = propuestaDecisionesDe(db, id);
  if (!p) return null;
  const equipo = verPersonas ? p.datos.equipo : p.datos.equipo.map(({ motivo: _motivo, ...resto }) => resto);
  return { guion_id: p.guion_id, creada_en: p.creada_en, avisos: p.avisos, ...p.datos, equipo };
}

// Las citas de las fugas y el motivo de anularlas pueden nombrar a personas del equipo.
function fugasParaAgente(
  fugas: EstadoMemoria['fugas'],
  verPersonas: boolean,
): EstadoMemoria['fugas'] | Record<string, unknown> {
  if (verPersonas) return fugas;
  return {
    hallazgos: fugas.hallazgos.map(({ cita: _cita, ...f }) => f),
    anulada: fugas.anulada ? { en: fugas.anulada.en } : null,
  };
}

type MejoraApartado = { apartado: number; que_cambiar: string; por_que: string };

// Sin permiso de colaboradores (tapar no es null), cada nombre de Colaboradores pasa a «la persona
// <id>»: los textos de la crítica y de la evaluación citan la memoria y pueden nombrar al equipo.
const tapado = (tapar: Tapar | null, t: string): string => (tapar ? tapar(t) : t);

// La última crítica por apartado: lo que arreglar (arreglo) y por qué baja (motivo, con su cita
// solo si la persona puede leer nombres: la cita es texto de la memoria y puede nombrarlos).
function mejorasDeCritica(db: Db, m: EstadoMemoria, tapar: Tapar | null): MejoraApartado[] {
  const ultima = criticasDe(db, m.id).at(-1);
  if (!ultima) return [];
  return ultima.datos.apartados
    .filter((a) => m.mejorable.includes(a.apartado) && a.motivos_para_bajar.length)
    .map((a) => ({
      apartado: a.apartado,
      que_cambiar: tapado(tapar, a.motivos_para_bajar.map((x) => x.arreglo).join(' ')),
      por_que: tapado(
        tapar,
        a.motivos_para_bajar.map((x) => (tapar ? x.motivo : `${x.motivo} (cita: «${x.cita}»)`)).join(' '),
      ),
    }));
}

// Sin crítica (una versión subida a mano): las sugerencias de la evaluación que citan el apartado y, si no, su justificación.
function mejorasDeEvaluacion(ev: Evaluacion, m: EstadoMemoria, tapar: Tapar | null): MejoraApartado[] {
  const sugerencias = [...ev.datos.modificar, ...ev.datos.reforzar];
  return m.mejorable.flatMap((n) => {
    const criterio = ev.datos.criterios.find((c) => c.apartado === n);
    const titulo = m.apartados.find((a) => a.apartado === n)?.titulo.toLowerCase() ?? '';
    const propias = sugerencias.filter(
      (x) =>
        new RegExp(`apartado ${n}(?!\\d)`, 'i').test(x.referencia) ||
        (titulo !== '' && x.referencia.toLowerCase().includes(titulo)),
    );
    if (!criterio) return [];
    const subir = `Subir de ${criterio.tramo ?? criterio.puntuacion} a más puntos del apartado (máximo ${criterio.peso}).`;
    const que = propias.length ? propias.map((x) => x.que).join(' ') : subir;
    return [{ apartado: n, que_cambiar: tapado(tapar, que), por_que: tapado(tapar, criterio.justificacion) }];
  });
}

function mejorasDe(db: Db, m: EstadoMemoria, tapar: Tapar | null): MejoraApartado[] {
  if (!m.evaluacion || !m.mejorable.length) return [];
  const deCritica = mejorasDeCritica(db, m, tapar);
  if (deCritica.length) return deCritica;
  const ev = evaluacionPorId(db, m.evaluacion.id);
  return ev ? mejorasDeEvaluacion(ev, m, tapar) : [];
}

// Los compromisos también pueden nombrar a personas. mejorable pasa de números de apartado a lo que
// cambiar y por qué, dentro de la evaluación. tapar null: el agente puede leer colaboradores.
function memoriaParaAgente(db: Db, memoria: EstadoMemoria | null, tapar: Tapar | null): Record<string, unknown> | null {
  if (!memoria) return null;
  const { mejorable: _mejorable, ...resto } = memoria;
  const evaluacion = memoria.evaluacion ? { ...memoria.evaluacion, mejorable: mejorasDe(db, memoria, tapar) } : null;
  if (!tapar) return { ...resto, evaluacion };
  return {
    ...resto,
    evaluacion,
    apartados: memoria.apartados.map((x) => ({ ...x, compromisos: [] })),
    fugas: fugasParaAgente(memoria.fugas, false),
    progreso: memoria.progreso ? progresoSinNombres(memoria.progreso) : null,
  };
}

// Una versión: qué pasó con ella (revisión, origen), cuántas fugas y si se anularon, y su evaluación
// entera (el resumen que escribió el evaluador, sin recortar y, sin permiso, sin nombres) con lo que mejorar.
function versionDeHistorial(db: Db, m: EstadoMemoria, tapar: Tapar | null): Record<string, unknown> {
  const ev = m.evaluacion ? evaluacionPorId(db, m.evaluacion.id) : null;
  const revision =
    m.borrador?.estado === 'aceptada' || m.borrador?.estado === 'descartada' ? m.borrador.estado : 'pendiente';
  return {
    id: m.id,
    version: m.version,
    ensayo: m.ensayo,
    estado: m.estado,
    guion_id: m.guion_id,
    pedida_en: m.pedida_en,
    ensamblada_en: m.ensamblada_en,
    revision,
    origen: m.origen,
    fugas: m.fugas.hallazgos.length,
    anulada: m.fugas.anulada ? { en: m.fugas.anulada.en } : null,
    hallazgos_fugas: m.fugas.hallazgos.map(({ cita, ...f }) => (tapar ? f : { ...f, cita })),
    evaluacion_id: m.evaluacion?.id ?? null,
    evaluacion:
      m.evaluacion && ev
        ? { ...m.evaluacion, resumen: tapado(tapar, ev.datos.resumen), mejorable: mejorasDe(db, m, tapar) }
        : m.evaluacion,
  };
}

// De la más reciente a la más antigua.
function historialMemorias(db: Db, memorias: readonly EstadoMemoria[], tapar: Tapar | null): Record<string, unknown>[] {
  return memorias.map((m) => versionDeHistorial(db, m, tapar));
}

// Los automáticos que el apartado no puede mencionar, como posiciones en guion.automaticos (que
// ya trae cada uno entero): contextoDeFugas los filtra sin reordenarlos.
function indicesVigilados(
  todos: readonly { criterio: string; archivo: string }[],
  vigilados: readonly { criterio: string; archivo: string }[],
): number[] {
  const indices: number[] = [];
  todos.forEach((a, i) => {
    const v = vigilados[indices.length];
    if (v && v.criterio === a.criterio && v.archivo === a.archivo) indices.push(i);
  });
  return indices;
}

function apartadoDe(
  g: GuionGuardado | null,
  a: ConsultaOfertaData,
  secciones: Set<SeccionOferta>,
): Result<Record<string, unknown> | null> {
  if (a.apartado === undefined)
    return secciones.has('apartado')
      ? fail('invalid_input', 'La sección «apartado» necesita el número de «apartado».')
      : ok(null);
  if (g && g.datos.memoria === null)
    return fail('invalid_input', 'Esta oferta no lleva memoria técnica (el pliego no la pide).');
  const contexto = g ? contextoDeApartado(g, a.apartado) : null;
  if (!g || !contexto) return fail('invalid_input', `El guion vigente no tiene apartado ${a.apartado} en la memoria.`);
  return ok({
    numero: a.apartado,
    ...contexto.apartado,
    cuota: contexto.cuota,
    automaticos_vigilados: indicesVigilados(g.datos.automaticos, contexto.automaticos),
  });
}

type Contexto = {
  db: Db;
  dbNucleo: DbNucleo;
  id: string;
  verPersonas: boolean;
  g: GuionGuardado | null;
  lotes: string[] | null;
  lote: string | undefined;
  vista: Vista | null;
  apartado: Record<string, unknown> | null;
  memorias: () => EstadoMemoria[];
  tapar: () => Tapar;
};

const AVISO_MEMORIA_POR_LOTE =
  'El pliego pide una memoria por lote: pide la sección «memoria» con «lote» (uno de memorias_por_lote) para sus apartados, su evaluación y lo que mejorar.';

// Con memoria por lote, la del lote pedido. Sin lote, la común solo si ningún lote tiene aún la
// suya (la que se hizo antes de pedirlas por lote); si alguno la tiene, no se elige una por él.
function memoriaDeLaConsulta(c: Contexto): { memoria: EstadoMemoria | null; aviso?: string } {
  const memorias = c.memorias();
  if (!c.lotes) return { memoria: memoriaDeLaOferta(memorias) };
  if (c.lote !== undefined) return { memoria: memoriaDeLaOferta(memorias, c.lote) };
  const propias = c.lotes.some((l) => memorias.some((m) => !m.ensayo && m.lote === l));
  return propias ? { memoria: null, aviso: AVISO_MEMORIA_POR_LOTE } : { memoria: memoriaDeLaOferta(memorias) };
}

const taparSiHace = (c: Contexto): Tapar | null => (c.verPersonas ? null : c.tapar());

function seccionMemoria(c: Contexto): Record<string, unknown> {
  const { memoria, aviso } = memoriaDeLaConsulta(c);
  return {
    memoria: memoriaParaAgente(c.db, memoria, taparSiHace(c)),
    ...(aviso ? { aviso_memoria: aviso } : {}),
    memorias_por_lote: memoriasPorLote(c.lotes, c.memorias()),
    memoria_ensayo: memoriaParaAgente(c.db, c.memorias().find((m) => m.ensayo) ?? null, taparSiHace(c)),
  };
}

function loteDeLaConsulta(lotes: string[] | null, lote: string | undefined): Result<null> {
  if (lote === undefined) return ok(null);
  if (!lotes)
    return fail('invalid_input', 'Esta oferta lleva una sola memoria común: pide la sección «memoria» sin «lote».');
  return lotes.includes(lote)
    ? ok(null)
    : fail(
        'invalid_input',
        `El lote «${lote}» no lleva memoria propia en esta oferta: las memorias son de los lotes ${lotes.join(', ')}.`,
      );
}

// En el orden de la respuesta: lo accionable primero. Lo que no casa ya viene como bloqueos.
const PIEZAS: readonly [SeccionOferta, (c: Contexto) => Record<string, unknown>][] = [
  ['estado', (c) => ({ estado: estadoParaAgente(c) })],
  [
    'bloqueos',
    (c) => ({ bloqueos: bloqueosParaAgente(c.vista!.comprobaciones.bloqueos, c.verPersonas ? null : c.tapar()) }),
  ],
  [
    'guion',
    (c) => ({ guion: c.g ? { id: c.g.id, version: c.g.version, avisos: c.g.avisos, datos: c.g.datos } : null }),
  ],
  [
    'decisiones',
    (c) => ({
      decisiones: decisionesParaAgente(
        c.dbNucleo,
        c.vista ? c.vista.e.decisiones : decisionesDe(c.db, c.id),
        c.verPersonas,
      ),
    }),
  ],
  ['propuesta', (c) => ({ propuesta_decisiones: propuestaParaAgente(c.db, c.id, c.verPersonas) })],
  // La presentada (subida tal cual, «presentada»: true) manda sobre las versiones de trabajo. Con
  // memoria por lote, cuál es la de cada lote (la presentada de ese lote o su última), como el resumen.
  ['memoria', seccionMemoria],
  ['memoria_historial', (c) => ({ memoria_historial: historialMemorias(c.db, c.memorias(), taparSiHace(c)) })],
  ['apartado', (c) => ({ apartado: c.apartado })],
];

const unaVez = <T>(f: () => T): (() => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};

/** La oferta para el agente, por secciones. not_found si la licitación no existe. */
export function ofertaParaAgente(
  db: Db,
  dbNucleo: DbNucleo,
  a: ConsultaOfertaData,
  verPersonas: boolean,
  ahoraMs: number = Date.now(),
): Result<Record<string, unknown>> {
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(a.id))
    return fail('not_found', `No hay ninguna licitación con id «${a.id}».`);
  const secciones = seccionesDe(a);
  const g = guionVigente(db, a.id);
  const apartado = apartadoDe(g, a, secciones);
  if (apartado.error) return apartado;
  const lotes = lotesDeLaMemoria(db, a.id);
  const lote = loteDeLaConsulta(lotes, a.lote);
  if (lote.error) return lote;
  const vista =
    secciones.has('estado') || secciones.has('bloqueos') ? vistaComprobaciones(db, dbNucleo, a.id, ahoraMs) : null;
  if (vista?.error) return vista;
  const c: Contexto = {
    db,
    dbNucleo,
    id: a.id,
    verPersonas,
    g,
    lotes,
    lote: a.lote,
    vista: vista?.data ?? null,
    apartado: apartado.data,
    memorias: unaVez(() => memoriasDe(db, a.id)),
    tapar: unaVez(() => taparPersonas(dbNucleo)),
  };
  const partes = PIEZAS.filter(([s]) => secciones.has(s)).map(([, pieza]) => pieza(c));
  return ok(Object.assign({ id: a.id }, ...partes) as Record<string, unknown>);
}
