// Bloque «Lotes» del detalle: regla de presentación (de la PLACSP o confirmada en el
// pliego), contra qué se evalúan requisitos y precios (lotes de interés o total) y cada
// lote con su importe y CPV, si encajó en el prefiltro y si la criba lo eligió (y por qué).
// Una persona puede cambiar a qué lotes vamos: pasan a ser los de interés.
import { useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, alpha } from '../../lib/tema';
import { euros } from '../../lib/formato';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { textoLotesGuardados, textoPresentacion } from '../../lib/licitacionesFormato';
import useGuardarConImpacto from '../../hooks/useGuardarConImpacto';
import { useCambiosSinGuardar } from '../../hooks/useCambiosSinGuardar';
import { puedeMarcar, textoMaximoLotes } from '../../lib/lotesEleccion';
import { PanelImpacto } from './Oferta/QueCambia';
import { Aviso, Boton, Chip } from '../ui';
import { Bloque } from '../comun/ui';

const celda = { padding: '5px 8px', textAlign: 'left', verticalAlign: 'top' };
const numero = { ...celda, textAlign: 'right', whiteSpace: 'nowrap' };

function FilaLote({ l, eleccion }) {
  return (
    <tr style={{ borderTop: `1px solid ${BORDE}`, background: l.interes ? alpha(ACCION, 0.06) : 'transparent' }}>
      {eleccion && (
        <td style={celda}>
          <input
            type="checkbox"
            checked={eleccion.elegidos.includes(l.id)}
            onChange={() => eleccion.alternar(l.id)}
            aria-label={`Vamos al lote ${l.id}`}
          />
        </td>
      )}
      <th scope="row" style={{ ...celda, fontWeight: 600 }}>
        {l.id}
      </th>
      <td style={{ ...celda, minWidth: 160 }}>
        {l.nombre ?? '—'}
        {l.motivo_interes && <div style={{ fontSize: 11.5, color: TINTA_2, marginTop: 2 }}>{l.motivo_interes}</div>}
      </td>
      <td className="tabular-nums" style={numero}>
        {euros(l.presupuesto_sin_iva)}
      </td>
      <td style={celda}>{l.cpvs.join(', ') || '—'}</td>
      <td style={celda}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {l.interes && (
            <Chip tono="ok" punto={false}>
              de interés
            </Chip>
          )}
          {l.prefiltro && <Chip>prefiltro</Chip>}
        </div>
      </td>
    </tr>
  );
}

function Regla({ presentacion, ambito }) {
  return (
    <div style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.5 }}>
      <div>
        <strong>Presentación:</strong> {textoPresentacion(presentacion)}
      </div>
      {presentacion?.combinacion && <div style={{ fontSize: 12, color: TINTA_2 }}>{presentacion.combinacion}</div>}
      {ambito && (
        <div>
          <strong>Requisitos, precios y equipo para:</strong> {ambito.descripcion}
          {typeof ambito.importe === 'number' && ` · ${euros(ambito.importe)}`}
        </div>
      )}
      {ambito?.error && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="error">{ambito.error}</Aviso>
        </div>
      )}
      {ambito?.aviso && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="aviso">{ambito.aviso}</Aviso>
        </div>
      )}
      {presentacion?.sin_confirmar && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono="aviso">
            La PLACSP no publica a cuántos lotes se puede presentar: la ficha lo confirmará con el pliego.
          </Aviso>
        </div>
      )}
    </div>
  );
}

const deInteres = (lotes) => lotes.filter((l) => l.interes).map((l) => l.id);

// La elección en curso y si difiere de los lotes de interés guardados. Va unida a los guardados
// con los que empezó: si cambian (al guardar o por un evento de otra persona), vuelve a ellos sin
// montar el componente otra vez, que se llevaría el aviso de «Guardar lotes».
function useEleccion(lotes, maximo) {
  const guardados = deInteres(lotes);
  const clave = guardados.join();
  const [eleccion, setEleccion] = useState(() => ({ clave, elegidos: guardados, limite: false }));
  const elegidos = eleccion.clave === clave ? eleccion.elegidos : guardados;
  const alternar = (id) => {
    if (!puedeMarcar(elegidos, id, maximo)) {
      setEleccion({ clave, elegidos, limite: true });
      return;
    }
    setEleccion({
      clave,
      limite: false,
      elegidos: elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id],
    });
  };
  const cambiada = elegidos.length !== guardados.length || elegidos.some((x) => !guardados.includes(x));
  return { elegidos, guardados, alternar, cambiada, limite: eleccion.clave === clave && eleccion.limite };
}

