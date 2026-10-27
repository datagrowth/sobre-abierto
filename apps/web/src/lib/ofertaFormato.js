// Formato y lógica del guion del pliego, las decisiones de la oferta y su precio (puntos estimados,
// importes, equipo), sin React y con tests. Trabaja sobre lo que devuelve GET …/oferta y lo traduce a
// estados, textos y formularios para las comprobaciones y sus cajones.
import { euros, fechaCorta, lista, numeroONulo, plural } from './formato.js';

const TIPOS_DOCUMENTO = {
  memoria: 'Memoria técnica',
  deuc: 'DEUC',
  declaracion: 'Declaración',
  oferta_economica: 'Oferta económica',
  acreditacion: 'Acreditación',
  otro: 'Otro',
};

export const NUMERO = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

// Importes como se escriben en España («95.000,50»); numeroONulo los vuelve a leer igual.
// Hasta 4 decimales: un precio por hora (1,4080 €) no se redondea al guardarlo.
const IMPORTE_FORMULARIO = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });

export const numero = (n) => (typeof n === 'number' ? NUMERO.format(n) : '—');

const sumaPuntos = (items = []) => items.reduce((t, x) => t + (typeof x.puntos === 'number' ? x.puntos : 0), 0);

/** Cita de un pasaje del pliego: «PCAP, pág. 41»; null sin documento. */
export function cita(x) {
  if (!x?.documento) return null;
  return x.pagina ? `${x.documento}, pág. ${x.pagina}` : x.documento;
}

/**
 * El guion es anterior a la ficha vigente: lo dice el servidor (`guion_desfasado`); si no
 * lo trae, se compara la ficha con la que se hizo.
 */
export function guionDesfasado(o, fichaId = null) {
  if (!o?.guion) return false;
  if (typeof o.guion_desfasado === 'boolean') return o.guion_desfasado;
  return fichaId !== null && o.guion.ficha_id != null && o.guion.ficha_id !== fichaId;
}

/** Estado del paso 1 para su chip y su botón: { clave, texto }. */
export function estadoGuion(o) {
  if (o.guion_en_curso)
    return {
      clave: 'en_curso',
      texto: o.guion_en_curso.estado === 'generando' ? 'Extrayendo del pliego…' : 'En cola…',
    };
  if (!o.guion) {
    if (!o.ficha_aprobada) return { clave: 'bloqueado', texto: 'Falta la ficha aprobada' };
    if (o.pliegos_listos === false) return { clave: 'bloqueado', texto: 'Los pliegos aún no se leen' };
    return { clave: 'pendiente', texto: 'Sin guion' };
  }
  if (o.lotes_cambiados) return { clave: 'desfasado', texto: `Guion v${o.guion.version}, de otros lotes` };
  if (guionDesfasado(o)) return { clave: 'desfasado', texto: `Guion v${o.guion.version}, anterior a la ficha` };
  return { clave: 'hecho', texto: `Guion v${o.guion.version}` };
}

/** ¿La mesa puntúa la memoria (del guion o una versión)? false si el pliego la exige sin puntuarla. */
export const memoriaValorable = (m) => m?.valorable !== false && (m?.apartados?.some((a) => a.puntos > 0) ?? true);

/** «2 archivos electrónicos · memoria de 4 apartados (25 puntos, máx. 25 págs.) · 5 criterios automáticos · hasta lun 13 oct». */
export function resumenGuion(d) {
  const partes = [plural(d.archivos.length, 'archivo electrónico', 'archivos electrónicos')];
  if (d.memoria && !memoriaValorable(d.memoria)) {
    const limite = d.memoria.limite_paginas ? ` (máx. ${d.memoria.limite_paginas} págs.)` : '';
    partes.push(`memoria no valorable de ${plural(d.memoria.apartados.length, 'apartado')}${limite}`);
  } else if (d.memoria) {
    const limite = d.memoria.limite_paginas ? `, máx. ${d.memoria.limite_paginas} págs.` : '';
    partes.push(
      `memoria de ${plural(d.memoria.apartados.length, 'apartado')} (${numero(sumaPuntos(d.memoria.apartados))} puntos${limite})`,
    );
  } else partes.push('sin memoria técnica');
  if (d.automaticos.length) partes.push(plural(d.automaticos.length, 'criterio automático', 'criterios automáticos'));
  if (d.plazo?.fecha_limite) partes.push(`hasta ${fechaCorta(d.plazo.fecha_limite)}`);
  return partes.join(' · ');
}

