// Rutas de la app en la almohadilla de la dirección (#/seccion/vista/id): se pueden
// recargar, compartir entre el equipo y el botón Atrás del navegador vuelve donde se
// estaba (sin React, con tests).

// La ficha de una licitación es su propia página («licitacion»). «diseno» es el catálogo de
// componentes: una ruta de desarrollo, fuera del menú.
const SECCIONES = [
  'pipeline',
  'oportunidades',
  'licitacion',
  'mercado',
  'aprendizaje',
  'equipo',
  'biblioteca',
  'actividad',
  'consola',
  'ajustes',
  'diseno',
];
const SECCION_INICIAL = 'pipeline';

// Nombres antiguos de las secciones («Hoy», «Colaboradores»…): hay enlaces ya enviados y guardados que
// los usan, así que se mantienen y llevan a la sección actual.
const ALIAS = {
  hoy: 'pipeline',
  colaboradores: 'equipo',
  live: 'actividad',
  'hermes-vault': 'biblioteca',
  'hermes-panel': 'consola',
};

// La antigua sección Licitaciones se repartió: cada vista guardada lleva a su
// sitio actual y la ficha («…/oportunidades/p-123/comprobaciones#bloqueo=…»), a su página con lo mismo detrás.
const MERCADO_ANTES = {
  competidores: 'competidores',
  organismos: 'organismos',
  'que-nos-falta': 'que-nos-falta',
  barreras: 'que-nos-falta',
};

function rutaLicitacionesAntigua(partes) {
  const [, vista = null, ...resto] = partes.map(decodificar);
  const id = resto.length ? resto.join('/') : null;
  if (vista === 'oportunidades' && id) return { seccion: 'licitacion', vista: null, id };
  if (vista === 'presentadas' || vista === 'ofertas') return { seccion: 'pipeline', vista: 'presentadas', id };
  if (MERCADO_ANTES[vista]) return { seccion: 'mercado', vista: MERCADO_ANTES[vista], id };
  if (vista === 'ajustes') return { seccion: 'ajustes', vista: 'fuentes', id };
  return { seccion: SECCION_INICIAL, vista: null, id: null };
}

function decodificar(trozo) {
  try {
    return decodeURIComponent(trozo);
  } catch {
    return trozo;
  }
}

function parametro(fragmento, clave) {
  const v = fragmento
    .split('&')
    .map((p) => p.split('='))
    .find(([k]) => k === clave)
    ?.slice(1)
    .join('=');
  return v ? decodificar(v) : null;
}

/**
 * Equipo: «#/equipo/12#campo=topografía» (el enlace de la matriz de equipo) abre la ficha de la
 * persona 12 en la materia: { seccion: 'equipo', vista: 'personas', id: '12', campo }.
 */
function rutaEquipo(limpio) {
  const corte = limpio.indexOf('#');
  const ruta = corte < 0 ? limpio : limpio.slice(0, corte);
  const campo = corte < 0 ? null : parametro(limpio.slice(corte + 1), 'campo');
  const [, vista = null, ...resto] = ruta.split('/').filter(Boolean).map(decodificar);
  const persona = vista !== null && /^\d+$/.test(vista);
  const base = {
    seccion: 'equipo',
    vista: persona ? 'personas' : vista,
    id: persona ? vista : resto.length ? resto.join('/') : null,
  };
  return campo ? { ...base, campo } : base;
}

/**
 * «#/mercado/competidores/B123» → { seccion, vista, id }; lo desconocido, al Pipeline. La ficha
 * («#/licitacion/p-123/comprobaciones#bloqueo=…») lleva todo lo de detrás en `id`, que lee leerFoco.
 */
