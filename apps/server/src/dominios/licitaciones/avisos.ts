// Avisos por email de Licitaciones: resumen semanal, plazo a 48 h, resolución de una presentada y búsquedas guardadas.
import type { Db as DbNucleo } from '../../nucleo/db.js';
import {
  anotarAviso,
  configResumen,
  enviarAviso,
  registrarAvisoPeriodico,
  registrarResumenSemanal,
  yaEnviado,
  type SeccionResumen,
} from '../../nucleo/avisos.js';
import { quienesQuieren, type Destinatario } from '../../nucleo/avisosPersona.js';
import type { BloqueCorreo, FilaCorreo } from '../../nucleo/correoPlantillas.js';
import { registrarCalendario, type EventoCalendario } from '../../nucleo/calendario.js';
import { registrarComentarios, type Entidad, type Recurso } from '../../nucleo/comentarios.js';
import { zonaEmpresa } from '../../nucleo/empresa.js';
import { escuchar } from '../../nucleo/eventos.js';
import { enHoraLocal, horaLocalEspana, instanteDeHoraEspana, type ZonaHoraria } from '../../nucleo/fechas.js';
import { logger } from '../../nucleo/log.js';
import { errorMessage } from '../../nucleo/result.js';
import { busquedasDe, marcarAvisadas, nuevasDeBusqueda, type BusquedaGuardada } from './busquedasGuardadas.js';
import { comprobacionesDe } from './oferta/comprobaciones.js';
import type { Bloqueo } from './oferta/comprobacionesTipos.js';
import { pendientesAprendizaje } from './oferta/aprendizajeVista.js';
import { licitacionesEnPreparacion, textoPlazo } from './oferta/plazo.js';
import { FiltroRevision, listaRevision, type ItemRevision } from './revision.js';
import type { Db } from './store.js';
import { tituloCorto } from './tituloCorto.js';
import { responsablesDe } from './responsable.js';

const log = logger('licitaciones');
const DIA_MS = 86_400_000;
// El resumen semanal lleva lo que cierra, las nuevas con mejor encaje, novedades y lecciones; el plazo a 48 h,
// lo que impide presentar o el precio sin decidir. Ningún aviso lleva importes, costes ni datos de CV; de las
// empresas, solo las que sigue la empresa y que no son personas.
const HORAS_URGENTE = 48;
const NUEVAS_EN_RESUMEN = 5;
const POR_BUSQUEDA = 10;

const enlaceFicha = (id: string) => `#/licitacion/${id}`;
// NIF de persona jurídica (empresa, administración…): el de una persona física no sale en un aviso.
const esEmpresa = (nif: string | null) => Boolean(nif && /^[ABCDEFGHJNPQRSUVW]/i.test(nif));
const cierre = (fecha: string | null, zona: ZonaHoraria) =>
  fecha ? `cierra ${textoPlazo(fecha, zona)}` : 'sin plazo publicado';

const filaDeItem =
  (zona: ZonaHoraria) =>
  (x: ItemRevision): FilaCorreo => ({
    texto: x.titulo_corto,
    enlace: enlaceFicha(x.id),
    detalle: [
      x.encaje?.valor != null ? `encaje ${x.encaje.valor}${x.encaje.elegible ? '' : ' (no elegible)'}` : null,
      cierre(x.fecha_limite, zona),
    ]
      .filter(Boolean)
      .join(' · '),
  });

// ─── Resumen semanal ─────────────────────────────────────────────────────────

function plazos(db: Db, ahoraMs: number): BloqueCorreo {
  const hasta = horaLocalEspana(ahoraMs + 7 * DIA_MS);
  const filas = licitacionesEnPreparacion(db, ahoraMs)
    .filter((l) => l.fecha_limite && l.fecha_limite <= hasta)
    .map((l) => ({
      texto: tituloCorto(l.titulo),
      detalle: cierre(l.fecha_limite, zonaEmpresa(db)),
      enlace: enlaceFicha(l.id),
    }));
  return {
    titulo: 'Cierran en los próximos 7 días',
    filas,
    vacio: 'Ninguna oferta en preparación cierra esta semana.',
  };
}

