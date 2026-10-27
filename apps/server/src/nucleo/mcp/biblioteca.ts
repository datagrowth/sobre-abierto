// Tools MCP del núcleo: Biblioteca, perfil de la empresa, estado, actividad y trabajos de IA.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { obtenerContextoPara, type ElementoContexto } from '../../biblioteca/motor/contexto.js';
import { crearPropuesta, ErrorBandeja } from '../../biblioteca/motor/bandeja.js';
import { MAX_BYTES_NOTA, ErrorBiblioteca } from '../../biblioteca/motor/notas.js';
import {
  listarDocumentos,
  leerPaginasDocumento,
  leerTexto,
  aRelativaBiblioteca,
  relativaBibliotecaOCruda,
  MAX_PAGINAS_LECTURA,
  MAX_CARACTERES_LECTURA,
} from '../../biblioteca/motor/documentos/lector.js';
import { pedirReescaneo } from '../../biblioteca/motor/documentos/servicioIndice.js';
import { getState, readSessionActivity } from '../hermes/observador.js';
import type { Agente } from '../agentes/registro.js';
import { usosRecientes } from '../agentes/auditoria.js';
import { ultimosEventos } from '../eventos.js';
import { estadoPlataforma, seccionesEstado } from '../estado.js';
import { listarTrabajos } from '../colaConsultas.js';
import {
  AVISO_IMPORTES,
  importesEnTexto,
  leerPerfilEmpresa,
  PerfilEmpresa,
  perfilParaAgentes,
  proponerPerfilEmpresa,
} from '../empresa.js';
import { nucleo } from '../contexto.js';
import { documentosParaAgente } from '../carpetaEmpresa.js';
import { fail, ok, type Result } from '../result.js';
import {
  CARPETA_COLABORADORES,
  carpetasOcultas,
  enColaboradores,
  puedeVerCvs,
  rutaAuditable,
} from '../colaboradores/cvs.js';
import {
  esCarpeta,
  leerDocumento,
  leerPaginas,
  leerSeccion,
  listarSalidas,
  MAX_LECTURA,
  MAX_PAGINAS_LECTURA as MAX_PAGINAS_SALIDAS,
  raicesActuales,
  rutaDeSalidas,
} from '../salidas.js';
import { carpetasConFicha, dominioConFicha } from '../documentos.js';
import { catalogoHerramientas } from './servidor.js';
import { permisosQueFaltan, registrarHerramienta, RESPUESTA_DETALLE, RESPUESTA_LECTURA } from './herramienta.js';

// La Biblioteca ofrece buscar, leer, documentos sin nota y proponer.
// Los CV de Colaboradores/ son datos de personas dentro de la Biblioteca: sin permiso de
// leer colaboradores no se buscan ni se leen, nunca se convierten en notas y la auditoría
// guarda su ruta como hash (el nombre del archivo suele ser el de la persona).
const SIN_PERMISO_CV =
  'Los CV de Colaboradores/ son datos personales: este agente no tiene permiso para leer colaboradores.';

// Las herramientas de propuestas dan las rutas con raíz («Conocimiento/…») y la Biblioteca es
// la propia raíz Conocimiento: se acepta la ruta copiada tal cual o sin el prefijo.
function sinRaiz(raw: string): string;
function sinRaiz(raw: string | undefined): string | undefined;
function sinRaiz(raw: string | undefined): string | undefined {
  return raw?.replace(/^Conocimiento(\/+|$)/, '');
}

function esCvAjeno(raw: string | undefined, agente: Agente): boolean {
  return raw !== undefined && enColaboradores(relativaBibliotecaOCruda(raw)) && !puedeVerCvs(agente.permisos);
}

function auditable(raw: string | undefined): string | null {
  return raw === undefined ? null : rutaAuditable(relativaBibliotecaOCruda(raw));
}

