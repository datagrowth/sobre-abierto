// Lo que la web dice del resumen de la memoria, sin React. La única nota es la del
// crítico ciego, con su margen: la autoevaluación de Hermes infla 6-8 puntos y por eso no llega nunca aquí. «Dar por buena» con algo marcado pide motivo, como el servidor.

import { euros } from './formato.js';

const NUMERO = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** «Nota del crítico ciego: 31,2 / 40 (± 3)»; sin crítica ciega, que no hay nota. */
export function textoNota(nota) {
  if (!nota || typeof nota.total !== 'number') return 'Sin nota: el crítico ciego aún no la ha leído';
  const margen = typeof nota.margen === 'number' && nota.margen > 0 ? ` (± ${NUMERO.format(nota.margen)})` : '';
  return `Nota del crítico ciego: ${NUMERO.format(nota.total)} / ${NUMERO.format(nota.maximo)}${margen}`;
}

/** «28 de 30 páginas» (y lo que sobra si pasa del límite); null si no se sabe cuántas tiene. */
export function textoPaginas(paginas, limite) {
  if (typeof paginas !== 'number') return null;
  const n = `${paginas} ${paginas === 1 ? 'página' : 'páginas'}`;
  if (typeof limite !== 'number' || limite <= 0) return n;
  const sobran = paginas - limite;
  return `${paginas} de ${limite} páginas${sobran > 0 ? `: sobran ${sobran}` : ''}`;
}

/** ¿Hace falta motivo para darla por buena? Lo mismo que exige el servidor: algo marcado, avisos o apartados sin redactar. */
export function necesitaMotivo(antes, marcados) {
  return (marcados?.length ?? 0) > 0 || (antes?.avisos?.length ?? 0) > 0 || (antes?.sin_redactar?.length ?? 0) > 0;
}

/** «Se descartan: v3, v2», de la más nueva a la más vieja; null si no se descarta ninguna. */
export function textoSeDescartan(versiones) {
  if (!versiones?.length) return null;
  return `Se descartan: ${[...versiones]
    .sort((a, b) => b - a)
    .map((v) => `v${v}`)
    .join(', ')}`;
}

/** «Sin redactar: apartados 2 y 4»; null si están todos. */
export function textoSinRedactar(apartados) {
  if (!apartados?.length) return null;
  if (apartados.length === 1) return `Sin redactar: apartado ${apartados[0]}`;
  return `Sin redactar: apartados ${apartados.slice(0, -1).join(', ')} y ${apartados.at(-1)}`;
}

/** El número de versión de la clave de su tarjeta («memoria:v3» → 3); null si no es de memoria. */
export function versionDeClave(clave) {
  const m = /^memoria:v(\d+)$/.exec(String(clave ?? ''));
  return m ? Number(m[1]) : null;
}

/** Las pestañas de lote: solo si la oferta va a más de uno (los decididos o, sin decidir, los del guion). */
export function lotesDelResumen(o) {
  const decididos = (o?.decisiones?.datos?.lotes ?? []).map(String);
  const lotes = decididos.length ? decididos : (o?.guion?.datos?.lotes ?? []).map(String);
  return lotes.length > 1 ? lotes : [];
}

/**
 * Con qué lote se lee el resumen de la vN y qué pestañas salen. La memoria de un lote (memoria
 * por lote) es de ese lote: sin pestañas y filtrada por el suyo. La común que va a varios lotes,
 * una pestaña por lote (la elegida o la primera). Sin lotes, ni pestañas ni filtro.
 */
export function loteDeLaVista(o, version, elegido = null) {
  const m = (o?.memorias ?? []).find((x) => !x.ensayo && x.version === version);
  if (m?.lote) return { pestanas: [], lote: String(m.lote) };
  const pestanas = lotesDelResumen(o);
  return { pestanas, lote: elegido && pestanas.includes(elegido) ? elegido : (pestanas[0] ?? null) };
}

