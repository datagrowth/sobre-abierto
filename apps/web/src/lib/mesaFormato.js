// La Mesa (GET /mesa, sacada de las comprobaciones de cada oferta) para «Siguiente tarea» de las comprobaciones, sin
// React para poder probarla. Los bloques los agrupa el servidor y aquí se respetan; solo si llega
// una lista plana se agrupa con los mismos criterios. La misma oferta cuenta una sola vez.
import { diasDeCalendario, instanteLocal } from './formato.js';
import { rutaComprobaciones } from './rutas.js';

// Una ficha por revisar entra en «Decide hoy» si su próximo plazo (la solicitud, si la hay) cae
// en estos días de calendario peninsular o menos: los mismos que DIAS_DECIDE_HOY del servidor.
const DIAS_DECIDE_HOY = 3;

const lista = (v) => (Array.isArray(v) ? v : []);
const LISTA_PARA_FIRMAR = new Set(['lista_para_firmar', 'presentable_con_riesgos']);

const instante = (iso) => instanteLocal(iso ?? '') ?? Number.POSITIVE_INFINITY;
// Lo que vence antes, primero: la fecha límite para decidir de una oferta o el plazo de una ficha.
const urgencia = (x) =>
  x?.tipo === 'ficha_por_revisar' ? instante(x.plazo) : instante(x?.limite_decidir ?? x?.vence_en);
const porUrgencia = (a, b) =>
  urgencia(a) - urgencia(b) || instante(a.vence_en) - instante(b.vence_en) || String(a.id).localeCompare(String(b.id));

const esFicha = (x) => x?.tipo === 'ficha_por_revisar';
const esFrenada = (x) =>
  x?.tipo === 'frenada' ||
  x?.frenada === true ||
  (x?.veredicto?.tipo === 'no_presentable' && x?.primer_bloqueo?.categoria === 'elegibilidad');

function fichaConPrisa(x, ahora) {
  const t = instanteLocal(x?.plazo ?? '');
  return t !== null && t >= ahora && diasDeCalendario(t, ahora) <= DIAS_DECIDE_HOY;
}

// Lista plana (un servidor sin agrupar): los criterios del servidor (mesa.ts).
function agrupar(items, ahora) {
  const g = { decide_hoy: [], tu_mesa: [], listas_para_firmar: [] };
  for (const x of items) {
    if (esFicha(x)) {
      if (fichaConPrisa(x, ahora)) g.decide_hoy.push(x);
    } else if (esFrenada(x)) g.decide_hoy.push({ ...x, tipo: 'frenada' });
    else if (LISTA_PARA_FIRMAR.has(x?.veredicto?.tipo)) g.listas_para_firmar.push(x);
    else g.tu_mesa.push(x);
  }
  return g;
}

const agrupada = (mesa) => ['decide_hoy', 'tu_mesa', 'listas_para_firmar'].some((k) => Array.isArray(mesa?.[k]));

/**
 * { decideHoy, tuMesa, listas }: cada bloque por urgencia y cada oferta una sola vez (gana el
 * primer bloque en que sale: decidir, luego tu mesa, luego firmar). `ahora` solo cuenta al
 * agrupar una lista plana (qué ficha por revisar tiene prisa).
 */
export function bloquesMesa(mesa, ahora = Date.now()) {
  const g = agrupada(mesa) ? mesa : agrupar(lista(mesa?.items ?? mesa?.ofertas), ahora);
  const vistos = new Set();
  const unaVez = (filas) =>
    [...lista(filas)]
      .filter((x) => x?.id)
      .sort(porUrgencia)
      .filter((x) => !vistos.has(x.id) && vistos.add(x.id));
  // En este orden: el primer bloque en que sale una oferta es el que se la queda.
  const decideHoy = unaVez(g.decide_hoy);
  const tuMesa = unaVez(g.tu_mesa);
  return { decideHoy, tuMesa, listas: unaVez(g.listas_para_firmar) };
}

const todas = (b) => [...b.decideHoy, ...b.tuMesa, ...b.listas];

/**
 * La siguiente tarea por fecha límite para decidir, saltándose `actual` (el id de las comprobaciones
 * abierta): { id, clave, ruta } o null si no queda otra. La ruta abre las comprobaciones en la fila.
 */
export function siguienteTarea(mesa, actual = null) {
  const x = todas(bloquesMesa(mesa))
    .sort(porUrgencia)
    .find((t) => t.id !== actual);
  if (!x) return null;
  const clave = x.primer_bloqueo?.clave ?? null;
  return { id: x.id, clave, ruta: rutaComprobaciones(x.id, clave) };
}