// Los errores conocidos de la Biblioteca llegan al agente con su mensaje.
async function desdeBiblioteca<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof ErrorBiblioteca || err instanceof ErrorBandeja) return fail(err.code, err.message);
    throw err;
  }
}

function rutaSegura(raw: string | undefined): Result<string | undefined> {
  if (!raw) return ok(undefined);
  try {
    return ok(aRelativaBiblioteca(raw));
  } catch {
    return fail('invalid_input', `«${raw}» no es una ruta dentro de la Biblioteca.`);
  }
}

const Buscar = z.object({
  consulta: z.string().trim().min(2).max(500).describe('Qué buscar, en lenguaje natural o palabras clave'),
  carpeta: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe(
      'Solo dentro de esta carpeta (con o sin «Conocimiento/» delante), p. ej. «Licitaciones/Presentadas» (lo que hemos presentado), «Licitaciones/Radar/2026» (pliegos del radar) o «Empresa»',
    ),
  limite: z.number().int().min(1).max(20).default(5),
});

// Un único formato: antes iban la lista con su fragmento y además el contexto en Markdown
// con los mismos pasajes, y cada búsqueda gastaba el doble de respuesta en texto repetido.
// El texto es el cuerpo (pasajes con su página o la nota) y, si no lo hay, el fragmento.
function resultadoDeBusqueda(i: ElementoContexto) {
  const frontmatter = i.frontmatter && Object.keys(i.frontmatter).length ? i.frontmatter : undefined;
  return {
    ruta: i.path,
    titulo: i.title,
    tipo: i.kind,
    score: i.score,
    frontmatter,
    texto: i.body ?? i.snippet,
    recortado: i.body_truncated || undefined,
  };
}

// Un dominio dice qué documentos de la Biblioteca no enseña a un agente aunque estén indexados
// (Licitaciones: las copias de un CV en la carpeta de una oferta, a quien no puede leer
// colaboradores). La ruta llega relativa a la Biblioteca. Devuelve el motivo o null.
const reservasBiblioteca = new Set<RutaReservada>();

export function reservarRutasBiblioteca(fn: RutaReservada): void {
  reservasBiblioteca.add(fn);
}

export function motivoBiblioteca(ruta: string, agente: Pick<Agente, 'permisos'>): string | null {
  for (const fn of reservasBiblioteca) {
    const motivo = fn(ruta, agente.permisos);
    if (motivo) return motivo;
  }
  return null;
}

async function buscar(args: z.infer<typeof Buscar>, agente: Agente): Promise<Result<unknown>> {
  const carpeta = sinRaiz(args.carpeta) || undefined;
  if (esCvAjeno(carpeta, agente)) return fail('forbidden', SIN_PERMISO_CV);
  // Se piden de más por si alguno está reservado: así siguen llegando «limite» resultados.
  const opciones = {
    limit: Math.min(20, args.limite * 2),
    body_max_chars: 3000,
    folder: carpeta,
    exclude_folders: carpetasOcultas(agente.permisos),
  };
  const ctx = await obtenerContextoPara(args.consulta, opciones);
  const visibles = ctx.items.filter((i) => motivoBiblioteca(i.path, agente) === null).slice(0, args.limite);
  return ok({ consulta: args.consulta, resultados: visibles.map(resultadoDeBusqueda) });
}

const Pagina = z.number().int().min(1).max(5000);
const Leer = z.object({
  ruta: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe(
      'Ruta dentro de la Biblioteca (la que devuelve biblioteca_buscar); puede ir con o sin «Conocimiento/» delante',
    ),
  desde: z.number().int().min(0).default(0).describe('Carácter desde el que leer, para documentos largos'),
  max: z.number().int().min(1).max(MAX_CARACTERES_LECTURA).default(MAX_CARACTERES_LECTURA),
  pagina_desde: Pagina.optional().describe(
    `Leer por páginas (PDF, PowerPoint, Excel): primera página. Si pides más de ${MAX_PAGINAS_LECTURA}, devuelve las ${MAX_PAGINAS_LECTURA} primeras y en «siguiente» la llamada para continuar; sustituye a «desde»`,
  ),
  pagina_hasta: Pagina.optional().describe('Última página (incluida); sin ella, solo pagina_desde'),
  sin_membretes: z
    .boolean()
    .default(false)
    .describe('Quita cabeceras y pies que se repiten en las páginas del documento; repítelo al seguir con «siguiente»'),
  desde_caracter: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .optional()
    .describe(
      'Con pagina_desde: carácter del texto de esas páginas desde el que seguir. Lo da «siguiente» cuando una página no cabe entera en una lectura',
    ),
});

