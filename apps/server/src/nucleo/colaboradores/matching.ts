// Matching requisito ↔ persona sin IA. Puro: recibe personas y CV ya buscados.
import type { PersonaGuardada } from './personas.js';
import {
  analizarRequisito,
  camposDe,
  CERTIFICACIONES,
  idiomaDe,
  nivelTitulacion,
  rangoNivel,
  type DocenciaExigida,
  type RequisitoAnalizado,
} from './requisito.js';
import { casaMateria, evidenciaDeMateria } from './materias.js';
import { contieneTermino, normalizar } from './texto.js';
import { DISPONIBLE, type Disponibilidad, type EstadoDisponibilidad } from './disponibilidad.js';

// Combina reglas que se pueden comprobar (años, titulación, certificación, idioma) y afinidad (tecnologías y rol
// citados, CPV, CV que aparece en la búsqueda por significado de la Biblioteca).
type ResultadoRegla = 'cumple' | 'parcial' | 'no_cumple' | 'desconocido';
export type Regla = {
  regla: 'anios' | 'titulacion' | 'certificacion' | 'idioma' | 'docencia';
  exigido: string;
  resultado: ResultadoRegla;
  detalle: string;
};

export type Candidato = {
  id: number;
  nombre: string;
  tipo: PersonaGuardada['tipo'];
  rol: string;
  disponibilidad: EstadoDisponibilidad;
  disponibilidad_motivo: string;
  tarifa_hora: number | null;
  cv_ruta: string | null;
  // coincidencias: reglas cumplidas (o en parte) más motivos de afinidad; con 0 no es candidato.
  puntuacion: number;
  cumple_minimos: boolean;
  coincidencias: number;
  reglas: Regla[];
  afinidad: string[];
  // Por cada materia del requisito, dónde la tiene registrada (null: no la acredita). Suma a
  // coincidencias y puntuación: quien la acredita solo en certificaciones o titulaciones no
  // puede quedar fuera de la lista.
  materias: { materia: string; evidencia: string | null }[];
};

// disponibilidad: la calculada de cada persona (disponibilidad.ts); quien no está, disponible.
// anio: el año en curso, para contar las horas de docencia «de los últimos N años».
export type Contexto = {
  texto: string;
  cpvs: string[];
  cvs: string[];
  disponibilidad?: Map<number, Disponibilidad>;
  anio?: number;
};

// Lo exigido pesa 70 puntos y la afinidad 30. Sin dato en el perfil no se da por
// incumplido (puede tenerlo y no estar escrito), pero puntúa menos que un «cumple».
const PESO_REGLAS = 70;
const PUNTOS: Record<ResultadoRegla, number> = { cumple: 1, parcial: 0.5, desconocido: 0.3, no_cumple: 0 };
const AFINIDAD = { porTermino: 5, maxTerminos: 3, cpvClase: 5, cpvDivision: 2.5, cv: 10 } as const;
const PUNTOS_MATERIA = 15;
const MAX_AFINIDAD = AFINIDAD.porTermino * AFINIDAD.maxTerminos + AFINIDAD.cpvClase + AFINIDAD.cv;
const FACTOR_DISPONIBILIDAD = { disponible: 1, parcial: 0.85, no_disponible: 0.5 } as const;

function reglaAnios(p: PersonaGuardada, minimo: number): Regla {
  const exigido = `≥ ${minimo} años de experiencia`;
  if (p.anios_experiencia === null)
    return {
      regla: 'anios',
      exigido,
      resultado: 'desconocido',
      detalle: 'El perfil no indica los años de experiencia.',
    };
  const cumple = p.anios_experiencia >= minimo;
  return {
    regla: 'anios',
    exigido,
    resultado: cumple ? 'cumple' : 'no_cumple',
    detalle: `${p.anios_experiencia} años de experiencia.`,
  };
}

function reglaTitulacion(p: PersonaGuardada, t: NonNullable<RequisitoAnalizado['titulacion']>): Regla {
  const exigido = `${t.nombre}${t.campos.length ? ` en ${t.campos.join(' o ')}` : ''}`;
  const niveles = p.titulaciones.map((x) => ({ titulo: x, nivel: nivelTitulacion(x)?.nivel ?? 0 }));
  const validas = niveles.filter((x) => x.nivel >= t.nivel);
  if (!p.titulaciones.length)
    return { regla: 'titulacion', exigido, resultado: 'desconocido', detalle: 'El perfil no indica titulaciones.' };
  if (!validas.length)
    return {
      regla: 'titulacion',
      exigido,
      resultado: niveles.some((x) => x.nivel === 0) ? 'desconocido' : 'no_cumple',
      detalle: `Tiene: ${p.titulaciones.join('; ')}.`,
    };
  const delCampo = validas.find((x) => !t.campos.length || camposDe(x.titulo).some((c) => t.campos.includes(c)));
  if (delCampo) return { regla: 'titulacion', exigido, resultado: 'cumple', detalle: delCampo.titulo };
  return {
    regla: 'titulacion',
    exigido,
    resultado: 'parcial',
    detalle: `Nivel suficiente en otra rama: ${validas[0]!.titulo}.`,
  };
}

