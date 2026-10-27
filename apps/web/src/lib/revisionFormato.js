// Lo que la web decide sobre la bandeja de revisión sin tocar el servidor: qué tarjetas se ven,
// en qué orden y qué dice la cabecera. Las cerradas no se pintan: ya no piden nada a nadie.

const pendientes = (tarjetas) => (tarjetas ?? []).filter((t) => t.estado === 'pendiente');

/** Primero las nuevas para ti, luego las de acreditación, y dentro de cada grupo la más reciente arriba. */
export function ordenTarjetas(tarjetas) {
  const peso = (t) => (t.nueva_para_ti ? 2 : 0) + (t.acreditacion ? 1 : 0);
  return pendientes(tarjetas).sort(
    (a, b) => peso(b) - peso(a) || String(b.creada_en).localeCompare(String(a.creada_en)),
  );
}

export function textoCabecera(tarjetas) {
  const n = pendientes(tarjetas).filter((t) => t.nueva_para_ti).length;
  if (n === 0) return 'Nada nuevo desde tu última revisión';
  return `Lo que hizo Hermes: ${n} ${n === 1 ? 'nueva' : 'nuevas'} desde tu última revisión`;
}

/** La versión del paquete de una tarjeta «revision_previa:vN», o null si la clave no es de una. */
export function versionDeRevisionPrevia(clave) {
  const m = /^revision_previa:v(\d+)$/.exec(String(clave ?? ''));
  return m ? Number(m[1]) : null;
}

// La memoria se descarta en su vista (ResumenMemoria): cierra la tarjeta y descarta el borrador. El
// «Descartar con motivo» genérico solo cerraba la tarjeta y dejaba la versión como la de la oferta.
const DESCARTE_PROPIO = new Set(['memoria']);

/** Si la tarjeta lleva el «Descartar con motivo» genérico de la bandeja. */
export const conDescarteGenerico = (tipo) => !DESCARTE_PROPIO.has(tipo);

const EVENTO_REVISION = 'licitacion.revision';

/**
 * Si un evento de la licitación obliga a releer la bandeja: el de la revisión (otra persona o el
 * agente cerró una tarjeta), cualquier otro de la licitación (Hermes deja memoria, anexos o una
 * propuesta, que son tarjetas nuevas) y la reconexión, porque lo de mientras no llegó.
 */
export function recargaLaRevision(detalle) {
  const tipo = String(detalle?.tipo ?? '');
  return tipo === EVENTO_REVISION || tipo.startsWith('licitacion.') || tipo === 'plataforma-reconectado';
}
