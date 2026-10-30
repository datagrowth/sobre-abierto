// Las dos piezas que se repiten en Aprendizaje: el resumen de una comparación con su barra apilada
// por tipo de cambio y el efecto oferta a oferta (puntos de la mesa frente al ganador, con un
// cuadrado verde donde se habían aceptado lecciones nuevas). Colores de los tokens: nada fuera de tema.js.
import { resumenComparacion, TIPOS_CAMBIO, tramosComparacion } from '../../lib/aprendizajeFormato';
import { Tarjeta } from '../ui';

const COLOR_TIPO = {
  especificidad: 'bg-tinta',
  estructura: 'bg-tinta-2',
  recorte: 'bg-hermes',
  correccion_dato: 'bg-borde-control',
  compromiso: 'bg-accion',
  cumplimiento: 'bg-ok',
  estilo: 'bg-superficie-2',
  sin_clasificar: 'bg-borde',
};

export function BarraComparacion({ resumen }) {
  const tramos = tramosComparacion(resumen);
  if (!tramos.length) return null;
  return (
    <div
      className="flex h-2.5 rounded-full overflow-hidden my-2 bg-superficie-2"
      role="img"
      aria-label={resumenComparacion(resumen)}
    >
      {tramos.map((t) => (
        <b
          key={t.tipo}
          title={`${t.n} ${TIPOS_CAMBIO[t.tipo]}`}
          className={COLOR_TIPO[t.tipo] ?? 'bg-borde'}
          style={{ width: `${t.pct}%` }}
        />
      ))}
    </div>
  );
}

export function UltimaComparacion({ c }) {
  if (!c) return null;
  return (
    <Tarjeta titulo="Última comparación" subtitulo={c.titulo ?? c.licitacion_id} testid="ultima-comparacion">
      <p className="text-cuerpo text-tinta m-0 tabular-nums">
        {c.resumen.total} cambios entre la memoria de Hermes y la presentada
      </p>
      <BarraComparacion resumen={c.resumen} />
      <p className="text-leyenda text-tinta-2 m-0 tabular-nums">
        {resumenComparacion(c.resumen).replace(/^[^:]*: /, '')}
      </p>
    </Tarjeta>
  );
}

const TOPE_PCT = 120;

export function GraficoEfecto({ efecto, testid = 'grafico-efecto' }) {
  const { ofertas } = efecto;
  return (
    <Tarjeta titulo="Puntos de juicio de valor frente al ganador" subtitulo="%" testid={testid}>
      {ofertas.length === 0 ? (
        <p className="text-tabla text-tinta-2 m-0">
          Aún no hay actas con los puntos del ganador: el gráfico sale con la primera.
        </p>
      ) : (
        <>
          <div
            className="flex items-end gap-2 h-36 pt-6"
            role="img"
            aria-label={ofertas.map((o, i) => `Oferta ${i + 1}: ${o.pct} %`).join(', ')}
          >
            {ofertas.map((o) => (
              <div
                key={`${o.titulo}-${o.fecha}`}
                title={`${o.titulo}: ${o.pct} %`}
                className="relative flex-1 min-w-3 max-w-12 rounded-t bg-tinta-2"
                style={{ height: `${(Math.min(o.pct, TOPE_PCT) / TOPE_PCT) * 100}%` }}
              >
                <span className="absolute -top-5 inset-x-0 text-center text-leyenda text-tinta tabular-nums">
                  {o.pct}
                </span>
                {o.nuevas_lecciones && (
                  <em
                    data-testid="marca-lecciones"
                    className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-2 h-2 rounded-[2px] bg-accion"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4 text-leyenda text-tinta-2 tabular-nums">
            {ofertas.map((o, i) => (
              <span key={`${o.titulo}-${o.fecha}`} className="flex-1 min-w-3 max-w-12 text-center">
                {i + 1}
              </span>
            ))}
          </div>
        </>
      )}
      <p className="text-leyenda text-tinta-2 mt-2 mb-0">
        Ofertas en orden de presentación. Los cuadrados verdes marcan cuándo se aceptaron lecciones. {efecto.nota} (n ={' '}
        {ofertas.length}).
      </p>
    </Tarjeta>
  );
}
