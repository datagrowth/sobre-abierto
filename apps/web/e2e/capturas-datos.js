// Datos sintéticos de las capturas de la documentación (capturas.captura.js), encima de e2e/datos.
// Todo es inventado: la empresa ficticia de los tests (Analítica Ejemplo), personas «Persona A…» y
// órganos «de Ejemplo» o de «Villaejemplo». Solo se usan aquí: los recorridos e2e no los leen.
import { leerDatos, servirFixture } from './api.js';

/** Las ofertas de e2e/datos que salen en las capturas. */
export const CASO_D = 'p-91000880';
export const CASO_E = 'p-91000080';
export const CASO_C = 'p-91000770';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** Responde `ruta` (un final de ruta o una función de URL) con `body` en las lecturas. */
export async function responder(page, ruta, body) {
  const casa = typeof ruta === 'function' ? ruta : (url) => url.pathname.endsWith(ruta);
  await page.route(casa, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(body)) : route.fallback(),
  );
}

// La instalación en marcha: ingesta encendida y Hermes conectado, sin avisos de operación.
const estadoEnMarcha = () => ({
  ...leerDatos('casoE')['GET /api/licitaciones/estado'].body,
  activo: true,
  hermes: 'configurado',
  aviso_hermes: null,
  ingesta: { activa: true, error: null, estado: { fase: 'esperando' } },
  al_dia_hasta: '2027-10-13T20:30:00.000Z',
});

// Los filtros ya ajustados por la empresa (sin el aviso de «son de ejemplo»).
const filtrosPropios = () => ({ ...leerDatos('casoE')['GET /api/licitaciones/filtros'].body, de_ejemplo: false });

/**
 * Socket.io conectado de mentira (Engine.IO v4: «0» abre, «40» une al espacio «/»). Sin él, el pie de
 * la barra lateral dice «Sin conexión con el servidor» y la Actividad no carga las sesiones.
 */
async function conectarSocket(page) {
  await page.routeWebSocket('**/socket.io/**', (ws) => {
    ws.send(
      `0${JSON.stringify({ sid: 'captura', upgrades: [], pingInterval: 25000, pingTimeout: 60000, maxPayload: 1e6 })}`,
    );
    ws.onMessage((m) => {
      if (String(m).startsWith('40')) ws.send(`40${JSON.stringify({ sid: 'captura-io' })}`);
      if (m === '2') ws.send('3');
    });
  });
}

