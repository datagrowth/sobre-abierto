// Lo que se acredita con un papel y se reconoce en el texto de un requisito. Puro y sin dependencias del dominio.

// Son certificaciones (ENS con su categoría, ISO, CMMI, partner de fabricante) y códigos de clasificación. Lo
// usan «Qué nos falta» (barreras.ts) y la verificación de la ficha (fichaVerificacion.ts).
// experiencia_personal: la materia que el pliego pide al personal («5 años en monitorización de
// medios»), que no se acredita con un papel sino con quién cuenta la empresa.
export type TipoBarrera = 'certificacion' | 'seguro' | 'clasificacion' | 'habilitacion' | 'experiencia_personal';
// nivel: la categoría del ENS que pide (básica, media o alta), si la dice.
export type Clave = { clave: string; nombre: string; tipo: TipoBarrera; nivel?: string };

export const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NIVEL_ENS: Record<string, string> = {
  basica: 'básica',
  basico: 'básica',
  media: 'media',
  medio: 'media',
  alta: 'alta',
  alto: 'alta',
};
const FABRICANTES = /(microsoft|azure|google|aws|amazon|oracle|ibm|salesforce|sap)/;

function textoBreve(t: string): Clave['nombre'] {
  const limpio = t.replace(/\s+/g, ' ').trim();
  return limpio.length > 90 ? `${limpio.slice(0, 89)}…` : limpio;
}

/** Un papel sin nombre conocido, con una clave sacada de su texto. */
export function otra(tipo: TipoBarrera, texto: string): Clave {
  return {
    clave: `${tipo}:${sinTildes(texto)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 60)}`,
    nombre: textoBreve(texto),
    tipo,
  };
}

/**
 * La experiencia del personal en una materia. La clave usa el mismo sujeto que la fila «medios»
 * de las comprobaciones (claveBloqueo): así la fila de elegibilidad encuentra su barrera.
 */
export function clavePersonal(materia: string): Clave {
  const sujeto = sinTildes(materia)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return {
    clave: `experiencia_personal:${sujeto}`,
    nombre: `Experiencia del personal en ${textoBreve(materia)}`,
    tipo: 'experiencia_personal',
  };
}

/** Certificaciones nombradas en un texto: ENS (con su categoría), ISO, CMMI, partner de fabricante. */
export function certificaciones(texto: string): Clave[] {
  const t = sinTildes(texto);
  const out: Clave[] = [];
  if (/esquema nacional de seguridad|\bens\b/.test(t)) {
    const nivel = /(?:categoria|nivel)\s+(?:de\s+seguridad\s+)?(basic[ao]|medi[ao]|alt[ao])/.exec(t)?.[1];
    out.push({
      clave: 'ens',
      nombre: 'ENS (Esquema Nacional de Seguridad)',
      tipo: 'certificacion',
      ...(nivel ? { nivel: NIVEL_ENS[nivel] } : {}),
    });
  }
  for (const m of t.matchAll(/\biso(?:\s*\/?\s*iec)?\s*[-:]?\s*(\d{4,5})/g))
    out.push({ clave: `iso-${m[1]}`, nombre: `ISO ${m[1]}`, tipo: 'certificacion' });
  if (/\bcmmi\b/.test(t)) out.push({ clave: 'cmmi', nombre: 'CMMI', tipo: 'certificacion' });
  if (/partner|premier tier|competency|expertise|especializacion/.test(t) && FABRICANTES.test(t)) {
    out.push({
      clave: 'partner-fabricante',
      nombre: 'Partner de fabricante (Microsoft, Google, AWS…)',
      tipo: 'certificacion',
    });
  }
  return [...new Map(out.map((c) => [c.clave, c])).values()];
}

// «Grupo V, Subgrupo 2, Categoría C» o un código pegado («V2-3», «V-2-C»): los sueltos con
// espacios («a 2 años») no cuentan como código.
export function codigoClasificacion(texto: string): string | null {
  const t = sinTildes(texto);
  const largo = /grupo\s+([a-z])\W+subgrupo\s+(\d)(?:\W+categoria\s+([1-6a-f]))?/.exec(t);
  if (largo) return `${largo[1]}${largo[2]}${largo[3] ? `-${largo[3]}` : ''}`.toUpperCase();
  const corto = /\b([A-Z])-?(\d)(?:-([1-6A-F]))?\b/.exec(texto.toUpperCase());
  return corto ? `${corto[1]}${corto[2]}${corto[3] ? `-${corto[3]}` : ''}` : null;
}
