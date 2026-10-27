// Aplazamientos: un valor de diseño que se deja «a acordar», «sujeto a validación» o relativo a «T0» en vez de fijarlo.
import { textoComparable } from '../temas.js';
import { frases } from './fugas.js';

// El pliego los puntúa como «carencias de detalle que requerirán concreción posterior» (tramo Aceptable): la
// memoria que aplazó todo sacó 18 «T0» y ninguna región, y la que ganó, fechas y valores. Lo usan la revisión de
// la estrategia (problemasDePrudencia) y el contador de cada apartado (memoriaRevision.ts). Puro.
// «T0» nunca vale: el calendario se fecha desde el inicio previsto.
const T0 = /\bT0\b|\bT\s*\+\s*\d+\b/;
// El resto, solo sin un número en la misma frase («se fijará en la semana 2 con un umbral del
// 90 %» ya da el valor). Sobre el texto sin tildes ni mayúsculas.
const APLAZA =
  /\ba acordar\b|\bacordad[oa]s? con\b|\bpendientes? de (?:definir|definicion|concretar|acordar|confirmar|confirmacion|decidir|decision)\b|\bse fijaran?\b|\bno fijar\b|\bse concretaran?\b|\bse definiran?\b|\bpor determinar\b/;
// «Sujeto a validación» o «pendiente de aprobación» aplaza un valor («la región queda sujeta a
// validación del órgano»), pero también describe la revisión humana de lo que produce el sistema
// («cada borrador queda sujeto a validación del técnico antes de enviarse»), que es diseño y la
// rúbrica premia: marcarla hacía que el redactor quitara el control humano de la memoria.
const APLAZA_REVISION =
  /\bsujet[oa]s? a (?:su )?(?:validacion|aprobacion|confirmacion)\b|\bpendientes? de (?:validacion|aprobacion)\b/;
const FLUJO =
  /\b(?:borrador(?:es)?|bandejas?|respuestas?|expedientes?|solicitud(?:es)?|salidas?|resultados?|generad[oa]s?|antes de (?:enviar|enviarse|publicar|publicarse|remitir|remitirse|firmar|firmarse|registrar|su envio|su publicacion)|se registran?|con su firma)\b/;

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function aplaza(frase: string): boolean {
  if (T0.test(frase)) return true;
  const t = textoComparable(frase);
  if (/\d/.test(frase)) return false;
  return APLAZA.test(t) || (APLAZA_REVISION.test(t) && !FLUJO.test(t));
}

// Un parámetro de una palabra («calendario», «plazo») eximía cualquier frase que la nombrara: un
// solo pendiente legítimo genérico apagaba el detector. Solo exime el nombre concreto del valor.
const VACIAS = new Set([
  'para',
  'como',
  'cada',
  'entre',
  'sobre',
  'desde',
  'hasta',
  'segun',
  'este',
  'esta',
  'estos',
  'estas',
  'todo',
  'toda',
  'todos',
  'todas',
]);
const significativas = (t: string): string[] =>
  comparable(t)
    .split(' ')
    .filter((w) => w.length >= 4 && !VACIAS.has(w));
const MIN_PALABRAS_PARAMETRO = 2;

/** ¿El nombre de un pendiente legítimo es lo bastante concreto para eximir las frases que lo nombran? */
export const parametroConcreto = (parametro: string): boolean =>
  significativas(parametro).length >= MIN_PALABRAS_PARAMETRO;

/**
 * Las frases de un texto que aplazan un valor de diseño. `exentos`: lo que el pliego reserva al
 * órgano (pendientes legítimos); una frase que nombra uno concreto no cuenta.
 */
export function aplazamientosEn(texto: string, exentos: string[] = []): string[] {
  const libres = exentos.filter(parametroConcreto).map(comparable);
  return frases(texto).filter((f) => aplaza(f) && !libres.some((x) => comparable(f).includes(x)));
}

// La fórmula «la empresa propone X; el órgano lo ratifica en el acta de la semana N»
// acabó 9 veces en una memoria de 88.000 caracteres y los jueces la leyeron como aplazamiento:
// lo decidido se escribe como hecho y la ratificación queda para lo que el pliego reserva al
// órgano. Cuenta aunque lleve cifra o fecha: el problema es la fórmula, no la falta de valor.
// Es una propuesta que espera aprobación, o una ratificación del órgano o del cliente. El
// gobierno normal del proyecto («los entregables se validan en la reunión quincenal», «el acta
// de aceptación se aprueba en el comité») no lo es, ni una regla que prohíbe la fórmula.
const PROPUESTA = /\b(?:propone|proponen|proponemos|propuesta|propuesto)\b/;
const APROBACION =
  /\b(?:ratific\w*|valid(?:a|an|ara|aran|ado|ada|ados|adas)|aprueba|aprueban|aprobara|aprobaran|aprobad[oa]s?|confirm(?:a|an|ara|aran|ado|ada|ados|adas))\b/;
const RATIFICACION = /\bratific\w*/;
const ORGANO =
  /\b(?:el organo|del organo|al organo|la mesa|el cliente|del cliente|la entidad|de la entidad|la administracion|el responsable del contrato|la direccion del contrato)\b/;
const PROHIBE =
  /\bno (?:escribir|escribas|decir|digas|dejar|dejes|usar|uses|poner|pongas)\b|\bnunca\b|\bsin (?:la formula|ratificacion)/;

function ratifica(frase: string): boolean {
  const t = textoComparable(frase);
  if (PROHIBE.test(t)) return false;
  return (PROPUESTA.test(t) && APROBACION.test(t)) || (RATIFICACION.test(t) && ORGANO.test(t));
}
// Más de esta cifra por apartado ya es la muletilla.
export const MAX_RATIFICACIONES = 1;

/** Las frases que dejan lo decidido a una ratificación posterior del órgano («lo ratifica en el acta…»), salvo las que nombran un pendiente legítimo. */
export function ratificacionesEn(texto: string, exentos: string[] = []): string[] {
  const libres = exentos.filter(parametroConcreto).map(comparable);
  return frases(texto).filter((f) => ratifica(f) && !libres.some((x) => comparable(f).includes(x)));
}
