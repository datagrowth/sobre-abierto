// Estado de un dominio (ingesta, Hermes, alertas) y una «versión» que sube con sus eventos
// de la plataforma y al reconectar el socket, para que listas y fichas se recarguen solas.
// Se refresca cada 30 s. `errorEstado`: el último fallo al leer el estado (null si fue bien).
import { useCallback, useEffect, useState } from 'react';

export default function useEstadoDominio(leerEstado, prefijoEventos) {
  const [estado, setEstado] = useState(null);
  const [errorEstado, setErrorEstado] = useState(null);
  const [version, setVersion] = useState(0);
  const cargarEstado = useCallback(
    () =>
      leerEstado().then(
        (e) => {
          setEstado(e);
          setErrorEstado(null);
        },
        (e) => setErrorEstado(e?.message ?? 'No se pudo leer el estado.'),
      ),
    [leerEstado],
  );
  useEffect(() => {
    cargarEstado();
    const iv = setInterval(cargarEstado, 30_000);
    const subir = () => {
      setVersion((v) => v + 1);
      cargarEstado();
    };
    const alEvento = (e) => {
      if (String(e.detail?.tipo ?? '').startsWith(prefijoEventos)) subir();
    };
    window.addEventListener('plataforma', alEvento);
    window.addEventListener('plataforma-reconectado', subir);
    return () => {
      clearInterval(iv);
      window.removeEventListener('plataforma', alEvento);
      window.removeEventListener('plataforma-reconectado', subir);
    };
  }, [cargarEstado, prefijoEventos]);
  return { estado, version, cargarEstado, errorEstado };
}
