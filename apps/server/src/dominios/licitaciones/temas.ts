// Los temas en que se lee un pliego para la ficha y para redactar la memoria. Puro: sin base de datos.

// Es la fuente única de qué buscar en los pliegos de una licitación (consultas y marcas), qué tipo de requisito
// de la ficha cubre cada tema y qué temas debe cubrir siempre la ficha (diciendo «el pliego no lo pide» si no
// aparece).
// Los tipos de requisito de la ficha (ficha.ts los valida con este mismo array).
export const TIPOS_REQUISITO = [
  'clasificacion',
  'solvencia_economica',
  'solvencia_tecnica',
  'experiencia',
  'certificacion',
  'medios_personales',
  'medios_materiales',
  'habilitacion',
  'idioma',
  'seguro',
  'subcontratacion',
  'ute',
  'visita',
  'lugar_ejecucion',
  'otro',
] as const;
type TipoRequisito = (typeof TIPOS_REQUISITO)[number];

// Cómo está la empresa frente a un requisito de la ficha. no_aplica: el pliego lo pide, pero no
// le afecta (p. ej. lo que solo vale para las UTE).
export const CUMPLE = ['si', 'no', 'dudoso', 'no_aplica'] as const;
export type Cumple = (typeof CUMPLE)[number];

// Lo que el redactor de la memoria necesita del objeto del servicio: qué se presta, a quién,
// cómo y con qué nivel. No son requisitos: la ficha no los lee ni los cubre.
export const TEMAS_MEMORIA = [
  'objeto_alcance',
  'prestaciones',
  'niveles_servicio',
  'metodologia_entregables',
  'formacion_transferencia',
  'destinatarios_usuarios',
] as const;

export const TEMAS = [
  'solvencia_economica',
  'solvencia_tecnica',
  'clasificacion',
  'medios_personales',
  'medios_materiales',
  'certificaciones',
  'habilitacion',
  'subcontratacion',
  'idioma',
  'seguro',
  'visita_obligatoria',
  'lugar_ejecucion',
  'nueva_creacion',
  'ute',
  'criterios_adjudicacion',
  'sobres_documentacion',
  'garantias',
  'penalizaciones',
  'plazos_hitos',
  'presentacion_lotes',
  'confidencialidad',
  ...TEMAS_MEMORIA,
] as const;
export type Tema = (typeof TEMAS)[number];

export type DefinicionTema = {
  etiqueta: string;
  // Frases para la búsqueda por palabras y por significado.
  consultas: string[];
  // Expresiones sobre el texto en minúsculas y sin tildes: cada una que casa suma.
  marcas: RegExp[];
  // Qué tipos de requisito de la ficha lo cubren (vacío: va en otra sección de la ficha).
  tipos: TipoRequisito[];
  // La ficha debe decir siempre algo de él: en sus requisitos o «el pliego no lo pide».
  checklist: boolean;
};

