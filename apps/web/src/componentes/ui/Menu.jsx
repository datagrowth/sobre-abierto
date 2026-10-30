// Menú desplegable de acciones («Más»): un botón que abre una lista. Flechas para moverse,
// Escape y pulsar fuera para cerrar, y el foco vuelve al botón.
// opciones: [{ clave, texto, onElegir, peligro?, desactivada? }].
import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { clases } from '../../lib/uiFormato';

export default function Menu({ etiqueta = 'Más', opciones, testid, Icono = MoreHorizontal }) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef(null);
  const boton = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    raiz.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    const fuera = (e) => {
      if (!raiz.current?.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);
  const cerrar = () => {
    setAbierto(false);
    boton.current?.focus();
  };
  const tecla = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...raiz.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div ref={raiz} className="relative inline-block" onKeyDown={tecla}>
      <button
        ref={boton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={id}
        data-testid={testid}
        onClick={() => setAbierto((a) => !a)}
        className="inline-flex items-center gap-1.5 rounded-full border border-borde-control bg-lienzo px-3.5 py-1.5 min-h-8 text-tabla font-medium text-tinta cursor-pointer hover:bg-superficie-2"
      >
        <Icono size={14} strokeWidth={1.5} aria-hidden="true" />
        {etiqueta}
      </button>
      {abierto && (
        <ul
          id={id}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-48 list-none m-0 p-1 bg-lienzo border border-borde rounded-control shadow-capa"
        >
          {opciones.map((o) => (
            <li key={o.clave} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={o.desactivada}
                onClick={() => {
                  cerrar();
                  o.onElegir();
                }}
                className={clases(
                  'w-full text-left px-3 py-2 rounded-control text-tabla bg-transparent border-0 cursor-pointer hover:bg-superficie-2 focus:bg-superficie-2 disabled:opacity-45 disabled:cursor-not-allowed',
                  o.peligro ? 'text-impide' : 'text-tinta',
                )}
              >
                {o.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
