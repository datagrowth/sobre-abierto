// Actas y resoluciones de expedientes del mercado en los que la empresa no participa: licitadores e importes.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../nucleo/db.js';
import { USER_AGENT } from '../../nucleo/http.js';
import { estadoNif, normalizarNif } from '../../nucleo/identidad.js';
import { logger } from '../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { encolar } from '../../nucleo/trabajos.js';
import { condicionSector } from './competencia/ambito.js';
import { sectorActual } from './historico.js';
import { leerConTope, pedirPermitida } from './placsp/descarga.js';
import { RESULTADOS_ADJUDICADOS } from './placsp/codigos.js';
import { documentosDelExpediente } from './placsp/expediente.js';
import { esUrlDePlataforma } from './placsp/fuentes.js';
import { guardarParticipacion } from './participaciones.js';
import { paginaExpediente } from './pliegosExpediente.js';
import { bastaLectura, licitadoresDeTexto, mejorActa, textoParaNif } from './actasMercadoLectura.js';
import type { Db } from './store.js';

// De lo adjudicado con dos o más ofertas en los CPV de la empresa, se lee la página del expediente, se baja el
// acta de valoración (o el informe o la resolución) y se sacan por código los licitadores con su importe. Si el
// código no basta (faltan ofertas o hay varios lotes), un trabajo de Hermes de prioridad baja, con un tope al
// día, lee el texto y lo devuelve con licitaciones_acta_mercado_guardar. Todo acaba en participaciones; el PDF
// no se guarda (no es conocimiento de la empresa: Drive no cambia). Las personas físicas van solo con su NIF y
// nada de esto pasa por el log.
export const TIPO_ACTA_MERCADO = 'licitaciones.leer_acta_mercado';
export const PayloadActaMercado = z.object({ id: z.string().min(3), pedida_en: z.string().min(10) });

export type EstadoActaMercado =
  'sin_acta' | 'sin_texto' | 'leida' | 'pendiente_hermes' | 'pedida_hermes' | 'leida_hermes' | 'sin_datos' | 'error';

const DIA_MS = 24 * 60 * 60_000;
// La PLACSP es lenta y es ajena: una lectura cada diez minutos y como mucho 60 al día.
const CADA_MS = 10 * 60_000;
const MAX_CODIGO_DIA = 60;
const MESES = 24;
// Un acta que aún no estaba publicada (o un PDF escaneado) se vuelve a mirar al mes; un fallo, al día.
const REINTENTO_MS = 30 * DIA_MS;
const REINTENTO_ERROR_MS = DIA_MS;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TEXTO = 200_000;
const MIN_LETRAS = 200;
const TIMEOUT_MS = 60_000;
const CONFIANZA_CODIGO = 0.6;
const CONFIANZA_HERMES = 0.8;
const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');
const log = logger('licitaciones.actas_mercado');

/** Cómo se llega a la PLACSP y se lee un PDF: inyectable para los tests. */
export type LectorExpediente = {
  pagina: (url: string) => Promise<Result<string>>;
  documento: (url: string) => Promise<Result<Buffer>>;
  texto: (pdf: Buffer) => Promise<Result<string>>;
};

async function documentoPlacsp(url: string): Promise<Result<Buffer>> {
  const r = await pedirPermitida(
    url,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    esUrlDePlataforma,
  );
  if (r.error) return r;
  if (!r.data.ok) {
    await r.data.body?.cancel().catch(() => undefined);
    return fail(`placsp_http_${r.data.status}`, r.data.statusText);
  }
  return leerConTope(r.data, MAX_BYTES);
}

async function textoPdf(pdf: Buffer): Promise<Result<string>> {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return fail('no_es_pdf', 'El documento no es un PDF.');
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const proxy = await getDocumentProxy(new Uint8Array(pdf));
    try {
      const { text } = await extractText(proxy, { mergePages: false });
      return ok(text.join('\n'));
    } finally {
      await proxy.loadingTask.destroy();
    }
  } catch (err) {
    return fail('pdf_ilegible', errorMessage(err));
  }
}

const LECTOR_PLACSP: LectorExpediente = {
  pagina: paginaExpediente,
  documento: documentoPlacsp,
  texto: textoPdf,
};

type Candidata = { id: string; url: string; organo_nif: string | null; ofertas: number | null; lotes: string };

/**
 * La siguiente licitación cuya acta leer: adjudicada en los últimos dos años con dos o más ofertas,
 * de los CPV de la empresa, que la empresa no presentó (esas las lee aprender_acta) y sin acta ya leída.
 * Primero las de órganos que sigue la empresa o con los que la empresa tiene ofertas; después, la más reciente.
 */
