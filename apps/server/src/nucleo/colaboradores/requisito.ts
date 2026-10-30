// Lectura determinista de un requisito de medios personales escrito en un pliego, sin IA.
import { materiaDe, materiasExigidas, normalizarMateria, type Materia } from './materias.js';
import { normalizar } from './texto.js';

// Ejemplo: «Jefe de proyecto con titulación universitaria en informática, 5 años de experiencia, PMP e inglés
// B2». Extrae qué se puede comprobar contra un perfil.
export type NivelIdioma = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'nativo';

export type RequisitoAnalizado = {
  anios_minimos: number | null;
  titulacion: { nivel: number; nombre: string; campos: string[] } | null;
  certificaciones: string[];
  idiomas: { idioma: string; nivel: NivelIdioma | null }[];
  // La materia o el ámbito concreto que pide («monitorización de medios»): los años no la acreditan.
  materias: Materia[];
  docencia: DocenciaExigida | null;
};

// Horas impartidas que pide el pliego, en una materia (null: cualquiera) y en los últimos `anios` (null: en toda la carrera).
export type DocenciaExigida = { horas: number; materia: Materia | null; anios: number | null };

// Del más alto al más bajo: un doctorado acredita un máster y un grado.
const NIVELES_TITULACION = [
  { nivel: 4, nombre: 'doctorado', re: /\bdoctor(ado|a)?\b|\bphd\b/ },
  { nivel: 3, nombre: 'máster', re: /\bmaster\b|\bmba\b/ },
  {
    nivel: 2,
    nombre: 'titulación universitaria',
    re: /\bgrado\b|licencia(do|da|tura)|ingenier|diplomad|universitari|titulad[oa] (superior|medio)|arquitect/,
  },
  {
    nivel: 1,
    nombre: 'formación profesional',
    re: /formacion profesional|ciclo formativo|tecnico superior|\bfp\b|\bcfgs\b/,
  },
] as const;

// Ramas que suelen exigir los pliegos de datos y TI; se comparan con las titulaciones.
const CAMPOS: { campo: string; re: RegExp }[] = [
  { campo: 'informática', re: /informatic|computacion|sistemas de informacion|software/ },
  { campo: 'telecomunicaciones', re: /telecomunicacion/ },
  { campo: 'matemáticas', re: /matematic/ },
  { campo: 'estadística', re: /estadistic/ },
  { campo: 'física', re: /\bfisica/ },
  // Ni «empresa» ni «económica» a secas: en los pliegos son «la empresa adjudicataria»
  // o «solvencia económica», no una titulación.
  {
    campo: 'economía o empresa',
    re: /\beconomia\b|economicas|economista|empresariales|direccion de empresas|\bade\b|finanzas/,
  },
  { campo: 'ingeniería industrial', re: /industrial/ },
  // «derecho» solo como carrera («grado en Derecho»): «tendrá derecho a» es otra cosa.
  { campo: 'derecho', re: /\b(en|de|grado|licenciatura) derecho\b|\bderecho y\b|juridic/ },
  { campo: 'ciencia de datos', re: /ciencia de datos|data science|big data|inteligencia artificial/ },
];

// Certificaciones de personas habituales en pliegos de TI. `suelta` es lo que basta para
// contarla aunque el requisito no hable de certificados (por defecto, `re`): «AWS» o un
// puesto «Product Owner» sin más son tecnología o rol, no exigen el certificado.
export const CERTIFICACIONES: { nombre: string; re: RegExp; suelta?: RegExp | null }[] = [
  { nombre: 'PMP', re: /\bpmp\b|project management professional/ },
  { nombre: 'PRINCE2', re: /\bprince ?2\b/ },
  { nombre: 'ITIL', re: /\bitil\b/ },
  { nombre: 'Scrum', re: /\b(psm|csm|pspo|cspo|scrum master|product owner)\b/, suelta: /\b(psm|csm|pspo|cspo)\b/ },
  { nombre: 'SAFe', re: /\bsafe (agilist|practitioner|scrum)/ },
  { nombre: 'CISA', re: /\bcisa\b/ },
  { nombre: 'CISM', re: /\bcism\b/ },
  { nombre: 'CISSP', re: /\bcissp\b/ },
  { nombre: 'CEH', re: /\bceh\b/ },
  { nombre: 'TOGAF', re: /\btogaf\b/ },
  { nombre: 'COBIT', re: /\bcobit\b/ },
  { nombre: 'ISO 27001', re: /27001/ },
  { nombre: 'AWS', re: /\baws\b|amazon web services/, suelta: null },
  { nombre: 'Azure', re: /\bazure\b/, suelta: null },
  { nombre: 'Google Cloud', re: /\bgcp\b|google cloud/, suelta: null },
];

