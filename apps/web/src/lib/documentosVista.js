// Cajón Documentos de las comprobaciones, sin React y con tests: tarjetas por
// archivo electrónico y lote, el tipo de cada documento y su estado. El estado no lo elige nadie
// en un desplegable: lo da la verificación, que son las comprobaciones (un bloqueo abierto que nombra al
// documento manda) o, si no queda nada que lo impida y está preparado, «Verificado». Así el
// cajón y la fila «Documentos» de las comprobaciones no pueden contar cosas distintas.

// Lo que la persona ya decidió en las comprobaciones deja de pesar sobre el documento.
const CERRADOS = new Set(['resuelto', 'riesgo_aceptado', 'vamos']);

const TIPOS_TARJETA = {
  rellena_hermes: 'Lo rellena Hermes',
  certificado: 'Certificado de empresa',
  no_tenemos: 'Certificado que no tenemos',
  genera_hermes: 'Lo genera Hermes',
};

const sinTildes = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
// Como claveBloqueo en el servidor (comprobacionesTipos.ts): «a1-d3-l1» y «a1_d3_l1» son el mismo documento.
const comoClave = (t) =>
  sinTildes(t)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const ultimoTramo = (clave) =>
  String(clave ?? '')
    .split(':')
    .at(-1);
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// «ANEXO III LOTE 2», «lotes 2 y 3»: el guion no siempre separa por lote, pero el nombre lo dice.
const LOTES = /\blotes?\s+(?:n[.ºo°]*\s*)?(\d{1,3}[a-z]?(?:\s*(?:,|y|e)\s*\d{1,3}[a-z]?)*)\b/g;

/** Los lotes de un documento: el suyo si la fila es de un lote o los que nombra; [] si no nombra ninguno. */
export function lotesDeDocumento(d) {
  if (d?.lote) return [String(d.lote)];
  const texto = sinTildes(`${d?.nombre ?? ''} ${d?.origen?.modelo ?? ''}`);
  const ids = [...texto.matchAll(LOTES)].flatMap((m) => m[1].match(/\d{1,3}[a-z]?/g) ?? []);
  return [...new Set(ids.map((i) => i.replace(/^0+(?=\d)/, '')))];
}

/** Los lotes a los que vamos (el ámbito de las comprobaciones): los de interés de la licitación. */
export function lotesDeAmbito(f) {
  return (f?.lotes_interes ?? []).map((l) => String(l?.id ?? l)).filter(Boolean);
}

const deOtroLote = (d, lotes) => {
  const suyos = lotesDeDocumento(d);
  return lotes.length > 0 && suyos.length > 0 && !suyos.some((l) => lotes.includes(l));
};

function loteDeGrupo(d, lotes) {
  const suyos = lotesDeDocumento(d).filter((l) => !lotes.length || lotes.includes(l));
  return suyos.length === 1 ? suyos[0] : null;
}

// Primero lo común; después cada lote en el orden del ámbito.
function gruposPorLote(docs, lotes) {
  const grupos = new Map();
  for (const d of docs) {
    const lote = loteDeGrupo(d, lotes);
    if (!grupos.has(lote)) grupos.set(lote, []);
    grupos.get(lote).push(d);
  }
  const orden = (l) => (l === null ? -1 : lotes.includes(l) ? lotes.indexOf(l) : lotes.length);
  return [...grupos].sort(([a], [b]) => orden(a) - orden(b)).map(([lote, documentos]) => ({ lote, documentos }));
}

/**
 * Una tarjeta por archivo electrónico (en el orden del guion) con sus documentos por lote y, aparte,
 * los de lotes a los que no vamos: no cuentan en nada y la web los enseña plegados.
 */
export function tarjetasPorSobre(docs = [], lotes = []) {
  const sobres = new Map();
  for (const d of docs) {
    const archivo = d.archivo || 'Sin archivo';
    if (!sobres.has(archivo)) sobres.set(archivo, { archivo, propios: [], otros: [] });
    const s = sobres.get(archivo);
    (deOtroLote(d, lotes) ? s.otros : s.propios).push(d);
  }
  return [...sobres.values()].map((s) => ({
    archivo: s.archivo,
    grupos: gruposPorLote(s.propios, lotes),
    otros: s.otros,
  }));
}

/** «8 de otros lotes»; null si no hay ninguno. */
export function textoOtrosLotes(otros = []) {
  return otros.length ? `${otros.length} de otros lotes` : null;
}

const nombraAlDocumento = (b, d) =>
  comoClave(ultimoTramo(b.clave)) === comoClave(d.clave) || b.accion?.destino === `documentos.${d.clave}`;

const mismoLote = (b, d) => {
  const suyos = lotesDeDocumento(d);
  return !b.lote || !suyos.length || suyos.includes(String(b.lote));
};

// La certificación de «excluyente_vs_perfil:<lote>:<cert>» (papeles.ts): «ens», «iso-27001», «cmmi».
function nombraLaCertificacion(cert, nombre) {
  if (cert === 'ens') return /esquema nacional de seguridad|\bens\b/.test(nombre);
  const partes = cert.split(/[-_]/).filter(Boolean).map(escapar);
  return partes.length > 0 && new RegExp(`\\b${partes.join('.{0,8}')}\\b`).test(nombre);
}

