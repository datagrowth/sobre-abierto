// Una cifra de mercado con lo que la respalda: rango, muestra, confianza y fuente.
// Con confianza baja no se enseña la cifra («pocos datos (n = 7)»): la cabecera de la ficha no
// puede dar por buena una baja sacada de siete adjudicaciones. BarraRango dibuja el P25-P75 en
// lavanda, la mediana en tinta, el umbral de anormalidad en rojo discontinuo y nuestro valor en verde.
import { TEXTO_CONFIANZA, clases, escalaRango, posicionEnRango, textoPocosDatos } from '../../lib/uiFormato';

export function Indicador({ titulo, valor, unidad, rango, n, confianza, fuente, ayuda, testid, children }) {
  const pocos = confianza === 'baja';
  return (
    <section
      data-testid={testid}
      data-confianza={confianza}
      className="rounded-tarjeta border border-borde bg-lienzo p-4 grid gap-2 content-start min-w-0"
    >
      <h4 className="m-0 text-tabla font-bold text-tinta">{titulo}</h4>
      {pocos ? (
        <p className="m-0 text-cuerpo text-tinta-2" data-testid={testid ? `${testid}-pocos` : undefined}>
          {textoPocosDatos(n)}
        </p>
      ) : (
        <p className="m-0 text-cifra font-bold leading-none text-tinta tabular-nums">
          {valor}
          {unidad && <small className="text-bloque font-medium text-tinta-2 ml-1.5">{unidad}</small>}
        </p>
      )}
      <p className="m-0 text-leyenda text-tinta-2 flex flex-wrap gap-x-2.5 gap-y-1">
        {!pocos && rango && <span>Rango {rango}</span>}
        {Number.isFinite(n) && <span>n = {n}</span>}
        {confianza && <span>{TEXTO_CONFIANZA[confianza]}</span>}
      </p>
      {!pocos && children}
      {ayuda && <p className="m-0 text-leyenda text-tinta-2">{ayuda}</p>}
      {fuente && <p className="m-0 text-leyenda text-tinta-2">{fuente}</p>}
    </section>
  );
}

const Marca = ({ izquierda, children }) => (
  <span
    className="absolute top-[26px] text-leyenda text-tinta-2 -translate-x-1/2 whitespace-nowrap"
    style={{ left: `${izquierda}%` }}
  >
    {children}
  </span>
);

/** p25, p50, p75, nuestro, umbral: valores en la misma unidad; formato(v) los escribe en las marcas. */
export function BarraRango({
  p25,
  p50,
  p75,
  nuestro = null,
  umbral = null,
  formato = (v) => String(v),
  etiqueta,
  testid,
}) {
  const escala = escalaRango([p25, p50, p75, nuestro, umbral]);
  if (!escala) return null;
  const pos = (v) => posicionEnRango(v, escala.min, escala.max);
  const [a, m, b, nos, um] = [pos(p25), pos(p50), pos(p75), pos(nuestro), pos(umbral)];
  return (
    <div role="img" aria-label={etiqueta} data-testid={testid} className="relative h-[42px] mt-1.5">
      <span className="absolute inset-x-0 top-3 h-2 rounded bg-superficie-2" />
      {a !== null && b !== null && (
        <span
          className="absolute top-3 h-2 rounded bg-hermes"
          style={{ left: `${a}%`, width: `${Math.max(b - a, 0.5)}%` }}
        />
      )}
      {m !== null && (
        <span className="absolute top-1.5 w-[3px] h-5 rounded-sm bg-tinta -translate-x-1/2" style={{ left: `${m}%` }} />
      )}
      {um !== null && (
        <span className="absolute top-1 h-6 border-l-2 border-dashed border-impide" style={{ left: `${um}%` }} />
      )}
      {nos !== null && (
        <span
          className="absolute top-2 w-2.5 h-4 rounded-sm bg-accion outline outline-1 outline-accion-borde -translate-x-1/2"
          style={{ left: `${nos}%` }}
        />
      )}
      {a !== null && <Marca izquierda={a}>{formato(p25)}</Marca>}
      {b !== null && <Marca izquierda={b}>{formato(p75)}</Marca>}
    </div>
  );
}

/** Leyenda de la barra: qué es cada marca. */
export function LeyendaRango({ conUmbral = false, conNuestro = false }) {
  const item = (clase, texto) => (
    <span className="inline-flex items-center gap-1.5">
      <i className={clases('inline-block w-2.5 h-2.5 rounded-[3px]', clase)} />
      {texto}
    </span>
  );
  return (
    <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-leyenda text-tinta-2">
      {item('bg-hermes', 'P25-P75')}
      {item('bg-tinta', 'mediana')}
      {conNuestro && item('bg-accion outline outline-1 outline-accion-borde', 'tu empresa')}
      {conUmbral && item('border-l-2 border-dashed border-impide rounded-none w-0', 'umbral de anormalidad')}
    </p>
  );
}
