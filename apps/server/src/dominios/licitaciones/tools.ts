// Tools MCP del dominio Licitaciones: leer con cualquier token; cribar y enviar con «proponer».
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../nucleo/agentes/registro.js';
import { puede } from '../../nucleo/agentes/permisos.js';
import {
  registrarHerramienta,
  RESPUESTA_DETALLE,
  RESPUESTA_LOTE,
  type ComoSeguir,
  type InfoRecorte,
} from '../../nucleo/mcp/herramienta.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { aplicarCriba, candidatasDelLote, Criba } from './criba.js';
import {
  detalle,
  detalleParaAgente,
  ESTADOS_LISTA,
  Filtro,
  listarOportunidades,
  plazosParaAgente,
  resumenParaAgente,
  sinCifrasDelPerfil,
} from './oportunidades.js';
import { dbLicitaciones } from './db.js';
import { FichaEntrada, proponerFicha } from './ficha.js';
import { nucleo } from '../../nucleo/contexto.js';
import { herramientasCompetencia } from './competencia/tools.js';
import { herramientasPropuestas } from './propuestas/tools.js';
import { herramientasOferta } from './oferta/tools.js';
import { herramientaPreguntaPliego, herramientasActasMercado } from './actasMercadoTools.js';
import { herramientasIndices } from './indices/tools.js';
import { equipoDeLicitacion } from './equipo.js';
import {
  calcularPrecios,
  comparablesDeLicitacion,
  comparablesDeSegmento,
  consultaDeSegmento,
  OpcionesPrecios,
  preciosDeLicitacion,
  SegmentoPrecios,
} from './precios/index.js';
import { antecedentesDe, OpcionesAntecedentes, resumenAntecedentes } from './antecedentes/index.js';
import { COMO_SE_ELIGEN } from './precios/comparables.js';
import { barreras, OpcionesBarreras } from './barreras.js';
import { leerPerfilEmpresa, zonaEmpresa } from '../../nucleo/empresa.js';
import { LARGO_PASAJE, pasajesDeLicitacion } from './pasajes.js';
import { TEMAS, TEMAS_MEMORIA } from './temas.js';
import { reservarRutasBiblioteca, reservarRutasSalidas } from '../../nucleo/mcp/biblioteca.js';
import { MOTIVO_IMPORTES, rutaConImportes } from './oferta/rutasConImportes.js';
import { esCopiaPersonal, MOTIVO_COPIA_PERSONAL } from './oferta/reutilizar.js';
import { puedeVerCvs } from '../../nucleo/colaboradores/cvs.js';
import { resumenSinNombres, taparPersonas } from './oferta/ofertaAgente.js';
import { informeCobertura } from './cobertura.js';

// Al cargar el dominio: salidas_listar y salidas_leer (núcleo) no enseñan los importes ofertados,
// ni las copias de un CV o de un documento de una persona a quien no puede leer colaboradores.
reservarRutasSalidas((ruta) => (rutaConImportes(dbLicitaciones(), ruta) ? MOTIVO_IMPORTES : null));
reservarRutasSalidas((ruta, permisos) =>
  !puedeVerCvs(permisos) && esCopiaPersonal(ruta) ? MOTIVO_COPIA_PERSONAL : null,
);
// Con la carpeta única la oferta está en Conocimiento y la Biblioteca la indexa entera para
// aprender de lo pasado, importes incluidos; las copias de un CV siguen solo para quien puede leerlos.
reservarRutasBiblioteca((ruta, permisos) =>
  !puedeVerCvs(permisos) && esCopiaPersonal(`/${ruta}`) ? MOTIVO_COPIA_PERSONAL : null,
);

