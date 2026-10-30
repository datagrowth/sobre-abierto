// Calendario previsto del contrato para el dossier: inicio de las semanas de la memoria, duración y festivos.
import {
  comunidadDeSede,
  COMUNIDADES,
  festivosEntre,
  siguienteLaborable,
  sumarDias,
  type Festivo,
  type SedeOrgano,
} from '../../../nucleo/festivos.js';
import { fechaEnTexto } from '../documentosCarpeta.js';
import { textoComparable } from '../temas.js';
import { marcaPagina, type DocumentoLeido } from './dossierTexto.js';

// Sin esto Hermes escribía «semana T0» relativo a una adjudicación desconocida, y el pliego puntúa la falta de
// fechas como «carencias de detalle». El inicio es el previsto en el pliego o la ficha; si no hay, la fecha
// límite más cinco semanas (lo que suele tardar la adjudicación), en el primer día laborable.
// Sin esto Hermes escribía «semana T0» relativo a una adjudicación desconocida, y el pliego puntúa la falta de
// fechas como «carencias de detalle». El inicio es el previsto en el pliego o la ficha; si no hay, la fecha
// límite más cinco semanas (lo que suele tardar la adjudicación), en el primer día laborable.
export type FuentesCalendario = {
  pcaps: DocumentoLeido[];
  hitos: { hito: string; fecha?: string | undefined }[];
  periodoInicio: string | null;
  duracionPlacsp: { valor: number; unidad: string } | null;
  fechaLimite: string | null;
  sede: SedeOrgano;
};
export type Calendario = {
  inicio: string;
  fuente: string;
  laborable: string;
  meses: number | null;
  duracion: string | null;
  fin: string | null;
  comunidad: string | null;
  sede: string | null;
  festivos: Festivo[];
};

const SEMANAS_TRAS_EL_PLAZO = 5;
const MESES_SIN_DURACION = 12;
// La fecha, en la misma línea o al principio de la siguiente: en un cuadro resumen sacado de PDF
// la etiqueta y el valor son celdas distintas.
const INICIO =
  /(?:fecha (?:prevista|estimada) de inicio|inicio previsto|fecha de inicio prevista|fecha de inicio (?:del contrato|de la ejecucion|de los trabajos|del servicio|de la prestacion))(?:[^\n]{0,60}?|[^\n]{0,60}\n\s*)(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2} de [a-z]+ de \d{4})/;
