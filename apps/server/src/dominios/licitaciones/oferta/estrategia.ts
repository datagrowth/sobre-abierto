// Estrategia de la memoria (docs/como-esta-hecho/memoria-tecnica.md, paso 2): el contrato de la redacción, que Hermes piensa antes.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { llevaNumeracion } from '../../../nucleo/documentos/docx.js';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { decisionesDe, equipoParaRedactar } from './decisiones.js';
import { baseDeArtefacto, CLAVES_DOSSIER, dossierDe, escribirEnSalidas, textoDePliegos } from './dossier.js';
import { filaMemoria, type FilaMemoria } from './ensamblado.js';
import {
  cifrasConUnidad,
  compromisosDeLaMemoria,
  valorDeCompromiso,
  type CompromisoMemoria,
} from './compromisosMemoria.js';
import { COMPROMISOS_BARATOS, solucionNormalizada } from './compromisosSolucion.js';
import { detectarFugas, type ContextoFugas } from './fugas.js';
import { contextoFugasDe } from './fugasMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { memoriaValorable } from './guionRevision.js';
import { nombresDelEquipoEn } from './hechos.js';
import { decisionesDelLote } from './memoriaLote.js';
import { CARACTERES_POR_PAGINA, cuotaDeApartado, cuotaIgual, paginasDeGuia, type Cuota } from './memoriaRevision.js';
import { normativaCitable, problemasDeSolucion, Solucion, solucionEnMarkdown, textosDeSolucion } from './solucion.js';
import { aplazamientosEn, ratificacionesEn } from './aplazamientos.js';
import { inicioDelDossier } from './calendario.js';
import { MESES_VIGENCIA, versionesAnticuadas } from './vigenciaModelos.js';
import { apelmazado } from './telegrafia.js';

// Antes de redactar, Hermes piensa la oferta: temas ganadores, audiencia, estructura con los títulos literales y
// la extensión de cada apartado, el mapa criterio → sección → evidencia, una hoja de hechos única (horarios,
// plazos, roles, cifras: sin ella, un mismo horario sale distinto en dos apartados) y la frontera. El código la
// revisa (pura) y la guarda.
export const TIPO_MEMORIA_ESTRATEGIA = 'licitaciones.memoria_estrategia';
export const PayloadEstrategia = z.object({
  id: z.string().min(3),
  memoria_id: z.number().int().positive(),
  version: z.number().int().positive(),
  pedida_en: z.string().min(10),
});
export type PayloadEstrategiaData = z.infer<typeof PayloadEstrategia>;

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const NumApartado = z.number().int().min(1).max(20);
export const CATEGORIAS_HECHO = [
  'horario',
  'plazo',
  'rol',
  'indicador',
  'cifra',
  'herramienta',
  'calendario',
  'otro',
] as const;
const ELEMENTOS = ['tabla', 'figura', 'lista', 'cronograma', 'riesgos'] as const;

const Hecho = z.strictObject({
  clave: Texto(2, 60).describe('Identificador corto y único, p. ej. «horario_atencion»'),
  categoria: z.enum(CATEGORIAS_HECHO),
  sobre: Texto(3, 200).describe('De qué es el hecho, p. ej. «atención tutorial»'),
  valor: Texto(1, 300).describe(
    'El valor exacto que copiarán todos los apartados, p. ej. «L-V 9:00-17:00 (peninsular)»',
  ),
  unidad: Texto(1, 40).optional(),
  audiencia: Texto(2, 200).optional(),
  palabras: z
    .array(Texto(2, 60))
    .min(1)
    .max(5)
    .describe('Anclas para encontrarlo en el texto, p. ej. «atención», «tutorías»'),
  corto: Texto(1, 12)
    .optional()
    .describe(
      'Sigla con que se cita el rol después de presentarlo, p. ej. «RS»; obligatoria en un rol de más de 40 caracteres',
    ),
  apartados: z
    .array(NumApartado)
    .max(20)
    .optional()
    .describe('En qué apartados sale (cuenta para el mínimo de cifras e indicadores por apartado)'),
});
export type HechoData = z.infer<typeof Hecho>;

export const EstrategiaDatos = z.strictObject({
  temas: z
    .array(
      z.strictObject({
        titulo: Texto(3, 200),
        mensaje: Texto(10, 1000),
        por_que_puntua: Texto(10, 1000).describe('Qué «se valorará» o tramo de la escala gana'),
        prueba: Texto(5, 1000).describe('El hecho, cifra o entregable que lo demuestra'),
        apartados: z.array(NumApartado).min(1).max(20),
      }),
    )
    .min(3)
    .max(6),
  audiencia: z.strictObject({
    destinatarios: Texto(3, 500),
    nivel: Texto(3, 300),
    ejemplos_del_contexto: z.array(Texto(3, 300)).max(10),
    evitar: z.array(Texto(3, 300)).max(10),
  }),
  estructura: z
    .array(
      z.strictObject({
        apartado: NumApartado,
        titulo: Texto(2, 300).describe('El título literal del guion'),
        caracteres_objetivo: z.number().int().min(500).max(500_000),
        secciones: z
          .array(
            z.strictObject({
              titulo: Texto(2, 200),
              contenido: Texto(10, 2000),
              elementos: z.array(z.enum(ELEMENTOS)).max(5).default([]),
            }),
          )
          .min(1)
          .max(15),
      }),
    )
    .min(1)
    .max(20),
  mapa: z
    .array(
      z.strictObject({
        apartado: NumApartado,
        item: Texto(2, 1000).describe('Un «se valorará» literal'),
        seccion: Texto(2, 200).describe('Título de la sección de la estructura que lo trata'),
        evidencia: Texto(5, 1000).describe(
          'Qué prueba concreta lo demuestra en esa sección, en una frase legible con espacios entre palabras y cifras (sale tal cual en la tabla guía del documento; unos 160 caracteres)',
        ),
      }),
    )
    .max(200),
  hechos: z.array(Hecho).max(80),
  frontera: z.array(z.strictObject({ no_decir: Texto(2, 500), motivo: Texto(3, 500) })).max(30),
  reglas: z.array(Texto(5, 500)).max(15),
  solucion: Solucion.describe(
    'Los parámetros de diseño que el pliego deja al licitador, ya decididos: la memoria los compromete',
  ),
});
export type EstrategiaDatosData = z.infer<typeof EstrategiaDatos>;
// Lo guardado antes del bloque «solucion» sigue valiendo para redactar (sin ficha que revisar).
const EstrategiaGuardadaDatos = EstrategiaDatos.extend({ solucion: Solucion.optional() });
export type EstrategiaLeidaData = z.infer<typeof EstrategiaGuardadaDatos>;

