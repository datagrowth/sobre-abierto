// Guion de la oferta: el mapa literal de lo que pide el pliego, enviado por Hermes con licitaciones_guion.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { emitir } from '../../../nucleo/eventos.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { encolar, encolarUnico } from '../../../nucleo/trabajos.js';
import { fichasDe, rubricasDeFicha } from '../ficha.js';
import { idsDelAmbito, lotesDeLicitacion } from '../lotes.js';
import { pasajesDeLicitacion, type Pasajes } from '../pasajes.js';
import { legibilidadDePliegos, listoParaFicha, motivoIlegible, type ListoParaFicha } from '../pliegosIndice.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { diferenciasGuion, type CambiosGuion } from './guionDiff.js';
import {
  AVISO_SIN_MARCAS,
  avisoMarcasDelNombre,
  completarMarcas,
  errorDuroGuion,
  limiteEnPasajes,
  problemasDeGuion,
  type LimiteEnPliego,
} from './guionRevision.js';
import { guardaPlazo } from './plazo.js';
import { leerCambios, rebasarTrasGuion } from './rebase.js';
import { claveDeRonda, rondaQueToca } from './rondas.js';

// Recoge los archivos electrónicos y sus documentos, los apartados de la memoria con su rúbrica, los criterios
// automáticos con sus marcas, la fórmula económica y el plazo. Hermes lo lee de los pliegos; el código lo
// contrasta con la ficha aprobada y con los pasajes del pliego (guionRevision.ts). Cada envío es una versión
// nueva: vale la mayor. Convive con ficha.documentacion, que no se toca.
export const TIPO_GUION = 'licitaciones.guion';
export const VERSION_PROMPT_GUION = 4;
export const PayloadGuion = z.object({ id: z.string().min(3), pedida_en: z.string().min(10) });
const log = logger('licitaciones');

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Pagina = z.number().int().min(1).max(5000).optional().describe('Página del pliego');
const Documento = Texto(1, 500).optional().describe('Ruta o nombre del pliego');
const Puntos = z.number().min(0).max(1000);

const DocumentoArchivo = z.strictObject({
  tipo: z.enum(['memoria', 'deuc', 'declaracion', 'oferta_economica', 'acreditacion', 'otro']),
  nombre: Texto(2, 300).describe(
    'Nombre literal del pliego, p. ej. «Anexo XIII. Declaración responsable de cumplimiento»',
  ),
  obligatorio: z.boolean(),
  produce: z
    .enum(['hermes', 'persona'])
    .describe('«hermes» solo para la memoria técnica; «persona» para todo lo demás'),
  origen: z
    .strictObject({ modelo: Texto(1, 200).optional(), documento: Texto(1, 500), pagina: Pagina })
    .optional()
    .describe('Dónde está el modelo (anexo) que hay que rellenar'),
  notas: Texto(1, 1000).optional(),
  lotes: z
    .array(Texto(1, 20))
    .max(100)
    .optional()
    .describe('Lotes en los que se exige; omitido = todos los del archivo'),
});

const ArchivoElectronico = z.strictObject({
  nombre: Texto(2, 200).describe('Nombre literal, p. ej. «Archivo electrónico nº 1»'),
  contenido: Texto(3, 1000).describe('Qué va dentro, en una frase'),
  prohibiciones: z
    .array(Texto(3, 2000))
    .max(20)
    .default([])
    .describe('Lo que el pliego prohíbe meter en este archivo, literal'),
  firma: Texto(2, 300).optional(),
  documentos: z.array(DocumentoArchivo).max(30),
  documento: Documento,
  pagina: Pagina,
  ambito: z
    .enum(['comun', 'por_lote'])
    .optional()
    .describe('«por_lote» si en la sede se sube una copia por lote (memoria u oferta de cada lote)'),
  indice: z
    .boolean()
    .optional()
    .describe('true si el pliego exige un índice o relación numerada del contenido del archivo'),
});

const ApartadoGuion = z.strictObject({
  titulo: Texto(2, 300).describe('Título literal del pliego, sin numerar'),
  puntos: Puntos.describe('0 en una memoria no valorable'),
  se_valorara: z
    .array(Texto(3, 1000))
    .max(20)
    .describe(
      'Cada cosa que el pliego dice que valorará (en una memoria no valorable, que debe contener), una por elemento, literal',
    ),
  puntos_se_valorara: z
    .array(Puntos)
    .max(20)
    .optional()
    .describe('Si el pliego da puntos a cada elemento de se_valorara: sus puntos máximos, en el mismo orden'),
  escala: z
    .array(z.strictObject({ puntos: Puntos, descripcion: Texto(2, 1000) }))
    .max(10)
    .describe('Cada tramo de la escala con sus puntos y su descripción literal'),
  documento: Documento,
  pagina: Pagina,
});

