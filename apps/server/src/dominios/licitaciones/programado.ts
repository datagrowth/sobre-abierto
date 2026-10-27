// Lo que Licitaciones hace solo y cada cuánto, para la sección «Programado» de Estado.
import { nucleo } from '../../nucleo/contexto.js';
import { registrarProgramado, siguiente, ultimaVuelta, type Automatismo } from '../../nucleo/programado.js';
import { frenadoHasta } from '../../nucleo/colaFrenos.js';
import type { Db } from './store.js';
import { dbLicitaciones } from './db.js';
import { estadoIngesta } from './ingesta.js';
import { AVISO_SIN_PERFIL, hayPerfilCriba, TIPO_CRIBA } from './criba.js';
import { raicesActuales } from '../../nucleo/salidas.js';
import { resumenRegeneracion } from './fichaRegeneracion.js';
import { ultimaCobertura } from './cobertura.js';
import { resumenActasMercado } from './actasMercado.js';

export const VUELTA_RADAR = 'licitaciones.vuelta';
const DIA_MS = 86_400_000;

const masReciente = (fechas: (string | null | undefined)[]) =>
  fechas
    .filter((f): f is string => Boolean(f))
    .sort()
    .at(-1) ?? null;

function ingesta(): Automatismo {
  const { activo, syncMinutos } = nucleo().config.licitaciones;
  const e = estadoIngesta();
  const fuentes = Object.values(e.estado?.fuentes ?? {});
  const ultima = masReciente(fuentes.map((f) => f.ultima_vuelta));
  const error = e.error ?? fuentes.map((f) => f.ultimo_error).find(Boolean) ?? null;
  return {
    id: 'licitaciones.ingesta',
    dominio: 'licitaciones',
    nombre: 'Ingesta de la PLACSP',
    accion: 'sync',
    que_hace: 'Baja las licitaciones nuevas o cambiadas de la Plataforma de Contratación y les pasa el prefiltro.',
    cada: `${syncMinutos} min`,
    ultima,
    proxima: activo && e.activa ? siguiente(ultima, syncMinutos * 60_000) : null,
    estado: activo && e.activa ? 'activo' : 'parado',
    detalle: !activo ? 'Desactivada (LICITACIONES_ACTIVO=0).' : error,
  };
}

/** Candidatas que esperan lote y cuándo se creó el último, para saber cuándo toca cribar. */
export function colaCriba(db: Db): { esperando: number; ultimo_lote: string | null } {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM oportunidades WHERE estado = 'candidata' AND lote_criba IS NULL")
    .get() as { n: number };
  const { t } = db.prepare('SELECT MAX(creado_en) AS t FROM lotes_criba').get() as { t: string | null };
  return { esperando: n, ultimo_lote: t };
}

function criba(): Automatismo {
  const { config, db } = nucleo();
  const { cribasDia, loteCriba } = config.licitaciones;
  const { esperando, ultimo_lote } = colaCriba(dbLicitaciones());
  const frenado = frenadoHasta(db, TIPO_CRIBA);
  const sinHermes = !config.hermesLicitaciones;
  const sinPerfil = !hayPerfilCriba(raicesActuales().conocimiento);
  const parado = sinHermes || sinPerfil || cribasDia === 0;
  const proxima =
    parado || esperando === 0
      ? null
      : esperando >= loteCriba
        ? new Date().toISOString()
        : siguiente(ultimo_lote, DIA_MS / cribasDia);
  const detalle = sinHermes
    ? 'Sin perfil de Hermes configurado (HERMES_LICITACIONES_URL y _KEY).'
    : sinPerfil
      ? `${AVISO_SIN_PERFIL}.`
      : frenado
        ? `Frenada por fallos hasta ${frenado}; «Cribar ahora» la reactiva.`
        : `${esperando} ${esperando === 1 ? 'candidata espera' : 'candidatas esperan'} lote.`;
  return {
    id: 'licitaciones.criba',
    dominio: 'licitaciones',
    nombre: 'Criba con Hermes',
    accion: 'cribar',
    que_hace: `Junta las candidatas en lotes de hasta ${loteCriba} y Hermes decide si encajan con el perfil de licitaciones.`,
    cada: cribasDia
      ? `${cribasDia} ${cribasDia === 1 ? 'vez' : 'veces'} al día, o antes si se juntan ${loteCriba}`
      : 'nunca (LICITACIONES_CRIBAS_DIA=0)',
    ultima: ultimo_lote,
    proxima: frenado ? null : proxima,
    estado: parado ? 'parado' : frenado ? 'frenado' : 'activo',
    detalle,
  };
}

