// Decisiones de la oferta: lo que fija una persona antes de redactar (lotes, equipo, criterios, enfoque, precio).
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { emitir } from '../../../nucleo/eventos.js';
import { obtenerPersona } from '../../../nucleo/colaboradores/personas.js';
import { logger } from '../../../nucleo/log.js';
import { PRECIO_SOLO_ADMIN, type Actor } from '../../../nucleo/permisos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { alcanza, type Rol } from '../../../nucleo/usuarios.js';
import { conLotes, idsDelAmbito, lotesDeLicitacion, TODOS_LOS_LOTES, type LotesLicitacion } from '../lotes.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { guionVigente, type GuionBaseData, type GuionGuardado } from './guion.js';
import { automaticoDe, claveCriterio, conCriteriosDelGuion, tramosDe } from './guionLotes.js';
import { sinCitasInternas } from './textoPliego.js';
import { automaticosContradictorios, type AutomaticoContradictorio } from './automaticosHonestos.js';
// Ciclo con propuestaDecisiones.ts (importa de aquí): solo se usa dentro de funciones, nunca al cargar.
import { propuestaDecisionesDe } from './propuestaDecisiones.js';
import { noPrometerDe, revisarEnfoque } from './enfoque.js';
import { normalizarOfertas, problemasDePrecios } from './preciosOferta.js';
// Ciclo con aIncorporarOferta.ts (importa de aquí): solo se usa dentro de funciones, nunca al cargar.
import { sincronizarAIncorporar } from './aIncorporarOferta.js';

// Una fila por licitación, con el guion contra el que se fijaron: si el guion cambia, hay que revisarlas y
// guardarlas otra vez antes de redactar. Los lotes no se eligen aquí: son los de interés (el ámbito, lotes.ts);
// si cambian, las decisiones dejan de valer. Cada guardado sube su versión y deja una fila en
// decisiones_historial; guardar una sola sección (precio, equipo…) es decisionesSecciones.ts.
const log = logger('licitaciones');
const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);

// Quién propuso un cambio y quién lo aplicó: lo guardado antes no lo trae, de ahí el default y el optional.
const Origen = z.strictObject({
  propuesto_por: z.enum(['hermes', 'persona']),
  aplicado_por: Texto(1, 80).nullable().default(null),
  en: z.string().min(10),
});

const PrecioConcepto = z.strictObject({ concepto: Texto(2, 200), precio: z.number().finite().nonnegative() });
const OfertaLote = z
  .strictObject({
    lote: Texto(1, 20).nullable().describe('null = contrato entero'),
    pendiente: z.boolean().default(true),
    importe: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .default(null)
      .describe('Importe total sin impuestos, si se oferta un total'),
    coste_estimado: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .default(null)
      .describe('Coste propio del lote: nunca se envía a un agente'),
    unitarios: z
      .array(PrecioConcepto)
      .max(20)
      .default([])
      .describe('Un precio por cada línea de precios_unitarios del guion'),
  })
  .refine((o) => (o.importe === null && !o.unitarios.length) || !o.pendiente, {
    message: 'Con precio, el lote ya no está pendiente: pon «pendiente» a false.',
    path: ['pendiente'],
  });

// Lo que el anexo necesita y el pliego no dice: null = sin decidir.
const DatosAnexo = z.strictObject({
  subcontratacion_servidores: z.boolean().nullable().default(null),
  orden_lotes: z.array(Texto(1, 20)).max(100).nullable().default(null),
  impuesto: z
    .strictObject({ tipo: z.enum(['IVA', 'IGIC', 'exento']), porcentaje: z.number().min(0).max(30).nullable() })
    .nullable()
    .default(null),
});
const DATOS_ANEXO_VACIOS = { subcontratacion_servidores: null, orden_lotes: null, impuesto: null };

// Un rol que la oferta cubre comprometiendo el perfil sin nombrar a nadie (el pliego deja
// acreditarlo tras la propuesta de adjudicación): la memoria y el anexo lo dicen «a incorporar»
// con los requisitos mínimos, y Equipo › A incorporar lo sigue hasta que haya alguien.
const AIncorporar = z.strictObject({
  rol_en_la_oferta: Texto(2, 120),
  lotes: z.array(Texto(1, 20)).max(100).default([]).describe('Lotes en los que va; vacío = todos'),
  requisitos: Texto(3, 2000).describe('Lo que el pliego pide al perfil, tal cual'),
  acreditar_antes: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null)
    .describe('Fecha estimada en la que habría que acreditarlo'),
  plazo: Texto(2, 300)
    .nullable()
    .default(null)
    .describe('Cómo lo dice el pliego o la ley: «10 días hábiles desde el requerimiento»'),
  cita: z
    .strictObject({ documento: Texto(1, 200), pagina: z.number().int().positive().nullable(), texto: Texto(1, 600) })
    .nullable()
    .default(null),
  origen: Origen.optional(),
});

