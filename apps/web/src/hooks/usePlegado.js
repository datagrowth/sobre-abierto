// Una caja plegable con memoria: se pliega o despliega y así se queda al recargar. Sin
// almacenamiento (ventana privada, bloqueado) funciona igual, solo que no se recuerda.
import { useState } from 'react';
import { clavePlegado, estadoPlegado } from '../lib/plegado';

function leer(clave) {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardar(clave, plegada) {
  try {
    window.localStorage.setItem(clave, plegada ? '1' : '0');
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

export default function usePlegado(nombre, porDefecto = false) {
  const clave = clavePlegado(nombre);
  const [plegada, setPlegada] = useState(() => estadoPlegado(leer(clave), porDefecto));
  const alternar = () =>
    setPlegada((p) => {
      guardar(clave, !p);
      return !p;
    });
  return [plegada, alternar];
}
