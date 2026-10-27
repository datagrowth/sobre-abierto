// Festivos laborales de España por año, calculados por código para fechar un calendario sin una tabla que caduque.

// Sirve para fechar el inicio de un contrato o sus semanas. Fuente: Estatuto de los Trabajadores, art. 37.2, y
// Real Decreto 2001/1983, art. 45 (fiestas nacionales y las que puede sustituir cada comunidad), con la
// relación que publica cada año la Dirección General de Trabajo en el BOE («Resolución … por la que se publica
// la relación de fiestas laborales para el año …»).
export const COMUNIDADES = {
  AN: 'Andalucía',
  AR: 'Aragón',
  AS: 'Principado de Asturias',
  IB: 'Illes Balears',
  CN: 'Canarias',
  CB: 'Cantabria',
  CM: 'Castilla-La Mancha',
  CL: 'Castilla y León',
  CT: 'Cataluña',
  VC: 'Comunitat Valenciana',
  EX: 'Extremadura',
  GA: 'Galicia',
  MD: 'Comunidad de Madrid',
  MC: 'Región de Murcia',
  NC: 'Comunidad Foral de Navarra',
  PV: 'País Vasco',
  RI: 'La Rioja',
  CE: 'Ceuta',
  ML: 'Melilla',
} as const;
export type Comunidad = keyof typeof COMUNIDADES;
export type Festivo = { fecha: string; nombre: string; ambito: 'nacional' | 'autonomico' };

const NACIONALES: [string, string][] = [
  ['01-01', 'Año Nuevo'],
  ['01-06', 'Epifanía del Señor'],
  ['05-01', 'Fiesta del Trabajo'],
  ['08-15', 'Asunción de la Virgen'],
  ['10-12', 'Fiesta Nacional de España'],
  ['11-01', 'Todos los Santos'],
  ['12-06', 'Día de la Constitución'],
  ['12-08', 'Inmaculada Concepción'],
  ['12-25', 'Natividad del Señor'],
];

// El día propio de cada comunidad y sus fiestas fijas estables.
const PROPIAS: Partial<Record<Comunidad, [string, string][]>> = {
  AN: [['02-28', 'Día de Andalucía']],
  AR: [['04-23', 'San Jorge, Día de Aragón']],
  AS: [['09-08', 'Día de Asturias']],
  IB: [['03-01', 'Día de las Illes Balears']],
  CN: [['05-30', 'Día de Canarias']],
  CM: [['05-31', 'Día de Castilla-La Mancha']],
  CL: [['04-23', 'Fiesta de Castilla y León']],
  CT: [
    ['06-24', 'San Juan'],
    ['09-11', 'Fiesta Nacional de Cataluña'],
    ['12-26', 'San Esteban'],
  ],
  VC: [
    ['06-24', 'San Juan'],
    ['10-09', 'Día de la Comunitat Valenciana'],
  ],
  EX: [['09-08', 'Día de Extremadura']],
  GA: [
    ['05-17', 'Día de las Letras Gallegas'],
    ['07-25', 'Día Nacional de Galicia'],
  ],
  MD: [['05-02', 'Fiesta de la Comunidad de Madrid']],
  MC: [['06-09', 'Día de la Región de Murcia']],
  NC: [['12-03', 'San Francisco Javier']],
  RI: [['06-09', 'Día de La Rioja']],
  CE: [['09-02', 'Día de Ceuta']],
  ML: [['09-17', 'Día de Melilla']],
};
const SIN_JUEVES_SANTO = new Set<Comunidad>(['CT', 'VC']);
const LUNES_DE_PASCUA = new Set<Comunidad>(['CT', 'VC', 'IB', 'NC', 'PV']);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (fecha: string) => new Date(`${fecha.slice(0, 10)}T00:00:00Z`);

/** Domingo de Pascua (algoritmo gregoriano anónimo, de Meeus/Jones/Butcher). */
export function domingoDePascua(anio: number): string {
  const a = anio % 19,
    b = Math.floor(anio / 100),
    c = anio % 100,
    d = Math.floor(b / 4),
    e = b % 4;
  const f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31),
    dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** La fecha `n` días después (o antes, con n negativo). */
