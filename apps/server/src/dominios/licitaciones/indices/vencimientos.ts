// Vencimientos: contratos del mercado de la empresa que acaban en los próximos meses y su nueva licitación esperada.
import { z } from 'zod';
import { percentil } from '../../../nucleo/estadistica.js';
import { claseNif } from '../../../nucleo/identidad.js';
import { condicionSector, nombreEmpresa, nombreOrgano } from '../competencia/ambito.js';
import { sectorActual } from '../historico.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import type { Db } from '../store.js';
import type { Confianza } from './calculo.js';
import { renovacionesSeguidas } from './renovaciones.js';

// Salida esperada = fin estimado − la mediana de la antelación con que ese órgano publicó antes la siguiente
// edición de un contrato suyo del mismo CPV (4 cifras), o 4 meses si no hay historial. Confianza alta con 2 o
// más ediciones, media con 1, baja sin ninguna.
export const OpcionesVencimientos = z.object({
  meses: z.coerce.number().int().min(1).max(24).default(12).describe('Contratos que acaban en los próximos N meses'),
  organo: z.string().trim().min(3).max(20).optional().describe('Solo los de este órgano (NIF)'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  desde: z.coerce.number().int().min(0).default(0),
});
export type OpcionesVencimientosData = z.infer<typeof OpcionesVencimientos>;

const ANTELACION_DEFECTO_MESES = 4;
const MES_MS = 30.4375 * 24 * 60 * 60_000;
const ANIOS_HISTORIAL = 6;
const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');

export type Vencimiento = {
  licitacion_id: string;
  lote: string;
  titulo: string;
  expediente: string;
  url: string | null;
  organo: string;
  organo_nif: string | null;
  adjudicatario_nif: string | null;
  adjudicatario: string | null;
  importe: number | null;
  inicio: string | null;
  fin_estimado: string;
  prorrogas_max: number | null;
  prorrogas_usadas: number | null;
  salida_esperada: string;
  antelacion_meses: number;
  ediciones: number;
  confianza: Confianza;
  // Si alguien pidió «Avisarme cuando salga» (renovaciones.ts).
  avisar: boolean;
};

export type Antelacion = { meses: number; ediciones: number; confianza: Confianza };

/** Antelación del órgano: mediana de (fin de un contrato − publicación de la siguiente edición), en meses. */
export function antelacionDe(antelaciones: number[]): Antelacion {
  const ordenadas = antelaciones.filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  const mediana = percentil(ordenadas, 0.5);
  const ediciones = ordenadas.length;
  return {
    meses: mediana === null ? ANTELACION_DEFECTO_MESES : Math.round(mediana * 10) / 10,
    ediciones,
    confianza: ediciones >= 2 ? 'alta' : ediciones === 1 ? 'media' : 'baja',
  };
}

// Ediciones anteriores del órgano: cada contrato suyo ya vencido con la primera licitación suya del
// mismo CPV (4 cifras) publicada después de adjudicarlo y en los 12 meses antes de su fin (nunca después:
// una antelación negativa o la edición de otro contrato anterior torcerían la mediana).
function antelacionesDelOrgano(db: Db, organo: string, hoy: string): number[] {
  const desde = `${Number(hoy.slice(0, 4)) - ANIOS_HISTORIAL}${hoy.slice(4, 10)}`;
  const filas = db
    .prepare(
      `SELECT c.fin_estimado AS fin, (SELECT MIN(l2.publicada_en) FROM licitaciones l2
        WHERE l2.organo_nif = l.organo_nif AND l2.id <> l.id AND l2.publicada_en BETWEEN date(c.fin_estimado, '-12 months') AND c.fin_estimado
          AND l2.publicada_en > COALESCE(c.adjudicado_en, '')
          AND EXISTS (SELECT 1 FROM licitacion_cpv x JOIN licitacion_cpv y ON substr(y.cpv, 1, 4) = substr(x.cpv, 1, 4)
            WHERE x.licitacion_id = l.id AND y.licitacion_id = l2.id)) AS siguiente
    FROM contratos c JOIN licitaciones l ON l.id = c.licitacion_id
    WHERE l.organo_nif = ? AND c.fin_estimado < ? AND c.fin_estimado >= ? LIMIT 200`,
    )
    .all(organo, hoy, desde) as { fin: string; siguiente: string | null }[];
  return filas
    .filter((f) => f.siguiente)
    .map((f) => (Date.parse(f.fin) - Date.parse(f.siguiente!.slice(0, 10))) / MES_MS);
}

function restarMeses(fecha: string, meses: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - meses * MES_MS).toISOString().slice(0, 10);
}

