// Identidad de una organización: NIF normalizado, clase de entidad, nombre canónico, UTE y provincia. Puro.

// El NIF se comprueba con su control; la clase la dice su primera letra; el nombre canónico agrupa los alias con
// que la PLACSP publica a una misma empresa; las UTE se separan en sus miembros y la provincia sale del código
// postal. Las usan nucleo.db al migrar y los dominios.
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const LETRAS_CIF = 'JABCDEFGHI';

/** Mayúsculas, sin espacios, puntos ni guiones y sin el prefijo de país «ES» de un NIF español. */
export function normalizarNif(nif: string): string {
  const limpio = nif.replace(/[\s.-]/g, '').toUpperCase();
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(limpio) ? limpio.slice(2) : limpio;
}

function controlDni(numero: string, letra: string): boolean {
  return LETRAS_DNI[Number(numero) % 23] === letra;
}

// CIF: las cifras impares (1.ª, 3.ª…) se doblan y se suman sus dígitos; el control es lo que
// falta para la decena. A, B, E y H llevan dígito; K, P, Q, S, N y W, letra; el resto, cualquiera.
function controlCif(letra: string, cifras: string, control: string): boolean {
  let suma = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(cifras[i]);
    suma += i % 2 === 0 ? Math.floor((d * 2) / 10) + ((d * 2) % 10) : d;
  }
  const digito = (10 - (suma % 10)) % 10;
  if ('ABEH'.includes(letra)) return control === String(digito);
  if ('KPQSNW'.includes(letra)) return control === LETRAS_CIF[digito];
  return control === String(digito) || control === LETRAS_CIF[digito];
}

export type EstadoNif = 'valido' | 'extranjero' | 'no_valido';

/** ¿NIF español con su control bien, identificador de otro país (dos letras de país delante) o ninguno? */
export function estadoNif(nif: string): EstadoNif {
  const n = normalizarNif(nif);
  let m = /^(\d{8})([A-Z])$/.exec(n);
  if (m) return controlDni(m[1]!, m[2]!) ? 'valido' : 'no_valido';
  m = /^([XYZ])(\d{7})([A-Z])$/.exec(n);
  if (m) return controlDni(String('XYZ'.indexOf(m[1]!)) + m[2]!, m[3]!) ? 'valido' : 'no_valido';
  m = /^([KLM])(\d{7})([A-Z])$/.exec(n);
  if (m) return controlDni(m[2]!, m[3]!) ? 'valido' : 'no_valido';
  m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(n);
  if (m) return controlCif(m[1]!, m[2]!, m[3]!) ? 'valido' : 'no_valido';
  return /^(?!ES)[A-Z]{2}[0-9A-Z]{2,13}$/.test(n) ? 'extranjero' : 'no_valido';
}

export type ClaseNif = 'persona_fisica' | 'organismo' | 'ute' | 'empresa';

/** La clase de entidad por la forma del NIF (DNI, NIE y K/L/M son personas físicas; P, Q y S, organismos; U, UTE). */
export function claseNif(nif: string): ClaseNif {
  const n = normalizarNif(nif);
  if (/^\d/.test(n) || /^[XYZKLM]\d{7}[A-Z]$/.test(n)) return 'persona_fisica';
  if (/^[PQS]\d{7}[0-9A-J]$/.test(n)) return 'organismo';
  if (/^U\d{7}[0-9A-J]$/.test(n)) return 'ute';
  return 'empresa';
}

// Formas jurídicas al final del nombre: «Sistemas Ejemplo, S.A.» e «SISTEMAS EJEMPLO SA» son la
// misma empresa y la PLACSP publica las dos.
export const FORMA_JURIDICA =
  /[\s,]+(s\.?\s?a\.?\s?u\.?|s\.?\s?l\.?\s?u\.?|s\.?\s?a\.?|s\.?\s?l\.?|s\.?\s?l\.?\s?l\.?|s\.?\s?c\.?\s?o\.?\s?o\.?\s?p\.?|sociedad an[oó]nima( unipersonal)?|sociedad limitada( unipersonal)?)\s*$/i;

