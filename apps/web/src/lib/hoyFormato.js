// El resumen de la plataforma (GET /api/plataforma/hoy) para la barra lateral (sin React, con
// tests): lo pendiente de cada sección, el título de la pestaña y la pastilla de Hermes.
import { plural } from './formato.js';

/**
 * Lo que dice la barra lateral debajo de cada sección con algo por revisar: el resumen del
 * dominio si lo da (explica su número: «19 decisiones tuyas en 3 ofertas»); si no, lo que es si
 * es una sola cosa («Memoria v5 por revisar») o cuántas son.
 */
export function avisosLaterales(hoy) {
  const out = {};
  for (const s of hoy?.secciones ?? []) {
    if (s.resumen) {
      out[s.seccion] = s.resumen;
      continue;
    }
    const items = s.por_aprobar ?? [];
    if (!items.length) continue;
    out[s.seccion] =
      items.length === 1 ? (items[0].corto ?? 'Una cosa por revisar') : `${items.length} cosas por revisar`;
  }
  return out;
}

/** Cuántas cosas esperan a una persona en total (para el título de la pestaña). */
export function totalPendiente(cuentas = {}) {
  return Object.values(cuentas).reduce((s, n) => s + n, 0);
}

/** «(3) Sobre Abierto»: lo pendiente delante del nombre de la app. */
export function tituloPestana(total, nombre) {
  return total > 0 ? `(${total}) ${nombre}` : nombre;
}

/**
 * La ayuda de la cuenta del menú. En Licitaciones cuenta las licitaciones que tienes que abrir
 * (algo tuyo en las comprobaciones, una ficha por decidir o un aviso); en el resto, lo que espera tu revisión.
 */
export function ayudaCuenta(seccion, label, cuenta) {
  if (!(cuenta > 0)) return label;
  if (seccion === 'pipeline' || seccion === 'licitaciones')
    return `${label}: ${plural(cuenta, 'oferta te espera', 'ofertas te esperan')}`;
  if (seccion === 'oportunidades') return `${label}: ${plural(cuenta, 'espera revisión', 'esperan revisión')}`;
  return `${label}: ${cuenta === 1 ? '1 cosa espera' : `${cuenta} cosas esperan`} tu revisión`;
}

const NOMBRE_DOMINIO = { licitaciones: 'Licitaciones', equipo: 'Equipo', biblioteca: 'Biblioteca' };
const MAX_TITULO = 28;

const nombreDominio = (d) => NOMBRE_DOMINIO[d] ?? `${String(d).charAt(0).toUpperCase()}${String(d).slice(1)}`;
const recortar = (t) => (t.length > MAX_TITULO ? `${t.slice(0, MAX_TITULO - 1).trimEnd()}…` : t);
// El nombre lo da el servidor (el de HermesEnVivo); sin él (un servidor anterior), la primera palabra del tipo.
const nombreTrabajo = (e) =>
  e.nombre ??
  String(e.tipo)
    .split('.')
    .at(-1)
    .split('_')[0]
    .replace(/^cribar$/, 'criba');

function queCorre(enMarcha) {
  const [e] = enMarcha;
  const uno = [nombreTrabajo(e), e.titulo ? recortar(e.titulo) : null].filter(Boolean).join(' ');
  return enMarcha.length > 1 ? `${uno} y ${enMarcha.length - 1} más` : uno;
}

/**
 * La pastilla «Hermes» de la barra lateral, una línea por dominio a partir de /api/plataforma/cola/resumen:
 * «Licitaciones: 1 en marcha (memoria Ejemplo) · 2 en cola · 0 fallos». Un dominio sin perfil
 * de Hermes sale solo como «Equipo (en pausa)»: sus pendientes no son trabajo atascado.
 */
export function lineasPastilla(resumen) {
  return (resumen?.dominios ?? []).map((r) => {
    const nombre = nombreDominio(r.dominio);
    if (r.en_pausa && r.motivo_pausa === 'sin_perfil')
      return { dominio: r.dominio, pausa: true, texto: `${nombre} (en pausa)` };
    const marcha = r.en_marcha ?? [];
    const partes = [
      `${marcha.length} en marcha${marcha.length ? ` (${queCorre(marcha)})` : ''}`,
      `${r.en_cola ?? 0} en cola`,
      plural(r.fallos_24h ?? 0, 'fallo'),
    ];
    const cabeza = r.en_pausa ? `${nombre} (en pausa por el límite de uso)` : nombre;
    return { dominio: r.dominio, pausa: Boolean(r.en_pausa), texto: `${cabeza}: ${partes.join(' · ')}` };
  });
}
