// Formato y lógica de la memoria técnica de una oferta: qué falta para redactarla, su progreso, sus
// versiones, las fugas, la autoevaluación y «Mejorar», sin React y con tests.
import { plural } from './formato.js';
import { puntosSobre, textoGenericos } from './propuestasFormato.js';
import { textoFaseMemoria } from './progresoMemoriaFormato.js';
import { NUMERO, numero, memoriaValorable } from './ofertaFormato.js';

/**
 * Lo que falta para que «Redactar memoria» tenga sentido, sobre lo GUARDADO (no sobre el
 * formulario): guion con memoria, decisiones al día, lote si hay lotes y equipo. El enfoque es
 * opcional (Hermes hace su estrategia desde el pliego) y el precio no bloquea: la memoria no lo menciona.
 */
export function faltaParaRedactar(o, lotesLicitacion = []) {
  if (!o?.guion) return ['el guion del pliego (paso 1)'];
  const falta = [];
  const m = o.guion.datos.memoria;
  if (!m?.apartados?.length)
    falta.push(
      'una memoria técnica en el guion (el pliego no la pide o el guion no la trae: vuelve a extraerlo del pliego)',
    );
  if (o.lotes_cambiados) falta.push('volver a extraer el guion: se hizo para otros lotes');
  const d = o.decisiones?.datos;
  if (!d) return [...falta, 'las decisiones de la oferta (paso 2)'];
  if (o.guion_cambiado) falta.push('guardar otra vez las decisiones: el guion cambió desde que se fijaron');
  // Que sean los de interés lo comprueba el servidor (decisiones_problemas); aquí, solo que un
  // guion de unos lotes no acabe en una memoria para el contrato entero (con «a todos los
  // lotes» el guion no trae lotes y las decisiones van sin ellos).
  if (lotesLicitacion.length && (o.guion.datos.lotes ?? []).length && !d.lotes?.length)
    falta.push('el lote al que vamos');
  if (!d.equipo?.length) falta.push('al menos una persona en el equipo');
  return [...falta, ...(o.decisiones_problemas ?? [])];
}

/** «a», «a y b», «a, b y c». */
export function enumerar(items = []) {
  const t = items.map(String);
  return t.length <= 1 ? t.join('') : `${t.slice(0, -1).join(', ')} y ${t.at(-1)}`;
}

/** Una línea de «Para redactar falta»: «Falta el enfoque…»; si ya empieza por «Falta» (lo dice el servidor), tal cual (nada de «Falta Falta»). */
export function lineaFalta(x) {
  const t = String(x);
  return /^falta\b/i.test(t) ? t : `Falta ${t}`;
}

/** «Para redactar falta: a, b y c.»; null si no falta nada. */
export function textoFaltaParaRedactar(falta) {
  if (!falta.length) return null;
  return `Para redactar falta: ${enumerar(falta)}.`;
}

/** Número de la memoria que se pediría ahora: la siguiente a la última. */
export function versionSiguiente(memorias = []) {
  return memorias.reduce((max, m) => Math.max(max, m.version), 0) + 1;
}

/** ¿Falló antes de acabar (dossier, estrategia o redacción)? Entonces no tiene Word que montar. */
export const sinRedactar = (m) => m.progreso?.fase !== 'fin';

/** Avance de una memoria: apartados recibidos, fallidos, porcentaje y si sigue en marcha. */
export function progresoMemoria(m) {
  const total = m.apartados.length;
  const recibidos = m.apartados.filter((a) => a.estado === 'recibido').length;
  const fallidos = m.apartados.filter((a) => a.estado === 'fallido').length;
  const enCurso = m.estado === 'redactando' || m.estado === 'ensamblando';
  const texto =
    m.estado === 'ensamblando'
      ? 'Ensamblando el documento…'
      : m.estado === 'redactando'
        ? textoFaseMemoria(m)
        : m.estado === 'fallida'
          ? sinRedactar(m)
            ? 'No llegó a redactarse'
            : 'Falló el ensamblado'
          : 'Ensamblada';
  return {
    total,
    recibidos,
    fallidos,
    pct: total ? Math.round(((recibidos + fallidos) / total) * 100) : 0,
    enCurso,
    texto,
  };
}