const Numero = z.number().int().positive();
export const EstrategiaEntrada = EstrategiaDatos.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  memoria_id: Numero.describe('Los números que te dio la tarea'),
  version: Numero,
});
export type EstrategiaEntradaData = z.infer<typeof EstrategiaEntrada>;

export const recursoEstrategia = (a: { id: string; version: number }) => `${a.id}#v${a.version}#estrategia`;

// ── Revisión (pura) ──

type MemoriaDelGuion = NonNullable<GuionGuardado['datos']['memoria']>;
// compromisos: los criterios automáticos a los que se acoge la empresa que se acreditan en esta memoria.
// fuentes: el texto del dossier, donde tiene que estar la cita de cada pendiente legítimo.
// inicio: el día desde el que el dossier fecha el calendario (null si no lo sabe).
// recortado: el dossier tiene secciones recortadas (una cita que no aparece puede estar en ellas).
// normativa: el dossier trae pasajes de normativa del cliente (pide el catálogo normativo de la
// solución); normativaTexto: esa sección, para comprobar de qué norma sale cada cita.
export type ContextoEstrategia = {
  mem: MemoriaDelGuion;
  fugas: ContextoFugas;
  porRoles: boolean;
  equipo: string[];
  herramientas: string[];
  compromisos?: CompromisoMemoria[];
  fuentes?: string | undefined;
  recortado?: boolean | undefined;
  inicio?: string | null;
  normativa?: boolean;
  normativaTexto?: string | undefined;
};
export type ProblemasEstrategia = { duros: string[]; blandos: string[]; avisos: string[] };

const comparable = (t: string) =>
  textoComparable(t)
    .replace(/^\s*\d+(?:\.\d+)*[.)-]?\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const MILES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
// Portada e índice no cuentan (las mismas 2 páginas que en memoriaRevision.ts).
const PAGINAS_FUERA = 2;

function problemasDeEstructura(e: EstrategiaDatosData, mem: MemoriaDelGuion): string[] {
  const out: string[] = [];
  if (e.estructura.length !== mem.apartados.length)
    out.push(
      `«estructura» debe tener un elemento por apartado del guion (${mem.apartados.length}), en orden; tiene ${e.estructura.length}.`,
    );
  mem.apartados.forEach((a, i) => {
    const x = e.estructura[i];
    if (x && (x.apartado !== i + 1 || comparable(x.titulo) !== comparable(a.titulo)))
      out.push(
        `El apartado ${i + 1} de «estructura» debe llevar el título literal del guion: «${a.titulo}» (llegó ${x.apartado}. «${x.titulo}»).`,
      );
  });
  // El documento numera cada sección («2.3»): un título que ya lo trae sale numerado dos veces.
  for (const x of e.estructura) {
    for (const s of x.secciones)
      if (llevaNumeracion(s.titulo))
        out.push(
          `La sección «${s.titulo}» del apartado ${x.apartado} lleva numeración: escribe solo el título; el número lo pone el documento.`,
        );
  }
  return out;
}

function problemasDeMapa(e: EstrategiaDatosData, mem: MemoriaDelGuion): string[] {
  const out: string[] = [];
  mem.apartados.forEach((a, i) => {
    const delApartado = e.mapa.filter((m) => m.apartado === i + 1);
    const secciones = new Set((e.estructura[i]?.secciones ?? []).map((s) => comparable(s.titulo)));
    for (const s of a.se_valorara)
      if (!delApartado.some((m) => comparable(m.item) === comparable(s)))
        out.push(
          `Falta en «mapa» el «se valorará» «${s}» del apartado ${i + 1}: di en qué sección se trata y con qué evidencia.`,
        );
    for (const m of delApartado)
      if (!secciones.has(comparable(m.seccion)))
        out.push(
          `El «mapa» lleva «${m.item}» a la sección «${m.seccion}», que no está en la estructura del apartado ${i + 1}.`,
        );
    // La evidencia sale tal cual en la tabla guía del documento: apelmazada no se lee.
    for (const m of delApartado)
      if (apelmazado(m.evidencia))
        out.push(
          `La evidencia del «mapa» para «${m.item}» (apartado ${i + 1}) va apelmazada: «${m.evidencia}». Escríbela como una frase legible, con espacios entre palabras y cifras («Figura con los 2 perfiles y los 9 tipos de documento»): sale tal cual en la tabla guía del documento.`,
        );
  });
  return out;
}

// Las cuotas son de la memoria: reservan las páginas de la tabla guía que la plataforma añade al Word.
const cuotasDe = (mem: MemoriaDelGuion): (Cuota | null)[] => {
  const total = mem.apartados.reduce((s, a) => s + a.puntos, 0);
  const guia = paginasDeGuia(mem);
  return mem.apartados.map((a) =>
    memoriaValorable(mem)
      ? cuotaDeApartado(mem.limite_paginas, a.puntos, total, guia)
      : cuotaIgual(mem.limite_paginas, mem.apartados.length, guia),
  );
};

// Sin límite de páginas, un techo por cada «se valorará»: la extensión es la de un buen desarrollo
// de cada punto, no la que quepa (una memoria sin límite se planeó y salió muy por encima de la local).
const TECHO_POR_PUNTO = 3_300;
const techoDe = (a: MemoriaDelGuion['apartados'][number]) => TECHO_POR_PUNTO * Math.max(1, a.se_valorara.length);

