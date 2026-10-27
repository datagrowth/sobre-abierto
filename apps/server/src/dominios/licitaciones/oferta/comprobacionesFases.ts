// Carril de fases de las comprobaciones: estado, no navegación. «Hecho» solo con la fase
// completa y comprobada en las entradas: con un precio pendiente, Decisiones no está hecha. Puro.
import { TIPO_FICHA } from '../ficha.js';
import { memoriasEvaluadas, type EntradasComprobaciones, type TrabajoEnCurso } from './comprobacionesEntradas.js';
import type { Actor, Bloqueo, Categoria, EnVivo, Fase, NombreFase } from './comprobacionesTipos.js';
import { TIPO_ANEXO } from './anexosTrabajo.js';
import { preciosDecididos } from './comprobacionesReglasDecisiones.js';
import { TIPO_MEMORIA_CRITICA } from './critica.js';
import { TIPO_MEMORIA_ESTRATEGIA } from './estrategia.js';
import { TIPO_GUION } from './guion.js';
import { TIPO_MEMORIA_HECHOS } from './parcheHechos.js';
import type { EstadoMemoria } from './memoria.js';
import { DURACION_MIN, type TrabajoOferta } from './plazo.js';
import { TIPO_PROPUESTA_DECISIONES } from './propuestaDecisiones.js';
import { TIPO_MEMORIA_REDACCION } from './redaccion.js';

const NOMBRES_FASE: readonly NombreFase[] = [
  'decidir',
  'pliegos',
  'guion',
  'decisiones',
  'memoria',
  'documentos',
  'paquete',
  'presentar',
];

type EstadoFase = Fase['estado'];

// Quién mueve cada fase cuando le toca: Hermes baja, extrae, redacta y monta; la persona decide y presenta.
const ACTOR_FASE: Record<NombreFase, Actor> = {
  decidir: 'tu',
  pliegos: 'hermes',
  guion: 'hermes',
  decisiones: 'tu',
  memoria: 'hermes',
  documentos: 'tu',
  paquete: 'hermes',
  presentar: 'tu',
};

// El trabajo de Hermes que mueve cada fase y lo que tarda (plazo.ts): de ahí sale la hora estimada.
// Se arma al primer uso y no al cargar: los anexos llegan a este módulo por un ciclo de imports
// (decisionesSecciones → oportunidades → preparacion) y aún no ha definido TIPO_ANEXO.
type TrabajoDeFase = { fase: NombreFase; duracion: TrabajoOferta };
let cacheTrabajos: Record<string, TrabajoDeFase> | null = null;
const trabajosPorTipo = (): Record<string, TrabajoDeFase> =>
  (cacheTrabajos ??= {
    [TIPO_FICHA]: { fase: 'decidir', duracion: 'ficha' },
    [TIPO_GUION]: { fase: 'guion', duracion: 'guion' },
    [TIPO_PROPUESTA_DECISIONES]: { fase: 'decisiones', duracion: 'decisiones' },
    [TIPO_MEMORIA_ESTRATEGIA]: { fase: 'memoria', duracion: 'memoria' },
    [TIPO_MEMORIA_REDACCION]: { fase: 'memoria', duracion: 'memoria' },
    [TIPO_MEMORIA_CRITICA]: { fase: 'memoria', duracion: 'memoria' },
    [TIPO_MEMORIA_HECHOS]: { fase: 'memoria', duracion: 'memoria' },
    [TIPO_ANEXO]: { fase: 'documentos', duracion: 'anexo' },
  });

const FASE_DE_CATEGORIA: Record<Categoria, NombreFase> = {
  elegibilidad: 'decidir',
  precio: 'decisiones',
  decisiones: 'decisiones',
  coherencia: 'memoria',
  fugas: 'memoria',
  documentos: 'documentos',
  empresa: 'documentos',
  firma: 'paquete',
  // Un hito vencido (hitos.ts) no es de ninguna fase: se calcula con las fases ya hechas.
  plazo: 'presentar',
};