const AutomaticoDecidido = z.strictObject({
  criterio: Texto(2, 300),
  lote: Texto(1, 20).nullable().default(null).describe('Lote al que se aplica; null si el criterio es común'),
  nos_acogemos: z.boolean(),
  tramo: Texto(2, 500).nullable().default(null).describe('descripcion literal del tramo elegido'),
  evidencia: Texto(3, 600).optional().describe('Dónde consta que podemos cumplirlo'),
  nota: Texto(1, 1000).optional(),
  valor: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .describe('Valor ofertado en el criterio, si se oferta una cifra: años, horas, n.º de certificaciones, alumnas…'),
  origen: Origen.optional(),
  motivo_hermes: Texto(1, 600).optional(),
});

// Decisiones anteriores a los precios por lote: un solo «precio» → una oferta sin lote
// (normalizarOfertas la reparte entre los lotes decididos al leerlas o guardarlas).
function deV1(x: unknown): unknown {
  if (!x || typeof x !== 'object' || !('precio' in x)) return x;
  const { precio, ...resto } = x as { precio?: { importe?: number | null; pendiente?: boolean } } & Record<
    string,
    unknown
  >;
  if ('ofertas' in resto) return resto;
  return {
    ...resto,
    ofertas: precio
      ? [{ lote: null, pendiente: precio.pendiente ?? true, importe: precio.importe ?? null, unitarios: [] }]
      : [],
  };
}

/** Las decisiones sin la lectura de las decisiones antiguas: de aquí sale el esquema de cada sección (decisionesSecciones.ts). */
export const DecisionesObjeto = z.strictObject({
  lotes: z
    .array(Texto(1, 20))
    .max(100)
    .default([])
    .describe(
      'Lotes a los que va la oferta: los de interés (go_no_go.ambito); vacío, se toman de ahí (o es para toda la licitación si no hay lotes)',
    ),
  equipo: z
    .array(
      z.strictObject({
        persona_id: z.number().int().positive(),
        rol_en_la_oferta: Texto(2, 120),
        dedicacion: Texto(1, 120).optional(),
        lotes: z.array(Texto(1, 20)).max(100).default([]).describe('Lotes en los que trabaja; vacío = todos'),
        origen: Origen.optional(),
        motivo_hermes: Texto(1, 600).optional(),
      }),
    )
    .max(30)
    .default([]),
  automaticos: z.array(AutomaticoDecidido).max(200).default([]),
  herramientas: z.array(Texto(1, 120)).max(30).default([]),
  enfoque: z.string().trim().max(8000).default(''),
  ofertas: z.array(OfertaLote).max(100).default([]).describe('El precio de cada lote decidido (o pendiente)'),
  datos_anexo: DatosAnexo.default(DATOS_ANEXO_VACIOS),
  a_incorporar: z
    .array(AIncorporar)
    .max(30)
    .default([])
    .describe('Roles cubiertos con un perfil a incorporar, sin persona'),
});
export const Decisiones = z.preprocess(deV1, DecisionesObjeto);
type DecisionesLeidas = z.infer<typeof Decisiones>;
// Al construir decisiones a mano (propuestas, podas, tests) coste_estimado, datos_anexo y a_incorporar pueden
// faltar: al leerlas de la base el esquema los rellena con null o [], que es lo que significa «sin decidir».
export type DecisionesData = Omit<DecisionesLeidas, 'ofertas' | 'datos_anexo' | 'a_incorporar'> & {
  ofertas: (Omit<DecisionesLeidas['ofertas'][number], 'coste_estimado'> & { coste_estimado?: number | null })[];
  datos_anexo?: DecisionesLeidas['datos_anexo'];
  a_incorporar?: DecisionesLeidas['a_incorporar'];
};
export type PerfilAIncorporarDecidido = DecisionesLeidas['a_incorporar'][number];

