// Lo que Licitaciones da a la API de lectura para BI: Pipeline, presentadas, índices de mercado y lecciones.
import type { Fila } from '../../nucleo/apiLectura.js';
import { ESCALON } from './indices/index.js';
import { leccionesDonde } from './oferta/libroLecciones.js';
import { pipeline } from './pipeline.js';
import { listarPropuestas } from './propuestas/registro.js';
import type { Db } from './store.js';

const MAX = 100_000;

// Datos de la PLACSP y las cifras de la empresa; nada de personas (ni el responsable de una oferta ni quién
// revisó una lección), costes internos, notas ni documentos. Los plazos, en hora peninsular sin zona.
export function filasPipeline(db: Db, ahoraMs = Date.now()): Fila[] {
  return pipeline(db, ahoraMs).columnas.flatMap((c) =>
    c.tarjetas.map((t) => ({
      id: t.id,
      expediente: t.expediente,
      titulo: t.titulo,
      titulo_corto: t.titulo_corto,
      organo: t.organo,
      importe_sin_iva: t.importe,
      fecha_limite: t.fecha_limite,
      columna: c.clave,
      estado: c.titulo,
      resultado: t.resultado,
    })),
  );
}

export function filasPresentadas(db: Db): Fila[] {
  return listarPropuestas(db, { limite: MAX }).items.map((p) => ({
    licitacion_id: p.licitacion_id,
    expediente: p.expediente,
    titulo: p.titulo,
    organo: p.organo,
    organo_nif: p.organo_nif,
    lote: p.lote || null,
    presentada_en: p.presentada_en,
    importe_ofertado: p.importe_ofertado,
    presupuesto: p.presupuesto,
    baja_ofertada: p.baja_ofertada,
    resultado: p.resultado,
    posicion: p.posicion,
    puntos_total: p.puntos_total,
    puntos_ganador: p.puntos_ganador,
    ganador_nif: p.ganador_nif,
    ganador_nombre: p.ganador_nombre,
    importe_ganador: p.importe_ganador,
    baja_ganadora: p.baja_ganadora,
    resuelta_en: p.resuelta_en,
  }));
}

type FilaSegmento = {
  clave: string;
  nivel_cpv: number;
  n: number;
  ofertas_p25: number | null;
  ofertas_p50: number | null;
  ofertas_p75: number | null;
  p_un_licitador: number | null;
  baja_p25: number | null;
  baja_p50: number | null;
  baja_p75: number | null;
  baja_esperada: number | null;
  confianza: string;
  actualizado_en: string;
};

// La clave del segmento (claveSegmento): tipo|cpv|escalón de importe|grupo de procedimiento|órgano.
const nulo = (s: string | undefined) => (s === undefined || s === '-' ? null : s);

export function filasIndices(db: Db): Fila[] {
  const filas = db
    .prepare(
      `SELECT clave, nivel_cpv, n, ofertas_p25, ofertas_p50, ofertas_p75, p_un_licitador, baja_p25, baja_p50, baja_p75,
    baja_esperada, confianza, actualizado_en FROM indices_segmento ORDER BY clave`,
    )
    .all() as FilaSegmento[];
  return filas.map(({ clave, ...f }) => {
    const [tipo, cpv, escalon, procedimiento, organo] = clave.split('|');
    const e = nulo(escalon);
    return {
      segmento: clave,
      tipo_contrato: nulo(tipo),
      cpv: nulo(cpv),
      importe_referencia: e === null ? null : Math.round(ESCALON ** Number(e)),
      procedimiento: procedimiento === 'neg' ? 'negociado' : 'abierto',
      organo_nif: nulo(organo),
      ...f,
    };
  });
}

export function filasLecciones(db: Db): Fila[] {
  return leccionesDonde(db, "estado = 'aceptada' ORDER BY id").map((l) => ({
    id: l.id,
    licitacion_id: l.licitacion_id,
    origen: l.origen,
    alcance: l.alcance,
    alcance_valor: l.alcance_valor,
    tema: l.tema,
    texto: l.texto,
    fuerza: l.fuerza,
    creada_en: l.creada_en,
    revisada_en: l.revisada_en,
  }));
}
