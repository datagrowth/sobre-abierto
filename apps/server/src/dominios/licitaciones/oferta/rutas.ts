// API web de la oferta (/api/licitaciones/licitaciones/:id/oferta…): guion, decisiones y memoria.
import { rutasAsistente } from './asistenteRutas.js';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { Bandera, fallo, invalido, responder } from '../../../nucleo/http.js';
import { logger } from '../../../nucleo/log.js';
import { actorDe, conQuien, quienDe } from '../../../nucleo/permisos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { raicesActuales } from '../../../nucleo/salidas.js';
import { trabajoEnCurso, type EnCurso } from '../../../nucleo/colaConsultas.js';
import { dbLicitaciones } from '../db.js';
import { fichasDe } from '../ficha.js';
import { confirmado, conId } from '../http.js';
import { rutasDocumentosOferta } from './anexosRutas.js';
import { rutasComprobaciones } from './comprobacionesRutas.js';
import { rutasRevisionHermes } from './revisionHermes.js';
import { rutasDiffPropuesta } from './diffPropuesta.js';
import { rutasResumenMemoria } from './resumenMemoria.js';
import { rutasApartadosAfectados } from './apartadosAfectados.js';
import { actualizarMemoria } from './actualizarMemoria.js';
import { CambioImpacto } from './dependencias.js';
import { rutasVistaAnexo } from './vistaAnexo.js';
import { rutasApartadoTexto } from './apartadoTexto.js';
import {
  decisionesDe,
  decisionesVigentes,
  guardarDecisiones,
  lotesDecididos,
  type DecisionesGuardadas,
} from './decisiones.js';
import { guardarSeccion } from './decisionesSecciones.js';
import { deshacerDecisiones, historialDecisiones } from './decisionesHistorial.js';
import { ensamblarEnFondo, filaMemoria, remontarMemoria } from './ensamblado.js';
import { avanzarMemoria, ensamblarYa } from './avanceMemoria.js';
import { aprobarFicha, fichaDe, type FichaSolucion } from './fichaSolucion.js';
import type { CambiosGuion } from './guionDiff.js';
import {
  guionDeOtrosLotes,
  guionVigente,
  pedirGuion,
  pliegosSinLeer,
  TIPO_GUION,
  type GuionBaseData,
} from './guion.js';
import { memoriasDe, pedirMemoria, type EstadoMemoria } from './memoria.js';
import { lotesDeMemoria } from './memoriaLote.js';
import { MAX_MEMORIA_SUBIDA, subirMemoria } from './subida.js';
import { EXTENSIONES_PRESENTADA, ofertaCerrada, rutasMemoriaPresentada } from './memoriaPresentada.js';
import { estadoPlazo } from './plazo.js';
import { revisarLeccion } from './lecciones.js';
import { revisarDelLibro } from './libroLecciones.js';
import { AjusteAlcance, ajustarAlcance, aprendizajeDe, Retirada, retirarLeccion } from './aprendizajeVista.js';
import { comparacionesDe, RespuestaPorque, responderPorque } from './comparacionMemoria.js';
import { Revision } from '../propuestas/revision.js';
import { recibirArchivo } from '../../../nucleo/subidas.js';
import { evaluarMemoria } from './reevaluar.js';
import { preciosSugeridos, type PrecioSugerido } from './precioSugerido.js';
import { coherenciaOferta, type Incoherencia } from './coherencia.js';
import {
  pedirPropuestaDecisiones,
  propuestaDecisionesDe,
  TIPO_PROPUESTA_DECISIONES,
  type PropuestaGuardada,
} from './propuestaDecisiones.js';
import { estadoPaquete, generarPaquete, paqueteVigente, type PaqueteVigente } from './paquete.js';
import { hermesEnVivo, type HermesEnVivo } from './hermesEnVivo.js';
import { frenoDeElegibilidad, type Freno } from './frenoElegibilidad.js';
import { restaurarVersion } from './restaurar.js';
import { rutasTelemetria } from './telemetria.js';
import { matrizDeLicitacion } from './matrizEquipo.js';
import { rutasGuiaDeuc } from './deucGuia.js';
import { rutasReutilizar } from './reutilizar.js';
import { rutasContextoPrecio } from './contextoPrecio.js';
import { rutasRevisionPrevia } from './revisionPrevia.js';

