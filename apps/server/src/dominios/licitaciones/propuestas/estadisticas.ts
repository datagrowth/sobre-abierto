// Estadísticas del registro de propuestas (sin IA): tasa de éxito y baja frente a la ganadora.
import { media, percentil } from '../../../nucleo/estadistica.js';
import type { Db } from '../store.js';
import type { ResultadoPropuesta } from './registro.js';

// El sector es la división CPV. La tasa cuenta solo lo decidido (ganada, perdida o excluida); desiertas,
// retiradas y pendientes no cuentan. «ganadas» suma además las que solo constan en las actas de mesa, diciendo
// de dónde sale cada una.
const DECIDIDAS: ResultadoPropuesta[] = ['ganada', 'perdida', 'excluida'];

const BANDAS = [
  { clave: 'menos de 50.000 €', hasta: 50_000 },
  { clave: '50.000 – 200.000 €', hasta: 200_000 },
  { clave: '200.000 – 1 M€', hasta: 1_000_000 },
  { clave: '1 M€ o más', hasta: Infinity },
] as const;

export function bandaDe(importe: number | null): string {
  if (importe === null || importe <= 0) return 'sin importe';
  return BANDAS.find((b) => importe < b.hasta)!.clave;
}

type Fila = {
  id: number;
  licitacion_id: string;
  titulo: string;
  resultado: ResultadoPropuesta;
  presupuesto: number | null;
  importe_ofertado: number | null;
  baja_ofertada: number | null;
  baja_ganadora: number | null;
  importe_ganador: number | null;
  puntos_tecnica: number | null;
  puntos_economica: number | null;
  puntos_total: number | null;
  puntos_ganador: number | null;
  organo: string;
  organo_nif: string | null;
  cpvs: string;
  expediente: string | null;
};

export type GrupoExito = {
  clave: string;
  nombre: string | null;
  presentadas: number;
  decididas: number;
  ganadas: number;
  tasa: number | null;
  importe_ganado: number;
};

function tasa(ganadas: number, decididas: number): number | null {
  return decididas ? Math.round((ganadas / decididas) * 1000) / 1000 : null;
}

function agrupar(
  filas: Fila[],
  clave: (f: Fila) => string,
  nombre: (f: Fila) => string | null = () => null,
): GrupoExito[] {
  const grupos = new Map<string, GrupoExito>();
  for (const f of filas) {
    const k = clave(f);
    const g = grupos.get(k) ?? {
      clave: k,
      nombre: nombre(f),
      presentadas: 0,
      decididas: 0,
      ganadas: 0,
      tasa: null,
      importe_ganado: 0,
    };
    g.presentadas += 1;
    if (DECIDIDAS.includes(f.resultado)) g.decididas += 1;
    if (f.resultado === 'ganada') {
      g.ganadas += 1;
      g.importe_ganado += f.importe_ganador ?? f.importe_ofertado ?? 0;
    }
    grupos.set(k, g);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, tasa: tasa(g.ganadas, g.decididas) }))
    .sort((a, b) => b.presentadas - a.presentadas || a.clave.localeCompare(b.clave));
}

const mediana = (xs: number[]) =>
  percentil(
    [...xs].sort((a, b) => a - b),
    0.5,
  );
const valores = (filas: Fila[], f: (x: Fila) => number | null) => filas.map(f).filter((x): x is number => x !== null);

type ParBajas = {
  propuesta: number;
  licitacion_id: string;
  titulo: string;
  resultado: ResultadoPropuesta;
  baja_ofertada: number;
  baja_ganadora: number;
  diferencia: number;
};

/** La baja de la empresa frente a la ganadora en lo ya adjudicado (diferencia > 0: ofertó más caro). */
function bajas(filas: Fila[]) {
  const pares: ParBajas[] = filas
    .filter(
      (f) =>
        f.baja_ofertada !== null &&
        f.baja_ganadora !== null &&
        (f.resultado === 'ganada' || f.resultado === 'perdida' || f.resultado === 'excluida'),
    )
    .map((f) => ({
      propuesta: f.id,
      licitacion_id: f.licitacion_id,
      titulo: f.titulo,
      resultado: f.resultado,
      baja_ofertada: f.baja_ofertada!,
      baja_ganadora: f.baja_ganadora!,
      diferencia: Math.round((f.baja_ganadora! - f.baja_ofertada!) * 10_000) / 10_000,
    }));
  const perdidas = pares.filter((p) => p.resultado !== 'ganada');
  return {
    pares: pares.slice(0, 50),
    mediana_ofertada_ganadas: mediana(
      valores(
        filas.filter((f) => f.resultado === 'ganada'),
        (f) => f.baja_ofertada,
      ),
    ),
    mediana_ofertada_perdidas: mediana(perdidas.map((p) => p.baja_ofertada)),
    mediana_ganadora_perdidas: mediana(perdidas.map((p) => p.baja_ganadora)),
    mediana_diferencia_perdidas: mediana(perdidas.map((p) => p.diferencia)),
  };
}

