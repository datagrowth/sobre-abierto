// Perfiles genéricos para los fixtures: el nombre seudonimizado no basta, porque el rol («CEO y
// cofundadora»), las titulaciones, las certificaciones concretas, los años y los sectores de una
// plantilla pequeña reidentifican a cada persona. Se dejan solo los rasgos que leen las reglas y las
// pruebas (nivel y rama de la titulación, certificaciones reconocibles —PMP, Azure…—, si hay algo de
// IA, el idioma, el sector por familia y los años por tramos) y el resto pasa a texto genérico.
// Lo usa generalizarFixtures.mjs sobre los fixtures ya escritos.

const normal = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const IA = /\b(?:ia|ai|inteligencia artificial|artificial intelligence|machine learning|deep learning|aprendizaje profundo|copilot)\b/;

// Mismas ramas que nucleo/colaboradores/requisito.ts (CAMPOS) y las que miran las reglas de medios.
const RAMAS = [
  ['informática', /informatic|computacion|sistemas de informacion|software|tecnologias de la informacion|programacion/],
  ['telecomunicaciones', /telecomunicacion/],
  ['matemáticas', /matematic/],
  ['estadística', /estadistic/],
  ['física', /\bfisica/],
  ['economía y empresa', /\beconomia\b|economicas|empresariales|direccion de empresas|administracion de empresas|\bade\b|finanzas|contabilidad/],
  ['ciencia de datos', /ciencia de datos|data science|big data|analisis (?:avanzado )?de datos|data analytics|data engineering/],
  ['inteligencia artificial', IA],
  ['marketing y comunicación', /marketing|publicidad|relaciones publicas|comunicacion/],
  ['educación', /educacion|profesorado|pedagog|magisterio|docen/],
  ['ciencias de la salud', /salud|biologia|medicina/],
  ['gestión de proyectos', /project management|gestion de proyectos/],
];

const NIVELES = [
  ['Doctorado', /\bdoctor(?:ado|a)?\b|\bphd\b/],
  ['Máster', /\bmaster\b|\bmba\b/],
  ['Grado', /\bgrado\b|licencia(?:do|da|tura)|ingenieri|diplomad|universitari|bachelor/],
  ['Ciclo de formación profesional', /formacion profesional|ciclo formativo|tecnico superior|\bfp\b|\bcfgs\b/],
];

const ramasDe = (n) => RAMAS.filter(([, re]) => re.test(n)).map(([rama]) => rama);
const conRamas = (base, ramas) => (ramas.length ? `${base} en ${ramas.join(' y ')}` : `${base} de área general`);

export function titulacionGenerica(t) {
  const n = normal(t);
  const nivel = NIVELES.find(([, re]) => re.test(n))?.[0] ?? 'Curso';
  return conRamas(nivel, ramasDe(n));
}

// Las que reconoce el código (nucleo/colaboradores/requisito.ts) se quedan por su nombre.
const CERTIFICACIONES = [
  ['PMP', /\bpmp\b|project management professional/], ['PRINCE2', /\bprince ?2\b/], ['ITIL', /\bitil\b/],
  ['Scrum', /\b(?:psm|csm|pspo|cspo|scrum master|product owner)\b/], ['ISO 27001', /27001/],
  ['AWS', /\baws\b|amazon web services/], ['Azure', /\bazure\b/], ['Google Cloud', /\bgcp\b|google cloud/],
];
const INGLES = /\bingles\b|\benglish\b|first certificate|\bfce\b|cambridge|\b[bc][12]\b/;

export function certificacionGenerica(t) {
  const n = normal(t);
  const ia = IA.test(n) ? ' de inteligencia artificial (IA)' : '';
  const conocida = CERTIFICACIONES.find(([, re]) => re.test(n))?.[0];
  if (conocida) return `Certificación ${conocida}${ia}`;
  if (INGLES.test(n)) return `Certificado de inglés${/\bc1\b/.test(n) ? ' C1' : /\bb2\b|first|fce/.test(n) ? ' B2' : ''}`;
  if (ia) return `Curso${ia}`;
  const ramas = ramasDe(n).filter((r) => r !== 'inteligencia artificial');
  return ramas.length ? `Curso de ${ramas.join(' y ')}` : 'Curso de formación';
}

// Cada genérico casa también consigo mismo: pasarlo otra vez no lo cambia.
const ROLES = [
  ['Dirección', /\bceo\b|\bcto\b|director|direccion|gerente|co-?founder|cofundador|socio|\blead\b/],
  ['Ciencia de datos', /data scientist|cientific[oa] de datos|ciencia de datos|data science/],
  ['Análisis de datos', /\bbi\b|business intelligence|analista|analyst|analytics|analisis de datos/],
  ['Ingeniería de datos', /data engineer|ingenier|engineer|desarroll|developer|programador/],
  ['Inteligencia artificial', IA],
  ['Marketing digital', /marketing|social media|publicidad/],
  ['Formación', /formador|formacion|docente|profesor|tutor/],
  ['Consultoría', /consultor/],
  ['Coordinación de proyectos', /jefe de proyecto|project manager|coordinador|coordinacion/],
];

