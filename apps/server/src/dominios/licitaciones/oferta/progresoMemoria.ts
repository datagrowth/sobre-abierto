// Lo que la web y las tools ven de una memoria: fase, trabajo en curso, dossier, estrategia, críticas y coherencia.
import { nucleo } from '../../../nucleo/contexto.js';
import { logger } from '../../../nucleo/log.js';
import type { EnCurso } from '../../../nucleo/colaConsultas.js';
import type { Db } from '../store.js';
import { hallazgosDe } from './coherenciaMemoria.js';
import { criticasDe } from './critica.js';
import { dossierDe } from './dossier.js';
import type { FilaMemoria } from './ensamblado.js';
import { estrategiaDe, type HechoData } from './estrategia.js';
import { PREFIJO_HECHO } from './fichaCampos.js';
import { estadoFicha, fichaDe, type EstadoFicha, type FichaSolucion } from './fichaSolucion.js';
import { compromisoDeCampo, type CampoFicha, type SolucionData } from './solucion.js';
import { claveDeFase, faseDe, FASES_CON_TRABAJO, type FaseConTrabajo, type FaseMemoria } from './fasesMemoria.js';
import { parchesDe, type ParcheHechos } from './parcheHechos.js';
import { guionPorId } from './guion.js';
import { desfaseMemoria } from './huellasMemoria.js';
import { textoDeHallazgo, type Hallazgo } from './hechos.js';
import type { FaltaMarcada, MotivoMarcado } from './motivosRonda.js';
import {
  filasDeRondas,
  guardaRegresiones,
  motivosMarcados,
  obsoletasDe,
  type FilaRonda,
  type MotivosMarcados,
} from './rondasMemoria.js';

// Incluye el dossier y la estrategia en Salidas, la hoja de hechos, las críticas por ronda (con las regresiones
// restauradas y si fueron independientes y ciegas) y los hallazgos de coherencia.
// Por apartado, los motivos y lo que falta de esa ronda; «repetido»: ya lo dijo la crítica
// anterior sobre un texto que se reescribió (la ronda no lo resolvió).
type CriticaWeb = {
  ronda: number;
  total: number;
  maximo: number;
  independiente: boolean;
  ciega: boolean;
  avisos: string[];
  apartados: { apartado: number; tramo: number; puntos: number; motivos: MotivoMarcado[]; falta: FaltaMarcada[] }[];
};
// euros: lo que cuesta un compromiso (sus horas × LICITACIONES_PRECIO_HORA), solo para la persona.
type CampoWeb = CampoFicha & { euros?: number };
// La ficha de solución con su estado de ahora (vencida: pendiente con el plazo pasado).
type FichaWeb = Omit<FichaSolucion, 'estado' | 'campos'> & {
  estado: Exclude<EstadoFicha, 'ninguna'>;
  campos: CampoWeb[];
};
export type ProgresoMemoria = {
  fase: FaseMemoria;
  ronda: number;
  max_rondas: number;
  umbral: number;
  trabajo: EnCurso | null;
  // Lo que está pasando, en una frase (para las tools: «ficha de solución pendiente de revisión»).
  situacion: string;
  ficha: FichaWeb | null;
  dossier: { ruta_md: string | null; caracteres: number; equipo_por_roles: boolean; recortadas: string[] } | null;
  estrategia: {
    ruta_md: string | null;
    creada_en: string;
    avisos: string[];
    hechos: Pick<HechoData, 'clave' | 'categoria' | 'sobre' | 'valor'>[];
  } | null;
  criticas: CriticaWeb[];
  // Apartados que una ronda empeoró y volvieron a su mejor versión.
  restaurados: number[];
  // Con la frase exacta que se le daría al redactor.
  coherencia: (Hallazgo & { texto: string })[];
  // Los hechos corregidos en las rondas porque el crítico citaba su valor (cada cambio, para revisar).
  parches: ParcheHechos[];
  // Lo que un cambio tardío dejó atrás en la memoria montada (huellasMemoria.ts): secciones del dossier y
  // apartados a revisar, sin nombres. null si no está montada o ningún apartado depende de lo que cambió.
  desfase: { secciones: string[]; apartados: number[] } | null;
};

