// Textos y tonos de la caducidad de los documentos de la carpeta Empresa. `hoy` es AAAA-MM-DD
// (día de Madrid) y se recibe como argumento para que el resultado no dependa del reloj.
const AVISO_DIAS = 30;
const DIA_MS = 86400000;

export const TIPOS_DOCUMENTO = [
  ['certificado', 'Certificado'],
  ['rolece', 'ROLECE'],
  ['aeat', 'AEAT'],
  ['tgss', 'TGSS'],
  ['escritura', 'Escritura'],
  ['seguro', 'Seguro'],
  ['titulo', 'Título'],
  ['cv', 'CV'],
  ['otro', 'Otro'],
];

export const etiquetaTipo = (tipo) => TIPOS_DOCUMENTO.find(([k]) => k === tipo)?.[1] ?? tipo;

function diasHasta(caducaEn, hoy) {
  if (!caducaEn || !hoy) return null;
  const d = Math.round((Date.parse(`${caducaEn}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA_MS);
  return Number.isNaN(d) ? null : d;
}

/** «Caduca en 19 días», «Caduca hoy», «Caducado» o «Sin fecha». */
export function textoCaducidad(caducaEn, hoy) {
  const d = diasHasta(caducaEn, hoy);
  if (d === null) return 'Sin fecha';
  if (d < 0) return 'Caducado';
  if (d === 0) return 'Caduca hoy';
  return `Caduca en ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** 'peligro' si caducó, 'aviso' dentro de los 30 días, 'ok' si está vigente, 'neutro' sin fecha. */
export function tonoCaducidad(caducaEn, hoy) {
  const d = diasHasta(caducaEn, hoy);
  if (d === null) return 'neutro';
  if (d < 0) return 'peligro';
  return d <= AVISO_DIAS ? 'aviso' : 'ok';
}

/** Cuerpo del campo «datos» de la subida; null con el motivo si falta algo. */
export function datosSubida({ tipo, nombre, caduca_en, persona_id, horas_desglosadas }) {
  const n = (nombre ?? '').trim();
  if (n.length < 2) return { error: 'Pon un nombre al documento.' };
  return {
    datos: {
      tipo,
      nombre: n,
      caduca_en: caduca_en || null,
      persona_id: persona_id ? Number(persona_id) : null,
      horas_desglosadas: Boolean(horas_desglosadas),
    },
  };
}

/**
 * La pregunta antes de quitar un documento: no se puede deshacer y, si estaba vigente, las filas
 * de las ofertas dejan de ofrecerlo en «Usar el de la carpeta Empresa».
 */
export function preguntaQuitar(d) {
  return {
    pregunta: `¿Quitar «${d.nombre}» de la carpeta Empresa?`,
    detalle: 'No se puede deshacer: las ofertas dejan de ofrecerlo para reutilizar y habrá que volver a subirlo.',
  };
}

/** Hoy como AAAA-MM-DD en Madrid (los plazos de la PLACSP son peninsulares). */
export function hoyMadrid(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
