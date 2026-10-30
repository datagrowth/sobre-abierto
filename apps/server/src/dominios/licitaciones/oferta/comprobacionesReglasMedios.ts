// Reglas de medios de las comprobaciones: roles exigidos sin persona y materias que pide el pliego sin acreditar.
import type { Materia } from '../../../nucleo/colaboradores/materias.js';
import type { PersonaGuardada } from '../../../nucleo/colaboradores/personas.js';
import type { FichaDatosData } from '../ficha.js';
import { textoComparable } from '../temas.js';
import { citaLiteral } from './comprobacionesCitas.js';
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import {
  MINUTOS_POR_ACCION,
  claveBloqueo,
  huellaDe,
  type Actor,
  type Bloqueo,
  type Cita,
  type Gravedad,
} from './comprobacionesTipos.js';
import {
  mediosSinAcreditar,
  rolExigido,
  rolesNombrados,
  rolesSinCubrir,
  type MedioSinAcreditar,
  type RolNombrado,
} from './coherencia.js';

// Sustituyen los avisos «equipo» y «medios_sin_acreditar» de la coherencia (comprobacionesCoherencia.ts) con una
// fila por materia, su actor y su acción. Una materia que nadie acredita impide solo si el pliego la nombra y la
// oferta declara los medios (DEUC o compromiso de adscripción): declararlos sin tenerlos es una declaración no
// veraz; sin esa declaración es un riesgo. Si alguien del equipo la tiene pero no está en el rol, es un riesgo
// que se resuelve asignándolo en Decisiones.
type RequisitoFicha = FichaDatosData['requisitos'][number];
type Fila = {
  clave: string;
  lote: string | null;
  gravedad: Gravedad;
  titulo: string;
  cita: Cita | null;
  actor: Actor;
  rol: string;
  huella: string;
};

// Por el nombre del documento o su modelo: un anexo de horas no declara medios.
const DECLARA_MEDIOS = /adscripcion|medios personales/;

function declaraMedios(e: EntradasComprobaciones, lote: string | null): boolean {
  return e.documentos.del_guion.some(
    ({ doc, lote: suyo }) =>
      (suyo === null || lote === null || suyo === lote) &&
      (doc.tipo === 'deuc' || DECLARA_MEDIOS.test(textoComparable(`${doc.nombre} ${doc.origen?.modelo ?? ''}`))),
  );
}

const RECORTE_CITA = 200;

function citaDe(e: EntradasComprobaciones, r: RequisitoFicha): Cita | null {
  const literal = citaLiteral(e, r);
  if (literal) return literal;
  if (!r.documento) return null;
  const texto = r.descripcion.length > RECORTE_CITA ? `${r.descripcion.slice(0, RECORTE_CITA - 1)}…` : r.descripcion;
  return { documento: r.documento, pagina: r.pagina ?? null, texto, comprobada: false };
}

const enLote = (lote: string | null): string => (lote ? ` (lote ${lote})` : '');
const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

// El título se lee: con la forma del pliego («IA administrativa», «técnico»), no con la comparable
// («ia administrativa», «tecnico»), que solo sirve para la clave. textoComparable conserva las
// posiciones, así que el tramo del original es el mismo; si no casa, queda la comparable.
function literal(
  original: string,
  comparable: string,
  en: number = textoComparable(original).indexOf(comparable),
): string {
  const tramo = en >= 0 ? original.slice(en, en + comparable.length) : '';
  return tramo && textoComparable(tramo) === comparable ? tramo : comparable;
}

function materiaLiteral(r: RequisitoFicha, m: Materia): string {
  const enDescripcion = literal(r.descripcion, m.texto);
  return enDescripcion !== m.texto || !r.valor_exigido ? enDescripcion : literal(r.valor_exigido, m.texto);
}

const rolLiteral = (r: RequisitoFicha, rol: RolNombrado): string => literal(r.descripcion, rol.palabra, rol.en);

// Lo que Colaboradores no registra no se puede dar por acreditado ni por que falte: la materia
// que el pliego no nombra («relacionada con el curso», «no docente relacionada») y las horas
// («30 h de formación teleformación/TIC o 60 h de impartición online»).
const SIN_OBJETO = /\brelacionad[ao]s?$/;
const CON_HORAS = /\b\d{1,3} ?(?:h|horas)\b/;

