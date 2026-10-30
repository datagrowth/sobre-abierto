// Crítico ciego de la memoria (docs/memoria-tecnica.md, paso 5), sin decisiones, estrategia ni equipo.
import { z } from 'zod';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { dossierDe } from './dossier.js';
import { textoDeChequeos } from './chequeosDocumento.js';
import { chequeosConCoste } from './compromisosMemoriaCoste.js';
import { apartadosDe, documentoEnMarkdown, filaMemoria, type FilaMemoria } from './ensamblado.js';
import { estrategiaDe } from './estrategia.js';
import { localizarCitas, textosDeApartados, tramoMaximo } from './evaluacionMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { memoriaValorable, puntosTexto } from './guionRevision.js';
import { aplicacionesDe, marcarCumplidas } from './leccionesAplicadas.js';

// La autoevaluación del mismo perfil que redacta infla la nota y no distingue una memoria buena de una mediocre. El crítico solo ve un paquete ciego (la rúbrica,
// el pliego y la memoria: nunca decisiones, estrategia, equipo ni evaluaciones; las lecciones que se
// pasaron a la redacción solo le llegan para comprobarlas DESPUÉS de puntuar), corre
// en su propio perfil si lo hay (independiente) y la auditoría de tools confirma que no miró nada
// más (ciega). Contra el inflado, por código: el tramo es de la escala, la nota se sostiene con
// una cita literal (sin ella, al tercer envío se guarda un tramo por debajo) y un tramo máximo no
// puede traer motivos para bajar ni cosas que faltan.

// Puntúa un paquete sin decisiones, estrategia ni equipo, para no inflar la nota.
export const TIPO_MEMORIA_CRITICA = 'licitaciones.memoria_critica';
export const PayloadCritica = z.object({
  id: z.string().min(3),
  memoria_id: z.number().int().positive(),
  version: z.number().int().positive(),
  ronda: z.number().int().min(0),
  pedida_en: z.string().min(10),
  // Si el run va al perfil propio del crítico (otro modelo) o al de oferta, el mismo que redacta.
  independiente: z.boolean(),
});
export type PayloadCriticaData = z.infer<typeof PayloadCritica>;

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const CriticaDatos = z.strictObject({
  apartados: z
    .array(
      z.strictObject({
        apartado: z.number().int().min(1).max(20),
        tramo: z
          .number()
          .min(0)
          .max(1000)
          .describe('Los puntos de uno de los tramos de la escala del apartado (no valorable: 1 si cumple, 0 si no)'),
        puntos: z.number().min(0).max(1000).describe('Los que le daría la mesa: como mucho los del tramo'),
        cita: Texto(10, 1500).describe(
          'Frase literal de la memoria que justifica el tramo (con «…» entre trozos si la recortas)',
        ),
        motivos_para_bajar: z
          .array(z.strictObject({ cita: Texto(5, 1500), motivo: Texto(5, 1000), arreglo: Texto(5, 1000) }))
          .max(10),
        falta: z.array(Texto(3, 500)).max(20).describe('Cada «se valorará» sin tratar o sin concreción'),
      }),
    )
    .min(1)
    .max(20),
  resumen: Texto(10, 3000),
});
export type CriticaDatosData = z.infer<typeof CriticaDatos>;
export type CriticaApartado = CriticaDatosData['apartados'][number];

export const CriticaEntrada = CriticaDatos.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  memoria_id: z.number().int().positive().describe('Los números que te dio la tarea'),
  ronda: z.number().int().min(0),
  lecciones: z
    .array(
      z.strictObject({
        leccion: z.number().int().positive().describe('El número de la lección en la tarea (L<n>)'),
        apartado: z.number().int().min(1).max(20),
        cumple: z.boolean().describe('Si el texto del apartado cumple la lección'),
        nota: Texto(3, 300).describe('Por qué, con una frase o una cita corta del apartado'),
      }),
    )
    .max(60)
    .optional()
    .describe(
      'Solo si la tarea trae LECCIONES DEL EQUIPO: si cada una se cumple, después de puntuar y sin cambiar ningún tramo',
    ),
});
export type CriticaEntradaData = z.infer<typeof CriticaEntrada>;

// Desde la ronda 1, la crítica compara la versión nueva con la anterior (criticaPares.ts).
export const TOOL_PARES = 'licitaciones_memoria_critica_pares';
export const recursoCritica = (a: { id: string; memoria_id: number; ronda: number }) =>
  `${a.id}#m${a.memoria_id}#critica#r${a.ronda}`;
// Las tools que un crítico ciego no puede usar: le enseñan decisiones, estrategia, equipo o notas anteriores.
const TOOLS_PROHIBIDAS = [
  'licitaciones_oferta',
  'licitaciones_dossier',
  'licitaciones_ver',
  'licitaciones_evaluacion',
  'licitaciones_propuestas',
  'licitaciones_equipo',
  'colaboradores_ver',
  'colaboradores_buscar',
];

// ── Revisión (pura) ──

type MemoriaDelGuion = NonNullable<GuionGuardado['datos']['memoria']>;
type ApartadoGuion = MemoriaDelGuion['apartados'][number];
type ContextoCritica = { mem: MemoriaDelGuion; textos: string[] };
// rebajas: apartado → tramo con el que se guarda si se acepta sin la cita del tramo.
type RevisionCritica = { duros: string[]; blandos: string[]; rebajas: Map<number, number> };

const EPSILON = 0.01;
const igual = (a: number, b: number) => Math.abs(a - b) < EPSILON;
const escalaDe = (a: ApartadoGuion): number[] => [...new Set(a.escala.map((t) => t.puntos))].sort((x, y) => x - y);

