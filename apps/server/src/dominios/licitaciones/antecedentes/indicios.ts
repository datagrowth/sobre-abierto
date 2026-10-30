// Indicios de «licitación con nombre»: patrones de una licitación pensada para quien ya presta el servicio.
import { percentil } from '../../../nucleo/estadistica.js';
import { plausible } from '../precios/segmento.js';
import { textoBase } from './texto.js';
import type { DuracionData, Hito } from './linea.js';

// No prueban nada; cada indicio lleva su explicación y el dato del que sale, y el nivel se calcula con reglas
// fijas (REGLAS).
type Origen = 'historico' | 'licitacion' | 'pliego';
export type Indicio = {
  codigo: string;
  titulo: string;
  explicacion: string;
  dato: string;
  peso: number;
  origen: Origen;
};
export type Nivel = 'bajo' | 'medio' | 'alto';
export type Indicios = { nivel: Nivel; puntos: number; indicios: Indicio[]; sin_datos: string[] };

// Por debajo de un 2 % el ganador ofertó prácticamente el presupuesto (con una sola
// oferta la baja media de la PLACSP ya es del ~4 %).
const BAJA_MINIMA = 0.02;
// El contrato nuevo «enlaza» si empieza entre un mes antes y 45 días después del fin del anterior.
const ENLACE_DIAS = { antes: 31, despues: 45 };
// Referencias de solvencia de la LCSP (ver SOLVENCIA): tope del volumen de negocio frente al
// valor estimado (art. 87.1.a) y supletorio de trabajos similares frente a la anualidad media (art. 90).
const TOPE_VOLUMEN = 1.5;
const REFERENCIA_TRABAJOS = 0.7;
const PUNTOS_MEDIO = 3;
const PUNTOS_ALTO = 5;
// El pliego suma como mucho estos puntos, por muchas señales que lleve.
const MAX_PLIEGO = 4;

const DIA = 86_400_000;
const FECHA = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const EUROS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const fecha = (f: string) => FECHA.format(new Date(`${f.slice(0, 10)}T00:00:00Z`));
const dias = (desde: string, hasta: string) => Math.floor((Date.parse(hasta) - Date.parse(desde)) / DIA);
const lista = (anios: string[]) => [...new Set(anios)].join(', ');

type Ganador = { clave: string; nif: string | null; nombre: string };
type Edicion = { id: string; anio: string; hitos: Hito[]; ganadores: Map<string, Ganador> };

function ganadorDe(h: Hito): Ganador | null {
  if (!h.adjudicada || (!h.adjudicatario_nif && !h.adjudicatario_nombre)) return null;
  const clave = h.adjudicatario_nif ?? textoBase(h.adjudicatario_nombre ?? '');
  return { clave, nif: h.adjudicatario_nif, nombre: h.adjudicatario_nombre ?? h.adjudicatario_nif ?? '' };
}

/** Las filas agrupadas por edición, de la más reciente a la más antigua. */
function ediciones(hitos: Hito[]): Edicion[] {
  const porId = new Map<string, Edicion>();
  for (const h of [...hitos].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    const e: Edicion = porId.get(h.licitacion_id) ?? {
      id: h.licitacion_id,
      anio: h.anio,
      hitos: [],
      ganadores: new Map(),
    };
    e.hitos.push(h);
    const g = ganadorDe(h);
    if (g) e.ganadores.set(g.clave, g);
    porId.set(h.licitacion_id, e);
  }
  return [...porId.values()];
}

type Incumbente = Ganador & { racha: Edicion[] };

/** Quien ganó la última edición adjudicada y en cuántas seguidas (hacia atrás) ganó. */
function incumbente(eds: Edicion[]): Incumbente | null {
  const adjudicadas = eds.filter((e) => e.ganadores.size);
  let mejor: Incumbente | null = null;
  for (const g of adjudicadas[0]?.ganadores.values() ?? []) {
    const corte = adjudicadas.findIndex((e) => !e.ganadores.has(g.clave));
    const racha = corte === -1 ? adjudicadas : adjudicadas.slice(0, corte);
    if (!mejor || racha.length > mejor.racha.length) mejor = { ...g, racha };
  }
  return mejor;
}