function problemasDeTecho(e: EstrategiaDatosData, mem: MemoriaDelGuion): string[] {
  const out = mem.apartados.flatMap((a, i) => {
    const x = e.estructura[i];
    return x && x.caracteres_objetivo > techoDe(a)
      ? [
          `La extensión objetivo del apartado ${i + 1} (${MILES.format(x.caracteres_objetivo)}) pasa del techo de ${MILES.format(techoDe(a))} caracteres (${MILES.format(TECHO_POR_PUNTO)} por cada «se valorará»; el pliego no limita las páginas, pero la extensión no puntúa): recórtala.`,
        ]
      : [];
  });
  const techo = mem.apartados.reduce((s, a) => s + techoDe(a), 0);
  const suma = e.estructura.reduce((s, x) => s + x.caracteres_objetivo, 0);
  if (suma > techo)
    out.push(
      `Las extensiones suman ${MILES.format(suma)} caracteres y el techo de la memoria es ${MILES.format(techo)} (${MILES.format(TECHO_POR_PUNTO)} por cada «se valorará»): recórtalas.`,
    );
  return out;
}

function problemasDeExtension(e: EstrategiaDatosData, mem: MemoriaDelGuion): string[] {
  if (mem.limite_paginas === null) return problemasDeTecho(e, mem);
  const out = cuotasDe(mem).flatMap((q, i) => {
    const x = e.estructura[i];
    if (!q || !x) return [];
    const suelo = q.minimo ?? 0;
    return x.caracteres_objetivo > q.caracteres || x.caracteres_objetivo < suelo
      ? [
          `La extensión objetivo del apartado ${i + 1} (${MILES.format(x.caracteres_objetivo)}) debe ir de ${MILES.format(suelo)} a ${MILES.format(q.caracteres)} caracteres.`,
        ]
      : [];
  });
  const cabe = (mem.limite_paginas - PAGINAS_FUERA - paginasDeGuia(mem)) * CARACTERES_POR_PAGINA;
  const suma = e.estructura.reduce((s, x) => s + x.caracteres_objetivo, 0);
  if (suma > cabe)
    out.push(
      `Las extensiones suman ${MILES.format(suma)} caracteres y en ${mem.limite_paginas} páginas caben unos ${MILES.format(cabe)} (sin portada, índice ni tabla guía): recórtalas.`,
    );
  return out;
}

function problemasDeHechos(e: EstrategiaDatosData, c: ContextoEstrategia): ProblemasEstrategia {
  const repetidas = [...new Set(e.hechos.map((h) => h.clave).filter((k, i, xs) => xs.indexOf(k) !== i))];
  const fugas = e.hechos.flatMap((h) =>
    detectarFugas(`${h.sobre}: ${h.valor}.`, c.fugas).map(
      (f) =>
        `El hecho «${h.clave}» delata «${f.marca}» («${f.criterio}», que va en «${f.archivo}»): un hecho se copia en todos los apartados; quítalo.`,
    ),
  );
  const nombres = c.porRoles
    ? e.hechos.flatMap((h) =>
        nombresDelEquipoEn(`${h.sobre} ${h.valor}`, c.equipo).map(
          () =>
            `El hecho «${h.clave}» nombra a una persona del equipo y el pliego pide el equipo por roles, sin nombres: escribe solo el rol.`,
        ),
      )
    : [];
  const conocidas = c.herramientas.map(comparable);
  const avisos = e.hechos
    .filter(
      (h) =>
        h.categoria === 'herramienta' &&
        !conocidas.some((x) => comparable(h.valor).includes(x) || x.includes(comparable(h.valor))),
    )
    .map((h) => `La herramienta «${h.valor}» (hecho «${h.clave}») no está en las decisiones de la oferta.`);
  return {
    duros: [...fugas, ...nombres],
    blandos: [
      ...repetidas.map((k) => `La clave de hecho «${k}» está repetida: cada hecho, una clave.`),
      ...rolesSinSigla(e),
      ...compromisosSinHecho(e, c),
    ],
    avisos,
  };
}

// Un rol largo copiado entero en cada mención llenaba la memoria de la misma etiqueta: se
// presenta entero una vez y después se cita por su sigla.
const ROL_LARGO = 40;
function rolesSinSigla(e: EstrategiaDatosData): string[] {
  return e.hechos
    .filter((h) => h.categoria === 'rol' && h.valor.length > ROL_LARGO && !h.corto)
    .map(
      (h) =>
        `El rol del hecho «${h.clave}» («${h.valor}») pasa de ${ROL_LARGO} caracteres: dale una sigla en «corto» (la de «alias_roles»); la memoria lo presenta entero una vez y después lo cita por ella.`,
    );
}

// La hoja de hechos es lo que todos los apartados copian: un compromiso que se acredita en esta
// memoria y no está en ella acaba sin declarar (y sin sus puntos de fórmula).
function compromisosSinHecho(e: EstrategiaDatosData, c: ContextoEstrategia): string[] {
  const dichas = new Set(
    cifrasConUnidad(e.hechos.map((h) => `${h.valor}${h.unidad ? ` ${h.unidad}` : ''}`).join(' | ')),
  );
  return (c.compromisos ?? [])
    .filter((x) => x.cifras.length && !x.cifras.every((y) => dichas.has(y)))
    .map(
      (x) =>
        `«${x.criterio}» se acredita en esta memoria (${valorDeCompromiso(x)}): falta en la hoja de hechos con su valor exacto, para que la memoria lo declare.`,
    );
}

// ── Prudencia: lo que aplaza en vez de decidir ──

// Por apartado que puntúa, al menos estas cifras o indicadores: sin ellos el apartado se escribe
// en abstracto, y el pliego pide «cifras y límites concretos» para el tramo más alto.
const MIN_CUANTITATIVOS = 2;
const CUANTITATIVAS: readonly HechoData['categoria'][] = ['cifra', 'indicador', 'plazo', 'horario', 'calendario'];
const FECHA_ABSOLUTA = /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} de [a-z]+ de \d{4}\b/;