/** Los documentos de un archivo electrónico, con tipo, quién lo produce y su cita legibles. */
export function documentosDeArchivo(a) {
  return (a.documentos ?? []).map((d) => ({
    nombre: d.nombre,
    tipo: TIPOS_DOCUMENTO[d.tipo] ?? d.tipo,
    obligatorio: d.obligatorio !== false,
    quien: d.produce === 'hermes' ? 'La redacta Hermes' : 'Lo prepara una persona',
    modelo: d.origen?.modelo ?? null,
    cita: cita(d.origen) ?? cita(a),
    notas: d.notas ?? null,
  }));
}

/** «máx. 25 págs. · Arial 11 · interlineado sencillo»; null sin memoria. */
export function textoFormatoMemoria(m) {
  if (!m) return null;
  const f = m.formato ?? {};
  const partes = [m.limite_paginas ? `máx. ${m.limite_paginas} págs.` : 'sin límite de páginas'];
  const letra = [f.fuente, f.tamano_letra].filter(Boolean).join(' ');
  if (letra) partes.push(letra);
  if (f.interlineado) partes.push(`interlineado ${f.interlineado}`);
  if (f.otros) partes.push(f.otros);
  return partes.join(' · ') + (m.limite_detalle ? ` (${m.limite_detalle})` : '');
}

/** El plazo que leyó el guion no es el de la PLACSP (día distinto, o hora distinta si las dos la traen). */
export function plazoDiscrepa(plazoGuion, fechaLimitePlacsp) {
  const a = String(plazoGuion ?? '');
  const b = String(fechaLimitePlacsp ?? '');
  if (!a || !b) return false;
  if (a.slice(0, 10) !== b.slice(0, 10)) return true;
  const ha = /T(\d{2}:\d{2})/.exec(a)?.[1];
  const hb = /T(\d{2}:\d{2})/.exec(b)?.[1];
  return Boolean(ha && hb && ha !== hb);
}

/** Los tramos de un criterio automático (gemela de guionLotes.tramosDe): sin tramos, uno con el criterio entero. */
export function tramosDeAutomatico(a) {
  return a?.tramos?.length ? a.tramos : [{ descripcion: a?.criterio ?? '', puntos: a?.puntos ?? 0 }];
}

/** Los pares (criterio, lote) que se deciden: uno por criterio común y uno por lote de los nuestros que cite el criterio. */
/** El automático del guion de un criterio en un lote: el mismo texto puede salir varias veces, cada una con sus lotes y tramos. */
export function automaticoDeLote(automaticosGuion = [], criterio, lote = null) {
  const homonimos = automaticosGuion.filter((a) => a.criterio === criterio);
  const comun = homonimos.find((a) => !a.lotes?.length);
  return lote === null ? (comun ?? homonimos[0]) : (homonimos.find((a) => a.lotes?.includes(lote)) ?? comun);
}

function paresDeAutomaticos(automaticosGuion = [], lotes = []) {
  return automaticosGuion.flatMap((a) =>
    a.lotes?.length ? a.lotes.filter((l) => lotes.includes(l)).map((l) => ({ a, lote: l })) : [{ a, lote: null }],
  );
}

/**
 * Las filas de los criterios automáticos en el orden del guion, una por criterio y lote,
 * conservando lo decidido; las de lotes a los que ya no vamos se descartan. Un
 * criterio de un solo tramo al que nos acogemos lleva ese tramo.
 */
export function sincronizarAutomaticos(decididos = [], automaticosGuion = [], lotes = []) {
  return paresDeAutomaticos(automaticosGuion, lotes).map(({ a, lote }) => {
    const d = (decididos ?? []).find((x) => x.criterio === a.criterio && (x.lote ?? null) === lote);
    const tramos = tramosDeAutomatico(a);
    const nos = Boolean(d?.nos_acogemos);
    const tramo = d?.tramo ?? (nos && tramos.length === 1 ? tramos[0].descripcion : null);
    return {
      criterio: a.criterio,
      lote,
      nos_acogemos: nos,
      tramo,
      valor: valorFormulario(d?.valor),
      evidencia: d?.evidencia ?? '',
      nota: d?.nota ?? '',
    };
  });
}