// Leer: cualquier agente con token. Cribar, enviar fichas, guiones, apartados de la memoria, borradores y
// evaluaciones: solo los agentes con «proponer» en licitaciones (Hermes y su perfil «licitaciones»). El equipo
// propuesto exige además leer colaboradores.
// Estricto para el agente: una clave inventada («estado» en vez de «estados») se ignoraba y
// devolvía la lista por defecto sin avisar. La web sigue con `Filtro`.
const FiltroAgente = z.strictObject(
  { ...Filtro.shape, limite: z.number().int().min(1).max(100).default(10) },
  {
    error: (iss) =>
      iss.code === 'unrecognized_keys'
        ? `Clave desconocida ${iss.keys.map((k) => `«${k}»`).join(', ')}. Usa «estados» (lista: ${ESTADOS_LISTA.join(', ')}), «texto», «limite» (1-100, por defecto 10), «pagina», «orden» (plazo, importe, llegada) o «comunidad». Por ejemplo {"estados": ["descartada"]}.`
        : undefined,
  },
);

const SEGUIR_TEXTOS =
  'Se recortaron textos largos (ver «cadenas»), no oportunidades: el detalle entero de una, con licitaciones_ver.';

// Con otro «limite» la página siguiente no empieza donde acabó la recortada: solo se calcula si
// cuadra. Solo un recorte de la lista de filas («items») trae filas en «devueltos»: el de una
// cadena trae caracteres, y con 0 filas la cuenta daba NaN y un «limite» fuera de rango.
export function seguirOportunidades(
  a: Pick<z.infer<typeof FiltroAgente>, 'pagina' | 'limite'>,
  info: InfoRecorte,
): ComoSeguir {
  if (info.campo !== 'items') return SEGUIR_TEXTOS;
  if (info.devueltos < 1) return 'Pide limite=1 desde pagina 1.';
  const desde = (a.pagina - 1) * a.limite;
  if (desde % info.devueltos === 0) return { limite: info.devueltos, pagina: desde / info.devueltos + 2 };
  return `Pide limite menor (p. ej. ${info.devueltos}) desde pagina 1.`;
}

const Ver = z.object({ id: z.string().trim().min(3).max(40).describe('Id de la licitación, p. ej. «p-12345678»') });
const Plazos = z.object({ dias: z.number().int().min(1).max(90).default(14) });
const Candidatas = z.object({ lote: z.number().int().positive() });
// Una licitación por id o un segmento por CPV (+ importe, tipo y procedimiento).
const PorLicitacionOSegmento = OpcionesPrecios.extend({ id: Ver.shape.id.optional() }).extend(
  SegmentoPrecios.partial().shape,
);
// Comparables no usa el tramo de ofertas ni las bajas: no se ofrecen al agente.
const Comparables = PorLicitacionOSegmento.omit({ ofertas: true, filtrar_ofertas: true, bajas: true }).extend({
  limite: z.number().int().min(1).max(50).default(15),
});
type ConsultaTool = z.infer<typeof PorLicitacionOSegmento>;
const Antecedentes = Ver.extend(OpcionesAntecedentes.shape);
const Pliegos = Ver.extend({
  temas: z
    .array(z.enum(TEMAS))
    .max(TEMAS.length)
    .optional()
    .describe(
      `Solo estos temas; sin ellos, los de la ficha (todos salvo ${TEMAS_MEMORIA.join(', ')}, que son para redactar la memoria)`,
    ),
  max_por_tema: z.number().int().min(1).max(10).default(4).describe('Pasajes por tema'),
  max_caracteres: z
    .number()
    .int()
    .min(500)
    .max(4000)
    .default(LARGO_PASAJE)
    .describe(
      'Largo máximo de cada pasaje: el párrafo que responde y lo que le sigue en esa página. Con muchos temas a la vez se acorta para que la respuesta llegue entera',
    ),
});
// pasajes.ts reparte 120.000 caracteres de texto entre todos los pasajes: con el sobre JSON y
// los saltos de línea escapados cabe con margen.
const RESPUESTA_PASAJES = 160_000;

// licitaciones_ver lleva el resumen de antecedentes (nivel de indicios) para que el agente
// lo tenga en cuenta sin pedir la línea de tiempo entera.
function ver(id: string, verPerfil: boolean): Result<unknown> {
  const d = detalle(dbLicitaciones(), id);
  if (d.error) return d;
  const antecedentes = resumenAntecedentes(dbLicitaciones(), id).data;
  return ok(detalleParaAgente(verPerfil ? d.data : sinCifrasDelPerfil(d.data), antecedentes, zonaEmpresa(nucleo().db)));
}