function leer(entrada: z.infer<typeof Leer>): Promise<Result<unknown>> {
  const a = { ...entrada, ruta: sinRaiz(entrada.ruta) };
  if (a.pagina_desde === undefined) {
    if (a.pagina_hasta !== undefined || a.desde_caracter !== undefined)
      return Promise.resolve(fail('invalid_input', 'Indica pagina_desde (y, si quieres más de una, pagina_hasta).'));
    if (a.sin_membretes)
      return Promise.resolve(
        fail('invalid_input', 'sin_membretes solo vale al leer por páginas: indica pagina_desde.'),
      );
    return desdeBiblioteca(() => leerTexto(a.ruta, a.desde, a.max));
  }
  const hasta = a.pagina_hasta ?? a.pagina_desde;
  if (hasta < a.pagina_desde)
    return Promise.resolve(fail('invalid_input', 'pagina_hasta no puede ser menor que pagina_desde.'));
  return desdeBiblioteca(async () =>
    leerPaginasDocumento(a.ruta, {
      desde: a.pagina_desde!,
      hasta,
      desdeCaracter: a.desde_caracter,
      sinMembretes: a.sin_membretes,
    }),
  );
}

// Un dominio dice qué rutas de Salidas no lista ni lee un agente (Licitaciones: las que llevan los
// importes ofertados, para todos; las copias de un CV, para quien no puede leer colaboradores).
// Devuelve el motivo, o null si la ruta se le puede enseñar.
export type RutaReservada = (ruta: string, permisos: Agente['permisos']) => string | null;
const reservas = new Set<RutaReservada>();

export function reservarRutasSalidas(fn: RutaReservada): void {
  reservas.add(fn);
}

function motivoReserva(ruta: string, agente: Agente): string | null {
  for (const fn of reservas) {
    const motivo = fn(ruta, agente.permisos);
    if (motivo) return motivo;
  }
  return null;
}

const LeerSalidas = z.object({
  ruta: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      'Ruta dentro de Salidas, p. ej. «Licitaciones/2026-123 (p-12345678)/memoria.docx» (con o sin «Salidas/» delante), o la de la oferta en su carpeta única, «Conocimiento/Licitaciones/Ofertas/…/Oferta/…»',
    ),
  desde: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Carácter desde el que leer, para documentos largos (excluyente con pagina_desde y seccion)'),
  max: z.number().int().min(1).max(MAX_LECTURA).default(MAX_LECTURA),
  pagina_desde: Pagina.optional().describe(
    `Leer por páginas (PDF, PowerPoint, Excel): primera página. Máximo ${MAX_PAGINAS_SALIDAS} por llamada; en «siguiente_pagina_desde» va la página para seguir`,
  ),
  pagina_hasta: Pagina.optional().describe('Última página (incluida); sin ella, solo pagina_desde'),
  seccion: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Markdown: número N de la sección «## N.» a leer entera; si no cabe, trae «siguiente_desde»: sigue con desde=siguiente_desde',
    ),
});

