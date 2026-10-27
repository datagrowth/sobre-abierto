// Colaboradores: personas del equipo y externas con lo que pueden acreditar en una licitación.
import { z } from 'zod';
import { ahora, type Db } from '../db.js';
import { emitir } from '../eventos.js';
import { logger } from '../log.js';
import { fail, ok, type Result } from '../result.js';
import { pararRunDe } from '../colaTipos.js';
import { normalizar } from './texto.js';
import { CARPETA_COLABORADORES, hashCv, TIPO_PERFIL_CV } from './cvs.js';

// Acreditan titulaciones, certificaciones, experiencia e idiomas. Viven en el núcleo porque las usarán otros
// dominios. Son datos personales: nunca van a los logs, y los eventos y la auditoría solo llevan el id.
export const TIPOS_PERSONA = ['interno', 'externo'] as const;
const NIVELES_IDIOMA = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'nativo'] as const;

const Lista = (max: number, largo: number) => z.array(z.string().trim().min(1).max(largo)).max(max);

// El CV vive en la Biblioteca, dentro de Colaboradores/: ni rutas absolutas ni «..».
// Tampoco «\» ni «:»: en Windows son separador y unidad, y sacarían la ruta de la carpeta.
// eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se rechaza
const PROHIBIDOS = /[\\:\u0000-\u001f\u007f]/;
export const RutaCv = z
  .string()
  .trim()
  .min(16)
  .max(500)
  .refine(
    (r) =>
      r.startsWith(`${CARPETA_COLABORADORES}/`) &&
      !PROHIBIDOS.test(r) &&
      !r.split('/').some((p) => p === '..' || p.startsWith('.') || p === ''),
    `el CV debe estar dentro de ${CARPETA_COLABORADORES}/`,
  )
  .describe('Ruta del CV en la Biblioteca, p. ej. «Colaboradores/cv-ana.pdf»');

const Idioma = z.strictObject({
  idioma: z.string().trim().min(2).max(40),
  nivel: z.enum(NIVELES_IDIOMA).nullable().describe('Marco europeo (A1–C2) o nativo; null si el CV no lo dice'),
});

// Horas impartidas en una materia: lo que más piden los pliegos de formación («150 h impartidas en
// IA en los 3 últimos años»). Los años son los del periodo en que se impartieron; la evidencia dice
// dónde consta («CV, pág. 2», «certificado de la universidad»).
const Anio = z.number().int().min(1950).max(2100);
const Docencia = z
  .strictObject({
    materia: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe('Materia impartida, p. ej. «inteligencia artificial», «Power BI»'),
    horas: z.number().int().min(1).max(100_000).describe('Horas impartidas en esa materia'),
    desde: Anio.nullable().default(null).describe('Año en que empezó a impartirla; null si el CV no lo dice'),
    hasta: Anio.nullable().default(null).describe('Último año en que la impartió; null si el CV no lo dice'),
    evidencia: z.string().trim().max(200).nullable().default(null).describe('Dónde consta, p. ej. «CV, pág. 2»'),
  })
  .refine((d) => d.desde === null || d.hasta === null || d.desde <= d.hasta, {
    message: 'docencia: «desde» no puede ser posterior a «hasta»',
    path: ['desde'],
  });

// Perfil de LinkedIn: solo el público (linkedin.com/in/<id>), guardado siempre igual
// (https://www.linkedin.com/in/<id>) venga con o sin https, www, subdominio de país o «?…».
function normalizarLinkedin(url: string): string {
  const id = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(
    url.trim(),
  )?.[1];
  return id ? `https://www.linkedin.com/in/${id}` : url.trim();
}

const LinkedIn = z
  .string()
  .trim()
  .max(300)
  .transform(normalizarLinkedin)
  .pipe(
    z
      .string()
      .regex(
        /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9\-_%]{2,100}$/,
        'LinkedIn: la dirección del perfil, https://www.linkedin.com/in/…',
      ),
  );