const MemoriaGuion = z.strictObject({
  archivo: Texto(2, 200).describe('El archivo electrónico donde va (nombre exacto de «archivos»)'),
  titulo_documento: Texto(2, 300).describe('Cómo llama el pliego a la memoria'),
  valorable: z
    .boolean()
    .optional()
    .describe(
      'false si el pliego exige la memoria pero no la puntúa (p. ej. «memoria técnica no valorable» con un contenido mínimo): apartados con 0 puntos y sin escala',
    ),
  limite_paginas: z.number().int().min(1).max(500).nullable().describe('null solo si el pliego no fija ninguno'),
  limite_detalle: Texto(3, 500).optional(),
  formato: z
    .strictObject({
      fuente: Texto(2, 80).optional(),
      tamano_letra: z.number().min(6).max(20).optional(),
      interlineado: z.number().min(0.8).max(3).optional(),
      otros: Texto(2, 500)
        .optional()
        .describe(
          'Otras exigencias de forma, literales; si el modelo de la memoria acaba en «Lugar, fecha y firma del proponente», cítalo aquí: la plataforma pone ese cierre',
        ),
    })
    .optional(),
  apartados: z.array(ApartadoGuion).min(1).max(20).describe('En el orden del pliego'),
  advertencias: z
    .array(Texto(3, 2000))
    .max(20)
    .default([])
    .describe('Frases literales sobre cómo se valora o qué no se valora'),
  por_lote: z
    .boolean()
    .optional()
    .describe(
      'true si el pliego exige una memoria específica para cada lote («una Memoria Técnica específica para cada lote», «tantas … como lotes»)',
    ),
  documento: Documento,
  pagina: Pagina,
});

const Tramo = z.strictObject({
  descripcion: Texto(2, 500).describe('Literal del pliego: «16 horas o más adicionales»'),
  puntos: Puntos,
  valor: Texto(1, 80).optional().describe('Lo que se teclea o marca: «30», «Sí», «6 meses»'),
});
export type TramoData = z.infer<typeof Tramo>;

const Automatico = z.strictObject({
  criterio: Texto(2, 300),
  puntos: Puntos,
  como_se_acredita: Texto(3, 1000),
  casilla_en: Texto(2, 300).describe('Modelo y casilla donde se marca, p. ej. «Anexo VII, casilla 2»'),
  archivo: Texto(2, 200).describe('Archivo electrónico donde va'),
  marcas: z
    .array(Texto(2, 80))
    .max(8)
    .describe('Palabras que lo delatarían si aparecieran en la memoria, p. ej. «ISO 14001»'),
  documento: Documento,
  pagina: Pagina,
  lotes: z
    .array(Texto(1, 20))
    .max(100)
    .optional()
    .describe('Lotes donde puntúa este criterio; omitido = todos los del guion'),
  tipo: z
    .enum(['compromiso', 'acreditacion'])
    .optional()
    .describe('«compromiso» si se promete hacer algo; «acreditacion» si se demuestra algo que ya se tiene'),
  tramos: z
    .array(Tramo)
    .max(12)
    .optional()
    .describe('Tramos excluyentes, de menos a más; el último da los puntos máximos'),
  exige_documento: Texto(3, 300)
    .optional()
    .describe('Documento que el pliego exige para acreditarlo: «Dossier Técnico Homologado del fabricante»'),
  penalizacion: z
    .strictObject({ texto: Texto(3, 1000), documento: Documento, pagina: Pagina })
    .optional()
    .describe('Penalidad por incumplir lo ofertado, literal (p. ej. «2 % del gasto máximo»)'),
});
export type AutomaticoGuion = z.infer<typeof Automatico>;

const OfertaEconomica = z.strictObject({
  formula: Texto(3, 3000).describe('Literal'),
  presupuesto_base: z.number().nonnegative().nullable(),
  impuesto_aparte: z
    .enum(['IVA', 'IGIC', 'exento'])
    .nullable()
    .describe('«exento» si el pliego dice que la prestación está exenta; null si no lo dice'),
  precio_unitario: z
    .strictObject({
      unidad: Texto(1, 40).describe('Por qué se oferta el precio, en singular: «hora», «alumno»…'),
      maximo: z.number().positive().nullable().describe('Precio unitario máximo sin impuestos, si el pliego lo fija'),
    })
    .nullable()
    .optional()
    .describe('Solo si se oferta un precio por unidad (€/hora…) en vez de un importe total'),
  umbral_anormalidad: Texto(3, 2000).nullable().describe('Literal, o null si remite al art. 85 RGLCAP'),
  modelo: Texto(2, 300).nullable(),
  archivo: Texto(2, 200),
  documento: Documento,
  pagina: Pagina,
});

const PrecioUnitario = z.strictObject({
  concepto: Texto(2, 200).describe('«Edición nivel básico», «Alumno», «Informe»'),
  unidad: Texto(1, 40),
  maximo: z.number().positive().nullable(),
  cantidad: z
    .number()
    .positive()
    .nullable()
    .describe('Unidades previstas (alumnos, horas, ediciones), si el pliego las da'),
});
export type PrecioUnitarioData = z.infer<typeof PrecioUnitario>;

