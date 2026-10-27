// Tabla de la interfaz: cabecera fija en el claro, orden por columna (aria-sort) y dos
// densidades: compacta (filas de 36 px, para listas) y cómoda (para leer). Las filas se pueden
// apagar (texto en gris, sin quitar contraste: lo que Hermes descarta) o marcar como seleccionadas (verde suave).
// columnas: [{ clave, titulo, valor?(fila), celda?(fila), alinear?, ordenable?, ancho?, nitida? }];
// `nitida`: la columna no se apaga (las acciones de una fila apagada se siguen leyendo).
import { ArrowDown, ArrowUp } from 'lucide-react';
import { ariaOrden, clases, ordenarFilas, siguienteOrden } from '../../lib/uiFormato';

const valorDe = (c) => c.valor ?? ((f) => f[c.clave]);

function Cabecera({ c, orden, onOrden }) {
  const sort = ariaOrden(orden, c.clave);
  const alinear = c.alinear === 'derecha' ? 'text-right' : 'text-left';
  return (
    <th
      scope="col"
      aria-sort={c.ordenable ? sort : undefined}
      style={c.ancho ? { width: c.ancho } : undefined}
      className={clases(
        'sticky top-0 z-[1] bg-superficie-2 border-b border-borde px-2.5 py-2 text-leyenda font-bold text-tinta-2 whitespace-nowrap',
        alinear,
      )}
    >
      {c.ordenable && onOrden ? (
        <button
          type="button"
          onClick={() => onOrden(siguienteOrden(orden, c.clave))}
          className="inline-flex items-center gap-1 font-bold text-tinta-2 cursor-pointer bg-transparent border-0 p-0"
        >
          {c.titulo}
          {sort === 'ascending' && <ArrowUp size={12} aria-hidden="true" />}
          {sort === 'descending' && <ArrowDown size={12} aria-hidden="true" />}
        </button>
      ) : (
        c.titulo
      )}
    </th>
  );
}

export default function Tabla({
  columnas,
  filas,
  claveFila = (f) => f.id,
  orden = null,
  onOrden,
  densidad = 'compacta',
  seleccionada = null,
  apagada = () => false,
  onFila,
  vacio = 'No hay filas que mostrar.',
  etiqueta,
  testid,
  alto,
}) {
  const col = columnas.find((c) => c.clave === orden?.clave);
  const vistas = col ? ordenarFilas(filas, valorDe(col), orden.sentido) : filas;
  const celda = densidad === 'compacta' ? 'px-2.5 py-2 h-9' : 'px-2.5 py-3';
  return (
    <div
      data-testid={testid}
      className="border border-borde rounded-tarjeta overflow-auto"
      style={alto ? { maxHeight: alto } : undefined}
    >
      <table aria-label={etiqueta} className="w-full border-collapse text-tabla text-tinta">
        <thead>
          <tr>
            {columnas.map((c) => (
              <Cabecera key={c.clave} c={c} orden={orden} onOrden={onOrden} />
            ))}
          </tr>
        </thead>
        <tbody>
          {vistas.length === 0 && (
            <tr>
              <td colSpan={columnas.length} className="px-2.5 py-4 text-tinta-2">
                {vacio}
              </td>
            </tr>
          )}
          {vistas.map((f) => {
            const k = claveFila(f);
            return (
              <tr
                key={k}
                data-fila={k}
                aria-selected={seleccionada === k || undefined}
                onClick={onFila ? () => onFila(f) : undefined}
                data-apagada={apagada(f) || undefined}
                className={clases(
                  'border-t border-borde first:border-t-0',
                  onFila && 'cursor-pointer hover:bg-superficie-2',
                  seleccionada === k && 'bg-accion-suave',
                )}
              >
                {columnas.map((c) => (
                  <td
                    key={c.clave}
                    className={clases(
                      celda,
                      'align-top',
                      c.alinear === 'derecha' && 'text-right tabular-nums',
                      apagada(f) && !c.nitida && 'text-tinta-2',
                    )}
                  >
                    {c.celda ? c.celda(f) : valorDe(c)(f)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
