// Coherencia de la oferta: lo que no casa entre lotes, ficha, pliegos, guion y decisiones. Sin IA.
import fs from 'node:fs';
import path from 'node:path';
import { evidenciaDeMateria, materiasExigidas, type Materia } from '../../../nucleo/colaboradores/materias.js';
import { listarPersonas, obtenerPersona, type PersonaGuardada } from '../../../nucleo/colaboradores/personas.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { zonaEmpresa } from '../../../nucleo/empresa.js';
import { raicesActuales } from '../../../nucleo/salidas.js';
import { fichasDe, type FichaDatosData } from '../ficha.js';
import { conLotes, idsDelAmbito, lotesDeLicitacion, type LotesLicitacion } from '../lotes.js';
import { carpetaPliegos } from '../pliegos.js';
import {
  avisoSinComprobar,
  completitudPliegos,
  pliegoObtenido,
  type DocumentoQueFalta,
} from '../pliegosCompletitud.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from '../store.js';
import { textoComparable } from '../temas.js';
import { decisionesDe, lotesFueraDelAmbito, presupuestosDeLotes, type DecisionesData } from './decisiones.js';
import {
  DOCUMENTO_CLAVE,
  guionDeOtrosLotes,
  guionVigente,
  lotesFrenteAlGuion,
  pedidaEnDe,
  pliegosClaveDesde,
  type GuionGuardado,
} from './guion.js';
import { automaticoDe, claveCriterio } from './guionLotes.js';
import { lotesDeAutomaticoDetalle, lotesDeCriterios, lotesMencionados } from './lotesMencionados.js';
import { duracionTexto, plazoDe, textoPlazo } from './plazo.js';
import { precioSugerido, type PrecioSugerido } from './precioSugerido.js';
import { problemasDePrecios } from './preciosOferta.js';
import { pideEvidencia, propuestaDecisionesDe, type PropuestaGuardada } from './propuestaDecisiones.js';

export { umbralDelPliego, umbralIlegible } from './guionLotes.js';

// Los lotes a los que se va son la fuente única; se cruzan con la ficha, los pliegos bajados, el guion y las
// decisiones (lotes, precio y equipo). Con algo que bloquea, la herramienta no da la oferta por lista; los avisos
// se enseñan sin parar nada. Los mensajes no dicen el precio decidido: también los lee Hermes
// (licitaciones_oferta) y la memoria no puede llevar importes.
type Gravedad = 'bloquea' | 'aviso';
// donde: el sitio donde se arregla, para enlazarlo (el bloque Lotes, la ficha, los pliegos, el guion o las decisiones).
export type Donde = 'lotes' | 'ficha' | 'pliegos' | 'guion' | 'decisiones';
export type TipoIncoherencia =
  | 'lotes_regla'
  | 'ficha_lotes'
  | 'pliegos'
  | 'pliegos_nuevos'
  | 'guion_lotes'
  | 'lotes_decisiones'
  | 'precio_maximo'
  | 'precio_anormal'
  | 'precio_lotes'
  | 'equipo'
  | 'medios_sin_acreditar'
  | 'guion_criterios'
  | 'automaticos_lotes'
  | 'equipo_lotes'
  | 'automaticos_sin_acreditar'
  | 'plazo';
export type Incoherencia = { tipo: TipoIncoherencia; gravedad: Gravedad; mensaje: string; donde: Donde };

// precio: el precio sugerido para unos lotes, si quien llama ya lo tiene (cuesta consultas);
// ahoraMs: el instante con el que se mide lo que queda de plazo.
export type OpcionesCoherencia = { precio?: (lotes: string[]) => PrecioSugerido | null; ahoraMs?: number };

const recorte = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

const deRegla = (l: LotesLicitacion): Incoherencia[] =>
  l.ambito.error ? [{ tipo: 'lotes_regla', gravedad: 'bloquea', donde: 'lotes', mensaje: l.ambito.error }] : [];

// Las fichas anteriores a ambito_lotes solo dicen para qué lotes se hicieron en sus requisitos de lote.
const lotesDeRequisitos = (f: FichaDatosData) => [...new Set(f.requisitos.flatMap((r) => (r.lote ? [r.lote] : [])))];

/**
 * ¿Se hizo la ficha para otros lotes que los de interés de ahora? Es lo que hace pedirla otra vez
 * (cadena.ts). Solo mira el ámbito con que se hizo: la comprobación de requisitos por lote es de
 * coherenciaOferta; en la cadena cada ficha nueva tiene id nuevo y pediría fichas sin fin si el
 * pliego no trae solvencia propia de ese lote.
 */
export const fichaDeOtrosLotes = (f: FichaDatosData | null, ahora: string[]): boolean => deAmbito(f, ahora).length > 0;

