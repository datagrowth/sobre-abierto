// El bloque «solucion» de la estrategia de la memoria: los parámetros de diseño que el pliego deja al licitador. Puro.
import { z } from 'zod';
import { textoComparable } from '../temas.js';
import { parametroConcreto } from './aplazamientos.js';
import {
  avisoDeCoste,
  Compromiso,
  compromisosVigentes,
  esCaro,
  llevaImporte,
  NIVELES_COSTE,
  problemasDeAnadido,
  problemasDeExigidoSinCoste,
  solucionNormalizada,
  textoDeCoste,
  type CompromisoData,
} from './compromisosSolucion.js';
import { detectarFugas, type ContextoFugas } from './fugas.js';

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const NumApartado = z.number().int().min(1).max(20);
const NIVEL = ['baja', 'media', 'alta'] as const;

// Ya decididos: calendario con fechas, arquitectura por capa, modelos, umbrales, banco de pruebas, formación y
// soporte si se acreditan aquí, riesgos con dueño, siglas de los roles, un caso por apartado, como mucho cinco
// pendientes que el pliego reserva al órgano y el catálogo de reglas del cliente con su norma. Sin él, la
// estrategia convertía «no consta en el dossier» en «se aprobará después» y la memoria salía con un calendario
// relativo a «T0» y sin cifras: el tramo Aceptable del pliego («carencias de detalle que requerirán concreción
// posterior»).
export const Solucion = z.strictObject({
  calendario: z.strictObject({
    inicio: Fecha.describe('Día de inicio (AAAA-MM-DD): el inicio previsto de «identificacion» del dossier'),
    fuente_inicio: Texto(3, 300).describe('De dónde sale (cuadro resumen, ficha o fecha límite + 5 semanas)'),
    semanas: z
      .array(
        z.strictObject({
          desde: Fecha,
          hasta: Fecha,
          trabajo: Texto(3, 300),
          rol: Texto(1, 60).describe('Sigla del rol que lo lleva'),
          entregable: Texto(2, 300),
          puerta: Texto(3, 300).describe('Cómo se da por bueno: acta, prueba o hito'),
        }),
      )
      .min(1)
      .max(40),
    festivos: z.array(Texto(3, 120)).max(30).describe('Festivos del periodo, con su fecha'),
    desplazamiento: Texto(5, 500).describe('Qué pasa si el inicio se mueve o un hito cae en festivo'),
  }),
  arquitectura: z
    .array(
      z.strictObject({
        capa: Texto(2, 100),
        servicio: Texto(2, 200).describe('Servicio o componente con versión o configuración'),
        tier: Texto(1, 100),
        region: Texto(2, 100),
        motivo: Texto(5, 400),
        control: Texto(3, 300).describe('Seguridad, coste o cumplimiento que lo vigila'),
        alternativa: Texto(2, 200),
      }),
    )
    .max(8)
    .describe('Una fila por capa; vacía si la solución no lleva sistemas'),
  modelos: z
    .array(
      z.strictObject({
        uso: Texto(3, 200),
        modelo: Texto(2, 120).describe(
          'Familia y versión vigentes a la fecha del pliego (nunca una versión fechada de más de 12 meses antes del inicio, salvo que el pliego la cite)',
        ),
        alternativa: Texto(2, 120),
      }),
    )
    .max(4),
  umbrales: z
    .array(
      z.strictObject({
        metrica: Texto(2, 120),
        formula: Texto(3, 300),
        umbral: Texto(1, 60).describe('El valor exigido, p. ej. «≥ 90 %»'),
        banco: Texto(2, 200).describe(
          'Con qué datos y en qué entorno se mide, p. ej. «banco sintético en preproducción»',
        ),
        cuando: Texto(2, 200).describe('Cuándo se mide, coherente con el calendario y con lo que cada entorno permite'),
      }),
    )
    .max(8),
  banco_pruebas: z
    .strictObject({
      casos: Texto(3, 300),
      estratos: z.array(Texto(2, 200)).max(10),
      tamano: z.number().int().min(1).max(100_000),
      fuente_tamano: Texto(3, 300).describe('Por qué ese tamaño: el pliego, una aclaración o nuestro criterio'),
    })
    .nullable(),
  formacion: z
    .strictObject({
      horas: z.number().min(0).max(10_000),
      sesiones: z.number().int().min(0).max(1000),
      destinatarios: Texto(3, 300),
      plan: Texto(5, 600),
    })
    .nullable()
    .describe('Solo si el pliego la pide o se acredita en esta memoria; nunca un criterio automático de otro archivo'),
  soporte: z
    .strictObject({
      horario: Texto(3, 200),
      respuesta: Texto(3, 300).describe('Tiempos de respuesta por prioridad'),
      meses: z.number().min(0).max(120).nullable(),
      canal: Texto(2, 200),
    })
    .nullable()
    .describe('Solo si el pliego lo pide o se acredita en esta memoria; nunca un criterio automático de otro archivo'),
  riesgos: z
    .array(
      z.strictObject({
        id: Texto(1, 10),
        causa: Texto(5, 300),
        probabilidad: z.enum(NIVEL),
        impacto: z.enum(NIVEL),
        disparador: Texto(3, 300),
        medida: Texto(5, 400),
        dueno: Texto(1, 60),
      }),
    )
    .min(3)
    .max(15),
  alias_roles: z
    .array(
      z.strictObject({
        rol: Texto(2, 200),
        alias: Texto(1, 12),
        dedicacion: Texto(2, 200).describe('Dedicación por fase, p. ej. «50 % S1-S6; 25 % S7-S12»'),
      }),
    )
    .min(1)
    .max(10),
  casos: z
    .array(z.strictObject({ apartado: NumApartado, caso: Texto(10, 500) }))
    .max(20)
    .describe('Un ejemplo distinto por apartado; el hilo común, solo en el mockup'),
  pendientes_legitimos: z
    .array(
      z.strictObject({
        parametro: Texto(3, 200),
        cita: z
          .string()
          .trim()
          .max(500)
          .describe('Cita literal del pliego o de una aclaración que lo reserva al órgano'),
        por_defecto: Texto(1, 300).describe('Nuestra propuesta mientras el órgano no decida'),
      }),
    )
    .max(5),
  // La memoria local ganó el diseño funcional con un catálogo de reglas del cliente, cada una con
  // su norma y apartado; la memoria no lo tenía. Por defecto vacío: lo guardado antes sigue valiendo.
  catalogo_normativo: z
    .array(
      z.strictObject({
        id: Texto(1, 12).describe('Identificador de la regla, p. ej. «R01»'),
        regla: Texto(5, 400).describe('La regla operativa: qué comprueba o impone la solución'),
        norma: Texto(3, 200).describe(
          'Código de la norma y apartado, como en el dossier, p. ej. «P-XX-010, apartado 4.2»',
        ),
        cita: Texto(10, 500).describe(
          'Cita literal del pasaje del dossier (sección normativa_cliente) que la sostiene',
        ),
        donde: Texto(3, 300).describe('Dónde se aplica en la solución (pantalla, paso del flujo, control)'),
      }),
    )
    .max(25)
    .default([])
    .describe('Reglas del cliente con su norma: obligatorio si el dossier trae normativa del cliente; vacío si no'),
  // Lo que la memoria promete y cuesta (compromisosSolucion.ts). Por defecto vacío: lo guardado antes sigue valiendo.
  compromisos: z
    .array(Compromiso)
    .max(30)
    .default([])
    .describe(
      'Cada cosa que la memoria promete y cuesta al ejecutar: exigida por el pliego (con su cita) o añadida (con el criterio que la puntúa y su coste)',
    ),
});
export type SolucionData = z.infer<typeof Solucion>;

