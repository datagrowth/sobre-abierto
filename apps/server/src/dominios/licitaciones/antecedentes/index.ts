// Antecedentes de una licitación: ediciones anteriores con quién ganó, e indicios de «licitación con nombre».
import { z } from 'zod';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { fichasDe } from '../ficha.js';
import { lotesDeDatos, type LoteDatos } from '../lotes.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from '../store.js';
import {
  anterioresA,
  buscarEdiciones,
  candidatasDelOrgano,
  DESCRIPCION_BUSQUEDA,
  type CacheOrganos,
  SQL_FECHA_EDICION,
  UMBRAL_PARECIDO,
  type Candidata,
  type Encontrada,
  type Objeto,
} from './ediciones.js';
import {
  indiciosDePliego,
  indiciosHistoricos,
  indicioPlazo,
  indicioSolvencia,
  REGLAS,
  sumar,
  type Indicios,
  type Nivel,
  type ReqSolvencia,
  type Senal,
} from './indicios.js';
import { detalleEdicion, Duracion, hitosDe, leerJson, type DetalleEdicion, type Hito } from './linea.js';
import { claveOrgano, COMO_SE_RECONOCE } from './organo.js';
import { palabrasObjeto, pesosDe, similitud, type Pesos } from './texto.js';
import { lugaresDe } from './lugares.js';

// Solo código sobre datos de la PLACSP y la ficha aprobada: la IA no decide nada aquí. Las ediciones son las del
// contrato y las de cada lote.
export const OpcionesAntecedentes = z.object({
  lote: z.string().trim().min(1).max(20).optional().describe('Solo este lote (id como en «lotes[].id»)'),
  limite: z.number().int().min(1).max(30).default(12).describe('Ediciones como mucho, por contrato y por lote'),
});
export type OpcionesAntecedentesData = z.infer<typeof OpcionesAntecedentes>;

// Hay contratos con más de 60 lotes: se miran los primeros.
const MAX_LOTES = 30;
const NOTA =
  'Indicios, no pruebas: patrones que suelen aparecer cuando una licitación está pensada para quien ya presta el servicio. Compruébalos en el pliego. La PLACSP solo publica quién ganó, no quién se presentó.';

type LineaLote = { id: string; nombre: string | null; ediciones: Hito[]; indicios: Indicios };
export type Antecedentes = {
  licitacion: { id: string; titulo: string; organo: string; organo_por: string | null; referencia: string };
  como_se_buscan: string;
  reglas: string;
  nota: string;
  nivel: Nivel;
  ediciones: Hito[];
  indicios: Indicios;
  lotes: LineaLote[];
  lotes_sin_mirar: number;
};

const DatosActual = z
  .object({
    requisitos: z
      .array(
        z.object({
          clase: z.string(),
          codigo: z.string().nullable().catch(null),
          umbral: z.number().nullable().optional().catch(null),
          lote: z.string().nullable().optional().catch(null),
        }),
      )
      .catch([]),
    duracion: Duracion.optional().transform((d) => d ?? null),
    periodo: z
      .object({ inicio: z.string().nullable().catch(null) })
      .nullable()
      .optional()
      .catch(null),
  })
  .catch({ requisitos: [], duracion: null, periodo: null });

type Contexto = {
  db: Db;
  fila: FilaLicitacion;
  datos: z.infer<typeof DatosActual>;
  senales: Senal[];
  candidatas: Candidata[];
  pesos: Pesos;
  objeto: Objeto;
  limite: number;
  contrato: Encontrada[];
  numLotes: number;
  detalles: Map<string, DetalleEdicion>;
  referencia: string;
};

function detalle(ctx: Contexto, id: string): DetalleEdicion {
  const d = ctx.detalles.get(id) ?? detalleEdicion(ctx.db, id);
  ctx.detalles.set(id, d);
  return d;
}

function referenciaDe(db: Db, id: string): string {
  return (db.prepare(`SELECT ${SQL_FECHA_EDICION} AS f FROM licitaciones l WHERE l.id = ?`).get(id) as { f: string }).f;
}

function contexto(db: Db, fila: FilaLicitacion, o: { limite: number; cache: CacheOrganos }): Contexto {
  const clave = claveOrgano(fila);
  const referencia = referenciaDe(db, fila.id);
  const candidatas = clave ? anterioresA(candidatasDelOrgano(db, clave, o.cache), fila.id, referencia) : [];
  const limite = o.limite;
  const lotes = lotesDeDatos(fila.datos);
  const objeto: Objeto = {
    palabras: palabrasObjeto(fila.titulo),
    cpvs: fila.cpvs.split(',').filter(Boolean),
    importe: fila.presupuesto_sin_iva ?? fila.valor_estimado,
    lugares: lugaresDe(fila.titulo),
  };
  const pesos = pesosDe([
    ...candidatas.map((c) => c.palabras),
    objeto.palabras,
    ...lotes.map((l) => palabrasObjeto(l.nombre ?? '')),
  ]);
  return {
    db,
    fila,
    datos: DatosActual.parse(leerJson(fila.datos)),
    senales: fichasDe(db, fila.id).aprobada?.datos.senales_pliego ?? [],
    candidatas,
    pesos,
    objeto,
    limite,
    contrato: buscarEdiciones(candidatas, objeto, pesos, limite),
    numLotes: lotes.length,
    detalles: new Map(),
    referencia,
  };
}