function reglaCertificacion(p: PersonaGuardada, nombre: string): Regla {
  const def = CERTIFICACIONES.find((c) => c.nombre === nombre);
  const suya = p.certificaciones.find((c) => def?.re.test(normalizar(c)));
  if (suya) return { regla: 'certificacion', exigido: nombre, resultado: 'cumple', detalle: suya };
  return {
    regla: 'certificacion',
    exigido: nombre,
    resultado: p.certificaciones.length ? 'no_cumple' : 'desconocido',
    detalle: p.certificaciones.length ? 'No figura entre sus certificaciones.' : 'El perfil no indica certificaciones.',
  };
}

function reglaIdioma(p: PersonaGuardada, pedido: RequisitoAnalizado['idiomas'][number]): Regla {
  const exigido = `${pedido.idioma}${pedido.nivel ? ` ${pedido.nivel}` : ''}`;
  const suyo = p.idiomas.find((i) => idiomaDe(i.idioma) === pedido.idioma);
  if (!suyo)
    return {
      regla: 'idioma',
      exigido,
      resultado: p.idiomas.length ? 'no_cumple' : 'desconocido',
      detalle: p.idiomas.length ? `No figura ${pedido.idioma}.` : 'El perfil no indica idiomas.',
    };
  if (!pedido.nivel)
    return {
      regla: 'idioma',
      exigido,
      resultado: 'cumple',
      detalle: `${suyo.idioma}${suyo.nivel ? ` ${suyo.nivel}` : ''}`,
    };
  if (!suyo.nivel)
    return { regla: 'idioma', exigido, resultado: 'parcial', detalle: `${suyo.idioma}, sin nivel indicado.` };
  const cumple = rangoNivel(suyo.nivel) >= rangoNivel(pedido.nivel);
  return {
    regla: 'idioma',
    exigido,
    resultado: cumple ? 'cumple' : 'no_cumple',
    detalle: `${suyo.idioma} ${suyo.nivel}`,
  };
}

const sumaHoras = (xs: PersonaGuardada['docencia']) => xs.reduce((s, x) => s + x.horas, 0);

// Del periodo pedido solo cuentan seguro las horas impartidas entero dentro; las que empezaron antes
// o no traen años pueden caer fuera, y con ellas no se pasa de «en parte».
function reglaDocencia(p: PersonaGuardada, d: DocenciaExigida, anio: number): Regla {
  const materia = d.materia ? ` en ${d.materia.texto}` : '';
  const exigido = `≥ ${d.horas} h de docencia${materia}${d.anios ? ` en los últimos ${d.anios} años` : ''}`;
  if (!p.docencia.length)
    return { regla: 'docencia', exigido, resultado: 'desconocido', detalle: 'El perfil no indica horas de docencia.' };
  const suyas = p.docencia.filter((x) => !d.materia || casaMateria(x.materia, d.materia));
  if (!suyas.length) return { regla: 'docencia', exigido, resultado: 'no_cumple', detalle: `Sin docencia${materia}.` };
  const inicio = d.anios ? anio - d.anios + 1 : null;
  const dentro = suyas.filter((x) => inicio === null || (x.desde ?? x.hasta ?? 0) >= inicio);
  const dudosas =
    inicio === null ? [] : suyas.filter((x) => !dentro.includes(x) && (x.hasta === null || x.hasta >= inicio));
  const [seguras, posibles] = [sumaHoras(dentro), sumaHoras(dudosas)];
  if (seguras >= d.horas)
    return { regla: 'docencia', exigido, resultado: 'cumple', detalle: `${seguras} h${materia}.` };
  if (seguras + posibles >= d.horas)
    return {
      regla: 'docencia',
      exigido,
      resultado: 'parcial',
      detalle: `${seguras} h dentro del periodo y ${posibles} h que pueden caer fuera: comprueba las fechas en el CV.`,
    };
  return {
    regla: 'docencia',
    exigido,
    resultado: 'no_cumple',
    detalle: `${seguras + posibles} de ${d.horas} h${materia}.`,
  };
}

export function reglasDe(p: PersonaGuardada, req: RequisitoAnalizado, anio = new Date().getFullYear()): Regla[] {
  return [
    ...(req.anios_minimos !== null ? [reglaAnios(p, req.anios_minimos)] : []),
    ...(req.titulacion ? [reglaTitulacion(p, req.titulacion)] : []),
    ...req.certificaciones.map((c) => reglaCertificacion(p, c)),
    ...req.idiomas.map((i) => reglaIdioma(p, i)),
    ...(req.docencia ? [reglaDocencia(p, req.docencia, anio)] : []),
  ];
}