export function sumarDias(fecha: string, n: number): string {
  const d = utc(fecha);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

function autonomicos(anio: number, c: Comunidad): Festivo[] {
  const pascua = domingoDePascua(anio);
  const fijos = (PROPIAS[c] ?? []).map(([md, nombre]) => ({
    fecha: `${anio}-${md}`,
    nombre,
    ambito: 'autonomico' as const,
  }));
  return [
    ...(SIN_JUEVES_SANTO.has(c)
      ? []
      : [{ fecha: sumarDias(pascua, -3), nombre: 'Jueves Santo', ambito: 'autonomico' as const }]),
    ...(LUNES_DE_PASCUA.has(c)
      ? [{ fecha: sumarDias(pascua, 1), nombre: 'Lunes de Pascua', ambito: 'autonomico' as const }]
      : []),
    ...fijos,
  ];
}

// Se calculan las nacionales de fecha fija y el Viernes Santo (Pascua por el algoritmo gregoriano anónimo), y
// las autonómicas estables año tras año: el día de cada comunidad, Jueves Santo donde es fiesta y Lunes de
// Pascua en las comunidades que lo celebran. Lo que cada comunidad decide año a año (trasladar al lunes la
// fiesta que cae en domingo, el 19 de marzo, el 25 de julio, el Corpus…) y las dos fiestas locales de cada
// municipio no se calculan: el calendario lo dice para que una persona lo confirme con la resolución del año.
/** Los festivos de un año: nacionales y, con comunidad, los suyos; por fecha y sin repetir día. */
export function festivosDelAnio(anio: number, comunidad: Comunidad | null): Festivo[] {
  const nacionales: Festivo[] = [
    ...NACIONALES.map(([md, nombre]) => ({ fecha: `${anio}-${md}`, nombre, ambito: 'nacional' as const })),
    { fecha: sumarDias(domingoDePascua(anio), -2), nombre: 'Viernes Santo', ambito: 'nacional' },
  ];
  const todos = [...nacionales, ...(comunidad ? autonomicos(anio, comunidad) : [])];
  const vistos = new Set<string>();
  return todos
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .filter((f) => !vistos.has(f.fecha) && vistos.add(f.fecha));
}

/** Los festivos entre dos fechas (incluidas). */
export function festivosEntre(desde: string, hasta: string, comunidad: Comunidad | null): Festivo[] {
  const anios = Array.from(
    { length: Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4)) + 1 },
    (_, i) => Number(desde.slice(0, 4)) + i,
  );
  return anios
    .flatMap((a) => festivosDelAnio(a, comunidad))
    .filter((f) => f.fecha >= desde.slice(0, 10) && f.fecha <= hasta.slice(0, 10));
}

const finDeSemana = (fecha: string) => [0, 6].includes(utc(fecha).getUTCDay());

/** El primer día laborable desde `fecha` (ella misma si lo es): ni sábado, ni domingo, ni festivo. */
export function siguienteLaborable(fecha: string, comunidad: Comunidad | null): string {
  const festivos = new Set(festivosEntre(fecha, sumarDias(fecha, 30), comunidad).map((f) => f.fecha));
  let d = fecha.slice(0, 10);
  while (finDeSemana(d) || festivos.has(d)) d = sumarDias(d, 1);
  return d;
}

/** `n` días hábiles después de `fecha` (sin contarla): «10 días hábiles desde el requerimiento». */
export function sumarDiasHabiles(fecha: string, n: number, comunidad: Comunidad | null): string {
  let d = fecha.slice(0, 10);
  for (let i = 0; i < n; i += 1) d = siguienteLaborable(sumarDias(d, 1), comunidad);
  return d;
}