const MARCA_UTE = /\b(u\.?\s?t\.?\s?e\.?|uni[oó]n temporal de empresas|ley\s*18\/1982)(?=[\s,.\-:]|$)/gi;

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Clave para agrupar alias: sin tildes, mayúsculas, forma jurídica, marca de UTE ni puntuación. */
export function nombreCanonico(nombre: string): string {
  let t = sinTildes(nombre).toLowerCase().replace(/\s+/g, ' ').trim();
  for (let antes = ''; antes !== t;) {
    antes = t;
    t = t.replace(FORMA_JURIDICA, '').replace(/[\s,.;:]+$/, '');
  }
  return t
    .replace(MARCA_UTE, ' ')
    .replace(/&/g, ' y ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Es una UTE? Por el NIF (empieza por U) o porque el nombre lo dice. */
export function esUte(nif: string | null, nombre: string | null): boolean {
  if (nif && claseNif(nif) === 'ute') return true;
  return nombre !== null && new RegExp(MARCA_UTE.source, 'i').test(nombre);
}

// Separadores entre miembros: guion, barra, punto y coma o «+» con espacios; o «y», «e», «&» y
// coma justo después de una forma jurídica («X, S.L. y Z, S.A.»). Un «y» dentro de un nombre
// («Construcciones y Contratas») no separa.
const SEPARADOR = /\s+[-–/;+]\s+|\s*[/;+]\s*|(?<=\bs\.?\s?[la]\.?(?:\s?u\.?)?)\s*(?:,\s*|\s+(?:y|e|&)\s+)(?=\S)/i;

/** Nombres de los miembros de una UTE tal como los publica el órgano; [] si no se separan en dos o más. */
export function miembrosUte(nombre: string): string[] {
  const sinMarca = nombre
    .replace(MARCA_UTE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.\-:]+|[\s,\-:]+$/g, '');
  const partes = sinMarca
    .split(SEPARADOR)
    .map((p) => p.trim().replace(/^[\s,.\-:]+|[\s,\-:]+$/g, ''))
    .filter((p) => nombreCanonico(p).length >= 3);
  return partes.length >= 2 ? partes : [];
}

const PROVINCIAS: Record<string, string> = {
  '01': 'Araba/Álava',
  '02': 'Albacete',
  '03': 'Alicante',
  '04': 'Almería',
  '05': 'Ávila',
  '06': 'Badajoz',
  '07': 'Illes Balears',
  '08': 'Barcelona',
  '09': 'Burgos',
  '10': 'Cáceres',
  '11': 'Cádiz',
  '12': 'Castellón',
  '13': 'Ciudad Real',
  '14': 'Córdoba',
  '15': 'A Coruña',
  '16': 'Cuenca',
  '17': 'Girona',
  '18': 'Granada',
  '19': 'Guadalajara',
  '20': 'Gipuzkoa',
  '21': 'Huelva',
  '22': 'Huesca',
  '23': 'Jaén',
  '24': 'León',
  '25': 'Lleida',
  '26': 'La Rioja',
  '27': 'Lugo',
  '28': 'Madrid',
  '29': 'Málaga',
  '30': 'Murcia',
  '31': 'Navarra',
  '32': 'Ourense',
  '33': 'Asturias',
  '34': 'Palencia',
  '35': 'Las Palmas',
  '36': 'Pontevedra',
  '37': 'Salamanca',
  '38': 'Santa Cruz de Tenerife',
  '39': 'Cantabria',
  '40': 'Segovia',
  '41': 'Sevilla',
  '42': 'Soria',
  '43': 'Tarragona',
  '44': 'Teruel',
  '45': 'Toledo',
  '46': 'Valencia',
  '47': 'Valladolid',
  '48': 'Bizkaia',
  '49': 'Zamora',
  '50': 'Zaragoza',
  '51': 'Ceuta',
  '52': 'Melilla',
};

/** Provincia por las dos primeras cifras del código postal español; null si no lo es. */
export function provinciaDeCp(cp: string | null | undefined): string | null {
  const m = /^\s*(\d{2})\d{3}\s*$/.exec(cp ?? '');
  return m ? (PROVINCIAS[m[1]!] ?? null) : null;
}
