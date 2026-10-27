// API web del núcleo (/api/plataforma, detrás del login del servidor): lo que
// comparten los dominios y edita una persona, como el perfil de la empresa.
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { documentosSinNota, PedidoNota, pedirNotas, usosDeNotas } from './bibliotecaGestion.js';
import { resumenPorDominio } from './colaResumen.js';
import { nucleo } from './contexto.js';
import { cerrarPropuestaEmpresa, guardarPerfilEmpresa, leerPerfilEmpresa, leerPropuestaEmpresa } from './empresa.js';
import { ConsultaHoy, resumenHoy } from './hoy.js';
import { guardarPerfilCostes, leerPerfilCostes } from './perfilCostes.js';
import { automatismos, cronHermes } from './programado.js';
import { cancelarTrabajo } from './colaRelanzado.js';
import { operacionCola } from './colaEstadisticas.js';
import {
  borrarDocumentoEmpresa,
  cambiarDocumentoEmpresa,
  EXTENSIONES_EMPRESA,
  listarDocumentosEmpresa,
  MAX_DOCUMENTO_EMPRESA,
  subirDocumentoEmpresa,
} from './carpetaEmpresa.js';
import { recibirArchivo } from './subidas.js';
import { fallo, responder } from './http.js';
import { fail, ok, type Result } from './result.js';
import { raicesActuales } from './salidas.js';
import { rutasUsuarios } from './usuariosRutas.js';
import { guardarPreferencias, preferenciasDe, tieneEmail } from './avisosPersona.js';
import { configResumen, guardarConfigResumen, resumenSemanal } from './avisos.js';
import { enviarCorreo, hayCorreo } from './correo.js';
import { montarCorreo } from './correoPlantillas.js';
import { listarUsuarios, usuarioPorId } from './usuarios.js';
import { EXTENSIONES_LOGO, guardarLogo, guardarMarca, leerMarca, MAX_LOGO, quitarLogo } from './marca.js';
import { crearEnlaceCalendario, estadoCalendario, revocarCalendario } from './calendario.js';
import { quienDe, usuarioDe } from './permisos.js';
import { crearToken, listarTokens, revocarToken } from './apiLectura.js';
import { estadoMcp } from './mcp/estado.js';
import {
  comentariosDe,
  leerMenciones,
  mencionesSinLeer,
  publicarComentario,
  resolverComentario,
  type Autor,
} from './comentarios.js';
import { alcanza } from './usuarios.js';

const IdTrabajo = z.coerce.number().int().positive();
const ESTADO_HTTP: Record<string, number> = { not_found: 404, conflict: 409 };

