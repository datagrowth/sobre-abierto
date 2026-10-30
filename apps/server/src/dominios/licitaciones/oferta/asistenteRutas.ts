// API web del asistente de la oferta: las preguntas con su estado, responder, el hilo y
// «OK, generar los documentos» con el plan por sobres; y la Revisión por sobre y documento.
import type { Router } from 'express';
import { nucleo } from '../../../nucleo/contexto.js';
import { fallo, responder as responderHttp } from '../../../nucleo/http.js';
import { actorDe, quienDe } from '../../../nucleo/permisos.js';
import { raicesActuales } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { hiloDe } from './asistenteHilo.js';
import { cerrarLecturasFallidas } from './asistenteInterpretar.js';
import { generarDocumentos, planDeGeneracion } from './asistenteGenerar.js';
import { preguntasDeOferta } from './asistentePreguntas.js';
import { responder } from './asistenteRespuestas.js';
import { revisionPorSobres } from './revisionSobres.js';
import { pasarAComprobaciones, preguntarAlPliego, preguntasDe } from '../preguntasPliego.js';

const errorDe = (que: string) => (res: Parameters<typeof fallo>[0]) => fallo(res, que, 'licitaciones');

export function rutasAsistente(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/preguntas',
    conId((id, _req, res) => {
      preguntasDeOferta(dbLicitaciones(), nucleo().db, id).then(
        (x) => responderHttp(res, x),
        errorDe('preguntas de la oferta')(res),
      );
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/respuestas',
    conId((id, req, res) => {
      responder(dbLicitaciones(), nucleo().db, id, req.body ?? {}, actorDe(req)).then(
        (x) => responderHttp(res, x, x.data?.estado === 'interpretando' ? 202 : 200),
        errorDe('respuesta de la oferta')(res),
      );
    }),
  );
  r.get(
    '/licitaciones/:id/oferta/sobres',
    conId((id, _req, res) => responderHttp(res, revisionPorSobres(dbLicitaciones(), nucleo().db, id))),
  );
  r.get(
    '/licitaciones/:id/oferta/hilo',
    conId((id, _req, res) => {
      cerrarLecturasFallidas(dbLicitaciones(), nucleo().db, id);
      res.json({ mensajes: hiloDe(dbLicitaciones(), id) });
    }),
  );
  r.get(
    '/licitaciones/:id/oferta/generar',
    conId((id, _req, res) => {
      planDeGeneracion(dbLicitaciones(), nucleo().db, id).then(
        (x) => responderHttp(res, x),
        errorDe('plan de documentos')(res),
      );
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/generar',
    conId((id, req, res) => {
      generarDocumentos(dbLicitaciones(), nucleo().db, raicesActuales(), id, quienDe(req)).then(
        (x) => responderHttp(res, x, 202),
        errorDe('documentos de la oferta')(res),
      );
    }),
  );
  // Preguntar al pliego: la caja de la ficha; preguntar encola un trabajo (editor, como toda escritura).
  r.get(
    '/licitaciones/:id/preguntas',
    conId((id, _req, res) => {
      res.json({ preguntas: preguntasDe(dbLicitaciones(), id) });
    }),
  );
  r.post(
    '/licitaciones/:id/preguntas',
    conId((id, req, res) =>
      responderHttp(res, preguntarAlPliego(dbLicitaciones(), nucleo().db, id, req.body ?? {}, quienDe(req)), 202),
    ),
  );
  r.put(
    '/licitaciones/:id/preguntas/:n/comprobaciones',
    conId((id, req, res) => {
      const n = Number(req.params.n);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: 'invalid_input', message: 'Pregunta no válida.' });
        return;
      }
      responderHttp(res, pasarAComprobaciones(dbLicitaciones(), id, n, req.body ?? {}));
    }),
  );
}
