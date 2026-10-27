// Oportunidades que sigue la empresa y siguen vivas, para ver qué competidores ganan donde licita.
import type { Db } from '../store.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';

// Coinciden por el mismo órgano o la misma clase de CPV. El ranking (en SQL) y las fichas (en JS) parten del
// mismo conjunto para que sus coincidencias cuadren.
// Clase CPV (4 cifras): «mismo CPV» sin exigir el código exacto, que cada órgano elige a su manera.
const CIFRAS_CLASE_CPV = 4;

// Nadie cierra a mano las nuevas cuyo plazo pasó: sin este corte se acumulan y
// pesarían más que las abiertas. Lo que la empresa prepara o presenta cuenta hasta que se resuelve.
const CON_PLAZO = ['nueva'];
const COMPROMETIDAS = ['en_preparacion', 'presentada'];

/** FROM y WHERE de las oportunidades vivas (alias o y l), para usarlo también como subconsulta. */
export function sqlSeguidas(hoy: Date): { sql: string; args: string[] } {
  const marcas = (xs: string[]) => xs.map(() => '?').join(',');
  // fecha_limite se guarda como AAAA-MM-DDTHH:MM:SS en hora de España, sin zona: se compara
  // con «ahora» en el mismo formato y la misma hora.
  return {
    sql: `FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE (o.estado IN (${marcas(COMPROMETIDAS)})
      OR (o.estado IN (${marcas(CON_PLAZO)}) AND (l.fecha_limite IS NULL OR l.fecha_limite > ?)))`,
    args: [...COMPROMETIDAS, ...CON_PLAZO, horaLocalEspana(hoy.getTime())],
  };
}

export type Nuestra = {
  id: string;
  titulo: string;
  organo: string;
  organo_nif: string | null;
  clases: string[];
  estado: string;
};

export function oportunidadesSeguidas(db: Db, hoy = new Date()): Nuestra[] {
  const s = sqlSeguidas(hoy);
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo, l.organo_nombre AS organo, l.organo_nif, l.cpvs, o.estado ${s.sql}
    ORDER BY COALESCE(l.fecha_limite, '9999')`,
    )
    .all(...s.args) as (Omit<Nuestra, 'clases'> & { cpvs: string })[];
  return filas.map(({ cpvs, ...f }) => ({ ...f, clases: clasesDe(cpvs) }));
}

export function clasesDe(cpvs: string | null): string[] {
  return [
    ...new Set(
      (cpvs ?? '')
        .split(',')
        .filter(Boolean)
        .map((c) => c.slice(0, CIFRAS_CLASE_CPV)),
    ),
  ];
}

/** Clases CPV de las oportunidades: sin tope, porque el catálogo CPV tiene pocos cientos de clases. */
export function clasesSeguidas(nuestras: Nuestra[]): string[] {
  return [...new Set(nuestras.flatMap((n) => n.clases))];
}

export type Coincidencia = Omit<Nuestra, 'clases'> & { mismo_organo: boolean; mismo_cpv: boolean };

/** Oportunidades seguidas que comparten órgano o clase de CPV con unas adjudicaciones. */
export function coincidencias(
  nuestras: Nuestra[],
  filas: { organo_nif: string | null; cpvs: string | null }[],
): Coincidencia[] {
  const organos = new Set(filas.map((f) => f.organo_nif).filter(Boolean));
  const clases = new Set(filas.flatMap((f) => clasesDe(f.cpvs)));
  return nuestras
    .map(({ clases: suyas, ...n }) => ({
      ...n,
      mismo_organo: n.organo_nif !== null && organos.has(n.organo_nif),
      mismo_cpv: suyas.some((c) => clases.has(c)),
    }))
    .filter((c) => c.mismo_organo || c.mismo_cpv);
}
