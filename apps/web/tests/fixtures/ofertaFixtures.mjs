// Datos de ejemplo que comparten las pruebas de la oferta (guion, decisiones, memorias, anexos).

export const ARCHIVO_1 = {
  nombre: 'Archivo electrónico nº 1',
  contenido: 'Documentación administrativa y técnica',
  prohibiciones: ['No podrá incluir la oferta económica'],
  firma: 'electrónica',
  documentos: [
    {
      tipo: 'deuc',
      nombre: 'DEUC',
      obligatorio: true,
      produce: 'persona',
      origen: { modelo: 'Anexo II', documento: 'PCAP', pagina: 41 },
    },
    { tipo: 'memoria', nombre: 'Memoria técnica', obligatorio: true, produce: 'hermes' },
  ],
  documento: 'PCAP',
  pagina: 41,
};

export const ARCHIVO_2 = {
  nombre: 'Archivo electrónico nº 2',
  contenido: 'Oferta económica y criterios automáticos',
  prohibiciones: [],
  documentos: [{ tipo: 'oferta_economica', nombre: 'Anexo VII', obligatorio: true, produce: 'persona' }],
  documento: 'PCAP',
  pagina: 44,
};

export const APARTADOS = [
  {
    titulo: 'Organización y metodología',
    puntos: 8,
    se_valorara: ['modelo organizativo'],
    escala: [
      { puntos: 0, descripcion: 'Genérico' },
      { puntos: 8, descripcion: 'Completo' },
    ],
    documento: 'PCAP',
    pagina: 31,
  },
  { titulo: 'Incidencias y control', puntos: 7, se_valorara: [], escala: [], documento: 'PCAP', pagina: 32 },
  { titulo: 'Asesoramiento', puntos: 6, se_valorara: [], escala: [], documento: 'PCAP', pagina: 33 },
  { titulo: 'Mejoras vinculadas', puntos: 4, se_valorara: [], escala: [], documento: 'PCAP', pagina: 34 },
];

export const GUION = {
  archivos: [ARCHIVO_1, ARCHIVO_2],
  memoria: {
    archivo: 'Archivo electrónico nº 1',
    titulo_documento: 'Memoria técnica',
    limite_paginas: 25,
    formato: { fuente: 'Arial', tamano_letra: '11', interlineado: 'sencillo' },
    apartados: APARTADOS,
    advertencias: ['No se valorarán manifestaciones genéricas'],
    documento: 'PCAP',
    pagina: 31,
  },
  automaticos: [
    {
      criterio: 'ISO 14001',
      puntos: 10,
      como_se_acredita: 'Certificado',
      casilla_en: 'Anexo VII',
      archivo: 'Archivo electrónico nº 2',
      marcas: ['ISO 14001'],
      documento: 'PCAP',
      pagina: 44,
    },
    {
      criterio: 'Discapacidad ≥ 10 %',
      puntos: 15,
      como_se_acredita: 'Declaración',
      casilla_en: 'Anexo VII',
      archivo: 'Archivo electrónico nº 2',
      marcas: ['discapacidad'],
      documento: 'PCAP',
      pagina: 44,
    },
  ],
  oferta_economica: {
    formula: 'P = 40 × (Om / O)',
    presupuesto_base: 100000,
    impuesto_aparte: 'IGIC',
    umbral_anormalidad: null,
    modelo: 'Anexo VII',
    archivo: 'Archivo electrónico nº 2',
    documento: 'PCAP',
    pagina: 44,
  },
  plazo: { fecha_limite: '2026-10-13T14:00:00', canal: 'PLACSP' },
};

export const DECISIONES = {
  lotes: [],
  equipo: [{ persona_id: 3, rol_en_la_oferta: 'Jefa de proyecto', dedicacion: '50 %' }],
  automaticos: [
    { criterio: 'ISO 14001', lote: null, nos_acogemos: false, tramo: null },
    {
      criterio: 'Discapacidad ≥ 10 %',
      lote: null,
      nos_acogemos: true,
      tramo: 'Discapacidad ≥ 10 %',
      nota: 'Plantilla actual',
    },
  ],
  herramientas: ['Power BI', 'Python'],
  enfoque: 'Trato directo con quien hace el trabajo.',
  ofertas: [{ lote: null, pendiente: false, importe: 87500, unitarios: [] }],
};

export const OFERTA = {
  guion: { id: 1, version: 1, ficha_id: 9, creado_en: '2026-10-05T10:00:00Z', avisos: [], datos: GUION },
  guion_en_curso: null,
  guion_desfasado: false,
  decisiones: { guion_id: 1, actualizada_en: '2026-10-05T11:00:00Z', datos: DECISIONES },
  decisiones_problemas: [],
  guion_cambiado: false,
  memorias: [],
  ficha_aprobada: true,
  salidas_configurado: true,
  pliegos_listos: true,
};
