// Ficha de una licitación (Analista de pliegos): lo que Hermes envía con licitaciones_ficha tras leer los pliegos.
import { z } from 'zod';
import { encolar, encolarUnico } from '../../nucleo/trabajos.js';
import { emitir } from '../../nucleo/eventos.js';
import type { Db as DbNucleo } from '../../nucleo/db.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { importesMalLeidos, leerPerfilEmpresa, type PerfilEmpresaData } from '../../nucleo/empresa.js';
import { logger } from '../../nucleo/log.js';
import type { Evaluacion } from './evaluador.js';
import {
  bloqueos,
  descartarSola,
  descartarTipificada,
  descarteNoGo,
  evaluarFila,
  recuperarNoGo,
  resolverConFicha,
  semaforo,
  type FilaEvaluable,
  type Semaforo,
} from './gonogo.js';
import type { Db } from './store.js';
import {
  COLUMNAS_LOTES,
  idsDelAmbito,
  lotesDeLicitacion,
  sqlReglaFicha,
  type Ambito,
  type Presentacion,
} from './lotes.js';
import { nucleo } from '../../nucleo/contexto.js';
import { buscarCandidatos } from '../../nucleo/colaboradores/busqueda.js';
import { CUMPLE, TEMAS, TEMAS_CHECKLIST, TIPOS_REQUISITO } from './temas.js';
import { esNuevaCreacion, verificarRequisitos, type ContextoVerificacion } from './fichaVerificacion.js';
import { reglaFormacionesFicha } from './formaciones.js';
import {
  certificacionesOmitidas,
  coberturaDeFicha,
  ESTADOS_COBERTURA,
  type CoberturaTema as CoberturaDeTema,
} from './fichaCobertura.js';
import { pasajesDeLicitacion, type Pasajes } from './pasajes.js';
import { calidadDeFicha } from './fichaCalidad.js';
import type { MetricasRun } from '../../nucleo/hermes/metricas.js';
import { exigirTotal } from './prefiltro.js';
import { TIPOS_SENAL } from './antecedentes/indicios.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { legibilidadDePliegos, listoParaFicha, motivoIlegible, type ListoParaFicha } from './pliegosIndice.js';
import { exigirRevision } from './rechazos.js';

// Hermes lee la ficha de la PLACSP, el perfil de la empresa y los pliegos. Se valida con zod estricto y se
// aplica al llegar (sin paso de aprobación: la decisión es preparar la oferta o descartar): un requisito
// excluyente que la empresa no cumple descarta la oportunidad. Si Hermes la vuelve a enviar, la nueva
// sustituye a la anterior.
export const TIPO_FICHA = 'licitaciones.ficha';
const log = logger('licitaciones');
export const PayloadFicha = z.object({ id: z.string().min(3), pedida_en: z.string().min(10) });

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Pagina = z.number().int().min(1).max(5000).optional().describe('Página del pliego donde está el dato');
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, 'fecha AAAA-MM-DD o AAAA-MM-DDTHH:MM');

// Lo que se puede conseguir antes de presentarse nunca descarta, aunque la ficha lo marque excluyente.
const NUNCA_EXCLUYENTES: ReadonlySet<string> = new Set(['seguro']);
const esExcluyente = (r: { tipo: string; excluyente: boolean }) => r.excluyente && !NUNCA_EXCLUYENTES.has(r.tipo);

// Versión del análisis (instrucciones, esquema y verificación): las fichas de una versión
// anterior se vuelven a pedir (fichaRegeneracion.ts) y la web avisa de que son antiguas.
// 3: medios personales sin falsos «sí»: las fichas de antes dicen «Cumple» con mínimos genéricos.
// 4: lee las rectificaciones y notas posteriores (una nota puede exigir una certificación que el pliego no cita), rechaza
// «certificaciones: no_lo_pide» si un pasaje pide una, y un «sí» por confirmar queda en duda.
// 5: la norma para empresas de nueva creación va aparte en cada solvencia (nueva_creacion) y
// una formación fuera de las áreas de la empresa es no_go.
export const VERSION_PROMPT_FICHA = 5;

// La regla que el pliego da a las empresas de menos de cinco años (art. 90.4 LCSP) cuando no es la
// general: la web la enseña como la norma que se le aplica mientras la empresa sea de nueva creación.
const NuevaCreacion = z.strictObject({
  valor_exigido: Texto(3, 500).describe(
    'Lo que se exige a las empresas de nueva creación en lugar de la regla general, p. ej. «sin relación de servicios: declaración de medios técnicos y personal»',
  ),
  documento: Texto(1, 500).describe('Ruta o nombre del pliego'),
  pagina: z.number().int().min(1).max(5000).describe('Página donde el pliego admite la excepción'),
});

