// Coherencia de la memoria contra su hoja de hechos (docs/memoria-tecnica.md, paso 4). Puro: sin base de datos.
import { textoComparable } from '../temas.js';
import type { HechoData } from './estrategia.js';
import { frases } from './fugas.js';

// Una memoria puede dar «de 9:00 a 18:00» en un apartado y 9-17 h en otro, o tiempos de respuesta distintos en
// varios; o nombrar al equipo cuando el pliego pedía CV anónimos. Se busca frase a frase (el troceo de
// fugas.ts): en las frases donde sale alguna palabra ancla de un hecho se sacan sus valores normalizados según
// la categoría y se comparan con la hoja. Sin hechos, el mismo ancla con valores distintos en dos apartados
// también es un hallazgo.
const normal = (t: string) =>
  ` ${textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

// ── Nombres del equipo ──

// Cómo se nombra a una persona en un texto: entera, por nombre y primer apellido o por los dos
// apellidos («Ana García Pérez», «Ana García», «García Pérez»). Un nombre suelto no basta.
function formasDe(nombre: string): string[] {
  const t = textoComparable(nombre)
    .replace(/[^\p{L}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((x) => x.length >= 2);
  const formas = [t.join(' '), t.slice(0, 2).join(' '), t.length >= 3 ? t.slice(-2).join(' ') : ''];
  return [...new Set(formas.filter((f) => f.split(' ').length >= 2))];
}

/** ¿Se puede buscar a esta persona en un texto? Con una sola palabra («Ana», «A.») no hay forma fiable. */
export const nombreBuscable = (nombre: string): boolean => formasDe(nombre).length > 0;

/** Los nombres del equipo que aparecen en un texto (sin tildes ni mayúsculas). */
export function nombresDelEquipoEn(texto: string, nombres: string[]): string[] {
  const n = normal(texto);
  return nombres.filter((p) => formasDe(p).some((f) => n.includes(` ${f} `)));
}

// ── Valores normalizados ──

export type TipoValor = 'horario' | 'plazo' | 'cifra';

// «9:00-17:00», «de 9 a 17 h», «9.00–17.00 h», «de 9:00 a 18:00»: con minutos o con «h» detrás
// (sin ellos, «de 2 a 4 sesiones» sería un horario). Nunca «1.000-2.000».
const HORARIO =
  /\b([01]?\d|2[0-4])(?:[:.h]([0-5]\d)(?!\d))?\s*(h\b|horas?\b)?\s*(?:-|–|—|\ba\b|\bhasta\b)\s*(?:las\s+)?([01]?\d|2[0-4])(?:[:.h]([0-5]\d)(?!\d))?\s*(h\b|horas?\b)?/g;
// «en 48 horas», «4 horas hábiles», «2 días», «30 min»; no las horas de un reloj («17:00 h»).
const PLAZO = /(?<![\d:.,])(\d+(?:[.,]\d+)?)\s*(minutos?|min|horas?|h|dias?|semanas?|meses|mes)\b/g;
const SIEMPRE = /\b24\s*(?:\/|x)\s*7\b/g;
const UNIDAD_PLAZO: [RegExp, string][] = [
  [/^min/, 'min'],
  [/^h/, 'h'],
  [/^dia/, 'dia'],
  [/^semana/, 'semana'],
  [/^mes/, 'mes'],
];
const CIFRA = /(?<![\d:.,])(\d+(?:[.,]\d+)?)\s*(%|[a-z]+)/g;

const reloj = (h: string, m: string | undefined) => `${Number(h)}:${(m ?? '00').padStart(2, '0')}`;

// Con minutos es una hora; sin ellos, solo con «h» detrás y entre las 6 y las 23 («de 9 a 17 h»,
// no «de 2 a 4 horas», que es una duración).
function esHorario(m: RegExpMatchArray): boolean {
  const [desde, hasta] = [Number(m[1]), Number(m[4])];
  const conMinutos = m[2] !== undefined || m[5] !== undefined;
  const conH = m[3] !== undefined || m[6] !== undefined;
  const ordenado = hasta > desde || (hasta === desde && Number(m[5] ?? 0) > Number(m[2] ?? 0));
  return ordenado && (conMinutos || (conH && desde >= 6 && hasta <= 23));
}

const rangos = (c: string) => [...c.matchAll(HORARIO)].filter(esHorario);

function horarios(c: string): string[] {
  return rangos(c).map((m) => `${reloj(m[1]!, m[2])}-${reloj(m[4]!, m[5])}`);
}

// Sin los horarios: el «17 h» de «de 9 a 17 h» no es un plazo.
function plazos(texto: string): string[] {
  const c = rangos(texto).reduce((t, m) => t.replace(m[0], ' '), texto);
  const durs = [...c.matchAll(PLAZO)].map(
    (m) => `${m[1]!.replace(',', '.')} ${UNIDAD_PLAZO.find(([re]) => re.test(m[2]!))![1]}`,
  );
  return [...durs, ...[...c.matchAll(SIEMPRE)].map(() => '24/7')];
}

const singular = (u: string) => (u === '%' ? u : u.replace(/(?:es|s)$/, ''));

function cifras(c: string, unidades: Set<string>): string[] {
  return [...c.matchAll(CIFRA)]
    .map((m) => ({ n: m[1]!.replace(',', '.'), u: singular(m[2]!) }))
    .filter((x) => unidades.has(x.u))
    .map((x) => `${x.n} ${x.u}`);
}

const TIPO_DE_CATEGORIA: Partial<Record<HechoData['categoria'], TipoValor>> = {
  horario: 'horario',
  calendario: 'horario',
  plazo: 'plazo',
  indicador: 'cifra',
  cifra: 'cifra',
};

/** Los valores de un tipo en un texto, ya normalizados («9:00-17:00», «48 h», «30 alumna»). */
export function valoresDe(tipo: TipoValor, texto: string, unidades: Set<string> = new Set()): string[] {
  const c = textoComparable(texto);
  if (tipo === 'horario') return horarios(c);
  return tipo === 'plazo' ? plazos(c) : cifras(c, unidades);
}

// ── Hallazgos ──

// compromiso: un criterio automático que se acredita en esta memoria y cuyo valor no aparece (compromisosMemoria.ts).
// repeticion: una frase de 6 palabras o más repetida más de 8 veces en el documento (repeticion.ts; solo avisa).
type TipoHallazgo = 'contradiccion' | 'nombre' | 'herramienta' | 'entre_apartados' | 'compromiso' | 'repeticion';
export type Hallazgo = {
  apartado: number;
  hecho: string;
  cita: string;
  encontrado: string;
  esperado: string;
  tipo: TipoHallazgo;
};
export type HechoCoherencia = Pick<HechoData, 'clave' | 'categoria' | 'sobre' | 'valor' | 'palabras'> & {
  unidad?: string | undefined;
  corto?: string | undefined;
};
export type OpcionesCoherencia = { equipo?: string[]; porRoles?: boolean; herramientas?: string[] };

const CITA_MAX = 240;
const citaDe = (f: string) => (f.length > CITA_MAX ? `${f.slice(0, CITA_MAX - 1).trim()}…` : f);
// Un ancla casa por la palabra entera o su plural («consultas» encuentra «consulta»), nunca por
// un trozo: «consultas» no es «consultor» ni «consultoría».
const formas = (w: string) => new Set([w, `${w}s`, `${w}es`, w.replace(/s$/, ''), w.replace(/es$/, '')]);
function tieneAncla(n: string, palabras: string[]): boolean {
  const tokens = n.trim().split(' ');
  return palabras.some((p) => {
    const ancla = normal(p).trim();
    if (!ancla) return false;
    return ancla.includes(' ') ? n.includes(` ${ancla} `) : tokens.some((t) => formas(t).has(ancla));
  });
}

/** ¿Hay que reescribir por este hallazgo? Los de «entre_apartados» (anclas genéricas, sin saber de qué servicio habla cada frase) solo avisan a la persona. */
export const obligaARehacer = (h: Pick<Hallazgo, 'tipo'>): boolean =>
  h.tipo === 'contradiccion' || h.tipo === 'nombre' || h.tipo === 'compromiso';

function contradiccion(h: HechoCoherencia, frase: string, apartado: number): Hallazgo | null {
  const tipo = TIPO_DE_CATEGORIA[h.categoria];
  if (!tipo || !tieneAncla(normal(frase), h.palabras)) return null;
  const unidades = new Set(
    [...textoComparable(`${h.valor} ${h.unidad ?? ''}`).matchAll(CIFRA)].map((m) => singular(m[2]!)),
  );
  const esperados = valoresDe(tipo, `${h.valor}${h.unidad ? ` ${h.unidad}` : ''}`, unidades);
  const encontrados = valoresDe(tipo, frase, unidades);
  if (!esperados.length || !encontrados.length || encontrados.some((v) => esperados.includes(v))) return null;
  return {
    apartado,
    hecho: h.clave,
    cita: citaDe(frase),
    encontrado: encontrados.join(', '),
    esperado: h.valor,
    tipo: 'contradiccion',
  };
}

// Herramientas y productos que se reconocen por su nombre.
const PRODUCTOS =
  /\b(moodle|microsoft teams|teams|zoom|google meet|slack|jira|trello|asana|sharepoint|onedrive|power bi|tableau|salesforce|hubspot|notion|confluence|github|gitlab|wordpress|odoo|sap|zendesk|freshdesk|glpi|redmine|n8n|h5p|rustdesk|anydesk|teamviewer|canva|genially|kahoot|mentimeter)\b/g;

function herramientasAjenas(frase: string, apartado: number, conocidas: string[]): Hallazgo[] {
  const c = textoComparable(frase);
  return [...new Set([...c.matchAll(PRODUCTOS)].map((m) => m[1]!))]
    .filter((p) => !conocidas.some((k) => k.includes(p)))
    .map((p) => ({
      apartado,
      hecho: '',
      cita: citaDe(frase),
      encontrado: p,
      esperado: 'las herramientas de las decisiones y de la hoja de hechos',
      tipo: 'herramienta' as const,
    }));
}

// El rol se nombra entero o por su sigla («RS»): las dos formas son el mismo rol.
const nombraRol = (n: string, h: HechoCoherencia): boolean =>
  n.includes(normal(h.sobre)) || (h.corto !== undefined && n.includes(normal(h.corto)));

// Una persona del equipo con el rol que la hoja da a otra («Luis, responsable del servicio»).
function rolesCruzados(frase: string, apartado: number, hechos: HechoCoherencia[], equipo: string[]): Hallazgo[] {
  const roles = hechos
    .filter((h) => h.categoria === 'rol')
    .map((h) => ({ h, de: nombresDelEquipoEn(h.valor, equipo) }))
    .filter((x) => x.de.length === 1);
  const n = normal(frase);
  return nombresDelEquipoEn(frase, equipo).flatMap((persona) => {
    const suyos = roles.filter((r) => r.de[0] === persona);
    const ajeno = roles.find((r) => r.de[0] !== persona && nombraRol(n, r.h));
    if (!ajeno || suyos.some((r) => nombraRol(n, r.h))) return [];
    return [
      {
        apartado,
        hecho: ajeno.h.clave,
        cita: citaDe(frase),
        encontrado: `${persona}, ${ajeno.h.sobre}`,
        esperado: suyos[0]?.h.valor ?? `${ajeno.h.sobre} es ${ajeno.de[0]}`,
        tipo: 'contradiccion' as const,
      },
    ];
  });
}

function enFrase(frase: string, apartado: number, hechos: HechoCoherencia[], op: OpcionesCoherencia): Hallazgo[] {
  const equipo = op.equipo ?? [];
  const nombres = op.porRoles
    ? nombresDelEquipoEn(frase, equipo).map((p) => ({
        apartado,
        hecho: '',
        cita: citaDe(frase),
        encontrado: p,
        esperado: 'el rol, sin el nombre',
        tipo: 'nombre' as const,
      }))
    : [];
  const conocidas = [
    ...(op.herramientas ?? []),
    ...hechos.filter((h) => h.categoria === 'herramienta').map((h) => h.valor),
  ].map(textoComparable);
  return [
    ...nombres,
    ...hechos.map((h) => contradiccion(h, frase, apartado)).filter((x): x is Hallazgo => x !== null),
    ...(op.porRoles ? [] : rolesCruzados(frase, apartado, hechos, equipo)),
    ...herramientasAjenas(frase, apartado, conocidas),
  ];
}

const sinRepetir = (hs: Hallazgo[]): Hallazgo[] => {
  const vistos = new Set<string>();
  return hs.filter((h) => {
    const k = `${h.apartado}|${h.tipo}|${h.hecho}|${h.encontrado}|${h.cita}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
};

