// Veredicto de las comprobaciones: una sola frase con precedencia fija. Puro y sin E/S.
import type { Bloqueo, Comprobaciones } from './comprobacionesTipos.js';

export type EntradaVeredicto = {
  descartada?: boolean;
  retirada?: boolean;
  motivo?: string | null;
  bloqueos: readonly Bloqueo[];
  enCurso?: boolean;
  eta?: { desde: string; hasta: string } | null;
};

const MAX_MOTIVO = 120;

// Solo cuentan como pendientes las filas que nadie ha cerrado ni aceptado.
const estaAbierta = (b: Bloqueo): boolean => b.estado === 'abierto' || b.estado === 'propuesta';
const bloquea = (b: Bloqueo): boolean => b.gravedad === 'impide' || b.gravedad === 'riesgo';

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

function textoNoPresentable(duros: Bloqueo[]): string {
  const resto = duros.length - 1;
  return `No presentable: ${duros[0]?.titulo ?? ''}${resto > 0 ? ` y ${resto} más` : ''}`;
}

function textoHermes(eta?: { desde: string; hasta: string } | null): string {
  return `Hermes trabajando${eta ? ` (lista entre ${eta.desde} y ${eta.hasta})` : ''}`;
}

export function veredictoDe(e: EntradaVeredicto): Comprobaciones['veredicto'] {
  if (e.descartada || e.retirada) {
    const motivo = (e.motivo ?? '').trim().slice(0, MAX_MOTIVO);
    return { tipo: 'descartada', texto: `Descartada: ${motivo}` };
  }
  const abiertas = e.bloqueos.filter((b) => estaAbierta(b) && bloquea(b));
  const duros = abiertas.filter((b) => b.gravedad === 'impide' && (b.actor === 'negocio' || b.actor === 'fuera'));
  if (duros.length) return { tipo: 'no_presentable', texto: textoNoPresentable(duros) };
  const tuyas = abiertas.filter((b) => b.actor === 'tu');
  if (tuyas.length)
    return { tipo: 'faltan_decisiones', texto: `Faltan ${plural(tuyas.length, 'decisión tuya', 'decisiones tuyas')}` };
  if (e.enCurso || abiertas.some((b) => b.actor === 'hermes'))
    return { tipo: 'hermes_trabajando', texto: textoHermes(e.eta) };
  const aceptados = e.bloqueos.filter((b) => b.estado === 'riesgo_aceptado').length;
  if (aceptados)
    return {
      tipo: 'presentable_con_riesgos',
      texto: `Presentable con ${plural(aceptados, 'riesgo aceptado', 'riesgos aceptados')}`,
    };
  return { tipo: 'lista_para_firmar', texto: 'Lista para firmar' };
}

// Los minutos de cada fila, que su regla ya calcula (medio minuto por documento en las agrupadas,
// 0 para lo que hace el negocio): así el total cuadra con las filas. Lo de 'fuera' no cuenta.
export function minutosPersona(bloqueos: readonly Bloqueo[]): number {
  return bloqueos.filter((b) => estaAbierta(b) && b.actor !== 'fuera').reduce((suma, b) => suma + b.minutos, 0);
}
