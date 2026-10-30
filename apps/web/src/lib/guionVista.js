// La vista del guion en su cajón: qué filas son de los lotes a los
// que vamos y cuáles de otros, cómo se dice lo que cambió frente a la versión anterior y cuándo
// tienen sentido las prohibiciones. Puro: sin React ni peticiones.
import { ofertasEconomicas, textoLotesOferta } from './ofertaFormato.js';

const comparable = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const LOTES_EN_NOMBRE = /\blotes?\s+(?:n\.?\s*º?\s*)?(\d{1,3}(?:\s*(?:,|y|e|-)\s*\d{1,3})*)\b/i;

/**
 * Los lotes de una fila del guion: los que cita (`lotes`) o, en un guion anterior a los lotes por
 * documento, los que nombra («ANEXO III LOTE 2», modelo «Anexo III Bis, lote 4»). Vacío: vale
 * para todos.
 */
function lotesDeFila(x, lotesGuion) {
  if (x?.lotes?.length) return x.lotes.map(String);
  const nombrados = LOTES_EN_NOMBRE.exec([x?.nombre, x?.origen?.modelo].filter(Boolean).join(' '));
  if (!nombrados) return [];
  const lotes = nombrados[1].split(/\D+/).filter(Boolean);
  // Solo si son lotes del guion: «lote 2026» en un título no es un lote.
  return lotes.every((l) => lotesGuion.includes(l)) ? lotes : [];
}

const esAjena = (lotes, decididos) => lotes.length > 0 && !lotes.some((l) => decididos.includes(l));

function partirDocumentos(archivos, lotesGuion, decididos) {
  const ajenos = [];
  const propios = archivos.map((a) => {
    const documentos = (a.documentos ?? []).filter((d) => {
      if (!esAjena(lotesDeFila(d, lotesGuion), decididos)) return true;
      ajenos.push({ archivo: a.nombre, documento: d });
      return false;
    });
    return { ...a, documentos };
  });
  return { propios, ajenos };
}

/**
 * Las filas del guion de los lotes a los que vamos (`propios`, con la misma forma que `datos`,
 * para pintarlo igual) y las de otros lotes (`ajenos`: documentos, automáticos y ofertas
 * económicas, con su total). Sin lotes decididos, nada es ajeno.
 */
export function dividirPorLotes(datos, lotesDecididos = []) {
  const decididos = (lotesDecididos ?? []).map(String);
  const lotesGuion = (datos?.lotes ?? []).map(String);
  const vacio = { documentos: [], automaticos: [], ofertas: [], total: 0 };
  if (!datos || !decididos.length) return { propios: datos, ajenos: vacio };
  const docs = partirDocumentos(datos.archivos ?? [], lotesGuion, decididos);
  const automaticos = datos.automaticos ?? [];
  const ofertas = ofertasEconomicas(datos);
  const ajenaAuto = (a) => esAjena(lotesDeFila(a, lotesGuion), decididos);
  const ajenaOferta = (o) => esAjena((o.lotes ?? []).map(String), decididos);
  const ajenos = {
    documentos: docs.ajenos,
    automaticos: automaticos.filter(ajenaAuto),
    ofertas: ofertas.filter(ajenaOferta),
  };
  const propios = {
    ...datos,
    archivos: docs.propios,
    automaticos: automaticos.filter((a) => !ajenaAuto(a)),
    // Las ofertas ya normalizadas: sin oferta_economica, un guion anterior no vuelve a sacar la suya.
    ofertas_economicas: ofertas.filter((o) => !ajenaOferta(o)),
    oferta_economica: null,
  };
  return {
    propios,
    ajenos: { ...ajenos, total: ajenos.documentos.length + ajenos.automaticos.length + ajenos.ofertas.length },
  };
}

const CAMBIO_APARTADO = {
  nuevo: 'nuevo',
  quitado: 'quitado',
  movido: 'cambia de sitio',
  puntos: 'cambian los puntos',
  contenido: 'cambia lo que se valora',
  escala: 'cambia la escala',
};

// «declaracion · Declaración ENS BÁSICA · lotes 1» → «Declaración ENS BÁSICA · lotes 1»: el tipo va en código.
const sinTipo = (identidad) => {
  const partes = String(identidad).split(' · ');
  return partes.length > 1 ? partes.slice(1).join(' · ') : identidad;
};

