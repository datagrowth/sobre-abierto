// Calidad de una ficha medida por código, para comparar modelos y versiones del análisis.
import type { ResultadoCobertura } from './fichaCobertura.js';
import type { Verificacion } from './fichaVerificacion.js';

// Cuenta cuántos requisitos trae, cuántos quedan por confirmar, cuántos citan página, cuánto cubre de la lista
// de temas y de lo que publica la PLACSP y cuánto tuvo que corregir el código.
export type Calidad = {
  puntuacion: number;
  requisitos: number;
  excluyentes: number;
  dudosos_pct: number;
  con_pagina_pct: number;
  excluyentes_con_cita_pct: number;
  cobertura_checklist_pct: number;
  cobertura_placsp_pct: number;
  corregidos_por_codigo: number;
  avisos: string[];
};

type RequisitoMedible = {
  cumple: string;
  excluyente: boolean;
  documento?: string | undefined;
  pagina?: number | undefined;
};

// Con ocho requisitos o más un pliego normal está razonablemente cubierto.
const REQUISITOS_BUENOS = 8;
const pct = (n: number, de: number) => (de ? Math.round((100 * n) / de) : 100);

/**
 * Puntuación 0–100: 25 cobertura de la lista de temas, 25 cobertura de la PLACSP, 20 citas
 * de los excluyentes, 20 pocas dudas y 10 número de requisitos.
 */
export function calidadDeFicha(
  requisitos: RequisitoMedible[],
  cobertura: ResultadoCobertura,
  verificaciones: Verificacion[],
  avisos: string[],
): Calidad {
  const excluyentes = requisitos.filter((r) => r.excluyente);
  const dudosos_pct = pct(requisitos.filter((r) => r.cumple === 'dudoso').length, requisitos.length);
  const excluyentes_con_cita_pct = pct(excluyentes.filter((r) => r.documento && r.pagina).length, excluyentes.length);
  const puntuacion = Math.round(
    0.25 * cobertura.checklist_pct +
      0.25 * cobertura.placsp_pct +
      0.2 * excluyentes_con_cita_pct +
      0.2 * (100 - dudosos_pct) +
      10 * Math.min(1, requisitos.length / REQUISITOS_BUENOS),
  );
  return {
    puntuacion,
    requisitos: requisitos.length,
    excluyentes: excluyentes.length,
    dudosos_pct,
    excluyentes_con_cita_pct,
    con_pagina_pct: pct(requisitos.filter((r) => r.pagina).length, requisitos.length),
    cobertura_checklist_pct: cobertura.checklist_pct,
    cobertura_placsp_pct: cobertura.placsp_pct,
    corregidos_por_codigo: verificaciones.filter((v) => v.resultado !== v.resultado_ia).length,
    avisos,
  };
}