export function candidataActa(db: Db, ahoraMs = Date.now()): Candidata | null {
  const { cpvs } = sectorActual(db, false);
  if (!cpvs.length) return null;
  const sector = condicionSector('a.cpvs', cpvs);
  return (
    (db
      .prepare(
        `SELECT a.licitacion_id AS id, l.url, l.organo_nif, MAX(a.ofertas) AS ofertas, group_concat(DISTINCT a.lote) AS lotes
    FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id LEFT JOIN actas_mercado m ON m.licitacion_id = a.licitacion_id
    WHERE a.resultado IN (${ADJUDICADOS}) AND a.ofertas >= 2 AND a.fecha_ref >= ? AND l.url IS NOT NULL AND l.borrada_en IS NULL AND ${sector.sql}
      AND NOT EXISTS (SELECT 1 FROM oportunidades o WHERE o.licitacion_id = a.licitacion_id AND o.estado IN ('presentada', 'ganada', 'perdida'))
      AND (m.licitacion_id IS NULL OR (m.estado IN ('sin_acta', 'sin_texto') AND m.revisada_en <= ?) OR (m.estado = 'error' AND m.revisada_en <= ?))
    GROUP BY a.licitacion_id
    ORDER BY (l.organo_nif IN (SELECT nif FROM seguidos WHERE tipo = 'organismo')
      OR l.organo_nif IN (SELECT l2.organo_nif FROM oportunidades o2 JOIN licitaciones l2 ON l2.id = o2.licitacion_id
        WHERE o2.estado IN ('en_preparacion', 'presentada', 'ganada', 'perdida'))) DESC, MAX(a.fecha_ref) DESC
    LIMIT 1`,
      )
      .get(
        new Date(ahoraMs - MESES * 30 * DIA_MS).toISOString().slice(0, 10),
        ...sector.args,
        new Date(ahoraMs - REINTENTO_MS).toISOString(),
        new Date(ahoraMs - REINTENTO_ERROR_MS).toISOString(),
      ) as Candidata | undefined) ?? null
  );
}

type Apunte = {
  estado: EstadoActaMercado;
  documento?: { nombre: string; url: string } | null;
  licitadores?: number;
  texto?: string | null;
  error?: string | null;
};

function apuntar(db: Db, id: string, a: Apunte, ahoraMs: number): void {
  db.prepare(
    `INSERT INTO actas_mercado (licitacion_id, estado, documento_nombre, documento_url, licitadores, texto, error, revisada_en)
    VALUES (@id, @estado, @nombre, @url, @licitadores, @texto, @error, @en)
    ON CONFLICT(licitacion_id) DO UPDATE SET estado = excluded.estado, documento_nombre = COALESCE(excluded.documento_nombre, documento_nombre),
      documento_url = COALESCE(excluded.documento_url, documento_url), licitadores = excluded.licitadores, texto = excluded.texto,
      error = excluded.error, revisada_en = excluded.revisada_en`,
  ).run({
    id,
    estado: a.estado,
    nombre: a.documento?.nombre ?? null,
    url: a.documento?.url ?? null,
    licitadores: a.licitadores ?? 0,
    texto: a.texto ?? null,
    error: a.error ?? null,
    en: new Date(ahoraMs).toISOString(),
  });
}