const quien = (g: Ganador) => (g.nif ? `${g.nombre} (${g.nif})` : g.nombre);

function indicioIncumbente(inc: Incumbente): Indicio {
  const n = inc.racha.length;
  const anios = lista(inc.racha.map((e) => e.anio));
  return {
    codigo: 'incumbente',
    origen: 'historico',
    peso: Math.min(3, n),
    titulo: n > 1 ? 'Mismo adjudicatario en las ediciones anteriores' : 'Hay un adjudicatario anterior',
    explicacion:
      'Quien ya presta el servicio conoce el contrato y los pliegos suelen escribirse a partir de cómo lo hace: cuantas más ediciones seguidas gana, más probable es que la licitación esté pensada a su medida.',
    dato:
      n > 1
        ? `${quien(inc)} ganó las ${n} últimas ediciones adjudicadas (${anios}).`
        : `${quien(inc)} ganó la última edición (${anios}).`,
  };
}

type OfertasEdicion = { e: Edicion; una: boolean; pocas: boolean };

// Por lote: una edición cuenta como «con una oferta» (o «con pocas») si la mitad o más de
// sus adjudicaciones con dato lo fueron. Un solo lote con una oferta no marca un contrato de diez.
function ofertasDe(e: Edicion): OfertasEdicion | null {
  const conDato = e.hitos.map((h) => h.ofertas).filter((o): o is number => o !== null && o >= 1);
  if (!conDato.length) return null;
  const mitad = conDato.length / 2;
  return {
    e,
    una: conDato.filter((o) => o === 1).length >= mitad,
    pocas: conDato.filter((o) => o <= 2).length >= mitad,
  };
}

function indicioOfertas(eds: Edicion[]): Indicio | null {
  const conDato = eds.map(ofertasDe).filter((x): x is OfertasEdicion => x !== null);
  const conUna = conDato.filter((x) => x.una);
  const pocas = conDato.length >= 2 && conDato.every((x) => x.pocas);
  if (!conUna.length && !pocas) return null;
  const anios = lista(conUna.map((x) => x.e.anio));
  const una =
    conDato.length === 1
      ? `1 sola oferta en la única edición con dato (${anios}).`
      : `1 sola oferta en ${conUna.length} de ${conDato.length} ediciones con dato (${anios}).`;
  const dato = conUna.length ? una : `Como mucho 2 ofertas en las ${conDato.length} ediciones con dato.`;
  return {
    codigo: 'pocas_ofertas',
    origen: 'historico',
    peso: conUna.length >= 2 ? 2 : 1,
    titulo: 'Ediciones con una oferta o muy pocas',
    dato,
    explicacion:
      'Si casi nadie más se presenta, el mercado suele leer que la licitación tiene dueño. En la PLACSP lo normal es más competencia: la baja media pasa del 4 % con una oferta al 24 % con diez o más.',
  };
}

function indicioBajas(inc: Incumbente): Indicio | null {
  // Las bajas imposibles (y la baja 0 con varias ofertas: precios unitarios) no cuentan, como
  // en Precios. Tampoco las de una sola oferta: sin competencia, la baja casi nula es lo
  // esperable y ese hecho ya puntúa en «pocas_ofertas».
  const bajas = inc.racha
    .flatMap((e) => e.hitos)
    .filter(
      (h) => ganadorDe(h)?.clave === inc.clave && h.baja !== null && h.ofertas !== 1 && plausible(h.baja, h.ofertas),
    )
    .map((h) => h.baja as number)
    .sort((a, b) => a - b);
  const mediana = percentil(bajas, 0.5);
  if (mediana === null || mediana >= BAJA_MINIMA) return null;
  return {
    codigo: 'bajas_minimas',
    origen: 'historico',
    peso: bajas.length >= 2 ? 2 : 1,
    titulo: 'Bajas mínimas del adjudicatario anterior',
    explicacion: `Ganar ofertando prácticamente el presupuesto (baja por debajo del ${PCT.format(BAJA_MINIMA * 100)} %) indica que no tuvo que competir en precio.`,
    dato: `${quien(inc)}: baja mediana del ${PCT.format(mediana * 100)} % en ${bajas.length === 1 ? 'su adjudicación' : `sus ${bajas.length} adjudicaciones`}.`,
  };
}