// Lo que se puede leer de un CV. Sin datos de contacto ni DNI (no hacen falta para casar
// requisitos y así no se guardan), salvo el perfil de LinkedIn, que es profesional.
export const PerfilProfesional = z.strictObject({
  nombre: z.string().trim().min(2).max(120),
  tipo: z.enum(TIPOS_PERSONA),
  rol: z
    .string()
    .trim()
    .max(120)
    .default('')
    .describe('Puesto o perfil, p. ej. «Jefe de proyecto» o «Científica de datos»'),
  titulaciones: Lista(20, 200)
    .default([])
    .describe('Títulos académicos, p. ej. «Grado en Ingeniería Informática», «Máster en Big Data»'),
  certificaciones: Lista(50, 120)
    .default([])
    .describe('Certificaciones profesionales, p. ej. «PMP», «AWS Solutions Architect»'),
  anios_experiencia: z
    .number()
    .int()
    .min(0)
    .max(60)
    .nullable()
    .default(null)
    .describe('Años de experiencia profesional'),
  sectores: Lista(30, 80).default([]).describe('Sectores con experiencia, p. ej. «sanidad», «administración pública»'),
  cpv: z
    .array(z.string().regex(/^\d{2,8}$/, 'CPV: de 2 a 8 cifras'))
    .max(50)
    .default([])
    .describe('Prefijos CPV de los proyectos en los que ha trabajado'),
  tecnologias: Lista(80, 80).default([]).describe('Tecnologías y habilidades, p. ej. «Python», «Power BI», «Scrum»'),
  idiomas: z.array(Idioma).max(15).default([]),
  docencia: z.array(Docencia).max(40).default([]).describe('Horas de docencia por materia, con su periodo y evidencia'),
  linkedin: LinkedIn.nullable()
    .default(null)
    .describe('Perfil de LinkedIn (https://www.linkedin.com/in/…), si el CV lo trae'),
});

// La disponibilidad ya no se declara: se calcula con las ofertas y los contratos de la persona
// (disponibilidad.ts). Las fichas guardadas antes la traen y se ignora.
function sinDisponibilidadDeclarada(x: unknown): unknown {
  if (!x || typeof x !== 'object' || !('disponibilidad' in x)) return x;
  const { disponibilidad: _declarada, ...resto } = x as Record<string, unknown>;
  return resto;
}

const PersonaBase = PerfilProfesional.extend({
  tarifa_hora: z.number().finite().nonnegative().max(10_000).nullable().default(null).describe('€/hora, opcional'),
  cv_ruta: RutaCv.nullable().default(null),
  notas: z.string().max(5000).default(''),
  activo: z.boolean().default(true),
});
export const Persona = z.preprocess(sinDisponibilidadDeclarada, PersonaBase);
export type PersonaEntrada = z.input<typeof PersonaBase>;
export type PersonaData = z.infer<typeof Persona>;
export type PersonaGuardada = PersonaData & { id: number; creada_en: string; actualizada_en: string };

type Fila = { id: number; datos: string; creada_en: string; actualizada_en: string };

const log = logger('colaboradores');

