// Las decisiones por secciones: cada sección del cajón se guarda sola (PATCH
// …/oferta/decisiones/:seccion), así que hace falta saber qué sección está sin guardar y sacar
// solo su valor del formulario. Reutiliza la lectura del formulario de ofertaFormato.js pasándole
// solo esa sección: un error en el equipo no impide leer el precio. Sin React para poder probarlo.
import { hayCambios, leerDecisiones } from './ofertaFormato.js';

/** En el orden del cajón. */
const SECCIONES = ['lotes', 'equipo', 'automaticos', 'herramientas', 'enfoque', 'precio'];

// La sección «precio» es el campo `ofertas` del formulario; las demás se llaman igual.
const CAMPO = {
  lotes: 'lotes',
  equipo: 'equipo',
  automaticos: 'automaticos',
  herramientas: 'herramientas',
  enfoque: 'enfoque',
  precio: 'ofertas',
};

export const campoDeSeccion = (seccion) => CAMPO[seccion] ?? null;

/**
 * El valor de una sección tal como lo pide el PATCH, o el error para la persona.
 * @returns {{ data: unknown, error: string | null }}
 */
export function datosDeSeccion(campos, seccion) {
  const campo = campoDeSeccion(seccion);
  if (!campo) return { data: null, error: `No hay ninguna sección «${String(seccion)}» en las decisiones.` };
  const r = leerDecisiones({ [campo]: campos?.[campo] });
  if (r.error) return { data: null, error: r.error };
  return { data: r.body[campo], error: null };
}

/** Las secciones del formulario que difieren de lo cargado, en el orden del cajón. */
export function seccionesSucias(campos, base) {
  return SECCIONES.filter((s) => hayCambios(campos?.[CAMPO[s]], base?.[CAMPO[s]]));
}

// Quién sale y quién entra o cambia de rol, dedicación o lotes. El cálculo pide al menos una persona:
// si solo cambió el orden, van todas como «no sale» (se revisa lo que las nombra).
function cambioDeEquipo(antes = [], despues = []) {
  const id = (p) => Number(p.persona_id);
  const previa = new Map(antes.map((p) => [id(p), p]));
  const ahora = new Set(despues.map(id));
  const salen = antes.filter((p) => !ahora.has(id(p))).map((p) => ({ persona_id: id(p), sale: true }));
  const cambian = despues
    .filter((p) => hayCambios(p, previa.get(id(p))))
    .map((p) => ({ persona_id: id(p), sale: false }));
  const todas = [...salen, ...cambian].filter((c) => Number.isInteger(c.persona_id) && c.persona_id > 0);
  return todas.length
    ? todas
    : despues.map((p) => ({ persona_id: id(p), sale: false })).filter((c) => c.persona_id > 0);
}

/**
 * Lo que se manda a POST /oferta/impacto antes de guardar una sección (sin importes: del precio,
 * solo el lote). null si no hay nada que calcular.
 */
export function cambioDeImpacto(seccion, campos, base, lote = null) {
  if (seccion === 'lotes') return { lotes: [...(campos?.lotes ?? [])] };
  if (seccion === 'precio') return { decisiones: { precio: { lote } } };
  if (seccion === 'equipo') {
    const equipo = cambioDeEquipo(base?.equipo, campos?.equipo);
    return equipo.length ? { decisiones: { equipo } } : null;
  }
  return CAMPO[seccion] ? { decisiones: { [seccion]: true } } : null;
}

/**
 * Llega otra base del servidor (lo guardado). Cada sección sin cambios la adopta, y también la
 * que tiene justo lo que llega (lo recién guardado); la que tiene cambios distintos se respeta y
 * sale en `ajenas` (otra persona guardó mientras se editaba). Devuelve el mismo objeto si no cambia nada.
 */
export function adoptarBase(form, base) {
  let { campos, base: cargada } = form;
  const ajenas = [];
  for (const s of SECCIONES) {
    const k = CAMPO[s];
    if (!hayCambios(base?.[k], cargada?.[k])) continue;
    const propia = hayCambios(campos?.[k], cargada?.[k]) && hayCambios(campos?.[k], base?.[k]);
    if (propia) {
      ajenas.push(s);
      continue;
    }
    campos = { ...campos, [k]: base[k] };
    cargada = { ...cargada, [k]: base[k] };
  }
  return { campos, base: cargada, ajenas };
}