/** La columna «cuándo o medida» de la hoja: el valor del hecho o del compromiso. */
export function filaCompromiso(c) {
  return { que: c.que, quien: c.quien ?? '—', valor: c.valor, choca: c.choca ? `choca con ${c.choca}` : null };
}

/** «Descartada por Persona A: «motivo»» de una versión anterior, o null si no se descartó desde su tarjeta. */
export function textoDescarte(version, descartes) {
  const d = (descartes ?? []).find((x) => x.version === version);
  if (!d) return null;
  const quien = d.quien ? ` por ${d.quien}` : '';
  return d.motivo ? `Descartada${quien}: «${d.motivo}»` : `Descartada${quien}, sin motivo guardado`;
}

const numeroSeguro = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * Si la tarjeta puede ofrecer «Actualizar los apartados afectados»: ni la presentada, ni una de
 * ensayo, ni una subida a mano (el servidor no la rehace). Una montada por el método anterior sí.
 */
export const puedeActualizarAfectados = (m) =>
  Boolean(m) && !m.presentada && !m.ensayo && !m.sin_repartir && !m.origen?.subida;

/**
 * La vista previa del servidor (GET …/memoria/:v/afectados) como la enseña la tarjeta: los apartados
 * que nombran lo que cambió en el equipo o los lotes desde que se pidió, con su coste. null si no
 * hay ninguno (la memoria sigue valiendo) o la respuesta no se entiende.
 */
export function vistaPreviaAfectados(previa) {
  const afectadas = Array.isArray(previa?.afectadas) ? previa.afectadas : [];
  const cambios = Array.isArray(previa?.cambios) ? previa.cambios : [];
  if (!afectadas.length || !cambios.length) return null;
  return {
    cambios,
    apartados: afectadas.map((a) => ({
      n:
        Number(
          String(a?.clave ?? '')
            .split('-')
            .at(-1),
        ) || null,
      nombre: String(a?.nombre ?? ''),
    })),
    minutos: afectadas.reduce((s, a) => s + numeroSeguro(a?.coste?.min), 0),
    runs: afectadas.reduce((s, a) => s + numeroSeguro(a?.coste?.runs), 0),
  };
}

const MAX_CAMBIOS = 5;

/**
 * Qué se manda al pedirlo: los apartados de la vista previa (por su número) y los cambios que los
 * explican, que el servidor acota a cinco y da a Hermes como contexto. Sin número de apartado
 * reconocible, lo calcula el servidor por lo que cambió.
 */
export function pedidoActualizarAfectados(vista) {
  const apartados = vista.apartados.map((a) => a.n).filter((n) => n !== null);
  return { ...(apartados.length ? { apartados } : {}), cambios: vista.cambios.slice(0, MAX_CAMBIOS) };
}

// ── Compromisos añadidos y su coste (horas que el pliego no pedía) ──
// Los euros solo se ven aquí, en la web; el MCP y la Mesa llevan horas y nivel.

// useGrouping 'always': «1.500 h» (es-ES no agrupa las cifras de cuatro dígitos por defecto).
const HORAS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, useGrouping: 'always' });
const esCifra = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// La coletilla de cada instrucción, donde esté: la fila del total junta varias.
const COLETILLA = /;?\s*no añadas compromisos con coste que el pliego no pide\.?/gi;
const CIERRE = 'No añadas compromisos con coste que el pliego no pide.';

/** «650 h», «1.500 h»; '—' si no hay cifra. */
export const textoHoras = (h) => (esCifra(h) ? `${HORAS.format(h)} h` : '—');

/** «650 h · 16.250 €»; solo la parte que se sabe, o «sin cifra». */
export function textoCoste(horas, eurosN) {
  const partes = [esCifra(horas) ? textoHoras(horas) : null, esCifra(eurosN) ? euros(eurosN) : null].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'sin cifra';
}

const textoApartados = (as) => {
  if (!as?.length) return 'En la memoria';
  return as.length === 1 ? `Apartado ${as[0]}` : `Apartados ${as.slice(0, -1).join(', ')} y ${as.at(-1)}`;
};

