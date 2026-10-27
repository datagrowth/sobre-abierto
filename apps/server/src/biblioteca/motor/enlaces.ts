// Enlaces entre notas: calcula los salientes y entrantes de una nota y actualiza los wikilinks al renombrarla.
import fs from 'node:fs/promises';
import { listarNotas, leerNota, resolverRutaSegura, renombrarNota, ErrorBiblioteca } from './notas.js';
import { iniciarSesionRespaldo, respaldarNota } from './respaldo.js';
import { leerArchivoRegular } from './rutaReal.js';
import { enlacesCrudos, type EnlaceCrudo } from './wikilinks.js';

type IndiceEnlaces = {
  paths: string[];
  byLower: Map<string, string>;
  byBasename: Map<string, string[]>;
};

type EnlaceSaliente = { target: string; heading: string | null; path: string | null; title: string | null };
type EnlaceEntrante = { path: string; title: string };
export type EnlacesNota = { path: string; outgoing: EnlaceSaliente[]; incoming: EnlaceEntrante[] };

function nombreBaseDe(p: string): string {
  return p.split('/').pop() ?? p;
}

// Ante varias notas candidatas, se prefiere la de ruta más corta.
function porRutaMasCorta(a: string, b: string): number {
  return a.split('/').length - b.split('/').length || a.localeCompare(b);
}

function construirIndiceEnlaces(rutasPosibles: string[]): IndiceEnlaces {
  const porMinusculas = new Map<string, string>();
  const porNombreBase = new Map<string, string[]>();
  for (const p of rutasPosibles) {
    porMinusculas.set(p.toLowerCase(), p);
    const base = nombreBaseDe(p).toLowerCase();
    if (!porNombreBase.has(base)) porNombreBase.set(base, []);
    porNombreBase.get(base)!.push(p);
  }
  for (const lista of porNombreBase.values()) lista.sort(porRutaMasCorta);
  return { paths: rutasPosibles, byLower: porMinusculas, byBasename: porNombreBase };
}

/**
 * Resuelve el destino de un wikilink a la ruta de una nota de la bóveda, o null si
 * está roto. Admite el nombre solo ([[Nota]]), la ruta completa ([[carpeta/Nota]])
 * o parcial ([[sub/Nota]] → a/sub/Nota.md), con o sin .md y con #encabezado.
 */
function resolverDestinoEnlace(destinoCrudo: string, indice: IndiceEnlaces): string | null {
  const destino = destinoCrudo.split('#')[0]!.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!destino) return null;
  const minuscula = (/\.md$/i.test(destino) ? destino : `${destino}.md`).toLowerCase();

  const exacto = indice.byLower.get(minuscula);
  if (exacto) return exacto;
  if (!minuscula.includes('/')) return indice.byBasename.get(minuscula)?.[0] ?? null;

  const sufijo = `/${minuscula}`;
  const parcial = indice.paths.filter((p) => p.toLowerCase().endsWith(sufijo)).sort(porRutaMasCorta);
  return parcial[0] ?? null;
}

// Tapa los bloques de código (``` / ~~~) y el código en línea con espacios, sin
// cambiar posiciones: los [[…]] de ejemplo dentro de código no son enlaces.
function enmascararCodigo(texto: string): string {
  const enBlanco = (s: string) => s.replace(/[^\n]/g, ' ');
  const lineas = texto.split('\n');
  let valla: string | null = null;
  const enmascarado = lineas.map((line) => {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (valla) {
      if (m && m[1]!.startsWith(valla)) valla = null;
      return enBlanco(line);
    }
    if (m) {
      valla = m[1]!;
      return enBlanco(line);
    }
    return line;
  });
  return enmascarado.join('\n').replace(/`[^`\n]*`/g, enBlanco);
}

// Wikilinks fuera de bloques y código en línea: [[destino]], [[destino#encabezado]],
// [[destino|alias]] y embebidos ![[destino]].
function buscarEnlaces(texto: string): EnlaceCrudo[] {
  return enlacesCrudos(enmascararCodigo(texto));
}

/**
 * Reescribe los wikilinks de `texto`: `mapearDestino` recibe el destino tal cual está
 * escrito y devuelve el nuevo, o null para dejarlo igual. Conserva '!', #encabezado
 * y |alias.
 */
export function reescribirEnlaces(texto: string, mapearDestino: (target: string) => string | null): string {
  let salida = '';
  let ultimo = 0;
  for (const enlace of buscarEnlaces(texto)) {
    const siguiente = mapearDestino(enlace.target.trim());
    if (siguiente === null || siguiente === enlace.target.trim()) continue;
    salida += texto.slice(ultimo, enlace.index) + `${enlace.bang}[[${siguiente}${enlace.heading}${enlace.alias}]]`;
    ultimo = enlace.index + enlace.length;
  }
  return ultimo === 0 ? texto : salida + texto.slice(ultimo);
}

async function leerCrudo(rutaRelativa: string): Promise<string | null> {
  let absoluta: string;
  try {
    absoluta = resolverRutaSegura(rutaRelativa);
  } catch {
    return null;
  }
  const leido = await leerArchivoRegular(absoluta);
  return leido.data ? leido.data.contenido.toString('utf8') : null;
}

/** Enlaces salientes (resueltos) y entrantes (backlinks) de una nota. */
export async function obtenerEnlacesNota(rutaRelativa: string): Promise<EnlacesNota> {
  const nota = await leerNota(rutaRelativa);
  const notas = await listarNotas();
  const indice = construirIndiceEnlaces(notas.map((n) => n.path));
  const titulos = new Map(notas.map((n) => [n.path, n.title]));

  const salientes: EnlaceSaliente[] = [];
  const vistos = new Set<string>();
  const crudo = (await leerCrudo(nota.path)) ?? nota.body;
  for (const enlace of buscarEnlaces(crudo)) {
    const destino = enlace.target.trim();
    if (!destino) continue; // [[#encabezado]] apunta a la propia nota
    const encabezado = enlace.heading ? enlace.heading.slice(1) : null;
    const clave = `${destino.toLowerCase()}#${encabezado ?? ''}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const resolved = resolverDestinoEnlace(destino, indice);
    salientes.push({
      target: destino,
      heading: encabezado,
      path: resolved,
      title: resolved ? (titulos.get(resolved) ?? null) : null,
    });
  }

  const entrantes: EnlaceEntrante[] = [];
  for (const otro of notas) {
    if (otro.path === nota.path) continue;
    const texto = await leerCrudo(otro.path);
    if (!texto) continue;
    if (buscarEnlaces(texto).some((l) => resolverDestinoEnlace(l.target, indice) === nota.path)) {
      entrantes.push({ path: otro.path, title: otro.title });
    }
  }
  entrantes.sort((a, b) => a.title.localeCompare(b.title));

  return { path: nota.path, outgoing: salientes, incoming: entrantes };
}