// El valor ofertado como se escribe en el formulario («2,25»); vacío si no hay.
const VALOR_FORMULARIO = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false });

const valorFormulario = (v) => (typeof v === 'number' ? VALOR_FORMULARIO.format(v) : typeof v === 'string' ? v : '');

const sinTildes = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const NOTA_CONTRARIA = /^\s*no nos acogemos\b/;

const ERROR_NOTA_CONTRARIA = 'La nota dice que no nos acogemos: desmarca el criterio o cambia la nota';

/**
 * Por qué no se puede guardar un criterio marcado (gemela de automaticosHonestos del
 * servidor): una nota que empieza por «No nos acogemos» o un documento exigido sin evidencia. null si se puede.
 */
export function bloqueoAutomatico(f, a = null) {
  if (!f?.nos_acogemos) return null;
  if (NOTA_CONTRARIA.test(sinTildes(f.nota))) return ERROR_NOTA_CONTRARIA;
  if (a?.exige_documento && !String(f.evidencia ?? '').trim())
    return `Pide ${a.exige_documento}: di en «Evidencia» dónde consta o desmarca el criterio`;
  return null;
}

/** Los lotes a los que vamos: los del ámbito (los de interés). Vacío si la oferta es para el contrato entero. */
export function lotesDelAmbito(ambito) {
  return ambito?.por_lotes ? ambito.lotes.map((l) => l.id) : [];
}

/** Formulario de decisiones recién abierto: los lotes a los que vamos y los automáticos sin marcar. */
export function decisionesIniciales(guion, ambito = null) {
  const lotes = lotesDelAmbito(ambito);
  return {
    lotes,
    equipo: [],
    automaticos: sincronizarAutomaticos([], guion.automaticos, lotes),
    herramientas: '',
    enfoque: '',
    ofertas: ofertasIniciales(guion, lotes),
  };
}

/** La oferta económica del guion para un lote (la que lo cita o la del contrato entero). */
export function ofertaDeLoteGuion(guion, lote) {
  const todas = ofertasEconomicas(guion);
  return (
    (lote !== null && todas.find((o) => o.lotes.includes(lote))) ||
    todas.find((o) => !o.lotes.length) ||
    (todas.length === 1 && lote === null ? todas[0] : null)
  );
}

/**
 * Las filas de precio del formulario: una por lote (o una para el contrato entero), con un
 * campo por cada precio unitario de su oferta en el guion, o el importe total. Lo guardado se
 * conserva; un precio de antes sin lote vale para cada lote.
 */
function ofertasIniciales(guion, lotes = [], guardadas = []) {
  const unica = guardadas.length === 1 && guardadas[0].lote == null ? guardadas[0] : null;
  return (lotes.length ? lotes : [null]).map((lote) => {
    const g = guardadas.find((o) => (o.lote ?? null) === lote) ?? unica;
    const lineas = ofertaDeLoteGuion(guion, lote)?.precios_unitarios ?? [];
    const solo = lineas.length === 1 && !g?.unitarios?.length && typeof g?.importe === 'number' ? g.importe : null;
    const unitarios = lineas.map((l) => {
      const p = g?.unitarios?.find((u) => u.concepto === l.concepto)?.precio ?? solo;
      return { concepto: l.concepto, precio: importeFormulario(p) };
    });
    const importe = lineas.length ? '' : importeFormulario(g?.importe);
    const vacia = !unitarios.some((u) => u.precio) && !importe;
    return { lote, pendiente: vacia ? g?.pendiente !== false : false, importe, unitarios };
  });
}

/** Importe tal como se escribe en el formulario («95.000», «1,408»). */
export function importeFormulario(n) {
  return typeof n === 'number' ? IMPORTE_FORMULARIO.format(n) : '';
}

// Los lotes no se eligen en Decisiones: son los de interés (bloque Lotes). Con el ámbito a
// mano, el formulario lleva siempre esos, aunque lo guardado o la propuesta digan otros.
function conLotesDelAmbito(campos, ambito) {
  return ambito ? { ...campos, lotes: lotesDelAmbito(ambito) } : campos;
}

/**
 * Formulario recién abierto: lo guardado; si no hay, la propuesta de Hermes; si tampoco, vacío.
 * Los lotes, los del ámbito. Sin precio guardado, el lote queda pendiente y vacío: el precio lo elige una persona.
 */