const log = logger('licitaciones.memoria');

// El trabajo de la fase en curso (o su reintento) que espera turno o corre en Hermes.
function trabajoDeLaFase(db: Db, m: FilaMemoria, fase: FaseMemoria): EnCurso | null {
  if (!FASES_CON_TRABAJO.includes(fase)) return null;
  const base = claveDeFase(m, fase as FaseConTrabajo);
  const t = db
    .prepare(
      `SELECT estado, actualizado_en FROM nucleo.trabajos_ia WHERE (clave = @base OR (clave >= @desde AND clave < @hasta))
    AND estado IN ('pendiente', 'lanzado') ORDER BY id DESC LIMIT 1`,
    )
    .get({ base, desde: `${base}-r`, hasta: `${base}-s` }) as { estado: string; actualizado_en: string } | undefined;
  return t ? { estado: t.estado === 'lanzado' ? 'generando' : 'en_cola', desde: t.actualizado_en } : null;
}

function restaurados(db: Db, m: FilaMemoria, filas: FilaRonda[]): number[] {
  const mem = guionPorId(db, m.guion_id)?.datos.memoria;
  if (!mem) return [];
  const r = guardaRegresiones(filas, mem, m.ronda, obsoletasDe(db, m.id));
  return [...r.bloqueados, ...r.reintentos].sort((a, b) => a - b);
}

function criticasWeb(db: Db, m: FilaMemoria, filas: FilaRonda[]): CriticaWeb[] {
  const sinMotivos: MotivosMarcados = { motivos: [], falta: [] };
  return criticasDe(db, m.id).map((c) => ({
    ronda: c.ronda,
    total: c.total,
    maximo: c.maximo,
    independiente: c.independiente,
    ciega: c.ciega,
    avisos: c.avisos,
    apartados: c.datos.apartados.map((x) => {
      const f = filas.find((y) => y.apartado === x.apartado && y.ronda === c.ronda);
      return {
        apartado: x.apartado,
        tramo: x.tramo,
        puntos: x.puntos,
        ...(f ? motivosMarcados(filas, f) : sinMotivos),
      };
    }),
  }));
}

const SITUACION: Record<FaseMemoria, string> = {
  dossier: 'componiendo el dossier',
  estrategia: 'Hermes piensa la estrategia',
  ficha: 'ficha de solución pendiente de revisión',
  redaccion: 'Hermes redacta la memoria',
  critica: 'el crítico ciego la puntúa',
  hechos: 'Hermes corrige los hechos que cita el crítico antes de reescribir',
  fin: 'ensamblando el documento',
};

// Los euros se calculan aquí, al enseñarlos, y no se guardan: ni la ficha, ni la solución, ni la
// hoja de hechos los llevan, así que la redacción y el crítico no pueden copiarlos a la memoria.
function conEuros(c: CampoFicha, s: SolucionData | undefined, precioHora: number | null): CampoWeb {
  const horas = s && precioHora ? compromisoDeCampo(c.clave, s)?.horas : null;
  return horas && precioHora ? { ...c, euros: Math.round(horas * precioHora) } : c;
}

function fichaWeb(f: FichaSolucion | null, s: SolucionData | undefined, precioHora: number | null): FichaWeb | null {
  if (!f) return null;
  const estado = estadoFicha(f) as FichaWeb['estado'];
  return {
    ...f,
    estado,
    campos: f.campos.map((c) => conEuros(c, s, precioHora)),
    no_revisados: estado === 'vencida' ? f.campos.map((c) => c.clave) : f.no_revisados,
  };
}

function situacion(fase: FaseMemoria, f: FichaWeb | null): string {
  if (fase === 'ficha' && f)
    return `${SITUACION.ficha}: una persona acepta o edita los valores en la web (si no, se redacta con lo propuesto a partir del ${f.vence_en.slice(0, 16).replace('T', ' ')} UTC)`;
  return SITUACION[fase];
}

function desfaseWeb(db: Db, m: FilaMemoria): ProgresoMemoria['desfase'] {
  const r = desfaseMemoria(db, nucleo().db, m.id);
  if (r.error) {
    log.warn('desfase de la memoria sin calcular', { memoria: m.id, motivo: r.error.message });
    return null;
  }
  // Sin apartados afectados no hay nada que actualizar: avisar sería un aviso que nunca se quita.
  return r.data?.secciones.length && r.data.apartados.length
    ? { secciones: r.data.secciones, apartados: r.data.apartados }
    : null;
}

