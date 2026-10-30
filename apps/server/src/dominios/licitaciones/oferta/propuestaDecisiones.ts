// Propuesta de las decisiones de la oferta: Hermes la deja al llegar el guion; una persona revisa y guarda.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { cancelarTrabajosDe } from '../../../nucleo/colaRelanzado.js';
import { encolar, encolarUnico } from '../../../nucleo/trabajos.js';
import { lotesDeLicitacion } from '../lotes.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import {
  decisionesDe,
  lotesDecididos,
  normalizarDecisiones,
  problemasDeDecisiones,
  tieneCautelas,
  type DecisionesData,
} from './decisiones.js';
import { guionVigente, type GuionBaseData } from './guion.js';
import { automaticoDe, conCriteriosDelGuion } from './guionLotes.js';
import { NoPrometer, revisarEnfoque } from './enfoque.js';
import { citasInternas, lotesNombrados } from './textoPliego.js';
import { guardaPlazo } from './plazo.js';
import { claveDeRonda } from './rondas.js';
import { quedanPropuestasHoy } from './topes.js';

// El precio no lo propone Hermes: sale de la
// estadística (precioSugerido.ts). Regla de los criterios automáticos: el tramo más alto con
// capacidad demostrada; lo que exige un documento que la empresa no tiene va a 0 y explicado (p. ej. un dossier del fabricante que no está en la Biblioteca), y lo que el
// pliego pide acreditar con un documento o un hecho solo con la evidencia: marcarlo sin ella es
// una declaración inexacta. El enfoque es opcional y, si va, en positivo, sin citas del
// pliego, sin lotes a los que no se va y sin delatar un criterio automático. Lo que la
// empresa no tiene o no conviene va en «no_prometer», con las marcas que lo delatarían (p. ej. una
// plataforma propia, un alojamiento concreto o un asistente 24/7).

// Hermes la deja con los CV, el perfil de la empresa, el pliego y las ofertas parecidas. No son las decisiones:
// una persona revisa y guarda.
export const TIPO_PROPUESTA_DECISIONES = 'licitaciones.decisiones';
export const PayloadPropuestaDecisiones = z.object({
  id: z.string().min(3),
  guion_id: z.number().int().positive(),
  pedida_en: z.string().min(10),
});
const log = logger('licitaciones');
const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);

const MiembroPropuesto = z.strictObject({
  persona_id: z.number().int().positive(),
  rol_en_la_oferta: Texto(2, 120).describe(
    'Rol en esta oferta, con el nombre que le da el pliego si lo da («Responsable de proyecto»)',
  ),
  dedicacion: Texto(1, 120).optional(),
  motivo: Texto(10, 600).describe(
    'Qué requisito o criterio cubre y qué de su CV lo acredita (años, proyectos, certificaciones)',
  ),
});

const AutomaticoPropuesto = z.strictObject({
  criterio: Texto(2, 300).describe('Literal del guion'),
  lote: Texto(1, 20)
    .nullable()
    .default(null)
    .describe('Lote al que se aplica si el criterio del guion trae «lotes» (uno por lote); null si es común'),
  tipo: z
    .enum(['compromiso', 'acreditacion'])
    .describe(
      '«compromiso»: algo que ofrecemos hacer (formación, soporte, horas, mejoras, más alumnos…); «acreditacion»: algo que hay que tener (certificado, experiencia, plantilla…)',
    ),
  nos_acogemos: z.boolean(),
  tramo: Texto(2, 500)
    .nullable()
    .default(null)
    .describe('descripcion literal del tramo (de guion.automaticos[].tramos); null si no nos acogemos'),
  capacidad: z
    .enum(['demostrada', 'parcial', 'no'])
    .optional()
    .describe('¿Podemos cumplir ese tramo hoy, con lo que consta?'),
  evidencia: Texto(10, 600)
    .optional()
    .describe('Dónde consta: perfil de la empresa, CV de quién, documento de la Biblioteca (ruta)'),
  documento_en_mano: z
    .boolean()
    .optional()
    .describe('Solo si el guion trae exige_documento: ¿está ya en la Biblioteca?'),
  cumple: z
    .enum(['si', 'no', 'falta_dato'])
    .optional()
    .describe(
      'Solo en «acreditacion»: «si» si consta (perfil de la empresa, ficha o CV), «no» si consta que no, «falta_dato» si no se puede saber con lo que hay',
    ),
  nivel: Texto(2, 300).optional().describe('Propuestas anteriores: el tramo. Usa «tramo»'),
  motivo: Texto(10, 600).describe(
    'Por qué ese tramo y no el siguiente; si no nos acogemos, qué falta para poder (y el documento exigido, si es eso)',
  ),
});