type FinAnterior = { fin: string; estimado: boolean };

function finDelIncumbente(inc: Incumbente): FinAnterior | null {
  const h = inc.racha[0]?.hitos.find((x) => ganadorDe(x)?.clave === inc.clave && x.fin);
  return h?.fin ? { fin: h.fin, estimado: h.fin_estimado } : null;
}

function indicioContinuidad(inc: Incumbente, inicio: string | null, sinDatos: string[]): Indicio | null {
  const anterior = finDelIncumbente(inc);
  if (!inicio || !anterior) {
    sinDatos.push('Continuidad: falta el inicio previsto del contrato nuevo o el fin del anterior.');
    return null;
  }
  const d = dias(anterior.fin, inicio);
  if (d < -ENLACE_DIAS.antes || d > ENLACE_DIAS.despues) return null;
  return {
    codigo: 'continuidad',
    origen: 'historico',
    peso: 1,
    titulo: 'El contrato nuevo empieza al acabar el del adjudicatario anterior',
    explicacion:
      'Una licitación que se resuelve justo para enlazar con el contrato que termina deja poco margen a otro para organizarse y entrar; quien ya lo presta sigue sin cortes.',
    dato: `El contrato de ${quien(inc)} termina el ${fecha(anterior.fin)}${anterior.estimado ? ' (estimado con su inicio y su duración)' : ''} y el nuevo empieza el ${fecha(inicio)}.`,
  };
}

/** Indicios que salen de las ediciones anteriores. */
export function indiciosHistoricos(hitos: Hito[], inicioNuevo: string | null, sinDatos: string[]): Indicio[] {
  const eds = ediciones(hitos);
  if (!eds.length) {
    sinDatos.push('No hay ediciones anteriores en el histórico cargado.');
    return [];
  }
  const inc = incumbente(eds);
  const ofertas = indicioOfertas(eds);
  if (!inc) return ofertas ? [ofertas] : [];
  return [indicioIncumbente(inc), ofertas, indicioBajas(inc), indicioContinuidad(inc, inicioNuevo, sinDatos)].filter(
    (i): i is Indicio => i !== null,
  );
}

// Mínimos de la LCSP sin regulación armonizada, en días naturales desde el anuncio:
// abierto, 15, y 26 en obras y concesiones (art. 156.6); simplificado, 15, y 20 en obras
// (art. 159.3); simplificado sumario (art. 159.6: obras de menos de 80.000 € y servicios o
// suministros de menos de 60.000 € de valor estimado), 10 días hábiles (unos 14 naturales) y
// 5 hábiles (unos 7) en compras corrientes de bienes, que aquí son todos los suministros
// porque no se distinguen. El margen de 2 días absorbe cómo se cuenta (día siguiente, festivos).
// Publicar en el mínimo es lo habitual (medido: más de un tercio de las licitaciones), así
// que solo puntúa lo que queda por debajo; el plazo en el mínimo se muestra con 0 puntos.
const MARGEN_PLAZO = 2;
const OBRAS = new Set(['3', '31', '32']);
const CONCESIONES = new Set(['3', '21', '22', '31', '32']);
const SUMARIO = { obras: 80_000, resto: 60_000 };
// Umbral más bajo de regulación armonizada en servicios y suministros (art. 22, lo revisa la
// Comisión cada dos años) y el de obras, redondeados: por encima, el mínimo podría ser mayor.
const POSIBLE_SARA = { obras: 5_000_000, resto: 140_000 };