function precios(a: ConsultaTool): Result<unknown> {
  const minimo = nucleo().config.licitaciones.preciosMinimo;
  if (a.id) return preciosDeLicitacion(dbLicitaciones(), a.id, a, minimo);
  if (!a.cpv) return fail('invalid_input', 'Indica id (una licitación) o cpv (un segmento, mejor con importe y tipo).');
  return ok(calcularPrecios(dbLicitaciones(), consultaDeSegmento({ ...a, cpv: a.cpv }, a), a, minimo));
}

function similares(a: z.infer<typeof Comparables>): Result<unknown> {
  if (a.id) return comparablesDeLicitacion(dbLicitaciones(), a.id, a, a.limite);
  if (!a.cpv) return fail('invalid_input', 'Indica id (una licitación) o cpv (un segmento, mejor con importe y tipo).');
  return ok(comparablesDeSegmento(dbLicitaciones(), { ...a, cpv: a.cpv }, a, a.limite));
}

export function herramientasLicitaciones(server: McpServer, agente: Agente): void {
  herramientaBarreras(server, agente);
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_oportunidades',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: FiltroAgente,
    comoSeguir: seguirOportunidades,
    descripcion:
      'Oportunidades de licitación que sigue la empresa, por «estados» (lista; por defecto nueva, ficha_por_revisar y en_preparacion), ordenadas por el próximo plazo (la solicitud de participación mientras siga abierta), 10 por página por defecto; sigue con «pagina». «nueva» son las cribadas que aún esperan tu ficha; «ficha_por_revisar», las que ya la tienen y no se descartaron; «con_error», las nuevas que el proceso automático ya no saca adelante (pliegos sin bajar o ilegibles, ficha fallida), con el motivo en error_proceso. «descartada» solo trae las que siguen en plazo. Incluye importe, órgano, CPV, el plazo en ISO con zona y en texto (hora peninsular y, si la empresa está en Canarias, la de allí) y el veredicto de la criba.',
    ejecutar: async (a, ag) => {
      const r = listarOportunidades(dbLicitaciones(), a);
      // El primer bloqueo puede nombrar a una persona («Persona J lo tiene, asígnala al rol»).
      const tapar = puede(ag.permisos, 'colaboradores', 'leer') ? null : taparPersonas(nucleo().db);
      const zona = zonaEmpresa(nucleo().db);
      return ok({ ...r, items: r.items.map((x) => resumenSinNombres(resumenParaAgente(x, zona), tapar)) });
    },
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_ver',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Ver,
    descripcion:
      'Todo de una licitación: datos de la PLACSP (criterios con pesos, requisitos, garantías, lotes, documentos, adjudicaciones), estado de la oportunidad, lotes (con los que encajaron en el prefiltro y los de interés de la criba), pliegos descargados con su ruta en la Biblioteca, go_no_go (semáforo, regla de presentación por lotes, ámbito evaluado —lotes de interés o total—, requisitos ya evaluados contra el perfil de la empresa y la ficha) y antecedentes (nivel bajo/medio/alto de indicios de «licitación con nombre», ediciones anteriores, adjudicatario anterior e indicios; el detalle, con licitaciones_antecedentes).',
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a, ag) => ver(a.id, puede(ag.permisos, 'plataforma', 'leer')),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_antecedentes',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Antecedentes,
    descripcion:
      'Antecedentes de una licitación (por id): ediciones anteriores del mismo órgano (por NIF o, sin él, por DIR3 o nombre) con objeto parecido, publicadas al menos seis meses antes, con una línea de tiempo (año, expediente, enlace, quién ganó con NIF y nombre, importe, baja, ofertas, duración, inicio y fin), del contrato y de cada lote; e indicios de «licitación con nombre» (mismo adjudicatario, pocas ofertas, bajas mínimas, continuidad, plazo ajustado, solvencia alta y señales del pliego de la ficha), cada uno con su explicación, su dato y sus puntos, y el nivel bajo/medio/alto con las reglas. Son indicios, no pruebas: la PLACSP solo publica quién ganó.',
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a) => antecedentesDe(dbLicitaciones(), a.id, a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_pliegos',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Pliegos,
    descripcion: `Pasajes de los pliegos ya bajados e indexados de una licitación, por tema (${TEMAS.join(', ')}), cada uno con su ruta, clase (pcap, ppt, adicional), página y texto; encontrado=false si ningún pliego habla de ese tema. Es el punto de partida de la ficha: no leas los pliegos desde el principio; si un pasaje se corta, lee esa cláusula o el cuadro de características entero con biblioteca_leer por páginas (pagina_desde y pagina_hasta). «documentos» dice qué pliegos no se pueden leer.`,
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_PASAJES,
    ejecutar: (a) =>
      pasajesDeLicitacion(dbLicitaciones(), a.id, {
        temas: a.temas,
        maxPorTema: a.max_por_tema,
        maxCaracteres: a.max_caracteres,
      }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_plazos',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Plazos,
    descripcion:
      'Oportunidades que seguimos con fin de plazo de presentación en los próximos N días, con el plazo en ISO con zona y en texto (hora peninsular y de Canarias), el semáforo de requisitos y lo que espera revisión.',
    ejecutar: async (a) => ok(plazosParaAgente(dbLicitaciones(), a.dias)),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_candidatas',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Candidatas,
    descripcion:
      'Candidatas de un lote de criba, en formato compacto (con la regla de presentación por lotes, los máximos y los lotes con id, nombre, importe y CPV), y la ruta del perfil de la empresa con el que hay que cribarlas.',
    recurso: (a) => `lote-${a.lote}`,
    respuestaLarga: RESPUESTA_LOTE,
    ejecutar: async (a) => candidatasDelLote(dbLicitaciones(), a.lote),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_cribar',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: Criba,
    descripcion:
      'Envía los veredictos de un lote de criba: exactamente uno por candidata, con veredicto (interesa, descartar o revisar), motivo, confianza de 0 a 1 y, en licitaciones con lotes a las que se puede ir por lotes sueltos, los lotes de interés con su motivo. Si falta o sobra alguno, o un lote no existe o la regla no deja elegirlo, se rechaza entero y se explica qué corregir.',
    recurso: (a) => `lote-${a.lote}`,
    ejecutar: async (a) => aplicarCriba(dbLicitaciones(), a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_ficha',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: FichaEntrada,
    descripcion:
      'Envía la ficha de una licitación leída de sus pliegos: resumen, requisitos (tipo, excluyente, cumple si/no/dudoso con justificación y página), criterios con peso y tipo, documentación por sobre, hitos, garantías, penalizaciones, riesgos, recomendación go/no_go/revisar, si la PLACSP no publica la regla de presentación por lotes, la del PCAP (presentacion_lotes) y, si las hay, senales_pliego (señales de pliego a medida con cita y página, y lote si son de uno solo, que suman a los indicios de «licitación con nombre»). Se aplica al llegar: si un requisito excluyente da «no» (o hay que ir a todos los lotes y el total se sale de los filtros), la oportunidad se descarta sola; también pasa sola a Descartadas si la recomendación es no_go y la oportunidad sigue por decidir (nueva o ficha por revisar, sin cambio a mano); si una ficha posterior deja de ser no_go, vuelve sola a Ficha por revisar, y si una persona la recuperó, otra no_go ya no la descarta; si ya había ficha, la sustituye.',
    recurso: (a) => a.id,
    ejecutar: (a, ag) => proponerFicha(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_cobertura',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: z.object({}),
    descripcion:
      'Auditoría de cobertura de la PLACSP por comunidad autónoma: por semana cerrada (lunes, hora peninsular), las licitaciones de nuestro sector que trajo la agregada y los perfiles, por lugar de ejecución, y lo que publicó la plataforma autonómica si alguien lo apuntó. «falta» es lo que le falta a la agregada frente a la autonómica en las semanas comparadas; con más de un 5 % el veredicto es «anadir_fuente». Solo informa.',
    ejecutar: async () => ok(informeCobertura(dbLicitaciones())),
  });
  herramientasPrecios(server, agente);
  herramientasCompetencia(server, agente);
  herramientaEquipo(server, agente);
  herramientasPropuestas(server, agente);
  herramientasOferta(server, agente);
  herramientasActasMercado(server, agente);
  herramientaPreguntaPliego(server, agente);
  herramientasIndices(server, agente);
}

const Equipo = Ver.extend({
  limite: z.number().int().min(1).max(20).default(5).describe('Candidatos por requisito y tipo'),
});

// Devuelve datos de personas (dominio colaboradores): sin permiso para leerlas, ni se ofrece.
function herramientaEquipo(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_equipo',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Equipo,
    requiere: [['colaboradores', 'leer']],
    descripcion:
      'Equipo propuesto para una licitación: por cada requisito de medios personales de su ficha, los colaboradores internos y externos que mejor encajan, con puntuación 0–100, si cumplen los mínimos y cada regla (años, titulación, certificación, idioma) con su detalle, más la afinidad (tecnologías, CPV, CV parecido). Sin ficha no hay requisitos: usa colaboradores_buscar con el texto del requisito. Orientativo: revisa los CV.',
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: (a) => equipoDeLicitacion(dbLicitaciones(), nucleo().db, a.id, a.limite),
  });
}