// Valor contra el que se mide la solvencia: el estimado (incluye prórrogas, como el art. 87)
// o, si no consta, el presupuesto. El lote solo publica su presupuesto: se lleva a valor
// estimado con la proporción del contrato.
function valorDe(fila: FilaLicitacion, lote: LoteDatos | null): number | null {
  const total = fila.valor_estimado ?? fila.presupuesto_sin_iva;
  if (!lote) return total;
  const escala =
    fila.valor_estimado && fila.presupuesto_sin_iva ? Math.max(1, fila.valor_estimado / fila.presupuesto_sin_iva) : 1;
  return lote.presupuesto_sin_iva === null ? null : lote.presupuesto_sin_iva * escala;
}

// Los requisitos generales se miden contra el contrato entero también en cada lote: una
// solvencia pensada para el total no es «muy alta» por compararla con un lote. Los del lote, contra el lote.
function requisitosDe(ctx: Contexto, lote: LoteDatos | null, sinDatos: string[]): ReqSolvencia[] {
  const total = valorDe(ctx.fila, null);
  const delLote = lote ? valorDe(ctx.fila, lote) : null;
  const requisitos = ctx.datos.requisitos
    .filter((r) => !r.lote || r.lote === lote?.id)
    .map((r) => ({ clase: r.clase, codigo: r.codigo, umbral: r.umbral ?? null, valor: r.lote ? delLote : total }));
  if (ctx.fila.valor_estimado === null && requisitos.some((r) => r.umbral !== null))
    sinDatos.push('Solvencia: no consta el valor estimado; se mide con el presupuesto sin IVA.');
  return requisitos;
}

function indiciosDe(ctx: Contexto, hitos: Hito[], lote: LoteDatos | null): Indicios {
  const sinDatos: string[] = [];
  const { fila, datos } = ctx;
  const plazo = {
    publicada_en: fila.publicada_en,
    fecha_limite: fila.fecha_limite,
    procedimiento: fila.procedimiento,
    tipo_contrato: fila.tipo_contrato,
    importe: fila.valor_estimado ?? fila.presupuesto_sin_iva,
  };
  return sumar(
    [
      ...indiciosHistoricos(hitos, datos.periodo?.inicio ?? null, sinDatos),
      indicioPlazo(plazo, sinDatos),
      indicioSolvencia({ requisitos: requisitosDe(ctx, lote, sinDatos), duracion: datos.duracion }),
      ...indiciosDePliego(ctx.senales.filter((s) => !s.lote || (lote !== null && s.lote === lote.id))),
    ].filter((i) => i !== null),
    sinDatos,
  );
}

// El lote de una edición cuyo nombre más se parece al del lote actual.
function loteParecido(lotes: LoteDatos[], o: Objeto, pesos: Pesos): LoteDatos | null {
  const puntuados = lotes.map((l) => ({ l, s: similitud(o.palabras, palabrasObjeto(l.nombre ?? ''), pesos) }));
  const mejor = puntuados.sort((a, b) => b.s - a.s)[0];
  return mejor && mejor.s >= UMBRAL_PARECIDO ? mejor.l : null;
}

// Una edición encontrada por el nombre del lote: su lote parecido o, si no lo hay, toda.
function porNombre(ctx: Contexto, e: Encontrada, o: Objeto): Hito[] {
  const d = detalle(ctx, e.id);
  return hitosDe(e, d, d.lotes.length ? (loteParecido(d.lotes, o, ctx.pesos)?.id ?? null) : null);
}

// Una edición del contrato: sin lotes, entera (era el contrato que ahora se parte); con
// lotes, el de nombre parecido o, si tenía los mismos lotes, el del mismo id.
function delContrato(ctx: Contexto, e: Encontrada, lote: LoteDatos, o: Objeto): Hito[] {
  const d = detalle(ctx, e.id);
  if (!d.lotes.length) return hitosDe(e, d);
  const mismoId = d.lotes.length === ctx.numLotes ? d.lotes.find((l) => l.id === lote.id) : undefined;
  const elegido = loteParecido(d.lotes, o, ctx.pesos) ?? mismoId ?? null;
  return elegido ? hitosDe(e, d, elegido.id) : [];
}