function leerSalidas(a: z.infer<typeof LeerSalidas>, agente: Agente): Promise<Result<unknown>> {
  const raices = raicesActuales();
  const ruta = rutaDeSalidas(raices.salidas, a.ruta);
  const motivo = motivoReserva(ruta, agente);
  if (motivo) return Promise.resolve(fail('forbidden', motivo));
  if (esCarpeta(raices, ruta)) {
    return Promise.resolve(
      fail(
        'invalid_input',
        `«${ruta}» es una carpeta: usa salidas_listar (carpeta «${ruta.replace(/^Salidas\/?/, '')}»).`,
      ),
    );
  }
  const modo = [a.desde !== undefined, a.pagina_desde !== undefined, a.seccion !== undefined].filter(Boolean).length;
  if (modo > 1 || (a.pagina_hasta !== undefined && a.pagina_desde === undefined)) {
    return Promise.resolve(
      fail('invalid_input', 'Elige una sola forma de leer: desde/max, pagina_desde (con pagina_hasta) o seccion.'),
    );
  }
  if (a.seccion !== undefined) return leerSeccion(raices, ruta, a.seccion);
  if (a.pagina_desde !== undefined) return leerPaginas(raices, ruta, a.pagina_desde, a.pagina_hasta);
  return leerDocumento(raices, ruta, a.desde ?? 0, a.max);
}

const ListarSalidas = z.object({
  carpeta: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      'Carpeta dentro de Salidas, p. ej. «Licitaciones/123-2026 (p-12345678)», o la carpeta única de una licitación, «Conocimiento/Licitaciones/Ofertas/…»',
    ),
  // 4 niveles llegan a PRESENTACION/vN/Lote N/<n> Sobre X/, donde está lo que se presenta.
  profundidad: z.number().int().min(1).max(5).default(4),
});

// «hay_mas» y no «recortado»: serializar usa esa clave para su propio recorte y la pisaba, y el
// agente veía un total de 100 sin saber que el listado ya venía cortado.
function listarCarpetaSalidas(a: z.infer<typeof ListarSalidas>, agente: Agente): Result<unknown> {
  const raices = raicesActuales();
  const r = listarSalidas(raices, rutaDeSalidas(raices.salidas, a.carpeta), a.profundidad);
  if (r.error) return r;
  const { recortado, documentos, carpeta } = r.data;
  const motivos = documentos.map((d) => motivoReserva(d.ruta, agente));
  const visibles = documentos.filter((_, i) => motivos[i] === null);
  const ocultos = documentos.length - visibles.length;
  const por_que = [...new Set(motivos.filter((m): m is string => m !== null))].join(' ');
  return ok({ carpeta, documentos: visibles, hay_mas: recortado, ...(ocultos ? { ocultos, por_que } : {}) });
}

const seguirListado = (a: z.infer<typeof ListarSalidas>): string =>
  `Lista una subcarpeta de «${a.carpeta}» o baja «profundidad» (ahora ${a.profundidad}).`;

const SinNota = z.object({ limite: z.number().int().min(1).max(200).default(50) });

const Proponer = z.object({
  titulo: z.string().trim().min(1).max(200),
  contenido: z
    .string()
    .min(1)
    .refine((t) => Buffer.byteLength(t, 'utf8') <= MAX_BYTES_NOTA, 'contenido demasiado grande')
    .describe('Markdown; puede llevar frontmatter'),
  fuente: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('Documento del que sale la nota; la nota aprobada se guarda a su lado'),
  carpeta: z.string().trim().max(1000).optional().describe('Carpeta destino si no hay fuente'),
  motivo: z.string().trim().min(1).max(500).optional(),
});