function textosConOrigen(e: EstrategiaDatosData): { donde: string; texto: string }[] {
  return [
    ...e.hechos.map((h) => ({ donde: `hecho «${h.clave}»`, texto: `${h.sobre}: ${h.valor}` })),
    ...e.reglas.map((r) => ({ donde: 'regla de oro', texto: r })),
    ...e.frontera.map((f) => ({ donde: 'frontera', texto: `${f.no_decir}. ${f.motivo}` })),
    ...e.estructura.flatMap((x) =>
      x.secciones.map((s) => ({ donde: `sección «${s.titulo}» del apartado ${x.apartado}`, texto: s.contenido })),
    ),
    ...e.mapa.map((m) => ({ donde: `mapa del apartado ${m.apartado}`, texto: m.evidencia })),
    ...textosDeSolucion(e.solucion).map((t) => ({ donde: 'solución', texto: t })),
  ];
}

function aplazamientosDeEstrategia(e: EstrategiaDatosData): string[] {
  const exentos = e.solucion.pendientes_legitimos.map((p) => p.parametro);
  return textosConOrigen(e).flatMap(({ donde, texto }) =>
    aplazamientosEn(texto, exentos).map(
      (f) =>
        `Aplaza un valor de diseño en vez de fijarlo (${donde}): «${f}». Escribe el valor como hecho («La solución usa…», «El servicio se presta de 9:00 a 18:00 h») o, si el pliego lo reserva expresamente al órgano, llévalo a «pendientes_legitimos» con su cita y nuestra propuesta por defecto.`,
    ),
  );
}

// Lo que la estrategia deja «ratificado en el acta» lo copian todos los apartados: la fórmula
// sale de aquí. Solo la llevan los pendientes legítimos (exentos). La frontera es lo que no se
// dice: nombrar ahí la fórmula es justo prohibirla.
function ratificacionesDeEstrategia(e: EstrategiaDatosData): string[] {
  const exentos = e.solucion.pendientes_legitimos.map((p) => p.parametro);
  return textosConOrigen(e)
    .filter((x) => x.donde !== 'frontera')
    .flatMap(({ donde, texto }) =>
      ratificacionesEn(texto, exentos).map(
        (f) =>
          `Deja lo decidido a una ratificación del órgano (${donde}): «${f}». Escríbelo como hecho («La solución usa…», «El servicio se presta…»); la ratificación es solo para lo que el pliego reserva al órgano («pendientes_legitimos», con su cita).`,
      ),
    );
}

// Un hecho de calendario sin día puede ser una fecha («noviembre de 2026»), una cadencia («comité
// cada 15 días») o una duración («12 semanas»): no se le pide fecha. Sí a lo relativo («semana 6»,
// «T0»), que es justo lo que el pliego puntúa como concreción posterior.
const MES_Y_ANO =
  /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de)? \d{4}\b/;
const CADENCIA =
  /\b(?:cada|semanal(?:es|mente)?|quincenal(?:es|mente)?|mensual(?:es|mente)?|bimestral(?:es)?|trimestral(?:es|mente)?|semestral(?:es)?|anual(?:es|mente)?|diari[oa]s?|diariamente|duracion|durante)\b|\b\d+ (?:dias|semanas|meses|anos)\b/;
const RELATIVO = /\b(?:semana|mes|dia|sprint|fase|hito) \d+\b|\bt ?0\b|\bt ?\+ ?\d+\b/;

function pideFecha(h: HechoData): boolean {
  const t = textoComparable(`${h.valor} ${h.unidad ?? ''}`);
  if (FECHA_ABSOLUTA.test(t) || MES_Y_ANO.test(t)) return false;
  return RELATIVO.test(t) || !CADENCIA.test(t);
}

function problemasDeFechas(e: EstrategiaDatosData, inicio: string | null | undefined): string[] {
  if (!inicio) return [];
  const sinFecha = e.hechos.filter((h) => h.categoria === 'calendario' && pideFecha(h));
  return [
    ...(e.solucion.calendario.inicio < inicio
      ? [
          `El calendario de la solución empieza el ${e.solucion.calendario.inicio}, antes del inicio previsto del dossier (${inicio}): fecha desde ese inicio.`,
        ]
      : []),
    ...sinFecha.map(
      (h) =>
        `El hecho de calendario «${h.clave}» no lleva fecha («${h.valor}»): el dossier da el inicio previsto (${inicio}); escribe la fecha absoluta.`,
    ),
  ];
}

function problemasDeCifras(e: EstrategiaDatosData, mem: MemoriaDelGuion): string[] {
  if (!memoriaValorable(mem)) return [];
  return mem.apartados.flatMap((a, i) => {
    const n = i + 1;
    const hechos = e.hechos.filter((h) => CUANTITATIVAS.includes(h.categoria) && h.apartados?.includes(n)).length;
    const evidencias = e.mapa.filter((m) => m.apartado === n && /\d/.test(m.evidencia)).length;
    return hechos + evidencias < MIN_CUANTITATIVOS
      ? [
          `El apartado ${n} «${a.titulo}» no lleva al menos ${MIN_CUANTITATIVOS} cifras o indicadores (tiene ${hechos + evidencias}): añade hechos de cifra o indicador con «apartados» que lo incluyan, o evidencias con su número en el «mapa».`,
        ]
      : [];
  });
}

/** Lo que aplaza en vez de decidir: aplazamientos sin cifra, ratificaciones posteriores, calendario sin fechas habiendo inicio y apartados sin cifras. */
export function problemasDePrudencia(e: EstrategiaDatosData, c: Pick<ContextoEstrategia, 'mem' | 'inicio'>): string[] {
  return [
    ...aplazamientosDeEstrategia(e),
    ...ratificacionesDeEstrategia(e),
    ...problemasDeFechas(e, c.inicio),
    ...problemasDeCifras(e, c.mem),
  ];
}

// Modelos y servicios con su versión: donde la estrategia los fija (la solución y los hechos de
// herramienta) y de donde los copia la memoria. Los hechos «otro» llevan hitos y fechas que no
// son versiones.
function textosDeVersiones(e: EstrategiaDatosData): { donde: string; texto: string }[] {
  return [
    ...e.solucion.modelos.map((m) => ({ donde: `modelo «${m.uso}»`, texto: `${m.modelo} | ${m.alternativa}` })),
    ...e.solucion.arquitectura.map((a) => ({ donde: `capa «${a.capa}»`, texto: a.servicio })),
    ...e.hechos
      .filter((h) => h.categoria === 'herramienta')
      .map((h) => ({ donde: `hecho «${h.clave}»`, texto: h.valor })),
  ];
}

