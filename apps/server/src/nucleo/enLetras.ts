// Importes en letras, como los piden los modelos de proposición económica («setenta y dos
// euros con cincuenta céntimos»). Hasta 999.999.999,99 €.

const UNIDADES = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

function hastaCien(n: number): string {
  if (n < 30) return UNIDADES[n]!;
  const u = n % 10;
  return `${DECENAS[Math.floor(n / 10)]}${u ? ` y ${UNIDADES[u]}` : ''}`;
}

function hastaMil(n: number): string {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  return [c ? CENTENAS[c] : '', resto ? hastaCien(resto) : ''].filter(Boolean).join(' ');
}

// «uno» delante de un sustantivo: «un», «veintiún», «treinta y un».
const apocope = (t: string) => t.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

/** Un entero (0 a 999.999.999) en letras: «mil doscientos treinta y cuatro». */
export function enteroEnLetras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) return String(n);
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  return [
    millones ? (millones === 1 ? 'un millón' : `${apocope(hastaMil(millones))} millones`) : '',
    miles ? (miles === 1 ? 'mil' : `${apocope(hastaMil(miles))} mil`) : '',
    resto ? hastaMil(resto) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Un importe en euros en letras: «setenta y dos euros con cincuenta céntimos». */
export function eurosEnLetras(importe: number): string {
  const centimos = Math.round(importe * 100);
  const euros = Math.floor(centimos / 100);
  const cent = centimos % 100;
  const parteEuros = `${apocope(enteroEnLetras(euros))} ${euros === 1 ? 'euro' : 'euros'}`;
  return cent
    ? `${parteEuros} con ${apocope(enteroEnLetras(cent))} ${cent === 1 ? 'céntimo' : 'céntimos'}`
    : parteEuros;
}
