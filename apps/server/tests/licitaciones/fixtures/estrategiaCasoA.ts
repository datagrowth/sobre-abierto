// Una estrategia válida de la memoria técnica del caso A: títulos literales, cada «se valorará» en
// el mapa, extensiones al 85 % de cada cuota (con la guía descontada; caben en las 25 páginas) y una hoja de hechos sin
// nada de los criterios automáticos.
import type { HechoData } from '../../../src/dominios/licitaciones/oferta/estrategia.js';
import { cuotaDeApartado, paginasDeGuia } from '../../../src/dominios/licitaciones/oferta/memoriaRevision.js';
import { APARTADOS, GUION_CASO_A, ID } from './casoA.js';

export type NumerosEstrategia = { memoria_id: number; version: number };
const TOTAL = APARTADOS.reduce((s, a) => s + a.puntos, 0);
// La memoria reserva páginas a la tabla guía: las cuotas se calculan descontándolas.
const GUIA = paginasDeGuia(GUION_CASO_A.memoria);

const HECHOS_CASO_A: HechoData[] = [
  { clave: 'horario_atencion', categoria: 'horario', sobre: 'atención de consultas', valor: 'L-V 9:00-17:00 (hora de Canarias)', palabras: ['atención', 'consultas'] },
  { clave: 'respuesta_consultas', categoria: 'plazo', sobre: 'respuesta a consultas', valor: '48 horas', palabras: ['respuesta', 'responderá'] },
  { clave: 'responsable', categoria: 'rol', sobre: 'responsable del servicio', valor: 'Responsable del servicio (50 %)', palabras: ['responsable'] },
  { clave: 'tickets', categoria: 'herramienta', sobre: 'registro de consultas', valor: 'Gestor de tickets', palabras: ['tickets'] },
];

// Fechas desde hoy: el inicio previsto del dossier sale de la fecha límite (hoy + 30 días) + 5
// semanas, y el calendario no puede empezar antes.
const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/** La solución decidida del caso A: sin sistemas ni modelos (es un servicio de asesoramiento). */
export function solucionCasoA() {
  return {
    calendario: {
      inicio: dia(120), fuente_inicio: 'Fecha límite + 5 semanas, en el primer día laborable',
      semanas: [
        { desde: dia(120), hasta: dia(124), trabajo: 'Reunión de arranque y registro de actividades', rol: 'RS', entregable: 'Acta de arranque', puerta: 'Acta firmada por la Asesoría Jurídica' },
        { desde: dia(127), hasta: dia(155), trabajo: 'Análisis de riesgos de los tratamientos', rol: 'RS', entregable: 'Informe de riesgos', puerta: 'Revisión en la reunión mensual' },
      ],
      festivos: [], desplazamiento: 'Si el inicio se mueve, todas las fechas se desplazan lo mismo; un hito en festivo pasa al siguiente laborable.',
    },
    arquitectura: [], modelos: [],
    umbrales: [
      { metrica: 'Consultas respondidas en plazo', formula: 'respondidas en 48 horas / recibidas', umbral: '≥ 95 %', banco: 'Gestor de tickets', cuando: 'Cada mes' },
      { metrica: 'Satisfacción del personal', formula: 'media de la encuesta de 1 a 5', umbral: '≥ 4', banco: 'Encuesta tras cada sesión', cuando: 'Cada sesión de formación' },
    ],
    banco_pruebas: null,
    formacion: { horas: 4, sesiones: 2, destinatarios: 'Personal de oficina de la SIIE', plan: 'Dos sesiones anuales de 2 horas sobre protección de datos en su trabajo diario.' },
    soporte: { horario: 'L-V 9:00-17:00 (hora de Canarias)', respuesta: 'Respuesta a consultas en 48 horas', meses: null, canal: 'Gestor de tickets y correo' },
    riesgos: [
      { id: 'R1', causa: 'Picos de consultas al cierre del ejercicio', probabilidad: 'media', impacto: 'media', disparador: 'Más de 20 consultas abiertas', medida: 'Refuerzo de la responsable al 75 % ese mes', dueno: 'RS' },
      { id: 'R2', causa: 'Cambio normativo en protección de datos', probabilidad: 'baja', impacto: 'alta', disparador: 'Publicación en el BOE', medida: 'Nota de impacto en 10 días', dueno: 'RS' },
      { id: 'R3', causa: 'Rotación del personal formado', probabilidad: 'media', impacto: 'baja', disparador: 'Alta de personal nuevo', medida: 'Píldora formativa grabada', dueno: 'RS' },
    ],
    alias_roles: [{ rol: 'Responsable del servicio', alias: 'RS', dedicacion: '50 %' }],
    casos: [
      { apartado: 1, caso: 'Una consulta sobre el formulario de inscripción a un taller.' },
      { apartado: 2, caso: 'Una incidencia por un correo enviado con destinatarios visibles.' },
      { apartado: 3, caso: 'El acompañamiento al implantar un registro de visitas.' },
      { apartado: 4, caso: 'Una guía rápida de protección de datos para el personal de sala.' },
    ],
    pendientes_legitimos: [],
  };
}

export function estrategiaCasoA(n: NumerosEstrategia) {
  return {
    id: ID, ...n,
    temas: [
      { titulo: 'Una persona de referencia', mensaje: 'La SIIE tendrá siempre a la misma responsable al otro lado.', por_que_puntua: 'Responde al modelo organizativo y a los roles.', prueba: 'Organigrama con dedicaciones.', apartados: [1] },
      { titulo: 'Respuesta medida', mensaje: 'Cada consulta se responde en 48 horas y se mide cada mes.', por_que_puntua: 'Indicadores de calidad del servicio.', prueba: 'Cuadro de indicadores con metas.', apartados: [2] },
      { titulo: 'Autonomía al terminar', mensaje: 'La documentación y la formación se quedan en la entidad.', por_que_puntua: 'Formación al personal y acompañamiento.', prueba: 'Plan de formación con fechas.', apartados: [3, 4] },
    ],
    audiencia: { destinatarios: 'Personal de oficina de la SIIE', nivel: 'No técnico', ejemplos_del_contexto: ['Un formulario de inscripción a un taller'], evitar: ['Jerga de seguridad informática'] },
    estructura: APARTADOS.map((a, i) => ({
      apartado: i + 1, titulo: a.titulo,
      caracteres_objetivo: Math.round((cuotaDeApartado(GUION_CASO_A.memoria.limite_paginas, a.puntos, TOTAL, GUIA)!.caracteres * 0.85) / 100) * 100,
      secciones: a.se_valorara.map((s) => ({ titulo: s, contenido: `Cómo tratamos ${s.toLowerCase()} con responsables y plazos.`, elementos: ['tabla'] })),
    })),
    mapa: APARTADOS.flatMap((a, i) => a.se_valorara.map((s) => ({ apartado: i + 1, item: s, seccion: s, evidencia: `Procedimiento y responsable de ${s.toLowerCase()}, revisado cada 30 días.` }))),
    hechos: HECHOS_CASO_A.map((h) => ({ ...h, palabras: [...h.palabras] })),
    frontera: [{ no_decir: 'Certificaciones ambientales', motivo: 'Van en el archivo electrónico nº 2.' }],
    reglas: ['Voz afirmativa y en futuro.', 'Cada compromiso con quién y cuándo.'],
    solucion: solucionCasoA(),
  };
}
