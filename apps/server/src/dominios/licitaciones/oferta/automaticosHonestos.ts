// Criterios automáticos que no pueden mentir en el anexo (declaración inexacta). Puro.
import { textoComparable } from '../temas.js';
import type { DecisionesData } from './decisiones.js';
import type { AutomaticoGuion, GuionBaseData } from './guion.js';
import { automaticoDe, claveCriterio } from './guionLotes.js';
import { pideEvidencia, type PropuestaGuardada } from './propuestaDecisiones.js';

// Acogerse a un criterio con una nota que dice lo contrario, o a uno que hay que acreditar sin decir con qué, es
// una declaración inexacta en el anexo (p. ej. una nota «No nos acogemos: exige dossier…» con el criterio
// marcado como sí).
export type AutomaticoContradictorio = {
  criterio: string;
  lote: string | null;
  motivo: 'nota_contraria' | 'sin_evidencia';
  // Lo que el pliego pide para acreditarlo, si lo dice.
  exige: string | null;
};

type Decidido = DecisionesData['automaticos'][number];
type Propuesto = PropuestaGuardada['datos']['automaticos'][number];

const NOTA_CONTRARIA = /^\s*no nos acogemos\b/;
const notaContraria = (nota: string | undefined): boolean => NOTA_CONTRARIA.test(textoComparable(nota ?? ''));

// La frase de «cómo se acredita» que nombra el documento o el hecho («Dossier Técnico Homologado…»).
const fraseConEvidencia = (como: string): string => como.split(/(?<=\.)\s+/).find(pideEvidencia) ?? como;

function exigeDe(c: AutomaticoGuion | undefined): string | null {
  if (!c) return null;
  if (c.exige_documento) return c.exige_documento;
  return pideEvidencia(c.como_se_acredita) ? fraseConEvidencia(c.como_se_acredita) : null;
}

// Hay que acreditarlo si el guion o la propuesta lo tratan como acreditación, o si el pliego pide
// un documento o un hecho que hay que tener. Un compromiso (algo que se promete hacer) no.
function pideAcreditar(c: AutomaticoGuion | undefined, p: Propuesto | undefined): boolean {
  if (c?.tipo === 'acreditacion' || p?.tipo === 'acreditacion') return true;
  return Boolean(c && (c.exige_documento || pideEvidencia(c.como_se_acredita)));
}

function propuestoDe(propuesta: PropuestaGuardada | null, a: Decidido): Propuesto | undefined {
  const clave = claveCriterio(a.criterio);
  return propuesta?.datos.automaticos.find(
    (x) => claveCriterio(x.criterio) === clave && (x.lote ?? null) === (a.lote ?? null),
  );
}

function contradiccionDe(
  a: Decidido,
  g: Pick<GuionBaseData, 'automaticos'>,
  propuesta: PropuestaGuardada | null,
): AutomaticoContradictorio | null {
  const lote = a.lote ?? null;
  const c = automaticoDe(g, a.criterio, lote);
  const exige = exigeDe(c);
  if (notaContraria(a.nota)) return { criterio: a.criterio, lote, motivo: 'nota_contraria', exige };
  const p = propuestoDe(propuesta, a);
  if (a.evidencia || p?.cumple === 'si' || !pideAcreditar(c, p)) return null;
  return { criterio: a.criterio, lote, motivo: 'sin_evidencia', exige };
}

/**
 * Los automáticos a los que se acoge la empresa y no debería: con una nota que empieza por «No nos
 * acogemos» o que piden acreditarse sin evidencia y sin que la propuesta de Hermes los dé por
 * cumplidos. La propuesta solo cuenta si es del mismo guion: eso lo decide quien llama.
 */
export function automaticosContradictorios(
  d: DecisionesData,
  g: Pick<GuionBaseData, 'automaticos'>,
  propuesta: PropuestaGuardada | null,
): AutomaticoContradictorio[] {
  return d.automaticos.filter((a) => a.nos_acogemos).flatMap((a) => contradiccionDe(a, g, propuesta) ?? []);
}
