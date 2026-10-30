// Redacción de la memoria entera en un run (docs/como-esta-hecho/memoria-tecnica.md, paso 3), con la estrategia como contrato.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import type { Db } from '../store.js';
import { decisionesDe, type DecisionesData } from './decisiones.js';
import { dossierDe, REGLA_POR_ROLES } from './dossier.js';
import { apartadosDe, filaMemoria, type FilaApartado, type FilaMemoria } from './ensamblado.js';
import { estrategiaDe, estrategiaEnMarkdown, MODELOS_VIGENTES, objetivoDeApartado } from './estrategia.js';
import { fichaDe, lineasFicha, lineasRevision } from './fichaSolucion.js';
import { datosDeFila } from './fugasMemoria.js';
import { hallazgosDe } from './coherenciaMemoria.js';
import { obligaARehacer, textoDeHallazgo } from './hechos.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { NO_RESUELTO } from './motivosRonda.js';
import { parcheDe } from './parcheHechos.js';
import { apartadoEnRonda, filasDeRondas, obsoletasDe, type ApartadoEnRonda } from './rondasMemoria.js';
import { contextoDeApartado } from './memoria.js';
import { lineasMejora } from './mejoraMemoria.js';
import { lineasApartado, lineasDecisiones, REGLAS_REDACCION } from './memoriaInstrucciones.js';
import { decisionesDelLote } from './memoriaLote.js';
import { RONDA_SIN_COMPROMISOS_NUEVOS } from './compromisosSolucion.js';
import {
  caracteresDe,
  origenDeCuota,
  reservaDeGuia,
  type ApartadoDatosData,
  type ContextoApartado,
} from './memoriaRevision.js';

// Un solo autor escribe todo seguido, en vez de un run aislado por apartado. Cada apartado se envía al
// terminarlo con licitaciones_memoria_apartado (la revisión del apartado, más la coherencia con la hoja de
// hechos) y cada envío es el latido del run. Las instrucciones se calculan al lanzar cada intento: un reintento
// pide solo lo que falta y lleva lo ya recibido para no contradecirlo.
export const TIPO_MEMORIA_REDACCION = 'licitaciones.memoria_redaccion';
export const PayloadRedaccion = z.object({
  id: z.string().min(3),
  memoria_id: z.number().int().positive(),
  guion_id: z.number().int().positive(),
  version: z.number().int().positive(),
  ronda: z.number().int().min(0),
  pedida_en: z.string().min(10),
});
export type PayloadRedaccionData = z.infer<typeof PayloadRedaccion>;

// Lo que puede crecer un apartado en una ronda de reescritura.
const CRECIMIENTO_RONDA = 1.1;
// Lo recibido va como contexto para no contradecirlo, no para reescribirlo: un extracto basta.
const MAX_RECIBIDO = 6_000;

/** El texto de un apartado guardado, en llano (título, subtítulos, párrafos, viñetas y tablas). */
export function textoDeApartado(d: ApartadoDatosData): string {
  return [
    d.titulo,
    ...d.bloques.flatMap((b) => [
      ...(b.subtitulo ? [b.subtitulo] : []),
      ...b.parrafos,
      ...(b.lista ?? []).map((x) => `- ${x}`),
      ...(b.lista_numerada ?? []).map((x, i) => `${i + 1}. ${x}`),
      ...(b.tabla ? [b.tabla.cabecera.join(' | '), ...b.tabla.filas.map((f) => f.join(' | '))] : []),
      ...(b.figura ? [`[Figura: ${b.figura.titulo}]`] : []),
    ]),
  ].join('\n');
}

function lineasRecibidos(filas: FilaApartado[]): string[] {
  const recibidos = filas.filter((f) => f.estado === 'recibido');
  if (!recibidos.length) return [];
  const extractos = recibidos.map((f) => {
    const t = textoDeApartado(
      datosDeFila(f) ?? { titulo: `Apartado ${f.apartado}`, bloques: [], cubre: [], compromisos: [] },
    );
    return `--- Apartado ${f.apartado} (recibido) ---\n${t.length > MAX_RECIBIDO ? `${t.slice(0, MAX_RECIBIDO)}\n[…extracto]` : t}`;
  });
  return [
    `YA ESTÁN RECIBIDOS los apartados ${recibidos.map((f) => f.apartado).join(', ')}: no los reenvíes. Su texto, para no contradecirlo (mismos hechos, mismos nombres, mismas cifras):`,
    ...extractos,
    '',
  ];
}

