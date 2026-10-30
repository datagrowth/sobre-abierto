// Formato de los datos de licitaciones para la interfaz (sin React, con tests).
import {
  diasDeCalendario,
  euros,
  fechaCorta,
  fechaHora,
  horaPlazo,
  instanteLocal,
  plural,
  proximoPlazo,
  segundaHora,
  textoVeredicto,
} from './formato.js';
import { bloqueosAbiertos, DESCARTE_NO_GO, ETIQUETA_NO_GO, motivoDeHermes } from './comprobacionesFormato.js';

const ESTADOS = [
  // Nuevas: cribadas, a la espera de que Hermes lea los pliegos y deje la ficha.
  { key: 'nueva', label: 'Nuevas' },
  // Nuevas que ya tienen ficha y no se descartaron solas (sale de la ficha).
  { key: 'ficha_por_revisar', label: 'Ficha por revisar' },
  { key: 'en_preparacion', label: 'En preparación' },
  { key: 'presentada', label: 'Presentadas' },
  // Solo las que siguen en plazo: el servidor no lista las cerradas.
  { key: 'descartada', label: 'Descartadas' },
  { key: 'candidata', label: 'Sin cribar' },
  { key: 'ganada', label: 'Ganadas' },
  { key: 'perdida', label: 'Perdidas' },
];

// Las pestañas de la lista de Oportunidades: lo presentado (y su resultado) va en la
// vista Presentadas, con sus filtros por resultado; aquí solo lo que aún no se ha presentado.
const FUERA_DE_LA_LISTA = new Set(['presentada', 'ganada', 'perdida']);
export const ESTADOS_LISTA = ESTADOS.filter((e) => !FUERA_DE_LA_LISTA.has(e.key));

// Triaje que fija una persona (descartar va aparte porque pide motivo). Presentada,
// ganada y perdida salen de la propuesta registrada y de su resultado.
const ESTADOS_HUMANOS = ['nueva', 'en_preparacion'];
const SE_PUEDE_DESCARTAR = new Set(ESTADOS_HUMANOS);
// En singular: la píldora dice en qué estado está esta, no el nombre de la lista.
const ETIQUETAS_TRIAJE = { nueva: 'Nueva', en_preparacion: 'En preparación' };

/**
 * Estados que se pueden fijar a mano desde la ficha ({ key, label }), o ninguno si no la
 * decide una persona: una presentada, ganada o perdida no se devuelve a Nuevas desde aquí.
 */
// La cita del final del resumen de la ficha: « (PCP págs. 2-4; ETC §-3)», «PCP págs. 2-4; ETC §§1-3.»
// o «Fuentes: PPT págs. 2-7; CC págs. 8-15.». El punto de cada «págs.» no corta la cita: si lo
// hiciera, la segunda «págs.» se quedaría sola como fuente y la primera, pegada al texto. El «§»
// queda fuera de la clase de caracteres para que la repetición no retroceda en exponencial.
const MARCA_CITA = String.raw`(?:p[áa]gs?\.|§)`;
const CITA_SUELTA = String.raw`(?:Fuentes?:\s*)?[^.()§]*${MARCA_CITA}(?:[^.()§]*${MARCA_CITA})*[^.()§]*\.?`;
const CITA_FINAL = new RegExp(String.raw`\s*(?:\(([^()]*${MARCA_CITA}[^()]*)\)\.?|(${CITA_SUELTA}))\s*$`, 'i');

/** El resumen de la ficha en dos partes: el texto y de dónde sale (o null). */
export function partesResumen(resumen) {
  const t = String(resumen ?? '').trim();
  if (!t) return null;
  const m = CITA_FINAL.exec(t);
  if (!m || m.index === 0) return { texto: t, fuente: null };
  return { texto: t.slice(0, m.index).trim(), fuente: (m[1] ?? m[2] ?? '').trim().replace(/\.$/, '') };
}

export function opcionesTriaje(estado) {
  if (!ESTADOS_HUMANOS.includes(estado) && estado !== 'descartada') return [];
  return ESTADOS_HUMANOS.map((key) => ({ key, label: ETIQUETAS_TRIAJE[key] }));
}

/** Los estados del «Mover a…» de Notas y estado: solo los distintos al actual (elegir el mismo no es un cambio). */
export function opcionesMover(estado) {
  return opcionesTriaje(estado).filter((o) => o.key !== estado);
}

// Ficha pedida a Hermes: en cola mientras espera turno, generando mientras la lee.
function accionFichaEnCurso(enCurso, queLee) {
  if (!enCurso) return null;
  return enCurso.estado === 'generando'
    ? {
        clave: 'esperar',
        texto: 'Generando ficha…',
        espera: `Hermes está leyendo ${queLee} y generando la ficha: aparecerá aquí sola.`,
      }
    : {
        clave: 'esperar',
        texto: 'Ficha en cola…',
        espera: 'La ficha está en cola: Hermes la empezará en cuanto quede libre.',
      };
}

const ESPERANDO_PLIEGOS = {
  clave: 'esperar',
  texto: 'Esperando los pliegos',
  espera:
    'Bajando los pliegos, que en la Plataforma de Contratación va lenta: primero el PCAP y el PPT de lo que tiene el plazo más cerca. La ficha se genera sola en cuanto estén.',
};

// Sin ficha y sin pliegos bajados: o se están bajando, o no hay nada que bajar y hay que
// decirlo (si no, «Esperando los pliegos» se queda para siempre).
function sinPliegos(f) {
  const filas = f.pliegos ?? [];
  if (filas.some((p) => p.estado !== 'error')) return ESPERANDO_PLIEGOS;
  const ver = 'Ábrelos desde su página (enlace de arriba) y decide: Preparar la oferta o Descartar.';
  if (filas.length)
    return {
      clave: 'esperar',
      texto: 'Los pliegos no se pueden bajar',
      espera: `La plataforma da error al descargarlos (es un fallo suyo, se reintentó). ${ver}`,
    };
  return (f.datos?.documentos?.length ?? 0)
    ? {
        clave: 'esperar',
        texto: 'Sin pliegos que bajar',
        espera: `Están en una plataforma de la que no se bajan solos. ${ver}`,
      }
    : {
        clave: 'esperar',
        texto: 'Sin pliegos que bajar',
        espera: `La plataforma no los publica en sus datos abiertos. ${ver}`,
      };
}

/**
 * El siguiente paso de una oportunidad, para el botón principal de su ficha:
 * { clave, texto, pestana? }, o null si ya no queda nada que hacer (ganada, perdida).
 */
