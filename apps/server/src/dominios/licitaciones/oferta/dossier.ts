// Dossier de la memoria (docs/como-esta-hecho/memoria-tecnica.md, paso 1): todo lo necesario para escribirla, compuesto sin IA.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { leerPerfilEmpresa, perfilParaAgentes, zonaEmpresa } from '../../../nucleo/empresa.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, leerDocumento, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { abrirIndiceLectura } from '../../../biblioteca/motor/documentos/servicioIndice.js';
import * as indice from '../../../biblioteca/motor/documentos/almacen.js';
import { registrarDocumentosDeCarpeta, type DocumentoCarpeta } from '../documentosCarpeta.js';
import { fichasDe } from '../ficha.js';
import { carpetaPliegos } from '../pliegos.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import { leccionesParaApartado } from '../propuestas/aprendizaje.js';
import { aprendizajesParecidos, propuestasParecidas } from '../propuestas/parecidas.js';
import type { Db } from '../store.js';
import { obtenerLicitacion } from '../store.js';
import { marcasDe, TEMAS_MEMORIA, textoComparable, type Tema } from '../temas.js';
import { calendarioPrevisto, lineasCalendario, type FuentesCalendario } from './calendario.js';
import { compromisosDeLaMemoria, valorDeCompromiso } from './compromisosMemoria.js';
import {
  CAUTELAS_ENFOQUE,
  decisionesDe,
  equipoParaRedactar,
  textoAIncorporar,
  textoHerramientas,
  tieneCautelas,
  type DecisionesData,
} from './decisiones.js';
import { lineasNoPrometer, noPrometerDe } from './enfoque.js';
import { filaMemoria, lotesDePortada, memoriaDeEnsayo, pideFirmaFinal } from './ensamblado.js';
import { contextoFugasDe } from './fugasMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { memoriaValorable, puntosTexto } from './guionRevision.js';
import { leccionesParaRedactar } from './leccionesAplicadas.js';
import { decisionesDelLote } from './memoriaLote.js';
import { sinCitasInternas } from './memoriaRevision.js';
import { seccionAclaraciones, seccionCuadroResumen, seccionNormativa } from './dossierCarpeta.js';
import { podarAnexos } from './dossierPoda.js';
import { aliasDeRoles, funcionesDelRol } from './equipoDossier.js';
import { comoLeer, paginasDe, recortar, textoPaginas, tramosDePaginas, type Parte } from './dossierTexto.js';
import { textoPlazo } from './plazo.js';

// Reúne en un solo contexto el pliego técnico entero, los criterios literales con sus páginas, el formato, la
// frontera con los otros sobres, la empresa, el equipo, las herramientas, las lecciones y las memorias
// parecidas; y de la carpeta de la licitación, las aclaraciones, el cuadro resumen y la normativa del cliente
// (dossierCarpeta.ts). Cada sección tiene un tope y, si se recorta, dice cómo seguir leyendo: nada se pierde en
// silencio. Se guarda en la base y, sin la sección del equipo (datos del CV, que solo salen hacia Hermes), en
// Salidas.
export const CLAVES_DOSSIER = [
  'identificacion',
  'pliego_tecnico',
  'aclaraciones',
  'cuadro_resumen',
  'criterios',
  'formato',
  'normativa_cliente',
  'frontera',
  'empresa',
  'equipo',
  'herramientas',
  'lecciones',
  'parecidas',
] as const;
export type ClaveDossier = (typeof CLAVES_DOSSIER)[number];
// huella: sha256 (16 hex) del texto; '' en un dossier de antes de las huellas (huellasMemoria.ts lo da por cambiado).
export type SeccionDossier = {
  clave: ClaveDossier;
  titulo: string;
  texto: string;
  critico: boolean;
  personal: boolean;
  truncado: boolean;
  huella: string;
};
// equipo_ids: quién va en el equipo de esta memoria (ids, sin nombres), para saber después quién salió.
export type Dossier = {
  memoria_id: number;
  licitacion_id: string;
  version: number;
  secciones: SeccionDossier[];
  caracteres: number;
  equipo_por_roles: boolean;
  equipo_ids: number[];
};

// Tope de cada sección (caracteres), su título y si va al crítico ciego (critico: lo que necesita
// para puntuar: identificación, pliego y sus aclaraciones, cuadro resumen, criterios y formato).
const SECCIONES: Record<ClaveDossier, { titulo: string; tope: number; critico: boolean }> = {
  identificacion: { titulo: 'Identificación', tope: 5_000, critico: true },
  pliego_tecnico: { titulo: 'Pliego técnico', tope: 60_000, critico: true },
  aclaraciones: { titulo: 'Aclaraciones y respuestas a dudas', tope: 40_000, critico: true },
  cuadro_resumen: { titulo: 'Cuadro resumen del PCAP', tope: 12_000, critico: true },
  criterios: { titulo: 'Criterios de la memoria (literales)', tope: 25_000, critico: true },
  formato: { titulo: 'Formato', tope: 5_000, critico: true },
  normativa_cliente: { titulo: 'Normativa del cliente y contrato', tope: 15_000, critico: false },
  frontera: { titulo: 'Frontera: lo que la memoria no puede decir', tope: 8_000, critico: false },
  empresa: { titulo: 'Empresa', tope: 6_000, critico: false },
  equipo: { titulo: 'Equipo', tope: 10_000, critico: false },
  herramientas: { titulo: 'Herramientas y enfoque', tope: 4_000, critico: false },
  lecciones: { titulo: 'Lecciones aceptadas', tope: 6_000, critico: false },
  parecidas: { titulo: 'Propuestas parecidas', tope: 20_000, critico: false },
};
const MAX_MEMORIA_PARECIDA = 15_000;
const MAX_PARECIDAS = 3;

