// Formato de las comprobaciones de una oferta, sin React para poder probarlo: etiquetas,
// qué filas siguen abiertas y en qué orden, qué botones lleva cada una y los textos de hora y
// minutos. El orden y las reglas de las acciones son los del servidor (comprobacionesTipos.ts y
// comprobacionesBloqueos.ts): si la web ofreciera otra cosa, el servidor la rechazaría.
import { diaEn, euros, fechaCorta, plural, segundaHora } from './formato.js';
import { pedidoSuavizar } from './resumenMemoriaFormato.js';

const ORDEN_CATEGORIAS = [
  'elegibilidad',
  'precio',
  'decisiones',
  'coherencia',
  'fugas',
  'documentos',
  'empresa',
  'firma',
  'plazo',
];

const ETIQUETA_CATEGORIA = {
  elegibilidad: 'Elegibilidad',
  precio: 'Precio',
  decisiones: 'Decisiones',
  coherencia: 'Coherencia',
  fugas: 'Fugas entre sobres',
  documentos: 'Documentos',
  empresa: 'Datos de empresa',
  firma: 'Firma y envío',
  plazo: 'Hitos del plazo',
};

export const ETIQUETA_FASE = {
  decidir: 'Decidir',
  pliegos: 'Pliegos',
  guion: 'Guion',
  decisiones: 'Decisiones',
  memoria: 'Memoria',
  documentos: 'Documentos',
  paquete: 'Paquete',
  presentar: 'Presentar',
};

export const ETIQUETA_ACTOR = {
  tu: 'Tú',
  hermes: 'Hermes trabajando',
  negocio: 'Decisión de negocio',
  fuera: 'Fuera de Hermes',
};

const MOTIVO_MINIMO = 15;
const ERROR_MOTIVO = `Explica en una frase el motivo (al menos ${MOTIVO_MINIMO} caracteres).`;
// El servidor corta en 500 (forzar_motivo, motivo de una fila): mejor decirlo aquí en español
// que enseñar su error de validación.
const MOTIVO_MAXIMO = 500;
const ERROR_MOTIVO_LARGO = `El motivo es demasiado largo: resúmelo en ${MOTIVO_MAXIMO} caracteres como mucho.`;

// Lo que la persona ya decidió (o el servidor dio por bueno) deja de pedirle nada.
const ESTADOS_CERRADOS = new Set(['resuelto', 'riesgo_aceptado', 'vamos']);
const PESO_GRAVEDAD = { impide: 0, riesgo: 1, no_comprobado: 2, ok: 3 };

const cerrado = (b) => ESTADOS_CERRADOS.has(b.estado);

function comparar(a, b) {
  return (
    ORDEN_CATEGORIAS.indexOf(a.categoria) - ORDEN_CATEGORIAS.indexOf(b.categoria) ||
    (PESO_GRAVEDAD[a.gravedad] ?? 9) - (PESO_GRAVEDAD[b.gravedad] ?? 9) ||
    (a.lote ?? '').localeCompare(b.lote ?? '', 'es', { numeric: true })
  );
}

/** Las filas que impiden o arriesgan y nadie ha decidido aún, en el orden fijo de las comprobaciones. */
export function bloqueosAbiertos(c) {
  return (c?.bloqueos ?? [])
    .filter((b) => (b.gravedad === 'impide' || b.gravedad === 'riesgo') && !cerrado(b))
    .sort(comparar);
}

/** Lo que Hermes no pudo comprobar (falta un dato): se enseña aparte, nunca como «ok». */
export function noComprobados(c) {
  return (c?.bloqueos ?? []).filter((b) => b.gravedad === 'no_comprobado' && !cerrado(b)).sort(comparar);
}

export function primerBloqueo(c) {
  return bloqueosAbiertos(c)[0] ?? null;
}

const ACCION = {
  aplicar_propuesta: { accion: 'aplicar_propuesta', texto: 'Aplicar la propuesta', conMotivo: false },
  vamos: { accion: 'vamos', texto: 'Vamos', conMotivo: true },
  aceptar_riesgo: { accion: 'aceptar_riesgo', texto: 'Aceptar el riesgo con motivo', conMotivo: true },
  descartar: { accion: 'descartar', texto: 'Descartar con motivo', conMotivo: true },
};