// Texto con el que enlazar a `rutaDestino` desde un enlace que antes decía `destinoAnterior`:
// si el original usaba ruta, ruta completa; si usaba solo el nombre, el nuevo
// nombre (o la ruta si ese nombre ya no es único en la bóveda).
function nuevoDestinoEnlace(destinoAnterior: string, rutaDestino: string, indice: IndiceEnlaces): string {
  const conExtension = /\.md$/i.test(destinoAnterior);
  const rutaCompleta = rutaDestino.replace(/\.md$/i, '');
  const base = nombreBaseDe(rutaCompleta);
  const unico = (indice.byBasename.get(nombreBaseDe(rutaDestino).toLowerCase())?.length ?? 0) <= 1;
  const texto = !destinoAnterior.includes('/') && unico ? base : rutaCompleta;
  return conExtension ? `${texto}.md` : texto;
}

/**
 * Renombra/mueve una nota y, con `actualizarEnlaces`, reescribe los wikilinks que la
 * apuntaban en el resto de la bóveda. Todas las notas tocadas se respaldan en la
 * misma sesión de respaldo. Devuelve las otras notas actualizadas.
 */
export async function renombrarNotaActualizandoEnlaces(
  origenRelativa: string,
  relativaDestino: string,
  actualizarEnlaces = true,
): Promise<{ from: string; to: string; links_updated: string[] }> {
  if (!actualizarEnlaces) return { ...(await renombrarNota(origenRelativa, relativaDestino)), links_updated: [] };

  // Qué enlaces apuntan hoy a la nota se decide con el índice ANTERIOR al renombrado.
  const antes = await listarNotas();
  const indiceAntes = construirIndiceEnlaces(antes.map((n) => n.path));
  const sesion = iniciarSesionRespaldo();
  const { from: desdeRuta, to } = await renombrarNota(origenRelativa, relativaDestino, sesion);

  const rutasDespues = antes.map((n) => (n.path === desdeRuta ? to : n.path));
  const indiceDespues = construirIndiceEnlaces(rutasDespues);
  const actualizada: string[] = [];

  for (const p of rutasDespues) {
    const texto = await leerCrudo(p);
    if (texto === null) continue;
    const siguiente = reescribirEnlaces(texto, (destino) =>
      resolverDestinoEnlace(destino, indiceAntes) === desdeRuta ? nuevoDestinoEnlace(destino, to, indiceDespues) : null,
    );
    if (siguiente === texto) continue;
    try {
      // La propia nota renombrada ya se respaldó (con su ruta antigua) en renombrarNota.
      if (p !== to) await respaldarNota(sesion, p);
      await fs.writeFile(resolverRutaSegura(p), siguiente, 'utf8');
    } catch (err) {
      throw new ErrorBiblioteca(
        `La nota se renombró, pero no se pudieron actualizar los enlaces de ${p}: ${(err as Error).message}`,
        'write_error',
      );
    }
    if (p !== to) actualizada.push(p);
  }
  return { from: desdeRuta, to, links_updated: actualizada };
}