const OfertaEconomicaLote = OfertaEconomica.extend({
  lotes: z.array(Texto(1, 20)).max(100).describe('Lotes de esta oferta; vacío = contrato entero'),
  precios_unitarios: z
    .array(PrecioUnitario)
    .max(20)
    .default([])
    .describe('Una línea por precio unitario que se oferta'),
  umbral_baja: z
    .number()
    .min(0)
    .max(0.9)
    .nullable()
    .optional()
    .describe('Baja a partir de la cual es anormal (0,15), si el pliego la fija sobre el presupuesto o el máximo'),
  redondeo: Texto(3, 200).optional().describe('Regla de decimales o truncado, literal'),
});
export type OfertaEconomicaLoteData = z.infer<typeof OfertaEconomicaLote>;

const DocumentoAdjudicacion = z.strictObject({
  nombre: Texto(2, 300),
  modelo: Texto(2, 200).nullable(),
  documento: Texto(2, 300),
  pagina: z.number().int().min(1).nullable(),
  cuando: Texto(2, 500).describe('Literal: «antes de la formalización», «en 10 días hábiles desde el requerimiento»'),
});

// Alcance por curso o servicio: base de las horas y unidades de los compromisos con coste. Los
// números son mínimos literales del pliego; sin ellos el cálculo cae a memoria y a los valores por defecto.
const UnidadAlcance = z.strictObject({
  nombre: Texto(2, 200).describe('Nombre literal del curso o servicio'),
  personas_minimas: z.number().int().min(0).max(100000).nullable().describe('Alumnas o usuarios mínimos'),
  horas: z.number().min(0).max(100000).nullable(),
  grupos: z.number().int().min(0).max(1000).nullable(),
  semanas: z.number().min(0).max(1000).nullable(),
  lotes: z.array(Texto(1, 20)).max(100).optional().describe('Lotes a los que aplica, si no es a todos'),
  documento: Documento,
  pagina: Pagina,
});
export type UnidadAlcanceData = z.infer<typeof UnidadAlcance>;

export const GuionBase = z.strictObject({
  archivos: z.array(ArchivoElectronico).min(1).max(5).describe('Uno por archivo electrónico o sobre'),
  memoria: MemoriaGuion.nullable(),
  automaticos: z
    .array(Automatico)
    .max(30)
    .describe(
      'Criterios evaluables con fórmula o automáticamente que no son el precio; uno por criterio y conjunto de lotes',
    ),
  oferta_economica: OfertaEconomica.nullable()
    .optional()
    .describe('Guiones anteriores: una sola oferta. Usa ofertas_economicas'),
  ofertas_economicas: z
    .array(OfertaEconomicaLote)
    .max(100)
    .optional()
    .describe('Una oferta económica por lote (o una sola, con lotes vacío, si no hay lotes)'),
  plazo: z.strictObject({
    fecha_limite: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, 'fecha AAAA-MM-DD o AAAA-MM-DDTHH:MM')
      .nullable(),
    canal: Texto(2, 300),
    observaciones: Texto(2, 1000).optional(),
  }),
  lotes: z.array(Texto(1, 20)).max(100).optional().describe('Lotes a los que se refiere, si hay'),
  // Opcional con default: los guiones guardados antes de este campo siguen validando.
  documentos_adjudicacion: z
    .array(DocumentoAdjudicacion)
    .max(40)
    .default([])
    .describe('Documentos que el pliego pide solo al propuesto como adjudicatario; no van en los archivos'),
  // Opcional: los guiones guardados antes de este campo siguen validando (no sube VERSION_PROMPT_GUION).
  alcance: z
    .array(UnidadAlcance)
    .max(30)
    .optional()
    .describe(
      'Una fila por curso o servicio con el mínimo de alumnas/usuarios, horas, grupos y semanas, literal del pliego',
    ),
});
export type GuionBaseData = z.infer<typeof GuionBase>;

export const GuionEntrada = GuionBase.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación, p. ej. «p-12345678»'),
});
export type GuionEntradaData = z.infer<typeof GuionEntrada>;

export type GuionGuardado = {
  id: number;
  licitacion_id: string;
  version: number;
  ficha_id: number | null;
  creado_en: string;
  avisos: string[];
  agente: string;
  version_prompt: number;
  trabajo_id: number | null;
  datos: GuionBaseData;
  /** Qué cambió frente a la versión anterior; null si no se pudo comparar (cuenta como «cambió todo»). */
  cambios: CambiosGuion | null;
};
type FilaGuion = Omit<GuionGuardado, 'datos' | 'avisos' | 'cambios'> & {
  datos: string;
  avisos: string;
  cambios: string | null;
};

/**
 * Los lotes de interés de ahora frente a los del guion: los que no cubre (faltan) y los que
 * cubre de más (sobran). Sin lotes en el guion —licitación sin lotes o guion anterior— no hay
 * con qué comparar.
 */
