// Caso A de la oferta (ficticio): la SIIE, exp. EXP-2026-0412 (p-91000710). Memoria de 25 páginas con 4
// apartados de juicio de valor (8, 7, 6 y 4 puntos; PCAP págs. 31-34), dos archivos
// electrónicos (nº 1 con la memoria, nº 2 con la oferta económica y los criterios
// automáticos: ISO 14001, discapacidad y tres mejoras) e IGIC aparte. Las páginas del PCAP
// (pliego-casoA.json) llevan las frases literales que vigila la revisión del guion.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LicitacionData } from '../../../src/dominios/licitaciones/placsp/mapper.js';
import { cuotaDeApartado } from '../../../src/dominios/licitaciones/oferta/memoriaRevision.js';
import { licitacion } from '../../helpers/sinteticas.js';

export const ID = 'p-91000710';
export const CARPETA_PLIEGOS = `Licitaciones/Radar/2026/EXP-2026-0412 (${ID})`;
export const PAGINAS_PCAP = (JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pliego-casoA.json'), 'utf8')) as { 'PCAP.pdf': string[] })['PCAP.pdf'];

const ORGANO = { nombre: 'Sociedad Insular de Inclusión de Ejemplo, S.L. (SIIE)', nif: 'B00543215' };

// El plazo, siempre unas semanas por delante: con el plazo vencido o muy cerca no se pide nada
// a Hermes (oferta/plazo.ts), y los tests no deben caducar con el calendario.
const plazoDentroDe = (dias: number) => `${new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)}T14:00:00`;

export function licitacionCasoA(): LicitacionData {
  const l = licitacion({ titulo: 'Servicio de apoyo a la entidad en protección de datos personales', publicada: '2026-09-18', organo: ORGANO, presupuesto: 51_480, cpv: '79111000', limite: plazoDentroDe(30) });
  return { ...l, id: ID, atom_id: `atom-${ID}`, expediente: 'EXP-2026-0412' };
}

/** Otra licitación del mismo órgano, para los casos sin ficha o sin guion. */
export function otraLicitacion(id: string): LicitacionData {
  const l = licitacion({ titulo: 'Servicio de mantenimiento de la web corporativa', publicada: '2026-09-20', organo: ORGANO, presupuesto: 20_000, cpv: '72267000', limite: plazoDentroDe(35) });
  return { ...l, id, atom_id: `atom-${id}`, expediente: `${id.slice(2)}/2026` };
}

export const APARTADOS = [
  { titulo: 'Organización y metodología del servicio', puntos: 8, pagina: 31, escala: [0, 4, 6, 8],
    se_valorara: ['Modelo organizativo propuesto', 'Definición de roles y responsabilidades', 'Procedimiento de atención de consultas', 'Coordinación con la Asesoría Jurídica', 'Viabilidad de la propuesta'] },
  { titulo: 'Gestión de incidencias y control de calidad', puntos: 7, pagina: 32, escala: [0, 3, 5, 7],
    se_valorara: ['Procedimiento de gestión de incidencias', 'Indicadores de calidad del servicio', 'Mecanismos de control y seguimiento'] },
  { titulo: 'Asesoramiento y acompañamiento', puntos: 6, pagina: 33, escala: [0, 3, 5, 6],
    se_valorara: ['Plan de asesoramiento a los órganos de la entidad', 'Acompañamiento en la implantación', 'Formación al personal'] },
  { titulo: 'Mejoras vinculadas al objeto del contrato', puntos: 4, pagina: 34, escala: [0, 2, 4],
    se_valorara: ['Mejoras relacionadas con el objeto del contrato', 'Utilidad de las mejoras para la entidad'] },
];

export const FICHA_CASO_A = {
  id: ID, resumen: 'Servicio de asesoramiento en protección de datos para la SIIE durante dos años.', requisitos: [],
  criterios: [
    { descripcion: 'Oferta económica', peso: 30, tipo: 'formula' },
    ...APARTADOS.map((a) => ({ descripcion: a.titulo, peso: a.puntos, tipo: 'juicio_valor', pagina: a.pagina })),
    { descripcion: 'Certificado ISO 14001', peso: 10, tipo: 'formula' },
    { descripcion: 'Plantilla con discapacidad igual o superior al 10 %', peso: 15, tipo: 'formula' },
    { descripcion: 'Mejoras automáticas', peso: 20, tipo: 'formula' },
  ],
  documentacion: [], hitos: [], garantias: [], penalizaciones: [], riesgos: [], recomendacion: { decision: 'go', motivo: 'Encaja con lo que hacemos.' },
};

const ARCHIVO_1 = 'Archivo electrónico nº 1';
const ARCHIVO_2 = 'Archivo electrónico nº 2';
const ANEXOS = 'Anexos al PCAP.doc';
const declaracion = (nombre: string, obligatorio = true) => ({ tipo: 'declaracion', nombre, obligatorio, produce: 'persona' });
const automatico = (criterio: string, puntos: number, marcas: string[]) => ({
  criterio, puntos, como_se_acredita: 'Marcando la casilla del Anexo VII y aportando el justificante.', casilla_en: 'Anexo VII', archivo: ARCHIVO_2, marcas, documento: 'PCAP.pdf', pagina: 36,
});

export const GUION_CASO_A = {
  archivos: [
    {
      nombre: ARCHIVO_1, contenido: 'Documentación administrativa y memoria técnica (criterios sujetos a juicio de valor).',
      prohibiciones: ['No podrá incluirse en este archivo ninguna información relativa a la oferta económica ni a los criterios evaluables automáticamente, so pena de exclusión.'],
      firma: 'Firma electrónica del representante',
      documentos: [
        { tipo: 'deuc', nombre: 'DEUC', obligatorio: true, produce: 'persona' },
        { tipo: 'memoria', nombre: 'Memoria técnica', obligatorio: true, produce: 'hermes' },
        { ...declaracion('Anexo XIII. Declaración responsable'), origen: { modelo: 'Anexo XIII', documento: ANEXOS, pagina: 12 } },
        declaracion('Anexo II. Compromiso de UTE', false), declaracion('Anexo X'), declaracion('Anexo VI'),
      ],
      documento: 'PCAP.pdf', pagina: 41,
    },
    {
      nombre: ARCHIVO_2, contenido: 'Oferta económica y criterios evaluables automáticamente.',
      documentos: [{ tipo: 'oferta_economica', nombre: 'Anexo VII. Proposición económica', obligatorio: true, produce: 'persona', origen: { modelo: 'Anexo VII', documento: ANEXOS, pagina: 20 } }],
      documento: 'PCAP.pdf', pagina: 44,
    },
  ],
  memoria: {
    archivo: ARCHIVO_1, titulo_documento: 'Memoria técnica', limite_paginas: 25 as number | null, formato: { fuente: 'Arial', tamano_letra: 11, interlineado: 1 },
    apartados: APARTADOS.map((a) => ({
      titulo: a.titulo, puntos: a.puntos, se_valorara: a.se_valorara, documento: 'PCAP.pdf', pagina: a.pagina,
      escala: a.escala.map((p) => ({ puntos: p, descripcion: p === 0 ? 'No aporta contenido operativo.' : `Propuesta con un desarrollo que merece ${p} puntos.` })),
    })),
    advertencias: ['No se valorarán las manifestaciones genéricas, meramente declarativas o carentes de contenido operativo.'],
    documento: 'PCAP.pdf', pagina: 31,
  },
  automaticos: [
    automatico('Certificado ISO 14001', 10, ['ISO 14001', 'gestión ambiental certificada']),
    automatico('Plantilla con discapacidad igual o superior al 10 %', 15, ['trabajadores con discapacidad', 'plantilla con discapacidad']),
    automatico('Mejora 1: bolsa de horas adicionales', 7, ['bolsa de horas']),
    automatico('Mejora 2: formación adicional', 6, ['formación adicional']),
    automatico('Mejora 3: ampliación del horario de atención', 7, ['ampliación del horario']),
  ],
  oferta_economica: {
    formula: 'P = 30 × (oferta más baja / oferta a valorar)', presupuesto_base: 51_480, impuesto_aparte: 'IGIC', umbral_anormalidad: null,
    modelo: 'Anexo VII', archivo: ARCHIVO_2, documento: 'PCAP.pdf', pagina: 35,
  },
  plazo: { fecha_limite: '2026-10-20T14:00', canal: 'Presentación electrónica en la PLACSP' },
};

export type Guion = typeof GUION_CASO_A;

/** El guion con cambios, sin tocar el original. */
export function guionCon(cambio: (g: Guion) => void): Guion & { id: string } {
  const g = structuredClone(GUION_CASO_A);
  cambio(g);
  return { id: ID, ...g };
}

/** Decisiones completas: las dos personas, ningún criterio automático, enfoque decidido y precio pendiente. */
export function decisionesCasoA(personas: number[]) {
  return {
    lotes: [],
    equipo: personas.map((persona_id, i) => ({ persona_id, rol_en_la_oferta: i === 0 ? 'Responsable del servicio' : 'Consultora de protección de datos', dedicacion: i === 0 ? '50 %' : '100 %' })),
    automaticos: GUION_CASO_A.automaticos.map((a) => ({ criterio: a.criterio, nos_acogemos: false })),
    herramientas: ['Registro de actividades en hoja compartida', 'Gestor de tickets'],
    enfoque: 'Servicio cercano: una persona de referencia, respuestas en 48 horas y documentación que se queda en la entidad.',
    precio: { importe: null, pendiente: true },
  };
}

export type Numeros = { memoria_id: number; guion_id: number; version: number };

// Un apartado que puntúa ocupa entre el 70 % y el 100 % de su cuota: el desarrollo de cada
// punto va en viñetas, para que el primer párrafo de cada bloque siga siendo el único.
const PARTE_DE_LA_CUOTA = 0.8;
const DESARROLLO = 'La empresa asignará a este punto una persona responsable, un calendario semanal de trabajo y un indicador con meta mensual que revisará con la entidad en la reunión de seguimiento, con acta de los acuerdos. ';

function desarrollo(caracteres: number): string[] {
  const vinetas: string[] = [];
  for (let falta = caracteres; falta > 0; falta -= 900) vinetas.push(DESARROLLO.repeat(5).slice(0, Math.min(900, Math.max(falta, 20))).trim());
  return vinetas;
}

/** Un apartado válido: un bloque por cada punto de «se valorará», con compromisos y fuentes, y el 80 % de su cuota. */
export function apartadoCasoA(n: number, numeros: Numeros) {
  const a = APARTADOS[n - 1]!;
  const total = APARTADOS.reduce((s, x) => s + x.puntos, 0);
  const porBloque = Math.ceil((cuotaDeApartado(GUION_CASO_A.memoria.limite_paginas, a.puntos, total)?.caracteres ?? 0) * PARTE_DE_LA_CUOTA / a.se_valorara.length);
  return {
    id: ID, ...numeros, apartado: n, titulo: `${n}. ${a.titulo}`,
    bloques: a.se_valorara.map((item) => ({
      subtitulo: item,
      parrafos: [`La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas y un indicador mensual que se revisa con la entidad (${item.toLowerCase()}).`],
      lista: desarrollo(porBloque - 200),
    })),
    cubre: a.se_valorara.map((item, i) => ({ item, bloque: i + 1, parrafo: 1 })),
    compromisos: [{ que: 'Responder cada consulta', quien: 'Responsable del servicio', cuando_o_medida: '48 horas desde su entrada' }],
    fuentes: [{ documento: 'PCAP.pdf', pagina: a.pagina }],
  };
}
