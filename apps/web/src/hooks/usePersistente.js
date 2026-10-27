// Estado que se recuerda mientras dura la sesión del navegador (p. ej. los filtros de una
// lista al ir a otra sección y volver). Sin almacenamiento disponible, funciona como useState.
import { useEffect, useState } from 'react';

function leer(clave, inicial) {
  try {
    const guardado = window.sessionStorage.getItem(clave);
    return guardado === null ? inicial : JSON.parse(guardado);
  } catch {
    return inicial;
  }
}

export default function usePersistente(clave, inicial) {
  const [valor, setValor] = useState(() => leer(`dg.${clave}`, inicial));
  useEffect(() => {
    try {
      window.sessionStorage.setItem(`dg.${clave}`, JSON.stringify(valor));
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
  }, [clave, valor]);
  return [valor, setValor];
}

/** Deja un valor para cuando se monte quien lo lee (p. ej. abrir Oportunidades con una búsqueda guardada). */
export function dejarPersistente(clave, valor) {
  try {
    window.sessionStorage.setItem(`dg.${clave}`, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento: se abre sin ella */
  }
}
