// Evaluador determinista de requisitos: compara lo que publica la PLACSP con el perfil de la empresa.
import { z } from 'zod';
import type { PerfilEmpresaData } from '../../nucleo/empresa.js';

// Se evalúa lo que la PLACSP publica estructurado (clasificación exigida, umbrales de solvencia). Lo que solo
// viene en texto queda «desconocido»: lo lee la IA en el pliego.
// no_aplica: el pliego lo pide, pero no afecta a la empresa (p. ej. lo de las UTE): no cuenta.
export type Resultado = 'cumple' | 'no_cumple' | 'desconocido' | 'no_aplica';

export type Evaluacion = {
  origen: 'placsp' | 'ficha';
  clase: string;
  etiqueta: string;
  descripcion: string;
  lote: string | null;
  exigido: string | null;
  resultado: Resultado;
  // Si de verdad no se cumple, deja fuera de la licitación.
  excluyente: boolean;
  motivo: string;
  pagina?: number | null;
  documento?: string | null;
  // Quedó «desconocido» pero hay una ficha aprobada: la persona ya lo revisó allí.
  en_ficha?: boolean;
  // De la ficha: qué dato de la empresa decide el resultado y, si el código lo comprobó, qué decía Hermes.
  fuente?: string | null;
  verificacion?: { regla: string; resultado_ia: string; detalle: string | null } | null;
};

// Lo guardado en licitaciones.datos; las filas anteriores a los umbrales no traen umbral ni lote.
const RequisitoGuardado = z.object({
  clase: z.string(),
  codigo: z.string().nullable().catch(null),
  descripcion: z.string().catch(''),
  umbral: z.number().nullable().optional().catch(null),
  lote: z.string().nullable().optional().catch(null),
});
type Req = z.infer<typeof RequisitoGuardado>;

// lotes_en_juego: los lotes a los que se va (los de interés); los requisitos propios de otros
// lotes no cuentan. null o ausente = todos.
export type LicitacionEvaluable = {
  tipo_contrato: string | null;
  valor_estimado: number | null;
  requisitos: unknown;
  lotes_en_juego?: string[] | null;
};

const EUROS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const euros = (n: number) => `${EUROS.format(n)} €`;
const SIN_PERFIL = 'Falta el perfil de la empresa (Ajustes › Empresa).';
const EN_EL_PLIEGO = 'La PLACSP no da el detalle: Hermes lo leerá del pliego al generar la ficha.';
// LCSP art. 77.1.a: la clasificación solo es obligatoria en obras de 500.000 € o más.
const OBRAS = '3';
const UMBRAL_CLASIFICACION_OBRAS = 500_000;
// La PLACSP a veces pone en ThresholdQuantity un ratio («1,5 veces el valor estimado»),
// un número de trabajos o un 0, no un importe: por debajo de esto no se compara.
const IMPORTE_MINIMO = 1000;
const NO_ES_IMPORTE =
  'El umbral publicado no es un importe (parece un ratio o un número de trabajos): Hermes lo leerá del pliego al generar la ficha.';
const esImporte = (umbral: number | null | undefined): umbral is number => umbral != null && umbral >= IMPORTE_MINIMO;

function exigidoImporte(umbral: number | null | undefined): string | null {
  if (umbral == null) return null;
  return esImporte(umbral) ? `≥ ${euros(umbral)}` : `umbral publicado: ${umbral}`;
}

function base(r: Req, etiqueta: string, excluyente: boolean): Omit<Evaluacion, 'resultado' | 'motivo' | 'exigido'> {
  return { origen: 'placsp', clase: r.clase, etiqueta, descripcion: r.descripcion, lote: r.lote ?? null, excluyente };
}

// Categoría en números (RD 773/2015) o en letras (antigua), equivalencias de su
// disposición transitoria. Grupos A–K son obras; L–V, servicios.
const LETRA_OBRAS: Record<string, number> = { A: 1, B: 1, C: 2, D: 3, E: 4, F: 5 };
const LETRA_SERVICIOS: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 5 };

export function categoriaNumerica(grupo: string, categoria: string): number | null {
  const c = categoria.toUpperCase();
  if (/^[1-6]$/.test(c)) return Number(c);
  const tabla = grupo.toUpperCase() <= 'K' ? LETRA_OBRAS : LETRA_SERVICIOS;
  return tabla[c] ?? null;
}

export type CodigoClasificacion = { grupo: string; subgrupo: number | null; categoria: number | null };

/** «V2-3», «V2c», «U*-1» o «G4» → grupo, subgrupo (null = cualquiera) y categoría. */
export function parsearClasificacion(codigo: string | null): CodigoClasificacion | null {
  const m = /^([A-Za-z])(\d|\*)-?([1-6a-fA-F])?$/.exec((codigo ?? '').trim());
  if (!m) return null;
  const grupo = m[1]!.toUpperCase();
  return {
    grupo,
    subgrupo: m[2] === '*' ? null : Number(m[2]),
    categoria: m[3] ? categoriaNumerica(grupo, m[3]) : null,
  };
}