type Fila = Omit<
  Vencimiento,
  'salida_esperada' | 'antelacion_meses' | 'ediciones' | 'confianza' | 'adjudicatario' | 'organo' | 'avisar'
> & {
  organo_nombre: string;
  adjudicatario_nombre: string | null;
};

/** Contratos de los CPV de la empresa que acaban en los próximos `meses`, el más cercano primero. */
export function vencimientos(
  db: Db,
  o: OpcionesVencimientosData,
  ahoraMs = Date.now(),
): { total: number; desde: number; siguiente: number | null; items: Vencimiento[] } {
  const hoy = new Date(ahoraMs).toISOString().slice(0, 10);
  const hasta = new Date(ahoraMs + o.meses * MES_MS).toISOString().slice(0, 10);
  const sector = condicionSector('a.cpvs', sectorActual(db, false).cpvs);
  const organo = o.organo ? 'AND l.organo_nif = ?' : '';
  const base = `FROM contratos c JOIN licitaciones l ON l.id = c.licitacion_id
    JOIN adjudicaciones a ON a.licitacion_id = c.licitacion_id AND a.lote = c.lote AND a.resultado IN (${ADJUDICADOS})
    WHERE c.fin_estimado >= ? AND c.fin_estimado <= ? AND ${sector.sql} ${organo}`;
  const args = [hoy, hasta, ...sector.args, ...(o.organo ? [o.organo] : [])];
  const total = (
    db.prepare(`SELECT COUNT(DISTINCT c.licitacion_id || '|' || c.lote) AS n ${base}`).get(...args) as { n: number }
  ).n;
  const filas = db
    .prepare(
      `SELECT c.licitacion_id, c.lote, l.titulo, l.expediente, l.url, l.organo_nombre, l.organo_nif, MIN(a.ord) AS _ord,
      a.adjudicatario_nif, a.adjudicatario_nombre, a.importe_sin_iva AS importe, c.inicio, c.fin_estimado, c.prorrogas_max, c.prorrogas_usadas
    ${base} GROUP BY c.licitacion_id, c.lote ORDER BY c.fin_estimado, c.licitacion_id LIMIT ? OFFSET ?`,
    )
    .all(...args, o.limite, o.desde) as (Fila & { _ord: number })[];
  const porOrgano = new Map<string, Antelacion>();
  const seguidas = renovacionesSeguidas(db);
  const items = filas.map(({ _ord: _o, organo_nombre, adjudicatario_nombre, ...f }) => {
    const clave = f.organo_nif ?? '';
    const a = porOrgano.get(clave) ?? antelacionDe(f.organo_nif ? antelacionesDelOrgano(db, f.organo_nif, hoy) : []);
    porOrgano.set(clave, a);
    const persona = f.adjudicatario_nif !== null && claseNif(f.adjudicatario_nif) === 'persona_fisica';
    return {
      ...f,
      organo: nombreOrgano(organo_nombre) ?? organo_nombre,
      adjudicatario: persona ? null : nombreEmpresa(adjudicatario_nombre),
      salida_esperada: restarMeses(f.fin_estimado, a.meses),
      antelacion_meses: a.meses,
      ediciones: a.ediciones,
      confianza: a.confianza,
      avisar: seguidas.has(`${f.licitacion_id}|${f.lote}`),
    };
  });
  return { total, desde: o.desde, siguiente: o.desde + items.length < total ? o.desde + items.length : null, items };
}