// version: sube con cada guardado (PUT entero o PATCH de una sección); su historial, en decisiones_historial.
export type DecisionesGuardadas = { guion_id: number; version: number; actualizada_en: string; datos: DecisionesData };
export type DecisionesRecibidas = DecisionesGuardadas & { avisos: string[] };

const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

// Las órdenes de «no prometer», «evitar»… del enfoque: la memoria las copiaba como matices o las
// cumplía dejando valores abiertos.
const NEGATIVO =
  /\bno (?:prometer|prometas|ofrecer|ofrezcas|mencionar|menciones|comprometer|comprometas|decir|digas)\b|\bevitar\b|\bevita\b|\bsin prometer\b/i;
export const tieneCautelas = (enfoque: string): boolean => NEGATIVO.test(enfoque);
export const CAUTELAS_ENFOQUE = 'Sus cautelas se cumplen sin escribirlas y sin dejar valores abiertos.';

/**
 * Las herramientas para el redactor. Elegir y nombrar servicios y componentes es diseño de la
 * solución (la memoria que aplazaba «servicios pendientes de validación» perdía el tramo); lo que
 * no se inventa son licencias, accesos concedidos, certificaciones y productos propios.
 */
export function textoHerramientas(herramientas: string[]): string {
  const decididas = herramientas.length
    ? `Herramientas decididas: ${herramientas.join(', ')}.`
    : 'Herramientas decididas: ninguna fijada por el equipo.';
  return `${decididas} Además, elige y nombra los servicios y componentes que pide el pliego, con versión o configuración: es diseño de la solución. Lo que no se inventa son licencias, accesos concedidos, certificaciones y productos propios.`;
}
/** Los perfiles a incorporar, para el redactor: sin nombre y con los requisitos mínimos que se comprometen; con lote, los de ese lote. */
export function textoAIncorporar(d: DecisionesData, lote: string | null = null): string | null {
  const perfiles = (d.a_incorporar ?? []).filter((p) => lote === null || !p.lotes.length || p.lotes.includes(lote));
  if (!perfiles.length) return null;
  const lista = perfiles.map((p) => `${p.rol_en_la_oferta} — ${p.requisitos}`).join(' | ');
  return `Perfiles a incorporar (sin persona: no nombres a nadie ni inventes un CV; preséntalo como «<rol> a incorporar» y comprométete a que cumpla estos requisitos mínimos, acreditados cuando el órgano lo requiera): ${lista}.`;
}

const comillas = (xs: string[]) => xs.map((x) => `«${x}»`).join(', ');

type Par = { criterio: string; lote: string | null };
const clavePar = (p: Par) => `${claveCriterio(p.criterio)}|${p.lote ?? ''}`;
const textoPar = (p: Par) => `«${p.criterio}»${p.lote ? ` (lote ${p.lote})` : ''}`;

/** Los pares (criterio, lote) que hay que decidir: uno por criterio común y uno por lote decidido de los que citan su lote. */
export function paresDeAutomaticos(g: GuionBaseData, lotes: string[]): Par[] {
  return g.automaticos.flatMap((a): Par[] => {
    if (!a.lotes?.length) return [{ criterio: a.criterio, lote: null }];
    return a.lotes.filter((l) => lotes.includes(l)).map((l) => ({ criterio: a.criterio, lote: l }));
  });
}

export function problemasDeTramos(d: DecisionesData, g: GuionBaseData): string[] {
  return d.automaticos.flatMap((x) => {
    const a = automaticoDe(g, x.criterio, x.lote ?? null);
    if (!a) return [];
    const tramos = tramosDe(a);
    if (x.tramo !== null && !tramos.some((t) => comparable(t.descripcion) === comparable(x.tramo!))) {
      return [`El tramo «${x.tramo}» no es ninguno de ${textoPar(x)}: ${comillas(tramos.map((t) => t.descripcion))}.`];
    }
    return x.nos_acogemos && x.tramo === null ? [`Elige el tramo de ${textoPar(x)} al que nos acogemos.`] : [];
  });
}

const paresTexto = (ps: Par[]) =>
  ps.length
    ? `va ${ps.map((p) => (p.lote ? `en el lote ${p.lote}` : 'una vez, común a todos los lotes')).join(', ')}`
    : 'no puntúa en ninguno de los lotes a los que vamos';