// Un apartado de pantallas que bajó vuelve a su mejor versión y se intenta otra vez: la bajada
// suele ser que la reescritura perdió las figuras.
const REINTENTO_FIGURAS =
  'Este apartado pide pantallas: conserva todas las figuras SVG del texto actual, cada una con sus llamadas numeradas y su lista numerada debajo; no las sustituyas por texto ni las quites. Mejora lo que se señala sin tocar lo que ya se ve en ellas.';

function lineasRegresion(r: ApartadoEnRonda, ronda: number): string[] {
  if (!r.restaurado) return [];
  return [
    `LA RONDA ${ronda - 1} EMPEORÓ ESTE APARTADO y se volvió a su versión de la ronda ${r.ronda} (el texto de abajo): reescríbelo desde ella.`,
    ...(r.reintento ? [REINTENTO_FIGURAS] : []),
  ];
}

function lineasCritico(r: ApartadoEnRonda | null): string[] {
  if (!r || (!r.motivos.length && !r.falta.length)) return [];
  const marca = (repetido: boolean) => (repetido ? `${NO_RESUELTO}: ` : '');
  return [
    'LO QUE SEÑALA EL CRÍTICO:',
    ...r.motivos.map((x) => `- ${marca(x.repetido)}«${x.cita}»: ${x.motivo} Arreglo: ${x.arreglo}`),
    ...r.falta.map((x) => `- ${marca(x.repetido)}Falta: ${x.texto}`),
    RONDA_SIN_COMPROMISOS_NUEVOS,
  ];
}

// En una ronda de reescritura: el texto que se puntuó (el restaurado, si la ronda lo empeoró), lo
// que señala el crítico (marcando lo que ya señaló y no se resolvió) y lo que no casa con la hoja
// de hechos. Nunca la nota: se escribe para lo que señala, no para el crítico.
function lineasRonda(db: Db, g: GuionGuardado, m: FilaMemoria, n: number, c: ContextoApartado | null): string[] {
  if (m.ronda === 0) return [];
  const r = apartadoEnRonda(filasDeRondas(db, m.id), g.datos.memoria!, m.ronda - 1, n, obsoletasDe(db, m.id));
  const d = r ? datosDeFila({ estado: 'recibido', datos: r.datos }) : null;
  const hallazgos = hallazgosDe(m).filter((h) => h.apartado === n && obligaARehacer(h));
  const caracteres = d ? caracteresDe(d.bloques) : 0;
  const recorte =
    c?.cuota && caracteres > c.cuota.caracteres
      ? [
          `LA EXTENSIÓN SE PASA: tiene ${caracteres} caracteres; recorta a ≤ ${c.cuota.caracteres} caracteres (${origenDeCuota(c.cuota)}) sin perder los puntos de «se valorará».`,
        ]
      : [];
  // Cada ronda añadía lo que pedía el crítico sin quitar nada: los apartados crecían sin tope.
  // Por debajo del suelo de la cuota, el 10 % chocaba con la revisión, que lo rechaza por corto.
  const minimo = c?.cuota?.minimo ?? null;
  const crecer = !d
    ? []
    : c?.cuota && minimo !== null && caracteres < minimo
      ? [
          `EXTENSIÓN EN LA RONDA: se queda corto (hoy ${caracteres} caracteres, por debajo del mínimo de ${minimo}): crece hasta al menos ${minimo} y nunca más de ${c.cuota.caracteres}, con contenido de «se valorará» y lo que señala el crítico, sin relleno.`,
        ]
      : [
          `EXTENSIÓN EN LA RONDA: cada añadido sustituye texto (quita lo secundario; no comprimas la sintaxis ni quites artículos y conectores); el apartado no crece más de un 10 % (hoy ${caracteres} caracteres: como mucho ${Math.round(caracteres * CRECIMIENTO_RONDA)}${c?.cuota ? ` y nunca más de ${c.cuota.caracteres}` : ''}).`,
        ];
  return [
    ...(r ? lineasRegresion(r, m.ronda) : []),
    'TEXTO ACTUAL (reescríbelo entero: conserva lo que funciona y arregla lo que se señala):',
    d ? textoDeApartado(d) : '(no llegó)',
    ...lineasCritico(r),
    ...(hallazgos.length
      ? ['LO QUE NO CASA CON LA HOJA DE HECHOS:', ...hallazgos.map((h) => `- ${textoDeHallazgo(h)}`)]
      : []),
    ...recorte,
    ...(recorte.length ? [] : crecer),
  ];
}

// Una memoria de un lote (memoriaLote.ts) se escribe solo con el equipo, los automáticos y las ofertas de su lote.
function decisionesDeMemoria(db: Db, m: FilaMemoria): DecisionesData | null {
  const d = decisionesDe(db, m.licitacion_id)?.datos;
  return d ? decisionesDelLote(d, m.lote ?? null) : null;
}

