// Ajustes › Marca (sin React, con tests): el nombre de la app y los colores de la instalación ⇄
// formulario. El servidor vuelve a validarlo (tokens que existen, #RRGGBB y contraste AA); aquí
// solo se envían los colores que cambian respecto al tema neutro de tema.js.
import { PALETA } from './tema.js';

const PREFIJO = '--so-';
const HEX = /^#[0-9a-fA-F]{6}$/;

// En el orden de PALETA, con un nombre que se entiende.
const NOMBRES = {
  lienzo: 'Fondo',
  'superficie-2': 'Superficie',
  borde: 'Borde',
  'borde-control': 'Borde de los campos',
  tinta: 'Texto',
  'tinta-2': 'Texto secundario',
  accion: 'Acción',
  'accion-hover': 'Acción al pasar',
  'accion-suave': 'Acción, fondo suave',
  'accion-borde': 'Acción, contorno',
  'ok-texto': 'Texto de «hecho»',
  hermes: 'Hermes',
  'hermes-suave': 'Hermes, fondo suave',
  'hermes-punto': 'Hermes, punto',
  impide: 'Impide',
  'impide-suave': 'Impide, fondo suave',
  riesgo: 'Riesgo',
  'riesgo-suave': 'Riesgo, fondo suave',
};

/** [{ token, nombre, neutro }] de cada color que se puede cambiar. */
export const TOKENS_MARCA = Object.entries(PALETA).map(([variable, neutro]) => {
  const token = variable.slice(PREFIJO.length);
  return { token, nombre: NOMBRES[token] ?? token, neutro: neutro.toUpperCase() };
});

/** La marca del servidor → { nombre, colores: { token: '#RRGGBB' } } con todos los tokens. */
export function marcaAFormulario(marca) {
  const tema = marca?.tema ?? {};
  return {
    nombre: marca?.nombre ?? '',
    colores: Object.fromEntries(
      TOKENS_MARCA.map(({ token, neutro }) => [token, (tema[token] ?? neutro).toUpperCase()]),
    ),
  };
}

/** Formulario → { marca: { nombre, tema }, errores }: en el tema solo va lo que no es neutro. */
export function formularioAMarca(f) {
  const errores = [];
  const nombre = String(f.nombre ?? '').trim();
  if (!nombre) errores.push('Escribe el nombre de la aplicación.');
  const tema = {};
  for (const { token, nombre: etiqueta, neutro } of TOKENS_MARCA) {
    const color = String(f.colores?.[token] ?? neutro)
      .trim()
      .toUpperCase();
    if (!HEX.test(color)) errores.push(`${etiqueta}: escribe el color como #RRGGBB.`);
    else if (color !== neutro) tema[token] = color;
  }
  return { marca: { nombre, tema }, errores };
}

/** Las variables CSS del tema propio (las que no se nombran vuelven a las de index.css). */
export function variablesDelTema(tema = {}) {
  return TOKENS_MARCA.map(({ token }) => [`${PREFIJO}${token}`, tema[token] ?? null]);
}
