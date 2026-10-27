// Fugas entre sobres: lo que la memoria (juicio de valor) no puede decir porque va en otros archivos.
import { textoComparable } from '../temas.js';
import type { GuionBaseData } from './guion.js';
import { archivosEconomicos } from './guionLotes.js';
import { marcasVigilables } from './guionRevision.js';

// Los pliegos lo castigan con la exclusión («no podrán hacer mención a ninguno de los aspectos incluidos como
// valorables en los criterios automáticos»): una fuga es un error duro que nunca se acepta con
// avisos, salvo los ecos, que son una sospecha (problema blando: tras dos rechazos entran como
// aviso y piden motivo al dar la memoria por buena). Puro: sin base de datos. Se busca frase a frase y cada hallazgo trae su cita literal:
// - las marcas del guion que se pueden vigilar (ni genéricas ni de la rúbrica);
// - lo decidido en los automáticos a los que se acoge la empresa: cifras con unidad del nivel y la nota
//   («2 horas», «24/7», «30 alumnas») y herramientas o certificados que solo se nombran ahí. Una
//   cifra sale en cualquier memoria («sesiones de 2 horas»): cuenta si la frase habla además de
//   su criterio. Lo decidido no se descarta por genérico: es justo lo que la empresa ha ofrecido;
// - importes y bajas de frases que hablan de la oferta (precio, presupuesto, coste, IVA…). Un
//   importe que no habla de ella (el ejemplo de un método de valoración: «página a 4.000 €») no
//   es fuga: se avisa aparte (importesSueltos) y lo revisa una persona;
// - los anexos de esos archivos («Anexo V»);
// - los ecos de lo que se declara en ellos: la frase dice lo mismo con otras palabras (p. ej.
//   «accederá a lo imprescindible para resolver el problema de acceso» frente a la declaración
//   «acceso solo para actuaciones indispensables y precisas para solventar la incidencia»).

// Va en el archivo de criterios automáticos o en el de la oferta económica.
export type TipoFuga = 'marca' | 'decidido' | 'documento' | 'importe' | 'eco';
/** marca: lo que delata (para un eco, la cláusula que repite); cita: la frase literal del texto. */
export type Fuga = { tipo: TipoFuga; marca: string; cita: string; criterio: string; archivo: string };

type Vigilado = { criterio: string; archivo: string; marcas: string[] };
// contexto: conceptos de los que tiene que hablar la frase para que cuente (vacío: siempre).
type Literal = {
  tipo: 'decidido' | 'documento';
  marca: string;
  buscar: string;
  criterio: string;
  archivo: string;
  contexto: string[];
};
type Eco = { criterio: string; archivo: string; clausula: string; conceptos: string[] };

export type ContextoFugas = {
  // Criterios automáticos que van en otro archivo que la memoria, con sus marcas vigilables.
  automaticos: Vigilado[];
  // El nombre del órgano y el título de la licitación se citan tal cual aunque lleven una marca.
  nombresPropios?: string[];
  literales?: Literal[];
  ecos?: Eco[];
  // Conceptos que la rúbrica pide tratar: un eco tiene que decir algo que no esté en ella.
  rubrica?: string[];
  // Dónde va la oferta económica (para el mensaje de los importes).
  economica?: string;
  // Un automático de otro archivo puntúa la experiencia, titulación o certificaciones del equipo:
  // los años junto al nombre de alguien del equipo lo delatan (p. ej. un criterio de experiencia).
  meritos?: { criterio: string; archivo: string; nombres: string[] };
};

type AutomaticoDecidido = {
  criterio: string;
  nos_acogemos: boolean;
  nota?: string | undefined;
  nivel?: string | undefined;
  tramo?: string | null | undefined;
  valor?: number | undefined;
};
export type EntradaFugas = {
  guion: Pick<
    GuionBaseData,
    'archivos' | 'automaticos' | 'memoria' | 'oferta_economica' | 'ofertas_economicas' | 'lotes'
  >;
  decididos?: AutomaticoDecidido[] | undefined;
  // Las herramientas de las decisiones son para la memoria: no delatan nada.
  herramientas?: string[] | undefined;
  nombresPropios?: string[] | undefined;
  // Los nombres del equipo de las decisiones.
  equipo?: string[] | undefined;
};

