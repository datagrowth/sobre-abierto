// Acciones de cabecera de un dominio: cuál está en marcha y el mensaje con su resultado.
import { useState } from 'react';
import useMensaje from './useMensaje';

export default function useAcciones(alTerminar) {
  const { mensaje, mostrar } = useMensaje();
  const [enMarcha, setEnMarcha] = useState(null);
  const ejecutar = async (clave, fn, textoOk) => {
    setEnMarcha(clave);
    try {
      await fn();
      mostrar(textoOk);
      alTerminar?.();
    } catch (e) {
      mostrar(e.message, 'error');
    } finally {
      setEnMarcha(null);
    }
  };
  return { mensaje, enMarcha, ejecutar };
}
