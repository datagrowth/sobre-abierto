// Lo puro de los cambios por apartado: el diff palabra a palabra entre el
// texto de la versión base y el de la nueva, y lo que cuesta «Actualizar los apartados afectados»
// leído del impacto. Sin React para poder probarlo.

// Por encima, la tabla del LCS (palabras × palabras) pesa decenas de MB y bloquea la pestaña.
export const MAX_PALABRAS_DIFF = 4000;
export const TEXTO_DEMASIADO_LARGO = 'El apartado es demasiado largo para comparar palabra a palabra: ábrelo entero';

// Cada palabra con el espacio que la sigue, para que juntar los trozos devuelva el texto tal cual.
const trocear = (t) => (typeof t === 'string' ? (t.match(/\S+\s*/g) ?? []) : []);
const palabra = (tok) => tok.trimEnd();

function juntar(trozos) {
  const salida = [];
  for (const t of trozos) {
    const ultimo = salida.at(-1);
    if (ultimo && ultimo.tipo === t.tipo) ultimo.texto += t.texto;
    else salida.push({ ...t });
  }
  return salida;
}

// Tabla del LCS desde el final: L[i][j] = la subsecuencia común más larga de a[i..] y b[j..].
function tablaLcs(a, b) {
  const ancho = b.length + 1;
  const L = new Uint16Array((a.length + 1) * ancho);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      L[i * ancho + j] =
        palabra(a[i]) === palabra(b[j])
          ? L[(i + 1) * ancho + j + 1] + 1
          : Math.max(L[(i + 1) * ancho + j], L[i * ancho + j + 1]);
    }
  }
  return { L, ancho };
}

// Entre dos quitas y pones seguidos, primero lo quitado: así se lee «antes → después».
function recorrer(a, b) {
  const { L, ancho } = tablaLcs(a, b);
  const trozos = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (palabra(a[i]) === palabra(b[j])) {
      trozos.push({ tipo: 'igual', texto: b[j] });
      i += 1;
      j += 1;
    } else if (L[(i + 1) * ancho + j] >= L[i * ancho + j + 1]) {
      trozos.push({ tipo: 'quita', texto: a[i] });
      i += 1;
    } else {
      trozos.push({ tipo: 'pone', texto: b[j] });
      j += 1;
    }
  }
  return [
    ...trozos,
    ...a.slice(i).map((texto) => ({ tipo: 'quita', texto })),
    ...b.slice(j).map((texto) => ({ tipo: 'pone', texto })),
  ];
}

// Lo común al principio y al final no entra en la tabla: un cambio mínimo deja casi todo igual.
function extremosIguales(a, b) {
  let ini = 0;
  while (ini < a.length && ini < b.length && palabra(a[ini]) === palabra(b[ini])) ini += 1;
  let fin = 0;
  while (
    fin < a.length - ini &&
    fin < b.length - ini &&
    palabra(a[a.length - 1 - fin]) === palabra(b[b.length - 1 - fin])
  )
    fin += 1;
  return { ini, fin };
}

/**
 * Diff palabra a palabra por LCS. Los trozos seguidos del mismo tipo van juntos y, unidos, dan
 * el texto nuevo (igual + pone) o el anterior (igual + quita).
 * @returns {{ data: { tipo: 'igual'|'quita'|'pone', texto: string }[] | null, error: string | null }}
 */
export function diffPalabras(antes, despues) {
  const a = trocear(antes);
  const b = trocear(despues);
  if (a.length > MAX_PALABRAS_DIFF || b.length > MAX_PALABRAS_DIFF) return { data: null, error: TEXTO_DEMASIADO_LARGO };
  const { ini, fin } = extremosIguales(a, b);
  const igual = (toks) => toks.map((texto) => ({ tipo: 'igual', texto }));
  const medio = recorrer(a.slice(ini, a.length - fin), b.slice(ini, b.length - fin));
  return { data: juntar([...igual(b.slice(0, ini)), ...medio, ...igual(b.slice(b.length - fin))]), error: null };
}

/** Si el diff no cambia nada (la versión nueva dejó el apartado igual). */
export const sinCambios = (trozos) => (trozos ?? []).every((t) => t.tipo === 'igual');

// ── «Actualizar los apartados afectados»: lo que cuesta, leído de «Qué cambia» ──

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// La clave de un apartado en el impacto es «v{versión}-{n}» (dependencias.ts).
function deClave(clave) {
  const m = /^v(\d+)-(\d+)$/.exec(String(clave ?? ''));
  return m ? { version: Number(m[1]), n: Number(m[2]) } : null;
}

const sumar = (as, k) => as.reduce((s, a) => s + a.coste[k], 0);

/**
 * Los apartados que «Qué cambia» manda rehacer (los que nombran lo que cambió), de la clasificación
 * de impactoFormato, agrupados por la versión de memoria a la que van: con una memoria por lote,
 * un cambio puede tocar las de dos lotes, y cada versión se actualiza aparte. version: la única, o
 * null si son varias. Un apartado con una clave que no se entiende no se puede pedir: no entra.
 * @returns {{ version: number | null, versiones: { version: number, apartados: { n: number, nombre: string }[], minutos: number, runs: number }[], apartados: { n: number, nombre: string }[], minutos: number, runs: number } | null}
 */
export function apartadosAfectados(c) {
  const rehacer = (c?.rehace ?? [])
    .filter((a) => a.pieza === 'apartado' && a.accion === 'rehacer')
    .map((a) => ({ a, k: deClave(a.clave) }))
    .filter((x) => x.k !== null);
  if (!rehacer.length) return null;
  const porVersion = new Map();
  for (const x of rehacer) porVersion.set(x.k.version, [...(porVersion.get(x.k.version) ?? []), x]);
  const versiones = [...porVersion.entries()]
    .sort(([a], [b]) => a - b)
    .map(([version, xs]) => ({
      version,
      apartados: xs.map((x) => ({ n: x.k.n, nombre: x.a.nombre })),
      minutos: sumar(
        xs.map((x) => x.a),
        'minutos',
      ),
      runs: sumar(
        xs.map((x) => x.a),
        'runs',
      ),
    }));
  return {
    version: versiones.length === 1 ? versiones[0].version : null,
    versiones,
    apartados: versiones.flatMap((v) => v.apartados),
    minutos: sumar(
      rehacer.map((x) => x.a),
      'minutos',
    ),
    runs: sumar(
      rehacer.map((x) => x.a),
      'runs',
    ),
  };
}

/** «2 apartados · unos 60 min · 2 runs». */
export function textoAfectados({ apartados = [], minutos = 0, runs = 0 } = {}) {
  const tiempo = minutos > 0 ? `unos ${Math.max(1, Math.round(minutos))} min` : 'segundos';
  return `${plural(apartados.length, 'apartado', 'apartados')} · ${tiempo} · ${plural(runs, 'run', 'runs')}`;
}

/** Lo que queda en marcha tras pedirlo: «Hermes rehace los apartados 2 y 5 en la v4 (…).». */
export function avisoAfectados(r, a) {
  const ns = (r?.apartados ?? []).map(String);
  const lista =
    ns.length > 1 ? `los apartados ${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}` : `el apartado ${ns[0] ?? ''}`;
  const version = typeof r?.version === 'number' ? ` en la v${r.version}` : '';
  return `Hermes rehace ${lista}${version} sobre el texto que había (${textoAfectados(a ?? {})}). Revisa luego el cambio de cada uno.`;
}
