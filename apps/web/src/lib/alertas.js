// Lo que impide que llegue trabajo nuevo a un dominio (ingesta apagada o con error, Hermes
// sin conectar o frenado): se avisa en todas sus vistas, no solo en Estado (sin React, con tests).
import { fechaHora, textoAlertaIa } from './formato.js';

// La pausa por límite de uso, de estadoCola (pausa_por_limite_hasta) o de las alertas del dominio.
function pausaHasta(estado) {
  return estado?.pausa_por_limite_hasta ?? (estado?.alertas_ia ?? []).find((a) => a.motivo === 'limite')?.hasta ?? null;
}

const horaMinutos = (iso, zona) =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona });

/**
 * Lo que dice el pie de la barra lateral: «Servidor ✓ · Hermes ✓» y no «Conectado» a secas.
 * { tono: 'ok' | 'aviso' | 'error', texto }; sin el estado de Licitaciones, solo el servidor.
 */
export function estadoConexion(conectado, estado, zona = undefined) {
  if (!conectado) return { tono: 'error', texto: 'Sin conexión con el servidor' };
  if (!estado) return { tono: 'ok', texto: 'Servidor ✓' };
  if (estado.hermes !== 'configurado') return { tono: 'aviso', texto: 'Servidor ✓ · Hermes ✗' };
  const hasta = pausaHasta(estado);
  if (hasta && Date.parse(hasta) > Date.now())
    return { tono: 'aviso', texto: `Servidor ✓ · Hermes en pausa hasta ${horaMinutos(hasta, zona)}` };
  return { tono: 'ok', texto: 'Servidor ✓ · Hermes ✓' };
}

// Una fuente de la PLACSP que no publica. Si las demás siguen al día, nuestra ingesta funciona y
// es la PLACSP; sin `fuente` (un servidor anterior), el aviso de siempre.
function textoSinNovedades(a) {
  if (!a.fuente)
    return `La ingesta lleva más de 6 h sin traer nada nuevo: lo último es del ${fechaHora(a.desde)}. Prueba «Sincronizar ahora»; si sigue igual, la PLACSP puede estar caída.`;
  const base = `${a.nombre}: la PLACSP no publica nada nuevo desde hace más de ${a.horas} h (lo último es del ${fechaHora(a.desde)}).`;
  const alDia = a.al_dia ?? [];
  if (alDia.length)
    return `${base} ${alDia.join(' y ')} sigue al día: la ingesta funciona, es la PLACSP. Mientras tanto, busca a mano en la PLACSP lo publicado desde esa fecha.`;
  return `${base} Prueba «Sincronizar ahora»; si sigue igual, la PLACSP puede estar caída.`;
}

// Los avisos de operación que calcula el servidor: la ingesta en marcha que no trae
// nada y la criba que falla más de la cuenta, que antes solo se veían mirando los contadores.
function textoAlertaOperacion(a) {
  if (a.motivo === 'ingesta_sin_novedades') return textoSinNovedades(a);
  if (a.motivo === 'criba_con_fallos') {
    return `La criba ha fallado en ${a.fallidos} de ${a.total} lotes en los últimos 7 días (más del 20 %): esas candidatas vuelven a la cola. Mira la causa en Ajustes › Hermes.`;
  }
  return null;
}

/** [{ tono: 'aviso' | 'error', texto }] a partir del estado de Licitaciones. */
export function alertasDeEstado(estado) {
  if (!estado) return [];
  const out = [];
  if (estado.activo === false)
    out.push({
      tono: 'aviso',
      texto:
        'La ingesta está apagada: se ve lo guardado, pero no llega nada nuevo. La enciende quien administra el servidor.',
    });
  if (estado.hermes !== 'configurado') {
    out.push({
      tono: 'aviso',
      texto:
        'La criba por IA está en espera porque Hermes no está conectado. Las candidatas se guardan y se cribarán cuando lo esté.',
    });
  }
  if (estado.aviso_hermes) out.push({ tono: 'aviso', texto: `${estado.aviso_hermes}.` });
  for (const a of estado.alertas_ia ?? []) out.push({ tono: 'aviso', texto: textoAlertaIa(a) });
  for (const a of estado.alertas_operacion ?? []) {
    const texto = textoAlertaOperacion(a);
    if (texto) out.push({ tono: 'aviso', texto });
  }
  if (estado.ingesta?.error)
    out.push({ tono: 'error', texto: `La ingesta se detuvo: ${estado.ingesta.error}. Se reinicia sola.` });
  return out;
}