function prefijoComun(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Afinidad: puntos y motivos legibles. Los términos se buscan como palabra entera.
function afinidad(p: PersonaGuardada, ctx: Contexto): { puntos: number; motivos: string[] } {
  const texto = normalizar(ctx.texto);
  const terminos = [p.rol, ...p.tecnologias, ...p.sectores].filter(
    (t) => t.trim().length >= 1 && contieneTermino(texto, normalizar(t)),
  );
  const motivos = terminos.length ? [`Cita: ${terminos.slice(0, 6).join(', ')}`] : [];
  let puntos = Math.min(terminos.length, AFINIDAD.maxTerminos) * AFINIDAD.porTermino;
  const comun = Math.max(0, ...p.cpv.flatMap((a) => ctx.cpvs.map((b) => prefijoComun(a, b))));
  if (comun >= 4) {
    puntos += AFINIDAD.cpvClase;
    motivos.push('Experiencia en la misma clase de CPV');
  } else if (comun >= 2) {
    puntos += AFINIDAD.cpvDivision;
    motivos.push('Experiencia en la misma división de CPV');
  }
  const enCvs = p.cv_ruta ? ctx.cvs.indexOf(p.cv_ruta) : -1;
  if (enCvs >= 0) {
    puntos += AFINIDAD.cv * (1 - enCvs / Math.max(ctx.cvs.length, 1));
    motivos.push(`Su CV responde a la búsqueda por significado (puesto ${enCvs + 1})`);
  }
  return { puntos, motivos };
}

export function evaluarPersona(p: PersonaGuardada, req: RequisitoAnalizado, ctx: Contexto): Candidato {
  const reglas = reglasDe(p, req, ctx.anio);
  const disp = ctx.disponibilidad?.get(p.id) ?? DISPONIBLE;
  const af = afinidad(p, ctx);
  const materias = req.materias.map((m) => ({ materia: m.texto, evidencia: evidenciaDeMateria(p, m) }));
  const acreditadas = materias.filter((m) => m.evidencia !== null).length;
  const base = Math.min(
    100,
    (reglas.length
      ? PESO_REGLAS * (reglas.reduce((s, r) => s + PUNTOS[r.resultado], 0) / reglas.length) + af.puntos
      : (af.puntos / MAX_AFINIDAD) * 100) +
      acreditadas * PUNTOS_MATERIA,
  );
  const disponibilidad =
    disp.estado === 'disponible'
      ? []
      : [`${disp.estado === 'parcial' ? 'Disponibilidad parcial' : 'No disponible ahora'}: ${disp.motivo}`];
  return {
    id: p.id,
    nombre: p.nombre,
    tipo: p.tipo,
    rol: p.rol,
    disponibilidad: disp.estado,
    disponibilidad_motivo: disp.motivo,
    tarifa_hora: p.tarifa_hora,
    cv_ruta: p.cv_ruta,
    puntuacion: Math.round(base * FACTOR_DISPONIBILIDAD[disp.estado]),
    cumple_minimos: !reglas.some((r) => r.resultado === 'no_cumple'),
    coincidencias:
      reglas.filter((r) => r.resultado === 'cumple' || r.resultado === 'parcial').length +
      af.motivos.length +
      acreditadas,
    reglas,
    afinidad: [...af.motivos, ...disponibilidad],
    materias,
  };
}

function ordenar(a: Candidato, b: Candidato): number {
  return (
    Number(b.cumple_minimos) - Number(a.cumple_minimos) ||
    b.puntuacion - a.puntuacion ||
    a.nombre.localeCompare(b.nombre, 'es')
  );
}

// recortado: había más candidatos que el límite; quien lea las listas no puede concluir que
// «nadie» acredita algo, porque pudo quedar fuera del recorte.
// activos: personas dadas de alta y activas; con 0 y lista vacía no hay equipo, con más es que nadie casa.
export type ResultadoMatching = {
  requisito: RequisitoAnalizado;
  internos: Candidato[];
  externos: Candidato[];
  recortado: boolean;
  activos: number;
};

/**
 * Candidatos para un requisito, internos y externos por separado, del más al menos
 * adecuado. Solo quien casa en algo: una persona sin datos no sale por no tenerlos.
 */
export function candidatos(personas: PersonaGuardada[], ctx: Contexto, limite: number): ResultadoMatching {
  const requisito = analizarRequisito(ctx.texto);
  const todos = personas
    .filter((p) => p.activo)
    .map((p) => evaluarPersona(p, requisito, ctx))
    .filter((c) => c.coincidencias > 0)
    .sort(ordenar);
  const internos = todos.filter((c) => c.tipo === 'interno');
  const externos = todos.filter((c) => c.tipo === 'externo');
  return {
    requisito,
    internos: internos.slice(0, limite),
    externos: externos.slice(0, limite),
    recortado: internos.length > limite || externos.length > limite,
    activos: personas.filter((p) => p.activo).length,
  };
}
