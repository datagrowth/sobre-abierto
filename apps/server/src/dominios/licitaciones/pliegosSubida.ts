// Subida manual de un pliego que la plataforma no trae (una rectificación, un anexo que solo se ve en la página).
import crypto from 'node:crypto';
import path from 'node:path';
import type { Db, FilaLicitacion } from './store.js';
import { ahora } from '../../nucleo/db.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { logger } from '../../nucleo/log.js';
import { emitir } from '../../nucleo/eventos.js';
import { guardarDocumentoNuevo } from '../../nucleo/documentos.js';
import type { ArchivoRecibido } from '../../nucleo/subidas.js';
import { pedirReescaneo } from '../../biblioteca/motor/documentos/servicioIndice.js';
import {
  carpetaPliegos,
  conExtension,
  esPeticionDeuc,
  guardarEntradasZip,
  tipoDeDocumento,
  type ClaseDocumento,
  type Pendiente,
} from './pliegos.js';
import { esperaPorCarpeta } from './presentadas.js';

// Lo sube una persona desde la web. Se guarda donde van los demás pliegos de la licitación, sin pisar nada, y
// queda registrado como uno más (origen «manual», con quién lo subió): la Biblioteca lo indexa y la cadena
// rehace la ficha si es una rectificación (fichaPorRehacer mira los pliegos que llegan después de la ficha).
export const MAX_PLIEGO_SUBIDA = 60 * 1024 * 1024;
// Lo que la Biblioteca lee (y el ZIP que los trae, y la petición del DEUC): nada que se ejecute.
export const EXTENSIONES_PLIEGO = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.odt', '.ods', '.zip', '.xml'];
export const EVENTO_PLIEGOS = 'licitacion.pliegos';
const log = logger('licitaciones.pliegos.subida');

export type PliegoSubido = { guardados: { nombre: string; ruta: string }[]; duplicado: string | null };
type Subida = {
  db: Db;
  raiz: string;
  l: FilaLicitacion;
  archivo: ArchivoRecibido;
  quien: string;
  ext: string;
  sha256: string;
};

// La clase la da el feed; lo subido no la trae: se deduce del nombre como lo llama el órgano.
function claseSegunNombre(nombre: string): ClaseDocumento {
  if (/\bpcap\b|cl[aá]usulas\s+administrativas/i.test(nombre)) return 'pcap';
  if (/\bppt\b|prescripciones\s+t[eé]cnicas/i.test(nombre)) return 'ppt';
  return 'adicional';
}

// Por los bytes, no por el nombre: un ZIP llamado «.pdf» se descomprime y un ejecutable
// renombrado no entra aunque diga ser un documento.
function tipoAdmitido(archivo: ArchivoRecibido): Result<string> {
  if (!EXTENSIONES_PLIEGO.includes(path.extname(archivo.nombre).toLowerCase())) {
    return fail('invalid_input', `Formato no admitido: sube un archivo ${EXTENSIONES_PLIEGO.join(', ')}.`);
  }
  const tipo = tipoDeDocumento(archivo.datos, archivo.nombre);
  if (tipo.error) return fail('invalid_input', tipo.error.message);
  return EXTENSIONES_PLIEGO.includes(tipo.data)
    ? tipo
    : fail(
        'invalid_input',
        `El archivo es en realidad un «${tipo.data}»: no es un documento del pliego que se pueda leer.`,
      );
}

function yaSubido(db: Db, id: string, sha256: string): string | null {
  const f = db
    .prepare('SELECT nombre FROM pliegos WHERE licitacion_id = ? AND sha256 = ? ORDER BY rowid LIMIT 1')
    .get(id, sha256) as { nombre: string } | undefined;
  return f?.nombre ?? null;
}

function registrar(
  s: Subida,
  fila: { url: string; nombre: string; estado: string; ruta: string | null; tipo: string | null },
): void {
  s.db
    .prepare(
      `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, sha256, origen, tipo, subido_por, actualizado_en)
    VALUES (@id, @url, @clase, @nombre, @estado, @ruta, @sha256, 'manual', @tipo, @quien, @ts)`,
    )
    .run({
      ...fila,
      id: s.l.id,
      clase: claseSegunNombre(s.archivo.nombre),
      sha256: s.sha256,
      quien: s.quien,
      ts: ahora(),
    });
}