function porVerbo(lista, etiqueta) {
  const grupos = { nuevo: [], quitado: [], cambiado: [] };
  for (const x of lista ?? []) grupos[x.cambio]?.push(etiqueta(x));
  return grupos;
}

function cambiosMemoria(m) {
  if (!m) return [];
  if (m.existe === 'nueva') return ['ahora pide memoria técnica'];
  if (m.existe === 'quitada') return ['ya no pide memoria técnica'];
  const que = [
    ['limite', 'el límite de páginas'],
    ['formato', 'el formato de la memoria'],
    ['valorable', 'si la memoria puntúa'],
    ['advertencias', 'las advertencias de la memoria'],
  ];
  return que.filter(([k]) => m[k]).map(([, t]) => `cambia ${t}`);
}

function frasesCambios(c) {
  const docs = porVerbo(c.documentos, (d) => sinTipo(d.identidad));
  const autos = porVerbo(c.automaticos, (a) => `el criterio «${a.clave}»`);
  const ofertas = porVerbo(
    c.ofertas,
    (o) => `la oferta económica${o.lotes ? ` del ${textoLotesOferta(String(o.lotes).split('+')).toLowerCase()}` : ''}`,
  );
  const frases = [];
  const anadidos = [...docs.nuevo, ...autos.nuevo, ...ofertas.nuevo];
  const quitados = [...docs.quitado, ...autos.quitado, ...ofertas.quitado];
  const cambiados = [...docs.cambiado, ...autos.cambiado, ...ofertas.cambiado];
  if (anadidos.length) frases.push(`añade ${anadidos.join(', ')}`);
  if (quitados.length) frases.push(`quita ${quitados.join(', ')}`);
  if (cambiados.length) frases.push(`cambia ${cambiados.join(', ')}`);
  for (const a of c.apartados ?? [])
    frases.push(`apartado ${a.n} «${a.titulo}»: ${CAMBIO_APARTADO[a.cambio] ?? 'cambia'}`);
  frases.push(...cambiosMemoria(c.memoria));
  if (c.archivos) frases.push('cambian los archivos electrónicos (prohibiciones o firma)');
  if (c.plazo) frases.push('cambia el plazo o el canal');
  if (c.lotes) frases.push('cambian los lotes del guion');
  return frases;
}

/**
 * Lo que cambió un guion frente a la versión anterior, en una línea: «v4: añade Declaración ENS
 * BÁSICA · cambia el plazo o el canal». Sin cambios, «Igual que la v3»; sin el cálculo (guion
 * sin esa información, o uno que ya no valida), «No se sabe qué cambió»: nunca «igual» a ciegas.
 */
export function textoCambiosGuion(cambios, version = null) {
  const anterior = version > 1 ? `la v${version - 1}` : 'la versión anterior';
  if (!cambios || typeof cambios !== 'object') return 'No se sabe qué cambió';
  if (cambios.vacio) return `Igual que ${anterior}`;
  const frases = frasesCambios(cambios);
  if (!frases.length) return 'No se sabe qué cambió';
  return `${version ? `v${version}: ` : ''}${frases.join(' · ')}`;
}

// Los archivos de los criterios que no son la memoria: los automáticos y las ofertas económicas.
function archivosDeCriterios(datos) {
  return [...(datos.automaticos ?? []).map((a) => a.archivo), ...ofertasEconomicas(datos).map((o) => o.archivo)]
    .filter(Boolean)
    .map(comparable);
}

/**
 * Las prohibiciones que tiene sentido enseñar: solo si hay memoria y va en un archivo
 * distinto de los criterios automáticos y la oferta económica. Si todo va junto, la memoria tiene
 * que hablar de esos criterios, y sin memoria no hay nada que prohibirle. Lista de
 * `{donde, textos}`: las literales de cada archivo y lo que la memoria no puede decir.
 */
export function prohibicionesVisibles(datos) {
  const memoria = datos?.memoria;
  if (!memoria?.archivo) return [];
  if (archivosDeCriterios(datos).includes(comparable(memoria.archivo))) return [];
  const deArchivos = (datos.archivos ?? [])
    .filter((a) => a.prohibiciones?.length)
    .map((a) => ({ donde: a.nombre, textos: a.prohibiciones }));
  const marcas = [...new Set((datos.automaticos ?? []).flatMap((a) => a.marcas ?? []))];
  return [
    ...deArchivos,
    ...(marcas.length ? [{ donde: 'La memoria no puede decir', textos: marcas.map((m) => `«${m}»`) }] : []),
  ];
}