export const PropuestaDecisionesEntrada = z.strictObject({
  id: Texto(3, 40).describe('Id de la licitación'),
  guion_id: z.number().int().positive().describe('El id del guion vigente (licitaciones_oferta → guion.id)'),
  lotes: z.array(Texto(1, 20)).max(100).default([]),
  equipo: z.array(MiembroPropuesto).max(30),
  automaticos: z.array(AutomaticoPropuesto).max(30).default([]),
  herramientas: z.array(Texto(1, 120)).max(30).default([]),
  enfoque: z
    .string()
    .trim()
    .max(4000)
    .default('')
    .describe(
      'Indicaciones opcionales para la memoria, en positivo: solo lo que la estrategia no sacaría del pliego (qué nos diferencia aquí, qué contar y cómo). Sin citas del pliego, sin lotes a los que no vamos y sin nombrar criterios automáticos',
    ),
  no_prometer: z
    .array(NoPrometer)
    .max(10)
    .default([])
    .describe(
      'Lo que la memoria no debe prometer porque no lo tenemos o no conviene, con motivo y las marcas que lo delatarían',
    ),
  resumen: Texto(10, 1000).describe('En dos o tres frases, la propuesta y lo que la persona debe confirmar'),
});
export type PropuestaDecisionesData = z.infer<typeof PropuestaDecisionesEntrada>;
type ContenidoPropuesta = Omit<PropuestaDecisionesData, 'id' | 'guion_id'>;

export type PropuestaGuardada = {
  guion_id: number;
  creada_en: string;
  agente: string;
  avisos: string[];
  datos: ContenidoPropuesta;
  decisiones: DecisionesData;
};

/** La propuesta como decisiones (lo que se guardaría tal cual), sin precio: ese lo pone la plataforma. */
export function comoDecisiones(p: ContenidoPropuesta): DecisionesData {
  return {
    lotes: p.lotes,
    equipo: p.equipo.map(({ persona_id, rol_en_la_oferta, dedicacion }) => ({
      persona_id,
      rol_en_la_oferta,
      lotes: [],
      ...(dedicacion ? { dedicacion } : {}),
    })),
    automaticos: p.automaticos.map((a) => ({
      criterio: a.criterio,
      lote: a.lote,
      nos_acogemos: a.nos_acogemos,
      tramo: a.nos_acogemos ? a.tramo : null,
      ...(a.evidencia ? { evidencia: a.evidencia } : {}),
      nota: (a.nivel ? `${a.nivel}. ${a.motivo}` : a.motivo).slice(0, 1000),
    })),
    herramientas: p.herramientas,
    enfoque: p.enfoque,
    ofertas: (p.lotes.length ? p.lotes : [null]).map((lote) => ({
      lote,
      pendiente: true,
      importe: null,
      unitarios: [],
    })),
  };
}

const comillas = (xs: string[]) => xs.map((x) => `«${x}»`).join(', ');
const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();
type Propuesto = ContenidoPropuesta['automaticos'][number];
const nombre = (a: Propuesto) => `«${a.criterio}»${a.lote ? ` (lote ${a.lote})` : ''}`;
const nombres = (xs: Propuesto[]) => xs.map(nombre).join(', ');

// Lo que exige un documento que la empresa no tiene va a 0 y el motivo lo nombra.
function problemasDeDocumentos(p: ContenidoPropuesta, g: Pick<GuionBaseData, 'automaticos'>): string[] {
  return p.automaticos.flatMap((a) => {
    const doc = automaticoDe(g, a.criterio, a.lote ?? null)?.exige_documento;
    if (!doc || a.documento_en_mano === true) return [];
    if (a.nos_acogemos)
      return [
        `${nombre(a)} exige «${doc}» y no consta en la Biblioteca (documento_en_mano): va con nos_acogemos false, 0 puntos, y el motivo lo dice.`,
      ];
    return comparable(a.motivo).includes(comparable(doc))
      ? []
      : [`El motivo de ${nombre(a)} debe nombrar el documento que falta: «${doc}».`];
  });
}