/** Versiones fechadas de más de 12 meses antes del inicio previsto que el pliego no cita. */
export function problemasDeVigencia(
  e: EstrategiaDatosData,
  c: Pick<ContextoEstrategia, 'inicio' | 'fuentes'>,
): string[] {
  const inicio = c.inicio ?? e.solucion.calendario.inicio;
  return textosDeVersiones(e).flatMap(({ donde, texto }) =>
    versionesAnticuadas(texto, inicio, c.fuentes ?? '').map(
      (v) =>
        `Versión anticuada (${donde}): «${texto}» fija una versión del ${v.fecha}, más de ${MESES_VIGENCIA} meses antes del inicio previsto (${inicio}). ${MODELOS_VIGENTES}`,
    ),
  );
}

/** Lo que impide aceptar una estrategia: duros (fugas, nombres con equipo por roles) siempre; blandos, hasta el tercer envío. */
export function problemasDeEstrategia(e: EstrategiaDatosData, c: ContextoEstrategia): ProblemasEstrategia {
  const hechos = problemasDeHechos(e, c);
  const solucion = problemasDeSolucion(e.solucion, {
    fugas: c.fugas,
    fuentes: c.fuentes,
    recortado: c.recortado,
    normativa: c.normativa,
    normativaTexto: c.normativaTexto,
  });
  return {
    duros: [...hechos.duros, ...solucion.duros],
    blandos: [
      ...problemasDeEstructura(e, c.mem),
      ...problemasDeMapa(e, c.mem),
      ...problemasDeExtension(e, c.mem),
      ...hechos.blandos,
      ...solucion.blandos,
      ...problemasDePrudencia(e, c),
      ...problemasDeVigencia(e, c),
    ],
    avisos: [...hechos.avisos, ...solucion.avisos],
  };
}

// ── Recepción y guardado ──

function memoriaDeLaEstrategia(db: Db, e: EstrategiaEntradaData): Result<{ m: FilaMemoria; guion: GuionGuardado }> {
  const m = filaMemoria(db, e.memoria_id);
  if (!m || m.licitacion_id !== e.id)
    return fail('not_found', `No hay ninguna memoria con id ${e.memoria_id} en la licitación «${e.id}».`);
  if (m.version !== e.version)
    return fail('invalid_input', `Esa memoria es la v${m.version}; envía los números que te dio la tarea.`);
  if (m.estado !== 'redactando' || m.fase !== 'estrategia')
    return fail('invalid_input', 'Esa memoria no espera estrategia (o ya pasó de esa fase).');
  const guion = guionPorId(db, m.guion_id);
  return guion?.datos.memoria ? ok({ m, guion }) : fail('not_found', 'El guion de esta memoria ya no está.');
}

/** El contexto con que se revisa la estrategia de una memoria. */
function contextoEstrategia(db: Db, dbNucleo: DbNucleo, m: FilaMemoria, guion: GuionGuardado): ContextoEstrategia {
  const todas = decisionesDe(db, m.licitacion_id)?.datos;
  const d = todas ? decisionesDelLote(todas, m.lote ?? null) : null;
  const dossier = dossierDe(db, m.id);
  const normativa = dossier?.secciones.find((s) => s.clave === 'normativa_cliente')?.texto ?? '';
  return {
    mem: guion.datos.memoria!,
    fugas: contextoFugasDe(db, guion),
    porRoles: dossier?.equipo_por_roles ?? false,
    // Los pliegos enteros además del dossier: la cita de un pendiente puede caer en lo que el tope recortó.
    fuentes: dossier
      ? [...dossier.secciones.map((s) => s.texto), textoDePliegos(db, m.licitacion_id)].join('\n')
      : undefined,
    recortado: dossier?.secciones.some((s) => s.truncado) ?? false,
    normativa: normativaCitable(normativa),
    normativaTexto: normativa,
    inicio: inicioDelDossier(dossier?.secciones.find((s) => s.clave === 'identificacion')?.texto ?? ''),
    equipo: d ? equipoParaRedactar(dbNucleo, d).map((p) => p.nombre) : [],
    herramientas: d?.herramientas ?? [],
    compromisos: compromisosDeLaMemoria(guion.datos, d?.automaticos ?? []),
  };
}