export function camposIniciales(o, ambito = null) {
  if (o.decisiones) return conLotesDelAmbito(camposDeDecisiones(o.decisiones.datos, o.guion.datos), ambito);
  const base = o.propuesta_decisiones
    ? camposDeDecisiones(o.propuesta_decisiones.decisiones, o.guion.datos)
    : decisionesIniciales(o.guion.datos, ambito);
  return conLotesDelAmbito(base, ambito);
}

/** La propuesta de Hermes como formulario, con los lotes a los que vamos; sin precio, que la propuesta nunca lo trae. */
export function camposDePropuesta(o, ambito = null) {
  return conLotesDelAmbito(camposDeDecisiones(o.propuesta_decisiones.decisiones, o.guion.datos), ambito);
}

/** ¿Hay una propuesta de Hermes posterior a las decisiones guardadas? */
export function propuestaPosterior(o) {
  return Boolean(
    o?.propuesta_decisiones && o.decisiones && o.propuesta_decisiones.creada_en > o.decisiones.actualizada_en,
  );
}

const QUE_ES_AUTOMATICO = { si: 'acreditado', no: 'no lo cumplimos', falta_dato: 'falta el dato: confírmalo' };

/**
 * Lo que propuso Hermes para un criterio: «tramo «2 h o menos» (capacidad demostrada: turnos
 * de 2025)», «0 puntos — exige el Dossier…, que no está en la Biblioteca», «acreditado»… Un
 * compromiso que se acredita con un documento (un dossier del fabricante) lleva «cumple» como
 * una acreditación y se lee como tal.
 */
export function textoMotivoAutomatico(m, a = null) {
  if (!m.nos_acogemos && a?.exige_documento && m.documento_en_mano !== true)
    return `0 puntos — exige ${a.exige_documento}, que no está en la Biblioteca`;
  if (m.nos_acogemos && m.nivel) {
    const capacidad =
      m.capacidad === 'demostrada' ? ` (capacidad demostrada${m.evidencia ? `: ${m.evidencia}` : ''})` : '';
    return `tramo «${m.nivel}»${capacidad}`;
  }
  if (m.tipo === 'compromiso' && !m.cumple) return m.nos_acogemos ? 'compromiso' : 'compromiso: no nos acogemos';
  return QUE_ES_AUTOMATICO[m.cumple] ?? 'hay que acreditarlo';
}

/** La clave de un criterio decidido o propuesto: criterio y lote. */
export const claveAutomatico = (a) => `${a.criterio}|${a.lote ?? ''}`;

/** Por qué propuso Hermes a cada persona y cada criterio automático. */
export function motivosDePropuesta(propuesta) {
  const datos = propuesta?.datos;
  return {
    equipo: new Map((datos?.equipo ?? []).map((p) => [p.persona_id, p.motivo])),
    automaticos: new Map(
      (datos?.automaticos ?? []).map((a) => [
        claveAutomatico(a),
        {
          tipo: a.tipo,
          cumple: a.cumple ?? null,
          nivel: a.tramo ?? a.nivel ?? null,
          nos_acogemos: a.nos_acogemos ?? null,
          capacidad: a.capacidad ?? null,
          evidencia: a.evidencia ?? null,
          documento_en_mano: a.documento_en_mano ?? null,
          motivo: a.motivo,
        },
      ]),
    ),
  };
}

const PORCENTAJE = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** «75.000 € · baja del 25 % · habría ganado en precio el 80 % de 34 adjudicaciones parecidas». */
export function textoOpcionPrecio(op, sugerido) {
  if (!op) return null;
  const importe = textoPrecio(op.importe, sugerido.unidad);
  const ganadas =
    typeof op.ganadas === 'number'
      ? ` · habría ganado en precio el ${PORCENTAJE.format(op.ganadas * 100)} % de ${plural(sugerido.comparables, 'adjudicación parecida', 'adjudicaciones parecidas')}`
      : '';
  return `${importe} · baja del ${PORCENTAJE.format(op.baja * 100)} %${ganadas}`;
}

/** «Umbral de anormalidad estimado: baja del 20 % (3 ofertas esperadas, art. 85 RGLCAP).» */
export function textoUmbralPrecio(sugerido) {
  if (!sugerido || sugerido.umbral_anormal == null) return null;
  return `Umbral de anormalidad estimado: baja del ${PORCENTAJE.format(sugerido.umbral_anormal * 100)} % (${plural(sugerido.ofertas_esperadas, 'oferta esperada', 'ofertas esperadas')}, art. 85 RGLCAP). Las dos opciones quedan un punto por debajo.`;
}