async function proponer(args: z.infer<typeof Proponer>, agente: Agente): Promise<Result<unknown>> {
  if ([args.fuente, args.carpeta].some((r) => r !== undefined && enColaboradores(relativaBibliotecaOCruda(r)))) {
    return fail(
      'invalid_input',
      `Los CV de ${CARPETA_COLABORADORES}/ no se convierten en notas: el perfil se propone con colaboradores_proponer_perfil.`,
    );
  }
  const dominio = args.fuente === undefined ? null : dominioConFicha(relativaBibliotecaOCruda(args.fuente));
  if (dominio)
    return fail('invalid_input', `Ese documento ya lo analiza ${dominio} con su ficha: no se convierte en nota.`);
  const fuente = rutaSegura(args.fuente);
  if (fuente.error) return fuente;
  const carpeta = rutaSegura(args.carpeta);
  if (carpeta.error) return carpeta;
  const input = {
    title: args.titulo,
    body: args.contenido,
    source: fuente.data,
    folder: carpeta.data,
    reason: args.motivo,
    origin: agente.nombre,
  };
  const r = await desdeBiblioteca(() => crearPropuesta(input));
  if (r.error) return r;
  pedirReescaneo();
  return ok({ ruta: r.data.path, estado: 'pendiente de aprobar en la web' });
}

// Con todo junto la respuesta pasaba de 20.000 caracteres y llegaba cortada: cada parte se
// puede pedir sola.
const SECCIONES_ACTIVIDAD = ['sesiones', 'usos_de_agentes', 'eventos'] as const;
const Actividad = z.object({
  limite: z.number().int().min(1).max(50).default(15),
  seccion: z
    .enum(SECCIONES_ACTIVIDAD)
    .optional()
    .describe('Solo una parte: sesiones (acciones de Hermes), usos_de_agentes (herramientas por agente) o eventos'),
});

function sesionesRecientes(limite: number): unknown[] {
  return getState()
    .sessions.slice(0, 3)
    .map((s) => {
      const id = String(s.id ?? '');
      const acciones = readSessionActivity(id, limite)
        .filter((a) => a.kind === 'tool')
        .map(({ actor, category, tool, subject, status, at }) => ({
          actor,
          category,
          tool,
          subject,
          status,
          at: new Date(at).toISOString(),
        }));
      return { id, titulo: s['title'] ?? null, origen: s.source ?? null, acciones };
    });
}

function actividad(args: z.infer<typeof Actividad>): Result<unknown> {
  const { db } = nucleo();
  const partes: Record<(typeof SECCIONES_ACTIVIDAD)[number], () => unknown> = {
    sesiones: () => sesionesRecientes(args.limite),
    usos_de_agentes: () => usosRecientes(db, args.limite),
    eventos: () => ultimosEventos(db, args.limite),
  };
  const pedidas = args.seccion ? [args.seccion] : SECCIONES_ACTIVIDAD;
  return ok(Object.fromEntries(pedidas.map((p) => [p, partes[p]()])));
}

const Estado = z.object({
  seccion: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .optional()
    .describe(
      'Solo una parte: «trabajos» (cola de IA y fallos de los últimos 7 días por tipo y código), «licitaciones», «biblioteca», «colaboradores» o «agentes»',
    ),
});

// Qué herramientas tiene quien pregunta y cuáles le faltan, con el permiso que las daría:
// sin esto, una tool ausente parece que no existe.
// Se mira cada permiso que pide la herramienta, no solo el de su dominio: licitaciones_equipo
// pide también colaboradores:leer, y sin él no se registra.
function herramientasDelQueLlama(ag: Agente) {
  const tiene: string[] = [];
  const le_faltan: { nombre: string; permiso: string }[] = [];
  for (const h of catalogoHerramientas()) {
    const faltan = permisosQueFaltan(ag.permisos, h.nombre);
    if (faltan.length === 0) tiene.push(h.nombre);
    else le_faltan.push({ nombre: h.nombre, permiso: faltan.join(' y ') });
  }
  return { agente: ag.nombre, tiene, le_faltan };
}

function estado(a: z.infer<typeof Estado>, ag: Agente): Result<unknown> {
  if (a.seccion !== undefined && !seccionesEstado().includes(a.seccion))
    return fail('invalid_input', `No hay sección «${a.seccion}»: ${seccionesEstado().join(', ')}.`);
  const base = estadoPlataforma(a.seccion);
  if (a.seccion !== undefined && a.seccion !== 'agentes') return ok(base);
  return ok({ ...base, herramientas_del_que_llama: herramientasDelQueLlama(ag) });
}