export function rutasPlataforma(): Router {
  const r = Router();
  r.use(express.json({ limit: '128kb' }));
  r.get('/empresa', (_req, res) => {
    const { db } = nucleo();
    const guardado = leerPerfilEmpresa(db);
    res.json({ ...(guardado ?? { perfil: null, actualizado_en: null }), propuesta: leerPropuestaEmpresa(db) });
  });
  r.delete('/empresa/propuesta', (_req, res) => {
    res.json({ cerrada: cerrarPropuestaEmpresa(nucleo().db) });
  });
  r.put('/empresa', (req, res) => {
    const g = guardarPerfilEmpresa(nucleo().db, req.body);
    if (g.error) res.status(400).json({ error: g.error.code, message: g.error.message });
    else res.json(g.data);
  });
  // Solo para la web (Ajustes › Empresa): los euros nunca van a un agente.
  r.get('/empresa/costes', (_req, res) => {
    const { db, config } = nucleo();
    res.json(leerPerfilCostes(db, config.licitaciones.precioHora));
  });
  r.put('/empresa/costes', (req, res) => {
    const { db, config } = nucleo();
    responder(res, guardarPerfilCostes(db, req.body, config.licitaciones.precioHora));
  });
  // La marca de la instalación (Ajustes › Marca): la lee cualquiera; la cambia un admin (permisos.ts).
  r.get('/marca', (_req, res) => {
    res.json(leerMarca(nucleo().db));
  });
  r.put('/marca', (req, res) => {
    responder(res, guardarMarca(nucleo().db, req.body));
  });
  r.put('/marca/logo', (req, res) => {
    subirLogo(req, res).catch(fallo(res, 'logo sin subir', 'plataforma'));
  });
  r.delete('/marca/logo', (_req, res) => {
    res.json(quitarLogo(nucleo().db));
  });
  r.get('/empresa/documentos', (_req, res) => {
    res.json({ documentos: listarDocumentosEmpresa(nucleo().db) });
  });
  r.post('/empresa/documentos', (req, res) => {
    subirEmpresa(req, res).catch(fallo(res, 'documento de empresa sin subir', 'plataforma'));
  });
  r.patch('/empresa/documentos/:id', (req, res) => {
    conIdDocumento(req, res, (id) => cambiarDocumentoEmpresa(nucleo().db, id, req.body ?? {}));
  });
  r.delete('/empresa/documentos/:id', (req, res) => {
    conIdDocumento(req, res, (id) => borrarDocumentoEmpresa(nucleo().db, id));
  });
  r.get('/hoy', (req, res) => {
    const q = ConsultaHoy.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: 'invalid_input', message: 'desde: fecha ISO con zona horaria' });
      return;
    }
    resumenHoy(q.data.desde).then(
      (h) => res.json(h),
      () => res.status(500).json({ error: 'internal_error' }),
    );
  });
  // Biblioteca: documentos sin nota, «Pedir nota» y en cuántas ofertas se usó cada nota.
  r.get('/biblioteca/sin-nota', (_req, res) => {
    documentosSinNota().then((d) => res.json(d), fallo(res, 'documentos sin nota', 'nucleo'));
  });
  r.get('/biblioteca/usos', (_req, res) => {
    res.json({ usos: usosDeNotas(nucleo().db) });
  });
  r.post('/biblioteca/pedir-nota', (req, res) => {
    const p = PedidoNota.safeParse(req.body ?? {});
    if (!p.success) return responder(res, fail('invalid_input', z.prettifyError(p.error)));
    pedirNotas(nucleo().db, p.data).then((x) => responder(res, x, 202), fallo(res, 'pedir nota', 'nucleo'));
  });
  r.get('/programado', (_req, res) => {
    res.json({ automatismos: automatismos(), hermes: cronHermes(nucleo().config.hermesHome) });
  });
  // La pastilla «Hermes» de la barra lateral, separada por dominio.
  r.get('/cola/resumen', (_req, res) => {
    res.json(resumenPorDominio(nucleo().db, Date.now()));
  });
  r.get('/trabajos/estado', (_req, res) => {
    res.json(operacionCola(nucleo().db));
  });
  // «Cancelar» de Ajustes › Estado: sobre todo, lo que lleva horas en cola sin salir.
  r.post('/trabajos/:id/cancelar', (req, res) => {
    const id = IdTrabajo.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: 'invalid_input', message: 'id: número de trabajo' });
      return;
    }
    const c = cancelarTrabajo(nucleo().db, id.data);
    if (c.error) res.status(ESTADO_HTTP[c.error.code] ?? 500).json({ error: c.error.code, message: c.error.message });
    else res.json(c.data);
  });
  r.use('/usuarios', rutasUsuarios());
  // Ajustes › Integraciones (solo admin, permisos.ts): los tokens de la API de lectura y el MCP.
  r.get('/integraciones/tokens', (_req, res) => {
    res.json({ tokens: listarTokens(nucleo().db) });
  });
  r.post('/integraciones/tokens', (req, res) =>
    responder(res, crearToken(nucleo().db, quienDe(req), req.body ?? {}), 201),
  );
  r.delete('/integraciones/tokens/:id', (req, res) => {
    const id = IdTrabajo.safeParse(req.params['id']);
    if (!id.success) return responder(res, fail('invalid_input', 'Token no válido.'));
    responder(res, revocarToken(nucleo().db, id.data));
  });
  r.get('/integraciones/mcp', (_req, res) => {
    res.json(estadoMcp(nucleo().db));
  });
  // Quién hay en el equipo para elegir responsable o mencionar: cualquiera lo lee, sin emails.
  r.get('/companeros', (_req, res) => {
    res.json({
      companeros: listarUsuarios(nucleo().db)
        .filter((u) => u.activo)
        .map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol })),
    });
  });
  // Los avisos de quien entra (Ajustes › Avisos › Tus avisos). El acceso de emergencia no es una persona.
  r.get('/yo/avisos', (req, res) => conPersona(req, res, (id) => responder(res, ok(preferenciasDe(nucleo().db, id)))));
  r.put('/yo/avisos', (req, res) =>
    conPersona(req, res, (id) => responder(res, guardarPreferencias(nucleo().db, id, req.body ?? {}))),
  );
  // El enlace del calendario ICS de quien entra (Ajustes › Integraciones): el token, solo al crearlo.
  r.get('/yo/calendario', (req, res) =>
    conPersona(req, res, (id) => responder(res, ok(estadoCalendario(nucleo().db, id)))),
  );
  r.post('/yo/calendario', (req, res) =>
    conPersona(req, res, (id) => {
      const { ruta } = crearEnlaceCalendario(nucleo().db, id);
      const base = nucleo().config.urlWeb;
      responder(res, ok({ ...estadoCalendario(nucleo().db, id), url: base ? `${base}${ruta}` : null, ruta }), 201);
    }),
  );
  r.delete('/yo/calendario', (req, res) =>
    conPersona(req, res, (id) => {
      revocarCalendario(nucleo().db, id);
      responder(res, ok(estadoCalendario(nucleo().db, id)));
    }),
  );
  // Comentarios con menciones: cualquiera comenta; la firma es la de la sesión.
  r.get('/comentarios', (req, res) => responder(res, comentariosDe(nucleo().db, req.query)));
  r.post('/comentarios', (req, res) =>
    responder(res, publicarComentario(nucleo().db, autorDe(req), req.body ?? {}), 201),
  );
  r.patch('/comentarios/:id', (req, res) => {
    const id = IdTrabajo.safeParse(req.params['id']);
    if (!id.success) return responder(res, fail('invalid_input', 'Comentario no válido.'));
    const u = usuarioDe(req);
    responder(
      res,
      resolverComentario(
        nucleo().db,
        id.data,
        { ...autorDe(req), puedeEditar: !u || alcanza(u.rol, 'editor') },
        req.body ?? {},
      ),
    );
  });
  r.get('/yo/menciones', (req, res) =>
    conPersona(req, res, (id) => {
      const m = mencionesSinLeer(nucleo().db, id);
      res.json({ sin_leer: m.length, menciones: m });
    }),
  );
  r.post('/yo/menciones/leidas', (req, res) =>
    conPersona(req, res, (id) => responder(res, leerMenciones(nucleo().db, id, req.body ?? {}))),
  );
  // El resumen semanal (Ajustes › Avisos): cualquiera lo ve; cambiarlo y probarlo, solo un admin (permisos.ts).
  r.get('/avisos/config', (_req, res) => {
    const { db, config } = nucleo();
    const usuarios = listarUsuarios(db)
      .filter((u) => u.activo)
      .map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, con_email: tieneEmail(u.email) }));
    res.json({
      config: configResumen(db),
      smtp: hayCorreo(),
      url_web: config.urlWeb !== null,
      aviso_smtp: config.correoAviso,
      usuarios,
    });
  });
  r.put('/avisos/config', (req, res) => responder(res, guardarConfigResumen(nucleo().db, req.body ?? {})));
  r.get('/avisos/resumen/previa', (_req, res) => {
    const { db, config } = nucleo();
    res.type('html').send(montarCorreo(resumenSemanal(db), config.urlWeb, leerMarca(db)).html);
  });
  r.post('/avisos/resumen/prueba', (req, res) =>
    conPersona(req, res, (id) => {
      const { db, config } = nucleo();
      const yo = usuarioPorId(db, id);
      if (!yo || !tieneEmail(yo.email))
        return responder(res, fail('invalid_input', 'Pon tu email en Ajustes › Usuarios para recibir la prueba.'));
      const correo = montarCorreo(resumenSemanal(db), config.urlWeb, leerMarca(db));
      enviarCorreo({ ...correo, asunto: `[Prueba] ${correo.asunto}`, para: yo.email }, 'resumen_prueba').then(
        (r) => responder(res, r.error ? r : ok({ enviado: true })),
        fallo(res, 'prueba del resumen', 'avisos'),
      );
    }),
  );
  r.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  return r;
}