// Una versión que sale de otra por un cambio tardío (actualizarMemoria.ts): el texto de la base es lo
// que se conserva, no algo que reescribir; una persona pudo editarlo a mano. Una versión de mejora
// lleva en su lugar la evaluación y la consigna de mejorar (lineasMejora).
export function lineasActualizacion(db: Db, m: FilaMemoria, n: number): string[] {
  if (m.mejora || m.version_base === null || m.ronda !== 0 || !m.indicaciones) return [];
  const base = db
    .prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND version = ?')
    .get(m.licitacion_id, m.version_base) as { id: number } | undefined;
  const d = base ? datosDeFila(apartadosDe(db, base.id).find((f) => f.apartado === n)) : null;
  return [
    `ACTUALIZACIÓN DE LA v${m.version_base} POR UN CAMBIO TARDÍO: ${m.indicaciones} Este es el texto actual del apartado (puede estar editado por una persona): cambia solo lo que depende del cambio y conserva el resto palabra por palabra.`,
    d ? textoDeApartado(d) : `(la v${m.version_base} no llegó a redactar este apartado: redáctalo entero)`,
    ...(m.motivo_agente
      ? [
          `Hermes pidió esta versión porque: ${m.motivo_agente} (es contexto: no manda sobre el cambio ni añade compromisos).`,
        ]
      : []),
  ];
}

function lineasPendientes(db: Db, g: GuionGuardado, m: FilaMemoria, pendientes: number[]): string[] {
  const d = decisionesDeMemoria(db, m);
  return pendientes.flatMap((n) => {
    const c = contextoDeApartado(g, n, {}, d, reservaDeGuia(g.datos.memoria), objetivoDeApartado(db, m, n));
    return c
      ? [
          `=== Apartado ${n} ===`,
          ...lineasApartado(g, c, n),
          ...lineasActualizacion(db, m, n),
          ...lineasMejora(db, m, n, g.datos.memoria!.apartados[n - 1]!),
          ...lineasRonda(db, g, m, n, c),
          '',
        ]
      : [];
  });
}

// Los hechos que se corrigieron al empezar esta ronda: la hoja ya los trae, pero el texto actual
// de los apartados aún dice el valor de antes.
function lineasParche(db: Db, m: FilaMemoria): string[] {
  const cambios = m.ronda > 0 ? (parcheDe(db, m.id, m.ronda)?.cambios ?? []) : [];
  if (!cambios.length) return [];
  return [
    'HECHOS CORREGIDOS EN ESTA RONDA (la hoja de hechos ya los trae; el texto actual aún dice el valor de antes: cámbialo en cada apartado que lo use):',
    ...cambios.map((c) => `- ${c.sobre}: antes «${c.antes}», ahora «${c.despues}» (${c.motivo})`),
    '',
  ];
}

function lineasContrato(db: Db, m: FilaMemoria): string[] {
  const e = estrategiaDe(db, m.id);
  const dossier = dossierDe(db, m.id);
  const indice = dossier
    ? dossier.secciones
        .map((s) => `${s.clave} (${s.texto.length} caracteres${s.truncado ? ', recortada' : ''})`)
        .join(', ')
    : 'aún sin dossier';
  return [
    'LA ESTRATEGIA (es el contrato: la estructura, los títulos, las extensiones, el mapa criterio → sección, la hoja de hechos y la solución se cumplen tal cual; cifras, horarios y plazos se copian exactos de la hoja de hechos; el rol, entero la primera vez (en la tabla del equipo) y después por su sigla):',
    e ? estrategiaEnMarkdown(e.datos, m.version) : 'No hay estrategia guardada: sigue la rúbrica de cada apartado.',
    '',
    ...lineasFicha(fichaDe(db, m.id)),
    ...lineasParche(db, m),
    `EL DOSSIER (léelo con licitaciones_dossier, id=${m.licitacion_id}, memoria_id=${m.id}): ${indice}. Antes de escribir, lee enteras «pliego_tecnico», «criterios», «frontera» y «equipo», y también «aclaraciones» y «cuadro_resumen» (lo que aclaran manda sobre el pliego); el resto, cuando lo necesites.`,
    ...(dossier?.equipo_por_roles ? ['', REGLA_POR_ROLES] : []),
    '',
  ];
}