const comparable = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Capitales de provincia, islas y ciudades grandes con su comunidad: la sede de un órgano
// suele estar en una de ellas.
const LUGARES: Record<string, Comunidad> = Object.fromEntries(
  Object.entries({
    AN: [
      'sevilla',
      'malaga',
      'cordoba',
      'granada',
      'almeria',
      'cadiz',
      'huelva',
      'jaen',
      'jerez de la frontera',
      'marbella',
      'algeciras',
      'andalucia',
    ],
    AR: ['zaragoza', 'huesca', 'teruel', 'aragon'],
    AS: ['oviedo', 'gijon', 'aviles', 'asturias'],
    IB: ['palma', 'palma de mallorca', 'mallorca', 'menorca', 'ibiza', 'eivissa', 'illes balears', 'islas baleares'],
    CN: [
      'santa cruz de tenerife',
      'las palmas de gran canaria',
      'las palmas',
      'tenerife',
      'gran canaria',
      'lanzarote',
      'fuerteventura',
      'la palma',
      'la gomera',
      'el hierro',
      'canarias',
    ],
    CB: ['santander', 'torrelavega', 'cantabria'],
    CM: [
      'toledo',
      'albacete',
      'ciudad real',
      'cuenca',
      'guadalajara',
      'talavera de la reina',
      'castilla-la mancha',
      'castilla la mancha',
    ],
    CL: [
      'valladolid',
      'burgos',
      'leon',
      'salamanca',
      'palencia',
      'zamora',
      'avila',
      'segovia',
      'soria',
      'ponferrada',
      'castilla y leon',
    ],
    CT: [
      'barcelona',
      'girona',
      'gerona',
      'lleida',
      'lerida',
      'tarragona',
      'hospitalet de llobregat',
      'badalona',
      'sabadell',
      'terrassa',
      'cataluna',
      'catalunya',
    ],
    VC: [
      'valencia',
      'alicante',
      'alacant',
      'castellon',
      'castellon de la plana',
      'elche',
      'elx',
      'comunitat valenciana',
      'comunidad valenciana',
    ],
    EX: ['merida', 'badajoz', 'caceres', 'extremadura'],
    GA: [
      'santiago de compostela',
      'a coruna',
      'la coruna',
      'lugo',
      'ourense',
      'pontevedra',
      'vigo',
      'ferrol',
      'galicia',
      'xunta',
    ],
    MD: [
      'madrid',
      'alcala de henares',
      'getafe',
      'mostoles',
      'leganes',
      'fuenlabrada',
      'alcorcon',
      'comunidad de madrid',
    ],
    MC: ['murcia', 'cartagena', 'lorca', 'region de murcia'],
    NC: ['pamplona', 'iruna', 'navarra'],
    PV: ['vitoria', 'vitoria-gasteiz', 'bilbao', 'san sebastian', 'donostia', 'barakaldo', 'pais vasco', 'euskadi'],
    RI: ['logrono', 'la rioja'],
    CE: ['ceuta'],
    ML: ['melilla'],
  }).flatMap(([c, lugares]) => lugares.map((l) => [l, c as Comunidad])),
);

// NUTS 2 de España (Eurostat, NUTS 2021) → comunidad.
const NUTS2: Record<string, Comunidad> = {
  ES11: 'GA',
  ES12: 'AS',
  ES13: 'CB',
  ES21: 'PV',
  ES22: 'NC',
  ES23: 'RI',
  ES24: 'AR',
  ES30: 'MD',
  ES41: 'CL',
  ES42: 'CM',
  ES43: 'EX',
  ES51: 'CT',
  ES52: 'VC',
  ES53: 'IB',
  ES61: 'AN',
  ES62: 'MC',
  ES63: 'CE',
  ES64: 'ML',
  ES70: 'CN',
};

function lugarEnTexto(texto: string): Comunidad | null {
  const t = ` ${comparable(texto).replace(/[^a-z0-9ñ -]/g, ' ')} `;
  const hallado = Object.keys(LUGARES)
    .sort((a, b) => b.length - a.length)
    .find((l) => t.includes(` ${l} `));
  return hallado ? LUGARES[hallado]! : null;
}

export type SedeOrgano = { ciudad?: string | null; nombre?: string | null; nuts?: string | null };

/**
 * La comunidad de la sede del órgano, con de dónde sale: la ciudad de su dirección, un lugar en
 * su nombre («Cabildo de Tenerife») o, si no, el NUTS del lugar de ejecución. null si nada lo dice.
 */
export function comunidadDeSede(s: SedeOrgano): { comunidad: Comunidad; fuente: string } | null {
  const porCiudad = s.ciudad ? lugarEnTexto(s.ciudad) : null;
  if (porCiudad) return { comunidad: porCiudad, fuente: `ciudad del órgano: ${s.ciudad}` };
  const porNombre = s.nombre ? lugarEnTexto(s.nombre) : null;
  if (porNombre) return { comunidad: porNombre, fuente: 'nombre del órgano' };
  const porNuts = s.nuts ? NUTS2[s.nuts.slice(0, 4).toUpperCase()] : undefined;
  return porNuts ? { comunidad: porNuts, fuente: `lugar de ejecución (NUTS ${s.nuts})` } : null;
}
