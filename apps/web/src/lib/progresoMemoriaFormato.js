// Formateadores del progreso de la memoria (plan y crítico): la línea de fases, el texto de lo que
// está haciendo ahora, la tabla ronda × apartado con la nota del crítico y si este fue independiente
// y ciego. Puros: reciben la memoria tal como la da GET /oferta (m.progreso).

/** El trabajo que se puede relanzar en cada fase (RelanzarTrabajo). */
export const TIPO_TRABAJO_FASE = {
  estrategia: 'memoria_estrategia',
  redaccion: 'memoria_redaccion',
  critica: 'memoria_critica',
  hechos: 'memoria_hechos',
};
const ORDEN = ['dossier', 'estrategia', 'ficha', 'redaccion', 'critica', 'fin'];
const FIN = ORDEN.indexOf('fin');

const recibidos = (m) => m.apartados.filter((a) => a.estado === 'recibido').length;

function estadoDePaso(j, i, fallida) {
  if (j < i) return 'hecho';
  if (j === i) return fallida ? 'fallido' : 'en_curso';
  return 'pendiente';
}

/**
 * Dossier → Estrategia → Ficha → Redacción k/N → Crítica → Ronda r/máx → Ensamblada, cada paso con
 * su estado (hecho, en_curso, pendiente, fallido u omitido: la ronda cuando no hizo falta y la
 * ficha cuando no la hubo, como en una memoria de ensayo).
 */
export function fasesMemoria(m) {
  const v = m?.progreso;
  if (!v) return [];
  const lista = m.estado === 'ensamblada';
  // «hechos» corrige la hoja entre la crítica y la reescritura: crítica hecha y ronda en curso.
  const i = lista ? ORDEN.length : v.fase === 'hechos' ? ORDEN.indexOf('critica') + 0.5 : ORDEN.indexOf(v.fase);
  const fallida = m.estado === 'fallida';
  const base = [
    { clave: 'dossier', texto: 'Dossier' },
    { clave: 'estrategia', texto: 'Estrategia' },
    { clave: 'ficha', texto: 'Ficha de solución' },
    { clave: 'redaccion', texto: `Redacción ${recibidos(m)}/${m.apartados.length}` },
    { clave: 'critica', texto: 'Crítica' },
  ].map((p, j) => ({
    ...p,
    estado: p.clave === 'ficha' && !v.ficha && j < i ? 'omitido' : estadoDePaso(j, i, fallida),
  }));
  const ronda = {
    clave: 'ronda',
    texto: `Ronda ${v.ronda}/${v.max_rondas}`,
    estado: v.ronda === 0 ? (i >= FIN ? 'omitido' : 'pendiente') : i >= FIN ? 'hecho' : 'en_curso',
  };
  const fin = {
    clave: 'fin',
    texto: lista ? 'Ensamblada' : 'Ensamblar',
    estado: lista ? 'hecho' : v.fase === 'fin' ? 'en_curso' : 'pendiente',
  };
  return [...base, ronda, fin];
}

/** Lo que está haciendo ahora una memoria que se redacta (null si es una versión subida a mano, sin progreso). */
export function textoFaseMemoria(m) {
  const v = m?.progreso;
  if (!v) return null;
  const enRonda = v.ronda > 0 ? ` (ronda ${v.ronda} de reescritura)` : '';
  switch (v.fase) {
    case 'dossier':
      return 'Componiendo el dossier: pliego técnico, criterios, formato, frontera y equipo';
    case 'estrategia':
      return 'Hermes piensa la estrategia: temas, estructura, mapa de criterios, hoja de hechos y solución';
    case 'ficha':
      return 'Ficha de solución pendiente de revisión: acepta o edita los valores que propone Hermes y empezará a redactar';
    case 'redaccion':
      return `Hermes redacta la memoria entera: ${recibidos(m)} de ${m.apartados.length} apartados recibidos${enRonda}`;
    case 'critica':
      return `El crítico ciego puntúa la memoria${v.ronda > 0 ? ` (ronda ${v.ronda})` : ''}`;
    case 'hechos':
      return `Hermes corrige los hechos que cita el crítico antes de la ronda ${v.ronda} de reescritura (cada cambio queda en los avisos para revisarlo)`;
    default:
      return 'Ensamblando el documento…';
  }
}

const num = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

