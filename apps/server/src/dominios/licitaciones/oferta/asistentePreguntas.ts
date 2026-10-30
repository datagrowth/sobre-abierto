// Las preguntas del asistente de la oferta, por código y en el orden en que se decide.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { conLotes, TODOS_LOS_LOTES } from '../lotes.js';
import type { Db } from '../store.js';
import { contextoAsistente, recorte, type ContextoAsistente } from './asistenteContexto.js';
import { preguntasEquipo } from './asistenteEquipo.js';
import { preguntasAutomaticos, preguntasPrecio } from './asistentePrecio.js';
import type { Opcion, Pregunta, Preguntas } from './asistenteTipos.js';
import { datoDecidido, datosQuePide, ordenVigente, textosDeDocumentos, type DatoAnexo } from './datosAnexo.js';
import { problemasPorSeccion } from './decisionesSecciones.js';
import type { FilaDocumento } from './documentos.js';

// ── Lotes ──

// Orden: lotes, equipo por rol, precio por lote, criterios automáticos, datos que pide el anexo y enfoque. Salen
// de la lista cerrada de lo que las comprobaciones dan por pendiente: Hermes no inventa preguntas, y lo que ya
// se sabe por la ficha o los datos de empresa no se pregunta (sale hecho).
const MAX_OPCIONES_LOTE = 8;

function preguntaLotes(c: ContextoAsistente): Pregunta | null {
  const { lotes, ambito, presentacion } = c.lotes;
  if (!lotes.length) return null;
  const base = { clave: 'lotes', seccion: 'lotes' as const, lote: null, titulo: 'Lotes', citas: [] };
  if (presentacion?.codigo === TODOS_LOS_LOTES)
    return {
      ...base,
      texto: 'Hay que presentarse a todos los lotes.',
      opciones: [],
      libre: null,
      estado: 'hecha',
      respuesta: 'Todos los lotes',
    };
  if (ambito.origen === 'interes' && !ambito.error)
    return {
      ...base,
      texto: '¿A qué lotes vamos?',
      opciones: opcionesLotes(c),
      libre: 'codigo',
      estado: 'hecha',
      respuesta: ambito.descripcion,
    };
  const motivo =
    ambito.error ??
    (ambito.origen === 'prefiltro'
      ? `El prefiltro dejó ${conLotes('de', c.ambito).replace(/^de /, '')}, pero nadie lo ha confirmado.`
      : 'Aún no se han elegido los lotes.');
  return {
    ...base,
    texto: `${motivo} ¿A qué lotes vamos?`,
    opciones: opcionesLotes(c),
    libre: 'codigo',
    estado: 'pendiente',
    respuesta: null,
  };
}

function opcionesLotes(c: ContextoAsistente): Opcion[] {
  const { lotes, ambito } = c.lotes;
  const opcion = (clave: string, texto: string, ids: string[], detalle: string | null = null): Opcion => ({
    clave,
    texto,
    detalle,
    tono: 'neutro',
    hermes: false,
    accion: { tipo: 'lotes', lotes: ids },
  });
  return [
    ...(ambito.origen === 'prefiltro' && ambito.lotes.length > 1
      ? [
          opcion(
            'prefiltro',
            `Los del prefiltro: ${ambito.lotes.map((l) => l.id).join(', ')}`,
            ambito.lotes.map((l) => l.id),
          ),
        ]
      : []),
    ...lotes
      .slice(0, MAX_OPCIONES_LOTE)
      .map((l) => opcion(`lote-${l.id}`, `Solo el lote ${l.id}`, [l.id], l.nombre ? recorte(l.nombre, 90) : null)),
    ...(c.lotes.presentacion?.codigo === '1'
      ? []
      : [
          opcion(
            'todos',
            'Todos los lotes',
            lotes.map((l) => l.id),
          ),
        ]),
  ];
}

// ── Datos que pide el anexo ──

const DATOS: Record<
  DatoAnexo,
  { titulo: string; texto: string; opciones: { clave: string; texto: string; valor: unknown }[] }
> = {
  subcontratacion_servidores: {
    titulo: 'Subcontratación',
    texto: 'El anexo pregunta si se subcontratan los servidores o el alojamiento. ¿Lo subcontratamos?',
    opciones: [
      { clave: 'si', texto: 'Sí, se subcontratan', valor: true },
      { clave: 'no', texto: 'No', valor: false },
    ],
  },
  impuesto: {
    titulo: 'Impuesto de la oferta',
    texto: 'El anexo pide el impuesto que va aparte del precio. ¿Cuál es?',
    opciones: [
      { clave: 'iva', texto: 'IVA al 21 %', valor: { tipo: 'IVA', porcentaje: 21 } },
      { clave: 'igic', texto: 'IGIC al 7 %', valor: { tipo: 'IGIC', porcentaje: 7 } },
      { clave: 'exento', texto: 'Exento', valor: { tipo: 'exento', porcentaje: null } },
    ],
  },
  orden_lotes: {
    titulo: 'Orden de preferencia de los lotes',
    texto: 'El anexo pide el orden de preferencia de los lotes, por si solo nos adjudican algunos. ¿En qué orden?',
    opciones: [],
  },
};

function filasDocumentos(c: ContextoAsistente): Pick<FilaDocumento, 'clave' | 'nombre' | 'sustituciones'>[] {
  return c.dbLic
    .prepare('SELECT clave, nombre, sustituciones FROM oferta_documentos WHERE licitacion_id = ?')
    .all(c.id) as Pick<FilaDocumento, 'clave' | 'nombre' | 'sustituciones'>[];
}