// Aceptar o descartar la memoria ensamblada es el PATCH /borradores/:n sobre su borrador. La ficha de solución
// se ve y se aprueba en /memoria/:version/ficha (GET y PUT).
export type EstadoOferta = {
  // cambios: frente a la versión anterior (null en la primera o si ya no se puede comparar).
  guion: {
    id: number;
    version: number;
    ficha_id: number | null;
    creado_en: string;
    avisos: string[];
    datos: GuionBaseData;
    cambios: CambiosGuion | null;
  } | null;
  // lotes_cambiados: el guion se extrajo para otros lotes que los de interés de ahora.
  guion_en_curso: EnCurso | null;
  guion_desfasado: boolean;
  lotes_cambiados: boolean;
  decisiones: DecisionesGuardadas | null;
  decisiones_problemas: string[];
  guion_cambiado: boolean;
  memorias: EstadoMemoria[];
  ficha_aprobada: boolean;
  salidas_configurado: boolean;
  pliegos_listos: boolean;
  propuesta_decisiones: PropuestaGuardada | null;
  propuesta_en_curso: EnCurso | null;
  precios_sugeridos: Record<string, PrecioSugerido | null>;
  paquete: ResumenPaquete | null;
  // Lo que no casa entre lotes, ficha, pliegos, guion y decisiones (coherencia.ts), primero lo que bloquea.
  coherencia: Incoherencia[];
  // Los lotes con memoria propia si el pliego pide una por lote (memoriaLote.ts); null = una común.
  memoria_lotes: string[] | null;
  // Presentada o con el plazo vencido: lo que se sube ya suele ser la memoria entregada.
  presentada_o_vencida: boolean;
};

// El precio se calcula para los lotes decididos o, sin decisiones, los de interés (el ámbito).
// Nunca los de la propuesta: pueden ser otros (p. ej. una propuesta de dos lotes cuando solo
// se va a uno) y el formulario se rellenaba con el precio del contrato entero, que supera el del lote.
function propuestaYPrecio(
  id: string,
  lotes: string[] | undefined,
): Pick<EstadoOferta, 'propuesta_decisiones' | 'propuesta_en_curso' | 'precios_sugeridos'> {
  const db = dbLicitaciones();
  const propuesta = propuestaDecisionesDe(db, id);
  return {
    propuesta_decisiones: propuesta,
    propuesta_en_curso: trabajoEnCurso(db, TIPO_PROPUESTA_DECISIONES, id),
    precios_sugeridos: preciosSugeridos(
      db,
      id,
      lotes ?? lotesDecididos(db, id, []),
      nucleo().config.licitaciones.preciosMinimo,
    ),
  };
}

/** Todo lo de la oferta para la pestaña Preparación. */
export function estadoOferta(id: string): Result<EstadoOferta> {
  const db = dbLicitaciones();
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const g = guionVigente(db, id);
  const ficha = fichasDe(db, id).aprobada;
  const d = decisionesVigentes(db, nucleo().db, id);
  // Con decisiones, el precio sugerido es el de cada uno de sus lotes: la coherencia lo reutiliza.
  const precio = propuestaYPrecio(id, d.decisiones?.datos.lotes);
  return ok({
    guion: g
      ? {
          id: g.id,
          version: g.version,
          ficha_id: g.ficha_id,
          creado_en: g.creado_en,
          avisos: g.avisos,
          datos: g.datos,
          cambios: g.cambios,
        }
      : null,
    guion_en_curso: trabajoEnCurso(db, TIPO_GUION, id),
    guion_desfasado: Boolean(g && ficha && (g.ficha_id ?? 0) < ficha.id),
    lotes_cambiados: guionDeOtrosLotes(db, g),
    decisiones: d.decisiones,
    decisiones_problemas: d.problemas,
    guion_cambiado: d.guion_cambiado,
    memorias: memoriasDe(db, id, true),
    ficha_aprobada: ficha !== null,
    salidas_configurado: nucleo().config.salidasDir !== null,
    pliegos_listos: pliegosSinLeer(db, id) === null,
    ...precio,
    coherencia: coherenciaOferta(db, id, { precio: (ls) => precio.precios_sugeridos[ls[0] ?? ''] ?? null }),
    paquete: resumenPaquete(paqueteVigente(db, id)),
    memoria_lotes: g ? lotesDeMemoria(g.datos, lotesDecididos(db, id, d.decisiones?.datos.lotes ?? [])) : null,
    presentada_o_vencida: ofertaCerrada(db, id) || Boolean(estadoPlazo(db, id)?.vencido),
  });
}

