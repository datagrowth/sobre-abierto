// Formato común de la interfaz (sin React, con tests): importes, plazos, fechas y campos de formulario.

// useGrouping 'always': en español «4.624 €» (por defecto, las cifras de cuatro dígitos no se agrupan).
const EUROS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  useGrouping: 'always',
});

export function euros(n) {
  return typeof n === 'number' && Number.isFinite(n) ? EUROS.format(n) : '—';
}

// Los plazos de la PLACSP vienen en hora peninsular y sin zona («2026-10-15T08:00:00»). Date.parse
// los leería en la hora del navegador (desde Canarias, una hora tarde) y contar días como bloques
// de 24 h dice «hoy» para algo de mañana: se pasan a su instante en la zona y se cuentan por día
// de calendario en esa zona.
const ZONA_PENINSULAR = 'Europe/Madrid';
const DIA_MS = 86_400_000;
const SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const FORMATOS_ZONA = new Map();

function formatoZona(zona) {
  if (!FORMATOS_ZONA.has(zona)) {
    FORMATOS_ZONA.set(
      zona,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zona,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return FORMATOS_ZONA.get(zona);
}

/** El instante `ms` como hora local de `zona`: «AAAA-MM-DDTHH:MM:SS». */
function horaEn(ms, zona) {
  const p = Object.fromEntries(
    formatoZona(zona)
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/**
 * El instante (ms) de un plazo. Sin zona, es la hora de `zona` («2026-10-15T08:00:00» → las 08:00
 * en Madrid, se mire desde donde se mire); con zona («Z», «+01:00»), el instante que dice; solo
 * con fecha, las 23:59:59 de ese día en `zona`. null si no es una fecha.
 */
export function instanteLocal(texto, zona = ZONA_PENINSULAR) {
  if (typeof texto !== 'string' || !texto) return null;
  if (CON_ZONA.test(texto)) {
    const t = Date.parse(texto);
    return Number.isNaN(t) ? null : t;
  }
  const m = LOCAL.exec(SOLO_DIA.test(texto) ? `${texto}T23:59:59` : texto);
  if (!m) return null;
  const comoUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (Number.isNaN(comoUtc)) return null;
  const desfase = (ms) => Date.parse(`${horaEn(ms, zona)}Z`) - ms;
  // El desfase se mide otra vez en el instante aproximado: el día del cambio de hora, el de la
  // hora buscada puede no ser el de la misma hora en UTC (como en nucleo/fechas.ts).
  return comoUtc - desfase(comoUtc - desfase(comoUtc));
}

/** El día de calendario del instante `ms` en `zona`: «AAAA-MM-DD». */
export function diaEn(ms, zona = ZONA_PENINSULAR) {
  return horaEn(ms, zona).slice(0, 10);
}

/** Días de calendario de `ahora` a `ms` en `zona` (0 = el mismo día; negativo si ya pasó). */
export function diasDeCalendario(ms, ahora, zona = ZONA_PENINSULAR) {
  return Math.round((Date.parse(diaEn(ms, zona)) - Date.parse(diaEn(ahora, zona))) / DIA_MS);
}

/** La urgencia de un plazo, la misma en toda la web: pasada | alta (menos de 24 h o hoy/mañana) | media (5 días) | baja. */
export function urgenciaPlazo(ms, ahora, dias) {
  if (ms <= ahora) return 'pasada';
  if (ms - ahora < DIA_MS || dias <= 1) return 'alta';
  return dias <= 5 ? 'media' : 'baja';
}

/** Días de calendario que faltan hasta el plazo (negativo si ya pasó), o null sin plazo. */
export function diasHasta(fechaLimite, ahora = Date.now(), zona = ZONA_PENINSULAR) {
  const t = instanteLocal(fechaLimite, zona);
  return t === null ? null : diasDeCalendario(t, ahora, zona);
}

/**
 * La hora del plazo tal como está escrita («2026-10-05T12:00:00» → «12:00»), sin pasarla por
 * la zona del navegador: no todas vencen a la misma hora. null si no trae hora.
 */
export function horaPlazo(fechaLimite) {
  const m = /T(\d{2}):(\d{2})/.exec(String(fechaLimite ?? ''));
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Una hora peninsular en Canarias, que va siempre una hora por detrás (también en verano). */
export function horaCanarias(hora) {
  const [h, m] = hora.split(':').map(Number);
  return `${String((h + 23) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// La zona de la empresa (de /api/config, configInstalacion.js). Los plazos de la PLACSP son
// peninsulares; la hora de Canarias se añade al lado solo si la empresa está allí.
let enCanarias = false;

export function fijarZonaEmpresa(zona) {
  enCanarias = zona === 'Atlantic/Canary';
}

export const empresaEnCanarias = () => enCanarias;

/** La hora de Canarias de una hora peninsular si la empresa está allí; null si no. */
export function segundaHora(hora) {
  return enCanarias && hora ? horaCanarias(hora) : null;
}

/**
 * Texto y urgencia del plazo: «hoy», «mañana», «en 5 días» (por día de calendario en `zona`),
 * «vencida»; `fecha`, la fecha corta, y `hora`, las del texto; `instante`, en ms.
 */
export function plazo(fechaLimite, ahora = Date.now(), zona = ZONA_PENINSULAR) {
  const instante = instanteLocal(fechaLimite, zona);
  if (instante === null) return { texto: 'sin plazo', urgencia: 'ninguna', fecha: null, hora: null, instante: null };
  const dias = diasDeCalendario(instante, ahora, zona);
  const urgencia = urgenciaPlazo(instante, ahora, dias);
  const base = { urgencia, fecha: fechaCorta(fechaLimite, ahora), hora: horaPlazo(fechaLimite), instante };
  if (urgencia === 'pasada') return { texto: 'vencida', ...base };
  return { texto: dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`, ...base };
}

/**
 * El plazo que manda ahora: en un procedimiento en dos fases, la solicitud de participación
 * mientras no haya pasado; si no, la oferta. `solicitud`: si es el de la solicitud. La fecha
 * de la PLACSP viene sin zona y es peninsular: leída en la hora del navegador, en Canarias se
 * elegía la solicitud una hora después de vencida, al revés que plazo() y que el servidor.
 */
export function proximoPlazo(fechaLimite, fechaSolicitud = null, ahora = Date.now()) {
  const t = instanteLocal(fechaSolicitud);
  const solicitud = t !== null && t >= ahora;
  return { fecha: solicitud ? fechaSolicitud : fechaLimite, solicitud };
}

/**
 * «hoy · lun 5 oct · 12:00». Con `peninsular` (los plazos de la PLACSP), la hora es la de la
 * península y, si la empresa está en Canarias, se añade la de allí: «12:00 (11:00 Canarias)».
 */
export function textoPlazo(p, peninsular = false) {
  if (!p.fecha) return p.texto;
  const canarias = peninsular ? segundaHora(p.hora) : null;
  const hora = p.hora ? ` · ${p.hora}${canarias ? ` (${canarias} Canarias)` : ''}` : '';
  return `${p.texto} · ${p.fecha}${hora}`;
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/**
 * «2026-10-06» → «lun 6 oct»; con otro año, «lun 6 oct 2025». Una fecha sin zona es un día
 * del calendario (no se pasa por la zona horaria, que la movería al día anterior).
 */
export function fechaCorta(iso, ahora = Date.now()) {
  if (!iso) return '—';
  // Con hora y sin zona, el día es el del texto (el del plazo publicado), no el del navegador.
  const solo = CON_ZONA.test(String(iso))
    ? null
    : /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(String(iso));
  const d = solo ? new Date(Number(solo[1]), Number(solo[2]) - 1, Number(solo[3])) : new Date(Date.parse(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  const anio = d.getFullYear() === new Date(ahora).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}${anio}`;
}

/** plural(1, 'contrato') → «1 contrato»; plural(3, 'contrato') → «3 contratos». */
export function plural(n, singular, varios = `${singular}s`) {
  const cifra = typeof n === 'number' ? n.toLocaleString('es-ES') : String(n);
  return `${cifra} ${n === 1 ? singular : varios}`;
}

export function fechaHora(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

/** «72, 48 ,7331» → ['72', '48', '7331']: listas separadas por comas o saltos de línea. */
export function lista(texto) {
  return String(texto ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Número de un campo de formulario, o null si está vacío. */
// Miles con punto y grupos de tres («1.500.000», «186.420»), con o sin decimales con coma.
const CON_MILES = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;

/**
 * Número escrito a mano o el que vuelve al formulario desde el servidor: «186.420,35»,
 * «186420,35», «1.500.000» y también «186420.35». Un punto solo es de miles si separa
 * grupos de tres cifras; si no, es decimal. Antes se quitaban todos los puntos y un
 * importe guardado (186420.35) se multiplicaba por 100 cada vez que se volvía a guardar.
 */
export function numeroONulo(texto) {
  const crudo = String(texto ?? '')
    .trim()
    .replace(/\s|€/g, '');
  if (!crudo) return null;
  const t = CON_MILES.test(crudo)
    ? crudo.replace(/\./g, '').replace(',', '.')
    : crudo.includes(',')
      ? crudo.replace(/\./g, '').replace(',', '.')
      : crudo;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

const COMO_PEDIRLO = { cribar: '«Cribar ahora»', aprender_acta: '«Leer actas pendientes»' };

/** Aviso legible de lo que tiene parada la IA: límite de uso, una herramienta que Hermes no ve o tiene vieja, o fallos seguidos. */
export function textoAlertaIa(a) {
  if (a.motivo === 'limite')
    return `Hermes ha agotado el uso del modelo: la cola de IA espera hasta ${fechaHora(a.hasta)} y no gasta intentos.`;
  // El nombre lo da el servidor (el mismo que en HermesEnVivo): la web no lleva su propia tabla.
  const quien = `«${a.nombre ?? a.tipo}»`;
  const clave = Object.keys(COMO_PEDIRLO).find((k) => String(a.tipo).endsWith(k));
  const antes = COMO_PEDIRLO[clave] ?? 'pedirlo a mano';
  // Sin «vuelve a pedirlo»: sale solo en cuanto Hermes, ya reiniciado, vuelva a pedir la lista.
  if (a.motivo === 'desfase') {
    return `${quien} espera: Hermes tiene la lista de herramientas de antes del despliegue. Reinicia Hermes y saldrá solo; mientras, no se gastan intentos.${a.error ? ` ${a.error}` : ''}`;
  }
  if (a.motivo === 'herramienta') {
    return `${quien} espera: Hermes no tiene una herramienta de la plataforma (suele pasar tras desplegar sin reiniciarlo). Reinicia Hermes y vuelve a ${antes === 'pedirlo a mano' ? 'pedirlo a mano' : `pulsar ${antes}`}; mientras, no se gastan intentos.${a.error ? ` ${a.error}` : ''}`;
  }
  const causa = a.error ? ` Último error: ${a.error}` : '';
  return `Hermes ha frenado ${quien} tras tres fallos seguidos para no gastar uso del modelo. Vuelve a intentarlo el ${fechaHora(a.hasta)}, o antes con ${antes}.${causa}`;
}

// Un instante con zona («…Z», «…+01:00») se enseña en la hora de quien lo mira; sin zona,
// la hora es la del texto (p. ej. el fin de plazo de un diario oficial, ya en hora local).
const CON_ZONA = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const dosCifras = (n) => String(n).padStart(2, '0');

function instanteConHora(texto, ahora) {
  const d = new Date(Date.parse(texto));
  if (Number.isNaN(d.getTime())) return texto;
  const dia = fechaCorta(`${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`, ahora);
  return `${dia}, ${dosCifras(d.getHours())}:${dosCifras(d.getMinutes())}`;
}

/**
 * «2026-10-13T17:00:00» → «mar 13 oct, 17:00»; sin hora (o a medianoche), solo la fecha
 * corta. «2026-10-05T07:30:00Z» → en Madrid, «lun 5 oct, 09:30».
 */
export function fechaConHora(iso, ahora = Date.now()) {
  if (!iso) return '—';
  if (CON_ZONA.test(String(iso))) return instanteConHora(String(iso), ahora);
  const m = /T(\d{2}):(\d{2})/.exec(String(iso));
  const fecha = fechaCorta(String(iso).slice(0, 10), ahora);
  return m && `${m[1]}:${m[2]}` !== '00:00' ? `${fecha}, ${m[1]}:${m[2]}` : fecha;
}

const AGENTES = { 'claude-code': 'Claude Code', hermes: 'Hermes', licitaciones: 'Hermes (licitaciones)' };

/** «claude-code» → «Claude Code»; los perfiles de Hermes, como «Hermes (licitaciones)». */
export function nombreAgente(agente) {
  return AGENTES[agente] ?? (agente ? `Hermes (${agente})` : 'un agente');
}

// Idiomas: los que se piden en el perfil del equipo y los que se detectan en los títulos.
export const IDIOMAS = {
  es: 'Español',
  en: 'Inglés',
  ca: 'Catalán o valenciano',
  eu: 'Euskera',
  gl: 'Gallego',
  fr: 'Francés',
  de: 'Alemán',
  pt: 'Portugués',
  it: 'Italiano',
};
const EN_IDIOMA = { ca: 'en catalán', eu: 'en euskera', gl: 'en gallego' };

// Opinión de Hermes en la criba, en palabras: «revisar» era «encaja, pero con dudas».
const VEREDICTOS = { interesa: 'Encaja', revisar: 'Encaja con dudas', descartar: 'No encaja' };

// Sin la «confianza» que da el modelo: no está calibrada y con «con dudas» no dice nada.
/** Veredicto de la criba → «Encaja con dudas»; null sin criba. */
export function textoVeredicto(veredicto) {
  return veredicto ? (VEREDICTOS[veredicto] ?? veredicto) : null;
}

/** Chip de idioma del título: «en catalán», o null si es español o no se sabe. */
export function textoIdiomaTitulo(codigo) {
  return EN_IDIOMA[codigo] ?? null;
}

// Comunidades autónomas por su NUTS 2.
export const COMUNIDADES = [
  ['ES61', 'Andalucía'],
  ['ES24', 'Aragón'],
  ['ES12', 'Asturias'],
  ['ES53', 'Illes Balears'],
  ['ES70', 'Canarias'],
  ['ES13', 'Cantabria'],
  ['ES41', 'Castilla y León'],
  ['ES42', 'Castilla-La Mancha'],
  ['ES51', 'Cataluña'],
  ['ES52', 'Comunitat Valenciana'],
  ['ES43', 'Extremadura'],
  ['ES11', 'Galicia'],
  ['ES30', 'Madrid'],
  ['ES62', 'Murcia'],
  ['ES22', 'Navarra'],
  ['ES21', 'País Vasco'],
  ['ES23', 'La Rioja'],
  ['ES63', 'Ceuta'],
  ['ES64', 'Melilla'],
];

/**
 * Prefijos NUTS de los filtros → las comunidades que cubren («ES3» es Madrid, «ES5» tres
 * comunidades) y los prefijos más finos que no son una comunidad entera (provincias,
 * «ES701»), que se conservan tal cual.
 */
export function comunidadesDeNuts(prefijos = []) {
  const elegidas = new Set();
  const otros = [];
  for (const p of prefijos.map((x) => x.toUpperCase())) {
    const cubiertas = COMUNIDADES.filter(([c]) => c.startsWith(p));
    if (cubiertas.length) cubiertas.forEach(([c]) => elegidas.add(c));
    else otros.push(p);
  }
  return { comunidades: COMUNIDADES.map(([c]) => c).filter((c) => elegidas.has(c)), otros };
}

/** Comunidades elegidas → prefijos para guardar; todas (sin provincias sueltas) es lo mismo que ninguna. */
export function nutsDeComunidades(comunidades, otros = []) {
  if (comunidades.length === COMUNIDADES.length && !otros.length) return [];
  return [...COMUNIDADES.map(([c]) => c).filter((c) => comunidades.includes(c)), ...otros];
}

/** «Toda España», «Canarias», «Canarias y Madrid» o «Canarias, Madrid y 3 más». */
export function resumenComunidades(comunidades, otros = []) {
  const nombres = [...COMUNIDADES.filter(([c]) => comunidades.includes(c)).map(([, n]) => n), ...otros];
  if (!nombres.length || (comunidades.length === COMUNIDADES.length && !otros.length)) return 'Toda España';
  if (nombres.length <= 2) return nombres.join(' y ');
  return nombres.length === 3
    ? `${nombres[0]}, ${nombres[1]} y ${nombres[2]}`
    : `${nombres[0]}, ${nombres[1]} y ${nombres.length - 2} más`;
}

/**
 * Solo se enlaza lo que es http(s): una URL de una fuente externa o de una nota con otro
 * esquema (javascript:, data:…) ejecutaría código al pulsarla. null = mostrarla como texto.
 */
export function urlEnlazable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}