// La ficha y los parches de las rondas leen la estrategia guardada con un JSON.parse crudo: la de
// antes de los compromisos no los trae y el `.default([])` del esquema no llega a aplicarse.
// Y la de antes del contrato con el extractor decía «origen» y «añadido»: se normaliza al leer.
const compromisosDe = (s: SolucionData): CompromisoData[] => solucionNormalizada(s).compromisos ?? [];

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const repetidos = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

/** Todo el texto de la solución, por línea, para buscar fugas y aplazamientos. */
export function textosDeSolucion(s: SolucionData): string[] {
  const c = s.calendario;
  return [
    `Inicio ${c.inicio} (${c.fuente_inicio}). ${c.desplazamiento}`,
    ...c.semanas.map((x) => `${x.desde}–${x.hasta}: ${x.trabajo}; ${x.rol}; ${x.entregable}; ${x.puerta}`),
    ...s.arquitectura.map(
      (a) => `${a.capa}: ${a.servicio}, ${a.tier}, ${a.region}. ${a.motivo} ${a.control} Alternativa: ${a.alternativa}`,
    ),
    ...s.modelos.map((m) => `${m.uso}: ${m.modelo} (alternativa ${m.alternativa})`),
    ...s.umbrales.map((u) => `${u.metrica}: ${u.umbral} (${u.formula}; ${u.banco}; ${u.cuando})`),
    ...(s.banco_pruebas
      ? [
          `Banco de pruebas: ${s.banco_pruebas.tamano} ${s.banco_pruebas.casos} (${s.banco_pruebas.estratos.join(', ')}; ${s.banco_pruebas.fuente_tamano})`,
        ]
      : []),
    ...(s.formacion
      ? [
          `Formación: ${s.formacion.horas} horas en ${s.formacion.sesiones} sesiones para ${s.formacion.destinatarios}. ${s.formacion.plan}`,
        ]
      : []),
    ...(s.soporte
      ? [
          `Soporte: ${s.soporte.horario}; ${s.soporte.respuesta}; ${s.soporte.canal}${s.soporte.meses !== null ? `; ${s.soporte.meses} meses` : ''}`,
        ]
      : []),
    ...s.riesgos.map((r) => `${r.id}: ${r.causa}. ${r.disparador}. ${r.medida} (${r.dueno})`),
    ...s.alias_roles.map((r) => `${r.rol} (${r.alias}): ${r.dedicacion}`),
    ...s.casos.map((x) => x.caso),
    // La propuesta de la empresa por defecto llega a la ficha y a la memoria tal cual: se vigila como lo
    // demás. La cita no, que es texto del pliego.
    ...s.pendientes_legitimos.map((p) => `${p.parametro}: proponemos ${p.por_defecto}`),
    ...s.catalogo_normativo.map((r) => `${r.id}: ${r.regla} (${r.donde})`),
    ...compromisosVigentes(compromisosDe(s)).map((c) => c.texto),
  ];
}

