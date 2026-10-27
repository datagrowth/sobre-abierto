// Memoria por lote: si el pliego exige una memoria específica por lote, se redacta una por lote decidido.
import { textoComparable } from '../temas.js';
import type { DecisionesData } from './decisiones.js';
import type { GuionBaseData } from './guion.js';

// Por ejemplo «una Memoria Técnica específica para cada lote». Cada una se escribe con las decisiones de su
// lote. Módulo puro: lee el guion y las decisiones, no la base.
// Sobre textoComparable (minúsculas y sin tildes). Los guiones anteriores a «por_lote» solo lo
// dicen en el texto: en una advertencia, en el contenido del archivo o en el nombre del documento.
const PIDE_POR_LOTE: RegExp[] = [
  /memoria[^.;]{0,80}\b(?:para|por|de) cada lote/,
  /tant[oa]s (?:memorias|proposiciones|ofertas|anexos)[^.;]{0,40}como (?:a )?lotes/,
  /una memoria (?:tecnica )?(?:especifica|independiente|distinta) (?:para|por) (?:cada )?lote/,
];

// Solo el archivo de la memoria: «tantas ofertas como lotes» en el de la oferta económica habla del precio, no de la memoria.
function textosDeLaMemoria(g: GuionBaseData): string[] {
  const mem = g.memoria;
  if (!mem) return [];
  const archivo = g.archivos.find((a) => a.nombre === mem.archivo);
  const docs = g.archivos.flatMap((a) => a.documentos).filter((d) => d.tipo === 'memoria');
  return [
    mem.titulo_documento,
    ...mem.advertencias,
    mem.limite_detalle ?? '',
    archivo?.contenido ?? '',
    ...docs.flatMap((d) => [d.nombre, d.notas ?? '']),
  ];
}

/** ¿Pide el pliego una memoria por lote? Lo que diga el guion («por_lote») manda sobre el texto. */
export function memoriaPorLote(g: GuionBaseData): boolean {
  const mem = g.memoria;
  if (!mem) return false;
  if (mem.por_lote !== undefined) return mem.por_lote;
  if (g.archivos.find((a) => a.nombre === mem.archivo)?.ambito === 'por_lote') return true;
  const texto = textoComparable(textosDeLaMemoria(g).join(' \n '));
  return PIDE_POR_LOTE.some((re) => re.test(texto));
}

/** Los lotes con memoria propia: los decididos si el pliego pide una por lote y son dos o más; null = una sola común. */
export function lotesDeMemoria(g: GuionBaseData, lotesDecididos: string[]): string[] | null {
  const lotes = [...new Set(lotesDecididos)];
  return lotes.length >= 2 && memoriaPorLote(g) ? lotes : null;
}

const vaEnElLote = (lotes: string[], lote: string): boolean => !lotes.length || lotes.includes(lote);

/** Las decisiones que valen para la memoria de un lote (null = la común: todas). */
export function decisionesDelLote(d: DecisionesData, lote: string | null): DecisionesData {
  if (lote === null) return d;
  return {
    ...d,
    lotes: [lote],
    equipo: d.equipo.filter((m) => vaEnElLote(m.lotes, lote)),
    automaticos: d.automaticos.filter((a) => a.lote === null || a.lote === lote),
    ofertas: d.ofertas.filter((o) => o.lote === lote),
  };
}