/** Decisiones guardadas → formulario (los automáticos y los precios, sincronizados con el guion vigente y los lotes). */
export function camposDeDecisiones(datos, guion) {
  const lotes = [...(datos.lotes ?? [])];
  const guardadas = datos.ofertas ?? (datos.precio ? [{ lote: null, ...datos.precio }] : []);
  return {
    lotes,
    equipo: (datos.equipo ?? []).map((p) => ({
      persona_id: p.persona_id,
      rol_en_la_oferta: p.rol_en_la_oferta,
      dedicacion: p.dedicacion ?? '',
      lotes: [...(p.lotes ?? [])],
    })),
    automaticos: sincronizarAutomaticos(datos.automaticos, guion?.automaticos ?? [], lotes),
    herramientas: (datos.herramientas ?? []).join(', '),
    enfoque: datos.enfoque ?? '',
    ofertas: ofertasIniciales(guion, lotes, guardadas),
  };
}

function leerEquipo(equipo) {
  const filas = equipo.map((p) => ({
    persona_id: Number(p.persona_id),
    rol_en_la_oferta: String(p.rol_en_la_oferta ?? '').trim(),
    dedicacion: String(p.dedicacion ?? '').trim(),
    lotes: p.lotes ?? [],
  }));
  if (filas.some((p) => !Number.isInteger(p.persona_id) || p.persona_id <= 0))
    return { error: 'Elige a cada persona del equipo en la lista.' };
  if (filas.some((p) => p.rol_en_la_oferta.length < 2))
    return { error: 'Cada persona del equipo lleva su rol en la oferta (p. ej. «Jefa de proyecto»).' };
  return {
    equipo: filas.map(({ dedicacion, lotes, ...p }) => ({
      ...p,
      ...(dedicacion ? { dedicacion } : {}),
      ...(lotes.length ? { lotes: [...lotes] } : {}),
    })),
  };
}

const ERROR_IMPORTE =
  'Cada precio es un número en € sin impuestos (p. ej. 95.000 o 1,50), o déjalo vacío y marca el lote «Pendiente».';

// Un lote: los precios escritos (o ninguno, y entonces pendiente si está marcado).
function leerOferta(o) {
  const importe = numeroONulo(o.importe);
  const unitarios = o.unitarios.map((u) => ({ concepto: u.concepto, precio: numeroONulo(u.precio) }));
  if ([importe, ...unitarios.map((u) => u.precio)].some((n) => Number.isNaN(n) || n === 0))
    return { error: ERROR_IMPORTE };
  const dados = unitarios.filter((u) => u.precio !== null);
  const conPrecio = importe !== null || dados.length > 0;
  return { oferta: { lote: o.lote, pendiente: conPrecio ? false : Boolean(o.pendiente), importe, unitarios: dados } };
}

const ERROR_VALOR = 'El valor ofertado es una cifra (p. ej. 30 o 2,25), o déjalo vacío.';

// El valor ofertado solo cuenta si nos acogemos: desmarcado, no se teclea nada.
function leerAutomatico(a) {
  const evidencia = String(a.evidencia ?? '').trim();
  const nota = String(a.nota ?? '').trim();
  const bloqueo = bloqueoAutomatico(a);
  if (bloqueo) return { error: `${a.criterio}: ${bloqueo}.` };
  const valor = a.nos_acogemos ? (typeof a.valor === 'number' ? a.valor : numeroONulo(a.valor)) : null;
  if (Number.isNaN(valor)) return { error: ERROR_VALOR };
  return {
    automatico: {
      criterio: a.criterio,
      lote: a.lote ?? null,
      nos_acogemos: Boolean(a.nos_acogemos),
      tramo: a.nos_acogemos ? (a.tramo ?? null) : null,
      ...(evidencia ? { evidencia } : {}),
      ...(nota ? { nota } : {}),
      ...(valor !== null ? { valor } : {}),
    },
  };
}