function puntuaciones(filas: Fila[]) {
  const redondear = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
  const con = filas.filter((f) => f.puntos_total !== null);
  return {
    n: con.length,
    media_tecnica: redondear(media(valores(con, (f) => f.puntos_tecnica))),
    media_economica: redondear(media(valores(con, (f) => f.puntos_economica))),
    media_total: redondear(media(valores(con, (f) => f.puntos_total))),
    media_ganador: redondear(media(valores(con, (f) => f.puntos_ganador))),
  };
}

const SQL = `SELECT p.id, p.licitacion_id, l.titulo, p.resultado, COALESCE(p.presupuesto, l.presupuesto_sin_iva) AS presupuesto, p.importe_ofertado,
  p.baja_ofertada, p.baja_ganadora, p.importe_ganador, p.puntos_tecnica, p.puntos_economica, p.puntos_total, p.puntos_ganador,
  l.organo_nombre AS organo, l.organo_nif, l.cpvs, l.expediente FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id ORDER BY p.presentada_en DESC, p.id DESC`;

type FuenteGanada = 'registro' | 'acta';
type Ganada = {
  fuente: FuenteGanada;
  licitacion_id: string | null;
  nombre: string;
  propuesta: number | null;
  aprendizaje: number | null;
};

type ActaGanada = { id: number; licitacion_id: string | null; expediente: string | null; carpeta: string };

// Lo que dijo la mesa de lo presentado (sin lo descartado por una persona) con resultado «ganada».
const SQL_ACTAS = `SELECT id, licitacion_id, expediente, carpeta FROM aprendizajes
  WHERE estado <> 'descartada' AND json_extract(datos, '$.resultado') = 'ganada' ORDER BY id`;

const nombreActa = (a: ActaGanada) => a.expediente || a.carpeta.split('/').filter(Boolean).at(-1) || `acta ${a.id}`;

/**
 * Ganadas = registradas + las que solo constan en un acta, cada una con su fuente. El acta no
 * trae lote, así que se empareja por licitación (o por expediente si la carpeta la creó el equipo
 * a mano): si esa licitación ya tiene un resultado registrado, manda el registro y el acta no
 * cuenta otra vez; si sigue pendiente, el acta es lo que se sabe.
 */
function ganadasConFuente(db: Db, filas: Fila[]): Ganada[] {
  const decididas = filas.filter((f) => f.resultado !== 'pendiente');
  const licitaciones = new Set(decididas.map((f) => f.licitacion_id));
  const expedientes = new Set(decididas.map((f) => f.expediente).filter((e): e is string => Boolean(e)));
  const registradas: Ganada[] = filas
    .filter((f) => f.resultado === 'ganada')
    .map((f) => ({
      fuente: 'registro',
      licitacion_id: f.licitacion_id,
      nombre: f.expediente || f.titulo,
      propuesta: f.id,
      aprendizaje: null,
    }));
  const actas: Ganada[] = (db.prepare(SQL_ACTAS).all() as ActaGanada[])
    .filter((a) =>
      a.licitacion_id ? !licitaciones.has(a.licitacion_id) : !(a.expediente && expedientes.has(a.expediente)),
    )
    .map((a) => ({
      fuente: 'acta',
      licitacion_id: a.licitacion_id,
      nombre: nombreActa(a),
      propuesta: null,
      aprendizaje: a.id,
    }));
  return [...registradas, ...actas];
}

function resumenGanadas(db: Db, filas: Fila[]) {
  const lista = ganadasConFuente(db, filas);
  const registradas = lista.filter((g) => g.fuente === 'registro').length;
  return { total: lista.length, registradas, de_actas: lista.length - registradas, lista: lista.slice(0, 50) };
}

export function estadisticasPropuestas(db: Db) {
  const filas = db.prepare(SQL).all() as Fila[];
  const porResultado = Object.fromEntries(agrupar(filas, (f) => f.resultado).map((g) => [g.clave, g.presentadas]));
  const total = agrupar(filas, () => 'total')[0];
  return {
    total: filas.length,
    por_resultado: porResultado,
    tasa_exito: total?.tasa ?? null,
    importe_ganado: total?.importe_ganado ?? 0,
    ganadas: resumenGanadas(db, filas),
    por_sector: agrupar(filas, (f) => `CPV ${f.cpvs.split(',').find(Boolean)?.slice(0, 2) ?? '—'}`),
    por_organo: agrupar(
      filas,
      (f) => f.organo_nif ?? f.organo,
      (f) => f.organo,
    ).slice(0, 20),
    por_banda: agrupar(filas, (f) => bandaDe(f.presupuesto)),
    bajas: bajas(filas),
    puntuaciones: puntuaciones(filas),
    nota: 'La tasa de éxito cuenta solo lo decidido (ganadas, perdidas y excluidas). Sector = división CPV (2 cifras) del CPV principal; banda = presupuesto sin IVA del lote o de la licitación.',
  };
}
