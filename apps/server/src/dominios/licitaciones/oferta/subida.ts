// Una versión de la memoria que una persona editó en Word y sube desde la web.
import crypto from 'node:crypto';
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { paginasDe } from '../../../nucleo/documentos/paginas.js';
import fs from 'node:fs';
import path from 'node:path';
import { contenidoDocx, dimensionesImagen, type ContenidoDocx } from '../../../nucleo/documentos/leerDocx.js';
import { documentoEnDisco } from '../../../nucleo/salidas.js';
import type { ArchivoRecibido } from '../../../nucleo/subidas.js';
import type { Db } from '../store.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import { avisoDescartadas, descartarVersionesSinRevisar } from '../propuestas/revision.js';
import { autoevaluar, escribir, filaMemoria, type FilaMemoria } from './ensamblado.js';
import { avisosDeFugas, contextoFugasDe, fugasDeApartados } from './fugasMemoria.js';
import type { DependenciasApartado } from './dependencias.js';
import { decisionesDe, lotesDecididos } from './decisiones.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { lotesMencionados } from './lotesMencionados.js';
import { lotesDeMemoria } from './memoriaLote.js';
import { baseDependencias, dependenciasDeTexto } from './memoria.js';
import {
  caracteresDe,
  CARACTERES_POR_PAGINA,
  paginasEstimadasDe,
  textoDeBloque,
  type ApartadoDatosData,
} from './memoriaRevision.js';
import { apartadosDeTexto, type ImagenGuardada } from './memoriaTexto.js';
import { pedirLecciones } from './lecciones.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { subidaFlexible } from './subidaFlexible.js';
import { seccionSinApartado } from './textoEntero.js';

// El .docx se guarda tal cual en Salidas (es el documento que se presenta, con sus imágenes y su formato), con
// su PDF y páginas reales si hay LibreOffice, y pasa a ser la versión siguiente: entra pendiente de revisar,
// Hermes la evalúa sola y desde ella se pueden pedir cambios. Para eso su texto se reparte por los apartados del
// guion (memoriaTexto.ts).
export const MAX_MEMORIA_SUBIDA = 30 * 1024 * 1024;
const log = logger('licitaciones.memoria');

// aprende: se pidió a Hermes que saque lecciones de los cambios (y de la nota); descartadas: las
// versiones sin revisar que la subida dejó atrás (quedan dichas en los avisos de la nueva).
export type MemoriaSubida = {
  memoria: number;
  version: number;
  borrador: number;
  ruta: string;
  reconocidos: number;
  total: number;
  paginas: number | null;
  avisos: string[];
  aprende: boolean;
  descartadas: number[];
  lote: string | null;
};
type Registrada = { memoria: number; borrador: number; descartadas: number[] };
// lote: de qué lote es la versión si el pliego pide una memoria por lote (memoriaLote.ts); null = común.
type Base = {
  l: { id: string; expediente: string };
  guion: GuionGuardado;
  version: number;
  anterior: number | null;
  anteriorId: number | null;
  lote: string | null;
};
type Troceo = { datos: (ApartadoDatosData | null)[]; avisos: string[] };

const CampoLote = z.string().trim().max(20).optional();
const unaDe = (lotes: string[]): string =>
  lotes.length > 1 ? `${lotes.slice(0, -1).join(', ')} o ${lotes.at(-1)}` : (lotes[0] ?? '');

const VERSION_EN_NOMBRE = /memoria-v(\d+)/i;