export function leerRuta(hash) {
  const partes = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean);
  if (partes[0] === 'licitaciones') return rutaLicitacionesAntigua(partes);
  const pedida = ALIAS[partes[0]] ?? partes[0];
  if (!SECCIONES.includes(pedida)) return { seccion: SECCION_INICIAL, vista: null, id: null };
  if (pedida === 'equipo') return rutaEquipo(String(hash ?? '').replace(/^#\/?/, ''));
  if (pedida === 'licitacion')
    return { seccion: pedida, vista: null, id: partes.length > 1 ? partes.slice(1).map(decodificar).join('/') : null };
  const vista = partes[1] ? decodificar(partes[1]) : null;
  return { seccion: pedida, vista, id: partes.length > 2 ? decodificar(partes.slice(2).join('/')) : null };
}

/** La dirección pide una sección que no existe (y no está vacía): la app avisa en vez de redirigir en silencio. */
export function rutaDesconocida(hash) {
  const primera = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)[0];
  if (!primera || primera === 'licitaciones') return false;
  return !SECCIONES.includes(ALIAS[primera] ?? primera);
}

/** { seccion, vista, id, campo } → «#/seccion/vista/id#campo=…» (cada trozo codificado; el id puede llevar «/»). */
export function rutaA({ seccion, vista = null, id = null, campo = null }) {
  const partes = [seccion, vista, id].filter((p) => p !== null && p !== undefined && p !== '');
  const ancla = campo ? `#campo=${encodeURIComponent(campo)}` : '';
  return `#/${partes.map((p) => encodeURIComponent(String(p))).join('/')}${ancla}`;
}

const VACIO_FOCO = { id: null, seccion: null, bloqueo: null, testid: null };

// Los correos, avisos y mensajes ya enviados llevan la ruta con el nombre antiguo de las comprobaciones.
const SECCION_RENOMBRADA = { cabina: 'comprobaciones' };

function parametrosFoco(fragmento) {
  return { bloqueo: parametro(fragmento, 'bloqueo'), testid: parametro(fragmento, 'testid') };
}

/**
 * El id de la ruta de una ficha: «p-123/comprobaciones#bloqueo=precio_pendiente:3:-» → { id, seccion,
 * bloqueo, testid } (la fila de las comprobaciones en la que abrir, o la pieza a enfocar con
 * «#testid=registrar-paquete»). Los enlaces de antes («p-123/preparacion») siguen leyéndose como
 * una sección.
 */
export function leerFoco(id) {
  if (!id) return VACIO_FOCO;
  const almohadilla = String(id).indexOf('#');
  const ruta = almohadilla < 0 ? String(id) : String(id).slice(0, almohadilla);
  const [ficha = null, pedida = null] = ruta.split('/').filter(Boolean);
  const seccion = SECCION_RENOMBRADA[pedida] ?? pedida;
  const { bloqueo, testid } =
    almohadilla < 0 ? { bloqueo: null, testid: null } : parametrosFoco(String(id).slice(almohadilla + 1));
  return { id: ficha, seccion, bloqueo, testid };
}

/** Las comprobaciones con el foco en una pieza (el pie del paquete): «…/p-123/comprobaciones#testid=registrar-paquete». */
export function rutaComprobacionesEn(id, testid) {
  return `${rutaComprobaciones(id)}#testid=${encodeURIComponent(testid)}`;
}

/** La ficha de una licitación, en una pestaña si se pide: «#/licitacion/p-123/expediente». */
export function rutaFicha(id, pestana = null) {
  return `#/licitacion/${encodeURIComponent(id)}${pestana ? `/${encodeURIComponent(pestana)}` : ''}`;
}

/** Las comprobaciones de una oferta, abierta en una fila: «#/licitacion/p-123/comprobaciones#bloqueo=…». */
export function rutaComprobaciones(id, clave = null) {
  const base = rutaFicha(id, 'comprobaciones');
  return clave ? `${base}#bloqueo=${encodeURIComponent(clave)}` : base;
}

/** La persona que abre la ruta de Equipo («#/equipo/12#campo=…» → 12), o null si no abre ninguna. */
export function personaDeRuta(ruta) {
  if (ruta?.seccion !== 'equipo' || !/^\d+$/.test(String(ruta.id ?? ''))) return null;
  return Number(ruta.id);
}
