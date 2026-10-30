// La matriz rol × persona del equipo de la oferta, sin React. El servidor
// (GET …/oferta/equipo/matriz) calcula las celdas sobre las decisiones GUARDADAS; aquí solo se
// decide cómo se leen y qué cambia en el formulario al asignar a alguien a un rol.

const ACENTOS = /[̀-ͯ]/g;

/** «Técnico/a de formación» → «tecnico-a-de-formacion»: estable para data-testid. */
export function slug(texto) {
  const s = String(texto ?? '')
    .normalize('NFD')
    .replace(ACENTOS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'sin-nombre';
}

const SIMBOLO = { si: '✓', no: '✗', no_comprobado: 'no comprobado' };
const TONO = { si: 'ok', no: 'peligro', no_comprobado: 'aviso' };

const pagina = (p) => (Number.isInteger(p) ? ` (pág. ${p})` : '');

function fuenteDe(c) {
  if (c.fuente === 'colaboradores') return 'Colaboradores';
  if (c.fuente === 'cv') return `su CV${pagina(c.pagina)}`;
  return null;
}

/** { simbolo, tono, fuente } de una celda; lo desconocido se lee como «no comprobado», nunca como ✓. */
export function textoCelda(celda) {
  const estado = SIMBOLO[celda?.estado] ? celda.estado : 'no_comprobado';
  return { simbolo: SIMBOLO[estado], tono: TONO[estado], fuente: celda ? fuenteDe(celda) : null };
}

/** La ficha de la persona en Equipo, abierta en la materia: «#/equipo/12#campo=topografía». */
export function enlaceFicha(personaId, materia) {
  const base = `#/equipo/${encodeURIComponent(String(personaId))}`;
  return materia ? `${base}#campo=${encodeURIComponent(materia)}` : base;
}

/** El enlace de una celda sin ✓: con el CV, actualizar Colaboradores desde él; si no, añadirlo en su ficha. */
export function enlaceCelda(personaId, celda) {
  if (!celda || celda.estado === 'si') return null;
  const texto =
    celda.fuente === 'cv'
      ? `Actualizar Colaboradores con el CV${pagina(celda.pagina)}`
      : `Añadir «${celda.materia}» en su ficha`;
  return { href: enlaceFicha(personaId, celda.materia), texto };
}

// La primera palabra del rol basta para casar «Coordinador/a» con «Coordinadora de los cursos».
const raizRol = (rol) => slug(rol).split('-')[0];
const ocupaRol = (miembro, rol) => slug(miembro.rol_en_la_oferta).includes(raizRol(rol));

/** Los del formulario que ya van en el rol de la fila pero aún no están guardados (la matriz no los ve). */
export function pendientesDeGuardar(fila, equipo = []) {
  if (!fila?.rol) return [];
  const guardados = new Set((fila.asignados ?? []).map((a) => a.persona_id));
  const ids = equipo.filter((m) => ocupaRol(m, fila.rol) && !guardados.has(m.persona_id)).map((m) => m.persona_id);
  return [...new Set(ids)];
}

/** El equipo del formulario con la persona en el rol de la fila (una entrada por rol, como en Decisiones). */
export function asignarAlRol(equipo, personaId, fila) {
  const id = Number(personaId);
  if (!Number.isInteger(id) || !fila?.rol) return equipo;
  if (equipo.some((m) => m.persona_id === id && ocupaRol(m, fila.rol))) return equipo;
  return [
    ...equipo,
    { persona_id: id, rol_en_la_oferta: fila.rol, dedicacion: '', lotes: fila.lote ? [fila.lote] : [] },
  ];
}

/** Los avisos de roles incompatibles de toda la matriz, sin repetir (cada fila trae el suyo). */
export function avisosIncompatibles(filas = []) {
  const vistos = new Set();
  return filas
    .flatMap((f) => f.incompatibles ?? [])
    .filter((t) => {
      // «A es X y también Y» y «A es Y y también X» son el mismo aviso: mismas letras, otro orden.
      const clave = [...t].sort().join('');
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}
