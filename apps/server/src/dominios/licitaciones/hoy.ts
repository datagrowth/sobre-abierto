// Lo que aporta Licitaciones a «Hoy»: plazos, pendientes de una persona, novedades y ofertas en preparación.
import type { Db, FilaLicitacion } from './store.js';
import { pendientesAprendizaje } from './oferta/aprendizajeVista.js';
import { nucleo } from '../../nucleo/contexto.js';
import { logger } from '../../nucleo/log.js';
import type { HoyDominio, ItemHoy, ItemPreparacion } from '../../nucleo/hoy.js';
import { pendientesDeRevisar, plazos, retiradaDe, type Pendiente } from './oportunidades.js';
import { horaLocalEspana, instanteDeHoraEspana } from '../../nucleo/fechas.js';
import { licitacionesEnPreparacion } from './oferta/plazo.js';
import { comprobacionesDe } from './oferta/comprobaciones.js';
import { frenada, tareaTuya } from './oferta/mesa.js';
import { faltaDePreparacion } from './oferta/preparacion.js';
import { totalPorRevisar } from './pipeline.js';
import {
  completitudPliegos,
  faltanConAviso,
  type CompletitudPliegos,
  type DocumentoQueFalta,
} from './pliegosCompletitud.js';

const log = logger('licitaciones.hoy');
// Son los plazos de los próximos 7 días de lo que sigue la empresa; lo que espera a una persona (borradores y
// evaluaciones de Hermes, lo que sigue la empresa y la PLACSP anuló y lo que la empresa prepara con documentos
// publicados sin bajar); lo que llegó nuevo; y cada oferta en preparación con su cuenta atrás y lo que falta.
// Nada de lo descartado.
const DIAS_PLAZO = 7;
const MAX = 20;
const enlace = (id: string) => ({ seccion: 'licitaciones', vista: 'oportunidades', id });
// Lo que se revisa en la preparación abre la ficha directamente en esa sección.
const enlacePreparacion = (id: string) => ({
  seccion: 'licitaciones',
  vista: 'oportunidades',
  id: `${id}/preparacion`,
});

// En dos fases, primero vence la solicitud de participación: es la que avisa mientras no pase.
function vence(db: Db, ahoraMs: number): ItemHoy[] {
  const ahora = horaLocalEspana(ahoraMs);
  return plazos(db, DIAS_PLAZO, ahoraMs)
    .slice(0, MAX)
    .map((r) => {
      const solicitud = r.fecha_solicitud && r.fecha_solicitud >= ahora ? r.fecha_solicitud : null;
      return {
        tipo: 'plazo',
        titulo: r.titulo,
        detalle: solicitud ? `Solicitud de participación · ${r.organo}` : r.organo,
        fecha: solicitud ?? r.fecha_limite,
        importe: r.importe,
        enlace: enlace(r.id),
      };
    });
}

// El veredicto de la criba, como lo dice la web (no el valor interno).
const VEREDICTO: Record<string, string> = { interesa: 'Encaja', revisar: 'Encaja con dudas', descartar: 'No encaja' };

// Lo que sigue la empresa y la PLACSP retiró (p. ej. anulada) en el último mes: quien la llevaba tiene
// que enterarse y decidir (descartarla o buscar si la vuelven a publicar, con otro id).
const DIAS_RETIRADA = 30;
const QUE_HACER: Record<string, string> = {
  nueva: 'descártala o busca si la vuelven a publicar',
  en_preparacion: 'ya no se puede presentar: busca si la vuelven a publicar',
  presentada: 'la oferta presentada no sigue adelante',
};

