// Telemetría del tiempo de persona: cuánto tiempo con foco pasa cada fila de las comprobaciones
// hasta cerrarse. Cuenta mientras la fila está desplegada (el foco dentro de ella o su confirmación
// abierta) o está abierto el cajón al que llevó su botón, con la pestaña visible y la ventana con el
// foco. Lo manda cada minuto y al irse, con navigator.sendBeacon (no lleva X-Web-Version, así que
// una pestaña antigua no cae en el 409). Solo la clave, el tipo de acción y los milisegundos.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LATIDO_TELEMETRIA_MS, acumularFoco, cajonDeDestino, tareaCerrada } from '../lib/comprobacionesFormato';
import { bloqueo as testidBloqueo } from '../lib/idsPrueba';

const MIN_ENVIO_MS = 1000;
const url = (id) => `/api/licitaciones/licitaciones/${encodeURIComponent(id)}/telemetria`;

// El apartado del detalle de la Oferta abierto ahora (lo publica DetalleOferta): uno a la vez.
let cajonAbierto = null;
const oyentes = new Set();
const suscribir = (fn) => {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
};
const leerCajon = () => cajonAbierto;

function publicarCajon(nombre, abierto) {
  const nuevo = abierto ? nombre : cajonAbierto === nombre ? null : cajonAbierto;
  if (nuevo === cajonAbierto) return;
  cajonAbierto = nuevo;
  oyentes.forEach((fn) => fn());
}

/** Montado en cada apartado de DetalleOferta: avisa a las filas de qué apartado está abierto. */
export function useCajonTelemetria(nombre, abierto) {
  useEffect(() => {
    publicarCajon(nombre, abierto);
    return () => publicarCajon(nombre, false);
  }, [nombre, abierto]);
}

// La telemetría no puede romper las comprobaciones ni avisar a nadie: si no sale, se pierde ese minuto.
function enviar(id, cuerpo) {
  const json = JSON.stringify(cuerpo);
  try {
    if (navigator.sendBeacon?.(url(id), new Blob([json], { type: 'application/json' }))) return;
  } catch {
    /* sin beacon (o lo rechaza): va por fetch */
  }
  try {
    fetch(url(id), {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    }).catch(() => {});
  } catch {
    /* sin red al cerrar la pestaña: ese tramo se pierde */
  }
}

const ahoraVisible = () => typeof document !== 'undefined' && document.visibilityState === 'visible';
const ventanaConFoco = () => typeof document !== 'undefined' && document.hasFocus();

// La fila salió de la lista mientras las comprobaciones siguen a la vista: pasó a resuelta, riesgo aceptado
// o «Vamos». Si se fueron las comprobaciones enteras (otra página, otra oferta), la tarea sigue abierta.
function seCerroEnLaComprobaciones(clave) {
  const comprobaciones = document.querySelector('[data-testid="comprobaciones"]');
  return Boolean(comprobaciones) && !document.querySelector(`[data-testid="${CSS.escape(testidBloqueo(clave))}"]`);
}

// El cajón que abrió la fila cuenta para ella hasta que se cierra; luego ya no es suyo.
function useCajonDeLaFila() {
  const abierto = useSyncExternalStore(suscribir, leerCajon, leerCajon);
  const [pedido, setPedido] = useState({ nombre: null, visto: false });
  if (pedido.nombre && abierto === pedido.nombre && !pedido.visto) setPedido({ ...pedido, visto: true });
  if (pedido.visto && abierto !== pedido.nombre) setPedido({ nombre: null, visto: false });
  const pedirCajon = useCallback(
    (destino) => setPedido({ nombre: cajonDeDestino(destino)?.nombre ?? null, visto: false }),
    [],
  );
  return { enCajon: Boolean(pedido.nombre) && abierto === pedido.nombre, pedirCajon };
}

// El cronómetro y sus envíos. La tarea y si está abierta van en refs: el latido y el cierre leen
// lo último sin rehacer sus suscripciones. Sin nada medido ni enviado, el cierre no manda nada.
function useCronometro({ id, clave, tipo }, abierta) {
  const ref = useRef({ ms: 0, desde: null, enviado: false });
  const datos = useRef({ id, clave, tipo });
  const abiertaRef = useRef(abierta);
  const medir = useCallback(() => {
    const s = acumularFoco(ref.current, {
      ahora: Date.now(),
      abierta: abiertaRef.current,
      visible: ahoraVisible(),
      foco: ventanaConFoco(),
    });
    ref.current = { ...ref.current, ...s };
  }, []);
  const vaciar = useCallback((cerrada) => {
    const { id, clave, tipo } = datos.current;
    const { ms, enviado } = ref.current;
    if (!id || !clave || !tipo || (ms < MIN_ENVIO_MS && !(cerrada && enviado))) return;
    ref.current = { ...ref.current, ms: 0, enviado: true };
    enviar(id, { clave, tipo, ms_foco: Math.round(ms), cerrada });
  }, []);
  useEffect(() => {
    datos.current = { id, clave, tipo };
  }, [id, clave, tipo]);
  // Cierra el tramo con lo de antes y abre el siguiente con lo de ahora.
  useEffect(() => {
    abiertaRef.current = abierta;
    medir();
  }, [abierta, medir]);
  return { medir, vaciar };
}

function useLatido(medir, vaciar, clave) {
  useEffect(() => {
    const cambio = () => medir();
    const irse = () => {
      medir();
      vaciar(false);
    };
    const latido = setInterval(irse, LATIDO_TELEMETRIA_MS);
    document.addEventListener('visibilitychange', cambio);
    window.addEventListener('focus', cambio);
    window.addEventListener('blur', cambio);
    window.addEventListener('pagehide', irse);
    return () => {
      clearInterval(latido);
      document.removeEventListener('visibilitychange', cambio);
      window.removeEventListener('focus', cambio);
      window.removeEventListener('blur', cambio);
      window.removeEventListener('pagehide', irse);
      medir();
      // Tras el repintado: entonces se sabe si la fila salió de la lista con las comprobaciones a la vista.
      setTimeout(() => vaciar(seCerroEnLaComprobaciones(clave)), 0);
    };
  }, [medir, vaciar, clave]);
}

/**
 * En FilaBloqueo. b: la fila; idLicitacion: su oferta. Devuelve los manejadores del <li>
 * (onFocus/onBlur: la fila desplegada), desplegada para lo que la abre sin foco (la
 * confirmación) y pedirCajon(destino) para cuando su botón abre un cajón.
 */
export default function useTelemetriaTarea({ idLicitacion, b, desplegada = false }) {
  const [enFila, setEnFila] = useState(false);
  const { enCajon, pedirCajon } = useCajonDeLaFila();
  const { medir, vaciar } = useCronometro(
    { id: idLicitacion, clave: b?.clave, tipo: b?.accion?.tipo },
    enFila || desplegada || enCajon,
  );
  useLatido(medir, vaciar, b?.clave);
  const cerrada = tareaCerrada(b?.estado);
  useEffect(() => {
    if (cerrada) {
      medir();
      vaciar(true);
    }
  }, [cerrada, medir, vaciar]);
  const props = {
    onFocus: () => setEnFila(true),
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setEnFila(false);
    },
  };
  return { props, pedirCajon };
}
