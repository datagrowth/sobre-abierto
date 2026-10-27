// La ficha de una licitación, sin React y con tests: las tres preguntas
// de la cabecera (¿Podemos?, ¿Merece la pena?, ¿Llegamos?), los índices de competencia y baja con
// los cálculos de precios/ (muestra, rango y confianza), el estado de cada área de requisitos y
// el reparto de puntos entre juicio de valor y fórmulas.
import { textoEncaje } from './encajeFormato.js';
import { horaPlazo, plazo, plural, segundaHora, textoPlazo } from './formato.js';
import { porcentaje } from './preciosFormato.js';
import { textoCierreInterno, textoProximoHito } from './comprobacionesFormato.js';
import { textoPocosDatos, TEXTO_CONFIANZA } from './uiFormato.js';

const TONO_SEMAFORO = { verde: 'ok', ambar: 'riesgo', rojo: 'impide' };
const PODEMOS = { verde: 'Elegible', ambar: 'Elegible con dudas', rojo: 'No elegible' };
// El veredicto de las comprobaciones ya dice si se puede presentar: su tono.
const TONO_VEREDICTO = {
  lista_para_firmar: 'ok',
  presentable_con_riesgos: 'riesgo',
  no_presentable: 'impide',
  faltan_decisiones: 'riesgo',
  hermes_trabajando: 'hermes',
  descartada: 'neutro',
};

/** ¿Podemos? Con comprobaciones, su veredicto; sin ellas, el semáforo de requisitos. { valor, detalle, tono, testid, estado }. */
export function preguntaPodemos(f, comprobaciones = null) {
  const v = comprobaciones?.veredicto;
  if (v)
    return {
      valor: v.texto,
      detalle: null,
      tono: TONO_VEREDICTO[v.tipo] ?? 'neutro',
      testid: 'veredicto-cabecera',
      estado: v.tipo,
    };
  const s = f?.go_no_go?.semaforo;
  if (!s)
    return {
      valor: 'Sin evaluar',
      detalle: 'Aún no hay requisitos leídos: llegan con la ficha de Hermes.',
      tono: 'neutro',
      testid: 'ficha-indicador-requisitos',
      estado: null,
    };
  return {
    valor: PODEMOS[s.color] ?? s.color,
    detalle: s.motivo ?? null,
    tono: TONO_SEMAFORO[s.color] ?? 'neutro',
    testid: 'ficha-indicador-requisitos',
    estado: s.color,
  };
}

/** De dónde sale el umbral de anormalidad de la barra: el del pliego manda; si no, el art. 85 (supletorio). */
export function textoUmbral(b) {
  if (!Number.isFinite(b?.umbral_anormal)) return null;
  const cifra = porcentaje(b.umbral_anormal);
  if (b.regla_umbral === 'pliego') return `Anormal desde ${cifra} de baja, el umbral que fija el pliego.`;
  if (b.regla_umbral === 'literal')
    return `Anormal desde ${cifra} de baja según el art. 85 RGLCAP; el pliego trae su regla: «${b.umbral_literal}».`;
  return `Anormal desde ${cifra} de baja según el art. 85 RGLCAP con las ofertas esperadas (el pliego no fija otro).`;
}

/**
 * Los índices de mercado del servidor (GET …/indices) para la cabecera y la pestaña Mercado:
 * la baja esperada con su rango, las ofertas esperadas, la muestra y la confianza (la del servidor).
 */
export function indicesDeMercado(i) {
  if (!i?.muestra) return null;
  const { p25 = null, p50 = null, p75 = null } = i.baja?.rango ?? {};
  return {
    n: i.muestra.n,
    confianza: i.confianza,
    p25,
    p50,
    p75,
    umbral: i.baja?.umbral_anormal ?? null,
    ofertas: i.competencia?.ofertas ?? null,
    baja: porcentaje(i.baja?.esperada ?? p50),
    rango: p25 !== null && p75 !== null ? `${porcentaje(p25)}-${porcentaje(p75)}` : null,
    muestra: i.muestra.descripcion ?? null,
    resumen: i.resumen ?? null,
    unLicitador: i.competencia?.p_un_licitador ?? null,
    licitadores: i.licitadores ?? [],
    concentracion: i.concentracion ?? null,
    // La prueba hacia atrás de cada índice: «La baja esperada se desvía de media 5,8 puntos…».
    acierto: { baja: i.acierto?.baja?.texto ?? null, ofertas: i.acierto?.ofertas?.texto ?? null },
    textoUmbral: textoUmbral(i.baja),
    comparables: i.comparables ?? [],
  };
}

