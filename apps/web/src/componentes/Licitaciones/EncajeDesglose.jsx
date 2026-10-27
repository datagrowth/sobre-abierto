// «Encaje · cómo sale»: el número con su desglose, nunca solo. La elegibilidad
// cierra (no pesa); cada componente, con su peso, su barra y de dónde sale. La temática la da
// Hermes (barra lavanda); el resto lo calcula el código. Un componente sin datos no cuenta.
import { filasEncaje, textoEncaje } from '../../lib/encajeFormato';
import { clases } from '../../lib/uiFormato';
import { Chip, Tarjeta } from '../ui';

function Barra({ valor, deHermes }) {
  return (
    <span className="block h-2 rounded-full bg-superficie-2 overflow-hidden" aria-hidden="true">
      <span
        className={clases('block h-full rounded-full', deHermes ? 'bg-hermes' : 'bg-accion')}
        style={{ width: `${valor}%` }}
      />
    </span>
  );
}

export default function EncajeDesglose({ encaje }) {
  if (!encaje) return null;
  return (
    <Tarjeta titulo={textoEncaje(encaje) ?? 'Encaje: faltan datos'} subtitulo="cómo sale" testid="encaje-desglose">
      <div className="grid gap-2 text-tabla text-tinta">
        {filasEncaje(encaje).map((f) => (
          <div
            key={f.clave}
            className="grid items-center gap-x-3 gap-y-0.5"
            style={{ gridTemplateColumns: 'minmax(120px, 1.2fr) 48px minmax(80px, 2fr) 32px' }}
            title={f.detalle ?? undefined}
          >
            <span>{f.etiqueta}</span>
            <small className="text-leyenda text-tinta-2 tabular-nums">{f.peso}</small>
            {f.chip ? (
              <span>
                <Chip tono={f.chip.tono}>{f.chip.texto}</Chip>
              </span>
            ) : (
              <Barra valor={f.valor} deHermes={f.de_hermes} />
            )}
            <b className="text-right tabular-nums">{f.valor ?? ''}</b>
            {f.detalle && (
              <small className="text-leyenda text-tinta-2" style={{ gridColumn: '1 / -1' }}>
                {f.detalle}
              </small>
            )}
          </div>
        ))}
      </div>
      <p className="m-0 mt-3 text-leyenda text-tinta-2">
        La temática la da Hermes (barra lavanda); el resto lo calcula el código. Lo que no tiene datos no cuenta.
      </p>
    </Tarjeta>
  );
}