// En el orden de la lista: por encaje solo si la calibración lo da por bueno; si no, las que cierran antes.
function nuevas(db: Db, desdeMs: number, ahoraMs: number): BloqueCorreo {
  const r = listaRevision(
    db,
    FiltroRevision.parse({
      pestana: 'por_revisar',
      limite: NUEVAS_EN_RESUMEN,
      creada_desde: new Date(desdeMs).toISOString(),
    }),
    ahoraMs,
  );
  const titulo =
    r.orden === 'encaje'
      ? `Las ${NUEVAS_EN_RESUMEN} nuevas con mejor encaje`
      : `Las ${NUEVAS_EN_RESUMEN} nuevas que cierran antes`;
  return {
    titulo,
    filas: r.items.map(filaDeItem(zonaEmpresa(db))),
    vacio: 'Esta semana no ha entrado nada nuevo por revisar.',
  };
}

const RESULTADO: Record<string, string> = {
  ganada: 'Ganada',
  perdida: 'Perdida',
  desierta: 'Desierta',
  excluida: 'Excluida',
};

function novedades(db: Db, desdeMs: number): BloqueCorreo {
  const desde = new Date(desdeMs).toISOString();
  const resueltas = (
    db
      .prepare(
        `SELECT p.licitacion_id AS id, p.resultado, l.titulo FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id
    WHERE p.resuelta_en >= ? AND p.resultado IN ('ganada', 'perdida', 'desierta', 'excluida') ORDER BY p.resuelta_en`,
      )
      .all(desde) as { id: string; resultado: string; titulo: string }[]
  ).map((p) => ({
    texto: `${RESULTADO[p.resultado]}: ${tituloCorto(p.titulo)}`,
    detalle: 'Sube el acta para aprender de ella.',
    enlace: enlaceFicha(p.id),
  }));
  const competidores = (
    db
      .prepare(
        `SELECT a.adjudicatario_nif AS nif, MAX(a.adjudicatario_nombre) AS empresa, l.id, l.titulo FROM adjudicaciones a
      JOIN seguidos s ON s.tipo = 'competidor' AND s.nif = a.adjudicatario_nif JOIN licitaciones l ON l.id = a.licitacion_id
    WHERE a.fecha_ref >= ? GROUP BY l.id, a.adjudicatario_nif ORDER BY a.fecha_ref`,
      )
      .all(desde.slice(0, 10)) as { nif: string; empresa: string | null; id: string; titulo: string }[]
  )
    .filter((c) => esEmpresa(c.nif))
    .map((c) => ({
      texto: `${c.empresa ?? 'Un competidor que sigues'} ganó: ${tituloCorto(c.titulo)}`,
      enlace: enlaceFicha(c.id),
    }));
  const organismos = (
    db
      .prepare(
        `SELECT l.id, l.titulo, l.organo_nombre FROM licitaciones l JOIN seguidos s ON s.tipo = 'organismo' AND s.nif = l.organo_nif
    WHERE l.publicada_en >= ? AND l.borrada_en IS NULL ORDER BY l.publicada_en`,
      )
      .all(desde.slice(0, 10)) as { id: string; titulo: string; organo_nombre: string }[]
  ).map((o) => ({ texto: `${o.organo_nombre} publicó: ${tituloCorto(o.titulo)}`, enlace: enlaceFicha(o.id) }));
  return {
    titulo: 'Novedades de la semana',
    filas: [...resueltas, ...competidores, ...organismos],
    vacio: 'Ni resoluciones ni novedades de lo que sigues esta semana.',
  };
}

function lecciones(db: Db): BloqueCorreo {
  const n = pendientesAprendizaje(db);
  const filas = n
    ? [
        {
          texto: n === 1 ? '1 lección espera tu revisión' : `${n} lecciones esperan tu revisión`,
          enlace: '#/aprendizaje',
        },
      ]
    : [];
  return { titulo: 'Lecciones por revisar', filas, vacio: 'Ninguna lección espera revisión.' };
}

function seccionesResumen(db: Db, desdeMs: number, ahoraMs: number): SeccionResumen[] {
  return [
    { clave: 'plazos', bloque: plazos(db, ahoraMs) },
    { clave: 'nuevas', bloque: nuevas(db, desdeMs, ahoraMs) },
    { clave: 'novedades', bloque: novedades(db, desdeMs) },
    { clave: 'lecciones', bloque: lecciones(db) },
  ];
}

// ─── Plazo a 48 h ────────────────────────────────────────────────────────────