/**
 * Los botones de estado de una fila. «Vamos» solo en elegibilidad (allí sustituye a aceptar el
 * riesgo); aceptar el riesgo, solo en riesgo y no comprobado. Nunca hay «aceptar todo»: las
 * filas de elegibilidad y acreditación se confirman una a una con su evidencia.
 */
export function accionesDeEstado(b) {
  if (!b || cerrado(b)) return [];
  const elegibilidad = b.categoria === 'elegibilidad';
  const r = [];
  if (b.estado === 'propuesta' && b.propuesta) r.push(ACCION.aplicar_propuesta);
  if (elegibilidad) r.push(ACCION.vamos);
  if (!elegibilidad && (b.gravedad === 'riesgo' || b.gravedad === 'no_comprobado')) r.push(ACCION.aceptar_riesgo);
  if (elegibilidad || b.gravedad === 'impide') r.push(ACCION.descartar);
  return r;
}

/** El motivo de «Vamos», aceptar un riesgo o descartar: una frase, no un «ok». */
export function leerMotivo(texto) {
  const motivo = String(texto ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (motivo.length < MOTIVO_MINIMO) return { motivo: null, error: ERROR_MOTIVO };
  if (motivo.length > MOTIVO_MAXIMO) return { motivo: null, error: ERROR_MOTIVO_LARGO };
  return { motivo, error: null };
}

const HORA_MADRID = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// Las comprobaciones dan «HH:MM» peninsular; la cola (colaEta) da instantes ISO: los dos valen.
function horaPeninsular(valor) {
  if (/^\d{2}:\d{2}$/.test(String(valor ?? ''))) return valor;
  const t = Date.parse(valor);
  return Number.isNaN(t) ? null : HORA_MADRID.format(new Date(t));
}

/** «lista entre 15:50 y 16:40» y, si la empresa está en Canarias, «(14:50-15:40 Canarias)»; null sin hora estimada. */
export function textoEta(eta) {
  const desde = horaPeninsular(eta?.desde);
  const hasta = horaPeninsular(eta?.hasta);
  if (!desde || !hasta) return null;
  const canarias = segundaHora(desde) ? ` (${segundaHora(desde)}-${segundaHora(hasta)} Canarias)` : '';
  return `lista entre ${desde} y ${hasta}${canarias}`;
}

/** «unos 6 min tuyos»; sin nada que hacer, null (las comprobaciones no prometen minutos que no hay). */
export function textoMinutos(n) {
  const min = Math.ceil(Number(n) || 0);
  return min > 0 ? `unos ${min} min tuyos` : null;
}

/** Una oferta descartada se ve, pero no se toca. */
export function esSoloLectura(c) {
  return c?.veredicto?.tipo === 'descartada';
}

/** Un evento de la plataforma es de esta licitación si lo dice su recurso o sus datos. */
export function esEventoDe(detalle, id) {
  if (!id || !detalle) return false;
  return detalle.recurso === id || detalle.datos?.id === id;
}

/**
 * Cómo se pintan las comprobaciones: «solo_lectura» si está descartada (se ve, solo se recupera), «decidir»
 * con la ficha por revisar (aún no hay oferta: solo la fase Decidir y sus excluyentes) y, si
 * no, «completa».
 */
export function modoComprobaciones(f, c) {
  if (f?.estado === 'descartada' || esSoloLectura(c)) return 'solo_lectura';
  if (f?.estado === 'ficha_por_revisar') return 'decidir';
  return 'completa';
}

/** Las filas que enseña cada modo: en «decidir», solo la elegibilidad. */
export function filasDeModo(c, modo) {
  const abiertas = bloqueosAbiertos(c);
  const sin = noComprobados(c);
  if (modo !== 'decidir') return { abiertas, noComprobadas: sin };
  const deDecidir = (b) => b.categoria === 'elegibilidad';
  return { abiertas: abiertas.filter(deDecidir), noComprobadas: sin.filter(deDecidir) };
}

/**
 * La marca de la fila. Una fuga «riesgo» es un eco (el mismo dato aparece en otro sobre, pero
 * puede no ser una fuga): «Sospecha», no «Riesgo», para que no se lea como algo seguro.
 */
export function marcaGravedad(b) {
  if (b?.gravedad === 'impide') return { texto: 'Impide', tono: 'peligro' };
  if (b?.gravedad === 'riesgo') return { texto: b.categoria === 'fugas' ? 'Sospecha' : 'Riesgo', tono: 'aviso' };
  if (b?.gravedad === 'no_comprobado') return { texto: 'Sin comprobar', tono: 'neutro' };
  return { texto: 'Bien', tono: 'bien' };
}

// Los tipos que abren el dato que hay que tocar (el cajón de la). Los de estado (vamos,
// aceptar_riesgo, descartar) van por accionesDeEstado; esperar_hermes no pide nada a la persona.
const TEXTO_ACCION = {
  fijar_precio: 'Fijar el precio',
  asignar_rol: 'Asignar al rol',
  desmarcar_criterio: 'Desmarcar el criterio',
  subir_certificado: 'Subir certificado',
  consulta_organo: 'Preparar consulta al órgano',
  completar_empresa: 'Completar en Ajustes › Empresa',
  aplicar_diff: 'Ver la propuesta',
  revisar_memoria: 'Revisar la memoria',
  preparar_documento: 'Preparar el documento',
  rehacer_anexo: 'Rehacer el anexo',
  campo: 'Decidir el dato',
  abrir: 'Abrir',
  // El botón principal de una fila con coste es «Suavizar» (FilaBloqueo); este solo enseña dónde está.
  suavizar: 'Ver en la memoria',
};
const SIN_BOTON = new Set(['vamos', 'aceptar_riesgo', 'descartar', 'esperar_hermes']);

/** El texto del botón de dato de una fila, o null si esa acción no abre nada. */
export function textoAccionDato(accion) {
  const tipo = accion?.tipo;
  if (!tipo || SIN_BOTON.has(tipo)) return null;
  return TEXTO_ACCION[tipo] ?? 'Abrir';
}

/** «3 impiden · 1 riesgo» de las filas abiertas. */
export function recuentoBloqueos(filas) {
  const impiden = filas.filter((b) => b.gravedad === 'impide').length;
  const riesgos = filas.length - impiden;
  return `${impiden} ${impiden === 1 ? 'impide' : 'impiden'} · ${plural(riesgos, 'riesgo')}`;
}

/** Las filas por categoría, en el orden en que llegan (el de bloqueosAbiertos). */
export function agruparPorCategoria(filas) {
  const grupos = [];
  for (const b of filas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.categoria === b.categoria) ultimo.filas.push(b);
    else grupos.push({ categoria: b.categoria, etiqueta: ETIQUETA_CATEGORIA[b.categoria] ?? b.categoria, filas: [b] });
  }
  return grupos;
}

