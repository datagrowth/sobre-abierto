// Define una tool MCP con las reglas de la plataforma.
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { puede, type Accion, type Dominio, type Permisos } from '../agentes/permisos.js';
import type { Agente } from '../agentes/registro.js';
import { registrarUso } from '../agentes/auditoria.js';
import { nucleo } from '../contexto.js';
import { errorMessage, fail, type Result } from '../result.js';
import { logger } from '../log.js';

// Solo se registra si el agente tiene permiso, valida la entrada con zod (lo hace el SDK), deja rastro en la
// auditoría, recorta respuestas enormes y devuelve los errores como resultado.
const MAX_RESPUESTA = 20_000;
// Un lote real de 40 candidatas con antecedentes ocupó 37.065 caracteres en JSON compacto
// (49.698 con sangría): con 20.000 Hermes solo veía 17 y no podía cribar el lote.
export const RESPUESTA_LOTE = 150_000;
// Una lectura por partes trae hasta 20.000 caracteres de texto: con el sobre JSON y los
// saltos de línea escapados pasaba de 20.000 y se perdía el final de cada parte, que el
// agente nunca leía porque seguía desde «hasta».
// Por páginas llegan hasta 40.000 caracteres de texto: con los saltos de línea escapados y
// el sobre, el tope deja margen.
export const RESPUESTA_LECTURA = 60_000;
// El detalle de una licitación grande (datos de la PLACSP, ficha, lotes, antecedentes).
export const RESPUESTA_DETALLE = 80_000;
// Más que esto en una tool de lectura queda en el log con su tamaño: para saber si un 502/504
// del proxy viene de una respuesta lenta o grande.
export const TOOL_LENTA_MS = 10_000;
const log = logger('mcp');

export type AvisoLentitud = { ms: number; resultado: 'ok' | 'error'; caracteres?: number };

// Decide si una llamada merece el aviso de lentitud y con qué datos. Función pura para
// poder probar el umbral (el límite no cuenta como lenta) y que «caracteres» solo salga en las ok.
export function avisoDeLentitud(ms: number, resultado: 'ok' | 'error', caracteres?: number): AvisoLentitud | null {
  if (ms <= TOOL_LENTA_MS) return null;
  return resultado === 'ok' && caracteres !== undefined ? { ms, resultado, caracteres } : { ms, resultado };
}

export type Herramienta<S extends z.ZodObject> = {
  nombre: string;
  dominio: Dominio;
  accion: Accion;
  descripcion: string;
  entrada: S;
  recurso?: (args: z.infer<S>) => string | null;
  // Permisos que pide además del de su dominio (p. ej. licitaciones_equipo devuelve personas:
  // también colaboradores:leer). Van al catálogo para no decirle a un agente que la tiene.
  requiere?: Permiso[];
  // Respuestas que el agente necesita enteras (p. ej. un lote de criba, donde debe dar un
  // veredicto por candidata): JSON sin sangría y un límite propio en vez de MAX_RESPUESTA.
  respuestaLarga?: number;
  // Qué llamada trae lo que faltó cuando la respuesta se recorta (p. ej. { pagina: 2 }).
  comoSeguir?: (args: z.infer<S>, info: InfoRecorte) => ComoSeguir;
  ejecutar: (args: z.infer<S>, agente: Agente) => Promise<Result<unknown>>;
};

type Texto = { content: { type: 'text'; text: string }[]; isError?: boolean };

type Permiso = [Dominio, Accion];
export type InfoRecorte = { campo: string; devueltos: number; total: number };
export type ComoSeguir = Record<string, unknown> | string;
export type Serializada = { text: string; recortada: boolean };
type Plano = Record<string, unknown>;
type Pista = ((info: InfoRecorte) => ComoSeguir) | undefined;

const SEGUIR_GENERICO = 'Pide menos resultados (limite) o la página siguiente (pagina o desde).';
const MARCA_CADENA = '…[recortado]';
// Una cadena no baja de esto al recortarla: por debajo ya no aporta nada al agente.
const CADENA_MINIMA = 40;
// Hueco para el aviso final de un texto plano, para que el total no pase de max.
const HUECO_AVISO = 100;

const aJson = (v: unknown, compacto: boolean) => JSON.stringify(v, null, compacto ? undefined : 2);
const esPlano = (v: unknown): v is Plano => typeof v === 'object' && v !== null && !Array.isArray(v);

function recortado(info: InfoRecorte, pista: Pista): Plano {
  return { ...info, como_seguir: pista?.(info) ?? SEGUIR_GENERICO };
}

// Un texto plano se corta en un salto de línea, con el desplazamiento desde el que seguir.
function recortarTexto(text: string, max: number): string {
  const tope = Math.max(0, max - HUECO_AVISO);
  const salto = text.lastIndexOf('\n', tope);
  const n = salto > 0 ? salto + 1 : tope;
  return `${text.slice(0, n)}\n…[recortado: ${n} de ${text.length} caracteres; sigue con desde=${n}]`;
}