function trabajoEnMarcha(db: Db, memoriaId: number): number | null {
  const t = db
    .prepare(
      `SELECT id FROM nucleo.trabajos_ia WHERE tipo = ? AND estado = 'lanzado' AND json_extract(payload, '$.memoria_id') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(TIPO_MEMORIA_ESTRATEGIA, memoriaId) as { id: number } | undefined;
  return t?.id ?? null;
}

export type EstrategiaRecibida = {
  memoria: number;
  version: number;
  hechos: number;
  avisos: string[];
  ruta_md: string | null;
};
export type OpcionesEstrategia = { revisar?: boolean; hoy?: Date; raices?: Raices };

function guardar(
  db: Db,
  m: FilaMemoria,
  datos: EstrategiaDatosData,
  r: { avisos: string[]; agente: string; raices: Raices },
): string | null {
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(m.licitacion_id) as {
    id: string;
    expediente: string;
  };
  const ruta = escribirEnSalidas(
    r.raices,
    l,
    baseDeArtefacto(m.version, m.ensayo === 1, 'estrategia'),
    estrategiaEnMarkdown(datos, m.version),
  );
  db.prepare(
    `INSERT INTO memoria_estrategias (memoria_id, datos, avisos, agente, trabajo_id, ruta_md, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memoria_id) DO UPDATE SET datos = excluded.datos, avisos = excluded.avisos, agente = excluded.agente, trabajo_id = excluded.trabajo_id, ruta_md = excluded.ruta_md, creada_en = excluded.creada_en`,
  ).run(
    m.id,
    JSON.stringify(datos),
    JSON.stringify(r.avisos),
    r.agente,
    trabajoEnMarcha(db, m.id),
    ruta.data,
    new Date().toISOString(),
  );
  return ruta.data;
}

/**
 * Revisa y guarda la estrategia de una memoria. Con `revisar` (la tool) rechaza lo blando
 * con frases exactas hasta el tercer envío; una fuga o un nombre con el equipo por roles, siempre.
 */
export function recibirEstrategia(
  db: Db,
  dbNucleo: DbNucleo,
  e: EstrategiaEntradaData,
  agente: string,
  op: OpcionesEstrategia = {},
): Result<EstrategiaRecibida> {
  const destino = memoriaDeLaEstrategia(db, e);
  if (destino.error) return destino;
  const { id: _id, memoria_id: _m, version: _v, ...datos } = e;
  const p = problemasDeEstrategia(datos, contextoEstrategia(db, dbNucleo, destino.data.m, destino.data.guion));
  const exigir =
    op.revisar === true && exigirRevision(db, 'licitaciones_memoria_estrategia', recursoEstrategia(e), op.hoy);
  if (p.duros.length || (exigir && p.blandos.length))
    return fail(
      'invalid_input',
      `${[...p.duros, ...p.blandos].join(' ')} Corrige y vuelve a enviar la estrategia entera.`,
    );
  const avisos = [...(exigir ? [] : p.blandos), ...p.avisos];
  const ruta = guardar(db, destino.data.m, datos, { avisos, agente, raices: op.raices ?? raicesActuales() });
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { accion: 'estrategia', version: e.version, memoria: e.memoria_id },
  });
  return ok({ memoria: e.memoria_id, version: e.version, hechos: datos.hechos.length, avisos, ruta_md: ruta });
}

export type EstrategiaGuardada = {
  datos: EstrategiaLeidaData;
  avisos: string[];
  agente: string;
  ruta_md: string | null;
  creada_en: string;
};

/** La extensión objetivo del apartado `n` en la estrategia de una memoria (null sin estrategia). */
export function objetivoDeApartado(db: Db, m: Pick<FilaMemoria, 'id'>, n: number): number | null {
  return estrategiaDe(db, m.id)?.datos.estructura.find((x) => x.apartado === n)?.caracteres_objetivo ?? null;
}

// Los compromisos guardados con «origen», «añadido» o euros se leen con el vocabulario de ahora.
const datosNormalizados = (d: { solucion?: unknown }) =>
  d.solucion ? { ...d, solucion: solucionNormalizada(d.solucion) } : d;

/** La estrategia guardada de una memoria (null si no hay o ya no valida). */
export function estrategiaDe(db: Db, memoriaId: number): EstrategiaGuardada | null {
  const f = db
    .prepare('SELECT datos, avisos, agente, ruta_md, creada_en FROM memoria_estrategias WHERE memoria_id = ?')
    .get(memoriaId) as
    { datos: string; avisos: string; agente: string; ruta_md: string | null; creada_en: string } | undefined;
  const d = f ? EstrategiaGuardadaDatos.safeParse(datosNormalizados(JSON.parse(f.datos))) : null;
  return f && d?.success
    ? {
        datos: d.data,
        avisos: JSON.parse(f.avisos) as string[],
        agente: f.agente,
        ruta_md: f.ruta_md,
        creada_en: f.creada_en,
      }
    : null;
}

/** «hecho» del trabajo: la estrategia de esa memoria llegó después de pedirla (o la memoria ya no la espera). */
export function estrategiaRecibida(db: Db, p: PayloadEstrategiaData): boolean {
  const m = filaMemoria(db, p.memoria_id);
  if (!m || m.estado !== 'redactando' || m.fase !== 'estrategia') return true;
  const e = estrategiaDe(db, p.memoria_id);
  return e !== null && e.creada_en >= p.pedida_en;
}

// ── Markdown e instrucciones ──

const fila = (xs: string[]) => `| ${xs.map((x) => x.replace(/\|/g, '/').replace(/\n+/g, ' ')).join(' | ')} |`;

/** La estrategia para leerla en Salidas: reglas, temas, audiencia, estructura, mapa, hechos y frontera. */
export function estrategiaEnMarkdown(e: EstrategiaLeidaData, version: number): string {
  return [
    `# Estrategia de la memoria v${version}`,
    '',
    '## Reglas de oro',
    ...e.reglas.map((r) => `- ${r}`),
    '',
    '## Temas ganadores',
    ...e.temas.map(
      (t) =>
        `- **${t.titulo}** (apartados ${t.apartados.join(', ')}): ${t.mensaje} Puntúa porque ${t.por_que_puntua} Prueba: ${t.prueba}`,
    ),
    '',
    '## Audiencia',
    `${e.audiencia.destinatarios}. Nivel: ${e.audiencia.nivel}.`,
    ...e.audiencia.ejemplos_del_contexto.map((x) => `- Ejemplo: ${x}`),
    ...e.audiencia.evitar.map((x) => `- Evitar: ${x}`),
    '',
    '## Estructura',
    ...e.estructura.flatMap((x) => [
      `### ${x.apartado}. ${x.titulo} (≈ ${MILES.format(x.caracteres_objetivo)} caracteres)`,
      ...x.secciones.map(
        (s) => `- ${s.titulo}: ${s.contenido}${s.elementos.length ? ` [${s.elementos.join(', ')}]` : ''}`,
      ),
    ]),
    '',
    '## Criterio → sección',
    fila(['Apartado', 'Se valorará', 'Sección', 'Evidencia']),
    fila(['---', '---', '---', '---']),
    ...e.mapa.map((m) => fila([String(m.apartado), m.item, m.seccion, m.evidencia])),
    '',
    '## Hoja de hechos',
    fila(['Clave', 'Categoría', 'Sobre', 'Valor']),
    fila(['---', '---', '---', '---']),
    ...e.hechos.map((h) =>
      fila([
        h.clave,
        h.categoria,
        h.sobre,
        `${h.valor}${h.unidad ? ` ${h.unidad}` : ''}${h.corto ? ` (sigla ${h.corto})` : ''}`,
      ]),
    ),
    '',
    '## Frontera',
    ...e.frontera.map((f) => `- ${f.no_decir}: ${f.motivo}`),
    ...(e.solucion ? ['', ...solucionEnMarkdown(e.solucion)] : []),
    '',
  ].join('\n');
}

