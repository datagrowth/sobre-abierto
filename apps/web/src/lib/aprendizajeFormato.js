// Textos y cálculos de la pantalla Aprendizaje: sin React, con tests.
import { fechaCorta } from './formato.js';
import { textoAlcance } from './memoriaFormato.js';

export const ORIGENES = { edicion: 'Edición', mesa: 'Mesa', decision: 'Decisión', precio: 'Precio' };
export const TEMAS = {
  planificacion: 'Planificación',
  metodologia: 'Metodología',
  equipo: 'Equipo',
  mejoras: 'Mejoras',
  calidad: 'Calidad',
  riesgos: 'Riesgos',
  comunicacion: 'Comunicación',
  formacion: 'Formación',
  medios: 'Medios',
  sostenibilidad: 'Sostenibilidad',
};
export const TIPOS_CAMBIO = {
  especificidad: 'de especificidad',
  estructura: 'de estructura',
  recorte: 'recortes',
  correccion_dato: 'de datos',
  compromiso: 'compromisos',
  cumplimiento: 'de cumplimiento',
  estilo: 'de estilo',
  sin_clasificar: 'sin clasificar',
};
// El orden de la barra apilada: lo que más dice de cómo mejoramos, primero.
const ORDEN_TIPOS = Object.keys(TIPOS_CAMBIO);

/** «Tema Planificación» o «Órgano: …». */
export function textoAlcanceLeccion(l) {
  if (l.alcance === 'general' && l.tema) return `Tema ${TEMAS[l.tema] ?? l.tema}`;
  const base = textoAlcance({ alcance: l.alcance, alcance_valor: l.alcance_valor, apartado: null });
  return l.tema ? `${base} · ${TEMAS[l.tema] ?? l.tema}` : base;
}

/** Las opciones de «Ajustar el alcance», con el valor de su licitación. */
export function opcionesDeAlcance(l) {
  const o = l.opciones_alcance ?? {};
  return [
    { valor: 'general', texto: 'General: cualquier memoria', alcance_valor: null },
    ...(l.licitacion_id
      ? [{ valor: 'licitacion', texto: 'Solo esta licitación', alcance_valor: l.licitacion_id }]
      : []),
    ...(o.organo ? [{ valor: 'organo', texto: `Órgano: ${o.organo}`, alcance_valor: o.organo }] : []),
    ...(o.cpv ? [{ valor: 'cpv', texto: `CPV ${o.cpv}`, alcance_valor: o.cpv }] : []),
    ...(o.tipo_contrato
      ? [
          {
            valor: 'tipo_contrato',
            texto: `Tipo de contrato: ${o.tipo_contrato_nombre ?? o.tipo_contrato}`,
            alcance_valor: o.tipo_contrato,
          },
        ]
      : []),
  ];
}

/** La primera evidencia como se lee en la tarjeta: «apartado 2 · Planificación · memoria.docx: + el 3 de marzo…». */
export function textoEvidencia(l) {
  const e = l.evidencias?.[0];
  if (!e) return null;
  const donde = [e.ubicacion, e.documento && !e.ubicacion?.includes(e.documento) ? e.documento : null]
    .filter(Boolean)
    .join(' · ');
  const texto = [donde, e.texto].filter(Boolean).join(': ');
  return [texto, e.porque ? `Por qué: ${e.porque}` : null].filter(Boolean).join(' · ') || null;
}

/** Dónde se usó y qué dijo el crítico: «En 3 apartados de 2 ofertas · cumplida 2 de 3 · crítico 78 %». */
export function textoUso(u) {
  if (!u?.aplicaciones) return 'Aún no se ha aplicado';
  const veces = u.aplicaciones === 1 ? 'En 1 apartado' : `En ${u.aplicaciones} apartados`;
  const ofertas = u.ofertas === 1 ? 'de 1 oferta' : `de ${u.ofertas} ofertas`;
  const cumplida = u.comprobadas ? ` · cumplida ${u.cumplidas} de ${u.comprobadas}` : '';
  const critico = u.nota_critico !== null && u.nota_critico !== undefined ? ` · crítico ${u.nota_critico} %` : '';
  return `${veces} ${ofertas}${cumplida}${critico}`;
}

/** El libro filtrado por tema, origen, fuerza mínima y texto (órgano o enunciado). */
export function filtrarLibro(libro, f = {}) {
  const texto = (f.texto ?? '').trim().toLowerCase();
  return libro.filter(
    (l) =>
      (!f.tema || l.tema === f.tema) &&
      (!f.origen || l.origen === f.origen) &&
      (!f.fuerza || l.fuerza >= f.fuerza) &&
      (!texto || `${l.texto} ${l.alcance_valor ?? ''} ${l.titulo_licitacion ?? ''}`.toLowerCase().includes(texto)),
  );
}

/** «32 cambios: 12 de especificidad · 8 de estructura · 6 recortes…», los más numerosos primero. */
export function resumenComparacion(r) {
  if (!r?.total) return 'Sin cambios entre la memoria de Hermes y la presentada';
  const partes = Object.entries(r.por_tipo ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} ${TIPOS_CAMBIO[t] ?? t}`);
  return `${r.total === 1 ? '1 cambio' : `${r.total} cambios`}: ${partes.join(' · ')}`;
}

/** Los tramos de la barra apilada, en % del total y en un orden fijo. */
export function tramosComparacion(r) {
  if (!r?.total) return [];
  return ORDEN_TIPOS.filter((t) => r.por_tipo?.[t]).map((t) => ({
    tipo: t,
    n: r.por_tipo[t],
    pct: (100 * r.por_tipo[t]) / r.total,
  }));
}

/** Qué falta por revisar, para la pestaña: lecciones, porqués y actas. */
export function cuentaPorRevisar(p) {
  return (p?.lecciones?.length ?? 0) + (p?.porques?.length ?? 0) + (p?.actas?.length ?? 0);
}

/** «Resuelta (perdida) el 10/08: sube el acta a …» o, si la PLACSP la publica, que se está bajando. */
export function textoActaQueFalta(a, ahora = Date.now()) {
  const base = `Resuelta (${a.resultado}) el ${fechaCorta(a.resuelta_en, ahora)}`;
  if (a.publicada) return `${base}: la PLACSP ha publicado el acta y se está bajando sola`;
  return a.carpeta
    ? `${base}: sube el acta a «${a.carpeta.replace(/^Conocimiento\//, '')}»`
    : `${base}: sube el acta a su carpeta`;
}

/** Lo que respondió la persona sobre un cambio, para Comparar: { n: respuesta }. */
export function porquesRespondidos(c) {
  return Object.fromEntries((c.preguntas ?? []).filter((p) => p.respuesta).map((p) => [p.n, p.respuesta]));
}