// Un compromiso que el pliego pide acreditar con un documento o un hecho que hay que tener.
const PIDE_EVIDENCIA =
  /dossier|homologad|certificad|fabricante|ya (implantad|desplegad|en (uso|funcionamiento))|existente|en producci[oó]n/i;

/** Si el guion pide acreditar un criterio con un documento o un hecho (dossier del fabricante, certificado, plataforma existente). */
export const pideEvidencia = (comoSeAcredita: string): boolean => PIDE_EVIDENCIA.test(comoSeAcredita);

/** Si un criterio se acredita como una acreditación: por su tipo o porque el guion pide evidencia. */
function seAcredita(a: Propuesto, guion: Pick<GuionBaseData, 'automaticos'>): boolean {
  if (a.tipo === 'acreditacion') return true;
  const delGuion = automaticoDe(guion, a.criterio, a.lote ?? null);
  return Boolean(delGuion && pideEvidencia(delGuion.como_se_acredita));
}

/**
 * Lo propio de la propuesta: el tramo más alto con capacidad demostrada (y lo que no se puede
 * demostrar, a 0 y explicado), acreditaciones (y compromisos con evidencia) coherentes y un
 * equipo si hay memoria.
 */
export function problemasDePropuesta(
  p: ContenidoPropuesta,
  guion: Pick<GuionBaseData, 'automaticos' | 'memoria'>,
): string[] {
  const sinDemostrar = p.automaticos.filter((a) => a.nos_acogemos && a.capacidad !== 'demostrada');
  const sinEvidencia = p.automaticos.filter((a) => a.nos_acogemos && !a.evidencia);
  const acreditaciones = p.automaticos.filter((a) => seAcredita(a, guion));
  const sinCumple = acreditaciones.filter((a) => !a.cumple);
  // Con «si» puede ir nos_acogemos false (consta, pero falta el documento exigido): no se obliga.
  const incoherentes = acreditaciones.filter((a) => a.nos_acogemos && a.cumple && a.cumple !== 'si');
  const hayMemoria = guion.memoria !== null;
  return [
    ...(sinDemostrar.length
      ? [
          `Solo nos acogemos al tramo que podemos demostrar hoy: ${nombres(sinDemostrar)} van con capacidad «demostrada» o con nos_acogemos false y en el motivo lo que falta para subir.`,
        ]
      : []),
    ...(sinEvidencia.length
      ? [
          `Di dónde consta que podemos cumplirlo («evidencia»: perfil de la empresa, CV de quién o documento de la Biblioteca): ${nombres(sinEvidencia)}.`,
        ]
      : []),
    ...problemasDeDocumentos(p, guion),
    ...(sinCumple.length
      ? [
          `Cada acreditación, y cada compromiso que el pliego pide acreditar con un documento o un hecho (dossier, certificado, plataforma existente), lleva «cumple» (si, no o falta_dato): ${nombres(sinCumple)}.`,
        ]
      : []),
    ...(incoherentes.length ? [`Con cumple «no» o «falta_dato» va nos_acogemos false: ${nombres(incoherentes)}.`] : []),
    ...(hayMemoria && !p.equipo.length
      ? ['Propón el equipo: al menos una persona, con su rol en la oferta y el motivo.']
      : []),
  ];
}

/** Lo que se rechaza del enfoque hasta el tercer envío: citas del pliego, frases en negativo y lotes a los que no se va. */
export function problemasDeEnfoque(enfoque: string, lotes: { ambito: string[]; licitacion: string[] }): string[] {
  const citas = citasInternas(enfoque);
  const ajenos = lotes.licitacion.length
    ? lotesNombrados(enfoque, lotes.licitacion).filter((l) => !lotes.ambito.includes(l))
    : [];
  return [
    ...(citas.length
      ? [`Quita del enfoque las citas del pliego (${comillas(citas.slice(0, 5))}): lo que tomes del pliego, en prosa.`]
      : []),
    ...(tieneCautelas(enfoque)
      ? ['Escribe el enfoque en positivo: lo que la memoria contará y cómo. Lo que no se ofrece no se menciona.']
      : []),
    ...(ajenos.length
      ? [
          `El enfoque habla ${ajenos.length === 1 ? `del lote ${ajenos[0]}` : `de los lotes ${ajenos.join(', ')}`}, al que no vamos (vamos ${lotes.ambito.length ? `a ${lotes.ambito.join(', ')}` : 'al contrato entero'}): quítalo.`,
        ]
      : []),
  ];
}