type ResumenPaquete = Omit<PaqueteVigente, 'manifiesto'>;

// Sin el manifiesto (lleva los importes): para el estado del paso 4 basta con la versión y sus cuentas.
function resumenPaquete(p: PaqueteVigente | null): ResumenPaquete | null {
  if (!p) return null;
  const { manifiesto: _manifiesto, ...resumen } = p;
  return resumen;
}

const contextoPaquete = () => ({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() });

const Version = z.coerce.number().int().positive();

// Una memoria que aún se redacta no pasa por el ensamblado normal: sale por su cierre (coherencia y evaluación).
function montar(db: ReturnType<typeof dbLicitaciones>, memoriaId: number) {
  const f = filaMemoria(db, memoriaId);
  return f?.estado === 'redactando' ? ensamblarYa(db, memoriaId) : ensamblarEnFondo(db, memoriaId);
}

function ensamblar(id: string, req: Request, res: Response): void {
  const v = Version.safeParse(req.params['version']);
  if (!v.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Versión no válida.' });
    return;
  }
  const db = dbLicitaciones();
  const m = db.prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, v.data) as
    { id: number } | undefined;
  responder(res, m ? montar(db, m.id) : fail('not_found', `No hay memoria v${v.data} de esta licitación.`), 202);
}

// Volver a montar sin IA (portada y firma con el perfil de ahora): solo el generador, sin
// runs; se espera al documento para decir cómo quedó.
async function remontar(id: string, req: Request, res: Response): Promise<void> {
  const v = Version.safeParse(req.params['version']);
  if (!v.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Versión no válida.' });
    return;
  }
  responder(res, await remontarMemoria(dbLicitaciones(), id, v.data, raicesActuales()), 202);
}

// «Volver a esta versión»: la siguiente es una copia de la elegida, montada sin runs.
async function restaurar(id: string, req: Request, res: Response): Promise<void> {
  const v = Version.safeParse(req.params['version']);
  if (!v.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Versión no válida.' });
    return;
  }
  responder(res, await restaurarVersion(dbLicitaciones(), id, v.data, raicesActuales()), 201);
}

// Volver a evaluar una versión ensamblada.
function evaluar(id: string, req: Request, res: Response): void {
  const v = Version.safeParse(req.params['version']);
  if (!v.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Versión no válida.' });
    return;
  }
  responder(res, evaluarMemoria(nucleo().db, dbLicitaciones(), raicesActuales(), { id, version: v.data }), 202);
}

const NumeroLeccion = z.coerce.number().int().positive();

function revisarLeccionRuta(id: string, req: Request, res: Response): void {
  const n = NumeroLeccion.safeParse(req.params['leccion']);
  const d = Revision.safeParse(req.body ?? {});
  if (!n.success || !d.success)
    return responder(res, fail('invalid_input', 'Indica la lección y «decision»: aceptar o descartar.'));
  responder(res, revisarLeccion(dbLicitaciones(), id, n.data, d.data, quienDe(req)));
}

// Del libro de lecciones (Aprendizaje): también las de un acta sin licitación conocida.
function revisarDelLibroRuta(req: Request, res: Response): void {
  const n = NumeroLeccion.safeParse(req.params['leccion']);
  const d = Revision.safeParse(req.body ?? {});
  if (!n.success || !d.success)
    return responder(res, fail('invalid_input', 'Indica la lección y «decision»: aceptar o descartar.'));
  responder(res, revisarDelLibro(dbLicitaciones(), n.data, d.data, quienDe(req)));
}

function alcanceRuta(req: Request, res: Response): void {
  const n = NumeroLeccion.safeParse(req.params['leccion']);
  const a = AjusteAlcance.safeParse(req.body ?? {});
  if (!n.success) return responder(res, fail('invalid_input', 'Indica la lección.'));
  if (!a.success) return responder(res, fail('invalid_input', z.prettifyError(a.error)));
  responder(res, ajustarAlcance(dbLicitaciones(), n.data, a.data));
}