// `gentilicio`: la palabra también nombra instituciones («Gobierno Vasco», «Servicio
// Gallego de Salud»); solo cuenta como idioma con un nivel o hablando de idiomas.
const IDIOMAS: { idioma: string; re: RegExp; gentilicio?: RegExp }[] = [
  { idioma: 'inglés', re: /\bingles\b/ },
  { idioma: 'francés', re: /\bfrances\b/ },
  { idioma: 'alemán', re: /\baleman\b/ },
  { idioma: 'italiano', re: /\bitaliano\b/ },
  { idioma: 'portugués', re: /\bportugues\b/ },
  { idioma: 'catalán', re: /\bcatala\b/, gentilicio: /\bcatalan\b|\bvalenciano\b/ },
  { idioma: 'euskera', re: /\beuskera\b|\beuskara\b/, gentilicio: /\bvasco\b/ },
  { idioma: 'gallego', re: /\bgalego\b/, gentilicio: /\bgallego\b/ },
];
const HABLA_DE_IDIOMAS = /idioma|lengua|conocimientos? (de|del)|dominio (de|del)|nivel/;

const ORDEN_NIVEL: NivelIdioma[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'nativo'];
// Distancia máxima (caracteres) entre el idioma y su nivel: «inglés (nivel B2)».
const CERCA = 40;

export function rangoNivel(nivel: NivelIdioma): number {
  return ORDEN_NIVEL.indexOf(nivel);
}

/** El idioma de una lista conocida al que se refiere un texto («Inglés», «valenciano»…). */
export function idiomaDe(texto: string): string | null {
  const t = normalizar(texto);
  return IDIOMAS.find((i) => i.re.test(t) || i.gentilicio?.test(t))?.idioma ?? null;
}

// «nivel C1 de inglés», «B2 en francés»: el nivel justo delante del idioma.
const NIVEL_ANTES = /\b([abc][12]|nativo|bilingue)\s+(de|en)\s+((idioma|lengua)\s+)?$/;
// «vasco (B2)», «valenciano nativo»: el nivel pegado detrás.
const NIVEL_TRAS = /^[\s(:,-]*(nivel\s+)?([abc][12]|nativo|bilingue)\b/;

function aNivel(s: string): NivelIdioma {
  return s === 'nativo' || s === 'bilingue' ? 'nativo' : (s.toUpperCase() as NivelIdioma);
}

/** Nivel del marco europeo (o nativo/bilingüe) justo antes o cerca después de una posición. */
function nivelCerca(t: string, desde: number): NivelIdioma | null {
  const antes = NIVEL_ANTES.exec(t.slice(Math.max(0, desde - 25), desde));
  if (antes) return aNivel(antes[1]!);
  const trozo = t.slice(desde, desde + CERCA);
  if (/nativo|bilingue|lengua materna/.test(trozo)) return 'nativo';
  const m = /\b([abc][12])\b/.exec(trozo);
  return m ? aNivel(m[1]!) : null;
}

function esIdioma(t: string, inicio: number, largo: number): boolean {
  const antes = t.slice(Math.max(0, inicio - 30), inicio);
  return HABLA_DE_IDIOMAS.test(antes) || NIVEL_ANTES.test(antes) || NIVEL_TRAS.test(t.slice(inicio + largo));
}

/** Posición en la que el texto pide un idioma, o null. */
function mencion(t: string, i: (typeof IDIOMAS)[number]): number | null {
  const m = i.re.exec(t);
  if (m) return m.index;
  if (!i.gentilicio) return null;
  const g = [...t.matchAll(new RegExp(i.gentilicio.source, 'g'))].find((x) => esIdioma(t, x.index, x[0].length));
  return g ? g.index : null;
}

function idiomas(t: string): RequisitoAnalizado['idiomas'] {
  return IDIOMAS.flatMap((i) => {
    const desde = mencion(t, i);
    return desde === null ? [] : [{ idioma: i.idioma, nivel: nivelCerca(t, desde) }];
  });
}

// «3-5 años», «de 3 a 5 años»: cuenta el límite inferior.
const ANIOS = /(\d{1,2})(?:\s*(?:-|a|y)\s*\d{1,2})?\s*\+?\s*anos?\b/g;
// Plazos que no son experiencia: «en los últimos 10 años», «duración del contrato: 2 años».
const PLAZO_ANTES = /\b(ultim[oa]s|durante|duracion|plazo|periodo|vigencia|prorroga|hace)\b[^.;]{0,20}$/;

// Años mínimos de experiencia: solo si el requisito habla de experiencia, porque «2 años»
// suele ser la duración del contrato. De las cifras que no son plazos, la mayor de las
// que van junto a «experiencia» (o de todas, si ninguna va junto).
function aniosMinimos(t: string): number | null {
  if (!/experiencia/.test(t)) return null;
  const menciones = [...t.matchAll(ANIOS)]
    .filter((m) => !PLAZO_ANTES.test(t.slice(Math.max(0, m.index - 30), m.index)))
    .map((m) => ({
      n: Number(m[1]),
      junto: /experiencia/.test(t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20)),
    }))
    .filter((x) => x.n > 0 && x.n <= 40);
  const elegidas = menciones.some((x) => x.junto) ? menciones.filter((x) => x.junto) : menciones;
  return elegidas.length ? Math.max(...elegidas.map((x) => x.n)) : null;
}