export function siguienteAccion(f) {
  const { aprobada } = f.go_no_go?.ficha ?? {};
  const conPliegos = (f.pliegos ?? []).some((p) => p.estado === 'descargado');
  if (f.estado === 'sin_oportunidad') return { clave: 'seguir', texto: 'Seguir esta licitación' };
  if (f.estado === 'descartada') return { clave: 'reactivar', texto: 'Recuperar' };
  if (f.estado === 'presentada') return { clave: 'resultado', texto: 'Anotar el resultado', pestana: 'preparacion' };
  if (f.estado === 'en_preparacion')
    return { clave: 'registrar', texto: 'Registrar la presentación', pestana: 'preparacion' };
  if (!['nueva', 'candidata'].includes(f.estado)) return null;
  const enCurso = accionFichaEnCurso(f.ficha_en_curso, 'los pliegos');
  if (enCurso) return enCurso;
  if (!aprobada) {
    return conPliegos ? { clave: 'generar_ficha', texto: 'Generar ficha' } : sinPliegos(f);
  }
  return { clave: 'preparar', texto: 'Preparar la oferta' };
}

export function sePuedeDescartar(estado) {
  return SE_PUEDE_DESCARTAR.has(estado);
}

export function etiquetaEstado(key) {
  return ESTADOS.find((e) => e.key === key)?.label ?? key;
}

/** El estado como lo enseña la lista: una nueva con ficha es «Ficha por revisar». */
export function estadoVisible(f) {
  if (f.estado === 'sin_oportunidad') return 'No seguida';
  const conFicha = f.estado === 'nueva' && Boolean(f.go_no_go?.ficha?.aprobada);
  return etiquetaEstado(conFicha ? 'ficha_por_revisar' : f.estado);
}

// Ficha y go/no-go.
const RESULTADOS = { cumple: 'Cumple', no_cumple: 'No cumple', desconocido: 'Por confirmar', no_aplica: 'No procede' };
export function etiquetaResultado(resultado) {
  return RESULTADOS[resultado] ?? resultado;
}

export const SEMAFOROS = {
  verde: 'Cumplimos',
  ambar: 'Por confirmar',
  rojo: 'No cumplimos',
};

// «revisar» de la recomendación es «con dudas»: «Revisar» se confundía con «Ficha por
// revisar» (el estado) y con «Por revisar» (el semáforo), que son otra cosa.
export const DECISIONES = { go: 'Go', no_go: 'No go', revisar: 'Con dudas' };

// La criba que se hizo sin el perfil de la empresa no opinó: decía «con dudas» por no saber.
const SIN_PERFIL = /falta el perfil de licitaciones/i;

// El motivo es el del «No go» que la descartó (motivo_descarte), no el de la ficha vigente: si una
// ficha posterior dice otra cosa, su motivo no explica el descarte. La lista no trae
// motivo_descarte: ahí solo vale la ficha vigente si sigue diciendo «No go».
function motivoDelNoGo(motivoDescarte, recomendacion) {
  const deHermes = motivoDeHermes(motivoDescarte);
  if (deHermes) return deHermes;
  return recomendacion?.decision === 'no_go' ? (recomendacion.motivo ?? null) : null;
}

/** Lo que enseña el indicador «Hermes» de la cabecera: la opinión sin repetir «Hermes: ». */
export function valorOpinion(opinion) {
  return opinion ? opinion.texto.replace(/^Hermes: /, '') : 'Sin cribar';
}

/**
 * La opinión de Hermes que enseña la lista: la de la ficha (con los pliegos leídos) manda sobre
 * la de la criba. → { texto, motivo, clave: 'ficha' | 'sin_evaluar' | 'criba' }, o null.
 */
export function opinionHermes({
  veredicto_ia,
  motivo_ia,
  recomendacion_ficha,
  estado,
  categoria_descarte,
  motivo_descarte,
} = {}) {
  // Descartada por su «No go»: ya no es algo que revisar, es el motivo del descarte.
  if (estado === 'descartada' && categoria_descarte === DESCARTE_NO_GO)
    return { texto: ETIQUETA_NO_GO, motivo: motivoDelNoGo(motivo_descarte, recomendacion_ficha), clave: 'descarte' };
  if (recomendacion_ficha) {
    return {
      texto: `Ficha: ${DECISIONES[recomendacion_ficha.decision] ?? recomendacion_ficha.decision}`,
      motivo: recomendacion_ficha.motivo ?? null,
      clave: 'ficha',
    };
  }
  if (motivo_ia && SIN_PERFIL.test(motivo_ia))
    return { texto: 'Hermes: sin evaluar (faltaba el perfil)', motivo: null, clave: 'sin_evaluar' };
  if (!veredicto_ia) return null;
  return { texto: `Hermes: ${textoVeredicto(veredicto_ia)}`, motivo: motivo_ia ?? null, clave: 'criba' };
}

const GARANTIAS_PLACSP = { 1: 'provisional', 2: 'definitiva', 3: 'complementaria' };

