// Pantalla Aprendizaje: pendientes de una persona, libro de lecciones, comparaciones con la presentada y su efecto.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { TIPOS_CONTRATO, nombreDe } from '../placsp/codigos.js';
import { aprendizajesDe } from '../propuestas/aprendizaje.js';
import { actasQueFaltan, type ActaQueFalta } from '../propuestas/actasQueFaltan.js';
import type { Db } from '../store.js';
import { comparacionesDe, type Comparacion, type PreguntaPorque } from './comparacionMemoria.js';
import { ALCANCES, leccionesDonde, type Leccion } from './libroLecciones.js';
import { TEMAS_APARTADO } from './temasApartado.js';

// Lo que espera a una persona son las lecciones por revisar, el porqué de los cambios más grandes de una
// presentada y las actas que faltan. El efecto son los puntos de la mesa frente al ganador, oferta a oferta,
// con cuándo se aceptaron lecciones. Con pocas ofertas al año es una tendencia, no una prueba, y así lo dice.
type Licitacion = { id: string; titulo: string; organo_nombre: string; cpvs: string; tipo_contrato: string | null };
// Lo que puede ser su alcance, con el valor de su licitación: así «Ajustar el alcance» no hace teclear.
type OpcionesAlcance = {
  organo: string | null;
  cpv: string | null;
  tipo_contrato: string | null;
  tipo_contrato_nombre: string | null;
};
type Uso = {
  aplicaciones: number;
  ofertas: number;
  cumplidas: number;
  comprobadas: number;
  nota_critico: number | null;
};
type TarjetaLeccion = Leccion & {
  titulo_licitacion: string | null;
  opciones_alcance: OpcionesAlcance;
  uso: Uso;
};

function licitaciones(db: Db, ids: (string | null)[]): Map<string, Licitacion> {
  const unicos = [...new Set(ids.filter((x): x is string => x !== null))];
  if (!unicos.length) return new Map();
  const filas = db
    .prepare(
      `SELECT id, titulo, organo_nombre, cpvs, tipo_contrato FROM licitaciones WHERE id IN (${unicos.map(() => '?').join(', ')})`,
    )
    .all(...unicos) as Licitacion[];
  return new Map(filas.map((l) => [l.id, l]));
}

const opcionesDe = (l: Licitacion | undefined): OpcionesAlcance => ({
  organo: l?.organo_nombre ?? null,
  cpv: l?.cpvs.split(',').find(Boolean)?.slice(0, 4) ?? null,
  tipo_contrato: l?.tipo_contrato ?? null,
  tipo_contrato_nombre: nombreDe(TIPOS_CONTRATO, l?.tipo_contrato ?? null),
});

// La nota del crítico en los apartados donde se aplicó, en % del máximo del tramo (la última ronda).
function usoDe(db: Db, leccionId: number): Uso {
  const u = db
    .prepare(
      `SELECT COUNT(*) AS aplicaciones, COUNT(DISTINCT m.licitacion_id) AS ofertas,
      SUM(CASE WHEN a.cumplida = 1 THEN 1 ELSE 0 END) AS cumplidas, SUM(CASE WHEN a.cumplida IS NOT NULL THEN 1 ELSE 0 END) AS comprobadas
    FROM lecciones_aplicaciones a JOIN memorias m ON m.id = a.memoria_id WHERE a.leccion_id = ?`,
    )
    .get(leccionId) as Omit<Uso, 'nota_critico'>;
  const notas = db
    .prepare(
      `SELECT r.puntos, r.tramo FROM lecciones_aplicaciones a JOIN memoria_apartado_rondas r ON r.memoria_id = a.memoria_id AND r.apartado = a.apartado
    WHERE a.leccion_id = ? AND r.ronda = (SELECT MAX(x.ronda) FROM memoria_apartado_rondas x WHERE x.memoria_id = a.memoria_id AND x.apartado = a.apartado)`,
    )
    .all(leccionId) as { puntos: number; tramo: number }[];
  const conMaximo = notas.filter((n) => n.tramo > 0);
  const nota = conMaximo.length
    ? Math.round((100 * conMaximo.reduce((s, n) => s + n.puntos / n.tramo, 0)) / conMaximo.length)
    : null;
  return {
    aplicaciones: u.aplicaciones,
    ofertas: u.ofertas,
    cumplidas: u.cumplidas ?? 0,
    comprobadas: u.comprobadas ?? 0,
    nota_critico: nota,
  };
}

function tarjetas(db: Db, ls: Leccion[]): TarjetaLeccion[] {
  const lics = licitaciones(
    db,
    ls.map((l) => l.licitacion_id),
  );
  return ls.map((l) => {
    const lic = l.licitacion_id ? lics.get(l.licitacion_id) : undefined;
    return { ...l, titulo_licitacion: lic?.titulo ?? null, opciones_alcance: opcionesDe(lic), uso: usoDe(db, l.id) };
  });
}