function sobraUno(a: Par, ctx: { pares: Par[]; lotes: string[]; g: GuionGuardado }): string {
  const delGuion = ctx.g.datos.automaticos.map((x) => x.criterio);
  if (!delGuion.some((c) => claveCriterio(c) === claveCriterio(a.criterio)))
    return `El criterio «${a.criterio}» no está en el guion vigente (v${ctx.g.version}): los que hay son ${delGuion.length ? comillas(delGuion) : 'ninguno'}.`;
  if (a.lote !== null && !ctx.lotes.includes(a.lote))
    return `El criterio «${a.criterio}» está decidido para el lote ${a.lote}, al que no vamos: quítalo.`;
  return `El criterio «${a.criterio}» no se decide ${a.lote ? `para el lote ${a.lote}` : 'sin lote'}: ${paresTexto(ctx.pares.filter((p) => claveCriterio(p.criterio) === claveCriterio(a.criterio)))}.`;
}

// parcial: el asistente de la oferta guarda los criterios de uno en uno; los que faltan siguen
// en las comprobaciones como «decisiones incompletas», pero no impiden guardar el que se decide.
export function problemasDeAutomaticos(d: DecisionesData, g: GuionGuardado, op: { parcial?: boolean } = {}): string[] {
  const pares = paresDeAutomaticos(g.datos, d.lotes);
  const decididos = new Set(d.automaticos.map(clavePar));
  const faltan = op.parcial ? [] : pares.filter((p) => !decididos.has(clavePar(p)));
  const esperados = new Set(pares.map(clavePar));
  const sobran = d.automaticos
    .filter((a) => !esperados.has(clavePar(a)))
    .map((a) => sobraUno(a, { pares, lotes: d.lotes, g }));
  return [
    ...(faltan.length
      ? [
          `Falta decidir ${faltan.length === 1 ? '1 criterio automático' : `${faltan.length} criterios automáticos`}: ${faltan.map(textoPar).join(', ')}.`,
        ]
      : []),
    ...sobran,
    ...problemasDeTramos(d, g.datos),
  ];
}

export function problemasDeEquipo(dbNucleo: DbNucleo, d: DecisionesData): string[] {
  const inactivos = d.equipo
    .filter((m) => {
      const p = obtenerPersona(dbNucleo, m.persona_id);
      return p.error !== null || !p.data.activo;
    })
    .map((m) => `No hay ningún colaborador con id ${m.persona_id} (o está inactivo).`);
  // Las decisiones pueden ser de un lote y una persona seguir asignada a otro.
  const fuera = d.equipo.flatMap((m) =>
    m.lotes
      .filter((l) => !d.lotes.includes(l))
      .map((l) => {
        const p = obtenerPersona(dbNucleo, m.persona_id);
        return `${p.error ? `La persona ${m.persona_id}` : p.data.nombre} está asignada al lote ${l}, al que no vamos: quítale ese lote.`;
      }),
  );
  return [...inactivos, ...fuera];
}

/** Los perfiles a incorporar de lotes a los que no se va. */
export function problemasDeAIncorporar(d: DecisionesData): string[] {
  return (d.a_incorporar ?? []).flatMap((p) =>
    p.lotes
      .filter((l) => !d.lotes.includes(l))
      .map(
        (l) => `El perfil a incorporar «${p.rol_en_la_oferta}» va en el lote ${l}, al que no vamos: quítale ese lote.`,
      ),
  );
}

const paraLotes = (ids: string[]) => (ids.length ? conLotes('para', ids) : 'para el contrato entero');

/**
 * Por qué unos lotes decididos no son los del ámbito (los lotes a los que se va, la fuente
 * única); null si lo son, en cualquier orden. Lo usa también la coherencia de la oferta.
 */
export function lotesFueraDelAmbito(l: LotesLicitacion, decididos: string[]): string | null {
  const ambito = idsDelAmbito(l.ambito);
  const unicos = new Set(decididos);
  if (unicos.size === ambito.length && ambito.every((x) => unicos.has(x))) return null;
  if (!l.lotes.length)
    return 'Esta licitación no tiene lotes: la oferta es para el contrato entero (deja «lotes» vacío).';
  if (!ambito.length && l.presentacion?.codigo === TODOS_LOS_LOTES)
    return 'Hay que presentarse a todos los lotes: la oferta es para el contrato entero (deja «lotes» vacío).';
  if (!ambito.length)
    return `Las decisiones son ${paraLotes(decididos)} y aún no hay lotes a los que vamos: elígelos en el bloque Lotes del Resumen.`;
  return `Las decisiones son ${paraLotes(decididos)} y vamos ${conLotes('a', ambito)} (bloque Lotes del Resumen): guarda otra vez las decisiones o, si son otros, cámbialos antes en el bloque Lotes.`;
}

