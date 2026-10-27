// Los campos de la ficha de solución frente a la hoja de hechos. Puro.
import { sumarDias } from '../../../nucleo/festivos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { textoComparable } from '../temas.js';
import type { HechoData } from './estrategia.js';
import { llevaImporte } from './compromisosSolucion.js';
import {
  alertaDeCompromiso,
  camposDeSolucion,
  definicionesDeFicha,
  esDeCompromiso,
  escribirCampo,
  etiquetaDeRuta,
  fechaReal,
  PREFIJO_COMPROMISO,
  problemasDeCalendario,
  SEPARADOR,
  Solucion,
  valorDeCampo,
  type CampoFicha,
  type CambioDeRanura,
  type DefinicionCampo,
  type SolucionData,
} from './solucion.js';

// Buscar la edición como texto literal en toda la hoja fallaba: los campos
// compuestos («servicio · tier · región», «Respuesta a consultas en 48 horas» frente a «48 horas»)
// no aparecían, la hoja se quedaba con el valor viejo y la coherencia devolvía el texto a lo que la
// persona había rechazado; y un valor corto («50 %») cambiaba en hechos que no tenían nada que ver.
// Ahora cada hecho que lleva el valor de un campo se ata a ese campo al abrir la ficha, y una
// edición cambia la solución, esos hechos y ningún otro; un hecho que no es de ningún campo se
// enseña como campo propio. Si cambia el inicio, el calendario y las fechas de la hoja se desplazan.

// Una edición de la persona cambia la solución y solo los hechos que llevan ese valor.
const GRUPO_HOJA = 'Hoja de hechos';
export const PREFIJO_HECHO = 'hecho-';
const MAX_VALOR_HECHO = 300;

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();
const contiene = (texto: string, valor: string) => valor.length > 0 && ` ${texto} `.includes(` ${valor} `);
const VACIAS = new Set(['para', 'como', 'cada', 'entre', 'sobre', 'desde', 'hasta', 'segun', 'horas', 'dias']);
const palabras = (t: string) =>
  new Set(
    comparable(t)
      .split(' ')
      .filter((w) => w.length >= 4 && !VACIAS.has(w)),
  );
const comparten = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
// Un valor largo con letras («Gestor de tickets») solo sale donde se habla de él; uno corto
// («50 %», «4 h») sale en cualquier parte: necesita además que el hecho hable de lo mismo.
const distintivo = (t: string) => t.length >= 8 && /\p{L}/u.test(t);

// Qué hechos pueden llevar el valor de cada campo (por el prefijo de su clave). Un compromiso
// suele venir también como hecho («entrevista individual con cada alumna»): atado a su campo, la
// ficha no lo enseña dos veces y quitarlo o suavizarlo cambia también la hoja que se copia.
const DE_COMPROMISO: readonly HechoData['categoria'][] = [
  'cifra',
  'plazo',
  'calendario',
  'horario',
  'indicador',
  'herramienta',
  'otro',
];
const CATEGORIAS: Record<string, readonly HechoData['categoria'][]> = {
  compromiso: DE_COMPROMISO,
  exigido: DE_COMPROMISO,
  arquitectura: ['herramienta', 'otro', 'cifra'],
  modelo: ['herramienta', 'otro'],
  umbral: ['indicador', 'cifra', 'otro'],
  banco: ['cifra', 'indicador', 'otro'],
  rol: ['rol'],
  formacion: ['cifra', 'plazo', 'calendario', 'indicador', 'otro'],
  'soporte-horario': ['horario'],
  'soporte-respuesta': ['plazo', 'indicador', 'horario'],
  'soporte-meses': ['plazo', 'cifra', 'otro'],
  'soporte-canal': ['herramienta', 'otro'],
  pendiente: ['otro', 'cifra', 'plazo', 'horario', 'herramienta', 'indicador', 'calendario'],
};
const prefijo = (clave: string) => clave.replace(/-\d+$/, '');
const anclaDeHecho = (h: HechoData) => palabras(`${h.clave.replace(/_/g, ' ')} ${h.sobre} ${h.palabras.join(' ')}`);

