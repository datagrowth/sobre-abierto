// «Qué cambia» antes de guardar, sin React para poder probarlo.
// Lee la respuesta de POST /oferta/impacto tal cual la da el servidor (dependencias.ts): la web
// nunca deduce que algo se mantiene si el servidor no lo dice, y una acción que no conoce sale
// «para revisar», porque un falso «se mantiene» es peor que no avisar.

// Lo que cambia de verdad (regenerar, rehacer, podar, ocultar) frente a lo que solo se marca.
const GRUPO_ACCION = { regenerar: 'rehace', rehacer: 'rehace', podar: 'rehace', ocultar: 'rehace', revisar: 'marca' };

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const lista = (v) => (Array.isArray(v) ? v : []);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Sin coste legible, la pieza no puede contar como «0 runs».
function normalizarAfectada(a) {
  const minutos = numero(a?.coste?.min);
  const runs = numero(a?.coste?.runs);
  const grupo = GRUPO_ACCION[a?.accion] ?? 'marca';
  return {
    pieza: String(a?.pieza ?? ''),
    clave: String(a?.clave ?? ''),
    nombre: String(a?.nombre ?? a?.clave ?? 'Una pieza'),
    accion: GRUPO_ACCION[a?.accion] ? a.accion : 'revisar',
    grupo,
    por: lista(a?.por).map(String),
    coste: { minutos: minutos ?? 0, runs: runs ?? 0 },
    costeConocido: minutos !== null && runs !== null,
    pierde: lista(a?.pierde).map(String),
  };
}

/**
 * Agrupa la respuesta del impacto. `sinCoste`: todo lo afectado se regenera por código con 0 runs
 * (se guarda sin preguntar). Una respuesta sin `afectadas` es un error, nunca «no cambia nada».
 * @returns {{ data: object | null, error: string | null }}
 */
export function clasificarImpacto(r) {
  if (!r || !Array.isArray(r.afectadas))
    return { data: null, error: 'La respuesta del cálculo de «Qué cambia» no se entiende.' };
  const afectadas = r.afectadas.map(normalizarAfectada);
  const minutos = afectadas.reduce((s, a) => s + a.coste.minutos, 0);
  const runs = afectadas.reduce((s, a) => s + a.coste.runs, 0);
  const sinCoste = afectadas.every((a) => a.accion === 'regenerar' && a.costeConocido) && runs === 0;
  return {
    data: {
      sinCoste,
      minutos,
      runs,
      resumen: typeof r.resumen === 'string' ? r.resumen : '',
      rehace: afectadas.filter((a) => a.grupo === 'rehace'),
      regenera: afectadas.filter((a) => a.accion === 'regenerar'),
      marca: afectadas.filter((a) => a.grupo === 'marca'),
      pierden: afectadas.filter((a) => a.pierde.length),
      mantiene: lista(r.se_mantiene).map(String),
    },
    error: null,
  };
}

/** «unos 30 min, 2 runs» o «segundos, 0 runs». */
export function textoCoste({ minutos = 0, runs = 0 } = {}) {
  const tiempo = minutos > 0 ? `unos ${Math.max(1, Math.round(minutos))} min` : 'segundos';
  return `${tiempo}, ${plural(runs, 'run', 'runs')}`;
}

/** El aviso en línea de un guardado sin coste. */
export function avisoGuardadoSinCoste(c) {
  const nombres = (c?.regenera ?? []).map((a) => a.nombre);
  if (!nombres.length) return 'Guardado. No cambia nada de lo hecho.';
  return `Guardado. Se regenera por código: ${nombres.join(', ')} (${textoCoste(c)}).`;
}

/**
 * El aviso tras guardar, sin prometer lo que nadie hace: el servidor ignora «rehacer» al guardar, así
 * que lo que cuesta runs queda sin rehacer salvo los apartados de la memoria, que pide «Qué cambia»
 * cuando conoce el cambio (`conApartados`). Lo que se regenera por código sí lo hace el guardado.
 */
export function avisoTrasGuardar(tras, c, { conApartados = false } = {}) {
  if (tras === 'marcar')
    return c
      ? 'Guardado. Lo afectado queda marcado para revisar.'
      : 'Guardado. Todo lo hecho queda marcado para revisar.';
  if (c?.sinCoste) return avisoGuardadoSinCoste(c);
  const pendientes = lista(c?.rehace).filter(
    (a) => a.accion === 'rehacer' && !(conApartados && a.pieza === 'apartado'),
  );
  if (!pendientes.length) return 'Guardado.';
  return `Guardado. Sin rehacer todavía: ${pendientes.map((a) => a.nombre).join(', ')}. Hermes no lo rehace solo: pídelo de nuevo desde su sección.`;
}

export const TEXTO_FALLO_IMPACTO = 'No se pudo calcular qué cambia. ¿Guardar y marcar todo para revisar?';

/**
 * Lo que la persona da por cerrado antes del cambio, leído de las comprobaciones (fase memoria «hecho» =
 * memoria dada por buena; fase paquete «hecho») y del impacto (la versión del paquete afectado).
 */
export function estadoParaConfirmar({ comprobaciones = null, impacto = null } = {}) {
  const fase = (n) => (comprobaciones?.fases ?? []).find((f) => f.nombre === n)?.estado;
  const pieza = lista(impacto?.afectadas).find((a) => a?.pieza === 'paquete');
  const version = Number(String(pieza?.clave ?? '').replace(/^v/, '')) || null;
  return {
    memoriaDadaPorBuena: fase('memoria') === 'hecho',
    paquete: pieza || fase('paquete') === 'hecho' ? { version } : null,
  };
}