// Las incoherencias de pliegos y de guion caen en Elegibilidad o Decisiones, pero las mueve su propia fase.
export function faseDeBloqueo(b: Pick<Bloqueo, 'categoria' | 'accion'>): NombreFase {
  if (b.accion.destino === 'pliegos') return 'pliegos';
  if (b.accion.destino === 'guion') return 'guion';
  return FASE_DE_CATEGORIA[b.categoria];
}

const abierto = (b: Bloqueo): boolean => b.estado === 'abierto' || b.estado === 'propuesta';
const PRESENTADA: ReadonlySet<string> = new Set(['presentada', 'ganada', 'perdida']);
const MIN_MS = 60_000;

type Contexto = {
  e: EntradasComprobaciones;
  todos: readonly Bloqueo[];
  abiertos: readonly Bloqueo[];
  enCurso: ReadonlySet<NombreFase>;
};
const abiertosDe = (c: Contexto, fase: NombreFase): Bloqueo[] => c.abiertos.filter((b) => faseDeBloqueo(b) === fase);

function decidir(c: Contexto): EstadoFase {
  // «Vamos» ya viene aplicado a la fila solo si su huella sigue siendo la de ahora (comprobaciones.ts).
  const conVamos = c.todos.some((b) => b.estado === 'vamos');
  const enMarcha = c.e.oportunidad?.estado === 'en_preparacion' || PRESENTADA.has(c.e.oportunidad?.estado ?? '');
  if ((conVamos || enMarcha) && !abiertosDe(c, 'decidir').length) return 'hecho';
  if (c.enCurso.has('decidir')) return 'en_curso';
  return 'te_toca';
}

// Lo que falta bajar a mano lo dice la coherencia («no se ha bajado»); el aviso de sin comprobar solo deja la fase pendiente.
function pliegos(c: Contexto): EstadoFase {
  const suyos = abiertosDe(c, 'pliegos');
  const fichaAnterior = c.abiertos.some((b) => b.clave.startsWith('ficha_anterior_rectificacion:'));
  if (c.e.pliegos.length && !suyos.length && !fichaAnterior) return 'hecho';
  return suyos.some((b) => /no se ha(n)? bajado/i.test(b.titulo)) ? 'te_toca' : 'pendiente';
}

function guion(c: Contexto): EstadoFase {
  if (c.enCurso.has('guion')) return 'en_curso';
  return c.e.guion ? 'hecho' : 'pendiente';
}

function decisiones(c: Contexto): EstadoFase {
  const { guion: g, decisiones: d, propuesta: p } = c.e;
  if (!g) return 'pendiente';
  const propuestaNueva = p !== null && (!d || p.creada_en > d.actualizada_en);
  // Un precio decidido que la coherencia da por anormal o por encima del máximo tampoco está decidido.
  const impide = abiertosDe(c, 'decisiones').some((b) => b.gravedad === 'impide');
  if (d && d.guion_id === g.id && preciosDecididos(c.e) && !propuestaNueva && !impide) return 'hecho';
  return c.enCurso.has('decisiones') ? 'en_curso' : 'te_toca';
}

function estadoMemoria(c: Contexto, m: EstadoMemoria | null): EstadoFase {
  if (c.enCurso.has('memoria') || m?.estado === 'redactando' || m?.estado === 'ensamblando') return 'en_curso';
  if (!c.e.guion || !m || m.estado !== 'ensamblada' || m.guion_cambiado) return 'pendiente';
  return m.borrador?.estado === 'aceptada' ? 'hecho' : 'te_toca';
}

// Con memoria por lote, la de cada lote (memoriasEvaluadas, como el MCP): solo está hecha si todas
// lo están; lo que te toca en un lote manda sobre lo que Hermes aún hace en otro.
const ORDEN_MEMORIA: readonly EstadoFase[] = ['te_toca', 'en_curso', 'pendiente', 'hecho'];

function memoria(c: Contexto): EstadoFase {
  if (c.e.guion && c.e.guion.datos.memoria === null) return 'no_aplica';
  const estados = memoriasEvaluadas(c.e).map((x) => estadoMemoria(c, x.memoria));
  return ORDEN_MEMORIA.find((s) => estados.includes(s)) ?? 'pendiente';
}