/** El tramo inmediatamente por debajo (0 si es el más bajo o no hay escala). */
export function tramoInferior(a: ApartadoGuion, tramo: number): number {
  return [...escalaDe(a)].reverse().find((t) => t < tramo - EPSILON) ?? 0;
}

export function problemasDeTramo(x: CriticaApartado, a: ApartadoGuion, valorable: boolean): string[] {
  const n = x.apartado;
  if (!valorable) {
    if (!igual(x.tramo, 0) && !igual(x.tramo, 1))
      return [
        `En una memoria no valorable el tramo del apartado ${n} es 1 (cumple el contenido mínimo) o 0 (no cumple).`,
      ];
    return igual(x.tramo, 0) && !x.falta.length
      ? [`El apartado ${n} no cumple (tramo 0): di en «falta» qué contenido exigido no está.`]
      : [];
  }
  const escala = escalaDe(a);
  if (escala.length && !escala.some((t) => igual(t, x.tramo)))
    return [
      `El tramo ${puntosTexto(x.tramo)} no está en la escala del apartado ${n} (${escala.map(puntosTexto).join(', ')}).`,
    ];
  if (x.puntos > x.tramo + EPSILON)
    return [`En el apartado ${n} los puntos (${puntosTexto(x.puntos)}) pasan de su tramo (${puntosTexto(x.tramo)}).`];
  return x.tramo > a.puntos + EPSILON ? [`El apartado ${n} vale como mucho ${puntosTexto(a.puntos)} puntos.`] : [];
}

export function problemasDeCitas(
  x: CriticaApartado,
  texto: string,
  maximo: number,
): { blandos: string[]; sinCita: boolean } {
  const n = x.apartado;
  const [tramo, ...motivos] = localizarCitas([texto], [x.cita, ...x.motivos_para_bajar.map((m) => m.cita)]);
  const blandos = [
    ...(tramo === null
      ? [
          `La cita del apartado ${n} no está tal cual en su texto: copia literal la frase que justifica el tramo (sin evidencia, la nota no sube).`,
        ]
      : []),
    ...motivos.flatMap((c, i) =>
      c === null ? [`La cita del motivo ${i + 1} del apartado ${n} no está tal cual en su texto.`] : [],
    ),
    ...(igual(x.tramo, maximo) && (x.motivos_para_bajar.length || x.falta.length)
      ? [
          `El apartado ${n} está en el tramo máximo y trae motivos para bajar o cosas que faltan: o baja de tramo o no hay nada que bajar.`,
        ]
      : []),
  ];
  return { blandos, sinCita: tramo === null };
}

/** Que estén todos los apartados, una vez cada uno (por su número). */
export function cobertura(nums: number[], total: number): string[] {
  const faltan = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !nums.includes(n));
  const repetidos = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))];
  return [
    ...(faltan.length ? [`Puntúa todos los apartados: faltan ${faltan.join(', ')}.`] : []),
    ...(repetidos.length ? [`Cada apartado una vez: ${repetidos.join(', ')} está repetido.`] : []),
    ...(nums.some((n) => n > total) ? [`La memoria tiene ${total} apartados.`] : []),
  ];
}

// Un tramo por debajo del máximo sin motivos dejaba a la ronda sin nada que arreglar: el apartado
// se reescribía con «LO QUE SEÑALA EL CRÍTICO:» vacío y no se movía de tramo.
export function problemasDeHueco(x: CriticaApartado, maximo: number, valorable: boolean): string[] {
  if (!valorable || x.tramo >= maximo - EPSILON || x.motivos_para_bajar.length) return [];
  return [
    `El apartado ${x.apartado} está por debajo del tramo máximo (${puntosTexto(x.tramo)} de ${puntosTexto(maximo)}) y no trae ningún motivo para bajar: di qué le separa del tramo siguiente, cada motivo con su cita literal y su arreglo (sin motivos, la ronda no tiene qué arreglar).`,
  ];
}

// Un motivo por aplazamiento («se aprobará después», «sin fechas») con un arreglo genérico
// («concretar el calendario») vuelve a aplazar: el arreglo da el valor que fijaría el mejor competidor.
// Solo las formas de aplazar: «validación», «aprobación» o «pendiente» sueltas salen en motivos
// técnicos que no aplazan nada («no describe el proceso de validación de las respuestas»).
export const MOTIVO_APLAZA =
  /aplaz|a acordar|\bsin (?:fechas?|valor(?:es)?|fijar|concretar|cifras?)\b|\bt0\b|(?:calendario|fechas?|plazos?|hitos?|cronograma) relativ|(?:aprobacion|validacion|concrecion|definicion|confirmacion) posterior|\bpendientes? de (?:aprobacion|validacion|definir|definicion|concretar|acordar|confirmar|decidir)\b|\bsujet[oa]s? a (?:su )?(?:aprobacion|validacion|confirmacion)\b|\bse (?:fijara|definira|concretara|aprobara|acordara)n?\b|\bpor determinar\b/;
const DA_VALOR = /\d|«[^»]{2,}»/;

export function problemasDeAplazamiento(x: CriticaApartado): string[] {
  return x.motivos_para_bajar.flatMap((m, i) =>
    MOTIVO_APLAZA.test(textoComparable(m.motivo)) && !DA_VALOR.test(m.arreglo)
      ? [
          `El motivo ${i + 1} del apartado ${x.apartado} señala un valor aplazado: su arreglo da el valor concreto que propondría el mejor competidor (la cifra, la fecha o el servicio, p. ej. «el servicio se presta de 9:00 a 18:00 h» o «la solución usa X en la región Y»), no «concretarlo».`,
        ]
      : [],
  );
}

