// Los compromisos de una memoria que cuestan dinero al ejecutar el contrato, con su coste y si los exige el pliego.
import type { PerfilCostesData } from '../../../nucleo/perfilCostes.js';
import { lotesMencionados } from './lotesMencionados.js';
import type { Pasaje } from '../pasajes.js';
import { raices } from './compromisosMemoria.js';
import type { ClaseCompromiso, CompromisoConCoste } from './compromisosMemoriaCoste.js';
import type { CompromisoData } from './compromisosSolucion.js';
import {
  CONCRECION_MINIMA,
  decimal,
  detectar,
  formulacionBarata,
  magnitudTexto,
  menosEsMas,
  normal,
  objetosNombrados,
  VECES_POR_SEMANA,
  type Deteccion,
  type FraseCostes,
  type TipoCompromiso,
} from './costesCatalogo.js';
import {
  dimensiones,
  fuenteDoc,
  subgruposDe,
  unidadesNombradas,
  type Dimensiones,
  type UnidadCoste,
} from './costesDimensiones.js';
import { lineasParaCostes, type LineaCostes } from './costesTexto.js';
import type { GuionBaseData } from './guion.js';

export type { ClaseCompromiso, CompromisoConCoste };
/** El guion tal como lo acordamos con la memoria: en el repo es GuionBaseData. */
export type GuionData = GuionBaseData;

// Una memoria puede prometer kits a cada alumna, 3,5 h fijas por subgrupo y semana o una entrevista con cada
// alumna apta: cientos de horas que el pliego no pedía. Aquí se orquesta: se leen las frases (costesTexto), se
// detectan con el catálogo (costesCatalogo), se agrupan las que dicen lo mismo (la tabla resumen y el cuerpo), se
// cotejan con el pliego y se calculan con las dimensiones del contrato (costesDimensiones). Los euros son solo
// para la web: lo que lee un agente se queda en horas (compromisosMemoriaCoste.ts). Puro.
// seccion: «1.2» si la memoria numera con punto (la instrucción la nombra así); apartado: el del guion.
export type Aparicion = { cita: string; apartado: number | null; seccion?: string };
type CitaPliego = { cita: string; documento: string; pagina: number | null };
/** Lo que necesitan las comprobaciones, el resumen y el MCP además del contrato. */
export type CompromisoDetallado = CompromisoConCoste & {
  tipo: TipoCompromiso;
  objeto: string;
  barata: string;
  instruccion: string;
  unidades: number;
  apariciones: Aparicion[];
  pliego: CitaPliego | null;
};

/**
 * El pliego para cotejar: los pasajes con obligaciones y si se pudo leer. Un pliego legible puede
 * no tener ningún pasaje que obligue: entonces nada es exigido («El pliego no lo pide»), no
 * «sin cotejar». Una lista sola vale como cotejable si trae algún pasaje.
 */
export type PliegoCostes = Pasaje[] | { pasajes: Pasaje[]; cotejable: boolean };
const delPliego = (p: PliegoCostes | undefined): { pasajes: Pasaje[]; cotejable: boolean } =>
  Array.isArray(p) ? { pasajes: p, cotejable: p.length > 0 } : (p ?? { pasajes: [], cotejable: false });

