// Licitaciones sintéticas con la forma que deja el mapper, para los tests de antecedentes
// (y su medida de rendimiento): órgano con o sin NIF, lotes, ganadores y fechas.
import type { LicitacionData } from '../../src/dominios/licitaciones/placsp/mapper.js';

let n = 0;

type Ganador = {
  nif: string | null;
  nombre: string;
  importe: number;
  ofertas: number | null;
  lote?: string;
  inicio?: string;
};
export type Sintetica = {
  titulo: string;
  publicada: string;
  organo?: { nombre: string; nif: string | null; dir3?: string | null; superior?: string | null };
  presupuesto?: number;
  cpv?: string;
  procedimiento?: string;
  ganadores?: Ganador[];
  lotes?: { id: string; nombre: string; importe: number }[];
  limite?: string | null;
  inicio?: string | null;
  duracion?: { valor: number; unidad: string } | null;
  requisitos?: LicitacionData['requisitos'];
  valorEstimado?: number;
  tipo?: string;
  nuts?: string | null;
};

export const AYTO = { nombre: 'Junta de Gobierno Local del Ayuntamiento de Villaejemplo', nif: 'P0000004B' };

// Una licitación como las que deja el mapper, con lo que importa para los antecedentes.
export function licitacion(s: Sintetica): LicitacionData {
  n += 1;
  const o: NonNullable<Sintetica['organo']> = s.organo ?? AYTO;
  return {
    id: `p-${1000 + n}`,
    atom_id: `atom-${n}`,
    fuente: o.nif ? 'perfiles' : 'agregadas',
    expediente: `${n}/${s.publicada.slice(0, 4)}`,
    titulo: s.titulo,
    url: `https://contrataciondelestado.es/${n}`,
    estado: s.ganadores ? 'RES' : 'PUB',
    actualizada_en: `${s.publicada}T10:00:00Z`,
    organo: { nombre: o.nombre, nif: o.nif, dir3: o.dir3 ?? null, ciudad: null, superior: o.superior ?? null },
    tipo_contrato: s.tipo ?? '2',
    procedimiento: s.procedimiento ?? '1',
    presupuesto_sin_iva: s.presupuesto ?? 120_000,
    presupuesto_con_iva: null,
    valor_estimado: s.valorEstimado ?? null,
    cpvs: [s.cpv ?? '72267000'],
    nuts: s.nuts === undefined ? 'ES300' : s.nuts,
    lugar: null,
    duracion: s.duracion === undefined ? { valor: 2, unidad: 'ANN' } : s.duracion,
    periodo: s.inicio ? { inicio: s.inicio, fin: null } : null,
    publicada_en: s.publicada,
    fecha_limite: s.limite ?? null,
    fecha_solicitud: null,
    criterios: [],
    requisitos: s.requisitos ?? [],
    garantias: [],
    documentos: [],
    lotes: (s.lotes ?? []).map((l) => ({ id: l.id, nombre: l.nombre, presupuesto_sin_iva: l.importe, cpvs: [] })),
    presentacion: { codigo: s.lotes ? '3' : null, maximo_lotes: null, maximo_adjudicables: null, combinacion: null },
    resultados: (s.ganadores ?? []).map((g) => ({
      lote: g.lote ?? null,
      codigo: '9',
      fecha: s.publicada.replace(/-\d\d$/, '-28'),
      ofertas: g.ofertas,
      oferta_min: null,
      oferta_max: null,
      adjudicatario_nif: g.nif,
      adjudicatario_nombre: g.nombre,
      importe_sin_iva: g.importe,
      importe_con_iva: null,
      pyme: true,
      inicio: g.inicio ?? null,
    })),
  };
}