// La lista que más ocupa entre las claves de primer y segundo nivel: casi siempre es la que
// hace grande la respuesta (candidatas, resultados, requisitos…).
function arrayMasGrande(obj: Plano): { ruta: string[]; lista: unknown[] } | null {
  const listas: { ruta: string[]; lista: unknown[]; peso: number }[] = [];
  const mirar = (ruta: string[], v: unknown) => {
    if (Array.isArray(v) && v.length > 0) listas.push({ ruta, lista: v, peso: JSON.stringify(v).length });
  };
  for (const [k, v] of Object.entries(obj)) {
    mirar([k], v);
    if (esPlano(v)) for (const [k2, valor2] of Object.entries(v)) mirar([k, k2], valor2);
  }
  return listas.sort((a, b) => b.peso - a.peso)[0] ?? null;
}

function conValor(obj: Plano, ruta: string[], valor: unknown): Plano {
  const [k, k2] = ruta as [string, string | undefined];
  if (k2 === undefined) return { ...obj, [k]: valor };
  return { ...obj, [k]: { ...(obj[k] as Plano), [k2]: valor } };
}

// Búsqueda binaria del mayor número de elementos que cabe, nunca menos de uno; null si no hay
// lista o si lo que sobra es un texto: una lista que pesa menos que el exceso, o con la que ni
// vacía cabe la respuesta, se quedaba vacía sin necesidad y se llevaba el texto que había que recortar.
function recortarLista(obj: Plano, max: number, compacto: boolean, pista: Pista): Plano | null {
  const grande = arrayMasGrande(obj);
  if (!grande) return null;
  const { ruta, lista } = grande;
  const campo = ruta.join('.');
  const con = (k: number) => ({
    ...conValor(obj, ruta, lista.slice(0, k)),
    recortado: recortado({ campo, devueltos: k, total: lista.length }, pista),
  });
  if (aJson(lista, compacto).length < aJson(obj, compacto).length - max || aJson(con(0), compacto).length > max)
    return null;
  let [lo, hi] = [0, lista.length - 1];
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (aJson(con(mid), compacto).length <= max) lo = mid;
    else hi = mid - 1;
  }
  // Si ni uno cabe, va uno con sus cadenas recortadas; si ese uno es toda la lista, se recortan solo las cadenas.
  const k = Math.max(lo, 1);
  return k >= lista.length ? null : con(k);
}

function cadenas(v: unknown, ruta: string[], out: { ruta: string[]; largo: number }[]): void {
  if (typeof v === 'string') out.push({ ruta, largo: v.length });
  else if (Array.isArray(v)) v.forEach((x, i) => cadenas(x, [...ruta, String(i)], out));
  else if (esPlano(v))
    for (const [k, x] of Object.entries(v))
      if (!(ruta.length === 0 && k === 'recortado')) cadenas(x, [...ruta, k], out);
}

function cambiarCadena(obj: Plano, ruta: string[], largo: number): void {
  let padre = obj as Record<string, unknown>;
  for (const k of ruta.slice(0, -1)) padre = padre[k] as Record<string, unknown>;
  const ultima = ruta[ruta.length - 1]!;
  padre[ultima] = `${String(padre[ultima]).slice(0, largo)}${MARCA_CADENA}`;
}

// Recorta la cadena más larga cada vez hasta que el JSON cabe. Trabaja sobre una copia.
function recortarCadenas(base: Plano, max: number, compacto: boolean, pista: Pista): Plano | null {
  const obj = JSON.parse(JSON.stringify(base)) as Plano;
  const rutas: string[] = [];
  let primera: InfoRecorte | null = null;
  for (let exceso = aJson(obj, compacto).length - max; exceso > 0; exceso = aJson(obj, compacto).length - max) {
    const lista: { ruta: string[]; largo: number }[] = [];
    cadenas(obj, [], lista);
    const mayor = lista.sort((a, b) => b.largo - a.largo)[0];
    if (!mayor || mayor.largo <= CADENA_MINIMA + MARCA_CADENA.length) return null;
    const largo = Math.max(CADENA_MINIMA, mayor.largo - exceso - MARCA_CADENA.length - 1);
    cambiarCadena(obj, mayor.ruta, largo);
    rutas.push(mayor.ruta.join('.'));
    primera ??= { campo: mayor.ruta.join('.'), devueltos: largo, total: mayor.largo };
  }
  if (!primera) return obj;
  const previo = esPlano(obj.recortado) ? obj.recortado : recortado(primera, pista);
  obj.recortado = { ...previo, cadenas: [...new Set(rutas)] };
  return aJson(obj, compacto).length <= max ? obj : recortarCadenas(obj, max, compacto, pista);
}

/**
 * Serializa la respuesta de una tool sin pasar de `max` caracteres. Si recorta, el resultado
 * sigue siendo JSON válido (salvo que data fuera texto) con `recortado` y cómo seguir: con un
 * `slice` el agente recibía JSON roto y no sabía qué le faltaba.
 */