// 0: no lleva el valor del campo; 1: lo lleva literal; 3: lo lleva y habla de lo mismo.
function afinidad(d: DefinicionCampo, valor: string, h: HechoData): number {
  if (!CATEGORIAS[prefijo(d.clave)]?.includes(h.categoria)) return 0;
  const hv = comparable(h.valor);
  const ancla = comparten(palabras(d.ancla), anclaDeHecho(h));
  const literal = valor
    .split(SEPARADOR)
    .map(comparable)
    .some((p) => {
      const menor = p.length <= hv.length ? p : hv;
      return (contiene(hv, p) || contiene(p, hv)) && (ancla || distintivo(menor));
    });
  return literal ? (ancla ? 3 : 1) : 0;
}

// Sin el valor literal, el horario y el tiempo de respuesta se atan al único hecho de su clase
// («L-V, 8:00-18:00» frente a «lunes a viernes de 8:00 a 18:00»): es el mismo compromiso escrito
// de otra forma, y la edición lo sustituye entero.
const POR_CLASE: [string, HechoData['categoria'], boolean][] = [
  ['soporte-horario', 'horario', false],
  ['soporte-respuesta', 'plazo', true],
];

function atarPorClase(defs: DefinicionCampo[], hechos: HechoData[], atados: Map<string, string>): void {
  for (const [clave, categoria, conAncla] of POR_CLASE) {
    const d = defs.find((x) => x.clave === clave);
    if (!d || [...atados.values()].includes(clave)) continue;
    const libres = hechos.filter(
      (h) =>
        h.categoria === categoria &&
        !atados.has(h.clave) &&
        (!conAncla || comparten(palabras(d.ancla), anclaDeHecho(h))),
    );
    if (libres.length === 1) atados.set(libres[0]!.clave, clave);
  }
}

/** A qué campo de la solución pertenece cada hecho (clave del hecho → clave del campo); sin dueño claro, a ninguno. */
function hechosDeCampos(s: SolucionData, hechos: HechoData[]): Map<string, string> {
  const defs = definicionesDeFicha(s);
  const valores = defs.map((d) => valorDeCampo(d, s));
  const atados = new Map<string, string>();
  for (const h of hechos) {
    const puntos = defs.map((d, i) => afinidad(d, valores[i]!, h));
    const max = Math.max(0, ...puntos);
    if (max > 0 && puntos.filter((p) => p === max).length === 1) atados.set(h.clave, defs[puntos.indexOf(max)]!.clave);
  }
  atarPorClase(defs, hechos, atados);
  return atados;
}

// Una certificación o una norma que la memoria atribuya a la empresa no es diseño: si no la tiene la empresa, es
// una declaración falsa. La ficha la señala para que la persona la compruebe.
const CERTIFICACION =
  /\b(?:ens|esquema nacional de seguridad|iso ?\d{4,5}(?: \d+)?|certificad[oa]s?|certificacion(?:es)?|acreditad[oa]s?|acreditacion(?:es)?|homologad[oa]s?|soc ?2)\b/;
export const ALERTA_CERTIFICACION =
  'Nombra una certificación o una norma: comprueba que la tenemos o que es solo una medida de diseño (la memoria no puede atribuirnos una certificación que no tengamos).';
const alertaDe = (valor: string): Pick<CampoFicha, 'alerta'> =>
  CERTIFICACION.test(comparable(valor)) ? { alerta: ALERTA_CERTIFICACION } : {};

// En un compromiso, el aviso de coste va delante y la certificación se añade: antes la sustituía,
// y la persona decidía sin ver lo que cuesta (y un compromiso barato salía como «Coste alto»).
function alertasDe(c: CampoFicha, s: SolucionData): CampoFicha {
  const { alerta: _antes, caro: _caro, ...resto } = c;
  const coste = alertaDeCompromiso(c.clave, s);
  const textos = [...(coste ? [coste] : []), ...(alertaDe(c.valor).alerta ? [ALERTA_CERTIFICACION] : [])];
  return {
    ...resto,
    ...(textos.length ? { alerta: textos.join(' ') } : {}),
    ...(coste ? { caro: true as const } : {}),
  };
}

const campoDeHecho = (h: HechoData): CampoFicha => ({
  clave: `${PREFIJO_HECHO}${h.clave}`,
  grupo: GRUPO_HOJA,
  etiqueta: `${h.sobre}${h.unidad ? ` (${h.unidad})` : ''}`,
  propuesto: h.valor,
  valor: h.valor,
  ...alertaDe(h.valor),
});

