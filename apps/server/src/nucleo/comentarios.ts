// Comentarios con menciones: en el hilo de la oferta, en cada comprobación de la Revisión y en cada requisito.
import { z } from 'zod';
import { enviarAviso } from './avisos.js';
import { quienesQuieren } from './avisosPersona.js';
import type { Db } from './db.js';
import { emitir } from './eventos.js';
import { fail, ok, type Result } from './result.js';

// Cualquiera con acceso comenta (también un lector); mencionar es escribir «@Nombre» de una persona activa del
// equipo. Cada mención queda sin leer para esa persona (el contador de la barra lateral) y, si lo tiene
// activado, le llega por email en la siguiente vuelta de avisos, con las suyas pendientes juntas. El email no
// copia el comentario: solo quién y dónde, con el enlace (un comentario sobre el precio lo llevaría al correo).
// Cada dominio dice de qué recurso es un comentario (título y enlace) con registrarComentarios.
const ENTIDADES = ['oferta', 'bloqueo', 'requisito'] as const;
export type Entidad = (typeof ENTIDADES)[number];
const TIPO_EVENTO_COMENTARIO = 'plataforma.comentario';
export const MAX_TEXTO = 4000;

export type Autor = { id: number | null; nombre: string };
export type Comentario = {
  id: number;
  entidad: Entidad;
  entidad_id: string;
  autor: string;
  autor_id: number | null;
  texto: string;
  menciones: { id: number; nombre: string }[];
  resuelto: boolean;
  resuelto_por: string | null;
  creado_en: string;
};

// ─── De qué es cada comentario (lo pone cada dominio) ────────────────────────

/** Título corto y enlace de la web del recurso, o null si no existe. */
export type Recurso = { titulo: string; enlace: (entidad: Entidad) => string };
const recursos = new Map<string, (recurso: string) => Recurso | null>();

export function registrarComentarios(dominio: string, fn: (recurso: string) => Recurso | null): void {
  recursos.set(dominio, fn);
}

const recursoDe = (dominio: string, recurso: string): Recurso | null => recursos.get(dominio)?.(recurso) ?? null;

// ─── Validación ──────────────────────────────────────────────────────────────

const Dominio = z.string().regex(/^[a-z]{3,30}$/);
const IdRecurso = z.string().min(1).max(60);
const Donde = z.strictObject({ dominio: Dominio, recurso: IdRecurso });
const NuevoComentario = z.strictObject({
  dominio: Dominio,
  recurso: IdRecurso,
  entidad: z.enum(ENTIDADES),
  // Vacío en el hilo de la oferta; la clave de la fila o del requisito en los demás.
  entidad_id: z.string().max(200).default(''),
  texto: z
    .string()
    .trim()
    .min(1, 'Escribe el comentario.')
    .max(MAX_TEXTO, `El comentario no cabe: ${MAX_TEXTO} caracteres como mucho.`),
});
const CambioComentario = z.strictObject({ resuelto: z.boolean() });

const mensaje = (e: z.ZodError) => e.issues[0]?.message ?? 'Comentario no válido.';

// ─── Menciones ───────────────────────────────────────────────────────────────

type Persona = { id: number; nombre: string };
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ALFANUMERICO = /[\p{L}\p{N}]/u;

/**
 * Tapa en `t` cada «marca» suelta (sin letra ni cifra pegada delante ni detrás: «pepe@luis.com»
 * no es «@luis», ni «@Anabel» es «@Ana») y dice si había alguna.
 */
function taparMarca(t: string, marca: string): { t: string; hay: boolean } {
  let hay = false;
  for (let i = t.indexOf(marca); i >= 0; i = t.indexOf(marca, i + marca.length)) {
    if (ALFANUMERICO.test(t.charAt(i - 1)) || ALFANUMERICO.test(t.charAt(i + marca.length))) continue;
    t = t.slice(0, i) + ' '.repeat(marca.length) + t.slice(i + marca.length);
    hay = true;
  }
  return { t, hay };
}

/**
 * Las personas activas que el texto menciona con «@Nombre» (sin distinguir tildes ni mayúsculas),
 * sin quien escribe. Si dos nombres empiezan igual («@Ana» y «@Ana Pérez»), cuenta el más largo.
 */
export function mencionadas(texto: string, equipo: readonly Persona[], autorId: number | null): Persona[] {
  let t = sinTildes(texto);
  const out: Persona[] = [];
  for (const p of [...equipo].sort((a, b) => b.nombre.length - a.nombre.length)) {
    const r = taparMarca(t, `@${sinTildes(p.nombre)}`);
    t = r.t;
    if (r.hay && p.id !== autorId) out.push(p);
  }
  return out;
}

const equipoActivo = (db: Db): Persona[] =>
  db.prepare('SELECT id, nombre FROM usuarios WHERE activo = 1').all() as Persona[];

// ─── Leer y escribir ─────────────────────────────────────────────────────────