const NOMBRE_CATEGORIA: Record<string, string> = {
  elegibilidad: 'elegibilidad',
  decisiones: 'decisiones',
  coherencia: 'coherencia',
  fugas: 'fugas',
  documentos: 'documentos',
  empresa: 'datos de la empresa',
  firma: 'firma',
};
const abierto = (b: Bloqueo) => b.estado === 'abierto' || b.estado === 'propuesta';

/** Lo que falta para presentar, sin cifras ni nombres: el precio y cuántas cosas impiden, por categoría. */
export function queFalta(bloqueos: readonly Bloqueo[]): string | null {
  const vivos = bloqueos.filter(abierto);
  const precio = vivos.some((b) => b.categoria === 'precio');
  const impiden = vivos.filter((b) => b.gravedad === 'impide' && b.categoria !== 'precio');
  if (!precio && !impiden.length) return null;
  const categorias = [...new Set(impiden.map((b) => NOMBRE_CATEGORIA[b.categoria] ?? b.categoria))].join(', ');
  const cosas = impiden.length
    ? `${impiden.length === 1 ? '1 cosa que impide' : `${impiden.length} cosas que impiden`} presentar (${categorias})`
    : null;
  return [precio ? 'el precio sin decidir' : null, cosas].filter(Boolean).join(' y ');
}

// Una oferta a menos de 48 h sin nada que falte no se vuelve a mirar hasta pasado este rato: la
// vuelta pasa cada minuto y montar sus comprobaciones lee el expediente entero.
const REMIRAR_COMPROBACIONES_MS = 15 * 60_000;
const sinFaltas = new WeakMap<Db, Map<string, number>>();

// Lo que falta (lo que mira «mirar»), o null; sin nada que falte, null hasta que toque volver a mirar.
function faltaEn(db: Db, clave: string, ahoraMs: number, mirar: () => string | null): string | null {
  const vistas = sinFaltas.get(db) ?? new Map<string, number>();
  sinFaltas.set(db, vistas);
  if ((vistas.get(clave) ?? -Infinity) > ahoraMs) return null;
  const falta = mirar();
  if (falta) vistas.delete(clave);
  else vistas.set(clave, ahoraMs + REMIRAR_COMPROBACIONES_MS);
  return falta;
}

export type ComprobacionesDe = typeof comprobacionesDe;

export async function avisarPlazos(
  db: Db,
  dbNucleo: DbNucleo,
  ahoraMs: number,
  comprobaciones: ComprobacionesDe = comprobacionesDe,
): Promise<void> {
  for (const l of licitacionesEnPreparacion(db, ahoraMs)) {
    const plazo = l.fecha_limite ? instanteDeHoraEspana(l.fecha_limite) : null;
    if (plazo === null || plazo - ahoraMs > HORAS_URGENTE * 3_600_000) continue;
    const clave = `urgente:${l.id}:${l.fecha_limite}`;
    if (yaEnviado(dbNucleo, clave)) continue;
    const falta = faltaEn(db, clave, ahoraMs, () => {
      const c = comprobaciones(db, dbNucleo, l.id, ahoraMs);
      return c.data ? queFalta(c.data.bloqueos) : null;
    });
    if (!falta) continue;
    const titulo = tituloCorto(l.titulo);
    await enviarAviso(dbNucleo, {
      clave,
      tipo: 'plazo_urgente',
      para: quienesQuieren(dbNucleo, 'urgentes'),
      plantilla: {
        asunto: `Hermes: «${titulo}» cierra en menos de 48 h y falta algo`,
        titulo: `«${titulo}» cierra en menos de 48 horas`,
        intro: `Cierra ${textoPlazo(l.fecha_limite!, zonaEmpresa(dbNucleo))}. Falta ${falta}.`,
        bloques: [],
        boton: { texto: 'Abrir la oferta', enlace: `${enlaceFicha(l.id)}/oferta` },
      },
    });
  }
}

// ─── Resolución ──────────────────────────────────────────────────────────────