export type Plazo = {
  publicada_en: string | null;
  fecha_limite: string | null;
  procedimiento: string | null;
  tipo_contrato: string | null;
  importe: number | null;
};
type Regla = { minimo: number; nombre: string };

function reglaPlazo(p: Plazo): Regla | null {
  const tipo = p.tipo_contrato ?? '';
  const obras = OBRAS.has(tipo);
  if (p.procedimiento === '1') {
    return CONCESIONES.has(tipo)
      ? { minimo: 26, nombre: 'abierto de obras o concesión: 26 días naturales (art. 156.6 LCSP)' }
      : { minimo: 15, nombre: 'abierto: 15 días naturales (art. 156.6 LCSP)' };
  }
  if (p.procedimiento !== '9') return null;
  const sumario = p.importe === null || p.importe < (obras ? SUMARIO.obras : SUMARIO.resto);
  if (!sumario)
    return obras
      ? { minimo: 20, nombre: 'simplificado de obras: 20 días naturales (art. 159.3 LCSP)' }
      : { minimo: 15, nombre: 'simplificado: 15 días naturales (art. 159.3 LCSP)' };
  return tipo === '1'
    ? {
        minimo: 7,
        nombre: 'simplificado sumario de bienes corrientes: 5 días hábiles, unos 7 naturales (art. 159.6 LCSP)',
      }
    : { minimo: 14, nombre: 'simplificado sumario: 10 días hábiles, unos 14 naturales (art. 159.6 LCSP)' };
}

function avisoArmonizada(p: Plazo, sinDatos: string[]): void {
  const umbral = OBRAS.has(p.tipo_contrato ?? '') ? POSIBLE_SARA.obras : POSIBLE_SARA.resto;
  if (p.procedimiento === '1' && p.importe !== null && p.importe >= umbral) {
    sinDatos.push(
      'Plazo: la PLACSP no dice si está sujeta a regulación armonizada; se mide con el mínimo no armonizado (si lo está, el mínimo es mayor, art. 156.2).',
    );
  }
}

export function indicioPlazo(p: Plazo, sinDatos: string[]): Indicio | null {
  const regla = reglaPlazo(p);
  if (!regla) return null;
  if (!p.publicada_en || !p.fecha_limite) {
    sinDatos.push('Plazo: la PLACSP no publica la fecha del anuncio o el fin de plazo.');
    return null;
  }
  avisoArmonizada(p, sinDatos);
  const n = dias(p.publicada_en, p.fecha_limite);
  if (n > regla.minimo + MARGEN_PLAZO) return null;
  const debajo = n < regla.minimo - MARGEN_PLAZO;
  return {
    codigo: 'plazo_corto',
    origen: 'licitacion',
    peso: debajo ? 2 : 0,
    titulo: debajo ? 'Plazo de presentación por debajo del mínimo legal' : 'Plazo de presentación en el mínimo legal',
    explicacion: debajo
      ? `Con un plazo tan corto solo llega a tiempo con una buena oferta quien ya conoce el servicio. Mínimo del procedimiento ${regla.nombre}; por debajo solo cabe en casos tasados (como la tramitación urgente) o es un dato mal publicado: compruébalo en el anuncio.`
      : `Mínimo del procedimiento ${regla.nombre}. Publicar en el mínimo es lo habitual, así que no suma puntos: se muestra porque deja poco margen a quien no conoce el servicio.`,
    dato: `${n} días naturales entre el anuncio (${fecha(p.publicada_en)}) y el fin de plazo (${fecha(p.fecha_limite)}).`,
  };
}

// valor: contra qué se mide el requisito (el valor estimado del contrato o el de su lote).
export type ReqSolvencia = { clase: string; codigo: string | null; umbral: number | null; valor: number | null };
export type Solvencia = { requisitos: ReqSolvencia[]; duracion: DuracionData };

