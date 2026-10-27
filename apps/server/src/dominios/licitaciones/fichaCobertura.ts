// Cobertura de la ficha: cada tema de la lista debe estar en sus requisitos o decir que el pliego no lo pide.
import path from 'node:path';
import type { Evaluacion } from './evaluador.js';
import { exime } from './fichaVerificacion.js';
import { certificaciones } from './papeles.js';
import type { Pasaje } from './pasajes.js';
import { DEFINICION, temaDeRequisitoPlacsp, TEMAS_CHECKLIST, textoComparable, type Tema } from './temas.js';

// Los temas son solvencia, medios, certificaciones… Todo requisito que la PLACSP publica sin detalle tiene que
// haberse leído del pliego. Puro: devuelve los problemas en frases que Hermes puede corregir.
export const ESTADOS_COBERTURA = ['en_requisitos', 'no_lo_pide', 'no_encontrado'] as const;
export type CoberturaTema = {
  tema: Tema;
  estado: (typeof ESTADOS_COBERTURA)[number];
  detalle?: string | undefined;
  documento?: string | undefined;
  pagina?: number | undefined;
};
type RequisitoCubierto = {
  tipo: string;
  lote?: string | undefined;
  excluyente: boolean;
  cumple: string;
  fuente?: string | undefined;
  documento?: string | undefined;
  pagina?: number | undefined;
  descripcion: string;
};

export type ResultadoCobertura = { problemas: string[]; checklist_pct: number; placsp_pct: number };

const lista = (xs: string[]) => xs.map((x) => `«${x}»`).join(', ');

function deTema(tema: Tema, requisitos: RequisitoCubierto[], lote: string | null = null): boolean {
  const tipos: readonly string[] = DEFINICION[tema].tipos;
  return requisitos.some((r) => tipos.includes(r.tipo) && (lote === null || r.lote === undefined || r.lote === lote));
}

function problemasChecklist(
  cobertura: CoberturaTema[],
  requisitos: RequisitoCubierto[],
): { problemas: string[]; cubiertos: number } {
  const porTema = new Map(cobertura.map((c) => [c.tema, c]));
  const faltan = TEMAS_CHECKLIST.filter((t) => !porTema.has(t));
  const vacios = TEMAS_CHECKLIST.filter((t) => porTema.get(t)?.estado === 'en_requisitos' && !deTema(t, requisitos));
  const problemas = [
    ...(faltan.length
      ? [
          `Falta en «cobertura»: ${lista(faltan)}. Para cada uno di si está en los requisitos, si el pliego no lo pide (con documento y página) o si no lo encontraste.`,
        ]
      : []),
    ...(vacios.length
      ? [
          `«cobertura» dice en_requisitos para ${lista(vacios)}, pero no hay ningún requisito de ese tipo (${vacios.map((t) => DEFINICION[t].tipos.join('/')).join('; ')}).`,
        ]
      : []),
  ];
  return { problemas, cubiertos: TEMAS_CHECKLIST.length - faltan.length - vacios.length };
}

// Los requisitos de la PLACSP sin detalle («desconocido») del ámbito: cada uno, con su lote, debe
// tener en la ficha un requisito de su tema.
function problemasPlacsp(
  pendientes: Evaluacion[],
  requisitos: RequisitoCubierto[],
): { problemas: string[]; total: number; cubiertos: number } {
  const conTema = pendientes.flatMap((e) => {
    const tema = temaDeRequisitoPlacsp(e.etiqueta);
    return tema ? [{ e, tema }] : [];
  });
  const sinCubrir = conTema.filter(({ e, tema }) => !deTema(tema, requisitos, e.lote));
  const problemas = sinCubrir.map(
    ({ e, tema }) =>
      `La PLACSP publica «${e.etiqueta}»${e.lote ? ` del lote ${e.lote}` : ''} y la ficha no trae ningún requisito de ${DEFINICION[tema].etiqueta.toLowerCase()}${e.lote ? ' de ese lote' : ''}: léelo con licitaciones_pliegos (tema ${tema}) y añádelo.`,
  );
  return { problemas, total: conTema.length, cubiertos: conTema.length - sinCubrir.length };
}

// Lo que el agente debe dar en cada requisito para que la ficha se pueda revisar.
function problemasCitas(requisitos: RequisitoCubierto[]): string[] {
  const sinCita = requisitos
    .filter((r) => r.excluyente && (!r.documento || !r.pagina))
    .map((r) => r.descripcion.slice(0, 80));
  const sinFuente = requisitos
    .filter((r) => (r.cumple === 'si' || r.cumple === 'no') && !r.fuente)
    .map((r) => r.descripcion.slice(0, 80));
  return [
    ...(sinCita.length
      ? [`Los requisitos excluyentes deben citar documento y página del pliego: ${lista(sinCita)}.`]
      : []),
    ...(sinFuente.length
      ? [
          `Con cumple «si» o «no», di en «fuente» qué dato nuestro lo decide (perfil, notas, colaboradores…): ${lista(sinFuente)}.`,
        ]
      : []),
  ];
}

// Una frase que pide un papel: nombra una certificación (ENS, ISO de 4-5 cifras…) o dice
// «requisito exigible», sin decir a la vez que no se exige («no se exige ISO ni ENS»).
const REQUISITO_EXIGIBLE = /requisito exigible/;
const LARGO_CITA = 300;

function fraseQuePide(texto: string): string | null {
  const frases = texto
    .split(/(?<=[.;])\s+|\n+/)
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return (
    frases.find((f) => {
      const t = textoComparable(f);
      const nombra =
        certificaciones(f).some((c) => c.clave === 'ens' || c.clave.startsWith('iso-')) || REQUISITO_EXIGIBLE.test(t);
      return nombra && !exime(t);
    }) ?? null
  );
}

/**
 * Si la cobertura dice que el pliego no pide certificaciones y un pasaje de certificaciones
 * (las rectificaciones y notas posteriores incluidas) sí pide una, la frase para Hermes con la
 * cita; si no, null. Una nota de rectificación puede exigir una certificación que la ficha no leyó.
 */
export function certificacionesOmitidas(cobertura: CoberturaTema[] | undefined, pasajes: Pasaje[]): string | null {
  if (!cobertura?.some((c) => c.tema === 'certificaciones' && c.estado === 'no_lo_pide')) return null;
  for (const p of pasajes) {
    const frase = fraseQuePide(p.texto);
    if (!frase) continue;
    const cita = frase.length > LARGO_CITA ? `${frase.slice(0, LARGO_CITA - 1)}…` : frase;
    return `La cobertura dice que el pliego no pide certificaciones, pero «${path.posix.basename(p.ruta)}»${p.pagina ? ` pág. ${p.pagina}` : ''} dice: «${cita}». Añade el requisito o explica por qué no se exige.`;
  }
  return null;
}

/** Problemas de cobertura y de citas de una ficha, y cuánto cubre (para la calidad). */
export function coberturaDeFicha(
  cobertura: CoberturaTema[] | undefined,
  requisitos: RequisitoCubierto[],
  pendientesPlacsp: Evaluacion[],
): ResultadoCobertura {
  const checklist = problemasChecklist(cobertura ?? [], requisitos);
  const placsp = problemasPlacsp(pendientesPlacsp, requisitos);
  return {
    problemas: [...checklist.problemas, ...placsp.problemas, ...problemasCitas(requisitos)],
    checklist_pct: Math.round((100 * checklist.cubiertos) / TEMAS_CHECKLIST.length),
    placsp_pct: placsp.total ? Math.round((100 * placsp.cubiertos) / placsp.total) : 100,
  };
}