/** Chip de un apartado: pendiente, en cola, redactando, rechazado N veces, recibido o fallido. */
export function estadoApartado(a) {
  if (a.estado === 'recibido')
    return { clave: 'recibido', texto: a.avisos?.length ? 'Recibido con avisos' : 'Recibido' };
  if (a.estado === 'fallido') return { clave: 'fallido', texto: 'Fallido' };
  if (a.rechazos > 0)
    return { clave: 'rechazado', texto: `Rechazado ${a.rechazos === 1 ? 'una vez' : `${a.rechazos} veces`}` };
  if (a.trabajo?.estado === 'generando') return { clave: 'redactando', texto: 'Redactando…' };
  if (a.trabajo) return { clave: 'en_cola', texto: 'En cola' };
  return { clave: 'pendiente', texto: 'Pendiente' };
}

/** «27 págs. de 25: se pasa 2» (aviso), «24 págs. de 25: al límite» (aviso), «12 págs. estimadas de 25»; null sin cifra. */
export function textoLimitePaginas(m) {
  const reales = typeof m.paginas === 'number';
  const n = reales ? m.paginas : m.paginas_estimadas;
  if (typeof n !== 'number') return null;
  const base = `${reales ? n : Math.round(n)} págs.${reales ? '' : ' estimadas'}`;
  const limite = m.limite_paginas;
  if (typeof limite !== 'number') return { texto: base, aviso: false };
  if (n > limite) return { texto: `${base} de ${limite}: se pasa ${NUMERO.format(n - limite)}`, aviso: true };
  if (n >= limite - 1) return { texto: `${base} de ${limite}: al límite`, aviso: true };
  return { texto: `${base} de ${limite}`, aviso: false };
}

/** Lo que se revisa de una memoria ensamblada: el borrador con sus rutas (docx, pdf, md); null si no hay documento. */
export function revisionDeVersion(m) {
  const b = m.borrador;
  if (!b) return null;
  return { id: b.id, estado: b.estado, rutas: [b.ruta, b.ruta_pdf, b.ruta_md].filter(Boolean) };
}

/** Borradores que no son una memoria ensamblada (los antiguos, escritos de una vez por Hermes). */
export function borradoresSueltos(borradores = [], memorias = []) {
  const deMemorias = new Set(memorias.map((m) => m.borrador?.id).filter((id) => id != null));
  return borradores.filter((b) => !deMemorias.has(b.id) && b.origen !== 'ensamblado');
}

/** Cuerpo del PATCH /borradores/:id: el motivo y las fugas anuladas solo van si los hay. */
export function cuerpoRevisionBorrador(decision, { anularFugas, motivo } = {}) {
  const m = motivo?.trim();
  return { decision, ...(anularFugas ? { anular_fugas: anularFugas } : {}), ...(m ? { motivo: m } : {}) };
}

// Mismo texto que MOTIVO_OBLIGATORIO del servidor (oferta/resumenMemoria.ts).
const PIDE_MOTIVO = 'Queda algo marcado';

/** Si el servidor rechazó «Aceptar» un borrador de memoria porque le falta el motivo (400 con párrafos marcados, avisos o apartados sin redactar). */
export function pideMotivoAlAceptar(e) {
  return e?.status === 400 && typeof e.message === 'string' && e.message.startsWith(PIDE_MOTIVO);
}

/** Documento preseleccionado para evaluar: el docx de la última memoria ensamblada, en la lista o como otra ruta. */
export function documentoParaEvaluar(memorias = [], documentos = []) {
  const ruta = memorias.find((m) => m.estado === 'ensamblada' && m.borrador?.ruta)?.borrador.ruta ?? '';
  if (!ruta) return { elegido: '', otro: '' };
  return documentos.includes(ruta) ? { elegido: ruta, otro: '' } : { elegido: '', otro: ruta };
}

