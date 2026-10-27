// El expediente por lotes de interés: qué requisitos, criterios y documentos son de
// los lotes que vamos a ofertar, qué excluyentes quedan por confirmar (con su fila de las comprobaciones)
// y qué condiciona el semáforo de la ficha. Puro: sin React ni red, con tests.
import { fichaAntigua, resumenCobertura } from './licitacionesFormato.js';
import { rutaComprobaciones } from './rutas.js';

const normal = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Los criterios y los documentos de la ficha no traen «lote»: lo dicen en el texto («Lote 2: …»,
// «…, lote 1 criterio 2B1»). Solo cuenta si nombra un único lote; con dos o ninguno, es del contrato.
const LOTE_EN_TEXTO = /\blote\s+(\d+)\b/g;

function lotesDe(item) {
  if (item?.lote != null) return [String(item.lote)];
  if (Array.isArray(item?.lotes) && item.lotes.length) return item.lotes.map(String);
  const texto = normal(item?.descripcion ?? item?.documento ?? item?.criterio ?? '');
  const nombrados = [...new Set([...texto.matchAll(LOTE_EN_TEXTO)].map((m) => m[1]))];
  return nombrados.length === 1 ? nombrados : [];
}

/** Los ids de los lotes de interés de una licitación («lotes_interes» de la web). */
export function idsInteres(f) {
  return (f?.lotes_interes ?? []).map((l) => String(l?.id ?? l)).filter(Boolean);
}

/**
 * Lo que es de los lotes de interés o del contrato entero. Sin lotes de interés, o con
 * `todos`, no se quita nada: filtrar a ciegas escondería un requisito que sí nos toca.
 */
export function filtrarPorLotes(items = [], lotes = [], todos = false) {
  if (todos || !lotes?.length) return items;
  const interes = new Set(lotes.map(String));
  return items.filter((x) => {
    const suyos = lotesDe(x);
    return !suyos.length || suyos.some((l) => interes.has(l));
  });
}

const mismoLote = (r, b) => String(r.lote ?? '') === String(b.lote ?? '');
const sujetoDe = (b) => normal(String(b.clave).split(':').slice(2).join(' ').replace(/_/g, ' ').replace(/^rol /, ''));

// La cita de la fila es la descripción del requisito (o su principio, recortado con «…»).
function casaPorCita(r, b) {
  const cita = normal(b.cita?.texto).replace(/…$/, '').trim();
  return cita.length > 0 && normal(r.descripcion).startsWith(cita);
}

function casaPorSujeto(r, b) {
  const sujeto = sujetoDe(b);
  return (
    sujeto.length > 1 &&
    ` ${normal(`${r.descripcion ?? ''} ${r.exigido ?? ''}`).replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${sujeto} `)
  );
}

/**
 * La fila de elegibilidad de las comprobaciones de un requisito. Por la cita, cualquiera vale (todas salen
 * de ese requisito); por el sujeto, solo si hay una: ante la duda, sin enlace antes que uno equivocado.
 */
export function bloqueoDeRequisito(r, bloqueos = []) {
  const candidatas = bloqueos.filter(
    (b) => b.categoria === 'elegibilidad' && b.estado !== 'resuelto' && mismoLote(r, b),
  );
  const porCita = candidatas.filter((b) => casaPorCita(r, b));
  if (porCita.length) return porCita[0];
  const porSujeto = candidatas.filter((b) => casaPorSujeto(r, b));
  return porSujeto.length === 1 ? porSujeto[0] : null;
}

const MAX_ETIQUETA = 48;

// La primera frase del requisito, corta: lo justo para reconocerlo en una línea.
function etiquetaCorta(r) {
  const frase =
    String(r.descripcion ?? r.etiqueta ?? '')
      .split(/[.;:(]/)[0]
      .trim() || String(r.etiqueta ?? 'Requisito');
  const corta = frase.length > MAX_ETIQUETA ? `${frase.slice(0, MAX_ETIQUETA - 1).trimEnd()}…` : frase;
  return r.lote ? `${corta} (lote ${r.lote})` : corta;
}

/**
 * «{n} excluyentes por confirmar»: cada uno con su etiqueta y, si casa con una fila de
 * elegibilidad de las comprobaciones, su clave y su ruta. Sin pareja, sale sin enlace.
 */
export function resumenExcluyentes(requisitos = [], bloqueos = [], id = null) {
  const items = requisitos
    .filter((r) => r.excluyente && r.resultado === 'desconocido')
    .map((r) => {
      const b = bloqueoDeRequisito(r, bloqueos ?? []);
      return {
        etiqueta: etiquetaCorta(r),
        clave: b?.clave ?? null,
        ruta: b && id ? rutaComprobaciones(id, b.clave) : null,
      };
    });
  return { n: items.length, items };
}

function avisoCalidad(c) {
  if (!c) return null;
  return `calidad ${c.puntuacion}/100${c.dudosos_pct ? `, ${c.dudosos_pct} % por confirmar` : ''}`;
}

/**
 * La línea «Fiabilidad de la ficha»: lo que condiciona el semáforo junto (sin perfil, ficha hecha
 * con una regla anterior, temas no encontrados en los pliegos y calidad). `avisa` dice si alguno
 * pide hacer algo; la calidad sola no. null sin ficha ni avisos.
 */
export function fiabilidadFicha(f) {
  const gng = f?.go_no_go;
  if (!gng) return null;
  const ficha = gng.ficha?.aprobada ?? null;
  const { noEncontrado } = resumenCobertura(ficha?.datos?.cobertura ?? []);
  const avisos = [
    !gng.perfil_empresa ? 'sin el perfil de la empresa (rellénalo en Empresa para saber si cumplimos)' : null,
    fichaAntigua(ficha, gng.version_ficha_actual)
      ? `hecha con una regla anterior (v${ficha.version_prompt ?? 1}; la vigente es la v${gng.version_ficha_actual}): se regenera sola o con «Volver a generar la ficha»`
      : null,
    noEncontrado.length ? `no encontrado en los pliegos: ${noEncontrado.join(', ')}` : null,
  ].filter(Boolean);
  const partes = [...avisos, avisoCalidad(ficha?.datos?.calidad)].filter(Boolean);
  return partes.length ? { texto: `Fiabilidad de la ficha: ${partes.join(' · ')}.`, avisa: avisos.length > 0 } : null;
}
