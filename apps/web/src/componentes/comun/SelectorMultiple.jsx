// Desplegable con casillas para elegir varias opciones (p. ej. comunidades autónomas).
// Se cierra al pulsar fuera o con Escape (y el foco vuelve al botón, para no perderlo);
// «Quitar todas» deja la selección vacía. Son casillas en un grupo, no una lista de
// opciones: así el lector de pantalla las anuncia como lo que son.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, BORDE_CONTROL, LIENZO, RADIUS, SOMBRA_CAPA } from '../../lib/tema';

export default function SelectorMultiple({ opciones, seleccion, onCambio, resumen, etiqueta }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  const boton = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    };
    const tecla = (e) => {
      if (e.key !== 'Escape') return;
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);
  const alternar = (k) => onCambio(seleccion.includes(k) ? seleccion.filter((x) => x !== k) : [...seleccion, k]);
  return (
    <div ref={caja} style={{ position: 'relative', maxWidth: 420 }}>
      <button
        ref={boton}
        type="button"
        className="input-field"
        aria-expanded={abierto}
        aria-label={`${etiqueta}: ${resumen}`}
        onClick={() => setAbierto((a) => !a)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: TINTA }}>
          {resumen}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          style={{ flex: '0 0 16px', color: TINTA_2, transform: abierto ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {abierto && (
        <div
          role="group"
          aria-label={etiqueta}
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 320,
            overflowY: 'auto',
            background: LIENZO,
            border: `1px solid ${BORDE_CONTROL}`,
            borderRadius: RADIUS,
            padding: 6,
            boxShadow: SOMBRA_CAPA,
          }}
        >
          {opciones.map(([k, label]) => (
            <label
              key={k}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '5px 6px',
                fontSize: 12.5,
                color: TINTA,
                cursor: 'pointer',
                borderRadius: 6,
              }}
            >
              <input type="checkbox" checked={seleccion.includes(k)} onChange={() => alternar(k)} />
              {label}
            </label>
          ))}
          <div
            style={{
              borderTop: `1px solid ${BORDE}`,
              marginTop: 4,
              paddingTop: 6,
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={() => onCambio([])}
              disabled={!seleccion.length}
              style={{
                background: 'transparent',
                border: 'none',
                color: TINTA_2,
                fontSize: 12,
                cursor: seleccion.length ? 'pointer' : 'default',
              }}
            >
              Quitar todas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
