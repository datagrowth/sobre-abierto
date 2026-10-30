// El Pipeline en la web, sin React y con tests: el cierre de cada tarjeta (peninsular y,
// si la empresa está allí, de Canarias, en ámbar a 3 días o menos), el texto de lo resuelto, el aviso de lo que está por
// revisar y las filas de la vista lista (el CSV lo arma el servidor).
import {
  euros,
  fechaCorta,
  horaPlazo,
  instanteLocal,
  diasDeCalendario,
  plural,
  segundaHora,
  textoVeredicto,
} from './formato.js';

const URGENTE_DIAS = 3;

/**
 * El cierre de una tarjeta: { fecha: «jue 29 oct, 14:00», canarias: «13:00 en Canarias» o null, urgente }.
 * `urgente`: faltan 3 días de calendario o menos y no ha pasado. Sin fecha, null.
 */
export function cierreDeTarjeta(fechaLimite, ahora = Date.now()) {
  const instante = instanteLocal(fechaLimite);
  if (instante === null) return null;
  const hora = horaPlazo(fechaLimite);
  const dias = diasDeCalendario(instante, ahora);
  return {
    fecha: `${fechaCorta(fechaLimite, ahora)}${hora ? `, ${hora}` : ''}`,
    canarias: segundaHora(hora) ? `${segundaHora(hora)} en Canarias` : null,
    urgente: instante > ahora && dias <= URGENTE_DIAS,
  };
}

/** Lo que sustituye a la fecha en Resuelta. */
export function textoResultado(t) {
  if (t.resultado === 'ganada') return 'Ganada';
  if (t.resultado === 'perdida') return 'Perdida';
  return 'Adjudicada, sin resultado propio';
}

/** «4 oportunidades pueden encajar y están pendientes de revisión». */
export function textoPorRevisar(total) {
  return `${plural(total, 'oportunidad puede encajar y está pendiente', 'oportunidades pueden encajar y están pendientes')} de revisión`;
}

/** «95.000 € · Hermes: interesa» para cada una de las próximas. */
export function detallePorRevisar(o) {
  return [euros(o.importe), o.veredicto_ia ? `Hermes: ${textoVeredicto(o.veredicto_ia)}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** Todas las tarjetas en filas para la vista lista: [{ ...tarjeta, estado: «En preparación» }]. */
export function filasDelPipeline(p) {
  return (p?.columnas ?? []).flatMap((c) => c.tarjetas.map((t) => ({ ...t, estado: c.titulo })));
}

// Las columnas que se calculan solas no aceptan tarjetas: lo que las mueve son las comprobaciones o la PLACSP.
const SOLAS = {
  lista_para_firmar: '«Lista para firmar» la ponen las comprobaciones cuando la oferta está completa.',
  en_evaluacion: '«En evaluación» llega sola al cerrar el plazo o cuando la PLACSP la pasa a evaluación.',
};
const PREPARANDO = new Set(['en_preparacion', 'lista_para_firmar']);
const PRESENTADA = new Set(['presentada', 'en_evaluacion']);

/**
 * Qué pasa al soltar en `destino` una tarjeta de `origen`: { tipo } con la acción real
 * («registrar» la presentación, anotar el «resultado» o «deshacer» la presentación),
 * { bloqueo } con el porqué si ahí no se suelta, o null si no se mueve.
 */
export function accionAlSoltar(origen, destino) {
  if (origen === destino) return null;
  if (SOLAS[destino]) return { bloqueo: SOLAS[destino] };
  if (origen === 'resuelta')
    return { bloqueo: 'Lo resuelto no se mueve: cambia el resultado en la ficha (Presentación).' };
  if (destino === 'presentada')
    return PREPARANDO.has(origen)
      ? { tipo: 'registrar' }
      : { bloqueo: 'Ya está presentada: pasa a «En evaluación» sola al cerrar el plazo.' };
  if (destino === 'resuelta')
    return PRESENTADA.has(origen) ? { tipo: 'resultado' } : { bloqueo: 'Primero regístrala como presentada.' };
  if (destino === 'en_preparacion')
    return PRESENTADA.has(origen)
      ? { tipo: 'deshacer' }
      : { bloqueo: 'Vuelve sola a «En preparación» si las comprobaciones encuentran algo pendiente.' };
  return null;
}

/** Las columnas a las que se puede mover una tarjeta (el menú «Mover», para teclado y móvil). */
export function destinosDe(origen, columnas) {
  return columnas
    .filter((c) => accionAlSoltar(origen, c.clave)?.tipo)
    .map((c) => ({ ...c, tipo: accionAlSoltar(origen, c.clave).tipo }));
}
