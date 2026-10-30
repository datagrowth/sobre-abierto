// El tema de un apartado de la memoria (planificación, metodología, equipo…). Puro: sin base de datos.
import { textoComparable } from '../temas.js';

// Las lecciones se guardan con el tema y se eligen por él al redactar, porque dos memorias no titulan igual el
// mismo apartado («Cronograma» y «Plan de trabajo»). Sin base de datos, para poder usarlo al migrar.
export const TEMAS_APARTADO = [
  'planificacion',
  'metodologia',
  'equipo',
  'mejoras',
  'calidad',
  'riesgos',
  'comunicacion',
  'formacion',
  'medios',
  'sostenibilidad',
] as const;
export type TemaApartado = (typeof TEMAS_APARTADO)[number];

// Sobre el texto en minúsculas y sin tildes. Cada marca que casa suma un punto.
const MARCAS: Record<TemaApartado, RegExp[]> = {
  planificacion: [
    /planificaci/,
    /cronograma/,
    /calendario/,
    /plan de trabajo/,
    /\bhitos?\b/,
    /\bfases?\b/,
    /plazos? de ejecucion/,
  ],
  metodologia: [/metodolog/, /enfoque/, /procedimiento/, /forma de trabajo/, /\bproceso\b/],
  equipo: [/\bequipo\b/, /personal/, /perfiles?\b/, /responsables?\b/, /organigrama/, /dedicaci/, /coordinador/],
  mejoras: [/\bmejoras?\b/, /valor anadido/, /prestaciones adicionales/, /\bextras?\b/],
  calidad: [/calidad/, /seguimiento/, /indicadores?\b/, /\bkpi/, /evaluacion del servicio/, /control/],
  riesgos: [/riesgos?\b/, /contingencia/, /continuidad/, /incidencias/],
  comunicacion: [/comunicaci/, /difusi/, /coordinacion con/, /reuniones/, /informes? de seguimiento/],
  formacion: [/formaci/, /capacitaci/, /transferencia/, /docencia/, /\bcursos?\b/],
  medios: [/medios materiales/, /herramientas/, /tecnolog/, /infraestructura/, /plataforma/, /equipamiento/],
  sostenibilidad: [/sostenib/, /medioambient/, /igualdad/, /\bsocial(es)?\b/, /accesibilidad/],
};

/** El tema que más marcas reúne en el texto (título y lo que se valora); null si ninguno casa. */
export function temaDeApartado(texto: string | null | undefined): TemaApartado | null {
  if (!texto) return null;
  const c = textoComparable(texto);
  let mejor: { tema: TemaApartado; n: number } | null = null;
  for (const tema of TEMAS_APARTADO) {
    const n = MARCAS[tema].reduce((s, re) => s + (re.test(c) ? 1 : 0), 0);
    if (n > 0 && (!mejor || n > mejor.n)) mejor = { tema, n };
  }
  return mejor?.tema ?? null;
}