// El bloqueo de elegibilidad cita a veces la ficha y no el documento: entonces casa por la certificación.
function pideEsteCertificado(b, d) {
  if (b.categoria !== 'elegibilidad' || d.tipo !== 'acreditacion' || !mismoLote(b, d)) return false;
  if (b.cita?.texto && sinTildes(b.cita.texto) === sinTildes(d.nombre)) return true;
  return (
    String(b.clave).startsWith('excluyente_vs_perfil:') &&
    nombraLaCertificacion(ultimoTramo(b.clave), sinTildes(d.nombre))
  );
}

/** Los bloqueos abiertos de las comprobaciones que son de este documento. */
function bloqueosDeDocumento(d, bloqueos = []) {
  return (bloqueos ?? []).filter(
    (b) => !CERRADOS.has(b.estado) && (nombraAlDocumento(b, d) || pideEsteCertificado(b, d)),
  );
}

/** { clave, texto } del tipo de la tarjeta: quién lo produce y, en un certificado, si lo tenemos. */
export function tipoDocumento(d, bloqueos = []) {
  let clave = 'rellena_hermes';
  if (d.tipo === 'acreditacion') {
    const falta = bloqueosDeDocumento(d, bloqueos).some(
      (b) => b.categoria === 'elegibilidad' && b.gravedad === 'impide',
    );
    clave = falta ? 'no_tenemos' : 'certificado';
  } else if (d.tipo === 'memoria' || d.produce === 'hermes') clave = 'genera_hermes';
  return { clave, texto: TIPOS_TARJETA[clave] };
}

const ESTADOS_SIN_BLOQUEO = {
  preparado: () => ({ clave: 'verificado', texto: 'Verificado' }),
  no_aplica: (d) => ({ clave: 'no_aplica', texto: d.nota ? `No aplica: ${d.nota}` : 'No aplica' }),
  borrador: () => ({ clave: 'borrador', texto: 'Borrador por aceptar' }),
};

/**
 * { clave, texto, bloqueo }: el primer bloqueo abierto que nombra al documento (su título es el
 * estado) o, sin ninguno, «Verificado» si está preparado, «No aplica», «Borrador por aceptar» o «Sin preparar».
 */
export function estadoVerificado(d, bloqueos = []) {
  const b = bloqueosDeDocumento(d, bloqueos)[0];
  if (b) return { clave: 'bloqueado', texto: b.titulo, bloqueo: b };
  const sin = ESTADOS_SIN_BLOQUEO[d.estado];
  return { ...(sin ? sin(d) : { clave: 'pendiente', texto: 'Sin preparar' }), bloqueo: null };
}

/** Un borrador se acepta de una vez solo si no exige evidencia (un certificado se revisa uno a uno). */
export function aceptableDeUnaVez(d) {
  return d.estado === 'borrador' && d.tipo !== 'acreditacion';
}

/** «3 de 5 verificados» de un conjunto de documentos (lo que no aplica no cuenta). */
export function textoVerificados(docs = [], bloqueos = []) {
  const cuentan = docs.filter((d) => d.estado !== 'no_aplica');
  if (!cuentan.length) return null;
  const hechos = cuentan.filter((d) => estadoVerificado(d, bloqueos).clave === 'verificado').length;
  return `${hechos} de ${cuentan.length} ${cuentan.length === 1 ? 'verificado' : 'verificados'}`;
}

/**
 * El cambio de «Ruta y nota» listo para el PATCH: con un archivo propio que existe en Drive, el
 * documento queda preparado (ya no hay desplegable que lo diga a mano).
 */
export function cambioConArchivo(body, d) {
  if (!body?.ruta || d.estado === 'preparado' || d.estado === 'no_aplica') return body;
  return { ...body, estado: 'preparado' };
}

const OFERTA = /^Oferta(?: · Lote (.+))?$/;
const AUTOMATICO_CON_LOTE = /^(.*) \(lote ([^)]+)\)$/;

function destinoAutomatico(etiqueta) {
  const m = AUTOMATICO_CON_LOTE.exec(etiqueta);
  return `automatico:${m ? m[1] : etiqueta}|${m ? m[2] : ''}`;
}

/**
 * Dónde se cambia un valor de la hoja de datos que sale de una decisión (hojaDatos.ts): el
 * precio del lote, el criterio automático o los lotes, en el cajón Decisiones. null si el valor
 * no sale de una decisión (la empresa se cambia en Ajustes, la licitación no se cambia).
 * lotes: los del ámbito, para la oferta de un solo lote, que la hoja no rotula con su lote.
 */
export function destinoDeCampoHoja(campo, lotes = []) {
  const grupo = String(campo?.grupo ?? '');
  const oferta = OFERTA.exec(grupo);
  if (oferta) return `decisiones.precio.${oferta[1] ?? (lotes.length === 1 ? lotes[0] : 'unico')}`;
  if (grupo === 'Criterios automáticos') return destinoAutomatico(String(campo.etiqueta ?? ''));
  if (grupo === 'Licitación' && campo.etiqueta === 'Lotes') return 'decisiones.lotes';
  return null;
}