export function rolGenerico(t) {
  const n = normal(t);
  const roles = ROLES.filter(([, re]) => re.test(n)).map(([r]) => r);
  return roles.length ? roles.join('; ') : 'Perfil técnico';
}

// Solo los sectores de clientes (los que dicen dónde trabajó): las materias que piden los pliegos
// (transformación digital, marketing digital, datos, IA, educación…) se quedan, que las reglas de
// medios las buscan.
const FAMILIAS = [
  ['servicios financieros', /banca|seguros|finanz/],
  ['comercio y turismo', /retail|moda|hoteleria|hosteleria|turismo|comercio/],
  ['salud', /farmac/],
  ['industria y logística', /automocion|cadena de suministro|logistic|industria/],
  ['empresas tecnológicas', /smart city|startups/],
];

export function sectorGenerico(t) {
  const n = normal(t);
  return FAMILIAS.find(([, re]) => re.test(n))?.[0] ?? t;
}

// Herramientas de uso común: las demás, por su rareza, dicen quién es.
const TECNOLOGIAS_COMUNES = /^(?:python|r|sql|sas|power bi|tableau|excel|azure|aws|amazon web services \(aws\)|google cloud|azure databricks|snowflake|apache spark|big data|machine learning|deep learning|aprendizaje profundo|data science|data analytics|data engineering|business intelligence|inteligencia artificial|analisis de datos|bases de datos|estadistica aplicada|cuadros de mando|kpis|etl|nlp|seo|crm|google analytics|github|javascript|html|css|mongodb|visualizacion de datos)$/;

export const tecnologiasComunes = (xs) => (xs ?? []).filter((x) => TECNOLOGIAS_COMUNES.test(normal(x)));

// Por tramos: los umbrales de los pliegos (2, 3, 5, 8, 10 años) dan lo mismo y el número exacto no sale.
export function aniosPorTramo(n) {
  if (typeof n !== 'number') return n;
  return [15, 10, 8, 5, 3, 2, 1].find((t) => n >= t) ?? 0;
}

const unicos = (xs) => [...new Set(xs)];

/** La persona de un fixture con el perfil genérico (nombre, ids, tipo, disponibilidad e idiomas, tal cual). */
export function personaGenerica(p) {
  return {
    ...p,
    rol: typeof p.rol === 'string' ? rolGenerico(p.rol) : p.rol,
    titulaciones: unicos((p.titulaciones ?? []).map(titulacionGenerica)),
    certificaciones: unicos((p.certificaciones ?? []).map(certificacionGenerica)),
    anios_experiencia: aniosPorTramo(p.anios_experiencia),
    sectores: unicos((p.sectores ?? []).map(sectorGenerico)),
    tecnologias: tecnologiasComunes(p.tecnologias),
  };
}

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lo que sustituye, en los textos libres (motivos, memorias, propuestas), cada valor concreto de
 * esas personas por el genérico: de los más largos a los más cortos, y los identificadores sueltos.
 */
// Una titulación también se cita sin lo que va entre paréntesis («cursó Data Engineering en…») o
// por su área sola si esta es propia («Liderazgo Emprendedor e Innovación»): un área de una o dos
// palabras («Marketing Digital», «Transformación Digital») es una materia y se queda.
function paresDeTitulacion(t) {
  const sinParentesis = t.replace(/\s*\([^)]*\)/g, '').trim();
  const area = / en (.+)$/i.exec(sinParentesis)?.[1];
  const propia = area && area.split(/\s+/).length >= 3;
  return [
    [t, titulacionGenerica(t)], [sinParentesis, titulacionGenerica(sinParentesis)],
    ...(propia ? [[area, ramasDe(normal(area)).join(' y ') || 'su área']] : []),
  ];
}

// Ya pasada a genérico (otra vuelta del script): no aporta nada que sustituir.
const yaGenerica = (p) => (p.titulaciones ?? []).every((t) => t === titulacionGenerica(t)) && (typeof p.rol !== 'string' || p.rol === rolGenerico(p.rol));

export function sustitucionesDeTexto(personas) {
  const pares = personas.filter((p) => !yaGenerica(p)).flatMap((p) => [
    ...(typeof p.rol === 'string' ? [[p.rol, rolGenerico(p.rol)], ...p.rol.split(/\s*[;/]\s*/).map((r) => [r, rolGenerico(r)])] : []),
    ...(p.titulaciones ?? []).flatMap(paresDeTitulacion),
    ...(p.certificaciones ?? []).map((c) => [c, certificacionGenerica(c)]),
  // Solo lo que cambia de verdad: cambiar «Inteligencia Artificial» por «inteligencia artificial»
  // no tapa a nadie y estropearía las citas literales de los pliegos.
  ]).filter(([a, b]) => a.length >= 4 && normal(a) !== normal(b));
  const sueltos = [
    [/\b(?:AZ|AI|DP|AB|PL|MS)-9\d\d\b/g, 'certificación Azure'], [/\bCEO\b/g, 'dirección'],
    [/\bco-?fundador(a)?\b/gi, 'responsable'], [/\bCo-Founder\b/g, 'responsable'], [/\bCTO\b/g, 'dirección técnica'],
  ];
  const porLargo = unicos(pares.map(([a]) => a)).sort((a, b) => b.length - a.length);
  const mapa = new Map(pares.map(([a, b]) => [a.toLowerCase(), b]));
  return [...porLargo.map((a) => [new RegExp(`(?<![\\p{L}\\d])${escapar(a)}(?![\\p{L}\\d])`, 'giu'), mapa.get(a.toLowerCase())]), ...sueltos];
}

