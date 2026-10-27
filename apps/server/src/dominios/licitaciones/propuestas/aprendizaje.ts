// Aprender de las actas de mesa: Hermes envía con licitaciones_aprendizaje la valoración criterio a criterio.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { archivoExistente, RutaDocumento, type Raices } from '../../../nucleo/salidas.js';
import type * as indice from '../../../biblioteca/motor/documentos/almacen.js';
import { abreviarOrgano, carpetasLicitaciones } from '../carpetas.js';
import { CARPETA_OFERTAS } from '../carpetasUnicas.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { textoDeDocumento, textoPlano, trozosNoLiterales } from './actas.js';
import type { EstadoRevision, RevisionData } from './revision.js';
import { personasEn } from '../oferta/libroLecciones.js';
import { leccionesDeActa } from './leccionesResultado.js';

// Hermes lee el acta (o el informe de valoración o la resolución) de una carpeta de lo presentado y la memoria
// de la empresa, y envía la valoración criterio a criterio (la de la empresa y la del ganador, con el comentario
// literal de la mesa) y lecciones concretas. Entra pendiente y una persona lo acepta o lo descarta; solo lo
// aceptado llega a la redacción de la memoria (leccionesParaApartado) y a las propuestas parecidas.
export const HERRAMIENTA_APRENDIZAJE = 'licitaciones_aprendizaje';
const RESULTADOS_ACTA = ['ganada', 'perdida', 'excluida', 'desierta', 'desconocido'] as const;
const log = logger('licitaciones');

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Puntos = z.number().finite().min(0).max(1000);

const CriterioActa = z.strictObject({
  criterio: Texto(2, 500).describe('El criterio tal como lo nombra el acta'),
  puntos_max: z.number().finite().positive().max(1000).describe('Puntos máximos del criterio'),
  nuestros: Puntos.nullable().describe('Puntos de nuestra oferta; null si el documento no los da'),
  ganador: Puntos.nullable().describe('Puntos del adjudicatario (o el mejor valorado); null si no los da'),
  comentario_mesa: z
    .string()
    .trim()
    .max(1500)
    .describe(
      'Lo que dice la mesa de NUESTRA oferta en este criterio, copiado literal del documento (tramos separados por «…»); "" si no comenta',
    ),
  pagina: z.number().int().min(1).max(5000).nullable().describe('Página del documento'),
});

const AprendizajeDatos = z.strictObject({
  resultado: z.enum(RESULTADOS_ACTA),
  ganador: Texto(2, 300).nullable().describe('Nombre del adjudicatario o el mejor valorado'),
  puntos_nuestros: Puntos.nullable().describe('Puntuación total de nuestra oferta'),
  puntos_ganador: Puntos.nullable(),
  criterios: z.array(CriterioActa).max(40),
  lecciones: z.array(Texto(10, 600)).max(10).describe('Qué puntuó y qué no, concreto, para la próxima memoria'),
});
export type AprendizajeDatosData = z.infer<typeof AprendizajeDatos>;

export const AprendizajeEntrada = z.strictObject({
  carpeta: RutaDocumento.describe(
    'Carpeta que dio la tarea: «Conocimiento/Licitaciones/Presentadas/<carpeta>» o la carpeta única «Conocimiento/Licitaciones/Ofertas/<carpeta>»',
  ),
  documento: RutaDocumento.describe('El acta, informe o resolución leído, dentro de esa carpeta'),
  ...AprendizajeDatos.shape,
});
export type AprendizajeEntradaData = z.infer<typeof AprendizajeEntrada>;

export type Aprendizaje = {
  id: number;
  carpeta: string;
  licitacion_id: string | null;
  expediente: string | null;
  organo: string | null;
  documento: string;
  datos: AprendizajeDatosData;
  avisos: string[];
  estado: EstadoRevision;
  agente: string;
  creado_en: string;
  revisado_en: string | null;
};
type Fila = Omit<Aprendizaje, 'datos' | 'avisos'> & { datos: string; avisos: string };

// La carpeta debe ser una de Presentadas o una carpeta única (Ofertas) y el documento estar dentro de ella.
function comprobarSitio(raices: Raices, e: AprendizajeEntradaData): Result<null> {
  const bases = [`Conocimiento/${carpetasLicitaciones().presentadas}/`, `Conocimiento/${CARPETA_OFERTAS}/`];
  const raiz = bases.find((r) => e.carpeta.startsWith(r));
  const nombre = raiz ? e.carpeta.slice(raiz.length) : '';
  if (!nombre || nombre.includes('/'))
    return fail(
      'invalid_input',
      `«carpeta» es la carpeta que dio la tarea: «${bases[0]}<carpeta>» o «${bases[1]}<carpeta>».`,
    );
  if (!e.documento.startsWith(`${e.carpeta}/`))
    return fail('invalid_input', 'El documento debe estar dentro de esa carpeta: envía el que dio la tarea.');
  const abs = archivoExistente(raices, e.documento);
  return abs.error ? abs : ok(null);
}

