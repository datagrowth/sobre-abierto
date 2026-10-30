// API web de Licitaciones (/api/licitaciones, detrás del login del servidor).
import { huecosBiblioteca } from './huecosBiblioteca.js';
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nucleo } from '../../nucleo/contexto.js';
import { Bandera, fallo, invalido, responder } from '../../nucleo/http.js';
import { conQuien, quienDe, usuarioDe } from '../../nucleo/permisos.js';
import { conId, conNumero } from './http.js';
import { rutasCompetencia } from './competencia/rutas.js';
import { rutasIndices } from './indices/rutas.js';
import { rutasCalidad } from './calidadRutas.js';
import { rutasPropuestas } from './propuestas/rutas.js';
import { rutasOferta } from './oferta/rutas.js';
import { dbLicitaciones } from './db.js';
import {
  CambioWeb,
  cambiarOportunidad,
  detalle,
  EleccionLotes,
  elegirLotesInteres,
  ESTADOS_LISTA,
  Filtro,
  listarOportunidades,
  seguirLicitacion,
} from './oportunidades.js';
import {
  descartarPorIdioma,
  descartarPorImporte,
  Filtros,
  filtrosDeEjemplo,
  guardarFiltros,
  leerFiltros,
} from './prefiltro.js';
import { buscarCpv, describirCpvs } from './clasificacion.js';
import { pedirCargaHistorico, pedirPrefiltro, pedirSync } from './ingesta.js';
import { PedidoHistorico, pedirHistorico, resumenHistorico } from './historico.js';
import { comparablesDeLicitacion, OpcionesPrecios, preciosDeLicitacion } from './precios/index.js';
import { pedirFicha } from './ficha.js';
import { reintentarProceso } from './errores.js';
import { AccionRegeneracion, cambiarRegeneracion } from './fichaRegeneracion.js';
import { equipoDeLicitacion } from './equipo.js';
import { antecedentesDe, OpcionesAntecedentes } from './antecedentes/index.js';
import { estadoLicitaciones, pedirCriba } from './index.js';
import { barreras, OpcionesBarreras } from './barreras.js';
import { CarpetaDrive, enlaceEnDrive } from './enDrive.js';
import { leerPerfilEmpresa } from '../../nucleo/empresa.js';
import { reorganizar } from './reorganizacion.js';
import { logger } from '../../nucleo/log.js';
import { errorMessage, fail, ok } from '../../nucleo/result.js';
import { relanzarTrabajos } from '../../nucleo/colaRelanzado.js';
import { recibirArchivo } from '../../nucleo/subidas.js';
import { raicesActuales } from '../../nucleo/salidas.js';
import { descargaPermitida, leerReorganizacion } from './reorganizacion.js';
import { EXTENSIONES_PLIEGO, MAX_PLIEGO_SUBIDA, subirPliego } from './pliegosSubida.js';
import { AnotacionAutonomica, anotarAutonomica, informeCobertura } from './cobertura.js';
import { ensayoCarpetaUnica } from './carpetaUnica.js';
import { asegurarCarpetaUnica, leerMigracion, migrarCarpetaUnica } from './migracionCarpetaUnica.js';
import { pipeline } from './pipeline.js';
import { csvOportunidades, csvPipeline, csvPresentadas } from './exportar.js';
import { FiltroPropuestas } from './propuestas/registro.js';
import { enviarCsv } from '../../nucleo/csv.js';
import { cambiarResponsable } from './responsable.js';
import { FiltroRevision, listaRevision } from './revision.js';
import { Busqueda, buscar } from './buscador.js';
import { calibracionVigente } from './encajeCalibracion.js';
import { borrarBusqueda, busquedasConNuevas, cambiarBusqueda, guardarBusqueda } from './busquedasGuardadas.js';
import { abrirIndiceLectura } from '../../biblioteca/motor/documentos/servicioIndice.js';

const log = logger('licitaciones');

const ConsultaLista = z.object({
  estados: z
    .string()
    .optional()
    .transform((s) => s?.split(',').filter(Boolean))
    .pipe(z.array(z.enum(ESTADOS_LISTA)).optional()),
  texto: z.string().optional(),
  pagina: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  orden: z.enum(['plazo', 'importe', 'llegada']).optional(),
  comunidad: z
    .string()
    .regex(/^ES[0-9A-Z]{2}$/)
    .optional(),
});

