// Cliente de /api/licitaciones (mismo origen, tras el login del monitor).
import { json, request, requestCondicional } from './apiCliente';
import { pedirConPlazo } from './peticiones';
import { cuerpoRevisionBorrador } from './memoriaFormato.js';
import { apuntarDecisiones } from './decisionesRecientes.js';

const BASE = '/api/licitaciones';
const deLicitacion = (id, resto = '') => `${BASE}/licitaciones/${encodeURIComponent(id)}${resto}`;
// Lo que se pide a Hermes a mano: cerca del plazo el servidor avisa y, confirmado, va con «?confirmar=1».
const conConfirmacion = (url) => (confirmado) => `${url}${confirmado ? '?confirmar=1' : ''}`;

// Sin todaEspana ni todosImportes, el servidor aplica la banda en la que licitamos y el territorio de la escala de los rankings.
function consultaRanking({
  meses = 24,
  orden,
  texto,
  limite = 50,
  desde = 0,
  todaEspana = false,
  todosImportes = false,
} = {}) {
  const q = new URLSearchParams({ meses: String(meses), limite: String(limite) });
  if (desde > 0) q.set('desde', String(desde));
  if (todaEspana) q.set('toda_espana', '1');
  if (todosImportes) q.set('todos_importes', '1');
  if (orden) q.set('orden', orden);
  // El servidor pide al menos dos letras: con una sola no se filtra.
  if (texto?.trim().length >= 2) q.set('texto', texto.trim());
  return q;
}

