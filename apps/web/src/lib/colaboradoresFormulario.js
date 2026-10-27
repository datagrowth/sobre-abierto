// Colaborador ⇄ formulario de la pestaña Colaboradores y textos del matching (sin
// React, con tests). El servidor vuelve a validarlo todo; aquí solo se convierten
// textos y se avisa pronto de lo que no tiene forma.
import { lista, numeroONulo } from './formato.js';
import { diferencias } from './propuestaIa.js';

export const TIPOS = { interno: 'Equipo', externo: 'Externo' };
// La disponibilidad no se declara: la calcula el servidor con las ofertas y los contratos de cada persona.
export const DISPONIBILIDADES = { disponible: 'Disponible', parcial: 'Parcial', no_disponible: 'No disponible' };

/** Una entrada por línea: las titulaciones llevan comas («Grado en X, mención en Y»). */
export function lineas(texto) {
  return String(texto ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** [{idioma:'Inglés', nivel:'C1'}] → «Inglés C1». */
export function idiomasATexto(idiomas = []) {
  return idiomas.map((i) => (i.nivel ? `${i.idioma} ${i.nivel}` : i.idioma)).join(', ');
}

const CON_NIVEL = /^(.+?)\s+(a1|a2|b1|b2|c1|c2|nativo|nativa)$/i;

/** «Inglés C1, francés, alemán nativo» → idiomas; sin nivel reconocible, nivel null. */
export function idiomasDesdeTexto(texto) {
  return lista(texto).map((trozo) => {
    const m = CON_NIVEL.exec(trozo);
    if (!m) return { idioma: trozo, nivel: null };
    const nivel = m[2].toLowerCase().startsWith('nativ') ? 'nativo' : m[2].toUpperCase();
    return { idioma: m[1].trim(), nivel };
  });
}

const texto = (n) => (n === null || n === undefined ? '' : String(n));

const periodo = (d) =>
  d.desde && d.hasta && d.desde !== d.hasta ? `${d.desde}-${d.hasta}` : texto(d.hasta ?? d.desde);

/** {materia:'IA', horas:160, desde:2024, hasta:2026, evidencia:'CV, pág. 3'} → «IA · 160 h · 2024-2026 · CV, pág. 3». */
export function docenciaATexto(d) {
  return [d.materia, `${d.horas} h`, periodo(d), d.evidencia ?? ''].filter(Boolean).join(' · ');
}

const HORAS = /^(\d{1,6})\s*(?:h|horas)\.?$/i;
const ANIOS = /^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/;

/** Una línea por materia: «IA · 160 h · 2024-2026 · CV, pág. 3». Las líneas sin horas son errores. */
export function docenciaDesdeTexto(textoLibre) {
  const errores = [];
  const docencia = lineas(textoLibre).flatMap((linea) => {
    const [materia, ...resto] = linea.split('·').map((x) => x.trim());
    const horas = resto.map((x) => HORAS.exec(x)).find(Boolean);
    if (!materia || !horas) {
      errores.push(`Docencia «${linea}»: escribe la materia y las horas, «IA · 160 h · 2024-2026».`);
      return [];
    }
    const anios = resto.map((x) => ANIOS.exec(x)).find(Boolean);
    const evidencia = resto.filter((x) => !HORAS.test(x) && !ANIOS.test(x)).join(' · ') || null;
    const desde = anios ? Number(anios[1]) : null;
    return [{ materia, horas: Number(horas[1]), desde, hasta: anios ? Number(anios[2] ?? anios[1]) : null, evidencia }];
  });
  return { docencia, errores };
}

/** «IA 160 h · Power BI 180 h»: lo que se enseña en la lista de Equipo. */
export function resumenDocencia(docencia = []) {
  return docencia.map((d) => `${d.materia} ${d.horas} h`).join(' · ');
}

// Igual que el servidor: https://www.linkedin.com/in/<id>, se pegue como se pegue.
const PERFIL_LINKEDIN = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

/** «es.linkedin.com/in/ana-perez/?trk=x» → «https://www.linkedin.com/in/ana-perez»; null si no es un perfil. */
export function normalizarLinkedin(url) {
  const id = PERFIL_LINKEDIN.exec(String(url ?? '').trim())?.[1];
  return id && /^[A-Za-z0-9\-_%]{2,100}$/.test(id) ? `https://www.linkedin.com/in/${id}` : null;
}

export function personaAFormulario(p) {
  return {
    nombre: p?.nombre ?? '',
    tipo: p?.tipo ?? 'interno',
    rol: p?.rol ?? '',
    titulaciones: (p?.titulaciones ?? []).join('\n'),
    certificaciones: (p?.certificaciones ?? []).join(', '),
    anios_experiencia: texto(p?.anios_experiencia),
    sectores: (p?.sectores ?? []).join(', '),
    cpv: (p?.cpv ?? []).join(', '),
    tecnologias: (p?.tecnologias ?? []).join(', '),
    idiomas: idiomasATexto(p?.idiomas),
    docencia: (p?.docencia ?? []).map(docenciaATexto).join('\n'),
    tarifa_hora: texto(p?.tarifa_hora),
    cv_ruta: p?.cv_ruta ?? '',
    notas: p?.notas ?? '',
    activo: p?.activo ?? true,
    linkedin: p?.linkedin ?? '',
  };
}

function numero(valor, etiqueta, errores, entero = false) {
  const n = numeroONulo(valor);
  if (Number.isNaN(n) || (entero && n !== null && !Number.isInteger(n)))
    errores.push(`${etiqueta}: escribe un número${entero ? ' entero' : ''}.`);
  return Number.isNaN(n) ? null : n;
}

/** Formulario → colaborador para el servidor, con los errores de forma que se ven antes de enviar. */
export function formularioAPersona(f) {
  const errores = [];
  if (f.nombre.trim().length < 2) errores.push('Nombre: escribe al menos dos letras.');
  const cpv = lista(f.cpv);
  const malos = cpv.filter((c) => !/^\d{2,8}$/.test(c));
  if (malos.length) errores.push(`CPV ${malos.join(', ')}: de 2 a 8 cifras.`);
  const linkedin = f.linkedin.trim() ? normalizarLinkedin(f.linkedin) : null;
  if (f.linkedin.trim() && !linkedin) errores.push('LinkedIn: pega la dirección del perfil, linkedin.com/in/…');
  const docencia = docenciaDesdeTexto(f.docencia);
  errores.push(...docencia.errores);
  const persona = {
    nombre: f.nombre.trim(),
    tipo: f.tipo,
    rol: f.rol.trim(),
    titulaciones: lineas(f.titulaciones),
    certificaciones: lista(f.certificaciones),
    anios_experiencia: numero(f.anios_experiencia, 'Años de experiencia', errores, true),
    sectores: lista(f.sectores),
    cpv,
    tecnologias: lista(f.tecnologias),
    idiomas: idiomasDesdeTexto(f.idiomas),
    docencia: docencia.docencia,
    tarifa_hora: numero(f.tarifa_hora, 'Tarifa', errores),
    cv_ruta: f.cv_ruta.trim() || null,
    notas: f.notas,
    activo: Boolean(f.activo),
    linkedin,
  };
  return { persona, errores };
}

// Matching.
export const RESULTADOS_REGLA = {
  cumple: 'Cumple',
  parcial: 'En parte',
  no_cumple: 'No cumple',
  desconocido: 'Sin dato',
};
const REGLAS = {
  anios: 'Experiencia',
  titulacion: 'Titulación',
  certificacion: 'Certificación',
  idioma: 'Idioma',
  docencia: 'Docencia',
};

export function etiquetaRegla(regla) {
  return REGLAS[regla] ?? regla;
}

/** Lo que el código entendió de un requisito: «≥ 5 años · titulación universitaria en informática · PMP · inglés B2». */
export function textoRequisito(r) {
  if (!r) return '';
  const partes = [
    r.anios_minimos ? `≥ ${r.anios_minimos} años de experiencia` : null,
    r.titulacion
      ? `${r.titulacion.nombre}${r.titulacion.campos.length ? ` en ${r.titulacion.campos.join(' o ')}` : ''}`
      : null,
    ...r.certificaciones,
    ...r.idiomas.map((i) => `${i.idioma}${i.nivel ? ` ${i.nivel}` : ''}`),
    r.docencia
      ? `≥ ${r.docencia.horas} h de docencia${r.docencia.materia ? ` en ${r.docencia.materia.texto}` : ''}${r.docencia.anios ? ` (${r.docencia.anios} años)` : ''}`
      : null,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'nada comprobable: se ordena por afinidad';
}

// Lo que se lee de un CV (tarifa y notas no salen de ahí). La docencia lleva su página del CV.
const CAMPOS_CV = {
  nombre: 'Nombre',
  rol: 'Rol',
  titulaciones: 'Titulaciones',
  certificaciones: 'Certificaciones',
  anios_experiencia: 'Años de experiencia',
  sectores: 'Sectores',
  cpv: 'CPV',
  tecnologias: 'Tecnologías',
  idiomas: 'Idiomas',
  docencia: 'Docencia',
  linkedin: 'LinkedIn',
};

/** Qué cambia un perfil leído de un CV respecto a la persona que ya existe ([] si es nueva). */
export function diferenciasPersona(previa, propuesta) {
  if (!previa) return [];
  const a = personaAFormulario(previa);
  const b = personaAFormulario(propuesta);
  a.titulaciones = lineas(a.titulaciones);
  b.titulaciones = lineas(b.titulaciones);
  a.docencia = lineas(a.docencia);
  b.docencia = lineas(b.docencia);
  return diferencias(a, b, CAMPOS_CV);
}