function retirarRuta(req: Request, res: Response): void {
  const n = NumeroLeccion.safeParse(req.params['leccion']);
  const r = Retirada.safeParse(req.body ?? {});
  if (!n.success) return responder(res, fail('invalid_input', 'Indica la lección.'));
  if (!r.success) return responder(res, fail('invalid_input', z.prettifyError(r.error)));
  responder(res, retirarLeccion(dbLicitaciones(), n.data, r.data, quienDe(req)));
}

function porqueRuta(id: string, req: Request, res: Response): void {
  const n = NumeroLeccion.safeParse(req.params['comparacion']);
  const r = RespuestaPorque.safeParse(req.body ?? {});
  if (!n.success || !r.success)
    return responder(res, fail('invalid_input', 'Indica la comparación, «n» (el cambio) y «respuesta».'));
  responder(res, responderPorque(dbLicitaciones(), id, n.data, r.data));
}

// Una versión editada a mano: un solo Word o PDF por petición, procesado al momento (no se guarda si falla).
async function subir(id: string, req: Request, res: Response): Promise<void> {
  const a = await recibirArchivo(req, { maxBytes: MAX_MEMORIA_SUBIDA, extensiones: EXTENSIONES_PRESENTADA });
  if (a.error) return responder(res, a);
  responder(res, await subirMemoria(dbLicitaciones(), id, a.data), 201);
}

// Con «ensayo», una memoria para medir el método con el plazo ya vencido (memoria.ts,
// comprobarEnsayo). Con «lote», solo la memoria de ese lote si el pliego pide una por lote (sin
// él, la de cada lote).
const PedidoMemoria = z
  .object({
    ensayo: z.boolean().optional(),
    lote: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

function pedir(id: string, req: Request, res: Response): void {
  const p = PedidoMemoria.safeParse(req.body ?? {});
  if (!p.success)
    return responder(res, fail('invalid_input', '«ensayo» solo puede ser true o false, y «lote», el id de un lote.'));
  const op = { ensayo: p.data.ensayo, lote: p.data.lote, confirmado: confirmado(req) };
  responder(res, pedirMemoria(nucleo().db, dbLicitaciones(), nucleo().config.salidasDir, id, op), 202);
}

const log = logger('licitaciones');

function memoriaDeVersion(id: string, req: Request): Result<{ id: number }> {
  const v = Version.safeParse(req.params['version']);
  if (!v.success) return fail('invalid_input', 'Versión no válida.');
  const m = dbLicitaciones()
    .prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND version = ?')
    .get(id, v.data) as { id: number } | undefined;
  return m ? ok(m) : fail('not_found', `No hay memoria v${v.data} de esta licitación.`);
}

function verFicha(id: string, req: Request): Result<FichaSolucion> {
  const m = memoriaDeVersion(id, req);
  if (m.error) return m;
  const f = fichaDe(dbLicitaciones(), m.data.id);
  return f
    ? ok(f)
    : fail(
        'not_found',
        'Esta memoria no tiene ficha de solución (es de ensayo, se subió a mano o su estrategia no la trae).',
      );
}

// Aprobada la ficha, la memoria avanza ya (encola la redacción) sin esperar a la vuelta del minuto.
async function revisarFicha(id: string, req: Request, res: Response): Promise<void> {
  const db = dbLicitaciones();
  const m = memoriaDeVersion(id, req);
  const fila = m.error ? null : filaMemoria(db, m.data.id);
  if (m.error || !fila) return responder(res, m.error ? m : fail('not_found', 'La memoria ya no está.'));
  const r = aprobarFicha(db, fila, conQuien(req, 'revisado_por'));
  if (r.error) return responder(res, r);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'ficha', version: fila.version },
  });
  await avanzarMemoria(nucleo().db, db, fila.id).catch((err: unknown) =>
    log.error('memoria sin avanzar tras la ficha', {
      memoria: fila.id,
      clase: err instanceof Error ? err.name : typeof err,
    }),
  );
  responder(res, r);
}

function verDecisiones(id: string): Result<DecisionesGuardadas> {
  const d = decisionesDe(dbLicitaciones(), id);
  return d ? ok(d) : fail('not_found', 'Aún no se han fijado las decisiones de la oferta.');
}

