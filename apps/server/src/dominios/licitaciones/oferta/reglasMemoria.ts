// Reglas de las comprobaciones sobre la memoria: se pasa de páginas y nombra al equipo cuando se pide por roles.
import { enumerar } from './dependenciasAnexo.js';
import type { EstadoMemoria } from './memoria.js';

// Puras y sin nombres de personas: el texto lo leen las comprobaciones, Hoy, la lista y el MCP, y debe ser el
// mismo en todas.
export type MemoriaParaReglas = Pick<
  EstadoMemoria,
  'version' | 'estado' | 'paginas' | 'paginas_estimadas' | 'limite_paginas' | 'anonimato'
> & { lote?: string | null; presentada?: boolean };

export type FilaMemoria = {
  clave: string;
  gravedad: 'impide' | 'riesgo';
  titulo: string;
  detalle: string;
  cita: string | null;
  lote: string | null;
};

const sufijo = (lote: string | null | undefined): string => (lote ? `-l${lote}` : '');
// Las estimadas suman decimales por apartado: «31,4», nunca «31.4» ni restos binarios.
const paginasTexto = (n: number): string => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

function reglaPaginas(m: MemoriaParaReglas, cita: string | null): FilaMemoria | null {
  const { limite_paginas: limite } = m;
  if (limite === null) return null;
  const lote = m.lote ?? null;
  const clave = `memoria_paginas${sufijo(lote)}`;
  const medidas = m.paginas ?? m.paginas_estimadas;
  if (medidas === null) {
    // Mientras se redacta no hay documento que medir: solo la ensamblada puede quedar sin medir.
    if (m.estado !== 'ensamblada') return null;
    return {
      clave,
      gravedad: 'riesgo',
      titulo: 'No se pudo medir la extensión de la memoria',
      detalle: `No se pudo medir la extensión de la v${m.version}: compruébala en el Word (límite ${limite} páginas).`,
      cita,
      lote,
    };
  }
  if (medidas <= limite) return null;
  const estimada = m.paginas === null ? ' (estimadas)' : '';
  return {
    clave,
    gravedad: 'impide',
    titulo: 'La memoria se pasa de páginas',
    cita,
    lote,
    detalle: `La v${m.version} ocupa ${paginasTexto(medidas)} páginas${estimada} y el pliego limita a ${limite}: recorta ${Math.ceil(medidas - limite)} antes de presentar.`,
  };
}

function reglaAnonimato(m: MemoriaParaReglas): FilaMemoria | null {
  const a = m.anonimato;
  if (!a?.exige || !a.personas) return null;
  const lote = m.lote ?? null;
  const personas = a.personas === 1 ? '1 persona' : `${a.personas} personas`;
  const apartados = `${a.apartados.length === 1 ? 'apartado' : 'apartados'} ${enumerar(a.apartados.map(String))}`;
  return {
    clave: `memoria_nombra_personas${sufijo(lote)}`,
    gravedad: 'impide',
    titulo: 'La memoria nombra al equipo',
    cita: null,
    lote,
    detalle: `La v${m.version} nombra a ${personas} del equipo (${apartados}) y el pliego pide el equipo sin nombres: preséntala${a.personas === 1 ? '' : 's'} por su rol.`,
  };
}

/**
 * Filas de bloqueo de la memoria que cuenta en las comprobaciones. cita: el límite tal como lo dice el pliego, si el guion lo trae.
 * La presentada (de su lote) ya se entregó: no hay nada que recortar ni corregir, así que no bloquea.
 */
export function reglasDeMemoria(m: MemoriaParaReglas, cita?: string | null): FilaMemoria[] {
  if (m.presentada) return [];
  return [reglaPaginas(m, cita ?? null), reglaAnonimato(m)].filter((f): f is FilaMemoria => f !== null);
}
