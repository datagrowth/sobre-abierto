// Búsquedas guardadas: la búsqueda y los filtros de Oportunidades como alerta, diaria o semanal, de cada persona.
import { z } from 'zod';
import { fail, ok, type Result } from '../../nucleo/result.js';
import type * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { FiltroRevision, listaRevision, type ItemRevision } from './revision.js';
import type { Db } from './store.js';

// Le llegan las nuevas que la cumplen (el envío es de avisos.ts). Nadie ve ni cambia las de otro. La consulta se
// guarda con la forma de GET /revision y se resuelve con la misma lista, así que «nuevas» es lo mismo que vería
// en Por revisar con esos filtros.
const FRECUENCIAS = ['diaria', 'semanal'] as const;
type Frecuencia = (typeof FRECUENCIAS)[number];

// Lo que se puede guardar de GET /revision: todo menos la pestaña y la página (las nuevas son de Por revisar).
const CLAVES = [
  'texto',
  'pliegos',
  'opinion',
  'comunidad',
  'importe_min',
  'importe_max',
  'cpv',
  'palabras',
  'excluir',
  'tipos',
  'idiomas',
] as const;
const Consulta = z
  .partialRecord(z.enum(CLAVES), z.string().max(2000))
  .refine((c) => FiltroRevision.safeParse({ ...c, pestana: 'por_revisar' }).success, {
    message: 'La búsqueda tiene filtros que no valen.',
  });

const Nombre = z.string().trim().min(2, 'Ponle un nombre a la búsqueda.').max(80);
const AltaBusqueda = z.strictObject({
  nombre: Nombre,
  consulta: Consulta,
  frecuencia: z.enum(FRECUENCIAS).default('semanal'),
});
const CambioBusqueda = z.strictObject({
  nombre: Nombre.optional(),
  frecuencia: z.enum(FRECUENCIAS).optional(),
  activa: z.boolean().optional(),
});

export type BusquedaGuardada = {
  id: number;
  nombre: string;
  consulta: Record<string, string>;
  frecuencia: Frecuencia;
  activa: boolean;
  avisada_hasta: string | null;
  creada_en: string;
};
type Fila = Omit<BusquedaGuardada, 'consulta' | 'activa'> & { consulta: string; activa: number; usuario_id: number };

const aBusqueda = (f: Fila): BusquedaGuardada => ({
  id: f.id,
  nombre: f.nombre,
  consulta: JSON.parse(f.consulta) as Record<string, string>,
  frecuencia: f.frecuencia,
  activa: f.activa === 1,
  avisada_hasta: f.avisada_hasta,
  creada_en: f.creada_en,
});
const mensaje = (e: z.ZodError) => e.issues[0]?.message ?? 'Datos no válidos.';
const NO_ESTA = 'Esa búsqueda no está entre las tuyas.';

export function busquedasDe(db: Db, usuarioId: number): BusquedaGuardada[] {
  return (
    db.prepare('SELECT * FROM busquedas_guardadas WHERE usuario_id = ? ORDER BY id').all(usuarioId) as Fila[]
  ).map(aBusqueda);
}

function suya(db: Db, usuarioId: number, id: number): Fila | null {
  return (
    (db.prepare('SELECT * FROM busquedas_guardadas WHERE id = ? AND usuario_id = ?').get(id, usuarioId) as
      Fila | undefined) ?? null
  );
}

export function guardarBusqueda(db: Db, usuarioId: number, datos: unknown): Result<BusquedaGuardada> {
  const v = AltaBusqueda.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  const t = new Date().toISOString();
  // Desde ahora: lo que ya estaba al guardarla no es «nuevo».
  const r = db
    .prepare(
      'INSERT INTO busquedas_guardadas (usuario_id, nombre, consulta, frecuencia, avisada_hasta, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(usuarioId, v.data.nombre, JSON.stringify(v.data.consulta), v.data.frecuencia, t, t, t);
  return ok(aBusqueda(suya(db, usuarioId, Number(r.lastInsertRowid))!));
}

export function cambiarBusqueda(db: Db, usuarioId: number, id: number, datos: unknown): Result<BusquedaGuardada> {
  const v = CambioBusqueda.safeParse(datos);
  if (!v.success) return fail('invalid_input', mensaje(v.error));
  const f = suya(db, usuarioId, id);
  if (!f) return fail('not_found', NO_ESTA);
  db.prepare(
    'UPDATE busquedas_guardadas SET nombre = ?, frecuencia = ?, activa = ?, actualizada_en = ? WHERE id = ?',
  ).run(
    v.data.nombre ?? f.nombre,
    v.data.frecuencia ?? f.frecuencia,
    (v.data.activa ?? f.activa === 1) ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  return ok(aBusqueda(suya(db, usuarioId, id)!));
}

export function borrarBusqueda(db: Db, usuarioId: number, id: number): Result<{ id: number }> {
  return db.prepare('DELETE FROM busquedas_guardadas WHERE id = ? AND usuario_id = ?').run(id, usuarioId).changes
    ? ok({ id })
    : fail('not_found', NO_ESTA);
}

/** Hasta cuándo se avisó de unas búsquedas (las nuevas del siguiente aviso son las de después). */
export function marcarAvisadas(db: Db, ids: readonly number[], hasta: string): void {
  const up = db.prepare('UPDATE busquedas_guardadas SET avisada_hasta = ? WHERE id = ?');
  for (const id of ids) up.run(hasta, id);
}

export type Nuevas = { total: number; items: ItemRevision[] };

/** Las que entraron en Por revisar desde `desde` (ISO) y cumplen la búsqueda, por fecha de cierre. */
export function nuevasDeBusqueda(
  db: Db,
  b: Pick<BusquedaGuardada, 'consulta'>,
  desde: string,
  ahoraMs = Date.now(),
  idx: indice.BaseDatos | null = null,
): Nuevas {
  const f = FiltroRevision.parse({ ...b.consulta, pestana: 'por_revisar', limite: 100, creada_desde: desde });
  const r = listaRevision(db, f, ahoraMs, idx);
  return { total: r.total, items: r.items };
}

/** Cuántas trae cada búsqueda de una persona en los últimos `dias` (la lista de Ajustes › Avisos). */
export function busquedasConNuevas(
  db: Db,
  usuarioId: number,
  dias: number,
  ahoraMs = Date.now(),
): (BusquedaGuardada & { nuevas: number })[] {
  const desde = new Date(ahoraMs - dias * 86_400_000).toISOString();
  return busquedasDe(db, usuarioId).map((b) => ({ ...b, nuevas: nuevasDeBusqueda(db, b, desde, ahoraMs).total }));
}