// HermesEnVivo con el freno de elegibilidad: la web dice por qué Hermes no redacta la
// memoria ni los anexos y qué fila espera tu «Vamos». Se compone aquí: las comprobaciones ya usan hermesEnVivo.
function hermesDeOferta(id: string): Result<HermesEnVivo & { freno_elegibilidad: Freno }> {
  const v = hermesEnVivo(dbLicitaciones(), nucleo().db, id);
  if (v.error) return v;
  return ok({ ...v.data, freno_elegibilidad: frenoDeElegibilidad(dbLicitaciones(), nucleo().db, id) });
}

// La matriz rol × persona. Con ?cv=1 busca además en los CV de la Biblioteca lo que
// Colaboradores no registra: cuesta consultas, por eso no va por defecto.
const ConsultaMatriz = z.object({ cv: Bandera });

function matriz(id: string, req: Request, res: Response): void {
  const q = ConsultaMatriz.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  matrizDeLicitacion(dbLicitaciones(), nucleo().db, id, { cv: q.data.cv }).then(
    (x) => responder(res, x),
    fallo(res, 'matriz del equipo', 'licitaciones'),
  );
}

// «Actualizar los apartados afectados» (cambio tardío): sin apartados, los que nombran el cambio
// (los mismos que cobra «Qué cambia») o, sin él, los que dicen las huellas del dossier
// (huellasMemoria.ts). «Nueva versión» (mejora): los apartados y las indicaciones de quien lleva
// la oferta, o los que la evaluación deja por debajo de su tramo máximo.
const CuerpoActualizar = z.strictObject({
  cambio: CambioImpacto.optional(),
  cambios: z.array(CambioImpacto).min(1).max(5).optional(),
  apartados: z.array(z.number().int().min(1).max(20)).min(1).max(20).optional(),
  indicaciones: z.string().trim().min(10).optional(),
});

function actualizar(mejora: boolean, id: string, req: Request, res: Response): void {
  const v = Version.safeParse(req.params['version']);
  if (!v.success) return invalido(res, v.error);
  const c = CuerpoActualizar.safeParse(req.body ?? {});
  if (!c.success) return invalido(res, c.error);
  const { cambio, cambios, ...resto } = c.data;
  const p = {
    id,
    version: v.data,
    ...resto,
    cambios: cambios ?? (cambio ? [cambio] : undefined),
    confirmado: confirmado(req),
    mejora,
  };
  actualizarMemoria(nucleo().db, dbLicitaciones(), nucleo().config.salidasDir, p).then(
    (x) => responder(res, x, 202),
    fallo(res, 'memoria sin actualizar', 'licitaciones'),
  );
}

function rutasMatrizEquipo(r: Router): void {
  r.get('/licitaciones/:id/oferta/equipo/matriz', conId(matriz));
}