function respuestaDato(c: ContextoAsistente, dato: DatoAnexo): string | null {
  if (!datoDecidido(c.d, dato)) return null;
  if (dato === 'orden_lotes') return ordenVigente(c.d)?.join(', ') ?? null;
  const v = c.d.datos_anexo?.[dato];
  if (dato === 'subcontratacion_servidores') return v ? 'Sí' : 'No';
  const i = v as { tipo: string; porcentaje: number | null };
  return i.tipo === 'exento' ? 'Exento' : `${i.tipo} al ${i.porcentaje ?? '?'} %`;
}

function preguntasDatosAnexo(c: ContextoAsistente): Pregunta[] {
  return datosQuePide(c.guion.datos, textosDeDocumentos(filasDocumentos(c))).map((p): Pregunta => {
    const def = DATOS[p.dato];
    const orden =
      p.dato === 'orden_lotes'
        ? [
            {
              clave: 'en-orden',
              texto: `En el orden de los lotes: ${[...c.d.lotes].join(', ')}`,
              valor: [...c.d.lotes],
            },
          ]
        : [];
    const opciones = [...def.opciones, ...orden].map((o): Opcion => ({
      clave: o.clave,
      texto: o.texto,
      detalle: null,
      tono: 'neutro',
      hermes: false,
      accion: { tipo: 'dato_anexo', dato: p.dato, valor: o.valor },
    }));
    const respuesta = respuestaDato(c, p.dato);
    return {
      clave: `dato_anexo:${p.dato}`,
      seccion: 'datos_anexo',
      lote: null,
      titulo: def.titulo,
      texto: def.texto,
      citas: [{ documento: p.cita.documento, pagina: p.cita.pagina, texto: p.cita.texto }],
      opciones,
      libre: p.dato === 'orden_lotes' ? 'codigo' : null,
      estado: respuesta ? 'hecha' : 'pendiente',
      respuesta,
    };
  });
}

// ── Enfoque ──

const SIN_INDICACIONES =
  'Sin indicaciones del equipo: plantea tú el enfoque en la estrategia, con lo que pide el pliego.';

function preguntaEnfoque(c: ContextoAsistente): Pregunta | null {
  if (!c.guion.datos.memoria) return null;
  const propuesto = c.propuesta?.enfoque.trim() ?? '';
  const opciones: Opcion[] = [
    ...(propuesto
      ? [
          {
            clave: 'hermes',
            texto: 'Usar el que propone Hermes',
            detalle: recorte(propuesto, 160),
            tono: 'neutro' as const,
            hermes: true,
            accion: { tipo: 'enfoque' as const, texto: propuesto },
          },
        ]
      : []),
    {
      clave: 'sin',
      texto: 'Sin indicaciones: que lo plantee Hermes',
      detalle: null,
      tono: 'neutro',
      hermes: false,
      accion: { tipo: 'enfoque', texto: SIN_INDICACIONES },
    },
  ];
  const enfoque = c.d.enfoque.trim();
  return {
    clave: 'enfoque',
    seccion: 'enfoque',
    lote: null,
    titulo: 'Enfoque de la memoria',
    citas: [],
    texto:
      'Enfoque de la memoria: qué quieres que destaque, qué no prometer y cualquier indicación para quien redacta. Escríbelo o elige una opción.',
    opciones,
    libre: 'codigo',
    estado: enfoque ? 'hecha' : 'pendiente',
    respuesta: enfoque ? recorte(enfoque, 80) : null,
  };
}

// ── Todas ──

async function todas(c: ContextoAsistente): Promise<Pregunta[]> {
  return [
    ...[preguntaLotes(c)].filter((p): p is Pregunta => p !== null),
    ...(await preguntasEquipo(c)),
    ...preguntasPrecio(c),
    ...preguntasAutomaticos(c),
    ...preguntasDatosAnexo(c),
    ...[preguntaEnfoque(c)].filter((p): p is Pregunta => p !== null),
  ];
}

// Lo que no cuadra en lo ya decidido (una persona dada de baja, un lote al que no se va); el precio
// y los criterios no, porque lo que les falta ya sale como pregunta.
function avisosDe(c: ContextoAsistente): string[] {
  const por = c.guardadas
    ? problemasPorSeccion({ dbLic: c.dbLic, dbNucleo: c.dbNucleo, id: c.id, guion: c.guion }, c.d, true)
    : null;
  const problemas = por ? [...por.lotes, ...por.equipo, ...por.a_incorporar, ...por.enfoque] : [];
  return [
    ...(c.guardadas && c.guardadas.guion_id !== c.guion.id
      ? ['Las decisiones son de un guion anterior: revisa las respuestas antes de generar los documentos.']
      : []),
    ...(c.ficha ? [] : ['La ficha aún no está aprobada: el equipo se pregunta cuando estén sus requisitos.']),
    ...problemas,
  ];
}

/** Las preguntas de la oferta con su estado. Sin guion vigente no hay nada que preguntar todavía. */
export async function preguntasDeOferta(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs = Date.now(),
): Promise<Result<Preguntas>> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const c = contextoAsistente(dbLic, dbNucleo, id, ahoraMs);
  if (!c)
    return ok({
      id,
      estado: 'sin_guion',
      preguntas: [],
      hechas: 0,
      total: 0,
      avisos: ['Hermes aún está preparando el guion de la oferta: las preguntas salen de él.'],
      version: null,
    });
  const preguntas = await todas(c);
  const hechas = preguntas.filter((p) => p.estado === 'hecha').length;
  return ok({
    id,
    estado: hechas === preguntas.length ? 'listas' : 'preguntando',
    preguntas,
    hechas,
    total: preguntas.length,
    avisos: avisosDe(c),
    version: c.guardadas?.version ?? null,
  });
}
