// Texto normalizado para reconocer ediciones de una misma licitación: nombre del órgano y palabras del objeto.

// Quita años, números de expediente y las palabras que salen en casi todos los títulos.
/** Minúsculas, sin acentos ni entidades HTML, solo letras y números separados por un espacio. */
export function textoBase(s: string): string {
  return s
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`´·]/g, '')
    .replace(/[^a-z0-9ñç]+/g, ' ')
    .trim();
}

// Nombres de órgano que son un cargo y no una entidad: en las plataformas agregadas hay
// decenas de «Pleno», «Alcaldía» o «Junta de Gobierno Local» de ayuntamientos distintos
// (un mismo «Pleno» o «Alcalde» se repite con decenas de superiores distintos).
// Se comparan sin artículos ni preposiciones («Junta Gobierno Local») y sin la forma doble
// («Director/a Gerente»).
const CARGO = new RegExp(
  `^(${[
    'alcalde',
    'alcaldesa',
    'alcaldia',
    'alcalde presidente',
    'alcaldesa presidenta',
    'alcaldia presidencia',
    'pleno',
    'pleno municipal',
    'pleno ayuntamiento',
    'pleno corporacion',
    'pleno corporacion municipal',
    'junta gobierno',
    'junta gobierno local',
    'junta plenaria',
    'junta directiva',
    'junta general',
    'junta',
    'junta concejo',
    'junta concejil',
    'concejo abierto',
    'presidente',
    'presidenta',
    'presidencia',
    'director',
    'directora',
    'direccion',
    'director general',
    'directora general',
    'direccion general',
    'director gerente',
    'directora gerente',
    'direccion gerencia',
    'gerente',
    'gerencia',
    'consejo administracion',
    'presidente consejo administracion',
    'consejo rector',
    'consejo gobierno',
    'consejo gobierno foral',
    'diputado general',
    'diputada general',
    'comision ejecutiva',
    'comision gobierno',
    'consejero delegado',
    'consejera delegada',
    'organo contratacion',
    'mesa contratacion',
    'secretario general',
    'secretaria general',
    'rector',
    'rectora',
    'rectorado',
    'patronato',
    'comite direccion',
    'comite directivo',
    'asamblea',
    'asamblea general',
  ].join('|')})$`,
);

// Cargos de una entidad local al principio del nombre: «Alcaldía de Castejón», «Pleno de la
// Corporación Municipal de Castejón» o «Presidente de la Cuadrilla» son su ayuntamiento o su
// cuadrilla (el órgano superior). Solo los locales: «Dirección General de …» con superior
// «Comunidad de La Rioja» juntaría todas las direcciones de la comunidad.
const CARGO_LOCAL =
  /^(alcalde|alcaldesa|alcaldia|pleno|junta gobierno|presidente|presidenta|presidencia|concejal|concejala|concejalia)\b/;

const ENLACES = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'e']);

function nucleoCargo(s: string): string {
  return textoBase(s.replace(/\/(a|as|o|os)\b/gi, ''))
    .split(' ')
    .filter((t) => !ENLACES.has(t))
    .join(' ');
}

/**
 * Clave del órgano por nombre, para cuando no hay NIF: sin los cargos del final
 * («Ayuntamiento de Vitoria-Gasteiz-Junta de Gobierno Local» → el ayuntamiento); si el
 * nombre es solo un cargo o empieza por un cargo local, el órgano superior; y si no, el
 * nombre con su superior («consejo de gobierno foral | diputacion foral de alava»), para que
 * dos órganos de nombre genérico de entidades distintas no se confundan. Null si no queda
 * nada que lo identifique.
 */
export function normalizarOrgano(nombre: string, superior: string | null = null): string | null {
  const partes = nombre.split(/\s*[-–]\s*/).filter((p) => p.trim());
  while (partes.length && CARGO.test(nucleoCargo(partes[partes.length - 1] ?? ''))) partes.pop();
  const propio = textoBase(partes.join(' '));
  const deSuperior = superior ? textoBase(superior) : '';
  if (!deSuperior) return propio || null;
  if (!propio || CARGO_LOCAL.test(nucleoCargo(propio)) || propio === deSuperior) return deSuperior;
  return `${propio} | ${deSuperior}`;
}

// Palabras vacías (castellano, catalán, gallego) y las que salen en casi todos los
// títulos de contratos: no dicen de qué es el contrato.
const VACIAS = new Set(
  `a al ante bajo con contra de del desde durante e el en entre hacia hasta la las le lo los mediante o para por que se
segun sin sobre su sus tras u un una unos unas y i amb dels els les per pel pels als da do das dos no na
servicio servicios contrato contratos contratacion suministro suministros prestacion adquisicion lote lotes expediente exp
ano anos anual anualidad anualidades ejercicio ejercicios curso cursos procedimiento abierto simplificado licitacion varios
diversas diversos destino destinado destinados municipal municipales ayuntamiento enero febrero marzo abril mayo junio julio
agosto septiembre setiembre octubre noviembre diciembre mes meses periodo plazo prorroga prorrogable duracion
servei serveis subministrament contracte obra obres
financiado financiada fondo fondos mecanismo recuperacion transformacion resiliencia plan prtr nextgenerationeu next generation
union europea feder cofinanciado cofinanciada`.split(/\s+/),
);

// Plural a singular, lo justo para que «servidores» y «servidor» cuenten igual.
function singular(t: string): string {
  if (t.length > 4 && t.endsWith('es') && 'lnrdj'.includes(t[t.length - 3] ?? '')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/** Palabras del objeto: sin años, números de expediente (toda palabra con cifras) ni vacías. */
export function palabrasObjeto(titulo: string): Set<string> {
  const palabras = textoBase(titulo)
    .split(' ')
    .filter((t) => t.length > 2 && !/\d/.test(t) && !VACIAS.has(t));
  return new Set(palabras.map(singular));
}

// licitaciones.titulo_palabras guarda las palabras del título ya normalizadas: leer un órgano
// de 20.000 licitaciones no tiene que normalizar 20.000 títulos en cada consulta. Si cambian
// VACIAS o singular(), hay que recalcular la columna (ARREGLOS de store.ts).
export function palabrasTexto(titulo: string): string {
  return [...palabrasObjeto(titulo)].join(' ');
}

export function palabrasGuardadas(guardadas: string | null, titulo: string): Set<string> {
  return guardadas === null ? palabrasObjeto(titulo) : new Set(guardadas.split(' ').filter(Boolean));
}

// propia: la palabra sale en muy pocos títulos del órgano (un topónimo, un centro, una ruta).
export type Pesos = ((palabra: string) => number) & { propia: (palabra: string) => boolean };

// Con menos títulos que estos en el órgano no se puede saber qué palabra es «propia».
const MIN_TITULOS_PROPIAS = 20;
const MAX_DF_PROPIA = 2;

/**
 * Pesos por rareza dentro de los títulos del mismo órgano (idf): las palabras que el
 * órgano repite en todo («hospital», «universitario», su propio nombre) pesan poco y las
 * que distinguen un contrato de otro, mucho. El +0,1 evita pesos nulos.
 */
export function pesosDe(documentos: Set<string>[]): Pesos {
  const df = new Map<string, number>();
  for (const d of documentos) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const n = documentos.length;
  const pesos = new Map([...df].map(([t, f]) => [t, Math.log((n + 1) / (f + 0.5)) + 0.1]));
  const raro = Math.log((n + 1) / 0.5) + 0.1;
  const propia = (t: string) => n >= MIN_TITULOS_PROPIAS && (df.get(t) ?? 0) <= MAX_DF_PROPIA;
  return Object.assign((t: string) => pesos.get(t) ?? raro, { propia });
}

/** Jaccard ponderado: peso de las palabras comunes entre el de todas. 0 si alguno está vacío. */
export function similitud(a: Set<string>, b: Set<string>, peso: Pesos): number {
  if (!a.size || !b.size) return 0;
  let comun = 0;
  let total = 0;
  for (const t of a) {
    const w = peso(t);
    total += w;
    if (b.has(t)) comun += w;
  }
  for (const t of b) if (!a.has(t)) total += peso(t);
  return total > 0 ? Math.round((comun / total) * 1000) / 1000 : 0;
}

// Contratos basados en un acuerdo marco: repiten el título del acuerdo y no son ediciones.
const DERIVADO = /\b(cbam|contratos? basados?|contratos? derivados?|basados? en (el |un )?acuerdo marco)\b/;

export function esDerivado(titulo: string): boolean {
  return DERIVADO.test(textoBase(titulo));
}

/**
 * ¿Tiene cada título una palabra propia que el otro no tiene? Es lo que separa «Servicio
 * de investigación privada en Ourense» de «… en Alicante»: el mismo servicio en otro
 * sitio, no una edición anterior.
 */
export function propiasEnAmbos(a: Set<string>, b: Set<string>, pesos: Pesos): boolean {
  const exclusivaPropia = (x: Set<string>, y: Set<string>) => [...x].some((t) => !y.has(t) && pesos.propia(t));
  return exclusivaPropia(a, b) && exclusivaPropia(b, a);
}