/** «Cierre interno: jue 15 oct 06:00» (con «(05:00 Canarias)» si la empresa está allí), o null sin hora. */
export function textoCierreInterno(iso, ahora = Date.now()) {
  const hora = horaPeninsular(iso);
  if (!hora || !iso) return null;
  const canarias = segundaHora(hora);
  return `Cierre interno: ${fechaCorta(diaEn(Date.parse(iso)), ahora)} ${hora}${canarias ? ` (${canarias} Canarias)` : ''}`;
}

/**
 * El primer hito sin hacer de las comprobaciones: «Próximo hito: Decisiones y precio, 5 nov 12:00»,
 * o «Vencido» si ya pasó. null si están todos hechos o no hay plazo.
 */
export function textoProximoHito(hitos = [], ahora = Date.now()) {
  const h = (hitos ?? []).find((x) => x.estado !== 'hecho');
  const hora = h && horaPeninsular(h.fecha);
  if (!h || !hora) return null;
  const cuando = `${fechaCorta(diaEn(Date.parse(h.fecha)), ahora)} ${hora}`;
  return {
    texto:
      h.estado === 'vencido' ? `Hito vencido: ${h.titulo}, era el ${cuando}` : `Próximo hito: ${h.titulo}, ${cuando}`,
    vencido: h.estado === 'vencido',
  };
}

const ETIQUETA_DESCARTE = {
  solvencia: 'falta de solvencia',
  certificacion: 'falta de certificación',
  plazo: 'plazo',
  precio: 'precio',
  encaje: 'falta de encaje',
  otro: 'otro motivo',
};

// La ficha «No go» de Hermes descarta sola lo que sigue por decidir (NG-01): un tipo que solo
// pone el código, con el motivo «Hermes: no go — …» de la recomendación.
export const DESCARTE_NO_GO = 'hermes_no_go';
export const ETIQUETA_NO_GO = 'Hermes: no ir';
const PREFIJO_NO_GO = /^Hermes: no go — /;

