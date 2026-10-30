// Perfiles a incorporar: lo que una oferta se comprometió a incorporar sin nombrar a nadie.
import { z } from 'zod';
import { ahora, type Db } from '../db.js';
import { emitir } from '../eventos.js';
import { logger } from '../log.js';
import { errorMessage, fail, ok, type Result } from '../result.js';
import { obtenerPersona } from './personas.js';

// Por ejemplo «docente de IA a incorporar», cuando el pliego deja comprometer el perfil y acreditarlo tras la
// propuesta de adjudicación. Los guarda el dominio de la oferta al decidirlo; aquí se ven todos con la fecha
// límite para acreditarlo y quién podría cubrirlo.
export const ESTADOS_INCORPORAR = ['pendiente', 'cubierto', 'retirado'] as const;
type EstadoIncorporar = (typeof ESTADOS_INCORPORAR)[number];

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');

const PerfilAIncorporar = z.strictObject({
  dominio: Texto(2, 40),
  recurso: Texto(1, 120).describe('La oferta que lo comprometió (en Licitaciones, el id de la licitación)'),
  clave: Texto(1, 200).describe('El mismo perfil de la misma oferta tiene siempre la misma clave (rol y lote)'),
  perfil: Texto(2, 200).describe('«Docente de IA generativa · lote 1»'),
  lote: Texto(1, 20).nullable().default(null),
  requisitos: Texto(3, 2000).describe('Lo que pide el pliego al perfil, tal cual'),
  expediente: Texto(1, 120),
  titulo: Texto(1, 300),
  acreditar_antes: Fecha.nullable().default(null).describe('Fecha estimada en la que hay que acreditarlo'),
  plazo: Texto(2, 300)
    .nullable()
    .default(null)
    .describe('Cómo lo dice el pliego: «10 días hábiles desde el requerimiento»'),
  cita: z
    .strictObject({ documento: Texto(1, 200), pagina: z.number().int().positive().nullable(), texto: Texto(1, 600) })
    .nullable()
    .default(null),
});
type PerfilAIncorporarData = z.infer<typeof PerfilAIncorporar>;
export type PerfilGuardado = PerfilAIncorporarData & {
  id: number;
  estado: EstadoIncorporar;
  candidato_id: number | null;
  creado_en: string;
  actualizado_en: string;
};

type Fila = {
  id: number;
  estado: EstadoIncorporar;
  candidato_id: number | null;
  datos: string;
  creado_en: string;
  actualizado_en: string;
};

function aGuardado(f: Fila | undefined): PerfilGuardado | null {
  if (!f) return null;
  const d = PerfilAIncorporar.safeParse(JSON.parse(f.datos));
  return d.success
    ? {
        ...d.data,
        id: f.id,
        estado: f.estado,
        candidato_id: f.candidato_id,
        creado_en: f.creado_en,
        actualizado_en: f.actualizado_en,
      }
    : null;
}

function avisar(db: Db, id: number, estado: EstadoIncorporar): void {
  emitir(db, { tipo: 'colaboradores.incorporar', dominio: 'colaboradores', recurso: String(id), datos: { estado } });
}

function obtenerPerfilAIncorporar(db: Db, id: number): Result<PerfilGuardado> {
  const p = aGuardado(db.prepare('SELECT * FROM perfiles_a_incorporar WHERE id = ?').get(id) as Fila | undefined);
  return p ? ok(p) : fail('not_found', `No hay ningún perfil a incorporar con id ${id}.`);
}

/** Guarda (o actualiza) el perfil comprometido. Si estaba retirado, vuelve a pendiente; si no, conserva su estado y candidato. */
export function guardarPerfilAIncorporar(db: Db, entrada: unknown): Result<PerfilGuardado> {
  const p = PerfilAIncorporar.safeParse(entrada);
  if (!p.success) return fail('invalid_input', z.prettifyError(p.error));
  const { dominio, recurso, clave } = p.data;
  const ts = ahora();
  db.prepare(
    `INSERT INTO perfiles_a_incorporar (dominio, recurso, clave, estado, candidato_id, datos, creado_en, actualizado_en)
    VALUES (?, ?, ?, 'pendiente', NULL, ?, ?, ?)
    ON CONFLICT (dominio, recurso, clave) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en,
      estado = CASE WHEN estado = 'retirado' THEN 'pendiente' ELSE estado END`,
  ).run(dominio, recurso, clave, JSON.stringify(p.data), ts, ts);
  const f = db
    .prepare('SELECT * FROM perfiles_a_incorporar WHERE dominio = ? AND recurso = ? AND clave = ?')
    .get(dominio, recurso, clave) as Fila;
  avisar(db, f.id, f.estado);
  return obtenerPerfilAIncorporar(db, f.id);
}