export const DEFINICION: Record<Tema, DefinicionTema> = {
  solvencia_economica: {
    etiqueta: 'Solvencia económica y financiera',
    consultas: [
      'solvencia económica y financiera volumen anual de negocios',
      'cifra anual de negocio en el mejor ejercicio de los tres últimos',
    ],
    marcas: [
      /solvencia economica/,
      /volumen anual de negocio/,
      /cifra (anual )?de negocio/,
      /patrimonio neto/,
      /fondos propios/,
      /articulo 87|art\. ?87/,
    ],
    tipos: ['solvencia_economica'],
    checklist: true,
  },
  solvencia_tecnica: {
    etiqueta: 'Solvencia técnica y experiencia',
    consultas: [
      'solvencia técnica o profesional relación de los principales servicios realizados',
      'trabajos de igual o similar naturaleza importe anual acumulado',
    ],
    marcas: [
      /solvencia tecnica/,
      /igual o similar naturaleza/,
      /principales (servicios|trabajos|suministros)/,
      /buena ejecucion/,
      /importe anual acumulado/,
      /articulo 90|art\. ?90/,
    ],
    tipos: ['solvencia_tecnica', 'experiencia'],
    checklist: true,
  },
  clasificacion: {
    etiqueta: 'Clasificación empresarial',
    consultas: ['clasificación del contratista grupo subgrupo categoría'],
    marcas: [
      /clasificacion (empresarial|del (contratista|empresario)|exigida|requerida)/,
      /grupo [a-z]\W{1,3}subgrupo/,
      /\bsubgrupo \d/,
    ],
    tipos: ['clasificacion'],
    checklist: true,
  },
  medios_personales: {
    etiqueta: 'Medios personales (equipo)',
    consultas: [
      'compromiso de adscripción de medios personales equipo mínimo',
      'perfiles profesionales titulación y años de experiencia del equipo',
    ],
    marcas: [
      /adscripcion de medios/,
      /medios personales/,
      /equipo (minimo|de trabajo|tecnico)/,
      /perfil(es)? profesional/,
      /jefe de proyecto|coordinador/,
      /anos de experiencia/,
      /\btitulacion\b/,
    ],
    tipos: ['medios_personales'],
    checklist: true,
  },
  medios_materiales: {
    etiqueta: 'Medios materiales y técnicos',
    consultas: [
      'medios materiales y técnicos que debe aportar el adjudicatario',
      'licencias plataforma herramienta software infraestructura',
    ],
    marcas: [
      /medios materiales/,
      /medios tecnicos/,
      /\blicencias?\b/,
      /equipos informaticos/,
      /infraestructura (tecnologica|necesaria|propia)/,
    ],
    tipos: ['medios_materiales'],
    checklist: true,
  },
  certificaciones: {
    etiqueta: 'Certificaciones (ENS, ISO…)',
    consultas: [
      'certificación Esquema Nacional de Seguridad categoría',
      'certificado ISO 9001 27001 sistema de gestión de calidad',
    ],
    marcas: [
      /esquema nacional de seguridad|\bens\b/,
      /\biso(\/iec)? ?\d{4,5}/,
      /\bcmmi\b/,
      /gestion (de la )?calidad/,
      /gestion medioambiental|medio ambiente/,
      /\bune[- ]en\b/,
    ],
    tipos: ['certificacion'],
    checklist: true,
  },
  habilitacion: {
    etiqueta: 'Habilitación o registro',
    consultas: ['habilitación empresarial o profesional exigida inscripción en registro'],
    marcas: [
      /habilitacion (empresarial|profesional)/,
      /inscripcion en el registro/,
      /autorizacion administrativa/,
      /colegiad/,
    ],
    tipos: ['habilitacion'],
    checklist: true,
  },
  subcontratacion: {
    etiqueta: 'Subcontratación',
    consultas: ['subcontratación porcentaje máximo prestaciones que no se pueden subcontratar'],
    marcas: [/subcontrata/],
    tipos: ['subcontratacion'],
    checklist: true,
  },
  idioma: {
    etiqueta: 'Idioma',
    consultas: ['idioma lengua de prestación del servicio y de la documentación'],
    marcas: [
      /\b(euskera|catalan|valenciano|gallego|ingles|frances|aleman)\b/,
      /lengua (oficial|castellana|cooficial|vehicular)/,
      /\bidiomas?\b/,
      /\bnivel [abc][12]\b/,
    ],
    tipos: ['idioma'],
    checklist: true,
  },
  seguro: {
    etiqueta: 'Seguro de responsabilidad civil',
    consultas: ['seguro de responsabilidad civil o de indemnización por riesgos profesionales'],
    marcas: [/seguro de (responsabilidad|indemnizacion)/, /\bpoliza\b/, /riesgos profesionales/],
    tipos: ['seguro'],
    checklist: true,
  },
  visita_obligatoria: {
    etiqueta: 'Visita obligatoria',
    consultas: ['visita obligatoria a las instalaciones antes de presentar la oferta'],
    marcas: [/visita .{0,40}(obligatori|previa|instalaciones)/, /reconocimiento de las instalaciones/],
    tipos: ['visita'],
    checklist: true,
  },
  lugar_ejecucion: {
    etiqueta: 'Lugar y presencialidad',
    consultas: [
      'lugar de prestación del servicio presencial en las dependencias del órgano',
      'condiciones especiales de ejecución horario de atención',
    ],
    marcas: [
      /lugar de (ejecucion|prestacion)/,
      /presencial/,
      /en las (dependencias|instalaciones|oficinas) d/,
      /condiciones especiales de ejecucion/,
      /24 ?x ?7|24 horas/,
      /teletrabajo|en remoto|a distancia/,
    ],
    tipos: ['lugar_ejecucion'],
    checklist: true,
  },
  nueva_creacion: {
    etiqueta: 'Empresas de nueva creación',
    consultas: ['empresas de nueva creación antigüedad inferior a cinco años solvencia técnica'],
    marcas: [
      /nueva creacion/,
      /90\.4|apartado 4 del articulo 90/,
      /antiguedad (inferior|menor) a (cinco|5)/,
      /menos de (cinco|5) anos/,
    ],
    tipos: ['solvencia_tecnica', 'experiencia'],
    checklist: false,
  },
  ute: {
    etiqueta: 'Uniones temporales (UTE)',
    consultas: ['unión temporal de empresas compromiso de constitución'],
    marcas: [/union temporal|\bute\b/],
    tipos: ['ute'],
    checklist: false,
  },
  criterios_adjudicacion: {
    etiqueta: 'Criterios de adjudicación',
    consultas: [
      'criterios de adjudicación ponderación puntuación',
      'criterios evaluables mediante juicio de valor y mediante fórmulas',
    ],
    marcas: [
      /criterios? de adjudicacion/,
      /juicio de valor/,
      /\bformula/,
      /\bpuntos\b|puntuacion/,
      /oferta economica/,
      /anormalmente baja|desproporcionad/,
    ],
    tipos: [],
    checklist: false,
  },
  sobres_documentacion: {
    etiqueta: 'Sobres y documentación',
    consultas: ['contenido de los sobres o archivos electrónicos documentación a presentar'],
    marcas: [
      /\bsobre (n\.?º? ?|numero )?[123abc]\b/,
      /archivo electronico/,
      /\bdeuc\b/,
      /declaracion responsable/,
      /documentacion (administrativa|a presentar|acreditativa)/,
    ],
    tipos: [],
    checklist: false,
  },
  garantias: {
    etiqueta: 'Garantías',
    consultas: ['garantía definitiva provisional porcentaje del precio de adjudicación'],
    marcas: [/garantia (definitiva|provisional|complementaria)/],
    tipos: [],
    checklist: false,
  },
  penalizaciones: {
    etiqueta: 'Penalidades',
    consultas: ['penalidades por demora o cumplimiento defectuoso'],
    marcas: [/penalidad/, /penalizacion/, /cumplimiento defectuoso/, /\bdemora\b/],
    tipos: [],
    checklist: false,
  },
  plazos_hitos: {
    etiqueta: 'Plazos e hitos',
    consultas: ['plazo de ejecución duración del contrato prórrogas', 'hitos de entrega cronograma'],
    marcas: [/plazo de (ejecucion|entrega|duracion)/, /duracion del contrato/, /prorroga/, /\bhitos?\b/, /cronograma/],
    tipos: [],
    checklist: false,
  },
  presentacion_lotes: {
    etiqueta: 'Presentación por lotes',
    consultas: ['número máximo de lotes a los que se puede presentar oferta'],
    marcas: [
      /lotes? a los que (se )?(podra|puede|pueden)/,
      /numero maximo de lotes/,
      /(uno|varios|todos) (de )?los lotes/,
      /a uno o (a )?varios lotes/,
    ],
    tipos: [],
    checklist: false,
  },
  confidencialidad: {
    etiqueta: 'Confidencialidad y datos',
    consultas: ['confidencialidad protección de datos encargado del tratamiento'],
    marcas: [/confidencial/, /proteccion de datos|\brgpd\b/, /encargad[oa] del tratamiento/],
    tipos: [],
    checklist: false,
  },
  objeto_alcance: {
    etiqueta: 'Objeto y alcance',
    consultas: ['objeto del contrato y alcance de los trabajos', 'necesidades a satisfacer descripción del servicio'],
    marcas: [
      /objeto del contrato/,
      /\balcance (tecnico|del (contrato|servicio|proyecto)|de los trabajos)/,
      /necesidades? a satisfacer/,
      /descripcion (del servicio|de los trabajos)/,
      /\bambito (del contrato|de aplicacion)/,
    ],
    tipos: [],
    checklist: false,
  },
  prestaciones: {
    etiqueta: 'Prestaciones y tareas',
    consultas: [
      'prestaciones que comprende el servicio y tareas del adjudicatario',
      'trabajos incluidos funciones y actividades a desarrollar',
    ],
    marcas: [
      /prestaciones (objeto|del (contrato|servicio)|a realizar|incluidas|que comprende)/,
      /tareas? (a realizar|que (debera|realizara))/,
      /trabajos (a realizar|incluidos|comprendidos)/,
      /funciones del (contratista|adjudicatario)/,
      /actividades (a desarrollar|incluidas)/,
      /el (adjudicatario|contratista) (debera|realizara|prestara)/,
    ],
    tipos: [],
    checklist: false,
  },
  niveles_servicio: {
    etiqueta: 'Niveles de servicio',
    consultas: [
      'acuerdo de nivel de servicio tiempos de respuesta y de resolución',
      'indicadores de calidad y disponibilidad del servicio',
    ],
    marcas: [
      /nivel(es)? de servicio/,
      /\bans\b|\bsla\b/,
      /tiempos? (maximo )?de (respuesta|resolucion|atencion)/,
      /indicadores? de (calidad|servicio|rendimiento)/,
      /disponibilidad (del servicio|minima)/,
    ],
    tipos: [],
    checklist: false,
  },
  metodologia_entregables: {
    etiqueta: 'Metodología y entregables',
    consultas: [
      'metodología de trabajo fases y plan del proyecto',
      'entregables informes de seguimiento documentación a entregar',
    ],
    marcas: [
      /metodologia/,
      /\bentregables?\b/,
      /plan de (trabajo|proyecto)/,
      /\bfases? (del proyecto|de (ejecucion|trabajo))/,
      /informes? (de seguimiento|mensual|final)/,
      /documentacion a entregar/,
    ],
    tipos: [],
    checklist: false,
  },
  formacion_transferencia: {
    etiqueta: 'Formación y transferencia',
    consultas: [
      'formación al personal y a los usuarios transferencia de conocimiento',
      'manuales documentación de usuario y traspaso del servicio',
    ],
    marcas: [
      /\bla formacion\b/,
      /formacion (al|del|de los|de las|a los|a las|para (el|los|las)) (personal|usuari|alumn|participantes|equipo)/,
      /transferencia (de conocimiento|tecnologica)/,
      /traspaso (del servicio|de conocimiento)/,
      /\bmanuales?\b/,
      /accion(es)? formativ/,
      /teleformacion|horas lectivas/,
    ],
    tipos: [],
    checklist: false,
  },
  destinatarios_usuarios: {
    etiqueta: 'Destinatarios y usuarios',
    consultas: [
      'destinatarios del servicio personas usuarias y perfil del alumnado',
      'número de usuarios o participantes y colectivo al que se dirige',
    ],
    marcas: [
      /destinatari[oa]s/,
      /personas usuarias|usuarios finales|\busuari[oa]s\b/,
      /\balumn(o|a|ado)s?\b/,
      /beneficiari[oa]s/,
      /\bcolectivos?\b/,
      /numero de (usuarios|alumnos|participantes|personas)/,
    ],
    tipos: [],
    checklist: false,
  },
};