function lineaDeLote(ctx: Contexto, lote: LoteDatos): LineaLote {
  const propios = lugaresDe(lote.nombre ?? '');
  const o: Objeto = {
    palabras: palabrasObjeto(lote.nombre ?? ''),
    cpvs: lote.cpvs.length ? lote.cpvs : ctx.objeto.cpvs,
    importe: lote.presupuesto_sin_iva,
    lugares: propios.size ? propios : ctx.objeto.lugares,
  };
  // Un nombre de una palabra («Lote 1», «Madrid») no basta para buscar por él.
  const encontradas = o.palabras.size >= 2 ? buscarEdiciones(ctx.candidatas, o, ctx.pesos, ctx.limite) : [];
  const ids = new Set(encontradas.map((e) => e.id));
  const hitos = [
    ...encontradas.flatMap((e) => porNombre(ctx, e, o)),
    ...ctx.contrato.filter((e) => !ids.has(e.id)).flatMap((e) => delContrato(ctx, e, lote, o)),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { id: lote.id, nombre: lote.nombre, ediciones: hitos, indicios: indiciosDe(ctx, hitos, lote) };
}

const ORDEN: Record<Nivel, number> = { bajo: 0, medio: 1, alto: 2 };
const maximo = (niveles: Nivel[]): Nivel => niveles.reduce((m, n) => (ORDEN[n] > ORDEN[m] ? n : m), 'bajo');

function lotesPedidos(fila: FilaLicitacion, lote: string | undefined): Result<LoteDatos[]> {
  const lotes = lotesDeDatos(fila.datos);
  if (lote === undefined) return ok(lotes);
  const pedido = lotes.find((l) => l.id === lote);
  if (pedido) return ok([pedido]);
  return fail(
    'invalid_input',
    lotes.length
      ? `La licitación no tiene el lote «${lote}» (lotes: ${lotes
          .map((l) => l.id)
          .slice(0, 60)
          .join(', ')}).`
      : 'La licitación no tiene lotes: no indiques lote.',
  );
}

/**
 * Ediciones anteriores, línea de tiempo e indicios de una licitación (y de cada lote).
 * `cache`: para varias licitaciones seguidas (la criba), las de cada órgano se leen una vez.
 */
export function antecedentesDe(
  db: Db,
  id: string,
  o: OpcionesAntecedentesData,
  cache: CacheOrganos = new Map(),
): Result<Antecedentes> {
  const fila = obtenerLicitacion(db, id);
  if (!fila) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const pedidos = lotesPedidos(fila, o.lote);
  if (pedidos.error) return pedidos;
  const clave = claveOrgano(fila);
  const ctx = contexto(db, fila, { limite: o.limite, cache });
  const ediciones = ctx.contrato.flatMap((e) => hitosDe(e, detalle(ctx, e.id)));
  const indicios = indiciosDe(ctx, ediciones, null);
  const lotes = pedidos.data.slice(0, MAX_LOTES).map((l) => lineaDeLote(ctx, l));
  return ok({
    licitacion: {
      id,
      titulo: fila.titulo,
      organo: fila.organo_nombre,
      organo_por: clave ? COMO_SE_RECONOCE[clave.por] : null,
      referencia: ctx.referencia,
    },
    como_se_buscan: DESCRIPCION_BUSQUEDA,
    reglas: REGLAS,
    nota: NOTA,
    nivel: maximo([indicios.nivel, ...lotes.map((l) => l.indicios.nivel)]),
    ediciones,
    indicios,
    lotes,
    lotes_sin_mirar: Math.max(0, pedidos.data.length - MAX_LOTES),
  });
}

// Para la criba y licitaciones_ver: lo justo para tenerlo en cuenta sin leer la línea entera.
// Puntos, ediciones, incumbente e indicios son todos del mismo ámbito (el contrato o el lote
// con más puntos), que dice «ambito»; los indicios sin puntos (plazo en el mínimo) no van.
export type ResumenAntecedentes = {
  nivel: Nivel;
  ambito: string;
  puntos: number;
  ediciones: number;
  incumbente: string | null;
  indicios: string[];
  lotes: { id: string; nivel: Nivel }[];
};

function resumirAntecedentes(a: Antecedentes): ResumenAntecedentes {
  const contrato = { ambito: 'contrato', ediciones: a.ediciones, indicios: a.indicios };
  const peor = [
    contrato,
    ...a.lotes.map((l) => ({ ambito: `lote ${l.id}`, ediciones: l.ediciones, indicios: l.indicios })),
  ].reduce((m, x) => (x.indicios.puntos > m.indicios.puntos ? x : m));
  const incumbente = peor.indicios.indicios.find((i) => i.codigo === 'incumbente')?.dato ?? null;
  return {
    nivel: a.nivel,
    ambito: peor.ambito,
    puntos: peor.indicios.puntos,
    ediciones: new Set(peor.ediciones.map((h) => h.licitacion_id)).size,
    incumbente,
    indicios: peor.indicios.indicios.filter((i) => i.peso > 0).map((i) => `${i.titulo}: ${i.dato}`),
    lotes: a.lotes.filter((l) => l.indicios.nivel !== 'bajo').map((l) => ({ id: l.id, nivel: l.indicios.nivel })),
  };
}

export function resumenAntecedentes(db: Db, id: string, cache: CacheOrganos = new Map()): Result<ResumenAntecedentes> {
  const a = antecedentesDe(db, id, { limite: 12 }, cache);
  return a.error ? a : ok(resumirAntecedentes(a.data));
}