const ANIOS_POR_UNIDAD: Record<string, number> = { ANN: 1, MON: 1 / 12, WEE: 7 / 365, DAY: 1 / 365 };

// Años de contrato para la anualidad media; uno si dura menos o no se sabe.
function anios(d: DuracionData): number {
  const factor = d ? ANIOS_POR_UNIDAD[d.unidad] : undefined;
  return d && factor ? Math.max(1, d.valor * factor) : 1;
}

type Medida = {
  base: (valor: number, d: DuracionData) => number;
  maximo: number;
  que: string;
  frente: string;
  explicacion: string;
};

// Volumen de negocio: el tope legal es 1,5 veces el valor estimado salvo casos justificados
// (art. 87.1.a LCSP); con un 10 % de margen, porque muchos pliegos piden exactamente el
// supletorio (1,5 veces la anualidad media, art. 87.3.a) y con redondeos queda en 1,5x.
// Medido sobre datos de la PLACSP: pasa de 1,65 veces el 2 % de los requisitos. Trabajos
// similares: sin otra cifra, el 70 % de la anualidad media (art. 90); marca más del doble.
const SOLVENCIA: Record<string, Medida> = {
  '5': {
    base: (v) => v,
    maximo: TOPE_VOLUMEN * 1.1,
    que: 'volumen anual de negocio',
    frente: 'el valor estimado',
    explicacion: `La LCSP limita el volumen anual de negocio exigido a ${PCT.format(TOPE_VOLUMEN)} veces el valor estimado del contrato, salvo casos justificados (art. 87.1.a). Pedir más deja fuera a empresas capaces y deja dentro a pocas: mira si el pliego lo justifica.`,
  },
  'OSR-COMPTASK': {
    base: (v, d) => v / anios(d),
    maximo: REFERENCIA_TRABAJOS * 2,
    que: 'trabajos similares (importe anual)',
    frente: 'la anualidad media',
    explicacion: `Si el pliego no fija otra cifra, la LCSP toma como referencia en trabajos similares el ${PCT.format(REFERENCIA_TRABAJOS * 100)} % de la anualidad media (art. 90); aquí se marca lo que pasa del doble. Pedir mucha más experiencia deja dentro a pocas empresas.`,
  },
};

type Exceso = { r: ReqSolvencia & { umbral: number; valor: number }; m: Medida; ratio: number; base: number };

function exceso(r: ReqSolvencia, d: DuracionData): Exceso | null {
  const m = SOLVENCIA[r.codigo ?? ''];
  // Por debajo de 1.000 € el «umbral» es un ratio o un número de trabajos, no un importe.
  if (!m || r.umbral === null || r.umbral < 1000 || !r.valor) return null;
  const base = m.base(r.valor, d);
  const ratio = r.umbral / base;
  return ratio > m.maximo ? { r: { ...r, umbral: r.umbral, valor: r.valor }, m, ratio, base } : null;
}

/** Volumen de negocio por encima del tope legal o trabajos similares por encima del doble de su referencia. */
export function indicioSolvencia(s: Solvencia): Indicio | null {
  const x = s.requisitos
    .map((r) => exceso(r, s.duracion))
    .filter((e): e is Exceso => e !== null)
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (!x) return null;
  return {
    codigo: 'solvencia_alta',
    origen: 'licitacion',
    peso: 2,
    titulo: 'Solvencia exigida muy por encima de la referencia legal',
    explicacion: x.m.explicacion,
    dato: `Pide ${EUROS.format(x.r.umbral)} € de ${x.m.que}: ${PCT.format(x.ratio)} veces ${x.m.frente} (${EUROS.format(x.base)} €).`,
  };
}