/** Lee el acta de una licitación por código y deja apuntado en qué quedó. */
async function leerActaMercado(
  db: Db,
  c: Candidata,
  lector: LectorExpediente = LECTOR_PLACSP,
  ahoraMs = Date.now(),
): Promise<EstadoActaMercado> {
  const html = await lector.pagina(c.url);
  if (html.error) return fallo(db, c.id, html.error.code, null, ahoraMs);
  const doc = mejorActa(documentosDelExpediente(html.data, c.url));
  if (!doc) {
    apuntar(db, c.id, { estado: 'sin_acta' }, ahoraMs);
    return 'sin_acta';
  }
  const pdf = await lector.documento(doc.url);
  if (pdf.error) return fallo(db, c.id, pdf.error.code, doc, ahoraMs);
  const texto = await lector.texto(pdf.data);
  if (texto.error || (texto.data.match(/\p{L}/gu)?.length ?? 0) < MIN_LETRAS) {
    apuntar(db, c.id, { estado: 'sin_texto', documento: doc, error: texto.error?.code ?? null }, ahoraMs);
    return 'sin_texto';
  }
  const leidos = licitadoresDeTexto(texto.data, c.organo_nif);
  const lotes = (c.lotes ?? '').split(',');
  // Con varios lotes el código no sabe a cuál se presentó cada uno: eso lo lee Hermes.
  if (lotes.length === 1) {
    db.transaction(() => {
      for (const l of leidos) {
        guardarParticipacion(db, {
          licitacion_id: c.id,
          lote: lotes[0] ?? '',
          empresa_nif: l.nif,
          empresa_nombre: l.nombre,
          rol: l.excluida ? 'excluida' : 'licitadora',
          importe_ofertado: l.importe,
          puntos_tecnicos: null,
          puntos_economicos: null,
          fuente: 'acta',
          documento: doc.nombre,
          confianza: CONFIANZA_CODIGO,
        });
      }
    })();
  }
  const basta = lotes.length === 1 && bastaLectura(leidos, c.ofertas);
  const estado: EstadoActaMercado = basta ? 'leida' : 'pendiente_hermes';
  apuntar(
    db,
    c.id,
    {
      estado,
      documento: doc,
      licitadores: lotes.length === 1 ? leidos.length : 0,
      texto: basta ? null : texto.data.slice(0, MAX_TEXTO),
    },
    ahoraMs,
  );
  return estado;
}

function fallo(
  db: Db,
  id: string,
  codigo: string,
  doc: { nombre: string; url: string } | null,
  ahoraMs: number,
): EstadoActaMercado {
  apuntar(db, id, { estado: 'error', documento: doc, error: codigo }, ahoraMs);
  log.warn('acta de mercado sin leer', { licitacion: id, error: codigo });
  return 'error';
}

const inicioDia = (ahoraMs: number) => new Date(ahoraMs - DIA_MS).toISOString();

/** Pasa a Hermes lo que el código no pudo leer entero, sin pasar del tope de las últimas 24 h. */
export function pedirHermes(db: Db, dbNucleo: DbNucleo, tope: number, ahoraMs = Date.now()): number {
  const hechos = (
    dbNucleo
      .prepare('SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ? AND creado_en >= ?')
      .get(TIPO_ACTA_MERCADO, inicioDia(ahoraMs)) as { n: number }
  ).n;
  const huecos = Math.max(0, tope - hechos);
  if (!huecos) return 0;
  const ids = (
    db
      .prepare(`SELECT licitacion_id FROM actas_mercado WHERE estado = 'pendiente_hermes' ORDER BY revisada_en LIMIT ?`)
      .all(huecos) as { licitacion_id: string }[]
  ).map((f) => f.licitacion_id);
  const en = new Date(ahoraMs).toISOString();
  for (const id of ids) {
    encolar(dbNucleo, {
      tipo: TIPO_ACTA_MERCADO,
      dominio: 'licitaciones',
      clave: `acta-mercado-${id}-${en}`,
      payload: { id, pedida_en: en },
    });
    db.prepare("UPDATE actas_mercado SET estado = 'pedida_hermes', pedida_en = ? WHERE licitacion_id = ?").run(en, id);
  }
  return ids.length;
}

// Un trabajo de Hermes que acabó fallido o cancelado sin leerla: el acta queda en error y se
// reintenta al día siguiente (con otro trabajo, si hay hueco).
function cerrarFallidas(db: Db, dbNucleo: DbNucleo, ahoraMs: number): void {
  const pedidas = db
    .prepare("SELECT licitacion_id, pedida_en FROM actas_mercado WHERE estado = 'pedida_hermes'")
    .all() as { licitacion_id: string; pedida_en: string }[];
  for (const p of pedidas) {
    const t = dbNucleo
      .prepare('SELECT estado FROM trabajos_ia WHERE clave = ?')
      .get(`acta-mercado-${p.licitacion_id}-${p.pedida_en}`) as { estado: string } | undefined;
    if (t && t.estado !== 'fallido' && t.estado !== 'cancelado') continue;
    apuntar(db, p.licitacion_id, { estado: 'error', error: 'hermes_sin_leer' }, ahoraMs);
  }
}

let ultimaMs = 0;
let leyendo = false;

/**
 * Lo de cada vuelta: cierra lo que Hermes no leyó, le pasa lo pendiente y, como mucho una vez
 * cada diez minutos y 60 al día, lee una acta más por código. Nada de esto para la vuelta.
 */