// «máximo» precedido de una negación («ningún apartado llega al máximo») no lo afirma; tampoco
// el «límite máximo de páginas». Un resumen que dice qué apartados están en el máximo solo
// contradice los tramos si nombra uno que no lo está: «el apartado 1 alcanza el máximo; el 3
// queda en Bueno» es exacto, y rechazarlo (era duro) dejaba la ronda sin crítica.
const NIEGA = /\b(?:no|ningun[oa]?|sin|debajo|lejos|ni|salvo|excepto|menos)\b/;
const DE_LIMITE = /\b(?:limite|paginas?|extension|caracteres|palabras|tamano)\b/;
// Una cláusula acaba en un punto, en un «;» o «:», o donde empieza otra con su sujeto.
const CLAUSULA = /[.;:]|,? (?:y|pero|mientras|aunque) (?=(?:el|la|los|las) )|, (?=(?:el|la|los|las) (?:apartado|\d))/g;
const NUMEROS = /\bapartados? ((?:\d{1,2}(?:, | y | e )?)+)|\b(?:el|la|los|las) (\d{1,2})\b/g;

function clausulaDe(t: string, i: number): string {
  let desde = 0;
  let hasta = t.length;
  for (const m of t.matchAll(CLAUSULA)) {
    if (m.index < i) desde = m.index + m[0].length;
    else {
      hasta = m.index;
      break;
    }
  }
  return t.slice(desde, hasta);
}

const numerosEn = (t: string): number[] =>
  [...t.matchAll(NUMEROS)].flatMap((m) => (m[1] ?? m[2] ?? '').match(/\d{1,2}/g) ?? []).map(Number);

/** ¿El resumen afirma una nota máxima? Con `bajos` (los apartados por debajo del máximo), solo si la afirma de uno de ellos o de toda la memoria. */
export function resumenDiceMaximo(resumen: string, bajos?: number[]): boolean {
  const t = textoComparable(resumen);
  return [...t.matchAll(/\bmaxim[oa]s?\b/g)].some((m) => {
    if (NIEGA.test(t.slice(Math.max(0, m.index - 40), m.index))) return false;
    const clausula = clausulaDe(t, m.index);
    if (DE_LIMITE.test(clausula)) return false;
    const nums = numerosEn(clausula);
    return !bajos || !nums.length || nums.some((n) => bajos.includes(n));
  });
}

export function problemaDeResumen(
  c: Pick<CriticaDatosData, 'apartados' | 'resumen'>,
  maximos: Map<number, number>,
): string[] {
  const bajos = c.apartados
    .filter((x) => maximos.has(x.apartado) && x.tramo < maximos.get(x.apartado)! - EPSILON)
    .map((x) => x.apartado);
  return bajos.length && resumenDiceMaximo(c.resumen, bajos)
    ? [
        `El resumen habla de «máximo» y los apartados ${bajos.join(', ')} están por debajo del tramo máximo: el resumen no puede contradecir los tramos (di qué apartados llegan al máximo y cuáles no).`,
      ]
    : [];
}

/** Lo que impide aceptar una crítica: duros (tramo fuera de escala, apartados que faltan, tramos bajos sin motivos) siempre; blandos, hasta el tercer envío. */
function revisarCritica(c: CriticaDatosData, ctx: ContextoCritica): RevisionCritica {
  const valorable = memoriaValorable(ctx.mem);
  const duros = cobertura(
    c.apartados.map((x) => x.apartado),
    ctx.mem.apartados.length,
  );
  const blandos: string[] = [];
  const rebajas = new Map<number, number>();
  const maximos = new Map<number, number>();
  for (const x of c.apartados) {
    const a = ctx.mem.apartados[x.apartado - 1];
    if (!a) continue;
    const maximo = valorable ? tramoMaximo(a) : 1;
    maximos.set(x.apartado, maximo);
    duros.push(...problemasDeTramo(x, a, valorable), ...problemasDeHueco(x, maximo, valorable));
    const citas = problemasDeCitas(x, ctx.textos[x.apartado - 1] ?? '', maximo);
    blandos.push(...citas.blandos, ...problemasDeAplazamiento(x));
    if (citas.sinCita && valorable) rebajas.set(x.apartado, tramoInferior(a, x.tramo));
  }
  // El resumen es blando: una frase dudosa no puede dejar la ronda sin crítica.
  return { duros, blandos: [...blandos, ...problemaDeResumen(c, maximos)], rebajas };
}

// Aceptada con lo que falte: sin la cita del tramo, un tramo por debajo (sin evidencia, la nota no sube).
function conRebajas(c: CriticaDatosData, r: RevisionCritica): { datos: CriticaDatosData; avisos: string[] } {
  const avisos: string[] = [];
  const apartados = c.apartados.map((x) => {
    const tramo = r.rebajas.get(x.apartado);
    if (tramo === undefined) return x;
    avisos.push(
      `Apartado ${x.apartado}: sin cita literal que lo sostenga, se guarda en el tramo ${puntosTexto(tramo)} en vez de ${puntosTexto(x.tramo)}.`,
    );
    return { ...x, tramo, puntos: Math.min(x.puntos, tramo) };
  });
  return { datos: { ...c, apartados }, avisos };
}

// ── Paquete ciego ──