/** Garantía de la PLACSP o de la ficha → «Definitiva: 5 %» o «Provisional: 5.000 €». */
export function textoGarantia(g) {
  const tipo = GARANTIAS_PLACSP[g.tipo] ?? g.tipo ?? 'garantía';
  const cuanto = [
    typeof g.porcentaje === 'number' ? `${g.porcentaje} %` : null,
    typeof g.importe === 'number' && g.importe > 0 ? euros(g.importe) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${tipo.charAt(0).toUpperCase()}${tipo.slice(1)}${cuanto ? `: ${cuanto}` : ''}${g.descripcion ? ` (${g.descripcion})` : ''}`;
}

// Primero lo que deja fuera, luego lo que no cumple, lo dudoso, lo que se cumple y lo que no procede.
const ORDEN_RESULTADO = { desconocido: 2, cumple: 3, no_aplica: 4 };
function gravedad(r) {
  if (r.resultado === 'no_cumple') return r.excluyente ? 0 : 1;
  return ORDEN_RESULTADO[r.resultado] ?? 3;
}

const RESULTADO_FICHA = { si: 'cumple', no: 'no_cumple', dudoso: 'desconocido', no_aplica: 'no_aplica' };
const ETIQUETA_TIPO = {
  clasificacion: 'Clasificación',
  solvencia_economica: 'Solvencia económica',
  solvencia_tecnica: 'Solvencia técnica',
  experiencia: 'Experiencia (trabajos similares)',
  certificacion: 'Certificación',
  medios_personales: 'Medios personales',
  medios_materiales: 'Medios materiales',
  habilitacion: 'Habilitación',
  idioma: 'Idioma',
  seguro: 'Seguro de responsabilidad civil',
  subcontratacion: 'Subcontratación',
  ute: 'UTE',
  visita: 'Visita obligatoria',
  lugar_ejecucion: 'Lugar de ejecución',
  otro: 'Otro requisito',
};

/**
 * Requisitos de la ficha de Hermes con la forma de los de la PLACSP, con el dato nuestro que
 * decide (fuente), si el código lo comprobó, qué decía Hermes, y su cita literal con lo que dio
 * buscarla en el pliego (`citas`: las del detalle, en el mismo orden).
 */
export function requisitosDeFicha(ficha, citas = []) {
  const comprobado = new Map((ficha?.datos.verificaciones ?? []).map((v) => [v.indice, v]));
  return (ficha?.datos.requisitos ?? []).map((r, i) => ({
    origen: 'ficha',
    clase: r.tipo,
    etiqueta: ETIQUETA_TIPO[r.tipo] ?? r.tipo,
    descripcion: r.descripcion,
    lote: r.lote ?? null,
    exigido: r.valor_exigido ?? null,
    nueva_creacion: r.nueva_creacion ?? null,
    // El seguro se contrata antes de presentarse: nunca excluyente (igual que en el servidor).
    resultado: RESULTADO_FICHA[r.cumple],
    excluyente: r.excluyente && r.tipo !== 'seguro',
    motivo: r.justificacion,
    pagina: r.pagina ?? null,
    documento: r.documento ?? null,
    fuente: r.fuente ?? null,
    verificacion: comprobado.get(i) ?? null,
    cita: r.cita ?? null,
    comprobacion_cita: citas[i] ?? null,
  }));
}

/**
 * Dónde lo dice el pliego y si la cita literal está: «cita comprobada» (con la página donde se
 * encontró), «cita no localizada» o, sin cita o sin pliegos leídos, solo documento y página.
 */
export function textoCitaRequisito(r) {
  const nombre = (d) => (d ? d.split('/').pop() : null);
  const c = r.cita ? r.comprobacion_cita : null;
  if (c?.estado === 'comprobada') {
    return {
      donde: [nombre(c.documento) ?? r.documento, c.pagina ? `pág. ${c.pagina}` : null].filter(Boolean).join(' · '),
      estado: { texto: 'cita comprobada', tono: 'ok' },
    };
  }
  const donde = [r.documento, r.pagina ? `pág. ${r.pagina}` : null].filter(Boolean).join(' · ') || null;
  if (c?.estado === 'no_localizada') return { donde, estado: { texto: 'cita no localizada', tono: 'riesgo' } };
  return donde ? { donde, estado: null } : null;
}

/** «Hermes decía: Por confirmar» si el código cambió el resultado; null si lo confirmó o no lo miró. */
export function textoComprobado(v) {
  if (!v) return null;
  const cambio = v.resultado !== v.resultado_ia;
  return cambio
    ? `Comprobado con los datos de tu empresa. Hermes decía: ${etiquetaResultado(RESULTADO_FICHA[v.resultado_ia])}.`
    : 'Comprobado con los datos de tu empresa.';
}

const TEMAS = {
  solvencia_economica: 'solvencia económica',
  solvencia_tecnica: 'solvencia técnica',
  clasificacion: 'clasificación',
  medios_personales: 'medios personales',
  medios_materiales: 'medios materiales',
  certificaciones: 'certificaciones',
  habilitacion: 'habilitación',
  subcontratacion: 'subcontratación',
  idioma: 'idioma',
  seguro: 'seguro',
  visita_obligatoria: 'visita obligatoria',
  lugar_ejecucion: 'lugar y presencialidad',
};

/** Lo que el pliego no pide y lo que no se encontró en él, según la cobertura de la ficha. */
export function resumenCobertura(cobertura = []) {
  const de = (estado) => cobertura.filter((c) => c.estado === estado).map((c) => TEMAS[c.tema] ?? c.tema);
  return { noLoPide: de('no_lo_pide'), noEncontrado: de('no_encontrado') };
}

/** La ficha es de una versión anterior del análisis (sin cobertura ni comprobaciones). */
export function fichaAntigua(ficha, versionActual) {
  return Boolean(ficha && versionActual && (ficha.version_prompt ?? 1) < versionActual);
}

// Las métricas de antes de leer el modelo del run guardaban la etiqueta del agente: no es un modelo
// y mezclada con los de verdad falseaba la comparación.
const MODELO_SIN_DATO = 'hermes-agent';

/** El modelo de unas métricas; «sin métrica» en las antiguas que solo dicen «hermes-agent». */
export function etiquetaModelo(modelo) {
  return modelo === MODELO_SIN_DATO ? 'sin métrica' : modelo;
}

/** «gpt-6-luna · 14 min · 23 llamadas · 180.000 tokens · 2 respuestas recortadas», o null sin métricas. */
export function textoMetricas(m) {
  if (!m) return null;
  const partes = [
    etiquetaModelo(m.modelo),
    m.duracion_s != null ? duracion(m.duracion_s) : null,
    m.llamadas_herramientas != null ? `${m.llamadas_herramientas} llamadas` : null,
    m.tokens_entrada != null || m.tokens_salida != null
      ? `${(m.tokens_entrada ?? 0) + (m.tokens_salida ?? 0)} tokens`
      : null,
    m.respuestas_recortadas ? `${m.respuestas_recortadas} respuestas recortadas` : null,
    m.rechazos ? `${m.rechazos} rechazos` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** 840 → «14 min»; 45 → «45 s». */
export function duracion(s) {
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** «Calidad 72/100 · 2 corregidos por código · 15 % por confirmar», o null sin medición. */
export function textoCalidad(calidad) {
  if (!calidad) return null;
  const partes = [
    `Calidad ${calidad.puntuacion}/100`,
    `${calidad.requisitos} requisitos`,
    `${calidad.dudosos_pct} % por confirmar`,
  ];
  if (calidad.corregidos_por_codigo)
    partes.push(`${calidad.corregidos_por_codigo} corregidos con los datos de tu empresa`);
  return partes.join(' · ');
}

/**
 * Requisitos de la lista de la ficha. Con una ficha de Hermes a la vista, los de la PLACSP
 * que solo dicen «por confirmar» (la PLACSP no da el detalle) ya están leídos del pliego en
 * ella: no se repiten como filas y se nombran aparte en `leidosEnFicha`.
 */
export function requisitosALaVista(placsp = [], deFicha = []) {
  if (!deFicha.length) return { lista: placsp, leidosEnFicha: [] };
  const enFicha = (r) => r.origen === 'placsp' && r.resultado === 'desconocido';
  return {
    lista: [...placsp.filter((r) => !enFicha(r)), ...deFicha],
    leidosEnFicha: [...new Set(placsp.filter(enFicha).map((r) => r.etiqueta))],
  };
}

/**
 * Las líneas de un requisito en la ficha: qué piden (la descripción del pliego o de la
 * PLACSP), lo exigido si no está ya en ese texto y cómo estamos nosotros (el motivo).
 */
export function lineasRequisito(r) {
  const descripcion = (r.descripcion ?? '').trim();
  const piden = descripcion && descripcion.toLowerCase() !== (r.etiqueta ?? '').toLowerCase() ? descripcion : null;
  const exigido = r.exigido && !(piden ?? '').toLowerCase().includes(r.exigido.toLowerCase()) ? r.exigido : null;
  return { tipo: r.etiqueta, piden, exigido, nosotros: r.motivo ?? null };
}

export function ordenarRequisitos(requisitos = []) {
  return requisitos
    .map((r, i) => ({ r, i }))
    .sort((a, b) => gravedad(a.r) - gravedad(b.r) || a.i - b.i)
    .map((x) => x.r);
}

// Las cinco áreas de requisitos, en este orden. `clases`: el tipo de la
// ficha y la clase de la PLACSP (tecnica, financiera…); `temas`: los de la cobertura de la ficha.
// La clasificación sustituye a la solvencia técnica y el seguro suele ser solvencia económica.
const APARTADOS_REQUISITOS = [
  {
    key: 'solvencia_economica',
    titulo: 'Solvencia económica',
    clases: ['solvencia_economica', 'seguro', 'financiera'],
    temas: ['solvencia_economica', 'seguro'],
  },
  {
    key: 'solvencia_tecnica',
    titulo: 'Solvencia técnica',
    clases: ['solvencia_tecnica', 'experiencia', 'clasificacion', 'tecnica'],
    temas: ['solvencia_tecnica', 'clasificacion'],
  },
  {
    key: 'certificaciones',
    titulo: 'Certificaciones',
    clases: ['certificacion', 'habilitacion'],
    temas: ['certificaciones', 'habilitacion'],
  },
  { key: 'perfiles', titulo: 'Perfiles', clases: ['medios_personales'], temas: ['medios_personales'] },
  { key: 'otras', titulo: 'Otros requisitos', clases: null, temas: [] },
];

/** Los temas de la cobertura que ya dicen los apartados («El pliego no lo pide»). */
export const TEMAS_APARTADOS = new Set(APARTADOS_REQUISITOS.flatMap((a) => a.temas));

function textoVacio(a, cobertura) {
  if (!a.temas.length) return 'Nada más.';
  const de = (estado) => cobertura.some((c) => c.estado === estado && a.temas.includes(c.tema));
  if (de('no_lo_pide')) return 'El pliego no lo pide.';
  return de('no_encontrado') ? 'No se encontró en los pliegos.' : 'Sin requisitos todavía.';
}

/**
 * Los requisitos en cinco apartados ({ key, titulo, requisitos, vacio }), cada uno ordenado por
 * gravedad. Lo que no es de los cuatro primeros va a «Otros requisitos». `vacio` dice, si el
 * apartado no tiene ninguno, si el pliego no lo pide o no se encontró (cobertura de la ficha).
 */
export function agruparRequisitos(requisitos = [], cobertura = []) {
  const conocidas = new Set(APARTADOS_REQUISITOS.flatMap((a) => a.clases ?? []));
  return APARTADOS_REQUISITOS.map((a) => {
    const suyos = requisitos.filter((r) => (a.clases ? a.clases.includes(r.clase) : !conocidas.has(r.clase)));
    return {
      key: a.key,
      titulo: a.titulo,
      requisitos: ordenarRequisitos(suyos),
      vacio: suyos.length ? null : textoVacio(a, cobertura ?? []),
    };
  });
}

/**
 * La norma de nueva creación de un requisito, si el pliego la da y nos aplica (la empresa tiene
 * menos de cinco años o no consta su fecha): { exigido, general, documento, pagina }, con la regla
 * general aparte para que se vea qué se exige a los demás. null si no hay o no nos aplica.
 */
export function normaNuevaCreacion(r, empresaNueva) {
  const n = r?.nueva_creacion;
  if (!n || empresaNueva === false) return null;
  const l = lineasRequisito(r);
  const general = [l.piden, l.exigido].filter(Boolean).join(': ') || null;
  return { exigido: n.valor_exigido, general, documento: n.documento ?? null, pagina: n.pagina ?? null };
}

/**
 * Lotes de interés de la criba → «Lote 2 · 103.624 €» o «Lotes 1, 2 · 318.698 €»; null sin
 * lotes. Si alguno no publica importe no se suma nada: la suma de los demás engañaría.
 */
export function textoLotesInteres(lotes = []) {
  if (!lotes.length) return null;
  const importes = lotes.map((l) => l.importe).filter((n) => typeof n === 'number');
  const total = importes.length === lotes.length ? ` · ${euros(importes.reduce((a, b) => a + b, 0))}` : '';
  return `${lotes.length === 1 ? 'Lote' : 'Lotes'} ${lotes.map((l) => l.id).join(', ')}${total}`;
}

/** Regla de presentación por lotes → «A uno o varios lotes (máx. 2 por oferta; 2 adjudicables)». */
export function textoPresentacion(p) {
  if (!p) return null;
  const maximos = [
    p.maximo_lotes ? `máx. ${p.maximo_lotes} por oferta` : null,
    p.maximo_adjudicables ? `${p.maximo_adjudicables} adjudicables` : null,
  ]
    .filter(Boolean)
    .join('; ');
  return `${p.regla}${maximos ? ` (${maximos})` : ''}${p.origen === 'ficha' ? ' · confirmada en el pliego' : ''}`;
}

const REGLAS_FICHA = {
  un_lote: 'A un solo lote',
  todos_los_lotes: 'A todos los lotes',
  uno_o_varios: 'A uno o varios lotes',
};

/** Regla de presentación que lee Hermes del pliego (presentacion_lotes de la ficha) → «A uno o varios lotes (máx. 2 por oferta) · PCAP, pág. 4». */
export function textoReglaFicha(pl) {
  if (!pl) return null;
  const donde = [pl.documento, pl.pagina ? `pág. ${pl.pagina}` : null].filter(Boolean).join(', ');
  return `${REGLAS_FICHA[pl.regla] ?? pl.regla}${pl.maximo_lotes ? ` (máx. ${pl.maximo_lotes} por oferta)` : ''}${donde ? ` · ${donde}` : ''}`;
}

// Duración de cada trabajo de Hermes, como DURACION_MIN del servidor (oferta/plazo.ts).
const MIN_FICHA = 40;
const MIN_GUION = 45;

const listaLotes = (ids) => (ids.length > 1 ? `${ids.slice(0, -1).join(', ')} y ${ids[ids.length - 1]}` : ids[0]);
const loteConArticulo = (ids, uno, varios) => `${ids.length === 1 ? uno : varios} ${listaLotes(ids)}`;

function textoRehace(rehace, lotes) {
  const que = rehace.ficha && rehace.guion ? 'la ficha y el guion' : rehace.ficha ? 'la ficha' : 'el guion';
  const min = (rehace.ficha ? MIN_FICHA : 0) + (rehace.guion ? MIN_GUION : 0);
  return `Hermes rehace ${que} para ${loteConArticulo(lotes, 'el lote', 'los lotes')} (unos ${min} min) y después la propuesta.`;
}

/**
 * Respuesta de «Guardar lotes» → lo que va a pasar de verdad: qué rehace Hermes y cuánto tarda,
 * o que la ficha y el guion siguen valiendo cuando solo se quitaron lotes.
 */
export function textoLotesGuardados(r) {
  const { lotes = [], anadidos = [], quitados = [], rehace = {} } = r ?? {};
  const vamos = `Vamos ${loteConArticulo(lotes, 'al lote', 'a los lotes')}.`;
  if (rehace.ficha || rehace.guion) return `${vamos} ${textoRehace(rehace, anadidos.length ? anadidos : lotes)}`;
  if (anadidos.length)
    return `${vamos} Cuando prepares la oferta, Hermes hará la ficha y el guion para ${loteConArticulo(anadidos, 'el lote', 'los lotes')}.`;
  if (quitados.length)
    return `${vamos} La ficha y el guion siguen valiendo: revisa en Decisiones lo que era ${loteConArticulo(quitados, 'del lote', 'de los lotes')}.`;
  return vamos;
}

/** Lote que se propone al registrar una presentación: el único de interés, o vacío (el contrato). */
export function loteSugerido(lotes = []) {
  return lotes.length === 1 ? lotes[0].id : '';
}

/** Documentación agrupada por sobre, en el orden en que aparece. */
export function porSobre(documentacion = []) {
  const grupos = new Map();
  for (const d of documentacion) {
    if (!grupos.has(d.sobre)) grupos.set(d.sobre, []);
    grupos.get(d.sobre).push(d);
  }
  return [...grupos].map(([sobre, documentos]) => ({ sobre, documentos }));
}

// Carpetas en Conocimiento: reorganización única (Radar / Presentadas) y carpeta de cada presentada.
const ESTADOS_REORGANIZACION = {
  pendiente: 'Pendiente',
  en_curso: 'Moviendo en Drive',
  sincronizando: 'Esperando a drive-sync',
  hecha: 'Hecha',
  sin_drive: 'Sin Drive',
  error: 'Con errores',
};
export function etiquetaReorganizacion(estado) {
  return ESTADOS_REORGANIZACION[estado] ?? estado ?? '—';
}

// Tono del chip: verde hecha, rojo con errores, ámbar sin Drive y azul mientras trabaja.
export function tonoReorganizacion(estado) {
  if (estado === 'hecha') return 'exito';
  if (estado === 'error') return 'error';
  if (estado === 'sin_drive') return 'aviso';
  return 'info';
}

/** Texto de la carpeta de lo presentado de una licitación (null si no hay ninguna pedida). */
export function textoCarpetaPresentada(c) {
  if (!c) return null;
  if (c.estado === 'hecha')
    return `Carpeta de lo presentado: Conocimiento/${c.ruta}/ (PLIEGOS, DOCUMENTACION PRESENTADA y OTROS DOCUMENTOS). Deja ahí lo que se entregó.`;
  if (c.estado === 'error')
    return `No se pudo crear la carpeta de lo presentado (${c.error ?? 'error desconocido'}); se reintenta sola.`;
  return 'Creando la carpeta de lo presentado en Conocimiento y moviendo allí los pliegos…';
}

/**
 * El motivo corto del prefiltro («CPV 79311… · palabra «datos»», con lotes o a mano) en
 * frases legibles, con los CPV de la licitación que encajan con cada prefijo de los filtros.
 */
export function explicarPrefiltro(motivo, cpvs = []) {
  if (!motivo) return [];
  const conPrefijo = (p) => cpvs.filter((c) => c.startsWith(p));
  return motivo.split(' · ').map((trozo) =>
    trozo
      .replace(/CPV (\d+)…/g, (_m, p) => {
        const cuales = conPrefijo(p);
        return `CPV que empieza por ${p}, uno de los de tus filtros${cuales.length ? ` (${cuales.join(', ')})` : ''}`;
      })
      .replace(/^palabra «(.+)»$/, 'el título contiene «$1», una palabra clave de tus filtros')
      .replace(/: palabra «(.+)»$/, ': contiene «$1», una palabra clave de tus filtros')
      .replace(/^añadida a mano$/, 'la añadió una persona a mano'),
  );
}

/**
 * Por qué ya no se puede presentar una licitación que la PLACSP retiró del feed:
 * «Anulada en la PLACSP el lun 5 oct a las 14:58 (13:58 Canarias, si la empresa está allí): …». null si no lo está.
 */
export function textoRetirada(r, ahora = Date.now()) {
  if (!r) return null;
  const hora = horaPlazo(r.en);
  const canarias = segundaHora(hora);
  const cuando = `el ${fechaCorta(r.en.slice(0, 10), ahora)}${hora ? ` a las ${hora}${canarias ? ` (${canarias} Canarias)` : ''}` : ''}`;
  const que = r.etiqueta.includes('PLACSP') ? r.etiqueta : `${r.etiqueta} en la PLACSP`;
  return `${que} ${cuando}: ya no se puede presentar. Si el órgano la vuelve a publicar, llegará como una licitación nueva.`;
}

function motivoFalta(f) {
  if (f.motivo === 'error') return 'da error al bajarlo';
  if (f.motivo === 'no_descargable') return 'está en una web de la que no se baja solo: bájalo a mano';
  if (f.motivo === 'pendiente') return f.error ? 'falla al bajarlo; se reintenta solo' : 'en cola para bajarse';
  return 'entra en cola en la próxima vuelta';
}

/**
 * Lo que falta en Drive de lo publicado y lo que el guion o la ficha citan sin estar entre los
 * pliegos, para la pestaña Pliegos: { titulo, lineas }. null si no falta nada o si aún no toca
 * bajarlo todo (lo nuevo sin ficha solo baja lo que lee la ficha).
 */
export function avisoPliegos(c) {
  if (!c?.descarga_completa) return null;
  const faltan = (c.faltan ?? []).map((f) => `«${f.nombre}»: ${motivoFalta(f)}${f.citado ? ' (lo usa el guion)' : ''}`);
  const citados = (c.citados_sin_pliego ?? []).map(
    (x) =>
      `«${x.documento}»: lo cita ${x.en === 'guion' ? 'el guion' : 'la ficha'}, pero no está entre los pliegos publicados`,
  );
  // Datos de antes de leer los «Otros documentos» y página del expediente sin revisar: que no
  // falte nada no está comprobado.
  const fallo = c.expediente?.error
    ? [`La última revisión de la página del expediente falló (${c.expediente.error}).`]
    : [];
  const sinComprobar = c.sin_comprobar ? [SIN_COMPROBAR, ...fallo] : [];
  if (!faltan.length && !citados.length && !sinComprobar.length) return null;
  const titulo = faltan.length
    ? `Faltan ${plural(faltan.length, 'documento publicado', 'documentos publicados')} en Drive (${c.descargados} de ${c.publicados} bajados)`
    : citados.length
      ? 'Hay documentos citados que no están entre los pliegos'
      : 'Pliegos sin comprobar';
  return { titulo, lineas: [...faltan, ...citados, ...sinComprobar] };
}

const SIN_COMPROBAR =
  'Puede haber más documentos publicados («Otros documentos», como una nota de rectificación): los datos son anteriores a que la plataforma los leyera y la página del expediente aún no se ha podido revisar (se revisa sola cada pocas horas). Revísalo en la PLACSP.';

// euros() redondea a la unidad; un máximo por alumno (110,25 €) necesita los céntimos.
const EUROS_CON_CENTIMOS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  useGrouping: 'always',
});

// «Lote 2: máx. 110,25 € por alumno», o lo que falta decir cuando el guion no fija el máximo.
export function textoMaximoLote(x) {
  const lote = x.lote ? `Lote ${x.lote}: ` : 'Contrato entero: ';
  const por = x.unidad ? ` por ${x.unidad}` : '';
  if (typeof x.maximo === 'number') return `${lote}máx. ${EUROS_CON_CENTIMOS.format(x.maximo)}${por}`;
  const presupuesto =
    typeof x.presupuesto === 'number'
      ? ` (presupuesto ${x.lote ? 'del lote ' : ''}${EUROS_CON_CENTIMOS.format(x.presupuesto)})`
      : '';
  return `${lote}no consta el máximo${por}${presupuesto}`;
}

// Hermes escribía «precio máximo 0» en el criterio cuando el pliego no fija máximo: no es un dato.
const MAXIMO_CERO = /precio\s+m[aá]ximo:?\s*0(?:[.,]0+)?\s*(?:€|euros)?(?=\s|[.,;](?!\d)|$)/i;
export function sinMaximoCero(descripcion) {
  return typeof descripcion === 'string'
    ? descripcion.replace(MAXIMO_CERO, 'precio máximo: no consta (ver por lote)')
    : descripcion;
}

// Ficha: pestañas, cabecera y descarte.

// Los mismos que acepta el servidor (CATEGORIAS_DESCARTE de oportunidades.ts), en este orden.
export const MOTIVOS_DESCARTE = [
  { key: 'solvencia', label: 'Solvencia' },
  { key: 'certificacion', label: 'Certificación' },
  { key: 'plazo', label: 'Plazo' },
  { key: 'precio', label: 'Precio' },
  { key: 'encaje', label: 'Encaje' },
  { key: 'otro', label: 'Otro' },
];
const MOTIVO_DESCARTE_MINIMO = 3;

/**
 * El cuerpo del PATCH al descartar desde la web: { data } o { error } si falta el motivo
 * tipificado o el texto. El tipo es lo que alimenta «Qué nos falta»: sin él no se envía.
 */
export function cuerpoDescarte({ tipo, motivo } = {}) {
  const texto = String(motivo ?? '').trim();
  if (!MOTIVOS_DESCARTE.some((m) => m.key === tipo)) return { data: null, error: 'Elige el motivo del descarte.' };
  if (texto.length < MOTIVO_DESCARTE_MINIMO) return { data: null, error: 'Dilo en pocas palabras.' };
  return { data: { estado: 'descartada', motivo_descarte: texto, categoria_descarte: tipo }, error: null };
}

/**
 * El aviso de una descartada en su ficha (sin comprobaciones), o null si no lo está o no hay motivo.
 * Lo que descartó el código dice por qué y que se puede «Recuperar».
 */
export function avisoDescarte(f) {
  if (f?.estado !== 'descartada' || !f.motivo_descarte) return null;
  if (!f.descarte_automatico) return `Descartada: ${f.motivo_descarte}`;
  const recuperar = ' Si no es así, pulsa «Recuperar».';
  if (f.categoria_descarte === DESCARTE_NO_GO)
    return `Se descartó sola: Hermes leyó los pliegos y recomienda no ir (${motivoDeHermes(f.motivo_descarte).replace(/[.\s]+$/, '')}).${recuperar}`;
  return `Se descartó sola porque no la podemos presentar. ${f.motivo_descarte}${recuperar}`;
}

const DIAS_COMPROBACIONES = 3;

/** Una nueva con la ficha aprobada es, para la persona, una «ficha por revisar». */
export function esFichaPorRevisar(f) {
  return f?.estado === 'ficha_por_revisar' || (f?.estado === 'nueva' && Boolean(f?.go_no_go?.ficha?.aprobada));
}

// Por revisar y con el próximo plazo (la solicitud, si la hay) a 3 días o menos: ya se decide en las comprobaciones.
function porRevisarConPrisa(f, ahora) {
  if (!esFichaPorRevisar(f)) return false;
  const instante = instanteLocal(proximoPlazo(f.fecha_limite, f.fecha_solicitud, ahora).fecha);
  return instante !== null && instante >= ahora && diasDeCalendario(instante, ahora) <= DIAS_COMPROBACIONES;
}

/** La ficha se abre en las comprobaciones: en preparación, por revisar con prisa o descartada tras empezar la oferta (solo lectura). */
export function conComprobaciones(f, ahora = Date.now()) {
  if (f?.estado === 'en_preparacion') return true;
  if (f?.estado === 'descartada') return Boolean(f.oferta?.guion);
  return porRevisarConPrisa(f, ahora);
}

const DE_LA_PROPUESTA = new Set(['presentada', 'ganada', 'perdida']);

/**
 * Las pestañas de la ficha ({ key, label, cuenta? }), las mismas en todos los estados:
 * Resumen · Requisitos · Criterios de valoración · Mercado. En preparación, además Oferta (el
 * asistente que pregunta y el detalle) y Revisión (lo que impide presentar y lo generado, por sobre
 * y documento); descartada tras empezarla o por decidir con prisa, solo Oferta (lo que hay que decidir); en lo
 * presentado, Presentación (clave «preparacion», la de los enlaces antiguos).
 */
export function pestanasFicha(f, ahora = Date.now()) {
  const porConfirmar = (f?.go_no_go?.requisitos ?? []).filter(
    (r) => r.resultado === 'desconocido' && !r.en_ficha,
  ).length;
  const enPreparacion = f?.estado === 'en_preparacion';
  const oferta = enPreparacion
    ? [
        { key: 'oferta', label: 'Oferta' },
        { key: 'revision', label: 'Revisión' },
      ]
    : conComprobaciones(f, ahora)
      ? [{ key: 'oferta', label: 'Oferta' }]
      : [];
  const presentacion = DE_LA_PROPUESTA.has(f?.estado)
    ? [{ key: 'preparacion', label: 'Presentación', cuenta: f.oferta?.memoria?.por_revisar ? 1 : 0 }]
    : [];
  return [
    { key: 'resumen', label: 'Resumen' },
    { key: 'requisitos', label: 'Requisitos', cuenta: porConfirmar },
    { key: 'criterios', label: 'Criterios de valoración' },
    { key: 'mercado', label: 'Mercado' },
    ...oferta,
    ...presentacion,
  ];
}

// Nombres antiguos de las secciones de la ficha: hay enlaces guardados que los usan y llevan a su sitio actual (las
// comprobaciones se ven en la Revisión y la Oferta).
const EQUIVALENTE = { preparacion: 'oferta', comprobaciones: 'oferta', expediente: 'requisitos', pliegos: 'resumen' };

/**
 * La sección que se enseña: la pedida si está, su equivalente si no. Un enlace de las comprobaciones a una
 * fila o a una pieza (#bloqueo=…, #testid=…: la Mesa, el MCP) lleva a la Revisión, donde están las
 * filas y el registro; sin ellas, a la Oferta. Sin pedir ninguna, la Oferta si la hay o el Resumen.
 */
export function seccionDeFicha(pedida, pestanas, foco = null) {
  const hay = (k) => pestanas.some((p) => p.key === k);
  if (pedida === 'comprobaciones' && (foco?.bloqueo || foco?.testid) && hay('revision')) return 'revision';
  if (pedida && hay(pedida)) return pedida;
  if (pedida && hay(EQUIVALENTE[pedida])) return EQUIVALENTE[pedida];
  return hay('oferta') ? 'oferta' : (pestanas[0]?.key ?? null);
}

// El rol de una fila de medios: «Tutor de topografía (lote 3): …» → «tutor de topografía».
function rolDe(titulo) {
  const rol = String(titulo ?? '')
    .split(/\s*\(lote|:/)[0]
    .trim();
  return rol ? rol.charAt(0).toLowerCase() + rol.slice(1) : 'que falta';
}
const criterioDe = (titulo) => /«([^»]+)»/.exec(String(titulo ?? ''))?.[1] ?? null;
const delLote = (b) => (b.lote ? ` del lote ${b.lote}` : '');

// El botón dice qué hacer con un verbo, como la Mesa: «Fijar el precio del lote 3».
const VERBO = {
  fijar_precio: (b) => `Fijar el precio${delLote(b)}`,
  asignar_rol: (b) => `Asignar a alguien al rol de ${rolDe(b.titulo)}`,
  desmarcar_criterio: (b) =>
    criterioDe(b.titulo) ? `Revisar el criterio «${criterioDe(b.titulo)}»` : 'Revisar el criterio',
  completar_empresa: () => 'Completar los datos de la empresa',
  preparar_documento: (b) => `Preparar los documentos${delLote(b)}`,
  revisar_memoria: () => 'Revisar la memoria',
  aplicar_diff: () => 'Revisar la propuesta de Hermes',
  subir_certificado: () => 'Subir el certificado',
  consulta_organo: () => 'Preparar la consulta al órgano',
  rehacer_ficha: () => 'Rehacer la ficha',
  rehacer_anexo: () => 'Rehacer el anexo',
  extraer_guion: () => 'Volver a extraer el guion',
};

/** El texto con verbo de lo que pide una fila de las comprobaciones. */
export function textoAccionBloqueo(b) {
  const verbo = VERBO[b?.accion?.tipo];
  return verbo ? verbo(b) : `Resolver: ${b?.titulo ?? 'lo pendiente'}`;
}

const AL_PAQUETE = new Set(['lista_para_firmar', 'presentable_con_riesgos']);

/**
 * El único botón primario de la cabecera de una oferta en preparación, de las comprobaciones: el primer
 * bloqueo tuyo abierto ({ clave: 'bloqueo', bloqueo }), «Ir al paquete» si está para firmar, o
 * solo la línea de Hermes ({ clave: 'esperar', espera }) mientras trabaja. Una descartada con
 * comprobaciones no propone nada (en solo lectura, solo deja «Recuperar»). Fuera de preparación, el
 * siguiente paso de siempre. null: sin botón.
 */
export function accionCabecera(comprobaciones, f) {
  if (f?.estado === 'descartada' && conComprobaciones(f)) return null;
  if (f?.estado !== 'en_preparacion') return siguienteAccion(f);
  if (!comprobaciones?.veredicto || comprobaciones.veredicto.tipo === 'descartada') return null;
  const tuyo = bloqueosAbiertos(comprobaciones).find((b) => b.actor === 'tu');
  if (tuyo) return { clave: 'bloqueo', bloqueo: tuyo.clave, texto: textoAccionBloqueo(tuyo) };
  if (comprobaciones.veredicto.tipo === 'hermes_trabajando')
    return { clave: 'esperar', texto: comprobaciones.veredicto.texto, espera: comprobaciones.veredicto.texto };
  return AL_PAQUETE.has(comprobaciones.veredicto.tipo) ? { clave: 'paquete', texto: 'Ir al paquete' } : null;
}

/** La pregunta antes de preparar una oferta en rojo o retirada (o null si no hace falta). */
export function preguntaPreparar(f) {
  if (f?.retirada) return 'La licitación está retirada en la Plataforma: ¿prepararla igualmente?';
  return f?.go_no_go?.semaforo?.color === 'rojo' ? 'La ficha dice «No cumplimos»: ¿prepararla igualmente?' : null;
}

/** El estado de la PLACSP del subtítulo: en una descartada, que sigue en plazo (por eso se ve). */
export function textoEstadoPlacsp(f) {
  return f?.estado === 'descartada' ? 'En plazo en la PLACSP' : (f?.estado_placsp ?? '');
}

const sinTildes = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const coincide =
  (q) =>
  (...textos) =>
    textos.some((t) => sinTildes(t).includes(q));

// Los requisitos de la ficha que casan, con sus comprobaciones reindexadas (van por posición).
function requisitosFichaQueCasan(datos, casa) {
  const quedan = (datos?.requisitos ?? [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => casa(r.descripcion, r.tipo, r.valor_exigido, r.justificacion));
  const verificaciones = quedan.flatMap(({ i }, j) =>
    (datos?.verificaciones ?? []).filter((v) => v.indice === i).map((v) => ({ ...v, indice: j })),
  );
  return { requisitos: quedan.map(({ r }) => r), verificaciones };
}

function conFichaFiltrada(gng, casa) {
  const aprobada = gng?.ficha?.aprobada;
  if (!aprobada?.datos) return gng?.ficha;
  const criterios = (aprobada.datos.criterios ?? []).filter((c) => casa(c.descripcion));
  return {
    ...gng.ficha,
    aprobada: {
      ...aprobada,
      datos: { ...aprobada.datos, ...requisitosFichaQueCasan(aprobada.datos, casa), criterios },
    },
  };
}

function contarFiltrados(gng, datos, pliegos) {
  const fichaDatos = gng?.ficha?.aprobada?.datos;
  return {
    requisitos: (gng?.requisitos ?? []).length + (fichaDatos?.requisitos ?? []).length,
    criterios: (fichaDatos?.criterios ?? []).length || datos.criterios.length,
    pliegos: pliegos.length || datos.documentos.length,
  };
}

/**
 * La ficha con solo los requisitos, criterios y pliegos que contienen `texto` (sin tildes ni
 * mayúsculas) y cuántos quedan de cada uno. Sin texto, la ficha tal cual y `filtrada: false`.
 */
export function filtrarExpediente(f, texto) {
  const q = sinTildes(texto).trim();
  if (!q || !f) return { f, filtrada: false, cuentas: null };
  const casa = coincide(q);
  const gng = f.go_no_go && {
    ...f.go_no_go,
    requisitos: (f.go_no_go.requisitos ?? []).filter((r) => casa(r.etiqueta, r.descripcion, r.motivo, r.exigido)),
    ficha: conFichaFiltrada(f.go_no_go, casa),
  };
  const datos = {
    ...(f.datos ?? {}),
    criterios: (f.datos?.criterios ?? []).filter((c) => casa(c.descripcion)),
    documentos: (f.datos?.documentos ?? []).filter((d) => casa(d.nombre, d.tipo)),
  };
  const pliegos = (f.pliegos ?? []).filter((p) => casa(p.nombre, p.tipo));
  return { f: { ...f, go_no_go: gng, datos, pliegos }, filtrada: true, cuentas: contarFiltrados(gng, datos, pliegos) };
}

const CAUSA_FALLO = {
  sin_resultado: 'Hermes acabó sin dejar el resultado',
  run_inactivo: 'Hermes dejó de responder',
  run_tiempo_maximo: 'tardó más del máximo',
  run_perdido: 'Hermes se reinició y perdió el trabajo',
  run_failed: 'Hermes dio el trabajo por fallido',
  run_cancelled: 'se paró el trabajo en Hermes',
  limite_uso: 'se agotó el uso del modelo',
  sin_herramienta: 'falta una herramienta en Hermes',
  herramientas_desfasadas: 'Hermes tiene herramientas antiguas: hay que reiniciarlo',
  consulta_fallida: 'no se pudo consultar a Hermes',
  sin_destino: 'no hay perfil de Hermes configurado',
  tipo_desconocido: 'tipo de trabajo desconocido',
  error_interno: 'error interno al preparar el trabajo',
  relanzado: 'se relanzó',
  zombi: 'llevaba 48 h en la cola sin salir',
};

/** La causa de un fallo de la cola en palabras (por su código); el código tal cual si no se conoce. */
export function causaFallo(codigo) {
  if (!codigo || codigo === 'desconocido') return 'error de Hermes sin clasificar';
  return CAUSA_FALLO[codigo] ?? codigo;
}

/** «Ficha», «Memoria apartado»: el tipo de un trabajo de la cola sin el prefijo del dominio. */
export function nombreTipoTrabajo(tipo) {
  const corto = String(tipo ?? '')
    .replace(/^[a-z]+\./, '')
    .replaceAll('_', ' ');
  return corto.charAt(0).toUpperCase() + corto.slice(1);
}

/**
 * El KPI de la ingesta: «al día» solo si de verdad trae novedades; si el servidor avisa de que
 * lleva más de 6 h sin traer nada, «sin novedades». La pista dice hasta cuándo está al día.
 */
export function textoIngesta(estado) {
  const fase = estado?.ingesta?.estado?.fase;
  const pista = estado?.al_dia_hasta ? `Al día hasta ${fechaHora(estado.al_dia_hasta)}` : null;
  if (!fase) return { valor: estado?.ingesta?.activa ? 'arrancando' : 'parada', pista };
  if (fase !== 'esperando') return { valor: `${fase}…`, pista };
  const parada = (estado.alertas_operacion ?? []).some((a) => a.motivo === 'ingesta_sin_novedades');
  return { valor: parada ? 'sin novedades' : 'al día', pista };
}
