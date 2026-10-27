// licitaciones.db: lo de la PLACSP, el flujo de oportunidades y la oferta con su memoria y su aprendizaje.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nucleoFile } from '../../nucleo/db.js';
import { claseNif, estadoNif, normalizarNif } from '../../nucleo/identidad.js';
import { decodificarEntidades } from '../../nucleo/entidades.js';
import { VERSION_MAPPER, type LicitacionData } from './placsp/mapper.js';
import { cpvsTexto, guardarClasificacion, rellenarClasificacion, SQL_CLASIFICACION } from './clasificacion.js';
import { indexarTexto, rellenarBuscador, SQL_BUSCADOR } from './buscador.js';
import { SQL_BUSQUEDAS } from './busquedasTabla.js';
import { SQL_ACTAS_MERCADO } from './actasMercadoTabla.js';
import { SQL_PREGUNTAS_PLIEGO } from './preguntasPliegoTabla.js';
import { finContrato, guardarContratos, rellenarContratos, SQL_CONTRATOS } from './contratos.js';
import { SQL_INDICES, SQL_RENOVACIONES } from './indices/tabla.js';
import { detectarIncidencias, rellenarIncidencias, SQL_CALIDAD } from './calidad.js';
import { rellenarParticipaciones, sembrarParticipaciones, SQL_PARTICIPACIONES } from './participaciones.js';
import { RESULTADOS_ADJUDICADOS } from './placsp/codigos.js';
import { normalizarOrgano, palabrasTexto } from './antecedentes/texto.js';
import type { GuionBaseData } from './oferta/guion.js';
import { lotesDeMemoria } from './oferta/memoriaLote.js';
import { descartarSinAviso, descarteNoGo } from './gonogo.js';
import { fichasDe } from './ficha.js';
import { SQL_TABLA_LECCIONES } from './oferta/libroLecciones.js';
import { temaDeApartado } from './oferta/temasApartado.js';

// licitaciones.db: licitaciones (hechos de la PLACSP), adjudicaciones, pliegos (y la última
// revisión de la página de su expediente: expedientes_placsp),
// oportunidades (el flujo de la empresa), fichas propuestas por la IA, filtros del
// prefiltro, lotes de criba, estado de la sincronización y carpetas de lo presentado
// en Conocimiento (carpetas_presentadas), y la oferta (guiones, decisiones_oferta, memorias
// y memoria_apartados, oferta_documentos y, de las fases de la memoria, memoria_dossiers,
// memoria_estrategias, memoria_fichas_solucion, memoria_criticas, memoria_apartado_rondas y
// memoria_parches_hechos: oferta/; lecciones, lecciones_aplicaciones, comparaciones_memoria y parrafos_biblioteca: aprendizaje entre ofertas; las comprobaciones: oferta_bloqueos, descartes_historial,
// revisiones_usuario, decisiones_historial y lotes_interes_historial; los documentos de la
// carpeta de la licitación que no son pliegos (aclaraciones, normativa del cliente y contrato:
// documentos_licitacion, documentosCarpeta.ts); el banco de pruebas de
// memorias: eval_casos, eval_documentos y eval_juicios). nucleo.db se adjunta
// para las organizaciones y el perfil de la empresa.

const INDICES_LECCIONES = `CREATE INDEX IF NOT EXISTS lecciones_memoria ON lecciones(memoria_id, estado);
CREATE INDEX IF NOT EXISTS lecciones_estado ON lecciones(estado, creada_en);`;