// «documento»: la memoria ensamblada (portada, índice, guía, numeración, figuras con su contenido)
// con los chequeos deterministas delante; «memoria», el texto de los apartados sueltos.
export const PARTES_PAQUETE = ['rubrica', 'pliego', 'memoria', 'documento'] as const;
export type ParteDelPaquete = (typeof PARTES_PAQUETE)[number];
// El cliente MCP de Hermes recorta las salidas largas por su cuenta (no es configuración de la plataforma):
// con trozos grandes el crítico recibía el pliego cortado y, gracias al «cierre», se
// negaba a puntuar. 15.000 llega entero; son más lecturas, y las
// instrucciones obligan a seguir hasta «siguiente» = null y a ver el cierre de cada trozo.
export const TROZO_PAQUETE = 15_000;
// El tope de la respuesta de los paquetes (crítico y juez): deja sitio al texto escapado y al sobre
// JSON de un trozo. Si los escapes de un trozo no caben, el trozo se acorta.
export const RESPUESTA_PAQUETE = 30_000;
const SOBRE_PAQUETE = 1_000;
// Va detrás del texto: si el cliente de Hermes recortara la salida, el agente no lo vería y
// sabría que el trozo le llegó cortado aunque «siguiente» diga null.
export const cierreDeTrozo = (desde: number, hasta: number): string => `fin del trozo ${desde}-${hasta}`;

export type TrozoDelPaquete = {
  total: number;
  desde: number;
  hasta: number;
  siguiente: number | null;
  texto: string;
  cierre: string;
};

// Pedirla otra vez traería el mismo recorte: que falle a la vista, no una nota de lo leído a medias.
export const LEER_HASTA_EL_CIERRE =
  'Cada trozo termina con «cierre» = «fin del trozo desde-hasta»: si no lo ves al final, la respuesta te llegó recortada; no envíes nada y termina diciendo «paquete recortado en la parte X».';

/**
 * El trozo de `texto` que empieza en `desde`: hasta TROZO_PAQUETE caracteres y, si sus escapes
 * JSON (un control ocupa 6) no caben en RESPUESTA_PAQUETE, menos: lo que se recortara
 * al servirlo no lo leería nadie, porque el agente sigue desde «siguiente».
 */
export function trozoDelPaquete(texto: string, desde = 0): TrozoDelPaquete {
  const inicio = Math.min(Math.max(desde, 0), texto.length);
  let hasta = Math.min(texto.length, inicio + TROZO_PAQUETE);
  const tope = RESPUESTA_PAQUETE - SOBRE_PAQUETE;
  let escapado = JSON.stringify(texto.slice(inicio, hasta)).length;
  while (escapado > tope) {
    hasta = inicio + Math.max(1, Math.floor(((hasta - inicio) * tope) / escapado) - 1);
    escapado = JSON.stringify(texto.slice(inicio, hasta)).length;
  }
  return {
    total: texto.length,
    desde: inicio,
    hasta,
    siguiente: hasta < texto.length ? hasta : null,
    texto: texto.slice(inicio, hasta),
    cierre: cierreDeTrozo(inicio, hasta),
  };
}

function textoRubrica(mem: MemoriaDelGuion): string {
  const valorable = memoriaValorable(mem);
  return [
    `Memoria «${mem.titulo_documento}»: ${valorable ? `${puntosTexto(mem.apartados.reduce((s, a) => s + a.puntos, 0))} puntos` : 'no se puntúa; la mesa comprueba el contenido mínimo'}; límite ${mem.limite_paginas ?? 'sin límite'} páginas.`,
    ...mem.apartados.flatMap((a, i) => [
      '',
      `${i + 1}. ${a.titulo}${valorable ? ` (${puntosTexto(a.puntos)} puntos)` : ''}`,
      ...a.se_valorara.map(
        (s, k) =>
          `- ${s}${a.puntos_se_valorara?.[k] !== undefined ? ` (máx. ${puntosTexto(a.puntos_se_valorara[k]!)})` : ''}`,
      ),
      ...(valorable
        ? [
            `Escala: ${a.escala.length ? a.escala.map((t) => `${puntosTexto(t.puntos)} = ${t.descripcion}`).join(' | ') : `de 0 a ${puntosTexto(a.puntos)}`}`,
          ]
        : []),
    ]),
    '',
    `Advertencias del pliego: ${mem.advertencias.length ? mem.advertencias.map((x) => `«${x}»`).join(' ') : 'ninguna'}.`,
  ].join('\n');
}

function textoMemoria(db: Db, m: FilaMemoria, mem: MemoriaDelGuion): string {
  const textos = textosDeApartados(db, m.id);
  return mem.apartados
    .map(
      (a, i) =>
        `## ${i + 1}. ${a.titulo}\n\n${textos[i] ? textos[i]!.split('\n').slice(1).join('\n') : '[Apartado sin redactar]'}`,
    )
    .join('\n\n');
}

// Sin documento (no se puede componer), el texto de los apartados con la misma cabecera.
function textoDocumento(db: Db, m: FilaMemoria, mem: MemoriaDelGuion): string {
  const md = documentoEnMarkdown(db, m.id) ?? textoMemoria(db, m, mem);
  return `${textoDeChequeos(chequeosConCoste(md))}\n\n${md}`;
}

function textoParte(db: Db, m: FilaMemoria, mem: MemoriaDelGuion, parte: ParteDelPaquete): string {
  if (parte === 'rubrica') return textoRubrica(mem);
  if (parte === 'memoria') return textoMemoria(db, m, mem);
  if (parte === 'documento') return textoDocumento(db, m, mem);
  const secciones = dossierDe(db, m.id)?.secciones.filter((s) => s.critico) ?? [];
  return secciones.length
    ? secciones.map((s) => `## ${s.titulo}\n\n${s.texto}`).join('\n\n')
    : 'Sin el pliego compuesto: puntúa con la rúbrica.';
}