export async function avisarResolucion(
  db: Db,
  dbNucleo: DbNucleo,
  x: { id: string; propuesta: number; resultado: string },
): Promise<void> {
  const l = db.prepare('SELECT titulo FROM licitaciones WHERE id = ?').get(x.id) as { titulo: string } | undefined;
  if (!l || !RESULTADO[x.resultado]) return;
  const titulo = tituloCorto(l.titulo);
  await enviarAviso(dbNucleo, {
    clave: `resolucion:${x.propuesta}:${x.resultado}`,
    tipo: 'resolucion',
    para: quienesQuieren(dbNucleo, 'resoluciones'),
    plantilla: {
      asunto: `Hermes: ${RESULTADO[x.resultado]!.toLowerCase()} «${titulo}»`,
      titulo: `${RESULTADO[x.resultado]}: ${titulo}`,
      intro:
        'La PLACSP ha publicado el resultado. Sube el acta de la mesa y la memoria presentada para que Hermes aprenda de ella.',
      bloques: [],
      boton: { texto: 'Abrir la ficha', enlace: enlaceFicha(x.id) },
    },
  });
}

// ─── Búsquedas guardadas ─────────────────────────────────────────────────────

// Las búsquedas de una persona que tocan ahora: las diarias cada día y las semanales el día del
// resumen, desde su hora. La clave es por persona y día (o semana).
function deTurno(dbNucleo: DbNucleo, ahoraMs: number): { frecuencia: 'diaria' | 'semanal'; clave: string }[] {
  const cfg = configResumen(dbNucleo);
  const c = enHoraLocal(ahoraMs, zonaEmpresa(dbNucleo));
  if (c.hora < cfg.hora) return [];
  return [
    { frecuencia: 'diaria', clave: c.fecha },
    ...(c.dia === cfg.dia ? [{ frecuencia: 'semanal' as const, clave: c.semana }] : []),
  ];
}

async function avisarBusquedasDe(
  db: Db,
  dbNucleo: DbNucleo,
  d: Destinatario,
  turno: { frecuencia: 'diaria' | 'semanal'; clave: string },
  ahoraMs: number,
): Promise<void> {
  const clave = `busquedas:${turno.frecuencia}:${d.id}:${turno.clave}`;
  if (yaEnviado(dbNucleo, clave)) return;
  const busquedas = busquedasDe(db, d.id).filter((b) => b.activa && b.frecuencia === turno.frecuencia);
  const con = busquedas
    .map((b: BusquedaGuardada) => ({ b, n: nuevasDeBusqueda(db, b, b.avisada_hasta ?? b.creada_en, ahoraMs) }))
    .filter((x) => x.n.total > 0);
  marcarAvisadas(
    db,
    busquedas.map((b) => b.id),
    new Date(ahoraMs).toISOString(),
  );
  if (!con.length) {
    anotarAviso(dbNucleo, clave, 'busquedas');
    return;
  }
  const total = con.reduce((s, x) => s + x.n.total, 0);
  await enviarAviso(dbNucleo, {
    clave,
    tipo: 'busquedas',
    para: [d],
    plantilla: {
      asunto: `Hermes: ${total === 1 ? '1 nueva' : `${total} nuevas`} en tus búsquedas`,
      titulo: 'Nuevas en tus búsquedas guardadas',
      intro: 'Han entrado en Oportunidades y cumplen lo que buscas.',
      bloques: con.map((x) => ({
        titulo: `${x.b.nombre} · ${x.n.total === 1 ? '1 nueva' : `${x.n.total} nuevas`}`,
        filas: x.n.items.slice(0, POR_BUSQUEDA).map(filaDeItem(zonaEmpresa(dbNucleo))),
      })),
      boton: { texto: 'Abrir Oportunidades', enlace: '#/oportunidades' },
    },
  });
}

export async function avisarBusquedas(db: Db, dbNucleo: DbNucleo, ahoraMs: number): Promise<void> {
  const turnos = deTurno(dbNucleo, ahoraMs);
  if (!turnos.length) return;
  for (const d of quienesQuieren(dbNucleo, 'busquedas'))
    for (const t of turnos) await avisarBusquedasDe(db, dbNucleo, d, t, ahoraMs);
}

// ─── Calendario ──────────────────────────────────────────────────────────────

type FilaCalendario = {
  id: string;
  titulo: string;
  organo_nombre: string;
  fecha_limite: string | null;
  fecha_solicitud: string | null;
};

const enlaceDe = (l: FilaCalendario) => enlaceFicha(l.id);
const deFila =
  (l: FilaCalendario, zona: ZonaHoraria) =>
  (inicio: string, que: string, uid: string): EventoCalendario => ({
    uid: `${l.id}-${uid}`,
    titulo: `${que}: ${tituloCorto(l.titulo)}`,
    descripcion: `${l.organo_nombre}. ${que} ${textoPlazo(inicio, zona)}.`,
    inicio,
    enlace: enlaceDe(l),
  });