// nucleo.db se adjunta para las organizaciones y el perfil de la empresa.
export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS licitaciones (
  id TEXT PRIMARY KEY, atom_id TEXT NOT NULL UNIQUE, fuente TEXT NOT NULL, expediente TEXT NOT NULL,
  titulo TEXT NOT NULL, url TEXT, estado TEXT NOT NULL, actualizada_en TEXT NOT NULL,
  organo_nombre TEXT NOT NULL, organo_nif TEXT, tipo_contrato TEXT, procedimiento TEXT,
  presupuesto_sin_iva REAL, valor_estimado REAL, cpvs TEXT NOT NULL, nuts TEXT, lugar TEXT,
  fecha_limite TEXT, datos TEXT NOT NULL, borrada_en TEXT, borrada_motivo TEXT, vista_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS licitaciones_estado ON licitaciones(estado, fecha_limite);
CREATE INDEX IF NOT EXISTS licitaciones_organo ON licitaciones(organo_nif);
CREATE INDEX IF NOT EXISTS licitaciones_sector ON licitaciones(actualizada_en, organo_nif, presupuesto_sin_iva, cpvs);
CREATE TABLE IF NOT EXISTS adjudicaciones (
  licitacion_id TEXT NOT NULL, lote TEXT NOT NULL, resultado TEXT, fecha TEXT, ofertas REAL,
  oferta_min REAL, oferta_max REAL, adjudicatario_nif TEXT, adjudicatario_nombre TEXT,
  importe_sin_iva REAL, presupuesto_sin_iva REAL, baja REAL, pyme INTEGER, ord INTEGER NOT NULL,
  PRIMARY KEY (licitacion_id, ord));
CREATE INDEX IF NOT EXISTS adjudicaciones_nif ON adjudicaciones(adjudicatario_nif);
CREATE TABLE IF NOT EXISTS oportunidades (
  licitacion_id TEXT PRIMARY KEY, estado TEXT NOT NULL, motivo_prefiltro TEXT, lote_criba INTEGER,
  veredicto_ia TEXT, motivo_ia TEXT, confianza_ia REAL, rescatada INTEGER NOT NULL DEFAULT 0,
  notas TEXT, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS oportunidades_estado ON oportunidades(estado);
CREATE TABLE IF NOT EXISTS lotes_criba (
  id INTEGER PRIMARY KEY, ids TEXT NOT NULL, estado TEXT NOT NULL, creado_en TEXT NOT NULL, cribado_en TEXT);
CREATE TABLE IF NOT EXISTS pliegos (
  licitacion_id TEXT NOT NULL, url TEXT NOT NULL, clase TEXT NOT NULL, nombre TEXT NOT NULL,
  estado TEXT NOT NULL, ruta TEXT, sha256 TEXT, error TEXT, intentos INTEGER NOT NULL DEFAULT 0, actualizado_en TEXT NOT NULL,
  PRIMARY KEY (licitacion_id, url));
CREATE TABLE IF NOT EXISTS documentos_licitacion (
  licitacion_id TEXT NOT NULL, ruta TEXT NOT NULL, clase TEXT NOT NULL, nombre TEXT NOT NULL, fecha TEXT, codigo TEXT, version TEXT,
  origen TEXT NOT NULL, detectado_en TEXT NOT NULL, PRIMARY KEY (licitacion_id, ruta));
CREATE TABLE IF NOT EXISTS expedientes_placsp (
  licitacion_id TEXT PRIMARY KEY, revisado_en TEXT NOT NULL, comprobado_en TEXT, documentos INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS filtros (id INTEGER PRIMARY KEY CHECK (id = 1), datos TEXT NOT NULL, actualizado_en TEXT NOT NULL);
-- La escala de los rankings de competencia (competencia/escala.ts): territorio y banda por defecto.
CREATE TABLE IF NOT EXISTS escala_competencia (id INTEGER PRIMARY KEY CHECK (id = 1), datos TEXT NOT NULL, actualizado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fichas (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, estado TEXT NOT NULL, datos TEXT NOT NULL, agente TEXT NOT NULL,
  creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL, revisada_en TEXT);
CREATE INDEX IF NOT EXISTS fichas_licitacion ON fichas(licitacion_id, estado);
CREATE TABLE IF NOT EXISTS sync_estado (
  fuente TEXT PRIMARY KEY, hasta TEXT, ultima_vuelta TEXT, last_modified TEXT, ultimo_error TEXT, entradas INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS historico_estado (
  fuente TEXT NOT NULL, anio INTEGER NOT NULL, estado TEXT NOT NULL, piezas_total INTEGER NOT NULL,
  piezas_hechas INTEGER NOT NULL DEFAULT 0, atoms_hechos INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  entradas INTEGER NOT NULL DEFAULT 0, guardadas INTEGER NOT NULL DEFAULT 0, fuera_de_sector INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0, error TEXT, pedido_en TEXT NOT NULL, actualizado_en TEXT NOT NULL, terminado_en TEXT,
  PRIMARY KEY (fuente, anio));
-- Auditoría de cobertura por comunidad (cobertura.ts): lo contado de la PLACSP y lo apuntado de cada plataforma autonómica.
CREATE TABLE IF NOT EXISTS cobertura_semanal (
  semana TEXT NOT NULL, comunidad TEXT NOT NULL, agregadas INTEGER NOT NULL, perfiles INTEGER NOT NULL,
  calculada_en TEXT NOT NULL, PRIMARY KEY (semana, comunidad));
CREATE TABLE IF NOT EXISTS carpetas_unicas (
  licitacion_id TEXT PRIMARY KEY, ruta TEXT NOT NULL, creada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cobertura_autonomica (
  semana TEXT NOT NULL, comunidad TEXT NOT NULL, publicadas INTEGER NOT NULL, fuente TEXT NOT NULL,
  anotada_en TEXT NOT NULL, PRIMARY KEY (semana, comunidad));
CREATE TABLE IF NOT EXISTS seguidos (
  tipo TEXT NOT NULL CHECK (tipo IN ('competidor', 'organismo')), nif TEXT NOT NULL, notas TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL, PRIMARY KEY (tipo, nif));
CREATE TABLE IF NOT EXISTS propuestas (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, lote TEXT NOT NULL DEFAULT '', presentada_en TEXT NOT NULL,
  importe_ofertado REAL, presupuesto REAL, baja_ofertada REAL, documentos TEXT NOT NULL DEFAULT '[]',
  resultado TEXT NOT NULL DEFAULT 'pendiente', resultado_origen TEXT,
  puntos_tecnica REAL, puntos_economica REAL, puntos_total REAL, posicion INTEGER, puntos_ganador REAL,
  ganador_nif TEXT, ganador_nombre TEXT, importe_ganador REAL, baja_ganadora REAL,
  notas TEXT NOT NULL DEFAULT '', lecciones TEXT NOT NULL DEFAULT '',
  creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL, resuelta_en TEXT, UNIQUE (licitacion_id, lote));
CREATE INDEX IF NOT EXISTS propuestas_resultado ON propuestas(resultado, presentada_en);
CREATE TABLE IF NOT EXISTS borradores (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, ruta TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
  resumen TEXT, agente TEXT NOT NULL, registrado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS borradores_licitacion ON borradores(licitacion_id, registrado_en);
CREATE TABLE IF NOT EXISTS evaluaciones (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, documento TEXT NOT NULL, datos TEXT NOT NULL,
  agente TEXT NOT NULL, creada_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS evaluaciones_licitacion ON evaluaciones(licitacion_id, creada_en);
CREATE TABLE IF NOT EXISTS carpetas_presentadas (
  licitacion_id TEXT PRIMARY KEY, nombre TEXT NOT NULL, ruta TEXT, drive_id TEXT, estado TEXT NOT NULL,
  error TEXT, intentos INTEGER NOT NULL DEFAULT 0, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guiones (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, version INTEGER NOT NULL, ficha_id INTEGER,
  datos TEXT NOT NULL, avisos TEXT NOT NULL DEFAULT '[]', agente TEXT NOT NULL, version_prompt INTEGER NOT NULL, trabajo_id INTEGER,
  creado_en TEXT NOT NULL, UNIQUE (licitacion_id, version));
CREATE TABLE IF NOT EXISTS decisiones_oferta (
  licitacion_id TEXT PRIMARY KEY, guion_id INTEGER NOT NULL, datos TEXT NOT NULL, actualizada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS propuestas_decisiones (
  licitacion_id TEXT PRIMARY KEY, guion_id INTEGER NOT NULL, datos TEXT NOT NULL, avisos TEXT NOT NULL DEFAULT '[]',
  agente TEXT NOT NULL, trabajo_id INTEGER, creada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memorias (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, guion_id INTEGER NOT NULL, version INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('redactando', 'ensamblando', 'ensamblada', 'fallida')), pedida_en TEXT NOT NULL, ensamblada_en TEXT,
  borrador_id INTEGER, avisos TEXT NOT NULL DEFAULT '[]', error TEXT, UNIQUE (licitacion_id, version));
CREATE TABLE IF NOT EXISTS memoria_apartados (
  memoria_id INTEGER NOT NULL, apartado INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'recibido', 'fallido')), datos TEXT, caracteres INTEGER, paginas_estimadas REAL,
  avisos TEXT NOT NULL DEFAULT '[]', rechazos INTEGER NOT NULL DEFAULT 0, trabajo_id INTEGER, agente TEXT, recibido_en TEXT, error TEXT,
  PRIMARY KEY (memoria_id, apartado));
CREATE TABLE IF NOT EXISTS memoria_dossiers (
  memoria_id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, secciones TEXT NOT NULL, caracteres INTEGER NOT NULL,
  ruta_md TEXT, creado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memoria_estrategias (
  memoria_id INTEGER PRIMARY KEY, datos TEXT NOT NULL, avisos TEXT NOT NULL DEFAULT '[]', agente TEXT NOT NULL,
  trabajo_id INTEGER, ruta_md TEXT, creada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memoria_fichas_solucion (
  memoria_id INTEGER PRIMARY KEY, estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'aprobada', 'vencida')), campos TEXT NOT NULL,
  creada_en TEXT NOT NULL, vence_en TEXT NOT NULL, revisada_en TEXT, revisada_por TEXT, editados TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS memoria_criticas (
  id INTEGER PRIMARY KEY, memoria_id INTEGER NOT NULL, ronda INTEGER NOT NULL, datos TEXT NOT NULL, total REAL, maximo REAL,
  independiente INTEGER NOT NULL, ciega INTEGER NOT NULL, avisos TEXT NOT NULL DEFAULT '[]', agente TEXT NOT NULL, trabajo_id INTEGER,
  creada_en TEXT NOT NULL, UNIQUE (memoria_id, ronda));
CREATE TABLE IF NOT EXISTS memoria_apartado_rondas (
  memoria_id INTEGER NOT NULL, apartado INTEGER NOT NULL, ronda INTEGER NOT NULL, datos TEXT NOT NULL,
  puntos REAL, tramo REAL, motivos TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (memoria_id, apartado, ronda));
CREATE TABLE IF NOT EXISTS memoria_parches_hechos (
  memoria_id INTEGER NOT NULL, ronda INTEGER NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'recibido', 'saltado')),
  pedidos TEXT NOT NULL, apartados TEXT NOT NULL DEFAULT '[]', cambios TEXT NOT NULL DEFAULT '[]', agente TEXT, creado_en TEXT NOT NULL, recibido_en TEXT,
  PRIMARY KEY (memoria_id, ronda));
CREATE TABLE IF NOT EXISTS eval_casos (
  id INTEGER PRIMARY KEY, clave TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, rubrica TEXT NOT NULL, pliego TEXT NOT NULL,
  esperado TEXT, creado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eval_documentos (
  id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL, etiqueta TEXT NOT NULL, origen TEXT NOT NULL, texto TEXT NOT NULL,
  sha256 TEXT NOT NULL, creado_en TEXT NOT NULL, UNIQUE (caso_id, etiqueta));
CREATE TABLE IF NOT EXISTS eval_juicios (
  id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL, doc_1 INTEGER NOT NULL, doc_2 INTEGER NOT NULL, lote TEXT NOT NULL,
  datos TEXT NOT NULL, total_1 REAL NOT NULL, total_2 REAL NOT NULL, preferido INTEGER NOT NULL, agente TEXT NOT NULL,
  trabajo_id INTEGER, creado_en TEXT NOT NULL, UNIQUE (caso_id, doc_1, doc_2, lote));
CREATE TABLE IF NOT EXISTS oferta_documentos (
  licitacion_id TEXT NOT NULL, clave TEXT NOT NULL, nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'borrador', 'preparado', 'no_aplica')),
  ruta TEXT, ruta_pdf TEXT, nota TEXT, avisos TEXT NOT NULL DEFAULT '[]', oculto INTEGER NOT NULL DEFAULT 0,
  anexo_en TEXT, anexo_modelo TEXT, actualizado_en TEXT NOT NULL, PRIMARY KEY (licitacion_id, clave));
CREATE TABLE IF NOT EXISTS paquetes_presentacion (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, version INTEGER NOT NULL, ruta TEXT NOT NULL,
  guion_id INTEGER NOT NULL, decisiones_en TEXT, manifiesto TEXT NOT NULL,
  bloqueos INTEGER NOT NULL, avisos INTEGER NOT NULL, creado_en TEXT NOT NULL,
  copia_estado TEXT CHECK (copia_estado IN ('pendiente', 'hecha', 'error')), copia_ruta TEXT, copia_error TEXT,
  UNIQUE (licitacion_id, version));
${SQL_TABLA_LECCIONES('lecciones')};
${INDICES_LECCIONES}
-- La memoria final de Hermes frente a la presentada (oferta/comparacionMemoria.ts): cambios, resumen y preguntas en JSON.
CREATE TABLE IF NOT EXISTS comparaciones_memoria (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, lote TEXT, memoria_hermes_id INTEGER NOT NULL, version_hermes INTEGER NOT NULL,
  memoria_presentada_id INTEGER NOT NULL UNIQUE, version_presentada INTEGER NOT NULL, por_apartado INTEGER NOT NULL,
  cambios TEXT NOT NULL, resumen TEXT NOT NULL, preguntas TEXT NOT NULL DEFAULT '[]', creada_en TEXT NOT NULL, clasificada_en TEXT);
CREATE INDEX IF NOT EXISTS comparaciones_licitacion ON comparaciones_memoria(licitacion_id, creada_en);
-- Qué lecciones se pasaron a cada apartado de cada memoria y si el crítico las ve cumplidas (oferta/leccionesAplicadas.ts).
CREATE TABLE IF NOT EXISTS lecciones_aplicaciones (
  id INTEGER PRIMARY KEY, leccion_id INTEGER NOT NULL, memoria_id INTEGER NOT NULL, version INTEGER NOT NULL, apartado INTEGER NOT NULL,
  cumplida INTEGER, nota TEXT, aplicada_en TEXT NOT NULL, comprobada_en TEXT, UNIQUE (leccion_id, memoria_id, apartado));
CREATE INDEX IF NOT EXISTS lecciones_aplicaciones_memoria ON lecciones_aplicaciones(memoria_id);
-- Párrafos que se repiten en memorias que funcionaron, ya propuestos a la Biblioteca (oferta/parrafosRepetidos.ts).
CREATE TABLE IF NOT EXISTS parrafos_biblioteca (
  huella TEXT PRIMARY KEY, titulo TEXT NOT NULL, palabras TEXT NOT NULL, propuesta TEXT, licitaciones TEXT NOT NULL, creada_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aprendizajes (
  id INTEGER PRIMARY KEY, carpeta TEXT NOT NULL, licitacion_id TEXT, expediente TEXT, organo TEXT, documento TEXT NOT NULL,
  datos TEXT NOT NULL, avisos TEXT NOT NULL DEFAULT '[]', estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'descartada')),
  agente TEXT NOT NULL, creado_en TEXT NOT NULL, revisado_en TEXT, UNIQUE (carpeta));
-- Comprobaciones (experiencia de licitaciones). Solo se añade: la última fila por clave manda y el resto queda de auditoría.
CREATE TABLE IF NOT EXISTS oferta_bloqueos (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, clave TEXT NOT NULL, huella TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('propuesta', 'vamos', 'riesgo_aceptado', 'resuelto', 'abierto')),
  propuesta_json TEXT, evidencia_json TEXT, quien TEXT NOT NULL, motivo TEXT, en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS oferta_bloqueos_clave ON oferta_bloqueos(licitacion_id, clave, id);
CREATE TABLE IF NOT EXISTS descartes_historial (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, accion TEXT NOT NULL CHECK (accion IN ('descartada', 'recuperada')),
  categoria TEXT, motivo TEXT, automatico INTEGER NOT NULL DEFAULT 0, quien TEXT, en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS descartes_historial_licitacion ON descartes_historial(licitacion_id, id);
CREATE TABLE IF NOT EXISTS revisiones_usuario (
  licitacion_id TEXT NOT NULL, usuario TEXT NOT NULL, revisado_en TEXT NOT NULL, PRIMARY KEY (licitacion_id, usuario));
CREATE TABLE IF NOT EXISTS decisiones_historial (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, version INTEGER NOT NULL, guion_id INTEGER NOT NULL, datos TEXT NOT NULL,
  secciones TEXT NOT NULL DEFAULT '[]', autor TEXT, motivo TEXT, creada_en TEXT NOT NULL, UNIQUE (licitacion_id, version));
CREATE TABLE IF NOT EXISTS lotes_interes_historial (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, lotes TEXT NOT NULL, autor TEXT, creada_en TEXT NOT NULL);
-- Telemetría del tiempo de persona (oferta/telemetria.ts): tiempo con foco por tarea de las
-- comprobaciones hasta cerrarse. Sin textos: solo la clave de la fila, su tipo de acción y la clave de persona.
CREATE TABLE IF NOT EXISTS telemetria_tareas (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, clave TEXT NOT NULL, tipo TEXT NOT NULL, persona TEXT,
  ms_foco INTEGER NOT NULL, cerrada INTEGER NOT NULL DEFAULT 0, creada_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS telemetria_tareas_tipo ON telemetria_tareas(tipo, cerrada);
-- El análisis de cada modelo dentro de un PDF (oferta/modelosPdf.ts), por archivo y modelo
-- («anexo xiv»): un PDF que cambia tiene otro sha256 y se vuelve a analizar.
CREATE TABLE IF NOT EXISTS modelos_pdf (
  ruta TEXT NOT NULL, sha256 TEXT NOT NULL, modelo TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('campos','transcrito','a_mano')),
  motivo TEXT, desde_pagina INTEGER, hasta_pagina INTEGER, docx TEXT, analizado_en TEXT NOT NULL, PRIMARY KEY (ruta, sha256, modelo));
-- Cada DEUC-vN.xml preparado por código (oferta/deuc.ts): huella de lo que lleva (petición, empresa,
-- representante, lotes y volumen, por partes para decir qué cambió) y las preguntas que quedan (JSON).
CREATE TABLE IF NOT EXISTS deuc_respuestas (
  licitacion_id TEXT NOT NULL, version INTEGER NOT NULL, ruta TEXT NOT NULL, huella TEXT NOT NULL, peticion_sha256 TEXT NOT NULL,
  sin_responder TEXT NOT NULL DEFAULT '[]', creada_en TEXT NOT NULL, PRIMARY KEY (licitacion_id, version));
-- Revisión de Hermes: una tarjeta por cosa que una persona debe aceptar o descartar. La clave
-- identifica la cosa (apartado, anexo...) y la huella, su contenido: si cambia, la tarjeta se reabre.
CREATE TABLE IF NOT EXISTS revision_tarjetas (
  licitacion_id TEXT NOT NULL, clave TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('propuesta','memoria','anexo','deuc','revision_previa')),
  huella TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptada','descartada')),
  quien TEXT, motivo TEXT, creada_en TEXT NOT NULL, cerrada_en TEXT, PRIMARY KEY (licitacion_id, clave));
-- Revisión previa al envío: una por versión del paquete, con su trabajo de IA y el informe (.md) que dejó.
CREATE TABLE IF NOT EXISTS revisiones_previas (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, paquete_version INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pedida','terminada','fallida')), resumen TEXT, ruta_md TEXT, agente TEXT,
  trabajo_id INTEGER, pedida_en TEXT NOT NULL, terminada_en TEXT, UNIQUE (licitacion_id, paquete_version));
-- El hilo del asistente de la oferta: respuestas de la persona, interpretaciones de Hermes y avisos.
CREATE TABLE IF NOT EXISTS oferta_hilo (
  id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, pregunta TEXT, autor TEXT NOT NULL, tipo TEXT NOT NULL,
  texto TEXT NOT NULL, datos TEXT, estado TEXT, creado_en TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS oferta_hilo_licitacion ON oferta_hilo(licitacion_id, id);
${SQL_CLASIFICACION}${SQL_BUSCADOR}${SQL_BUSQUEDAS}${SQL_PARTICIPACIONES}${SQL_ACTAS_MERCADO}${SQL_CONTRATOS}${SQL_INDICES}${SQL_CALIDAD}${SQL_RENOVACIONES}${SQL_PREGUNTAS_PLIEGO}`;

// Índices sobre columnas que añade la migración: van después de ella.
// licitaciones_organo_norm y _dir3: antecedentes y comparables del mismo órgano cuando no
// hay NIF (las plataformas agregadas no lo publican).
// Con la fecha detrás: las ediciones de un órgano grande se leen de la más reciente hacia atrás.
const INDICES_MIGRADOS = `CREATE INDEX IF NOT EXISTS adjudicaciones_organo ON adjudicaciones(organo_nif);
CREATE INDEX IF NOT EXISTS licitaciones_organo_fecha ON licitaciones(organo_nif, actualizada_en);
CREATE INDEX IF NOT EXISTS licitaciones_organo_norm ON licitaciones(organo_norm, actualizada_en);
CREATE INDEX IF NOT EXISTS licitaciones_organo_dir3 ON licitaciones(organo_dir3, actualizada_en);`;

// Columnas añadidas después de la primera versión del esquema. cambiada_a_mano: una
// persona fijó el estado (el código ya no lo toca); descarte_automatico: la descartó el
// código (un excluyente que la empresa no cumple), con el motivo en motivo_descarte.
// reaparecida_en: cuándo volvió sola a Nuevas (p. ej. al publicar sus pliegos): para la
// novedad cuenta esa fecha y no la de creación.
// origen: «feed» (en vivo) o «historico» (ZIP anual o mensual). Es solo un dato: el
// prefiltro mira lo abierto y en plazo venga de donde venga.
// adjudicaciones.organo_nif, cpvs, nuts y fecha_ref copian de la licitación lo que
// necesitan los agregados de competidores y organismos: así recorren solo esta tabla,
// estrecha, y no las filas de licitaciones (con su JSON, ~4 KB cada una; con 400.000 filas
// en disco, 6 s frente a 0,1 s). fecha_ref es la de adjudicación o, sin ella, la de la versión.
// presentacion_lotes (PartPresentationCode: 1 un lote, 2 todos, 3 uno o varios),
// max_lotes_oferta y max_lotes_adjudicacion deciden si el prefiltro mira el total o cada
// lote; las versiones guardadas antes no los traían y se rellenan con la siguiente versión
// de cada entrada (hasta entonces cuentan como «sin confirmar», igual que las agregadas).
// oportunidades.lotes_prefiltro (ids que encajaron en el prefiltro) y lotes_interes (los
// que eligió la criba, [{id, motivo}]) son JSON.
// organo_dir3 y organo_norm (nombre normalizado) identifican al órgano sin NIF: así se
// buscan sus ediciones anteriores y sus adjudicaciones parecidas. publicada_en (primer
// anuncio de licitación) fecha cada edición y mide el plazo de presentación; lo guardado
// antes no lo traía y llega con la siguiente versión de cada entrada o al recargar el histórico.
// titulo_palabras: las palabras del objeto ya normalizadas (antecedentes/texto.ts).
// oportunidades.error_proceso / error_detalle: por qué el proceso automático no la saca adelante
// (errores.ts, pestaña «Errores»); se recalcula en cada vuelta.
// oportunidades.responsable_id: la persona de la web (nucleo.usuarios) que lleva la oferta (responsable.ts).
const COLUMNAS_NUEVAS: Record<string, Record<string, string>> = {
  oportunidades: {
    cambiada_a_mano: 'INTEGER NOT NULL DEFAULT 0',
    lotes_prefiltro: 'TEXT',
    lotes_interes: 'TEXT',
    motivo_descarte: 'TEXT',
    descarte_automatico: 'INTEGER NOT NULL DEFAULT 0',
    reaparecida_en: 'TEXT',
    error_proceso: 'TEXT',
    error_detalle: 'TEXT',
    renovacion_de: 'TEXT',
    responsable_id: 'INTEGER',
  },
  licitaciones: {
    origen: "TEXT NOT NULL DEFAULT 'feed'",
    presentacion_lotes: 'TEXT',
    max_lotes_oferta: 'INTEGER',
    max_lotes_adjudicacion: 'INTEGER',
    organo_dir3: 'TEXT',
    organo_norm: 'TEXT',
    publicada_en: 'TEXT',
    titulo_palabras: 'TEXT',
    fecha_solicitud: 'TEXT',
  },
  // nif_valido (nucleo/identidad.ts): 1 si el NIF del adjudicatario es español con su control
  // bien o de otro país; 0 si no lo es, y entonces no entra en los índices ni en participaciones.
  adjudicaciones: { organo_nif: 'TEXT', cpvs: 'TEXT', nuts: 'TEXT', fecha_ref: 'TEXT', nif_valido: 'INTEGER' },
  // origen: 'hermes' (lo escribió y registró Hermes) o 'ensamblado' (memoria .docx que monta
  // la plataforma con los apartados de Hermes: oferta/ensamblado.ts), con sus rutas hermanas.
  borradores: {
    estado: "TEXT NOT NULL DEFAULT 'pendiente'",
    revisado_en: 'TEXT',
    origen: "TEXT NOT NULL DEFAULT 'hermes'",
    guion_id: 'INTEGER',
    version: 'INTEGER',
    memoria_id: 'INTEGER',
    apartados_json: 'TEXT',
    paginas_estimadas: 'REAL',
    paginas: 'INTEGER',
    ruta_pdf: 'TEXT',
    ruta_md: 'TEXT',
    ruta_json: 'TEXT',
  },
  evaluaciones: { estado: "TEXT NOT NULL DEFAULT 'pendiente'", revisado_en: 'TEXT' },
  // Una oferta por precio unitario (€/informe): el precio, su unidad y el paquete del que sale.
  // forzado_motivo: por qué se registró el paquete con filas que impedían presentarlo (auditoría).
  propuestas: { unidad: 'TEXT', precio_unitario: 'REAL', paquete_version: 'INTEGER', forzado_motivo: 'TEXT' },
  // Una memoria «mejorada» sale de otra (version_base) rehaciendo solo algunos apartados (JSON).
  // subida: nombre del Word si la versión la subió una persona (editada a mano).
  // notas_subida: lo que la persona dice que mejoró al subirla (de ahí aprende Hermes).
  // anulacion_fugas: quien la dio por buena con fugas entre sobres detectadas, por qué y cuáles (JSON).
  // fase de la memoria (oferta/avanceMemoria.ts), ronda de reescritura y último resultado de la
  // coherencia contra la hoja de hechos (JSON).
  // ensayo: 1 si se pidió con el plazo vencido para medirla contra la presentada (no es la de la oferta).
  // lote: de qué lote es cuando el pliego pide una memoria por lote (oferta/memoriaLote.ts); null = común.
  // La versión sigue siendo de la licitación (v5 · lote 2, v6 · lote 4): UNIQUE(licitacion_id, version) no cambia.
  // presentada: 1 si es la que se entregó, subida tal cual (oferta/memoriaPresentada.ts); 2 si otra la sustituyó.
  // sin_repartir: 1 si es una versión subida a mano sin los títulos del guion (oferta/subidaFlexible.ts):
  // se guarda entera y no se piden cambios por apartado sobre ella.
  // cortes_ensamblado: ensamblados seguidos que cortó un reinicio (oferta/ensamblado.ts); vuelve a 0 al acabar.
  // por_agente: 1 si no la pidió una persona (un agente con licitaciones_pedir o la cadena sola):
  // ninguna de sus fases levanta el freno de su tipo, que solo quita una persona.
  // mejora: 1 si la versión sale de otra para mejorar los apartados elegidos (oferta/mejoraMemoria.ts),
  // 0 si es por un cambio tardío, que conserva el texto; motivo_agente: por qué la pidió Hermes.
  memorias: {
    version_base: 'INTEGER',
    apartados_rehechos: 'TEXT',
    indicaciones: 'TEXT',
    subida: 'TEXT',
    notas_subida: 'TEXT',
    anulacion_fugas: 'TEXT',
    fase: 'TEXT',
    ronda: 'INTEGER NOT NULL DEFAULT 0',
    coherencia: "TEXT NOT NULL DEFAULT '[]'",
    ensayo: 'INTEGER NOT NULL DEFAULT 0',
    lote: 'TEXT',
    presentada: 'INTEGER NOT NULL DEFAULT 0',
    sin_repartir: 'INTEGER NOT NULL DEFAULT 0',
    cortes_ensamblado: 'INTEGER NOT NULL DEFAULT 0',
    por_agente: 'INTEGER NOT NULL DEFAULT 0',
    mejora: 'INTEGER NOT NULL DEFAULT 0',
    motivo_agente: 'TEXT',
  },
  // La ronda de reescritura en la que se pidió el apartado: los rechazos cuentan por ronda.
  // dependencias: de qué decisiones y apartados salió el texto (JSON), para marcarlo viejo si cambian;
  // editado: 1 si una persona lo tocó a mano (la regeneración ya no lo pisa sin avisar).
  memoria_apartados: {
    ronda: 'INTEGER NOT NULL DEFAULT 0',
    dependencias: "TEXT NOT NULL DEFAULT '{}'",
    editado: 'INTEGER NOT NULL DEFAULT 0',
  },
  // Versión del análisis con que se hizo la ficha (las de antes de la 2 se regeneran) y el
  // trabajo de IA que la trajo (sus métricas: modelo, tokens, duración).
  fichas: { version_prompt: 'INTEGER NOT NULL DEFAULT 1', trabajo_id: 'INTEGER' },
  // origen: «feed» (publicado en la PLACSP), «zip» (sacado de un ZIP publicado, cuya URL es
  // padre_url) o «expediente» (listado en la página del expediente de la PLACSP,
  // pliegosExpediente.ts); tipo: «deuc» si es la petición del DEUC (XML ESPDRequest);
  // proximo_intento_en: cuándo se vuelve a pedir lo que falló por algo pasajero (espera
  // creciente hasta el plazo).
  // subido_por: quien lo subió a mano (null = lo trajo la plataforma).
  pliegos: {
    origen: "TEXT NOT NULL DEFAULT 'feed'",
    padre_url: 'TEXT',
    tipo: 'TEXT',
    proximo_intento_en: 'TEXT',
    subido_por: 'TEXT',
  },
  // De qué secciones de las decisiones salió el anexo (JSON, oferta/dependenciasAnexo.ts), para relanzarlo solo si cambian.
  // identidad: nombre, modelo y lote del documento (oferta/documentos.ts), para seguirlo si el guion lo mueve.
  // sustituciones: el plan con que se rellenó (oferta/anexoPlan.ts, JSON); cambios_huecos: los huecos que
  // cambiaron después en la hoja (null si el anexo está al día).
  oferta_documentos: { anexo_dependencias: 'TEXT', identidad: 'TEXT', sustituciones: 'TEXT', cambios_huecos: 'TEXT' },
  // Comprobaciones: número de la versión vigente de las decisiones (su historial está en decisiones_historial).
  decisiones_oferta: { version: 'INTEGER NOT NULL DEFAULT 1' },
  // Quién aceptó, descartó o retiró la lección (la persona de la sesión).
  lecciones: { revisada_por: 'TEXT' },
  // Qué cambió frente a la versión anterior, por sección (oferta/guionDiff.ts, JSON); null si no
  // se pudo comparar, que cuenta como «cambió todo».
  guiones: { cambios: 'TEXT' },
  // Con qué versión del análisis (VERSION_ANALISIS_MODELOS, oferta/modelosPdf.ts) se guardó el modelo:
  // las filas anteriores (1 por defecto) se vuelven a analizar solas, sin borrar nada.
  modelos_pdf: { version_analisis: 'INTEGER NOT NULL DEFAULT 1' },
};

// normalizarNif en SQL (espacios, puntos y guiones fuera, en mayúsculas). `columna` es
// siempre un nombre fijo del código, nunca entrada.
const nifNormalizado = (columna: string) => `upper(replace(replace(replace(${columna}, ' ', ''), '.', ''), '-', ''))`;

// Al crear la columna en una base anterior: lo seguido o rescatado a mano (rescatada=1)
// es la única huella de una decisión humana que guardaba el esquema anterior, y los
// cambios automáticos no deben pisarla. Las adjudicaciones ya guardadas toman de su
// licitación los datos copiados (los CPV del contrato: los del lote no se guardaban) y
// el NIF del adjudicatario queda normalizado como en nucleo.organizaciones.
const RELLENOS: Record<string, string> = {
  // Las decisiones guardadas antes de las comprobaciones arrancan su historial en la versión 1.
  'decisiones_oferta.version': `INSERT OR IGNORE INTO decisiones_historial (licitacion_id, version, guion_id, datos, secciones, autor, creada_en)
    SELECT licitacion_id, 1, guion_id, datos, '[]', 'migración', actualizada_en FROM decisiones_oferta`,
  'oportunidades.cambiada_a_mano': 'UPDATE oportunidades SET cambiada_a_mano = 1 WHERE rescatada = 1',
  'adjudicaciones.fecha_ref': `UPDATE adjudicaciones AS a SET organo_nif = l.organo_nif, cpvs = l.cpvs, nuts = l.nuts,
      fecha_ref = COALESCE(NULLIF(substr(a.fecha, 1, 10), ''), substr(l.actualizada_en, 1, 10)),
      adjudicatario_nif = ${nifNormalizado('a.adjudicatario_nif')}
    FROM licitaciones AS l WHERE l.id = a.licitacion_id`,
  'licitaciones.organo_dir3': "UPDATE licitaciones SET organo_dir3 = json_extract(datos, '$.organo.dir3')",
  'licitaciones.titulo_palabras': 'UPDATE licitaciones SET titulo_palabras = palabras_objeto(titulo)',
  'licitaciones.organo_norm':
    "UPDATE licitaciones SET organo_norm = normalizar_organo(organo_nombre, json_extract(datos, '$.organo.superior'))",
  // Lo que antes acababa en error y ahora se baja: un ZIP (se descomprime) y los fallos
  // pasajeros, que se daban por perdidos a los tres intentos de tres vueltas seguidas.
  'pliegos.proximo_intento_en': `UPDATE pliegos SET estado = 'pendiente', intentos = 0, error = NULL WHERE estado = 'error'
    AND (error LIKE 'comprimido:%' OR error LIKE 'placsp_http_5%' OR error LIKE 'placsp_inalcanzable:%' OR error LIKE 'io_error:%')`,
};

// Arreglos de datos de columnas que ya existían: se aplican una vez y en orden, y
// PRAGMA user_version guarda cuántos lleva la base (en una base nueva no tocan nada).
// 1: el NIF del órgano se guardaba tal cual llegaba de la PLACSP; ahora se normaliza como
// en nucleo.organizaciones y en las rutas, o su ficha y su seguimiento no lo encontrarían.
// 2: organo_norm reconoce más cargos y lleva el órgano superior cuando el nombre no es un
// cargo (antecedentes/texto.ts): con la clave anterior, «Consejo de Gobierno Foral» de dos
// diputaciones distintas era el mismo órgano. Solo las filas sin NIF, que son las que se
// buscan por nombre (medido con 93.000 filas: 2 s frente a 13 s todas); las de NIF toman
// la clave nueva con su siguiente versión.
// 4: lo que el código pasaba solo a next (Más adelante) por un excluyente ahora se
// descarta; las que siguen ahí sin que nadie las tocara pasan a Descartadas con su motivo,
// y la columna motivo_next desaparece (una base nueva no la tiene).
function nextADescartadas(db: Db): void {
  const columnas = (db.prepare('PRAGMA table_info(oportunidades)').all() as { name: string }[]).map((c) => c.name);
  if (!columnas.includes('motivo_next')) return;
  db.exec(`UPDATE oportunidades SET estado = 'descartada', motivo_descarte = motivo_next, descarte_automatico = 1
    WHERE estado = 'next' AND motivo_next IS NOT NULL AND cambiada_a_mano = 0;
    ALTER TABLE oportunidades DROP COLUMN motivo_next;`);
}

// 19: la memoria ya no se redacta apartado por apartado: toda memoria pasa por las fases
// (fase no nula). Las anteriores que seguían abiertas no tienen quien las termine y se dan por
// fallidas (hay que pedirlas de nuevo); las ensambladas se conservan tal cual. La columna del
// método desaparece (una base nueva no la tiene).
function retirarMemoriasPorApartado(db: Db): void {
  const columnas = (db.prepare('PRAGMA table_info(memorias)').all() as { name: string }[]).map((c) => c.name);
  if (!columnas.includes('pipeline')) return;
  db.prepare(
    "UPDATE memorias SET estado = 'fallida', error = ? WHERE fase IS NULL AND estado IN ('redactando', 'ensamblando')",
  ).run(MOTIVO_SIN_METODO);
  db.exec('ALTER TABLE memorias DROP COLUMN pipeline');
}

// 20: lo que la 19 dejó a medias. (a) Una memoria del método anterior con todos sus apartados
// recibidos no necesita IA para terminar: vuelve a «ensamblando» y la monta reanudarEnsamblados al
// arrancar (si la 19 ya la dio por fallida, se deshace con su mismo error). (b) Una base que nunca
// tuvo la columna del método se saltó la 19 y dejaba memorias sin fase redactándose para siempre:
// las que no se pueden montar fallan con el mismo motivo.
const MOTIVO_SIN_METODO = 'Esta memoria se redactaba por apartados, un método que ya no existe: pídela de nuevo.';
const SOLO_RECIBIDOS = `EXISTS (SELECT 1 FROM memoria_apartados a WHERE a.memoria_id = memorias.id)
  AND NOT EXISTS (SELECT 1 FROM memoria_apartados a WHERE a.memoria_id = memorias.id AND a.estado <> 'recibido')`;
function cerrarMemoriasSinFase(db: Db): void {
  db.prepare(
    `UPDATE memorias SET estado = 'ensamblando', error = NULL WHERE fase IS NULL AND subida IS NULL AND ${SOLO_RECIBIDOS}
      AND (estado IN ('redactando', 'ensamblando') OR (estado = 'fallida' AND error = ?))`,
  ).run(MOTIVO_SIN_METODO);
  db.prepare(
    "UPDATE memorias SET estado = 'fallida', error = ? WHERE fase IS NULL AND estado IN ('redactando', 'ensamblando') AND NOT (" +
      SOLO_RECIBIDOS +
      ')',
  ).run(MOTIVO_SIN_METODO);
}

// 22: la clave de los trabajos de fase de la memoria pasó de «memoria2-…» a «memoria-…»: los que
// siguen vivos, fallidos o cancelados se renombran, o la máquina de fases no los encontraría y
// pediría otra vez un run que ya está en marcha (o que alguien canceló). Los completados se quedan
// como histórico. nucleo está adjunta antes de migrar; sin su tabla (una base nueva) no hay nada.
function renombrarClavesMemoria(db: Db): void {
  const hay = db.prepare("SELECT 1 FROM nucleo.sqlite_master WHERE type = 'table' AND name = 'trabajos_ia'").get();
  if (!hay) return;
  db.exec(`UPDATE nucleo.trabajos_ia SET clave = 'memoria-' || substr(clave, 10)
    WHERE clave GLOB 'memoria2-*' AND estado IN ('pendiente', 'lanzado', 'fallido', 'cancelado')`);
}

// 23: la columna con la que una persona pasa una respuesta del pliego a las comprobaciones se llamaba
// en_cabina. Una base nueva ya la trae con el nombre actual.
function renombrarColumnaEnComprobaciones(db: Db): void {
  const columnas = (db.prepare('PRAGMA table_info(preguntas_pliego)').all() as { name: string }[]).map((c) => c.name);
  if (!columnas.includes('en_cabina')) return;
  db.exec('ALTER TABLE preguntas_pliego RENAME COLUMN en_cabina TO en_comprobaciones');
}

// 5: el seguro de responsabilidad civil dejó de ser excluyente (se contrata antes de
// presentarse). Lo que el código descartó solo por él vuelve a Revisar; si había otro
// excluyente (el motivo los separa con « · »), sigue descartado.
const SEGURO_YA_NO_DESCARTA = `UPDATE oportunidades SET estado = 'revisar', motivo_descarte = NULL, descarte_automatico = 0
  WHERE estado = 'descartada' AND descarte_automatico = 1 AND cambiada_a_mano = 0
    AND motivo_descarte LIKE 'Requisito excluyente no cumplido: Seguro de indemnización%' AND instr(motivo_descarte, ' · ') = 0`;

// 10: las presentadas subidas antes guardaron el lote solo en su resumen («…»), lote N.»)
// y su .json, con memorias.lote NULL (la columna es de esta misma versión): pasaban por la común y
// cerraban la oferta entera. Toman el lote del resumen si es uno de los que llevan memoria propia
// según el guion y las decisiones vigentes (lotesConMemoriaPropia); si no, no hay de dónde saberlo y
// se quedan comunes. Después, en cada lote, la presentada más nueva es la que vale (1) y las demás
// quedan sustituidas (2): antes, subir la de un lote sustituía la de cualquier otro.
const LOTE_EN_RESUMEN = /»\), lote ([^»]+?)\.?\s*$/;

function lotesDecididosAlMigrar(db: Db, id: string): string[] {
  const d = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as
    { datos: string } | undefined;
  const o = db.prepare('SELECT lotes_interes FROM oportunidades WHERE licitacion_id = ?').get(id) as
    { lotes_interes: string | null } | undefined;
  try {
    const decididos = d ? ((JSON.parse(d.datos) as { lotes?: unknown }).lotes ?? []) : [];
    if (Array.isArray(decididos) && decididos.length) return decididos.map(String);
    const interes = o?.lotes_interes ? (JSON.parse(o.lotes_interes) as unknown[]) : [];
    return interes.map((x) => String(typeof x === 'object' && x !== null ? (x as { id?: unknown }).id : x));
  } catch {
    return [];
  }
}

// Como lotesDeLaMemoria (oferta/memoriaPresentada.ts), leído a mano: al migrar no se cargan los módulos de la oferta.
function lotesConMemoriaPropia(db: Db, id: string): string[] {
  const g = db.prepare('SELECT datos FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1').get(id) as
    { datos: string } | undefined;
  if (!g) return [];
  try {
    return lotesDeMemoria(JSON.parse(g.datos) as GuionBaseData, lotesDecididosAlMigrar(db, id)) ?? [];
  } catch {
    return [];
  }
}

function presentadasConSuLote(db: Db): void {
  const filas = db
    .prepare(
      `SELECT m.id, m.licitacion_id, b.resumen FROM memorias m JOIN borradores b ON b.id = m.borrador_id
    WHERE m.presentada IN (1, 2) AND m.lote IS NULL AND b.resumen IS NOT NULL`,
    )
    .all() as { id: number; licitacion_id: string; resumen: string }[];
  const poner = db.prepare('UPDATE memorias SET lote = ? WHERE id = ?');
  for (const f of filas) {
    const lote = LOTE_EN_RESUMEN.exec(f.resumen)?.[1]?.trim();
    if (lote && lotesConMemoriaPropia(db, f.licitacion_id).includes(lote)) poner.run(lote, f.id);
  }
  db.exec(`UPDATE memorias SET presentada = CASE WHEN version = (SELECT MAX(n.version) FROM memorias n
      WHERE n.licitacion_id = memorias.licitacion_id AND n.lote = memorias.lote AND n.presentada IN (1, 2)) THEN 1 ELSE 2 END
    WHERE presentada IN (1, 2) AND lote IS NOT NULL;`);
}

// 11: una ficha «No go» de Hermes descarta sola la oportunidad que sigue por decidir.
// Las que ya estaban en nueva (o «Ficha por revisar») con la ficha vigente en «No go» y que nadie
// movió a mano pasan a Descartadas con el mismo motivo, tipo e historial que al llegar la ficha.
// La ficha vigente se lee como la leen la web y el MCP (fichasDe): una que ya no valida no se
// enseña, así que tampoco descarta. Sin evento: el núcleo aún no está adjunto; la web las ve al cargar.
function noGoADescartadas(db: Db): void {
  const ids = db
    .prepare(
      `SELECT o.licitacion_id AS id FROM oportunidades o WHERE o.estado = 'nueva' AND o.cambiada_a_mano = 0
    AND EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id AND f.estado = 'aprobada')`,
    )
    .all() as { id: string }[];
  for (const { id } of ids) {
    const r = fichasDe(db, id).aprobada?.datos.recomendacion;
    if (r?.decision === 'no_go') descartarSinAviso(db, id, descarteNoGo(r.motivo));
  }
}

// 12: las lecciones pasan a ser el libro de lecciones (origen, alcance con su valor, tema, fuerza
// y evidencias). Las de antes son todas de una edición a mano: su evidencia suelta pasa a la lista
// con el Word del que salió y el apartado, y su tema sale del título del apartado. SQLite no cambia
// un CHECK, así que la tabla se rehace con los mismos ids.
type LeccionV1 = {
  id: number;
  licitacion_id: string;
  memoria_id: number;
  apartado: number | null;
  apartado_titulo: string | null;
  alcance: string;
  texto: string;
  evidencia: string;
  estado: string;
  agente: string;
  trabajo_id: number | null;
  creada_en: string;
  revisada_en: string | null;
  subida: string | null;
};

function leccionesAmpliadas(db: Db): void {
  const columnas = (db.prepare('PRAGMA table_info(lecciones)').all() as { name: string }[]).map((c) => c.name);
  if (columnas.includes('origen')) return;
  db.exec(`ALTER TABLE lecciones RENAME TO lecciones_previas; ${SQL_TABLA_LECCIONES('lecciones')};`);
  const viejas = db
    .prepare('SELECT l.*, m.subida FROM lecciones_previas l LEFT JOIN memorias m ON m.id = l.memoria_id')
    .all() as LeccionV1[];
  const ins =
    db.prepare(`INSERT INTO lecciones (id, licitacion_id, memoria_id, apartado, apartado_titulo, origen, alcance, alcance_valor, tema, texto,
      evidencias, fuerza, estado, agente, trabajo_id, creada_en, revisada_en)
    VALUES (?, ?, ?, ?, ?, 'edicion', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`);
  for (const l of viejas) {
    const ubicacion = l.apartado
      ? `apartado ${l.apartado}${l.apartado_titulo ? ` · ${l.apartado_titulo}` : ''}`
      : 'toda la memoria';
    const evidencias = JSON.stringify([
      { licitacion_id: l.licitacion_id, memoria_id: l.memoria_id, documento: l.subida, ubicacion, texto: l.evidencia },
    ]);
    ins.run(
      l.id,
      l.licitacion_id,
      l.memoria_id,
      l.apartado,
      l.apartado_titulo,
      l.alcance,
      l.alcance === 'licitacion' ? l.licitacion_id : null,
      temaDeApartado(l.apartado_titulo ?? l.texto),
      l.texto,
      evidencias,
      l.estado,
      l.agente,
      l.trabajo_id,
      l.creada_en,
      l.revisada_en,
    );
  }
  db.exec(`DROP TABLE lecciones_previas; ${INDICES_LECCIONES}`);
}

const ARREGLOS: (string | ((db: Db) => void))[] = [
  `UPDATE licitaciones SET organo_nif = ${nifNormalizado('organo_nif')} WHERE organo_nif GLOB '*[^A-Z0-9]*';
   UPDATE adjudicaciones SET organo_nif = ${nifNormalizado('organo_nif')} WHERE organo_nif GLOB '*[^A-Z0-9]*';`,
  "UPDATE licitaciones SET organo_norm = normalizar_organo(organo_nombre, json_extract(datos, '$.organo.superior')) WHERE organo_nif IS NULL",
  // 3: títulos y nombres con entidades HTML codificadas dos veces por el órgano (`&nbsp;`);
  // el título del JSON `datos` no se toca: la web y las búsquedas usan la columna.
  `UPDATE licitaciones SET titulo = decodificar_entidades(titulo), titulo_palabras = palabras_objeto(decodificar_entidades(titulo)) WHERE titulo LIKE '%&%;%';
   UPDATE licitaciones SET organo_nombre = decodificar_entidades(organo_nombre) WHERE organo_nombre LIKE '%&%;%';
   UPDATE adjudicaciones SET adjudicatario_nombre = decodificar_entidades(adjudicatario_nombre) WHERE adjudicatario_nombre LIKE '%&%;%';`,
  nextADescartadas,
  SEGURO_YA_NO_DESCARTA,
  // 6: sin «revisar» ni «más adelante»: lo que la criba dejaba en revisar pasa a nueva (la
  // ficha resuelve las dudas) y lo que estaba en más adelante, a descartada con su motivo.
  `UPDATE oportunidades SET estado = 'nueva' WHERE estado = 'revisar';
   UPDATE oportunidades SET estado = 'descartada', motivo_descarte = COALESCE(motivo_descarte, 'Estaba en «Más adelante», que ya no existe.') WHERE estado = 'next';`,
  // 7: lo que Hermes «cribó» sin poder leer el perfil (todo «revisar», motivo «falta el
  // perfil de licitaciones») vuelve a Sin cribar para cribarlo de verdad. Solo lo que nadie
  // tocó a mano y aún no tiene ficha.
  `UPDATE oportunidades SET estado = 'candidata', veredicto_ia = NULL, motivo_ia = NULL, confianza_ia = NULL, lotes_interes = NULL, lote_criba = NULL
   WHERE estado = 'nueva' AND cambiada_a_mano = 0 AND lower(motivo_ia) LIKE '%falta el perfil de licitaciones%'
     AND NOT EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = oportunidades.licitacion_id);`,
  // 8: las de la 7 que ya tenían ficha también: la ficha lee requisitos, pero el encaje con
  // el sector de la empresa lo juzga la criba (servicios eléctricos, seguía en Nuevas con
  // «falta el perfil»). La ficha se queda.
  `UPDATE oportunidades SET estado = 'candidata', veredicto_ia = NULL, motivo_ia = NULL, confianza_ia = NULL, lotes_interes = NULL, lote_criba = NULL
   WHERE estado = 'nueva' AND cambiada_a_mano = 0 AND lower(motivo_ia) LIKE '%falta el perfil de licitaciones%';`,
  // 9: la criba que no pudo leer el perfil dejó «Hermes: falta el perfil de licitaciones»
  // congelado también en descartadas y en las cambiadas a mano (también en las descartadas). Solo se borran motivo y veredicto; el estado lo decidió una persona y no se toca.
  `UPDATE oportunidades SET veredicto_ia = NULL, motivo_ia = NULL, confianza_ia = NULL
   WHERE lower(motivo_ia) LIKE '%falta el perfil de licitaciones%' OR lower(motivo_ia) LIKE '%perfil-licitaciones%';`,
  presentadasConSuLote,
  noGoADescartadas,
  leccionesAmpliadas,
  // 13: CPV y lotes en tablas (clasificacion.ts) con lo que ya había.
  rellenarClasificacion,
  // 14: la búsqueda de texto (buscador.ts), con los títulos de los lotes de la 13.
  rellenarBuscador,
  // 15: NIF sin el prefijo «ES» y marca de NIF válido en las adjudicaciones.
  `UPDATE licitaciones SET organo_nif = normalizar_nif(organo_nif) WHERE organo_nif GLOB 'ES*';
   UPDATE adjudicaciones SET organo_nif = normalizar_nif(organo_nif) WHERE organo_nif GLOB 'ES*';
   UPDATE adjudicaciones SET adjudicatario_nif = normalizar_nif(adjudicatario_nif) WHERE adjudicatario_nif GLOB 'ES*';
   UPDATE adjudicaciones SET nif_valido = nif_estado(adjudicatario_nif) <> 'no_valido' WHERE adjudicatario_nif IS NOT NULL;`,
  // 16: participaciones sembradas con los adjudicatarios de NIF válido de la 15.
  rellenarParticipaciones,
  // 17: contratos con su fin estimado.
  rellenarContratos,
  // 18: incidencias de calidad de lo que ya había.
  rellenarIncidencias,
  retirarMemoriasPorApartado,
  cerrarMemoriasSinFase,
  // 21: la regla de las comprobaciones de los hechos de la memoria pasó de «hecho_v2» a «hecho»: lo que una
  // persona decidió sobre esos bloqueos («Vamos», riesgo aceptado…) sigue con su clave.
  "UPDATE oferta_bloqueos SET clave = 'hecho:' || substr(clave, 10) WHERE clave GLOB 'hecho_v2:*'",
  renombrarClavesMemoria,
  renombrarColumnaEnComprobaciones,
];

/** user_version de una base al día (los tests lo comparan sin contar los arreglos a mano). */
export const ARREGLOS_TOTALES = ARREGLOS.length;

function arreglarDatos(db: Db): void {
  const hechos = Number(db.pragma('user_version', { simple: true }));
  if (hechos >= ARREGLOS.length) return;
  for (const arreglo of ARREGLOS.slice(hechos)) {
    if (typeof arreglo === 'string') db.exec(arreglo);
    else arreglo(db);
  }
  db.pragma(`user_version = ${ARREGLOS.length}`);
}

function anadirColumnas(db: Db, tabla: string, columnas: Record<string, string>): void {
  const existentes = new Set(
    (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [nombre, tipo] of Object.entries(columnas)) {
    if (existentes.has(nombre)) continue;
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo}`);
    const relleno = RELLENOS[`${tabla}.${nombre}`];
    if (relleno) db.exec(relleno);
  }
}

// Idempotente y en transacción inmediata: el hilo de ingesta y el servidor abren la
// base a la vez y solo uno debe añadir cada columna.
function migrar(db: Db): void {
  db.transaction(() => {
    for (const [tabla, columnas] of Object.entries(COLUMNAS_NUEVAS)) anadirColumnas(db, tabla, columnas);
    arreglarDatos(db);
  }).immediate();
}

export function licitacionesFile(dataDir: string): string {
  return path.join(dataDir, 'licitaciones.db');
}

/** Abre licitaciones.db con nucleo.db adjunta como «nucleo». Cada hilo abre la suya. */
export function abrirLicitaciones(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(licitacionesFile(dataDir));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  // La migración rellena organo_norm y titulo_palabras con la misma normalización que usa el código.
  db.function('palabras_objeto', { deterministic: true }, (titulo: unknown) =>
    typeof titulo === 'string' ? palabrasTexto(titulo) : null,
  );
  db.function('normalizar_nif', { deterministic: true }, (nif: unknown) =>
    typeof nif === 'string' ? normalizarNif(nif) : nif,
  );
  db.function('fin_contrato', { deterministic: true }, finContrato);
  db.function('nif_clase', { deterministic: true }, (nif: unknown) => (typeof nif === 'string' ? claseNif(nif) : null));
  db.function('nif_estado', { deterministic: true }, (nif: unknown) =>
    typeof nif === 'string' ? estadoNif(nif) : null,
  );
  db.function('decodificar_entidades', { deterministic: true }, (t: unknown) =>
    typeof t === 'string' ? decodificarEntidades(t) : t,
  );
  db.function('normalizar_organo', { deterministic: true }, (nombre: unknown, superior: unknown) =>
    typeof nombre === 'string' ? normalizarOrgano(nombre, typeof superior === 'string' ? superior : null) : null,
  );
  // Adjunta antes de migrar: algún arreglo toca los trabajos de nucleo (renombrarClavesMemoria).
  db.prepare('ATTACH DATABASE ? AS nucleo').run(nucleoFile(dataDir));
  migrar(db);
  db.exec(INDICES_MIGRADOS);
  return db;
}

const ahora = () => new Date().toISOString();

export { cpvsTexto };

function bajaDe(importe: number | null, presupuesto: number | null): number | null {
  if (importe === null || presupuesto === null || presupuesto <= 0 || importe > presupuesto * 1.5) return null;
  return Math.round((1 - importe / presupuesto) * 10_000) / 10_000;
}

function presupuestoDelLote(l: LicitacionData, lote: string | null): number | null {
  if (lote === null || l.lotes.length === 0) return l.presupuesto_sin_iva;
  return l.lotes.find((x) => x.id === lote)?.presupuesto_sin_iva ?? null;
}

// Los CPV del lote, si los fija aparte, describen mejor lo adjudicado que los del contrato.
function cpvsDelLote(l: LicitacionData, lote: string | null): string {
  const propios = lote === null ? [] : (l.lotes.find((x) => x.id === lote)?.cpvs ?? []);
  return cpvsTexto(propios.length ? propios : l.cpvs);
}

// El NIF del órgano, normalizado como en nucleo.organizaciones: las fichas y el
// seguimiento lo buscan así.
function nifOrgano(l: LicitacionData): string | null {
  return l.organo.nif ? normalizarNif(l.organo.nif) : null;
}

function guardarAdjudicaciones(db: Db, l: LicitacionData): void {
  db.prepare('DELETE FROM adjudicaciones WHERE licitacion_id = ?').run(l.id);
  const insert =
    db.prepare(`INSERT INTO adjudicaciones (licitacion_id, lote, resultado, fecha, ofertas, oferta_min, oferta_max,
    adjudicatario_nif, adjudicatario_nombre, importe_sin_iva, presupuesto_sin_iva, baja, pyme, ord, organo_nif, cpvs, nuts, fecha_ref, nif_valido)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const fechaVersion = l.actualizada_en.slice(0, 10);
  l.resultados.forEach((r, ord) => {
    const presupuesto = presupuestoDelLote(l, r.lote);
    const adjudicado = r.codigo !== null && RESULTADOS_ADJUDICADOS.has(r.codigo);
    const nif = r.adjudicatario_nif ? normalizarNif(r.adjudicatario_nif) : null;
    insert.run(
      l.id,
      r.lote ?? '',
      r.codigo,
      r.fecha,
      r.ofertas,
      r.oferta_min,
      r.oferta_max,
      nif,
      r.adjudicatario_nombre,
      r.importe_sin_iva,
      presupuesto,
      adjudicado ? bajaDe(r.importe_sin_iva, presupuesto) : null,
      r.pyme === null ? null : Number(r.pyme),
      ord,
      nifOrgano(l),
      cpvsDelLote(l, r.lote),
      l.nuts,
      r.fecha?.slice(0, 10) || fechaVersion,
      nif === null ? null : Number(estadoNif(nif) !== 'no_valido'),
    );
  });
}

export type Guardado = 'nueva' | 'actualizada' | 'igual';
export type Origen = 'feed' | 'historico';

/** Inserta o actualiza una licitación si lo que llega es igual o más reciente. */
export function guardarLicitacion(db: Db, l: LicitacionData, origen: Origen = 'feed'): Guardado {
  const previa = db.prepare('SELECT actualizada_en FROM licitaciones WHERE id = ?').get(l.id) as
    { actualizada_en: string } | undefined;
  if (previa && Date.parse(previa.actualizada_en) > Date.parse(l.actualizada_en)) return 'igual';
  const {
    criterios,
    requisitos,
    garantias,
    documentos,
    lotes,
    presentacion,
    resultados,
    duracion,
    periodo,
    presupuesto_con_iva,
    organo,
  } = l;
  const datos = JSON.stringify({
    criterios,
    requisitos,
    garantias,
    documentos,
    lotes,
    presentacion,
    resultados,
    duracion,
    periodo,
    presupuesto_con_iva,
    organo,
    mapper: VERSION_MAPPER,
  });
  db.prepare(
    `INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, url, estado, actualizada_en, organo_nombre,
      organo_nif, tipo_contrato, procedimiento, presupuesto_sin_iva, valor_estimado, cpvs, nuts, lugar, fecha_limite, datos, vista_en, origen,
      presentacion_lotes, max_lotes_oferta, max_lotes_adjudicacion, organo_dir3, organo_norm, publicada_en, titulo_palabras, fecha_solicitud)
    VALUES (@id, @atom_id, @fuente, @expediente, @titulo, @url, @estado, @actualizada_en, @organo_nombre, @organo_nif,
      @tipo_contrato, @procedimiento, @presupuesto_sin_iva, @valor_estimado, @cpvs, @nuts, @lugar, @fecha_limite, @datos, @vista_en, @origen,
      @presentacion_lotes, @max_lotes_oferta, @max_lotes_adjudicacion, @organo_dir3, @organo_norm, @publicada_en, @titulo_palabras, @fecha_solicitud)
    ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, url = excluded.url, estado = excluded.estado,
      origen = CASE WHEN licitaciones.origen = 'feed' THEN 'feed' ELSE excluded.origen END,
      actualizada_en = excluded.actualizada_en, organo_nombre = excluded.organo_nombre, organo_nif = excluded.organo_nif,
      tipo_contrato = excluded.tipo_contrato, procedimiento = excluded.procedimiento, presupuesto_sin_iva = excluded.presupuesto_sin_iva,
      valor_estimado = excluded.valor_estimado, cpvs = excluded.cpvs, nuts = excluded.nuts, lugar = excluded.lugar,
      fecha_limite = excluded.fecha_limite, datos = excluded.datos, borrada_en = NULL, borrada_motivo = NULL,
      presentacion_lotes = excluded.presentacion_lotes, max_lotes_oferta = excluded.max_lotes_oferta,
      max_lotes_adjudicacion = excluded.max_lotes_adjudicacion, organo_dir3 = excluded.organo_dir3, organo_norm = excluded.organo_norm,
      publicada_en = COALESCE(excluded.publicada_en, licitaciones.publicada_en), titulo_palabras = excluded.titulo_palabras,
      fecha_solicitud = COALESCE(excluded.fecha_solicitud, licitaciones.fecha_solicitud)`,
  ).run({
    ...l,
    organo_nombre: organo.nombre,
    organo_nif: nifOrgano(l),
    cpvs: cpvsTexto(l.cpvs),
    datos,
    vista_en: ahora(),
    origen,
    presentacion_lotes: presentacion.codigo,
    max_lotes_oferta: presentacion.maximo_lotes,
    max_lotes_adjudicacion: presentacion.maximo_adjudicables,
    organo_dir3: organo.dir3,
    organo_norm: normalizarOrgano(organo.nombre, organo.superior ?? null),
    titulo_palabras: palabrasTexto(l.titulo),
    fecha_solicitud: l.fecha_solicitud ?? null,
  });
  guardarAdjudicaciones(db, l);
  sembrarParticipaciones(db, l.id);
  guardarContratos(db, l.id);
  guardarClasificacion(db, l);
  detectarIncidencias(db, l.id);
  indexarTexto(db, l);
  if (!previa) return 'nueva';
  return previa.actualizada_en === l.actualizada_en ? 'igual' : 'actualizada';
}

export function marcarBorrada(db: Db, atomId: string, cuando: string, motivo: string | null): void {
  db.prepare(
    'UPDATE licitaciones SET borrada_en = ?, borrada_motivo = ? WHERE atom_id = ? AND (borrada_en IS NULL OR borrada_en < ?)',
  ).run(cuando, motivo, atomId, cuando);
}

export type SyncEstado = {
  fuente: string;
  hasta: string | null;
  ultima_vuelta: string | null;
  last_modified: string | null;
  ultimo_error: string | null;
  entradas: number;
};

export function syncEstado(db: Db, fuente: string): SyncEstado {
  const row = db.prepare('SELECT * FROM sync_estado WHERE fuente = ?').get(fuente) as SyncEstado | undefined;
  return row ?? { fuente, hasta: null, ultima_vuelta: null, last_modified: null, ultimo_error: null, entradas: 0 };
}

export function guardarSyncEstado(db: Db, s: SyncEstado): void {
  db.prepare(
    `INSERT INTO sync_estado (fuente, hasta, ultima_vuelta, last_modified, ultimo_error, entradas)
    VALUES (@fuente, @hasta, @ultima_vuelta, @last_modified, @ultimo_error, @entradas)
    ON CONFLICT(fuente) DO UPDATE SET hasta = excluded.hasta, ultima_vuelta = excluded.ultima_vuelta,
      last_modified = excluded.last_modified, ultimo_error = excluded.ultimo_error, entradas = excluded.entradas`,
  ).run(s);
}

export type FilaLicitacion = {
  id: string;
  atom_id: string;
  fuente: string;
  expediente: string;
  titulo: string;
  url: string | null;
  estado: string;
  actualizada_en: string;
  organo_nombre: string;
  organo_nif: string | null;
  tipo_contrato: string | null;
  procedimiento: string | null;
  presupuesto_sin_iva: number | null;
  valor_estimado: number | null;
  cpvs: string;
  nuts: string | null;
  lugar: string | null;
  fecha_limite: string | null;
  datos: string;
  borrada_en: string | null;
  borrada_motivo: string | null;
  vista_en: string;
  origen: Origen;
  presentacion_lotes: string | null;
  max_lotes_oferta: number | null;
  max_lotes_adjudicacion: number | null;
  organo_dir3: string | null;
  organo_norm: string | null;
  publicada_en: string | null;
  titulo_palabras: string | null;
  fecha_solicitud: string | null;
};

export function obtenerLicitacion(db: Db, id: string): FilaLicitacion | null {
  return (db.prepare('SELECT * FROM licitaciones WHERE id = ?').get(id) as FilaLicitacion | undefined) ?? null;
}

export function contarLicitaciones(db: Db): { total: number; abiertas: number; adjudicaciones: number } {
  return db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM licitaciones) AS total,
    (SELECT COUNT(*) FROM licitaciones WHERE estado IN ('PUB', 'PRE') AND borrada_en IS NULL) AS abiertas,
    (SELECT COUNT(*) FROM adjudicaciones) AS adjudicaciones`,
    )
    .get() as { total: number; abiertas: number; adjudicaciones: number };
}