/**
 * La nota del crítico por ronda y apartado: { rondas: [0, 1…], filas: [{ apartado, titulo, celdas:
 * [{ ronda, texto, restaurado }] }], totales: [«22/25»…] }. Un apartado restaurado lleva la marca
 * en la ronda que lo empeoró.
 */
export function tablaCriticas(m) {
  const criticas = m?.progreso?.criticas ?? [];
  if (!criticas.length) return null;
  const ultima = criticas.at(-1).ronda;
  const restaurados = new Set(m.progreso.restaurados ?? []);
  const filas = m.apartados.map((a) => ({
    apartado: a.apartado,
    titulo: a.titulo,
    celdas: criticas.map((c) => {
      const x = c.apartados.find((y) => y.apartado === a.apartado);
      return {
        ronda: c.ronda,
        texto: x ? `${num(x.puntos)}/${num(a.puntos)}` : '—',
        restaurado: c.ronda === ultima && c.ronda > 0 && restaurados.has(a.apartado),
      };
    }),
  }));
  return {
    rondas: criticas.map((c) => c.ronda),
    filas,
    totales: criticas.map((c) => `${num(c.total)}/${num(c.maximo)}`),
  };
}

/** «Crítico independiente y ciego» y, si no lo es, por qué su nota vale menos. */
export function textoCritico(c) {
  if (!c) return null;
  const avisos = [
    ...(c.independiente ? [] : ['Crítica hecha por el mismo modelo que redacta: tiende a sobrevalorar.']),
    ...(c.ciega
      ? []
      : ['El crítico leyó más que el paquete ciego (la oferta, el dossier o el equipo): su nota no es ciega.']),
  ];
  return { texto: `Crítico independiente: ${c.independiente ? 'sí' : 'no'} · ciego: ${c.ciega ? 'sí' : 'no'}`, avisos };
}

// ── Ficha de solución ──

/** Los campos de la ficha por grupo, en su orden: [{ grupo, campos }]. */
export function gruposFicha(ficha) {
  const grupos = [];
  for (const c of ficha?.campos ?? []) {
    const g = grupos.find((x) => x.grupo === c.grupo);
    if (g) g.campos.push(c);
    else grupos.push({ grupo: c.grupo, campos: [c] });
  }
  return grupos;
}

// Un compromiso añadido (el servidor lo enseña como «compromiso · horas · nivel · decisión»): la
// persona lo mantiene, lo suaviza editando el texto o el coste, o lo quita; lo quitado no se redacta.
const SEPARADOR = ' · ';
export const esCompromisoFicha = (c) => String(c?.clave ?? '').startsWith('compromiso-');

/** ¿El valor de un compromiso dice que se quita? */
export const compromisoQuitado = (valor) => /·\s*quitar\s*$/i.test(String(valor ?? ''));

/** El valor con la decisión cambiada: «mantener» ↔ «quitar» (la última parte). */
export function alternarCompromiso(valor) {
  const partes = String(valor ?? '').split(/\s+·\s+/);
  if (partes.length < 2) return valor;
  partes[partes.length - 1] = compromisoQuitado(valor) ? 'mantener' : 'quitar';
  return partes.join(SEPARADOR);
}

// Los euros los calcula el servidor (horas × LICITACIONES_PRECIO_HORA) solo para la persona: no
// se escriben en el valor, que es lo que pasa a la solución y de ahí a la memoria (sin precios).
const EUROS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  useGrouping: 'always',
});
/** «≈ 6.000 €» si el servidor trae los euros de un compromiso; null si no (sin precio por hora configurado). */
export const textoEurosCompromiso = (c) =>
  typeof c?.euros === 'number' && Number.isFinite(c.euros) ? `≈ ${EUROS.format(c.euros)}` : null;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Un campo compuesto (un tramo del calendario, una capa con su control) pasa de 300 caracteres:
// el mismo tope que el servidor.
export const MAX_VALOR_CAMPO = 1500;

/**
 * Lo que se envía al aprobar la ficha: quién y solo los campos que cambian. `valores`: { clave:
 * texto escrito }. Devuelve { error } si falta el nombre o un valor no vale (vacío, largo o un
 * inicio que no es fecha), con el mismo criterio que el servidor.
 */