// Unos puntos imposibles no se aceptan nunca: estropearían las lecciones y las comparaciones.
function problemasDePuntos(e: AprendizajeDatosData): string[] {
  const malos = e.criterios.filter((c) => (c.nuestros ?? 0) > c.puntos_max || (c.ganador ?? 0) > c.puntos_max);
  return malos.map(
    (c) =>
      `En «${c.criterio}» los puntos (${c.nuestros ?? '-'} nuestros, ${c.ganador ?? '-'} del ganador) superan el máximo ${c.puntos_max}.`,
  );
}

type Literalidad = { problemas: string[]; avisos: string[] };

async function revisarLiteralidad(
  raices: Raices,
  e: AprendizajeEntradaData,
  idx?: indice.BaseDatos | null,
): Promise<Literalidad> {
  const conComentario = e.criterios.filter((c) => c.comentario_mesa);
  if (!conComentario.length) return { problemas: [], avisos: [] };
  const texto = await textoDeDocumento(raices, e.documento, idx);
  if (texto === null)
    return {
      problemas: [],
      avisos: [`No se pudo leer «${e.documento}» para comprobar que los comentarios de la mesa son literales.`],
    };
  const plano = textoPlano(texto);
  const problemas = conComentario.flatMap((c) => {
    const fuera = trozosNoLiterales(c.comentario_mesa, plano);
    return fuera.length
      ? [`El comentario de la mesa en «${c.criterio}» no está literal en el documento (p. ej. «${fuera[0]}»).`]
      : [];
  });
  return { problemas, avisos: [] };
}

type Identidad = { licitacion_id: string | null; expediente: string | null; organo: string | null };

// Con la carpeta creada por la plataforma se sabe la licitación; si la creó el equipo a mano,
// el nombre «AAAA-MM - expediente - órgano - tema» da expediente y órgano.
function identificar(db: Db, carpeta: string): Identidad {
  const rel = carpeta.slice('Conocimiento/'.length);
  const unica = db
    .prepare(
      `SELECT l.id, l.expediente, l.organo_nombre FROM carpetas_unicas c JOIN licitaciones l ON l.id = c.licitacion_id
    WHERE c.ruta = ?`,
    )
    .get(rel) as { id: string; expediente: string; organo_nombre: string } | undefined;
  if (unica) return { licitacion_id: unica.id, expediente: unica.expediente, organo: unica.organo_nombre };
  const l = db
    .prepare(
      `SELECT l.id, l.expediente, l.organo_nombre FROM carpetas_presentadas c JOIN licitaciones l ON l.id = c.licitacion_id
    WHERE c.ruta = ? AND c.estado = 'hecha'`,
    )
    .get(rel) as { id: string; expediente: string; organo_nombre: string } | undefined;
  if (l) return { licitacion_id: l.id, expediente: l.expediente, organo: l.organo_nombre };
  const partes = rel.split('/').pop()!.split(' - ');
  return { licitacion_id: null, expediente: partes[1]?.trim() || null, organo: partes[2]?.trim() || null };
}

type Guardado = { avisos: string[]; agente: string; tapar: ((t: string) => string) | null };

function guardar(db: Db, e: AprendizajeEntradaData, { avisos, agente, tapar }: Guardado): number {
  const { carpeta, documento, ...datos } = e;
  const id = identificar(db, carpeta);
  db.prepare(
    `INSERT INTO aprendizajes (carpeta, licitacion_id, expediente, organo, documento, datos, avisos, estado, agente, creado_en)
      VALUES (@carpeta, @licitacion_id, @expediente, @organo, @documento, @datos, @avisos, 'pendiente', @agente, @ts)
    ON CONFLICT(carpeta) DO UPDATE SET licitacion_id = excluded.licitacion_id, expediente = excluded.expediente, organo = excluded.organo,
      documento = excluded.documento, datos = excluded.datos, avisos = excluded.avisos, estado = 'pendiente', agente = excluded.agente,
      creado_en = excluded.creado_en, revisado_en = NULL`,
  ).run({
    carpeta,
    ...id,
    documento,
    datos: JSON.stringify(datos),
    avisos: JSON.stringify(avisos),
    agente,
    ts: new Date().toISOString(),
  });
  const aprendizaje = (db.prepare('SELECT id FROM aprendizajes WHERE carpeta = ?').get(carpeta) as { id: number }).id;
  leccionesDeActa(
    db,
    { id: aprendizaje, licitacion_id: id.licitacion_id, organo: id.organo, documento, datos, agente },
    tapar,
  );
  return aprendizaje;
}

