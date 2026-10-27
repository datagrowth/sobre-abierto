// El texto libre del asistente de la oferta: un trabajo de cola en el que Hermes lo interpreta.
import { z } from 'zod';
import { obtenerPersona } from '../../../nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { encolarUnico } from '../../../nucleo/trabajos.js';
import type { Db } from '../store.js';
import { anotarHilo, cambiarEstado, hiloDe, mensajeDe } from './asistenteHilo.js';
import { preguntasDeOferta } from './asistentePreguntas.js';
import { describirAccion } from './asistenteRespuestas.js';
import { Accion, accionValePara, type AccionData, type Pregunta } from './asistenteTipos.js';
import { guionVigente } from './guion.js';
import { automaticoDe, tramosDe } from './guionLotes.js';

// Es el de prioridad más alta (hay una persona esperando delante del chat). Hermes lee la pregunta, sus opciones
// y lo que escribió la persona, y responde con licitaciones_oferta_interpretar: una de las opciones o una
// decisión estructurada. Queda «por confirmar» en el hilo: nada se guarda sin que una persona lo confirme. Las
// preguntas de precio nunca llegan aquí (el importe no va a Hermes).
export const TIPO_INTERPRETAR = 'licitaciones.interpretar_respuesta';
export const PayloadInterpretar = z.object({
  id: z.string().min(3),
  mensaje: z.number().int().positive(),
  pregunta: z.string().min(1),
});
export type PayloadInterpretarData = z.infer<typeof PayloadInterpretar>;

/** Encola la lectura de un texto libre; un mismo mensaje no se encola dos veces. */
export function encolarInterpretacion(dbNucleo: DbNucleo, p: PayloadInterpretarData): Result<{ trabajo: number }> {
  const t = encolarUnico(dbNucleo, {
    tipo: TIPO_INTERPRETAR,
    dominio: 'licitaciones',
    base: base(p.id, p.mensaje),
    payload: p,
    aMano: true,
  });
  return ok({ trabajo: t.id });
}

/** ¿Llegó la interpretación (o se dio por fallida)? Es la comprobación «hecho» del trabajo. */
export function interpretacionRecibida(db: Db, p: PayloadInterpretarData): boolean {
  return mensajeDe(db, p.id, p.mensaje)?.estado !== 'interpretando';
}

const base = (id: string, mensaje: number) => `interpretar-${id}-${mensaje}`;

/**
 * Los textos libres cuya lectura acabó sin respuesta (el trabajo falló o se canceló) se dan por
 * fallidos, con un aviso en el hilo: si no, se quedarían «leyendo» para siempre.
 */
export function cerrarLecturasFallidas(dbLic: Db, dbNucleo: DbNucleo, id: string): void {
  for (const m of hiloDe(dbLic, id).filter((x) => x.tipo === 'libre' && x.estado === 'interpretando')) {
    const t = dbNucleo
      .prepare(`SELECT estado FROM trabajos_ia WHERE clave >= ? || '#' AND clave < ? || '$' ORDER BY id DESC LIMIT 1`)
      .get(base(id, m.id), base(id, m.id)) as { estado: string } | undefined;
    if (t?.estado !== 'fallido' && t?.estado !== 'cancelado') continue;
    cambiarEstado(dbLic, id, m.id, 'fallida');
    anotarHilo(dbLic, id, {
      pregunta: m.pregunta,
      autor: 'plataforma',
      tipo: 'error',
      texto: 'Hermes no pudo leerlo: elige una de las opciones o escríbelo de otra forma.',
    });
  }
}

// Las formas de decisión que valen para cada pregunta, para que Hermes no tenga que adivinarlas.
const FORMAS: Record<string, string> = {
  equipo:
    '{"tipo":"persona","persona_id":<id de Colaboradores>,"rol":"<rol>","lotes":["<lote>"]} o {"tipo":"contratar","rol":"<rol>","lotes":[…]}',
  incorporar: '{"tipo":"incorporar",…} (usa la opción) o {"tipo":"nombrar","rol":"<rol>","lotes":[…]}',
  automaticos:
    '{"tipo":"automatico","criterio":"<literal del guion>","lote":"<lote>"|null,"nos_acogemos":true|false,"tramo":"<descripción literal del tramo>"|null,"evidencia":"<con qué se acredita>"}',
  lotes: '{"tipo":"lotes","lotes":["<lote>",…]}',
  datos_anexo: '{"tipo":"dato_anexo","dato":"subcontratacion_servidores"|"impuesto"|"orden_lotes","valor":…}',
  enfoque: '{"tipo":"enfoque","texto":"…"}',
};

