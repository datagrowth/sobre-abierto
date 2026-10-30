// Tema claro neutro de Sobre Abierto. Única fuente de color: los componentes importan de aquí
// nombres que valen `var(--so-…)`, y index.css declara esas variables en :root con los valores de
// PALETA (un test comprueba que coinciden). Cada instalación puede cambiar los tokens en Ajustes ›
// Marca (el servidor los valida con nucleo/tema.ts, que los copia, y los pone en la página). El
// color dice quién hizo qué: tinta para la estructura y el
// texto, verde para tu acción y lo decidido, índigo para lo que propone o hace Hermes, y rojo y
// ámbar solo para «Impide» y «Riesgo».

/** Los valores de cada token. Solo los leen los tests: index.css los declara igual y el contraste se mide sobre ellos. */
export const PALETA = {
  '--so-lienzo': '#FFFFFF',
  '--so-superficie-2': '#F3F4F6',
  '--so-borde': '#E5E7EB',
  '--so-borde-control': '#6B7280',
  '--so-tinta': '#1F2937',
  '--so-tinta-2': '#4B5563',
  '--so-accion': '#A7F3D0',
  '--so-accion-hover': '#6EE7B7',
  '--so-accion-suave': '#ECFDF5',
  '--so-accion-borde': '#34D399',
  '--so-ok-texto': '#047857',
  '--so-hermes': '#C7D2FE',
  '--so-hermes-suave': '#EEF2FF',
  '--so-hermes-punto': '#6366F1',
  '--so-impide': '#B42318',
  '--so-impide-suave': '#FEF3F2',
  '--so-riesgo': '#B54708',
  '--so-riesgo-suave': '#FFFAEB',
};

// Los atributos de color de SVG (iconos lucide, gráficos) resuelven var() y color-mix() como el CSS.
const v = (nombre) => `var(${nombre})`;

// Superficies: lienzo y paneles en blanco; el claro, para cabeceras de tabla, hover y bloques secundarios.
export const LIENZO = v('--so-lienzo');
export const SUPERFICIE_2 = v('--so-superficie-2');
export const BORDE = v('--so-borde');
// Borde de campos y botones secundarios: 3,3:1 sobre blanco (WCAG 1.4.11 pide 3:1).
export const BORDE_CONTROL = v('--so-borde-control');

// Texto. No hay un gris más claro que tinta-2 para texto (5,0:1).
export const TINTA = v('--so-tinta');
export const TINTA_2 = v('--so-tinta-2');

// Tu acción y lo decidido. El verde nunca es texto: encima va tinta; «Cumple» o «Hecho» en ok-texto.
export const ACCION = v('--so-accion');
const ACCION_HOVER = v('--so-accion-hover');
export const ACCION_SUAVE = v('--so-accion-suave');
// El contorno del verde cuando va sobre blanco (marca de lo activo, punto de «nosotros»).
const ACCION_BORDE = v('--so-accion-borde');
export const OK_TEXTO = v('--so-ok-texto');

// Hermes. El lavanda nunca es texto: es borde, punto o fondo.
export const HERMES = v('--so-hermes');
const HERMES_SUAVE = v('--so-hermes-suave');
export const HERMES_PUNTO = v('--so-hermes-punto');

// Estado, siempre con su palabra al lado.
export const IMPIDE = v('--so-impide');
const IMPIDE_SUAVE = v('--so-impide-suave');
export const RIESGO = v('--so-riesgo');
export const RIESGO_SUAVE = v('--so-riesgo-suave');

// Solo en lo que flota (cajón, menú, diálogo); las tarjetas llevan borde, no sombra. Del color de
// la tinta, para que sigan al tema de la instalación.
export const SOMBRA_CAPA = `0 8px 24px ${alpha(TINTA, 0.12)}`;
// El velo detrás de un diálogo o un cajón en el móvil.
export const VELO = alpha(TINTA, 0.32);

// Semáforo de requisitos y opinión de Hermes en la criba: el mismo color en la lista, la
// cabecera de la ficha y los chips. Lo descartado, apagado (como lo vencido).
export const COLOR_SEMAFORO = { verde: OK_TEXTO, ambar: RIESGO, rojo: IMPIDE };
export const COLOR_VEREDICTO = { interesa: OK_TEXTO, revisar: RIESGO, descartar: TINTA_2 };

// Radios: 8 px en controles, 12 en tarjetas; píldora en botones principales y chips.
export const RADIUS = 8;
export const RADIUS_PANEL = 12;
export const RADIUS_PILDORA = 999;

// Escala tipográfica (px): leyendas, tablas, cuerpo, título de bloque, de página y cifra destacada.
export const TIPO = { pequeno: 12, texto: 13, base: 14, titulo: 16, grande: 20, cifra: 28 };

export const FONT_SANS = "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace";

/** Color con transparencia, también sobre un `var(--…)`: alpha(ACCION, 0.2) → color-mix(…). */
export function alpha(color, opacity) {
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 1000) / 10}%, transparent)`;
}

/** Pares texto/fondo que la interfaz usa, con el mínimo WCAG que deben cumplir (test de contraste). */
export const PARES_CONTRASTE = [
  { texto: '--so-tinta', fondo: '--so-lienzo', minimo: 4.5 },
  { texto: '--so-tinta', fondo: '--so-superficie-2', minimo: 4.5 },
  { texto: '--so-tinta-2', fondo: '--so-lienzo', minimo: 4.5 },
  { texto: '--so-tinta-2', fondo: '--so-superficie-2', minimo: 4.5 },
  { texto: '--so-tinta', fondo: '--so-accion', minimo: 4.5 },
  { texto: '--so-tinta', fondo: '--so-accion-suave', minimo: 4.5 },
  { texto: '--so-ok-texto', fondo: '--so-lienzo', minimo: 4.5 },
  { texto: '--so-ok-texto', fondo: '--so-accion-suave', minimo: 4.5 },
  { texto: '--so-tinta', fondo: '--so-hermes', minimo: 4.5 },
  { texto: '--so-tinta', fondo: '--so-hermes-suave', minimo: 4.5 },
  { texto: '--so-impide', fondo: '--so-lienzo', minimo: 4.5 },
  { texto: '--so-impide', fondo: '--so-impide-suave', minimo: 4.5 },
  { texto: '--so-riesgo', fondo: '--so-lienzo', minimo: 4.5 },
  { texto: '--so-riesgo', fondo: '--so-riesgo-suave', minimo: 4.5 },
  { texto: '--so-borde-control', fondo: '--so-lienzo', minimo: 3 },
  { texto: '--so-hermes-punto', fondo: '--so-lienzo', minimo: 3 },
];