export function serializar(data: unknown, max: number, compacto: boolean, pista?: Pista): Serializada {
  const entero = typeof data === 'string' ? data : aJson(data, compacto);
  if (entero.length <= max) return { text: entero, recortada: false };
  if (typeof data === 'string') return { text: recortarTexto(data, max), recortada: true };
  const obj = JSON.parse(entero) as unknown;
  const raiz: Plano = esPlano(obj) ? obj : { elementos: obj };
  const conLista = recortarLista(raiz, max, compacto, pista) ?? raiz;
  const final = aJson(conLista, compacto).length <= max ? conLista : recortarCadenas(conLista, max, compacto, pista);
  const salida = final ?? { recortado: recortado({ campo: '', devueltos: 0, total: entero.length }, pista) };
  return { text: aJson(salida, compacto), recortada: true };
}

// Se mantiene para quien solo quiere el texto.
export function aTexto(data: unknown, max = MAX_RESPUESTA, compacto = false): string {
  return serializar(data, max, compacto).text;
}

async function ejecutarSeguro<S extends z.ZodObject>(
  def: Herramienta<S>,
  args: z.infer<S>,
  agente: Agente,
): Promise<Result<unknown>> {
  try {
    return await def.ejecutar(args, agente);
  } catch (err) {
    // La referencia une lo que ve el agente (o la persona) con la línea del log.
    const ref = randomUUID().slice(0, 8);
    log.error('fallo en herramienta', { herramienta: def.nombre, ref, error: errorMessage(err) });
    return fail(
      'internal_error',
      `Error interno al ejecutar la herramienta (ref. ${ref}). Vuelve a intentarlo; si se repite, avisa a una persona con esta referencia.`,
    );
  }
}

// Todas las herramientas que algún registrador ha intentado dar, con o sin permiso: es lo que
// permite decirle a un agente qué le falta y con qué permiso (plataforma_estado › agentes).
const catalogo = new Map<string, { dominio: Dominio; accion: Accion; requiere: Permiso[] }>();

export function catalogoRegistrado(): { nombre: string; dominio: Dominio; accion: Accion }[] {
  return [...catalogo]
    .map(([nombre, v]) => ({ nombre, dominio: v.dominio, accion: v.accion }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Los permisos («dominio:accion») que le faltan a quien tiene `permisos` para usar la herramienta; vacío si la tiene. */
export function permisosQueFaltan(permisos: Permisos, nombre: string): string[] {
  const h = catalogo.get(nombre);
  if (!h) return [];
  const todos: Permiso[] = [[h.dominio, h.accion], ...h.requiere];
  return todos.filter(([d, a]) => !puede(permisos, d, a)).map(([d, a]) => `${d}:${a}`);
}

export function registrarHerramienta<S extends z.ZodObject>(
  server: McpServer,
  agente: Agente,
  def: Herramienta<S>,
): void {
  catalogo.set(def.nombre, { dominio: def.dominio, accion: def.accion, requiere: def.requiere ?? [] });
  if (permisosQueFaltan(agente.permisos, def.nombre).length > 0) return;
  const annotations = {
    readOnlyHint: def.accion === 'leer',
    destructiveHint: false,
    idempotentHint: def.accion === 'leer',
  };
  // Con el esquema genérico el tipo del callback del SDK no se resuelve: se pasa como
  // ZodObject concreto y, como el SDK ya validó la entrada con él, se recupera el tipo.
  const entrada: z.ZodObject = def.entrada;
  server.registerTool(
    def.nombre,
    { description: def.descripcion, inputSchema: entrada, annotations },
    async (raw): Promise<Texto> => {
      const args = raw as z.infer<S>;
      const inicio = performance.now();
      const r = await ejecutarSeguro(def, args, agente);
      const recurso = def.recurso?.(args) ?? null;
      const ms = Math.round(performance.now() - inicio);
      if (r.error) {
        // También las que tardan y acaban en error: son las que más interesa ver en el log.
        const aviso = avisoDeLentitud(ms, 'error');
        if (aviso) log.warn('herramienta lenta', { herramienta: def.nombre, ...aviso });
        registrarUso(nucleo().db, {
          agente: agente.nombre,
          herramienta: def.nombre,
          dominio: def.dominio,
          recurso,
          resultado: 'error',
        });
        return { content: [{ type: 'text', text: `Error (${r.error.code}): ${r.error.message}` }], isError: true };
      }
      const pista = def.comoSeguir ? (info: InfoRecorte) => def.comoSeguir!(args, info) : undefined;
      // Con sangría salvo en las largas: hay tests de otras tools que leen el JSON con sangría.
      const { text, recortada } = serializar(
        r.data,
        def.respuestaLarga ?? MAX_RESPUESTA,
        def.respuestaLarga !== undefined,
        pista,
      );
      registrarUso(nucleo().db, {
        agente: agente.nombre,
        herramienta: def.nombre,
        dominio: def.dominio,
        recurso,
        resultado: recortada ? 'recortada' : 'ok',
      });
      if (recortada) log.warn('respuesta recortada', { herramienta: def.nombre });
      // Se recalcula tras serializar: en respuestas grandes el JSON.stringify también cuenta.
      const aviso = avisoDeLentitud(Math.round(performance.now() - inicio), 'ok', text.length);
      if (aviso) log.warn('herramienta lenta', { herramienta: def.nombre, ...aviso });
      return { content: [{ type: 'text', text }] };
    },
  );
}