// El acceso de emergencia (y las pruebas sin login) firman con su nombre, sin persona detrás.
const autorDe = (req: Request): Autor => ({ id: usuarioDe(req)?.id || null, nombre: quienDe(req) });

function conPersona(req: Request, res: Response, fn: (usuarioId: number) => void): void {
  const id = usuarioDe(req)?.id ?? 0;
  if (!id) return responder(res, fail('invalid_input', 'Entra con tu email para tener avisos propios.'));
  fn(id);
}

const IdDocumento = z.coerce.number().int().positive();

function conIdDocumento<T>(req: Request, res: Response, fn: (id: number) => Result<T>): void {
  const id = IdDocumento.safeParse(req.params['id']);
  if (!id.success) return responder(res, fail('invalid_input', 'Documento no válido.'));
  responder(res, fn(id.data));
}

// El formulario lleva el archivo y un solo campo «datos» (JSON con tipo, nombre, caducidad…):
// recibirArchivo admite pocos campos de texto y así se valida todo de una vez con zod.
async function subirLogo(req: Request, res: Response): Promise<void> {
  const a = await recibirArchivo(req, { maxBytes: MAX_LOGO, extensiones: EXTENSIONES_LOGO });
  responder(res, a.error ? a : guardarLogo(nucleo().db, a.data.datos));
}

async function subirEmpresa(req: Request, res: Response): Promise<void> {
  const raiz = raicesActuales().conocimiento;
  if (!raiz)
    return responder(res, fail('no_configurado', 'No hay Biblioteca configurada: la carpeta Empresa vive en ella.'));
  const a = await recibirArchivo(req, { maxBytes: MAX_DOCUMENTO_EMPRESA, extensiones: EXTENSIONES_EMPRESA });
  if (a.error) return responder(res, a);
  let datos: unknown;
  try {
    datos = JSON.parse(a.data.campos['datos'] ?? '{}');
  } catch {
    return responder(res, fail('invalid_input', '«datos» tiene que ser JSON.'));
  }
  responder(res, await subirDocumentoEmpresa(nucleo().db, raiz, a.data, datos), 201);
}