const ConsultaBarreras = z.object({ meses: z.coerce.number().int().min(0).max(120).optional() });

function verBarreras(req: Request, res: Response): void {
  const q = ConsultaBarreras.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const o = OpcionesBarreras.safeParse(Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined)));
  if (!o.success) return invalido(res, o.error);
  res.json(barreras(dbLicitaciones(), leerPerfilEmpresa(nucleo().db)?.perfil ?? null, o.data));
}

function listar(req: Request, res: Response): void {
  const q = ConsultaLista.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const f = Filtro.safeParse(Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined)));
  if (!f.success) return invalido(res, f.error);
  const r = listarOportunidades(dbLicitaciones(), f.data);
  res.json({ ...r, pagina: f.data.pagina, limite: f.data.limite });
}

function cambiar(id: string, req: Request, res: Response): void {
  const c = CambioWeb.safeParse(req.body);
  if (!c.success) return invalido(res, c.error);
  // Quien pulsa «Aplicar» o «Preparar la oferta» la lleva (si nadie la llevaba): la sesión, no el cuerpo.
  const r = cambiarOportunidad(
    dbLicitaciones(),
    id,
    { ...c.data, responsable_id: usuarioDe(req)?.id ?? null },
    quienDe(req),
  );
  // Aplicar: con la migración hecha, la oferta nace con su carpeta única (en segundo plano).
  if (!r.error && r.data.estado === 'en_preparacion') asegurarCarpetaUnica(id).catch(() => undefined);
  responder(res, r);
}

function elegirLotes(id: string, req: Request, res: Response): void {
  const e = EleccionLotes.safeParse(conQuien(req));
  if (!e.success) return invalido(res, e.error);
  responder(res, elegirLotesInteres(dbLicitaciones(), id, e.data));
}

// La persona de la sesión (0 sin login): las búsquedas guardadas son suyas.
const usuarioId = (req: Request): number => usuarioDe(req)?.id ?? 0;
const DiasNuevas = z.coerce.number().int().min(1).max(31);

const BusquedaCpv = z.object({ q: z.string().trim().min(1).max(100) });
const PrefijosCpv = z.object({
  prefijos: z
    .string()
    .max(2000)
    .transform((t) =>
      t
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().regex(/^\d{2,8}$/))
        .min(1)
        .max(100),
    ),
});

const QueryPrecios = z.object({
  bajas: z
    .string()
    .max(100)
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean).map(Number) : [])),
  ofertas: z.coerce.number().optional(),
  importe: z.coerce.number().optional(),
  lote: z.string().max(20).optional(),
  mismo_organo: Bandera,
  filtrar_ofertas: Bandera,
  limite: z.coerce.number().int().min(1).max(50).default(15),
});
const OpcionesWeb = OpcionesPrecios.extend({ limite: z.number() });

// La query llega como texto: primero se convierte y luego se valida con el mismo esquema que las tools.
function opcionesPrecios(req: Request, res: Response): z.infer<typeof OpcionesWeb> | null {
  const q = QueryPrecios.safeParse(req.query);
  if (!q.success) {
    invalido(res, q.error);
    return null;
  }
  const o = OpcionesWeb.safeParse(q.data);
  if (!o.success) {
    invalido(res, o.error);
    return null;
  }
  return o.data;
}

function precios(id: string, req: Request, res: Response): void {
  const o = opcionesPrecios(req, res);
  if (o) responder(res, preciosDeLicitacion(dbLicitaciones(), id, o, nucleo().config.licitaciones.preciosMinimo));
}

function similares(id: string, req: Request, res: Response): void {
  const o = opcionesPrecios(req, res);
  if (o) responder(res, comparablesDeLicitacion(dbLicitaciones(), id, o, o.limite));
}

const QueryAntecedentes = z.object({ lote: z.string().max(20).optional(), limite: z.coerce.number().int().optional() });

function antecedentes(id: string, req: Request, res: Response): void {
  const q = QueryAntecedentes.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const o = OpcionesAntecedentes.safeParse(
    Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined)),
  );
  if (!o.success) return invalido(res, o.error);
  responder(res, antecedentesDe(dbLicitaciones(), id, o.data));
}

