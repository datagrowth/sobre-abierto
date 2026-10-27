// Cajón y Diálogo: lo que flota por encima (con sombra, la única de la interfaz). Los dos
// llevan el foco dentro al abrirse, se cierran con Escape y lo devuelven a quien los abrió. El
// cajón entra por la derecha (en el móvil, a pantalla completa); el diálogo va centrado, con velo.
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { VELO } from '../../lib/tema';

// onCerrar va en una ref: quien abre la capa suele pasar una función nueva en cada render, y
// volver a correr el efecto le quitaría el foco a lo que se está escribiendo.
function useFocoDentro(abierto, onCerrar) {
  const caja = useRef(null);
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  });
  useEffect(() => {
    if (!abierto) return undefined;
    const previo = document.activeElement;
    caja.current?.focus();
    const tecla = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cerrar.current();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
      previo?.focus?.();
    };
  }, [abierto]);
  return caja;
}

function Cerrar({ titulo, onCerrar }) {
  return (
    <button
      type="button"
      data-testid="capa-cerrar"
      aria-label={`Cerrar ${titulo}`}
      onClick={onCerrar}
      className="inline-flex p-1.5 rounded-control border border-borde bg-lienzo text-tinta-2 cursor-pointer hover:bg-superficie-2"
    >
      <X size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

/** Cajón lateral: `pie` lleva las acciones (un solo botón principal). */
export function Cajon({ abierto, titulo, onCerrar, pie, ancho = 560, testid, children }) {
  const id = useId();
  const caja = useFocoDentro(abierto, onCerrar);
  if (!abierto) return null;
  return (
    <aside
      ref={caja}
      role="dialog"
      aria-modal="false"
      aria-labelledby={id}
      tabIndex={-1}
      data-testid={testid}
      className="fixed inset-y-0 right-0 left-0 md:left-auto z-40 flex flex-col bg-lienzo md:border-l border-borde shadow-capa outline-none"
      style={{ width: `min(${ancho}px, 100vw)` }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-borde">
        <h2 id={id} className="m-0 flex-1 min-w-0 text-bloque font-bold text-tinta">
          {titulo}
        </h2>
        <Cerrar titulo={titulo} onCerrar={onCerrar} />
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
      {pie && <div className="flex gap-2 flex-wrap px-4 py-3 border-t border-borde">{pie}</div>}
    </aside>
  );
}

/** Diálogo modal con velo: lo que pide una decisión antes de seguir. */
export function Dialogo({ abierto, titulo, onCerrar, acciones, ancho = 480, testid, children }) {
  const id = useId();
  const caja = useFocoDentro(abierto, onCerrar);
  if (!abierto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: VELO }}
      onClick={onCerrar}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-testid={testid}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-lienzo rounded-tarjeta border border-borde shadow-capa outline-none"
        style={{ maxWidth: ancho }}
      >
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 id={id} className="m-0 flex-1 text-bloque font-bold text-tinta">
            {titulo}
          </h2>
          <Cerrar titulo={titulo} onCerrar={onCerrar} />
        </div>
        <div className="px-4 py-3 text-cuerpo text-tinta">{children}</div>
        {acciones && <div className="flex gap-2 justify-end flex-wrap px-4 pb-4">{acciones}</div>}
      </div>
    </div>
  );
}