export const TEMAS_CHECKLIST: Tema[] = TEMAS.filter((t) => DEFINICION[t].checklist);
// Los que lee la ficha cuando no se piden temas concretos (los de la memoria sobran ahí).
export const TEMAS_FICHA: Tema[] = TEMAS.filter((t) => !(TEMAS_MEMORIA as readonly string[]).includes(t));

/** Minúsculas y sin tildes, como las marcas de los temas. */
export function textoComparable(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Cuántas marcas distintas del tema casan en un texto ya comparable. */
export function marcasDe(tema: Tema, comparable: string): number {
  return DEFINICION[tema].marcas.reduce((n, re) => n + (re.test(comparable) ? 1 : 0), 0);
}

// Los requisitos estructurados de la PLACSP por su etiqueta (evaluador.ts): a qué tema van.
const TEMA_POR_ETIQUETA: Record<string, Tema> = {
  'Volumen anual de negocio': 'solvencia_economica',
  'Informe de entidades financieras': 'solvencia_economica',
  'Fondos propios': 'solvencia_economica',
  'Patrimonio neto': 'solvencia_economica',
  'Solvencia económica': 'solvencia_economica',
  'Seguro de indemnización': 'seguro',
  'Trabajos similares': 'solvencia_tecnica',
  'Solvencia técnica': 'solvencia_tecnica',
  'Plantilla media anual': 'solvencia_tecnica',
  'Técnicos o unidades técnicas': 'medios_personales',
  Titulaciones: 'medios_personales',
  'Medios materiales': 'medios_materiales',
  'Gestión medioambiental': 'certificaciones',
  'Medidas de calidad': 'certificaciones',
  'Certificados de calidad': 'certificaciones',
  Subcontratación: 'subcontratacion',
  Clasificación: 'clasificacion',
  Habilitación: 'habilitacion',
};

/** El tema de un requisito estructurado de la PLACSP, o null si no tiene (declaraciones). */
export function temaDeRequisitoPlacsp(etiqueta: string): Tema | null {
  return TEMA_POR_ETIQUETA[etiqueta] ?? null;
}