const QueryEquipo = z.object({ limite: z.coerce.number().int().min(1).max(20).default(5) });

function equipo(id: string, req: Request, res: Response): void {
  const q = QueryEquipo.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  equipoDeLicitacion(dbLicitaciones(), nucleo().db, id, q.data.limite).then(
    (r) => responder(res, r),
    fallo(res, 'fallo preparando el equipo', 'licitaciones'),
  );
}

// Lo que una persona puede parar y relanzar si se queda colgado (un trabajo de IA por licitación).
const TipoRelanzable = z.enum([
  'ficha',
  'guion',
  'decisiones',
  'memoria_apartado',
  'memoria_estrategia',
  'memoria_redaccion',
  'memoria_critica',
  'memoria_hechos',
  'evaluar',
  'anexo',
  'lecciones',
]);

function relanzar(id: string, req: Request, res: Response): void {
  const t = TipoRelanzable.safeParse(req.params['tipo']);
  if (!t.success) return invalido(res, t.error);
  const n = relanzarTrabajos(nucleo().db, `licitaciones.${t.data}`, id);
  responder(res, n ? ok({ relanzados: n }) : fail('not_found', 'No hay nada de eso en marcha para esta licitación.'));
}

function enDrive(id: string, req: Request, res: Response): void {
  const c = CarpetaDrive.safeParse(req.params['carpeta']);
  if (!c.success) return invalido(res, c.error);
  enlaceEnDrive(dbLicitaciones(), id, c.data).then(
    (r) => responder(res, r),
    fallo(res, 'fallo buscando la carpeta en Drive', 'licitaciones'),
  );
}

function cargarHistorico(req: Request, res: Response): void {
  const p = PedidoHistorico.safeParse(req.body);
  if (!p.success) return invalido(res, p.error);
  const r = pedirHistorico(dbLicitaciones(), p.data);
  if (r.error) return responder(res, r);
  res.status(202).json({ ...r.data, en_marcha: pedirCargaHistorico() });
}

// Repite la comprobación de la reorganización de carpetas contra el estado real de Drive.
// Mover lleva unos segundos: responde al momento y la web ve el resultado en Estado.
function comprobarCarpetas(_req: Request, res: Response): void {
  reorganizar().catch((err: unknown) => log.error('reorganización de carpetas fallida', { error: errorMessage(err) }));
  res.status(202).json({ pedida: true });
}

function ponerFiltros(req: Request, res: Response): void {
  const f = Filtros.safeParse(req.body);
  if (!f.success) return invalido(res, f.error);
  guardarFiltros(dbLicitaciones(), f.data);
  descartarPorIdioma(dbLicitaciones());
  descartarPorImporte(dbLicitaciones());
  pedirPrefiltro();
  res.json(f.data);
}

// La web de Actividad enseña el título en vez del id; ids ajenos o borrados simplemente no salen.
// Mismo formato que el :id de http.ts.
const IdLicitacion = z.string().regex(/^[pa]-[A-Za-z0-9_-]{1,30}$/);
const QueryTitulos = z.object({
  ids: z
    .string()
    .max(2000)
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(IdLicitacion).min(1).max(50)),
});