/** Una parte del paquete ciego, por trozos: solo rúbrica, pliego (lo que el crítico necesita) y memoria. */
export function paqueteCiego(
  db: Db,
  a: { id: string; memoria_id: number; parte: ParteDelPaquete; desde?: number | undefined },
): Result<unknown> {
  const m = filaMemoria(db, a.memoria_id);
  const mem = m && m.licitacion_id === a.id ? guionPorId(db, m.guion_id)?.datos.memoria : null;
  if (!m || !mem) return fail('not_found', `No hay ninguna memoria con id ${a.memoria_id} en la licitación «${a.id}».`);
  return ok({ parte: a.parte, ...trozoDelPaquete(textoParte(db, m, mem, a.parte), a.desde) });
}

// ── Recepción y guardado ──

/** ¿Usó el agente alguna tool prohibida para esta licitación durante el run? */
export function ciegaSegunAuditoria(
  db: Db,
  agente: string,
  licitacion: string,
  desde: string,
  hasta: string = new Date().toISOString(),
): boolean {
  const usadas = db
    .prepare(
      `SELECT DISTINCT herramienta FROM nucleo.auditoria_agentes WHERE agente = ? AND creado_en >= ? AND creado_en <= ?
    AND (recurso = ? OR recurso LIKE ?)`,
    )
    .all(agente, desde, hasta, licitacion, `${licitacion}#%`) as { herramienta: string }[];
  return !usadas.some((u) => TOOLS_PROHIBIDAS.includes(u.herramienta));
}

type TrabajoCritica = { id: number; lanzado_en: string | null; payload: string };