export const licitacionesApi = {
  // orden: plazo (por defecto), importe o llegada; la respuesta trae `cuentas` por estado.
  oportunidades: ({ estados, texto, orden, comunidad, pagina = 1, limite = 30 } = {}) => {
    const q = new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
    if (estados?.length) q.set('estados', estados.join(','));
    if (texto) q.set('texto', texto);
    if (orden) q.set('orden', orden);
    if (comunidad) q.set('comunidad', comunidad);
    return request(`${BASE}/oportunidades?${q}`);
  },
  licitacion: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}`),
  // Una licitación que no pasó el prefiltro pasa a seguirse a mano (como «nueva»).
  seguirLicitacion: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/seguir`, { method: 'POST' }),
  cambiar: (id, cambio) => request(`${BASE}/oportunidades/${encodeURIComponent(id)}`, json('PATCH', cambio)),
  // Quién lleva la oferta: el id de una persona activa o null.
  cambiarResponsable: (id, usuarioId) =>
    request(`${BASE}/oportunidades/${encodeURIComponent(id)}/responsable`, json('PUT', { usuario_id: usuarioId })),
  // Los lotes a los que vamos (pasan a ser los de interés: ámbito de requisitos, precios y guion).
  elegirLotes: (id, lotes) => request(`${BASE}/oportunidades/${encodeURIComponent(id)}/lotes`, json('PUT', { lotes })),
  generarFicha: (id) => request(`${BASE}/oportunidades/${encodeURIComponent(id)}/ficha`, { method: 'POST' }),
  // Pestaña «Errores»: vuelve a bajar los pliegos con error o vuelve a pedir la ficha fallida.
  reintentar: (id) => request(`${BASE}/oportunidades/${encodeURIComponent(id)}/reintentar`, { method: 'POST' }),
  // ficha y version: la persona decide sobre la versión que ha visto (409 si Hermes la reenvió).
  // bajas como fracción (0.15 = 15 %); ofertas, el número esperado (por defecto, la mediana del segmento).
  // lote: para qué lote (por defecto, el primero de interés de la criba).
  precios: (id, { bajas = [], ofertas = null, mismoOrgano = false, lote = null } = {}) => {
    const q = new URLSearchParams();
    if (lote) q.set('lote', lote);
    if (bajas.length) q.set('bajas', bajas.join(','));
    if (ofertas) q.set('ofertas', String(ofertas));
    if (mismoOrgano) q.set('mismo_organo', '1');
    return request(`${BASE}/licitaciones/${encodeURIComponent(id)}/precios?${q}`);
  },
  comparables: (id, { limite = 15, mismoOrgano = false, lote = null } = {}) => {
    const q = new URLSearchParams({ limite: String(limite) });
    if (lote) q.set('lote', lote);
    if (mismoOrgano) q.set('mismo_organo', '1');
    return request(`${BASE}/licitaciones/${encodeURIComponent(id)}/comparables?${q}`);
  },
  // Ediciones anteriores (contrato y lotes) e indicios de «licitación con nombre».
  indices: (id, { lote = null } = {}) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/indices${lote ? `?lote=${encodeURIComponent(lote)}` : ''}`),
  vencimientos: ({ meses = 12, organo = null, desde = 0 } = {}) =>
    request(
      `${BASE}/mercado/vencimientos?${new URLSearchParams({ meses: String(meses), desde: String(desde), ...(organo ? { organo } : {}) })}`,
    ),
  // Mercado › Panorama y «Avisarme cuando salga» de un contrato que vence (seguir = false lo quita).
  panorama: () => request(`${BASE}/mercado/panorama`),
  avisarRenovacion: (contrato, seguir = true) =>
    request(`${BASE}/mercado/vencimientos/avisar`, json(seguir ? 'POST' : 'DELETE', contrato)),
  antecedentes: (id, { lote = null } = {}) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/antecedentes${lote ? `?lote=${encodeURIComponent(lote)}` : ''}`,
    ),
  // Candidatos por requisito de medios personales de la ficha aprobada.
  equipo: (id, { limite = 5 } = {}) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/equipo?limite=${limite}`),
  // Matriz rol exigido × persona sobre las decisiones guardadas; cv busca además en los CV (cuesta consultas).
  matrizEquipo: (id, { cv = false } = {}) => request(deLicitacion(id, `/oferta/equipo/matriz${cv ? '?cv=1' : ''}`)),
  // Propuestas: lo presentado de una licitación, borradores, evaluaciones, parecidas y documentos evaluables.
  propuesta: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/propuesta`),
  registrarPropuesta: (id, body) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/propuestas`, json('POST', body)),
  cambiarPropuesta: (pid, cambio) => request(`${BASE}/propuestas/${pid}`, json('PATCH', cambio)),
  borrarPropuesta: (pid) => request(`${BASE}/propuestas/${pid}`, { method: 'DELETE' }),
  // Vuelve a «En preparación» una oferta presentada por error (solo si ningún lote tiene resultado).
  deshacerPresentacion: (id) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/propuestas/deshacer`, { method: 'POST' }),
  // Oferta: guion del pliego, decisiones de la oferta y memorias (todo en una respuesta).
  oferta: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta`),
  // Oportunidades: una pestaña afinada con los filtros (la consulta la arma consultaRevision).
  revision: (consulta) => request(`${BASE}/revision?${consulta}`),
  // El tablero: cinco columnas con sus tarjetas y el aviso de lo que está por revisar.
  pipeline: () => request(`${BASE}/pipeline`),
  // Las direcciones de descarga del CSV de cada listado: el servidor lo arma entero.
  csv: {
    pipeline: () => `${BASE}/pipeline.csv`,
    oportunidades: (consulta) => `${BASE}/revision.csv?${consulta}`,
    presentadas: ({ resultado, texto } = {}) => {
      const q = new URLSearchParams();
      if (resultado) q.set('resultado', resultado);
      if (texto?.trim().length >= 2) q.set('texto', texto.trim());
      return `${BASE}/propuestas.csv?${q}`;
    },
    competidores: (opciones = {}) => `${BASE}/competidores.csv?${consultaRanking(opciones)}`,
    organismos: (opciones = {}) => `${BASE}/organismos.csv?${consultaRanking(opciones)}`,
    comparables: (id) => `${BASE}/licitaciones/${encodeURIComponent(id)}/indices/comparables.csv`,
  },
  carpetaDrive: (id, carpeta) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/drive/${encodeURIComponent(carpeta)}`),
  extraerGuion: (id) =>
    pedirConPlazo((c) =>
      request(conConfirmacion(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/guion`)(c), { method: 'POST' }),
    ),
  decisiones: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/decisiones`),
  proponerDecisiones: (id) =>
    pedirConPlazo((c) =>
      request(conConfirmacion(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/decisiones/propuesta`)(c), {
        method: 'POST',
      }),
    ),
  guardarDecisiones: (id, decisiones) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/decisiones`, json('PUT', decisiones)),
  memoria: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria`),
  // Dossier, estrategia, la memoria entera en un run y un crítico ciego; el servidor ensambla el docx al acabar.
  // Con «lote», solo la memoria de ese lote (si el pliego pide una por lote); sin él, la de cada lote.
  redactarMemoria: (id, lote = null) =>
    pedirConPlazo((c) =>
      request(
        conConfirmacion(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria`)(c),
        lote ? json('POST', { lote }) : { method: 'POST' },
      ),
    ),
  // Memoria de ensayo de una oferta con el plazo vencido, para compararla con la presentada:
  // la persona ya lo confirmó en la vista, así que va con «?confirmar=1».
  memoriaEnsayo: (id) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria?confirmar=1`,
      json('POST', { ensayo: true }),
    ),
  fichaSolucion: (id, version) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}/ficha`,
    ),
  revisarFichaSolucion: (id, version, cuerpo) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}/ficha`,
      json('PUT', cuerpo),
    ),
  ensamblarMemoria: (id, version) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}/ensamblar`,
      { method: 'POST' },
    ),
  // La versión ensamblada se evalúa sola con la escala del guion; esto la repite.
  relanzarTrabajo: (id, tipo) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/trabajos/${encodeURIComponent(tipo)}/relanzar`, {
      method: 'POST',
    }),
  remontarMemoria: (id, version) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}/remontar`,
      { method: 'POST' },
    ),
  evaluarMemoria: (id, version) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}/evaluar`,
      { method: 'POST' },
    ),
  // Crea la versión siguiente rehaciendo solo esos apartados (sin ellos, los mejorables de la última evaluación).
  // Un Word de la memoria editado a mano: pasa a ser la versión siguiente.
  // lote: de qué lote es, si el pliego pide una memoria por lote.
  subirMemoria: (id, archivo, notas = '', lote = null) => {
    const form = new FormData();
    // La nota y el lote antes que el archivo: el servidor los lee al recibir el formulario.
    if (notas) form.append('notas', notas);
    if (lote) form.append('lote', lote);
    form.append('archivo', archivo, archivo.name);
    return request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/subir`, {
      method: 'POST',
      body: form,
    });
  },
  // La memoria que se entregó (PDF o Word), tal cual: pasa a ser la de la oferta, también con el plazo vencido.
  subirMemoriaPresentada: (id, archivo, notas = '', lote = null) => {
    const form = new FormData();
    if (notas) form.append('notas', notas);
    if (lote) form.append('lote', lote);
    form.append('archivo', archivo, archivo.name);
    return request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/presentada`, {
      method: 'POST',
      body: form,
    });
  },
  revisarLeccion: (id, leccion, decision) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/lecciones/${encodeURIComponent(String(leccion))}`,
      json('PATCH', { decision }),
    ),
  mejorarMemoria: (id, version, apartados, indicaciones = null) =>
    pedirConPlazo((c) =>
      request(
        conConfirmacion(
          `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/memoria/${encodeURIComponent(String(version))}/mejorar`,
        )(c),
        json('POST', { ...(apartados ? { apartados } : {}), ...(indicaciones ? { indicaciones } : {}) }),
      ),
    ),
  // Rehace solo los apartados que dependen de lo que cambió (sin «apartados», los que calcula el servidor por las huellas).
  actualizarMemoria: (id, version, apartados = null) =>
    pedirConPlazo((c) =>
      request(
        conConfirmacion(
          deLicitacion(id, `/oferta/memoria/${encodeURIComponent(String(version))}/actualizar-afectados`),
        )(c),
        json('POST', apartados?.length ? { apartados } : {}),
      ),
    ),
  // Comprobaciones de la oferta: qué impide presentar y qué falta. Con el ETag de la última, 304 → { noCambio: true }.
  comprobaciones: (id, etag = null) => requestCondicional(deLicitacion(id, '/comprobaciones'), etag),
  // Lo que hace Hermes en esta oferta ahora: en marcha, en cola, último fallo y frenos.
  hermesEnVivo: (id) => request(deLicitacion(id, '/oferta/hermes')),
  // Mesa (Hoy): lo de hoy de todas las ofertas activas.
  mesa: () => request(`${BASE}/mesa`),
  // accion: vamos | aceptar_riesgo | descartar | aplicar_propuesta; las tres primeras, con motivo.
  accionBloqueo: (id, clave, { accion, motivo, categoria_descarte: categoria } = {}) =>
    request(
      deLicitacion(id, `/comprobaciones/bloqueos/${encodeURIComponent(clave)}`),
      json('POST', { accion, ...(motivo ? { motivo } : {}), ...(categoria ? { categoria_descarte: categoria } : {}) }),
    ),
  // Una sección de las decisiones (precio, equipo, automaticos, herramientas, enfoque, lotes, datos_anexo) sobre la
  // versión leída (409 si otra persona guardó antes); la respuesta trae `problemas_otras`. Guardar no rehace nada: lo
  // afectado lo pide «Qué cambia» después (los apartados de la memoria). La versión devuelta queda apuntada
  // (decisionesRecientes) para que la siguiente sección no vaya con la vieja.
  guardarSeccionDecisiones: (id, seccion, { datos, version }) =>
    request(
      deLicitacion(id, `/oferta/decisiones/${encodeURIComponent(seccion)}`),
      json('PATCH', { version, valor: datos }),
    ).then((r) => {
      apuntarDecisiones(id, r);
      return r;
    }),
  // Asistente de la oferta: las preguntas con su estado, responder (opción, texto libre o la
  // interpretación de Hermes que se confirma), el hilo y «OK, generar» con el plan por sobres.
  preguntasOferta: (id) => request(deLicitacion(id, '/oferta/preguntas')),
  responderOferta: (id, respuesta) => request(deLicitacion(id, '/oferta/respuestas'), json('POST', respuesta)),
  hiloOferta: (id) => request(deLicitacion(id, '/oferta/hilo')),
  // Preguntar al pliego: la caja de la ficha y pasar una respuesta a las comprobaciones.
  preguntasPliego: (id) => request(deLicitacion(id, '/preguntas')),
  preguntarPliego: (id, pregunta) => request(deLicitacion(id, '/preguntas'), json('POST', { pregunta })),
  preguntaAComprobaciones: (id, n, enComprobaciones) =>
    request(
      deLicitacion(id, `/preguntas/${encodeURIComponent(n)}/comprobaciones`),
      json('PUT', { en_comprobaciones: enComprobaciones }),
    ),
  planGenerar: (id) => request(deLicitacion(id, '/oferta/generar')),
  generarDocumentos: (id) => request(deLicitacion(id, '/oferta/generar'), json('POST', {})),
  // Revisión: el veredicto de las comprobaciones y sus comprobaciones por sobre y documento.
  revisionSobres: (id) => request(deLicitacion(id, '/oferta/sobres')),
  // Qué cambia (panel previo a guardar): solo calcula, no escribe.
  impacto: (id, cambio) => request(deLicitacion(id, '/oferta/impacto'), json('POST', cambio)),
  historialDecisiones: (id) => request(deLicitacion(id, '/oferta/decisiones/historial')),
  // Vuelve a la versión anterior a `version` (la que se está viendo).
  deshacerDecisiones: (id, version) =>
    request(deLicitacion(id, '/oferta/decisiones/deshacer'), json('POST', { version })),
  restaurarMemoria: (id, version) =>
    request(deLicitacion(id, `/oferta/memoria/${encodeURIComponent(String(version))}/restaurar`), { method: 'POST' }),
  // «Ver texto»: { titulo, texto, ronda, rechazos, estado } del apartado n de la versión.
  apartadoTexto: (id, version, n) =>
    request(
      deLicitacion(
        id,
        `/oferta/memoria/${encodeURIComponent(String(version))}/apartados/${encodeURIComponent(String(n))}`,
      ),
    ),
  // Títulos de varias licitaciones de una vez (la cola y la Mesa los enseñan por nombre).
  titulos: (ids) => request(`${BASE}/titulos?ids=${encodeURIComponent(ids.join(','))}`),
  // Checklist de lo que hay que presentar (del guion vigente) y relleno de los anexos por Hermes.
  documentosOferta: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/documentos`),
  cambiarDocumentoOferta: (id, clave, cambios) =>
    request(
      `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/documentos/${encodeURIComponent(clave)}`,
      json('PATCH', cambios),
    ),
  rellenarAnexo: (id, clave) =>
    pedirConPlazo((c) =>
      request(
        conConfirmacion(
          `${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/documentos/${encodeURIComponent(clave)}/anexo`,
        )(c),
        { method: 'POST' },
      ),
    ),
  // El DEUC (XML para importar en el servicio DEUC) lo prepara el código, sin runs: 409 si faltan datos de la empresa.
  prepararDeuc: (id, clave) =>
    request(deLicitacion(id, `/oferta/documentos/${encodeURIComponent(clave)}/deuc`), { method: 'POST' }),
  hojaDatos: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/hoja-datos`),
  // Paquete de presentación: el vigente con las comprobaciones de ahora, y generar una versión nueva.
  paqueteOferta: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/paquete`),
  generarPaquete: (id) => request(`${BASE}/licitaciones/${encodeURIComponent(id)}/oferta/paquete`, { method: 'POST' }),
  evaluar: (id, documento) =>
    request(`${BASE}/licitaciones/${encodeURIComponent(id)}/evaluaciones`, json('POST', { documento })),
  // Lo que escribe la IA entra pendiente: una persona lo acepta o lo descarta (también la memoria ensamblada, por su borrador).
  // anularFugas: por qué lo detectado no es una fuga entre sobres (sin él no se da por buena);
  // motivo: por qué se acepta una memoria con párrafos marcados, avisos o apartados sin redactar (sin él, 400).
  revisarBorrador: (bid, decision, { anularFugas, motivo } = {}) =>
    request(`${BASE}/borradores/${bid}`, json('PATCH', cuerpoRevisionBorrador(decision, { anularFugas, motivo }))),
  revisarEvaluacion: (eid, decision) => request(`${BASE}/evaluaciones/${eid}`, json('PATCH', { decision })),
  // Histórico de propuestas con sus estadísticas.
  propuestas: ({ resultado, texto, limite = 100 } = {}) => {
    const q = new URLSearchParams({ limite: String(limite) });
    if (resultado) q.set('resultado', resultado);
    if (texto?.trim().length >= 2) q.set('texto', texto.trim());
    return request(`${BASE}/propuestas?${q}`);
  },
  // Lo aprendido de las actas de mesa de lo presentado: Hermes las lee y una persona acepta o descarta.
  aprendizajes: () => request(`${BASE}/aprendizajes`),
  leerActas: () => request(`${BASE}/aprendizajes/leer`, { method: 'POST' }),
  revisarAprendizaje: (n, decision) => request(`${BASE}/aprendizajes/${n}`, json('PATCH', { decision })),
  // Aprendizaje: la pantalla entera y lo que se hace con cada lección del libro.
  aprendizaje: () => request(`${BASE}/aprendizaje`),
  revisarDelLibro: (n, decision) =>
    request(`${BASE}/lecciones/${encodeURIComponent(String(n))}`, json('PATCH', { decision })),
  ajustarAlcance: (n, ajuste) =>
    request(`${BASE}/lecciones/${encodeURIComponent(String(n))}/alcance`, json('PATCH', ajuste)),
  retirarLeccion: (n, motivo) =>
    request(`${BASE}/lecciones/${encodeURIComponent(String(n))}/retirar`, json('POST', { motivo })),
  responderPorque: (id, comparacion, n, respuesta) =>
    request(
      deLicitacion(id, `/oferta/comparaciones/${encodeURIComponent(String(comparacion))}/porque`),
      json('POST', { n, respuesta }),
    ),
  // Competencia: meses 0 = todo el histórico; sin cpv, el sector de los filtros y del perfil.
  competidores: (opciones = {}) => request(`${BASE}/competidores?${consultaRanking(opciones)}`),
  competidor: (nif, { soloSector = false } = {}) =>
    request(`${BASE}/competidores/${encodeURIComponent(nif)}${soloSector ? '?solo_sector=1' : ''}`),
  resumenCompetidor: (nif) => request(`${BASE}/competidores/${encodeURIComponent(nif)}/resumen`, { method: 'POST' }),
  organismos: (opciones = {}) => request(`${BASE}/organismos?${consultaRanking(opciones)}`),
  // Qué nos falta: certificaciones, seguro, clasificación y habilitaciones que piden.
  barreras: ({ meses = 12 } = {}) => request(`${BASE}/barreras?meses=${encodeURIComponent(String(meses))}`),
  organismo: (nif, { soloSector = false } = {}) =>
    request(`${BASE}/organismos/${encodeURIComponent(nif)}${soloSector ? '?solo_sector=1' : ''}`),
  // tipo: «competidor» u «organismo».
  seguidos: (tipo) => request(`${BASE}/seguidos?tipo=${encodeURIComponent(tipo)}`),
  seguir: (tipo, nif, notas = '') =>
    request(`${BASE}/seguidos/${encodeURIComponent(tipo)}/${encodeURIComponent(nif)}`, json('PUT', { notas })),
  dejarDeSeguir: (tipo, nif) =>
    request(`${BASE}/seguidos/${encodeURIComponent(tipo)}/${encodeURIComponent(nif)}`, { method: 'DELETE' }),
  cargarHistorico: (pedido) => request(`${BASE}/historico`, json('POST', pedido)),
  filtros: () => request(`${BASE}/filtros`),
  // La escala con que se abren los rankings de competencia (Ajustes › Fuentes y filtros).
  escalaCompetencia: () => request(`${BASE}/competencia/escala`),
  guardarEscalaCompetencia: (escala) => request(`${BASE}/competencia/escala`, json('PUT', escala)),
  // Búsquedas guardadas de quien entra (con cuántas nuevas trae cada una en `dias`).
  busquedas: (dias = 7) => request(`${BASE}/busquedas?dias=${dias}`),
  guardarBusqueda: (b) => request(`${BASE}/busquedas`, json('POST', b)),
  cambiarBusqueda: (id, cambio) => request(`${BASE}/busquedas/${encodeURIComponent(id)}`, json('PATCH', cambio)),
  borrarBusqueda: (id) => request(`${BASE}/busquedas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // La descripción oficial de unos prefijos CPV, para las etiquetas de los filtros.
  cpv: (prefijos) => request(`${BASE}/cpv?prefijos=${encodeURIComponent(prefijos.join(','))}`),
  // El buscador de los filtros: por cifras («72» → 72…) o por palabras de la descripción.
  buscarCpv: (q) => request(`${BASE}/cpv/buscar?q=${encodeURIComponent(q)}`),
  // Auditoría de cobertura por comunidad y la cifra de la plataforma autonómica apuntada a mano.
  cobertura: () => request(`${BASE}/cobertura`),
  // Calidad del dato: incidencias, pliegos ilegibles, acierto de los índices y actas ajenas.
  calidad: () => request(`${BASE}/calidad`),
  anotarCobertura: (anotacion) => request(`${BASE}/cobertura/autonomica`, json('PUT', anotacion)),
  // Ensayo en seco de la carpeta única por licitación: solo lee.
  ensayoCarpetaUnica: () => request(`${BASE}/carpeta-unica/ensayo`),
  // La migración la lanza una persona tras revisar el ensayo; corre en segundo plano.
  migracionCarpetaUnica: () => request(`${BASE}/carpeta-unica/migracion`),
  migrarCarpetaUnica: () => request(`${BASE}/carpeta-unica/migracion`, { method: 'POST' }),
  guardarFiltros: (filtros) => request(`${BASE}/filtros`, json('PUT', filtros)),
  estado: () => request(`${BASE}/estado`),
  sincronizar: () => request(`${BASE}/sync`, { method: 'POST' }),
  cribar: () => request(`${BASE}/cribar`, { method: 'POST' }),
  // Pausar o reanudar la regeneración de las fichas de una versión anterior del análisis.
  regeneracionFichas: (accion) => request(`${BASE}/fichas/regeneracion`, json('POST', { accion })),
  // Repite la comprobación de la reorganización de Conocimiento/Licitaciones (Radar / Presentadas) en Drive.
  reorganizarCarpetas: () => request(`${BASE}/carpetas/reorganizar`, { method: 'POST' }),
};