const SIN_COTEJAR = 'Sin cotejar con el pliego';
const VINETA = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/;
const FRASES = /(?<=[.;!?])\s+(?=[\p{Lu}¿¡«(\d-])/u;

// ── Frases ──

function frasesDeLinea(l: LineaCostes): FraseCostes[] {
  const contexto = normal(l.contexto);
  if (l.celdas)
    return [{ cita: l.celdas.join(' | '), norm: normal(l.celdas.join(' | ')), celdas: l.celdas, contexto, linea: l }];
  return l.texto
    .replace(VINETA, '')
    .split(FRASES)
    .filter((f) => f.trim())
    .map((f) => ({ cita: f.trim(), norm: normal(f), celdas: null, contexto, linea: l }));
}

function frasesDePasaje(p: Pasaje): FraseCostes[] {
  return p.texto
    .replace(/\s*\n\s*/g, ' ')
    .split(FRASES)
    .filter((f) => f.trim())
    .map((f) => ({ cita: f.trim(), norm: normal(f), celdas: null, contexto: '', linea: null }));
}

// En una fila, la celda que lleva la cifra («2 h 30 min por subgrupo»), no la fila entera.
function citaDe(f: FraseCostes, ancla: string): string {
  if (!f.celdas) return f.cita;
  return f.celdas.find((c) => normal(c).includes(ancla)) ?? f.cita;
}

// ── Agrupar ──

type Hallazgo = { d: Deteccion; f: FraseCostes; cita: string };

// Un informe mensual y uno semanal son dos compromisos distintos.
const clave = (d: Deteccion) => `${d.tipo}|${d.objeto}${d.tipo === 'frecuencia_alta' ? `|${d.frecuencia}` : ''}`;

function agrupar(hs: Hallazgo[]): Hallazgo[][] {
  const grupos = new Map<string, Hallazgo[]>();
  for (const h of hs) grupos.set(clave(h.d), [...(grupos.get(clave(h.d)) ?? []), h]);
  return [...grupos.values()];
}

// Las filas de una misma tabla de dedicación se suman (corrección + debate + seguimiento por subgrupo).
function dedicacionTotal(g: Hallazgo[]): number {
  const porTabla = new Map<string, number>();
  g.forEach((h, i) => {
    const k = h.f.linea?.tabla != null ? `t${h.f.linea.tabla}` : `l${i}`;
    porTabla.set(k, (porTabla.get(k) ?? 0) + h.d.magnitud);
  });
  return Math.max(...porTabla.values());
}

// ¿b compromete más que a? A igual magnitud, la que dice «por curso»: se multiplica por los cursos.
function comprometeMas(tipo: TipoCompromiso, a: Hallazgo, b: Hallazgo): boolean {
  if (b.d.magnitud === a.d.magnitud) return Boolean(b.d.porCurso) && !a.d.porCurso;
  return menosEsMas(tipo) ? b.d.magnitud < a.d.magnitud : b.d.magnitud > a.d.magnitud;
}

// Lo que más compromete del grupo (en los plazos, el más corto), con la magnitud del grupo.
// Una duración escrita pesa más que la supuesta («consulta de media hora» frente a «la consulta»).
function representante(g: Hallazgo[]): Hallazgo {
  const tipo = g[0]!.d.tipo;
  const explicitas = g.filter((h) => h.d.explicita);
  const mejor = (explicitas.length ? explicitas : g).reduce((a, b) => (comprometeMas(tipo, a, b) ? b : a));
  return tipo === 'dedicacion_fija' ? { ...mejor, d: { ...mejor.d, magnitud: dedicacionTotal(g) } } : mejor;
}

function apariciones(g: Hallazgo[]): Aparicion[] {
  const vistas = new Set<string>();
  return g.flatMap((h) => {
    if (vistas.has(h.cita)) return [];
    vistas.add(h.cita);
    const seccion = h.f.linea?.seccion;
    return [{ cita: h.cita, apartado: h.f.linea?.apartado ?? null, ...(seccion ? { seccion } : {}) }];
  });
}

// ── Pliego ──

type Pliego = {
  cotejable: boolean;
  detecciones: { d: Deteccion; cita: CitaPliego }[];
  nombrados: { tipo: TipoCompromiso; objeto: string; rotulo: string; cita: CitaPliego }[];
};

// Los lotes que existen no los sabe el guion: con los números habituales basta para reconocer «lotes 1 y 2».
const LOTES_POSIBLES = Array.from({ length: 30 }, (_, i) => String(i + 1));

// Un pasaje que solo habla de otros lotes no obliga en el lote de la empresa: un «material
// fungible» de los lotes presenciales no cubre los kits de otro lote.
function pasajesPropios(pliego: Pasaje[], guion: GuionBaseData | undefined): Pasaje[] {
  const propios = guion?.lotes ?? [];
  if (!propios.length) return pliego;
  const existentes = [...new Set([...LOTES_POSIBLES, ...propios])];
  return pliego.filter((p) => {
    const nombra = lotesMencionados(p.texto, existentes);
    return !nombra.length || nombra.some((l) => propios.includes(l));
  });
}

function leerPliego(pliego: { pasajes: Pasaje[]; cotejable: boolean }, guion: GuionBaseData | undefined): Pliego {
  const ps = pasajesPropios(pliego.pasajes, guion);
  const frases = ps.flatMap((p) =>
    frasesDePasaje(p).map((f) => ({
      f,
      cita: { cita: f.cita, documento: fuenteDoc(p.ruta.split('/').at(-1) ?? p.ruta, null), pagina: p.pagina },
    })),
  );
  return {
    cotejable: pliego.cotejable,
    detecciones: frases.flatMap(({ f, cita }) => detectar(f).map((d) => ({ d, cita }))),
    nombrados: frases.flatMap(({ f, cita }) => objetosNombrados(f.norm).map((n) => ({ ...n, cita }))),
  };
}

// ── Exigido o añadido ──

type Cotejo = { clase: ClaseCompromiso; nota: string; pliego: CitaPliego | null };

const SINONIMOS: Record<string, string> = {
  sesion: 'tutoria',
  videollamada: 'llamada',
  tutoria_individual: 'entrevista',
};
const canonico = (o: string) => SINONIMOS[o] ?? o;
const comunes = (a: string, b: string) => {
  const rb = raices(b);
  return [...raices(a)].filter((r) => rb.has(r)).length;
};
const mismoObjeto = (
  a: { tipo: TipoCompromiso; objeto: string; rotulo: string },
  b: { tipo: TipoCompromiso; objeto: string; rotulo: string },
) => a.tipo === b.tipo && (canonico(a.objeto) === canonico(b.objeto) || comunes(a.rotulo, b.rotulo) >= 2);
const cubre = (tipo: TipoCompromiso, pide: number, nuestra: number) =>
  menosEsMas(tipo) ? pide <= nuestra : pide >= nuestra;

function conDeteccion(d: Deteccion, p: Pliego): Cotejo | null {
  const iguales = p.detecciones.filter((x) => mismoObjeto(x.d, d));
  if (!iguales.length) return null;
  const pide = iguales.reduce((a, b) => (cubre(d.tipo, b.d.magnitud, a.d.magnitud) ? b : a));
  if (cubre(d.tipo, pide.d.magnitud, d.magnitud))
    return { clase: 'exigido', nota: `El pliego pide ${magnitudTexto(d.tipo, pide.d.magnitud)}`, pliego: pide.cita };
  return {
    clase: 'anadido',
    nota: `El pliego pide ${magnitudTexto(d.tipo, pide.d.magnitud)}; la memoria, ${magnitudTexto(d.tipo, d.magnitud)}`,
    pliego: pide.cita,
  };
}

// El pliego lo nombra sin cifra («las tutorías que se establezcan»): solo lo mínimo es exigido.
function conNombrado(d: Deteccion, p: Pliego, perfil: PerfilCostesData): Cotejo | null {
  const n = p.nombrados.find((x) => mismoObjeto(x, d));
  if (!n) return null;
  const min =
    d.tipo === 'plazo_corto'
      ? { magnitud: perfil.plazo_referencia_dias, texto: `${perfil.plazo_referencia_dias} días hábiles` }
      : CONCRECION_MINIMA[d.tipo];
  if (min && cubre(d.tipo, min.magnitud, d.magnitud))
    return {
      clase: 'exigido',
      nota: `El pliego lo pide sin cifra; se concreta en lo mínimo (${min.texto})`,
      pliego: n.cita,
    };
  const minimo = min ? `lo mínimo es ${min.texto}` : 'cualquier cifra es añadida';
  return {
    clase: 'anadido',
    nota: `El pliego lo pide sin cifra (${minimo}); la memoria, ${magnitudTexto(d.tipo, d.magnitud)}`,
    pliego: n.cita,
  };
}

function cotejar(d: Deteccion, p: Pliego, perfil: PerfilCostesData): Cotejo {
  if (!p.cotejable) return { clase: 'anadido', nota: SIN_COTEJAR, pliego: null };
  return (
    conDeteccion(d, p) ?? conNombrado(d, p, perfil) ?? { clase: 'anadido', nota: 'El pliego no lo pide', pliego: null }
  );
}

// El curso del que habla «en dos grupos» (el primero si no nombra ninguno).
const cursoDe = (h: Hallazgo, dims: Dimensiones): UnidadCoste =>
  unidadesNombradas(`${h.f.cita} ${h.f.contexto}`, dims.unidades)[0]?.unidad ?? dims.unidades[0]!;
const grupoDelPliego = (u: UnidadCoste) => !u.grupos.fuente.startsWith('supuesto') && u.grupos.fuente !== 'memoria';

// Un grupo que el alcance (literal del pliego) ya pide no es extra.
function grupoDelAlcance(h: Hallazgo, dims: Dimensiones): Cotejo | null {
  if (h.d.tipo !== 'grupo_extra') return null;
  const u = cursoDe(h, dims);
  return grupoDelPliego(u) && u.grupos.valor >= h.d.magnitud
    ? { clase: 'exigido', nota: `El alcance pide ${u.grupos.valor} grupos (${u.grupos.fuente})`, pliego: null }
    : null;
}

// ── Coste ──

type Coste = { horas: number | null; unidades: number; eurosUnidad: number; supuesto: string };
type Calculo = { h: Hallazgo; dims: Dimensiones; perfil: PerfilCostesData };

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fuentes = (vs: { fuente: string }[]) => [...new Set(vs.map((v) => v.fuente))].join('; ');
const personasDe = (us: UnidadCoste[]) => suma(us.map((u) => u.personas?.valor ?? 0));
// De dónde salen las personas, las semanas y los grupos, para el supuesto.
const dePersonas = (us: UnidadCoste[]) => fuentes(us.flatMap((u) => (u.personas ? [u.personas] : [])));
const deSemanas = (us: UnidadCoste[]) => fuentes(us.map((u) => u.semanas));
const deGrupos = (us: UnidadCoste[]) => fuentes(us.map((u) => u.grupos));
const semanasAula = (us: UnidadCoste[]) => suma(us.map((u) => u.grupos.valor * u.semanas.valor));
const cursos = (n: number) => `${n} ${n === 1 ? 'curso' : 'cursos'}`;
const enHoras = (horas: number, supuesto: string): Coste => ({ horas, unidades: 0, eurosUnidad: 0, supuesto });
const sinPersonas = (d: Dimensiones): Coste => ({
  horas: null,
  unidades: 0,
  eurosUnidad: 0,
  supuesto: `Sin el número de ${d.personas}: falta el alcance en el guion`,
});

// Los cursos que nombra el compromiso (o todos), con el desglose para el supuesto.
function cursosDe(c: Calculo): { us: UnidadCoste[]; desglose: string } {
  const nombradas = unidadesNombradas(`${c.h.f.cita} ${c.h.f.contexto}`, c.dims.unidades);
  if (!nombradas.length || nombradas.length === c.dims.unidades.length)
    return { us: c.dims.unidades, desglose: dePersonas(c.dims.unidades) };
  const us = nombradas.map((n) => n.unidad);
  const partes = nombradas.map(({ unidad, palabra }) => `${palabra} ${unidad.personas?.valor ?? '?'}`).join(' + ');
  return { us, desglose: `${dePersonas(us)}: ${partes}` };
}

function costeMaterial(c: Calculo): Coste {
  const { us, desglose } = cursosDe(c);
  const p = personasDe(us);
  if (!p) return sinPersonas(c.dims);
  const { euros_material_por_persona: m, euros_envio_por_persona: e } = c.perfil;
  const supuesto = `${p} ${c.dims.personas} (${desglose}) × (${decimal(m)} + ${decimal(e)}) por ${c.dims.persona}: material y envío (perfil de costes)`;
  return { horas: null, unidades: p, eurosUnidad: m + e, supuesto };
}

const UNIDAD_DEDICACION = { subgrupo: 'subgrupo', aula: 'aula', alumna: 'persona' } as const;

function unidadesSemana(u: keyof typeof UNIDAD_DEDICACION, x: UnidadCoste, d: Dimensiones): number {
  const n = u === 'subgrupo' ? subgruposDe(x, d) : u === 'aula' ? x.grupos.valor : (x.personas?.valor ?? 0);
  return n * x.semanas.valor;
}

function costeDedicacion(c: Calculo): Coste {
  const u = c.h.d.unidad ?? 'subgrupo';
  const us = c.dims.unidades;
  if (u !== 'aula' && !personasDe(us)) return sinPersonas(c.dims);
  const n = suma(us.map((x) => unidadesSemana(u, x, c.dims)));
  const base =
    u === 'aula'
      ? `grupos: ${deGrupos(us)}`
      : `subgrupos de ${c.dims.subgrupo.valor} (${c.dims.subgrupo.fuente}) sobre ${personasDe(us)} ${c.dims.personas} (${dePersonas(us)})`;
  const nombre = UNIDAD_DEDICACION[u];
  return enHoras(
    c.h.d.magnitud * n,
    `${decimal(c.h.d.magnitud)} h por ${nombre} y semana × ${n} semanas de ${nombre} (${base}; semanas: ${deSemanas(us)})`,
  );
}

function costePlazo(c: Calculo): Coste {
  const us = c.dims.unidades;
  const entregas = suma(us.map((u) => (u.personas?.valor ?? 0) * u.semanas.valor));
  if (!entregas) return sinPersonas(c.dims);
  const min = c.perfil.minutos_extra_comentario;
  const base = `1 por ${c.dims.persona} y semana; ${c.dims.personas}: ${dePersonas(us)}; semanas: ${deSemanas(us)}`;
  return enHoras(
    (entregas * min) / 60,
    `${entregas} entregas (${base}) × ${decimal(min)} min más por entrega (perfil de costes)`,
  );
}

function costeRecurrente(c: Calculo): Coste {
  const us = c.dims.unidades;
  const sa = semanasAula(us);
  const frecuencia = c.h.d.frecuencia ?? 'semanal';
  const veces = Math.ceil(VECES_POR_SEMANA[frecuencia] * sa);
  const h = c.h.d.horas ?? 1;
  return enHoras(
    h * veces,
    `${decimal(h)} h × ${veces} sesiones (${frecuencia} en ${sa} semanas de aula; grupos: ${deGrupos(us)}; semanas: ${deSemanas(us)})`,
  );
}

function fraccionDe(c: Calculo): { f: number; texto: string } {
  if (c.h.d.fraccion === 'aptas')
    return { f: c.perfil.fraccion_aptas, texto: ` × ${decimal(c.perfil.fraccion_aptas)} (aptas, perfil de costes)` };
  if (c.h.d.fraccion === 'ruta_apoyo')
    return {
      f: c.perfil.fraccion_ruta_apoyo,
      texto: ` × ${decimal(c.perfil.fraccion_ruta_apoyo)} (ruta de apoyo, perfil de costes)`,
    };
  return { f: 1, texto: '' };
}

function costeIndividual(c: Calculo): Coste {
  const p = personasDe(c.dims.unidades);
  if (!p) return sinPersonas(c.dims);
  const { f, texto } = fraccionDe(c);
  const min = (c.h.d.horas ?? 0.5) * 60;
  const prep = c.perfil.minutos_preparacion_individual;
  return enHoras(
    (p * f * (min + prep)) / 60,
    `${p} ${c.dims.personas} (${dePersonas(c.dims.unidades)})${texto} × (${decimal(min)} min + ${decimal(prep)} min de preparación)`,
  );
}

function costeMinimo(c: Calculo): Coste {
  const n = c.h.d.porCurso ? c.dims.unidades.length : 1;
  const hc = c.perfil.horas_por_contacto;
  return enHoras(
    c.h.d.magnitud * n * hc,
    `${c.h.d.magnitud} ${c.h.d.nombre ?? c.h.d.objeto} × ${cursos(n)} × ${decimal(hc)} h por contacto (perfil de costes)`,
  );
}

function costeFrecuencia(c: Calculo): Coste {
  const sa = semanasAula(c.dims.unidades);
  const veces = Math.ceil(c.h.d.magnitud * sa);
  const hi = c.perfil.horas_por_informe;
  return enHoras(
    veces * hi,
    `${veces} veces (${c.h.d.frecuencia ?? 'semanal'} en ${sa} semanas de aula; semanas: ${deSemanas(c.dims.unidades)}) × ${decimal(hi)} h (perfil de costes)`,
  );
}

function costeGrupo(c: Calculo): Coste {
  const u = cursoDe(c.h, c.dims);
  const extra = Math.max(0, c.h.d.magnitud - (grupoDelPliego(u) ? u.grupos.valor : 1));
  const { horas_montaje_aula: m, horas_aula_semana: s } = c.perfil;
  const aula = `${decimal(m)} h de montaje + ${u.semanas.valor} semanas (${u.semanas.fuente}) × ${decimal(s)} h por semana, perfil de costes`;
  return enHoras(
    extra * (m + u.semanas.valor * s),
    `${extra} ${extra === 1 ? 'grupo' : 'grupos'} más en «${u.nombre}» × (${aula})`,
  );
}

function costeHorasExtra(c: Calculo): Coste {
  const n = c.h.d.porCurso ? c.dims.unidades.length : 1;
  const prep = c.perfil.horas_preparacion_por_hora_lectiva;
  return enHoras(
    c.h.d.magnitud * n * (1 + prep),
    `${decimal(c.h.d.magnitud)} h × ${cursos(n)} × (1 + ${decimal(prep)} h de preparación por hora lectiva, perfil de costes)`,
  );
}

const COSTES: Record<TipoCompromiso, (c: Calculo) => Coste> = {
  material_fisico: costeMaterial,
  dedicacion_fija: costeDedicacion,
  plazo_corto: costePlazo,
  sesion_recurrente: costeRecurrente,
  sesion_individual: costeIndividual,
  cantidad_minima: costeMinimo,
  frecuencia_alta: costeFrecuencia,
  grupo_extra: costeGrupo,
  horas_extra: costeHorasExtra,
};

const redondeoEuros = (n: number) => Math.round(n / 10) * 10;

function euros(c: Coste, perfil: PerfilCostesData): number | null {
  if (c.horas === null && !c.unidades) return null;
  return redondeoEuros(Math.round(c.horas ?? 0) * perfil.euros_hora + c.unidades * c.eurosUnidad);
}

// ── Texto, criterio e instrucción ──

const OBJETO_TEXTO: Record<string, string> = {
  consulta: 'Consulta',
  guardia: 'Guardia',
  resumen: 'Resumen escrito',
  sintesis: 'Síntesis',
  tutoria: 'Tutoría',
  sesion: 'Sesión en directo',
  reunion: 'Reunión',
  entrevista: 'Entrevista individual',
  revision: 'Revisión individual',
  tutoria_individual: 'Tutoría individual',
  llamada: 'Llamada',
  videollamada: 'Videollamada',
  informe: 'Informe',
  cruce: 'Cruce de ofertas',
  consulta_seguimiento: 'Consulta de seguimiento',
  publicacion: 'Publicación de ofertas',
  boletin: 'Boletín',
  taller: 'Taller',
  sesion_grupal: 'Sesión grupal',
  horas_adicionales: 'Horas adicionales',
};
const objetoTexto = (o: string) => OBJETO_TEXTO[o] ?? o;

function textoDe(d: Deteccion, dims: Dimensiones): string {
  const porCurso = d.porCurso ? ' por curso' : '';
  switch (d.tipo) {
    case 'material_fisico':
      return `Material físico enviado a cada ${dims.persona}`;
    case 'dedicacion_fija':
      return `Dedicación fija de ${decimal(d.magnitud)} h por ${UNIDAD_DEDICACION[d.unidad ?? 'subgrupo']} y semana`;
    case 'plazo_corto':
      return `Corrección en ${decimal(d.magnitud)} días hábiles`;
    case 'sesion_recurrente':
      return `${objetoTexto(d.objeto)} ${d.frecuencia ?? 'semanal'} de ${decimal(d.horas ?? 1)} h`;
    case 'sesion_individual':
      return `${objetoTexto(d.objeto)} de ${decimal((d.horas ?? 0.5) * 60)} min con cada ${dims.persona}${d.fraccion === 'aptas' ? ' apta' : d.fraccion === 'ruta_apoyo' ? ' de la ruta de apoyo' : ''}`;
    case 'cantidad_minima':
      return `Al menos ${d.magnitud} ${d.nombre ?? d.objeto}${porCurso}`;
    case 'frecuencia_alta':
      return `${objetoTexto(d.objeto)} ${d.frecuencia ?? 'semanal'}`;
    case 'grupo_extra':
      return `${d.magnitud} grupos en lugar de uno`;
    case 'horas_extra':
      return `${objetoTexto(d.objeto)} de ${decimal(d.magnitud)} h${porCurso}`;
  }
}

// El «se valorará» del guion con más raíces en común con el compromiso (al menos 2), como apartadoDelCompromiso.
// El mejor «se valorará» para unas raíces: el de más raíces en común, si son al menos 2.
function mejorItem(buscadas: Set<string>, items: string[]): string | null {
  const puntos = items.map((s) => [...raices(s)].filter((r) => buscadas.has(r)).length);
  const mejor = Math.max(0, ...puntos);
  return mejor >= 2 ? items[puntos.indexOf(mejor)]! : null;
}

// Primero con la frase que más compromete (y su título y contexto); si no basta, con todas las
// apariciones: la tabla resumen suele nombrar el criterio que el cuerpo solo desarrolla.
function criterioDe(g: Hallazgo[], rep: Hallazgo, guion: GuionBaseData | undefined): string | null {
  const items = (guion?.memoria?.apartados ?? []).flatMap((a) => a.se_valorara);
  const texto = (h: Hallazgo) => `${h.f.cita} ${h.f.linea?.titulo ?? ''}`;
  return (
    mejorItem(raices(`${texto(rep)} ${rep.f.linea?.contexto ?? ''}`), items) ??
    mejorItem(raices(g.map(texto).join(' ')), items)
  );
}

// El cierre de cada instrucción: una sola vez aunque se junten las de varios compromisos.
const CIERRE_INSTRUCCION = 'no añadas compromisos con coste que el pliego no pide.';
const pasosDe = (as: Aparicion[], barata: string): string[] =>
  as.map((a) => {
    const donde = a.seccion ?? a.apartado;
    return `${donde ? `En el apartado ${donde}` : 'En la memoria'}, sustituye «${a.cita}» por: ${barata}`;
  });
const instruccionDe = (as: Aparicion[], barata: string): string =>
  [...pasosDe(as, barata), CIERRE_INSTRUCCION].join('; ');

/** La instrucción de suavizar varios compromisos a la vez (la fila del total): sus pasos y el cierre una vez. */
export const instruccionConjunta = (xs: readonly CompromisoDetallado[]): string =>
  [...new Set(xs.flatMap((x) => pasosDe(x.apariciones, x.barata)))].concat(CIERRE_INSTRUCCION).join('; ');

// ── Orquestación ──

type Entrada = { texto: string; perfil: PerfilCostesData; guion?: GuionBaseData | undefined };

function hallazgos(lineas: LineaCostes[], perfil: PerfilCostesData): Hallazgo[] {
  return lineas
    .flatMap(frasesDeLinea)
    .flatMap((f) => detectar(f).map((d) => ({ d, f, cita: citaDe(f, d.ancla) })))
    .filter((h) => h.d.tipo !== 'plazo_corto' || h.d.magnitud < perfil.plazo_referencia_dias);
}

function detallado(g: Hallazgo[], e: Entrada, dims: Dimensiones, p: Pliego): CompromisoDetallado {
  const h = representante(g);
  const co = grupoDelAlcance(h, dims) ?? cotejar(h.d, p, e.perfil);
  const coste = COSTES[h.d.tipo]({ h, dims, perfil: e.perfil });
  const barata = formulacionBarata(h.d, { plazoReferencia: e.perfil.plazo_referencia_dias, persona: dims.persona });
  const as = apariciones(g);
  return {
    texto: textoDe(h.d, dims),
    cita: as[0]!.cita,
    clase: co.clase,
    criterio: co.clase === 'anadido' ? criterioDe(g, h, e.guion) : null,
    horas: coste.horas === null ? null : Math.round(coste.horas),
    euros: euros(coste, e.perfil),
    supuesto: `${coste.supuesto}. ${co.nota}.`,
    tipo: h.d.tipo,
    objeto: h.d.objeto,
    barata,
    instruccion: instruccionDe(as, barata),
    unidades: coste.unidades,
    apariciones: as,
    pliego: co.pliego,
  };
}

/** Cada compromiso con coste de la memoria, con lo que necesitan las comprobaciones, el resumen y el MCP. */
export function compromisosDetallados(
  texto: string,
  perfil: PerfilCostesData,
  guion?: GuionData,
  pliego?: PliegoCostes,
): CompromisoDetallado[] {
  if (!texto.trim()) return [];
  const lineas = lineasParaCostes(texto);
  const e: Entrada = { texto, perfil, guion };
  const ps = delPliego(pliego);
  const dims = dimensiones(lineas, perfil, guion, pasajesPropios(ps.pasajes, guion));
  const p = leerPliego(ps, guion);
  return agrupar(hallazgos(lineas, perfil)).map((g) => detallado(g, e, dims, p));
}

/** El contrato con la memoria (compromisosMemoriaCoste.ts): exactamente CompromisoConCoste. */
export function compromisosConCoste(
  texto: string,
  perfil: PerfilCostesData,
  guion?: GuionData,
  pliego?: PliegoCostes,
): CompromisoConCoste[] {
  return compromisosDetallados(texto, perfil, guion, pliego).map(
    ({ texto: t, cita, clase, criterio, horas, euros: e, supuesto }) => ({
      texto: t,
      cita,
      clase,
      criterio,
      horas,
      euros: e,
      supuesto,
    }),
  );
}

// ── Lo que ya decidió la ficha de solución (solucion.compromisos de la estrategia) ──

/** Un compromiso de la ficha de solución, tal como lo dejó la persona. */
export type CompromisoDeFicha = Pick<CompromisoData, 'texto' | 'clase' | 'compensa' | 'quitado'>;
const MIN_RAICES_FICHA = 2;

/** El compromiso de la ficha que dice lo mismo (el de más raíces en común, al menos 2); null si ninguno. */
export function enLaFicha(
  x: Pick<CompromisoDetallado, 'texto' | 'apariciones'>,
  ficha: readonly CompromisoDeFicha[],
): CompromisoDeFicha | null {
  const buscadas = raices([x.texto, ...x.apariciones.map((a) => a.cita)].join(' '));
  const puntos = ficha.map((c) => [...raices(c.texto)].filter((r) => buscadas.has(r)).length);
  const mejor = Math.max(0, ...puntos);
  return mejor >= MIN_RAICES_FICHA ? ficha[puntos.indexOf(mejor)]! : null;
}

/**
 * Por qué la ficha ya lo da por bueno: lo marcó exigido o dijo por qué compensa. null si no lo
 * justifica (o si se quitó: entonces no debería estar en la memoria).
 */
export function justificacionDeFicha(f: CompromisoDeFicha | null): string | null {
  if (!f || f.quitado) return null;
  if (f.clase === 'exigido') return 'La ficha de solución lo da por exigido por el pliego';
  return f.compensa.trim() ? `En la ficha de solución compensa: ${f.compensa.trim()}` : null;
}
