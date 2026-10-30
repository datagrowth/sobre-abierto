// Resumen de la memoria para «Revisar lo que hizo Hermes», porque la persona no lee las 13 páginas.
import type { Router } from 'express';
import { z } from 'zod';
import { listarPersonas } from '../../../nucleo/colaboradores/personas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { sinMarcas } from '../../../nucleo/documentos/marcas.js';
import { invalido, responder } from '../../../nucleo/http.js';
import { conQuien } from '../../../nucleo/permisos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { leerPerfilCostes } from '../../../nucleo/perfilCostes.js';
import { dbLicitaciones } from '../db.js';
import { fichasDe } from '../ficha.js';
import { conId } from '../http.js';
import { lotesDeLicitacion } from '../lotes.js';
import { revisarIa, RevisionBorrador, type EstadoRevision, type RevisionBorradorData } from '../propuestas/revision.js';
import { obtenerLicitacion, type Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { leerPlan } from './anexoPlan.js';
import { hallazgosDe, textoParaCoherencia } from './coherenciaMemoria.js';
import {
  coherenciaCompromisos,
  noPrometerDe,
  type Choque,
  type DatoAnexo,
  type TipoChoque,
} from './coherenciaCompromisos.js';
import { totalEnRiesgo } from './comprobacionesReglasCostes.js';
import {
  compromisosDetallados,
  enLaFicha,
  justificacionDeFicha,
  type ClaseCompromiso,
  type CompromisoDeFicha,
  type CompromisoDetallado,
} from './costesCompromisos.js';
import { textoParaCostes } from './costesTexto.js';
import { criticasDe } from './critica.js';
import { decisionesDe } from './decisiones.js';
import { apartadosDe, filaMemoria, pideFirmaFinal, PREFIJO_AVISO_FIRMA, type FilaMemoria } from './ensamblado.js';
import { estrategiaDe, type HechoData } from './estrategia.js';
import { importesSueltos } from './fugas.js';
import { avisosDeFugas, datosDeFila } from './fugasMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { ofertaParaLotes } from './guionLotes.js';
import { textoDeHallazgo, type Hallazgo } from './hechos.js';
import { lotesMencionados } from './lotesMencionados.js';
import { memoriasDe, type EstadoMemoria } from './memoria.js';
import type { ApartadoDatosData } from './memoriaRevision.js';
import { pasajesParaCompromisos } from './pliegoCompromisos.js';
import { propuestaDecisionesDe } from './propuestaDecisiones.js';
import { cerrarTarjeta, tarjetasDe, USUARIO_POR_DEFECTO } from './revisionHermes.js';

// Lee la hoja de compromisos (hechos de la memoria o compromisos de cada apartado en una versión subida a mano)
// cruzada con decisiones, pliego y anexos; hasta 5 párrafos marcados por el crítico o la coherencia con su texto
// en cada ronda; la nota del crítico ciego con su margen (la autoevaluación infla 6-8 puntos: nunca sale como
// nota); lo comprobado; y lo que cuesta cumplir lo prometido (horas que el pliego no pedía), con euros porque es
// solo de la web. «Dar por buena» enseña antes lo que se acepta y pide motivo si queda algo marcado o caro.
// apartado null: un hecho de la memoria, que vale para toda la memoria. choca: con qué no casa (null si casa).
export type Compromiso = {
  apartado: number | null;
  clave: string | null;
  categoria: string | null;
  que: string;
  quien: string | null;
  valor: string;
  choca: string | null;
};
type RondaParrafo = { ronda: number; texto: string | null };
// rondas: el párrafo en cada ronda de la memoria (null si en esa ronda no estaba); ahora: en la versión.
type Parrafo = {
  apartado: number;
  origen: 'critico' | 'coherencia' | 'compromisos';
  cita: string;
  motivo: string;
  arreglo: string | null;
  rondas: RondaParrafo[];
  ahora: string | null;
};
type NotaMemoria = { total: number; maximo: number; margen: number; fuente: 'critico_ciego' };
type AntesDeAceptar = {
  paginas: number | null;
  limite: number | null;
  avisos: string[];
  sin_redactar: number[];
  se_descartan: number[];
};
// Por qué se descartó cada versión anterior (su tarjeta en revision_tarjetas): un
// «versión descartada» sin motivo haría que la siguiente repitiera lo mismo.
type DescarteMemoria = { version: number; motivo: string | null; quien: string | null; en: string | null };
// Lo que cuesta cumplir lo que promete la memoria (costesCompromisos.ts). Lleva euros: solo lo ve
// la web, y el MCP los quita. caro: añadido por encima de los umbrales de Ajustes › Empresa que la
// ficha de solución no justifica. ficha: lo que dice de él la ficha (por qué compensa, que es
// exigido o que se quitó); null si no está en ella.
export type CompromisoCosteMemoria = {
  texto: string;
  cita: string | null;
  apartados: number[];
  clase: ClaseCompromiso;
  criterio: string | null;
  horas: number | null;
  euros: number | null;
  supuesto: string;
  barata: string;
  instruccion: string;
  caro: boolean;
  ficha: string | null;
  // La ficha de solución de la memoria ya lo decidió (compensa, exigido o quitado): no es caro ni se suaviza otra vez.
  justificado: boolean;
};
// cotejado: false si no se pudo leer el pliego (todo sale «añadido», sin cotejar).
// presupuesto_pct: los añadidos frente al presupuesto base del lote, en % (null sin presupuesto).
// total_riesgo: juntos pasan de umbral_total_pct (en %, el del perfil): la misma fila del total que las comprobaciones.
export type CostesMemoria = {
  cotejado: boolean;
  compromisos: CompromisoCosteMemoria[];
  total_anadidos: { horas: number; euros: number };
  caros: number;
  presupuesto_pct: number | null;
  umbral_total_pct: number;
  total_riesgo: boolean;
};
export type ResumenMemoria = {
  version: number;
  compromisos: Compromiso[];
  marcados: Parrafo[];
  nota: NotaMemoria | null;
  comprobado: string[];
  antes_de_aceptar: AntesDeAceptar;
  descartes: DescarteMemoria[];
  costes: CostesMemoria;
};
export type MemoriaAceptada = { version: number; estado: 'aceptada'; descartadas: number[] };

// Lo que puede bailar la nota del crítico ciego: el listón del banco evalMemorias admite la memoria a 3 puntos o menos de la versión hecha a mano, y es la única diferencia medida
// hasta ahora. Se cambia aquí cuando el banco mida la del crítico frente al juez.
export const MARGEN_CRITICO = 3;
// La persona lee 3-5 párrafos, no la memoria: más ya es leerla entera.
export const MAX_MARCADOS = 5;
export const MOTIVO_OBLIGATORIO = 'Queda algo marcado: di por qué la das por buena';

const log = logger('licitaciones');
const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

type Contexto = {
  db: Db;
  dbNucleo: DbNucleo;
  m: FilaMemoria;
  estado: EstadoMemoria;
  guion: GuionGuardado;
  // datos[i] y textos[i]: el apartado i+1 del guion (null o '' si no se redactó).
  datos: (ApartadoDatosData | null)[];
  textos: string[];
  hechos: HechoData[];
  hallazgos: Hallazgo[];
};

// ── Contexto ────────────────────────────────────────────────────────────────────────────────────

function contextoDe(db: Db, dbNucleo: DbNucleo, id: string, version: number): Result<Contexto> {
  const estado = memoriasDe(db, id).find((x) => x.version === version);
  const m = estado ? filaMemoria(db, estado.id) : null;
  if (!estado || !m) return fail('not_found', `No hay memoria v${version} en esta oferta.`);
  if (m.estado !== 'ensamblada')
    return fail('conflicto', `La memoria v${version} aún no está montada: el resumen sale al montarla.`);
  const guion = guionPorId(db, m.guion_id);
  if (!guion?.datos.memoria)
    return fail('conflicto', `El guion de la memoria v${version} ya no está: pide una memoria nueva.`);
  const filas = apartadosDe(db, m.id);
  const datos = guion.datos.memoria.apartados.map((_, i) => datosDeFila(filas.find((f) => f.apartado === i + 1)));
  return ok({
    db,
    dbNucleo,
    m,
    estado,
    guion,
    datos,
    textos: datos.map((d) => (d ? textoParaCoherencia(d) : '')),
    hechos: estrategiaDe(db, m.id)?.datos.hechos ?? [],
    hallazgos: hallazgosDe(m),
  });
}

// Lo que llevó cada anexo rellenado, dato a dato, como lo comparan las comprobaciones.
function anexosDe(db: Db, id: string): DatoAnexo[] {
  const filas = db.prepare('SELECT clave, sustituciones FROM oferta_documentos WHERE licitacion_id = ?').all(id) as {
    clave: string;
    sustituciones: string | null;
  }[];
  return filas.flatMap((f) => {
    const plan = leerPlan(f.sustituciones);
    if (!plan) return [];
    if (plan.formato === 'docx')
      return plan.items.map((x) => ({ clave: f.clave, dato: x.dato, valor: x.valor ?? x.nuevo }));
    return plan.campos
      .filter((c) => typeof c.valor === 'string')
      .map((c) => ({ clave: f.clave, dato: c.dato, valor: c.valor_hoja ?? String(c.valor) }));
  });
}

const compromisosV1 = (c: Contexto) =>
  c.datos.flatMap((d, i) => (d?.compromisos ?? []).map((x) => ({ apartado: i + 1, ...x })));

/** Lo que la memoria promete y no casa con el equipo, el pliego, los automáticos, lo que Hermes dijo no prometer o los anexos. */
function choquesDe(c: Contexto): Choque[] {
  const id = c.m.licitacion_id;
  const d = decisionesDe(c.db, id)?.datos ?? null;
  const nombres = new Map(listarPersonas(c.dbNucleo).map((p) => [p.id, p.nombre]));
  const p = propuestaDecisionesDe(c.db, id);
  return coherenciaCompromisos({
    textos: c.textos,
    compromisos: compromisosV1(c),
    decisiones: d,
    personas: [...nombres.values()],
    nombresEquipo: (d?.equipo ?? []).flatMap((x) => nombres.get(x.persona_id) ?? []),
    guion: c.guion.datos,
    plazos: (fichasDe(c.db, id).aprobada?.datos.hitos ?? []).map((h) => ({
      texto: [h.hito, h.detalle].filter(Boolean).join(': '),
      pagina: h.pagina ?? null,
    })),
    noPrometer: p ? noPrometerDe([p.datos.enfoque, p.datos.resumen, ...p.avisos]) : [],
    anexos: anexosDe(c.db, id),
  });
}

// ── Hoja de compromisos ─────────────────────────────────────────────────────────────────────────

const textoDeChoque = (x: Choque) => `«${x.encontrado}» frente a ${x.esperado}`;

function compromisosDe(c: Contexto, choques: Choque[]): Compromiso[] {
  if (c.m.fase !== null) {
    return c.hechos.map((h) => {
      const valor = `${h.valor}${h.unidad ? ` ${h.unidad}` : ''}`;
      const hallazgo = c.hallazgos.find((x) => x.hecho === h.clave);
      const choque = choques.find((x) => comparable(valor).includes(comparable(x.encontrado)));
      const choca = hallazgo ? textoDeHallazgo(hallazgo, c.hechos) : choque ? textoDeChoque(choque) : null;
      return { apartado: null, clave: h.clave, categoria: h.categoria, que: h.sobre, quien: null, valor, choca };
    });
  }
  return compromisosV1(c).map((x) => {
    const frase = comparable(`${x.que}: ${x.cuando_o_medida}`);
    const choque = choques.find((k) => k.apartado === x.apartado && frase.includes(comparable(k.encontrado)));
    return {
      apartado: x.apartado,
      clave: null,
      categoria: null,
      que: x.que,
      quien: x.quien || null,
      valor: x.cuando_o_medida,
      choca: choque ? textoDeChoque(choque) : null,
    };
  });
}

// ── Párrafos marcados ───────────────────────────────────────────────────────────────────────────

type Marca = Omit<Parrafo, 'rondas' | 'ahora'>;

function parrafosDe(d: ApartadoDatosData): string[] {
  return d.bloques
    .flatMap((b) => [
      ...b.parrafos,
      ...(b.lista ?? []),
      ...(b.lista_numerada ?? []),
      ...(b.tabla?.filas ?? []).map((f) => f.join(' | ')),
    ])
    .map(sinMarcas);
}

/** El número del párrafo que contiene la cita (con «…» entre trozos, basta el más largo); -1 si no está. */
function indiceCon(d: ApartadoDatosData | null, cita: string): number {
  const trozo =
    cita
      .split('…')
      .map((t) => comparable(t))
      .sort((a, b) => b.length - a.length)[0]
      ?.slice(0, 160) ?? '';
  if (!d || trozo.length < 5) return -1;
  return parrafosDe(d).findIndex((p) => comparable(p).includes(trozo));
}

// Los motivos para bajar de la crítica de la última ronda: lo que el crítico citó de la memoria.
function marcasDelCritico(c: Contexto): Marca[] {
  const ultima = criticasDe(c.db, c.m.id).at(-1);
  return (ultima?.datos.apartados ?? []).flatMap((a) =>
    a.motivos_para_bajar.map((x) => ({
      apartado: a.apartado,
      origen: 'critico' as const,
      cita: x.cita,
      motivo: x.motivo,
      arreglo: x.arreglo,
    })),
  );
}

// Lo que más cuesta si se escapa va antes: un plazo del pliego o una persona fuera del equipo.
const ORDEN_CHOQUE: Record<TipoChoque, number> = {
  plazo_guion: 0,
  persona_fuera: 1,
  no_prometer: 2,
  automatico_no_acogido: 3,
  anexo_distinto: 4,
};

function marcasDeCoherencia(c: Contexto, choques: Choque[]): Marca[] {
  const deHechos = c.hallazgos.map((h) => ({
    apartado: h.apartado,
    origen: 'coherencia' as const,
    cita: h.cita,
    motivo: textoDeHallazgo(h, c.hechos),
    arreglo: null,
  }));
  const deCompromisos = [...choques]
    .sort((a, b) => ORDEN_CHOQUE[a.tipo] - ORDEN_CHOQUE[b.tipo])
    .map((x) => ({
      apartado: x.apartado,
      origen: 'compromisos' as const,
      cita: x.cita,
      motivo: textoDeChoque(x),
      arreglo: null,
    }));
  return [...deHechos, ...deCompromisos];
}

type FilaRonda = { apartado: number; ronda: number; datos: string };

// La cita es del texto criticado: en la ronda en que se reescribió ya no está, y el «después» es
// el párrafo que ocupa su sitio (el mismo número de párrafo del apartado).
function conRondas(c: Contexto, marcas: Marca[]): Parrafo[] {
  const filas = c.db
    .prepare('SELECT apartado, ronda, datos FROM memoria_apartado_rondas WHERE memoria_id = ? ORDER BY ronda')
    .all(c.m.id) as FilaRonda[];
  return marcas.map((x) => {
    const versiones = filas
      .filter((f) => f.apartado === x.apartado)
      .map((f) => ({ ronda: f.ronda, d: datosDeFila({ estado: 'recibido', datos: f.datos }) }));
    const actual = c.datos[x.apartado - 1] ?? null;
    const indice =
      [actual, ...versiones.map((v) => v.d).reverse()].map((d) => indiceCon(d, x.cita)).find((i) => i >= 0) ?? -1;
    const en = (d: ApartadoDatosData | null): string | null => {
      if (!d || indice < 0) return null;
      const i = indiceCon(d, x.cita);
      return parrafosDe(d)[i >= 0 ? i : indice] ?? null;
    };
    return { ...x, ahora: en(actual), rondas: versiones.map((v) => ({ ronda: v.ronda, texto: en(v.d) })) };
  });
}

function marcadosDe(c: Contexto, choques: Choque[], enLote: (t: string) => boolean): Parrafo[] {
  const vistos = new Set<string>();
  const unicas = [...marcasDelCritico(c), ...marcasDeCoherencia(c, choques)].filter((x) => {
    const k = `${x.apartado}|${comparable(x.cita)}`;
    if (vistos.has(k) || !enLote(x.cita)) return false;
    vistos.add(k);
    return true;
  });
  return conRondas(c, unicas.slice(0, MAX_MARCADOS));
}

// ── Nota, lo comprobado y lo que se acepta ──────────────────────────────────────────────────────

// Solo la del crítico ciego de la última ronda: si esa no fue ciega, no hay nota que enseñar.
function notaDe(c: Contexto): NotaMemoria | null {
  const ultima = criticasDe(c.db, c.m.id).at(-1);
  return ultima?.ciega
    ? { total: ultima.total, maximo: ultima.maximo, margen: MARGEN_CRITICO, fuente: 'critico_ciego' }
    : null;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

function comprobadoDeFugas(c: Contexto): string | null {
  const mem = c.guion.datos.memoria!;
  const otros = c.guion.datos.automaticos.filter((a) => comparable(a.archivo) !== comparable(mem.archivo));
  if (!c.guion.datos.automaticos.length) return 'No aplica: el pliego no tiene criterios automáticos';
  if (!otros.length) return 'No aplica: memoria y criterios van en el mismo archivo';
  if (c.estado.fugas.hallazgos.length) return null;
  const archivos = [...new Set(otros.map((a) => a.archivo))].join(' y ');
  return `0 fugas contra ${plural(otros.length, 'el criterio', `los ${otros.length} criterios`)} del ${archivos}`;
}

const importesDe = (c: Contexto) =>
  c.textos.flatMap((t, i) => importesSueltos(t).map((x) => ({ apartado: i + 1, importe: x })));

function comprobadoDe(c: Contexto): string[] {
  const firma = pideFirmaFinal(c.guion.datos.memoria!) && !c.estado.avisos.some((a) => a.includes(PREFIJO_AVISO_FIRMA));
  return [
    comprobadoDeFugas(c),
    importesDe(c).length ? null : '0 importes',
    firma ? 'Lugar de firma rellenado' : null,
  ].filter((x): x is string => x !== null);
}

// Las versiones que «Dar por buena» descarta: las mismas que descarta la revisión del borrador.
function seDescartan(db: Db, m: FilaMemoria): number[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT b.version FROM borradores b WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND b.estado <> 'descartada'
    AND b.id IS NOT ? AND b.version IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memorias x WHERE x.id = b.memoria_id AND x.ensayo = 1) ORDER BY b.version`,
      )
      .all(m.licitacion_id, m.borrador_id) as { version: number }[]
  ).map((f) => f.version);
}

function avisosDe(c: Contexto): string[] {
  const deApartados = c.estado.apartados.flatMap((a) => a.avisos.map((x) => `Apartado ${a.apartado}: ${x}`));
  const importes = importesDe(c).map(
    (x) => `Importe en el apartado ${x.apartado}: «${x.importe}». Comprueba que no es de la oferta económica.`,
  );
  return [...new Set([...c.estado.avisos, ...avisosDeFugas(c.estado.fugas.hallazgos), ...deApartados, ...importes])];
}

const MILES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

// Un añadido caro abierto pide motivo para «Dar por buena», como un párrafo marcado; también los
// añadidos que juntos pasan del umbral del presupuesto aunque ninguno lo pase solo.
function avisoDeCostes(k: CostesMemoria): string[] {
  if (!k.caros && k.total_riesgo) return [avisoDelTotal(k)];
  if (!k.caros) return [];
  const horas = MILES.format(k.compromisos.filter((x) => x.caro).reduce((a, x) => a + (x.horas ?? 0), 0));
  return [
    k.caros === 1
      ? `1 compromiso añadido caro (~${horas} h): suavízalo o di por qué lo mantienes`
      : `${k.caros} compromisos añadidos caros (~${horas} h): suavízalos o di por qué los mantienes`,
  ];
}

function avisoDelTotal(k: CostesMemoria): string {
  const n = k.compromisos.filter((x) => x.clase === 'anadido').length;
  return `Los ${n} compromisos añadidos suman ~${MILES.format(k.total_anadidos.horas)} h y juntos pasan del ${k.umbral_total_pct} % del presupuesto: suavízalos o di por qué los mantienes`;
}

function antesDeAceptar(c: Contexto, costes: CostesMemoria): AntesDeAceptar {
  return {
    paginas: c.estado.paginas ?? c.estado.paginas_estimadas,
    limite: c.estado.limite_paginas,
    avisos: [...avisosDe(c), ...avisoDeCostes(costes)],
    sin_redactar: c.datos.flatMap((d, i) => (d ? [] : [i + 1])),
    se_descartan: seDescartan(c.db, c.m),
  };
}

// ── Costes ──────────────────────────────────────────────────────────────────────────────────────

// El lote del que se habla: el pedido o, si el guion solo tiene uno, ese.
const loteDe = (g: GuionGuardado, lote: string | null): string | null => {
  const lotes = g.datos.lotes ?? [];
  return lote ?? (lotes.length === 1 ? lotes[0]! : null);
};

// Como precioSugerido: el del lote, el de su oferta económica en el guion o el del contrato.
function presupuestoDe(c: Contexto, lote: string | null): number | null {
  const id = c.m.licitacion_id;
  const delLote = lote ? lotesDeLicitacion(c.db, id)?.lotes.find((x) => x.id === lote)?.presupuesto_sin_iva : null;
  const base =
    delLote ||
    ofertaParaLotes(c.guion.datos, lote ? [lote] : [])?.presupuesto_base ||
    obtenerLicitacion(c.db, id)?.presupuesto_sin_iva;
  return base && base > 0 ? base : null;
}

type Umbral = { horas: number; euros: number };

const QUITADO_EN_FICHA = 'Se quitó en la ficha de solución: no debería estar en la memoria';

function aFila(x: CompromisoDetallado, u: Umbral, ficha: readonly CompromisoDeFicha[]): CompromisoCosteMemoria {
  const f = enLaFicha(x, ficha);
  const motivo = justificacionDeFicha(f);
  const justificado = motivo !== null || f?.quitado === true;
  const caro = x.clase === 'anadido' && !justificado && ((x.horas ?? 0) >= u.horas || (x.euros ?? 0) >= u.euros);
  const apartados = [...new Set(x.apariciones.flatMap((a) => (a.apartado === null ? [] : [a.apartado])))].sort(
    (a, b) => a - b,
  );
  return {
    texto: x.texto,
    cita: x.cita,
    apartados,
    clase: x.clase,
    criterio: x.criterio,
    horas: x.horas,
    euros: x.euros,
    supuesto: x.supuesto,
    barata: x.barata,
    instruccion: x.instruccion,
    caro,
    ficha: f?.quitado ? QUITADO_EN_FICHA : motivo,
    justificado,
  };
}

const suma = (xs: CompromisoCosteMemoria[], k: 'horas' | 'euros') => xs.reduce((a, x) => a + (x[k] ?? 0), 0);

// Umbral por fila (diseño, Ajustes › Empresa): ≥ umbral_horas o ≥ max(umbral_euros, % del presupuesto del lote).
function costesDe(c: Contexto, lote: string | null, enLote: (t: string) => boolean): CostesMemoria {
  const perfil = leerPerfilCostes(c.dbNucleo, nucleo().config.licitaciones.precioHora).perfil;
  const pliego = pasajesParaCompromisos(c.db, c.m.licitacion_id);
  const texto = c.datos.flatMap((d, i) => (d ? [textoParaCostes(d, i + 1)] : [])).join('\n\n');
  const presupuesto = presupuestoDe(c, loteDe(c.guion, lote));
  const u = {
    horas: perfil.umbral_horas,
    euros: Math.max(perfil.umbral_euros, perfil.umbral_pct_presupuesto * (presupuesto ?? 0)),
  };
  const ficha = estrategiaDe(c.db, c.m.id)?.datos.solucion?.compromisos ?? [];
  const filas = compromisosDetallados(texto, perfil, c.guion.datos, pliego)
    .filter((x) => enLote([x.texto, ...x.apariciones.map((a) => a.cita)].join(' ')))
    .map((x) => aFila(x, u, ficha));
  const anadidos = filas.filter((x) => x.clase === 'anadido');
  const total = { horas: suma(anadidos, 'horas'), euros: suma(anadidos, 'euros') };
  return {
    cotejado: pliego.cotejable,
    compromisos: filas,
    total_anadidos: total,
    caros: filas.filter((x) => x.caro).length,
    presupuesto_pct: presupuesto ? Math.round((total.euros / presupuesto) * 100) : null,
    umbral_total_pct: Math.round(perfil.umbral_total_pct * 100),
    total_riesgo: totalEnRiesgo(anadidos.length, total.euros, presupuesto, perfil),
  };
}

type MemoriaDeLote = { c: Contexto; enLote: (t: string) => boolean };

// El contexto de la memoria vN y el filtro de su lote, o por qué no se puede leer.
function memoriaDeLote(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  version: number,
  lote: string | null,
): Result<MemoriaDeLote> {
  const c = contextoDe(db, dbNucleo, id, version);
  if (c.error) return c;
  const lotes = c.data.guion.datos.lotes ?? [];
  if (lote && lotes.length && !lotes.includes(lote))
    return fail('not_found', `El lote ${lote} no está en el guion de la memoria v${version}.`);
  return ok({ c: c.data, enLote: filtroDeLote(c.data.guion, lote) });
}

/** Los compromisos con coste de la memoria vN (de un lote, si se pide). Lleva euros: quien se lo dé a un agente los quita. */
export function compromisosDeMemoria(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  version: number,
  lote: string | null = null,
): Result<CostesMemoria> {
  const r = memoriaDeLote(db, dbNucleo, id, version, lote);
  return r.error ? r : ok(costesDe(r.data.c, lote, r.data.enLote));
}

// ── Resumen ─────────────────────────────────────────────────────────────────────────────────────

// Un compromiso o un párrafo es del lote si no nombra ninguno o nombra ese.
function filtroDeLote(g: GuionGuardado, lote: string | null): (t: string) => boolean {
  const lotes = g.datos.lotes ?? [];
  if (!lote) return () => true;
  return (t) => {
    const ls = lotesMencionados(t, lotes);
    return !ls.length || ls.includes(lote);
  };
}

/** Lo que una persona tiene que leer de la memoria vN antes de darla por buena (de un lote, si se pide). */
type FilaDescarte = { clave: string; motivo: string | null; quien: string | null; cerrada_en: string | null };

/** Las otras versiones de la memoria descartadas desde su tarjeta, con su motivo y quién. */
function descartesDe(db: Db, id: string, version: number): DescarteMemoria[] {
  const filas = db
    .prepare(
      `SELECT clave, motivo, quien, cerrada_en FROM revision_tarjetas
    WHERE licitacion_id = ? AND tipo = 'memoria' AND estado = 'descartada'`,
    )
    .all(id) as FilaDescarte[];
  return filas
    .flatMap((f) => {
      const v = Number(/^memoria:v(\d+)$/.exec(f.clave)?.[1]);
      return Number.isInteger(v) && v !== version
        ? [{ version: v, motivo: f.motivo, quien: f.quien, en: f.cerrada_en }]
        : [];
    })
    .sort((a, b) => a.version - b.version);
}

export function resumenMemoria(
  db: Db,
  dbNucleo: DbNucleo,
  id: string,
  version: number,
  lote: string | null = null,
): Result<ResumenMemoria> {
  const r = memoriaDeLote(db, dbNucleo, id, version, lote);
  if (r.error) return r;
  const { c, enLote } = r.data;
  const choques = choquesDe(c);
  const costes = costesDe(c, lote, enLote);
  return ok({
    version,
    compromisos: compromisosDe(c, choques).filter((x) => enLote(`${x.que} ${x.quien ?? ''} ${x.valor}`)),
    marcados: marcadosDe(c, choques, enLote),
    nota: notaDe(c),
    comprobado: comprobadoDe(c),
    antes_de_aceptar: antesDeAceptar(c, costes),
    descartes: descartesDe(db, id, version),
    costes,
  });
}

// ── Dar por buena ───────────────────────────────────────────────────────────────────────────────

// El motivo es de lo marcado; las fugas entre sobres (causa de exclusión) solo se anulan con su
// propia explicación, como al revisar el borrador.
export type Aceptacion = { motivo?: string | undefined; anular_fugas?: string | undefined; quien: string };

const quedaAlgo = (r: ResumenMemoria): boolean =>
  r.marcados.length > 0 || r.antes_de_aceptar.avisos.length > 0 || r.antes_de_aceptar.sin_redactar.length > 0;

// Un fallo dentro de la transacción la deshace entera: ni la tarjeta cerrada ni el borrador tocado.
class Rechazo extends Error {
  constructor(readonly r: Result<never>) {
    super('rechazo');
  }
}

function aceptarEnTransaccion(db: Db, m: FilaMemoria, borradorId: number, a: Aceptacion): void {
  const clave = `memoria:v${m.version}`;
  const pendiente = tarjetasDe(db, m.licitacion_id, a.quien).some((t) => t.clave === clave && t.estado === 'pendiente');
  const motivo = a.motivo?.trim() || undefined;
  if (pendiente) {
    const t = cerrarTarjeta(db, m.licitacion_id, clave, { accion: 'aceptar', motivo, quien: a.quien });
    if (t.error) throw new Rechazo(t);
  }
  const r = revisarIa(db, 'borradores', borradorId, {
    decision: 'aceptar',
    ...(a.anular_fugas ? { anular_fugas: a.anular_fugas } : {}),
  });
  if (r.error) throw new Rechazo(r);
}

/**
 * Da por buena la memoria vN: con algo marcado, avisos o apartados sin redactar, solo con motivo.
 * Cierra su tarjeta de la bandeja y la acepta por la revisión de siempre del borrador, que descarta las demás versiones.
 */
export function aceptarMemoria(db: Db, id: string, version: number, a: Aceptacion): Result<MemoriaAceptada> {
  const r = resumenMemoria(db, nucleo().db, id, version);
  if (r.error) return r;
  if (quedaAlgo(r.data) && !a.motivo?.trim()) return fail('invalid_input', MOTIVO_OBLIGATORIO);
  const anular = RevisionBorrador.shape.anular_fugas.safeParse(a.anular_fugas);
  if (!anular.success) return fail('invalid_input', z.prettifyError(anular.error));
  const m = filaMemoria(db, memoriasDe(db, id).find((x) => x.version === version)!.id)!;
  const b =
    m.borrador_id === null
      ? undefined
      : (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(m.borrador_id) as { estado: string } | undefined);
  if (m.borrador_id === null || !b)
    return fail('conflicto', `La memoria v${version} no tiene documento montado que dar por buena.`);
  if (b.estado === 'aceptada') return fail('conflicto', `La memoria v${version} ya está dada por buena.`);
  try {
    db.transaction(() => aceptarEnTransaccion(db, m, m.borrador_id!, { ...a, anular_fugas: anular.data }))();
  } catch (err) {
    if (err instanceof Rechazo) return err.r;
    log.error('memoria sin dar por buena', { id, version, error: errorMessage(err) });
    return fail('io_error', 'No se pudo dar por buena la memoria.');
  }
  return ok({ version, estado: 'aceptada', descartadas: r.data.antes_de_aceptar.se_descartan });
}

// El PATCH /borradores/:n de siempre: motivo y quién solo cuentan al dar por buena una memoria.
export type RevisionDeBorrador = RevisionBorradorData & { motivo?: string | undefined; quien?: string | undefined };

const quedan = (n: number, uno: string, varios: string): string =>
  n === 1 ? `queda 1 ${uno}` : `quedan ${n} ${varios}`;

// Lo que pide el motivo, dicho en la respuesta del PATCH (quien lo llama no ve el resumen).
function loQueQueda(r: ResumenMemoria): string {
  const {
    marcados,
    antes_de_aceptar: { avisos, sin_redactar },
  } = r;
  if (marcados.length) return quedan(marcados.length, 'párrafo marcado', 'párrafos marcados');
  if (avisos.length) return quedan(avisos.length, 'aviso', 'avisos');
  return quedan(sin_redactar.length, 'apartado sin redactar', 'apartados sin redactar');
}

const memoriaDelBorrador = (db: Db, borradorId: number) =>
  db
    .prepare('SELECT licitacion_id, version FROM memorias WHERE borrador_id = ? AND ensayo = 0 AND presentada = 0')
    .get(borradorId) as { licitacion_id: string; version: number } | undefined;

/**
 * Revisa un borrador por el PATCH de siempre. Dar por buena una memoria de trabajo va siempre por
 * aceptarMemoria, como «Dar por buena» del resumen: el mismo criterio para pedir el motivo (párrafos
 * marcados, avisos o apartados sin redactar), su tarjeta cerrada y, si el resumen no se puede
 * calcular, su error; si no, el PATCH sería un atajo para saltárselo. Lo demás, como siempre.
 */
export function revisarBorrador(
  db: Db,
  borradorId: number,
  r: RevisionDeBorrador,
): Result<{ id: number; estado: EstadoRevision }> {
  const m = r.decision === 'aceptar' ? memoriaDelBorrador(db, borradorId) : undefined;
  if (!m)
    return revisarIa(db, 'borradores', borradorId, {
      decision: r.decision,
      ...(r.anular_fugas ? { anular_fugas: r.anular_fugas } : {}),
    });
  const resumen = resumenMemoria(db, nucleo().db, m.licitacion_id, m.version);
  if (resumen.error) return resumen;
  if (quedaAlgo(resumen.data) && !r.motivo?.trim())
    return fail('invalid_input', `${MOTIVO_OBLIGATORIO} (${loQueQueda(resumen.data)}).`);
  const a = aceptarMemoria(db, m.licitacion_id, m.version, {
    motivo: r.motivo,
    anular_fugas: r.anular_fugas,
    quien: r.quien ?? USUARIO_POR_DEFECTO,
  });
  return a.error ? a : ok({ id: borradorId, estado: 'aceptada' });
}

// ── API web ─────────────────────────────────────────────────────────────────────────────────────

const Version = z.coerce.number().int().positive();
const ConsultaResumen = z.object({ lote: z.string().trim().min(1).max(20).optional() });
const AceptarMemoria = z.strictObject({
  motivo: z.string().trim().min(5, 'Escribe el motivo en pocas palabras.').max(1000).optional(),
  anular_fugas: RevisionBorrador.shape.anular_fugas,
  quien: z.string().trim().min(2).max(60).optional(),
});

export function rutasResumenMemoria(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/memoria/:version/resumen',
    conId((id, req, res) => {
      const v = Version.safeParse(req.params['version']);
      if (!v.success) return invalido(res, v.error);
      const q = ConsultaResumen.safeParse(req.query);
      if (!q.success) return invalido(res, q.error);
      responder(res, resumenMemoria(dbLicitaciones(), nucleo().db, id, v.data, q.data.lote ?? null));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/memoria/:version/aceptar',
    conId((id, req, res) => {
      const v = Version.safeParse(req.params['version']);
      if (!v.success) return invalido(res, v.error);
      const e = AceptarMemoria.safeParse(conQuien(req));
      if (!e.success) return invalido(res, e.error);
      responder(
        res,
        aceptarMemoria(dbLicitaciones(), id, v.data, {
          motivo: e.data.motivo,
          anular_fugas: e.data.anular_fugas,
          quien: e.data.quien ?? USUARIO_POR_DEFECTO,
        }),
      );
    }),
  );
}