// Lotes a los que se va sin requisito propio cuando la ficha sí trae los de otros lotes a los que
// se va. Sin comunes (sin lote) que les apliquen no comprobó su solvencia (bloquea); con comunes
// puede que la solvencia sea común y solo se avisa.
function deRequisitosPorLote(f: FichaDatosData, ahora: string[]): Incoherencia[] {
  const propios = lotesDeRequisitos(f);
  const faltan = propios.some((l) => ahora.includes(l)) ? ahora.filter((l) => !propios.includes(l)) : [];
  if (!faltan.length) return [];
  if (f.requisitos.some((r) => !r.lote)) {
    return [
      {
        tipo: 'ficha_lotes',
        gravedad: 'aviso',
        donde: 'ficha',
        mensaje: `La ficha no trae requisitos propios ${conLotes('de', faltan)}, solo comunes, y vamos ${conLotes('a', faltan)}: compruébalo en el pliego.`,
      },
    ];
  }
  return [
    {
      tipo: 'ficha_lotes',
      gravedad: 'bloquea',
      donde: 'ficha',
      mensaje: `La ficha trae requisitos ${conLotes(
        'de',
        propios.filter((l) => ahora.includes(l)),
      )} y ninguno ${conLotes('de', faltan)}, y vamos ${conLotes('a', faltan)}: no ha comprobado su solvencia. Genera la ficha otra vez.`,
    },
  ];
}

const deFicha = (f: FichaDatosData | null, ahora: string[]): Incoherencia[] => {
  const delAmbito = deAmbito(f, ahora);
  return delAmbito.length || !f ? delAmbito : deRequisitosPorLote(f, ahora);
};

function deAmbito(f: FichaDatosData | null, ahora: string[]): Incoherencia[] {
  if (!f || !ahora.length) return [];
  const delAmbito = f.ambito_lotes;
  if (delAmbito) {
    // Una ficha del contrato entero comprobó los requisitos de todos los lotes.
    const faltan = delAmbito.length ? ahora.filter((l) => !delAmbito.includes(l)) : [];
    return faltan.length
      ? [
          {
            tipo: 'ficha_lotes',
            gravedad: 'bloquea',
            donde: 'ficha',
            mensaje: `La ficha se hizo ${conLotes('para', delAmbito)} y vamos ${conLotes('a', ahora)}: no ha comprobado los requisitos ${conLotes('de', faltan)}. Genera la ficha otra vez.`,
          },
        ]
      : [];
  }
  const deRequisitos = lotesDeRequisitos(f);
  const faltan = ahora.filter((l) => !deRequisitos.includes(l));
  if (!faltan.length || deRequisitos.every((l) => ahora.includes(l))) return [];
  return [
    {
      tipo: 'ficha_lotes',
      gravedad: 'aviso',
      donde: 'ficha',
      mensaje: `La ficha parece hecha para otros lotes: trae requisitos ${conLotes('de', deRequisitos)} y ninguno ${conLotes('de', faltan)}. Si vamos ${conLotes('a', ahora)}, genérala otra vez.`,
    },
  ];
}

const MAX_NOMBRES = 6;