/** «1 de cada 4 comparables tuvo un solo licitador»; casi nunca o la mitad o más, con palabras. */
export function textoUnLicitador(p) {
  if (!Number.isFinite(p)) return null;
  if (p < 0.05) return 'Casi ningún comparable tuvo un solo licitador.';
  if (p >= 0.5) return 'La mitad o más de los comparables tuvo un solo licitador.';
  return `1 de cada ${Math.round(1 / p)} comparables tuvo un solo licitador.`;
}

/**
 * ¿Merece la pena? «3 ofertas esperadas · baja 12,0 %» y el detalle; con confianza baja, sin
 * cifras. `opinion`: la de Hermes con su origen («Hermes: Encaja», «Ficha: Con dudas»).
 */
export function preguntaMerece(indices, opinion = null, encaje = null) {
  const hermes = opinion;
  // El encaje va delante; su desglose está en el Resumen.
  const conEncaje = (valor) => [textoEncaje(encaje), valor].filter(Boolean).join(' · ');
  if (!indices)
    return {
      valor: conEncaje(hermes ?? 'Sin datos de mercado'),
      detalle: hermes ? 'Sin datos de mercado para este segmento.' : null,
      tono: 'neutro',
    };
  if (indices.confianza === 'baja')
    return {
      valor: conEncaje(hermes ?? 'Pocos datos de mercado'),
      detalle: textoPocosDatos(indices.n),
      tono: 'neutro',
    };
  const ofertas = indices.ofertas ? plural(indices.ofertas, 'oferta esperada', 'ofertas esperadas') : null;
  return {
    valor: conEncaje([ofertas, `baja ${indices.baja}`].filter(Boolean).join(' · ')),
    detalle: [indices.rango && `rango ${indices.rango}`, `n = ${indices.n}`, TEXTO_CONFIANZA[indices.confianza], hermes]
      .filter(Boolean)
      .join(' · '),
    tono: 'neutro',
  };
}

/** ¿Llegamos? El plazo en hora peninsular (con la de Canarias si la empresa está allí) y el cierre interno de las comprobaciones. */
export function preguntaLlegamos(f, comprobaciones = null, ahora = Date.now()) {
  if (f?.retirada)
    return { valor: f.retirada.etiqueta, detalle: 'Ya no se puede presentar.', tono: 'impide', estado: 'retirada' };
  const p = plazo(f?.fecha_limite, ahora);
  const hora = horaPlazo(f?.fecha_limite);
  const canarias = segundaHora(hora) ? `${segundaHora(hora)} en Canarias` : null;
  const interno = textoCierreInterno(comprobaciones?.hora_interna_cierre, ahora);
  const hito = textoProximoHito(comprobaciones?.hitos, ahora);
  const tono =
    p.urgencia === 'pasada'
      ? 'neutro'
      : p.urgencia === 'alta'
        ? 'impide'
        : p.urgencia === 'media' || hito?.vencido
          ? 'riesgo'
          : 'neutro';
  return {
    valor: p.fecha ? textoPlazo(p) : 'Sin plazo publicado',
    detalle: [canarias, interno, hito?.texto].filter(Boolean).join(' · ') || null,
    tono,
    estado: p.urgencia,
  };
}

/** La cabecera de un área de requisitos: { tono, texto }. No cumple manda; luego lo que falta comprobar. */
export function resumenArea(requisitos = []) {
  if (!requisitos.length) return { tono: 'neutro', texto: 'No lo pide' };
  const noCumple = requisitos.filter((r) => r.resultado === 'no_cumple').length;
  if (noCumple) return { tono: 'impide', texto: noCumple === 1 ? 'No cumple' : `${noCumple} no se cumplen` };
  const dudas = requisitos.filter((r) => r.resultado === 'desconocido').length;
  if (dudas) return { tono: 'riesgo', texto: plural(dudas, 'sin comprobar', 'sin comprobar') };
  return { tono: 'ok', texto: 'Cumple' };
}

/**
 * El reparto de puntos de los criterios con tipo (los de la ficha): { juicio, formula, total }.
 * null si ninguno trae tipo y peso (los de la PLACSP no dicen cómo se valoran).
 */
export function repartoCriterios(criterios = []) {
  const conTipo = criterios.filter(
    (c) => typeof c.peso === 'number' && (c.tipo === 'juicio_valor' || c.tipo === 'formula'),
  );
  if (!conTipo.length) return null;
  const suma = (tipo) => conTipo.filter((c) => c.tipo === tipo).reduce((t, c) => t + c.peso, 0);
  const juicio = suma('juicio_valor');
  const formula = suma('formula');
  return { juicio, formula, total: juicio + formula };
}