function guardar(
  db: Db,
  e: { id: string; guion_id: number; datos: ContenidoPropuesta; avisos: string[]; agente: string },
): string {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(licitacion_id) DO UPDATE SET guion_id = excluded.guion_id, datos = excluded.datos, avisos = excluded.avisos,
      agente = excluded.agente, trabajo_id = NULL, creada_en = excluded.creada_en`,
  ).run(e.id, e.guion_id, JSON.stringify(e.datos), JSON.stringify(e.avisos), e.agente, ts);
  return ts;
}

/** Revisa y guarda la propuesta (sustituye a la anterior). Con `revisar` (la tool) rechaza lo que falte hasta el tercer envío. */
export function proponerDecisiones(
  db: Db,
  dbNucleo: DbNucleo,
  entrada: PropuestaDecisionesData,
  agente: string,
  op: { revisar?: boolean; hoy?: Date } = {},
): Result<{ creada_en: string; avisos: string[] }> {
  const { id, guion_id, ...enviada } = entrada;
  const datos = { ...enviada, lotes: lotesDecididos(db, id, enviada.lotes) };
  const guion = guionVigente(db, id);
  if (!guion)
    return fail('not_found', `La licitación «${id}» no tiene guion de la oferta: la propuesta se hace sobre él.`);
  if (guion.id !== guion_id)
    return fail(
      'invalid_input',
      `El guion vigente es el ${guion.id} (v${guion.version}): vuelve a leerlo con licitaciones_oferta y envía la propuesta con ese guion_id.`,
    );
  // La fuga nunca se acepta, ni con avisos; lo que Hermes dice no prometer no se cruza con su propio enfoque.
  const [fuga] = revisarEnfoque(db, guion, datos.enfoque, []).errores;
  if (fuga) return fail('invalid_input', `${fuga} Corrige y vuelve a enviar la propuesta entera.`);
  const lotes = { ambito: datos.lotes, licitacion: (lotesDeLicitacion(db, id)?.lotes ?? []).map((l) => l.id) };
  const problemas = [
    ...problemasDePropuesta(datos, guion.datos),
    ...(datos.enfoque ? problemasDeEnfoque(datos.enfoque, lotes) : []),
    ...problemasDeDecisiones(
      { dbLic: db, dbNucleo, id, guion },
      normalizarDecisiones(comoDecisiones(datos), guion.datos),
    ),
  ];
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_decisiones', id, op.hoy);
  if (exigir && problemas.length)
    return fail('invalid_input', `${problemas.join(' ')} Corrige y vuelve a enviar la propuesta entera.`);
  const avisos = exigir ? [] : problemas;
  const creada_en = guardar(db, { id, guion_id, datos, avisos, agente });
  emitir(db, {
    tipo: 'licitacion.guion',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'propuesta_decisiones', version: guion.version, avisos: avisos.length },
  });
  return ok({ creada_en, avisos });
}

/** La propuesta de una licitación, si la hay y sigue validando. */
export function propuestaDecisionesDe(db: Db, id: string): PropuestaGuardada | null {
  const f = db
    .prepare('SELECT guion_id, datos, avisos, agente, creada_en FROM propuestas_decisiones WHERE licitacion_id = ?')
    .get(id) as { guion_id: number; datos: string; avisos: string; agente: string; creada_en: string } | undefined;
  if (!f) return null;
  const d = PropuestaDecisionesEntrada.omit({ id: true, guion_id: true }).safeParse(JSON.parse(f.datos));
  if (!d.success) {
    log.warn('propuesta de decisiones no válida', { licitacion: id });
    return null;
  }
  // Con los nombres del guion vigente, para que la web case «Cargarla en el formulario» (compara con ===).
  const g = guionVigente(db, id);
  const datos = g ? { ...d.data, automaticos: conCriteriosDelGuion(d.data.automaticos, g.datos) } : d.data;
  return {
    guion_id: f.guion_id,
    creada_en: f.creada_en,
    agente: f.agente,
    avisos: JSON.parse(f.avisos) as string[],
    datos,
    decisiones: comoDecisiones(datos),
  };
}

/** ¿Llegó la propuesta después de pedirla? Enlaza con el trabajo. */
export function propuestaRecibida(db: Db, id: string, desde: string, trabajoId: number): boolean {
  const r = db
    .prepare(
      'UPDATE propuestas_decisiones SET trabajo_id = ? WHERE licitacion_id = ? AND creada_en >= ? AND trabajo_id IS NULL',
    )
    .run(trabajoId, id, desde);
  return (
    r.changes > 0 ||
    Boolean(db.prepare('SELECT 1 FROM propuestas_decisiones WHERE licitacion_id = ? AND creada_en >= ?').get(id, desde))
  );
}

/** La clave de la propuesta automática para un guion (la de su primera ronda). */
export const claveAutoPropuesta = (id: string, guionId: number): string => `decisiones-auto-${id}-g${guionId}`;

/**
 * Pide la propuesta (a mano, o sola al llegar un guion nuevo si aún no hay decisiones
 * guardadas, o en la ronda `ronda` si la automática falló) si da tiempo antes del plazo.
 */
export function pedirPropuestaDecisiones(
  dbNucleo: DbNucleo,
  dbLic: Db,
  id: string,
  aMano: boolean,
  op: { ronda?: number; ahoraMs?: number; confirmado?: boolean } = {},
): Result<{ trabajo: number }> {
  const guion = guionVigente(dbLic, id);
  if (!guion)
    return fail(
      'invalid_input',
      'Esta licitación aún no tiene guion de la oferta: la propuesta se hace sobre él. Pídelo primero.',
    );
  const plazo = guardaPlazo(dbLic, id, 'decisiones', { ahoraMs: op.ahoraMs, aMano, confirmado: op.confirmado });
  if (plazo.error) return plazo;
  const pedida = new Date(op.ahoraMs ?? Date.now()).toISOString();
  const payload = { id, guion_id: guion.id, pedida_en: pedida };
  if (aMano)
    return ok({
      trabajo: encolarUnico(dbNucleo, {
        tipo: TIPO_PROPUESTA_DECISIONES,
        dominio: 'licitaciones',
        base: `decisiones-${id}`,
        payload,
        aMano,
      }).id,
    });
  const clave = claveDeRonda(claveAutoPropuesta(id, guion.id), op.ronda ?? 0);
  return ok({
    trabajo: encolar(dbNucleo, { tipo: TIPO_PROPUESTA_DECISIONES, dominio: 'licitaciones', clave, payload, aMano }),
  });
}

/**
 * Al llegar un guion, si no está descartada, se pide la propuesta para él, también con decisiones
 * guardadas sobre un guion anterior: queda como propuesta, sin tocarlas, y una persona decide si
 * la carga en el formulario (pliegos o lotes nuevos cambian lo que conviene decidir).
 */
export function proponerAlLlegarGuion(dbNucleo: DbNucleo, dbLic: Db, id: string): void {
  const guion = guionVigente(dbLic, id);
  if (!guion || decisionesDe(dbLic, id)?.guion_id === guion.id) return;
  if (dbLic.prepare("SELECT 1 FROM oportunidades WHERE licitacion_id = ? AND estado = 'descartada'").get(id)) return;
  // Un rebase (guion idéntico) ya pasó la propuesta al guion nuevo: pedir otra repetiría el run.
  if (dbLic.prepare('SELECT 1 FROM propuestas_decisiones WHERE licitacion_id = ? AND guion_id = ?').get(id, guion.id))
    return;
  // Dos propuestas a la vez gastarían intentos: la de un guion anterior fallaría por guion_id obsoleto.
  if (
    dbNucleo
      .prepare(
        `SELECT 1 FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? AND json_extract(payload, '$.guion_id') = ?`,
      )
      .get(TIPO_PROPUESTA_DECISIONES, id, guion.id)
  )
    return;
  cancelarTrabajosDe(
    dbNucleo,
    TIPO_PROPUESTA_DECISIONES,
    id,
    (p) => (p as { guion_id?: number }).guion_id !== guion.id,
  );
  if (!quedanPropuestasHoy(dbNucleo, id))
    return log.info('propuesta automática no pedida: tope del día', { licitacion: id });
  const r = pedirPropuestaDecisiones(dbNucleo, dbLic, id, false);
  if (r.error) log.warn('propuesta de decisiones sin pedir', { licitacion: id, codigo: r.error.code });
}

export function instruccionesPropuestaDecisiones(id: string, guionId: number, empresa: string): string {
  return [
    `Tarea de la plataforma de ${empresa}: propón las decisiones de la oferta a la licitación ${id} (guion ${guionId}): lotes, equipo nominal, criterios automáticos, herramientas, lo que no conviene prometer y, si hace falta, un enfoque. Es una propuesta: quien lleva la oferta la revisa y la guarda. El precio no: lo calcula la plataforma. Sigue la skill «licitaciones» (sección «Proponer las decisiones de la oferta»).`,
    `1. licitaciones_oferta (id=${id}): el guion (apartados de la memoria con lo que se valora, criterios automáticos con puntos, cómo se acreditan y casilla). licitaciones_ver (id=${id}): la ficha, «go_no_go.ambito» (lotes de interés) y los requisitos ya evaluados.`,
    `2. Equipo: licitaciones_equipo (id=${id}) da candidatos por requisito; colaboradores_ver y, si hace falta, su CV con biblioteca_leer. Cubre cada perfil que exige el pliego con la persona que mejor lo acredita. Si hay criterios automáticos de experiencia o certificaciones del equipo, reparte las categorías (una persona por categoría salvo que el pliego diga otra cosa) para sumar más puntos: a cada una, quien tenga más años específicos por encima del mínimo, mirando anios_experiencia, tecnologías, notas y el CV de cada colaborador. Rol con el nombre del pliego y motivo con lo que lo acredita.`,
    '3. Criterios automáticos, uno por cada criterio del guion y, si el criterio trae «lotes», uno por cada lote nuestro de esos (con «lote»). Regla: EL TRAMO MÁS ALTO CON CAPACIDAD DEMOSTRADA. Para cada uno: «tramo» (la descripcion literal de guion.automaticos[].tramos; sin tramos, el criterio), «capacidad» («demostrada» solo si hoy consta que lo cumplimos: perfil de la empresa con plataforma_empresa, ficha o CV del colaborador, documento de la Biblioteca), «evidencia» (dónde consta, con la ruta o el nombre) y «motivo» (por qué ese tramo y no el siguiente). Con capacidad «parcial» o «no», nos_acogemos false y en el motivo lo que falta para subir. Si el guion dice que se acredita con un documento o un hecho (dossier homologado del fabricante, certificado, plataforma ya en marcha), trátalo como una acreditación: lleva «cumple» y nos_acogemos true solo con la evidencia; marcarlo sin ella es una declaración inexacta. Si el guion trae «exige_documento», búscalo en la Biblioteca (biblioteca_buscar): si no está, documento_en_mano false, nos_acogemos false (0 puntos) y el motivo nombra el documento. «acreditacion» lleva además «cumple»: «si» si consta en plataforma_empresa, en la ficha del colaborador (también sus notas) o en su CV, aunque haya que preparar el documento para presentarlo (CV normalizado, certificado); «no» o «falta_dato» (dilo en «motivo»: qué dato falta y dónde ponerlo) con nos_acogemos false. Un compromiso con coste real (ediciones o materiales sin coste, horas adicionales) va al tramo que podemos sostener, no al máximo.',
    `4. Herramientas: solo las que usamos de verdad (perfil de la empresa, CV) y encajan con el pliego; nada inventado. En no_prometer, lo que la memoria no debe prometer porque no lo tenemos o no conviene (p. ej. «Moodle propio», «alojamiento en la UE», «chatbot 24/7»), con motivo y de 1 a 5 marcas; el enfoque es opcional. Si lo das, en positivo y solo con lo que la estrategia no sacaría del pliego: lo que la memoria debe contar para puntuar alto en cada apartado y cómo, y qué nos diferencia aquí (a medida, trato directo, autonomía del cliente, honestidad de alcance); lo que no se ofrece no se menciona, sin citas del pliego («pp. 12», nombres de archivo), sin hablar de lotes a los que no vamos y sin nombrar criterios automáticos ni lo que se oferta en ellos (iría a la memoria y sería causa de exclusión); mira licitaciones_propuestas (id=${id}) → «parecidas» y «aprendizajes». Lotes: exactamente los de «go_no_go.ambito.lotes» (vacío si el ámbito es el contrato entero); no se proponen otros: se cambian en el bloque Lotes de la web.`,
    '   Si licitaciones_oferta ya trae «decisiones» guardadas, son de un guion anterior y no se tocan: propón sobre este guion lo que conviene ahora (no las copies sin más) y di en «resumen» qué cambia respecto a ellas y por qué.',
    `5. Envía licitaciones_decisiones con id=${id}, guion_id=${guionId}, lotes, equipo, automaticos, herramientas, no_prometer, enfoque (si lo hay) y resumen (lo que la persona debe confirmar). Si responde con un error, corrige exactamente lo que dice y reenvía la propuesta entera.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}