/** Lo que no casa con la hoja de hechos en cada apartado (textos[i] es el apartado i+1). */
export function hallazgosDeCoherencia(
  textos: string[],
  hechos: HechoCoherencia[],
  op: OpcionesCoherencia = {},
): Hallazgo[] {
  return sinRepetir(textos.flatMap((t, i) => frases(t).flatMap((f) => enFrase(f, i + 1, hechos, op))));
}

// ── Entre apartados, sin hoja de hechos ──

const ANCLAS: Record<'horario' | 'plazo', string[]> = {
  horario: ['atencion', 'soporte', 'horario', 'consulta', 'tutoria'],
  plazo: ['respuesta', 'resolucion', 'incidencia', 'consulta'],
};

type Visto = { apartado: number; valores: string[]; cita: string };

function vistosPorAncla(textos: string[], tipo: 'horario' | 'plazo'): Map<string, Visto[]> {
  const grupos = new Map<string, Visto[]>();
  textos.forEach((t, i) =>
    frases(t).forEach((f) => {
      const valores = valoresDe(tipo, f);
      const ancla = ANCLAS[tipo].find((a) => tieneAncla(normal(f), [a]));
      if (valores.length && ancla)
        grupos.set(ancla, [...(grupos.get(ancla) ?? []), { apartado: i + 1, valores, cita: citaDe(f) }]);
    }),
  );
  return grupos;
}