const RequisitoFicha = z.strictObject({
  tipo: z.enum(TIPOS_REQUISITO),
  descripcion: Texto(3, 1000).describe(
    'Qué pide el pliego, concreto y comprobable en una frase: qué, cuánto y cómo se acredita (p. ej. «Visita obligatoria a las instalaciones antes de ofertar, con certificado del órgano»). Sin valorar si lo cumplimos: eso va en justificacion',
  ),
  excluyente: z
    .boolean()
    .describe('true si no cumplirlo deja fuera de la licitación; entonces documento y página son obligatorios'),
  valor_exigido: Texto(1, 300)
    .optional()
    .describe('La cifra, norma o plazo, p. ej. «≥ 450.000 € de volumen anual», «ISO 27001», «castellano»'),
  cumple: z
    .enum(CUMPLE)
    .describe(
      'si / no según nuestros datos; no_aplica si el pliego lo pide pero no nos afecta (p. ej. solo para UTE); dudoso solo si falta un dato concreto (di cuál)',
    ),
  fuente: Texto(2, 300)
    .optional()
    .describe(
      'Qué dato nuestro decide «cumple» (obligatorio con si o no): «perfil.volumen_negocio 2025: 186.420,35 €», «perfil.notas: subcontrata siempre el alojamiento», «perfil.idiomas», «colaboradores_buscar: 2 cumplen los mínimos», «perfil-licitaciones.md»',
    ),
  justificacion: Texto(3, 1000).describe(
    'Cómo estamos nosotros frente a eso, en una o dos frases: lo que tenemos o lo que falta',
  ),
  documento: Texto(1, 500).optional().describe('Ruta o nombre del pliego'),
  pagina: Pagina,
  cita: Texto(10, 500)
    .optional()
    .describe(
      'La frase del pliego que lo exige, copiada literal (sin resumir; «…» para saltar un trozo). La plataforma la busca en el pliego: si no está tal cual, el requisito sale como «cita no localizada»',
    ),
  lote: Texto(1, 20)
    .optional()
    .describe('Id del lote si el requisito es solo de uno (como en «lotes[].id»); sin él, vale para todo el contrato'),
  nueva_creacion: NuevaCreacion.optional().describe(
    'Solo en solvencia técnica, económica o experiencia, si el pliego da otra norma a las empresas de nueva creación (menos de cinco años)',
  ),
});

const CoberturaTema = z.strictObject({
  tema: z.enum(TEMAS),
  estado: z
    .enum(ESTADOS_COBERTURA)
    .describe(
      'en_requisitos: hay requisitos de ese tema; no_lo_pide: el pliego lo trata y no exige nada (cita dónde); no_encontrado: no aparece en los pliegos leídos',
    ),
  detalle: Texto(1, 300).optional(),
  documento: Texto(1, 500).optional(),
  pagina: Pagina,
});

const Criterio = z.strictObject({
  descripcion: Texto(2, 500),
  peso: z.number().min(0).max(1000).describe('Puntos o porcentaje'),
  tipo: z.enum(['formula', 'juicio_valor']),
  subcriterios: z
    .array(z.strictObject({ descripcion: Texto(2, 500), peso: z.number().min(0).max(1000).optional() }))
    .max(30)
    .optional(),
  pagina: Pagina,
});

// Señales textuales de que el pliego puede estar escrito a medida de alguien: Hermes las
// propone y, en cuanto llega la ficha, se suman a los indicios de «licitación con nombre».
const SenalPliego = z.strictObject({
  tipo: z
    .enum(TIPOS_SENAL)
    .describe(
      'experiencia_especifica, tecnologia_especifica, marca_o_compatibilidad, juicio_valor_favorece (criterio que premia a quien ya presta el servicio), solvencia_a_medida u otra',
    ),
  descripcion: Texto(3, 500).describe('Qué pide el pliego y por qué parece pensado para alguien'),
  cita: Texto(3, 500).optional().describe('Texto literal del pliego'),
  documento: Texto(1, 500).optional(),
  pagina: Pagina,
  lote: Texto(1, 20)
    .optional()
    .describe(
      'Id del lote si la señal es solo de un lote (como en «lotes[].id»); sin él, cuenta para todo el contrato',
    ),
});

// Lo que envía el agente. «cobertura» es opcional para el esquema (una ficha anterior a la segunda versión del análisis
// no la tiene); la exige la revisión de proponerFicha, que dice exactamente qué falta.
const FichaBase = z.strictObject({
  titulo_corto: Texto(3, 60)
    .optional()
    .describe(
      'El título en 60 caracteres como mucho para la tarjeta del Pipeline: qué se contrata y para quién, sin «Contratación de los servicios de…» ni el expediente. P. ej. «Formación en IA generativa para personal técnico»',
    ),
  resumen: Texto(10, 3000).describe(
    'De qué va en tres frases: qué se contrata y para qué; qué incluye; lotes, importe sin IVA, duración y meses de soporte o garantía. Al final, entre paréntesis, documento y página',
  ),
  requisitos: z.array(RequisitoFicha).max(60),
  criterios: z.array(Criterio).max(40),
  documentacion: z
    .array(z.strictObject({ sobre: Texto(1, 80), documento: Texto(2, 500), obligatorio: z.boolean(), pagina: Pagina }))
    .max(80),
  hitos: z
    .array(
      z.strictObject({
        hito: Texto(2, 300),
        fecha: Fecha.optional(),
        detalle: Texto(1, 300).optional(),
        pagina: Pagina,
      }),
    )
    .max(30),
  garantias: z
    .array(
      z.strictObject({
        tipo: z.enum(['provisional', 'definitiva', 'complementaria', 'otra']),
        descripcion: Texto(1, 300).optional(),
        porcentaje: z.number().min(0).max(100).optional(),
        importe: z.number().nonnegative().optional(),
        pagina: Pagina,
      }),
    )
    .max(10),
  penalizaciones: z.array(z.strictObject({ descripcion: Texto(3, 500), pagina: Pagina })).max(30),
  riesgos: z.array(z.strictObject({ descripcion: Texto(3, 500), gravedad: z.enum(['alta', 'media', 'baja']) })).max(30),
  recomendacion: z.strictObject({ decision: z.enum(['go', 'no_go', 'revisar']), motivo: Texto(3, 1000) }),
  presentacion_lotes: z
    .strictObject({
      regla: z
        .enum(['un_lote', 'todos_los_lotes', 'uno_o_varios'])
        .describe('A cuántos lotes se puede presentar un licitador según el PCAP'),
      maximo_lotes: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Máximo de lotes a los que se puede ofertar, si el pliego lo fija'),
      detalle: Texto(3, 500).optional(),
      documento: Texto(1, 500).optional(),
      pagina: Pagina,
    })
    .optional()
    .describe(
      'Solo en licitaciones con lotes cuya regla de presentación no publica la PLACSP («presentacion.sin_confirmar»): lo que dice el PCAP',
    ),
  senales_pliego: z
    .array(SenalPliego)
    .max(15)
    .optional()
    .describe(
      'Señales de pliego a medida: experiencia o tecnología muy específicas, marcas o compatibilidad obligatoria sin «o equivalente», criterios de juicio de valor que favorecen a quien ya presta el servicio, solvencia a medida. Vacío o ausente si no hay',
    ),
  cobertura: z
    .array(CoberturaTema)
    .max(TEMAS.length)
    .optional()
    .describe(
      `Un elemento por cada tema de la lista (${TEMAS_CHECKLIST.join(', ')}): si está en los requisitos, si el pliego no lo pide (con documento y página) o si no aparece en los pliegos`,
    ),
});