const Trabajos = z.object({
  tipo: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .optional()
    .describe(
      'Tipo de trabajo, p. ej. «licitaciones.cribar» o «licitaciones.ficha» (los de plataforma_estado › trabajos)',
    ),
  estado: z.enum(['pendiente', 'lanzado', 'completado', 'fallido', 'cancelado']).optional(),
  codigo: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .optional()
    .describe(
      'Código del último fallo: sin_resultado, run_inactivo, run_perdido, run_tiempo_maximo, limite_uso, sin_herramienta, herramientas_desfasadas (espera: Hermes tiene la lista de herramientas de antes del despliegue), hermes_http_…',
    ),
  licitacion: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .optional()
    .describe('Id de la licitación (o de la convocatoria) del trabajo, p. ej. «p-12345678»'),
  dias: z.number().int().min(1).max(365).optional().describe('Solo los que cambiaron en los últimos N días'),
  desde: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .default(0)
    .describe('Posición desde la que listar: la «siguiente» de la respuesta anterior'),
  limite: z.number().int().min(1).max(50).default(20),
});

function trabajos(a: z.infer<typeof Trabajos>): Result<unknown> {
  const { licitacion, ...filtro } = a;
  return ok(listarTrabajos(nucleo().db, { ...filtro, recurso: licitacion }));
}

const ProponerEmpresa = z.object({
  perfil: PerfilEmpresa,
  motivo: z.string().trim().min(10).max(4000).describe('Fuente de cada dato y lo que queda por confirmar'),
});

const SIN_PERFIL =
  'Aún no hay perfil de empresa: se rellena en la web (Ajustes › Empresa) o se propone con plataforma_empresa_proponer.';

// La carpeta Empresa sale aunque falte el perfil: un certificado vigente sirve igual para la oferta.
function empresaParaAgente(ag: Agente) {
  const { db } = nucleo();
  const guardado = leerPerfilEmpresa(db);
  const documentos = documentosParaAgente(db, ag.permisos);
  if (guardado)
    return ok({
      ...guardado,
      perfil: perfilParaAgentes(guardado.perfil),
      importes_en_texto: importesEnTexto(guardado.perfil),
      aviso_importes: AVISO_IMPORTES,
      documentos,
    });
  return documentos.length ? ok({ perfil: null, aviso: SIN_PERFIL, documentos }) : fail('not_found', SIN_PERFIL);
}

