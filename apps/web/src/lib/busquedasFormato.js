// Búsquedas guardadas: la búsqueda y los filtros de Oportunidades como alerta. Se
// guardan con la forma de GET /revision (sin pestaña ni página) y se vuelven a abrir en la lista.
// Sin React, con tests.
import { consultaRevision, OPINIONES } from './oportunidadesFormato.js';

export const FRECUENCIAS = [
  { key: 'diaria', label: 'Cada día' },
  { key: 'semanal', label: 'Cada semana' },
];
const QUITAR = ['pestana', 'pagina', 'limite'];

/** Lo que se guarda: la consulta de la lista de Por revisar, sin pestaña ni página. */
export function consultaParaGuardar({ texto = '', pliegos = false, filtros }) {
  const q = new URLSearchParams(consultaRevision({ pestana: 'por_revisar', texto, pliegos, filtros }));
  return Object.fromEntries([...q.entries()].filter(([k]) => !QUITAR.includes(k)));
}

const lista = (v) => (v ? v.split(',').filter(Boolean) : []);
const numero = (v) => (v === undefined || v === '' ? null : Number(v));

/** Al revés: la búsqueda guardada como texto, «en los pliegos» y filtros de la lista. */
export function deConsulta(consulta = {}) {
  return {
    texto: consulta.texto ?? '',
    pliegos: consulta.pliegos === '1',
    filtros: {
      opinion: consulta.opinion ? lista(consulta.opinion) : OPINIONES.map((o) => o.key),
      comunidades: lista(consulta.comunidad),
      importe_min: numero(consulta.importe_min),
      importe_max: numero(consulta.importe_max),
      cpv: lista(consulta.cpv),
      palabras: lista(consulta.palabras),
      excluir: lista(consulta.excluir),
      tipos: lista(consulta.tipos),
      idiomas: lista(consulta.idiomas),
    },
  };
}

/** El nombre que se propone al guardar: lo buscado o, sin texto, los prefijos CPV. */
export function nombreSugerido({ texto = '', filtros }) {
  if (texto.trim()) return texto.trim().slice(0, 80);
  if (filtros?.cpv?.length) return `CPV ${filtros.cpv.join(', ')}`.slice(0, 80);
  return 'Mi búsqueda';
}

/** «Cada semana · 2 nuevas esta semana» para la lista de Ajustes › Avisos. */
export function textoBusqueda(b) {
  const cada = FRECUENCIAS.find((f) => f.key === b.frecuencia)?.label ?? b.frecuencia;
  const nuevas =
    b.nuevas === 0
      ? 'ninguna nueva esta semana'
      : b.nuevas === 1
        ? '1 nueva esta semana'
        : `${b.nuevas} nuevas esta semana`;
  return `${cada} · ${b.activa ? nuevas : 'en pausa'}`;
}