// ── Por revisar ──

type PorqueAbierto = PreguntaPorque & {
  comparacion: number;
  licitacion_id: string;
  titulo: string | null;
  antes: string | null;
  despues: string | null;
};

function porquesAbiertos(db: Db, comparaciones: Comparacion[]): PorqueAbierto[] {
  const lics = licitaciones(
    db,
    comparaciones.map((c) => c.licitacion_id),
  );
  return comparaciones.flatMap((c) =>
    c.preguntas
      .filter((p) => p.respuesta === null)
      .map((p) => {
        const k = c.cambios.find((x) => x.n === p.n);
        return {
          ...p,
          comparacion: c.id,
          licitacion_id: c.licitacion_id,
          titulo: lics.get(c.licitacion_id)?.titulo ?? null,
          antes: k?.antes ?? null,
          despues: k?.despues ?? null,
        };
      }),
  );
}

// ── Efecto ──

type PuntoEfecto = {
  licitacion_id: string | null;
  titulo: string;
  fecha: string;
  pct: number;
  lecciones_aceptadas: number;
  nuevas_lecciones: boolean;
};
type Efecto = {
  ofertas: PuntoEfecto[];
  trimestres: { trimestre: string; ganadas: number; perdidas: number; tasa: number }[];
  nota: string;
};

const NOTA_EFECTO =
  'Es una tendencia, no una prueba: con pocas ofertas al año, una mesa distinta o un competidor nuevo mueven más que una lección.';

function pctFrenteAlGanador(d: ReturnType<typeof aprendizajesDe>[number]['datos']): number | null {
  const con = d.criterios.filter((c) => c.nuestros !== null && c.ganador !== null);
  const nuestros = con.length ? con.reduce((s, c) => s + c.nuestros!, 0) : d.puntos_nuestros;
  const ganador = con.length ? con.reduce((s, c) => s + c.ganador!, 0) : d.puntos_ganador;
  return nuestros !== null && ganador ? Math.round((100 * nuestros) / ganador) : null;
}

function efectoDe(db: Db): Efecto {
  const aceptadas = (
    db
      .prepare("SELECT revisada_en FROM lecciones WHERE estado IN ('aceptada', 'retirada') AND revisada_en IS NOT NULL")
      .all() as { revisada_en: string }[]
  ).map((x) => x.revisada_en);
  const presentada = db.prepare('SELECT MIN(presentada_en) AS f FROM propuestas WHERE licitacion_id = ?');
  const puntos = aprendizajesDe(db)
    .flatMap((a) => {
      const pct = pctFrenteAlGanador(a.datos);
      const fecha =
        (a.licitacion_id ? (presentada.get(a.licitacion_id) as { f: string | null }).f : null) ?? a.creado_en;
      return pct === null
        ? []
        : [
            {
              licitacion_id: a.licitacion_id,
              titulo: a.expediente ?? a.organo ?? a.carpeta.split('/').at(-1)!,
              fecha,
              pct,
            },
          ];
    })
    .sort((x, y) => x.fecha.localeCompare(y.fecha));
  let antes = 0;
  const ofertas = puntos.map((p) => {
    const n = aceptadas.filter((f) => f <= p.fecha).length;
    const nuevas = n > antes;
    antes = n;
    return { ...p, lecciones_aceptadas: n, nuevas_lecciones: nuevas };
  });
  const filas = db
    .prepare(
      `SELECT substr(resuelta_en, 1, 4) || '-T' || ((CAST(substr(resuelta_en, 6, 2) AS INTEGER) + 2) / 3) AS trimestre,
      SUM(resultado = 'ganada') AS ganadas, SUM(resultado = 'perdida') AS perdidas
    FROM propuestas WHERE resultado IN ('ganada', 'perdida') AND resuelta_en IS NOT NULL GROUP BY trimestre ORDER BY trimestre`,
    )
    .all() as { trimestre: string; ganadas: number; perdidas: number }[];
  return {
    ofertas,
    trimestres: filas.map((f) => ({ ...f, tasa: Math.round((100 * f.ganadas) / (f.ganadas + f.perdidas)) })),
    nota: NOTA_EFECTO,
  };
}

// ── Todo junto ──

export type Aprendizaje = {
  por_revisar: { lecciones: TarjetaLeccion[]; porques: PorqueAbierto[]; actas: ActaQueFalta[] };
  libro: TarjetaLeccion[];
  comparaciones: (Comparacion & { titulo: string | null })[];
  efecto: Efecto;
};