function titulos(req: Request, res: Response): void {
  const q = QueryTitulos.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const ids = [...new Set(q.data.ids)];
  const filas = dbLicitaciones()
    .prepare(`SELECT id, titulo FROM licitaciones WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: string; titulo: string }[];
  res.json(Object.fromEntries(filas.map((f) => [f.id, f.titulo])));
}

// Un pliego que falta, subido a mano: va a la carpeta de los pliegos y la Biblioteca lo indexa.
async function subirPliegoRuta(id: string, req: Request, res: Response): Promise<void> {
  const raiz = raicesActuales().conocimiento;
  if (!raiz) return responder(res, fail('no_configurado', 'No hay carpeta de Conocimiento configurada.'));
  if (!descargaPermitida(leerReorganizacion().estado))
    return responder(res, fail('conflicto', 'Las carpetas se están reorganizando: prueba en unos minutos.'));
  const a = await recibirArchivo(req, { maxBytes: MAX_PLIEGO_SUBIDA, extensiones: EXTENSIONES_PLIEGO });
  if (a.error) return responder(res, a);
  const r = await subirPliego(dbLicitaciones(), raiz, id, a.data, quienDe(req));
  responder(res, r.error ? r : ok({ ...r.data, indexacion: 'en_cola' as const }), 201);
}

export function rutasLicitaciones(): Router {
  const r = Router();
  r.use(express.json({ limit: '256kb' }));
  r.get('/oportunidades', listar);
  r.get('/barreras', verBarreras);
  r.get('/titulos', titulos);
  r.get(
    '/licitaciones/:id',
    conId((id, _req, res) => responder(res, detalle(dbLicitaciones(), id))),
  );
  r.get('/licitaciones/:id/drive/:carpeta', conId(enDrive));
  r.post('/licitaciones/:id/trabajos/:tipo/relanzar', conId(relanzar));
  r.patch('/oportunidades/:id', conId(cambiar));
  r.put('/oportunidades/:id/lotes', conId(elegirLotes));
  r.put(
    '/oportunidades/:id/responsable',
    conId((id, req, res) => responder(res, cambiarResponsable(dbLicitaciones(), id, req.body ?? {}))),
  );
  r.post(
    '/licitaciones/:id/seguir',
    conId((id, _req, res) => responder(res, seguirLicitacion(dbLicitaciones(), id), 201)),
  );
  r.post(
    '/oportunidades/:id/ficha',
    conId((id, _req, res) => responder(res, pedirFicha(nucleo().db, dbLicitaciones(), id), 202)),
  );
  r.post(
    '/oportunidades/:id/reintentar',
    conId((id, _req, res) => responder(res, reintentarProceso(nucleo().db, dbLicitaciones(), id), 202)),
  );
  r.get('/licitaciones/:id/precios', conId(precios));
  r.get('/licitaciones/:id/comparables', conId(similares));
  r.get('/licitaciones/:id/equipo', conId(equipo));
  r.get('/licitaciones/:id/antecedentes', conId(antecedentes));
  r.post(
    '/licitaciones/:id/pliegos',
    conId((id, req, res) => {
      subirPliegoRuta(id, req, res).catch(fallo(res, 'fallo subiendo un pliego', 'licitaciones'));
    }),
  );
  r.get('/historico', (_req, res) => {
    res.json(resumenHistorico(dbLicitaciones()));
  });
  r.post('/historico', cargarHistorico);
  // de_ejemplo: aún no se han guardado los de la empresa (la web pide ajustarlos).
  r.get('/filtros', (_req, res) => {
    res.json({ ...leerFiltros(dbLicitaciones()), de_ejemplo: filtrosDeEjemplo(dbLicitaciones()) });
  });
  // Lo que dice el vocabulario CPV de unos prefijos (las etiquetas de los filtros).
  r.get('/cpv', (req, res) => {
    const q = PrefijosCpv.safeParse(req.query);
    if (!q.success) return invalido(res, q.error);
    res.json({ cpv: describirCpvs(dbLicitaciones(), q.data.prefijos) });
  });
  r.get('/cpv/buscar', (req, res) => {
    const q = BusquedaCpv.safeParse(req.query);
    if (!q.success) return invalido(res, q.error);
    res.json({ cpv: buscarCpv(dbLicitaciones(), q.data.q) });
  });
  r.put('/filtros', ponerFiltros);
  r.get('/estado', (_req, res) => {
    res.json(estadoLicitaciones());
  });
  r.get('/pipeline', (_req, res) => {
    res.json(pipeline(dbLicitaciones()));
  });
  // CSV para Excel en español de los listados, con los mismos filtros que su vista.
  r.get('/pipeline.csv', (_req, res) => enviarCsv(res, 'pipeline', csvPipeline(dbLicitaciones())));
  r.get('/revision.csv', (req, res) => {
    const f = FiltroRevision.safeParse(req.query);
    if (!f.success) {
      invalido(res, f.error);
      return;
    }
    enviarCsv(res, `oportunidades-${f.data.pestana.replace(/_/g, '-')}`, csvOportunidades(dbLicitaciones(), f.data));
  });
  r.get('/propuestas.csv', (req, res) => {
    const f = FiltroPropuestas.omit({ limite: true }).safeParse(req.query);
    if (!f.success) {
      invalido(res, f.error);
      return;
    }
    enviarCsv(res, 'presentadas', csvPresentadas(dbLicitaciones(), f.data));
  });
  r.get('/revision', (req, res) => {
    const f = FiltroRevision.safeParse(req.query);
    if (!f.success) {
      invalido(res, f.error);
      return;
    }
    res.json(listaRevision(dbLicitaciones(), f.data, Date.now(), f.data.pliegos ? abrirIndiceLectura() : null));
  });
  // Búsquedas guardadas de quien entra: cada persona, las suyas.
  r.get('/busquedas', (req, res) => {
    const d = DiasNuevas.safeParse(req.query['dias'] ?? '7');
    if (!d.success) return invalido(res, d.error);
    res.json({ busquedas: busquedasConNuevas(dbLicitaciones(), usuarioId(req), d.data) });
  });
  r.post('/busquedas', (req, res) =>
    responder(res, guardarBusqueda(dbLicitaciones(), usuarioId(req), req.body ?? {}), 201),
  );
  r.patch(
    '/busquedas/:n',
    conNumero((n, req, res) => responder(res, cambiarBusqueda(dbLicitaciones(), usuarioId(req), n, req.body ?? {}))),
  );
  r.delete(
    '/busquedas/:n',
    conNumero((n, req, res) => responder(res, borrarBusqueda(dbLicitaciones(), usuarioId(req), n))),
  );
  // El AUC del encaje frente a lo que decidió la empresa; la calibración se calcula en encajeCalibracion.ts.
  r.get('/encaje/calibracion', (_req, res) => {
    res.json(calibracionVigente(dbLicitaciones()));
  });
  // Búsqueda de texto en títulos y, con pliegos=1, en los pliegos descargados, con los agregados de lo encontrado.
  r.get('/buscar', (req, res) => {
    const b = Busqueda.safeParse(req.query);
    if (!b.success) {
      invalido(res, b.error);
      return;
    }
    res.json(buscar(dbLicitaciones(), b.data, b.data.pliegos ? abrirIndiceLectura() : null));
  });
  r.get('/cobertura', (_req, res) => {
    res.json(informeCobertura(dbLicitaciones()));
  });
  r.put('/cobertura/autonomica', (req, res) => {
    const a = AnotacionAutonomica.safeParse(req.body);
    if (!a.success) {
      invalido(res, a.error);
      return;
    }
    responder(res, anotarAutonomica(dbLicitaciones(), a.data));
  });
  // Solo lee el disco y la base: se puede pedir cuantas veces haga falta antes de migrar.
  r.get('/carpeta-unica/ensayo', (_req, res) => {
    res.json(ensayoCarpetaUnica(dbLicitaciones()));
  });
  r.get('/carpeta-unica/migracion', (_req, res) => {
    res.json(leerMigracion());
  });
  // Mueve carpetas en Drive: la lanza una persona tras revisar el ensayo; corre en segundo plano.
  r.post('/carpeta-unica/migracion', (_req, res) => {
    const m = migrarCarpetaUnica();
    if (m.error) {
      responder(res, m);
      return;
    }
    res.status(202).json(leerMigracion());
  });
  r.post('/sync', (_req, res) => {
    res.status(pedirSync() ? 202 : 503).json({ pedido: true });
  });
  r.post('/cribar', (_req, res) => {
    responder(res, pedirCriba(), 202);
  });
  r.post('/carpetas/reorganizar', comprobarCarpetas);
  r.post('/fichas/regeneracion', (req, res) => {
    const a = AccionRegeneracion.safeParse(req.body);
    if (!a.success) {
      res.status(400).json({ error: 'invalid_input', message: 'accion: pausar o reanudar.' });
      return;
    }
    responder(res, cambiarRegeneracion(nucleo().db, a.data.accion));
  });
  rutasCompetencia(r);
  rutasIndices(r);
  rutasCalidad(r);
  rutasPropuestas(r);
  rutasOferta(r);
  // Biblioteca › Huecos: lo que piden los pliegos y la Biblioteca no respalda.
  r.get('/biblioteca/huecos', (_req, res) => {
    huecosBiblioteca(dbLicitaciones()).then((h) => res.json(h), fallo(res, 'huecos de la Biblioteca', 'licitaciones'));
  });
  r.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  return r;
}
