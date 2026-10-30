// Lo que la web decide sobre el diff de la propuesta de Hermes, sin React: cómo se lee
// cada valor, qué filas se pliegan y qué aplica «Aplicar todo y guardar». Las de acreditación
// quedan fuera de ese botón porque son una declaración: el servidor solo las acepta de una en una.
import { fechaHora } from './formato.js';

const VACIO = '—';

const listaConY = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

function textoLotes(lotes) {
  if (!lotes.length) return 'Ningún lote';
  return `${lotes.length === 1 ? 'Lote' : 'Lotes'} ${listaConY(lotes.map(String))}`;
}

// La persona sin nombre conocido sale por su id: nunca se inventa uno.
function textoMiembro(m, nombre) {
  const quien = nombre?.(m.persona_id) ?? `Persona ${m.persona_id}`;
  return [quien, m.rol_en_la_oferta, m.dedicacion].filter(Boolean).join(' · ');
}

function textoAutomatico(a) {
  if (!a.nos_acogemos) return 'No nos acogemos';
  const partes = [a.tramo ? `Nos acogemos: «${a.tramo}»` : 'Nos acogemos (sin tramo)'];
  if (a.nivel) partes.push(a.nivel);
  if (a.evidencia) partes.push(`Evidencia: ${a.evidencia}`);
  if (a.nota) partes.push(`Nota: ${a.nota}`);
  return partes.join(' · ');
}

/** Un valor del diff (guardado o propuesto) como texto; `nombre(persona_id)` da el nombre si se conoce. */
export function textoValor(seccion, valor, nombre = null) {
  if (valor === null || valor === undefined) return seccion === 'equipo' ? 'Fuera del equipo' : VACIO;
  if (seccion === 'lotes') return textoLotes(valor);
  if (seccion === 'equipo') return textoMiembro(valor, nombre);
  if (seccion === 'automaticos') return textoAutomatico(valor);
  if (seccion === 'herramientas') return valor.length ? valor.join(', ') : VACIO;
  return String(valor).trim() || VACIO;
}

/** Las filas con cambios, arriba, y las iguales aparte, para plegarlas en «Sin cambios (N)». */
export function filasVisibles(campos) {
  const todas = campos ?? [];
  return { cambios: todas.filter((c) => !c.igual), iguales: todas.filter((c) => c.igual) };
}

function textoBoton(n, acreditaciones) {
  if (!acreditaciones) return 'Aplicar todo y guardar';
  const cuales = acreditaciones === 1 ? 'la de acreditación' : `las ${acreditaciones} de acreditación`;
  return `Aplicar ${n} (${cuales}, una a una)`;
}

/** Lo que aplica «Aplicar todo y guardar»: las filas con cambios que no son de acreditación. */
export function resumenAplicar(campos) {
  const { cambios } = filasVisibles(campos);
  const claves = cambios.filter((c) => !c.acreditacion).map((c) => c.campo);
  const acreditaciones = cambios.length - claves.length;
  return { claves, acreditaciones, texto: textoBoton(claves.length, acreditaciones) };
}

/** La propuesta se hizo con otro guion: no se puede aplicar (el servidor la rechaza) y Hermes la rehace. */
export const esObsoleta = (d) => Boolean(d && d.guion_version !== d.guion_vigente);

export function textoCabeceraDiff(d) {
  const guion = d.guion_version === null ? 'un guion anterior' : `el guion v${d.guion_version}`;
  return `Propuesta de Hermes del ${fechaHora(d.propuesta_creada_en)} con ${guion}`;
}

export function textoObsoleta(d) {
  const guion = d.guion_version === null ? 'un guion anterior' : `el guion v${d.guion_version}`;
  return `Hecha con ${guion}: Hermes la está rehaciendo`;
}

const ETIQUETA = { lotes: 'Lotes', herramientas: 'Herramientas', enfoque: 'Enfoque' };

/** El nombre de la fila: el criterio con su lote, la persona o la sección. */
export function etiquetaCampo(c, nombre = null) {
  if (c.seccion === 'automaticos') {
    const a = c.propuesto ?? c.guardado;
    return a?.lote ? `${a.criterio} · lote ${a.lote}` : (a?.criterio ?? c.campo);
  }
  if (c.seccion === 'equipo') {
    const id = (c.propuesto ?? c.guardado)?.persona_id;
    return `Equipo · ${nombre?.(id) ?? `Persona ${id}`}`;
  }
  return ETIQUETA[c.seccion] ?? c.campo;
}