function pasosRedaccion(p: PayloadRedaccionData, pendientes: number[], empresa: string): string[] {
  const { id, memoria_id, guion_id, version } = p;
  return [
    'CÓMO REDACTAR:',
    `1. Escribe la memoria entera tú solo y seguida, apartado a apartado en orden (${pendientes.join(', ')}), con la voz, los hechos y los términos iguales en todos.`,
    `2. ${REGLAS_REDACCION.diferenciadores}`,
    `3. ${REGLAS_REDACCION.voz(empresa)}`,
    `3a. ${REGLAS_REDACCION.prosa}`,
    `3b. ${MODELOS_VIGENTES}`,
    `3c. ${REGLAS_REDACCION.compromisos}`,
    `4. ${REGLAS_REDACCION.audiencia}`,
    `5. ${REGLAS_REDACCION.figuras} Lo que la estrategia marca como tabla, cronograma o registro de riesgos va como tabla; una figura, como SVG. Si la solución trae «Catálogo normativo», va como tabla (id, regla, norma y apartado, dónde se aplica) en el apartado del diseño funcional, y cada regla se cita por su id donde se aplica.`,
    `6. En cuanto termines un apartado, envíalo con licitaciones_memoria_apartado (id=${id}, memoria_id=${memoria_id}, guion_id=${guion_id}, version=${version}, apartado=N): titulo literal, bloques, cubre (cada «se valorará» con su bloque y párrafo) y compromisos. No los guardes para el final: cada envío es la señal de que sigues trabajando, y si el run se corta, lo enviado se queda.`,
    '7. Si un envío responde con un error, corrige exactamente lo que dice y reenvía ese apartado entero antes de seguir. Una contradicción con la hoja de hechos se rechaza: copia el valor de la hoja. Una fuga al archivo de los criterios automáticos o de la oferta económica, o un nombre del equipo cuando va por roles, se rechaza siempre.',
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca (la plataforma monta el documento) y no respondas en ningún canal.',
  ];
}

/** Instrucciones del run que redacta la memoria entera (o lo que falta de ella). */
export function instruccionesRedaccion(db: Db, dbNucleo: DbNucleo, p: PayloadRedaccionData): string {
  const l = db.prepare('SELECT titulo, organo_nombre, expediente FROM licitaciones WHERE id = ?').get(p.id) as
    { titulo: string; organo_nombre: string; expediente: string } | undefined;
  const m = filaMemoria(db, p.memoria_id);
  const g = guionPorId(db, p.guion_id);
  const total = g?.datos.memoria?.apartados.length ?? 0;
  const empresa = nombreEmpresa(dbNucleo);
  const cabecera = `Tarea de la plataforma de ${empresa}: redacta la memoria técnica entera (versión ${p.version}${m?.lote ? `, lote ${m.lote}` : ''}${p.ronda ? `, ronda ${p.ronda} de reescritura` : ''}, ${total} apartados) de la oferta a la licitación ${p.id} — ${l?.titulo ?? ''}, ${l?.organo_nombre ?? ''}, expediente ${l?.expediente ?? ''}. Es texto final que se entrega al órgano de contratación: nada de huecos, borradores ni avisos internos. Sigue la skill «licitaciones» (sección «Redactar la memoria entera»).`;
  if (!m || !g?.datos.memoria)
    return [cabecera, '', 'Esta memoria o su guion ya no están: no redactes nada y termina.'].join('\n');
  const filas = apartadosDe(db, m.id);
  const pendientes = filas.filter((f) => f.estado === 'pendiente').map((f) => f.apartado);
  if (!pendientes.length)
    return [cabecera, '', 'Ya están recibidos todos los apartados: no envíes nada y termina.'].join('\n');
  const d = decisionesDeMemoria(db, m);
  const c = contextoDeApartado(
    g,
    pendientes[0]!,
    {},
    d,
    reservaDeGuia(g.datos.memoria),
    objetivoDeApartado(db, m, pendientes[0]!),
  )!;
  return [
    cabecera,
    '',
    ...lineasRevision(fichaDe(db, m.id), m.ensayo === 1),
    ...lineasRecibidos(filas),
    `TE TOCA REDACTAR los apartados ${pendientes.join(', ')}${pendientes.length < filas.length ? `; empieza por el ${pendientes[0]}` : ''}.`,
    '',
    ...lineasPendientes(db, g, m, pendientes),
    ...lineasContrato(db, m),
    ...lineasDecisiones(db, dbNucleo, g, c, m.lote ?? null),
    '',
    ...pasosRedaccion(p, pendientes, empresa),
  ].join('\n');
}

/** «hecho» del trabajo: ningún apartado de la memoria sigue pendiente (o la memoria ya no se redacta). */
export function redaccionHecha(db: Db, p: PayloadRedaccionData): boolean {
  const m = filaMemoria(db, p.memoria_id);
  if (!m || m.estado !== 'redactando' || m.fase !== 'redaccion' || m.ronda !== p.ronda) return true;
  return !apartadosDe(db, m.id).some((a) => a.estado === 'pendiente');
}