function trabajoDeCritica(db: Db, memoriaId: number, ronda: number): TrabajoCritica | null {
  return (
    (db
      .prepare(
        `SELECT id, lanzado_en, payload FROM nucleo.trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.memoria_id') = ?
    AND json_extract(payload, '$.ronda') = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(TIPO_MEMORIA_CRITICA, memoriaId, ronda) as TrabajoCritica | undefined) ?? null
  );
}

export function destinoDeLaCritica(
  db: Db,
  e: Pick<CriticaEntradaData, 'id' | 'memoria_id' | 'ronda'>,
): Result<{ m: FilaMemoria; mem: MemoriaDelGuion }> {
  const m = filaMemoria(db, e.memoria_id);
  if (!m || m.licitacion_id !== e.id)
    return fail('not_found', `No hay ninguna memoria con id ${e.memoria_id} en la licitación «${e.id}».`);
  if (m.estado !== 'redactando' || m.fase !== 'critica' || m.ronda !== e.ronda)
    return fail('invalid_input', `Esa memoria no espera crítica de la ronda ${e.ronda}.`);
  const mem = guionPorId(db, m.guion_id)?.datos.memoria;
  return mem ? ok({ m, mem }) : fail('not_found', 'El guion de esta memoria ya no está.');
}

export type CriticaRecibida = {
  memoria: number;
  ronda: number;
  total: number;
  maximo: number;
  independiente: boolean;
  ciega: boolean;
  avisos: string[];
};
export type Marcas = { independiente: boolean; ciega: boolean; trabajo: number | null };

// Sin perfil propio, el crítico es el mismo agente que redacta, y el run de la redacción puede
// seguir vivo cuando se lanza la crítica: lo que ese run consulte no es del crítico. Su ventana
// empieza en su primera lectura del paquete (o al lanzarse, si no lo leyó).
function inicioDeLaCritica(db: Db, m: FilaMemoria, agente: string, lanzado: string): string {
  const f = db
    .prepare(
      `SELECT MIN(creado_en) AS desde FROM nucleo.auditoria_agentes WHERE agente = ? AND herramienta = 'licitaciones_memoria_critica_paquete'
    AND recurso = ? AND creado_en >= ?`,
    )
    .get(agente, `${m.licitacion_id}#m${m.id}#paquete`, lanzado) as { desde: string | null };
  return f.desde ?? lanzado;
}

// Independiente: el run fue al perfil del crítico y no lo envió el mismo agente que escribió la estrategia.
export function marcasDe(db: Db, m: FilaMemoria, agente: string): Marcas {
  const t = trabajoDeCritica(db, m.id, m.ronda);
  const payload = t ? PayloadCritica.safeParse(JSON.parse(t.payload)) : null;
  const independiente =
    (payload?.success ? payload.data.independiente : false) && estrategiaDe(db, m.id)?.agente !== agente;
  const lanzado = t?.lanzado_en ?? m.pedida_en;
  const desde = independiente ? lanzado : inicioDeLaCritica(db, m, agente, lanzado);
  return { independiente, ciega: ciegaSegunAuditoria(db, agente, m.licitacion_id, desde), trabajo: t?.id ?? null };
}

export type TotalesCritica = { total: number; maximo: number };

/** Total y máximo de una crítica: puntos sobre el tramo máximo de cada apartado (o apartados que cumplen, si no se puntúa). */
export function totalesDe(c: CriticaDatosData, mem: MemoriaDelGuion): TotalesCritica {
  if (!memoriaValorable(mem))
    return { total: c.apartados.filter((x) => igual(x.tramo, 1)).length, maximo: mem.apartados.length };
  return {
    total: Math.round(c.apartados.reduce((s, x) => s + x.puntos, 0) * 100) / 100,
    maximo: mem.apartados.reduce((s, a) => s + tramoMaximo(a), 0),
  };
}

// Lo que se guarda de un apartado en la ronda cuando no es su texto actual: en el juicio por
// pares, la versión conservada (la anterior, si ganó) y el resultado del par.
export type FilaDeCritica = { datos: string; par: unknown };
export type CriticaAGuardar = {
  datos: CriticaDatosData & { pares?: unknown };
  avisos: string[];
  agente: string;
  marcas: Marcas;
  totales: TotalesCritica;
};

/** Guarda la crítica de la ronda en curso y, por apartado, el texto puntuado con su tramo y sus motivos. */
export function guardarCritica(
  db: Db,
  m: FilaMemoria,
  c: CriticaAGuardar,
  porApartado: ReadonlyMap<number, FilaDeCritica> = new Map(),
): void {
  const filas = apartadosDe(db, m.id);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO memoria_criticas (memoria_id, ronda, datos, total, maximo, independiente, ciega, avisos, agente, trabajo_id, creada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(memoria_id, ronda) DO UPDATE SET datos = excluded.datos, total = excluded.total, maximo = excluded.maximo,
        independiente = excluded.independiente, ciega = excluded.ciega, avisos = excluded.avisos, agente = excluded.agente, trabajo_id = excluded.trabajo_id, creada_en = excluded.creada_en`,
    ).run(
      m.id,
      m.ronda,
      JSON.stringify(c.datos),
      c.totales.total,
      c.totales.maximo,
      c.marcas.independiente ? 1 : 0,
      c.marcas.ciega ? 1 : 0,
      JSON.stringify(c.avisos),
      c.agente,
      c.marcas.trabajo,
      new Date().toISOString(),
    );
    const ronda =
      db.prepare(`INSERT INTO memoria_apartado_rondas (memoria_id, apartado, ronda, datos, puntos, tramo, motivos) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memoria_id, apartado, ronda) DO UPDATE SET datos = excluded.datos, puntos = excluded.puntos, tramo = excluded.tramo, motivos = excluded.motivos`);
    for (const x of c.datos.apartados) {
      const propia = porApartado.get(x.apartado);
      const datos = propia?.datos ?? filas.find((f) => f.apartado === x.apartado)?.datos ?? 'null';
      const par = propia ? { par: propia.par } : {};
      ronda.run(
        m.id,
        x.apartado,
        m.ronda,
        datos,
        x.puntos,
        x.tramo,
        JSON.stringify({ cita: x.cita, motivos_para_bajar: x.motivos_para_bajar, falta: x.falta, ...par }),
      );
    }
  })();
}

/**
 * Revisa y guarda la crítica de una ronda. Con `revisar` (la tool), lo blando (citas que no
 * están, tramo máximo con motivos) se rechaza hasta el tercer envío; lo duro (tramo fuera de la
 * escala, apartados que faltan), siempre. Marca si fue independiente y ciega.
 */
export function recibirCritica(
  db: Db,
  e: CriticaEntradaData,
  agente: string,
  op: { revisar?: boolean; hoy?: Date } = {},
): Result<CriticaRecibida> {
  const d = destinoDeLaCritica(db, e);
  if (d.error) return d;
  // Una nota absoluta por ronda dio los mismos tramos a dos versiones que los jueces separaban
  // por 7 puntos: desde la ronda 1 solo vale comparar con la versión anterior.
  if (e.ronda > 0)
    return fail(
      'invalid_input',
      `Desde la ronda 1 la crítica es por pares: lee las partes «documento_1» y «documento_2» del paquete y envía ${TOOL_PARES}.`,
    );
  const { id: _id, memoria_id: _m, ronda: _r, lecciones, ...datos } = e;
  const r = revisarCritica(datos, { mem: d.data.mem, textos: textosDeApartados(db, e.memoria_id) });
  const exigir = op.revisar === true && exigirRevision(db, 'licitaciones_memoria_critica', recursoCritica(e), op.hoy);
  if (r.duros.length || (exigir && r.blandos.length))
    return fail(
      'invalid_input',
      `${[...r.duros, ...r.blandos].join(' ')} Corrige y vuelve a enviar la crítica entera.`,
    );
  const aceptada = exigir ? { datos, avisos: [] } : conRebajas(datos, r);
  const avisos = [...(exigir ? [] : r.blandos.filter((b) => !/^La cita del apartado/.test(b))), ...aceptada.avisos];
  const marcas = marcasDe(db, d.data.m, agente);
  const totales = totalesDe(aceptada.datos, d.data.mem);
  guardarCritica(db, d.data.m, { datos: aceptada.datos, avisos, agente, marcas, totales });
  if (lecciones?.length) marcarCumplidas(db, e.memoria_id, lecciones);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { accion: 'critica', version: d.data.m.version, ronda: e.ronda, memoria: e.memoria_id },
  });
  return ok({
    memoria: e.memoria_id,
    ronda: e.ronda,
    ...totales,
    independiente: marcas.independiente,
    ciega: marcas.ciega,
    avisos,
  });
}

export type CriticaGuardada = {
  ronda: number;
  datos: CriticaDatosData;
  total: number;
  maximo: number;
  independiente: boolean;
  ciega: boolean;
  avisos: string[];
  agente: string;
  creada_en: string;
};

/** Las críticas de una memoria, por ronda. */
export function criticasDe(db: Db, memoriaId: number): CriticaGuardada[] {
  const filas = db.prepare('SELECT * FROM memoria_criticas WHERE memoria_id = ? ORDER BY ronda').all(memoriaId) as {
    ronda: number;
    datos: string;
    total: number;
    maximo: number;
    independiente: number;
    ciega: number;
    avisos: string;
    agente: string;
    creada_en: string;
  }[];
  return filas.map((f) => ({
    ronda: f.ronda,
    datos: JSON.parse(f.datos) as CriticaDatosData,
    total: f.total,
    maximo: f.maximo,
    independiente: f.independiente === 1,
    ciega: f.ciega === 1,
    avisos: JSON.parse(f.avisos) as string[],
    agente: f.agente,
    creada_en: f.creada_en,
  }));
}

/**
 * ¿La crítica es del texto de ahora? No, si algún apartado se recibió después de ella: la nota sería
 * de un texto anterior. Lo usan el tribunal de las comprobaciones y la Revisión.
 */
export function criticaVigente(db: Db, memoriaId: number, c: Pick<CriticaGuardada, 'creada_en'>): boolean {
  const f = db
    .prepare("SELECT MAX(recibido_en) AS ultimo FROM memoria_apartados WHERE memoria_id = ? AND estado = 'recibido'")
    .get(memoriaId) as { ultimo: string | null };
  return f.ultimo === null || f.ultimo <= c.creada_en;
}

/** «hecho» del trabajo: hay crítica de esa ronda (o la memoria ya no la espera). */
export function criticaRecibida(db: Db, p: PayloadCriticaData): boolean {
  const m = filaMemoria(db, p.memoria_id);
  if (!m || m.estado !== 'redactando' || m.fase !== 'critica' || m.ronda !== p.ronda) return true;
  return (
    db.prepare('SELECT 1 FROM memoria_criticas WHERE memoria_id = ? AND ronda = ?').get(p.memoria_id, p.ronda) !==
    undefined
  );
}

// ── Instrucciones ──

/** Lo que separa un Excelente de un Bueno, según el juez ciego al comparar una memoria fuerte con una floja. */
const EXCELENTE_FRENTE_A_BUENO = [
  'lo específico de este cliente: su normativa interna, sus aclaraciones, sus sistemas y su contexto, no lo que valdría para cualquiera',
  'cifras y límites concretos (plazos, volúmenes, umbrales, niveles de servicio) en vez de adjetivos',
  'planificación con fechas, hitos y responsables',
  'un registro de riesgos con probabilidad, impacto y medida',
  'figuras que muestran algo (arquitectura, flujo, calendario), no decorativas',
  'coherencia interna: los mismos horarios, plazos, roles y cifras en toda la memoria',
];

export const COMPROMETE_LO_CARO =
  'compromete lo caro que el pliego no exige y no puntúa (guardias o fines de semana, entrevistas o material físico por persona, horas fijas o frecuencias por encima de lo que se valora): no suma puntos y crea riesgo de ejecución';

/**
 * Defectos que, cada uno, impiden el tramo Excelente del apartado donde están (la memoria que
 * aplazó todo quedó en Aceptable: «carencias de detalle que requerirán concreción posterior»).
 */
export const DEFECTOS_QUE_BAJAN = [
  'aplaza un valor de diseño (región, servicio, modelo, umbral, horario, dedicación, fecha) a una aprobación posterior sin proponerlo',
  // Los jueces leyeron «X propone…; el órgano lo ratifica en el acta», repetido, como aplazamiento aunque llevara fecha.
  'deja lo decidido a que el órgano lo ratifique después («lo ratifica en el acta») en vez de afirmarlo, más de una vez en el apartado',
  'calendario relativo («T0», «semana 3») sin fechas',
  'el mismo ejemplo, caso o etiqueta repetido en varios apartados',
  'figuras sin contenido legible (un marcador o un dibujo sin rótulos que digan algo)',
  'transferencia sin horas, sesiones ni meses cuando la formación o el soporte se acreditan en esta memoria',
  // Un juez ciego vio indicadores medidos con datos reales mientras el calendario tenía la producción cerrada hasta la aceptación.
  'incoherencias entre calendario, entornos y medición (un indicador medido con datos reales en un entorno o en una fecha en que el calendario aún no los permite, o sin decir en qué entorno y con qué datos se mide)',
  // Prometer horas y euros que el pliego no pedía vincula al ejecutar y no da puntos.
  COMPROMETE_LO_CARO,
];

/**
 * Cómo se reparten los tramos, con la escala del propio pliego (nunca con una memoria de
 * referencia): sin esta vara, el crítico dio los mismos tramos a dos versiones que los jueces
 * ciegos separaban por 7 puntos sobre 25.
 */
function calibracionDeTramos(mem: MemoriaDelGuion): string {
  const base =
    'El tramo Excelente (el más alto) exige concreción verificable: cada «se valorará» con cifras, fechas, responsables, normas o sistemas del cliente que la mesa pueda comprobar en el texto. Bueno (el siguiente) si lo principal está concreto pero hay aspectos secundarios poco desarrollados o genéricos. Más abajo, si domina lo que valdría para cualquier contrato. Comprometer lo caro que el pliego no exige ni puntúa no sube ningún tramo: es un defecto, porque no da puntos y obliga al ejecutar el contrato.';
  const a = mem.apartados.find((x) => escalaDe(x).length >= 2 && x.escala.every((t) => t.descripcion.trim()));
  if (!a) return base;
  const [alto, siguiente] = [...a.escala].sort((x, y) => y.puntos - x.puntos);
  return `${base} Con la escala de este pliego, en «${a.titulo}»: «${alto!.descripcion}» (${puntosTexto(alto!.puntos)}) frente a «${siguiente!.descripcion}» (${puntosTexto(siguiente!.puntos)}); se pasa del segundo al primero cuando todo lo que se valora está concretado y se puede comprobar, no solo lo principal.`;
}

/** Lo que separa los tramos y los defectos que impiden el máximo: igual en la crítica absoluta y en la de pares. */
export function criteriosDeTramo(mem: MemoriaDelGuion): string {
  const calibracion = memoriaValorable(mem) ? ` ${calibracionDeTramos(mem)}` : '';
  return `Lo que separa un Excelente de un Bueno: ${EXCELENTE_FRENTE_A_BUENO.join('; ')}.${calibracion} Cada uno de estos defectos impide el Excelente del apartado donde esté: ${DEFECTOS_QUE_BAJAN.join('; ')}. Un motivo por aplazamiento lleva como arreglo el valor concreto que propondría el mejor competidor (la cifra, la fecha o el servicio), no «concretarlo».`;
}

// Lo que el equipo aprendió y se pasó a la redacción: se comprueba después de puntuar, para no
// mover la nota hacia lo que el equipo quiere ver.
function lineasLeccionesCritica(db: Db, memoriaId: number): string[] {
  const pasadas = aplicacionesDe(db, memoriaId);
  if (!pasadas.length) return [];
  return [
    '5. Después de puntuar, y sin cambiar ningún tramo ni ningún motivo: estas son LECCIONES DEL EQUIPO que se pasaron a la redacción. Di de cada una si el texto de su apartado la cumple, en «lecciones» = [{ leccion, apartado, cumple, nota }], con una frase o una cita corta en «nota».',
    'LECCIONES DEL EQUIPO:',
    ...pasadas.map((a) => `- L${a.leccion_id} (apartado ${a.apartado}): ${a.texto}`),
  ];
}

/** Instrucciones del run del crítico ciego. */
export function instruccionesCritica(db: Db, p: PayloadCriticaData): string {
  const m = filaMemoria(db, p.memoria_id);
  const mem = m ? guionPorId(db, m.guion_id)?.datos.memoria : null;
  const cabecera = `Tarea de la plataforma de ${nombreEmpresa(db)}: eres un vocal técnico de la mesa de contratación, severo, y puntúas la memoria técnica (versión ${p.version}, ronda ${p.ronda}) de la licitación ${p.id}. Sigue la skill «licitaciones» (sección «Criticar una memoria (ciego)»).`;
  if (!m || !mem) return [cabecera, '', 'Esta memoria ya no está: no hagas nada y termina.'].join('\n');
  const valorable = memoriaValorable(mem);
  return [
    cabecera,
    '',
    'SOLO puedes usar licitaciones_memoria_critica_paquete y licitaciones_memoria_critica. Ninguna otra herramienta: ni la oferta, ni el dossier, ni la ficha, ni el equipo, ni evaluaciones anteriores, ni la Biblioteca. La plataforma lo comprueba en la auditoría y una crítica que mire otra cosa no vale.',
    `1. Lee el paquete entero con licitaciones_memoria_critica_paquete (id=${p.id}, memoria_id=${p.memoria_id}): parte «rubrica», parte «pliego» y parte «documento» (la memoria como la verá la mesa: portada, índice, guía, numeración y el contenido de las figuras, con las comprobaciones automáticas delante), cada una por trozos («desde» = «siguiente») hasta el final: si la respuesta trae «siguiente» ≠ null, sigue leyendo; no envíes la crítica sin haber llegado a «siguiente» = null en rubrica, pliego y documento (una crítica de lo leído a medias puntúa una memoria que no existe). ${LEER_HASTA_EL_CIERRE} Cada comprobación automática es un defecto: llévala a «motivos_para_bajar» del apartado donde está. Las citas, del texto de los apartados (no de la portada, el índice, la guía ni los pies de figura).`,
    '2. Por cada apartado empieza en el tramo más bajo de su escala y súbelo solo con una cita literal de la memoria que lo pruebe. Compara con lo que escribiría el mejor competidor posible: una memoria correcta no es Excelente.',
    `3. ${criteriosDeTramo(mem)}`,
    valorable
      ? '4. Por apartado: «tramo» (los puntos de uno de los tramos de su escala), «puntos» (como mucho los del tramo), «cita» (la frase literal que lo justifica, copiada tal cual; si la recortas, con «…» entre trozos), «motivos_para_bajar» (hasta 10, cada uno con su cita literal, el motivo y el arreglo concreto) y «falta» (cada «se valorará» sin tratar o sin concreción). Un tramo máximo exige motivos y falta vacíos; un tramo por debajo del máximo, al menos un motivo con su arreglo. El resumen no dice «máximo» si algún apartado no lo es.'
      : '4. Esta memoria no se puntúa: por apartado, «tramo» 1 si cumple el contenido mínimo exigido y 0 si no, «puntos» igual al tramo, «cita» literal que lo pruebe y «falta» con lo exigido que no está (obligatoria con tramo 0).',
    ...lineasLeccionesCritica(db, p.memoria_id),
    `${aplicacionesDe(db, p.memoria_id).length ? 6 : 5}. Envía licitaciones_memoria_critica con id=${p.id}, memoria_id=${p.memoria_id}, ronda=${p.ronda}, los apartados y un resumen. Si responde con un error, corrige exactamente lo que dice y reenvía la crítica entera.`,
    'No hagas nada más: no reescribas la memoria y no respondas en ningún canal.',
  ].join('\n');
}