/** Los lotes de unas decisiones: los que llegan o, si no llega ninguno, los del ámbito (los de interés). */
export function lotesDecididos(dbLic: Db, id: string, lotes: string[]): string[] {
  if (lotes.length) return [...new Set(lotes)];
  const l = lotesDeLicitacion(dbLic, id);
  return l ? idsDelAmbito(l.ambito) : [];
}

export function problemasDeLotes(dbLic: Db, id: string, d: DecisionesData): string[] {
  const l = lotesDeLicitacion(dbLic, id);
  if (!l) return [];
  const lotes = l.lotes.map((x) => x.id);
  const ajenos = lotes.length ? d.lotes.filter((x) => !lotes.includes(x)) : [];
  if (ajenos.length)
    return ajenos.map((x) => `El lote «${x}» no existe en esta licitación (lotes: ${lotes.slice(0, 60).join(', ')}).`);
  const fuera = lotesFueraDelAmbito(l, d.lotes);
  return fuera ? [fuera] : [];
}

/** Lo que no cuadra de unas decisiones con el guion vigente, el equipo y los lotes a los que se va. */
export function problemasDeDecisiones(
  c: { dbLic: Db; dbNucleo: DbNucleo; id: string; guion: GuionGuardado },
  d: DecisionesData,
): string[] {
  const precios = problemasDePrecios(d, c.guion.datos, { presupuestos: presupuestosDeLotes(c.dbLic, c.id) })
    .filter((p) => p.gravedad === 'error')
    .map((p) => p.mensaje);
  return [
    ...problemasDeAutomaticos(d, c.guion),
    ...problemasDeEquipo(c.dbNucleo, d),
    ...problemasDeAIncorporar(d),
    ...problemasDeLotes(c.dbLic, c.id, d),
    ...precios,
  ];
}

/** El presupuesto de cada lote de la licitación (contra él se mide un importe total por lote). */
export function presupuestosDeLotes(dbLic: Db, id: string): Record<string, number | null> {
  return Object.fromEntries((lotesDeLicitacion(dbLic, id)?.lotes ?? []).map((l) => [l.id, l.presupuesto_sin_iva]));
}

/**
 * Las decisiones en su forma de ahora: las ofertas repartidas por lote (normalizarOfertas) y,
 * en un criterio de un solo tramo al que se acoge la empresa, ese tramo.
 */
export function normalizarDecisiones(d: DecisionesData, g: GuionBaseData): DecisionesData {
  const automaticos = conCriteriosDelGuion(d.automaticos, g).map((x) => {
    if (!x.nos_acogemos || x.tramo !== null) return x;
    const a = automaticoDe(g, x.criterio, x.lote ?? null);
    const tramos = a ? tramosDe(a) : [];
    return tramos.length === 1 ? { ...x, tramo: tramos[0]!.descripcion } : x;
  });
  return { ...d, automaticos, ofertas: normalizarOfertas(d.ofertas, d.lotes, g) };
}

const textoContradiccion = (c: AutomaticoContradictorio): string =>
  c.motivo === 'nota_contraria'
    ? `No puedes acogerte a ${textoPar(c)}: tu nota dice que no nos acogemos. Desmárcalo o cambia la nota.`
    : `No puedes acogerte a ${textoPar(c)} sin decir con qué lo acreditas${c.exige ? ` (pide: ${c.exige})` : ''}: rellena «evidencia» o desmárcalo.`;

/**
 * Los automáticos a los que se acoge la empresa y no se puede: una declaración inexacta en el
 * anexo. La propuesta de Hermes solo acredita algo si es del guion vigente.
 */
export function problemasDeContradictorios(dbLic: Db, id: string, guion: GuionGuardado, d: DecisionesData): string[] {
  const p = propuestaDecisionesDe(dbLic, id);
  return automaticosContradictorios(d, guion.datos, p?.guion_id === guion.id ? p : null).map(textoContradiccion);
}