/**
 * Todo lo que compromete la memoria, para la ficha: los campos de la solución (cada uno con los
 * hechos que llevan su valor) y, como campos propios, los hechos que no son de ninguno.
 */
export function camposDeFicha(s: SolucionData, hechos: HechoData[]): CampoFicha[] {
  const atados = hechosDeCampos(s, hechos);
  const deSolucion = camposDeSolucion(s).map((c) => {
    const suyos = hechos
      .filter((h) => atados.get(h.clave) === c.clave)
      .map((h) => ({ clave: h.clave, valor: h.valor }));
    return { ...alertasDe(c, s), ...(suyos.length ? { hechos: suyos } : {}) };
  });
  return [...deSolucion, ...hechos.filter((h) => !atados.has(h.clave)).map(campoDeHecho)];
}

// ── Desplazar fechas ──

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const dos = (n: number) => String(n).padStart(2, '0');
const iso = (a: number, m: number, d: number) => `${a}-${dos(m)}-${dos(d)}`;

/** Días entre dos fechas AAAA-MM-DD. */
const diasEntre = (desde: string, hasta: string): number =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

// Una fecha se mueve si es del contrato (desde el inicio de antes): el plazo de presentación o un
// festivo anterior no se mueven con él.
function mover(f: string, desde: string, dias: number): string | null {
  return fechaReal(f) && f >= desde ? sumarDias(f, dias) : null;
}

/** Las fechas de un texto (AAAA-MM-DD, d/m/aaaa y «d de mes de aaaa») desde `desde`, `dias` más tarde (o antes). */
export function desplazarFechas(texto: string, desde: string, dias: number): string {
  if (!dias) return texto;
  return texto
    .replace(
      /\b(\d{4})-(\d{2})-(\d{2})\b/g,
      (x, a: string, m: string, d: string) => mover(iso(+a, +m, +d), desde, dias) ?? x,
    )
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (x, d: string, m: string, a: string) => {
      const f = mover(iso(+a, +m, +d), desde, dias);
      return f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : x;
    })
    .replace(/\b(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\b/gi, (x, d: string, mes: string, a: string) => {
      const m = MESES.indexOf(textoComparable(mes).trim()) + 1;
      const f = m ? mover(iso(+a, m, +d), desde, dias) : null;
      return f ? `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]} de ${f.slice(0, 4)}` : x;
    });
}

// ── Llevar un cambio de un texto a otro que lleva el mismo valor ──

const prefijoComun = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
};
const sufijoComun = (a: string, b: string, max: number) => {
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
};

/**
 * `texto` lleva el valor que pasó de `antes` a `despues`: lo cambia ahí. Si `texto` lo contiene,
 * se sustituye; si es un trozo de él («48 horas» dentro de «Respuesta a consultas en 48 horas»),
 * se le aplica el cambio de ese trozo; si no casa, `entero` lo sustituye todo y si no, se queda.
 */
function llevarCambio(c: CambioDeRanura, texto: string, entero: boolean): string {
  if (c.antes === c.despues) return texto;
  if (c.antes && texto.includes(c.antes)) return texto.split(c.antes).join(c.despues);
  const p = c.antes.indexOf(texto);
  if (texto && p >= 0) {
    const cola = c.antes.length - p - texto.length;
    const pre = prefijoComun(c.antes, c.despues);
    const suf = sufijoComun(c.antes, c.despues, Math.min(c.antes.length, c.despues.length) - pre);
    return pre >= p && suf >= cola ? c.despues.slice(p, c.despues.length - cola) : c.despues;
  }
  return entero ? c.despues : texto;
}

// ── Aplicar la revisión de una persona ──

export type Revisada = { solucion: SolucionData; hechos: HechoData[]; campos: CampoFicha[] };
type Estado = { s: SolucionData; hechos: HechoData[]; errores: string[] };