/** Formulario → cuerpo de PUT …/oferta/decisiones, o el error para la persona. Con precio, el lote ya no está pendiente. */
export function leerDecisiones(campos) {
  const ofertas = (campos.ofertas ?? []).map(leerOferta);
  const mal = ofertas.find((o) => o.error);
  if (mal) return mal;
  const equipo = leerEquipo(campos.equipo ?? []);
  if (equipo.error) return equipo;
  const automaticos = (campos.automaticos ?? []).map(leerAutomatico);
  const malo = automaticos.find((a) => a.error);
  if (malo) return malo;
  return {
    body: {
      lotes: [...(campos.lotes ?? [])],
      equipo: equipo.equipo,
      automaticos: automaticos.map((a) => a.automatico),
      herramientas: lista(campos.herramientas),
      enfoque: String(campos.enfoque ?? '').trim(),
      ofertas: ofertas.map((o) => o.oferta),
    },
  };
}

function igual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const claves = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return claves.every((k) => igual(a[k], b[k]));
}

/** El formulario difiere de lo que se cargó: no se pisa cuando llega un evento y se avisa al salir. */
export function hayCambios(campos, base) {
  return !igual(campos, base);
}

// El tramo cuyo «valor» (lo que se teclea) es el ofertado: «30» casa con 30.
function tramoDelValor(tramos, valor) {
  const v = typeof valor === 'number' ? valor : numeroONulo(valor);
  if (v === null || Number.isNaN(v)) return null;
  return tramos.find((t) => t.valor !== undefined && numeroONulo(t.valor) === v) ?? null;
}

/**
 * Los puntos que daría un criterio decidido: con tramos, los del tramo elegido
 * o del que casa con el valor ofertado; sin tramos (el guion no trae la fórmula estructurada) no
 * se calculan: { puntos: null, hasta }. Sin acogernos, 0. `hasta`, el máximo del criterio.
 */
export function puntosEstimados(a, decision) {
  const hasta = a?.tramos?.length ? Math.max(...a.tramos.map((t) => t.puntos ?? 0)) : (a?.puntos ?? 0);
  if (!decision?.nos_acogemos) return { puntos: 0, hasta };
  if (!a?.tramos?.length) return { puntos: null, hasta };
  const t = a.tramos.find((x) => x.descripcion === decision.tramo) ?? tramoDelValor(a.tramos, decision.valor);
  return { puntos: t ? t.puntos : null, hasta };
}

/** «Puntos estimados: 4 de 5» en la fila de un criterio; sin poder calcularlos, «hasta 15 pt». */
export function textoPuntosFila(p) {
  return p.puntos === null
    ? `Puntos estimados: sin calcular (hasta ${numero(p.hasta)} pt)`
    : `Puntos estimados: ${numero(p.puntos)} de ${numero(p.hasta)}`;
}

/**
 * «Nos acogemos a 3 de 6 criterios automáticos. Puntos estimados: 4 de 60 (2 sin poder calcular:
 * hasta 30 pt).»: lo que dan los tramos elegidos, sobre el máximo de todos, y aparte lo que no se
 * puede calcular (antes se sumaban los máximos). null sin automáticos.
 */
export function textoPuntosAutomaticos(automaticosGuion = [], decididos = [], lotes = []) {
  const filas = sincronizarAutomaticos(decididos, automaticosGuion, lotes);
  if (!filas.length) return null;
  const estimados = filas.map((f) =>
    puntosEstimados(automaticoDeLote(automaticosGuion, f.criterio, f.lote ?? null), f),
  );
  const elegidos = filas.filter((f) => f.nos_acogemos).length;
  const calculados = estimados.reduce((t, p) => t + (p.puntos ?? 0), 0);
  const total = estimados.reduce((t, p) => t + p.hasta, 0);
  const sin = estimados.filter((p) => p.puntos === null);
  const aparte = sin.length
    ? ` (${sin.length} sin poder calcular: hasta ${numero(sin.reduce((t, p) => t + p.hasta, 0))} pt)`
    : '';
  return `Nos acogemos a ${elegidos} de ${plural(filas.length, 'criterio automático', 'criterios automáticos')}. Puntos estimados: ${numero(calculados)} de ${numero(total)}${aparte}.`;
}

const EUROS_UNITARIO = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
  useGrouping: 'always',
});

/**
 * Las ofertas económicas del guion, una por lote (gemela de guionLotes.ofertasEconomicas en el
 * servidor): un guion anterior trae una sola, para todos sus lotes, con su precio unitario como línea.
 */
