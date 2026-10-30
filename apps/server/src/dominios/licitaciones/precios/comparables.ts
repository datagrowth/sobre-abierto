// Adjudicaciones parecidas a una licitación, para ver con nombre y apellidos quién ganó qué y con qué baja.
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import type { Db } from '../store.js';
import { banda, claveDeConsulta, prefijosCpv, SQL_PLAUSIBLE, type Consulta } from './segmento.js';
import { esDelOrgano, sqlOrgano, type ClaveOrgano } from '../antecedentes/organo.js';
import { palabrasGuardadas, palabrasObjeto, pesosDe, similitud } from '../antecedentes/texto.js';
import { UMBRAL_PARECIDO } from '../antecedentes/ediciones.js';

// Se leen las adjudicaciones del mismo segmento (CPV de 2 cifras, tipo de contrato y banda de importe) y, aparte,
// las del mismo órgano (por NIF o, sin él, por DIR3 o nombre), y se ordenan: mismo órgano, objeto parecido
// (palabras del título), CPV más largo en común, parecido y fecha. Con mismo_organo, solo las de ese órgano.
// Se leen como mucho estas candidatas (las más recientes) y se ordenan por parecido; del
// mismo órgano, aparte, hasta DEL_ORGANO, para que no se queden fuera por antiguas.
const CANDIDATAS = 2000;
const DEL_ORGANO = 500;

// parecido: similitud del título (0–1, null sin título que comparar); objeto_parecido: llega al
// umbral con el que los antecedentes dan por buena una edición.
export type Comparable = {
  licitacion_id: string;
  titulo: string;
  organo: string;
  expediente: string;
  url: string | null;
  fecha: string | null;
  lote: string;
  adjudicatario_nombre: string | null;
  adjudicatario_nif: string | null;
  presupuesto: number | null;
  importe: number | null;
  baja: number;
  ofertas: number | null;
  mismo_organo: boolean;
  cpv_comun: string | null;
  parecido: number | null;
  objeto_parecido: boolean;
};

type Fila = Omit<Comparable, 'mismo_organo' | 'cpv_comun' | 'parecido' | 'objeto_parecido'> & {
  cpvs: string;
  organo_nif: string | null;
  organo_dir3: string | null;
  organo_norm: string | null;
  titulo_palabras: string | null;
};

function leer(db: Db, c: Consulta, organo: ClaveOrgano | null, limite: number): Fila[] {
  const adjudicados = [...RESULTADOS_ADJUDICADOS];
  const condiciones = [`a.resultado IN (${adjudicados.map(() => '?').join(',')})`, SQL_PLAUSIBLE];
  const args: (string | number)[] = [...adjudicados];
  const b = banda(c.presupuesto);
  if (c.cpv) {
    condiciones.push("instr(l.cpvs, ',' || ?) > 0");
    args.push(c.cpv.slice(0, 2));
  }
  if (c.tipo) {
    condiciones.push('l.tipo_contrato = ?');
    args.push(c.tipo);
  }
  if (organo) {
    const o = sqlOrgano(organo, 'l');
    condiciones.push(o.sql);
    args.push(...o.args);
  }
  if (b) {
    condiciones.push('a.presupuesto_sin_iva BETWEEN ? AND ?');
    args.push(b.min, b.max);
  }
  if (c.excluir) {
    condiciones.push('l.id <> ?');
    args.push(c.excluir);
  }
  return db
    .prepare(
      `SELECT l.id AS licitacion_id, l.titulo, l.titulo_palabras, l.organo_nombre AS organo, l.organo_nif, l.organo_dir3, l.organo_norm,
      l.expediente, l.url, l.cpvs, a.fecha, a.lote, a.adjudicatario_nombre, a.adjudicatario_nif, a.presupuesto_sin_iva AS presupuesto,
      a.importe_sin_iva AS importe, a.baja, a.ofertas
    FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id WHERE ${condiciones.join(' AND ')}
    ORDER BY COALESCE(a.fecha, l.actualizada_en) DESC LIMIT ?`,
    )
    .all(...args, limite) as Fila[];
}

// Las del segmento y, si no se pidió solo el órgano, también las del órgano, sin repetir.
function filasDe(db: Db, c: Consulta, clave: ClaveOrgano | null): Fila[] {
  if (c.mismo_organo) return leer(db, c, clave, CANDIDATAS);
  const delOrgano = clave ? leer(db, c, clave, DEL_ORGANO) : [];
  const vistas = new Set(delOrgano.map((f) => `${f.licitacion_id}|${f.lote}`));
  return [...delOrgano, ...leer(db, c, null, CANDIDATAS).filter((f) => !vistas.has(`${f.licitacion_id}|${f.lote}`))];
}

function cpvComun(cpvs: string, prefijos: string[]): string | null {
  return prefijos.find((p) => cpvs.includes(`,${p}`)) ?? null;
}

function ordenar(a: Comparable, b: Comparable): number {
  return (
    Number(b.mismo_organo) - Number(a.mismo_organo) ||
    Number(b.objeto_parecido) - Number(a.objeto_parecido) ||
    (b.cpv_comun?.length ?? 0) - (a.cpv_comun?.length ?? 0) ||
    (b.parecido ?? 0) - (a.parecido ?? 0) ||
    (b.fecha ?? '').localeCompare(a.fecha ?? '')
  );
}

/** Las `limite` adjudicaciones más parecidas, con el adjudicatario y su baja. */
export function comparables(db: Db, c: Consulta, limite: number): Comparable[] {
  const clave = claveDeConsulta(c);
  const prefijos = c.cpv ? prefijosCpv(c.cpv) : [];
  const filas = filasDe(db, c, clave);
  const objeto = c.titulo ? palabrasObjeto(c.titulo) : null;
  const palabras = filas.map((f) => palabrasGuardadas(f.titulo_palabras, f.titulo));
  const pesos = pesosDe([...(objeto ? [objeto] : []), ...palabras]);
  return filas
    .map(({ cpvs, organo_nif, organo_dir3, organo_norm, titulo_palabras: _guardadas, ...f }, i) => {
      const parecido = objeto ? similitud(objeto, palabras[i] ?? new Set(), pesos) : null;
      return {
        ...f,
        mismo_organo: esDelOrgano(clave, { organo_nif, organo_dir3, organo_norm }),
        cpv_comun: cpvComun(cpvs, prefijos),
        parecido,
        objeto_parecido: parecido !== null && parecido >= UMBRAL_PARECIDO,
      };
    })
    .sort(ordenar)
    .slice(0, limite);
}

export const COMO_SE_ELIGEN = `Adjudicaciones de la PLACSP con la misma división CPV (2 cifras), el mismo tipo de contrato y un presupuesto entre un tercio y el triple, con una baja creíble; las del mismo órgano (por NIF o, si la plataforma no lo publica, por DIR3 o nombre) se buscan aparte para que no se queden fuera por antiguas. Orden: mismo órgano, objeto parecido (palabras del título con un parecido de ${UMBRAL_PARECIDO} o más), CPV más largo en común, parecido y fecha.`;
