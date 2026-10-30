// Formato de HermesEnVivo en las comprobaciones, sin React para poder
// probarlo. Lo que dice cada línea sale del servidor (GET /oferta/hermes): el `nombre` legible,
// la posición, la hora estimada por mediana y «más de lo normal»; aquí solo se pone en palabras.
// Sin hora estimada (pocos runs de ese tipo) la línea no enseña hora: mejor nada que inventarla.
import { plural, segundaHora } from './formato.js';
import { ETIQUETA_FASE, textoEta } from './comprobacionesFormato.js';
import { causaFallo } from './licitacionesFormato.js';

// Los mismos intentos que la cola del servidor (MAX_INTENTOS de nucleo/trabajos.ts).
const MAX_INTENTOS = 3;
const PREFIJO = 'licitaciones.';
const HORA_MADRID = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// La espera normal en la cola (`cola`) y el reintento (lo cuenta el fallo) no llevan frase.
const ESPERA = {
  pausa_limite: 'espera al uso del modelo',
  freno: 'frenado tras varios fallos',
  espera_herramienta: 'espera a que se reinicie Hermes',
  tope_oferta: 'espera: tope de runs de hoy',
  plazo_cercano: 'espera: el plazo está cerca',
  sin_perfil: 'sin perfil de Hermes configurado',
};

function hora(iso) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return null;
  const h = HORA_MADRID.format(new Date(t));
  return segundaHora(h) ? `${h} (${segundaHora(h)} Canarias)` : h;
}

/** El tipo de la ruta de relanzar: «licitaciones.ficha» → «ficha». */
export const tipoCorto = (tipo) =>
  String(tipo ?? '').startsWith(PREFIJO) ? String(tipo).slice(PREFIJO.length) : String(tipo ?? '');

/** «falló 2 de 3: Hermes acabó sin dejar el resultado; reintento a las 16:05» (y la hora de Canarias si la empresa está allí), o null si no ha fallado. */
export function textoFallo(t) {
  if (!t?.codigo || !(t.intentos > 0)) return null;
  const cuando = hora(t.proximo_intento_en);
  return `falló ${t.intentos} de ${MAX_INTENTOS}: ${causaFallo(t.codigo)}${cuando ? `; reintento a las ${cuando}` : ''}`;
}

/**
 * «Relanzar» solo cuando un run en marcha pasó el percentil del servidor (`mas_de_lo_normal`) y
 * no ha avanzado desde la hora estimada: su último paso (`desde`) es anterior a eta.hasta.
 */
export function puedeRelanzar(t) {
  if (t?.estado !== 'generando' || !t.mas_de_lo_normal || !t.eta?.hasta) return false;
  const paso = Date.parse(t.desde ?? '');
  return !Number.isNaN(paso) && paso <= Date.parse(t.eta.hasta);
}

function posicion(t) {
  if (t.estado === 'generando') return 'en marcha';
  return t.posicion > 0 ? `${t.posicion}.ª en cola` : 'en cola';
}

function textoLinea(t) {
  const partes = [
    t.nombre ?? tipoCorto(t.tipo),
    t.ronda && t.rondas ? `ronda ${t.ronda}/${t.rondas}` : null,
    textoEta(t.eta),
    posicion(t),
    t.mas_de_lo_normal ? 'más de lo normal' : null,
    ESPERA[t.motivo_espera] ?? null,
    // Lo pidió un agente (licitaciones_pedir), no una persona ni la cadena.
    t.pedido_por_hermes ? 'pedido por Hermes' : null,
  ];
  return partes.filter(Boolean).join(' · ');
}

/** Una línea por trabajo vivo de la oferta: { id, tipo, texto, fallo, relanzable, sesion }. */
export function lineasEnVivo(hermes) {
  return (hermes?.trabajos ?? []).map((t) => ({
    id: t.id,
    tipo: tipoCorto(t.tipo),
    nombre: t.nombre ?? tipoCorto(t.tipo),
    texto: textoLinea(t),
    fallo: textoFallo(t),
    relanzable: puedeRelanzar(t),
    sesion: t.sesion ?? null,
  }));
}

/** «3 de 12 runs hoy en esta oferta» (y las propuestas automáticas, si ya hubo alguna), o null sin runs. */
export function textoTopes(hermes) {
  if (!hermes || !(hermes.runs_hoy > 0)) return null;
  const runs = `${hermes.runs_hoy} de ${plural(hermes.tope_runs, 'run')} hoy en esta oferta`;
  const props =
    hermes.propuestas_auto_hoy > 0
      ? ` · ${hermes.propuestas_auto_hoy} de ${hermes.tope_propuestas} propuestas automáticas`
      : '';
  return runs + props;
}

/** Lo que frena a Hermes en esta oferta: la pausa por uso del modelo y los frenos por tipo. */
export function textosFreno(hermes) {
  const pausa = hora(hermes?.pausa_hasta);
  const frenos = (hermes?.frenos ?? []).map(
    (f) =>
      `${f.nombre} frenado hasta las ${hora(f.hasta) ?? '—'}${f.alcance === 'tipo' ? ' (en todas las ofertas)' : ''}`,
  );
  return [...(pausa ? [`Hermes espera al uso del modelo hasta las ${pausa}`] : []), ...frenos];
}

/**
 * El freno de elegibilidad: Hermes no redacta la memoria ni los anexos mientras haya
 * filas de elegibilidad sin decidir. Devuelve { texto, bloqueos } o null si la cadena no está frenada.
 */
export function frenoElegibilidad(hermes) {
  const f = hermes?.freno_elegibilidad;
  const bloqueos = f?.frenada ? (f.bloqueos ?? []) : [];
  if (!bloqueos.length) return null;
  return { texto: 'Hermes no redacta la memoria ni los anexos hasta que decidas:', bloqueos };
}

/** ¿Hay algo que enseñar? Sin trabajos, fallos, frenos ni runs hoy, HermesEnVivo no ocupa sitio. */
export function hayEnVivo(hermes) {
  return Boolean(
    hermes &&
    ((hermes.trabajos ?? []).length ||
      hermes.ultimo_fallo ||
      textosFreno(hermes).length ||
      textoTopes(hermes) ||
      frenoElegibilidad(hermes)),
  );
}

// El servidor ya deja fuera de ultimo_fallo las esperas (uso del modelo, reinicio) y los relanzados a mano.
const claveFallo = (h) => (h?.ultimo_fallo ? `${h.ultimo_fallo.tipo}|${h.ultimo_fallo.en}` : null);

/**
 * Lo que merece aviso del navegador entre unas comprobaciones y la siguiente ({ fases, hermes }): una
 * fase que pasa a «te toca» o un fallo nuevo. Sin comprobaciones anteriores (la primera carga) no se avisa.
 */
export function cambiosQueAvisan(antes, despues) {
  if (!antes || !despues) return [];
  const previo = new Map((antes.fases ?? []).map((f) => [f.nombre, f.estado]));
  const toca = (despues.fases ?? [])
    .filter((f) => f.estado === 'te_toca' && previo.get(f.nombre) !== 'te_toca')
    .map((f) => ({ tipo: 'te_toca', texto: `Te toca: ${ETIQUETA_FASE[f.nombre] ?? f.nombre}` }));
  const fallo = despues.hermes?.ultimo_fallo;
  const nuevo = fallo && claveFallo(despues.hermes) !== claveFallo(antes.hermes);
  const aviso = nuevo ? [{ tipo: 'fallo', texto: `${fallo.nombre}: ${fallo.texto}` }] : [];
  return [...toca, ...aviso];
}