// Fechas imposibles («2026-02-30») o semanas al revés: el calendario es lo que se compromete.
export const fechaReal = (f: string) => {
  const d = new Date(`${f}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
};

/** Fechas que no existen, semanas al revés o antes del inicio (también tras editar la ficha). */
export function problemasDeCalendario(s: SolucionData): string[] {
  const c = s.calendario;
  const malas = [c.inicio, ...c.semanas.flatMap((x) => [x.desde, x.hasta])].filter((f) => !fechaReal(f));
  const alReves = c.semanas.filter((x) => x.hasta < x.desde).map((x) => `${x.desde}–${x.hasta}`);
  const antes = c.semanas.filter((x) => x.desde < c.inicio).map((x) => x.desde);
  return [
    ...(malas.length ? [`Estas fechas del calendario no existen: ${[...new Set(malas)].join(', ')}.`] : []),
    ...(alReves.length ? [`Estas semanas del calendario acaban antes de empezar: ${alReves.join(', ')}.`] : []),
    ...(antes.length
      ? [
          `El calendario empieza el ${c.inicio} y hay semanas antes de esa fecha (${[...new Set(antes)].join(', ')}): empieza en el inicio.`,
        ]
      : []),
  ];
}

// Un pendiente legítimo es lo que el pliego reserva al órgano: sin la cita que lo prueba es un
// aplazamiento como cualquier otro. Con el texto del dossier y de los pliegos se comprueba que la
// cita está en él; una cita con «[…]» se busca por trozos. Si no aparece pero el dossier tiene
// secciones recortadas, puede estar en lo recortado: se avisa en vez de rechazar (rechazarla
// empujaba a fijar por su cuenta lo que el pliego reserva al órgano).
type FuentesPendientes = { texto?: string | undefined; recortado?: boolean | undefined };
const OMISION = /\[\s*(?:…|\.\.\.)\s*\]|…|\.\.\./;
const trozosDeCita = (cita: string) =>
  cita
    .split(OMISION)
    .map(comparable)
    .filter((t) => t.length >= 10);

function citaEnFuentes(cita: string, fuentes: string): boolean {
  const trozos = trozosDeCita(cita);
  return trozos.length > 0 && trozos.every((t) => fuentes.includes(t));
}

function problemaDeCita(
  p: SolucionData['pendientes_legitimos'][number],
  f: FuentesPendientes,
  dossier: string | null,
): { blando?: string; aviso?: string } {
  if (comparable(p.cita).length < 10)
    return {
      blando: `El pendiente «${p.parametro}» no trae la cita del pliego que lo reserva al órgano: cítala literal o fija tú el valor (${p.por_defecto}).`,
    };
  if (dossier === null || citaEnFuentes(p.cita, dossier)) return {};
  return f.recortado
    ? {
        aviso: `La cita del pendiente «${p.parametro}» («${p.cita}») no está en el texto del dossier ni de los pliegos que lee la plataforma, y el dossier tiene secciones recortadas: compruébala.`,
      }
    : {
        blando: `La cita del pendiente «${p.parametro}» («${p.cita}») no está en el dossier: copia la frase literal del pliego o de la aclaración, o fija tú el valor.`,
      };
}

function problemasDePendientes(s: SolucionData, f: FuentesPendientes): { blandos: string[]; avisos: string[] } {
  const dossier = f.texto ? comparable(f.texto) : null;
  const citas = s.pendientes_legitimos.map((p) => problemaDeCita(p, f, dossier));
  const genericos = s.pendientes_legitimos
    .filter((p) => !parametroConcreto(p.parametro))
    .map(
      (p) =>
        `El pendiente «${p.parametro}» nombra el parámetro de forma genérica: di cuál es en concreto (p. ej. «región de alojamiento de los datos»); un nombre genérico no lo distingue de cualquier otro valor aplazado.`,
    );
  return {
    blandos: [...genericos, ...citas.flatMap((c) => (c.blando ? [c.blando] : []))],
    avisos: citas.flatMap((c) => (c.aviso ? [c.aviso] : [])),
  };
}

// Los pasajes de la sección «normativa_cliente» como los escribe seccionNormativa
// (dossierCarpeta.ts): una línea «[CÓDIGO p. N] texto» por pasaje, con «Contrato» por código
// para el contrato.
const PASAJE = /^\[([^\]\n]+?)(?: p\. \d+)?\] (.+)$/gmu;
export type PasajeNorma = { etiqueta: string; texto: string };

function pasajesDeNormativa(texto: string): PasajeNorma[] {
  return [...texto.matchAll(PASAJE)].map((m) => ({ etiqueta: comparable(m[1]!), texto: comparable(m[2]!) }));
}

/**
 * ¿Trae la sección pasajes de normativa del cliente que se puedan citar? Un índice sin pasajes
 * («Ningún pasaje casa…») o solo el contrato no bastan para exigir el catálogo: sus citas no se
 * podrían comprobar y empujaban a sacar «reglas del cliente» de un contrato.
 */
export const normativaCitable = (texto: string): boolean =>
  pasajesDeNormativa(texto).some((p) => p.etiqueta !== 'contrato');

// Cada regla del catálogo se comprueba como un pendiente legítimo: el código de su norma está en
// el dossier, su cita sale de un pasaje de esa norma (no del pliego ni de otra norma) y el
// apartado que cita aparece en sus pasajes. Una cita que no está en el dossier puede venir de
// biblioteca_leer (la sección lo manda para lo demás): se avisa en vez de rechazar.
const SEPARADOR_NORMA = /,|;|\bapartado\b|\bart(?:[ií]culo)?\b\.?|\bsecci[oó]n\b|§/i;
function partesDeNorma(norma: string): { codigo: string; apartado: string | null } {
  const m = SEPARADOR_NORMA.exec(norma);
  if (!m) return { codigo: comparable(norma), apartado: null };
  return {
    codigo: comparable(norma.slice(0, m.index)),
    apartado: /\d+(?:\.\d+)*/.exec(norma.slice(m.index))?.[0] ?? null,
  };
}
const conNumero = (texto: string, n: string) => new RegExp(`(?<![\\d])${n.replace(/\./g, ' ')}(?![\\d])`).test(texto);
type Veredicto = { blando?: string; aviso?: string };
type FuentesCatalogo = FuentesPendientes & { normativa?: boolean | undefined; normativaTexto?: string | undefined };

function normaAusente(r: SolucionData['catalogo_normativo'][number], f: FuentesCatalogo, dossier: string): Veredicto {
  const falta = [...(citaEnFuentes(r.cita, dossier) ? [] : [`la cita («${r.cita}»)`]), `la norma «${r.norma}»`];
  const que = `De la regla ${r.id} del catálogo normativo, ${falta.join(' y ')} no está en el dossier`;
  return f.recortado
    ? { aviso: `${que} ni en los pliegos, y el dossier tiene secciones recortadas: compruébala.` }
    : { blando: `${que}: copia el código y la frase literal de la sección «normativa_cliente», o quita la regla.` };
}

function problemasDeRegla(
  r: SolucionData['catalogo_normativo'][number],
  f: FuentesCatalogo,
  dossier: string | null,
): Veredicto {
  if (dossier === null) return {};
  const { codigo, apartado } = partesDeNorma(r.norma);
  if (!codigo || !dossier.includes(codigo)) return normaAusente(r, f, dossier);
  const deLaNorma = pasajesDeNormativa(f.normativaTexto ?? f.texto ?? '').filter(
    (p) => p.etiqueta.includes(codigo) || codigo.includes(p.etiqueta),
  );
  const de = `De la regla ${r.id} del catálogo normativo`;
  if (deLaNorma.some((p) => citaEnFuentes(r.cita, p.texto))) {
    return apartado && !deLaNorma.some((p) => conNumero(p.texto, apartado))
      ? {
          blando: `${de}, el apartado ${apartado} de «${r.norma}» no sale en los pasajes de esa norma del dossier: pon el apartado que dice el pasaje o deja solo el código de la norma.`,
        }
      : {};
  }
  if (citaEnFuentes(r.cita, dossier))
    return {
      blando: `${de}, la cita («${r.cita}») está en el dossier pero no en un pasaje de la norma «${r.norma}»: atribúyela a la norma de la que sale (lo del pliego no es una regla del cliente) o quita la regla.`,
    };
  return {
    aviso: `${de}, la cita («${r.cita}») no está en los pasajes del dossier (¿leída con biblioteca_leer?): compruébala contra «${r.norma}» antes de entregar.`,
  };
}

function problemasDeCatalogo(s: SolucionData, f: FuentesCatalogo): { blandos: string[]; avisos: string[] } {
  const dossier = f.texto ? comparable(f.texto) : null;
  const reglas = s.catalogo_normativo.map((r) => problemasDeRegla(r, f, dossier));
  const ids = repetidos(s.catalogo_normativo.map((r) => comparable(r.id)));
  return {
    blandos: [
      ...(f.normativa && !s.catalogo_normativo.length
        ? [
            'El dossier trae normativa del cliente (sección «normativa_cliente»): añade «catalogo_normativo» con cada regla que aplica la solución (id, regla operativa, norma y apartado, cita literal del dossier y dónde se aplica); la memoria lo presenta como tabla en el apartado funcional.',
          ]
        : []),
      ...(ids.length
        ? [`Los identificadores del catálogo normativo se repiten (${ids.join(', ')}): uno distinto por regla.`]
        : []),
      ...reglas.flatMap((x) => (x.blando ? [x.blando] : [])),
    ],
    avisos: reglas.flatMap((x) => (x.aviso ? [x.aviso] : [])),
  };
}

// Un compromiso exigido se comprueba como un pendiente legítimo: su cita tiene que estar en el
// dossier (o avisarse si puede estar en lo recortado). Sin cita, «exigido» era la forma de colar
// un añadido caro sin decir qué puntúa ni cuánto cuesta.
function problemaDeExigido(c: CompromisoData, f: FuentesPendientes, dossier: string | null): Veredicto {
  if (c.clase !== 'exigido' || c.quitado) return {};
  if (comparable(c.cita).length < 10)
    return {
      blando: `El compromiso «${c.texto}» va como exigido y no trae la cita del pliego que lo exige: cópiala literal del dossier o, si el pliego no lo exige, márcalo «anadido» con el criterio que lo puntúa y su coste.`,
    };
  if (dossier === null || citaEnFuentes(c.cita, dossier)) return {};
  return f.recortado
    ? {
        aviso: `La cita del compromiso exigido «${c.texto}» («${c.cita}») no está en el texto del dossier ni de los pliegos, y el dossier tiene secciones recortadas: compruébala.`,
      }
    : {
        blando: `La cita del compromiso exigido «${c.texto}» («${c.cita}») no está en el dossier: copia la frase literal del pliego o márcalo «anadido» con su criterio y su coste.`,
      };
}

function problemasDeCompromisos(s: SolucionData, f: FuentesPendientes): { blandos: string[]; avisos: string[] } {
  const dossier = f.texto ? comparable(f.texto) : null;
  const cs = compromisosDe(s);
  const exigidos = cs.map((c) => problemaDeExigido(c, f, dossier));
  return {
    blandos: [
      ...exigidos.flatMap((x) => (x.blando ? [x.blando] : [])),
      ...cs.flatMap(problemasDeAnadido),
      ...cs.flatMap(problemasDeExigidoSinCoste),
    ],
    avisos: [
      ...exigidos.flatMap((x) => (x.aviso ? [x.aviso] : [])),
      ...cs.flatMap((c) => {
        const a = avisoDeCoste(c);
        return a ? [a] : [];
      }),
    ],
  };
}

/** Lo que no se acepta del bloque «solucion»: duros (fugas) y blandos (forma, pendientes y catálogo normativo); avisos, lo que no se puede comprobar. */
export function problemasDeSolucion(
  s: SolucionData,
  op: {
    fugas: ContextoFugas;
    fuentes?: string | undefined;
    recortado?: boolean | undefined;
    normativa?: boolean | undefined;
    normativaTexto?: string | undefined;
  },
): { duros: string[]; blandos: string[]; avisos: string[] } {
  const fugas = textosDeSolucion(s)
    .flatMap((t) => detectarFugas(t, op.fugas))
    .map(
      (f) =>
        `La solución delata «${f.marca}» («${f.criterio}», que va en «${f.archivo}»): quítalo de la solución; la memoria lo copiaría.`,
    );
  const casos = repetidos(s.casos.map((x) => comparable(x.caso)));
  const apartadosRepetidos = repetidos(s.casos.map((x) => String(x.apartado)));
  const alias = repetidos(s.alias_roles.map((r) => comparable(r.alias)));
  const pendientes = problemasDePendientes(s, { texto: op.fuentes, recortado: op.recortado });
  const catalogo = problemasDeCatalogo(s, {
    texto: op.fuentes,
    recortado: op.recortado,
    normativa: op.normativa,
    normativaTexto: op.normativaTexto,
  });
  const parametros = parametrosDeFicha(s);
  const compromisos = problemasDeCompromisos(s, { texto: op.fuentes, recortado: op.recortado });
  return {
    duros: [...new Set(fugas)],
    blandos: [
      ...problemasDeCalendario(s),
      ...(casos.length || apartadosRepetidos.length
        ? [
            'Cada apartado lleva su propio caso en «casos»: uno por apartado y distintos entre sí (el mismo ejemplo repetido se lee como relleno).',
          ]
        : []),
      ...(alias.length ? [`Las siglas de «alias_roles» se repiten (${alias.join(', ')}): una distinta por rol.`] : []),
      ...pendientes.blandos,
      ...catalogo.blandos,
      ...compromisos.blandos,
      ...(parametros > MAX_CAMPOS_FICHA
        ? [
            `La ficha de solución que revisará una persona tendría ${parametros} parámetros (sin contar los tramos del calendario ni los riesgos) y el máximo es ${MAX_CAMPOS_FICHA}: agrupa capas, umbrales o roles.`,
          ]
        : []),
    ],
    avisos: [...pendientes.avisos, ...catalogo.avisos, ...compromisos.avisos],
  };
}

// ── Ficha de solución (lo que una persona revisa antes de redactar) ──

// Lo que Hermes no sabe es qué puede cumplir la empresa (un SLA, un horario, una dedicación): la persona
// lo ve en una pantalla y lo acepta o edita. Enseña todo lo que la memoria compromete (cada tramo
// del calendario, el control de cada capa, los meses y el canal del soporte, la fórmula de cada
// umbral, cada riesgo con su medida y su dueño): lo que no se enseñaba se aprobaba sin que nadie
// lo viera. Los parámetros, como mucho 20; los tramos y los riesgos son listas aparte.
const MAX_CAMPOS_FICHA = 20;
// hechos: los de la hoja de hechos que llevan este valor (una edición los cambia a ellos y a
// ningún otro); alerta: lo que la persona tiene que comprobar; ronda: si una ronda lo corrigió.
export type CampoFicha = {
  clave: string;
  grupo: string;
  etiqueta: string;
  propuesto: string;
  valor: string;
  hechos?: { clave: string; valor: string }[];
  alerta?: string;
  ronda?: { n: number; antes: string };
  // caro: la alerta lleva el aviso de coste de un compromiso (la web lo rotula «Coste alto»).
  caro?: true;
};

// Cada campo se compone de una o más ranuras de la solución, separadas por « · » en el valor: al
// editarlo, cada trozo vuelve a su sitio y la solución que lee la redacción cambia con él.
export const SEPARADOR = ' · ';
// opcional: un número que puede faltar («sin estimar»); decision: mantener o quitar un compromiso.
// sinImporte: el texto de un compromiso, que la memoria copia (va en un sobre sin precios); nivel: bajo, medio o alto.
type TipoRanura = 'texto' | 'fecha' | 'entero' | 'numero' | 'meses' | 'opcional' | 'decision' | 'sinImporte' | 'nivel';
type Ruta = (string | number)[];
type Ranura = { nombre: string; ruta: Ruta; tipo: TipoRanura; sufijo?: string };
// ancla: de qué habla el campo, para encontrar los hechos que llevan su valor.
export type DefinicionCampo = { clave: string; grupo: string; etiqueta: string; ancla: string; ranuras: Ranura[] };

const ranura = (nombre: string, ruta: Ruta, tipo: TipoRanura = 'texto', sufijo?: string): Ranura => ({
  nombre,
  ruta,
  tipo,
  ...(sufijo ? { sufijo } : {}),
});
function definicion(clave: string, grupo: string, base: string, ancla: string, ranuras: Ranura[]): DefinicionCampo {
  const etiqueta = ranuras.length > 1 ? `${base} (${ranuras.map((r) => r.nombre).join(SEPARADOR)})` : base;
  return { clave, grupo, etiqueta, ancla, ranuras };
}

function definicionesDeCalendario(s: SolucionData): DefinicionCampo[] {
  const tramo = (i: number) => {
    const r = (nombre: string, tipo: TipoRanura = 'texto', k = nombre) =>
      ranura(nombre, ['calendario', 'semanas', i, k], tipo);
    return [r('desde', 'fecha'), r('hasta', 'fecha'), r('trabajo'), r('rol'), r('entregable'), r('puerta')];
  };
  return [
    definicion('inicio', 'Calendario', 'Inicio del contrato (AAAA-MM-DD)', 'inicio calendario', [
      ranura('inicio', ['calendario', 'inicio'], 'fecha'),
    ]),
    ...s.calendario.semanas.map((_, i) =>
      definicion(`semana-${i + 1}`, 'Calendario', `Tramo ${i + 1}`, 'calendario', tramo(i)),
    ),
  ];
}

function definicionesTecnicas(s: SolucionData): DefinicionCampo[] {
  const capa = (i: number) => [
    ranura('servicio', ['arquitectura', i, 'servicio']),
    ranura('tier', ['arquitectura', i, 'tier']),
    ranura('región', ['arquitectura', i, 'region']),
    ranura('control', ['arquitectura', i, 'control']),
  ];
  const umbral = (i: number) => [
    ranura('umbral', ['umbrales', i, 'umbral']),
    ranura('fórmula', ['umbrales', i, 'formula']),
    ranura('con qué se mide', ['umbrales', i, 'banco']),
    ranura('cuándo', ['umbrales', i, 'cuando']),
  ];
  return [
    ...s.arquitectura.map((a, i) => definicion(`arquitectura-${i + 1}`, 'Arquitectura', a.capa, a.capa, capa(i))),
    ...s.modelos.map((m, i) =>
      definicion(`modelo-${i + 1}`, 'Modelos', m.uso, `${m.uso} modelo`, [ranura('modelo', ['modelos', i, 'modelo'])]),
    ),
    ...s.umbrales.map((u, i) => definicion(`umbral-${i + 1}`, 'Umbrales de calidad', u.metrica, u.metrica, umbral(i))),
    ...(s.banco_pruebas
      ? [
          definicion('banco', 'Banco de pruebas', 'Banco de pruebas', 'banco pruebas casos', [
            ranura('tamaño', ['banco_pruebas', 'tamano'], 'entero'),
            ranura('casos', ['banco_pruebas', 'casos']),
          ]),
        ]
      : []),
  ];
}

const FORMACION = [
  ranura('horas', ['formacion', 'horas'], 'numero', ' h'),
  ranura('sesiones', ['formacion', 'sesiones'], 'entero', ' sesiones'),
  ranura('destinatarios', ['formacion', 'destinatarios']),
  ranura('plan', ['formacion', 'plan']),
];
const SOPORTE: [string, string, string, Ranura][] = [
  ['horario', 'Horario', 'soporte horario atencion', ranura('horario', ['soporte', 'horario'])],
  [
    'respuesta',
    'Tiempos de respuesta',
    'soporte respuesta consultas incidencias resolucion',
    ranura('respuesta', ['soporte', 'respuesta']),
  ],
  ['meses', 'Meses de soporte', 'soporte meses duracion garantia', ranura('meses', ['soporte', 'meses'], 'meses')],
  ['canal', 'Canal', 'soporte canal', ranura('canal', ['soporte', 'canal'])],
];

function definicionesDeServicio(s: SolucionData): DefinicionCampo[] {
  return [
    ...s.alias_roles.map((r, i) =>
      definicion(`rol-${i + 1}`, 'Equipo', `Dedicación de ${r.rol} (${r.alias})`, `${r.rol} ${r.alias}`, [
        ranura('dedicación', ['alias_roles', i, 'dedicacion']),
      ]),
    ),
    ...(s.formacion ? [definicion('formacion', 'Formación', 'Formación', 'formacion sesiones horas', FORMACION)] : []),
    ...(s.soporte
      ? SOPORTE.map(([k, etiqueta, ancla, r]) => definicion(`soporte-${k}`, 'Soporte', etiqueta, ancla, [r]))
      : []),
  ];
}

// Lo añadido: la persona lo acepta, lo suaviza (otro texto, menos horas, menor nivel) o lo quita; lo
// quitado no se redacta. Lo exigido caro también se enseña (sin poder quitarlo), para comprobar
// que la cita lo pide tal cual: marcar «exigido» un añadido inflado lo sacaba de la revisión. La
// clave va por su posición en la lista para que no cambie al quitar otro.
export const PREFIJO_COMPROMISO = 'compromiso-';
const PREFIJO_EXIGIDO = 'exigido-';
const GRUPO_COMPROMISOS = 'Compromisos añadidos (cuestan: mantener, suavizar o quitar)';
const GRUPO_EXIGIDOS = 'Compromisos exigidos caros (comprueba que el pliego los pide tal cual)';
const QUITAR = 'quitar';
// Sin euros: la ficha guarda lo que luego leen la redacción y las rondas.
const coste = (i: number) => [
  ranura('horas', ['compromisos', i, 'horas'], 'opcional', ' h'),
  ranura('nivel', ['compromisos', i, 'nivel'], 'nivel'),
];

function definicionDeCompromiso(c: CompromisoData, i: number): DefinicionCampo[] {
  if (c.clase === 'anadido') {
    return [
      definicion(
        `${PREFIJO_COMPROMISO}${i + 1}`,
        GRUPO_COMPROMISOS,
        `Para «${c.criterio || 'sin criterio'}»`,
        c.texto,
        [
          ranura('compromiso', ['compromisos', i, 'texto'], 'sinImporte'),
          ...coste(i),
          ranura('decisión', ['compromisos', i, 'quitado'], 'decision'),
        ],
      ),
    ];
  }
  if (!esCaro(c)) return [];
  return [
    definicion(`${PREFIJO_EXIGIDO}${i + 1}`, GRUPO_EXIGIDOS, `Exige «${c.cita || 'sin cita'}»`, c.texto, [
      ranura('compromiso', ['compromisos', i, 'texto'], 'sinImporte'),
      ...coste(i),
    ]),
  ];
}

const definicionesDeCompromisos = (s: SolucionData): DefinicionCampo[] =>
  compromisosDe(s).flatMap(definicionDeCompromiso);

/** ¿Es el campo de un compromiso (añadido o exigido caro)? */
export const esDeCompromiso = (clave: string) =>
  clave.startsWith(PREFIJO_COMPROMISO) || clave.startsWith(PREFIJO_EXIGIDO);

/** El compromiso de un campo de la ficha (undefined si el campo no es de un compromiso). */
export const compromisoDeCampo = (clave: string, s: SolucionData): CompromisoData | undefined =>
  esDeCompromiso(clave) ? compromisosDe(s)[Number(clave.replace(/^\D+/, '')) - 1] : undefined;

/** El aviso de coste de un campo de compromiso con lo que dice ahora la solución (undefined si no lo lleva). */
export function alertaDeCompromiso(clave: string, s: SolucionData): string | undefined {
  const c = compromisoDeCampo(clave, s);
  return (c && avisoDeCoste(c)) ?? undefined;
}

/** ¿La persona quitó este compromiso en la ficha? */
export const campoQuitado = (c: Pick<CampoFicha, 'clave' | 'valor'>): boolean =>
  c.clave.startsWith(PREFIJO_COMPROMISO) && c.valor.endsWith(`${SEPARADOR}${QUITAR}`);

/** Los campos de la ficha y de qué ranuras de la solución sale cada uno, en el orden en que se enseñan. */
export function definicionesDeFicha(s: SolucionData): DefinicionCampo[] {
  return [
    ...definicionesDeCalendario(s),
    ...definicionesTecnicas(s),
    ...definicionesDeServicio(s),
    ...definicionesDeCompromisos(s),
    ...s.riesgos.map((r, i) =>
      definicion(`riesgo-${i + 1}`, 'Riesgos', `${r.id}: ${r.causa}`, r.causa, [
        ranura('medida', ['riesgos', i, 'medida']),
        ranura('dueño', ['riesgos', i, 'dueno']),
      ]),
    ),
    ...s.pendientes_legitimos.map((p, i) =>
      definicion(`pendiente-${i + 1}`, 'Lo que decide el órgano (nuestra propuesta)', p.parametro, p.parametro, [
        ranura('propuesta', ['pendientes_legitimos', i, 'por_defecto']),
      ]),
    ),
  ];
}

// Los parámetros que cuentan para el máximo: los tramos del calendario, los riesgos y los compromisos son listas.
const parametrosDeFicha = (s: SolucionData) =>
  definicionesDeFicha(s).filter((d) => !/^(?:semana|riesgo|compromiso|exigido)-/.test(d.clave)).length;

type Nodo = Record<string | number, unknown>;
const leerRuta = (o: unknown, ruta: Ruta): unknown =>
  ruta.reduce<unknown>((x, k) => (x as Nodo | null | undefined)?.[k], o);
function ponerRuta(o: unknown, ruta: Ruta, v: unknown): void {
  const padre = leerRuta(o, ruta.slice(0, -1)) as Nodo | undefined;
  if (padre) padre[ruta.at(-1)!] = v;
}

/** El texto de una ranura tal como se enseña («4 h», «sin plazo fijado»); sin « · », que separa las ranuras. */
function textoDeRanura(r: Ranura, v: unknown): string {
  if (r.tipo === 'meses') return v === null || v === undefined ? 'sin plazo fijado' : `${String(v)} meses`;
  if (r.tipo === 'opcional') return v === null || v === undefined ? 'sin estimar' : `${String(v)}${r.sufijo ?? ''}`;
  if (r.tipo === 'nivel') return typeof v === 'string' ? v : 'sin estimar';
  if (r.tipo === 'decision') return v === true ? QUITAR : 'mantener';
  if (r.tipo === 'entero' || r.tipo === 'numero') return `${String(v)}${r.sufijo ?? ''}`;
  return String(v ?? '').replace(/\s*·\s*/g, ', ');
}

/** El valor de un campo con lo que dice ahora la solución. */
export const valorDeCampo = (d: DefinicionCampo, s: SolucionData): string =>
  d.ranuras.map((r) => textoDeRanura(r, leerRuta(s, r.ruta))).join(SEPARADOR);

/** Los campos de la solución con lo que propone Hermes como valor inicial (los de la hoja de hechos, en fichaCampos.ts). */
export function camposDeSolucion(s: SolucionData): CampoFicha[] {
  return definicionesDeFicha(s).map((d) => {
    const valor = valorDeCampo(d, s);
    const alerta = alertaDeCompromiso(d.clave, s);
    return {
      clave: d.clave,
      grupo: d.grupo,
      etiqueta: d.etiqueta,
      propuesto: valor,
      valor,
      ...(alerta ? { alerta, caro: true as const } : {}),
    };
  });
}

const NUMERO = /^\d+(?:[.,]\d+)?/;
// Un trozo editado, a su tipo; null si no vale.
function leerRanura(r: Ranura, t: string): { v: unknown } | null {
  const x = t.trim();
  if (r.tipo === 'texto') return x ? { v: x } : null;
  if (r.tipo === 'sinImporte') return x && !llevaImporte(x) ? { v: x } : null;
  if (r.tipo === 'nivel')
    return /^sin\b/i.test(x)
      ? { v: null }
      : (NIVELES_COSTE as readonly string[]).includes(x.toLowerCase())
        ? { v: x.toLowerCase() }
        : null;
  if (r.tipo === 'fecha') return fechaReal(x) ? { v: x } : null;
  if (r.tipo === 'decision') return /^quit/i.test(x) ? { v: true } : /^(?:mant|acept)/i.test(x) ? { v: false } : null;
  if ((r.tipo === 'meses' || r.tipo === 'opcional') && /^sin\b/i.test(x)) return { v: null };
  const n = NUMERO.exec(x)?.[0];
  if (!n) return null;
  const v = Number(n.replace(',', '.'));
  return r.tipo === 'entero' && !Number.isInteger(v) ? null : { v };
}

const COMO: Record<TipoRanura, string> = {
  texto: 'texto',
  fecha: 'fecha AAAA-MM-DD',
  entero: 'número entero',
  numero: 'número',
  meses: 'número de meses o «sin plazo fijado»',
  opcional: 'número o «sin estimar»',
  decision: '«mantener» o «quitar»',
  nivel: '«bajo», «medio», «alto» o «sin estimar»',
  sinImporte: 'texto sin importes ni moneda (la memoria va en un sobre sin precios)',
};
export type CambioDeRanura = { antes: string; despues: string };

// El nivel y la decisión califican el compromiso, no son texto que copie la hoja: llevados a los
// hechos, «medio» → «alto» cambiaba «medios» por «altos» en cualquier hecho del compromiso.
const NO_VAN_A_LOS_HECHOS: ReadonlySet<TipoRanura> = new Set(['nivel', 'decision']);

/**
 * Pone en la solución `s` (la cambia) el valor editado de un campo. Devuelve los trozos que
 * cambiaron, tal como se enseñan (sin el nivel ni la decisión), o el error para la persona.
 */
export function escribirCampo(
  s: SolucionData,
  d: DefinicionCampo,
  valor: string,
): { cambios: CambioDeRanura[] } | { error: string } {
  const trozos = d.ranuras.length === 1 ? [valor] : valor.split(/\s+·\s+/);
  if (trozos.length !== d.ranuras.length)
    return {
      error: `«${d.etiqueta}» lleva ${d.ranuras.length} partes separadas por « · »; llegaron ${trozos.length}.`,
    };
  const cambios: CambioDeRanura[] = [];
  for (const [i, r] of d.ranuras.entries()) {
    const antes = textoDeRanura(r, leerRuta(s, r.ruta));
    if (trozos[i]!.trim() === antes) continue;
    const leido = leerRanura(r, trozos[i]!);
    if (!leido)
      return { error: `En «${d.etiqueta}», «${r.nombre}» va como ${COMO[r.tipo]} (llegó «${trozos[i]!.trim()}»).` };
    ponerRuta(s, r.ruta, leido.v);
    if (!NO_VAN_A_LOS_HECHOS.has(r.tipo)) cambios.push({ antes, despues: textoDeRanura(r, leido.v) });
  }
  return { cambios };
}

/** La etiqueta del campo y la parte a la que apunta una ruta de la solución (para los errores de validación). */
export function etiquetaDeRuta(s: SolucionData, ruta: Ruta): string | null {
  for (const d of definicionesDeFicha(s)) {
    const r = d.ranuras.find((x) => x.ruta.join('.') === ruta.join('.'));
    if (r) return d.ranuras.length > 1 ? `${d.grupo} · ${d.etiqueta}: ${r.nombre}` : `${d.grupo} · ${d.etiqueta}`;
  }
  return null;
}

const fila = (xs: (string | number)[]) =>
  `| ${xs.map((x) => String(x).replace(/\|/g, '/').replace(/\n+/g, ' ')).join(' | ')} |`;
const tabla = (cab: string[], filas: (string | number)[][]) =>
  filas.length ? [fila(cab), fila(cab.map(() => '---')), ...filas.map(fila)] : ['(no aplica)'];

/** La solución en Markdown, para la estrategia en Salidas y para el contrato de la redacción. */
export function solucionEnMarkdown(s: SolucionData): string[] {
  const c = s.calendario;
  return [
    '## Solución (decidida: la memoria la compromete)',
    `### Calendario (inicio ${c.inicio}: ${c.fuente_inicio})`,
    ...tabla(
      ['Desde', 'Hasta', 'Trabajo', 'Rol', 'Entregable', 'Puerta'],
      c.semanas.map((x) => [x.desde, x.hasta, x.trabajo, x.rol, x.entregable, x.puerta]),
    ),
    `Festivos: ${c.festivos.length ? c.festivos.join('; ') : 'ninguno'}. Desplazamiento: ${c.desplazamiento}`,
    '### Arquitectura',
    ...tabla(
      ['Capa', 'Servicio', 'Tier', 'Región', 'Motivo', 'Control', 'Alternativa'],
      s.arquitectura.map((a) => [a.capa, a.servicio, a.tier, a.region, a.motivo, a.control, a.alternativa]),
    ),
    '### Modelos',
    ...tabla(
      ['Uso', 'Modelo', 'Alternativa'],
      s.modelos.map((m) => [m.uso, m.modelo, m.alternativa]),
    ),
    '### Umbrales',
    ...tabla(
      ['Métrica', 'Fórmula', 'Umbral', 'Banco', 'Cuándo'],
      s.umbrales.map((u) => [u.metrica, u.formula, u.umbral, u.banco, u.cuando]),
    ),
    `### Banco de pruebas: ${s.banco_pruebas ? `${s.banco_pruebas.tamano} ${s.banco_pruebas.casos} (estratos: ${s.banco_pruebas.estratos.join(', ') || 'ninguno'}; ${s.banco_pruebas.fuente_tamano})` : 'no aplica'}`,
    `### Formación: ${s.formacion ? `${s.formacion.horas} h en ${s.formacion.sesiones} sesiones para ${s.formacion.destinatarios}. ${s.formacion.plan}` : 'no se compromete aquí'}`,
    `### Soporte: ${s.soporte ? `${s.soporte.horario}; ${s.soporte.respuesta}; ${s.soporte.canal}${s.soporte.meses !== null ? `; ${s.soporte.meses} meses` : ''}` : 'no se compromete aquí'}`,
    '### Riesgos',
    ...tabla(
      ['Id', 'Causa', 'P', 'I', 'Disparador', 'Medida', 'Dueño'],
      s.riesgos.map((r) => [r.id, r.causa, r.probabilidad, r.impacto, r.disparador, r.medida, r.dueno]),
    ),
    '### Roles (entero la primera vez, después la sigla)',
    ...tabla(
      ['Rol', 'Sigla', 'Dedicación'],
      s.alias_roles.map((r) => [r.rol, r.alias, r.dedicacion]),
    ),
    '### Un caso por apartado',
    ...s.casos.map((x) => `- Apartado ${x.apartado}: ${x.caso}`),
    '### Catálogo normativo (va como tabla en el apartado funcional que corresponda)',
    ...tabla(
      ['Id', 'Regla', 'Norma y apartado', 'Dónde se aplica'],
      s.catalogo_normativo.map((r) => [r.id, r.regla, r.norma, r.donde]),
    ),
    ...lineasCompromisos(compromisosDe(s)),
    '### Pendientes que el pliego reserva al órgano',
    ...(s.pendientes_legitimos.length
      ? s.pendientes_legitimos.map((p) => `- ${p.parametro}: proponemos ${p.por_defecto} («${p.cita}»)`)
      : ['- Ninguno: todo lo demás está decidido.']),
  ];
}

// Lo quitado se nombra para que no se escriba aunque lo traigan la estructura o la hoja de hechos.
function lineasCompromisos(cs: CompromisoData[]): string[] {
  const vigentes = compromisosVigentes(cs);
  const quitados = cs.filter((c) => c.quitado);
  return [
    '### Compromisos (lo único que la memoria compromete con frecuencia, cantidad, horas, material o disponibilidad; lo demás, como capacidad o a petición)',
    ...tabla(
      ['Clase', 'Compromiso', 'Cita del pliego o criterio que lo puntúa', 'Coste'],
      vigentes.map((c) => [
        c.clase === 'exigido' ? 'exigido' : 'añadido',
        c.texto,
        c.clase === 'exigido' ? `«${c.cita}»` : `${c.criterio}: ${c.compensa}`,
        textoDeCoste(c),
      ]),
    ),
    ...(quitados.length
      ? [
          `Quitados por la persona en la ficha (no se escriben ni se prometen, aunque los traiga otra parte de la estrategia o la hoja de hechos): ${quitados.map((c) => `«${c.texto}»`).join('; ')}.`,
        ]
      : []),
  ];
}
