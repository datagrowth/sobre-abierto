// Perfil de costes internos (Ajustes › Empresa › Costes internos) ⇄ formulario, sin React y con
// tests. Los rangos repiten los del servidor (nucleo/perfilCostes.ts) solo para avisar antes de
// enviar: el servidor vuelve a validarlo todo. Las fracciones se escriben en % porque «75 %» se
// entiende mejor que «0,75».
import { numeroONulo } from './formato.js';

// tipo: 'numero' (decimales), 'entero' o 'pct' (fracción guardada, % en el formulario).
const campo = (clave, etiqueta, unidad, [min, max], tipo = 'numero', ayuda = '') => ({
  clave,
  etiqueta,
  unidad,
  min,
  max,
  tipo,
  ayuda,
});

export const GRUPOS_COSTES = [
  {
    id: 'precios',
    titulo: 'Precios',
    campos: [
      campo(
        'euros_hora',
        'Coste de una hora de trabajo',
        '€/h',
        [1, 1000],
        'numero',
        'Sin perfil guardado se usa el de la instalación (LICITACIONES_PRECIO_HORA) o 25 €/h.',
      ),
      campo('euros_material_por_persona', 'Material por persona', '€', [0, 1000]),
      campo('euros_envio_por_persona', 'Envío por persona', '€', [0, 200]),
    ],
  },
  {
    id: 'supuestos',
    titulo: 'Supuestos del cálculo',
    campos: [
      campo(
        'fraccion_aptas',
        'Alumnado que acaba apto',
        '%',
        [0, 1],
        'pct',
        'Para lo que se promete a quien termina (entrevistas, informes, certificados).',
      ),
      campo(
        'fraccion_ruta_apoyo',
        'Alumnado en la ruta de apoyo',
        '%',
        [0, 1],
        'pct',
        'Para lo que se promete solo a quien necesita seguimiento individual.',
      ),
      campo('tamano_subgrupo', 'Tamaño de un subgrupo', 'personas', [1, 200], 'entero'),
      campo(
        'plazo_referencia_dias',
        'Plazo de respuesta de referencia',
        'días hábiles',
        [1, 60],
        'entero',
        'Lo que se puede cumplir sin coste extra: un plazo más corto es un compromiso añadido.',
      ),
      campo('minutos_preparacion_individual', 'Preparación por persona', 'min', [0, 240]),
      campo('horas_preparacion_por_hora_lectiva', 'Preparación por hora lectiva', 'h', [0, 10]),
      campo('horas_por_contacto', 'Horas por contacto (entrevista, empleador)', 'h', [0, 40]),
      campo('horas_montaje_aula', 'Montaje de un aula', 'h', [0, 200]),
      campo('horas_aula_semana', 'Horas de aula por semana', 'h', [0, 60]),
      campo('horas_por_informe', 'Horas por informe', 'h', [0, 80]),
      campo('minutos_extra_comentario', 'Minutos extra por comentario', 'min', [0, 60]),
    ],
  },
  {
    id: 'umbrales',
    titulo: 'Cuándo avisar',
    campos: [
      campo('umbral_horas', 'Un compromiso a partir de', 'h', [0, 10_000]),
      campo('umbral_euros', 'o a partir de', '€', [0, 1_000_000]),
      campo('umbral_pct_presupuesto', 'o del presupuesto base del lote', '%', [0, 1], 'pct'),
      campo(
        'umbral_total_pct',
        'Todos los añadidos juntos a partir de',
        '% del presupuesto',
        [0, 10],
        'pct',
        'Puede pasar de 100 %: los añadidos pueden costar más que el contrato.',
      ),
    ],
  },
];

const CAMPOS = GRUPOS_COSTES.flatMap((g) => g.campos);

// de-DE agrupa siempre los miles y usa coma decimal, como lo escribe la gente; numeroONulo lo
// vuelve a leer igual (mismo criterio que empresaFormulario).
const FORMATO = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
// Sin redondear, 0,07 × 100 sale 7,000000000000001.
const aPorcentaje = (n) => Math.round(n * 100 * 1000) / 1000;

function aTexto(c, n) {
  if (typeof n !== 'number') return '';
  return FORMATO.format(c.tipo === 'pct' ? aPorcentaje(n) : n);
}

/** Perfil del servidor → textos del formulario. Sin perfil, campos vacíos (= por defecto). */
export function perfilCostesAFormulario(perfil) {
  return Object.fromEntries(CAMPOS.map((c) => [c.clave, aTexto(c, perfil?.[c.clave])]));
}

const limite = (c, n) => FORMATO.format(c.tipo === 'pct' ? aPorcentaje(n) : n);

// El número leído, o el mensaje de por qué no vale.
function leerCampo(c, texto) {
  const n = numeroONulo(texto);
  if (n === null) return { valor: null };
  if (Number.isNaN(n)) return { error: `${c.etiqueta}: escribe un número igual o mayor que 0.` };
  const valor = c.tipo === 'pct' ? n / 100 : n;
  if (c.tipo === 'entero' && !Number.isInteger(valor)) return { error: `${c.etiqueta}: escribe un número entero.` };
  if (valor < c.min || valor > c.max)
    return { error: `${c.etiqueta}: entre ${limite(c, c.min)} y ${limite(c, c.max)} ${c.unidad}.` };
  return { valor };
}

/** Textos del formulario → perfil (null = vacío, toma el valor por defecto) y los errores. */
export function formularioAPerfilCostes(valores) {
  const perfil = {};
  const errores = [];
  for (const c of CAMPOS) {
    const r = leerCampo(c, valores?.[c.clave]);
    if (r.error) errores.push(r.error);
    else perfil[c.clave] = r.valor;
  }
  return { perfil, errores };
}

/**
 * Lo que se envía al PUT: sin los vacíos. El servidor pone el valor por defecto a lo que no
 * llega, pero un null explícito lo rechaza (su esquema es estricto).
 */
export function cuerpoPerfilCostes(perfil) {
  return Object.fromEntries(Object.entries(perfil).filter(([, v]) => v !== null && v !== undefined));
}