// Hermes sí decide (fijó pasos, segundos y llamadas) cuando una regla se lo pide; sin ella
// convertía «no consta en el dossier» en «se aprobará después», y el pliego puntúa eso como
// «carencias de detalle que requerirán concreción posterior». Las cautelas de la frontera solo
// prohíben lo que excluye o falsea, no fijar un valor de diseño.
export const DECISIONES_DE_DISENO =
  'DECISIONES DE DISEÑO. Somos el implantador y decidimos. Fija un valor concreto para cada parámetro que el pliego deja al licitador: región y servicios de nube, modelo y versión, límites de ejecución, presupuesto de tokens y latencia p95, umbrales de calidad (recuperación, citas, abstención), tamaño y composición del banco de pruebas, horario de soporte y tiempos de respuesta por prioridad, dedicación por rol y fechas de calendario desde el inicio previsto (con los festivos descontados). Lo decidido se escribe como hecho, en presente o futuro de compromiso: «La solución usa X en la región Y», «El servicio se presta de 9:00 a 18:00 h»; nunca «proponemos X; el órgano lo ratifica en el acta» (repetida, la mesa la lee como aplazamiento). «Se ratifica en…» o «se valida en…» solo para lo que el pliego reserva expresamente al órgano («pendientes_legitimos») y como mucho una vez por apartado. Prohibido dejar un parámetro «a acordar», «sujeto a validación», «pendiente de aprobación» o relativo a T0 sin su valor: el pliego puntúa eso como «carencias de detalle que requerirán concreción posterior» (tramo Aceptable). Solo queda abierto lo que el pliego reserva expresamente al órgano («pendientes_legitimos», con su cita), y aun así con nuestra propuesta por defecto. Las reglas y la frontera solo prohíben lo que excluye o falsea: importes, criterios automáticos acreditados en otro archivo, nombres si el equipo va por roles, acreditaciones, certificaciones, licencias, accesos concedidos y contenido de normas que no está en el dossier. «No consta en el dossier» no es motivo para no fijar un valor de diseño.';

// Un modelo con versión fechada de año y medio antes del contrato se lee como una
// oferta vieja. La estrategia y la redacción la llevan.
export const MODELOS_VIGENTES = `Modelos y servicios: elige familias y versiones vigentes a la fecha del pliego; no fijes una versión fechada de más de ${MESES_VIGENCIA} meses antes del inicio previsto salvo que el pliego la cite; si no consta una versión vigente, nombra la familia y el nivel con el criterio de sustitución («la versión estable vigente al inicio de la familia X, nivel Y; se sustituye por la siguiente estable tras la regresión del banco de pruebas»).`;

// La memoria local ganó el diseño funcional con un catálogo de reglas del cliente (cada una con su
// norma y apartado); la memoria, sin él, citaba la normativa en abstracto.
export const CATALOGO_NORMATIVO =
  'Catálogo normativo («catalogo_normativo» de la solución): si la sección «normativa_cliente» del dossier trae pasajes de normas del cliente (no solo el índice o el contrato), una fila por cada regla que aplica la solución: id (R01, R02…), la regla operativa (qué comprueba o impone), la norma con su código y apartado tal como salen en el dossier, la cita literal del pasaje del dossier que la sostiene (se comprueba contra él: de un pasaje de esa misma norma, nunca del pliego, y con el apartado que sale en el pasaje) y dónde se aplica en la solución (pantalla, paso del flujo o control). La memoria lo presenta como tabla en el apartado del diseño funcional. Sin normativa del cliente, vacío.';

// Un juez vio indicadores medidos con expedientes reales mientras el calendario tenía la
// producción cerrada hasta la aceptación: cada umbral dice dónde y con qué datos se mide.
const MEDICION_DE_KPI =
  'Medición: cada umbral e indicador dice en qué entorno (desarrollo, preproducción o producción) y con qué datos (sintéticos, una muestra anonimizada o expedientes reales) se mide, en «banco» y «cuando», y es coherente con el calendario: nada se mide con datos reales en un entorno o en una fecha en que el calendario aún no los permite.';

function lineasExtension(mem: MemoriaDelGuion): string[] {
  if (mem.limite_paginas === null) {
    return [
      `- El pliego no fija límite de páginas: extensión proporcionada a los puntos, sin relleno, y como mucho ${MILES.format(TECHO_POR_PUNTO)} caracteres por cada «se valorará» (es un techo, no una meta):`,
      ...mem.apartados.map(
        (a, i) => `- Apartado ${i + 1} «${a.titulo}»: hasta ${MILES.format(techoDe(a))} caracteres.`,
      ),
      '- La redacción no podrá pasar de la extensión objetivo de cada apartado más un 15 %.',
    ];
  }
  const cabe = (mem.limite_paginas - PAGINAS_FUERA - paginasDeGuia(mem)) * CARACTERES_POR_PAGINA;
  return [
    ...cuotasDe(mem).map(
      (q, i) =>
        `- Apartado ${i + 1} «${mem.apartados[i]!.titulo}»: entre ${MILES.format(q?.minimo ?? 0)} y ${MILES.format(q?.caracteres ?? 0)} caracteres (${q?.reparto ?? ''}).`,
    ),
    `- La suma no puede pasar de ${MILES.format(cabe)} caracteres (${mem.limite_paginas} páginas sin portada, índice ni tabla guía).`,
  ];
}

// La estrategia decía «una persona revisa los parámetros antes de redactar» y la redacción lo leía
// como una regla que la bloqueaba (y en un ensayo no hay ficha): la estrategia solo planifica; el
// estado de la revisión se lo dice la plataforma a la redacción.
function revisionDeLaSolucion(ensayo: boolean): string {
  const quien = ensayo
    ? 'Es una memoria de ENSAYO: nadie revisa la solución; se redacta con lo que propongas.'
    : 'Una persona puede revisar la solución en la ficha antes de redactar; si no lo hace a tiempo, se redacta con lo propuesto y queda marcado.';
  return `${quien} No escribas en las reglas, la frontera ni los pendientes que la redacción queda bloqueada o espera una revisión humana. Lo que el dossier no acredita (experiencia, certificaciones) va a la frontera como «no afirmar», con «sin acreditar» en el motivo (la plataforma se lo avisa a la persona), y no entra en la hoja de hechos; nunca como bloqueo de la redacción. Un criterio al que nos acogemos y que se acredita EN ESTA MEMORIA no va a la frontera: se declara.`;
}

