// Catálogo de la Biblioteca: de qué tipo es cada nota, de qué sector y cuándo se revisó. Puro: sin disco.

export const TIPOS_NOTA = [
  'caso_exito',
  'metodologia',
  'ficha_servicio',
  'normativa_cliente',
  'oferta_presentada',
  'plantilla',
] as const;
type TipoNota = (typeof TIPOS_NOTA)[number];

const comparable = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Por la carpeta, de lo más específico a lo más general.
const POR_CARPETA: [RegExp, TipoNota][] = [
  [/plantilla/, 'plantilla'],
  [/caso|exito|referencia/, 'caso_exito'],
  [/metodolog/, 'metodologia'],
  [/servicio/, 'ficha_servicio'],
  [/cliente|normativa/, 'normativa_cliente'],
  [/licitacion|presentad|ofertas?\b/, 'oferta_presentada'],
];
const DOCE_MESES_MS = 365 * 86_400_000;

export type Catalogo = {
  tipo: TipoNota | null;
  tipo_deducido: boolean;
  sector: string | null;
  revisada_en: string;
  revisar: boolean;
};

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : v instanceof Date ? v.toISOString() : null;

// Se lee del frontmatter (`tipo`, `sector`, `revisada_en`); sin `tipo`, se deduce de la carpeta (y se dice que es
// deducido); sin `revisada_en`, cuenta la última modificación. Una nota sin revisar en más de 12 meses pide «Revisar».
export function catalogoDe(
  fm: Record<string, unknown>,
  rutaRelativa: string,
  modificadoEn: string,
  ahoraMs = Date.now(),
): Catalogo {
  const declarado = texto(fm['tipo']);
  const tipo = declarado && (TIPOS_NOTA as readonly string[]).includes(declarado) ? (declarado as TipoNota) : null;
  const carpeta = comparable(rutaRelativa.split('/').slice(0, -1).join('/'));
  const deducido = tipo ? null : (POR_CARPETA.find(([re]) => re.test(carpeta))?.[1] ?? null);
  const fecha = texto(fm['revisada_en']);
  const revisada_en = fecha && !Number.isNaN(Date.parse(fecha)) ? new Date(fecha).toISOString() : modificadoEn;
  return {
    tipo: tipo ?? deducido,
    tipo_deducido: !tipo && deducido !== null,
    sector: texto(fm['sector']),
    revisada_en,
    revisar: ahoraMs - Date.parse(revisada_en) > DOCE_MESES_MS,
  };
}