export function rutasOferta(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta',
    conId((id, _req, res) => responder(res, estadoOferta(id))),
  );
  r.post(
    '/licitaciones/:id/oferta/guion',
    conId((id, req, res) =>
      responder(res, pedirGuion(nucleo().db, dbLicitaciones(), id, { confirmado: confirmado(req) }), 202),
    ),
  );
  r.get(
    '/licitaciones/:id/oferta/hermes',
    conId((id, _req, res) => responder(res, hermesDeOferta(id))),
  );
  r.get(
    '/licitaciones/:id/oferta/decisiones',
    conId((id, _req, res) => responder(res, verDecisiones(id))),
  );
  r.post(
    '/licitaciones/:id/oferta/decisiones/propuesta',
    conId((id, req, res) =>
      responder(
        res,
        pedirPropuestaDecisiones(nucleo().db, dbLicitaciones(), id, true, { confirmado: confirmado(req) }),
        202,
      ),
    ),
  );
  r.put(
    '/licitaciones/:id/oferta/decisiones',
    conId((id, req, res) =>
      responder(res, guardarDecisiones(dbLicitaciones(), nucleo().db, id, req.body ?? {}, actorDe(req))),
    ),
  );
  r.get(
    '/licitaciones/:id/oferta/decisiones/historial',
    conId((id, _req, res) => responder(res, historialDecisiones(dbLicitaciones(), id))),
  );
  r.post(
    '/licitaciones/:id/oferta/decisiones/deshacer',
    conId((id, req, res) =>
      responder(res, deshacerDecisiones(dbLicitaciones(), nucleo().db, id, conQuien(req), actorDe(req).rol)),
    ),
  );
  r.patch(
    '/licitaciones/:id/oferta/decisiones/:seccion',
    conId((id, req, res) =>
      responder(
        res,
        guardarSeccion(dbLicitaciones(), nucleo().db, id, req.params['seccion'], conQuien(req), {
          rol: actorDe(req).rol,
        }),
      ),
    ),
  );
  r.get(
    '/licitaciones/:id/oferta/memoria',
    conId((id, _req, res) => res.json({ memorias: memoriasDe(dbLicitaciones(), id, true) })),
  );
  r.post('/licitaciones/:id/oferta/memoria', conId(pedir));
  r.post('/licitaciones/:id/oferta/memoria/:version/ensamblar', conId(ensamblar));
  r.post(
    '/licitaciones/:id/oferta/memoria/:version/remontar',
    conId((id, req, res) => {
      remontar(id, req, res).catch(fallo(res, 'memoria sin volver a montar', 'licitaciones'));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/memoria/:version/restaurar',
    conId((id, req, res) => {
      restaurar(id, req, res).catch(fallo(res, 'memoria sin restaurar', 'licitaciones'));
    }),
  );
  r.post('/licitaciones/:id/oferta/memoria/:version/evaluar', conId(evaluar));
  r.post(
    '/licitaciones/:id/oferta/memoria/:version/mejorar',
    conId((id, req, res) => actualizar(true, id, req, res)),
  );
  r.get(
    '/licitaciones/:id/oferta/memoria/:version/ficha',
    conId((id, req, res) => responder(res, verFicha(id, req))),
  );
  r.put(
    '/licitaciones/:id/oferta/memoria/:version/ficha',
    conId((id, req, res) => {
      revisarFicha(id, req, res).catch(fallo(res, 'ficha de solución', 'licitaciones'));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/memoria/subir',
    conId((id, req, res) => {
      void subir(id, req, res);
    }),
  );
  r.patch('/licitaciones/:id/oferta/lecciones/:leccion', conId(revisarLeccionRuta));
  r.patch('/lecciones/:leccion', revisarDelLibroRuta);
  r.patch('/lecciones/:leccion/alcance', alcanceRuta);
  r.post('/lecciones/:leccion/retirar', retirarRuta);
  r.get('/aprendizaje', (_req, res) =>
    responder(res, ok(aprendizajeDe(dbLicitaciones(), raicesActuales().conocimiento))),
  );
  r.get(
    '/licitaciones/:id/oferta/comparaciones',
    conId((id, _req, res) => responder(res, ok({ items: comparacionesDe(dbLicitaciones(), id) }))),
  );
  r.post('/licitaciones/:id/oferta/comparaciones/:comparacion/porque', conId(porqueRuta));
  const errorPaquete = (res: Response) => fallo(res, 'paquete de presentación', 'licitaciones');
  r.get(
    '/licitaciones/:id/oferta/paquete',
    conId((id, _req, res) => {
      estadoPaquete(dbLicitaciones(), raicesActuales(), id).then((x) => responder(res, x), errorPaquete(res));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/paquete',
    conId((id, _req, res) => {
      generarPaquete(contextoPaquete(), id).then((x) => responder(res, x, 201), errorPaquete(res));
    }),
  );
  rutasDocumentosOferta(r);
  rutasComprobaciones(r);
  rutasTelemetria(r);
  rutasRevisionHermes(r);
  rutasDiffPropuesta(r);
  rutasResumenMemoria(r);
  r.post(
    '/licitaciones/:id/oferta/memoria/:version/actualizar-afectados',
    conId((id, req, res) => actualizar(false, id, req, res)),
  );
  rutasApartadosAfectados(r);
  rutasVistaAnexo(r);
  rutasApartadoTexto(r);
  rutasMatrizEquipo(r);
  rutasGuiaDeuc(r);
  rutasReutilizar(r);
  rutasContextoPrecio(r);
  rutasRevisionPrevia(r);
  rutasMemoriaPresentada(r);
  rutasAsistente(r);
}