/** El mismo ancla (atención, respuesta…) con valores que no comparten nada en dos apartados distintos. */
export function contradiccionesEntreApartados(textos: string[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const tipo of ['horario', 'plazo'] as const) {
    for (const [ancla, vistos] of vistosPorAncla(textos, tipo)) {
      const primero = vistos[0]!;
      const choca = vistos.find(
        (v) => v.apartado !== primero.apartado && !v.valores.some((x) => primero.valores.includes(x)),
      );
      if (choca)
        out.push({
          apartado: choca.apartado,
          hecho: ancla,
          cita: choca.cita,
          encontrado: choca.valores.join(', '),
          esperado: `${primero.valores.join(', ')} (apartado ${primero.apartado}: «${primero.cita}»)`,
          tipo: 'entre_apartados',
        });
    }
  }
  return out;
}

/** La frase exacta de un hallazgo, para el rechazo, el aviso y la ronda siguiente. */
export function textoDeHallazgo(h: Hallazgo, hechos: HechoCoherencia[] = []): string {
  const sobre = hechos.find((x) => x.clave === h.hecho)?.sobre;
  switch (h.tipo) {
    case 'nombre':
      return `Nombra a ${h.encontrado} y el pliego pide el equipo por roles, sin nombres: escribe solo su rol («${h.cita}»).`;
    case 'herramienta':
      return `Nombra «${h.encontrado}», que no está en las decisiones ni en la hoja de hechos: quítalo o usa una de las decididas («${h.cita}»).`;
    case 'compromiso':
      return `La memoria no declara lo que ofrecemos en «${h.hecho}» (${h.esperado}), que se acredita en este mismo archivo: decláralo con su valor y su plan (sesiones, destinatarios y semana; o meses, horario y prioridades), sin importes.`;
    case 'repeticion':
      return `«${h.cita}» sale ${h.encontrado} en la memoria: varía la frase y, si es un rol, preséntalo entero una vez y después cítalo por su sigla.`;
    case 'entre_apartados':
      return `El apartado ${h.apartado} dice ${h.encontrado} para «${h.hecho}» y otro dice ${h.esperado}: comprueba si es el mismo servicio y, si lo es, que coincidan («${h.cita}»).`;
    default:
      return `La hoja de hechos dice «${h.esperado}»${sobre ? ` para ${sobre}` : ''} y aquí pone ${h.encontrado} («${h.cita}»): copia el valor de la hoja.`;
  }
}
