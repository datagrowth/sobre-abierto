// Preguntas de precio y de criterios automáticos del asistente de la oferta.
import { nucleo } from '../../../nucleo/contexto.js';
import { eurosTexto } from '../lotes.js';
import { delLote, recorte, type ContextoAsistente } from './asistenteContexto.js';
import type { Opcion, Pregunta } from './asistenteTipos.js';
import { precioDecidido } from './comprobacionesReglasDecisiones.js';
import { paresDeAutomaticos } from './decisiones.js';
import { automaticoDe, claveCriterio, ofertaDeLote, tramosDe } from './guionLotes.js';
import { preciosSugeridos, type OpcionPrecio, type PrecioSugerido } from './precioSugerido.js';
import { pideEvidencia } from './propuestaDecisiones.js';
import { automaticosContradictorios } from './automaticosHonestos.js';
import type { PrecioUnitarioData } from './guion.js';

const pct = (x: number): string => `${(Math.round(x * 1000) / 10).toLocaleString('es-ES')} %`;

// concepto: el lote se oferta por unidad («alumno»): el importe es el precio unitario.
type Linea = { lote: string | null; concepto?: string };

// El precio va siempre por código: las opciones salen del precio sugerido (adjudicaciones parecidas y umbral de
// anormalidad) y un texto libre se lee aquí («29.280», «un 8 % de baja»); el importe nunca llega a Hermes. Los
// criterios automáticos preguntan si la empresa se acoge y a qué tramo, con lo que pide para acreditarlo.
function opcionPrecio(clave: string, l: Linea, o: OpcionPrecio, detalle: string): Opcion {
  return {
    clave,
    texto: `${eurosTexto(o.importe)} · ${pct(o.baja)} de baja`,
    detalle,
    tono: 'ok',
    hermes: false,
    accion: { tipo: 'precio', lote: l.lote, importe: o.importe, ...(l.concepto ? { concepto: l.concepto } : {}) },
  };
}

function opcionesPrecio(l: Linea, s: PrecioSugerido | null): Opcion[] {
  const otro: Opcion = {
    clave: 'otro',
    texto: 'Otro precio',
    detalle: null,
    tono: 'neutro',
    hermes: false,
    accion: null,
    pide: 'importe',
    ...(l.concepto ? { concepto: l.concepto } : {}),
  };
  if (!s) return [otro];
  return [
    ...(s.equilibrio
      ? [
          opcionPrecio(
            'equilibrio',
            l,
            s.equilibrio,
            `habría ganado en precio al menos el 80 % de ${s.comparables} adjudicaciones parecidas`,
          ),
        ]
      : []),
    ...(s.maxima && s.maxima.importe !== s.equilibrio?.importe
      ? [opcionPrecio('maxima', l, s.maxima, 'la baja más alta sin caer en oferta anormalmente baja')]
      : []),
    otro,
  ];
}

function textoPrecio(
  c: ContextoAsistente,
  lote: string | null,
  s: PrecioSugerido | null,
  unitario: PrecioUnitarioData | null,
): string {
  const o = ofertaDeLote(c.guion.datos, lote);
  const umbral = o?.umbral_baja ?? s?.umbral_anormal ?? null;
  const base = s?.base ?? unitario?.maximo ?? null;
  return [
    unitario ? `Se oferta por ${unitario.unidad} («${unitario.concepto}»).` : '',
    o ? `Se puntúa así: «${recorte(o.formula, 220)}».` : '',
    umbral !== null ? `A partir de un ${pct(umbral)} de baja la oferta es anormalmente baja.` : '',
    base !== null
      ? `${unitario ? 'El máximo' : 'El presupuesto'} es de ${eurosTexto(base)}${unitario ? ` por ${unitario.unidad}` : ''} sin impuestos.`
      : '',
    '¿Qué precio ofertas?',
  ]
    .filter(Boolean)
    .join(' ');
}

function respuestaPrecio(c: ContextoAsistente, lote: string | null): string {
  const o = c.d.ofertas.find((x) => x.lote === lote) ?? c.d.ofertas.find((x) => x.lote === null);
  if (o?.importe != null) return eurosTexto(o.importe);
  const u = o?.unitarios[0];
  return u ? `${eurosTexto(u.precio)} por ${u.concepto.toLowerCase()}` : 'Decidido';
}

