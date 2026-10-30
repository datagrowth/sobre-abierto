// Perfil de la empresa ⇄ formulario de la vista Empresa (sin React, con tests).
// El servidor vuelve a validarlo todo; aquí solo se convierten textos y se avisa
// pronto de lo que no tiene forma.
import { lista, numeroONulo } from './formato.js';

const ZONA_PENINSULAR = 'Europe/Madrid';
import { diferencias } from './propuestaIa.js';

const CLASIFICACION = /^([A-Za-z])\s*-?\s*(\d)\s*-?\s*([1-6A-Fa-f])$/;

/** [{grupo:'V', subgrupo:2, categoria:'C'}] → «V-2-C». */
export function clasificacionesATexto(clasificaciones = []) {
  return clasificaciones.map((c) => `${c.grupo}-${c.subgrupo}-${c.categoria}`).join(', ');
}

/** «V-2-C, m2-5» → clasificaciones y los trozos que no se entienden. */
export function clasificacionesDesdeTexto(texto) {
  const valor = [];
  const errores = [];
  for (const trozo of lista(texto)) {
    const m = CLASIFICACION.exec(trozo);
    if (m) valor.push({ grupo: m[1].toUpperCase(), subgrupo: Number(m[2]), categoria: m[3].toUpperCase() });
    else errores.push(`Clasificación «${trozo}»: usa grupo-subgrupo-categoría, p. ej. V-2-C o V-2-3.`);
  }
  return { valor, errores };
}

const texto = (n) => (n === null || n === undefined ? '' : String(n));
// Importes como se escriben en España («136.976,48»): con String() salían «136976.48», que
// parece mal escrito. de-DE agrupa siempre los miles (es-ES no lo hace con 4 cifras) y
// numeroONulo lo vuelve a leer igual.
const EUROS_FORMULARIO = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const importe = (n) => (typeof n === 'number' ? EUROS_FORMULARIO.format(n) : '');

/** Filas de volumen de negocio: las guardadas o, sin perfil, los tres últimos ejercicios cerrados. */
function filasVolumen(perfil, anioActual) {
  if (perfil?.volumen_negocio?.length)
    return [...perfil.volumen_negocio]
      .sort((a, b) => a.anio - b.anio)
      .map((v) => ({ anio: String(v.anio), importe: importe(v.importe) }));
  return [3, 2, 1].map((n) => ({ anio: String(anioActual - n), importe: '' }));
}

// El texto antiguo (domicilio, certificaciones) no se edita ya, pero se conserva para devolverlo
// mientras no haya versión estructurada: guardar no debe borrar lo que había. Con dirección
// estructurada, el domicilio lo deriva el servidor de ella: no es un texto antiguo que conservar.
function direccionAFormulario(perfil) {
  const d = perfil?.direccion;
  return {
    calle: d?.calle ?? '',
    codigo_postal: d?.codigo_postal ?? '',
    municipio: d?.municipio ?? '',
    provincia: d?.provincia ?? '',
    domicilio_texto: d ? '' : (perfil?.domicilio ?? ''),
  };
}

function certificadosAFormulario(perfil) {
  const lista = perfil?.certificados;
  return {
    certificados: (lista ?? []).map((c) => ({ nombre: c.nombre, nivel: c.nivel ?? '', caduca: c.caduca ?? '' })),
    sin_certificados: Array.isArray(lista) && lista.length === 0,
    certificaciones_texto: perfil?.certificaciones ?? [],
  };
}

export function perfilAFormulario(perfil, anioActual = new Date().getFullYear()) {
  return {
    nif: perfil?.nif ?? '',
    nombre: perfil?.nombre ?? '',
    ...direccionAFormulario(perfil),
    clasificaciones: clasificacionesATexto(perfil?.clasificaciones),
    volumen: filasVolumen(perfil, anioActual),
    ...certificadosAFormulario(perfil),
    seguro_rc: importe(perfil?.seguro_rc),
    plantilla_media: texto(perfil?.plantilla_media),
    anios_actividad: texto(perfil?.anios_actividad),
    cpv: (perfil?.cpv_experiencia ?? []).join(', '),
    mayor_contrato_similar: importe(perfil?.mayor_contrato_similar),
    notas: perfil?.notas ?? '',
    fecha_constitucion: perfil?.fecha_constitucion ?? '',
    tamano: perfil?.tamano ?? '',
    idiomas: [...(perfil?.idiomas ?? [])],
    rep_nombre: perfil?.representante?.nombre ?? '',
    rep_nif: perfil?.representante?.nif ?? '',
    rep_cargo: perfil?.representante?.cargo ?? '',
    email: perfil?.contacto?.email ?? '',
    telefono: perfil?.contacto?.telefono ?? '',
    ...instalacionAFormulario(perfil),
  };
}

