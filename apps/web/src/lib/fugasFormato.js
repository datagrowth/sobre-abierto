// Fugas entre sobres de una versión de la memoria (el servidor las detecta: oferta/fugas.ts):
// lo que la memoria dice del archivo de los criterios automáticos o de la oferta económica. Son
// causa de exclusión: «Dar por buena» (en la tarjeta de la memoria) pide antes el motivo.

// Los avisos del borrador que ya enseña el panel de fugas, con su cita.
const PREFIJO_AVISO = 'Fuga entre sobres';

/** Las fugas de la versión, siempre con la misma forma. */
export function fugasDe(m) {
  return { hallazgos: m?.fugas?.hallazgos ?? [], anulada: m?.fugas?.anulada ?? null };
}

/** Dónde está: «Apartado N» o, en una versión subida entera (apartado 0), «En el texto». */
export function dondeFuga(h) {
  return h?.apartado > 0 ? `Apartado ${h.apartado}` : 'En el texto';
}

/** «La memoria menciona 2 cosas…»; null sin fugas. */
export function textoFugas(m) {
  const n = fugasDe(m).hallazgos.length;
  if (!n) return null;
  const que = n === 1 ? 'una cosa que va' : `${n} cosas que van`;
  return `La memoria menciona ${que} en el archivo de los criterios automáticos o de la oferta económica: es causa de exclusión. Corrígela con «Pedir cambios» o subiendo una versión editada.`;
}

/** Los avisos de la versión sin los de fugas (los muestra el panel, con su cita). */
export function avisosSinFugas(avisos = []) {
  return avisos.filter((a) => !a.startsWith(PREFIJO_AVISO));
}

// Un eco dice lo mismo con otras palabras: puede ser casualidad, lo juzga una persona. Un importe
// que no habla de la oferta (importesSueltos del servidor) el código no lo puede dar por bueno.
const GRAVEDAD = {
  eco: { clave: 'sospecha', texto: 'Sospecha' },
  importe_suelto: { clave: 'no_comprobado', texto: 'No comprobado' },
};
const IMPIDE = { clave: 'impide', texto: 'Impide' };

/** La gravedad de un hallazgo: sospecha (eco), no comprobado (importe suelto) o impide (el resto). */
export function gravedadFuga(h) {
  return GRAVEDAD[h?.tipo] ?? IMPIDE;
}

// Mismo criterio que el servidor (oferta/fugas.ts, mismo()): sin mayúsculas, tildes ni espacios de más.
const comparable = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const enumerar = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);

/**
 * Lo que se comprobó cuando la versión no tiene fugas: contra cuántos criterios automáticos de
 * otro archivo, o que no aplica porque van en el mismo. guion: o.guion.datos. null si hay
 * hallazgos, la versión no está ensamblada (aún no se comprobó) o el guion no tiene memoria.
 */
export function textoComprobadoFugas(m, guion) {
  const archivoMemoria = guion?.memoria?.archivo;
  if (!archivoMemoria || m?.estado !== 'ensamblada' || fugasDe(m).hallazgos.length) return null;
  const otros = (guion.automaticos ?? []).filter((a) => comparable(a.archivo) !== comparable(archivoMemoria));
  if (!otros.length) return 'No aplica: memoria y criterios van en el mismo archivo';
  const archivos = enumerar([...new Map(otros.map((a) => [comparable(a.archivo), a.archivo])).values()]);
  const contra = otros.length === 1 ? 'el criterio' : `los ${otros.length} criterios`;
  return `Comprobado: 0 fugas contra ${contra} del ${archivos}`;
}

/** La indicación con la que «Pedir otra ronda con esta cita» abre «Pedir cambios». */
export function indicacionDeFuga(h) {
  return `Quita del apartado ${h.apartado}: «${h.cita}»`;
}

const enumerarApartados = (ns) =>
  ns.length > 1 ? `los apartados ${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}` : `el apartado ${ns[0]}`;

/**
 * Si el pliego pide el equipo por roles y la versión nombra a alguien: a cuántas personas y en qué
 * apartados (el servidor no manda los nombres). null si el pliego lo permite o no nombra a nadie.
 */
export function textoAnonimato(m) {
  const a = m?.anonimato;
  const apartados = Array.isArray(a?.apartados) ? a.apartados.filter((n) => Number.isInteger(n)) : [];
  if (!a?.exige || !apartados.length) return null;
  const personas = Number.isInteger(a.personas) && a.personas > 0 ? a.personas : null;
  const quien = personas
    ? `a ${personas} ${personas === 1 ? 'persona' : 'personas'} del equipo`
    : 'a personas del equipo';
  return `El pliego pide el equipo por roles, sin nombres, y la memoria nombra ${quien} en ${enumerarApartados(apartados)}: cámbialo por su rol con «Pedir cambios» o subiendo una versión editada.`;
}
