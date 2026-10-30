// Lo que se ve cuando aún no hay datos, mientras llegan o cuando algo pide atención: Vacio,
// Esqueleto y Aviso. El icono en caja cuadrada redondeada (estilo de marca) solo va en los vacíos.
import { clases } from '../../lib/uiFormato';

export function Vacio({ Icono, titulo, texto, accion, testid }) {
  return (
    <div data-testid={testid} className="flex flex-col items-center text-center gap-2 px-6 py-10 text-tinta">
      {Icono && (
        <span className="grid place-items-center w-11 h-11 rounded-control bg-superficie-2 text-tinta">
          <Icono size={20} strokeWidth={1.5} aria-hidden="true" />
        </span>
      )}
      {titulo && <h3 className="m-0 text-bloque font-bold">{titulo}</h3>}
      {texto && <p className="m-0 max-w-md text-cuerpo text-tinta-2">{texto}</p>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}

/** Líneas grises mientras carga; `lineas` y `alto` dan su forma aproximada. */
export function Esqueleto({ lineas = 3, alto = 12, etiqueta = 'Cargando…' }) {
  return (
    <div role="status" aria-label={etiqueta} className="grid gap-2.5 py-1">
      {Array.from({ length: lineas }, (_, i) => (
        <span
          key={i}
          className="block rounded bg-superficie-2 animate-pulse"
          style={{ height: alto, width: `${i === lineas - 1 ? 60 : 100}%` }}
        />
      ))}
    </div>
  );
}

const TONOS_AVISO = {
  info: 'bg-superficie-2 border-borde',
  ok: 'bg-accion-suave border-accion-borde',
  aviso: 'bg-riesgo-suave border-riesgo/35',
  error: 'bg-impide-suave border-impide/35',
};

/** tono: info, ok, aviso (riesgo) o error (impide). El error se anuncia (alert); el resto, como estado. */
export function Aviso({ tono = 'info', titulo, testid, children }) {
  return (
    <div
      role={tono === 'error' ? 'alert' : 'status'}
      data-testid={testid}
      data-tono={tono}
      className={clases(
        'px-3 py-2.5 rounded-control border text-tabla leading-normal text-tinta',
        TONOS_AVISO[tono] ?? TONOS_AVISO.info,
      )}
    >
      {titulo && <strong className="block mb-0.5">{titulo}</strong>}
      {children}
    </div>
  );
}
