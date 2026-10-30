// Textos de la calidad del dato (Ajustes › Fuentes): la prueba hacia atrás de cada índice
// y el recuento de las actas de expedientes ajenos.
import { plural } from './formato.js';

const NOMBRE_INDICE = { ofertas: 'Ofertas esperadas', baja: 'Baja esperada' };
const decimal = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** Filas de la tabla de acierto: índice, mes, n, cuánto se desvía y cuántos caen en el rango P25-P75. */
export function filasAcierto(historial = []) {
  return historial.map((a) => ({
    clave: `${a.indice}-${a.mes}`,
    indice: NOMBRE_INDICE[a.indice] ?? a.indice,
    mes: a.mes,
    n: a.n,
    error:
      a.error_absoluto_medio === null
        ? '—'
        : a.indice === 'baja'
          ? `${decimal(a.error_absoluto_medio * 100)} puntos`
          : `${decimal(a.error_absoluto_medio)} ofertas`,
    cobertura: a.cobertura_rango === null ? '—' : `${decimal(a.cobertura_rango * 100)} %`,
  }));
}

/** «12 leídas (40 licitadores) · 3 sin acta publicada · 1 esperando a Hermes». */
export function textoActasMercado(r) {
  const e = r?.por_estado ?? {};
  const leidas = (e.leida ?? 0) + (e.leida_hermes ?? 0);
  const hermes = (e.pendiente_hermes ?? 0) + (e.pedida_hermes ?? 0);
  const partes = [
    `${plural(leidas, 'leída', 'leídas')} (${plural(r?.licitadores ?? 0, 'licitador', 'licitadores')})`,
    e.sin_acta ? `${e.sin_acta} sin acta publicada` : null,
    e.sin_texto ? `${e.sin_texto} sin texto (escaneadas)` : null,
    hermes ? `${hermes} esperando a Hermes` : null,
    e.error ? `${e.error} con error` : null,
  ];
  return partes.filter(Boolean).join(' · ');
}
