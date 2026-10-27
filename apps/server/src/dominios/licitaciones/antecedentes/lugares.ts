// Lugares que nombran los títulos: provincias, comunidades, islas y ciudades grandes.
import { textoBase } from './texto.js';

// Cada grupo: el nombre que se devuelve y sus variantes (castellano, lengua cooficial, sin artículo).
const GRUPOS: string[][] = [
  ['a coruna', 'la coruna', 'coruna'],
  ['alava', 'araba'],
  ['albacete'],
  ['alicante', 'alacant'],
  ['almeria'],
  ['asturias', 'oviedo', 'gijon', 'aviles'],
  ['avila'],
  ['badajoz', 'merida'],
  ['baleares', 'illes balears', 'mallorca', 'palma de mallorca', 'menorca', 'ibiza', 'eivissa', 'formentera'],
  ['barcelona', 'badalona', 'sabadell', 'terrassa', 'hospitalet'],
  ['bizkaia', 'vizcaya', 'bilbao', 'barakaldo', 'getxo'],
  ['burgos'],
  ['caceres'],
  ['cadiz', 'jerez', 'algeciras'],
  ['cantabria', 'santander'],
  ['castellon', 'castello'],
  ['ciudad real', 'puertollano'],
  ['cordoba'],
  ['cuenca'],
  ['gipuzkoa', 'guipuzcoa', 'donostia', 'san sebastian'],
  ['girona', 'gerona', 'figueres', 'figueras'],
  ['granada'],
  ['guadalajara'],
  ['huelva'],
  ['huesca'],
  ['jaen'],
  ['la rioja', 'rioja', 'logrono'],
  ['las palmas', 'gran canaria', 'lanzarote', 'fuerteventura'],
  ['leon', 'ponferrada'],
  ['lleida', 'lerida'],
  ['lugo'],
  ['madrid', 'getafe', 'mostoles', 'fuenlabrada', 'leganes', 'alcala de henares', 'aranjuez'],
  ['malaga', 'marbella'],
  ['murcia', 'cartagena'],
  ['navarra', 'pamplona', 'iruna'],
  ['ourense', 'orense'],
  ['palencia'],
  ['pontevedra', 'vigo'],
  ['salamanca'],
  ['santa cruz de tenerife', 'tenerife', 'la palma', 'la gomera', 'el hierro'],
  ['segovia'],
  ['sevilla'],
  ['soria'],
  ['tarragona', 'reus'],
  ['teruel'],
  ['toledo', 'talavera'],
  ['valencia'],
  ['valladolid'],
  ['zamora'],
  ['zaragoza'],
  ['ceuta'],
  ['melilla'],
  ['vitoria', 'gasteiz'],
  ['santiago de compostela'],
  ['elche', 'elx'],
];

// Comunidades autónomas: cuentan como lugar propio («Castilla y León» no es «León»). Las
// mutuas licitan lo mismo por comunidades («… en Extremadura y Castilla-La Mancha», «… en Cataluña»).
const COMUNIDADES: string[][] = [
  ['castilla y leon'],
  ['castilla la mancha'],
  ['comunidad valenciana', 'comunitat valenciana'],
  ['pais vasco', 'euskadi'],
  ['cataluna', 'catalunya'],
  ['andalucia'],
  ['aragon'],
  ['extremadura'],
  ['galicia'],
  ['canarias'],
  ['comunidad de madrid'],
  ['region de murcia'],
  ['principado de asturias'],
  ['comunidad foral de navarra'],
];

const CANONICO = new Map<string, string>(
  [...GRUPOS, ...COMUNIDADES].flatMap((g) => g.map((v): [string, string] => [v, g[0] ?? v])),
);
// Las variantes largas primero: «palma de mallorca» antes que «la palma».
const PATRON = new RegExp(`(?:^| )(${[...CANONICO.keys()].sort((a, b) => b.length - a.length).join('|')})(?= |$)`, 'g');

// Lo mismo pasa con las rutas de transporte escolar, los sectores de carreteras o los
// lotes: «Ruta P-203» frente a «Ruta 2346S16004054N». El código tras la palabra se junta
// («ruta e 208 c» → «e208c») y debe llevar alguna cifra.
// Las palabras cortas que no son código («lote 2 de …») cortan el identificador.
const IDENTIFICADO =
  /(?:^| )(ruta|sector|tramo|linea|lote|zona) ((?:(?!(?:de|del|la|el|en|y|a|i|o|u|al|lo|da|do|na|no|per|amb) )[a-z0-9]{1,2} |[a-z]*\d[a-z0-9]* ){1,3})/g;

/** Lugares (lugar:…) e identificadores (ruta:…, sector:…) que nombra un texto. */
export function lugaresDe(texto: string): Set<string> {
  const base = textoBase(texto);
  const rasgos = new Set<string>();
  for (const m of base.matchAll(PATRON)) {
    const canonico = CANONICO.get(m[1] ?? '');
    if (canonico) rasgos.add(`lugar:${canonico}`);
  }
  for (const m of `${base} `.matchAll(IDENTIFICADO)) {
    const codigo = (m[2] ?? '').replace(/ /g, '');
    if (/\d/.test(codigo)) rasgos.add(`${m[1]}:${codigo}`);
  }
  return rasgos;
}

const clase = (rasgo: string) => rasgo.slice(0, rasgo.indexOf(':'));

// Un órgano estatal o una mutua licitan el mismo servicio en cada provincia («Servicio de investigación privada
// en Ourense», «… en Alicante») y esos títulos se parecen mucho sin ser ediciones uno del otro. Si los dos
// nombran lugares y no comparten ninguno, son contratos distintos.
/** ¿Nombran los dos lugares (o rutas, sectores…) de la misma clase sin ninguno en común? */
export function otroLugar(a: Set<string>, b: Set<string>): boolean {
  const clases = new Set([...a].map(clase));
  return [...clases].some((c) => {
    const deB = [...b].filter((r) => clase(r) === c);
    return deB.length > 0 && !deB.some((r) => a.has(r));
  });
}