export function lotesFrenteAlGuion(
  db: Db,
  g: Pick<GuionGuardado, 'licitacion_id' | 'datos'> | null,
): { faltan: string[]; sobran: string[] } {
  const delGuion = g?.datos.lotes ?? [];
  const ambito = g ? lotesDeLicitacion(db, g.licitacion_id)?.ambito : null;
  if (!delGuion.length || !ambito?.por_lotes) return { faltan: [], sobran: [] };
  const ahora = ambito.lotes.map((l) => l.id);
  return { faltan: ahora.filter((l) => !delGuion.includes(l)), sobran: delGuion.filter((l) => !ahora.includes(l)) };
}

/**
 * ¿Se extrajo el guion para otros lotes que los de interés de ahora? Solo si hay alguno que el
 * guion no cubre: quedarse con menos lotes (ir solo al 2 de un guion de 2 y 4) no obliga a
 * volver a extraerlo, que a horas del plazo ya no daría tiempo.
 */
export function guionDeOtrosLotes(db: Db, g: Pick<GuionGuardado, 'licitacion_id' | 'datos'> | null): boolean {
  return lotesFrenteAlGuion(db, g).faltan.length > 0;
}

// Un guion guardado que ya no valida no se usa; el log lleva las rutas de zod, nunca el contenido.
function aGuardado(f: FilaGuion | undefined): GuionGuardado | null {
  if (!f) return null;
  const datos = GuionBase.safeParse(JSON.parse(f.datos));
  if (!datos.success) {
    log.warn('guion guardado no válido', {
      guion: f.id,
      campos: datos.error.issues
        .map((i) => i.path.join('.'))
        .slice(0, 10)
        .join(','),
    });
    return null;
  }
  // Los guardados antes de completar marcas por código las ganan al leerlos, y su aviso sobra.
  const completo = completarMarcas(datos.data);
  const conMarcas = completo.automaticos.every((a) => a.marcas.length > 0);
  const avisos = (JSON.parse(f.avisos) as string[]).filter((a) => !(conMarcas && a.startsWith(AVISO_SIN_MARCAS)));
  return { ...f, avisos, datos: completo, cambios: leerCambios(f.cambios) };
}

/** El guion vigente de una licitación: la versión mayor. */
export function guionVigente(db: Db, id: string): GuionGuardado | null {
  return aGuardado(
    db.prepare('SELECT * FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1').get(id) as
      FilaGuion | undefined,
  );
}

export function guionPorId(db: Db, guionId: number): GuionGuardado | null {
  return aGuardado(db.prepare('SELECT * FROM guiones WHERE id = ?').get(guionId) as FilaGuion | undefined);
}

type BuscarPasajes = (id: string) => Promise<Result<Pasajes>>;
export type OpcionesGuion = { revisar?: boolean; hoy?: Date; pasajes?: BuscarPasajes };
export type GuionRecibido = { guion: number; version: number; sustituye: boolean; apartados: number; avisos: string[] };

const pasajesDelGuion =
  (db: Db): BuscarPasajes =>
  (id) =>
    pasajesDeLicitacion(db, id, { temas: ['criterios_adjudicacion', 'sobres_documentacion'], maxPorTema: 6 });

// Solo hace falta buscar el límite si la memoria viene sin él. Si los pasajes no se pueden
// leer, no se rechaza por eso: queda un aviso.
async function limiteDelPliego(
  g: GuionBaseData,
  id: string,
  buscar: BuscarPasajes,
): Promise<{ limite: LimiteEnPliego | null; aviso: string | null }> {
  if (!g.memoria || g.memoria.limite_paginas !== null || g.memoria.limite_detalle) return { limite: null, aviso: null };
  const r = await buscar(id);
  if (r.error)
    return {
      limite: null,
      aviso: `No se pudo comprobar en el pliego si fija un límite de páginas (${r.error.message}): la memoria va sin límite.`,
    };
  return { limite: limiteEnPasajes(r.data.temas.flatMap((t) => t.pasajes)), aviso: null };
}

// Los datos de la versión anterior; si ya no validan, no se puede comparar (cambios null).
function datosDeVersion(db: Db, id: string, version: number): GuionBaseData | null | undefined {
  const f = db.prepare('SELECT datos FROM guiones WHERE licitacion_id = ? AND version = ?').get(id, version) as
    { datos: string } | undefined;
  if (!f) return undefined;
  const r = GuionBase.safeParse(JSON.parse(f.datos));
  return r.success ? r.data : null;
}

type Guardado = { guion: number; version: number; sustituye: boolean; cambios: CambiosGuion | null };