const VerificacionGuardada = z.object({
  indice: z.number().int(),
  regla: z.string(),
  resultado_ia: z.enum(CUMPLE),
  resultado: z.enum(CUMPLE),
  fuente: z.string(),
  detalle: z.string().nullable(),
});
const CalidadGuardada = z.object({
  puntuacion: z.number(),
  requisitos: z.number(),
  excluyentes: z.number(),
  dudosos_pct: z.number(),
  con_pagina_pct: z.number(),
  excluyentes_con_cita_pct: z.number(),
  cobertura_checklist_pct: z.number(),
  cobertura_placsp_pct: z.number(),
  corregidos_por_codigo: z.number(),
  avisos: z.array(z.string()),
});

// Lo que se guarda: lo del agente con los «cumple» que corrigió el código, qué comprobó y la
// calidad. Las fichas anteriores no traen ni cobertura ni verificaciones y siguen valiendo.
// ambito_lotes: los lotes del ámbito cuando llegó (vacío: el contrato entero), para saber si
// se hizo para otros lotes que los de ahora; las anteriores no lo traen.
export const FichaDatos = FichaBase.extend({
  verificaciones: z.array(VerificacionGuardada).optional(),
  calidad: CalidadGuardada.optional(),
  ambito_lotes: z.array(z.string()).max(500).optional(),
});
export type FichaDatosData = z.infer<typeof FichaDatos>;

export const FichaEntrada = FichaBase.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación, p. ej. «p-12345678»'),
});
export type FichaEntradaData = z.infer<typeof FichaEntrada>;

// Las fichas se aplican al llegar: la vigente siempre es 'aprobada'. Las 'pendiente' y
// 'rechazada' del flujo anterior solo quedan en la base (las pendientes se aplican al arrancar).
// metricas: las del trabajo de IA que la trajo (modelo, tokens, duración), si se sabe.
export type FichaGuardada = {
  id: number;
  estado: 'aprobada';
  agente: string;
  creada_en: string;
  actualizada_en: string;
  revisada_en: string | null;
  version_prompt: number;
  trabajo_id: number | null;
  metricas: MetricasRun | null;
  datos: FichaDatosData;
};
type FilaFicha = Omit<FichaGuardada, 'datos' | 'metricas'> & { datos: string; metricas?: string | null };

// Un lote que no existe no contaría en ninguno: mejor que Hermes lo corrija.
function loteInexistente(
  items: { lote?: string | undefined }[],
  lotes: { id: string }[],
  que: (lote: string) => string,
): string | null {
  const mal = items.find((s) => s.lote !== undefined && !lotes.some((l) => l.id === s.lote));
  if (!mal) return null;
  return lotes.length
    ? `${que(mal.lote!)}, que no existe (lotes: ${lotes
        .map((l) => l.id)
        .slice(0, 60)
        .join(', ')}).`
    : 'Esta licitación no tiene lotes: quita «lote» de los requisitos y de las señales del pliego.';
}

// Lo que nunca se acepta: la ficha no casaría con la licitación o citaría mal las cifras de la empresa.
function errorDuro(
  entrada: FichaEntradaData,
  lotes: { id: string }[],
  perfil: PerfilEmpresaData | null,
): string | null {
  if (entrada.presentacion_lotes && !lotes.length) return 'Esta licitación no tiene lotes: quita «presentacion_lotes».';
  const senales = entrada.senales_pliego ?? [];
  return (
    loteInexistente(
      senales,
      lotes,
      (l) => `La señal «${senales.find((s) => s.lote === l)?.tipo}» indica el lote «${l}»`,
    ) ??
    loteInexistente(entrada.requisitos, lotes, (l) => `Un requisito indica el lote «${l}»`) ??
    (perfil ? importesMalLeidos(perfil, JSON.stringify(entrada)) : null)
  );
}

/** Requisitos de la PLACSP del ámbito que quedaron sin detalle: la ficha debe leerlos del pliego. */
function pendientesPlacsp(db: Db, id: string, perfil: PerfilEmpresaData | null, hoy: Date): Evaluacion[] {
  const f = db
    .prepare(
      `SELECT l.id, l.tipo_contrato, l.valor_estimado, ${COLUMNAS_LOTES}, o.lotes_interes, o.lotes_prefiltro, ${sqlReglaFicha('l')}
    FROM licitaciones l LEFT JOIN oportunidades o ON o.licitacion_id = l.id WHERE l.id = ?`,
    )
    .get(id) as FilaEvaluable | undefined;
  return f ? evaluarFila(f, perfil, hoy).evals.filter((e) => e.resultado === 'desconocido') : [];
}

// Los candidatos salen de los colaboradores del núcleo con los CPV del ámbito.
function candidatosDelNucleo(cpvs: string[]): ContextoVerificacion['candidatos'] {
  return async (textos) => {
    const r = await buscarCandidatos(nucleo().db, {
      requisitos: textos,
      cpvs: cpvs.filter((c) => /^\d{2,8}$/.test(c)).slice(0, 30),
      limite: 20,
    });
    return r.error ? null : r.data;
  };
}