/** Lo común a todas las capturas: una instalación en marcha con las 5 ofertas de e2e/datos. */
export async function instalacionEnMarcha(page, caso = 'casoE') {
  await servirFixture(page, caso);
  await conectarSocket(page);
  await responder(page, '/api/licitaciones/estado', estadoEnMarcha());
  await responder(page, '/api/licitaciones/filtros', filtrosPropios());
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

const tarjeta = (id, expediente, titulo, organo, importe, fecha_limite, extra = {}) => ({
  id,
  expediente,
  titulo,
  titulo_corto: titulo.length > 52 ? `${titulo.slice(0, 51).trimEnd()}…` : titulo,
  organo,
  importe,
  fecha_limite,
  resultado: null,
  responsable: null,
  ...extra,
});

export function pipeline() {
  const reales = leerDatos('casoE')['GET /api/licitaciones/pipeline'].body.columnas[0].tarjetas;
  const enPreparacion = reales
    .filter((t) => [CASO_E, CASO_D, 'p-91000770'].includes(t.id))
    .map((t, i) => ({ ...t, responsable: i === 1 ? { id: 2, nombre: 'Elisa Editora' } : t.responsable }));
  const columnas = {
    en_preparacion: enPreparacion,
    lista_para_firmar: [
      tarjeta(
        'p-91001010',
        'EXP-2027-0233',
        'Cuadro de mando de indicadores de movilidad urbana',
        'Ayuntamiento de Villaejemplo',
        48400,
        '2027-10-15T13:00:00',
        { responsable: { id: 1, nombre: 'Ana Admin' } },
      ),
    ],
    presentada: [
      tarjeta(
        'p-91001020',
        'SER-27/045',
        'Formación en protección de datos para el personal municipal',
        'Mancomunidad de Municipios de Ejemplo',
        18900,
        '2027-10-04T23:59:00',
      ),
      tarjeta(
        'p-91001030',
        '2027/112',
        'Plataforma de datos abiertos del portal de transparencia',
        'Cabildo de Isla Ejemplo',
        72000,
        '2027-09-30T14:00:00',
      ),
    ],
    en_evaluacion: [
      tarjeta(
        'p-91001040',
        'AE-2027-019',
        'Análisis de las encuestas de satisfacción de la ciudadanía',
        'Consorcio de Servicios de Ejemplo',
        35500,
        '2027-09-12T14:00:00',
      ),
    ],
    resuelta: [
      tarjeta(
        'p-91001050',
        'EXP-2027-0088',
        'Formación en analítica de datos con hojas de cálculo',
        'Diputación Provincial de Villaejemplo',
        24000,
        '2027-07-20T14:00:00',
        { resultado: 'ganada' },
      ),
      tarjeta(
        'p-91001060',
        'CTR-2027-0041',
        'Auditoría de accesibilidad de la sede electrónica',
        'Sociedad de Desarrollo de Villaejemplo',
        15800,
        '2027-06-30T14:00:00',
        { resultado: 'perdida' },
      ),
    ],
  };
  const titulos = {
    en_preparacion: 'En preparación',
    lista_para_firmar: 'Lista para firmar',
    presentada: 'Presentada',
    en_evaluacion: 'En evaluación',
    resuelta: 'Resuelta',
  };
  return {
    columnas: Object.entries(columnas).map(([clave, tarjetas]) => ({
      clave,
      titulo: titulos[clave],
      tarjetas: tarjetas.map((t) => ({ ...t, columna: clave })),
    })),
    por_revisar: { total: 0, proximas: [] },
  };
}

// ─── Oportunidades ───────────────────────────────────────────────────────────

const encaje = (valor, tematica, solvencia) => ({
  valor,
  elegible: true,
  componentes: [
    { etiqueta: 'Temática', valor: tematica },
    { etiqueta: 'Solvencia y medios', valor: solvencia },
  ],
});

const oportunidad = (id, expediente, titulo, organo, importe, fecha_limite, opinion, motivo, valor) => ({
  id,
  expediente,
  titulo,
  titulo_corto: titulo,
  organo,
  procedimiento: 'Abierto simplificado',
  estado_placsp: 'En plazo',
  importe,
  fecha_limite,
  fecha_solicitud: null,
  estado: opinion === 'descartar' ? 'descartada' : 'nueva',
  opinion,
  motivo,
  apagada: opinion === 'descartar',
  con_ficha: false,
  lotes_interes: [],
  error_proceso: null,
  creada_en: '2027-10-12T08:00:00.000Z',
  encaje: valor === null ? null : encaje(valor, valor + 6, valor - 8),
});

export const REVISION = {
  total: 7,
  orden: 'plazo',
  cuentas: { por_revisar: 7, sin_cribar: 2, errores: 0, descartadas: 38 },
  opiniones: { interesa: 3, revisar: 3, descartar: 1 },
  items: [
    oportunidad(
      'p-91001101',
      'EXP-2027-0301',
      'Cuadro de mando de calidad del aire',
      'Cabildo de Isla Ejemplo',
      38500,
      '2027-10-18T14:00:00',
      'interesa',
      'Cuadros de mando y datos ambientales: lo que hacemos',
      74,
    ),
    oportunidad(
      'p-91001102',
      '2027/0158',
      'Formación en inteligencia artificial generativa para el personal',
      'Diputación Provincial de Villaejemplo',
      21600,
      '2027-10-20T23:59:00',
      'interesa',
      'Formación en IA con docentes del equipo',
      68,
    ),
    oportunidad(
      'p-91001103',
      'SV-27-044',
      'Gobierno del dato y catálogo de datos corporativo',
      'Consorcio de Servicios de Ejemplo',
      64000,
      '2027-10-22T14:00:00',
      'interesa',
      'Encaja con la ficha de gobierno del dato',
      71,
    ),
    oportunidad(
      'p-91001104',
      'CTR-2027-0212',
      'Análisis estadístico de la demanda de transporte',
      'Ayuntamiento de Villaejemplo',
      29900,
      '2027-10-25T13:00:00',
      'revisar',
      'Pide un estadístico colegiado: confirmar con el equipo',
      55,
    ),
    oportunidad(
      'p-91001105',
      'EXP-2027-0333',
      'Migración del portal de datos abiertos a una plataforma de código abierto',
      'Sociedad de Desarrollo de Villaejemplo',
      86000,
      '2027-10-27T14:00:00',
      'revisar',
      'Mitad desarrollo web: ver si vamos con un colaborador',
      49,
    ),
    oportunidad(
      'p-91001106',
      '2027/0177',
      'Encuesta de clima laboral y su explotación',
      'Mancomunidad de Municipios de Ejemplo',
      12400,
      '2027-10-29T23:59:00',
      'revisar',
      'Trabajo de campo telefónico, no lo hacemos',
      46,
    ),
    oportunidad(
      'p-91001107',
      'OB-27-09',
      'Obras de mejora del alumbrado público',
      'Ayuntamiento de Villaejemplo',
      240000,
      '2027-11-02T14:00:00',
      'descartar',
      'Obra civil: no es de tu sector',
      null,
    ),
  ],
};

// ─── Mercado ─────────────────────────────────────────────────────────────────

export const PANORAMA = {
  desde: '2025-10-13',
  hasta: '2027-10-13',
  n: 46,
  importe: 1968000,
  cpvs: ['72', '48', '73', '79311', '79330'],
  trimestres: [
    { trimestre: '2025-T4', importe: 182000, adjudicaciones: 4 },
    { trimestre: '2026-T1', importe: 146000, adjudicaciones: 3 },
    { trimestre: '2026-T2', importe: 228000, adjudicaciones: 6 },
    { trimestre: '2026-T3', importe: 201000, adjudicaciones: 5 },
    { trimestre: '2026-T4', importe: 312000, adjudicaciones: 7 },
    { trimestre: '2027-T1', importe: 254000, adjudicaciones: 6 },
    { trimestre: '2027-T2', importe: 289000, adjudicaciones: 7 },
    { trimestre: '2027-T3', importe: 268000, adjudicaciones: 6 },
    { trimestre: '2027-T4', importe: 88000, adjudicaciones: 2 },
  ],
  tramos: [
    { tramo: '1', adjudicaciones: 9, baja_mediana: 0.02 },
    { tramo: '2-3', adjudicaciones: 17, baja_mediana: 0.09 },
    { tramo: '4-5', adjudicaciones: 11, baja_mediana: 0.16 },
    { tramo: '6-10', adjudicaciones: 7, baja_mediana: 0.22 },
    { tramo: '11+', adjudicaciones: 2, baja_mediana: 0.27 },
  ],
  organos: [
    { nif: 'P0000002F', nombre: 'Cabildo de Isla Ejemplo', importe: 512000, contratos: 9, cuota: 0.26 },
    { nif: 'P0000004B', nombre: 'Ayuntamiento de Villaejemplo', importe: 389000, contratos: 8, cuota: 0.2 },
    { nif: 'P0040000B', nombre: 'Diputación Provincial de Villaejemplo', importe: 301000, contratos: 6, cuota: 0.15 },
    { nif: 'Q0000006D', nombre: 'Consorcio de Servicios de Ejemplo', importe: 244000, contratos: 5, cuota: 0.12 },
    { nif: 'P0000008H', nombre: 'Mancomunidad de Municipios de Ejemplo', importe: 158000, contratos: 4, cuota: 0.08 },
  ],
  adjudicatarios: [
    { nif: 'B00000011', nombre: 'Sistemas Ejemplo, S.L.', importe: 498000, contratos: 8, cuota: 0.25, nosotros: false },
    {
      nif: 'A00000022',
      nombre: 'Consultoría Muestra, S.A.',
      importe: 402000,
      contratos: 6,
      cuota: 0.2,
      nosotros: false,
    },
    {
      nif: 'B00000033',
      nombre: 'Datos del Sur Ejemplo, S.L.',
      importe: 287000,
      contratos: 7,
      cuota: 0.15,
      nosotros: false,
    },
    { nif: 'B00000044', nombre: 'Formación Modelo, S.L.', importe: 196000, contratos: 5, cuota: 0.1, nosotros: false },
  ],
  nuestra_cuota: {
    nif: 'B00123455',
    nombre: 'Analítica Ejemplo',
    importe: 118000,
    contratos: 4,
    cuota: 0.06,
    nosotros: true,
  },
  nota: 'Adjudicaciones de la PLACSP.',
};

// ─── Ficha › Mercado (índices de la oferta del caso D) ──────────────────────

const comparable = (n, titulo, organo, fecha, ofertas, baja, peso, mismo = false) => ({
  licitacion_id: `p-9100120${n}`,
  lote: '',
  titulo,
  organo,
  mismo_organo: mismo,
  fecha,
  ofertas,
  baja,
  peso,
});

export function indicesCasoD() {
  const base = leerDatos('casoD')[`GET /api/licitaciones/licitaciones/${CASO_D}/indices`].body;
  const comparables = [
    comparable(
      1,
      'Formación en gestión documental para entidades locales',
      'Consorcio Insular de Archivos y Patrimonio de Isla Muestra, S.A.',
      '2027-03-18',
      4,
      0.14,
      1,
      true,
    ),
    comparable(
      2,
      'Campus virtual de formación continua',
      'Diputación Provincial de Villaejemplo',
      '2026-11-05',
      6,
      0.19,
      0.86,
    ),
    comparable(
      3,
      'Jornadas de capacitación en archivos municipales',
      'Cabildo de Isla Ejemplo',
      '2026-09-22',
      3,
      0.08,
      0.81,
    ),
    comparable(
      4,
      'Plataforma de aprendizaje en línea y tutorización',
      'Ayuntamiento de Villaejemplo',
      '2026-05-14',
      5,
      0.17,
      0.72,
    ),
    comparable(
      5,
      'Formación en digitalización de fondos documentales',
      'Mancomunidad de Municipios de Ejemplo',
      '2025-12-02',
      2,
      0.04,
      0.6,
    ),
  ];
  return {
    ...base,
    muestra: { ...base.muestra, descripcion: 'CPV 8053… · 5 años · ÷3–×3 del presupuesto', n: 23, n_organo: 2 },
    confianza: 'media',
    competencia: {
      ofertas: 4,
      rango: { p25: 3, p50: 4, p75: 6 },
      p_un_licitador: 0.09,
      n: 23,
      n_organo: 2,
      mediana_organo: 4,
      ajustado_por_organo: false,
    },
    baja: {
      ...base.baja,
      esperada: 0.13,
      rango: { p25: 0.08, p50: 0.13, p75: 0.18 },
      n: 23,
    },
    licitadores: [
      { nif: 'B00000044', nombre: 'Formación Modelo, S.L.', evidencia: 'ganó 3 parecidas', baja_media: 0.15 },
      {
        nif: 'B00000033',
        nombre: 'Datos del Sur Ejemplo, S.L.',
        evidencia: 'se presentó en 2 actas',
        baja_media: 0.11,
      },
    ],
    concentracion: null,
    resumen: 'Unas 4 ofertas y un 13 % de baja · n = 23, CPV 4 dígitos, confianza media',
    comparables,
  };
}

// ─── Aprendizaje ─────────────────────────────────────────────────────────────

const evidencia = (ubicacion, texto) => ({
  licitacion_id: CASO_E,
  memoria_id: 4,
  documento: 'memoria-presentada.docx',
  ubicacion,
  texto,
});

const leccion = (id, tema, origen, texto, ev) => ({
  id,
  licitacion_id: CASO_E,
  origen,
  alcance: 'general',
  alcance_valor: null,
  tema,
  fuerza: 2,
  estado: 'pendiente',
  texto,
  evidencias: [ev],
  titulo_licitacion: 'Formación en competencias digitales',
  opciones_alcance: {
    organo: 'Cabildo de Isla Ejemplo',
    cpv: '8053',
    tipo_contrato: '2',
    tipo_contrato_nombre: 'Servicios',
  },
  uso: { aplicaciones: 0, ofertas: 0, cumplidas: 0, comprobadas: 0, nota_critico: null },
});

export function aprendizaje() {
  const base = leerDatos('casoE')['GET /api/licitaciones/aprendizaje'].body;
  return {
    ...base,
    por_revisar: {
      lecciones: [
        leccion(
          7,
          'planificacion',
          'edicion',
          'Pon un cronograma con fechas reales, no «semana 1, semana 2».',
          evidencia('cambio 3 · apartado 2 · Planificación', '+ el 3 de marzo se constituye el equipo'),
        ),
        leccion(
          8,
          'calidad',
          'mesa',
          'Cuantifica los indicadores de seguimiento con su meta y quién los mide.',
          evidencia('acta de la mesa · criterio 2', 'no concreta las metas de los indicadores de calidad'),
        ),
      ],
      porques: [],
      actas: [],
    },
  };
}

// ─── Biblioteca ──────────────────────────────────────────────────────────────

const nota = (path, title, tipo, sector, revisada_en, revisar = false) => ({
  path,
  title,
  mtime: revisada_en,
  size: 10,
  tipo,
  tipo_deducido: false,
  sector,
  revisada_en,
  revisar,
});

export const NOTAS = [
  nota(
    'Casos/Medio ambiente/Calidad del aire.md',
    'Cuadros de mando de calidad del aire',
    'caso_exito',
    'Medio ambiente',
    '2027-09-10T10:00:00Z',
  ),
  nota(
    'Metodologías/Formación en IA.md',
    'Metodología de formación en IA generativa',
    'metodologia',
    'Formación',
    '2027-06-01T10:00:00Z',
  ),
  nota(
    'Servicios/Gobierno del dato.md',
    'Gobierno del dato: qué ofrecemos',
    'ficha_servicio',
    null,
    '2026-03-01T10:00:00Z',
    true,
  ),
  nota(
    'Casos/Formación/Campus virtual.md',
    'Campus virtual para la formación continua',
    'caso_exito',
    'Formación',
    '2027-08-21T10:00:00Z',
  ),
  nota(
    'Metodologías/Cuadros de mando.md',
    'Cómo diseñamos un cuadro de mando',
    'metodologia',
    'Datos',
    '2027-05-12T10:00:00Z',
  ),
  nota(
    'Plantillas/Plan de calidad.md',
    'Plan de calidad y seguimiento del servicio',
    'plantilla',
    null,
    '2027-04-02T10:00:00Z',
  ),
  nota(
    'Servicios/Accesibilidad.md',
    'Auditorías de accesibilidad web',
    'ficha_servicio',
    'Administración digital',
    '2027-02-15T10:00:00Z',
  ),
  nota(
    'Ofertas/Formación en datos 2027.md',
    'Formación en analítica de datos (presentada)',
    'oferta_presentada',
    'Formación',
    '2027-07-25T10:00:00Z',
  ),
];

export const USOS = {
  'Metodologías/Formación en IA.md': 6,
  'Casos/Medio ambiente/Calidad del aire.md': 4,
  'Plantillas/Plan de calidad.md': 9,
  'Metodologías/Cuadros de mando.md': 5,
  'Casos/Formación/Campus virtual.md': 3,
  'Servicios/Accesibilidad.md': 2,
  'Ofertas/Formación en datos 2027.md': 1,
};

export const ESTADO_INDEXADOR = {
  running: true,
  error: null,
  status: {
    phase: 'idle',
    notes: 312,
    documents: 1284,
    scanned: 0,
    errors: 0,
    chunks: 10,
    embedded: 10,
    model: 'e5',
    modelError: null,
  },
};

export const BUSQUEDA_BIBLIOTECA = {
  items: [
    {
      kind: 'note',
      path: 'Casos/Medio ambiente/Calidad del aire.md',
      title: 'Cuadros de mando de calidad del aire',
      snippet:
        'Cuadro de mando con los datos horarios de las estaciones de medición, alertas por umbral y un informe mensual automático para el servicio de medio ambiente.',
      matched_in: ['title', 'semantic'],
    },
    {
      kind: 'note',
      path: 'Metodologías/Cuadros de mando.md',
      title: 'Cómo diseñamos un cuadro de mando',
      snippet:
        'Del inventario de indicadores al prototipo: entrevistas, modelo de datos, validación con quien lo usa y traspaso al equipo del cliente.',
      matched_in: ['body', 'semantic'],
    },
    {
      kind: 'document',
      path: 'Licitaciones/EXP-2027-0301/Memoria técnica.pdf',
      title: 'Memoria técnica · calidad del aire',
      snippet:
        'Apartado 3. Solución propuesta: integración de las estaciones, depuración de series y visualización por zonas.',
      matched_in: ['semantic'],
    },
    {
      kind: 'note',
      path: 'Servicios/Gobierno del dato.md',
      title: 'Gobierno del dato: qué ofrecemos',
      snippet:
        'Catálogo de datos, responsables por dominio y calidad medida: la base para que los cuadros de mando digan lo mismo.',
      matched_in: ['semantic'],
    },
  ],
};

// ─── Equipo ──────────────────────────────────────────────────────────────────

const persona = (id, nombre, tipo, rol, extra = {}) => ({
  id,
  nombre,
  tipo,
  rol,
  titulaciones: [],
  certificaciones: [],
  anios_experiencia: 5,
  sectores: [],
  cpv: [],
  tecnologias: [],
  idiomas: [],
  linkedin: null,
  tarifa_hora: null,
  cv_ruta: `Colaboradores/cv-${id}.pdf`,
  notas: '',
  activo: true,
  docencia: [],
  creada_en: '2026-09-01T10:00:00Z',
  actualizada_en: '2027-09-01T10:00:00Z',
  disponibilidad: { estado: 'disponible', motivo: '', hasta: null },
  cv: { leido_en: '2027-09-01T10:00:00Z', antiguo: false, nuevo: null },
  ...extra,
});

export const PERSONA_A = persona(1, 'Persona A', 'interno', 'Coordinadora de formación', {
  titulaciones: ['Grado en Pedagogía', 'Máster en Tecnología Educativa'],
  certificaciones: ['PMP'],
  anios_experiencia: 9,
  tecnologias: ['Moodle', 'Power BI'],
  idiomas: ['español', 'inglés'],
  docencia: [
    { materia: 'competencias digitales', horas: 320, desde: 2023, hasta: 2027, evidencia: 'CV, pág. 2' },
    {
      materia: 'análisis de datos con hojas de cálculo',
      horas: 180,
      desde: 2025,
      hasta: 2027,
      evidencia: 'CV, pág. 3',
    },
  ],
  disponibilidad: { estado: 'parcial', motivo: '2 ofertas en curso', hasta: null },
});

export const EQUIPO = [
  PERSONA_A,
  persona(2, 'Persona B', 'externo', 'Formador de IA', {
    cv: { leido_en: '2025-05-01T10:00:00Z', antiguo: true, nuevo: 7 },
    docencia: [{ materia: 'inteligencia artificial', horas: 210, desde: 2024, hasta: 2027, evidencia: 'CV, pág. 1' }],
  }),
  persona(3, 'Persona C', 'interno', 'Analista de datos', {
    disponibilidad: { estado: 'no_disponible', motivo: 'en un contrato hasta diciembre', hasta: '2027-12-31' },
  }),
  persona(4, 'Persona D', 'interno', 'Desarrolladora web'),
];

export const FICHA_PERSONA_A = {
  ...PERSONA_A,
  ofertas: { ganadas: 3, resueltas: 5 },
  asignaciones: [
    {
      persona_id: 1,
      dominio: 'licitaciones',
      recurso: CASO_D,
      expediente: 'CP-0417/2027',
      titulo: 'Programa de capacitación en conservación y gestión documental',
      rol: 'coordinación',
      estado: 'en_preparacion',
      hasta: null,
    },
    {
      persona_id: 1,
      dominio: 'licitaciones',
      recurso: CASO_E,
      expediente: 'CAP-27/12',
      titulo: 'Formación virtual en competencias administrativas',
      rol: 'docencia · lote 2',
      estado: 'en_preparacion',
      hasta: null,
    },
    {
      persona_id: 1,
      dominio: 'licitaciones',
      recurso: 'p-91001050',
      expediente: 'EXP-2027-0088',
      titulo: 'Formación en analítica de datos con hojas de cálculo',
      rol: 'coordinación',
      estado: 'ganada',
      hasta: '2027-12-20',
    },
  ],
};

// ─── Presentadas ─────────────────────────────────────────────────────────────

const presentada = (id, titulo, organo, presentada_en, resultado, importe_ofertado, baja_ofertada, puntos_total) => ({
  id,
  licitacion_id: `p-9100130${id}`,
  titulo,
  lote: '',
  organo,
  presentada_en,
  resultado,
  importe_ofertado,
  baja_ofertada,
  puntos_total,
  presupuesto: Math.round(importe_ofertado / (1 - baja_ofertada)),
});

const grupo = (clave, nombre, presentadas, ganadas, decididas) => ({
  clave,
  nombre,
  presentadas,
  ganadas,
  decididas,
  tasa: decididas ? ganadas / decididas : null,
});

export const PRESENTADAS = {
  items: [
    presentada(
      1,
      'Formación en protección de datos para el personal municipal',
      'Mancomunidad de Municipios de Ejemplo',
      '2027-10-04',
      'pendiente',
      16800,
      0.11,
      null,
    ),
    presentada(
      2,
      'Plataforma de datos abiertos del portal de transparencia',
      'Cabildo de Isla Ejemplo',
      '2027-09-30',
      'pendiente',
      63400,
      0.12,
      null,
    ),
    presentada(
      3,
      'Formación en analítica de datos con hojas de cálculo',
      'Diputación Provincial de Villaejemplo',
      '2027-07-20',
      'ganada',
      21100,
      0.12,
      86.5,
    ),
    presentada(
      4,
      'Auditoría de accesibilidad de la sede electrónica',
      'Sociedad de Desarrollo de Villaejemplo',
      '2027-06-30',
      'perdida',
      14200,
      0.1,
      71,
    ),
    presentada(
      5,
      'Cuadro de mando de servicios sociales',
      'Ayuntamiento de Villaejemplo',
      '2027-05-12',
      'ganada',
      39800,
      0.09,
      88,
    ),
    presentada(
      6,
      'Curso de iniciación a la inteligencia artificial',
      'Consorcio de Servicios de Ejemplo',
      '2027-03-08',
      'ganada',
      9800,
      0.14,
      91,
    ),
    presentada(
      7,
      'Explotación estadística del padrón',
      'Ayuntamiento de Villaejemplo',
      '2027-02-02',
      'desierta',
      22600,
      0.06,
      null,
    ),
  ],
  estadisticas: {
    total: 7,
    por_resultado: { pendiente: 2, ganada: 3, perdida: 1, desierta: 1 },
    tasa_exito: 0.75,
    importe_ganado: 70700,
    ganadas: { total: 3, registradas: 3, de_actas: 0, lista: [] },
    puntuaciones: { media_total: 84.1, media_ganador: 85.3, n: 4 },
    por_sector: [grupo('80', 'Formación', 4, 2, 3), grupo('72', 'Servicios TI', 3, 1, 2)],
    por_banda: [grupo('<20k', 'Menos de 20.000 €', 3, 1, 2), grupo('20k-100k', 'De 20.000 a 100.000 €', 4, 2, 3)],
    por_organo: [
      grupo('P0000004B', 'Ayuntamiento de Villaejemplo', 2, 1, 2),
      grupo('P0040000B', 'Diputación Provincial de Villaejemplo', 1, 1, 1),
    ],
    bajas: {
      mediana_ofertada_ganadas: 0.12,
      mediana_ofertada_perdidas: 0.08,
      mediana_ganadora_perdidas: 0.15,
      mediana_diferencia_perdidas: 0.07,
      pares: [],
    },
    nota: 'Lo presentado desde Hermes o registrado a mano; el resultado lo pone también la PLACSP al adjudicar.',
  },
};

// ─── Ajustes › Empresa ───────────────────────────────────────────────────────

// La empresa ficticia de apps/server/tests/fixtures/empresaEjemplo.ts, con un domicilio inventado.
export function empresaFicticia() {
  const base = leerDatos('casoE')['GET /api/plataforma/empresa'].body;
  return {
    ...base,
    perfil: {
      ...base.perfil,
      nif: 'B00123455',
      nombre: 'ANALÍTICA EJEMPLO, S.L.',
      nombre_comercial: 'Analítica Ejemplo',
      direccion: {
        calle: 'Calle del Ejemplo, 1',
        codigo_postal: '00000',
        municipio: 'Villaejemplo',
        provincia: 'Provincia Ejemplo',
      },
      domicilio: 'Calle del Ejemplo, 1, 00000 Villaejemplo',
      contacto: { email: 'licitaciones@ejemplo.es', telefono: null },
      notas: 'Micropyme de datos y formación. Sin ISO ni ENS. Concurre en solitario.',
      fecha_constitucion: '2023-03-14',
    },
  };
}

// ─── Actividad de Hermes ─────────────────────────────────────────────────────

export const SESION = {
  id: '20271013_201502_c3d4e5',
  source: 'api_server',
  profile: 'licitaciones',
  title: 'Ficha de CP-0417/2027',
  message_count: 24,
  last_active: Date.parse('2027-10-13T20:31:40Z'),
};

// ─── Memoria técnica con la evaluación del crítico (caso C) ─────────────────

const CRITERIO = (apartado, criterio, peso, puntuacion, tramo, justificacion) => ({
  apartado,
  criterio,
  tipo: 'juicio',
  peso,
  puntuacion,
  tramo,
  justificacion,
  referencia: `apartado ${apartado}`,
});

const EVALUACION = {
  id: 21,
  documento: 'memoria-v3.docx',
  agente: 'crítico ciego',
  creada_en: '2027-10-13T10:41:00.000Z',
  estado: 'pendiente',
  datos: {
    puntuacion_total: 31,
    puntuacion_maxima: 40,
    resumen:
      'Plan y calendario concretos, con responsables y plazos medibles. El enfoque didáctico se apoya en el campus, pero la transferencia al puesto se queda en intenciones en dos de sus medidas.',
    criterios: [
      CRITERIO(
        1,
        'Plan de impartición y calendario',
        10,
        9,
        4,
        'Fechas, responsables y plazos de respuesta para cada acción; cubre las interrupciones.',
      ),
      CRITERIO(
        2,
        'Enfoque didáctico, recursos y entorno virtual',
        15,
        12,
        3,
        'Recursos y rúbricas por curso; falta cómo se adapta a quien va más lento.',
      ),
      CRITERIO(
        3,
        'Transferencia del aprendizaje al puesto',
        15,
        10,
        3,
        'La práctica en el puesto y el seguimiento a los tres meses no dicen quién lo mide ni con qué.',
      ),
    ],
    eliminar: [],
    modificar: [
      { referencia: 'apartado 3', que: 'Di quién hace el seguimiento a los tres meses y con qué cuestionario.' },
    ],
    reforzar: [
      { referencia: 'apartado 2', que: 'Añade la atención a quien no avanza: aviso, tutoría y recuperación.' },
    ],
    genericos: [
      {
        referencia: 'apartado 3',
        texto: 'Se fomentará la aplicación práctica de lo aprendido.',
        por_que: 'Sin quién, cuándo ni medida: la mesa no lo puntúa.',
      },
    ],
    comparables: [],
    riesgos: [],
  },
};

const RESUMEN_EVALUACION = { id: EVALUACION.id, puntuacion_total: 31, puntuacion_maxima: 40, genericos: 1 };

/** Las respuestas del caso C con la versión 3 de la memoria ya evaluada por el crítico. */
export function memoriaEvaluada() {
  const datos = leerDatos('casoC');
  const ruta = `GET /api/licitaciones/licitaciones/${CASO_C}`;
  const conEvaluacion = (memorias) =>
    memorias.map((m) => (m.version === 3 ? { ...m, evaluacion: RESUMEN_EVALUACION } : m));
  const oferta = datos[`${ruta}/oferta`].body;
  const memoria = datos[`${ruta}/oferta/memoria`].body;
  const propuesta = datos[`${ruta}/propuesta`].body;
  return {
    oferta: { ...oferta, memorias: conEvaluacion(oferta.memorias) },
    memoria: { ...memoria, memorias: conEvaluacion(memoria.memorias) },
    propuesta: { ...propuesta, evaluaciones: [EVALUACION] },
  };
}

/** La pastilla de Hermes con la ficha del caso D en marcha. */
export const COLA_EN_MARCHA = {
  dominios: [
    {
      dominio: 'licitaciones',
      en_marcha: [{ tipo: 'licitaciones.ficha', nombre: 'Ficha', recurso: CASO_D, titulo: 'CP-0417/2027' }],
      en_cola: 2,
      fallos_24h: 0,
      zombis: 0,
      en_pausa: false,
      motivo_pausa: null,
    },
  ],
};

/** El resumen semanal de una semana normal, con la forma de la plantilla del servidor (correoPlantillas). */
export const PLANTILLA_RESUMEN = {
  asunto: 'Hermes: tu semana (2027, semana 41)',
  titulo: 'Qué hacer esta semana',
  intro: 'Lo que cierra en los próximos días, lo nuevo que puede encajar y lo que ha pasado en la última semana.',
  bloques: [
    {
      titulo: 'Cierran en los próximos 7 días',
      filas: [
        {
          texto: 'Formación virtual en competencias administrativas',
          detalle: 'cierra jue 14 oct, 08:00',
          enlace: '#/licitacion/p-91000080',
        },
        {
          texto: 'Cuadro de mando de indicadores de movilidad urbana',
          detalle: 'cierra vie 15 oct, 13:00',
          enlace: '#/licitacion/p-91001010',
        },
      ],
    },
    {
      titulo: 'Las 5 nuevas que cierran antes',
      filas: REVISION.items
        .filter((x) => x.opinion !== 'descartar')
        .slice(0, 5)
        .map((x) => ({
          texto: x.titulo_corto,
          detalle: `encaje ${x.encaje.valor} · cierra ${x.fecha_limite.slice(8, 10)} oct`,
          enlace: `#/licitacion/${x.id}`,
        })),
    },
    {
      titulo: 'Novedades de la semana',
      filas: [
        {
          texto: 'Ganada: Formación en analítica de datos con hojas de cálculo',
          detalle: 'Sube el acta para aprender de ella.',
        },
        {
          texto: 'Cabildo de Isla Ejemplo publicó: Cuadro de mando de calidad del aire',
          enlace: '#/licitacion/p-91001101',
        },
      ],
    },
    {
      titulo: 'Lecciones por revisar',
      filas: [{ texto: '2 lecciones esperan tu revisión', enlace: '#/aprendizaje' }],
    },
  ],
  boton: { texto: 'Abrir Hermes', enlace: '#/pipeline' },
};

/** Lo que hace Hermes en la sesión: [herramienta, argumentos, resultado o null si sigue en marcha]. */
export const LLAMADAS_HERMES = [
  ['skill_view', { name: 'licitaciones' }, 'Skill licitaciones cargada'],
  ['read_file', { path: 'Licitaciones/Radar/CP-0417-2027/PCAP.pdf' }, '52 páginas'],
  ['read_file', { path: 'Licitaciones/Radar/CP-0417-2027/PCT.pdf' }, '31 páginas'],
  ['terminal', { command: 'pdftotext -layout PCT.pdf - | grep -n -i "solvencia"' }, '3 coincidencias'],
  ['mcp_plataforma_biblioteca_buscar', { query: 'formación en gestión documental para archivos' }, '5 notas'],
  ['web_search', { query: 'Chamilo 1.11 requisitos de servidor' }, '8 resultados'],
  ['memory', { action: 'add', target: 'memory' }, 'Guardado'],
  ['mcp_plataforma_biblioteca_buscar', { query: 'campus virtual de formación continua' }, null],
];