// Lo propio de cada empresa que antes iba en el código: el nombre comercial, la zona horaria (la de
// los avisos y la segunda hora de los plazos) y las áreas de formación (una por línea: llevan comas).
function instalacionAFormulario(perfil) {
  return {
    nombre_comercial: perfil?.nombre_comercial ?? '',
    zona_horaria: perfil?.zona_horaria ?? ZONA_PENINSULAR,
    areas_formacion: (perfil?.areas_formacion ?? []).join('\n'),
  };
}

function numero(valor, etiqueta, errores, entero = false) {
  const n = numeroONulo(valor);
  if (Number.isNaN(n) || (entero && n !== null && !Number.isInteger(n)))
    errores.push(`${etiqueta}: escribe un número${entero ? ' entero' : ''}.`);
  return Number.isNaN(n) ? null : n;
}

function volumenes(filas, errores) {
  return filas
    .filter((f) => String(f.importe).trim() !== '')
    .map((f) => ({
      anio: numero(f.anio, 'Año del volumen de negocio', errores, true),
      importe: numero(f.importe, `Volumen de negocio de ${f.anio}`, errores),
    }));
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Datos de empresa del DEUC: fecha de constitución y tamaño.
function deDatosEmpresa(f, errores) {
  const fecha = String(f.fecha_constitucion ?? '').trim();
  if (fecha && !FECHA.test(fecha)) errores.push('Fecha de constitución: usa AAAA-MM-DD.');
  return { fecha_constitucion: fecha || null, tamano: f.tamano || null };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recortar = (v) => String(v ?? '').trim();

// Representante y contacto van en los anexos: o completos o nada. Vacíos no se envían y el
// servidor los deja en null (así también se guarda con un servidor que aún no los conoce).
function deAnexos(f, errores) {
  const rep = { nombre: recortar(f.rep_nombre), nif: recortar(f.rep_nif).toUpperCase(), cargo: recortar(f.rep_cargo) };
  const contacto = { email: recortar(f.email), telefono: recortar(f.telefono) };
  const conRep = Object.values(rep).some(Boolean);
  const conContacto = Object.values(contacto).some(Boolean);
  if (conRep && !Object.values(rep).every(Boolean))
    errores.push('Representante: rellena nombre, NIF y cargo, o déjalo todo vacío.');
  if (conContacto && !Object.values(contacto).every(Boolean))
    errores.push('Contacto: rellena correo y teléfono, o déjalos vacíos.');
  if (contacto.email && !EMAIL.test(contacto.email))
    errores.push('Contacto: el correo no tiene forma de correo (nombre@dominio.es).');
  return { ...(conRep ? { representante: rep } : {}), ...(conContacto ? { contacto } : {}) };
}

const CODIGO_POSTAL = /^\d{5}$/;

// Dirección completa o vacía; un código postal mal escrito se avisa aquí, no en el servidor.
function deDireccion(f, errores) {
  const d = {
    calle: recortar(f.calle),
    codigo_postal: recortar(f.codigo_postal),
    municipio: recortar(f.municipio),
    provincia: recortar(f.provincia),
  };
  if (!Object.values(d).some(Boolean)) return { direccion: null, domicilio: recortar(f.domicilio_texto) || null };
  if (!Object.values(d).every(Boolean))
    errores.push('Dirección: rellena calle, código postal, municipio y provincia, o déjalo todo vacío.');
  if (d.codigo_postal && !CODIGO_POSTAL.test(d.codigo_postal)) errores.push('Código postal: 5 cifras');
  return { direccion: d, domicilio: null };
}

// Casilla marcada = «no tenemos ninguna» ([]); sin filas ni casilla = sin indicar (null).
function deCertificados(f, errores) {
  const filas = (f.certificados ?? []).filter((c) => recortar(c.nombre) !== '');
  if (filas.some((c) => recortar(c.caduca) && !FECHA.test(c.caduca)))
    errores.push('Certificaciones: la caducidad va en AAAA-MM-DD.');
  if (filas.length) {
    return {
      certificados: filas.map((c) => ({
        nombre: recortar(c.nombre),
        nivel: c.nivel || null,
        caduca: recortar(c.caduca) || null,
      })),
    };
  }
  return { certificados: f.sin_certificados ? [] : null, certificaciones: f.certificaciones_texto ?? [] };
}

// Solo lo que tiene valor: lo vacío (o la zona peninsular) lo pone el servidor por defecto, así que
// un perfil sin estos campos vuelve igual y vaciar uno lo quita.
function deInstalacion(f) {
  const comercial = recortar(f.nombre_comercial);
  const areas = String(f.areas_formacion ?? '')
    .split(/\r?\n/)
    .map(recortar)
    .filter(Boolean);
  return {
    ...(comercial ? { nombre_comercial: comercial } : {}),
    ...(areas.length ? { areas_formacion: [...new Set(areas)] } : {}),
    ...(f.zona_horaria && f.zona_horaria !== ZONA_PENINSULAR ? { zona_horaria: f.zona_horaria } : {}),
  };
}

/** Formulario → perfil para el servidor, con los errores de forma que se ven antes de enviar. */
export function formularioAPerfil(f) {
  const errores = [];
  const clasificaciones = clasificacionesDesdeTexto(f.clasificaciones);
  errores.push(...clasificaciones.errores);
  const perfil = {
    nif: f.nif.trim(),
    nombre: f.nombre.trim(),
    ...deDireccion(f, errores),
    clasificaciones: clasificaciones.valor,
    volumen_negocio: volumenes(f.volumen, errores),
    ...deCertificados(f, errores),
    seguro_rc: numero(f.seguro_rc, 'Seguro de responsabilidad civil', errores),
    plantilla_media: numero(f.plantilla_media, 'Plantilla media', errores, true),
    anios_actividad: numero(f.anios_actividad, 'Años de actividad', errores, true),
    cpv_experiencia: lista(f.cpv),
    mayor_contrato_similar: numero(f.mayor_contrato_similar, 'Mayor contrato similar', errores),
    notas: f.notas,
    idiomas: f.idiomas ?? [],
    ...deDatosEmpresa(f, errores),
    ...deAnexos(f, errores),
    ...deInstalacion(f),
  };
  return { perfil, errores };
}

const ETIQUETAS = {
  nif: 'NIF',
  nombre: 'Razón social',
  direccion: 'Dirección',
  clasificaciones: 'Clasificaciones',
  volumen: 'Volumen de negocio',
  certificaciones: 'Certificaciones',
  seguro_rc: 'Seguro de responsabilidad civil',
  plantilla_media: 'Plantilla media',
  anios_actividad: 'Años de actividad',
  cpv: 'CPV con experiencia',
  mayor_contrato_similar: 'Mayor contrato similar',
  notas: 'Notas',
  fecha_constitucion: 'Fecha de constitución',
  tamano: 'Tamaño',
  idiomas: 'Idiomas del equipo',
  rep_nombre: 'Representante',
  rep_nif: 'NIF del representante',
  rep_cargo: 'Cargo del representante',
  email: 'Correo de contacto',
  telefono: 'Teléfono de contacto',
  nombre_comercial: 'Nombre comercial',
  zona_horaria: 'Zona horaria',
  areas_formacion: 'Áreas de formación',
};

// El formulario con las listas en texto legible para comparar («2025: 186420.35 €»).
function paraComparar(perfil) {
  const f = perfilAFormulario(perfil, 2000);
  const volumen = f.volumen.filter((v) => String(v.importe).trim()).map((v) => `${v.anio}: ${v.importe} €`);
  const direccion = [f.calle, f.codigo_postal, f.municipio, f.provincia].filter(Boolean).join(' ') || f.domicilio_texto;
  const certificaciones = f.certificados.length
    ? f.certificados.map((c) => [c.nombre, c.nivel, c.caduca && `hasta ${c.caduca}`].filter(Boolean).join(' '))
    : f.sin_certificados
      ? ['ninguna']
      : f.certificaciones_texto;
  return { ...f, volumen, direccion, certificaciones };
}

/** [{campo, antes, despues}] de lo que cambia la propuesta de un agente respecto al perfil guardado. */
export function diferenciasPerfil(actual, propuesto) {
  return diferencias(paraComparar(actual), paraComparar(propuesto), ETIQUETAS);
}