const deLote = (m, lote) => (m.lote ?? null) === lote;

/** La presentada de ese lote o, sin ella, la común (sin lote), que vale para todos (como el servidor). */
function presentadaDelLote(memorias, lote) {
  return (
    memorias.find((m) => m.presentada && deLote(m, lote)) ??
    (lote === null ? null : (memorias.find((m) => m.presentada && deLote(m, null)) ?? null))
  );
}

/**
 * La memoria de la oferta: la presentada si se subió (la que se entregó) o la última; una de
 * ensayo (pedida con el plazo vencido para medirla contra la presentada) no cuenta. null si no hay.
 * Con lote, la de ese lote (su presentada, la común presentada o su última), como las comprobaciones y el MCP.
 */
export function memoriaDeLaOferta(o, lote) {
  const memorias = o?.memorias ?? [];
  if (lote === undefined) return memorias.find((m) => m.presentada) ?? memorias.find((m) => !m.ensayo) ?? null;
  return presentadaDelLote(memorias, lote) ?? memorias.find((m) => !m.ensayo && deLote(m, lote)) ?? null;
}

/** ¿Ya se entregó la memoria de ese lote (la suya o una común presentada)? Ahí no se redacta otra. */
export const loteEntregado = (o, lote) => Boolean(memoriaDeLaOferta(o, lote)?.presentada);

// El pliego pide una memoria por lote: los lotes con memoria propia; null = una común.
const lotesConMemoria = (o) => (o?.memoria_lotes?.length ? o.memoria_lotes : null);

/**
 * Las memorias en grupos para la vista: con memoria por lote, uno por lote ({ lote, nombre del lote
 * de la licitación, sus memorias }) y, si quedan memorias comunes (de antes de separarlas), uno más
 * con lote null al final; sin memoria por lote, un solo grupo con todas.
 */
export function memoriasPorLote(o, lotesLicitacion = []) {
  const memorias = o?.memorias ?? [];
  const lotes = lotesConMemoria(o);
  if (!lotes) return [{ lote: null, nombre: null, memorias }];
  const nombre = (lote) => lotesLicitacion.find((l) => String(l.id) === lote)?.nombre ?? null;
  const grupos = lotes.map((lote) => ({
    lote,
    nombre: nombre(lote),
    memorias: memorias.filter((m) => deLote(m, lote)),
  }));
  const comunes = memorias.filter((m) => deLote(m, null));
  return comunes.length ? [...grupos, { lote: null, nombre: null, memorias: comunes }] : grupos;
}

// Rehacer desde cero cuesta horas de máquina: plan, redacción entera y crítico.
const HORAS_REHACER = 3;

/**
 * La confirmación de «Rehacer con el guion vigente»: una versión nueva desde cero cuesta horas de
 * máquina y la actual no se pierde.
 */
export function textoRehacerVigente(m, o) {
  const guion = o?.guion?.version ? ` (v${o.guion.version})` : '';
  const siguiente = versionSiguiente(o?.memorias ?? [m]);
  return `Hermes redacta la v${siguiente} desde cero con el guion vigente${guion}: unas ${HORAS_REHACER} h de máquina. La v${m.version} se queda en el historial. ¿Seguimos?`;
}

/** ¿Se puntúa la memoria? Manda el guion vigente: una versión de otro guion puede traer puntos que ya no cuentan. */
export const memoriaSePuntuaEnOferta = (o, m) => memoriaValorable(o?.guion?.datos?.memoria ?? m);

/**
 * Cómo se reparten las versiones en la vista: la actual es la última memoria de la oferta (la que
 * se revisa, se da por buena y se mejora); la última de ensayo va aparte, con su nota, sin quitarle
 * el sitio; el resto, al historial.
 */