// revisar: el contrato con el agente (MCP). Exige cobertura y citas y rechaza con lo que falta;
// sin él (llamadas internas), lo que falte queda como aviso en la calidad.
// pasajes: los de certificaciones de los pliegos (la frontera con el índice de la Biblioteca).
type BuscarPasajes = (id: string) => Promise<Result<Pasajes>>;
export type OpcionesFicha = {
  revisar?: boolean;
  candidatos?: ContextoVerificacion['candidatos'];
  hoy?: Date;
  pasajes?: BuscarPasajes;
};
export type FichaRecibida = {
  ficha: number;
  estado: 'aprobada';
  sustituye: boolean;
  descartada: boolean;
  calidad: number;
  corregidos: { requisito: string; hermes: string; codigo: string; motivo: string | null }[];
  avisos: string[];
};

function guardarYAplicar(
  db: Db,
  id: string,
  datos: FichaDatosData,
  agente: string,
): { ficha: number; sustituye: boolean; descartada: boolean } {
  // Guardar y aplicar van juntos: una ficha guardada sin su descarte (o al revés) dejaría la
  // oportunidad en un estado que no cuadra con su ficha. El evento sale con lo ya confirmado.
  return db.transaction(() => {
    const ts = new Date().toISOString();
    const previa = db.prepare("SELECT 1 FROM fichas WHERE licitacion_id = ? AND estado = 'aprobada'").get(id);
    const ficha = Number(
      db
        .prepare(
          "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en, version_prompt) VALUES (?, 'aprobada', ?, ?, ?, ?, ?, ?)",
        )
        .run(id, JSON.stringify(datos), agente, ts, ts, ts, VERSION_PROMPT_FICHA).lastInsertRowid,
    );
    return { ficha, sustituye: Boolean(previa), descartada: alAprobar(db, id, datos) };
  })();
}

const pasajesDeCertificaciones =
  (db: Db): BuscarPasajes =>
  (id) =>
    pasajesDeLicitacion(db, id, { temas: ['certificaciones'], maxPorTema: 5 });

// Sin índice o sin pliegos legibles (p. ej. en pruebas) no se comprueba: no se rechaza por eso.
async function certificacionesSinRecoger(
  id: string,
  cobertura: CoberturaDeTema[] | undefined,
  buscar: BuscarPasajes,
): Promise<string | null> {
  if (!cobertura?.some((c) => c.tema === 'certificaciones' && c.estado === 'no_lo_pide')) return null;
  const r = await buscar(id);
  return r.error
    ? null
    : certificacionesOmitidas(
        cobertura,
        r.data.temas.flatMap((t) => t.pasajes),
      );
}

/**
 * Revisa, verifica, guarda y aplica la ficha (semáforo y descarte automático); sustituye a la
 * anterior. El código corrige los «cumple» que puede comprobar con los datos de la empresa.
 */
export async function proponerFicha(
  db: Db,
  entrada: FichaEntradaData,
  agente: string,
  op: OpcionesFicha = {},
): Promise<Result<FichaRecibida>> {
  const { id, ...datos } = entrada;
  const lotes = lotesDeLicitacion(db, id);
  if (!lotes) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const perfil = leerPerfilEmpresa(db)?.perfil ?? null;
  const duro = errorDuro(entrada, lotes.lotes, perfil);
  if (duro) return fail('invalid_input', duro);
  const hoy = op.hoy ?? new Date();
  const cobertura = coberturaDeFicha(datos.cobertura, datos.requisitos, pendientesPlacsp(db, id, perfil, hoy));
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_ficha', id, hoy);
  if (exigir && cobertura.problemas.length)
    return fail('invalid_input', `${cobertura.problemas.join(' ')} Corrige y vuelve a enviar la ficha entera.`);
  const omitidas = exigir
    ? await certificacionesSinRecoger(id, datos.cobertura, op.pasajes ?? pasajesDeCertificaciones(db))
    : null;
  if (omitidas) return fail('invalid_input', omitidas);
  const v = await verificarRequisitos(datos.requisitos, {
    perfil,
    hoy,
    candidatos: op.candidatos ?? candidatosDelNucleo(lotes.ambito.cpvs),
  });
  const calidad = calidadDeFicha(v.requisitos, cobertura, v.verificaciones, cobertura.problemas);
  const r = guardarYAplicar(
    db,
    id,
    {
      ...datos,
      requisitos: v.requisitos,
      verificaciones: v.verificaciones,
      calidad,
      ambito_lotes: idsDelAmbito(lotes.ambito),
    },
    agente,
  );
  emitir(db, {
    tipo: 'licitacion.ficha',
    dominio: 'licitaciones',
    recurso: id,
    datos: { estado: 'aprobada', agente, descartada: r.descartada },
  });
  const corregidos = v.verificaciones
    .filter((x) => x.resultado !== x.resultado_ia)
    .map((x) => ({
      requisito: datos.requisitos[x.indice]!.descripcion.slice(0, 120),
      hermes: x.resultado_ia,
      codigo: x.resultado,
      motivo: x.detalle,
    }));
  return ok({ ...r, estado: 'aprobada', calidad: calidad.puntuacion, corregidos, avisos: calidad.avisos });
}

/** Las fichas que quedaron pendientes con el flujo anterior se aplican (una vez, al arrancar). */
export function aplicarFichasPendientes(db: Db): number {
  // Se leen en 'pendiente' y se validan como la ficha vigente que van a ser.
  const filas = db.prepare("SELECT * FROM fichas WHERE estado = 'pendiente' ORDER BY id").all() as (FilaFicha & {
    licitacion_id: string;
  })[];
  for (const f of filas) {
    const g = aGuardada(f);
    db.prepare("UPDATE fichas SET estado = 'aprobada', revisada_en = ? WHERE id = ?").run(
      new Date().toISOString(),
      f.id,
    );
    if (g) alAprobar(db, f.licitacion_id, g.datos);
  }
  return filas.length;
}