function herramientaBarreras(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_barreras',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: OpcionesBarreras,
    descripcion:
      'Qué nos falta: certificaciones (ENS, ISO…), seguro de responsabilidad civil, clasificación empresarial y habilitaciones que piden las oportunidades seguidas (las de los últimos «meses», sin las sin cribar), con cuántas veces lo piden, cuántas no lo cumplimos, cuántas nos deja fuera (excluyente), el importe de las que no cumplimos, lo exigido y ejemplos. En «personal», la experiencia del personal que piden (por materia: «5 años en monitorización de medios») y nos falta o nos dejó fuera. Sale de los requisitos de la PLACSP y de las fichas; sirve para decidir qué certificación sacar o qué perfil reforzar.',
    ejecutar: async (a) => ok(barreras(dbLicitaciones(), leerPerfilEmpresa(nucleo().db)?.perfil ?? null, a)),
  });
}

function herramientasPrecios(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_precios',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: PorLicitacionOSegmento,
    descripcion:
      'Bajas de adjudicación (1 - importe adjudicado / presupuesto del lote) de licitaciones parecidas del histórico de la PLACSP, por id de licitación o por cpv + importe + tipo. Devuelve el segmento usado (con retroceso de CPV de 8 a 2 cifras, tipo, procedimiento y banda de importe hasta tener muestra), n, percentiles p10–p90, media, dispersión, evolución por año, baja por número de ofertas y escenarios de oferta (con id, para el lote de interés o el «lote» indicado; importe, proporción de adjudicaciones ganadas con una baja igual o menor y aviso de posible oferta anormalmente baja según el art. 85 RGLCAP). Bajas como fracción: 0.15 = 15 %. Orientativo: manda el pliego.',
    recurso: (a) => a.id ?? (a.cpv ? `cpv-${a.cpv}` : null),
    ejecutar: async (a) => precios(a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_comparables',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: Comparables,
    descripcion: `Adjudicaciones parecidas a una licitación (por id) o a un segmento (cpv + importe + tipo). ${COMO_SE_ELIGEN} Con mismo_organo (y id), solo las de su órgano. Cada una con adjudicatario (nombre y NIF), presupuesto, importe, baja, número de ofertas, parecido del objeto (0–1) y enlace. Para las ediciones anteriores de la misma licitación, licitaciones_antecedentes.`,
    recurso: (a) => a.id ?? (a.cpv ? `cpv-${a.cpv}` : null),
    ejecutar: async (a) => similares(a),
  });
}
