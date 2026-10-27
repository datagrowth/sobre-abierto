// Adaptador de la coherencia de la oferta (coherencia.ts) a filas de las comprobaciones.
import {
  MINUTOS_POR_ACCION,
  claveBloqueo,
  huellaDe,
  type AccionBloqueo,
  type Actor,
  type Bloqueo,
  type Categoria,
} from './comprobacionesTipos.js';
import type { Donde, Incoherencia, TipoIncoherencia } from './coherencia.js';

// Las comprobaciones no son un segundo motor: reutiliza lo que ya cruza y solo le da categoría, actor, acción y
// una clave estable. Los tipos que sustituyen las reglas nuevas de las comprobaciones no pasan: saldrían dos
// veces.
const SUSTITUIDOS: ReadonlySet<TipoIncoherencia> = new Set([
  'equipo',
  'medios_sin_acreditar',
  'automaticos_sin_acreditar',
  'plazo',
  'precio_lotes',
]);
const DE_PRECIO: ReadonlySet<TipoIncoherencia> = new Set(['precio_maximo', 'precio_anormal']);
const DE_DECISIONES: ReadonlySet<TipoIncoherencia> = new Set(['lotes_decisiones', 'automaticos_lotes', 'equipo_lotes']);

const ACCION_POR_TIPO: Partial<Record<TipoIncoherencia, AccionBloqueo>> = {
  precio_maximo: 'fijar_precio',
  precio_anormal: 'fijar_precio',
  automaticos_lotes: 'desmarcar_criterio',
  equipo_lotes: 'asignar_rol',
};
const ACCION_POR_DONDE: Record<Donde, AccionBloqueo> = {
  lotes: 'aplicar_diff',
  ficha: 'rehacer_ficha',
  pliegos: 'esperar_hermes',
  guion: 'extraer_guion',
  decisiones: 'aplicar_diff',
};

// La ficha nueva que pide pliegos_nuevos ya la pide la regla de la ficha de las comprobaciones.
const sustituida = (c: Incoherencia): boolean =>
  SUSTITUIDOS.has(c.tipo) || (c.tipo === 'pliegos_nuevos' && c.donde === 'ficha');

function categoriaDe(c: Incoherencia): Categoria {
  if (DE_PRECIO.has(c.tipo)) return 'precio';
  if (DE_DECISIONES.has(c.tipo)) return 'decisiones';
  return c.donde === 'guion' || c.donde === 'decisiones' ? 'decisiones' : 'elegibilidad';
}

// Bajar pliegos y extraer el guion es trabajo de Hermes; lo demás lo arregla la persona.
const actorDe = (c: Incoherencia): Actor => (c.donde === 'pliegos' || c.donde === 'guion' ? 'hermes' : 'tu');

// Ningún título lleva importes: Hermes y el MCP también las leen y el MCP, y de ahí sale la memoria.
const PARENTESIS_CON_IMPORTE = /\s*\([^()]*€[^()]*\)/g;
const IMPORTE = /\d[\d.]*(?:,\d+)?\s?(?:€|euros?\b)(?:\s*(?:\/|por)\s*[a-záéíóúñ]+)?/gi;
export const sinImportes = (t: string): string => t.replace(PARENTESIS_CON_IMPORTE, '').replace(IMPORTE, 'el importe');

// El lote solo cuando el mensaje habla de uno: «los lotes 2, 4» no es de ninguno en concreto.
function loteDe(mensaje: string): string | null {
  if (/\blotes\b/i.test(mensaje)) return null;
  const lotes = new Set([...mensaje.matchAll(/\blote\s+([A-Za-z0-9._-]{1,20}?)(?=[\s,.:;)]|$)/gi)].map((m) => m[1]!));
  return lotes.size === 1 ? [...lotes][0]! : null;
}

// Sin cifras, para que un importe o una fecha nuevos no cambien la clave (sí cambian la huella).
const sujetoDe = (mensaje: string): string => huellaDe(mensaje.replace(/\d+(?:[.,]\d+)*/g, '#')).slice(0, 8);

function bloqueoDe(c: Incoherencia): Bloqueo {
  const lote = loteDe(c.mensaje);
  const actor = actorDe(c);
  const tipo = ACCION_POR_TIPO[c.tipo] ?? ACCION_POR_DONDE[c.donde];
  return {
    clave: lote ? claveBloqueo(c.tipo, lote) : claveBloqueo(c.tipo, null, sujetoDe(c.mensaje)),
    categoria: categoriaDe(c),
    lote,
    gravedad: c.gravedad === 'bloquea' ? 'impide' : 'riesgo',
    titulo: sinImportes(c.mensaje),
    cita: null,
    actor,
    accion: { tipo, destino: c.donde },
    propuesta: null,
    minutos: actor === 'fuera' ? 0 : MINUTOS_POR_ACCION[tipo],
    estado: 'abierto',
    huella: huellaDe(c.tipo, c.gravedad, c.mensaje),
  };
}

/** Las incoherencias de siempre como filas de las comprobaciones, una por clave (si dos chocan, la segunda lleva su sujeto). */
export function desdeCoherencia(inc: readonly Incoherencia[]): Bloqueo[] {
  const vistas = new Set<string>();
  return inc
    .filter((c) => !sustituida(c))
    .map((c) => {
      const b = bloqueoDe(c);
      const clave = vistas.has(b.clave) ? `${b.clave}:${sujetoDe(c.mensaje)}` : b.clave;
      vistas.add(clave);
      return { ...b, clave };
    });
}
