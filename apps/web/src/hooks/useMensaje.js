// Mensaje breve tras una acción («Sincronizando…», un error): se borra solo para que no
// quede en pantalla un texto que ya no es verdad. Los errores duran algo más.
import { useCallback, useEffect, useRef, useState } from 'react';

const DURACION = { ok: 6000, error: 12000 };

export default function useMensaje() {
  const [mensaje, setMensaje] = useState(null);
  const temporizador = useRef(null);

  const mostrar = useCallback((texto, tono = 'ok') => {
    clearTimeout(temporizador.current);
    setMensaje({ texto, tono });
    temporizador.current = setTimeout(() => setMensaje(null), DURACION[tono] ?? DURACION.ok);
  }, []);

  useEffect(() => () => clearTimeout(temporizador.current), []);
  return { mensaje, mostrar, limpiar: () => setMensaje(null) };
}