async function guardarSuelto(s: Subida, carpeta: string): Promise<Result<PliegoSubido>> {
  const nombre = conExtension(s.archivo.nombre, s.ext);
  const g = await guardarDocumentoNuevo(s.db, s.raiz, {
    rel: path.posix.join(carpeta, nombre),
    bytes: s.archivo.datos,
    dominio: 'licitaciones',
    origenUrl: null,
  });
  if (g.error) return g;
  const tipo = s.ext === '.xml' && esPeticionDeuc(s.archivo.datos) ? 'deuc' : null;
  registrar(s, { url: `manual:${s.sha256}`, nombre, estado: 'descargado', ruta: g.data.ruta, tipo });
  return ok({ guardados: [{ nombre, ruta: g.data.ruta }], duplicado: g.data.nuevo ? null : g.data.ruta });
}

// El ZIP queda como un pliego «descomprimido» (padre) y cada documento de dentro, uno más, por
// el mismo camino que un ZIP publicado. Si no se puede abrir, no queda nada a medias.
async function guardarZip(s: Subida, carpeta: string): Promise<Result<PliegoSubido>> {
  const url = `manual:${s.sha256}`;
  registrar(s, { url, nombre: s.archivo.nombre, estado: 'descomprimido', ruta: null, tipo: null });
  const padre: Pendiente = {
    licitacion_id: s.l.id,
    url,
    nombre: s.archivo.nombre,
    clase: claseSegunNombre(s.archivo.nombre),
    intentos: 0,
    fecha_limite: s.l.fecha_limite,
  };
  const g = await guardarEntradasZip(s.db, s.raiz, carpeta, padre, s.archivo.datos);
  if (g.error) {
    s.db.prepare('DELETE FROM pliegos WHERE licitacion_id = ? AND (url = ? OR padre_url = ?)').run(s.l.id, url, url);
    return g;
  }
  s.db.prepare('UPDATE pliegos SET subido_por = ? WHERE licitacion_id = ? AND padre_url = ?').run(s.quien, s.l.id, url);
  const guardados = s.db
    .prepare('SELECT nombre, ruta FROM pliegos WHERE licitacion_id = ? AND padre_url = ? ORDER BY rowid')
    .all(s.l.id, url) as PliegoSubido['guardados'];
  return ok({ guardados, duplicado: null });
}

async function guardarSubida(s: Subida): Promise<Result<PliegoSubido>> {
  const previo = yaSubido(s.db, s.l.id, s.sha256);
  if (previo) return fail('conflicto', `Ya está: «${previo}»`);
  // Como la descarga: con la carpeta de presentada aún sin llegar al disco, se separaría del resto.
  if (esperaPorCarpeta(s.db, s.raiz, s.l.id))
    return fail('conflicto', 'La carpeta de la oferta presentada aún se está creando: prueba en unos minutos.');
  const carpeta = carpetaPliegos(s.db, s.l);
  return s.ext === '.zip' ? guardarZip(s, carpeta) : guardarSuelto(s, carpeta);
}

/** Guarda y registra un pliego subido a mano; la Biblioteca lo indexa en cuanto puede. */
export async function subirPliego(
  db: Db,
  raiz: string,
  id: string,
  archivo: ArchivoRecibido,
  quien: string,
): Promise<Result<PliegoSubido>> {
  const tipo = tipoAdmitido(archivo);
  if (tipo.error) return tipo;
  try {
    const l = db.prepare('SELECT * FROM licitaciones WHERE id = ?').get(id) as FilaLicitacion | undefined;
    if (!l) return fail('not_found', 'La licitación no existe.');
    const sha256 = crypto.createHash('sha256').update(archivo.datos).digest('hex');
    const r = await guardarSubida({ db, raiz, l, archivo, quien, ext: tipo.data, sha256 });
    if (r.error) return r;
    pedirReescaneo();
    emitir(db, {
      tipo: EVENTO_PLIEGOS,
      dominio: 'licitaciones',
      recurso: id,
      datos: { accion: 'subido', documentos: r.data.guardados.length },
    });
    log.info('pliego subido a mano', { licitacion: id, documentos: r.data.guardados.length, tipo: tipo.data });
    return r;
  } catch (err) {
    // El mensaje interno puede llevar rutas del disco o SQL: al log, y a la web uno genérico.
    log.error('pliego sin subir', { licitacion: id, error: errorMessage(err).slice(0, 200) });
    return fail('io_error', 'No se pudo guardar el pliego: prueba de nuevo en unos minutos.');
  }
}