export async function vueltaActasMercado(
  db: Db,
  dbNucleo: DbNucleo,
  topeHermes: number,
  lector = LECTOR_PLACSP,
  ahoraMs = Date.now(),
): Promise<EstadoActaMercado | null> {
  if (leyendo || ahoraMs - ultimaMs < CADA_MS) return null;
  leyendo = true;
  ultimaMs = ahoraMs;
  try {
    cerrarFallidas(db, dbNucleo, ahoraMs);
    pedirHermes(db, dbNucleo, topeHermes, ahoraMs);
    const hoy = (
      db.prepare('SELECT COUNT(*) AS n FROM actas_mercado WHERE revisada_en >= ?').get(inicioDia(ahoraMs)) as {
        n: number;
      }
    ).n;
    const c = hoy < MAX_CODIGO_DIA ? candidataActa(db, ahoraMs) : null;
    const estado = c ? await leerActaMercado(db, c, lector, ahoraMs) : null;
    if (estado === 'pendiente_hermes') pedirHermes(db, dbNucleo, topeHermes, ahoraMs);
    return estado;
  } finally {
    leyendo = false;
  }
}

/** Para los tests: la próxima vuelta lee sin esperar los diez minutos. */
export function reiniciarRitmoActas(): void {
  ultimaMs = 0;
}

// ─── Hermes ──────────────────────────────────────────────────────────────────

type FilaActa = {
  estado: EstadoActaMercado;
  documento_nombre: string | null;
  texto: string | null;
  pedida_en: string | null;
};

function filaActa(db: Db, id: string): FilaActa | null {
  return (
    (db
      .prepare('SELECT estado, documento_nombre, texto, pedida_en FROM actas_mercado WHERE licitacion_id = ?')
      .get(id) as FilaActa | undefined) ?? null
  );
}

/** ¿Llegó la lectura de Hermes? Es la comprobación «hecho» del trabajo. */
export function actaMercadoLeida(db: Db, id: string): boolean {
  return filaActa(db, id)?.estado !== 'pedida_hermes';
}

export function instruccionesActaMercado(id: string, empresa: string): string {
  return [
    `Tarea automática de la plataforma de ${empresa}: leer el acta (o informe o resolución) de una licitación ajena de nuestro mercado y devolver quién se presentó.`,
    `1. Llama a licitaciones_acta_mercado con id=${id}: trae los lotes con su adjudicatario y nº de ofertas y el texto del documento (si es largo, sigue con «desde»).`,
    `2. Llama a licitaciones_acta_mercado_guardar con id=${id} y en «licitadores» uno por empresa y lote: nif (tal como sale en el texto), nombre, lote (el de la lista; "" si no hay lotes), rol (licitadora, excluida o adjudicataria), importe_ofertado sin IVA y puntos_tecnicos y puntos_economicos si el acta los da, y motivo_exclusion si la excluyen.`,
    '3. Si el documento no dice quién se presentó (solo el adjudicatario o nada), llama con sin_datos=true.',
    'Solo lo que está escrito en el texto: no deduzcas NIF, importes ni puntos. Si la herramienta responde con un error, corrígelo y vuelve a enviarlo. No hagas nada más.',
  ].join('\n');
}

const MAX_PAGINA_TEXTO = 40_000;

export const ConsultaActaMercado = z.object({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  desde: z.number().int().min(0).default(0).describe('Carácter del texto desde el que leer (para documentos largos)'),
});

/** Lo que necesita Hermes para leer el acta: los lotes adjudicados y el texto, por trozos. */
export function actaMercadoParaHermes(db: Db, a: z.infer<typeof ConsultaActaMercado>): Result<unknown> {
  const fila = filaActa(db, a.id);
  if (!fila?.texto) return fail('not_found', `No hay ninguna acta por leer de la licitación «${a.id}».`);
  const l = db.prepare('SELECT titulo, organo_nombre, expediente FROM licitaciones WHERE id = ?').get(a.id) as
    { titulo: string; organo_nombre: string; expediente: string } | undefined;
  const lotes = db
    .prepare(
      `SELECT lote, adjudicatario_nif, adjudicatario_nombre, ofertas, importe_sin_iva AS importe FROM adjudicaciones
    WHERE licitacion_id = ? ORDER BY ord`,
    )
    .all(a.id);
  const hasta = a.desde + MAX_PAGINA_TEXTO;
  return ok({
    id: a.id,
    titulo: l?.titulo ?? null,
    organo: l?.organo_nombre ?? null,
    expediente: l?.expediente ?? null,
    documento: fila.documento_nombre,
    lotes,
    texto: fila.texto.slice(a.desde, hasta),
    siguiente_desde: hasta < fila.texto.length ? hasta : null,
    caracteres: fila.texto.length,
  });
}