/** Instrucciones del run que piensa la estrategia de la memoria (no la redacta). */
export function instruccionesEstrategia(db: Db, p: PayloadEstrategiaData): string {
  const l = db.prepare('SELECT titulo, organo_nombre, expediente FROM licitaciones WHERE id = ?').get(p.id) as
    { titulo: string; organo_nombre: string; expediente: string } | undefined;
  const m = filaMemoria(db, p.memoria_id);
  const mem = m ? guionPorId(db, m.guion_id)?.datos.memoria : null;
  const cabecera = `Tarea de la plataforma de ${nombreEmpresa(db)}: piensa la estrategia de la memoria técnica (versión ${p.version}) de la oferta a la licitación ${p.id} — ${l?.titulo ?? ''}, ${l?.organo_nombre ?? ''}, expediente ${l?.expediente ?? ''}. No redactes la memoria: solo el plan con que otra tarea la escribirá entera. Sigue la skill «licitaciones» (sección «Estrategia de la memoria»).`;
  if (!m || !mem) return [cabecera, '', 'Esta memoria ya no está: no hagas nada y termina.'].join('\n');
  const porRoles = dossierDe(db, m.id)?.equipo_por_roles ?? false;
  return [
    cabecera,
    '',
    // El pliego pide una memoria por lote (memoriaLote.ts): si no, prometería lo de otros lotes.
    ...(m.lote ? [`Esta memoria es solo del lote ${m.lote}: temas, hechos y equipo de ese lote.`, ''] : []),
    `1. Lee el dossier entero con licitaciones_dossier (id=${p.id}, memoria_id=${p.memoria_id}): primero el índice y después cada sección, sin saltarte ninguna (${CLAVES_DOSSIER.join(', ')}). Si una sección está recortada, lee lo que falta donde dice. Las aclaraciones mandan sobre el pliego; el inicio previsto, la duración y los festivos de «identificacion» fechan el calendario.`,
    '2. Piensa la oferta como el mejor competidor posible: reglas de oro (≤ 15), 3 a 6 temas ganadores (mensaje, por qué puntúa según la rúbrica, la prueba concreta que lo demuestra y en qué apartados va), audiencia (destinatarios, nivel, ejemplos de su día a día y lo que hay que evitar), la estructura (un elemento por apartado del guion, en orden, con su título literal, la extensión objetivo y sus secciones con contenido y elementos: tabla, figura, lista, cronograma o riesgos), el mapa (cada «se valorará» de cada apartado → la sección que lo trata → la evidencia, en una frase legible con espacios: sale tal cual en la tabla guía del documento) y la frontera.',
    '3. Lo que separa un Excelente de un Bueno: lo específico de este cliente (su normativa interna, sus aclaraciones, sus sistemas), cifras y límites concretos, planificación con fechas, registro de riesgos con medidas, figuras que muestran (arquitectura, flujo, calendario) y una memoria sin contradicciones internas.',
    `3a. ${DECISIONES_DE_DISENO}`,
    '4. Extensión objetivo de cada apartado (la plataforma rechaza lo que se salga):',
    ...lineasExtension(mem),
    `5. Hoja de hechos: cada horario, plazo, rol, indicador, cifra, herramienta y fecha que vaya a salir en más de un apartado, con su valor exacto y de 1 a 5 palabras ancla. Es el contrato: todos los apartados la copiarán tal cual. Nada de lo que va en otros archivos (criterios automáticos que se acreditan en otro archivo, oferta económica) ni importes: un hecho que delate un criterio automático acreditado en otro archivo se rechaza siempre. Un criterio automático al que nos acogemos y que se acredita en esta misma memoria (sección «frontera»: «EN ESTA MEMORIA») sí es un hecho, con su valor exacto y sin importes. Di en «apartados» dónde sale cada hecho: cada apartado que puntúa lleva al menos ${MIN_CUANTITATIVOS} cifras o indicadores (hechos o evidencias del mapa con su número). Las fechas, absolutas.${porRoles ? ' El pliego pide el equipo por roles, sin nombres: los hechos de rol nombran el rol, nunca a la persona.' : ''} Cada hecho de rol lleva en «corto» su sigla (obligatoria si el rol pasa de ${ROL_LARGO} caracteres).`,
    '6. Solución («solucion»): el calendario con fechas reales desde el inicio previsto (semanas con fechas, trabajo, sigla del rol, entregable y puerta; festivos y regla de desplazamiento), la arquitectura por capa (servicio, tier, región, motivo, control y alternativa; vacía si no hay sistemas), los modelos (uso, familia y versión, alternativa), los umbrales de calidad (métrica, fórmula, umbral, con qué y cuándo se miden), el banco de pruebas (casos, estratos, tamaño y de dónde sale), la formación y el soporte solo si los pide el pliego o se acreditan en esta memoria, de 3 a 15 riesgos con dueño, la sigla y la dedicación de cada rol, un caso distinto por apartado y, como mucho, 5 pendientes que el pliego reserva al órgano, cada uno con su cita literal y nuestra propuesta por defecto.',
    `6a. ${revisionDeLaSolucion(m.ensayo === 1)}`,
    `6b. ${MODELOS_VIGENTES}`,
    `6c. ${CATALOGO_NORMATIVO}`,
    `6d. ${MEDICION_DE_KPI}`,
    `6e. ${COMPROMISOS_BARATOS}`,
    `7. Envía licitaciones_memoria_estrategia con id=${p.id}, memoria_id=${p.memoria_id}, version=${p.version}. Si responde con un error, corrige exactamente lo que dice y reenvía la estrategia entera.`,
    'No hagas nada más: no redactes la memoria, no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}