// Los hitos sin hacer de una oferta (los de sus comprobaciones), en hora peninsular como los plazos.
function hitosDeOferta(db: Db, dbNucleo: DbNucleo, l: FilaCalendario, ahoraMs: number): EventoCalendario[] {
  const c = comprobacionesDe(db, dbNucleo, l.id, ahoraMs);
  const de = deFila(l, zonaEmpresa(dbNucleo));
  return (c.data?.hitos ?? [])
    .filter((h) => h.estado !== 'hecho')
    .map((h) => de(horaLocalEspana(Date.parse(h.fecha)), `Hito «${h.titulo}»`, `hito-${h.clave}`));
}

/**
 * El calendario ICS de una persona: los plazos de las ofertas en preparación y los hitos de las que
 * lleva ella o no lleva nadie; un responsable dado de baja es «nadie», como en el Pipeline
 * (responsablesDe). Título, órgano y fecha, nada más.
 */
export function eventosCalendario(
  db: Db,
  dbNucleo: DbNucleo,
  usuarioId: number,
  ahoraMs = Date.now(),
): EventoCalendario[] {
  const ahora = horaLocalEspana(ahoraMs);
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo, l.organo_nombre, l.fecha_limite, l.fecha_solicitud FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'en_preparacion' AND l.borrada_en IS NULL`,
    )
    .all() as FilaCalendario[];
  const responsables = responsablesDe(
    db,
    filas.map((l) => l.id),
  );
  const zona = zonaEmpresa(dbNucleo);
  return filas.flatMap((l) => {
    const de = deFila(l, zona);
    const quien = responsables.get(l.id)?.id ?? null;
    const suya = quien === null || quien === usuarioId;
    return [
      ...(l.fecha_solicitud && l.fecha_solicitud >= ahora
        ? [de(l.fecha_solicitud, 'Solicitud de participación', 'solicitud')]
        : []),
      ...(l.fecha_limite ? [de(l.fecha_limite, 'Cierre', 'plazo')] : []),
      ...(suya && l.fecha_limite && l.fecha_limite > ahora ? hitosDeOferta(db, dbNucleo, l, ahoraMs) : []),
    ];
  });
}

// ─── Comentarios ─────────────────────────────────────────────────────────────

// La pestaña de la ficha donde vive cada sitio de comentarios.
const PESTANA: Record<Entidad, string> = { oferta: 'oferta', bloqueo: 'revision', requisito: 'requisitos' };

/** El título corto y los enlaces de una licitación para sus comentarios, o null si no existe. */
function recursoComentado(db: Db, id: string): Recurso | null {
  const l = db.prepare('SELECT titulo FROM licitaciones WHERE id = ?').get(id) as { titulo: string } | undefined;
  return l ? { titulo: tituloCorto(l.titulo), enlace: (entidad) => `${enlaceFicha(id)}/${PESTANA[entidad]}` } : null;
}

/** Lo que Licitaciones pone en los avisos por email y en el calendario; `bases` da las dos bases cuando hace falta. */
export function registrarAvisosLicitaciones(bases: () => { db: Db; dbNucleo: DbNucleo }): void {
  registrarComentarios('licitaciones', (id) => recursoComentado(bases().db, id));
  registrarCalendario('licitaciones', (usuarioId) => {
    const b = bases();
    return eventosCalendario(b.db, b.dbNucleo, usuarioId);
  });
  registrarResumenSemanal('licitaciones', (desdeMs, ahoraMs) => seccionesResumen(bases().db, desdeMs, ahoraMs));
  registrarAvisoPeriodico('licitaciones.plazos', (ms) => {
    const b = bases();
    return avisarPlazos(b.db, b.dbNucleo, ms);
  });
  registrarAvisoPeriodico('licitaciones.busquedas', (ms) => {
    const b = bases();
    return avisarBusquedas(b.db, b.dbNucleo, ms);
  });
  escuchar('licitacion.propuesta_resuelta', (e) => {
    if (e.datos['origen'] !== 'placsp' || !e.recurso) return;
    const b = bases();
    avisarResolucion(b.db, b.dbNucleo, {
      id: e.recurso,
      propuesta: Number(e.datos['propuesta']),
      resultado: String(e.datos['resultado']),
    }).catch((err: unknown) => log.error('aviso de resolución sin enviar', { error: errorMessage(err) }));
  });
}