/** El motivo de la recomendación de Hermes, sin el prefijo que le pone el servidor. */
export function motivoDeHermes(motivo) {
  return String(motivo ?? '')
    .replace(PREFIJO_NO_GO, '')
    .trim();
}

/**
 * «Descartada el lun 12 oct por falta de solvencia: …»: la fecha dice si merece la pena
 * «Recuperar». Sin fecha (descartes antiguos) o sin categoría, se omite esa parte.
 * La de Hermes: «Descartada el lun 12 oct · Hermes: no ir — <su motivo>».
 */
export function textoDescarte(f, ahora = Date.now()) {
  const tipo = ETIQUETA_DESCARTE[f?.categoria_descarte];
  const cuando = f?.descartada_en ? ` el ${fechaCorta(f.descartada_en, ahora)}` : '';
  if (f?.categoria_descarte === DESCARTE_NO_GO) {
    const deHermes = motivoDeHermes(f.motivo_descarte);
    return `Descartada${cuando} · ${ETIQUETA_NO_GO}${deHermes ? ` — ${deHermes}` : ''}`;
  }
  const motivo = f?.motivo_descarte ? `: ${f.motivo_descarte}` : '';
  return `Descartada${cuando}${tipo ? ` por ${tipo}` : ''}${motivo}`;
}

/** Preparar una oferta en rojo o retirada pide confirmación: es la decisión cara. */
export function pidePrepararConfirmacion(f) {
  return f?.go_no_go?.semaforo?.color === 'rojo' || Boolean(f?.retirada);
}

/**
 * La fila a la que lleva un enlace (#bloqueo=clave): la misma si sigue abierta; si ya no está,
 * la primera abierta con `resuelta` para avisar «Eso ya está resuelto».
 */
export function destinoFoco(filas, clave) {
  if (!clave) return null;
  if (filas.some((b) => b.clave === clave)) return { clave, resuelta: false };
  return { clave: filas[0]?.clave ?? null, resuelta: true };
}

// Los cajones de las comprobaciones, en el orden de la barra que los abre.
export const CAJONES = ['guion', 'decisiones', 'equipo', 'memoria', 'documentos'];
export const ETIQUETA_CAJON = {
  guion: 'Guion',
  decisiones: 'Decisiones',
  equipo: 'Equipo',
  memoria: 'Memoria',
  documentos: 'Documentos',
};

// Destinos del servidor que no llevan el nombre del cajón delante (comprobacionesReglas*.ts): el precio
// y los criterios automáticos se fijan en Decisiones, igual que las personas de cada rol y la
// propuesta de decisiones de Hermes.
const DESTINOS_PROPIOS = [
  [/^precio-lote-(.+)$/, (m) => ({ nombre: 'decisiones', campo: `precio.${m[1]}` })],
  [/^automatico:(.+)$/, (m) => ({ nombre: 'decisiones', campo: `automatico:${m[1]}` })],
  // Un rol sin cubrir no tiene fila en el equipo: el foco va a la sección, donde se añade a alguien.
  [/^equipo:.+$/, () => ({ nombre: 'decisiones', campo: 'equipo' })],
  [/^propuesta$/, () => ({ nombre: 'decisiones', campo: null })],
];

/** «decisiones.precio.3» → { nombre: 'decisiones', campo: 'precio.3' }; null si no es de un cajón. */
export function cajonDeDestino(destino) {
  if (typeof destino !== 'string' || !destino) return null;
  for (const [re, aCajon] of DESTINOS_PROPIOS) {
    const m = destino.match(re);
    if (m) return aCajon(m);
  }
  const [nombre, ...resto] = destino.split('.');
  if (!CAJONES.includes(nombre)) return null;
  return { nombre, campo: resto.length ? resto.join('.') : null };
}

/** Lo que se arregla fuera de las comprobaciones: 'ajustes' (datos de empresa), 'expediente' (ficha y pliegos) o null. */
export function salidaDeDestino(destino) {
  if (typeof destino !== 'string') return null;
  if (destino === 'empresa' || destino.startsWith('empresa.')) return 'ajustes';
  if (destino === 'ficha' || destino === 'pliegos') return 'expediente';
  return null;
}

/** Una fila lleva botón de dato solo si su destino abre algo. */
export function destinoAbre(destino) {
  return Boolean(cajonDeDestino(destino) || salidaDeDestino(destino));
}