/** Pide confirmación fuerte: tras dar por buena la memoria o con paquete generado, casilla obligatoria. */
export function pideConfirmacionFuerte(o) {
  return Boolean(o?.memoriaDadaPorBuena || o?.paquete);
}

export function textoConfirmacionFuerte(o) {
  const paquete = o?.paquete?.version ? `el paquete v${o.paquete.version}` : 'el paquete';
  if (o?.paquete) return `Entiendo que ${paquete} queda desfasado y habrá que volver a firmar`;
  return 'Entiendo que la memoria dada por buena queda desfasada y habrá que revisarla';
}

/**
 * Qué hacer con la respuesta del impacto: «directo» (0 runs, todo por código y nada dado por
 * bueno: se guarda con aviso en línea), «panel» (QueCambia) o «fallo» (no se entiende: se pregunta).
 */
export function pasoTrasImpacto(r, comprobaciones = null) {
  const { data, error } = clasificarImpacto(r);
  if (error) return { fase: 'fallo', texto: TEXTO_FALLO_IMPACTO, detalle: error };
  const o = estadoParaConfirmar({ comprobaciones, impacto: r });
  const confirmacion = pideConfirmacionFuerte(o) ? textoConfirmacionFuerte(o) : null;
  return { fase: data.sinCoste && !confirmacion ? 'directo' : 'panel', clasificacion: data, confirmacion };
}

// ── Perfil de empresa: el impacto en todas las ofertas en preparación ──

const MAX_OFERTAS_IMPACTO = 10;

/** Las ofertas en preparación de la Mesa (frenadas, en tu mesa y listas para firmar), cada una una vez. */
export function ofertasEnPreparacion(mesa) {
  const frenadas = lista(mesa?.decide_hoy).filter((x) => x?.tipo === 'frenada');
  const todas = [...frenadas, ...lista(mesa?.tu_mesa), ...lista(mesa?.listas_para_firmar)].filter((o) => o?.id);
  return [...new Map(todas.map((o) => [o.id, { id: o.id, titulo: o.titulo ?? o.id }])).values()].slice(
    0,
    MAX_OFERTAS_IMPACTO,
  );
}

/**
 * Los campos del perfil que cambian (las claves del servidor, que es lo que pide el impacto). Solo
 * los que manda el formulario: los que deriva el servidor (domicilio, certificaciones) cambian con
 * los suyos (direccion, certificados), y contarlos aparte daría cambios que nadie ha hecho.
 */
export function camposCambiados(antes, despues) {
  return Object.keys(despues ?? {}).filter(
    (k) => JSON.stringify(antes?.[k] ?? null) !== JSON.stringify(despues?.[k] ?? null),
  );
}

const NOMBRE_PIEZA = {
  anexo: (n) => plural(n, 'anexo', 'anexos'),
  portada: (n) => `la portada de ${plural(n, 'memoria', 'memorias')}`,
  apartado: (n) => plural(n, 'apartado', 'apartados'),
  paquete: (n) => plural(n, 'paquete', 'paquetes'),
};

function contarPiezas(as) {
  const cuentas = new Map();
  for (const a of as) cuentas.set(a.pieza, (cuentas.get(a.pieza) ?? 0) + 1);
  const partes = [...cuentas].map(([p, n]) => (NOMBRE_PIEZA[p] ?? ((k) => plural(k, 'pieza más', 'piezas más')))(n));
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : partes.join('');
}

function resumenAgregado(n, afectadas) {
  const c = clasificarImpacto({ afectadas }).data;
  const cabeza = `En ${plural(n, 'oferta', 'ofertas')}`;
  if (!afectadas.length) return `${cabeza}: no cambia nada de lo hecho.`;
  const verbo = c.rehace.every((a) => a.accion === 'regenerar') ? 'se regeneran' : 'se rehacen';
  const partes = [
    c.rehace.length ? `${verbo} ${contarPiezas(c.rehace)}` : '',
    c.marca.length ? `hay que revisar ${contarPiezas(c.marca)}` : '',
  ];
  const coste = c.minutos > 0 ? textoCoste(c) : plural(c.runs, 'run', 'runs');
  return `${cabeza}: ${partes.filter(Boolean).join('; ')}, ${coste}.`;
}

/**
 * Junta los impactos de varias ofertas en uno con la misma forma que el del servidor; cada pieza,
 * con su oferta. Si alguna respuesta no se entiende, null: no se puede decir qué cambia en esa.
 */
export function agregarImpactos(porOferta) {
  const ok = lista(porOferta);
  if (ok.some((o) => !Array.isArray(o?.impacto?.afectadas))) return null;
  const afectadas = ok.flatMap((o) =>
    o.impacto.afectadas.map((a) => ({
      ...a,
      clave: `${o.id}#${a?.clave ?? ''}`,
      nombre: `${o.titulo}: ${a?.nombre ?? a?.clave ?? ''}`,
    })),
  );
  const se_mantiene = ok.flatMap((o) => lista(o.impacto.se_mantiene).map((m) => `${o.titulo}: ${m}`));
  return { afectadas, se_mantiene, resumen: resumenAgregado(ok.length, afectadas) };
}
