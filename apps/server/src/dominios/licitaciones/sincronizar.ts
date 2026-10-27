// Sincronización incremental de una fuente PLACSP: recorre el feed hacia atrás hasta llegar a lo ya visto.
import { entradas, enlaceSiguiente, borradas } from './placsp/atom.js';
import { mapearEntrada, type LicitacionData } from './placsp/mapper.js';
import { esUrlDePlataforma, type Fuente } from './placsp/fuentes.js';
import { pedirPermitida } from './placsp/descarga.js';
import { guardarLicitacion, guardarSyncEstado, marcarBorrada, syncEstado, type Db } from './store.js';
import { guardarOrganizacion } from '../../nucleo/organizaciones.js';
import { emitir } from '../../nucleo/eventos.js';
import { USER_AGENT } from '../../nucleo/http.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';

// Parte de la página más nueva y llega a lo ya visto (con una hora de margen). Guarda cada licitación, sus
// adjudicatarios y órganos, y avisa de cambios de estado.
type Pagina = { xml: string; lastModified: string | null };
// null = la página no ha cambiado desde la última vez (304).
export type Descargar = (url: string, desde: string | null) => Promise<Result<Pagina | null>>;

const MARGEN_MS = 60 * 60_000;
// Las páginas del feed pesan ~13 MB y el servidor de la PLACSP es lento.
const TIMEOUT_MS = 10 * 60_000;
const SEGUIDAS = new Set(['nueva', 'en_preparacion', 'presentada']);

// Las redirecciones se validan salto a salto (pedirPermitida): el feed no puede llevarnos
// fuera de la PLACSP.
export const descargarPagina: Descargar = async (url, desde) => {
  if (!esUrlDePlataforma(url)) return fail('url_no_permitida', `No se descarga fuera de la PLACSP: ${url}`);
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml' };
  if (desde) headers['If-Modified-Since'] = desde;
  const r = await pedirPermitida(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }, esUrlDePlataforma);
  if (r.error) return r;
  const res = r.data;
  try {
    if (res.status === 304) return ok(null);
    if (!res.ok) return fail(`placsp_http_${res.status}`, res.statusText);
    return ok({ xml: await res.text(), lastModified: res.headers.get('last-modified') });
  } catch (err) {
    return fail('placsp_inalcanzable', errorMessage(err));
  }
};

export function guardarOrganizaciones(db: Db, l: LicitacionData): void {
  if (l.organo.nif)
    guardarOrganizacion(db, {
      nif: l.organo.nif,
      nombre: l.organo.nombre,
      tipo: 'organismo',
      dir3: l.organo.dir3,
      ciudad: l.organo.ciudad,
      cp: l.organo.cp,
      nuts: l.nuts,
    });
  for (const r of l.resultados) {
    if (r.adjudicatario_nif && r.adjudicatario_nombre)
      guardarOrganizacion(db, { nif: r.adjudicatario_nif, nombre: r.adjudicatario_nombre, tipo: 'empresa' });
  }
}

// Una licitación que sigue la empresa y cambia de estado (p. ej. EV → ADJ) es un evento.
function avisarCambio(db: Db, l: LicitacionData, estadoPrevio: string | undefined): void {
  if (!estadoPrevio || estadoPrevio === l.estado) return;
  const op = db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(l.id) as
    { estado: string } | undefined;
  if (!op || !SEGUIDAS.has(op.estado)) return;
  emitir(db, {
    tipo: 'licitacion.estado',
    dominio: 'licitaciones',
    recurso: l.id,
    datos: { de: estadoPrevio, a: l.estado, titulo: l.titulo },
  });
}

type ResumenPagina = {
  cambiadas: string[];
  masAntigua: number;
  masReciente: string | null;
  errores: number;
  total: number;
};

export function procesarPagina(db: Db, fuente: Fuente, xml: string): ResumenPagina {
  const r: ResumenPagina = {
    cambiadas: [],
    masAntigua: Number.POSITIVE_INFINITY,
    masReciente: null,
    errores: 0,
    total: 0,
  };
  const estadoDe = db.prepare('SELECT estado FROM licitaciones WHERE id = ?');
  db.transaction(() => {
    for (const xmlEntrada of entradas(xml)) {
      r.total += 1;
      const m = mapearEntrada(fuente.id, xmlEntrada);
      if (!m.data) {
        r.errores += 1;
        continue;
      }
      const l = m.data;
      const previo = (estadoDe.get(l.id) as { estado: string } | undefined)?.estado;
      if (guardarLicitacion(db, l) !== 'igual') r.cambiadas.push(l.id);
      guardarOrganizaciones(db, l);
      avisarCambio(db, l, previo);
      r.masAntigua = Math.min(r.masAntigua, Date.parse(l.actualizada_en));
      if (!r.masReciente || Date.parse(l.actualizada_en) > Date.parse(r.masReciente)) r.masReciente = l.actualizada_en;
    }
    for (const b of borradas(xml)) marcarBorrada(db, b.atomId, b.cuando, b.motivo);
  })();
  return r;
}

export type ResultadoSync = {
  cambiadas: string[];
  paginas: number;
  entradas: number;
  errores: number;
  error: string | null;
};

function masReciente(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Una vuelta de sincronización de una fuente. `maxPaginas` limita la primera vez y los huecos largos. */
export async function sincronizarFuente(
  db: Db,
  fuente: Fuente,
  maxPaginas: number,
  descargar: Descargar = descargarPagina,
): Promise<ResultadoSync> {
  const previo = syncEstado(db, fuente.id);
  const corte = previo.hasta ? Date.parse(previo.hasta) - MARGEN_MS : Number.NEGATIVE_INFINITY;
  const out: ResultadoSync = { cambiadas: [], paginas: 0, entradas: 0, errores: 0, error: null };
  let url: string | null = fuente.feed;
  let hasta = previo.hasta;
  let lastModified = previo.last_modified;
  let completa = false;
  while (url && out.paginas < maxPaginas) {
    const r = await descargar(url, out.paginas === 0 ? previo.last_modified : null);
    if (r.error) {
      out.error = `${r.error.code}: ${r.error.message}`;
      break;
    }
    if (r.data === null) {
      completa = true;
      break;
    }
    if (out.paginas === 0) lastModified = r.data.lastModified;
    const p = procesarPagina(db, fuente, r.data.xml);
    Object.assign(out, {
      paginas: out.paginas + 1,
      entradas: out.entradas + p.total,
      errores: out.errores + p.errores,
      cambiadas: [...out.cambiadas, ...p.cambiadas],
    });
    hasta = masReciente(hasta, p.masReciente);
    const siguiente = enlaceSiguiente(r.data.xml);
    if (p.masAntigua < corte || !siguiente) {
      completa = true;
      break;
    }
    url = esUrlDePlataforma(siguiente) ? siguiente : null;
  }
  // Con un error a medias no se avanza la marca: la próxima vuelta repasa desde el principio
  // (guardar es idempotente). Si se agotan las páginas sin llegar a lo visto, queda un
  // hueco que solo cubre el histórico anual, y se avanza para no repetir la misma vuelta.
  const avanzar = completa || !out.error;
  guardarSyncEstado(db, {
    fuente: fuente.id,
    hasta: avanzar ? hasta : previo.hasta,
    ultima_vuelta: new Date().toISOString(),
    last_modified: avanzar ? lastModified : previo.last_modified,
    ultimo_error: out.error,
    entradas: previo.entradas + out.entradas,
  });
  return out;
}