/** «Tienes cambios sin guardar en Decisiones y Memoria. ¿Salir sin guardarlos?» */
export function preguntaCambiosSinGuardar(nombres) {
  const etiquetas = nombres.map((n) => ETIQUETA_CAJON[n] ?? n);
  const lista =
    etiquetas.length > 1 ? `${etiquetas.slice(0, -1).join(', ')} y ${etiquetas.at(-1)}` : (etiquetas[0] ?? '');
  return `Tienes cambios sin guardar en ${lista}. ¿Salir sin guardarlos?`;
}

// Telemetría del tiempo de persona. Un tramo sin latido más largo que esto (el portátil
// se durmió con la fila abierta) no es trabajo: se cuenta solo hasta aquí.
export const LATIDO_TELEMETRIA_MS = 60_000;
export const MAX_TRAMO_FOCO_MS = 90_000;

/**
 * El cronómetro de una tarea de las comprobaciones: { ms, desde }, con desde = cuándo empezó el tramo con
 * foco (null si no lo hay). Cuenta solo con la tarea abierta (fila desplegada o su cajón), la
 * pestaña visible y la ventana con el foco; cada llamada cierra el tramo y abre otro si sigue.
 */
export function acumularFoco(estado, { ahora, abierta, visible, foco }) {
  const tramo = estado.desde == null ? 0 : Math.min(Math.max(0, ahora - estado.desde), MAX_TRAMO_FOCO_MS);
  return { ms: estado.ms + tramo, desde: abierta && visible && foco ? ahora : null };
}

/** La tarea deja de pedir nada: se manda con cerrada = true. */
export function tareaCerrada(estado) {
  return ESTADOS_CERRADOS.has(estado);
}

/**
 * Dónde abrir el documento de una cita: la ruta del pliego bajado con ese nombre y la
 * página, para enlazar «…#page=N» como en Pliegos del Expediente. null si no está bajado.
 */
// La cita trae el nombre con extensión («Nota….pdf») y el pliego a veces sin ella; en Drive va con un prefijo «8-».
const sinExtension = (n) =>
  String(n ?? '')
    .trim()
    .replace(/\.[a-z0-9]{2,4}$/i, '');

export function documentoDeCita(cita, pliegos = []) {
  if (!cita?.documento) return null;
  const clave = sinExtension(cita.documento);
  const p = (pliegos ?? []).find(
    (x) => x?.ruta && (sinExtension(x.nombre) === clave || sinExtension(x.ruta.split('/').pop()).endsWith(clave)),
  );
  return p ? { ruta: p.ruta, pagina: Number.isInteger(cita.pagina) && cita.pagina > 0 ? cita.pagina : null } : null;
}

// ── Compromisos caros de la memoria (horas que el pliego no pedía) ──
// Las filas compromiso_caro y compromisos_caros llevan `coste` (con euros: solo la web lo ve).
// «Suavizar» es una ronda de «mejorar» con la instrucción que ya trae el servidor.

// useGrouping 'always': «~1.500 h» (es-ES no agrupa las cifras de cuatro dígitos por defecto).
const MILES = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });
const positiva = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** ¿Es la fila de un compromiso caro suelto (no la del total)? */
export const esFilaCompromiso = (b) => Boolean(b?.coste) && String(b.clave ?? '').startsWith('compromiso_caro:');
const esFilaTotal = (b) => Boolean(b?.coste) && String(b.clave ?? '').startsWith('compromisos_caros:');

export const ETIQUETA_CLASE = { anadido: 'Añadido: el pliego no lo pide', exigido: 'Exigido por el pliego' };