// Guardar pasa antes por «Qué cambia»: al quitar un lote enseña lo que se poda y al añadir uno el
// servidor dice cuánto tarda en rehacer la ficha y el guion; ese texto sustituye al «Guardado.» genérico.
function GuardarEleccion({ id, eleccion, onCambio }) {
  const [aviso, setAviso] = useState(null);
  // El cambio que se guarda es el mismo que mide «Qué cambia» y el que nombra los apartados a rehacer.
  const [cambio, setCambio] = useState(null);
  const pendiente = useRef([]);
  const escribir = async () => {
    const r = await licitacionesApi.elegirLotes(id, pendiente.current);
    setAviso({ tono: 'info', texto: textoLotesGuardados(r) });
    onCambio?.();
  };
  const impacto = useGuardarConImpacto(id, { guardar: escribir });
  const guardar = () => {
    setAviso(null);
    pendiente.current = eleccion.elegidos;
    const nuevo = { lotes: eleccion.elegidos };
    setCambio(nuevo);
    impacto.iniciar(nuevo);
  };
  return (
    <div style={{ marginTop: 8 }}>
      {eleccion.limite && eleccion.maximo && (
        <div data-testid="lotes-maximo">
          <Aviso tono="aviso">{textoMaximoLotes(eleccion.maximo)}</Aviso>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        {eleccion.cambiada && (
          <Boton
            Icono={Save}
            variante="principal"
            cargando={impacto.ocupado}
            disabled={!eleccion.elegidos.length || impacto.estado.fase === 'panel'}
            title={eleccion.elegidos.length ? undefined : 'Elige al menos un lote'}
            onClick={guardar}
            testid="lotes-guardar"
            escribe
          >
            Guardar lotes a los que vamos
          </Boton>
        )}
        {aviso && (
          <div data-testid="lotes-aviso">
            <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
          </div>
        )}
      </div>
      <PanelImpacto
        g={{ ...impacto, aviso: null }}
        conMarcar={false}
        textoRehacer="Guardar lotes"
        id={id}
        cambio={cambio}
      />
    </div>
  );
}

// Sin `id` (o si hay que ir a todos los lotes), solo se leen.
export default function LotesLicitacion({ id, lotes = [], presentacion, ambito, onCambio }) {
  const maximo = presentacion?.maximo_lotes ?? presentacion?.maximo;
  const eleccion = { ...useEleccion(lotes, maximo), maximo };
  // En las comprobaciones, salir o cambiar de cajón con lotes sin guardar pide confirmación.
  useCambiosSinGuardar('lotes', eleccion.cambiada);
  if (!lotes.length) return null;
  const editable = Boolean(id) && presentacion?.codigo !== '2';
  return (
    <Bloque titulo={`LOTES (${lotes.length})`}>
      <Regla presentacion={presentacion} ambito={ambito} />
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', fontSize: 12, color: TINTA, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: TINTA_2 }}>
              {editable && (
                <th scope="col" style={celda}>
                  Vamos
                </th>
              )}
              <th scope="col" style={celda}>
                Lote
              </th>
              <th scope="col" style={celda}>
                Nombre
              </th>
              <th scope="col" style={numero}>
                Importe sin IVA
              </th>
              <th scope="col" style={celda}>
                CPV
              </th>
              <th scope="col" style={celda} aria-label="Marcas" />
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <FilaLote key={l.id} l={l} eleccion={editable ? eleccion : null} />
            ))}
          </tbody>
        </table>
      </div>
      {editable && <GuardarEleccion id={id} eleccion={eleccion} onCambio={onCambio} />}
    </Bloque>
  );
}
