// Pestañas accesibles (flechas, Inicio y Fin; solo la abierta entra con Tab), subrayadas en tinta
// la abierta. En pantallas estrechas y con más de tres, un desplegable.
// vistas: [{ key, label, cuenta? }]; `prefijo` da los data-testid («ficha-pestana-comprobaciones»).
import { useRef } from 'react';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { opcionFuera, pestanaEnfocable } from '../../lib/pestanas';
import { clases } from '../../lib/uiFormato';
import { Selector } from './Campo';

function Desplegable({ vistas, vista, onVista, etiqueta }) {
  const fuera = opcionFuera(vistas, vista);
  return (
    <Selector aria-label={etiqueta} value={fuera ? fuera.key : vista} onChange={(e) => onVista(e.target.value)}>
      {fuera && (
        <option value={fuera.key} disabled>
          {fuera.label}
        </option>
      )}
      {vistas.map((v) => (
        <option key={v.key} value={v.key}>
          {v.label}
          {typeof v.cuenta === 'number' && v.cuenta > 0 ? ` (${v.cuenta})` : ''}
        </option>
      ))}
    </Selector>
  );
}

export default function Pestanas({ vistas, vista, onVista, etiqueta, prefijo = 'pestana' }) {
  const { isSmall } = useAnchoPantalla();
  const refs = useRef({});
  const enfocable = pestanaEnfocable(vistas, vista);
  if (isSmall && vistas.length > 3)
    return <Desplegable vistas={vistas} vista={vista} onVista={onVista} etiqueta={etiqueta} />;
  const mover = (e, i) => {
    const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: vistas.length - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    const v = vistas[(destino + vistas.length) % vistas.length];
    onVista(v.key);
    refs.current[v.key]?.focus();
  };
  return (
    <div role="tablist" aria-label={etiqueta} className="flex flex-wrap gap-1 border-b border-borde">
      {vistas.map((v, i) => {
        const activa = v.key === vista;
        return (
          <button
            key={v.key}
            ref={(el) => {
              refs.current[v.key] = el;
            }}
            type="button"
            role="tab"
            aria-selected={activa}
            data-testid={`${prefijo}-${v.key}`}
            data-estado={activa ? 'activa' : 'inactiva'}
            tabIndex={v.key === enfocable ? 0 : -1}
            onClick={() => onVista(v.key)}
            onKeyDown={(e) => mover(e, i)}
            className={clases(
              '-mb-px min-h-9 px-3 py-2 text-cuerpo cursor-pointer bg-transparent border-0 border-b-2',
              activa
                ? 'text-tinta font-bold border-tinta'
                : 'text-tinta-2 font-medium border-transparent hover:text-tinta',
            )}
          >
            {v.label}
            {typeof v.cuenta === 'number' && v.cuenta > 0 && (
              <span className="ml-1.5 text-leyenda font-medium text-tinta-2">{v.cuenta}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