function textoHorasEuros(horas, eurosN) {
  const partes = [
    positiva(horas) ? `~${MILES.format(horas)} h` : null,
    positiva(eurosN) ? `~${euros(eurosN)}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** «~650 h · ~16.250 €» del coste de una fila; null sin cifras. */
export const textoChipCoste = (coste) => textoHorasEuros(coste?.horas, coste?.euros);

/** «Puntúa en «…»» si el compromiso suma en un criterio; null si no. */
export const textoCriterioCoste = (coste) => (coste?.criterio ? `Puntúa en «${coste.criterio}»` : null);

/** Los apartados de todas las apariciones (sin repetir, en orden), o null si no se sabe cuál. */
export function apartadosDeCoste(coste) {
  const ns = (coste?.apariciones ?? []).map((a) => a?.apartado).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20);
  const unicos = [...new Set(ns)].sort((a, b) => a - b);
  return unicos.length ? unicos : null;
}

/** La memoria de esa versión en la respuesta de /oferta, o null. */
export function memoriaDeVersion(o, version) {
  return (o?.memorias ?? []).find((m) => m.version === version) ?? null;
}

/**
 * ¿Se ofrece «Suavizar» en esta fila? Solo abierta, con instrucción y con su memoria en la oferta,
 * no presentada (lo entregado no se rehace) y sin otra ronda de memoria en marcha.
 */
export function puedeSuavizar(b, m, rondaEnCurso) {
  if (!b?.coste?.instruccion || ESTADOS_CERRADOS.has(b.estado)) return false;
  return Boolean(m) && !m.presentada && !rondaEnCurso;
}

/** Lo que manda «Suavizar» de una fila a POST …/memoria/:version/mejorar. */
export function pedidoSuavizarFila(b) {
  return { version: b.coste.memoria_version, apartados: apartadosDeCoste(b.coste), indicaciones: b.coste.instruccion };
}

/** Lo que dice la confirmación de «Suavizar»: qué apartados rehará Hermes. */
export function textoRondaSuavizar(apartados) {
  const n = apartados ?? [];
  const cuales = !n.length
    ? 'la memoria entera'
    : n.length === 1
      ? `el apartado ${n[0]}`
      : `los apartados ${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
  return `Hermes rehará ${cuales} en una versión nueva, con esta instrucción:`;
}

// La fila del total repite las instrucciones de todos los añadidos: solo cuenta si no hay filas sueltas.
function filasParaSuavizar(filas) {
  const sueltas = filas.filter(esFilaCompromiso);
  return sueltas.length ? sueltas : filas.filter(esFilaTotal);
}

/**
 * «Suavizar todos»: una sola ronda por versión de memoria (una, salvo memorias por lote) con los
 * apartados de todas las apariciones y las instrucciones sin repetir, con el cierre una vez.
 */
export function pedidosSuavizarTodos(filas) {
  const porVersion = new Map();
  for (const b of filasParaSuavizar(filas ?? [])) {
    const v = b.coste.memoria_version;
    porVersion.set(v, [
      ...(porVersion.get(v) ?? []),
      { caro: true, instruccion: b.coste.instruccion, apartados: apartadosDeCoste(b.coste) ?? [] },
    ]);
  }
  return [...porVersion].flatMap(([version, compromisos]) => {
    const p = pedidoSuavizar({ compromisos });
    return p ? [{ version, ...p }] : [];
  });
}

// Un lote: el resumen de sus añadidos, que el servidor repite en cada fila con coste del lote
// (todos los añadidos, no solo los de las filas a la vista). Si está la fila del total, su n y su
// pct_presupuesto, que son los que la fila enseña.
function cuentaDeLote(filas, lote) {
  const delLote = filas.filter((b) => (b.lote ?? null) === lote);
  const r = delLote.find((b) => b.coste?.resumen)?.coste.resumen;
  if (!r) return null;
  const t = delLote.find(esFilaTotal)?.coste;
  const n = positiva(t?.n) ? t.n : r.anadidos;
  const pct = t && 'pct_presupuesto' in t ? t.pct_presupuesto : r.presupuesto_pct;
  return {
    n: positiva(n) ? n : 0,
    horas: positiva(r.horas) ? r.horas : 0,
    euros: positiva(r.euros) ? r.euros : 0,
    pct: positiva(pct) ? pct : null,
  };
}

/** «Compromisos añadidos: 12 · ~1.500 h · ~37.000 € (190 % del presupuesto)»; null sin filas con coste. */
export function textoCompromisosAnadidos(filas) {
  const conCoste = (filas ?? []).filter((b) => esFilaCompromiso(b) || esFilaTotal(b));
  const lotes = [...new Set(conCoste.map((b) => b.lote ?? null))];
  if (!lotes.length) return null;
  const cuentas = lotes.map((l) => cuentaDeLote(conCoste, l)).filter(Boolean);
  if (!cuentas.length) return null;
  const suma = (k) => cuentas.reduce((a, c) => a + c[k], 0);
  const cifras = textoHorasEuros(suma('horas'), suma('euros'));
  const pct = cuentas.length === 1 && cuentas[0].pct !== null ? ` (${cuentas[0].pct} % del presupuesto)` : '';
  return `Compromisos añadidos: ${suma('n')}${cifras ? ` · ${cifras}` : ''}${pct}`;
}