// Una ficha guardada que ya no valida (p. ej. tras endurecer el esquema) no se muestra,
// pero se avisa en el log con las rutas de zod, nunca con el contenido.
function aGuardada(f: FilaFicha | undefined): FichaGuardada | null {
  if (!f) return null;
  const datos = FichaDatos.safeParse(JSON.parse(f.datos));
  if (datos.success)
    return { ...f, metricas: f.metricas ? (JSON.parse(f.metricas) as MetricasRun) : null, datos: datos.data };
  log.warn('ficha guardada no válida', {
    ficha: f.id,
    campos: datos.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

/** La ficha vigente de una licitación (la última que llegó). */
export function fichasDe(db: Db, id: string): { aprobada: FichaGuardada | null } {
  const aprobada = db
    .prepare(
      "SELECT * FROM fichas WHERE licitacion_id = ? AND estado = 'aprobada' ORDER BY revisada_en DESC, id DESC LIMIT 1",
    )
    .get(id) as FilaFicha | undefined;
  return {
    aprobada: aGuardada(aprobada ? { ...aprobada, metricas: metricasDelTrabajo(db, aprobada.trabajo_id) } : undefined),
  };
}

// Las del trabajo que trajo la ficha, en nucleo.db (adjunta). Sin trabajo enlazado, o en una
// base sin el núcleo (pruebas, scripts), no hay.
function metricasDelTrabajo(db: Db, trabajoId: number | null): string | null {
  if (trabajoId === null) return null;
  try {
    return (
      (
        db.prepare('SELECT metricas FROM nucleo.trabajos_ia WHERE id = ?').get(trabajoId) as
          { metricas: string | null } | undefined
      )?.metricas ?? null
    );
  } catch {
    return null;
  }
}

const RESULTADO_FICHA = { si: 'cumple', no: 'no_cumple', dudoso: 'desconocido', no_aplica: 'no_aplica' } as const;
const ETIQUETA_TIPO: Record<(typeof TIPOS_REQUISITO)[number], string> = {
  clasificacion: 'Clasificación',
  solvencia_economica: 'Solvencia económica',
  solvencia_tecnica: 'Solvencia técnica',
  certificacion: 'Certificación',
  medios_personales: 'Medios personales',
  medios_materiales: 'Medios materiales',
  habilitacion: 'Habilitación',
  idioma: 'Idioma',
  seguro: 'Seguro de responsabilidad civil',
  otro: 'Otro requisito',
  experiencia: 'Experiencia (trabajos similares)',
  subcontratacion: 'Subcontratación',
  ute: 'UTE',
  visita: 'Visita obligatoria',
  lugar_ejecucion: 'Lugar de ejecución',
};

/** Requisitos de una ficha aprobada, con la misma forma que los evaluados por código. */
export function evaluacionesDeFicha(ficha: FichaDatosData): Evaluacion[] {
  const comprobado = new Map((ficha.verificaciones ?? []).map((v) => [v.indice, v]));
  return ficha.requisitos.map((r, i) => {
    const v = comprobado.get(i);
    return {
      origen: 'ficha',
      clase: r.tipo,
      etiqueta: ETIQUETA_TIPO[r.tipo],
      descripcion: r.descripcion,
      lote: r.lote ?? null,
      exigido: r.valor_exigido ?? null,
      resultado: RESULTADO_FICHA[r.cumple],
      excluyente: esExcluyente(r),
      motivo: r.justificacion,
      pagina: r.pagina ?? null,
      documento: r.documento ?? null,
      fuente: r.fuente ?? null,
      verificacion: v ? { regla: v.regla, resultado_ia: v.resultado_ia, detalle: v.detalle } : null,
    };
  });
}

export type Rubrica = { descripcion: string; puntos: number };

/**
 * Lo que puntúa la memoria técnica según la ficha: un apartado por criterio de juicio de
 * valor. Si solo hay uno y trae subcriterios con peso (p. ej. «Memoria técnica, 25 puntos»
 * con 8/7/6/4), los apartados son esos subcriterios.
 */
export function rubricasDeFicha(ficha: FichaDatosData): Rubrica[] {
  const juicio = ficha.criterios.filter((c) => c.tipo === 'juicio_valor');
  const subs = juicio.length === 1 ? (juicio[0]!.subcriterios ?? []) : [];
  if (subs.length >= 2 && subs.every((s) => s.peso !== undefined))
    return subs.map((s) => ({ descripcion: s.descripcion, puntos: s.peso! }));
  return juicio.map((c) => ({ descripcion: c.descripcion, puntos: c.peso }));
}

// presentacion: regla de presentación por lotes (null sin lotes); ambito: contra qué se
// evalúan los requisitos (los lotes de interés o el total).
export type GoNoGo = {
  semaforo: Semaforo;
  requisitos: Evaluacion[];
  ficha: { aprobada: FichaGuardada | null };
  perfil_empresa: boolean;
  // La empresa tiene menos de cinco años (la norma de nueva creación es la que le aplica); null sin fecha de constitución.
  nueva_creacion: boolean | null;
  presentacion: Presentacion | null;
  ambito: Ambito;
  // Para que la web avise de una ficha hecha con una versión anterior del análisis.
  version_ficha_actual: number;
};

/** Semáforo de una licitación: requisitos de la PLACSP evaluados más los de la ficha aprobada. */
export function goNoGo(
  db: Db,
  f: FilaEvaluable & { id: string },
  perfil: PerfilEmpresaData | null,
  hoy = new Date(),
): GoNoGo {
  const ficha = fichasDe(db, f.id);
  const confirmada = ficha.aprobada?.datos.presentacion_lotes;
  const { evals, lotes, todos, ambito, presentacion } = evaluarFila(
    { ...f, regla_ficha: confirmada?.regla ?? null, maximo_ficha: confirmada?.maximo_lotes ?? null },
    perfil,
    hoy,
  );
  // Lo de la ficha de otros lotes (fuera del ámbito) no cuenta, como en la PLACSP.
  const deFicha = (ficha.aprobada ? evaluacionesDeFicha(ficha.aprobada.datos) : []).filter(
    (e) => e.lote === null || lotes.includes(e.lote),
  );
  const requisitos = resolverConFicha(evals, deFicha);
  return {
    semaforo: semaforo([...requisitos, ...deFicha], lotes, todos),
    requisitos,
    ficha,
    perfil_empresa: perfil !== null,
    nueva_creacion: esNuevaCreacion(perfil, hoy),
    presentacion,
    ambito,
    version_ficha_actual: VERSION_PROMPT_FICHA,
  };
}

/**
 * El PCAP obliga a presentarse a todos los lotes y la PLACSP no lo decía: los lotes de
 * interés de la criba dejan de valer y el importe que cuenta es el total. Si el total
 * queda fuera del rango de los filtros, la oportunidad se descarta.
 */
function exigirTodosLosLotes(db: Db, id: string): boolean {
  const l = db.prepare('SELECT presentacion_lotes FROM licitaciones WHERE id = ?').get(id) as
    { presentacion_lotes: string | null } | undefined;
  if (!l || l.presentacion_lotes !== null) return false;
  return exigirTotal(db, id, 'Según la ficha de los pliegos, hay que presentarse a todos los lotes', 'ficha');
}

// Un excluyente que la empresa no cumple descarta, salvo si es de un lote y aún quedan otros lotes en
// juego sin él (como en la PLACSP).
function excluyenteQueDescarta(
  db: Db,
  id: string,
  datos: FichaDatosData,
): FichaDatosData['requisitos'][number] | undefined {
  const ambito = lotesDeLicitacion(db, id)?.ambito;
  const enJuego = ambito?.por_lotes ? ambito.lotes.map((l) => l.id) : [];
  const evals = evaluacionesDeFicha(datos).filter(
    (e) => e.lote === null || !enJuego.length || enJuego.includes(e.lote),
  );
  if (!bloqueos(evals, enJuego, datos.presentacion_lotes?.regla === 'todos_los_lotes').length) return undefined;
  return datos.requisitos.find(
    (r) =>
      esExcluyente(r) && r.cumple === 'no' && (r.lote === undefined || !enJuego.length || enJuego.includes(r.lote)),
  );
}

function alAprobar(db: Db, id: string, datos: FichaDatosData): boolean {
  // Primero se deshace el «No go» que esta ficha sustituye: así la nueva se aplica a la oportunidad
  // por decidir (un excluyente suyo puede volver a descartarla, ya con su motivo).
  if (datos.recomendacion.decision !== 'no_go') recuperarNoGo(db, id);
  const excluyente = excluyenteQueDescarta(db, id, datos);
  const porExcluyente = excluyente
    ? descartarSola(
        db,
        id,
        `Según la ficha de los pliegos, requisito excluyente que no cumplimos: ${excluyente.descripcion} (${excluyente.justificacion})`,
        'ficha',
      )
    : false;
  const porTotal = datos.presentacion_lotes?.regla === 'todos_los_lotes' ? exigirTodosLosLotes(db, id) : false;
  // Lo que ya descartó un excluyente o el total conserva ese motivo, más concreto que el «No go».
  const porNoGo =
    datos.recomendacion.decision === 'no_go'
      ? descartarTipificada(db, id, descarteNoGo(datos.recomendacion.motivo))
      : false;
  return porExcluyente || porTotal || porNoGo;
}

/** ¿Llegó una ficha después de pedirla? Es la comprobación «hecho» del trabajo. */
export function fichaRecibida(db: Db, id: string, desde: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM fichas WHERE licitacion_id = ? AND actualizada_en >= ?').get(id, desde));
}

/** Como fichaRecibida, y enlaza la ficha con el trabajo que la trajo (para sus métricas). */
export function fichaRecibidaDe(db: Db, id: string, desde: string, trabajoId: number): boolean {
  if (!fichaRecibida(db, id, desde)) return false;
  db.prepare(
    'UPDATE fichas SET trabajo_id = ? WHERE licitacion_id = ? AND actualizada_en >= ? AND trabajo_id IS NULL',
  ).run(trabajoId, id, desde);
  return true;
}

// Claves de los trabajos de ficha de una licitación, como rangos del índice único de
// trabajos_ia.clave: [x, x + siguiente carácter) es «empieza por x» y sí usa el índice.
// json_extract(payload) queda como filtro exacto sobre las pocas filas del rango.
function rangosDeClave(id: string): { manual: string; manualFin: string; auto: string; autoFin: string } {
  return { manual: `ficha-${id}-`, manualFin: `ficha-${id}.`, auto: `ficha-auto-${id}`, autoFin: `ficha-auto-${id}.` };
}

/**
 * Encola la ficha a petición de una persona; si ya hay una en cola o en marcha, devuelve esa.
 * porAgente (licitaciones_pedir): no levanta el freno del tipo, que solo quita una persona.
 */
export function pedirFicha(
  dbNucleo: DbNucleo,
  dbLic: Db,
  id: string,
  op: { porAgente?: boolean } = {},
): Result<{ trabajo: number }> {
  if (!dbLic.prepare('SELECT 1 FROM oportunidades WHERE licitacion_id = ?').get(id))
    return fail('not_found', 'Esa licitación no es una oportunidad.');
  // Sin pliegos, Hermes no tiene qué leer y el run se gastaría en vano.
  // El DEUC se baja pero no es un pliego que lea la ficha: solo con él no hay qué leer.
  if (
    !dbLic
      .prepare("SELECT 1 FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND tipo IS NOT 'deuc'")
      .get(id)
  ) {
    return fail('invalid_input', 'Aún no hay pliegos descargados de esta licitación: la ficha se lee de ellos.');
  }
  const leg = legibilidadDePliegos(dbLic, id);
  if (leg && listoParaFicha(leg) === 'ilegible') return fail('invalid_input', motivoIlegible(leg));
  // Por rango de clave (índice único) y no recorriendo payloads: las de la web son
  // «ficha-<id>-<fecha>» y las automáticas «ficha-auto-<id>[-rN]». «+estado» deja el
  // índice de estado fuera para que SQLite use los dos rangos de clave.
  const enCurso = dbNucleo
    .prepare(
      `SELECT id FROM trabajos_ia
    WHERE ((clave >= @manual AND clave < @manualFin) OR (clave >= @auto AND clave < @autoFin))
      AND tipo = @tipo AND +estado IN ('pendiente', 'lanzado') AND json_extract(payload, '$.id') = @id`,
    )
    .get({ ...rangosDeClave(id), tipo: TIPO_FICHA, id }) as { id: number } | undefined;
  if (enCurso) return ok({ trabajo: enCurso.id });
  const pedida = new Date().toISOString();
  // Base `ficha-<id>-m`: sus claves `…-m#n` caen en el rango manual de rangosDeClave.
  return ok({
    trabajo: encolarUnico(dbNucleo, {
      tipo: TIPO_FICHA,
      dominio: 'licitaciones',
      base: `ficha-${id}-m`,
      payload: { id, pedida_en: pedida },
      aMano: !op.porAgente,
    }).id,
  });
}

// Margen para que la Biblioteca lea los pliegos recién bajados antes de que Hermes los pida.
const ESPERA_PLIEGOS_MS = 2 * 60_000;

// Una ficha que falló (los 3 intentos de su trabajo) se vuelve a pedir pasada una hora, si la
// licitación sigue abierta y en nueva; como mucho tres rondas, para no gastar el
// modelo en una que falla siempre (y el freno de la cola para el tipo si fallan seguidas).
const REINTENTO_FICHA_MS = 60 * 60_000;
export const RONDAS_FICHA = 3;

// Trabajos de ficha de la licitación (alias o) cuyas claves están en [desde, hasta): por
// rango del índice único de clave (ver rangosDeClave), que corre cada minuto sobre toda la cola.
const trabajoDeFicha = (desde: string, hasta: string) => `EXISTS (SELECT 1 FROM nucleo.trabajos_ia t
  WHERE t.clave >= ${desde} AND t.clave < ${hasta} AND t.tipo = @tipo AND json_extract(t.payload, '$.id') = o.licitacion_id
    AND (t.estado IN ('pendiente', 'lanzado', 'completado') OR t.actualizado_en > @reintento))`;
const AUTO = "'ficha-auto-' || o.licitacion_id";
/** Cuántas rondas automáticas de ficha lleva la licitación (alias o): «ficha-auto-<id>» y sus «-rN». */
export const SQL_RONDAS_FICHA = `((SELECT COUNT(*) FROM nucleo.trabajos_ia t WHERE t.clave = ${AUTO})
  + (SELECT COUNT(*) FROM nucleo.trabajos_ia t WHERE t.clave >= ${AUTO} || '-r' AND t.clave < ${AUTO} || '-s'))`;
// Licitaciones cuyos pliegos no se pueden leer, ya avisadas en el log (una vez por proceso).
const avisadasIlegibles = new Set<string>();

/** Si los pliegos de una licitación ya se pueden leer para su ficha (avisa una vez de los que no). */
export function legibles(dbLic: Db): (id: string) => ListoParaFicha {
  return (id) => {
    const leg = legibilidadDePliegos(dbLic, id);
    const listo = listoParaFicha(leg);
    if (listo === 'ilegible' && !avisadasIlegibles.has(id)) {
      avisadasIlegibles.add(id);
      log.warn('ficha automática no pedida: pliegos ilegibles', { licitacion: id });
    }
    return listo;
  };
}

/**
 * Fichas automáticas: oportunidades nuevas con su PCAP y su PPT ya bajados y sin ficha (los
 * anexos no se esperan), y solo si la Biblioteca ya los indexó y se pueden leer: un PDF roto o
 * escaneado no se lee mejor por pedírselo a Hermes, y el run acabaría sin ficha.
 */
export function encolarFichasAuto(
  dbNucleo: DbNucleo,
  dbLic: Db,
  ahoraMs = Date.now(),
  legible = legibles(dbLic),
): number {
  const filas = dbLic
    .prepare(
      `SELECT o.licitacion_id AS id, ${SQL_RONDAS_FICHA} AS rondas
    FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'nueva' AND (l.fecha_limite IS NULL OR l.fecha_limite > @hoy)
      AND EXISTS (SELECT 1 FROM pliegos p WHERE p.licitacion_id = o.licitacion_id AND p.estado = 'descargado' AND p.tipo IS NOT 'deuc')
      AND NOT EXISTS (SELECT 1 FROM pliegos p WHERE p.licitacion_id = o.licitacion_id AND p.clase IN ('pcap', 'ppt') AND (p.estado = 'pendiente' OR p.actualizado_en > @pliegos))
      AND NOT EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id AND f.estado = 'aprobada')
      AND NOT ${trabajoDeFicha("'ficha-' || o.licitacion_id || '-'", "'ficha-' || o.licitacion_id || '.'")}
      AND NOT ${trabajoDeFicha(AUTO, `${AUTO} || '.'`)}`,
    )
    .all({
      hoy: horaLocalEspana(ahoraMs),
      pliegos: new Date(ahoraMs - ESPERA_PLIEGOS_MS).toISOString(),
      tipo: TIPO_FICHA,
      reintento: new Date(ahoraMs - REINTENTO_FICHA_MS).toISOString(),
    }) as { id: string; rondas: number }[];
  const pedida = new Date(ahoraMs).toISOString();
  const nuevas = filas.filter((f) => f.rondas < RONDAS_FICHA && legible(f.id) === 'listo');
  for (const f of nuevas) {
    const clave = f.rondas === 0 ? `ficha-auto-${f.id}` : `ficha-auto-${f.id}-r${f.rondas}`;
    encolar(dbNucleo, { tipo: TIPO_FICHA, dominio: 'licitaciones', clave, payload: { id: f.id, pedida_en: pedida } });
  }
  return nuevas.length;
}

export function instruccionesFicha(id: string, empresa: string, areasFormacion: readonly string[] = []): string {
  const formaciones = reglaFormacionesFicha(areasFormacion);
  return [
    `Tarea automática de la plataforma de ${empresa}: prepara la ficha de la licitación ${id} (analista de pliegos). La usa el equipo para decidir si se presenta: tiene que ser completa, citada y decir con nuestros datos si cumplimos. Sigue la skill «licitaciones» (sección «Preparar la ficha»).`,
    `1. licitaciones_ver (id=${id}): «go_no_go.requisitos» es lo que el código ya comparó con el perfil; lo que quedó «desconocido» hay que leerlo del pliego (la plataforma comprueba que la ficha lo trae). «go_no_go.ambito» dice contra qué lotes e importe se mide; si «go_no_go.presentacion.sin_confirmar» es true, busca en el PCAP a cuántos lotes se puede presentar y envíalo en «presentacion_lotes». «pliegos» dice qué documentos se pueden leer.`,
    '2. Nuestros datos: plataforma_empresa (volumen de negocio, clasificaciones, certificaciones, seguro, plantilla, idiomas, fecha de constitución y, sobre todo, «notas»: son hechos de la empresa, p. ej. «subcontrata siempre el alojamiento» decide subcontratación y UTE, «certificada en ISO 27001, sin ENS» decide certificaciones) y biblioteca_leer de «Empresa/perfil-licitaciones.md» (qué hacemos y qué tenemos). Los importes, como en importes_en_texto («186.420,35 €»): nunca los multipliques.',
    `3. Pliegos: licitaciones_pliegos (id=${id}) da los pasajes de cada tema con documento y página. NO leas los pliegos desde el principio. Si un pasaje se corta o necesitas la cláusula entera, biblioteca_leer con esa ruta y pagina_desde/pagina_hasta; lee entero, por páginas, el cuadro de características (anexo I) del PCAP.`,
    'Lee también las rectificaciones, aclaraciones y notas posteriores (licitaciones_pliegos las da): mandan sobre el pliego original; cita la nota y su página.',
    '4. Medios personales: para cada perfil exigido, colaboradores_buscar con el texto del requisito y los CPV de la licitación; di en «fuente» cuántos cumplen los mínimos.',
    `5. licitaciones_ficha (id=${id}) con todo de una vez:`,
    '   - requisitos: uno por cada cosa que el pliego exige para presentarse o ejecutar (solvencia económica y técnica, trabajos similares, clasificación, medios personales y materiales, certificaciones, habilitaciones, subcontratación, idioma, seguro, visita, lugar y presencialidad, UTE…), con tipo, descripción concreta, excluyente, valor_exigido, cumple, fuente, justificación, documento, página y lote si es solo de uno.',
    '   - cumple: «si» o «no» cuando nuestros datos lo deciden, con «fuente» (qué dato); «no_aplica» si el pliego lo pide pero no nos afecta; «dudoso» solo si falta un dato concreto (di cuál en la justificación). Castellano = si. Una certificación que no está en el perfil (y las notas dicen que no la tenemos) = no. La excepción de empresas de nueva creación solo vale si el pliego la admite: cita su página.',
    '   - nueva_creacion: si una solvencia (técnica, económica o experiencia) tiene otra norma para las empresas de nueva creación (menos de cinco años, art. 90.4 LCSP), pon esa norma en «nueva_creacion» del mismo requisito, con documento y página, y decide «cumple» con la norma que nos aplica según la fecha de constitución.',
    '   - excluyente=true solo si no cumplirlo deja fuera (solvencia mínima, clasificación exigida, habilitación, adscripción obligatoria de medios); entonces documento y página son obligatorios. El seguro de responsabilidad civil nunca es excluyente.',
    `   - cobertura: un elemento por cada tema de la lista (${TEMAS_CHECKLIST.join(', ')}): «en_requisitos», «no_lo_pide» (con documento y página donde lo dice) o «no_encontrado».`,
    `   - criterios con peso, tipo y subcriterios; documentación por sobre; hitos con fecha; garantías; penalizaciones; riesgos con gravedad; recomendación go, no_go o revisar con su motivo (no_go la pasa sola a Descartadas si sigue por decidir y nadie la movió a mano); ${formaciones ? `${formaciones} Y` : 'y'} senales_pliego si las hay (experiencia o tecnología muy específicas, marca sin «o equivalente», criterios que premian conocer ya el servicio, solvencia a medida: son indicios, no acusaciones; describe lo que pide el pliego con cita y página; para comparar, licitaciones_antecedentes da las ediciones anteriores y quién las ganó).`,
    '6. Si responde con un error, corrige exactamente lo que dice y reenvía la ficha entera. La respuesta dice qué «cumple» corrigió el código con nuestros datos: no hace falta reenviar por eso.',
    'No hagas nada más: no escribas en la Biblioteca ni en Salidas y no respondas en ningún canal.',
  ].join('\n');
}
