// El resumen semanal por email para Ajustes › Avisos. Sin React, con tests. La hora
// es la de la empresa: con la peninsular al lado si está en Canarias.
import { empresaEnCanarias } from './formato.js';

export const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const SECCIONES = [
  { key: 'plazos', label: 'Lo que cierra en los próximos 7 días' },
  {
    key: 'nuevas',
    label: 'Las 5 nuevas por revisar (las que cierran antes, o las de más encaje cuando el encaje esté calibrado)',
  },
  { key: 'novedades', label: 'Resoluciones, competidores que seguimos y órganos que seguimos' },
  { key: 'lecciones', label: 'Lecciones por revisar' },
];
const HORAS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

const dosCifras = (h) => `${String(h).padStart(2, '0')}:00`;

/** Las horas que se pueden elegir; en Canarias, con la peninsular al lado (siempre una más). */
export const opcionesHora = () =>
  HORAS.map((h) => ({
    valor: h,
    texto: empresaEnCanarias() ? `${dosCifras(h)} (${dosCifras((h + 1) % 24)} peninsular)` : dosCifras(h),
  }));

/** «hora de Canarias» u «hora peninsular», según la zona de la empresa. */
export const nombreHora = () => (empresaEnCanarias() ? 'hora de Canarias' : 'hora peninsular');

/** «Los lunes a las 08:00 (hora peninsular), a 2 personas»; sin nadie marcado, que no llega a nadie. */
export function textoResumen(config) {
  if (!config) return '';
  const quien =
    config.destinatarios.length === 0
      ? 'aún no llega a nadie'
      : config.destinatarios.length === 1
        ? 'a 1 persona'
        : `a ${config.destinatarios.length} personas`;
  return `Los ${DIAS[config.dia - 1]} a las ${dosCifras(config.hora)} (${nombreHora()}), ${quien}`;
}

/** Marcar o desmarcar a alguien en la lista de destinatarios. */
export function alternarDestinatario(destinatarios, id) {
  return destinatarios.includes(id) ? destinatarios.filter((x) => x !== id) : [...destinatarios, id];
}