export function tieneClasificacion(perfil: PerfilEmpresaData, req: CodigoClasificacion): boolean {
  return perfil.clasificaciones.some(
    (c) =>
      c.grupo === req.grupo &&
      (req.subgrupo === null || c.subgrupo === req.subgrupo) &&
      (categoriaNumerica(c.grupo, c.categoria) ?? 0) >= (req.categoria ?? 1),
  );
}

function evaluarClasificacion(r: Req, perfil: PerfilEmpresaData | null, lic: LicitacionEvaluable): Evaluacion {
  const obligatoria = lic.tipo_contrato === OBRAS && (lic.valor_estimado ?? 0) >= UMBRAL_CLASIFICACION_OBRAS;
  const b = { ...base(r, 'Clasificación', obligatoria), exigido: r.codigo };
  const req = parsearClasificacion(r.codigo);
  if (!req)
    return {
      ...b,
      resultado: 'desconocido',
      motivo: `Código de clasificación no reconocido: ${r.codigo ?? '(vacío)'}.`,
    };
  if (!perfil) return { ...b, resultado: 'desconocido', motivo: SIN_PERFIL };
  const alternativa = obligatoria ? '' : ' Aquí la clasificación es una vía alternativa para acreditar la solvencia.';
  if (tieneClasificacion(perfil, req))
    return { ...b, resultado: 'cumple', motivo: `Tenemos clasificación que la cubre.${alternativa}` };
  return {
    ...b,
    resultado: 'no_cumple',
    motivo: `No tenemos esa clasificación (o la categoría es inferior).${alternativa}`,
  };
}

/** El mejor volumen de negocio de los tres últimos ejercicios cerrados. */
export function mejorVolumen(perfil: PerfilEmpresaData, hoy: Date): { anio: number; importe: number } | null {
  const ultimo = hoy.getFullYear() - 1;
  const recientes = perfil.volumen_negocio.filter((v) => v.anio >= ultimo - 2 && v.anio <= ultimo);
  return recientes.reduce<{ anio: number; importe: number } | null>(
    (m, v) => (!m || v.importe > m.importe ? v : m),
    null,
  );
}

function evaluarVolumen(r: Req, perfil: PerfilEmpresaData, hoy: Date): Pick<Evaluacion, 'resultado' | 'motivo'> {
  const ultimo = hoy.getFullYear() - 1;
  const mejor = mejorVolumen(perfil, hoy);
  if (!mejor)
    return {
      resultado: 'desconocido',
      motivo: `Faltan los volúmenes de negocio de ${ultimo - 2}–${ultimo} en el perfil.`,
    };
  const texto = `Mejor de los tres últimos ejercicios: ${euros(mejor.importe)} (${mejor.anio}).`;
  return { resultado: mejor.importe >= (r.umbral ?? 0) ? 'cumple' : 'no_cumple', motivo: texto };
}

// El seguro de responsabilidad civil se contrata (o se amplía) cuando hace falta: si no
// llega, se avisa, pero nunca deja fuera de la licitación.
const SEGURO_CONTRATABLE =
  'Se puede contratar antes de presentarse (y suele acreditarse al ser propuesto adjudicatario): no impide presentarse.';

function evaluarSeguro(r: Req, perfil: PerfilEmpresaData): Pick<Evaluacion, 'resultado' | 'motivo'> {
  if (perfil.seguro_rc !== null && perfil.seguro_rc >= (r.umbral ?? 0))
    return { resultado: 'cumple', motivo: `Seguro de responsabilidad civil: ${euros(perfil.seguro_rc)}.` };
  const tenemos =
    perfil.seguro_rc === null
      ? 'El perfil no indica seguro de responsabilidad civil.'
      : `Seguro de responsabilidad civil: ${euros(perfil.seguro_rc)}.`;
  return { resultado: 'no_cumple', motivo: `${tenemos} ${SEGURO_CONTRATABLE}` };
}

const FINANCIERA: Record<string, string> = {
  '2': 'Informe de entidades financieras',
  '3': 'Seguro de indemnización',
  '4': 'Fondos propios',
  '5': 'Volumen anual de negocio',
  '6': 'Patrimonio neto',
};

const SEGURO = '3';

function evaluarFinanciera(r: Req, perfil: PerfilEmpresaData | null, hoy: Date): Evaluacion {
  const b = {
    ...base(r, FINANCIERA[r.codigo ?? ''] ?? 'Solvencia económica', r.codigo !== SEGURO),
    exigido: exigidoImporte(r.umbral),
  };
  const comparable = r.umbral != null && (r.codigo === '5' || r.codigo === SEGURO);
  if (!comparable) return { ...b, resultado: 'desconocido', motivo: EN_EL_PLIEGO };
  if (!esImporte(r.umbral)) return { ...b, resultado: 'desconocido', motivo: NO_ES_IMPORTE };
  if (!perfil) return { ...b, resultado: 'desconocido', motivo: SIN_PERFIL };
  return { ...b, ...(r.codigo === '5' ? evaluarVolumen(r, perfil, hoy) : evaluarSeguro(r, perfil)) };
}