function retiradas(db: Db, ahoraMs: number): ItemHoy[] {
  const desde = new Date(ahoraMs - DIAS_RETIRADA * 86_400_000).toISOString();
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo, l.organo_nombre, l.presupuesto_sin_iva, l.borrada_en, l.borrada_motivo, o.estado FROM oportunidades o
    JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.estado IN ('nueva', 'en_preparacion', 'presentada') AND l.borrada_en > ? ORDER BY l.borrada_en DESC LIMIT ?`,
    )
    .all(desde, MAX) as (Pick<
    FilaLicitacion,
    'id' | 'titulo' | 'organo_nombre' | 'presupuesto_sin_iva' | 'borrada_en' | 'borrada_motivo'
  > & { estado: string })[];
  return filas.map((f) => ({
    tipo: 'retirada',
    titulo: f.titulo,
    detalle: `${retiradaDe(f)?.etiqueta} en la PLACSP: ${QUE_HACER[f.estado] ?? 'revísala'}`,
    corto: `${retiradaDe(f)?.etiqueta ?? 'Retirada'} en la PLACSP`,
    fecha: f.borrada_en,
    importe: f.presupuesto_sin_iva,
    enlace: enlace(f.id),
  }));
}

// Qué es y dónde se revisa, para no tener que adivinarlo desde la bandeja.
const aItem = (p: Pendiente): ItemHoy => ({
  tipo: p.tipo,
  titulo: p.titulo,
  detalle: `${p.texto} · en ${p.donde}`,
  corto: p.corto,
  fecha: p.fecha,
  importe: null,
  enlace: enlacePreparacion(p.id),
});

const MAX_NOMBRES = 3;

function textoFaltan(faltan: DocumentoQueFalta[]): string {
  const nombres = faltan
    .slice(0, MAX_NOMBRES)
    .map((f) => `«${f.nombre}»`)
    .join(', ');
  const resto = faltan.length > MAX_NOMBRES ? ` y ${faltan.length - MAX_NOMBRES} más` : '';
  return `${faltan.length === 1 ? 'Falta un documento publicado' : `Faltan ${faltan.length} documentos publicados`} en Drive: ${nombres}${resto} · en Pliegos`;
}

// «No falta nada» no está comprobado: o los datos son de antes de leer los «Otros documentos»,
// o la revisión de la página del expediente falla (con su código) y lo comprobado caducó.
function textoSinComprobar(c: CompletitudPliegos): string {
  const error = c.expediente?.error;
  const motivo = error
    ? `la comprobación de la página del expediente falla (${error})`
    : 'datos anteriores a leer los «Otros documentos»';
  return `Sin comprobar si la PLACSP publica más documentos (${motivo}): revísalo en la PLACSP`;
}

// Lo que la empresa prepara con documentos publicados que no están en Drive (no se bajaron o fallan):
// un anexo con criterios o el modelo que hay que rellenar no puede faltar sin que se sepa.
function pliegosQueFaltan(db: Db, ahoraMs: number): ItemHoy[] {
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'en_preparacion' AND l.borrada_en IS NULL AND (l.fecha_limite IS NULL OR l.fecha_limite > ?)
    ORDER BY COALESCE(l.fecha_limite, '9999') LIMIT ?`,
    )
    .all(horaLocalEspana(ahoraMs), MAX) as { id: string; titulo: string }[];
  return filas.flatMap((f) => {
    const c = completitudPliegos(db, f.id, ahoraMs);
    const faltan = faltanConAviso(c);
    const sinComprobar = c?.sin_comprobar ? textoSinComprobar(c) : null;
    if (!faltan.length && !sinComprobar) return [];
    const detalle = [faltan.length ? textoFaltan(faltan) : null, sinComprobar].filter(Boolean).join(' · ');
    return [
      {
        tipo: 'pliegos',
        titulo: f.titulo,
        detalle,
        corto: faltan.length ? 'Faltan pliegos' : 'Pliegos sin comprobar',
        fecha: null,
        importe: null,
        enlace: enlace(`${f.id}/pliegos`),
      },
    ];
  });
}

function novedades(db: Db, desde: string): { items: ItemHoy[]; total: number } {
  const donde =
    "FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id WHERE o.estado = 'nueva' AND COALESCE(o.reaparecida_en, o.creada_en) > ?";
  const total = (db.prepare(`SELECT COUNT(*) AS n ${donde}`).get(desde) as { n: number }).n;
  const filas = db
    .prepare(
      `SELECT l.id, l.titulo, l.organo_nombre, l.presupuesto_sin_iva, COALESCE(o.reaparecida_en, o.creada_en) AS creada_en, o.veredicto_ia ${donde} ORDER BY 5 DESC LIMIT ?`,
    )
    .all(desde, MAX) as {
    id: string;
    titulo: string;
    organo_nombre: string;
    presupuesto_sin_iva: number | null;
    creada_en: string;
    veredicto_ia: string | null;
  }[];
  const items = filas.map((f) => ({
    tipo: 'nueva',
    titulo: f.titulo,
    detalle: [f.organo_nombre, f.veredicto_ia && `Hermes: ${VEREDICTO[f.veredicto_ia] ?? f.veredicto_ia}`]
      .filter(Boolean)
      .join(' · '),
    fecha: f.creada_en,
    importe: f.presupuesto_sin_iva,
    enlace: enlace(f.id),
  }));
  return { items, total };
}