const filaCoste = (c) => ({
  texto: c.texto,
  cita: c.cita ?? null,
  donde: textoApartados(c.apartados),
  coste: textoCoste(c.horas, c.euros),
  barata: c.barata,
  supuesto: c.supuesto,
  caro: Boolean(c.caro),
  ficha: c.ficha ?? null,
  justificado: c.justificado === true,
});

function textoTotal(k) {
  const pct = esCifra(k.presupuesto_pct) ? ` (${HORAS.format(k.presupuesto_pct)} % del presupuesto)` : '';
  return `Total añadido: ~${textoCoste(k.total_anadidos?.horas, k.total_anadidos?.euros)}${pct}`;
}

// Los caros arriba y, dentro, el que más cuesta primero: es lo primero que hay que suavizar.
const masCaroPrimero = (a, b) =>
  Number(Boolean(b.caro)) - Number(Boolean(a.caro)) ||
  (esCifra(b.euros) ? b.euros : 0) - (esCifra(a.euros) ? a.euros : 0);

const anadidosDe = (k) => (k?.compromisos ?? []).filter((c) => c.clase === 'anadido');

/**
 * La sección «Compromisos añadidos y su coste» de la tarjeta: las filas de los añadidos (los caros
 * primero), el total y si el total es riesgo (total_riesgo: el umbral del perfil, como las comprobaciones).
 * Sin ninguno caro ni total en riesgo, solo «Comprobado: 0…». aSuavizar: los que manda «Suavizar»
 * (los caros o, si solo pesa el total, todos los añadidos). null si el servidor no trae costes.
 */
export function vistaCostes(k) {
  if (!k || !Array.isArray(k.compromisos)) return null;
  const sinCotejar = k.cotejado ? null : 'Sin cotejar: no se pudo leer el pliego y todo cuenta como añadido.';
  const totalRiesgo = k.total_riesgo === true;
  if (!k.caros && !totalRiesgo)
    return {
      vacio: 'Comprobado: 0 compromisos caros que el pliego no pida',
      sinCotejar,
      filas: [],
      total: null,
      totalRiesgo: false,
      caros: 0,
      aSuavizar: 0,
    };
  const filas = anadidosDe(k).sort(masCaroPrimero).map(filaCoste);
  return {
    vacio: null,
    sinCotejar,
    filas,
    total: textoTotal(k),
    totalRiesgo,
    caros: k.caros ?? 0,
    aSuavizar: aSuavizarDe(k).length,
  };
}

// Los caros con instrucción o, si ninguno lo es pero el total pesa, los añadidos que la ficha de
// solución no justificó (lo que ya decidió no se suaviza otra vez).
function aSuavizarDe(k) {
  const caros = (k?.compromisos ?? []).filter((c) => c.caro && c.instruccion);
  if (caros.length || k?.total_riesgo !== true) return caros;
  return anadidosDe(k).filter((c) => c.instruccion && c.justificado !== true);
}

const primerApartado = (c) => (c.apartados?.length ? Math.min(...c.apartados) : Infinity);

/**
 * «Suavizar estos N»: una sola ronda de «mejorar» con los apartados de todas las apariciones de los
 * caros (o de todos los añadidos si solo pesa el total) y sus instrucciones (las del servidor), en
 * el orden de los apartados y con el cierre una vez. null si no hay nada que suavizar.
 */
export function pedidoSuavizar(k) {
  const caros = aSuavizarDe(k);
  if (!caros.length) return null;
  const orden = [...caros].sort((a, b) => primerApartado(a) - primerApartado(b));
  const lineas = [
    ...new Set(
      orden.map((c) => String(c.instruccion).replace(COLETILLA, '').trim().replace(/[.;]$/, '')).filter(Boolean),
    ),
  ];
  const apartados = [...new Set(caros.flatMap((c) => c.apartados ?? []))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 20)
    .sort((a, b) => a - b);
  return {
    apartados: apartados.length ? apartados : null,
    indicaciones: [...lineas.map((l) => `· ${l}.`), CIERRE].join('\n'),
  };
}