// Lo que puntúa del equipo: su experiencia, su titulación, su CV o sus certificaciones personales.
const MERITOS_DEL_EQUIPO =
  /experiencia|titulaci[oó]n|curricul|\bcv\b|(certificaci[oó]n|certificado)[^.]{0,60}\b(personal|profesional|equipo|director|coordinador|t[eé]cnic|docente|formador|tutor)/i;

/** El primer criterio automático de otro archivo que la memoria que puntúa méritos del equipo (null si no hay). */
export function meritosEnOtroArchivo(
  g: Pick<GuionBaseData, 'automaticos' | 'memoria'>,
): { criterio: string; archivo: string } | null {
  const mem = g.memoria;
  if (!mem) return null;
  const a = g.automaticos.find(
    (x) => !mismo(x.archivo, mem.archivo) && MERITOS_DEL_EQUIPO.test(`${x.criterio} ${x.como_se_acredita}`),
  );
  return a ? { criterio: a.criterio, archivo: a.archivo } : null;
}

const IMPORTES = [
  /\d[\d.,]*\s?(?:€|eur\b|euros\b)/gi,
  /€\s?\d[\d.,]*/g,
  /\b(?:baja|descuento|rebaja)\b[^.\n]{0,60}?\d+(?:[.,]\d+)?\s?%/gi,
];
// «Baja» sola no: también es la de una alumna («si la baja supera el 10 %»).
const DE_LA_OFERTA =
  /\b(?:precios?|presupuestos?|rebajas?|honorarios|factur\w*|iva|igic|costes?|costos?|ofertamos|ofertad[oa]s?|oferta economica|nuestra oferta)\b/;

// ── Texto comparable ──

// Sin tildes ni signos y con las unidades en una sola forma («2 horas», «2 h» y «2h»).
function normal(t: string): string {
  const c = textoComparable(t)
    .replace(/(\d)\s*(?:horas?|hrs?|h)(?![\p{L}])/gu, '$1 h')
    .replace(/(\d)\s*(?:minutos?|min)(?![\p{L}])/gu, '$1 min')
    .replace(/(\d)\s*%/g, '$1 %');
  return ` ${c.replace(/[^\p{L}\p{N}%]+/gu, ' ').trim()} `;
}

const contiene = (texto: string, marca: string) => marca.trim() !== '' && texto.includes(` ${marca.trim()} `);