// La web aún no manda «lote» (su selector llega con la d): sin él, el lote se deduce del
// nombre del Word («memoria-v5.docx», la versión que se descargó; «… lote 4 …») o, si solo un
// lote tiene una versión pendiente de revisar, de ese. Si no se puede saber, se pregunta.
function loteDeducido(db: Db, id: string, lotes: string[], nombre: string): string | null {
  const version = VERSION_EN_NOMBRE.exec(nombre)?.[1];
  const deVersion = version
    ? (
        db.prepare('SELECT lote FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, Number(version)) as
          { lote: string | null } | undefined
      )?.lote
    : null;
  if (deVersion && lotes.includes(deVersion)) return deVersion;
  const nombrados = lotesMencionados(nombre.replace(/[_.-]+/g, ' '), lotes);
  if (nombrados.length === 1) return nombrados[0]!;
  const pendientes = (
    db
      .prepare(
        `SELECT DISTINCT m.lote FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND b.estado = 'pendiente' AND m.ensayo = 0 AND m.lote IS NOT NULL`,
      )
      .all(id) as { lote: string }[]
  )
    .map((f) => f.lote)
    .filter((l) => lotes.includes(l));
  return pendientes.length === 1 ? pendientes[0]! : null;
}

// Con memoria por lote, cada Word es de un lote: el que se diga o el que se deduzca; si no, va sin lote (la común).
function loteDeSubida(
  db: Db,
  id: string,
  guion: GuionGuardado,
  archivo: Pick<ArchivoRecibido, 'nombre' | 'campos'>,
): Result<string | null> {
  const campo = CampoLote.safeParse(archivo.campos['lote']);
  if (!campo.success) return fail('invalid_input', '«lote» es el id de un lote (hasta 20 caracteres).');
  const lote = campo.data || null;
  const lotes = lotesDeMemoria(guion.datos, lotesDecididos(db, id, decisionesDe(db, id)?.datos.lotes ?? []));
  if (!lotes)
    return lote === null
      ? ok(null)
      : fail(
          'invalid_input',
          `El pliego pide una sola memoria para toda la oferta: súbela sin lote (no como la del lote «${lote}»).`,
        );
  const elegido = lote ?? loteDeducido(db, id, lotes, archivo.nombre);
  if (elegido === null) return fail('invalid_input', `Di de qué lote es esta memoria: ${unaDe(lotes)}.`);
  return lotes.includes(elegido)
    ? ok(elegido)
    : fail(
        'invalid_input',
        `El lote «${elegido}» no es de esta oferta: las memorias son de los lotes ${lotes.join(', ')}.`,
      );
}

function comprobar(db: Db, id: string, archivo: Pick<ArchivoRecibido, 'nombre' | 'campos'>): Result<Base> {
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(id) as Base['l'] | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id ${id}.`);
  const guion = guionVigente(db, id);
  if (!guion?.datos.memoria?.apartados.length)
    return fail(
      'conflicto',
      'Esta licitación aún no tiene guion con memoria técnica: hace falta para saber qué apartados lleva.',
    );
  const lote = loteDeSubida(db, id, guion, archivo);
  if (lote.error) return lote;
  const memorias = db
    .prepare('SELECT id, version, estado, ensayo, lote FROM memorias WHERE licitacion_id = ? ORDER BY version DESC')
    .all(id) as Pick<FilaMemoria, 'id' | 'version' | 'estado' | 'ensayo' | 'lote'>[];
  // Un ensayo en curso (horas con la memoria) no frena la memoria de la oferta, ni la de otro lote: van por su lado.
  const delLote = memorias.filter((m) => !m.ensayo && (m.lote ?? null) === lote.data);
  if (delLote.some((m) => m.estado === 'redactando' || m.estado === 'ensamblando'))
    return fail('conflicto', 'Hay una versión redactándose: espera a que termine antes de subir otra.');
  // El Word se edita sobre la memoria de la oferta (de su lote), no sobre una de ensayo: esa es la anterior.
  const anterior = delLote[0];
  return ok({
    l,
    guion,
    version: (memorias[0]?.version ?? 0) + 1,
    anterior: anterior?.version ?? null,
    anteriorId: anterior?.id ?? null,
    lote: lote.data,
  });
}

function leer(docx: Buffer, guion: GuionGuardado): Result<{ contenido: ContenidoDocx; titulos: string[] }> {
  if (docx.subarray(0, 2).toString('latin1') !== 'PK')
    return fail('invalid_input', 'No es un Word (.docx): guárdalo como «Documento de Word» y vuelve a subirlo.');
  const c = contenidoDocx(docx);
  if (c.error) return fail('invalid_input', `No se puede leer el Word: ${c.error.message}`);
  // Sin ningún título no llega aquí: subidaFlexible.ts la guarda entera.
  return ok({ contenido: c.data, titulos: guion.datos.memoria!.apartados.map((a) => a.titulo) });
}

// Las imágenes del Word (PNG o JPEG) se guardan junto a la versión para volver a meterlas en las
// que monte la plataforma: Salidas/…/memoria-vN-imagenes/imagen-K.png.
function guardarImagenes(
  raices: Raices,
  carpeta: string,
  version: number,
  c: ContenidoDocx,
): Result<Map<string, ImagenGuardada>> {
  const usadas = [...new Set(c.elementos.flatMap((e) => (e.tipo === 'parrafo' ? e.imagenes : [])))].filter((id) =>
    c.imagenes.has(id),
  );
  const out = new Map<string, ImagenGuardada>();
  if (!usadas.length) return ok(out);
  const sub = `${carpeta}/memoria-v${version}-imagenes`;
  const dir = documentoEnDisco(raices, sub);
  if (dir.error) return dir;
  fs.mkdirSync(dir.data, { recursive: true });
  usadas.forEach((id, k) => {
    const img = c.imagenes.get(id)!;
    const dim = dimensionesImagen(img);
    if (!dim) return;
    const nombre = `imagen-${k + 1}.${img.tipo}`;
    fs.writeFileSync(path.join(dir.data, nombre), img.datos);
    out.set(id, { ruta: `${sub}/${nombre}`, ...dim });
  });
  return ok(out);
}

function markdown(b: Base, t: Troceo, nombre: string): string {
  const apartados = b.guion.datos.memoria!.apartados.flatMap((a, i) => {
    const d = t.datos[i];
    return [
      `## ${i + 1}. ${a.titulo}`,
      '',
      d ? d.bloques.map(textoDeBloque).join('\n\n') : '[No se encontró en el Word subido]',
      '',
    ];
  });
  return [
    `# Memoria técnica v${b.version}${b.lote ? ` · lote ${b.lote}` : ''}`,
    '',
    `Subida a mano («${nombre}»). Las imágenes y el formato están en el .docx.`,
    '',
    ...apartados,
  ].join('\n');
}