function guardarGuion(
  db: Db,
  e: { id: string; datos: GuionBaseData; avisos: string[]; agente: string; fichaId: number | null },
): Guardado {
  return db.transaction(() => {
    const ultimo = db
      .prepare('SELECT id, version FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1')
      .get(e.id) as { id: number; version: number } | undefined;
    const previa = ultimo?.version ?? 0;
    const anterior = previa > 0 ? datosDeVersion(db, e.id, previa) : undefined;
    const cambios = anterior === null ? null : diferenciasGuion(anterior ?? null, e.datos);
    const guion = Number(
      db
        .prepare(
          `INSERT INTO guiones (licitacion_id, version, ficha_id, datos, avisos, agente, version_prompt, creado_en, cambios)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          e.id,
          previa + 1,
          e.fichaId,
          JSON.stringify(e.datos),
          JSON.stringify(e.avisos),
          e.agente,
          VERSION_PROMPT_GUION,
          new Date().toISOString(),
          cambios ? JSON.stringify(cambios) : null,
        ).lastInsertRowid,
    );
    // En la misma transacción: un rebase que falla no deja el guion nuevo con lo hecho en el anterior.
    if (ultimo) rebasarTrasGuion(db, e.id, ultimo.id, guion, cambios);
    return { guion, version: previa + 1, sustituye: previa > 0, cambios };
  })();
}

/** Revisa y guarda el guion como versión nueva. Con `revisar` (la tool) rechaza lo que falte hasta el tercer envío. */
export async function proponerGuion(
  db: Db,
  entrada: GuionEntradaData,
  agente: string,
  op: OpcionesGuion = {},
): Promise<Result<GuionRecibido>> {
  const { id, ...enviados } = entrada;
  const datos = completarMarcas(enviados);
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const duro = errorDuroGuion(datos);
  if (duro) return fail('invalid_input', duro);
  const ficha = fichasDe(db, id).aprobada;
  const { limite, aviso } = await limiteDelPliego(datos, id, op.pasajes ?? pasajesDelGuion(db));
  const problemas = problemasDeGuion(datos, { rubricas: ficha ? rubricasDeFicha(ficha.datos) : null, limite });
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_guion', id, op.hoy);
  if (exigir && problemas.length)
    return fail('invalid_input', `${problemas.join(' ')} Corrige y vuelve a enviar el guion entero.`);
  const deNombre = avisoMarcasDelNombre(enviados, datos);
  const avisos = [...(exigir ? [] : problemas), ...(aviso ? [aviso] : []), ...(deNombre ? [deNombre] : [])];
  // El rebase va dentro: quien escucha el aviso (la propuesta automática) ya ve las decisiones rebasadas.
  const { cambios, ...r } = guardarGuion(db, { id, datos, avisos, agente, fichaId: ficha?.id ?? null });
  const apartados = datos.memoria?.apartados.length ?? 0;
  emitir(db, {
    tipo: 'licitacion.guion',
    dominio: 'licitaciones',
    recurso: id,
    datos: {
      accion: 'guion',
      version: r.version,
      apartados,
      avisos: avisos.length,
      cambios_vacio: cambios?.vacio ?? false,
    },
  });
  return ok({ ...r, apartados, avisos });
}

// Vive en rebase.ts, que no puede importar este módulo; se reexporta para sus consumidores.
export { cambiosEntre } from './rebase.js';

/** ¿Llegó un guion después de pedirlo? Enlaza el guion con el trabajo que lo trajo. */
export function guionRecibidoDe(db: Db, id: string, desde: string, trabajoId: number): boolean {
  if (!db.prepare('SELECT 1 FROM guiones WHERE licitacion_id = ? AND creado_en >= ?').get(id, desde)) return false;
  db.prepare('UPDATE guiones SET trabajo_id = ? WHERE licitacion_id = ? AND creado_en >= ? AND trabajo_id IS NULL').run(
    trabajoId,
    id,
    desde,
  );
  return true;
}

function trabajoGuionEnCurso(dbNucleo: DbNucleo, id: string): number | null {
  const t = dbNucleo
    .prepare(
      `SELECT id FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(TIPO_GUION, id) as { id: number } | undefined;
  return t?.id ?? null;
}

/** ¿Se pueden leer ya los pliegos para el guion? null si sí; si no, por qué. */
export function pliegosSinLeer(dbLic: Db, id: string): string | null {
  if (
    !dbLic
      .prepare("SELECT 1 FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND tipo IS NOT 'deuc'")
      .get(id)
  ) {
    return 'Aún no hay pliegos descargados de esta licitación: el guion se lee de ellos.';
  }
  const leg = legibilidadDePliegos(dbLic, id);
  const listo = listoParaFicha(leg);
  if (listo === 'ilegible' && leg) return motivoIlegible(leg);
  return listo === 'esperar' ? 'Los pliegos aún no están en el índice de la Biblioteca: prueba en unos minutos.' : null;
}

/**
 * Encola el guion a petición de una persona; exige plazo (con poco margen, que lo confirme),
 * ficha aprobada y pliegos legibles. Si ya hay uno en curso, devuelve ese. porAgente
 * (licitaciones_pedir): no levanta el freno del tipo, que solo quita una persona.
 */
export function pedirGuion(
  dbNucleo: DbNucleo,
  dbLic: Db,
  id: string,
  op: { confirmado?: boolean; porAgente?: boolean } = {},
): Result<{ trabajo: number }> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const plazo = guardaPlazo(dbLic, id, 'guion', { aMano: true, confirmado: op.confirmado });
  if (plazo.error) return plazo;
  if (!fichasDe(dbLic, id).aprobada)
    return fail(
      'invalid_input',
      'Esta licitación aún no tiene ficha: el guion se contrasta con sus criterios. Pídela primero.',
    );
  const sinLeer = pliegosSinLeer(dbLic, id);
  if (sinLeer) return fail('invalid_input', sinLeer);
  const enCurso = trabajoGuionEnCurso(dbNucleo, id);
  if (enCurso !== null) return ok({ trabajo: enCurso });
  const pedida = new Date().toISOString();
  return ok({
    trabajo: encolarUnico(dbNucleo, {
      tipo: TIPO_GUION,
      dominio: 'licitaciones',
      base: `guion-${id}`,
      payload: { id, pedida_en: pedida },
      aMano: !op.porAgente,
    }).id,
  });
}

// Modelos que rellenar, el DEUC, las rectificaciones y las aclaraciones: cambian lo que hay que presentar.
export const DOCUMENTO_CLAVE = /anexo|modelo|deuc|rectifica|aclara/i;

/**
 * Desde cuándo trabajaba el run que produjo un guardado (una ficha o un guion): un pliego bajado
 * mientras el run trabajaba no lo vio aunque el run guardara después. Es el run_vivo_desde del
 * trabajo: el lanzamiento del run más antiguo que podía seguir vivo, no su pedida_en (un trabajo
 * relanzado o reintentado conserva el payload, y con pedida_en los pliegos bajados entre la
 * petición y un relanzamiento tras un run que acabó contaban como no vistos y el guion se volvía
 * a pedir). Ni el último lanzado_en: un run parado sin confirmación (relanzado, inactivo) aún
 * puede guardar después de que se lance el siguiente. Si es posterior al guardado, o el trabajo
 * es de antes de la columna, pedida_en, que es anterior a todos. Sin trabajo enlazado, cuando se guardó.
 */
export function pedidaEnDe(db: Db, trabajoId: number | null, guardado: string): string {
  const fila =
    trabajoId === null
      ? undefined
      : (db
          .prepare(
            "SELECT json_extract(payload, '$.pedida_en') AS pedida, run_vivo_desde AS vivo FROM nucleo.trabajos_ia WHERE id = ?",
          )
          .get(trabajoId) as { pedida: string | null; vivo: string | null } | undefined);
  const desde = fila?.vivo && fila.vivo <= guardado ? fila.vivo : fila?.pedida;
  return desde && desde < guardado ? desde : guardado;
}

/** Los documentos clave bajados (o ZIP descomprimidos) después de `desde`: lo que la ficha o el guion de esa fecha no leyeron. */
export function pliegosClaveDesde(db: Db, id: string, desde: string, clave: RegExp = DOCUMENTO_CLAVE): string[] {
  const filas = db
    .prepare(
      `SELECT nombre FROM pliegos WHERE licitacion_id = ? AND estado IN ('descargado', 'descomprimido') AND actualizado_en > ?
    ORDER BY actualizado_en`,
    )
    .all(id, desde) as { nombre: string }[];
  return [...new Set(filas.map((f) => f.nombre).filter((n) => clave.test(n)))];
}

// lotes: huella de los lotes del ámbito («2+4»), o null si se mide con el contrato entero;
// pliegos: cuántos documentos clave llegaron después del guion vigente (0 si ninguno) y guionId,
// el de ese guion: la cuenta vuelve a 0 con cada guion nuevo, así que sola repetiría la clave de
// un documento tardío anterior y el guion no se pediría;
// prompt: se pide otra vez porque se extrajo con un prompt anterior al de las ofertas por lote.
type Candidata = {
  id: string;
  ficha: number;
  lotes: string | null;
  pliegos: number;
  guionId: number | null;
  prompt: boolean;
};

// Un guion de antes de las ofertas por lote con varios lotes trae una sola oferta económica y
// los automáticos de un lote: se vuelve a pedir una vez.
function anteriorConVariosLotes(g: GuionGuardado | null, lotes: string | null): boolean {
  return g !== null && g.version_prompt < VERSION_PROMPT_GUION && (lotes?.includes('+') ?? false);
}

/** Huella de los lotes del ámbito («2+4») para las claves de los trabajos automáticos; null si se mide con el contrato entero. */
export function huellaDeLotes(dbLic: Db, id: string): string | null {
  const a = lotesDeLicitacion(dbLic, id)?.ambito;
  return a?.por_lotes ? idsDelAmbito(a).sort().join('+') : null;
}

// En preparación y en plazo, con ficha aprobada más nueva que la de su guion, sin guion, con
// un guion de otros lotes que los de interés de ahora (una persona los cambió) o con un modelo,
// el DEUC o una rectificación bajados después del guion (Hermes no los leyó) o con uno extraído
// con un prompt anterior al de las ofertas por lote yendo a varios lotes.
function candidatasGuionAuto(dbLic: Db, ahoraMs: number): Candidata[] {
  const filas = dbLic
    .prepare(
      `SELECT o.licitacion_id AS id,
      (SELECT MAX(g.ficha_id) FROM guiones g WHERE g.licitacion_id = o.licitacion_id) AS guion_ficha,
      (SELECT COUNT(*) FROM guiones g WHERE g.licitacion_id = o.licitacion_id) AS guiones
    FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'en_preparacion' AND l.borrada_en IS NULL AND (l.fecha_limite IS NULL OR l.fecha_limite > ?)`,
    )
    .all(horaLocalEspana(ahoraMs)) as { id: string; guion_ficha: number | null; guiones: number }[];
  return filas.flatMap((f) => {
    const ficha = fichasDe(dbLic, f.id).aprobada?.id;
    if (ficha === undefined) return [];
    const alDia = f.guiones > 0 && (f.guion_ficha ?? 0) >= ficha;
    const g = guionVigente(dbLic, f.id);
    const lotes = huellaDeLotes(dbLic, f.id);
    const pliegos = g ? pliegosClaveDesde(dbLic, f.id, pedidaEnDe(dbLic, g.trabajo_id, g.creado_en)).length : 0;
    const prompt = alDia && anteriorConVariosLotes(g, lotes);
    if (alDia && !guionDeOtrosLotes(dbLic, g) && !pliegos && !prompt) return [];
    return [{ id: f.id, ficha, lotes, pliegos, guionId: g?.id ?? null, prompt }];
  });
}

export type OpcionesGuionesAuto = { legible?: (id: string) => ListoParaFicha; esperaFicha?: (id: string) => boolean };

/**
 * Guiones automáticos: al pasar a «En preparación», al llegar una ficha nueva, al cambiar
 * los lotes de interés o al bajarse un documento clave después del guion se pide el guion, una
 * vez por ficha, lotes y documentos nuevos (clave «guion-auto-<id>-f<ficha>[-l<lotes>][-p<n>-g<guion>]»),
 * y una vez más si el vigente se extrajo con un prompt anterior y va a varios lotes (sufijo
 * «-v<versión>»; «-p» ya cuenta documentos); si falla, se vuelve a pedir por rondas (rondas.ts) y, agotadas, ya no hasta otra ficha, otros
 * lotes u otro documento. Solo con los pliegos ya legibles, si da tiempo antes del plazo y si
 * no hay que esperar a una ficha nueva (`esperaFicha`, cadena.ts): un guion pedido con la ficha
 * que se está rehaciendo habría que pedirlo otra vez en cuanto llegue.
 */
export function encolarGuionesAuto(
  dbNucleo: DbNucleo,
  dbLic: Db,
  ahoraMs = Date.now(),
  op: OpcionesGuionesAuto = {},
): number {
  const legible = op.legible ?? ((id: string) => listoParaFicha(legibilidadDePliegos(dbLic, id)));
  const pedida = new Date(ahoraMs).toISOString();
  let n = 0;
  for (const c of candidatasGuionAuto(dbLic, ahoraMs)) {
    const base = `guion-auto-${c.id}-f${c.ficha}${c.lotes ? `-l${c.lotes}` : ''}${c.pliegos ? `-p${c.pliegos}-g${c.guionId}` : ''}${c.prompt ? `-v${VERSION_PROMPT_GUION}` : ''}`;
    const ronda = rondaQueToca(dbNucleo, base, ahoraMs);
    if (ronda === null || trabajoGuionEnCurso(dbNucleo, c.id) !== null || op.esperaFicha?.(c.id)) continue;
    if (legible(c.id) !== 'listo' || guardaPlazo(dbLic, c.id, 'guion', { ahoraMs }).error) continue;
    encolar(dbNucleo, {
      tipo: TIPO_GUION,
      dominio: 'licitaciones',
      clave: claveDeRonda(base, ronda),
      payload: { id: c.id, pedida_en: pedida },
    });
    if (ronda > 0) log.info('guion automático pedido otra vez tras fallar', { licitacion: c.id, ronda });
    n += 1;
  }
  return n;
}

export function instruccionesGuion(id: string, empresa: string): string {
  return [
    `Tarea de la plataforma de ${empresa}: prepara el guion de la oferta de la licitación ${id} (analista de pliegos). Es el mapa de lo que hay que entregar y de cómo se puntúa: lo lee el equipo para decidir equipo, mejoras y precio, y la plataforma redacta la memoria técnica con él, siguiendo sus apartados. Todo literal del pliego, con documento y página. Sigue la skill «licitaciones» (sección «Guion de la oferta»).`,
    `1. licitaciones_ver (id=${id}): «go_no_go.ficha.aprobada.datos.criterios» son los criterios que leyó la ficha (los de juicio de valor son los apartados de la memoria: el guion debe traer los mismos, con los mismos puntos; si no hay ninguno pero el pliego exige igualmente una memoria técnica —«no valorable», con un contenido mínimo—, va con valorable = false, un apartado por cada bloque de contenido que exige, 0 puntos, sin escala y en se_valorara lo que debe contener, literal); «pliegos» dice qué documentos se leen y su ruta; «go_no_go.ambito» dice a qué lotes vamos.`,
    `2. licitaciones_pliegos (id=${id}, temas=[criterios_adjudicacion, sobres_documentacion, garantias, plazos_hitos], max_por_tema=6): localiza la cláusula de criterios de adjudicación, la de contenido de los sobres o archivos electrónicos y el plazo y canal de presentación. NO leas los pliegos desde el principio.`,
    '3. Lee enteras, por páginas, con biblioteca_leer (pagina_desde/pagina_hasta, hasta 15 páginas por llamada): (a) la cláusula de criterios de adjudicación completa, incluida la escala de puntuación de cada apartado de la memoria y las frases sobre qué se valora y qué no; (b) la cláusula de contenido de cada archivo electrónico o sobre, con lo que está prohibido meter en cada uno; (c) el cuadro de características (anexo I) del PCAP. Si hay un documento de anexos o modelos (los .doc llegan convertidos), léelo para saber qué modelo es cada anexo y en cuál se marcan los criterios automáticos.',
    `4. licitaciones_guion (id=${id}) con todo de una vez: archivos (uno por archivo electrónico o sobre, nombre literal, contenido, prohibiciones literales, firma, documentos con tipo/nombre literal/obligatorio/produce «hermes» solo para la memoria técnica y «persona» para el resto/origen con modelo, documento y página); memoria (null solo si el pliego no pide ninguna; archivo, cómo la llama el pliego, valorable = false si no se puntúa, limite_paginas —null solo si el pliego no fija ninguno—, limite_detalle, formato si el pliego lo fija, apartados en el orden del pliego con título literal, puntos, se_valorara —cada cosa que el pliego dice que valorará, una por elemento, literal—, puntos_se_valorara —si el pliego da puntos a cada una, en el mismo orden—, escala —cada tramo con puntos y descripción literal—, documento y página; advertencias literales sobre cómo se valora; por_lote true si el pliego pide una memoria por lote); automaticos (cada criterio evaluable con fórmula o automáticamente que no sea el precio, con puntos, cómo se acredita, modelo y casilla, archivo y sus marcas: palabras que solo saldrían al hablar de ese criterio, como «ISO 14001» o «tutores adicionales»; nunca cifras sueltas como «30 horas», frases que diría cualquier mejora como «sin coste adicional» ni nada que el pliego pida tratar en la memoria; un criterio con tramos excluyentes —1-3 años o más de 3— es uno solo, con sus puntos máximos y sus tramos literales de menos a más con puntos y el valor que se teclea; lotes si no puntúa en todos, tipo —compromiso o acreditacion—, exige_documento si el pliego exige un documento para acreditarlo y penalizacion literal si la hay); ofertas_economicas (UNA POR LOTE, para todos los lotes del ámbito y no solo el primero, o una sola con lotes vacío si no hay lotes: lotes, fórmula literal, presupuesto base del lote, impuesto aparte —«exento» si el pliego dice que la prestación está exenta—, precios_unitarios con una línea por precio que se oferta por unidad —concepto, unidad, máximo y cantidad prevista—, umbral de anormalidad literal o null si remite al art. 85 RGLCAP, umbral_baja si el pliego la fija, redondeo literal, modelo y archivo; no uses oferta_economica); en los archivos, ambito «por_lote» si se sube una copia por lote e indice si el pliego exige una relación numerada del contenido; plazo (fecha límite y canal; no comentes si ya ha pasado: la plataforma lo calcula).`,
    '5. documentos_adjudicacion: los que el pliego pide solo al propuesto como adjudicatario (protección de datos, confidencialidad, garantía definitiva…), literal y con documento y página; no los metas en archivos.',
    '6. La plataforma comprueba que los apartados casan con los criterios de juicio de valor de la ficha (mismo número y mismos puntos; sin ninguno, que la memoria vaya como no valorable y sin puntos), que si un archivo trae un documento de tipo memoria el guion trae «memoria», que cada apartado cita documento y página, que cada archivo trae al menos un documento, que la memoria lleva límite si el pliego lo fija, que los archivos citados existen, que los puntos de «se valorará» suman los del apartado, que ninguna marca es genérica ni sale en lo que se valora en la memoria, que cada lote tiene su oferta económica y que una fórmula que puntúa un precio por unidad trae precios_unitarios. Si responde con un error, corrige exactamente lo que dice y reenvía el guion entero. Tras dos rechazos se acepta con avisos.',
    '5b. alcance: una fila por curso o servicio con el número mínimo de alumnas/usuarios, horas, grupos y semanas, literal del pliego con documento y página (null en lo que el pliego no fije).',
    'No hagas nada más: no escribas en la Biblioteca ni en Salidas y no respondas en ningún canal.',
  ].join('\n');
}