export function versionesDeLaVista(memorias = []) {
  // La presentada va en su propio bloque (SubirMemoriaPresentada): no se revisa ni se mejora.
  const deTrabajo = memorias.filter((m) => !m.presentada);
  const actual = deTrabajo.find((m) => !m.ensayo && !m.presentada_sustituida) ?? null;
  const ensayo = deTrabajo.find((m) => m.ensayo) ?? null;
  return { actual, ensayo, anteriores: deTrabajo.filter((m) => m !== actual && m !== ensayo) };
}

/**
 * ¿Se dice «Aún no hay memoria»? Solo sin ninguna: con una presentada (sin versiones de Hermes),
 * actual y ensayo faltan, pero la memoria existe y sus sustituidas van al historial.
 */
export function sinMemoria(memorias = []) {
  return memorias.length === 0;
}

const ETIQUETA_ENSAYO = 'Ensayo (no presentada)';

/**
 * ¿Se ofrece pedir una memoria de ensayo (para compararla con la presentada)? Solo con el
 * plazo vencido (el servidor lo comprueba con la hora peninsular), guion, Salidas y sin otra
 * memoria redactándose.
 */
export function ofrecerEnsayo(o, fechaLimite, ahora = Date.now()) {
  const vence = Date.parse(fechaLimite ?? '');
  if (Number.isNaN(vence) || vence > ahora || !o?.guion || !o.salidas_configurado) return false;
  return !(o.memorias ?? []).some((m) => progresoMemoria(m).enCurso);
}

/** La etiqueta de una memoria de ensayo (no se presenta ni se da por buena); null si no lo es. */
export function etiquetaEnsayo(m) {
  return m?.ensayo ? ETIQUETA_ENSAYO : null;
}

/** Estado de una versión de la memoria para su cabecera: redactando, pendiente de revisar, dada por buena, de ensayo… */
export function estadoVersion(m) {
  const p = progresoMemoria(m);
  if (p.enCurso) return { clave: 'en_curso', texto: m.estado === 'ensamblando' ? 'Montando el Word' : 'Redactando' };
  if (m.estado === 'fallida')
    return { clave: 'fallida', texto: sinRedactar(m) ? 'No llegó a redactarse' : 'Falló el montaje del Word' };
  if (m.ensayo) return { clave: 'ensayo', texto: ETIQUETA_ENSAYO };
  if (m.presentada) return { clave: 'aceptada', texto: 'Presentada' };
  if (m.presentada_sustituida) return { clave: 'descartada', texto: 'Presentada, sustituida' };
  const r = m.borrador?.estado;
  if (r === 'aceptada') return { clave: 'aceptada', texto: 'Dada por buena' };
  if (r === 'descartada') return { clave: 'descartada', texto: 'Descartada' };
  return { clave: 'pendiente', texto: 'Pendiente de tu revisión' };
}

/** Los apartados de una versión con su estado de redacción y, si la hay, su nota estimada. */
export function filasApartados(m) {
  const notas = new Map(filasEvaluacionMemoria(m).map((f) => [f.apartado, f]));
  const puntos = (a) => (memoriaValorable(m) ? a.puntos : null);
  return (m?.apartados ?? []).map((a) => ({
    ...a,
    puntos: puntos(a),
    chip: estadoApartado(a),
    nota: notas.get(a.apartado) ?? null,
  }));
}

/** «Mejora de la v3: rehechos los apartados 2 y 4»; null si la versión no sale de mejorar otra. */
export function textoOrigen(m) {
  const o = m?.origen;
  if (o?.subida)
    return `Subida a mano${typeof o.version_base === 'number' ? ` a partir de la v${o.version_base}` : ''} («${o.subida}»)`;
  if (!o || typeof o.version_base !== 'number') return null;
  const n = o.apartados_rehechos ?? [];
  const con = o.indicaciones ? ', con tus indicaciones' : '';
  if (!n.length) return `Mejora de la v${o.version_base}${con}`;
  return `Mejora de la v${o.version_base}: ${n.length === 1 ? `rehecho el apartado ${n[0]}` : `rehechos los apartados ${enumerar(n)}`}${con}`;
}