// tapar: los nombres de Colaboradores; una lección que nombra a alguien se rechaza (el libro no guarda nombres).
export type OpcionesAprendizaje = {
  agente: string;
  revisar?: boolean;
  hoy?: Date;
  idx?: indice.BaseDatos | null;
  tapar?: ((t: string) => string) | null;
};

/**
 * Guarda lo que envía Hermes, pendiente de revisar. Con `revisar` (la tool) rechaza los
 * comentarios que no son literales hasta el tercer envío, que entra con aviso; unos puntos
 * por encima del máximo se rechazan siempre. Uno ya aceptado no se sustituye.
 */
export async function proponerAprendizaje(
  db: Db,
  raices: Raices,
  e: AprendizajeEntradaData,
  op: OpcionesAprendizaje,
): Promise<Result<{ aprendizaje: number; estado: 'pendiente'; avisos: string[] }>> {
  const sitio = comprobarSitio(raices, e);
  if (sitio.error) return sitio;
  const puntos = problemasDePuntos(e);
  if (puntos.length) return fail('invalid_input', `${puntos.join(' ')} Corrige y vuelve a enviarlo entero.`);
  const conNombre = e.lecciones.findIndex((l) => personasEn(l, op.tapar ?? null));
  if (conNombre >= 0)
    return fail(
      'invalid_input',
      `La lección ${conNombre + 1} nombra a una persona del equipo: las lecciones no guardan nombres. Escribe el rol y vuelve a enviarlo entero.`,
    );
  const previo = db.prepare('SELECT estado FROM aprendizajes WHERE carpeta = ?').get(e.carpeta) as
    { estado: EstadoRevision } | undefined;
  if (previo?.estado === 'aceptada')
    return fail('conflicto', 'Esa carpeta ya tiene un aprendizaje aceptado por una persona: no se sustituye.');
  const literal = await revisarLiteralidad(raices, e, op.idx);
  const exigir = op.revisar === true && exigirRevision(db, HERRAMIENTA_APRENDIZAJE, e.carpeta, op.hoy);
  if (exigir && literal.problemas.length)
    return fail(
      'invalid_input',
      `${literal.problemas.join(' ')} Copia el comentario tal cual del documento (une tramos con «…») o déjalo vacío, y vuelve a enviarlo entero.`,
    );
  const avisos = [...(exigir ? [] : literal.problemas), ...literal.avisos];
  const aprendizaje = guardar(db, e, { avisos, agente: op.agente, tapar: op.tapar ?? null });
  emitir(db, {
    tipo: 'licitacion.aprendizaje',
    dominio: 'licitaciones',
    recurso: null,
    datos: { aprendizaje, accion: 'recibido', criterios: e.criterios.length },
  });
  return ok({ aprendizaje, estado: 'pendiente', avisos });
}

function aAprendizaje(f: Fila): Aprendizaje | null {
  const datos = AprendizajeDatos.safeParse(JSON.parse(f.datos));
  if (datos.success)
    return { ...f, datos: datos.data, avisos: z.array(z.string()).catch([]).parse(JSON.parse(f.avisos)) };
  log.warn('aprendizaje guardado no válido', { aprendizaje: f.id });
  return null;
}

/** Los aprendizajes salvo los descartados (o solo los aceptados), los últimos primero. */
export function aprendizajesDe(db: Db, soloAceptados = false): Aprendizaje[] {
  const filas = db
    .prepare(
      `SELECT * FROM aprendizajes WHERE estado ${soloAceptados ? "= 'aceptada'" : "<> 'descartada'"} ORDER BY creado_en DESC, id DESC`,
    )
    .all() as Fila[];
  return filas.map(aAprendizaje).filter((x): x is Aprendizaje => x !== null);
}