// Si cambia el inicio, los tramos y las fechas de la hoja que la persona no tocó se desplazan lo
// mismo: antes la ficha decía «desplaza» y la hoja y el contrato seguían con las fechas viejas.
function desplazar(e: Estado, nuevos: Map<string, string>): void {
  const inicio = nuevos.get('inicio');
  const antes = e.s.calendario.inicio;
  const dias = inicio && fechaReal(inicio) ? diasEntre(antes, inicio) : 0;
  if (!dias) return;
  e.s.calendario.semanas.forEach((x, i) => {
    if (nuevos.has(`semana-${i + 1}`)) return;
    x.desde = sumarDias(x.desde, dias);
    x.hasta = sumarDias(x.hasta, dias);
  });
  e.hechos = e.hechos.map((h) =>
    nuevos.has(`${PREFIJO_HECHO}${h.clave}`) ? h : { ...h, valor: desplazarFechas(h.valor, antes, dias) },
  );
}

// Una ficha abierta antes de que cada campo llevara todas sus partes («≥ 90 %» sin fórmula ni
// momento): lo que escribe la persona son las primeras partes; las demás siguen como están.
function completarDeAntes(c: CampoFicha, d: DefinicionCampo, valor: string, s: SolucionData): string {
  const antes = c.propuesto.split(SEPARADOR).length;
  if (antes >= d.ranuras.length || valor.split(/\s+·\s+/).length !== antes) return valor;
  return [valor, ...valorDeCampo(d, s).split(SEPARADOR).slice(antes)].join(SEPARADOR);
}

// Un compromiso quitado sale también de la hoja de hechos: si no, la redacción lo copiaba de ella.
const quitadoEn = (s: SolucionData, d: DefinicionCampo) =>
  d.clave.startsWith(PREFIJO_COMPROMISO) &&
  s.compromisos[Number(d.clave.slice(PREFIJO_COMPROMISO.length)) - 1]?.quitado === true;

function editarCampo(e: Estado, c: CampoFicha, d: DefinicionCampo, valor: string, nuevos: Map<string, string>): void {
  const r = escribirCampo(e.s, d, completarDeAntes(c, d, valor, e.s));
  if ('error' in r) {
    e.errores.push(r.error);
    return;
  }
  const suyos = new Set((c.hechos ?? []).map((x) => x.clave).filter((k) => !nuevos.has(`${PREFIJO_HECHO}${k}`)));
  if (quitadoEn(e.s, d)) {
    e.hechos = e.hechos.filter((h) => !suyos.has(h.clave));
    return;
  }
  const entero = d.ranuras.length === 1;
  e.hechos = e.hechos.map((h) =>
    suyos.has(h.clave) ? { ...h, valor: r.cambios.reduce((v, x) => llevarCambio(x, v, entero), h.valor) } : h,
  );
}

function problemasFinales(e: Estado): string[] {
  const v = Solucion.safeParse(e.s);
  const esquema = v.success
    ? []
    : v.error.issues.map(
        (i) => `${etiquetaDeRuta(e.s, i.path as (string | number)[]) ?? i.path.join('.')}: ${i.message}.`,
      );
  const largos = e.hechos
    .filter((h) => !h.valor.trim() || h.valor.length > MAX_VALOR_HECHO)
    .map((h) => `«${h.sobre}» en la hoja de hechos queda con ${h.valor.length} caracteres: de 1 a ${MAX_VALOR_HECHO}.`);
  return [...esquema, ...problemasDeCalendario(e.s), ...largos];
}

// El aviso de coste de un compromiso cambia con él: suavizado por debajo del umbral o quitado, se va.
const alertaAlDia = (c: CampoFicha, s: SolucionData, valor: string): CampoFicha =>
  esDeCompromiso(c.clave) ? alertasDe({ ...c, valor }, s) : c;

/** Los campos con lo que dicen ahora la solución y la hoja (y los hechos de cada uno, al día). */
function camposAlDia(campos: CampoFicha[], s: SolucionData, hechos: HechoData[]): CampoFicha[] {
  const defs = new Map(definicionesDeFicha(s).map((d) => [d.clave, d]));
  const valorHecho = (k: string) => hechos.find((h) => h.clave === k)?.valor;
  return campos.map((c) => {
    const d = defs.get(c.clave);
    const valor = d
      ? valorDeCampo(d, s)
      : c.clave.startsWith(PREFIJO_HECHO)
        ? (valorHecho(c.clave.slice(PREFIJO_HECHO.length)) ?? c.valor)
        : c.valor;
    const suyos = c.hechos?.map((x) => ({ clave: x.clave, valor: valorHecho(x.clave) ?? x.valor }));
    return { ...alertaAlDia(c, s, valor), valor, ...(suyos ? { hechos: suyos } : {}) };
  });
}