function vuelta(): Automatismo {
  const { activo, fichaAuto } = nucleo().config.licitaciones;
  const ultima = ultimaVuelta(VUELTA_RADAR);
  return {
    id: VUELTA_RADAR,
    dominio: 'licitaciones',
    nombre: 'Mantenimiento del radar',
    accion: null,
    que_hace: activo
      ? `Baja los pliegos de lo cribado (descarta lo que no tiene ninguno y lo recupera si los publican), ${fichaAuto ? 'pide a Hermes las fichas de lo que ya tiene pliegos, ' : ''}crea las carpetas de lo presentado y marca ganadas o perdidas con las adjudicaciones.`
      : 'Solo carpetas: crea las de lo presentado y sigue la reorganización (la ingesta está desactivada).',
    cada: '1 min',
    ultima,
    proxima: siguiente(ultima, 60_000),
    estado: 'activo',
    detalle: null,
  };
}

// Las fichas de una versión anterior del análisis, que se vuelven a pedir solas al desplegar.
function regeneracion(): Automatismo {
  const { config, db } = nucleo();
  const r = resumenRegeneracion(db, dbLicitaciones());
  const parado = !config.licitaciones.fichaAuto || !config.hermesLicitaciones;
  const estado = parado ? 'parado' : r.estado === 'pausada' ? 'en_pausa' : 'activo';
  const detalle = parado
    ? 'Necesita la ficha automática (LICITACIONES_FICHA_AUTO) y el perfil de Hermes.'
    : r.estado === 'hecha'
      ? `Hecha: ${r.encoladas} fichas pedidas de nuevo.`
      : `${r.encoladas} pedidas; quedan ${r.quedan}.`;
  return {
    id: 'licitaciones.regeneracion_fichas',
    dominio: 'licitaciones',
    nombre: `Fichas al día (análisis v${r.version})`,
    accion:
      r.estado === 'pausada' ? 'reanudar_regeneracion' : r.estado === 'hecha' || parado ? null : 'pausar_regeneracion',
    que_hace:
      'Vuelve a pedir a Hermes las fichas de lo que está en Nuevas o En preparación y en plazo que se hicieron con una versión anterior del análisis, primero las que vencen antes, hasta 5 a la vez.',
    cada: '1 min',
    ultima: ultimaVuelta(VUELTA_RADAR),
    proxima: r.estado === 'en_curso' && !parado ? siguiente(ultimaVuelta(VUELTA_RADAR), 60_000) : null,
    estado,
    detalle,
  };
}

// La auditoría de cobertura cuenta cada lunes la semana que acaba de cerrar (y repasa las 3 de antes).
function cobertura(): Automatismo {
  const ultima = ultimaCobertura(dbLicitaciones());
  return {
    id: 'licitaciones.cobertura',
    dominio: 'licitaciones',
    nombre: 'Auditoría de cobertura por comunidad',
    accion: null,
    que_hace:
      'Cuenta por comunidad autónoma las licitaciones de nuestro sector que trajo la PLACSP cada semana (agregada y perfiles) para compararlas con lo que publica cada plataforma autonómica. Solo informa.',
    cada: 'semanal',
    ultima,
    proxima: ultima ? siguiente(ultima, 7 * DIA_MS) : null,
    estado: 'activo',
    detalle: null,
  };
}

// Actas de expedientes ajenos: una cada diez minutos por código y, si no basta, Hermes con su tope.
function actasMercado(): Automatismo {
  const r = resumenActasMercado(dbLicitaciones());
  const { activo, actasMercadoDia } = nucleo().config.licitaciones;
  const leidas = (r.por_estado['leida'] ?? 0) + (r.por_estado['leida_hermes'] ?? 0);
  return {
    id: 'licitaciones.actas_mercado',
    dominio: 'licitaciones',
    nombre: 'Actas de expedientes ajenos',
    accion: null,
    que_hace: `Lee las actas y resoluciones de lo adjudicado en nuestro mercado con dos o más ofertas para saber quién se presentó, con qué importe y qué puntos. Primero por código; si no basta, Hermes (hasta ${actasMercadoDia} al día).`,
    cada: '10 min',
    ultima: r.ultima,
    proxima: activo ? siguiente(r.ultima, 10 * 60_000) : null,
    estado: activo ? 'activo' : 'parado',
    detalle: `${leidas} leídas, ${r.licitadores} licitadores; ${r.por_estado['sin_acta'] ?? 0} sin acta publicada.`,
  };
}

export function registrarProgramadoLicitaciones(): void {
  registrarProgramado('licitaciones.actas_mercado', actasMercado);
  registrarProgramado('licitaciones.cobertura', cobertura);
  registrarProgramado('licitaciones.regeneracion_fichas', regeneracion);
  registrarProgramado('licitaciones.ingesta', ingesta);
  registrarProgramado('licitaciones.criba', criba);
  registrarProgramado(VUELTA_RADAR, vuelta);
}