const LicitadorHermes = z.strictObject({
  nif: z.string().trim().min(8).max(20),
  nombre: z.string().trim().min(2).max(200).nullable().default(null),
  lote: z.string().trim().max(40).default(''),
  rol: z.enum(['adjudicataria', 'licitadora', 'excluida']),
  importe_ofertado: z.number().positive().max(1e10).nullable().default(null),
  puntos_tecnicos: z.number().min(0).max(1000).nullable().default(null),
  puntos_economicos: z.number().min(0).max(1000).nullable().default(null),
  motivo_exclusion: z.string().trim().min(3).max(600).nullable().default(null),
});

export const GuardarActaMercado = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  licitadores: z
    .array(LicitadorHermes)
    .max(200)
    .default([])
    .describe('Uno por empresa y lote, tal como los da el texto'),
  sin_datos: z.boolean().default(false).describe('true si el documento no dice quién se presentó'),
});

// Un NIF que no está en el texto, con el control mal o de un lote que no existe se rechaza: no se deduce nada.
function problemaLicitador(l: z.infer<typeof LicitadorHermes>, texto: string, lotes: Set<string>): string | null {
  const nif = normalizarNif(l.nif);
  if (estadoNif(nif) === 'no_valido') return `${l.nif}: el NIF no es válido (el control no cuadra).`;
  if (!texto.includes(nif)) return `${l.nif}: ese NIF no está en el texto del documento.`;
  if (!lotes.has(l.lote))
    return `${l.nif}: el lote «${l.lote}» no es ninguno de ${[...lotes].map((x) => `«${x}»`).join(', ')}.`;
  return null;
}

/** Guarda lo que leyó Hermes del acta (fuente «acta»); con sin_datos, la da por leída sin licitadores. */
export function guardarActaMercado(db: Db, e: z.infer<typeof GuardarActaMercado>): Result<{ licitadores: number }> {
  const fila = filaActa(db, e.id);
  if (!fila?.texto || fila.estado !== 'pedida_hermes')
    return fail('conflicto', `La licitación «${e.id}» no tiene ningún acta pedida a Hermes.`);
  if (!e.sin_datos && !e.licitadores.length) return fail('invalid_input', 'Manda los licitadores o sin_datos=true.');
  const texto = textoParaNif(fila.texto);
  const lotes = new Set(
    (
      db.prepare('SELECT DISTINCT lote FROM adjudicaciones WHERE licitacion_id = ?').all(e.id) as { lote: string }[]
    ).map((f) => f.lote),
  );
  const problemas = e.licitadores.map((l) => problemaLicitador(l, texto, lotes)).filter((p): p is string => p !== null);
  if (problemas.length) return fail('invalid_input', problemas.join(' '));
  db.transaction(() => {
    for (const l of e.licitadores) {
      guardarParticipacion(db, {
        licitacion_id: e.id,
        lote: l.lote,
        empresa_nif: normalizarNif(l.nif),
        empresa_nombre: l.nombre,
        rol: l.rol,
        importe_ofertado: l.importe_ofertado,
        puntos_tecnicos: l.puntos_tecnicos,
        puntos_economicos: l.puntos_economicos,
        motivo_exclusion: l.motivo_exclusion,
        fuente: 'acta',
        documento: fila.documento_nombre,
        confianza: CONFIANZA_HERMES,
      });
    }
    db.prepare(
      `UPDATE actas_mercado SET estado = ?, licitadores = ?, texto = NULL, error = NULL WHERE licitacion_id = ?`,
    ).run(e.sin_datos ? 'sin_datos' : 'leida_hermes', e.licitadores.length, e.id);
  })();
  return ok({ licitadores: e.licitadores.length });
}

export type ResumenActasMercado = { por_estado: Record<string, number>; licitadores: number; ultima: string | null };

/** Recuento para Ajustes › Fuentes: cuántas actas en cada estado y cuántos licitadores salieron. */
export function resumenActasMercado(db: Db): ResumenActasMercado {
  const filas = db
    .prepare(
      'SELECT estado, COUNT(*) AS n, SUM(licitadores) AS licitadores, MAX(revisada_en) AS ultima FROM actas_mercado GROUP BY estado',
    )
    .all() as { estado: string; n: number; licitadores: number; ultima: string }[];
  return {
    por_estado: Object.fromEntries(filas.map((f) => [f.estado, f.n])),
    licitadores: filas.reduce((s, f) => s + (f.licitadores ?? 0), 0),
    ultima:
      filas
        .map((f) => f.ultima)
        .sort()
        .at(-1) ?? null,
  };
}