// Un punto parte la frase solo si sigue una mayúscula: «S.L. (Acme)» o «12.500 €» no la parten.
export function frases(texto: string): string[] {
  return texto
    .split(/\n+|(?<=[.!?;])\s+(?=[¿¡«"“]?[A-ZÁÉÍÓÚÜÑ])/u)
    .map((f) => f.trim())
    .filter(Boolean);
}

const importesDe = (frase: string): string[] =>
  IMPORTES.flatMap((re) => [...frase.matchAll(re)].map((m) => m[0].trim()));
const hablaDeLaOferta = (frase: string): boolean => DE_LA_OFERTA.test(textoComparable(frase));

/** Importes de frases que no hablan de la oferta: no son fuga, pero una persona debe verlos. */
export function importesSueltos(texto: string): string[] {
  return frases(texto)
    .filter((f) => !hablaDeLaOferta(f))
    .flatMap(importesDe);
}

// ── Conceptos (para los ecos y el contexto de las cifras) ──

// Palabras que dicen lo mismo en una declaración responsable y en una memoria.
const FAMILIAS: [string, RegExp][] = [
  ['acceso', /^(?:acced|acces)/],
  ['imprescindible', /^(?:impresc|indispens)/],
  ['resolver', /^(?:resolv|resuelv|resoluc|solvent|soluci)/],
  ['incidencia', /^(?:incidenc|incident|problem|averi)/],
  ['autorizacion', /^(?:autoriz|consentim|permiso)/],
  ['contrasena', /^(?:contrasen|credencial)/],
  ['remoto', /^remot/],
];
const VACIAS = new Set(
  (
    'para como sobre entre desde hasta solo cada todo toda todos todas este esta estos estas esto otro otra otros otras puede pueden ' +
    'podra podran sera seran debe deben debera deberan tambien segun mediante cuando donde dicho dicha mismo misma nunca siempre ningun ninguna ninguno ' +
    'alguna alguno algun tanto parte forma manera caso tras ante bajo contra sino aunque porque pues mientras durante dentro fuera menos cual cuales ' +
    'quien quienes sean estar tiene tienen tener hacer hace haya sido siendo nuestro nuestra nuestros nuestras unos unas esos esas cuyo cuya antes ' +
    'despues junto'
  ).split(' '),
);
// Lo que sale en cualquier pliego o memoria de formación: no distingue un criterio de otro (los
// requisitos de solvencia, «título», «experiencia mínima», «horas», tampoco).
const GENERICOS = new Set(
  (
    'anexo modelo declar respon firma firmad oferta aporta indica confor puntos puntua criter aparta casill archiv docume pliego ' +
    'pcap lote lotes licita contra adjudi empres servic alumna alumno usuari plataf curso cursos formac docent tutor tutora tutore tutori person datos ' +
    'inform protec proteg debida acredi requis exigid exigen exige minimo minima maximo maxima numero aument mejora mejoras titulo titula experi horas'
  ).split(' '),
);

function conceptos(t: string): Set<string> {
  const out = new Set<string>();
  for (const [p] of textoComparable(t).matchAll(/\p{L}+/gu)) {
    if (p.length < 4 || VACIAS.has(p)) continue;
    const c = FAMILIAS.find(([, re]) => re.test(p))?.[0] ?? p.slice(0, 6);
    if (!GENERICOS.has(c)) out.add(c);
  }
  return out;
}

// Un eco comparte con la cláusula al menos 3 conceptos, la mitad de los suyos, y uno que no
// pida la rúbrica: lo que la rúbrica pide tratar («resolver las incidencias de acceso») se dice.
const ECO_MINIMO = 3;
const ECO_PROPORCION = 0.5;

function esEco(frase: Set<string>, e: Eco, rubrica: Set<string>): boolean {
  const comunes = e.conceptos.filter((c) => frase.has(c));
  return (
    comunes.length >= ECO_MINIMO &&
    comunes.length / e.conceptos.length >= ECO_PROPORCION &&
    comunes.some((c) => !rubrica.has(c))
  );
}

// ── Contexto ──

const mismo = (a: string, b: string) =>
  textoComparable(a).replace(/\s+/g, ' ').trim() === textoComparable(b).replace(/\s+/g, ' ').trim();
type Guion = EntradaFugas['guion'];
type Memoria = NonNullable<Guion['memoria']>;

const textosRubrica = (m: Memoria): string[] => m.apartados.flatMap((a) => [a.titulo, ...a.se_valorara]);

// Cifras con unidad («2 horas», «≤ 2 h», «30 alumnas», «10 %») y «24/7».
const UNIDADES =
  'horas?|h|minutos?|min|dias?|semanas?|meses|mes|anos?|alumn[oa]s?|plazas?|participantes?|tutor(?:es|as?)?|docentes?|personas?|sesiones?|cursos?|licencias?|usuari[oa]s?|informes?|visitas?';
const CIFRA = new RegExp(`\\d+(?:[.,]\\d+)?\\s*(?:%|(?:${UNIDADES})(?![\\p{L}]))`, 'gu');
const SIEMPRE = /\b24\s*(?:\/|x)\s*7\b/g;
// Herramientas y certificados: «RustDesk», «n8n», «H5P», «ISO 14001».
const HERRAMIENTA =
  /\b[A-Z]?[a-z]+[A-Z][A-Za-z]*\b|\b(?=[A-Za-z\d]{3,}\b)[A-Za-z]+\d[A-Za-z\d]*\b|\b(?:ISO|UNE|EN)[ -]?\d{3,5}(?:[-:]\d+)*\b/g;

function cifrasDe(t: string): string[] {
  const c = textoComparable(t);
  return [...c.matchAll(CIFRA), ...c.matchAll(SIEMPRE)].map((m) => m[0].trim());
}

// El tramo elegido (si no es el criterio entero), el nivel o lo primero de la nota: las
// propuestas anteriores guardaban ahí «nivel. motivo».
const tramoPropio = (d: AutomaticoDecidido) => (d.tramo && !mismo(d.tramo, d.criterio) ? d.tramo : d.nivel);
const nivelDe = (d: AutomaticoDecidido) => tramoPropio(d) ?? d.nota?.split(/\.\s+/)[0] ?? '';

const ES = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });

// La cifra que de verdad se oferta (decisiones.valor), como la escribiría el redactor: «2,25» o
// «2.25» (las dos dan lo mismo al normalizar) y «1.000» o «1000».
function marcasDeValor(valor: number | undefined): string[] {
  if (valor === undefined) return [];
  const formas = [ES.format(valor), String(valor)];
  return formas.filter((f, i) => formas.findIndex((g) => normal(g) === normal(f)) === i);
}

function literalesDecididos(e: EntradaFugas, vigilados: Vigilado[], rubrica: string): Literal[] {
  const usadas = normal((e.herramientas ?? []).join(' | '));
  return (e.decididos ?? [])
    .filter((d) => d.nos_acogemos)
    .flatMap((d) => {
      const a = vigilados.find((x) => mismo(x.criterio, d.criterio));
      if (!a) return [];
      const texto = [tramoPropio(d), d.nota].filter(Boolean).join('. ');
      // Sin nada propio del criterio de que hablar, una cifra no se distingue de cualquier otra.
      const contexto = [...conceptos(`${a.criterio} ${nivelDe(d)}`)];
      const cifras = contexto.length
        ? [...cifrasDe(texto), ...marcasDeValor(d.valor)].map((m) => ({ marca: m, contexto }))
        : [];
      const herramientas = [...texto.matchAll(HERRAMIENTA)]
        .map((m) => ({ marca: m[0], contexto: [] as string[] }))
        .filter((h) => !contiene(usadas, normal(h.marca)));
      return [...cifras, ...herramientas]
        .map((x) => ({
          tipo: 'decidido' as const,
          ...x,
          buscar: normal(x.marca),
          criterio: a.criterio,
          archivo: a.archivo,
        }))
        .filter((x) => !contiene(rubrica, x.buscar));
    });
}

const ANEXO = /\banexo\s+[ivxlcdm\d]+\b/gi;

// Los anexos de los archivos de los automáticos y de la oferta económica que no son también de
// la memoria («Anexo V» en el sobre C, no el «Anexo IV» de la propuesta del sobre B).
function literalesDocumentos(g: Guion, mem: Memoria, rubrica: string): Literal[] {
  const ajenos = [...g.automaticos.map((a) => a.archivo), ...archivosEconomicos(g)].filter(
    (a) => !mismo(a, mem.archivo),
  );
  const ajeno = (archivo: string) => ajenos.some((a) => mismo(a, archivo));
  const propios = g.archivos
    .filter((a) => mismo(a.nombre, mem.archivo))
    .flatMap((a) => a.documentos.flatMap((d) => [d.nombre, d.origen?.modelo ?? '']));
  const vetados = normal([...propios, ...mem.advertencias].join(' | '));
  const fuentes = [
    ...g.archivos
      .filter((a) => ajeno(a.nombre))
      .flatMap((a) =>
        a.documentos.map((d) => ({
          texto: `${d.nombre} ${d.origen?.modelo ?? ''}`,
          criterio: d.nombre,
          archivo: a.nombre,
        })),
      ),
    ...g.automaticos
      .filter((a) => ajeno(a.archivo))
      .map((a) => ({ texto: a.casilla_en, criterio: a.criterio, archivo: a.archivo })),
  ];
  const vistos = new Set<string>();
  return fuentes
    .flatMap((f) =>
      [...f.texto.matchAll(ANEXO)].map((m) => ({ ...f, marca: `Anexo ${m[0].split(/\s+/)[1]!.toUpperCase()}` })),
    )
    .filter((x) => {
      const n = normal(x.marca);
      const nuevo = !vistos.has(n) && !contiene(vetados, n) && !contiene(rubrica, n);
      vistos.add(n);
      return nuevo;
    })
    .map((x) => ({
      tipo: 'documento' as const,
      marca: x.marca,
      buscar: normal(x.marca),
      criterio: x.criterio,
      archivo: x.archivo,
      contexto: [],
    }));
}

// Lo que se declara de cada automático: cómo se acredita (frase a frase) y el nivel decidido.
// Ni su nombre (con uno corto, describir lo que pide la rúbrica ya lo repetía) ni los criterios
// a los que la empresa no se acoge: ahí no se declara nada que delatar.
function ecosDe(g: Guion, vigilados: Vigilado[], decididos: AutomaticoDecidido[]): Eco[] {
  return vigilados.flatMap((v) => {
    if (decididos.some((x) => !x.nos_acogemos && mismo(x.criterio, v.criterio))) return [];
    const a = g.automaticos.find((x) => mismo(x.criterio, v.criterio));
    const d = decididos.find((x) => x.nos_acogemos && mismo(x.criterio, v.criterio));
    const clausulas = [...(a?.como_se_acredita.split(/[.;:]\s+|\n+/) ?? []), ...(d ? [nivelDe(d)] : [])];
    return clausulas
      .map((c) => ({ criterio: v.criterio, archivo: v.archivo, clausula: c.trim(), conceptos: [...conceptos(c)] }))
      .filter((e) => e.conceptos.length >= ECO_MINIMO);
  });
}

function economicaDe(g: Guion): { economica?: string } {
  const a = archivosEconomicos(g)[0];
  return a ? { economica: a } : {};
}

/** Lo que se vigila en una memoria con este guion y estas decisiones (vacío si el guion no trae memoria). */
export function contextoDeFugas(e: EntradaFugas): ContextoFugas {
  const mem = e.guion.memoria;
  const nombresPropios = e.nombresPropios ?? [];
  if (!mem) return { automaticos: [], nombresPropios };
  const automaticos = e.guion.automaticos
    .filter((x) => !mismo(x.archivo, mem.archivo))
    .map((x) => ({ ...x, marcas: marcasVigilables(x.marcas, mem.apartados) }));
  const rubrica = normal(textosRubrica(mem).join(' | '));
  const meritos = meritosEnOtroArchivo(e.guion);
  const equipo = (e.equipo ?? []).filter((x) => x.trim());
  return {
    automaticos,
    nombresPropios,
    ...(meritos && equipo.length ? { meritos: { ...meritos, nombres: equipo } } : {}),
    literales: [...literalesDocumentos(e.guion, mem, rubrica), ...literalesDecididos(e, automaticos, rubrica)],
    ecos: ecosDe(e.guion, automaticos, e.decididos ?? []),
    rubrica: [...conceptos(textosRubrica(mem).join(' '))],
    ...economicaDe(e.guion),
  };
}

// ── Detección ──

const CITA_MAX = 300;

// La frase entera o, si es larga, el trozo alrededor de lo que delata.
function citaDe(frase: string, marca: string): string {
  if (frase.length <= CITA_MAX) return frase;
  const i = Math.max(0, textoComparable(frase).indexOf(textoComparable(marca).split(/\s+/)[0] ?? ''));
  const desde = Math.max(0, i - 120);
  return `${desde > 0 ? '…' : ''}${frase.slice(desde, desde + CITA_MAX - 20).trim()}…`;
}

function enFrase(frase: string, n: string, ctx: ContextoFugas): Omit<Fuga, 'cita'>[] {
  const marcas = ctx.automaticos.flatMap((a) =>
    a.marcas
      .filter((m) => contiene(n, normal(m)))
      .map((m) => ({ tipo: 'marca' as const, marca: m, criterio: a.criterio, archivo: a.archivo })),
  );
  const deLaFrase = conceptos(n);
  // Con la marca del guion ya basta: «30 alumnas adicionales» no es además la cifra decidida.
  const conMarca = new Set(marcas.map((m) => m.criterio));
  const literales = (ctx.literales ?? [])
    .filter(
      (l) =>
        !conMarca.has(l.criterio) &&
        contiene(n, l.buscar) &&
        (!l.contexto.length || l.contexto.some((c) => deLaFrase.has(c))),
    )
    .map(({ tipo, marca, criterio, archivo }) => ({ tipo, marca, criterio, archivo }));
  const economica = ctx.economica ?? 'el archivo de la oferta económica';
  const importes = (hablaDeLaOferta(frase) ? importesDe(frase) : []).map((m) => ({
    tipo: 'importe' as const,
    marca: m,
    criterio: 'Oferta económica',
    archivo: economica,
  }));
  const ya = new Set([...marcas, ...literales].map((x) => x.criterio));
  const rubrica = new Set(ctx.rubrica ?? []);
  const ecos = (ctx.ecos ?? [])
    .filter((e) => !ya.has(e.criterio) && esEco(deLaFrase, e, rubrica))
    .slice(0, 1)
    .map((e) => ({ tipo: 'eco' as const, marca: e.clausula, criterio: e.criterio, archivo: e.archivo }));
  return [...marcas, ...literales, ...importes, ...ecos, ...aniosDelEquipo(n, ctx)];
}

const ANIOS = / (\d+(?:[.,]\d+)?) (?:anos?|ejercicios) /;

// Con un automático que puntúa méritos del equipo en otro archivo, los años de alguien del
// equipo (por su nombre o su nombre de pila) dicen lo que se valora allí.
function aniosDelEquipo(n: string, ctx: ContextoFugas): Omit<Fuga, 'cita'>[] {
  const m = ctx.meritos;
  const anios = m ? ANIOS.exec(n) : null;
  if (!m || !anios) return [];
  const nombra = m.nombres.some((x) => {
    const nombre = normal(x).trim();
    const pila = nombre.split(' ')[0] ?? '';
    return contiene(n, nombre) || (pila.length >= 4 && contiene(n, pila));
  });
  return nombra ? [{ tipo: 'decidido', marca: `${anios[1]} años`, criterio: m.criterio, archivo: m.archivo }] : [];
}

/** Las fugas de un texto, frase a frase, cada una con su cita literal y el criterio que delata. */
export function detectarFugas(texto: string, ctx: ContextoFugas): Fuga[] {
  const propios = (ctx.nombresPropios ?? []).map((x) => normal(x).trim()).filter((x) => x.length >= 8);
  const vistas = new Set<string>();
  return frases(texto)
    .flatMap((frase) => {
      const n = propios.reduce((x, p) => x.split(` ${p} `).join(' '), normal(frase));
      return enFrase(frase, n, ctx).map((f) => ({ ...f, cita: citaDe(frase, f.marca) }));
    })
    .filter((f) => {
      const clave = `${f.tipo}|${textoComparable(f.marca)}|${f.cita}`;
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    });
}

const corto = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 3)}…` : t);

/** Qué delata la fuga, sin la cita (la cita puede nombrar a personas del equipo). */
export function descripcionDeFuga(f: Pick<Fuga, 'tipo' | 'marca' | 'criterio' | 'archivo'>): string {
  switch (f.tipo) {
    case 'importe':
      return `un importe o una baja («${f.marca}»), que van en «${f.archivo}»`;
    case 'documento':
      return `nombra «${f.marca}», que va en «${f.archivo}»`;
    case 'eco':
      return `repite con otras palabras lo que se declara en «${corto(f.criterio)}»: «${corto(f.marca, 160)}»`;
    case 'decidido':
      return `«${f.marca}» es lo que ofrecemos en el criterio automático «${corto(f.criterio)}», que va en «${f.archivo}»`;
    default:
      return `«${f.marca}» delata el criterio automático «${corto(f.criterio)}», que va en «${f.archivo}»`;
  }
}
