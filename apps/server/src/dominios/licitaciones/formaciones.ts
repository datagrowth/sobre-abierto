// Formaciones: si el perfil de la empresa dice de qué áreas las da, el resto se descarta en la criba y en la ficha.

// Una formación de otra materia (medio ambiente, sanidad, idiomas, PRL…) entraba por un CPV o una palabra del
// prefiltro y llegaba hasta «Por decidir». La regla la aplica Hermes (criba y ficha), no el código: el título no
// siempre dice la materia («Plan de formación 2027») y con el pliego delante se ve. Sin áreas en el perfil no hay
// regla: una formación se juzga contra el perfil como cualquier otro contrato, que es lo que ya piden las
// instrucciones; una regla «neutra» solo repetiría eso.

/** La regla para la criba, que solo ve título, CPV y lotes; vacía si la empresa no tiene áreas de formación. */
export function reglaFormacionesCriba(areas: readonly string[]): string {
  if (!areas.length) return '';
  return `Formaciones (cursos, planes de formación, capacitación, talleres, CPV 80…): solo interesan si su materia es de las áreas de formación de la empresa (${areas.join('; ')}). Si es de otra materia, «descartar» con el motivo «Formación fuera de nuestras áreas: <materia>»; si el título no deja claro de qué es la formación, «revisar».`;
}

/** La regla para la ficha, que ya lee el pliego (no_go la pasa sola a Descartadas); vacía sin áreas. */
export function reglaFormacionesFicha(areas: readonly string[]): string {
  if (!areas.length) return '';
  return `Si el contrato es una formación (cursos, plan de formación, capacitación…), mira en el PPT de qué materia es: solo interesan las de ${areas.join('; ')}; si es de otra materia, recomendación «no_go» con el motivo «Formación fuera de nuestras áreas: <materia>».`;
}
