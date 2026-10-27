// Registro del relleno de anexos: la tool licitaciones_anexo, el tipo de trabajo y la API del paso
// Presentación (checklist, cambios de una fila, relleno y hoja de datos).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Response, Router } from 'express';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { pdfDeDocx } from '../../../nucleo/documentos/libreoffice.js';
import type { OrigenMetricas } from '../../../nucleo/hermes/metricas.js';
import type { DestinoHermes } from '../../../nucleo/hermes/runs.js';
import { fallo, responder } from '../../../nucleo/http.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { registrarTipoTrabajo } from '../../../nucleo/colaTipos.js';
import { dbLicitaciones } from '../db.js';
import { confirmado, conId } from '../http.js';
import type { Db } from '../store.js';
import { rutasDeuc } from './deuc.js';
import { cambiarDocumento, documentoDelGuion, type DocumentoOferta } from './documentos.js';
import { guionVigente } from './guion.js';
import { hojaDeDatos } from './hojaDatos.js';
import { PayloadAnexo, TIPO_ANEXO, anexoRecibido, conClave, recursoAnexo } from './anexosTrabajo.js';
import { type DocumentoConAnexo, conAnexo, documentosOferta } from './anexosChecklist.js';
import { pedirAnexo } from './anexosPedir.js';
import { instruccionesDeAnexo } from './anexosInstrucciones.js';
import { AnexoEntrada } from './anexosGuardado.js';
import { recibirAnexo } from './anexosRecibir.js';
import { logger } from '../../../nucleo/log.js';

const log = logger('licitaciones');

export function herramientaAnexo(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_anexo',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: AnexoEntrada,
    descripcion:
      'Envía el relleno de un anexo (solo en tareas «rellena el modelo»). Modelo Word: la clave del documento, el rango de párrafos del modelo (desde su título «ANEXO …» hasta antes del siguiente) y una sustitución por hueco (párrafo, trozo literal con el hueco, el mismo trozo con el dato de la hoja, y de qué dato sale; un texto que no sale de la hoja va con dato «Redacción» y sus fuentes). Modelo PDF con formulario: la clave y un campo por cada uno que se rellena (nombre exacto, valor y de qué dato de la hoja sale), sin rango ni sustituciones. La plataforma rellena solo esos huecos o campos, rechaza cualquier cambio en el texto del modelo, texto en una firma y un importe sin decidir, y guarda el anexo en Salidas como borrador para que una persona lo revise y lo firme.',
    recurso: (a) => recursoAnexo(a),
    ejecutar: (a) =>
      recibirAnexo({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() }, a, { revisar: true }),
  });
}

/** El trabajo de rellenar un anexo: sin Salidas espera sin gastar el modelo. */
export function registrarTipoAnexo(destino: () => DestinoHermes | null, metricas: OrigenMetricas): void {
  registrarTipoTrabajo(TIPO_ANEXO, {
    metricas,
    destino: () => (nucleo().config.salidasDir ? destino() : null),
    instrucciones: (p) => instruccionesDeAnexo(dbLicitaciones(), nucleo().db, PayloadAnexo.parse(p)),
    hecho: (p) => {
      const { id, clave, pedida_en } = PayloadAnexo.parse(p);
      return anexoRecibido(dbLicitaciones(), id, clave, pedida_en);
    },
  });
}

// Un .docx sin PDF: se genera al lado (versión nueva, sin pisar nada) para que el paquete lo lleve.
async function conPdf(db: Db, raices: Raices, id: string, doc: DocumentoOferta): Promise<DocumentoOferta> {
  if (!doc.ruta || doc.ruta_pdf || !doc.ruta.toLowerCase().endsWith('.docx')) return doc;
  const abs = documentoEnDisco(raices, doc.ruta);
  if (abs.error || !fs.existsSync(abs.data)) return doc;
  const { pdf, aviso } = await pdfDeDocx(await fsp.readFile(abs.data));
  if (!pdf) {
    if (aviso) log.warn('PDF de un documento sin generar', { licitacion: id, clave: doc.clave });
    return doc;
  }
  const ruta = escribirJunto(abs.data, doc.ruta, pdf);
  if (ruta.error) return doc;
  db.prepare('UPDATE oferta_documentos SET ruta_pdf = ? WHERE licitacion_id = ? AND clave = ?').run(
    ruta.data,
    id,
    doc.clave,
  );
  return { ...doc, ruta_pdf: ruta.data };
}

// «Anexo VI.docx» → «Anexo VI.pdf» (o «Anexo VI-2.pdf» si ya hay uno): nunca se pisa.
function escribirJunto(abs: string, ruta: string, bytes: Buffer): Result<string> {
  const baseAbs = abs.slice(0, -path.extname(abs).length);
  const baseRuta = ruta.slice(0, -path.extname(ruta).length);
  for (let n = 1; n < 50; n += 1) {
    const sufijo = n === 1 ? '' : `-${n}`;
    try {
      fs.writeFileSync(`${baseAbs}${sufijo}.pdf`, bytes, { flag: 'wx' });
      return ok(`${baseRuta}${sufijo}.pdf`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return fail('io_error', errorMessage(err).slice(0, 200));
    }
  }
  return fail('io_error', 'Demasiadas versiones del PDF.');
}

async function cambiar(id: string, clave: string, cambios: unknown): Promise<Result<DocumentoConAnexo>> {
  const db = dbLicitaciones();
  const cambiado = cambiarDocumento(db, id, clave, cambios);
  if (cambiado.error) return cambiado;
  const doc = await conPdf(db, raicesActuales(), id, cambiado.data);
  const g = guionVigente(db, id);
  const d = g ? documentoDelGuion(g.datos, clave) : null;
  return d
    ? ok(await conAnexo({ db, raices: raicesActuales(), id }, d, doc))
    : fail('not_found', `El guion vigente no tiene el documento «${clave}».`);
}

/** API del paso Presentación: checklist, cambios de una fila, hoja de datos y relleno de anexos. */
export function rutasDocumentosOferta(r: Router): void {
  const error = (res: Response) => fallo(res, 'documentos de la oferta', 'licitaciones');
  r.get(
    '/licitaciones/:id/oferta/documentos',
    conId((id, _req, res) => {
      documentosOferta(dbLicitaciones(), raicesActuales(), id).then((x) => responder(res, x), error(res));
    }),
  );
  r.patch(
    '/licitaciones/:id/oferta/documentos/:clave',
    conId(
      conClave((id, clave, req, res) => {
        cambiar(id, clave, req.body ?? {}).then((x) => responder(res, x), error(res));
      }),
    ),
  );
  r.post(
    '/licitaciones/:id/oferta/documentos/:clave/anexo',
    conId(
      conClave((id, clave, req, res) => {
        pedirAnexo({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() }, id, clave, {
          confirmado: confirmado(req),
        }).then((x) => responder(res, x, 202), error(res));
      }),
    ),
  );
  r.get(
    '/licitaciones/:id/oferta/hoja-datos',
    conId((id, _req, res) => responder(res, hojaDeDatos(dbLicitaciones(), nucleo().db, id))),
  );
  rutasDeuc(r);
}