function sinComprobar(m: Materia): string | null {
  if (!m.alternativas.length || SIN_OBJETO.test(m.texto))
    return 'el pliego no nombra la materia, revisa el CV y los certificados';
  if (CON_HORAS.test(m.texto)) return 'las horas no constan en Colaboradores, revisa el CV y los certificados';
  return null;
}

function filaDeMateria(e: EntradasComprobaciones, x: MedioSinAcreditar, m: Materia, gravedad: Gravedad): Fila {
  const rol = x.rol;
  const quien = x.alguienLaTiene[m.texto] ?? null;
  const sujeto = `${rol ? capital(rolLiteral(x.requisito, rol)) : 'Medios personales'} de ${materiaLiteral(x.requisito, m)}${enLote(x.lote)}`;
  const base = {
    clave: claveBloqueo('medios', x.lote, m.texto),
    lote: x.lote,
    cita: citaDe(e, x.requisito),
    rol: rol ? textoComparable(rol.palabra) : '',
  };
  const huella = huellaDe(
    'medios',
    x.requisito.descripcion,
    m.texto,
    quien,
    x.asignados.map((a) => a.miembro.persona_id),
  );
  const motivo = sinComprobar(m);
  if (motivo) return { ...base, gravedad: 'no_comprobado', actor: 'tu', huella, titulo: `${sujeto}: ${motivo}` };
  if (quien)
    return {
      ...base,
      gravedad: 'riesgo',
      actor: 'tu',
      huella,
      titulo: `${sujeto}: ${quien} lo tiene, asígnala al rol`,
    };
  return { ...base, gravedad, actor: 'negocio', huella, titulo: `${sujeto}: nadie del equipo lo tiene registrado` };
}

function filaDeRol(e: EntradasComprobaciones, r: RequisitoFicha): Fila {
  const raiz = rolExigido(r.descripcion) ?? '';
  const nombrado = rolesNombrados(r.descripcion)[0];
  const palabra = nombrado ? rolLiteral(r, nombrado) : raiz;
  const lote = r.lote ?? null;
  return {
    clave: claveBloqueo('medios', lote, `rol ${raiz}`),
    lote,
    gravedad: 'impide',
    cita: citaDe(e, r),
    actor: 'tu',
    rol: nombrado ? nombrado.palabra : raiz,
    titulo: `${capital(palabra)}${enLote(lote)}: el pliego lo exige y nadie de las decisiones tiene ese rol, asígnalo en el equipo`,
    huella: huellaDe('medios_rol', r.descripcion, raiz),
  };
}

function bloqueoDe(f: Fila): Bloqueo {
  return {
    clave: f.clave,
    categoria: 'elegibilidad',
    lote: f.lote,
    gravedad: f.gravedad,
    titulo: f.titulo,
    cita: f.cita,
    actor: f.actor,
    accion: { tipo: 'asignar_rol', destino: `equipo:${f.rol}` },
    propuesta: null,
    minutos: f.actor === 'tu' ? MINUTOS_POR_ACCION.asignar_rol : 0,
    estado: 'abierto',
    huella: f.huella,
  };
}

function genteDe(personas: readonly PersonaGuardada[]) {
  return { personas: () => [...personas], persona: (id: number) => personas.find((p) => p.id === id) ?? null };
}

/** Una fila por rol exigido sin nadie en las decisiones y por (requisito, materia que falta). */
export function reglasMedios(e: EntradasComprobaciones): Bloqueo[] {
  const ficha = e.ficha?.datos ?? null;
  const d = e.decisiones?.datos ?? null;
  const roles = d ? rolesSinCubrir(ficha, e.ambito, d).map((r) => filaDeRol(e, r)) : [];
  const materias = mediosSinAcreditar(ficha, e.ambito, d, genteDe(e.personas)).flatMap((x) => {
    const gravedad: Gravedad = declaraMedios(e, x.lote) ? 'impide' : 'riesgo';
    return x.materias.map((m) => filaDeMateria(e, x, m, gravedad));
  });
  const porClave = new Map<string, Bloqueo>();
  for (const f of [...roles, ...materias]) if (!porClave.has(f.clave)) porClave.set(f.clave, bloqueoDe(f));
  return [...porClave.values()];
}