// Una persona va solo por su id: su nombre, su rol y lo que le falta salen de su CV, y los datos de
// CV no van en este run. Quien puede leer colaboradores la busca con colaboradores_ver.
const textoOpcion = (o: Pregunta['opciones'][number]): string =>
  o.accion?.tipo === 'persona'
    ? `la persona ${o.accion.persona_id} de Colaboradores`
    : `${o.texto}${o.detalle ? ` (${o.detalle})` : ''}`;
const lineasOpciones = (p: Pregunta): string =>
  p.opciones.map((o) => `   - «${o.clave}»: ${textoOpcion(o)}`).join('\n');

export async function instruccionesInterpretar(
  dbLic: Db,
  dbNucleo: DbNucleo,
  p: PayloadInterpretarData,
): Promise<string> {
  const m = mensajeDe(dbLic, p.id, p.mensaje);
  const ps = await preguntasDeOferta(dbLic, dbNucleo, p.id);
  const pregunta = ps.data?.preguntas.find((x) => x.clave === p.pregunta);
  const empresa = nombreEmpresa(dbNucleo);
  if (!m || !pregunta)
    return `Tarea automática de la plataforma de ${empresa}: la pregunta «${p.pregunta}» de la licitación ${p.id} ya no está. Llama a licitaciones_oferta_interpretar (id=${p.id}, mensaje=${p.mensaje}, entendido=false, repregunta="La pregunta cambió: vuelve a responder") y no hagas nada más.`;
  return [
    `Tarea automática de la plataforma de ${empresa}: una persona ha contestado con texto libre a una pregunta del asistente de la oferta. Interprétalo; no decidas tú.`,
    `Licitación ${p.id}. Pregunta «${pregunta.titulo}»: ${pregunta.texto}`,
    pregunta.citas.length
      ? `Citas del pliego: ${pregunta.citas.map((c) => `${c.documento}${c.pagina ? `, pág. ${c.pagina}` : ''}`).join(' · ')}.`
      : '',
    `Opciones:\n${lineasOpciones(pregunta)}`,
    `Lo que ha escrito: «${m.texto}»`,
    `1. Si lo que escribe es una de las opciones, llama a licitaciones_oferta_interpretar (id=${p.id}, mensaje=${p.mensaje}, entendido=true, opcion=<clave>, explicacion=<por qué, en una frase>).`,
    `2. Si es otra decisión de las que valen aquí, mándala en «accion» con esta forma: ${FORMAS[pregunta.seccion] ?? 'la de una de las opciones'}. Puedes consultar licitaciones_oferta (decisiones, guion) y, si puedes leer colaboradores, colaboradores_ver para saber quién es cada persona por su id.`,
    `3. Si no se entiende o falta algo, entendido=false y «repregunta» con lo que hay que aclarar, en una frase.`,
    'Si la herramienta responde con un error, corrige lo que indique y vuelve a enviarlo. No guardes decisiones ni hagas nada más: la persona confirma lo que entiendas.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const InterpretacionEntrada = z.strictObject({
  id: z.string().min(3).max(40).describe('Id de la licitación'),
  mensaje: z.number().int().positive().describe('El mensaje del hilo con el texto libre (lo dice la tarea)'),
  entendido: z.boolean(),
  opcion: z.string().trim().min(1).max(120).optional().describe('La clave de la opción que corresponde'),
  accion: Accion.optional().describe('Otra decisión de las que valen para la pregunta, si no es una opción'),
  explicacion: z.string().trim().min(3).max(600).optional().describe('Por qué lo entiendes así, en una frase'),
  repregunta: z.string().trim().min(3).max(600).optional().describe('Con entendido=false: qué hay que aclarar'),
});
export type InterpretacionEntradaData = z.infer<typeof InterpretacionEntrada>;