// Cómo se llama cada campo para una persona (nada de «nos_acogemos» ni rutas de JSON).
const NOMBRE_CAMPO: Record<string, string> = {
  lotes: 'Lotes',
  equipo: 'Equipo',
  persona_id: 'persona',
  rol_en_la_oferta: 'rol en la oferta',
  dedicacion: 'dedicación',
  automaticos: 'Criterios automáticos',
  criterio: 'criterio',
  lote: 'lote',
  nos_acogemos: 'si nos acogemos',
  tramo: 'tramo',
  evidencia: 'evidencia',
  nota: 'nota',
  valor: 'valor ofertado',
  herramientas: 'Herramientas',
  enfoque: 'Enfoque',
  ofertas: 'Precio',
  pendiente: 'pendiente',
  importe: 'importe',
  unitarios: 'precios unitarios',
  concepto: 'concepto',
  precio: 'precio',
  version: 'versión',
  quien: 'quién guarda',
  a_incorporar: 'Perfiles a incorporar',
  requisitos: 'requisitos',
  acreditar_antes: 'acreditar antes de',
};

const campoLegible = (ruta: PropertyKey[]): string =>
  ruta.map((k) => (typeof k === 'number' ? `fila ${k + 1}` : (NOMBRE_CAMPO[String(k)] ?? String(k)))).join(', ');

function limite(i: { minimum?: unknown; maximum?: unknown; origin?: unknown }, cual: 'minimum' | 'maximum'): string {
  const n = Number(i[cual]);
  if (i.origin === 'string')
    return `${cual === 'minimum' ? 'al menos' : 'como mucho'} ${n} ${n === 1 ? 'carácter' : 'caracteres'}`;
  if (i.origin === 'array')
    return `${cual === 'minimum' ? 'al menos' : 'como mucho'} ${n} ${n === 1 ? 'elemento' : 'elementos'}`;
  return `${cual === 'minimum' ? 'un número desde' : 'un número hasta'} ${n}`;
}

const ESPERADO: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  boolean: 'sí o no',
  array: 'una lista',
  object: 'un bloque de datos',
};

function motivoDe(i: z.core.$ZodIssue): string {
  if (i.code === 'too_small') return `tiene que tener ${limite(i, 'minimum')}`;
  if (i.code === 'too_big') return `tiene que tener ${limite(i, 'maximum')}`;
  if (i.code === 'invalid_type')
    return /received undefined$/.test(i.message)
      ? 'falta'
      : `tiene que ser ${ESPERADO[i.expected] ?? 'otro tipo de dato'}`;
  if (i.code === 'unrecognized_keys') return `sobra: ${i.keys.map((k) => NOMBRE_CAMPO[k] ?? k).join(', ')}`;
  if (i.code === 'invalid_value') return `tiene que ser ${i.values.map((v) => `«${String(v)}»`).join(' o ')}`;
  // Los refine del esquema ya traen su mensaje en español.
  return i.message;
}

