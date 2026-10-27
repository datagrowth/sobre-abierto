// Extrae los wikilinks [[…]] de una nota en una sola pasada.

// Las regex que había (/\[\[([^\]\n|]+)…\]\]/g) eran cuadráticas: con «[[» repetido sin cerrar, cada intento
// recorría el resto del texto, y 200 KB de «[[» en una nota de Drive dejaban el servidor parado minutos. Aquí cada
// «[[» cuesta lo mismo: los siguientes «]», «\n», «|» o «#» se buscan una vez y se reutilizan. Los resultados son
// los mismos que con aquellas regex.
// Siguiente aparición de un carácter. Las consultas de cada carácter van siempre hacia
// delante, así que lo encontrado vale mientras quede por delante de la posición pedida.
function buscador(texto: string): (ch: string, desde: number) => number {
  const almacenCache = new Map<string, number>();
  return (ch, desde) => {
    const previo = almacenCache.get(ch);
    if (previo !== undefined && (previo === -1 || previo >= desde)) return previo;
    const posicion = texto.indexOf(ch, desde);
    almacenCache.set(ch, posicion);
    return posicion;
  };
}

function primero(...indices: number[]): number {
  const validos = indices.filter((i) => i !== -1);
  return validos.length === 0 ? -1 : Math.min(...validos);
}

type Segmento = { inicio: number; desde: number; hasta: number };

// Cada «[[» cuyo primer «]» o salto de línea posterior es el «]]» que lo cierra. `aceptar`
// dice si con ese interior hay enlace: si no, se prueba desde el carácter siguiente.
function recorrer(texto: string, aceptar: (s: Segmento, buscar: ReturnType<typeof buscador>) => boolean): void {
  const buscar = buscador(texto);
  let i = texto.indexOf('[[');
  while (i !== -1) {
    const cierre = primero(buscar(']', i + 2), buscar('\n', i + 2));
    if (cierre === -1) return;
    const ok =
      texto[cierre] === ']' && texto[cierre + 1] === ']' && aceptar({ inicio: i, desde: i + 2, hasta: cierre }, buscar);
    i = texto.indexOf('[[', ok ? cierre + 2 : i + 1);
  }
}

function antes(posicion: number, hasta: number): number {
  return posicion !== -1 && posicion < hasta ? posicion : -1;
}

/** Destinos de [[destino]] y [[destino|alias]] (sin «]», «|» ni saltos; alias no vacío). */
export function wikilinkTargets(texto: string): string[] {
  const salida: string[] = [];
  recorrer(texto, ({ desde, hasta }, buscar) => {
    const barra = antes(buscar('|', desde), hasta);
    const finDestino = barra === -1 ? hasta : barra;
    if (finDestino === desde || (barra !== -1 && barra + 1 === hasta)) return false;
    salida.push(texto.slice(desde, finDestino));
    return true;
  });
  return salida;
}

export type EnlaceCrudo = {
  index: number;
  length: number;
  bang: string;
  target: string;
  heading: string;
  alias: string;
};

/**
 * [[destino]], [[destino#encabezado]], [[destino|alias]] y embebidos ![[destino]], con
 * su posición. `heading` incluye el «#» y `alias` la «|» (o '' si no hay).
 */
export function enlacesCrudos(texto: string): EnlaceCrudo[] {
  const salida: EnlaceCrudo[] = [];
  recorrer(texto, ({ inicio, desde, hasta }, buscar) => {
    const barra = antes(buscar('|', desde), hasta);
    const almohadilla = antes(buscar('#', desde), hasta);
    const conEncabezado = almohadilla !== -1 && (barra === -1 || almohadilla < barra);
    const finDestino = conEncabezado ? almohadilla : barra === -1 ? hasta : barra;
    const inicioAlias = barra === -1 ? hasta : barra;
    const bang = inicio > 0 && texto[inicio - 1] === '!' ? '!' : '';
    const indice = inicio - bang.length;
    salida.push({
      index: indice,
      length: hasta + 2 - indice,
      bang,
      target: texto.slice(desde, finDestino),
      heading: conEncabezado ? texto.slice(almohadilla, inicioAlias) : '',
      alias: texto.slice(inicioAlias, hasta),
    });
    return true;
  });
  return salida;
}