// Los obligatorios del ámbito son los del guion para los lotes que van (comprobacionesEntradas): todos preparados o que no aplican.
function documentos(c: Contexto): EstadoFase {
  const { filas, del_guion } = c.e.documentos;
  if (!c.e.guion) return 'pendiente';
  const estado = (clave: string) => filas.find((f) => f.clave === clave)?.estado ?? 'pendiente';
  const obligatorios = del_guion.filter((x) => x.doc.obligatorio);
  if (obligatorios.every((x) => ['preparado', 'no_aplica'].includes(estado(x.clave)))) return 'hecho';
  if (c.enCurso.has('documentos')) return 'en_curso';
  const aMano = obligatorios.some(
    (x) => estado(x.clave) === 'borrador' || (estado(x.clave) === 'pendiente' && x.doc.produce === 'persona'),
  );
  return aMano ? 'te_toca' : 'pendiente';
}

const sinImpide = (c: Contexto): boolean => !c.abiertos.some((b) => b.gravedad === 'impide');
const paqueteListo = (c: Contexto): boolean =>
  c.e.paquete !== null && !c.e.paquete.desfasado && c.e.paquete.bloqueos === 0 && sinImpide(c);

function presentar(c: Contexto): EstadoFase {
  if (PRESENTADA.has(c.e.oportunidad?.estado ?? '')) return 'hecho';
  return paqueteListo(c) ? 'te_toca' : 'pendiente';
}

const ESTADO_FASE: Record<NombreFase, (c: Contexto) => EstadoFase> = {
  decidir,
  pliegos,
  guion,
  decisiones,
  memoria,
  documentos,
  paquete: (c) => (paqueteListo(c) ? 'hecho' : 'pendiente'),
  presentar,
};

// El trabajo de la fase que lleva más tiempo en marcha: desde su último paso más lo que tarda su tipo.
function etaDe(trabajos: readonly TrabajoEnCurso[], fase: NombreFase): Fase['eta'] {
  const t = trabajos.find((x) => trabajosPorTipo()[x.tipo]?.fase === fase);
  const desde = t ? Date.parse(t.actualizado_en) : NaN;
  if (!t || Number.isNaN(desde)) return null;
  const minutos = DURACION_MIN[trabajosPorTipo()[t.tipo]!.duracion];
  return { desde: new Date(desde).toISOString(), hasta: new Date(desde + minutos * MIN_MS).toISOString() };
}

// Una fase que aún no está hecha ni en marcha queda bloqueada si la anterior tiene un «impide» abierto.
function conBloqueo(estado: EstadoFase, anterior: NombreFase | undefined, c: Contexto): EstadoFase {
  if (!anterior || (estado !== 'pendiente' && estado !== 'te_toca')) return estado;
  return abiertosDe(c, anterior).some((b) => b.gravedad === 'impide') ? 'bloqueado' : estado;
}

export function fasesDe(e: EntradasComprobaciones, bloqueos: readonly Bloqueo[]): Fase[] {
  const enCurso = new Set(e.trabajos.flatMap((t) => trabajosPorTipo()[t.tipo]?.fase ?? []));
  const c: Contexto = { e, todos: bloqueos, abiertos: bloqueos.filter(abierto), enCurso };
  return NOMBRES_FASE.map((nombre, i) => {
    const estado = conBloqueo(ESTADO_FASE[nombre](c), NOMBRES_FASE[i - 1], c);
    return { nombre, estado, actor: ACTOR_FASE[nombre], eta: estado === 'en_curso' ? etaDe(e.trabajos, nombre) : null };
  });
}

const enVivoDe = (t: TrabajoEnCurso): EnVivo => ({
  tipo: t.tipo,
  estado: t.estado === 'lanzado' ? 'generando' : 'en_cola',
  desde: t.lanzado_en ?? t.creado_en,
  ...(t.pedido_por_hermes ? { pedido_por_hermes: true as const } : {}),
});

/** Lo que Hermes tiene entre manos en esta oferta: el trabajo en curso más antiguo. */
export function hermesEnVivo(e: Pick<EntradasComprobaciones, 'trabajos'>): EnVivo | null {
  const t = [...e.trabajos].sort((a, b) => a.creado_en.localeCompare(b.creado_en) || a.id - b.id)[0];
  return t ? enVivoDe(t) : null;
}