// Un lote que se oferta con varios precios unitarios (una línea por concepto) no cabe en una respuesta: se fija en su fila de la Revisión.
function preguntaUnitarios(c: ContextoAsistente, lote: string | null, hecha: boolean): Pregunta {
  return {
    clave: `precio:${lote ?? '-'}`,
    seccion: 'precio',
    lote,
    titulo: `Precio${delLote(lote)}`,
    citas: [],
    texto: `Precio${delLote(lote)}. Se oferta por precios unitarios, una línea por concepto: fíjalos en su fila de la Revisión, donde se ven todas a la vez.`,
    opciones: [
      {
        clave: 'comprobaciones',
        texto: 'Fijarlos en la Revisión',
        detalle: null,
        tono: 'neutro',
        hermes: false,
        accion: null,
        enlace: `comprobaciones#bloqueo=precio:${lote ?? '-'}`,
      },
    ],
    libre: null,
    estado: hecha ? 'hecha' : 'pendiente',
    respuesta: hecha ? 'Decidido en la Revisión' : null,
  };
}

/** Una pregunta por lote del ámbito (o por el contrato entero); las que tienen precio, hechas. */
export function preguntasPrecio(c: ContextoAsistente): Pregunta[] {
  const lotes: (string | null)[] = c.ambito.length ? c.ambito : [null];
  const sugeridos = preciosSugeridos(c.dbLic, c.id, c.ambito, nucleo().config.licitaciones.preciosMinimo);
  return lotes.map((lote): Pregunta => {
    const hecha = precioDecidido({ decisiones: c.guardadas }, lote);
    const o = ofertaDeLote(c.guion.datos, lote);
    const unitarios = o?.precios_unitarios ?? [];
    if (unitarios.length > 1) return preguntaUnitarios(c, lote, hecha);
    const unitario = unitarios[0] ?? null;
    const s = sugeridos[lote ?? ''] ?? null;
    return {
      clave: `precio:${lote ?? '-'}`,
      seccion: 'precio',
      lote,
      titulo: `Precio${delLote(lote)}`,
      texto: textoPrecio(c, lote, s, unitario),
      citas: o?.documento ? [{ documento: o.documento, pagina: o.pagina ?? null }] : [],
      opciones: opcionesPrecio({ lote, ...(unitario ? { concepto: unitario.concepto } : {}) }, s),
      libre: 'codigo',
      estado: hecha ? 'hecha' : 'pendiente',
      respuesta: hecha ? respuestaPrecio(c, lote) : null,
    };
  });
}

// «29.280», «29.280,50 €», «29280»: el primer importe; «un 8,5 % de baja»: sobre la base del lote.
const IMPORTE = /(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:€|euros?)?/i;
const BAJA = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/;

/** ¿Habla de una baja en %? Sin base sobre la que calcularla no se puede leer como importe. */
export const esBaja = (texto: string): boolean => BAJA.test(texto);

/**
 * El importe que escribe una persona; null si no hay ninguno que tenga sentido. Con «%», la baja
 * sobre la base; sin base, null: «8,5 %» no son 8,50 €.
 */
