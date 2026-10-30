// Una acción de la preparación de la oferta con su aviso (info o error) y si está en marcha.
// Tras un error también se recarga: puede que otra persona ya lo hubiera pedido. `texto`
// puede ser una función de la respuesta («Hermes rehace los apartados 2 y 4 en la v3»).
import { useState } from 'react';

export default function useAccionAviso(onCambio) {
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const hacer = async (fn, texto) => {
    setOcupado(true);
    try {
      const r = await fn();
      setAviso({ tono: 'info', texto: typeof texto === 'function' ? texto(r) : texto });
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setOcupado(false);
    }
    onCambio();
  };
  return [aviso, hacer, ocupado];
}