// La ficha enseña a la persona los euros de cada compromiso, pero lo que escribe en ella pasa a la
// solución y a la hoja de hechos, que copian la redacción y el crítico: ningún campo admite importes
// (los de un compromiso ya los rechaza cada parte con su tipo).
const importeEnFicha = (c: CampoFicha | undefined, clave: string) =>
  `«${c?.etiqueta ?? clave}» lleva un importe: la memoria va en un sobre sin precios; escribe el coste en horas o con el nivel, sin euros.`;

/**
 * Aplica lo que cambió la persona (`nuevos`: clave → valor) a la solución, a los hechos de cada
 * campo y a los campos de la hoja; con un inicio nuevo, desplaza el resto del calendario. Si algo
 * no vale (una parte de más, un número que no lo es, un tramo al revés), nada se aplica.
 */
export function aplicarRevision(
  s: SolucionData,
  hechos: HechoData[],
  campos: CampoFicha[],
  nuevos: Map<string, string>,
): Result<Revisada> {
  const e: Estado = { s: structuredClone(s), hechos: hechos.map((h) => ({ ...h })), errores: [] };
  desplazar(e, nuevos);
  const defs = new Map(definicionesDeFicha(s).map((d) => [d.clave, d]));
  for (const [clave, valor] of nuevos) {
    const c = campos.find((x) => x.clave === clave);
    if (!esDeCompromiso(clave) && llevaImporte(valor)) {
      e.errores.push(importeEnFicha(c, clave));
      continue;
    }
    const d = defs.get(clave);
    if (c && d) editarCampo(e, c, d, valor, nuevos);
    else if (clave.startsWith(PREFIJO_HECHO))
      e.hechos = e.hechos.map((h) => (`${PREFIJO_HECHO}${h.clave}` === clave ? { ...h, valor } : h));
  }
  e.errores.push(...problemasFinales(e));
  if (e.errores.length) return fail('invalid_input', [...new Set(e.errores)].join(' '));
  return ok({ solucion: e.s, hechos: e.hechos, campos: camposAlDia(campos, e.s, e.hechos) });
}

// ── Un hecho corregido en una ronda ──

export type CambioDeHecho = { clave: string; antes: string; despues: string };

/**
 * Un parche de una ronda cambió un hecho: el campo de la ficha del que sale y su sitio en la
 * solución cambian con él, para que la redacción no reciba la ficha diciendo una cosa y la hoja
 * otra. El campo queda marcado con la ronda y su valor de antes.
 */
export function seguirCambioDeHecho(
  s: SolucionData,
  campos: CampoFicha[],
  c: CambioDeHecho,
  ronda: number,
): { solucion: SolucionData; campos: CampoFicha[] } {
  const sol = structuredClone(s);
  const defs = new Map(definicionesDeFicha(s).map((d) => [d.clave, d]));
  const marcados = new Set<string>();
  for (const campo of campos) {
    const d = defs.get(campo.clave);
    if (!d || !campo.hechos?.some((x) => x.clave === c.clave)) continue;
    const trozos = campo.valor.split(SEPARADOR);
    const nuevos = trozos.map((t) => llevarCambio({ antes: c.antes, despues: c.despues }, t, false));
    const valor = (nuevos.join(SEPARADOR) === campo.valor && trozos.length === 1 ? [c.despues] : nuevos).join(
      SEPARADOR,
    );
    if (valor !== campo.valor && !('error' in escribirCampo(sol, d, valor))) marcados.add(campo.clave);
  }
  const hoja = `${PREFIJO_HECHO}${c.clave}`;
  if (campos.some((x) => x.clave === hoja)) marcados.add(hoja);
  const alDia = camposAlDia(
    campos.map((x) => (x.clave === hoja ? { ...x, valor: c.despues } : x)),
    sol,
    [],
  );
  return {
    solucion: sol,
    campos: alDia.map((x, i) => {
      const suyos = x.hechos?.map((h) => (h.clave === c.clave ? { ...h, valor: c.despues } : h));
      return {
        ...x,
        ...(suyos ? { hechos: suyos } : {}),
        ...(marcados.has(x.clave) ? { ronda: { n: ronda, antes: campos[i]!.valor } } : {}),
      };
    }),
  };
}