export const TIPOS_SENAL = [
  'experiencia_especifica',
  'tecnologia_especifica',
  'marca_o_compatibilidad',
  'juicio_valor_favorece',
  'solvencia_a_medida',
  'otra',
] as const;
// lote: la señal es de un lote concreto (solo cuenta en él); sin lote, de todo el contrato.
export type Senal = {
  tipo: (typeof TIPOS_SENAL)[number];
  descripcion: string;
  cita?: string | undefined;
  documento?: string | undefined;
  pagina?: number | undefined;
  lote?: string | undefined;
};

const SENALES: Record<Senal['tipo'], string> = {
  experiencia_especifica: 'Experiencia muy específica',
  tecnologia_especifica: 'Tecnología o herramienta concreta',
  marca_o_compatibilidad: 'Marca o compatibilidad obligatoria',
  juicio_valor_favorece: 'Criterio de juicio de valor que favorece a quien ya lo presta',
  solvencia_a_medida: 'Solvencia a medida',
  otra: 'Otra señal del pliego',
};

/** Señales del pliego de la ficha aprobada. Marcas y compatibilidad pesan 2 (art. 126.6 LCSP: «o equivalente»). */
export function indiciosDePliego(senales: Senal[]): Indicio[] {
  let restante = MAX_PLIEGO;
  return senales.flatMap((s): Indicio[] => {
    const peso = Math.min(restante, s.tipo === 'marca_o_compatibilidad' ? 2 : 1);
    restante -= peso;
    const donde = [s.documento, s.pagina ? `pág. ${s.pagina}` : null].filter(Boolean).join(', ');
    return [
      {
        codigo: `pliego_${s.tipo}`,
        origen: 'pliego',
        peso,
        titulo: SENALES[s.tipo],
        explicacion: s.descripcion,
        dato: `${s.cita ? `«${s.cita}»` : 'Señalado en la ficha aprobada'}${donde ? ` (${donde})` : ''}.`,
      },
    ];
  });
}

export function nivelDe(puntos: number): Nivel {
  return puntos >= PUNTOS_ALTO ? 'alto' : puntos >= PUNTOS_MEDIO ? 'medio' : 'bajo';
}

export function sumar(indicios: Indicio[], sinDatos: string[]): Indicios {
  const puntos = indicios.reduce((n, i) => n + i.peso, 0);
  return {
    nivel: nivelDe(puntos),
    puntos,
    indicios: [...indicios].sort((a, b) => b.peso - a.peso),
    sin_datos: sinDatos,
  };
}

export const REGLAS = `Puntos: mismo adjudicatario en las últimas ediciones seguidas, 1 por edición (máx. 3); ediciones con 1 oferta (en la mitad o más de sus lotes), 1 si hay una y 2 si hay dos o más (1 si todas tienen como mucho 2); baja mediana del adjudicatario anterior por debajo del ${PCT.format(BAJA_MINIMA * 100)} % sin contar las adjudicaciones con una sola oferta, 1 o 2 si son dos o más; el contrato nuevo empieza al acabar el anterior, 1; plazo de presentación más de ${MARGEN_PLAZO} días por debajo del mínimo legal de su procedimiento y tipo de contrato, 2 (en el mínimo se muestra, pero no suma); volumen de negocio de más de ${PCT.format(TOPE_VOLUMEN * 1.1)} veces el valor estimado (el tope legal es ${PCT.format(TOPE_VOLUMEN)}) o trabajos similares de más de ${PCT.format(REFERENCIA_TRABAJOS * 2)} veces la anualidad media (el doble de la referencia del ${PCT.format(REFERENCIA_TRABAJOS * 100)} %), 2; cada señal del pliego en la ficha aprobada, 1 (2 si es una marca o compatibilidad obligatoria; máx. ${MAX_PLIEGO} en total; las de un lote solo cuentan en ese lote). Nivel: alto desde ${PUNTOS_ALTO} puntos, medio desde ${PUNTOS_MEDIO}, bajo por debajo. Son indicios, no pruebas: compruébalos en el pliego.`;