// Lo que el código puede comprobar de una decisión que no es una opción: la persona, el criterio y su tramo.
function comprobarAccion(dbLic: Db, dbNucleo: DbNucleo, id: string, a: AccionData): string | null {
  if (a.tipo === 'persona') {
    const p = obtenerPersona(dbNucleo, a.persona_id);
    return p.data?.activo ? null : `No hay ningún colaborador activo con id ${a.persona_id}.`;
  }
  if (a.tipo === 'automatico') {
    const g = guionVigente(dbLic, id);
    const crit = g ? automaticoDe(g.datos, a.criterio, a.lote) : undefined;
    if (!crit)
      return `El criterio «${a.criterio}» no está en el guion vigente${a.lote ? ` para el lote ${a.lote}` : ''}.`;
    if (
      a.nos_acogemos &&
      a.tramo !== null &&
      crit.tramos?.length &&
      !tramosDe(crit).some((t) => t.descripcion === a.tramo)
    )
      return `El tramo «${a.tramo}» no es ninguno de los del criterio: ${tramosDe(crit)
        .map((t) => `«${t.descripcion}»`)
        .join(', ')}.`;
  }
  return null;
}

function accionInterpretada(
  dbLic: Db,
  dbNucleo: DbNucleo,
  p: Pregunta,
  e: InterpretacionEntradaData,
): Result<{ accion: AccionData; opcion: string | null }> {
  if (e.opcion) {
    const o = p.opciones.find((x) => x.clave === e.opcion);
    if (!o || !o.accion || o.pide === 'importe')
      return fail(
        'invalid_input',
        `La opción «${e.opcion}» no es de esta pregunta: ${p.opciones
          .filter((x) => x.accion)
          .map((x) => `«${x.clave}»`)
          .join(', ')}.`,
      );
    return ok({ accion: o.accion, opcion: o.clave });
  }
  if (!e.accion) return fail('invalid_input', 'Con entendido=true manda «opcion» o «accion».');
  if (!accionValePara(p.seccion, e.accion))
    return fail(
      'invalid_input',
      `Para esta pregunta la decisión tiene que ser: ${FORMAS[p.seccion] ?? 'una de las opciones'}.`,
    );
  const problema = comprobarAccion(dbLic, dbNucleo, e.id, e.accion);
  return problema ? fail('invalid_input', problema) : ok({ accion: e.accion, opcion: null });
}

/** Lo que entendió Hermes de un texto libre: queda por confirmar en el hilo. */
export async function interpretarRespuesta(
  dbLic: Db,
  dbNucleo: DbNucleo,
  e: InterpretacionEntradaData,
  agente: string,
): Promise<Result<{ mensaje: number; estado: 'por_confirmar' | 'repregunta' }>> {
  const libre = mensajeDe(dbLic, e.id, e.mensaje);
  if (!libre || libre.tipo !== 'libre')
    return fail('not_found', `No hay ningún texto libre con id ${e.mensaje} en la licitación «${e.id}».`);
  if (libre.estado !== 'interpretando') return fail('conflicto', 'Ese texto ya está interpretado.');
  const ps = await preguntasDeOferta(dbLic, dbNucleo, e.id);
  const p = ps.data?.preguntas.find((x) => x.clave === libre.pregunta);
  if (!p) return fail('conflicto', 'La pregunta ya no está en la oferta: no hace falta interpretarla.');
  if (!e.entendido) {
    if (!e.repregunta) return fail('invalid_input', 'Con entendido=false di qué hay que aclarar en «repregunta».');
    cambiarEstado(dbLic, e.id, libre.id, 'interpretada');
    const m = anotarHilo(dbLic, e.id, {
      pregunta: p.clave,
      autor: 'hermes',
      tipo: 'interpretacion',
      texto: e.repregunta,
      datos: { titulo: p.titulo, repregunta: e.repregunta, libre: libre.id },
    });
    return ok({ mensaje: m.id, estado: 'repregunta' });
  }
  const a = accionInterpretada(dbLic, dbNucleo, p, e);
  if (a.error) return a;
  cambiarEstado(dbLic, e.id, libre.id, 'interpretada');
  const m = anotarHilo(dbLic, e.id, {
    pregunta: p.clave,
    autor: 'hermes',
    tipo: 'interpretacion',
    texto: describirAccion(dbNucleo, a.data.accion),
    estado: 'por_confirmar',
    datos: {
      titulo: p.titulo,
      seccion: p.seccion,
      opcion: a.data.opcion,
      accion: a.data.accion,
      explicacion: e.explicacion ?? `Interpretado por ${agente}`,
      libre: libre.id,
    },
  });
  return ok({ mensaje: m.id, estado: 'por_confirmar' });
}