export function ofertasEconomicas(datos) {
  if (datos?.ofertas_economicas?.length)
    return datos.ofertas_economicas.map((o) => ({ ...o, precios_unitarios: o.precios_unitarios ?? [] }));
  const oe = datos?.oferta_economica;
  if (!oe) return [];
  const u = oe.precio_unitario;
  return [
    {
      ...oe,
      lotes: datos.lotes ?? [],
      precios_unitarios: u ? [{ concepto: u.unidad, unidad: u.unidad, maximo: u.maximo ?? null, cantidad: null }] : [],
    },
  ];
}

/** Contra qué se compara el precio: el precio unitario máximo si se oferta por unidad; si no, el presupuesto base. */
export function referenciaPrecio(oe) {
  const u = oe?.precios_unitarios?.[0] ?? oe?.precio_unitario;
  if (u) return { base: u.maximo ?? null, unidad: u.unidad };
  return { base: oe?.presupuesto_base ?? null, unidad: null };
}

/** «Lote 2», «Lotes 2 y 4» o null si la oferta es del contrato entero. */
export function textoLotesOferta(lotes = []) {
  if (!lotes.length) return null;
  return lotes.length === 1 ? `Lote ${lotes[0]}` : `Lotes ${lotes.slice(0, -1).join(', ')} y ${lotes.at(-1)}`;
}

/** «Edición nivel básico: máx. 4.480,00 € por edición × 6» */
export function textoPrecioUnitario(p) {
  const maximo = p.maximo != null ? `máx. ${textoPrecio(p.maximo, p.unidad)}` : `por ${p.unidad}, sin máximo`;
  return `${p.concepto}: ${maximo}${p.cantidad != null ? ` × ${NUMERO.format(p.cantidad)}` : ''}`;
}

/** «1,50 € por hora» o «100.000 €». */
export function textoPrecio(n, unidad = null) {
  return unidad ? `${EUROS_UNITARIO.format(n)} por ${unidad}` : euros(n);
}

/** «IVA aparte», «exento de impuestos» o null si el guion no lo dice. */
export function textoImpuesto(impuesto) {
  if (impuesto === 'exento') return 'exento de impuestos';
  return impuesto ? `${impuesto} aparte` : null;
}

/** «baja del 12,5 % sobre 100.000 €»; aviso si supera la referencia; null sin importe o sin referencia. */
export function textoBajaPrecio(importe, base, unidad = null) {
  if (typeof importe !== 'number' || typeof base !== 'number' || base <= 0) return null;
  const ref = textoPrecio(base, unidad);
  if (importe > base)
    return `Por encima del ${unidad ? 'precio máximo' : 'presupuesto base'} (${ref}): la oferta se excluye.`;
  return `Baja del ${NUMERO.format(((base - importe) / base) * 100)} % sobre ${ref}.`;
}

const porPuntuacion = (a, b) => b.puntuacion - a.puntuacion;

/**
 * Quién se puede añadir al equipo de la oferta: los candidatos que propuso el bloque Equipo
 * (sin repetir, mejor primero) y el resto de personas activas, sin los ya elegidos.
 */
export function candidatosEquipo(equipo, personas = [], elegidos = []) {
  const fuera = new Set(elegidos.map(Number));
  const vistos = new Map();
  for (const r of equipo?.requisitos ?? []) {
    for (const c of [...r.internos, ...r.externos]) {
      if (!fuera.has(c.id) && (!vistos.has(c.id) || vistos.get(c.id).puntuacion < c.puntuacion))
        vistos.set(c.id, { id: c.id, nombre: c.nombre, rol: c.rol, tipo: c.tipo, puntuacion: c.puntuacion });
    }
  }
  const sugeridos = [...vistos.values()].sort(porPuntuacion);
  const resto = personas
    .filter((p) => !fuera.has(p.id) && !vistos.has(p.id))
    .map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol ?? '', tipo: p.tipo }));
  return {
    sugeridos,
    internos: resto.filter((p) => p.tipo === 'interno'),
    externos: resto.filter((p) => p.tipo !== 'interno'),
  };
}

/** Nombre de una persona por su id, con lo que haya a mano (personas y candidatos); «persona 7» si no está. */
export function nombrePersona(id, personas = [], equipo = null) {
  const candidatos = (equipo?.requisitos ?? []).flatMap((r) => [...r.internos, ...r.externos]);
  const p = personas.find((x) => x.id === id) ?? candidatos.find((x) => x.id === id);
  return p ? p.nombre : `persona ${id}`;
}