export function leerRevisionFicha(ficha, valores) {
  const campos = (ficha?.campos ?? [])
    .map((c) => ({ c, valor: String(valores?.[c.clave] ?? c.valor).trim() }))
    .filter((x) => x.valor !== x.c.valor);
  const malo = campos.find((x) => !x.valor || x.valor.length > MAX_VALOR_CAMPO);
  if (malo) return { error: `«${malo.c.etiqueta}» debe tener de 1 a ${MAX_VALOR_CAMPO} caracteres.` };
  const inicio = campos.find((x) => x.c.clave === 'inicio');
  if (inicio && !FECHA.test(inicio.valor)) return { error: 'El inicio del contrato va como fecha AAAA-MM-DD.' };
  // Quién la revisa no va: lo pone el servidor desde la sesión.
  return { cuerpo: { campos: campos.map((x) => ({ clave: x.c.clave, valor: x.valor })) } };
}

/**
 * Lo que se dice debajo de un campo: cómo está escrito en la hoja de hechos (si cambia, cambia
 * con él), si una ronda lo corrigió y lo que hay que comprobar.
 */
export function notasCampoFicha(c) {
  const hoja = (c?.hechos ?? [])
    .filter((h) => h.valor !== c.valor)
    .map((h) => `En la hoja de hechos: «${h.valor}» (cambia con este campo).`);
  const ronda = c?.ronda
    ? [`Corregido en la ronda ${c.ronda.n} por lo que señaló el crítico; antes «${c.ronda.antes}».`]
    : [];
  return [...hoja, ...ronda, ...(c?.alerta ? [c.alerta] : [])];
}

/** Una línea con el estado de la ficha: quién la revisó y cuándo, o que venció sin revisar. */
export function textoEstadoFicha(ficha, fecha = (x) => x) {
  if (!ficha) return null;
  if (ficha.estado === 'aprobada')
    return `Revisada por ${ficha.revisada_por} el ${fecha(ficha.revisada_en)}${ficha.editados.length ? ` (${ficha.editados.length === 1 ? '1 valor cambiado' : `${ficha.editados.length} valores cambiados`})` : ' (sin cambios)'}.`;
  if (ficha.estado === 'vencida')
    return 'Venció sin revisar: la memoria lleva los valores que propuso Hermes, marcados para la revisión final.';
  return `Hermes espera tu revisión para redactar; si nadie la revisa, redactará con lo propuesto a partir del ${fecha(ficha.vence_en)}.`;
}

// ── Desfase: lo que cambió desde que se redactó la versión ──

// Las secciones del dossier dichas como las entiende quien prepara la oferta.
const SECCIONES_LEGIBLES = {
  equipo: 'el equipo',
  herramientas: 'las herramientas',
  empresa: 'el perfil de la empresa',
  frontera: 'los criterios de otros sobres',
  identificacion: 'los lotes o el plazo',
  pliego_tecnico: 'el pliego técnico',
  criterios: 'los criterios de valoración',
};
// Lo que tarda Hermes en rehacer un apartado (el mismo orden de magnitud que la mejora del servidor).
const MINUTOS_POR_APARTADO = 20;

const conY = (t) => (t.length <= 1 ? t.join('') : `${t.slice(0, -1).join(', ')} y ${t.at(-1)}`);
const seccionLegible = (s) => SECCIONES_LEGIBLES[s] ?? String(s).replaceAll('_', ' ');

/**
 * «Cambió desde esta versión: el equipo y las herramientas. Afecta a los apartados 2 y 4; el resto
 * se mantiene.» null si nada de lo que cambió toca algún apartado (no hay nada que actualizar).
 */
export function textoDesfaseMemoria(m) {
  const d = m?.progreso?.desfase;
  if (!d?.apartados?.length) return null;
  const ns = d.apartados.map(String);
  const afecta = ns.length === 1 ? `al apartado ${ns[0]}` : `a los apartados ${conY(ns)}`;
  const que = d.secciones?.length ? conY(d.secciones.map(seccionLegible)) : 'lo que usó Hermes';
  return `Cambió desde esta versión: ${que}. Afecta ${afecta}; el resto se mantiene.`;
}

/** Los minutos de Hermes que cuesta rehacer esos apartados. */
export const minutosActualizar = (apartados = []) => apartados.length * MINUTOS_POR_APARTADO;

/** Lo que se confirma antes de «Actualizar los apartados afectados»: el coste y que el resto no se toca. */
export function costeActualizar(apartados = []) {
  return `Unos ${minutosActualizar(apartados)} min de Hermes y una crítica; los demás apartados no se tocan.`;
}