type Licitacion = {
  id: string;
  titulo: string;
  organo_nombre: string;
  expediente: string;
  fecha_limite: string | null;
  nuts: string | null;
  datos: string;
};
type MemoriaDelGuion = NonNullable<GuionGuardado['datos']['memoria']>;
type Pliego = { ruta: string; nombre: string; clase: string; etiqueta: string; paginas: Map<number, string> };
type Contexto = {
  dbLic: Db;
  dbNucleo: DbNucleo;
  l: Licitacion;
  guion: GuionGuardado;
  mem: MemoriaDelGuion;
  decisiones: DecisionesData | null;
  pliegos: Pliego[];
  anonimo: boolean;
  topes: Record<ClaveDossier, number>;
  raices: Raices;
  // La Biblioteca y lo registrado de la carpeta de la licitación (aclaraciones, normativa, contrato).
  idx: indice.BaseDatos | null;
  documentos: DocumentoCarpeta[];
  carpeta: string;
  // De ensayo: se mide contra la presentada, así que no lee lo aprendido de ella (lecciones propias).
  ensayo: boolean;
  // De qué lote es la memoria si el pliego pide una por lote (memoriaLote.ts); null = común. Con
  // lote, «decisiones» ya son solo las de ese lote: equipo, automáticos y ofertas.
  lote: string | null;
};

// ── Utilidades ──

export { recortar, tramosDePaginas };

const ETIQUETA_CLASE: Record<string, string> = { ppt: 'PPT', pcap: 'PCAP' };

function pliegosLeidos(dbLic: Db, id: string, idx: indice.BaseDatos | null): Pliego[] {
  if (!idx) return [];
  const filas = dbLic
    .prepare(
      "SELECT ruta, nombre, clase FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL ORDER BY rowid",
    )
    .all(id) as { ruta: string; nombre: string; clase: string }[];
  return filas
    .map((f) => ({ ...f, etiqueta: ETIQUETA_CLASE[f.clase] ?? f.nombre, paginas: paginasDe(idx, f.ruta) }))
    .filter((p) => p.paginas.size > 0);
}

/** El texto entero de los pliegos descargados de una licitación (vacío sin índice): lo que el dossier recorta por topes. */
export function textoDePliegos(dbLic: Db, id: string, idx: indice.BaseDatos | null = abrirIndiceLectura()): string {
  return pliegosLeidos(dbLic, id, idx)
    .map((p) => [...p.paginas.values()].join('\n'))
    .join('\n');
}

// El pliego que el guion cita como «PCAP.pdf» (o con su ruta entera).
function pliegoDeDocumento(pliegos: Pliego[], documento: string | undefined): Pliego | null {
  if (!documento) return null;
  const buscado = textoComparable(path.posix.basename(documento.replace(/\\/g, '/'))).trim();
  return (
    pliegos.find((p) => [p.nombre, path.posix.basename(p.ruta)].some((n) => textoComparable(n).trim() === buscado)) ??
    null
  );
}

// ── Secciones ──

// Una memoria común puede prometer «consultas de ambos lotes» dentro de la de un lote.
function lineaLotes(c: Contexto): string {
  const lotes = lotesDePortada(c.dbLic, c.l.id, c.lote);
  if (c.lote !== null)
    return `- Lote: ${lotes[0]}. Esta memoria es solo de este lote: el pliego pide una memoria por lote; no hables de los demás lotes (van en su propia memoria).`;
  return `- Lotes a los que vamos: ${lotes.length ? lotes.join('; ') : 'el contrato entero'}.`;
}

function seccionIdentificacion(c: Contexto): Parte {
  return {
    truncado: false,
    texto: [
      `- Licitación: ${c.l.titulo} (${c.l.id}).`,
      `- Órgano de contratación: ${c.l.organo_nombre}. Expediente ${c.l.expediente}.`,
      lineaLotes(c),
      `- Plazo de presentación: ${c.l.fecha_limite ? textoPlazo(c.l.fecha_limite, zonaEmpresa(c.dbNucleo)) : 'sin plazo conocido'}.`,
      `- La memoria: «${c.mem.titulo_documento}», en «${c.mem.archivo}»; ${memoriaValorable(c.mem) ? `puntúa ${puntosTexto(c.mem.apartados.reduce((s, a) => s + a.puntos, 0))} puntos` : 'no se puntúa: la mesa comprueba el contenido mínimo'}.`,
      ...lineasCalendario(calendarioPrevisto(fuentesCalendario(c))),
    ].join('\n'),
  };
}

type DatosPublicados = {
  organo?: { ciudad?: string | null };
  periodo?: { inicio?: string | null } | null;
  duracion?: { valor: number; unidad: string } | null;
};

// Lo que fecha el calendario: el PCAP, la ficha aprobada, lo publicado y la sede del órgano.
function fuentesCalendario(c: Contexto): FuentesCalendario {
  let datos: DatosPublicados = {};
  try {
    datos = JSON.parse(c.l.datos) as DatosPublicados;
  } catch {
    /* datos ilegibles: sin periodo ni ciudad */
  }
  return {
    pcaps: c.pliegos.filter((p) => p.clase === 'pcap'),
    hitos: fichasDe(c.dbLic, c.l.id).aprobada?.datos.hitos ?? [],
    periodoInicio: datos.periodo?.inicio ?? null,
    duracionPlacsp: datos.duracion ?? null,
    fechaLimite: c.l.fecha_limite,
    sede: { ciudad: datos.organo?.ciudad ?? null, nombre: c.l.organo_nombre, nuts: c.l.nuts },
  };
}