// Una fila que ya no valida (p. ej. tras endurecer el esquema) no se muestra; el aviso
// lleva el id y las rutas de zod, nunca los datos de la persona.
function aGuardada(f: Fila | undefined): PersonaGuardada | null {
  if (!f) return null;
  const datos = Persona.safeParse(JSON.parse(f.datos));
  if (datos.success) return { ...datos.data, id: f.id, creada_en: f.creada_en, actualizada_en: f.actualizada_en };
  log.warn('persona guardada no válida', {
    persona: f.id,
    campos: datos.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

export const FiltroPersonas = z.object({
  tipo: z.enum(TIPOS_PERSONA).optional(),
  texto: z.string().trim().max(100).optional(),
  inactivos: z.boolean().default(false),
});
export type FiltroPersonasData = z.infer<typeof FiltroPersonas>;

function casaTexto(p: PersonaGuardada, texto: string): boolean {
  const pajar = normalizar(
    [p.nombre, p.rol, ...p.titulaciones, ...p.certificaciones, ...p.tecnologias, ...p.sectores].join(' | '),
  );
  return normalizar(texto)
    .split(' ')
    .every((t) => pajar.includes(t));
}

/** Personas por nombre; por defecto solo las activas. Son decenas o cientos: se filtra en JS. */
export function listarPersonas(db: Db, filtro: FiltroPersonasData = { inactivos: false }): PersonaGuardada[] {
  const filas = db
    .prepare('SELECT id, datos, creada_en, actualizada_en FROM personas ORDER BY nombre COLLATE NOCASE, id')
    .all() as Fila[];
  return filas
    .map(aGuardada)
    .filter((p): p is PersonaGuardada => p !== null)
    .filter(
      (p) =>
        (filtro.inactivos || p.activo) &&
        (!filtro.tipo || p.tipo === filtro.tipo) &&
        (!filtro.texto || casaTexto(p, filtro.texto)),
    );
}

export function obtenerPersona(db: Db, id: number): Result<PersonaGuardada> {
  const p = aGuardada(
    db.prepare('SELECT id, datos, creada_en, actualizada_en FROM personas WHERE id = ?').get(id) as Fila | undefined,
  );
  return p ? ok(p) : fail('not_found', `No hay ningún colaborador con id ${id}.`);
}

function avisar(db: Db, id: number, accion: 'alta' | 'cambio' | 'baja'): void {
  emitir(db, { tipo: 'colaboradores.persona', dominio: 'colaboradores', recurso: String(id), datos: { accion } });
}

/** Alta de una persona (a mano en la web o al aprobar un perfil leído de un CV). */
export function crearPersona(db: Db, entrada: unknown): Result<PersonaGuardada> {
  const p = Persona.safeParse(entrada);
  if (!p.success) return fail('invalid_input', z.prettifyError(p.error));
  const ts = ahora();
  const id = Number(
    db
      .prepare(
        'INSERT INTO personas (nombre, tipo, activo, cv_ruta, datos, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(p.data.nombre, p.data.tipo, p.data.activo ? 1 : 0, p.data.cv_ruta, JSON.stringify(p.data), ts, ts)
      .lastInsertRowid,
  );
  avisar(db, id, 'alta');
  return obtenerPersona(db, id);
}

/** Sustituye la ficha entera de una persona. */
export function actualizarPersona(db: Db, id: number, entrada: unknown): Result<PersonaGuardada> {
  const p = Persona.safeParse(entrada);
  if (!p.success) return fail('invalid_input', z.prettifyError(p.error));
  const cambio = db
    .prepare(
      'UPDATE personas SET nombre = ?, tipo = ?, activo = ?, cv_ruta = ?, datos = ?, actualizada_en = ? WHERE id = ?',
    )
    .run(p.data.nombre, p.data.tipo, p.data.activo ? 1 : 0, p.data.cv_ruta, JSON.stringify(p.data), ahora(), id);
  if (cambio.changes === 0) return fail('not_found', `No hay ningún colaborador con id ${id}.`);
  avisar(db, id, 'cambio');
  return obtenerPersona(db, id);
}

function rutasCvDe(db: Db, id: number): string[] {
  const filas = db
    .prepare(
      `SELECT cv_ruta FROM personas WHERE id = ? AND cv_ruta IS NOT NULL
    UNION SELECT cv_ruta FROM personas_propuestas WHERE persona_id = ?`,
    )
    .all(id, id) as { cv_ruta: string }[];
  return filas.map((f) => f.cv_ruta);
}

// Lo que queda de un CV en los trabajos de lectura de una persona borrada: solo su hash.
function rutaSuprimida(cvRuta: string): string {
  return `${CARPETA_COLABORADORES}/${hashCv(cvRuta)}`;
}

// Los perfiles rechazados antes del alta no tienen persona_id, pero son del mismo CV.
// Los trabajos de lectura de ese CV se quedan sin su ruta y sin su error (puede citar el CV);
// los que esperaban o estaban en marcha se cancelan. Devuelve los runs en marcha, que hay que
// parar en Hermes: si no, volverían a proponer el perfil de la persona borrada.
function borrarRastroDeCvs(db: Db, id: number, rutas: string[]): string[] {
  db.prepare('DELETE FROM personas_propuestas WHERE persona_id = ?').run(id);
  const runs: string[] = [];
  for (const ruta of rutas) {
    db.prepare('DELETE FROM personas_propuestas WHERE cv_ruta = ? AND persona_id IS NULL').run(ruta);
    const enMarcha = db
      .prepare(
        `SELECT run_id FROM trabajos_ia WHERE tipo = ? AND estado = 'lanzado' AND run_id IS NOT NULL
      AND json_extract(payload, '$.cv_ruta') = ?`,
      )
      .all(TIPO_PERFIL_CV, ruta) as { run_id: string }[];
    runs.push(...enMarcha.map((r) => r.run_id));
    db.prepare(
      `UPDATE trabajos_ia SET estado = CASE WHEN estado IN ('pendiente', 'lanzado') THEN 'cancelado' ELSE estado END,
      payload = json_set(payload, '$.cv_ruta', ?), error = NULL, actualizado_en = ?
      WHERE tipo = ? AND json_extract(payload, '$.cv_ruta') = ?`,
    ).run(rutaSuprimida(ruta), ahora(), TIPO_PERFIL_CV, ruta);
  }
  return runs;
}

/**
 * Borra a la persona y lo que la plataforma guarda de ella (derecho de supresión): sus
 * perfiles propuestos y la ruta de su CV en los trabajos de lectura, que se cancelan (y su
 * run se para en Hermes). El CV sigue en la Biblioteca: es un archivo de Drive y se borra allí.
 */
export function borrarPersona(db: Db, id: number): Result<{ id: number }> {
  const { borrada, runs } = db.transaction(() => {
    const runs = borrarRastroDeCvs(db, id, rutasCvDe(db, id));
    db.prepare('UPDATE perfiles_a_incorporar SET candidato_id = NULL WHERE candidato_id = ?').run(id);
    return { borrada: db.prepare('DELETE FROM personas WHERE id = ?').run(id).changes, runs };
  })();
  for (const run of runs) pararRunDe(TIPO_PERFIL_CV, run);
  if (borrada === 0) return fail('not_found', `No hay ningún colaborador con id ${id}.`);
  avisar(db, id, 'baja');
  return ok({ id });
}

/**
 * ¿La última lectura pedida de este CV era de una persona ya borrada? Un perfil que llegue
 * entonces es de un run que no se pudo parar: se rechaza hasta que alguien vuelva a pedir la
 * lectura desde la web.
 */
export function cvSuprimido(db: Db, cvRuta: string): boolean {
  const ultima = db
    .prepare(
      `SELECT json_extract(payload, '$.cv_ruta') AS ruta FROM trabajos_ia WHERE tipo = ?
    AND json_extract(payload, '$.cv_ruta') IN (?, ?) ORDER BY id DESC LIMIT 1`,
    )
    .get(TIPO_PERFIL_CV, cvRuta, rutaSuprimida(cvRuta)) as { ruta: string } | undefined;
  return ultima?.ruta === rutaSuprimida(cvRuta);
}

export function personaPorCv(db: Db, cvRuta: string): number | null {
  const f = db.prepare('SELECT id FROM personas WHERE cv_ruta = ? ORDER BY id LIMIT 1').get(cvRuta) as
    { id: number } | undefined;
  return f?.id ?? null;
}