const HITO_INICIO = /\binicio\b|\bcomienzo\b/;
const NO_ES_EL_CONTRATO = /presentac|oferta|solicitud|consulta|licitaci/;
const DURACION = /duraci[oó]n|plazo de ejecuci[oó]n/i;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** «lunes 16/11/2026». */
function fechaLarga(f: string): string {
  const d = new Date(`${f}T00:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
}

// El día antes del mismo día n meses después; si ese día no existe en el mes de llegada (31 de
// agosto + 6 meses), el último día de ese mes: setUTCMonth se pasaba al mes siguiente.
function sumarMeses(f: string, meses: number): string {
  const [a, m, d] = f.split('-').map(Number) as [number, number, number];
  const diasDelMes = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  if (d > diasDelMes) return new Date(Date.UTC(a, m - 1 + meses, diasDelMes)).toISOString().slice(0, 10);
  return sumarDias(new Date(Date.UTC(a, m - 1 + meses, d)).toISOString().slice(0, 10), -1);
}

function inicioEnPliego(pcaps: DocumentoLeido[]): { fecha: string; fuente: string } | null {
  for (const p of pcaps) {
    for (const [n, t] of [...p.paginas.entries()].sort((a, b) => a[0] - b[0])) {
      const m = INICIO.exec(textoComparable(t));
      const fecha = m ? fechaEnTexto(m[1]!) : null;
      if (fecha) return { fecha, fuente: `${marcaPagina(p, n)} «${m![0].replace(/\s+/g, ' ').trim()}»` };
    }
  }
  return null;
}

function inicioDe(f: FuentesCalendario): { fecha: string; fuente: string } | null {
  const pliego = inicioEnPliego(f.pcaps);
  if (pliego) return pliego;
  const hito = f.hitos.find(
    (h) => h.fecha && HITO_INICIO.test(textoComparable(h.hito)) && !NO_ES_EL_CONTRATO.test(textoComparable(h.hito)),
  );
  if (hito?.fecha) return { fecha: hito.fecha.slice(0, 10), fuente: `ficha, hito «${hito.hito}»` };
  if (f.periodoInicio)
    return { fecha: f.periodoInicio.slice(0, 10), fuente: 'inicio del periodo publicado en la plataforma' };
  if (!f.fechaLimite) return null;
  return {
    fecha: sumarDias(f.fechaLimite.slice(0, 10), SEMANAS_TRAS_EL_PLAZO * 7),
    fuente: `no lo fija el pliego ni la ficha: fecha límite + ${SEMANAS_TRAS_EL_PLAZO} semanas`,
  };
}

// Lo que viene tras «prorrogable» es la prórroga, no la duración; y «(2 años)» tras «24 meses»
// es la misma duración dicha otra vez. Sumarlos daba el doble.
const PRORROGA = /\bprorrog/;
const EQUIVALENCIA = /\([^()]*\p{L}[^()]*\)/gu;

/** Meses de una duración escrita: «Tres (3) meses de implantación + un (1) mes de soporte» → 4; sin prórrogas ni equivalencias. */
export function mesesDeTexto(t: string): number | null {
  const todo = textoComparable(t);
  const corte = todo.search(PRORROGA);
  const c = (corte >= 0 ? todo.slice(0, corte) : todo).replace(EQUIVALENCIA, ' ');
  const suma = (re: RegExp) => [...c.matchAll(re)].reduce((s, m) => s + Number(m[1]), 0);
  const meses = suma(/\((\d+)\)\s*mes/g) || suma(/(\d+)\s*mes/g);
  const anios = suma(/\((\d+)\)\s*anos?\b/g) || suma(/(\d+)\s*anos?\b/g);
  return meses + anios * 12 || null;
}

function duracionEnPliego(pcaps: DocumentoLeido[]): string | null {
  for (const p of pcaps) {
    for (const [n, t] of [...p.paginas.entries()].sort((a, b) => a[0] - b[0])) {
      const linea = t
        .split('\n')
        .find((l) => DURACION.test(l) && /:\s*\S/.test(l) && mesesDeTexto(l.slice(l.indexOf(':'))) !== null);
      if (linea) return `«${linea.trim().slice(0, 200)}» ${marcaPagina(p, n)}`;
    }
  }
  return null;
}

const MESES_PLACSP: Record<string, number> = { MON: 1, ANN: 12, DAY: 1 / 30 };

/** El calendario previsto; null si no hay ni inicio ni fecha límite de la que sacarlo. */
export function calendarioPrevisto(f: FuentesCalendario): Calendario | null {
  const inicio = inicioDe(f);
  if (!inicio) return null;
  const sede = comunidadDeSede(f.sede);
  const laborable = siguienteLaborable(inicio.fecha, sede?.comunidad ?? null);
  const duracion = duracionEnPliego(f.pcaps);
  const placsp =
    f.duracionPlacsp && MESES_PLACSP[f.duracionPlacsp.unidad]
      ? Math.round(f.duracionPlacsp.valor * MESES_PLACSP[f.duracionPlacsp.unidad]!)
      : null;
  const meses = (duracion ? mesesDeTexto(duracion.slice(duracion.indexOf(':'))) : null) ?? (placsp || null);
  const fin = meses ? sumarMeses(laborable, meses) : null;
  const festivos = festivosEntre(
    laborable,
    fin ?? sumarMeses(laborable, MESES_SIN_DURACION),
    sede?.comunidad ?? null,
  ).filter((x) => ![0, 6].includes(new Date(`${x.fecha}T00:00:00Z`).getUTCDay()));
  return {
    inicio: inicio.fecha,
    fuente: inicio.fuente,
    laborable,
    meses,
    duracion: duracion ?? (placsp ? `${placsp} meses (plataforma)` : null),
    fin,
    comunidad: sede ? COMUNIDADES[sede.comunidad] : null,
    sede: sede?.fuente ?? null,
    festivos,
  };
}

/** Las líneas del calendario para la identificación del dossier. */
export function lineasCalendario(c: Calendario | null): string[] {
  if (!c)
    return [
      '- Inicio previsto: sin fecha en el pliego, la ficha ni la plataforma, y sin fecha límite: fecha el calendario por semanas y dilo.',
    ];
  const movido =
    c.laborable !== c.inicio ? `; no es laborable: el primer día laborable es el ${fechaLarga(c.laborable)}` : '';
  const ambito = c.comunidad
    ? `nacionales y de ${c.comunidad} (sede: ${c.sede})`
    : 'nacionales (no se sabe la comunidad de la sede)';
  return [
    `- Inicio previsto: ${fechaLarga(c.inicio)} (${c.fuente})${movido}.`,
    `- Duración: ${c.duracion ?? 'el pliego no la dice'}${c.meses ? `; ${c.meses} meses, hasta el ${fechaLarga(c.fin!)}` : ''}.`,
    `- Festivos laborables en ese periodo, ${ambito}; los locales del municipio no se calculan: ${c.festivos.length ? c.festivos.map((x) => `${fechaLarga(x.fecha)} (${x.nombre})`).join('; ') : 'ninguno'}.`,
    '- Fecha el calendario de la memoria desde ese inicio, en semanas laborables y saltando esos festivos; si el inicio se mueve, todo se desplaza lo mismo.',
  ];
}

const FECHA_LARGA = /(\d{2})\/(\d{2})\/(\d{4})/;

/**
 * El día desde el que se fecha el calendario, leído de la identificación del dossier (las líneas
 * de lineasCalendario): el primer laborable si el inicio previsto no lo es. Null si no hay fecha.
 */
export function inicioDelDossier(identificacion: string): string | null {
  const linea = identificacion.split('\n').find((l) => l.startsWith('- Inicio previsto:'));
  const laborable = linea?.split('el primer día laborable es el')[1] ?? linea;
  const m = laborable ? FECHA_LARGA.exec(laborable) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