/**
 * El `texto` de useAccionAviso para una acción que crea una versión nueva: se dice arriba
 * (onAviso), porque el componente se vuelve a montar al llegar la versión y borraría su aviso;
 * el aviso local queda sin texto. Sin onAviso, el texto de siempre.
 */
export function textoArriba(onAviso, texto) {
  if (!onAviso) return texto;
  return (r) => {
    onAviso({ tono: 'info', texto: typeof texto === 'function' ? texto(r) : texto });
    return null;
  };
}

// Lo que la versión nueva dejó atrás sin revisar: nada desaparece sin decirlo.
function textoDescartadas(descartadas = []) {
  if (!descartadas.length) return null;
  const vs = enumerar(descartadas.map((v) => `v${v}`));
  return descartadas.length === 1
    ? `La ${vs} sin revisar pasó a descartada.`
    : `Las ${vs} sin revisar pasaron a descartadas.`;
}

/** Lo que se dice tras subir un Word o un PDF: la versión, cuántos apartados se reconocieron (o que va entera), lo que no y lo que se descartó. */
export function textoSubida(r) {
  const aprende = r.aprende ? ' y saca lecciones de tus cambios' : '';
  const reparto = r.sin_repartir
    ? ', entera (sin repartir por apartados).'
    : `: ${r.reconocidos} de ${plural(r.total, 'apartado')} reconocidos.`;
  const base = `Subida como v${r.version}${reparto} Hermes la evalúa ahora${aprende}.`;
  return [base, ...(r.avisos ?? []), textoDescartadas(r.descartadas)].filter(Boolean).join(' ');
}

/** «General» o «Solo esta licitación», con el apartado si lo tiene: «Solo esta licitación · apartado 2». */
const ALCANCE = {
  general: () => 'General',
  licitacion: () => 'Solo esta licitación',
  organo: (v) => `Órgano: ${v}`,
  tipo_contrato: (v) => `Tipo de contrato: ${v}`,
  cpv: (v) => `CPV ${v}`,
};

export function textoAlcance(l) {
  const alcance = (ALCANCE[l.alcance] ?? ALCANCE.general)(l.alcance_valor ?? '');
  return l.apartado ? `${alcance} · apartado ${l.apartado}` : alcance;
}

/** Mientras Hermes compara la versión subida: «Hermes está comparando tus cambios…»; null si no. */
export function textoLeccionesEnCurso(m) {
  const t = m?.lecciones_en_curso;
  if (!t) return null;
  return t.estado === 'generando'
    ? 'Hermes está comparando tus cambios…'
    : 'En cola para sacar lecciones de tus cambios…';
}

/** Las indicaciones de la persona para una versión nueva: null si no hay; el error si son demasiado cortas. */
export function leerIndicaciones(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { indicaciones: null };
  if (t.length < 10) return { error: 'Las indicaciones son muy cortas: di qué quieres que cambie.' };
  return { indicaciones: t };
}

export const textoEnCurso = (t, generando, enCola) => (t ? (t.estado === 'generando' ? generando : enCola) : null);

/**
 * La autoevaluación de una versión ensamblada: null si no toca (sin ensamblar, o un
 * servidor que aún no la trae); si no, { enCurso (texto o null), evaluacion (o null) }.
 */
export function estadoEvaluacionMemoria(m) {
  if (m?.estado !== 'ensamblada' || !memoriaValorable(m)) return null;
  if (m.evaluacion === undefined && !m.evaluacion_en_curso) return null;
  return {
    enCurso: textoEnCurso(m.evaluacion_en_curso, 'Evaluando…', 'En cola para evaluar…'),
    evaluacion: m.evaluacion ?? null,
  };
}

