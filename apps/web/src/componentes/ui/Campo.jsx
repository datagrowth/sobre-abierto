// Un dato de formulario: su etiqueta, el control, la ayuda y el error, enlazados para el lector
// de pantalla. `grupo`: varios controles dentro (no un <label>, que solo puede envolver uno).
// Acepta `label` y `ayuda` como antes. Entrada y Selector son los controles con el estilo común.
import { cloneElement, isValidElement, useId } from 'react';
import { clases } from '../../lib/uiFormato';

const CONTROL =
  'w-full bg-lienzo border border-borde-control rounded-control px-3 py-2 text-tabla text-tinta placeholder:text-tinta-2 focus:border-tinta focus:outline-none focus:ring-3 focus:ring-accion-suave';

export function Entrada({ invalido = false, className, ...props }) {
  return (
    <input
      className={clases(CONTROL, invalido && 'border-impide', className)}
      aria-invalid={invalido || undefined}
      {...props}
    />
  );
}

export function AreaTexto({ invalido = false, className, ...props }) {
  return (
    <textarea
      className={clases(CONTROL, 'resize-y leading-normal', invalido && 'border-impide', className)}
      aria-invalid={invalido || undefined}
      {...props}
    />
  );
}

/** opciones: [{ valor, texto }] o los <option> como children. */
export function Selector({ opciones, children, className, ...props }) {
  return (
    <select className={clases(CONTROL, 'pr-8 cursor-pointer', className)} {...props}>
      {opciones
        ? opciones.map((o) => (
            <option key={o.valor} value={o.valor} disabled={o.desactivada}>
              {o.texto}
            </option>
          ))
        : children}
    </select>
  );
}

export default function Campo({ etiqueta, label, ayuda, error, grupo = false, children }) {
  const id = useId();
  const titulo = etiqueta ?? label;
  const describe = [ayuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  // Un solo control: se le enlazan la ayuda y el error sin que quien lo usa tenga que pasarlos.
  const control =
    !grupo && isValidElement(children) ? cloneElement(children, { 'aria-describedby': describe }) : children;
  const Envoltorio = grupo ? 'div' : 'label';
  return (
    <Envoltorio
      role={grupo ? 'group' : undefined}
      aria-label={grupo ? titulo : undefined}
      aria-describedby={grupo ? describe : undefined}
      className="block mb-3"
    >
      <span className="block text-tabla font-bold text-tinta mb-1">{titulo}</span>
      {control}
      {ayuda && (
        <span id={`${id}-ayuda`} className="block text-leyenda text-tinta-2 mt-1">
          {ayuda}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="block text-leyenda text-impide mt-1">
          {error}
        </span>
      )}
    </Envoltorio>
  );
}
