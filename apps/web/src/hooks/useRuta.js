// La ruta actual (#/seccion/vista/id) y cómo ir a otra. Cada navegación entra en el
// historial, así que Atrás del navegador (y del móvil) vuelve a la vista anterior. Lo que cambia
// la ruta sin pasar por la web (Atrás, Adelante, un enlace «#…») también pregunta antes si las
// comprobaciones tienen cambios sin guardar: se vuelve a poner la ruta de antes como una entrada
// nueva del historial y, si la persona sale, se vuelve atrás a la que pidió (así Atrás sigue
// llevando a donde llevaba).
import { useCallback, useSyncExternalStore } from 'react';
import { leerRuta, rutaA } from '../lib/rutas';
import { decidirHash } from '../lib/guardiaRuta';
import { hayGuardia, salirCon } from './useCambiosSinGuardar';

// La ruta que la web dio por buena: la de ir() o una que ya pasó la guardia.
let aceptado = typeof window === 'undefined' ? '' : window.location.hash;

// Cada componente con useRuta escucha el evento: el primero que lo ve vuelve atrás y pregunta;
// los demás ya ven la ruta de antes y no cambian nada.
function rutaPermitida() {
  const nuevo = window.location.hash;
  if (decidirHash({ nuevo, aceptado, conGuardia: hayGuardia() }) === 'aceptar') {
    aceptado = nuevo;
    return true;
  }
  window.history.pushState(null, '', aceptado);
  salirCon(() => {
    aceptado = nuevo;
    window.history.back();
  });
  return false;
}

function suscribir(avisar) {
  const alCambiar = () => {
    if (rutaPermitida()) avisar();
  };
  window.addEventListener('hashchange', alCambiar);
  return () => window.removeEventListener('hashchange', alCambiar);
}

const hashActual = () => window.location.hash;

/** Va a un hash ya armado (rutaComprobaciones…) como ir(): lo que pide la web y ya pasó por salirCon no vuelve a preguntar. */
export function irAHash(destino) {
  if (destino === window.location.hash) return;
  aceptado = destino;
  window.location.hash = destino;
}

/** Navega a { seccion, vista, id }; con `reemplazar`, sin dejar rastro en el historial. */
export function ir(seccion, vista = null, id = null, { reemplazar = false } = {}) {
  const destino = rutaA({ seccion, vista, id });
  if (destino === window.location.hash) return;
  // Lo que navega por la web ya preguntó si hacía falta (salirCon): no se vuelve a preguntar.
  aceptado = destino;
  if (reemplazar) {
    window.history.replaceState(null, '', destino);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = destino;
  }
}

export default function useRuta() {
  const hash = useSyncExternalStore(suscribir, hashActual);
  const ruta = leerRuta(hash);
  // Cambiar de vista dentro de la misma sección.
  const irVista = useCallback((vista, id = null) => ir(ruta.seccion, vista, id), [ruta.seccion]);
  return { ...ruta, ir, irVista };
}