/** «19 / 25 (76 %) · 3 párrafos genéricos» (va detrás de «Nota de Hermes:»). */
export function textoEvaluacionMemoria(ev) {
  const partes = [puntosSobre(ev.puntuacion_total, ev.puntuacion_maxima)];
  if (typeof ev.genericos === 'number') partes.push(textoGenericos(ev.genericos));
  return partes.join(' · ');
}

/** Una fila por apartado evaluado: su título, «6 / 8 pt · tramo 6 de 8», la barra y si se puede subir. */
export function filasEvaluacionMemoria(m) {
  const ev = m?.evaluacion;
  if (!ev?.por_apartado?.length) return [];
  const mejorable = new Set(m.mejorable ?? []);
  return ev.por_apartado.map((p) => {
    const titulo = (m.apartados ?? []).find((a) => a.apartado === p.apartado)?.titulo ?? null;
    const pct = p.maximo > 0 ? Math.min(100, Math.round((p.puntos / p.maximo) * 100)) : 0;
    const tramo = typeof p.tramo === 'number' ? ` · tramo ${numero(p.tramo)} de ${numero(p.maximo)}` : '';
    const corto = `${numero(p.puntos)} / ${numero(p.maximo)} pt`;
    return {
      apartado: p.apartado,
      titulo,
      pct,
      corto,
      texto: `${corto}${tramo}`,
      mejorable: mejorable.has(p.apartado),
    };
  });
}

/** Casillas marcadas al abrir «Mejorar»: los apartados que la evaluación deja por debajo de su tramo máximo. */
export function apartadosMejorablesIniciales(m) {
  const existen = new Set((m?.apartados ?? []).map((a) => a.apartado));
  return (m?.mejorable ?? []).filter((n) => existen.has(n));
}

/**
 * Por qué no se puede crear ahora una versión nueva a partir de esta (null si se puede): lo que
 * el servidor rechazaría con 409. Con indicaciones propias no hace falta esperar a la evaluación.
 */
export function motivoNoMejorar(m, o, conIndicaciones = false) {
  if (m.guion_cambiado)
    return `La v${m.version} es de otro guion: «Pedir cambios» no sirve; rehazla con el guion vigente.`;
  if (m.sin_repartir)
    return `La v${m.version} se subió entera, sin los títulos de los apartados del guion: corrígela en tu documento o pide una memoria nueva.`;
  // Solo una subida a mano no sirve de base; una montada por el método anterior (sin progreso) sí.
  if (m.origen?.subida)
    return `La v${m.version} se subió a mano y Hermes no la rehace: pide una memoria nueva o corrígela en tu documento.`;
  if (m.estado !== 'ensamblada') return 'Solo se mejora una memoria ensamblada.';
  if (!m.evaluacion && !conIndicaciones)
    return m.evaluacion_en_curso
      ? 'Espera a que termine la evaluación o escribe tus indicaciones.'
      : 'Primero hace falta su evaluación («Volver a evaluar») o tus indicaciones.';
  if ((o?.memorias ?? []).some((x) => progresoMemoria(x).enCurso))
    return 'Hay una memoria redactándose: espera a que termine.';
  if (o?.guion_cambiado || (o?.decisiones_problemas ?? []).length)
    return 'Las decisiones no están al día con el guion: guárdalas otra vez (paso 2).';
  return null;
}

/** Casillas de «Mejorar» → apartados para POST …/mejorar (sin repetir, en orden), o el error. */
export function leerApartadosMejorar(elegidos, m) {
  const validos = new Set((m?.apartados ?? []).map((a) => a.apartado));
  const apartados = [...new Set(elegidos)].filter((n) => validos.has(n)).sort((a, b) => a - b);
  return apartados.length ? { apartados } : { error: 'Elige al menos un apartado que rehacer.' };
}
