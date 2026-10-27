// Hook que devuelve la hora actual refrescada cada cierto intervalo, para mostrar tiempos relativos.
import { useEffect, useState } from 'react';

// Hora actual refrescada cada `intervalMs`. El render debe ser puro, así que los
// componentes que muestran tiempos relativos la leen de aquí y no de Date.now().
export default function useAhora(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