const TECNICA: Record<string, string> = {
  'OSR-COMPTASK': 'Trabajos similares',
  'OSR-TECH': 'Técnicos o unidades técnicas',
  'OXR-TITULOS': 'Titulaciones',
  'OXR-GESTMEDIOAMB': 'Gestión medioambiental',
  'OXR-PLANTILLA': 'Plantilla media anual',
  'OXR-MEDIOS': 'Medios materiales',
  'XSR-CALIDAD': 'Medidas de calidad',
  'XSX-CERTCALIDAD': 'Certificados de calidad',
  'XXR-SUBCONT': 'Subcontratación',
};

// El pliego suele medir el acumulado anual de trabajos similares y el perfil guarda
// el mayor contrato: si no llega, se avisa pero no se descarta sola.
function evaluarTrabajos(r: Req, perfil: PerfilEmpresaData): Pick<Evaluacion, 'resultado' | 'motivo' | 'excluyente'> {
  const importe = perfil.mayor_contrato_similar;
  if (importe === null)
    return {
      resultado: 'desconocido',
      motivo: 'El perfil no indica el mayor contrato similar de los últimos 3 años.',
      excluyente: true,
    };
  if (importe >= (r.umbral ?? 0))
    return {
      resultado: 'cumple',
      motivo: `Mayor contrato similar: ${euros(importe)}, si es de la misma naturaleza.`,
      excluyente: true,
    };
  return {
    resultado: 'no_cumple',
    motivo: `Mayor contrato similar: ${euros(importe)}. El pliego suele pedir el acumulado anual de trabajos similares: compruébalo con la relación de trabajos.`,
    excluyente: false,
  };
}

function evaluarPlantilla(r: Req, perfil: PerfilEmpresaData): Pick<Evaluacion, 'resultado' | 'motivo'> {
  if (perfil.plantilla_media === null)
    return { resultado: 'desconocido', motivo: 'El perfil no indica la plantilla media.' };
  return {
    resultado: perfil.plantilla_media >= (r.umbral ?? 0) ? 'cumple' : 'no_cumple',
    motivo: `Plantilla media: ${perfil.plantilla_media} personas.`,
  };
}

function evaluarTecnica(r: Req, perfil: PerfilEmpresaData | null): Evaluacion {
  const plantilla = r.codigo === 'OXR-PLANTILLA';
  const exigido = !plantilla ? exigidoImporte(r.umbral) : r.umbral == null ? null : `≥ ${r.umbral} personas`;
  const b = { ...base(r, TECNICA[r.codigo ?? ''] ?? 'Solvencia técnica', true), exigido };
  if (r.umbral == null || (r.codigo !== 'OSR-COMPTASK' && !plantilla))
    return { ...b, resultado: 'desconocido', motivo: EN_EL_PLIEGO };
  if (!plantilla && !esImporte(r.umbral)) return { ...b, resultado: 'desconocido', motivo: NO_ES_IMPORTE };
  if (!perfil) return { ...b, resultado: 'desconocido', motivo: SIN_PERFIL };
  return { ...b, ...(plantilla ? evaluarPlantilla(r, perfil) : evaluarTrabajos(r, perfil)) };
}

// En servicios y obras pequeñas, tener la clasificación que pide el pliego acredita la
// solvencia económica y técnica (LCSP art. 77): un umbral no alcanzado deja de contar.
function sustituirPorClasificacion(evals: Evaluacion[]): Evaluacion[] {
  const cubiertos = new Set(
    evals.filter((e) => e.clase === 'clasificacion' && e.resultado === 'cumple').map((e) => e.lote),
  );
  return evals.map((e) => {
    const solvencia = e.clase === 'financiera' || e.clase === 'tecnica';
    if (!solvencia || e.resultado !== 'no_cumple' || !(cubiertos.has(e.lote) || cubiertos.has(null))) return e;
    return { ...e, resultado: 'cumple', motivo: `${e.motivo} Queda acreditada con la clasificación.` };
  });
}

/** Requisitos de la PLACSP evaluados contra el perfil. Las declaraciones responsables no se evalúan. */
export function evaluarRequisitos(
  lic: LicitacionEvaluable,
  perfil: PerfilEmpresaData | null,
  hoy = new Date(),
): Evaluacion[] {
  const enJuego = lic.lotes_en_juego ?? null;
  const reqs = z
    .array(RequisitoGuardado)
    .catch([])
    .parse(lic.requisitos)
    .filter((r) => enJuego === null || r.lote == null || enJuego.includes(r.lote));
  const evals = reqs.flatMap((r): Evaluacion[] => {
    if (r.clase === 'clasificacion') return [evaluarClasificacion(r, perfil, lic)];
    if (r.clase === 'financiera') return [evaluarFinanciera(r, perfil, hoy)];
    if (r.clase === 'tecnica') return [evaluarTecnica(r, perfil)];
    if (r.clase === 'habilitacion')
      return [
        {
          ...base(r, 'Habilitación', true),
          exigido: null,
          resultado: 'desconocido',
          motivo: 'Habilitación o título exigido: compruébalo en el pliego.',
        },
      ];
    return [];
  });
  return sustituirPorClasificacion(evals);
}