export function aprendizajeDe(db: Db, conocimiento: string | null): Aprendizaje {
  const comparaciones = comparacionesDe(db, null);
  const lics = licitaciones(
    db,
    comparaciones.map((c) => c.licitacion_id),
  );
  return {
    por_revisar: {
      lecciones: tarjetas(db, leccionesDonde(db, "estado = 'pendiente' ORDER BY creada_en DESC, id DESC")),
      porques: porquesAbiertos(db, comparaciones),
      actas: actasQueFaltan(db, conocimiento),
    },
    libro: tarjetas(
      db,
      leccionesDonde(db, "estado IN ('aceptada', 'retirada') ORDER BY estado, fuerza DESC, revisada_en DESC"),
    ),
    comparaciones: comparaciones.map((c) => ({ ...c, titulo: lics.get(c.licitacion_id)?.titulo ?? null })),
    efecto: efectoDe(db),
  };
}

/** Lo que cuenta la barra lateral: lecciones por revisar y porqués sin responder. */
export function pendientesAprendizaje(db: Db): number {
  const lecciones = (
    db.prepare("SELECT COUNT(*) AS n FROM lecciones WHERE estado = 'pendiente'").get() as { n: number }
  ).n;
  return lecciones + porquesAbiertos(db, comparacionesDe(db, null)).length;
}

// ── Acciones ──

export const AjusteAlcance = z
  .strictObject({
    alcance: z.enum(ALCANCES),
    alcance_valor: z.string().trim().min(1).max(300).nullable().default(null),
    tema: z.enum(TEMAS_APARTADO).nullable().optional(),
  })
  .refine((a) => a.alcance === 'general' || a.alcance_valor !== null, {
    message: 'Con un alcance que no es general, di a qué (el órgano, el CPV, el tipo de contrato o la licitación).',
  });

/** «Ajustar el alcance» (y el tema): una pendiente o aceptada; la retirada no se toca. */
export function ajustarAlcance(db: Db, id: number, a: z.infer<typeof AjusteAlcance>): Result<{ id: number }> {
  const l = db.prepare('SELECT estado, licitacion_id FROM lecciones WHERE id = ?').get(id) as
    { estado: string; licitacion_id: string | null } | undefined;
  if (!l) return fail('not_found', `No hay ninguna lección ${id}.`);
  if (l.estado === 'retirada' || l.estado === 'descartada')
    return fail('conflicto', 'Esa lección ya no se aplica: no se ajusta.');
  const valor = a.alcance === 'general' ? null : a.alcance_valor;
  const conTema = a.tema !== undefined;
  db.prepare(
    `UPDATE lecciones SET alcance = @alcance, alcance_valor = @valor${conTema ? ', tema = @tema' : ''} WHERE id = @id`,
  ).run({ alcance: a.alcance, valor, id, ...(conTema ? { tema: a.tema } : {}) });
  emitir(db, {
    tipo: 'licitacion.lecciones',
    dominio: 'licitaciones',
    recurso: l.licitacion_id,
    datos: { leccion: id, accion: 'alcance' },
  });
  return ok({ id });
}

export const Retirada = z.strictObject({
  motivo: z.string().trim().min(5, 'Di en una frase por qué se retira.').max(500),
});

/** Una aceptada deja de aplicarse (contradice otra, ya no vale…): queda en el libro como retirada. */
export function retirarLeccion(
  db: Db,
  id: number,
  r: z.infer<typeof Retirada>,
  quien = 'web',
): Result<{ id: number; estado: 'retirada' }> {
  const c = db
    .prepare(
      "UPDATE lecciones SET estado = 'retirada', retirada_motivo = ?, revisada_por = ? WHERE id = ? AND estado = 'aceptada'",
    )
    .run(r.motivo, quien, id);
  if (!c.changes) return fail('conflicto', 'Solo se retira una lección aceptada.');
  emitir(db, {
    tipo: 'licitacion.lecciones',
    dominio: 'licitaciones',
    recurso: null,
    datos: { leccion: id, accion: 'retirada' },
  });
  return ok({ id, estado: 'retirada' });
}

const AÑO_MS = 365 * 86_400_000;
export const MOTIVO_SIN_USO = 'Doce meses sin aplicarse en ninguna memoria.';

/** Las aceptadas hace más de un año que en el último año no se pasaron a ninguna memoria se retiran solas. */
export function retirarSinUso(db: Db, ahoraMs = Date.now()): number {
  const hace = new Date(ahoraMs - AÑO_MS).toISOString();
  return db
    .prepare(
      `UPDATE lecciones SET estado = 'retirada', retirada_motivo = @motivo WHERE estado = 'aceptada' AND revisada_en < @hace
    AND NOT EXISTS (SELECT 1 FROM lecciones_aplicaciones a WHERE a.leccion_id = lecciones.id AND a.aplicada_en >= @hace)`,
    )
    .run({ motivo: MOTIVO_SIN_USO, hace }).changes;
}
