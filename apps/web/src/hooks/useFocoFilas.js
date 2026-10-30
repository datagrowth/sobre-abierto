// Los enlaces que llevan a una fila de la oferta (#bloqueo=clave, desde la cabecera, la Mesa o el
// MCP) o a una pieza (#testid=…, p. ej. «Registrar»): llevan allí una sola vez, cuando llega lo que
// se pinta; las recargas posteriores no mueven a la persona de donde está.
import { useEffect, useRef, useState } from 'react';
import { destinoFoco } from '../lib/comprobacionesFormato';
import { bloqueo as testidBloqueo } from '../lib/idsPrueba';

const RESALTE_MS = 2000;

/** clave: la fila pedida; filas: las que se pintan; lista: ya llegaron. La fila queda resaltada RESALTE_MS. */
export function useFocoBloqueo(clave, filas, lista) {
  const [destino, setDestino] = useState(null);
  if (!destino && lista && clave) {
    const d = destinoFoco(filas, clave);
    setDestino({ ...d, resaltada: d.clave });
  }
  const objetivo = destino?.clave ?? null;
  useEffect(() => {
    if (!objetivo) return undefined;
    const el = document.querySelector(`[data-testid="${CSS.escape(testidBloqueo(objetivo))}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
    const t = setTimeout(() => setDestino((p) => ({ ...p, resaltada: null })), RESALTE_MS);
    return () => clearTimeout(t);
  }, [objetivo]);
  return { resaltada: destino?.resaltada ?? null, resuelta: Boolean(destino?.resuelta) };
}

/** testid: la pieza pedida; listo: ya está pintada. */
export function useFocoPieza(testid, listo) {
  const hecho = useRef(false);
  useEffect(() => {
    if (!testid || !listo || hecho.current) return;
    const el = document.querySelector(`[data-testid="${CSS.escape(testid)}"]`);
    if (!el) return;
    hecho.current = true;
    el.scrollIntoView({ block: 'center' });
    el.focus();
  }, [testid, listo]);
}