const nombreComparable = (n: string) =>
  textoComparable(path.parse(n).name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Lo que hay en la carpeta de los pliegos (bajado por la plataforma o dejado a mano en Drive).
function nombresEnCarpeta(db: Db, l: FilaLicitacion): string[] {
  const raiz = raicesActuales().conocimiento;
  if (!raiz) return [];
  try {
    return fs.readdirSync(path.join(raiz, carpetaPliegos(db, l))).map(nombreComparable);
  } catch {
    return [];
  }
}

const lista = (nombres: string[]) =>
  nombres
    .slice(0, MAX_NOMBRES)
    .map((n) => `«${n}»`)
    .join(', ') + (nombres.length > MAX_NOMBRES ? ` y ${nombres.length - MAX_NOMBRES} más` : '');

function faltanDocumentos(gravedad: Gravedad, docs: DocumentoQueFalta[]): Incoherencia {
  const uno = docs.length === 1;
  const nombres = lista(docs.map((d) => d.nombre));
  const porQue =
    gravedad === 'bloquea' ? ' Son modelos, el DEUC o rectificaciones: pueden cambiar lo que hay que presentar.' : '';
  return {
    tipo: 'pliegos',
    gravedad,
    donde: 'pliegos',
    mensaje: `La PLACSP publica ${uno ? 'un documento que no se ha bajado' : `${docs.length} documentos que no se han bajado`} y Hermes no ha leído: ${nombres}.${porQue} ${uno ? 'Bájalo' : 'Bájalos'} de la PLACSP a la carpeta de los pliegos, con el mismo nombre, y vuelve a extraer el guion.`,
  };
}

// Lo publicado que falta sale de la completitud de los pliegos (un ZIP descomprimido cuenta como
// bajado); aquí además vale, por su nombre, lo bajado de otra URL o dejado a mano en la carpeta.
function dePliegos(db: Db, id: string): Incoherencia[] {
  const l = obtenerLicitacion(db, id);
  const c = completitudPliegos(db, id);
  const sinComprobar: Incoherencia[] = c?.sin_comprobar
    ? [{ tipo: 'pliegos', gravedad: 'aviso', donde: 'pliegos', mensaje: avisoSinComprobar(c) }]
    : [];
  const publicadosQueFaltan = c?.faltan ?? [];
  if (!l || !publicadosQueFaltan.length) return sinComprobar;
  const filas = db.prepare('SELECT nombre, estado FROM pliegos WHERE licitacion_id = ?').all(id) as {
    nombre: string;
    estado: string;
  }[];
  const nombres = new Set([
    ...filas.filter((f) => pliegoObtenido(f.estado)).map((f) => nombreComparable(f.nombre)),
    ...nombresEnCarpeta(db, l),
  ]);
  const faltan = publicadosQueFaltan.filter((d) => !nombres.has(nombreComparable(d.nombre)));
  const clave = faltan.filter((d) => DOCUMENTO_CLAVE.test(d.nombre));
  const resto = faltan.filter((d) => !DOCUMENTO_CLAVE.test(d.nombre));
  return [
    ...(clave.length ? [faltanDocumentos('bloquea', clave)] : []),
    ...(resto.length ? [faltanDocumentos('aviso', resto)] : []),
    ...sinComprobar,
  ];
}

// Las rectificaciones y aclaraciones cambian también los requisitos que comprobó la ficha.
export const CAMBIA_REQUISITOS = /rectifica|aclara|correcci[oó]n de errores/i;

// Un pliego bajado después del guion no lo ha leído Hermes: una nota de rectificación del ENS
// descargada tarde dejaría de salir como «falta» y la oferta parecería completa.
function dePliegosTrasGuion(
  db: Db,
  id: string,
  g: GuionGuardado | null,
  ficha: { creada_en: string; trabajo_id: number | null } | null,
): Incoherencia[] {
  const out: Incoherencia[] = [];
  const trasGuion = g ? pliegosClaveDesde(db, id, pedidaEnDe(db, g.trabajo_id, g.creado_en)) : [];
  if (trasGuion.length) {
    out.push({
      tipo: 'pliegos_nuevos',
      gravedad: 'bloquea',
      donde: 'guion',
      mensaje: `${trasGuion.length === 1 ? 'Llegó un documento' : `Llegaron ${trasGuion.length} documentos`} después del guion que Hermes no ha leído: ${lista(trasGuion)}. Vuelve a extraer el guion (en preparación, Hermes lo pide solo).`,
    });
  }
  const trasFicha = ficha
    ? pliegosClaveDesde(db, id, pedidaEnDe(db, ficha.trabajo_id, ficha.creada_en), CAMBIA_REQUISITOS)
    : [];
  if (trasFicha.length) {
    out.push({
      tipo: 'pliegos_nuevos',
      gravedad: 'aviso',
      donde: 'ficha',
      mensaje: `La ficha es anterior a ${lista(trasFicha)}: puede cambiar los requisitos. Genera la ficha otra vez.`,
    });
  }
  return out;
}

function deGuion(db: Db, g: GuionGuardado | null, ahora: string[]): Incoherencia[] {
  if (!g) return [];
  if (guionDeOtrosLotes(db, g)) {
    return [
      {
        tipo: 'guion_lotes',
        gravedad: 'bloquea',
        donde: 'guion',
        mensaje: `El guion se extrajo ${conLotes('para', g.datos.lotes ?? [])} y vamos ${conLotes('a', ahora)}: hay que volver a extraerlo del pliego (en preparación, Hermes lo pide solo).`,
      },
    ];
  }
  // Se va a menos lotes de los que cubre: vale, pero lo de los otros no se presenta.
  const { sobran } = lotesFrenteAlGuion(db, g);
  return sobran.length
    ? [
        {
          tipo: 'guion_lotes',
          gravedad: 'aviso',
          donde: 'guion',
          mensaje: `El guion cubre también ${sobran.length === 1 ? 'el lote' : 'los lotes'} ${sobran.join(', ')} y vamos solo ${conLotes('a', ahora)}: deja fuera de la memoria y de los documentos lo que sea solo de ${sobran.length === 1 ? 'ese lote' : 'esos lotes'}.`,
        },
      ]
    : [];
}

// Un guion con los criterios de un solo lote cuando se va a varios (p. ej. solo los del lote 1 y se va
// del 1 al 5): los demás lotes no tienen con qué marcarse ni redactarse.
// Solo si cada criterio dice de qué lote es: uno que no lo dice puede valer para todos.
function deCriteriosDelGuion(db: Db, l: LotesLicitacion, g: GuionGuardado | null, ahora: string[]): Incoherencia[] {
  if (!g || ahora.length < 2 || guionDeOtrosLotes(db, g)) return [];
  const criterios = lotesDeCriterios(
    g.datos,
    l.lotes.map((x) => x.id),
  );
  if (!criterios.length || criterios.some((c) => !c.lotes.length)) return [];
  const cubiertos = [...new Set(criterios.flatMap((c) => c.lotes))];
  const faltan = ahora.filter((x) => !cubiertos.includes(x));
  return faltan.length
    ? [
        {
          tipo: 'guion_criterios',
          gravedad: 'bloquea',
          donde: 'guion',
          mensaje: `El guion solo trae criterios ${conLotes('de', cubiertos)} y vamos ${conLotes('a', ahora)}: faltan los ${conLotes('de', faltan)}. Vuelve a extraer el guion del pliego con los criterios de cada lote.`,
        },
      ]
    : [];
}

const enLotes = (lotes: string[]) => `${lotes.length === 1 ? 'lote' : 'lotes'} ${lotes.join(', ')}`;

type Ajeno = { texto: string; blando: boolean };

// Con un automático por lote (guion con un automático por lote) manda el lote de la decisión y el del criterio; el texto, al final.
function criteriosAjenos(
  g: GuionGuardado | null,
  d: DecisionesData,
  existentes: string[],
  ajenos: (lotes: string[]) => boolean,
): Ajeno[] {
  return d.automaticos
    .filter((a) => a.nos_acogemos)
    .flatMap((a) => {
      const c = g ? automaticoDe(g.datos, a.criterio, a.lote ?? null) : undefined;
      const explicitos = a.lote ? [a.lote] : (c?.lotes ?? []);
      const { lotes, soloDelTexto } =
        explicitos.length || !c || !g
          ? { lotes: explicitos, soloDelTexto: false }
          : lotesDeAutomaticoDetalle(c, g.datos, existentes);
      return ajenos(lotes)
        ? [{ texto: `«${recorte(a.criterio, 100)}» (${enLotes(lotes)})`, blando: soloDelTexto }]
        : [];
    });
}

// Lo decidido para lotes a los que no se va (p. ej. se va al lote 2 con criterios del lote 1
// marcados y una persona de «apoyo (lote 1)»): un criterio de otro lote compromete un anexo
// que no se presenta, y quien está para otro lote no forma parte de esta oferta. Si el lote del
// criterio sale solo de «cómo se acredita» no se da por seguro: es un aviso.
function deLotesAjenos(
  l: LotesLicitacion,
  g: GuionGuardado | null,
  d: DecisionesData,
  ahora: string[],
  nombre: (id: number) => string,
): Incoherencia[] {
  if (!ahora.length || !l.lotes.length) return [];
  const existentes = l.lotes.map((x) => x.id);
  const ajenos = (lotes: string[]) => lotes.length > 0 && lotes.every((x) => !ahora.includes(x));
  const criterios = criteriosAjenos(g, d, existentes, ajenos);
  const personas = d.equipo.flatMap((m) => {
    const lotes = m.lotes.length
      ? m.lotes
      : lotesMencionados(`${m.rol_en_la_oferta}. ${m.dedicacion ?? ''}`, existentes);
    return ajenos(lotes) ? [`${nombre(m.persona_id)} («${recorte(m.rol_en_la_oferta, 100)}»)`] : [];
  });
  const textos = (blando: boolean) => criterios.filter((c) => c.blando === blando).map((c) => c.texto);
  const desmarcar = `Vamos ${conLotes('a', ahora)}: desmárcalos en Decisiones (su anexo no se presenta) o, si vamos también a esos lotes, añádelos en el bloque Lotes.`;
  return [
    ...(textos(false).length
      ? [
          {
            tipo: 'automaticos_lotes' as const,
            gravedad: 'bloquea' as const,
            donde: 'decisiones' as const,
            mensaje: `Las decisiones se acogen a criterios automáticos de lotes a los que no vamos: ${textos(false).join('; ')}. ${desmarcar}`,
          },
        ]
      : []),
    ...(textos(true).length
      ? [
          {
            tipo: 'automaticos_lotes' as const,
            gravedad: 'aviso' as const,
            donde: 'decisiones' as const,
            mensaje: `Puede que las decisiones se acojan a criterios automáticos de lotes a los que no vamos (el lote sale solo de cómo se acredita, que quizá lo compara con otro): ${textos(true).join('; ')}. ${desmarcar}`,
          },
        ]
      : []),
    ...(personas.length
      ? [
          {
            tipo: 'equipo_lotes' as const,
            gravedad: 'aviso' as const,
            donde: 'decisiones' as const,
            mensaje: `En el equipo de las decisiones hay quien está para lotes a los que no vamos: ${personas.join('; ')}. Vamos ${conLotes('a', ahora)}: quítalo de Decisiones o cambia su rol.`,
          },
        ]
      : []),
  ];
}

function deLotesDecididos(l: LotesLicitacion, d: DecisionesData): Incoherencia[] {
  const fuera = lotesFueraDelAmbito(l, d.lotes);
  return fuera ? [{ tipo: 'lotes_decisiones', gravedad: 'bloquea', donde: 'decisiones', mensaje: fuera }] : [];
}

// Cada lote con su precio (preciosOferta.ts): lo que excluye la oferta y el umbral que fija el
// pliego bloquean; el umbral estimado (art. 85 RGLCAP) es un aviso.
function dePrecio(
  d: DecisionesData,
  g: GuionGuardado | null,
  ctx: { precio: (lotes: string[]) => PrecioSugerido | null; presupuestos: Record<string, number | null> },
): Incoherencia[] {
  if (!g) return [];
  const estimado = (lote: string | null) => {
    const p = ctx.precio(lote ? [lote] : []);
    return p?.umbral_anormal == null ? null : { umbral: p.umbral_anormal, ofertas: p.ofertas_esperadas };
  };
  return problemasDePrecios(d, g.datos, { presupuestos: ctx.presupuestos, estimado }).map((p) => ({
    tipo: p.tipo === 'precio_falta' ? 'precio_lotes' : p.tipo,
    gravedad: p.gravedad === 'error' || p.del_pliego ? 'bloquea' : 'aviso',
    donde: 'decisiones',
    mensaje: p.mensaje,
  }));
}

// Los roles que piden los pliegos, por su raíz: «tutor» vale para tutora y tutores. El primero
// que nombra un requisito es el que exige («Docente principal con …» → docente).
const ROLES = [
  'docent',
  'formador',
  'profesor',
  'tutor',
  'jef',
  'director',
  'coordinador',
  'responsabl',
  'analist',
  'consultor',
  'tecnic',
  'ingenier',
  'desarrollador',
  'programador',
  'arquitect',
  'gestor',
  'administrador',
  'expert',
  'especialist',
  'auditor',
  'orientador',
  'dinamizador',
  'monitor',
  'educador',
  'psicolog',
  'abogad',
  'asesor',
  'supervisor',
  'encargad',
  'delegad',
  'investigador',
  'disenador',
  'redactor',
  'traductor',
  'mediador',
  'medic',
  'enfermer',
];
const rolRe = (raiz: string, flags = '') => new RegExp(`\\b${raiz}(?:a|e|o|as|es|os|s)?\\b`, flags);

export type RolNombrado = { raiz: string; palabra: string; en: number };

/** Cada rol que nombra un texto (posiciones sobre textoComparable), por orden de aparición. */
export function rolesNombrados(texto: string): RolNombrado[] {
  const t = textoComparable(texto);
  return ROLES.flatMap((raiz) =>
    [...t.matchAll(rolRe(raiz, 'g'))].map((m) => ({ raiz, palabra: m[0], en: m.index })),
  ).sort((a, b) => a.en - b.en);
}

/** La raíz del rol que exige un requisito de medios personales; null si no nombra ninguno conocido. */
export function rolExigido(descripcion: string): string | null {
  return rolesNombrados(descripcion)[0]?.raiz ?? null;
}

type RequisitoFicha = FichaDatosData['requisitos'][number];
type MiembroEquipo = DecisionesData['equipo'][number];

// Quien está para unos lotes (vacío = todos) no cubre un requisito de otro lote; uno común lo cubre cualquiera.
const sirveEn = (m: MiembroEquipo, lote: string | undefined) => !lote || !m.lotes.length || m.lotes.includes(lote);
export const enElRol = (d: DecisionesData, r: RequisitoFicha, rol: string): MiembroEquipo[] =>
  d.equipo.filter((m) => sirveEn(m, r.lote) && rolRe(rol).test(textoComparable(m.rol_en_la_oferta)));
// Un rol comprometido como perfil a incorporar está cubierto: la oferta se obliga a traer a alguien que cumpla.
export const incorporaElRol = (d: DecisionesData, r: RequisitoFicha, rol: string): boolean =>
  (d.a_incorporar ?? []).some(
    (p) =>
      (!r.lote || !p.lotes.length || p.lotes.includes(r.lote)) && rolRe(rol).test(textoComparable(p.rol_en_la_oferta)),
  );

// Los requisitos de medios personales excluyentes que aplican a los lotes a los que se va.
const mediosEnJuego = (f: FichaDatosData, ahora: string[]) =>
  f.requisitos.filter(
    (r) =>
      r.tipo === 'medios_personales' &&
      r.excluyente &&
      r.cumple !== 'no_aplica' &&
      (!r.lote || !ahora.length || ahora.includes(r.lote)),
  );

/** Los requisitos de medios excluyentes cuyo rol no tiene a nadie en el equipo de las decisiones. */
export function rolesSinCubrir(f: FichaDatosData | null, ahora: string[], d: DecisionesData): RequisitoFicha[] {
  if (!f) return [];
  return mediosEnJuego(f, ahora).filter((r) => {
    const rol = rolExigido(r.descripcion);
    return rol !== null && !enElRol(d, r, rol).length && !incorporaElRol(d, r, rol);
  });
}

function deEquipo(f: FichaDatosData | null, ahora: string[], d: DecisionesData): Incoherencia[] {
  const sinCubrir = rolesSinCubrir(f, ahora, d);
  if (!sinCubrir.length) return [];
  const lista = sinCubrir
    .slice(0, 4)
    .map((r) => `«${recorte(r.descripcion, 140)}»${r.lote ? ` (lote ${r.lote})` : ''}`)
    .join('; ');
  const uno = sinCubrir.length === 1;
  return [
    {
      tipo: 'equipo',
      gravedad: 'aviso',
      donde: 'decisiones',
      mensaje: `Nadie del equipo de las decisiones tiene el rol que exige ${uno ? 'este requisito excluyente' : 'estos requisitos excluyentes'} de la ficha: ${lista}${sinCubrir.length > 4 ? ' y más' : ''}. Añade en Decisiones a quien ${uno ? 'lo' : 'los'} cubra, con ese rol.`,
    },
  ];
}

type Persona = PersonaGuardada | null;
// personas: todo Colaboradores (perezoso: cuesta una consulta); persona: una por su id.
export type GenteMedios = { personas: () => PersonaGuardada[]; persona: (id: number) => Persona };
export type MedioSinAcreditar = {
  requisito: RequisitoFicha;
  lote: string | null;
  // El rol al que se refieren estas materias (el último nombrado antes de ellas), o null.
  rol: RolNombrado | null;
  // Las que faltan: no las tienen los asignados al rol o, sin nadie asignado, nadie en Colaboradores.
  materias: Materia[];
  asignados: { miembro: MiembroEquipo; persona: Persona }[];
  // Por materia que falta (su texto), alguien de Colaboradores que sí la tiene registrada.
  alguienLaTiene: Record<string, string>;
};

const sinAcreditar = (ms: Materia[], personas: Persona[]) =>
  ms.filter((m) => !personas.some((p) => p && evidenciaDeMateria(p, m)));

function quienesLaTienen(ms: Materia[], personas: PersonaGuardada[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of ms) {
    const p = personas.find((x) => evidenciaDeMateria(x, m));
    if (p) out[m.texto] = p.nombre;
  }
  return out;
}

/**
 * El rol al que se refiere una materia: el último nombrado antes de ella («Adscripción de
 * coordinador/a… Cada tutor debe cumplir…: topografía 1» → tutor); si no se encuentra, el que exige.
 */
function rolDeMateria(descripcion: string, m: Materia): RolNombrado | null {
  const en = textoComparable(descripcion).indexOf(m.texto);
  const roles = rolesNombrados(descripcion);
  const antes = en >= 0 ? roles.filter((x) => x.en < en).at(-1) : undefined;
  return antes ?? roles[0] ?? null;
}

// Las materias de un requisito agrupadas por el rol al que se refieren, en orden de aparición.
export function porRol(r: RequisitoFicha, materias: Materia[]): { rol: RolNombrado | null; materias: Materia[] }[] {
  const grupos = new Map<string, { rol: RolNombrado | null; materias: Materia[] }>();
  for (const m of materias) {
    const rol = rolDeMateria(r.descripcion, m);
    const g = grupos.get(rol?.raiz ?? '') ?? { rol, materias: [] };
    g.materias.push(m);
    grupos.set(rol?.raiz ?? '', g);
  }
  return [...grupos.values()];
}

// Quién falta para un grupo de materias: si las decisiones ponen a alguien en su rol, se mira a
// quien está; si no hay nadie en ese rol (o no hay decisiones), si alguien de Colaboradores la
// tiene registrada. Con decisiones y nadie en el rol que exige el requisito no sale aquí: eso es
// de rolesSinCubrir.
function grupoSinAcreditar(
  r: RequisitoFicha,
  d: DecisionesData | null,
  gente: GenteMedios,
  g: { rol: RolNombrado | null; materias: Materia[] },
): MedioSinAcreditar | null {
  const enRol = d && g.rol ? enElRol(d, r, g.rol.raiz) : [];
  if (d && g.rol && !enRol.length && (g.rol.raiz === rolExigido(r.descripcion) || incorporaElRol(d, r, g.rol.raiz)))
    return null;
  const asignados = enRol.map((m) => ({ miembro: m, persona: gente.persona(m.persona_id) }));
  const faltan = sinAcreditar(g.materias, asignados.length ? asignados.map((x) => x.persona) : gente.personas());
  if (!faltan.length) return null;
  const alguienLaTiene = asignados.length ? quienesLaTienen(faltan, gente.personas()) : {};
  return { requisito: r, lote: r.lote ?? null, rol: g.rol, materias: faltan, asignados, alguienLaTiene };
}

function medioSinAcreditar(r: RequisitoFicha, d: DecisionesData | null, gente: GenteMedios): MedioSinAcreditar[] {
  const materias = materiasExigidas(`${r.descripcion}. ${r.valor_exigido ?? ''}`);
  return porRol(r, materias).flatMap((g) => grupoSinAcreditar(r, d, gente, g) ?? []);
}

/**
 * Los medios personales exigidos (excluyentes, de los lotes a los que se va) cuya materia no
 * acredita nadie, uno por requisito y rol. Los años totales no la acreditan, y el «dudoso» de la
 * ficha tampoco: aquí no se mira «cumple» salvo no_aplica. Puro: lo usan la coherencia y las comprobaciones.
 */
export function mediosSinAcreditar(
  f: FichaDatosData | null,
  ahora: string[],
  d: DecisionesData | null,
  gente: GenteMedios,
): MedioSinAcreditar[] {
  if (!f) return [];
  return mediosEnJuego(f, ahora).flatMap((r) => medioSinAcreditar(r, d, gente));
}

// La forma del pliego («IA administrativa», «Tutor/a»), no la comparable, que solo sirve para casar.
// textoComparable conserva las posiciones: el tramo del original es el mismo; si no casa, queda la comparable.
function literal(
  original: string,
  comparable: string,
  en: number = textoComparable(original).indexOf(comparable),
): string {
  const tramo = en >= 0 ? original.slice(en, en + comparable.length) : '';
  return tramo && textoComparable(tramo) === comparable ? tramo : comparable;
}

const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** El rol como lo escribe el pliego, con mayúscula y su «/a» si la lleva («Tutor/a»). */
export function rolLiteral(descripcion: string, rol: RolNombrado): string {
  const palabra = literal(descripcion, rol.palabra, rol.en);
  const barra = descripcion.slice(rol.en + rol.palabra.length).match(/^\/[ao]s?\b/)?.[0] ?? '';
  return capital(`${palabra}${barra}`);
}

/** La materia como la escribe el requisito (descripción o valor exigido). */
export function materiaLiteral(r: RequisitoFicha, m: Materia): string {
  const enDescripcion = literal(r.descripcion, m.texto);
  return enDescripcion !== m.texto || !r.valor_exigido ? enDescripcion : literal(r.valor_exigido, m.texto);
}

// Lo que Colaboradores no registra no se da por acreditado ni por que falte: la materia que el
// pliego no nombra («relacionada con el curso») y las horas («30 h de formación teleformación/TIC»).
const SIN_OBJETO = /\brelacionad[ao]s?$/;
const CON_HORAS = /\b\d{1,3} ?(?:h|horas)\b/;
export const materiaSinComprobar = (m: Materia): boolean =>
  !m.alternativas.length || SIN_OBJETO.test(m.texto) || CON_HORAS.test(m.texto);

const listaY = (t: string[]) => (t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t.at(-1)}` : (t[0] ?? ''));

// «Tutor/a de topografía (lote 3)»: el rol y las materias que le faltan, como en la matriz (matrizEquipo.ts).
function sujetoDeFalta(x: MedioSinAcreditar): string {
  const rol = x.rol ? rolLiteral(x.requisito.descripcion, x.rol) : 'Medios personales';
  return `${rol} de ${listaY(x.materias.map((m) => materiaLiteral(x.requisito, m)))}${x.lote ? ` (lote ${x.lote})` : ''}`;
}

function textoDeFalta(x: MedioSinAcreditar): string {
  const con = x.materias.map((m) => `«${materiaLiteral(x.requisito, m)}»`).join(', ');
  const quien = x.asignados.length
    ? `nadie en el equipo con ${con} (${x.asignados.map(({ miembro: m, persona: p }) => `${p?.nombre ?? `colaborador ${m.persona_id}`} (${m.rol_en_la_oferta})`).join(', ')} no lo tiene registrado)`
    : `nadie en Colaboradores con ${con}`;
  const otros = x.materias.flatMap((m) =>
    x.alguienLaTiene[m.texto] ? [`${x.alguienLaTiene[m.texto]} sí tiene «${materiaLiteral(x.requisito, m)}»`] : [],
  );
  const sinNombre = x.materias.some((m) => !m.alternativas.length)
    ? ' (el pliego no la nombra: revisa el CV y los certificados)'
    : '';
  return `${sujetoDeFalta(x)}: ${quien}${otros.length ? `; ${otros.join(', ')}` : ''}${sinNombre}`;
}

// Los años totales no acreditan la materia que pide un requisito de medios (p. ej. una
// directora sin la materia que pide el pliego, o tutores sin las horas online exigidas). Uno por
// requisito y rol, como las filas de la matriz: la lista concatenada no se podía leer.
function deMediosSinAcreditar(
  f: FichaDatosData | null,
  ahora: string[],
  d: DecisionesData | null,
  dbNucleo: DbNucleo,
): Incoherencia[] {
  let todas: PersonaGuardada[] | null = null;
  const gente: GenteMedios = {
    personas: () => (todas ??= listarPersonas(dbNucleo)),
    persona: (id) => obtenerPersona(dbNucleo, id).data ?? null,
  };
  return mediosSinAcreditar(f, ahora, d, gente).map((x) => ({
    tipo: 'medios_sin_acreditar',
    gravedad: 'aviso',
    donde: d ? 'decisiones' : 'ficha',
    mensaje: `${textoDeFalta(x)}. Los años totales no acreditan la materia: añade a quien la tenga registrada en Colaboradores o déjalo como «dudoso» hasta acreditarlo.`,
  }));
}

// La frase de «cómo se acredita» que pide el documento («Dossier Técnico Homologado: …»).
const fraseConEvidencia = (como: string) => como.split(/(?<=\.)\s+/).find(pideEvidencia) ?? como;

function porQueNoConsta(p: PropuestaGuardada['datos']['automaticos'][number] | undefined): string {
  if (p?.cumple === 'no') return 'según Hermes no lo cumplimos';
  if (p?.cumple === 'falta_dato') return 'Hermes no encontró con qué acreditarlo';
  return 'no consta que lo tengamos';
}

// Acogerse a un criterio que el pliego pide acreditar con un documento o un hecho (p. ej.
// un dossier homologado del fabricante) sin que conste es una declaración inexacta. Consta si la
// propuesta de Hermes lo dio por cumplido («si»), que mira el perfil de la empresa y los CV.
function deAutomaticosSinAcreditar(
  g: GuionGuardado | null,
  d: DecisionesData,
  p: PropuestaGuardada | null,
): Incoherencia[] {
  if (!g) return [];
  const faltan = d.automaticos
    .filter((a) => a.nos_acogemos)
    .flatMap((a) => {
      const c = automaticoDe(g.datos, a.criterio, a.lote ?? null);
      const propuesto = p?.datos.automaticos.find(
        (x) => claveCriterio(x.criterio) === claveCriterio(a.criterio) && (x.lote ?? null) === (a.lote ?? null),
      );
      const conEvidencia = propuesto?.tipo === 'acreditacion' || (c ? pideEvidencia(c.como_se_acredita) : false);
      if (!conEvidencia || propuesto?.cumple === 'si') return [];
      const como =
        c && pideEvidencia(c.como_se_acredita)
          ? `; se acredita con: ${recorte(fraseConEvidencia(c.como_se_acredita), 160)}`
          : '';
      return [`«${recorte(a.criterio, 100)}» (${porQueNoConsta(propuesto)}${como})`];
    });
  return faltan.length
    ? [
        {
          tipo: 'automaticos_sin_acreditar',
          gravedad: 'aviso',
          donde: 'decisiones',
          mensaje: `Las decisiones se acogen a criterios que hay que acreditar y no consta con qué: ${faltan.slice(0, 4).join('; ')}${faltan.length > 4 ? ' y más' : ''}. Consigue el documento antes de presentar o desmárcalos en Decisiones: marcarlos sin poder acreditarlos es una declaración inexacta.`,
        },
      ]
    : [];
}

const PLAZO_CERCANO_MS = 48 * 3_600_000;

// A menos de 48 h del cierre lo que aún bloquea ya no puede esperar: se dice cuánto queda.
function dePlazo(db: Db, id: string, bloquean: Incoherencia[], ahoraMs: number): Incoherencia[] {
  const p = bloquean.length ? plazoDe(db, id) : null;
  const queda = p ? p.vence - ahoraMs : 0;
  if (!p || queda <= 0 || queda >= PLAZO_CERCANO_MS) return [];
  const horas = Math.floor(queda / 3_600_000);
  const cosas = bloquean.length === 1 ? 'hay 1 cosa que bloquea' : `hay ${bloquean.length} cosas que bloquean`;
  return [
    {
      tipo: 'plazo',
      gravedad: 'aviso',
      donde: bloquean[0]!.donde,
      mensaje: `Quedan ${horas >= 1 ? `${horas} h` : duracionTexto(queda)} para el plazo (${textoPlazo(p.fecha, zonaEmpresa(db))}) y ${cosas} la oferta: arréglalo ya o, si no da tiempo, decide si se presenta.`,
    },
  ];
}

const nombreDe = (dbNucleo: DbNucleo) => (id: number) =>
  obtenerPersona(dbNucleo, id).data?.nombre ?? `colaborador ${id}`;

/** Lo que no casa en la oferta de una licitación, primero lo que bloquea. Vacío si no existe. */
export function coherenciaOferta(dbLic: Db, id: string, op: OpcionesCoherencia = {}): Incoherencia[] {
  const l = lotesDeLicitacion(dbLic, id);
  if (!l) return [];
  const ahora = idsDelAmbito(l.ambito);
  const aprobada = fichasDe(dbLic, id).aprobada;
  const ficha = aprobada?.datos ?? null;
  const g = guionVigente(dbLic, id);
  const d = decisionesDe(dbLic, id)?.datos ?? null;
  const precio =
    op.precio ?? ((lotes: string[]) => precioSugerido(dbLic, id, lotes, nucleo().config.licitaciones.preciosMinimo));
  const dbNucleo = nucleo().db;
  const todas = [
    ...deRegla(l),
    ...deFicha(ficha, ahora),
    ...dePliegos(dbLic, id),
    ...dePliegosTrasGuion(dbLic, id, g, aprobada),
    ...deGuion(dbLic, g, ahora),
    ...deCriteriosDelGuion(dbLic, l, g, ahora),
    ...(d
      ? [
          ...deLotesDecididos(l, d),
          ...deLotesAjenos(l, g, d, ahora, nombreDe(dbNucleo)),
          ...dePrecio(d, g, { precio, presupuestos: presupuestosDeLotes(dbLic, id) }),
          ...deEquipo(ficha, ahora, d),
          ...deAutomaticosSinAcreditar(g, d, propuestaDecisionesDe(dbLic, id)),
        ]
      : []),
    ...deMediosSinAcreditar(ficha, ahora, d, dbNucleo),
  ];
  const bloquean = todas.filter((c) => c.gravedad === 'bloquea');
  return [
    ...bloquean,
    ...dePlazo(dbLic, id, bloquean, op.ahoraMs ?? Date.now()),
    ...todas.filter((c) => c.gravedad === 'aviso'),
  ];
}