/**
 * El estado de una memoria para la web y las tools. `paraPersona`: con los euros de los
 * compromisos en la ficha; solo la web lo pide, por defecto no (las tools las leen agentes).
 */
export function progresoDe(db: Db, m: FilaMemoria, paraPersona = false): ProgresoMemoria {
  const fase = faseDe(m);
  const d = dossierDe(db, m.id);
  const e = estrategiaDe(db, m.id);
  const filas = filasDeRondas(db, m.id);
  const { licitaciones } = nucleo().config;
  const ficha = fichaWeb(fichaDe(db, m.id), e?.datos.solucion, paraPersona ? licitaciones.precioHora : null);
  return {
    fase,
    ronda: m.ronda,
    max_rondas: licitaciones.memoriaRondas,
    umbral: licitaciones.memoriaUmbral,
    trabajo: trabajoDeLaFase(db, m, fase),
    situacion: situacion(fase, ficha),
    ficha,
    dossier: d
      ? {
          ruta_md: d.ruta_md,
          caracteres: d.caracteres,
          equipo_por_roles: d.equipo_por_roles,
          recortadas: d.secciones.filter((s) => s.truncado).map((s) => s.titulo),
        }
      : null,
    estrategia: e
      ? {
          ruta_md: e.ruta_md,
          creada_en: e.creada_en,
          avisos: e.avisos,
          hechos: e.datos.hechos.map(({ clave, categoria, sobre, valor }) => ({ clave, categoria, sobre, valor })),
        }
      : null,
    criticas: criticasWeb(db, m, filas),
    restaurados: restaurados(db, m, filas),
    parches: parchesDe(db, m.id),
    coherencia: hallazgosDe(m).map((h) => ({ ...h, texto: textoDeHallazgo(h, e?.datos.hechos ?? []) })),
    desfase: desfaseWeb(db, m),
  };
}

// La ficha enseña la hoja de hechos (sus campos propios y los hechos atados a cada campo): fuera,
// como la hoja; un valor de antes de una ronda, también.
// Sin euros: las tools las leen agentes, y ningún importe puede acercarse a la memoria.
function campoSinNombres(c: CampoWeb): CampoWeb {
  const { hechos: _hechos, ronda, euros: _euros, ...resto } = c;
  return {
    ...resto,
    ...(c.clave.startsWith(PREFIJO_HECHO) ? { valor: '', propuesto: '' } : {}),
    ...(ronda ? { ronda: { n: ronda.n, antes: '' } } : {}),
  };
}

/** Sin lo que puede nombrar a personas (la hoja de hechos y las citas), para agentes sin permiso sobre colaboradores. */
export function progresoSinNombres(v: ProgresoMemoria): ProgresoMemoria {
  return {
    ...v,
    estrategia: v.estrategia ? { ...v.estrategia, hechos: [] } : null,
    ficha: v.ficha
      ? {
          ...v.ficha,
          revisada_por: v.ficha.revisada_por ? 'una persona del equipo' : null,
          campos: v.ficha.campos.map(campoSinNombres),
        }
      : null,
    coherencia: v.coherencia.map((h) => ({ ...h, cita: '', encontrado: '', esperado: '', texto: '' })),
    parches: v.parches.map((p) => ({
      ...p,
      pedidos: p.pedidos.map((x) => ({ ...x, valor: '', motivos: [] })),
      cambios: p.cambios.map((c) => ({ ...c, antes: '', despues: '', motivo: '' })),
    })),
    // Las citas, los motivos y los arreglos copian el texto de la memoria, que puede nombrar al equipo.
    criticas: v.criticas.map((c) => ({
      ...c,
      apartados: c.apartados.map((x) => ({
        ...x,
        motivos: x.motivos.map((mo) => ({ ...mo, cita: '', motivo: '', arreglo: '' })),
        falta: x.falta.map((f) => ({ ...f, texto: '' })),
      })),
    })),
  };
}