/** Una persona acepta o descarta un aprendizaje. */
export function revisarAprendizaje(
  db: Db,
  id: number,
  r: RevisionData,
): Result<{ id: number; estado: EstadoRevision }> {
  if (!db.prepare('SELECT 1 FROM aprendizajes WHERE id = ?').get(id))
    return fail('not_found', `No hay ningún aprendizaje con id ${id}.`);
  const estado: EstadoRevision = r.decision === 'aceptar' ? 'aceptada' : 'descartada';
  db.prepare('UPDATE aprendizajes SET estado = ?, revisado_en = ? WHERE id = ?').run(
    estado,
    new Date().toISOString(),
    id,
  );
  // Un acta mal leída no deja lecciones por revisar.
  if (estado === 'descartada')
    db.prepare(
      "UPDATE lecciones SET estado = 'descartada', revisada_en = ? WHERE aprendizaje_id = ? AND estado = 'pendiente'",
    ).run(new Date().toISOString(), id);
  emitir(db, {
    tipo: 'licitacion.aprendizaje',
    dominio: 'licitaciones',
    recurso: null,
    datos: { aprendizaje: id, accion: 'revisado', estado },
  });
  return ok({ id, estado });
}

// ── Uso: lo que dijeron las mesas en apartados parecidos ──

const VACIAS = new Set([
  'para',
  'como',
  'sobre',
  'entre',
  'desde',
  'hasta',
  'cada',
  'todo',
  'toda',
  'todos',
  'todas',
  'otros',
  'otras',
  'este',
  'esta',
  'estos',
  'estas',
  'segun',
  'mediante',
  'durante',
  'cual',
  'cuales',
  'donde',
  'tanto',
  'sera',
  'seran',
  'valorara',
  'valoraran',
  'puntos',
  'punto',
  'criterio',
  'criterios',
  'oferta',
  'ofertas',
  'propuesta',
  'licitador',
  'licitadores',
  'contrato',
  'servicio',
  'servicios',
  'memoria',
  'tecnica',
]);

/** Palabras significativas (≥ 4 letras, sin las vacías ni las de cualquier criterio). */
export function palabrasSignificativas(t: string): Set<string> {
  return new Set(
    textoPlano(t)
      .split(' ')
      .filter((p) => p.length >= 4 && !VACIAS.has(p) && !/^\d+$/.test(p)),
  );
}

/** ¿Es el mismo órgano? Por nombre, también abreviado como en las carpetas («Ayto. Villaejemplo»). */
export function mismoOrgano(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const variantes = (x: string) => [textoPlano(x), textoPlano(abreviarOrgano(x, 300))].filter((v) => v.length >= 4);
  return variantes(a).some((x) =>
    variantes(b).some((y) => x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `)),
  );
}

type Candidata = { a: Aprendizaje; c: AprendizajeDatosData['criterios'][number]; puntos: number };

function puntuar(a: Aprendizaje, c: Candidata['c'], consulta: Set<string>, organo?: string): number {
  const propias = palabrasSignificativas(c.criterio);
  const comunes = [...propias].filter((p) => consulta.has(p)).length;
  // Una palabra suelta en común solo cuenta si es la mitad del criterio («Metodología»).
  if (comunes < 2 && !(comunes === 1 && propias.size <= 2)) return 0;
  return comunes + (mismoOrgano(organo, a.organo) ? 1 : 0);
}

function frase({ a, c }: Candidata): string {
  const donde = `En ${a.organo ?? 'otro órgano'}${a.expediente ? ` (${a.expediente})` : ''}`;
  const ganador = c.ganador !== null ? ` (ganador ${c.ganador})` : '';
  const dijo = c.comentario_mesa ? ` La mesa dijo: «${c.comentario_mesa}».` : '';
  return `${donde}, «${c.criterio}»: ${c.nuestros ?? '?'}/${c.puntos_max}${ganador}.${dijo}`;
}

/** De los aprendizajes aceptados, lo que dijo la mesa en los criterios más parecidos a un apartado. */
export function leccionesParaApartado(
  db: Db,
  consulta: { titulo: string; se_valorara: string[]; organo?: string },
  limite = 3,
): string[] {
  const palabras = palabrasSignificativas([consulta.titulo, ...consulta.se_valorara].join(' '));
  const candidatas: Candidata[] = aprendizajesDe(db, true).flatMap((a) =>
    a.datos.criterios.map((c) => ({ a, c, puntos: puntuar(a, c, palabras, consulta.organo) })),
  );
  return candidatas
    .filter((x) => x.puntos > 0)
    .sort((x, y) => y.puntos - x.puntos || y.a.creado_en.localeCompare(x.a.creado_en))
    .slice(0, limite)
    .map(frase);
}