type Fila = Omit<Comentario, 'menciones' | 'resuelto'> & { resuelto: number; menciones: string };

function aComentario(db: Db, f: Fila): Comentario {
  const ids = JSON.parse(f.menciones) as number[];
  const nombres = new Map(
    (ids.length
      ? (db
          .prepare(`SELECT id, nombre FROM usuarios WHERE id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids) as Persona[])
      : []
    ).map((p) => [p.id, p.nombre]),
  );
  return {
    ...f,
    resuelto: f.resuelto === 1,
    menciones: ids.flatMap((id) => (nombres.has(id) ? [{ id, nombre: nombres.get(id)! }] : [])),
  };
}

const COLUMNAS =
  'id, entidad, entidad_id, autor, usuario_id AS autor_id, texto, menciones, resuelto, resuelto_por, creado_en';

/** Todos los comentarios de un recurso (una licitación), del más antiguo al más nuevo. */
export function comentariosDe(db: Db, donde: unknown): Result<{ comentarios: Comentario[] }> {
  const v = Donde.safeParse(donde);
  if (!v.success) return fail('invalid_input', 'Di de qué dominio y recurso son los comentarios.');
  const filas = db
    .prepare(`SELECT ${COLUMNAS} FROM comentarios WHERE dominio = ? AND recurso = ? ORDER BY id`)
    .all(v.data.dominio, v.data.recurso) as Fila[];
  return ok({ comentarios: filas.map((f) => aComentario(db, f)) });
}

function avisarCambio(db: Db, dominio: string, recurso: string, entidad: Entidad): void {
  emitir(db, { tipo: TIPO_EVENTO_COMENTARIO, dominio, recurso, datos: { id: recurso, entidad } });
}

export function publicarComentario(db: Db, autor: Autor, datos: unknown): Result<Comentario> {
  const v = NuevoComentario.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  const c = v.data;
  if (!recursoDe(c.dominio, c.recurso)) return fail('not_found', 'No hay nada que comentar ahí.');
  const menciones = mencionadas(c.texto, equipoActivo(db), autor.id).map((p) => p.id);
  const id = db.transaction(() => {
    const r = db
      .prepare(
        `INSERT INTO comentarios (dominio, recurso, entidad, entidad_id, usuario_id, autor, texto, menciones, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.dominio,
        c.recurso,
        c.entidad,
        c.entidad_id,
        autor.id,
        autor.nombre.slice(0, 60),
        c.texto,
        JSON.stringify(menciones),
        new Date().toISOString(),
      );
    const nuevo = Number(r.lastInsertRowid);
    const mencion = db.prepare('INSERT OR IGNORE INTO comentario_menciones (comentario_id, usuario_id) VALUES (?, ?)');
    for (const u of menciones) mencion.run(nuevo, u);
    return nuevo;
  })();
  avisarCambio(db, c.dominio, c.recurso, c.entidad);
  return ok(aComentario(db, db.prepare(`SELECT ${COLUMNAS} FROM comentarios WHERE id = ?`).get(id) as Fila));
}

/** Dar por resuelto (o reabrir): quien lo escribió o un editor. */
export function resolverComentario(
  db: Db,
  id: number,
  quien: Autor & { puedeEditar: boolean },
  datos: unknown,
): Result<Comentario> {
  const v = CambioComentario.safeParse(datos);
  if (!v.success) return fail('invalid_input', 'Di si queda resuelto (true) o abierto (false).');
  const f = db.prepare('SELECT dominio, recurso, entidad, usuario_id FROM comentarios WHERE id = ?').get(id) as
    { dominio: string; recurso: string; entidad: Entidad; usuario_id: number | null } | undefined;
  if (!f) return fail('not_found', 'Ese comentario no existe.');
  if (!quien.puedeEditar && (quien.id === null || f.usuario_id !== quien.id))
    return fail('sin_permiso', 'Solo quien lo escribió o un editor lo da por resuelto.');
  db.prepare('UPDATE comentarios SET resuelto = ?, resuelto_por = ?, resuelto_en = ? WHERE id = ?').run(
    v.data.resuelto ? 1 : 0,
    v.data.resuelto ? quien.nombre.slice(0, 60) : null,
    v.data.resuelto ? new Date().toISOString() : null,
    id,
  );
  avisarCambio(db, f.dominio, f.recurso, f.entidad);
  return ok(aComentario(db, db.prepare(`SELECT ${COLUMNAS} FROM comentarios WHERE id = ?`).get(id) as Fila));
}

// ─── Las menciones de cada persona ───────────────────────────────────────────

export type Mencion = {
  comentario: number;
  autor: string;
  texto: string;
  titulo: string;
  enlace: string;
  creado_en: string;
};
type FilaMencion = {
  comentario: number;
  autor: string;
  texto: string;
  dominio: string;
  recurso: string;
  entidad: Entidad;
  creado_en: string;
};

function aMencion(f: FilaMencion): Mencion | null {
  const r = recursoDe(f.dominio, f.recurso);
  return r
    ? {
        comentario: f.comentario,
        autor: f.autor,
        texto: f.texto,
        titulo: r.titulo,
        enlace: r.enlace(f.entidad),
        creado_en: f.creado_en,
      }
    : null;
}

const SELECT_MENCIONES = `SELECT c.id AS comentario, c.autor, c.texto, c.dominio, c.recurso, c.entidad, c.creado_en
  FROM comentario_menciones m JOIN comentarios c ON c.id = m.comentario_id`;

/** Las menciones sin leer de una persona, la más nueva primero. */
export function mencionesSinLeer(db: Db, usuarioId: number): Mencion[] {
  const filas = db
    .prepare(`${SELECT_MENCIONES} WHERE m.usuario_id = ? AND m.leida_en IS NULL ORDER BY c.id DESC LIMIT 50`)
    .all(usuarioId) as FilaMencion[];
  return filas.flatMap((f) => aMencion(f) ?? []);
}

const LeerMenciones = z.strictObject({ comentarios: z.array(z.number().int().positive()).max(200).optional() });

/** Marca como leídas las menciones de una persona: las de esos comentarios o, sin lista, todas. */
export function leerMenciones(db: Db, usuarioId: number, datos: unknown): Result<{ sin_leer: number }> {
  const v = LeerMenciones.safeParse(datos);
  if (!v.success) return fail('invalid_input', 'comentarios: lista de ids, o nada para marcarlas todas.');
  const t = new Date().toISOString();
  if (v.data.comentarios) {
    const marcar = db.prepare(
      'UPDATE comentario_menciones SET leida_en = ? WHERE usuario_id = ? AND comentario_id = ? AND leida_en IS NULL',
    );
    db.transaction(() => {
      for (const c of v.data.comentarios!) marcar.run(t, usuarioId, c);
    })();
  } else {
    db.prepare('UPDATE comentario_menciones SET leida_en = ? WHERE usuario_id = ? AND leida_en IS NULL').run(
      t,
      usuarioId,
    );
  }
  return ok({ sin_leer: mencionesSinLeer(db, usuarioId).length });
}

// ─── Email ───────────────────────────────────────────────────────────────────

/**
 * Las menciones aún sin avisar, un email por persona con todas las suyas (si lo tiene activado).
 * Las de quien no lo quiere quedan avisadas igual: activarlo después no manda las viejas.
 */
export async function avisarMenciones(db: Db): Promise<void> {
  const pendientes = db
    .prepare(
      `SELECT m.usuario_id, c.id AS comentario, c.autor, c.texto, c.dominio, c.recurso, c.entidad, c.creado_en
    FROM comentario_menciones m JOIN comentarios c ON c.id = m.comentario_id
    WHERE m.avisada_en IS NULL AND m.leida_en IS NULL ORDER BY c.id`,
    )
    .all() as (FilaMencion & { usuario_id: number })[];
  if (!pendientes.length) return;
  const quieren = new Map(quienesQuieren(db, 'menciones').map((d) => [d.id, d]));
  for (const usuario of new Set(pendientes.map((p) => p.usuario_id))) {
    const deUsuario = pendientes.filter((p) => p.usuario_id === usuario);
    const hasta = deUsuario.at(-1)!.comentario;
    const suyas = deUsuario.flatMap((p) => aMencion(p) ?? []);
    const d = quieren.get(usuario);
    if (d && suyas.length) {
      await enviarAviso(db, {
        clave: `menciones:${usuario}:${hasta}`,
        tipo: 'mencion',
        para: [d],
        plantilla: {
          asunto:
            suyas.length === 1
              ? `Hermes: ${suyas[0]!.autor} te ha mencionado`
              : `Hermes: ${suyas.length} menciones nuevas`,
          titulo: suyas.length === 1 ? `${suyas[0]!.autor} te ha mencionado` : 'Te han mencionado',
          // Sin el texto: ningún email lleva precios, y ningún filtro tapa «29 mil» ni «treinta mil».
          intro: 'Ábrelo en Hermes para leerlo y contestar en el mismo hilo.',
          bloques: [
            {
              titulo: 'Menciones',
              filas: suyas.map((m) => ({ texto: `${m.autor} en «${m.titulo}»`, enlace: m.enlace })),
            },
          ],
          boton: { texto: 'Abrir en Hermes', enlace: suyas[0]!.enlace },
        },
      });
    }
    // Hasta el último leído: lo que entre mientras sale el email se avisa en la vuelta siguiente.
    db.prepare(
      'UPDATE comentario_menciones SET avisada_en = ? WHERE usuario_id = ? AND comentario_id <= ? AND avisada_en IS NULL',
    ).run(new Date().toISOString(), usuario, hasta);
  }
}