export function importeDeTexto(texto: string, base: number | null): number | null {
  const baja = BAJA.exec(texto);
  if (baja) {
    if (!base) return null;
    const p = Number(baja[1]!.replace(',', '.')) / 100;
    return p > 0 && p < 1 ? Math.round(base * (1 - p) * 100) / 100 : null;
  }
  const m = IMPORTE.exec(texto);
  if (!m) return null;
  const n = Number(`${m[1]!.replace(/[.\s]/g, '')}.${m[2] ?? '0'}`);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * La base del lote para leer una baja escrita en %: la del precio sugerido o, sin comparables, la
 * misma que enseña la pregunta (el máximo unitario o el presupuesto del guion, o el del lote).
 */
export function baseDelLote(c: ContextoAsistente, lote: string | null): number | null {
  const sugerida = preciosSugeridos(c.dbLic, c.id, lote ? [lote] : [], nucleo().config.licitaciones.preciosMinimo)[
    lote ?? ''
  ]?.base;
  const o = ofertaDeLote(c.guion.datos, lote);
  const delLote = lote ? c.lotes.lotes.find((l) => l.id === lote)?.presupuesto_sin_iva : null;
  return sugerida ?? o?.precios_unitarios[0]?.maximo ?? o?.presupuesto_base ?? delLote ?? null;
}

// ── Criterios automáticos ──

type Par = { criterio: string; lote: string | null };

function opcionesAutomatico(c: ContextoAsistente, p: Par): Opcion[] {
  const a = automaticoDe(c.guion.datos, p.criterio, p.lote);
  if (!a) return [];
  const deHermes = c.propuesta?.automaticos.find(
    (x) => claveCriterio(x.criterio) === claveCriterio(p.criterio) && (x.lote ?? null) === p.lote,
  );
  const pideAcreditar = pideEvidencia(a.como_se_acredita);
  const si = tramosDe(a).map((t, i): Opcion => {
    const hermes = Boolean(
      deHermes?.nos_acogemos &&
      (deHermes.tramo === t.descripcion || (deHermes.tramo === null && tramosDe(a).length === 1)),
    );
    const valor =
      t.valor !== undefined && /^\d+(?:[.,]\d+)?$/.test(t.valor.trim()) ? Number(t.valor.replace(',', '.')) : undefined;
    const evidencia = hermes ? deHermes?.evidencia : undefined;
    return {
      clave: `tramo-${i + 1}`,
      texto: a.tramos?.length ? t.descripcion : 'Sí, nos acogemos',
      detalle: `${t.puntos} puntos${pideAcreditar ? ' · hay que acreditarlo' : ''}`,
      tono: 'ok',
      hermes,
      pide: pideAcreditar && !evidencia ? 'evidencia' : undefined,
      accion: {
        tipo: 'automatico',
        criterio: p.criterio,
        lote: p.lote,
        nos_acogemos: true,
        tramo: a.tramos?.length ? t.descripcion : null,
        ...(valor !== undefined ? { valor } : {}),
        ...(evidencia ? { evidencia } : {}),
      },
    };
  });
  const no: Opcion = {
    clave: 'no',
    texto: 'No nos acogemos',
    detalle: '0 puntos',
    tono: 'neutro',
    hermes: deHermes?.nos_acogemos === false,
    accion: { tipo: 'automatico', criterio: p.criterio, lote: p.lote, nos_acogemos: false, tramo: null },
  };
  return [...si, no];
}

// El tramo de un criterio sin tramos es el propio criterio: entonces basta «Sí».
function respuestaAutomatico(d: { criterio: string; nos_acogemos: boolean; tramo: string | null }): string {
  if (!d.nos_acogemos) return 'No nos acogemos';
  return d.tramo && claveCriterio(d.tramo) !== claveCriterio(d.criterio) ? `Sí: ${recorte(d.tramo, 80)}` : 'Sí';
}

const PROBLEMA = {
  sin_evidencia: 'Te acoges sin decir con qué lo acreditas.',
  nota_contraria: 'Te acoges y tu nota dice que no.',
} as const;

/**
 * Una pregunta por criterio automático de los lotes a los que se va; las decididas, hechas. Acogerse
 * sin con qué acreditarlo (o contra la nota) es una declaración inexacta: vuelve a preguntarse.
 */
export function preguntasAutomaticos(c: ContextoAsistente): Pregunta[] {
  const contradictorios = automaticosContradictorios(c.d, c.guion.datos, c.propuestaGuardada);
  return paresDeAutomaticos(c.guion.datos, c.d.lotes).flatMap((p): Pregunta[] => {
    const a = automaticoDe(c.guion.datos, p.criterio, p.lote);
    if (!a) return [];
    const mismo = (x: Par) => claveCriterio(x.criterio) === claveCriterio(p.criterio) && (x.lote ?? null) === p.lote;
    const contradiccion = contradictorios.find(mismo);
    const decidido = contradiccion ? undefined : c.d.automaticos.find(mismo);
    return [
      {
        clave: `automatico:${claveCriterio(p.criterio)}:${p.lote ?? '-'}`,
        seccion: 'automaticos',
        lote: p.lote,
        titulo: recorte(`${p.criterio}${delLote(p.lote)}`, 140),
        texto: `${contradiccion ? `${PROBLEMA[contradiccion.motivo]} ` : ''}Vale ${a.puntos} puntos y va en ${a.archivo}. Se acredita: ${recorte(a.como_se_acredita, 300)} ¿Nos acogemos?`,
        citas: a.documento ? [{ documento: a.documento, pagina: a.pagina ?? null }] : [],
        opciones: opcionesAutomatico(c, p),
        libre: 'hermes',
        estado: decidido ? 'hecha' : 'pendiente',
        respuesta: decidido ? respuestaAutomatico(decidido) : null,
      },
    ];
  });
}