// Las páginas del guion (±1) y las que hablan de lo que se presta (temas de la memoria), en ese orden.
function prioridadDePaginas(c: Contexto, p: Pliego): number[] {
  const delGuion = new Set(
    c.mem.apartados
      .filter((a) => pliegoDeDocumento([p], a.documento))
      .flatMap((a) => (a.pagina ? [a.pagina - 1, a.pagina, a.pagina + 1] : [])),
  );
  const puntos = (n: number, t: string) =>
    (delGuion.has(n) ? 100 : 0) + TEMAS_MEMORIA.reduce((s, tema) => s + marcasDe(tema as Tema, textoComparable(t)), 0);
  return [...p.paginas.entries()]
    .map(([n, t]) => ({ n, p: puntos(n, t) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.n - b.n)
    .map((x) => x.n);
}

function pliegoTecnicoRecortado(c: Contexto, p: Pliego, tope: number): Parte {
  const elegidas: number[] = [];
  let largo = 0;
  for (const n of prioridadDePaginas(c, p)) {
    const t = textoPaginas(p, [n]).length + 2;
    if (largo + t > tope - 400) continue;
    elegidas.push(n);
    largo += t;
  }
  const fuera = [...p.paginas.keys()].filter((n) => !elegidas.includes(n));
  const cabecera = `El ${p.etiqueta} entero no cabe: van las páginas de los criterios y las que tratan lo que se presta (${tramosDePaginas(elegidas) || 'ninguna'}).`;
  return {
    texto: `${cabecera}\n\n${textoPaginas(
      p,
      elegidas.sort((a, b) => a - b),
    )}\n[recortado: ${comoLeer(p, fuera)}]`,
    truncado: true,
  };
}

function seccionPliegoTecnico(c: Contexto): Parte {
  const ppts = c.pliegos.filter((p) => p.clase === 'ppt');
  if (!ppts.length)
    return {
      texto:
        'No hay pliego técnico (PPT) descargado y legible: lo que se presta está en el PCAP (sección «Criterios») y se busca con licitaciones_pliegos.',
      truncado: false,
    };
  const tope = Math.floor(c.topes.pliego_tecnico / ppts.length);
  // Sin sus anexos informativos (fases futuras, fuera del objeto): una línea con su ruta.
  const partes = ppts
    .map((x) => ({ ...x, ...podarAnexos(x).doc }))
    .map((p) => {
      const entero = textoPaginas(p, [...p.paginas.keys()]);
      return entero.length <= tope ? { texto: entero, truncado: false } : pliegoTecnicoRecortado(c, p, tope);
    });
  return { texto: partes.map((x) => x.texto).join('\n\n'), truncado: partes.some((x) => x.truncado) };
}

function lineasDeApartado(a: MemoriaDelGuion['apartados'][number], n: number, valorable: boolean): string[] {
  const puntos = (i: number) =>
    a.puntos_se_valorara?.[i] !== undefined ? ` (máx. ${puntosTexto(a.puntos_se_valorara[i]!)} puntos)` : '';
  const escala = a.escala.length
    ? a.escala.map((t) => `${puntosTexto(t.puntos)}: ${t.descripcion}`).join(' | ')
    : 'el pliego no la detalla';
  return [
    `### ${n}. ${a.titulo}${valorable ? ` (${puntosTexto(a.puntos)} puntos)` : ''}`,
    `${valorable ? 'Se valorará' : 'Contenido exigido'}${a.documento ? ` (${a.documento}${a.pagina ? ` pág. ${a.pagina}` : ''})` : ''}:`,
    ...a.se_valorara.map((s, i) => `- ${s}${puntos(i)}`),
    ...(valorable ? [`Escala: ${escala}`] : []),
    '',
  ];
}

// Las páginas de cada criterio en el pliego, una vez cada una (los apartados suelen ser seguidos).
function paginasCriterio(c: Contexto): { p: Pliego; ns: number[] }[] {
  const porPliego = new Map<Pliego, number[]>();
  for (const a of c.mem.apartados) {
    const p = pliegoDeDocumento(c.pliegos, a.documento);
    if (p && a.pagina) porPliego.set(p, [...(porPliego.get(p) ?? []), a.pagina, a.pagina + 1]);
  }
  return [...porPliego.entries()].map(([p, ns]) => ({ p, ns: [...new Set(ns)].sort((x, y) => x - y) }));
}

// Una sola copia del texto del pliego: lo que ya va en «Criterios» no se repite en otra sección.
const enCriterios = (c: Contexto, p: { ruta: string }, n: number) =>
  paginasCriterio(c).some((x) => x.p.ruta === p.ruta && x.ns.includes(n));

function paginasDeCriterios(c: Contexto): { texto: string; donde: string } {
  const partes = paginasCriterio(c);
  return {
    texto: partes.map(({ p, ns }) => textoPaginas(p, ns)).join('\n\n'),
    donde: partes.map(({ p, ns }) => comoLeer(p, ns)).join('; ') || 'sigue en licitaciones_oferta',
  };
}

function seccionCriterios(c: Contexto): Parte {
  const valorable = memoriaValorable(c.mem);
  const literal = paginasDeCriterios(c);
  const texto = [
    ...c.mem.apartados.flatMap((a, i) => lineasDeApartado(a, i + 1, valorable)),
    `Advertencias del pliego (literales): ${c.mem.advertencias.length ? c.mem.advertencias.map((x) => `«${x}»`).join(' ') : 'ninguna'}.`,
    ...(literal.texto ? ['', 'Texto del pliego donde están los criterios:', literal.texto] : []),
  ].join('\n');
  return recortar(texto, c.topes.criterios, literal.donde);
}

function seccionCuadro(c: Contexto): Parte {
  return seccionCuadroResumen({
    pcaps: c.pliegos.filter((p) => p.clase === 'pcap'),
    yaEnCriterios: (p, n) => enCriterios(c, p, n),
    automaticos: c.guion.datos.automaticos,
    tope: c.topes.cuadro_resumen,
  });
}

function seccionNormativaCliente(c: Contexto): Parte {
  return seccionNormativa({
    docs: c.documentos,
    idx: c.idx,
    apartados: c.mem.apartados,
    tope: c.topes.normativa_cliente,
  });
}

function seccionFormato(c: Contexto): Parte {
  const f = c.mem.formato;
  const p = pliegoDeDocumento(c.pliegos, c.mem.documento);
  const paginas = p && c.mem.pagina ? [c.mem.pagina] : [];
  const texto = [
    `- Límite: ${c.mem.limite_paginas ? `${c.mem.limite_paginas} páginas` : 'el pliego no fija ninguno'}${c.mem.limite_detalle ? ` («${c.mem.limite_detalle}»)` : ''}.`,
    `- Fuente ${f?.fuente ?? 'sin indicar'}, cuerpo ${f?.tamano_letra ?? 'sin indicar'}, interlineado ${f?.interlineado ?? 'sin indicar'}.`,
    ...(f?.otros ? [`- Otras exigencias: «${f.otros}».`] : []),
    `- Cierre: ${pideFirmaFinal(c.mem) ? 'la memoria acaba en «Lugar, fecha y firma del proponente» (lo pone la plataforma).' : 'sin bloque de firma al final.'}`,
    ...(p && paginas.length
      ? [
          '',
          'Cláusula del pliego:',
          enCriterios(c, p, paginas[0]!)
            ? `está en «Criterios» (${p.etiqueta} p. ${paginas[0]}): no se repite.`
            : textoPaginas(p, paginas),
        ]
      : []),
  ].join('\n');
  return recortar(texto, c.topes.formato, p ? comoLeer(p, paginas) : 'sigue en licitaciones_oferta');
}

// Fórmulas de anonimato del personal («CV anonimizados», «no se consignarán los nombres del
// personal»); un «no» con «nombre» cerca no basta: «el nombre del archivo» o «ofertas que no
// indiquen el nombre del responsable» hablan de otra cosa o piden lo contrario.
const PERSONAL = String.raw`nombres?\s+(?:y apellidos\s+)?de(?:l| las| los)?\s+(?:personal|equipo|personas|tecnic\w*|profesional\w*|trabajador\w*|docentes?|consultor\w*)`;
const NO_FIGURAR = String.raw`\bno\b[^.;]{0,60}\b(?:figur|consign|aparec|mencion|constar|revel|desvel|inclu)\w*`;
const ANONIMO = [
  /\banonimiz/,
  /\b(?:cv|curricul\w*|perfiles?)\s+(?:\w+\s+)?anonim/,
  /sin identificar/,
  new RegExp(String.raw`${NO_FIGURAR}[^.;]{0,40}\b${PERSONAL}`),
  new RegExp(String.raw`\b${PERSONAL}[^.;]{0,40}\bno\b[^.;]{0,20}\b(?:figur|aparec|consign|incluir)`),
];
const EXPERIENCIA_EQUIPO = /experiencia/;
const DEL_EQUIPO = /\b(?:equipo|personal|perfil|tecnic[oa]s?|profesional|coordinador|responsable|consultor)/;

/**
 * ¿El equipo va por roles, sin nombres? Si el pliego pide CV anonimizados (o no consignar
 * nombres), o si la experiencia del equipo se puntúa en un criterio automático: nombrar a la
 * persona en la memoria la delata. Nombrarlo arriesga la exclusión.
 */
export function equipoAnonimo(g: GuionGuardado['datos']): boolean {
  const textos = [
    ...g.archivos.flatMap((a) => a.prohibiciones),
    ...(g.memoria?.advertencias ?? []),
    ...(g.memoria?.apartados.flatMap((a) => [...a.se_valorara, ...a.escala.map((t) => t.descripcion)]) ?? []),
    ...g.automaticos.map((a) => `${a.criterio}. ${a.como_se_acredita}`),
  ].map(textoComparable);
  const automaticoDeEquipo = g.automaticos.some((a) => {
    const t = textoComparable(a.criterio);
    return EXPERIENCIA_EQUIPO.test(t) && DEL_EQUIPO.test(t);
  });
  return automaticoDeEquipo || textos.some((t) => ANONIMO.some((re) => re.test(t)));
}

export const REGLA_POR_ROLES =
  'EQUIPO POR ROLES, SIN NOMBRES: la memoria presenta a cada persona por su rol y su perfil («la responsable del servicio, licenciada en Derecho con 8 años en protección de datos»), nunca por su nombre: el pliego pide CV anonimizados o puntúa la experiencia del equipo en otro archivo, y un nombre en la memoria puede excluir la oferta.';
export const REGLA_ANEXOS =
  'COHERENCIA CON LOS ANEXOS: lo que declaramos en los criterios automáticos que se acreditan en otro archivo no se nombra en la memoria, pero tampoco se desmiente: ningún horario, plazo, cifra o medio de la memoria puede contradecir lo marcado en esos anexos (por ejemplo, una memoria que desmiente lo marcado en el Anexo VI). Los que se acreditan en esta misma memoria se declaran en ella con su valor y su plan, sin importes: callarlos cuesta sus puntos.';

// La frontera depende del archivo: lo que se acredita en esta memoria se declara (con el tramo
// estructurado, no la nota libre de la decisión, que puede llevar nombres); lo de otro archivo, no.
function lineasAutomaticos(c: Contexto): string[] {
  const ctx = contextoFugasDe(c.dbLic, c.guion);
  const compromisos = compromisosDeLaMemoria(c.guion.datos, c.decisiones?.automaticos ?? []);
  const propio = (criterio: string) =>
    compromisos.some((x) => textoComparable(x.criterio).trim() === textoComparable(criterio).trim());
  const decididos = (c.decisiones?.automaticos ?? []).filter((a) => a.nos_acogemos && !propio(a.criterio));
  return [
    ...ctx.automaticos.map(
      (a) =>
        `- «${a.criterio}» va en «${a.archivo}»: no se menciona, ni para afirmarlo ni para negarlo${a.marcas.length ? `; palabras que lo delatan: ${a.marcas.map((m) => `«${m}»`).join(', ')}` : ''}.`,
    ),
    ...compromisos.map(
      (x) =>
        `- Nos acogemos a «${x.criterio}», que se acredita EN ESTA MEMORIA: declara el compromiso con su valor (${valorDeCompromiso(x)}), su plan (sesiones, destinatarios y semana; o meses, horario y prioridades) y sin importes ni nada que permita deducir el precio.`,
    ),
    ...decididos.map(
      (a) =>
        `- Nos acogemos a «${a.criterio}»${a.nota ? ` (${sinCitasInternas(a.nota)})` : ''}: no se nombra y no se desmiente.`,
    ),
    ...(ctx.literales ?? [])
      .filter((x) => x.tipo === 'documento')
      .map((x) => `- «${x.marca}» es de «${x.archivo}»: no se nombra.`),
  ];
}

function seccionFrontera(c: Contexto): Parte {
  const economica = c.guion.datos.oferta_economica?.archivo;
  const texto = [
    ...c.guion.datos.archivos.flatMap((a) =>
      a.prohibiciones.map((p) => `- Prohibición de «${a.nombre}» (literal): «${p}»`),
    ),
    ...lineasAutomaticos(c),
    // Lo que la empresa no tiene o no conviene: la estrategia lo lleva a su frontera y el redactor no lo promete.
    ...lineasNoPrometer(noPrometerDe(c.dbLic, c.l.id)),
    `- Nada de importes, porcentajes de baja ni nada de la oferta económica${economica ? ` (va en «${economica}»)` : ''}.`,
    '',
    ...(c.anonimo ? [REGLA_POR_ROLES] : []),
    REGLA_ANEXOS,
  ].join('\n');
  return recortar(texto, c.topes.frontera, 'el guion entero está en licitaciones_oferta');
}

function seccionEmpresa(c: Contexto): Parte {
  const guardado = leerPerfilEmpresa(c.dbNucleo);
  if (!guardado)
    return {
      texto: 'Aún no hay perfil de la empresa (Ajustes › Empresa): no inventes certificaciones, plantilla ni medios.',
      truncado: false,
    };
  const p = perfilParaAgentes(guardado.perfil);
  const texto = [
    `- ${p.nombre}${p.anios_actividad !== null ? `, ${p.anios_actividad} años de actividad` : ''}${p.plantilla_media !== null ? `, plantilla media de ${p.plantilla_media} personas` : ''}.`,
    `- Certificaciones: ${p.certificaciones.length ? p.certificaciones.join(', ') : 'ninguna registrada'}.`,
    `- Clasificaciones: ${p.clasificaciones.length ? p.clasificaciones.map((x) => `${x.grupo}-${x.subgrupo}-${x.categoria}`).join(', ') : 'ninguna'}.`,
    ...(p.notas.trim() ? [`- Notas del perfil: ${p.notas.trim()}`] : []),
  ].join('\n');
  return recortar(texto, c.topes.empresa, 'el perfil entero está en plataforma_empresa');
}

function seccionEquipo(c: Contexto): Parte {
  const equipo = c.decisiones ? equipoParaRedactar(c.dbNucleo, c.decisiones) : [];
  const aIncorporar = c.decisiones ? textoAIncorporar(c.decisiones) : null;
  if (!equipo.length)
    return {
      texto: ['Sin equipo nominal fijado: no nombres personas.', ...(aIncorporar ? [aIncorporar] : [])].join('\n'),
      truncado: false,
    };
  const perfil = (p: (typeof equipo)[number]) =>
    [
      p.titulaciones.join(', '),
      p.anios_experiencia !== null ? `${p.anios_experiencia} años de experiencia` : '',
      p.certificaciones.length ? `certificaciones: ${p.certificaciones.join(', ')}` : '',
      p.sectores.length ? `sectores: ${p.sectores.join(', ')}` : '',
      p.tecnologias.length ? `tecnologías: ${p.tecnologias.slice(0, 10).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  const quien = (p: (typeof equipo)[number], i: number) => (c.anonimo ? `Persona ${i + 1}` : p.nombre);
  const alias = aliasDeRoles(equipo.map((p) => p.rol_en_la_oferta));
  const pliegos = [...c.pliegos.filter((p) => p.clase === 'ppt'), ...c.pliegos.filter((p) => p.clase === 'pcap')];
  // Una línea por persona (en Salidas se cuentan las personas por sus «- »).
  const linea = (p: (typeof equipo)[number], i: number) =>
    [
      `- ${quien(p, i)} — ${p.rol_en_la_oferta} (alias ${alias[i]}): categoría ${p.rol || 'sin indicar'}; ${p.tipo === 'externo' ? 'colaborador externo' : 'personal propio'};`,
      `dedicación ${p.dedicacion ?? 'sin decidir: proponla en la estrategia'}.`,
      `Funciones en el pliego: ${funcionesDelRol(p.rol_en_la_oferta, pliegos) ?? 'el pliego no las detalla: asígnalas en la estrategia'}.`,
      `Perfil: ${perfil(p) || 'sin datos del CV'}${!c.anonimo && p.cv_ruta ? `; CV «${p.cv_ruta}»` : ''}.`,
    ].join(' ');
  const texto = [
    ...(c.anonimo ? ['Por roles: estos nombres no se dan; en la memoria, cada persona es su rol.'] : []),
    'Cada rol se presenta entero una vez (en la tabla del equipo) y después se cita por su alias.',
    ...equipo.map(linea),
    ...(aIncorporar ? [aIncorporar] : []),
  ].join('\n');
  return recortar(texto, c.topes.equipo, 'el equipo está en licitaciones_oferta (decisiones)');
}

function seccionHerramientas(c: Contexto): Parte {
  const d = c.decisiones;
  const enfoque = d ? sinCitasInternas(d.enfoque) : '';
  const texto = [
    `- ${textoHerramientas(d?.herramientas ?? [])}`,
    `- Enfoque del equipo (orienta qué contar; no se copia): ${enfoque ? `«${enfoque}»${tieneCautelas(enfoque) ? ` ${CAUTELAS_ENFOQUE}` : ''}` : 'ninguno más allá de las decisiones'}.`,
  ].join('\n');
  return recortar(texto, c.topes.herramientas, 'las decisiones están en licitaciones_oferta');
}

function seccionLecciones(c: Contexto): Parte {
  const porApartado = c.mem.apartados
    .map((a, i) => {
      const mesa = leccionesParaApartado(
        c.dbLic,
        { titulo: a.titulo, se_valorara: a.se_valorara, organo: c.l.organo_nombre },
        3,
      );
      const elegidas = leccionesParaRedactar(c.dbLic, {
        licitacion_id: c.l.id,
        apartado: i + 1,
        titulo: a.titulo,
        se_valorara: a.se_valorara,
        sinLasPropias: c.ensayo,
      });
      const frases = [...new Set([...mesa, ...elegidas.map((l) => l.texto)])];
      return frases.length ? [`${i + 1}. ${a.titulo}:`, ...frases.map((f) => `- ${f}`)].join('\n') : '';
    })
    .filter(Boolean);
  return recortar(
    porApartado.length ? porApartado.join('\n\n') : 'Aún no hay lecciones aceptadas que toquen a estos apartados.',
    c.topes.lecciones,
    'más en licitaciones_propuestas (aprendizajes)',
  );
}

// De la mejor parecida ganada, su memoria (el primer documento que lo parezca), hasta un tope.
async function memoriaParecida(raices: Raices, documentos: string[]): Promise<string | null> {
  const ruta = documentos.find((d) => /memoria/i.test(path.posix.basename(d))) ?? documentos[0];
  if (!ruta) return null;
  const r = await leerDocumento(raices, ruta, 0, MAX_MEMORIA_PARECIDA);
  return r.error ? null : `Memoria de «${ruta}» (${r.data.hasta} de ${r.data.total} caracteres):\n${r.data.texto}`;
}

async function seccionParecidas(c: Contexto): Promise<Parte> {
  const parecidas = propuestasParecidas(c.dbLic, c.l.id, MAX_PARECIDAS);
  const lista = parecidas.error ? [] : parecidas.data;
  const aprendizajes = aprendizajesParecidos(c.dbLic, c.l.id, MAX_PARECIDAS);
  const ganada = lista.find((p) => p.resultado === 'ganada');
  const memoria = ganada ? await memoriaParecida(c.raices, ganada.documentos) : null;
  const texto = [
    ...(lista.length
      ? lista.map(
          (p) =>
            `- ${p.titulo} (${p.organo}), ${p.resultado}: ${p.motivos.join(', ')}${p.carpeta ? `; carpeta «${p.carpeta}»` : ''}${p.documentos.length ? `; documentos: ${p.documentos.join(', ')}` : ''}.`,
        )
      : ['Aún no hay propuestas parecidas registradas.']),
    ...aprendizajes.map(
      (a) =>
        `- Acta de ${a.organo ?? a.expediente ?? a.carpeta} (${a.resultado ?? 'sin resultado'}): ${a.motivos.join(', ')}; ${a.lecciones.slice(0, 3).join(' ')}`,
    ),
    ...(memoria ? ['', memoria] : []),
  ].join('\n');
  return recortar(texto, c.topes.parecidas, 'lee los documentos con biblioteca_leer o salidas_leer');
}

// ── Componer y guardar ──

// sinPliegos: no abre el índice ni lee pliegos (las huellas de GET /oferta, huellasActuales).
export type OpcionesDossier = { topes?: Partial<Record<ClaveDossier, number>>; raices?: Raices; sinPliegos?: boolean };

function contextoDe(
  dbLic: Db,
  dbNucleo: DbNucleo,
  memoriaId: number,
  op: OpcionesDossier,
): Result<Contexto & { version: number }> {
  const m = filaMemoria(dbLic, memoriaId);
  if (!m) return fail('not_found', `No hay ninguna memoria con id ${memoriaId}.`);
  const l = dbLic
    .prepare('SELECT id, titulo, organo_nombre, expediente, fecha_limite, nuts, datos FROM licitaciones WHERE id = ?')
    .get(m.licitacion_id) as Licitacion | undefined;
  const guion = guionPorId(dbLic, m.guion_id);
  if (!l || !guion?.datos.memoria) return fail('not_found', 'La licitación o el guion de esta memoria ya no están.');
  const topes = Object.fromEntries(CLAVES_DOSSIER.map((k) => [k, op.topes?.[k] ?? SECCIONES[k].tope])) as Record<
    ClaveDossier,
    number
  >;
  const idx = op.sinPliegos ? null : abrirIndiceLectura();
  const fila = obtenerLicitacion(dbLic, l.id);
  const lote = m.lote ?? null;
  const decisiones = decisionesDe(dbLic, l.id)?.datos;
  return ok({
    dbLic,
    dbNucleo,
    l,
    guion,
    mem: guion.datos.memoria,
    decisiones: decisiones ? decisionesDelLote(decisiones, lote) : null,
    version: m.version,
    lote,
    pliegos: pliegosLeidos(dbLic, l.id, idx),
    anonimo: equipoAnonimo(guion.datos),
    topes,
    raices: op.raices ?? raicesActuales(),
    ensayo: m.ensayo === 1,
    idx,
    documentos: registrarDocumentosDeCarpeta(dbLic, l.id, idx),
    carpeta: fila ? carpetaPliegos(dbLic, fila) : '',
  });
}

const SINCRONAS: Record<Exclude<ClaveDossier, 'parecidas'>, (c: Contexto) => Parte> = {
  identificacion: seccionIdentificacion,
  pliego_tecnico: seccionPliegoTecnico,
  aclaraciones: (c) => seccionAclaraciones(c.documentos, c.idx, c.carpeta, c.topes.aclaraciones),
  cuadro_resumen: seccionCuadro,
  criterios: seccionCriterios,
  formato: seccionFormato,
  normativa_cliente: seccionNormativaCliente,
  frontera: seccionFrontera,
  empresa: seccionEmpresa,
  equipo: seccionEquipo,
  herramientas: seccionHerramientas,
  lecciones: seccionLecciones,
};

// ── Huellas (en la memoria, huellasMemoria.ts) ──

/** Las secciones cuya huella se recalcula al abrir la oferta: dependen de las decisiones y del perfil, no de los pliegos. */
export const CLAVES_HUELLA_BARATA = [
  'identificacion',
  'frontera',
  'empresa',
  'equipo',
  'herramientas',
] as const satisfies readonly ClaveDossier[];
type ClaveBarata = (typeof CLAVES_HUELLA_BARATA)[number];
const esBarata = (k: ClaveDossier): k is ClaveBarata => (CLAVES_HUELLA_BARATA as readonly ClaveDossier[]).includes(k);

const huellaDe = (texto: string): string => crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);

// Las baratas se firman compuestas sin pliegos (el equipo cita sus funciones en el PPT y el
// calendario lee el PCAP): así la huella de GET /oferta, que no lee pliegos, es comparable con la
// guardada. Un cambio de pliego lo dicen las huellas de pliego_tecnico y criterios.
function huellaDeSeccion(c: Contexto, clave: ClaveDossier, texto: string): string {
  return esBarata(clave)
    ? huellaDe(SINCRONAS[clave]({ ...c, pliegos: [], idx: null, documentos: [] }).texto)
    : huellaDe(texto);
}

/** Las huellas de ahora de unas secciones baratas, sin abrir el índice ni leer pliegos. */
export function huellasActuales(
  dbLic: Db,
  dbNucleo: DbNucleo,
  memoriaId: number,
  claves: ClaveDossier[],
): Result<Partial<Record<ClaveDossier, string>>> {
  const caras = claves.filter((k) => !esBarata(k));
  if (caras.length) return fail('invalid_input', `Sin leer los pliegos no se puede firmar «${caras.join('», «')}».`);
  const c = contextoDe(dbLic, dbNucleo, memoriaId, { sinPliegos: true });
  if (c.error) return c;
  return ok(Object.fromEntries(claves.filter(esBarata).map((k) => [k, huellaDe(SINCRONAS[k](c.data).texto)])));
}

/** Compone el dossier de una memoria (sin IA): todas sus secciones, cada una con su tope. */
export async function componerDossier(
  dbLic: Db,
  dbNucleo: DbNucleo,
  memoriaId: number,
  op: OpcionesDossier = {},
): Promise<Result<Dossier>> {
  const c = contextoDe(dbLic, dbNucleo, memoriaId, op);
  if (c.error) return c;
  const partes: Record<ClaveDossier, Parte> = {
    ...Object.fromEntries(Object.entries(SINCRONAS).map(([k, f]) => [k, f(c.data)])),
    parecidas: await seccionParecidas(c.data),
  } as Record<ClaveDossier, Parte>;
  const secciones = CLAVES_DOSSIER.map((clave) => ({
    clave,
    titulo: SECCIONES[clave].titulo,
    texto: partes[clave].texto,
    critico: SECCIONES[clave].critico,
    personal: clave === 'equipo',
    truncado: partes[clave].truncado,
    huella: huellaDeSeccion(c.data, clave, partes[clave].texto),
  }));
  const equipo_ids = c.data.decisiones?.equipo.map((m) => m.persona_id) ?? [];
  return ok({
    memoria_id: memoriaId,
    licitacion_id: c.data.l.id,
    version: c.data.version,
    secciones,
    caracteres: secciones.reduce((s, x) => s + x.texto.length, 0),
    equipo_por_roles: c.data.anonimo,
    equipo_ids,
  });
}

/** El dossier en Markdown; sin lo personal (para Salidas), el equipo se resume en cuántas personas son. */
export function dossierEnMarkdown(d: Dossier, op: { sinPersonal: boolean }): string {
  const personas = (t: string) => (t.match(/^- /gm) ?? []).length;
  return [
    `# Dossier de la memoria v${d.version} (${d.licitacion_id})`,
    'Lo que la plataforma reúne para redactar la memoria: lo usa Hermes en la estrategia y en la redacción.',
    ...d.secciones.flatMap((s) => [
      '',
      `## ${s.titulo}`,
      '',
      op.sinPersonal && s.personal ? `${personas(s.texto)} personas: ver Decisiones de la oferta.` : s.texto,
    ]),
    '',
  ].join('\n');
}

/**
 * Escribe un Markdown junto a la memoria en Salidas sin pisar nada (alguien pudo editarlo en
 * Drive): si ya existe, «-2», «-3»… Devuelve la ruta.
 */
export function escribirEnSalidas(
  raices: Raices,
  l: { id: string; expediente: string },
  base: string,
  contenido: string,
): Result<string> {
  const carpeta = carpetaSalidas(l);
  const dir = documentoEnDisco(raices, carpeta);
  if (dir.error) return dir;
  fs.mkdirSync(dir.data, { recursive: true });
  for (let k = 1; k < 100; k += 1) {
    const nombre = k === 1 ? `${base}.md` : `${base}-${k}.md`;
    if (fs.existsSync(path.join(dir.data, nombre))) continue;
    fs.writeFileSync(path.join(dir.data, nombre), contenido, { flag: 'wx' });
    return ok(`${carpeta}/${nombre}`);
  }
  return fail('conflicto', `Ya hay demasiados «${base}» en ${carpeta}.`);
}

// memoria-vN-<qué> o, de ensayo, memoria-vN-ensayo-<qué>: en Salidas, junto a lo de la oferta,
// sin que nadie tome el plan de un ensayo por el de la memoria presentada.
export const baseDeArtefacto = (version: number, ensayo: boolean, que: string): string =>
  `memoria-v${version}${ensayo ? '-ensayo' : ''}-${que}`;

/** Guarda el dossier en la base y, sin el equipo, en Salidas (memoria-vN-dossier.md). */
export function guardarDossier(dbLic: Db, d: Dossier, raices: Raices = raicesActuales()): Result<{ ruta_md: string }> {
  const l = dbLic.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(d.licitacion_id) as
    { id: string; expediente: string } | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${d.licitacion_id}».`);
  const ruta = escribirEnSalidas(
    raices,
    l,
    baseDeArtefacto(d.version, memoriaDeEnsayo(dbLic, d.memoria_id), 'dossier'),
    dossierEnMarkdown(d, { sinPersonal: true }),
  );
  if (ruta.error) return ruta;
  dbLic
    .prepare(
      `INSERT INTO memoria_dossiers (memoria_id, licitacion_id, secciones, caracteres, ruta_md, creado_en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(memoria_id) DO UPDATE SET secciones = excluded.secciones, caracteres = excluded.caracteres, ruta_md = excluded.ruta_md, creado_en = excluded.creado_en`,
    )
    .run(
      d.memoria_id,
      d.licitacion_id,
      JSON.stringify({
        secciones: d.secciones,
        equipo_por_roles: d.equipo_por_roles,
        version: d.version,
        equipo_ids: d.equipo_ids,
      }),
      d.caracteres,
      ruta.data,
      new Date().toISOString(),
    );
  return ok({ ruta_md: ruta.data });
}

export type DossierGuardado = Dossier & { ruta_md: string | null; creado_en: string };

/** El dossier guardado de una memoria (null si aún no se compuso). */
export function dossierDe(dbLic: Db, memoriaId: number): DossierGuardado | null {
  const f = dbLic.prepare('SELECT * FROM memoria_dossiers WHERE memoria_id = ?').get(memoriaId) as
    | { licitacion_id: string; secciones: string; caracteres: number; ruta_md: string | null; creado_en: string }
    | undefined;
  if (!f) return null;
  // Los de antes de las huellas no traen huella ni equipo_ids.
  const s = JSON.parse(f.secciones) as {
    secciones: (Omit<SeccionDossier, 'huella'> & { huella?: string })[];
    equipo_por_roles: boolean;
    version: number;
    equipo_ids?: number[];
  };
  const secciones = s.secciones.map((x) => ({ ...x, huella: x.huella ?? '' }));
  return {
    memoria_id: memoriaId,
    licitacion_id: f.licitacion_id,
    version: s.version,
    secciones,
    caracteres: f.caracteres,
    equipo_por_roles: s.equipo_por_roles,
    equipo_ids: s.equipo_ids ?? [],
    ruta_md: f.ruta_md,
    creado_en: f.creado_en,
  };
}

// ── Lectura por MCP (licitaciones_dossier) ──

// Texto de cada trozo: con el sobre JSON y los saltos escapados cabe en RESPUESTA_LECTURA.
const TROZO_DOSSIER = 40_000;
export type ConsultaDossier = {
  id: string;
  memoria_id: number;
  seccion?: ClaveDossier | undefined;
  desde?: number | undefined;
};

function indiceDe(d: DossierGuardado, verPersonas: boolean): unknown {
  return {
    memoria_id: d.memoria_id,
    version: d.version,
    equipo_por_roles: d.equipo_por_roles,
    caracteres: d.caracteres,
    ruta_md: d.ruta_md,
    secciones: d.secciones.map((s) => ({
      clave: s.clave,
      titulo: s.titulo,
      caracteres: s.texto.length,
      recortada: s.truncado,
      disponible: !s.personal || verPersonas,
    })),
    como_leer: `Lee cada sección con «seccion» (y «desde» si no llega entera: trozos de ${TROZO_DOSSIER} caracteres). Una sección recortada dice dónde sigue.`,
  };
}

/** El índice del dossier o, con «seccion», su texto por trozos. El equipo, solo a quien puede leer colaboradores. */
export function leerDossier(dbLic: Db, a: ConsultaDossier, verPersonas: boolean): Result<unknown> {
  const d = dossierDe(dbLic, a.memoria_id);
  if (!d || d.licitacion_id !== a.id)
    return fail(
      'not_found',
      `La memoria ${a.memoria_id} de «${a.id}» aún no tiene dossier (se compone al pedir una memoria).`,
    );
  if (!a.seccion) return ok(indiceDe(d, verPersonas));
  const s = d.secciones.find((x) => x.clave === a.seccion)!;
  if (s.personal && !verPersonas)
    return fail(
      'forbidden',
      'La sección «equipo» lleva datos de los CV: solo la leen los agentes con permiso sobre colaboradores.',
    );
  const desde = Math.min(a.desde ?? 0, s.texto.length);
  const hasta = Math.min(s.texto.length, desde + TROZO_DOSSIER);
  return ok({
    seccion: s.clave,
    titulo: s.titulo,
    recortada: s.truncado,
    total: s.texto.length,
    desde,
    hasta,
    siguiente: hasta < s.texto.length ? hasta : null,
    texto: s.texto.slice(desde, hasta),
  });
}