/** Nivel académico más alto que menciona un texto, o null. */
export function nivelTitulacion(texto: string): { nivel: number; nombre: string } | null {
  const t = normalizar(texto);
  const n = NIVELES_TITULACION.find((x) => x.re.test(t));
  return n ? { nivel: n.nivel, nombre: n.nombre } : null;
}

export function camposDe(texto: string): string[] {
  const t = normalizar(texto);
  return CAMPOS.filter((c) => c.re.test(t)).map((c) => c.campo);
}

// La titulación exigida es la más baja que se acepta («grado o máster» → grado).
function titulacion(t: string): RequisitoAnalizado['titulacion'] {
  const niveles = NIVELES_TITULACION.filter((x) => x.re.test(t));
  const minimo = niveles.at(-1);
  return minimo ? { nivel: minimo.nivel, nombre: minimo.nombre, campos: camposDe(t) } : null;
}

function certificacionesDe(texto: string, todas = false): string[] {
  const t = normalizar(texto);
  const hablaDeCertificados = todas || /certific/.test(t);
  return CERTIFICACIONES.filter((c) => (hablaDeCertificados || c.suelta === undefined ? c.re : c.suelta)?.test(t)).map(
    (c) => c.nombre,
  );
}

// «150 h impartidas», «200 horas de docencia», «haber impartido un mínimo de 100 horas»: las horas y
// dónde acaba la frase que las pide, para leer detrás la materia.
const HORAS = String.raw`(\d{1,3}(?:\.\d{3})+|\d{1,6}) ?(?:horas|h)\b\.?`;
const HORAS_DOCENCIA = [
  new RegExp(
    String.raw`${HORAS} (?:lectivas )?(?:impartid[ao]s|de docencia|docentes|de experiencia docente|de formacion impartidas?)\b`,
    'i',
  ),
  new RegExp(
    String.raw`\b(?:impartido|docencia|experiencia docente)\b[^.;]{0,40}?${HORAS}(?: de (?:formacion|docencia))?(?: impartid[ao]s)?`,
    'i',
  ),
];
const MATERIA_TRAS =
  /^ (?:en|de|sobre) (?:(?:la )?materia de |el ambito de |la especialidad de )?(.+?)(?= en (?:los|el) | durante | dentro | desde |[.;:()]|, | y (?:con|titulacion|una|un)\b|$)/i;
const NUMEROS: Record<string, number> = {
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};
const PERIODO =
  /\bultimos (\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) anos\b|\b(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) ultimos anos\b/;

const aNumero = (s: string): number => NUMEROS[s] ?? Number(s);

/** Lo que pide un requisito de horas impartidas, o null si no las pide. */
export function docenciaExigida(texto: string): DocenciaExigida | null {
  const t = normalizarMateria(texto);
  const m = HORAS_DOCENCIA.map((re) => re.exec(t)).find((x) => x !== null);
  if (!m) return null;
  const horas = Number(m[1]!.replace(/\./g, ''));
  if (!horas) return null;
  const cola = MATERIA_TRAS.exec(t.slice(m.index + m[0].length))?.[1]?.trim() ?? '';
  const materia = cola ? materiaDe(cola) : null;
  const periodo = PERIODO.exec(normalizar(texto));
  return {
    horas,
    materia: materia?.alternativas.length ? materia : null,
    anios: periodo ? aNumero(periodo[1] ?? periodo[2]!) : null,
  };
}

export function analizarRequisito(texto: string): RequisitoAnalizado {
  const t = normalizar(texto);
  return {
    anios_minimos: aniosMinimos(t),
    titulacion: titulacion(t),
    certificaciones: certificacionesDe(t),
    idiomas: idiomas(t),
    materias: materiasExigidas(texto),
    docencia: docenciaExigida(texto),
  };
}