export function herramientasBiblioteca(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'biblioteca_buscar',
    dominio: 'biblioteca',
    accion: 'leer',
    entrada: Buscar,
    descripcion:
      'Busca en la Biblioteca de Conocimiento (notas y documentos de Drive) por palabras y por significado. Devuelve, por resultado, su ruta (la que usa biblioteca_leer), título, tipo, puntuación y el texto que responde: de los documentos, los fragmentos con su página ([pág. N]); de las notas, la nota con su frontmatter. Hasta 3.000 caracteres por resultado (con «recortado», sigue con biblioteca_leer).',
    recurso: (a) => auditable(sinRaiz(a.carpeta)),
    ejecutar: buscar,
  });
  registrarHerramienta(server, agente, {
    nombre: 'biblioteca_leer',
    dominio: 'biblioteca',
    accion: 'leer',
    entrada: Leer,
    descripcion: `Lee una nota o un documento de la Biblioteca por partes, con marcas [pág. N]. Si «hasta» es menor que «total», sigue leyendo con desde=hasta. En PDF, PowerPoint y Excel también por páginas (pagina_desde y pagina_hasta; si pides más de ${MAX_PAGINAS_LECTURA}, devuelve las ${MAX_PAGINAS_LECTURA} primeras y en «siguiente» la llamada para continuar, que puede traer desde_caracter si una página no cabe entera): para leer entera una cláusula o un cuadro de características ya localizado, sin empezar por el principio. Si el texto se corta por caracteres, «ultima_pagina_completa» dice hasta qué página está entero. Con sin_membretes, quita las cabeceras y pies que se repiten en el documento y dice cuántas líneas quitó de las páginas leídas en «membretes_quitados»; repítelo al seguir con «siguiente».`,
    recurso: (a) => auditable(sinRaiz(a.ruta)),
    respuestaLarga: RESPUESTA_LECTURA,
    ejecutar: (a, ag) => {
      if (esCvAjeno(sinRaiz(a.ruta), ag)) return Promise.resolve(fail('forbidden', SIN_PERMISO_CV));
      const motivo = motivoBiblioteca(relativaBibliotecaOCruda(sinRaiz(a.ruta)), ag);
      return motivo ? Promise.resolve(fail('forbidden', motivo)) : leer(a);
    },
  });
  registrarHerramienta(server, agente, {
    nombre: 'salidas_leer',
    dominio: 'biblioteca',
    accion: 'leer',
    entrada: LeerSalidas,
    descripcion:
      'Lee un documento de la carpeta Salidas de Drive (borradores, propuestas, entregables: Markdown, PDF, Word, OpenDocument, PowerPoint o Excel) por partes, con marcas [pág. N] si tiene páginas. Si «hasta» es menor que «total», sigue con desde=hasta. Por páginas (pagina_desde y pagina_hasta, hasta 15) o, en Markdown, una sección «## N.» entera con seccion (si no cabe, sigue con desde=siguiente_desde). Una carpeta no se lee: se lista con salidas_listar. Los documentos con los importes de la oferta no se leen. Lo de Conocimiento se lee con biblioteca_leer.',
    recurso: (a) => rutaDeSalidas(null, a.ruta),
    respuestaLarga: RESPUESTA_LECTURA,
    ejecutar: leerSalidas,
  });
  registrarHerramienta(server, agente, {
    nombre: 'salidas_listar',
    dominio: 'biblioteca',
    accion: 'leer',
    entrada: ListarSalidas,
    descripcion:
      'Lista los documentos de una carpeta de Salidas y sus subcarpetas (4 niveles por defecto), con su ruta (la que usa salidas_leer), tamaño en bytes y fecha de modificación. Como mucho 100: con «hay_mas», lista una subcarpeta. Los documentos con los importes de la oferta no se listan ni se leen.',
    recurso: (a) => rutaDeSalidas(null, a.carpeta),
    comoSeguir: (a) => seguirListado(a),
    ejecutar: async (a, ag) => listarCarpetaSalidas(a, ag),
  });
  registrarHerramienta(server, agente, {
    nombre: 'biblioteca_documentos_sin_nota',
    dominio: 'biblioteca',
    accion: 'leer',
    entrada: SinNota,
    descripcion: `Documentos de la Biblioteca que aún no tienen nota ni propuesta pendiente, del más nuevo al más antiguo. No salen los CV de ${CARPETA_COLABORADORES}/ ni los pliegos y bases que ya analiza Licitaciones con su ficha: no se convierten en notas.`,
    ejecutar: (a) =>
      desdeBiblioteca(() => listarDocumentos(true, a.limite, [CARPETA_COLABORADORES, ...carpetasConFicha()])),
  });
  registrarHerramienta(server, agente, {
    nombre: 'biblioteca_proponer',
    dominio: 'biblioteca',
    accion: 'proponer',
    entrada: Proponer,
    descripcion:
      'Propone una nota nueva para la Biblioteca. Queda pendiente hasta que una persona la apruebe en la web; nunca se escribe directamente.',
    // La fuente o la carpeta, nunca el título: la auditoría no guarda contenidos.
    recurso: (a) => auditable(a.fuente ?? a.carpeta),
    ejecutar: proponer,
  });
  registrarHerramienta(server, agente, {
    nombre: 'plataforma_estado',
    dominio: 'plataforma',
    accion: 'leer',
    entrada: Estado,
    descripcion:
      'Estado de la plataforma: índice de la Biblioteca, ingesta de licitaciones, colaboradores, agentes y cola de trabajos de IA (cuántos hay por estado en total y en los últimos 7 días —por_estado_7_dias—, los fallos de esos 7 días por tipo y código, y los últimos trabajos con su recurso y su error recortado). Con «seccion», solo esa parte; con «agentes», qué herramientas tienes y cuáles te faltan y con qué permiso; si una herramienta no aparece, mira aquí antes de suponer que no existe. Los trabajos uno a uno, con plataforma_trabajos.',
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a, ag) => estado(a, ag),
  });
  registrarHerramienta(server, agente, {
    nombre: 'plataforma_trabajos',
    dominio: 'plataforma',
    accion: 'leer',
    entrada: Trabajos,
    descripcion:
      'Trabajos de la cola de IA (criba, fichas, guiones, memorias, anexos…) filtrados por tipo, estado, código del fallo, licitación y días, del más nuevo al más viejo y por páginas: «total» y «siguiente» (pásala como «desde»; null en la última). Cada uno con su código, intentos, recurso (la licitación u objeto del trabajo), error (hasta 1.500 caracteres, recortado por el final con «…»), fechas y métricas del run y, en los pendientes y en marcha, su posición en la cola, la hora estimada (eta.desde–eta.hasta, del percentil 5 al 95 de lo que tardaron los de su tipo la última semana; mas_de_lo_normal, si un run en marcha ya pasó eta.hasta) y el motivo de la espera: pausa_limite, freno, espera_herramienta, reintento, tope_oferta, plazo_cercano, sin_perfil o cola.',
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a) => trabajos(a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'plataforma_empresa',
    dominio: 'plataforma',
    accion: 'leer',
    entrada: z.object({}),
    descripcion:
      'Perfil de la empresa para evaluar requisitos de licitaciones: NIF, clasificaciones (grupo, subgrupo, categoría), volumen anual de negocio por año, certificaciones, seguro de responsabilidad civil, plantilla media, años de actividad, CPV con experiencia, mayor contrato similar de los últimos 3 años, tamaño y fecha de constitución (para el DEUC) y areas_formacion (materias de las formaciones que da la empresa; vacío = sin esa regla). En «documentos», la carpeta Empresa: tipo, nombre, ruta en la Biblioteca (para biblioteca_leer), caduca_en y estado (vigente, caduca_pronto a 30 días o menos, caducado, sin_fecha); no presentes un documento caducado. Los importes van en euros enteros e importes_en_texto los trae escritos («186.420,35 €»): cítalos y compáralos con esos. Lo guarda una persona en la web; un agente solo puede proponerlo con plataforma_empresa_proponer.',
    ejecutar: async (_a, ag) => empresaParaAgente(ag),
  });
  registrarHerramienta(server, agente, {
    nombre: 'plataforma_empresa_proponer',
    dominio: 'plataforma',
    accion: 'proponer',
    entrada: ProponerEmpresa,
    descripcion:
      'Propone el perfil de la empresa completo (no un parche: lo que no envíes queda vacío). No cambia el perfil vigente: una persona lo carga en el formulario de Empresa, lo revisa y lo guarda. Una propuesta nueva sustituye a la anterior. En «motivo», de dónde sale cada dato y qué falta por confirmar.',
    ejecutar: async (a, ag) => proponerPerfilEmpresa(nucleo().db, a.perfil, ag.nombre, a.motivo),
  });
  registrarHerramienta(server, agente, {
    nombre: 'plataforma_actividad',
    dominio: 'plataforma',
    accion: 'leer',
    entrada: Actividad,
    descripcion:
      'Actividad reciente: últimas acciones de Hermes en sus sesiones, uso de herramientas por agente y eventos entre dominios. Con «seccion», solo esa parte.',
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a) => actividad(a),
  });
}
