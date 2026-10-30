// Único sitio donde se lee o escribe el frontmatter de una nota.
import matter from 'gray-matter';
import { fail, ok, type Result } from '../../nucleo/result.js';

export const MAX_FRONTMATTER_BYTES = 16 * 1024;
// Con 16 KB no se llega, pero acota el recorrido aunque cambie el tope.
const MAX_NODOS = 20_000;
const LENGUAJES_YAML = new Set(['', 'yaml', 'yml']);

export type ConFrontmatter = { data: Record<string, unknown>; content: string };

type MotorYaml = { parse: (texto: string) => unknown; stringify: (datos: object) => string };

// Las notas llegan de terceros (pliegos subidos a Drive, propuestas de un agente manipulable por prompt
// injection), así que gray-matter nunca se usa con sus opciones por defecto:
// - tras «---» admite «js»/«javascript» y lo ejecuta con eval (RCE): aquí solo YAML;
// - sin opciones guarda cada texto leído en una caché global que no se vacía nunca;
// - las anclas y alias YAML (&a / *a) se expanden al serializar: 1 KB → cientos de MB.
// js-yaml 3 (el que trae gray-matter) con safeLoad/safeDump: sin tipos que ejecuten código.
const yaml = (matter as unknown as { engines: { yaml: MotorYaml } }).engines.yaml;
const cargarYaml = yaml.parse;
const volcarYaml = yaml.stringify;

class FrontmatterNoValido extends Error {}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

// Un alias YAML a una lista o mapa devuelve el MISMO objeto en varios sitios: es lo que
// multiplica el tamaño al serializar. Un frontmatter normal nunca repite un objeto.
function sinAlias(raiz: unknown): void {
  const vistos = new Set<object>();
  const pendientes: unknown[] = [raiz];
  while (pendientes.length > 0) {
    const v = pendientes.pop();
    if (!Array.isArray(v) && !esObjetoPlano(v)) continue;
    if (vistos.has(v)) throw new FrontmatterNoValido('el frontmatter usa anclas y alias YAML');
    vistos.add(v);
    if (vistos.size > MAX_NODOS) throw new FrontmatterNoValido('el frontmatter tiene demasiados elementos');
    pendientes.push(...(Array.isArray(v) ? v : Object.values(v)));
  }
}

function yamlAcotado(texto: string): object {
  if (Buffer.byteLength(texto, 'utf8') > MAX_FRONTMATTER_BYTES) {
    throw new FrontmatterNoValido(`el frontmatter supera ${MAX_FRONTMATTER_BYTES} bytes`);
  }
  const datos = cargarYaml(texto);
  sinAlias(datos);
  return esObjetoPlano(datos) ? datos : {};
}

function rechazarEjecutable(): object {
  throw new FrontmatterNoValido('frontmatter ejecutable no admitido');
}

// Lo que va en la línea de apertura tras «---» («---js», «---toml»…), como lo lee gray-matter.
function lenguajeDeApertura(texto: string): string | null {
  if (!texto.startsWith('---') || texto.charAt(3) === '-') return null;
  const resto = texto.slice(3);
  const fin = resto.search(/\r?\n/);
  return (fin === -1 ? resto : resto.slice(0, fin)).trim().toLowerCase();
}

/**
 * Frontmatter YAML y cuerpo de una nota. Un frontmatter en otro lenguaje, con anclas o
 * alias, de más de 16 KB o mal formado vuelve como error: nunca se ejecuta nada.
 */
export function leerFrontmatter(crudo: string): Result<ConFrontmatter> {
  const texto = crudo.charCodeAt(0) === 0xfeff ? crudo.slice(1) : crudo;
  const lenguaje = lenguajeDeApertura(texto);
  if (lenguaje !== null && !LENGUAJES_YAML.has(lenguaje)) {
    return fail('invalid_content', `frontmatter en «${lenguaje.slice(0, 20)}»: solo se admite YAML`);
  }
  try {
    // Pasar opciones también evita la caché global de gray-matter.
    const analizado = matter(texto, {
      language: 'yaml',
      engines: { yaml: yamlAcotado, javascript: rechazarEjecutable, js: rechazarEjecutable },
    });
    const datos = esObjetoPlano(analizado.data) ? analizado.data : {};
    return ok({ data: datos, content: analizado.content });
  } catch (err) {
    const motivo = err instanceof FrontmatterNoValido ? err.message : 'frontmatter YAML mal formado';
    return fail('invalid_content', motivo);
  }
}

/** Como leerFrontmatter, pero si no se puede leer trata el texto entero como cuerpo sin frontmatter. */
export function frontmatterOVacio(crudo: string): ConFrontmatter {
  const r = leerFrontmatter(crudo);
  return r.data ?? { data: {}, content: crudo };
}

/**
 * Nota con `data` como frontmatter YAML y `content` como cuerpo. A diferencia de
 * matter.stringify, no vuelve a leer el cuerpo (que sí lo pasaría por gray-matter).
 */
export function serializarFrontmatter(contenido: string, datos: Record<string, unknown>): Result<string> {
  try {
    const cabecera = volcarYaml(datos).trim();
    const cuerpo = contenido.endsWith('\n') ? contenido : `${contenido}\n`;
    return ok(cabecera === '{}' ? cuerpo : `---\n${cabecera}\n---\n${cuerpo}`);
  } catch (err) {
    return fail(
      'invalid_content',
      `no se pudo escribir el frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