// Lo subido lo editó una persona (editado = 1): una regeneración no lo pisa sin avisar. Sus
// dependencias salen de su texto, como las de un apartado que redacta Hermes.
const insertarApartado = (
  db: Db,
  memoria: number,
  a: { n: number; d: ApartadoDatosData | null; dependencias: DependenciasApartado | null },
  ahora: string,
) => {
  const { n, d } = a;
  const caracteres = d ? caracteresDe(d.bloques) : null;
  db.prepare(
    `INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, agente, recibido_en, error, dependencias, editado)
    VALUES (?, ?, ?, ?, ?, ?, 'persona', ?, ?, ?, 1)`,
  ).run(
    memoria,
    n,
    d ? 'recibido' : 'fallido',
    d ? JSON.stringify(d) : null,
    caracteres,
    caracteres === null ? null : paginasEstimadasDe(caracteres),
    ahora,
    d ? null : 'No se encontró en el Word subido.',
    JSON.stringify(a.dependencias ?? {}),
  );
};

type Guardado = {
  docx: Buffer;
  nombre: string;
  notas: string | null;
  rutas: { ruta: string; ruta_pdf: string | null; ruta_md: string; ruta_json: string };
  paginas: number | null;
};

// La versión, sus apartados y su borrador, juntos: uno sin los otros dejaría la web sin enlace.
function registrar(db: Db, b: Base, t: Troceo, g: Guardado): Registrada {
  const ahora = new Date().toISOString();
  const estimadas =
    Math.round((t.datos.reduce((n, d) => n + (d ? caracteresDe(d.bloques) : 0), 0) / CARACTERES_POR_PAGINA) * 10) / 10;
  const base = baseDependencias(db, b.guion);
  return db.transaction(() => {
    const memoria = Number(
      db
        .prepare(
          `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, avisos, version_base, apartados_rehechos, subida, notas_subida, lote)
      VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, ?, '[]', ?, ?, ?)`,
        )
        .run(
          b.l.id,
          b.guion.id,
          b.version,
          ahora,
          ahora,
          JSON.stringify(t.avisos),
          b.anterior,
          g.nombre,
          g.notas,
          b.lote,
        ).lastInsertRowid,
    );
    t.datos.forEach((d, i) =>
      insertarApartado(
        db,
        memoria,
        { n: i + 1, d, dependencias: d ? dependenciasDeTexto(base, b.guion, i + 1, d) : null },
        ahora,
      ),
    );
    const reconocidos = t.datos.filter(Boolean).length;
    const resumen = `Memoria técnica v${b.version} subida a mano («${g.nombre}»): ${reconocidos} de ${t.datos.length} apartados reconocidos.`;
    const borrador = Number(
      db
        .prepare(
          `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, memoria_id,
        paginas_estimadas, paginas, ruta_pdf, ruta_md, ruta_json) VALUES (?, ?, ?, ?, ?, 'persona', ?, 'ensamblado', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          b.l.id,
          g.rutas.ruta,
          crypto.createHash('sha256').update(g.docx).digest('hex'),
          g.docx.length,
          resumen,
          ahora,
          b.guion.id,
          b.version,
          memoria,
          estimadas,
          g.paginas,
          g.rutas.ruta_pdf,
          g.rutas.ruta_md,
          g.rutas.ruta_json,
        ).lastInsertRowid,
    );
    const descartadas = descartarVersionesSinRevisar(db, b.l.id, borrador, b.version);
    const dicho = avisoDescartadas(b.version, descartadas);
    db.prepare('UPDATE memorias SET borrador_id = ?, avisos = ? WHERE id = ?').run(
      borrador,
      JSON.stringify(dicho ? [...t.avisos, dicho] : t.avisos),
      memoria,
    );
    return { memoria, borrador, descartadas };
  })();
}

async function pdfYPaginas(docx: Buffer): Promise<{ pdf: Buffer | null; paginas: number | null }> {
  const r = await paginasDe(docx);
  return r.error ? { pdf: null, paginas: null } : { pdf: r.data.pdf, paginas: r.data.paginas };
}

// Lo editado a mano también puede delatar el archivo de los automáticos: queda como aviso y
// «Dar por buena» pide el motivo para anularlo.
function conFugas(db: Db, guion: GuionGuardado, t: Troceo): Troceo {
  const fugas = fugasDeApartados(guion, t.datos, contextoFugasDe(db, guion));
  return fugas.length ? { ...t, avisos: [...avisosDeFugas(fugas), ...t.avisos] } : t;
}

// Lo que la persona escribe al subirla: opcional y sin límite (lo que haga falta contar).
const leerNotas = (campos: Record<string, string>): string | null => (campos['notas'] ?? '').trim() || null;

// Hermes aprende de la versión subida si tiene con qué compararla o la persona dijo algo.
function aprender(db: Db, b: Base, memoriaId: number, notas: string | null): boolean {
  const conBase =
    b.anteriorId !== null &&
    Boolean(
      db.prepare("SELECT 1 FROM memoria_apartados WHERE memoria_id = ? AND estado = 'recibido'").get(b.anteriorId),
    );
  if (!conBase && !notas) return false;
  try {
    // Null: la oferta ya llegó a su tope de lecciones del día y no se encoló nada.
    return (
      pedirLecciones(
        nucleo().db,
        { id: memoriaId, licitacion_id: b.l.id, version: b.version },
        conBase ? b.anteriorId : null,
      ) !== null
    );
  } catch (err) {
    log.warn('lecciones sin pedir', { licitacion: b.l.id, version: b.version, error: errorMessage(err).slice(0, 200) });
    return false;
  }
}

/** Guarda el Word subido como la versión siguiente de la memoria y pide su evaluación y sus lecciones. */
export async function subirMemoria(
  db: Db,
  id: string,
  archivo: ArchivoRecibido,
  raices: Raices = raicesActuales(),
): Promise<Result<MemoriaSubida>> {
  const notas = leerNotas(archivo.campos);
  const b = comprobar(db, id, archivo);
  if (b.error) return b;
  const flexible = await subidaFlexible(db, b.data, archivo, raices);
  if (flexible) return flexible;
  const leido = leer(archivo.datos, b.data.guion);
  if (leido.error) return leido;
  const imagenes = guardarImagenes(raices, carpetaSalidas(b.data.l), b.data.version, leido.data.contenido);
  if (imagenes.error) return imagenes;
  const t = {
    data: conFugas(
      db,
      b.data.guion,
      apartadosDeTexto(leido.data.contenido.elementos, leido.data.titulos, imagenes.data),
    ),
  };
  const { pdf, paginas } = await pdfYPaginas(archivo.datos);
  const json = JSON.stringify(
    { licitacion: id, version: b.data.version, subida: archivo.nombre, apartados: t.data.datos },
    null,
    2,
  );
  const rutas = escribir(raices, carpetaSalidas(b.data.l), b.data.version, {
    docx: archivo.datos,
    pdf,
    md:
      markdown(b.data, t.data, archivo.nombre) + seccionSinApartado(leido.data.contenido.elementos, leido.data.titulos),
    json,
  });
  if (rutas.error) return rutas;
  let r: Registrada;
  try {
    r = registrar(db, b.data, t.data, {
      docx: archivo.datos,
      nombre: archivo.nombre,
      notas,
      rutas: rutas.data,
      paginas,
    });
  } catch (err) {
    log.error('memoria subida sin registrar', {
      licitacion: id,
      version: b.data.version,
      error: errorMessage(err).slice(0, 200),
    });
    return fail(
      'conflicto',
      'No se pudo registrar la versión (¿se subió otra a la vez?): recarga y vuelve a intentarlo.',
    );
  }
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'subida', version: b.data.version, ...(b.data.lote ? { lote: b.data.lote } : {}) },
  });
  emitir(db, {
    tipo: 'licitacion.borrador',
    dominio: 'licitaciones',
    recurso: id,
    datos: { agente: 'persona', borrador: r.borrador },
  });
  autoevaluar(db, filaMemoria(db, r.memoria)!, rutas.data.ruta);
  const aprende = aprender(db, b.data, r.memoria, notas);
  const reconocidos = t.data.datos.filter(Boolean).length;
  return ok({
    ...r,
    version: b.data.version,
    ruta: rutas.data.ruta,
    reconocidos,
    total: t.data.datos.length,
    paginas,
    avisos: t.data.avisos,
    aprende,
    lote: b.data.lote,
  });
}