// Lo que la empresa prepara y sigue en plazo, la que vence antes primero: cuánto queda (desde el
// instante del plazo en hora de Madrid, no desde el texto) y qué falta para presentarla.
function enPreparacion(db: Db, ahoraMs: number): ItemPreparacion[] {
  return licitacionesEnPreparacion(db, ahoraMs)
    .slice(0, MAX)
    .map((l) => {
      const vence = l.fecha_limite ? instanteDeHoraEspana(l.fecha_limite) : null;
      const falta = faltaDePreparacion(db, l.id, ahoraMs);
      return {
        tipo: 'preparacion',
        titulo: l.titulo,
        detalle: falta.length ? falta.join(' · ') : 'Todo preparado: falta presentarla',
        fecha: l.fecha_limite,
        importe: l.presupuesto_sin_iva,
        enlace: enlacePreparacion(l.id),
        vence_en: vence === null ? null : new Date(vence).toISOString(),
        restante_ms: vence === null ? null : vence - ahoraMs,
        falta,
      };
    });
}

// Las filas tuyas salen de las mismas comprobaciones y el mismo predicado que la Mesa, para que nunca digan
// cosas distintas; una oferta frenada (en «Decide hoy») suma una decisión: si se va. Una oferta sin
// comprobaciones que no se pueden leer no suma (queda en el log), no deja el menú sin cuenta.
function tuyoEnComprobaciones(db: Db, ahoraMs: number): { ids: string[]; decisiones: number } {
  const ids: string[] = [];
  let decisiones = 0;
  for (const l of licitacionesEnPreparacion(db, ahoraMs)) {
    const c = comprobacionesDe(db, nucleo().db, l.id, ahoraMs);
    if (c.error) {
      log.warn('hoy sin las comprobaciones de una oferta', { id: l.id, codigo: c.error.code });
      continue;
    }
    const n = c.data.bloqueos.filter(tareaTuya).length + (frenada(c.data) ? 1 : 0);
    if (n > 0) ids.push(l.id);
    decisiones += n;
  }
  return { ids, decisiones };
}

const cuantas = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// «19 decisiones tuyas en 3 ofertas · 2 avisos de la PLACSP»: lo que hay detrás del número del
// Pipeline en el menú, con las mismas cuentas.
function textoResumen(comprobaciones: { ids: string[]; decisiones: number }, avisos: number): string | undefined {
  const partes = [
    comprobaciones.decisiones
      ? `${cuantas(comprobaciones.decisiones, 'decisión tuya', 'decisiones tuyas')} en ${cuantas(comprobaciones.ids.length, 'oferta', 'ofertas')}`
      : null,
    avisos ? cuantas(avisos, 'aviso de la PLACSP', 'avisos de la PLACSP') : null,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : undefined;
}

// La cuenta del Pipeline en el menú son licitaciones, no tareas: cuántas tienes que abrir. Las que
// tienen algo tuyo en las comprobaciones (o están frenadas) y lo que la PLACSP retiró o publicó sin bajar
// (sin que las comprobaciones lo cuenten, pero pide a alguien); una con varias cosas, una vez. Lo que espera
// revisión (con las fichas por decidir) es la cuenta de Oportunidades.
export function hoyLicitaciones(db: Db, desde: string, ahoraMs = Date.now()): HoyDominio {
  const n = novedades(db, desde);
  const avisos = [...retiradas(db, ahoraMs), ...pliegosQueFaltan(db, ahoraMs)];
  const comprobaciones = tuyoEnComprobaciones(db, ahoraMs);
  const tareas = new Set([...comprobaciones.ids, ...avisos.map((a) => (a.enlace.id ?? '').split('/')[0])]).size;
  return {
    seccion: 'licitaciones',
    vence: vence(db, ahoraMs),
    por_aprobar: [...avisos, ...pendientesDeRevisar(db, MAX).map(aItem)],
    novedades: n.items,
    novedades_total: n.total,
    en_preparacion: enPreparacion(db, ahoraMs),
    tareas,
    resumen: textoResumen(comprobaciones, avisos.length),
    otras_cuentas: {
      oportunidades: totalPorRevisar(db, horaLocalEspana(ahoraMs)),
      aprendizaje: pendientesAprendizaje(db),
    },
  };
}
