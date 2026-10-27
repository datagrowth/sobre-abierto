// Los colores de la web que una instalación puede cambiar (Ajustes › Marca) y los pares texto/fondo que
// deben llegar a WCAG AA; con ellos se valida un tema antes de guardarlo.
import { z } from 'zod';

// Los tokens de PALETA de apps/web/src/lib/tema.js, sin «--so-»; un test comprueba que coinciden con los de la web.
export const PALETA_NEUTRA = {
  lienzo: '#FFFFFF',
  'superficie-2': '#F3F4F6',
  borde: '#E5E7EB',
  'borde-control': '#6B7280',
  tinta: '#1F2937',
  'tinta-2': '#4B5563',
  accion: '#A7F3D0',
  'accion-hover': '#6EE7B7',
  'accion-suave': '#ECFDF5',
  'accion-borde': '#34D399',
  'ok-texto': '#047857',
  hermes: '#C7D2FE',
  'hermes-suave': '#EEF2FF',
  'hermes-punto': '#6366F1',
  impide: '#B42318',
  'impide-suave': '#FEF3F2',
  riesgo: '#B54708',
  'riesgo-suave': '#FFFAEB',
} as const;
export type Token = keyof typeof PALETA_NEUTRA;
const TOKENS = Object.keys(PALETA_NEUTRA) as [Token, ...Token[]];

export const PARES_CONTRASTE: readonly { texto: Token; fondo: Token; minimo: number }[] = [
  { texto: 'tinta', fondo: 'lienzo', minimo: 4.5 },
  { texto: 'tinta', fondo: 'superficie-2', minimo: 4.5 },
  { texto: 'tinta-2', fondo: 'lienzo', minimo: 4.5 },
  { texto: 'tinta-2', fondo: 'superficie-2', minimo: 4.5 },
  { texto: 'tinta', fondo: 'accion', minimo: 4.5 },
  { texto: 'tinta', fondo: 'accion-suave', minimo: 4.5 },
  { texto: 'ok-texto', fondo: 'lienzo', minimo: 4.5 },
  { texto: 'ok-texto', fondo: 'accion-suave', minimo: 4.5 },
  { texto: 'tinta', fondo: 'hermes', minimo: 4.5 },
  { texto: 'tinta', fondo: 'hermes-suave', minimo: 4.5 },
  { texto: 'impide', fondo: 'lienzo', minimo: 4.5 },
  { texto: 'impide', fondo: 'impide-suave', minimo: 4.5 },
  { texto: 'riesgo', fondo: 'lienzo', minimo: 4.5 },
  { texto: 'riesgo', fondo: 'riesgo-suave', minimo: 4.5 },
  { texto: 'borde-control', fondo: 'lienzo', minimo: 3 },
  { texto: 'hermes-punto', fondo: 'lienzo', minimo: 3 },
];

const Color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color #RRGGBB')
  .transform((c) => c.toUpperCase());
/** Solo los tokens que cambian; uno que no existe se rechaza, no se ignora. */
export const Tema = z.partialRecord(z.enum(TOKENS), Color);
export type TemaData = z.infer<typeof Tema>;

// Luminancia relativa y contraste de WCAG 2.x, como lib/tema.test.mjs en la web.
function luminancia(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Los pares que el tema (sobre la paleta neutra) deja por debajo de su mínimo, dichos para una persona. */
export function problemasDeContraste(tema: TemaData): string[] {
  const p: Record<Token, string> = { ...PALETA_NEUTRA, ...tema };
  return PARES_CONTRASTE.flatMap(({ texto, fondo, minimo }) => {
    const r = contraste(p[texto], p[fondo]);
    return r >= minimo
      ? []
      : [
          `«${texto}» sobre «${fondo}»: ${r.toFixed(2).replace('.', ',')}:1 (mínimo ${String(minimo).replace('.', ',')}:1)`,
        ];
  });
}