/** Los errores de validación como frases para una persona: campo legible y motivo («Equipo, fila 2, rol en la oferta: falta.»). */
export function mensajesParaPersonas(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? `${campoLegible(i.path)}: ` : ''}${motivoDe(i)}.`).join(' ');
}

export const SECCIONES = [
  'lotes',
  'equipo',
  'automaticos',
  'herramientas',
  'enfoque',
  'precio',
  'datos_anexo',
  'a_incorporar',
] as const;
export type NombreSeccion = (typeof SECCIONES)[number];
const campoDe = (s: NombreSeccion): keyof DecisionesData => (s === 'precio' ? 'ofertas' : s);

/** Las secciones en las que difieren dos decisiones (todas si no había antes). */
export function seccionesCambiadas(antes: DecisionesData | null, despues: DecisionesData): NombreSeccion[] {
  return SECCIONES.filter((s) => !antes || JSON.stringify(antes[campoDe(s)]) !== JSON.stringify(despues[campoDe(s)]));
}

/** Si ese rol puede guardar esas secciones: el precio, solo un admin. Sin rol (Hermes, la plataforma, los tests), sí. */
const puedeGuardar = (rol: Rol | undefined, secciones: readonly NombreSeccion[]): boolean =>
  !rol || !secciones.includes('precio') || alcanza(rol, 'admin');

// rol: el de la persona que guarda desde la web; sin él (Hermes, la plataforma, los tests) no se comprueba.
export type Escritura = {
  id: string;
  guion_id: number;
  datos: DecisionesData;
  secciones: NombreSeccion[];
  autor: string;
  rol?: Rol;
  esperada?: number;
};
type Escrita = { version: number; actualizada_en: string };

// La siguiente versión no repite ninguna del historial, aunque la fila se hubiera borrado.
function siguienteVersion(dbLic: Db, id: string): { actual: number | null; siguiente: number } {
  const fila = dbLic.prepare('SELECT version FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as
    { version: number } | undefined;
  const hist = dbLic.prepare('SELECT MAX(version) AS v FROM decisiones_historial WHERE licitacion_id = ?').get(id) as {
    v: number | null;
  };
  return { actual: fila?.version ?? null, siguiente: Math.max(fila?.version ?? 0, hist.v ?? 0) + 1 };
}

export const MENSAJE_CONFLICTO =
  'Otra persona guardó decisiones distintas mientras editabas: recarga para ver las suyas.';

/**
 * Escribe las decisiones con la versión siguiente y su fila de historial, en una transacción. Con
 * «esperada», solo si la guardada sigue siendo esa (sin decisiones guardadas no hay nada que pisar).
 * Todas las vías que cambian el precio (PUT, sección, deshacer, propuesta de Hermes, asistente)
 * pasan por aquí: el precio solo lo decide un admin.
 */
export function escribirDecisiones(dbLic: Db, e: Escritura): Result<Escrita> {
  if (!puedeGuardar(e.rol, e.secciones)) return fail('sin_permiso', PRECIO_SOLO_ADMIN);
  const ts = new Date().toISOString();
  return dbLic.transaction((): Result<Escrita> => {
    const v = siguienteVersion(dbLic, e.id);
    if (e.esperada !== undefined && v.actual !== null && v.actual !== e.esperada)
      return fail('conflicto', MENSAJE_CONFLICTO);
    const datos = JSON.stringify(e.datos);
    dbLic
      .prepare(
        `INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en, version) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(licitacion_id) DO UPDATE SET guion_id = excluded.guion_id, datos = excluded.datos, actualizada_en = excluded.actualizada_en, version = excluded.version`,
      )
      .run(e.id, e.guion_id, datos, ts, v.siguiente);
    dbLic
      .prepare(
        'INSERT INTO decisiones_historial (licitacion_id, version, guion_id, datos, secciones, autor, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(e.id, v.siguiente, e.guion_id, datos, JSON.stringify(e.secciones), e.autor, ts);
    return ok({ version: v.siguiente, actualizada_en: ts });
  })();
}

/**
 * Avisa a la web (recarga el paso) y a las comprobaciones, y lleva los perfiles a incorporar a Equipo. Solo
 * números y nombres de sección: el equipo son datos personales.
 */
export function avisarDecisiones(
  dbLic: Db,
  id: string,
  c: { guionVersion: number; version: number; secciones: NombreSeccion[] },
): void {
  sincronizarAIncorporar(dbLic, id);
  emitir(dbLic, {
    tipo: 'licitacion.guion',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'decisiones', version: c.guionVersion, decisiones: c.version, secciones: c.secciones },
  });
}

/** Los avisos del precio (por debajo del umbral de anormalidad…): no impiden guardar. */
export const avisosDePrecio = (dbLic: Db, id: string, g: GuionGuardado, d: DecisionesData): string[] =>
  problemasDePrecios(d, g.datos, { presupuestos: presupuestosDeLotes(dbLic, id) })
    .filter((p) => p.gravedad === 'aviso')
    .map((p) => p.mensaje);

/**
 * Guarda las decisiones contra el guion vigente. 409 sin guion; 400 con lo que no cuadre. Los
 * lotes son los de interés: sin lotes se toman de ahí y, si llegan otros, no se guarda.
 */
export function guardarDecisiones(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  entrada: unknown,
  actor?: Actor,
): Result<DecisionesRecibidas> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const guion = guionVigente(dbLic, id);
  if (!guion)
    return fail(
      'conflicto',
      'Esta licitación aún no tiene guion de la oferta: las decisiones se fijan sobre él. Pídelo primero.',
    );
  const d = Decisiones.safeParse(entrada);
  if (!d.success) return fail('invalid_input', mensajesParaPersonas(d.error));
  const lotes = lotesDecididos(dbLic, id, d.data.lotes);
  // El enfoque llega al redactor: sin citas del pliego, para que no aprenda a citar.
  const datos = normalizarDecisiones({ ...d.data, lotes, enfoque: sinCitasInternas(d.data.enfoque) }, guion.datos);
  // El enfoque con fuga no se guarda; prometer lo que Hermes dijo no prometer solo avisa.
  // Antes de validar: a quien no puede cambiar el precio no se le piden arreglos que no le tocan.
  const secciones = seccionesCambiadas(decisionesDe(dbLic, id)?.datos ?? null, datos);
  if (!puedeGuardar(actor?.rol, secciones)) return fail('sin_permiso', PRECIO_SOLO_ADMIN);
  const enfoque = revisarEnfoque(dbLic, guion, datos.enfoque, noPrometerDe(dbLic, id));
  const problemas = [
    ...enfoque.errores,
    ...problemasDeDecisiones({ dbLic, dbNucleo, id, guion }, datos),
    ...problemasDeContradictorios(dbLic, id, guion, datos),
  ];
  if (problemas.length) return fail('invalid_input', problemas.join(' '));
  const w = escribirDecisiones(dbLic, {
    id,
    guion_id: guion.id,
    datos,
    secciones,
    autor: actor?.nombre ?? 'web',
    rol: actor?.rol,
  });
  if (w.error) return w;
  avisarDecisiones(dbLic, id, { guionVersion: guion.version, version: w.data.version, secciones });
  return ok({
    guion_id: guion.id,
    version: w.data.version,
    actualizada_en: w.data.actualizada_en,
    datos,
    avisos: [...enfoque.avisos, ...avisosDePrecio(dbLic, id, guion, datos)],
  });
}

/** Las decisiones guardadas de una licitación, tal cual (null si no hay o ya no validan). */
export function decisionesDe(dbLic: Db, id: string): DecisionesGuardadas | null {
  const f = dbLic
    .prepare('SELECT guion_id, version, datos, actualizada_en FROM decisiones_oferta WHERE licitacion_id = ?')
    .get(id) as { guion_id: number; version: number; datos: string; actualizada_en: string } | undefined;
  if (!f) return null;
  const d = Decisiones.safeParse(JSON.parse(f.datos));
  const g = d.success ? guionVigente(dbLic, id) : null;
  if (d.success)
    return {
      guion_id: f.guion_id,
      version: f.version,
      actualizada_en: f.actualizada_en,
      datos: g ? normalizarDecisiones(d.data, g.datos) : d.data,
    };
  log.warn('decisiones de la oferta guardadas no válidas', {
    licitacion: id,
    campos: d.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

export type DecisionesVigentes = {
  decisiones: DecisionesGuardadas | null;
  problemas: string[];
  guion_cambiado: boolean;
};

/** Las decisiones con lo que ya no cuadra (p. ej. una persona dada de baja) y si el guion cambió desde que se fijaron. */
export function decisionesVigentes(dbLic: Db, dbNucleo: DbNucleo, id: string): DecisionesVigentes {
  const decisiones = decisionesDe(dbLic, id);
  const guion = guionVigente(dbLic, id);
  if (!decisiones || !guion) return { decisiones, problemas: [], guion_cambiado: false };
  const guion_cambiado = decisiones.guion_id !== guion.id;
  return {
    decisiones,
    problemas: problemasDeDecisiones({ dbLic, dbNucleo, id, guion }, decisiones.datos),
    guion_cambiado,
  };
}

// Lo del CV que sirve para presentar a la persona en la memoria; nada de contacto.
export type MiembroEquipo = {
  persona_id: number;
  nombre: string;
  rol: string;
  tipo: 'interno' | 'externo';
  rol_en_la_oferta: string;
  dedicacion: string | null;
  cv_ruta: string | null;
  titulaciones: string[];
  certificaciones: string[];
  anios_experiencia: number | null;
  sectores: string[];
  tecnologias: string[];
};

/** El equipo de las decisiones con los datos de cada persona (para la instrucción del run y la tool con permiso). */
export function equipoParaRedactar(dbNucleo: DbNucleo, d: DecisionesData): MiembroEquipo[] {
  return d.equipo.flatMap((m) => {
    const p = obtenerPersona(dbNucleo, m.persona_id);
    if (p.error) return [];
    return [
      {
        persona_id: m.persona_id,
        nombre: p.data.nombre,
        rol: p.data.rol,
        tipo: p.data.tipo,
        rol_en_la_oferta: m.rol_en_la_oferta,
        dedicacion: m.dedicacion ?? null,
        cv_ruta: p.data.cv_ruta,
        titulaciones: p.data.titulaciones,
        certificaciones: p.data.certificaciones,
        anios_experiencia: p.data.anios_experiencia,
        sectores: p.data.sectores,
        tecnologias: p.data.tecnologias,
      },
    ];
  });
}