/** La oferta ya no compromete esos perfiles (se nombró a alguien o cambió el lote): los que no siguen se retiran. */
export function retirarPerfilesAIncorporar(db: Db, dominio: string, recurso: string, vigentes: string[]): number {
  const filas = db
    .prepare("SELECT id, clave FROM perfiles_a_incorporar WHERE dominio = ? AND recurso = ? AND estado != 'retirado'")
    .all(dominio, recurso) as { id: number; clave: string }[];
  const fuera = filas.filter((f) => !vigentes.includes(f.clave));
  for (const f of fuera) {
    db.prepare("UPDATE perfiles_a_incorporar SET estado = 'retirado', actualizado_en = ? WHERE id = ?").run(
      ahora(),
      f.id,
    );
    avisar(db, f.id, 'retirado');
  }
  return fuera.length;
}

// Cada dominio dice si la oferta de un perfil sigue (en Licitaciones: en preparación, presentada o
// ganada, y no retirada de la PLACSP). Un perfil de una oferta descartada, perdida o retirada no se
// va a acreditar nunca: se retira al listarlos. Sin vigencia registrada, el perfil sigue.
type Vigencia = (recurso: string) => boolean;
const vigencias = new Map<string, Vigencia>();
const log = logger('colaboradores');

export function registrarVigenciaIncorporar(dominio: string, fn: Vigencia): void {
  vigencias.set(dominio, fn);
}

function sigue(dominio: string, recurso: string): boolean {
  const fn = vigencias.get(dominio);
  if (!fn) return true;
  try {
    return fn(recurso);
  } catch (err) {
    log.warn('vigencia de un perfil a incorporar sin leer', { dominio, error: errorMessage(err).slice(0, 200) });
    return true;
  }
}

/** Retira los perfiles cuya oferta ya no sigue. Devuelve cuántos. */
function retirarDeOfertasCerradas(db: Db): number {
  const filas = db
    .prepare("SELECT id, dominio, recurso FROM perfiles_a_incorporar WHERE estado != 'retirado'")
    .all() as { id: number; dominio: string; recurso: string }[];
  const fuera = filas.filter((f) => !sigue(f.dominio, f.recurso));
  for (const f of fuera) {
    db.prepare("UPDATE perfiles_a_incorporar SET estado = 'retirado', actualizado_en = ? WHERE id = ?").run(
      ahora(),
      f.id,
    );
    avisar(db, f.id, 'retirado');
  }
  return fuera.length;
}

/** Los vigentes (pendientes y cubiertos), con la fecha de acreditación más cercana primero; o los de un recurso. */
export function listarPerfilesAIncorporar(db: Db, de?: { dominio: string; recurso: string }): PerfilGuardado[] {
  retirarDeOfertasCerradas(db);
  const filas = (
    de
      ? db
          .prepare(
            "SELECT * FROM perfiles_a_incorporar WHERE dominio = ? AND recurso = ? AND estado != 'retirado' ORDER BY id",
          )
          .all(de.dominio, de.recurso)
      : db.prepare("SELECT * FROM perfiles_a_incorporar WHERE estado != 'retirado' ORDER BY id").all()
  ) as Fila[];
  return filas
    .map(aGuardado)
    .filter((p): p is PerfilGuardado => p !== null)
    .sort(
      (a, b) =>
        Number(a.estado === 'cubierto') - Number(b.estado === 'cubierto') ||
        (a.acreditar_antes ?? '9999').localeCompare(b.acreditar_antes ?? '9999'),
    );
}

export const CambioPerfil = z.strictObject({
  candidato_id: z.number().int().positive().nullable().optional().describe('Quien podría cubrirlo; null lo quita'),
  estado: z.enum(['pendiente', 'cubierto']).optional().describe('cubierto: ya hay alguien contratado o acreditado'),
});
export type CambioPerfilData = z.infer<typeof CambioPerfil>;

/** Una persona apunta el candidato o da el perfil por cubierto. */
export function cambiarPerfilAIncorporar(db: Db, id: number, cambio: CambioPerfilData): Result<PerfilGuardado> {
  const previo = obtenerPerfilAIncorporar(db, id);
  if (previo.error) return previo;
  if (previo.data.estado === 'retirado') return fail('conflicto', 'La oferta ya no compromete este perfil.');
  if (cambio.candidato_id && obtenerPersona(db, cambio.candidato_id).error)
    return fail('not_found', `No hay ningún colaborador con id ${cambio.candidato_id}.`);
  const candidato = cambio.candidato_id === undefined ? previo.data.candidato_id : cambio.candidato_id;
  const estado = cambio.estado ?? previo.data.estado;
  db.prepare('UPDATE perfiles_a_incorporar SET candidato_id = ?, estado = ?, actualizado_en = ? WHERE id = ?').run(
    candidato,
    estado,
    ahora(),
    id,
  );
  avisar(db, id, estado);
  return obtenerPerfilAIncorporar(db, id);
}
