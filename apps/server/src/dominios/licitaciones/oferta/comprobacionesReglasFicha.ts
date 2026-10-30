// Reglas de la ficha de las comprobaciones: ficha anterior a una rectificación, hecha con otra regla o sin hacer.
// Los pliegos nuevos de la ficha los da esta regla y no la coherencia (el adaptador excluye ese aviso).
import { TIPO_FICHA, VERSION_PROMPT_FICHA } from '../ficha.js';
import type { EntradasComprobaciones, PliegoComprobaciones } from './comprobacionesEntradas.js';
import {
  MINUTOS_POR_ACCION,
  claveBloqueo,
  huellaDe,
  type AccionBloqueo,
  type Bloqueo,
  type Gravedad,
} from './comprobacionesTipos.js';
import { CAMBIA_REQUISITOS } from './coherencia.js';
import { DOCUMENTO_CLAVE } from './guion.js';

type Fila = {
  regla: string;
  sujeto?: string;
  gravedad: Gravedad;
  titulo: string;
  actor: 'tu' | 'hermes';
  accion: AccionBloqueo;
  documento?: string;
};

function fila(f: Fila): Bloqueo {
  return {
    clave: claveBloqueo(f.regla, null, f.sujeto),
    categoria: 'elegibilidad',
    lote: null,
    gravedad: f.gravedad,
    titulo: f.titulo,
    cita: f.documento ? { documento: f.documento, pagina: null, texto: f.documento, comprobada: true } : null,
    actor: f.actor,
    accion: { tipo: f.accion, destino: 'ficha' },
    propuesta: null,
    minutos: MINUTOS_POR_ACCION[f.accion],
    estado: 'abierto',
    huella: huellaDe(f.regla, f.sujeto ?? null, f.titulo, f.gravedad),
  };
}

const bajado = (p: PliegoComprobaciones): boolean => p.estado === 'descargado' || p.estado === 'descomprimido';

// Desde la fecha en que se guardó la ficha: un pliego bajado mientras el run trabajaba puede haberlo visto, así que no avisa de más.
function posteriores(e: EntradasComprobaciones): PliegoComprobaciones[] {
  const desde = e.ficha?.creada_en;
  return desde ? e.pliegos.filter((p) => bajado(p) && p.actualizado_en > desde) : [];
}

function dePliegos(e: EntradasComprobaciones): Bloqueo[] {
  const vistos = new Set<string>();
  const out: Bloqueo[] = [];
  for (const p of posteriores(e)) {
    const rectifica = CAMBIA_REQUISITOS.test(p.nombre);
    if (vistos.has(p.nombre) || !(rectifica || DOCUMENTO_CLAVE.test(p.nombre))) continue;
    vistos.add(p.nombre);
    out.push(
      fila({
        regla: 'ficha_anterior_rectificacion',
        sujeto: huellaDe(p.nombre).slice(0, 8),
        gravedad: rectifica ? 'impide' : 'riesgo',
        titulo: `La ficha es anterior a «${p.nombre}»: rehazla`,
        actor: 'tu',
        accion: 'rehacer_ficha',
        documento: p.nombre,
      }),
    );
  }
  return out;
}

function deRegla(e: EntradasComprobaciones): Bloqueo[] {
  const v = e.ficha?.version_prompt;
  if (v === undefined || v >= VERSION_PROMPT_FICHA) return [];
  return [
    fila({
      regla: 'ficha_regla_anterior',
      sujeto: `v${v}`,
      gravedad: 'riesgo',
      titulo: `La ficha se hizo con una regla anterior (v${v}): rehazla`,
      actor: 'tu',
      accion: 'rehacer_ficha',
    }),
  ];
}

function sinFicha(e: EntradasComprobaciones): Bloqueo[] {
  const haciendose = e.trabajos.some((t) => t.tipo === TIPO_FICHA);
  return [
    haciendose
      ? fila({
          regla: 'ficha_falta',
          gravedad: 'impide',
          titulo: 'Hermes está haciendo la ficha',
          actor: 'hermes',
          accion: 'esperar_hermes',
        })
      : fila({
          regla: 'ficha_falta',
          gravedad: 'impide',
          titulo: 'Falta la ficha: pídela',
          actor: 'tu',
          accion: 'rehacer_ficha',
        }),
  ];
}

export function reglasFicha(e: EntradasComprobaciones): Bloqueo[] {
  return e.ficha ? [...dePliegos(e), ...deRegla(e)] : sinFicha(e);
}
