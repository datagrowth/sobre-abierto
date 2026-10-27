// Fuentes de datos abiertos de la PLACSP (Atom + CODICE). El feed en vivo trae lo
// último y enlaza con «next» a páginas anteriores; los ZIP anuales, el histórico.
export type FuenteId = 'perfiles' | 'agregadas';

export type Fuente = {
  id: FuenteId;
  nombre: string;
  feed: string;
  zipAnual: (anio: number) => string;
  // Desde 2018 también hay un ZIP por mes («_201803.zip»): diez veces más pequeño que el anual.
  zipMensual: (anio: number, mes: number) => string;
  // Primer año con ZIP en la PLACSP.
  primerAnio: number;
  // Prefijo de el id corto: «p-20571214», «a-7824336».
  prefijo: string;
  // Nombre corto para los avisos.
  corto: string;
  // Horas sin entradas nuevas a partir de las cuales la fuente se da por parada. Cada una
  // publica a su ritmo: perfiles, varias veces por hora; agregadas, un lote de madrugada.
  sinNovedadesHoras: number;
};

const BASE = 'https://contrataciondelestado.es/sindicacion';

export const FUENTES: Record<FuenteId, Fuente> = {
  perfiles: {
    id: 'perfiles',
    nombre: 'Perfiles de contratante de la Plataforma (Estado y organismos adheridos)',
    feed: `${BASE}/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom`,
    zipAnual: (anio) => `${BASE}/sindicacion_643/licitacionesPerfilesContratanteCompleto3_${anio}.zip`,
    zipMensual: (anio, mes) =>
      `${BASE}/sindicacion_643/licitacionesPerfilesContratanteCompleto3_${anio}${String(mes).padStart(2, '0')}.zip`,
    primerAnio: 2012,
    prefijo: 'p',
    corto: 'Perfiles de contratante (Estado y organismos adheridos)',
    sinNovedadesHoras: 6,
  },
  agregadas: {
    id: 'agregadas',
    nombre: 'Plataformas agregadas (comunidades autónomas y entidades locales)',
    feed: `${BASE}/sindicacion_1044/PlataformasAgregadasSinMenores.atom`,
    zipAnual: (anio) => `${BASE}/sindicacion_1044/PlataformasAgregadasSinMenores_${anio}.zip`,
    zipMensual: (anio, mes) =>
      `${BASE}/sindicacion_1044/PlataformasAgregadasSinMenores_${anio}${String(mes).padStart(2, '0')}.zip`,
    primerAnio: 2016,
    prefijo: 'a',
    corto: 'Plataformas agregadas (comunidades autónomas y entidades locales)',
    sinNovedadesHoras: 30,
  },
};

/** Id corto y estable a partir del id Atom («…/licitacionesPerfilContratante/20571214» → «p-20571214»). */
export function idCorto(fuente: FuenteId, atomId: string): string {
  const ultimo = atomId.replace(/\/+$/, '').split('/').pop() ?? atomId;
  return `${FUENTES[fuente].prefijo}-${ultimo.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

// Solo descargamos de la propia plataforma: las URLs de pliegos y páginas
// siguientes vienen del feed y no se sigue nada fuera de ella.
export function esUrlDePlataforma(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'contrataciondelestado.es' || u.hostname === 'contrataciondelsectorpublico.gob.es')
    );
  } catch {
    return false;
  }
}

// Las plataformas autonómicas que agrega la PLACSP publican los pliegos en su propio
// dominio y el feed los enlaza allí. Lista cerrada (nada de seguir cualquier URL del feed),
// con las que sirven el PDF directamente por https, comprobado a mano.
const PLATAFORMAS_AUTONOMICAS = new Set([
  'www.contratacion.euskadi.eus', // País Vasco
  'contractaciopublica.cat', // Cataluña
  'contratos-publicos.comunidad.madrid', // Comunidad de Madrid
]);

/** De dónde se pueden bajar pliegos: la PLACSP y las plataformas autonómicas de la lista. */
export function esUrlDePliego(raw: string): boolean {
  if (esUrlDePlataforma(raw)) return true;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && PLATAFORMAS_AUTONOMICAS.has(u.hostname);
  } catch {
    return false;
  }
}