export const generalizarTexto = (t, sustituciones) => sustituciones.reduce((s, [re, por]) => s.replace(re, por), t);

// ── Empresa, órganos y lugares ──

// Con el título y el importe, el nombre de la empresa, la sede del órgano o el lugar de ejecución
// bastan para encontrar el contrato. La empresa pasa a la ficticia de los tests
// (tests/fixtures/empresaEjemplo.ts); las ciudades y las islas, a Villaejemplo o a la región (la
// usan los festivos y el IGIC); el caso («CASO_B»), a su papel. Los nombres reales de órganos y
// clientes no se escriben aquí: el fixture llega con el identificador del caso.
const LUGARES = [
  [/\bdata ?growth\b/gi, (m) => (m === m.toUpperCase() ? 'ANALÍTICA EJEMPLO' : 'Analítica Ejemplo')],
  [/\b(?:Las Palmas de Gran Canaria|Santa Cruz de Tenerife|Santa Cruz de La Palma)\b/g, 'Villaejemplo (Canarias)'],
  [/\b(?:Gran Canaria|Las Palmas|Tenerife|Lanzarote|Fuerteventura|La Gomera|El Hierro|La Palma)\b/g, 'Canarias'],
  [/(^|[.:;]\s+|\n)CASO_[A-G]\b/g, '$1El órgano'], [/\bde CASO_[A-G]\b/g, 'del órgano'], [/\ba CASO_[A-G]\b/g, 'al órgano'], [/\bCASO_[A-G]\b/g, 'el órgano'],
];

/** El texto sin la empresa real, la sede ni los lugares que delatan el contrato (idempotente). */
export const generalizarLugares = (t) => LUGARES.reduce((s, [re, por]) => s.replace(re, por), t);

// ── Recorrido de un fixture entero ──

const esObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const esPersona = (v) => esObjeto(v) && ('titulaciones' in v || 'anios_experiencia' in v);
// Una persona tal como sale en otras respuestas (candidatos, equipo): con su seudónimo.
const esSeudonimo = (v) => esObjeto(v) && typeof v.nombre === 'string' && /^Persona [A-Z]$/.test(v.nombre);
// Una cita es literal del pliego: nunca se toca.
const esCita = (v) => esObjeto(v) && 'documento' in v && 'texto' in v;

export function personasDe(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => personasDe(x, out));
  else if (esObjeto(v)) {
    if (esPersona(v)) out.push(v);
    Object.values(v).forEach((x) => personasDe(x, out));
  }
  return out;
}

// Los textos que hablan de una persona: dentro de su ficha o de su fila de candidato, los porqués
// de quién va en el equipo, los que la nombran («Persona F») y los de la memoria y las evidencias
// (no las citas, que son literales del pliego).
const SOBRE_PERSONAS = new Set(['motivo', 'motivo_hermes', 'texto', 'evidencia']);
const YA_GENERICOS = new Set(['rol', 'titulaciones', 'certificaciones', 'sectores', 'tecnologias']);
const ANIOS = /\b(\d+) años de experiencia/g;

function texto(t, sust, ctx) {
  if (ctx.cita || !(ctx.persona || SOBRE_PERSONAS.has(ctx.clave) || /\bPersona [A-Z]\b/.test(t))) return t;
  const generico = generalizarTexto(t, sust);
  return ctx.persona ? generico.replace(ANIOS, (_, n) => `${aniosPorTramo(Number(n))} años de experiencia`) : generico;
}

function generalizar(v, sust, ctx) {
  if (typeof v === 'string') return texto(generalizarLugares(v), sust, ctx);
  if (Array.isArray(v)) return v.map((x) => generalizar(x, sust, ctx));
  if (!esObjeto(v)) return v;
  const persona = ctx.persona || esPersona(v) || esSeudonimo(v);
  const cita = ctx.cita || esCita(v);
  const base = esPersona(v) ? personaGenerica(v) : esSeudonimo(v) && typeof v.rol === 'string' ? { ...v, rol: rolGenerico(v.rol) } : v;
  // Lo que ya es genérico (el perfil) no se vuelve a sustituir.
  const hecho = (k) => (esPersona(v) || esSeudonimo(v)) && YA_GENERICOS.has(k);
  return Object.fromEntries(Object.entries(base).map(([k, x]) => [k, hecho(k) ? x : generalizar(x, sust, { clave: k, persona, cita })]));
}

/** El fixture con las personas genéricas, sus textos sin lo concreto de su perfil (sust: sustitucionesDeTexto) y sin lugares. */
export const generalizarDatos = (v, sust) => generalizar(v, sust, { clave: '', persona: false, cita: false });
