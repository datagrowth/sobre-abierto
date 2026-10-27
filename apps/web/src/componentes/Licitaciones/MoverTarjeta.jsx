// Mover una tarjeta del Pipeline a otra columna (arrastrándola o con «Mover»): cada movimiento
// es la acción real que ya existe, para que el tablero nunca contradiga a la propuesta registrada.
// Presentada registra la presentación, Resuelta anota el resultado de cada lote y volver a En
// preparación deshace una presentación hecha por error.
import { useState } from 'react';
import useCarga from '../../hooks/useCarga';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { RESULTADOS } from '../../lib/propuestasFormato';
import { Aviso, Boton, Campo, Dialogo, Esqueleto, Selector } from '../ui';
import { FormPresentacion } from './PropuestaRegistro';

const DECIDIDOS = RESULTADOS.filter((r) => r.key !== 'pendiente').map((r) => ({ valor: r.key, texto: r.label }));

function Registrar({ tarjeta, propuesta, onHecho, onCerrar }) {
  if (propuesta.kind === 'loading') return <Esqueleto lineas={3} etiqueta="Cargando los documentos…" />;
  if (propuesta.kind === 'error')
    return <Aviso tono="error">No se pudieron cargar los documentos: {propuesta.message}</Aviso>;
  return (
    <>
      <p className="m-0 text-tabla text-tinta-2">
        Si presentaste varios lotes, registra aquí uno y los demás en la ficha (Presentación).
      </p>
      <FormPresentacion
        id={tarjeta.id}
        candidatos={propuesta.data.documentos}
        onHecho={onHecho}
        onCancelar={onCerrar}
      />
    </>
  );
}

// Un selector por lote: en una licitación por lotes cada uno se adjudica por su lado.
function Resultado({ propuesta, onHecho }) {
  const [elegidos, setElegidos] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  if (propuesta.kind === 'loading') return <Esqueleto lineas={2} etiqueta="Cargando lo presentado…" />;
  if (propuesta.kind === 'error')
    return <Aviso tono="error">No se pudo cargar lo presentado: {propuesta.message}</Aviso>;
  const pendientes = propuesta.data.propuestas.filter((p) => p.resultado === 'pendiente');
  if (!pendientes.length)
    return <Aviso tono="aviso">No hay ningún lote sin resultado: cámbialo en la ficha (Presentación).</Aviso>;
  const guardar = async () => {
    if (pendientes.some((p) => !elegidos[p.id])) return setError('Elige el resultado de cada lote.');
    setGuardando(true);
    try {
      for (const p of pendientes) await licitacionesApi.cambiarPropuesta(p.id, { resultado: elegidos[p.id] });
      return onHecho();
    } catch (e) {
      setGuardando(false);
      return setError(e.message);
    }
  };
  return (
    <div className="grid gap-3">
      {pendientes.map((p) => (
        <Campo key={p.id} etiqueta={p.lote ? `Lote ${p.lote}` : 'Contrato entero'}>
          <Selector
            value={elegidos[p.id] ?? ''}
            onChange={(e) => {
              setError(null);
              setElegidos((x) => ({ ...x, [p.id]: e.target.value }));
            }}
          >
            <option value="" disabled>
              Elige el resultado
            </option>
            {DECIDIDOS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </Selector>
        </Campo>
      ))}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex justify-end">
        <Boton variante="principal" escribe cargando={guardando} onClick={guardar} testid="mover-guardar-resultado">
          Anotar el resultado
        </Boton>
      </div>
    </div>
  );
}

function Deshacer({ tarjeta, onHecho }) {
  const [error, setError] = useState(null);
  const [haciendo, setHaciendo] = useState(false);
  const deshacer = async () => {
    setHaciendo(true);
    try {
      await licitacionesApi.deshacerPresentacion(tarjeta.id);
      onHecho();
    } catch (e) {
      setHaciendo(false);
      setError(e.message);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="m-0">
        Se borra el registro de la presentación y la oferta vuelve a «En preparación». La carpeta de lo presentado que
        ya esté en Drive se queda.
      </p>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex justify-end">
        <Boton variante="peligro" escribe cargando={haciendo} onClick={deshacer} testid="mover-deshacer">
          Deshacer la presentación
        </Boton>
      </div>
    </div>
  );
}

const TITULOS = {
  registrar: 'Registrar la presentación',
  resultado: 'Anotar el resultado',
  deshacer: '¿Deshacer la presentación?',
};

function Movimiento({ tarjeta, tipo, onHecho, onCerrar }) {
  const propuesta = useCarga(
    () => (tipo === 'deshacer' ? Promise.resolve(null) : licitacionesApi.propuesta(tarjeta.id)),
    [tarjeta.id, tipo],
  );
  const hecho = () => {
    onCerrar();
    onHecho();
  };
  return (
    <Dialogo
      abierto
      titulo={`${TITULOS[tipo]} · ${tarjeta.expediente}`}
      onCerrar={onCerrar}
      ancho={560}
      testid="mover-tarjeta"
    >
      {tipo === 'registrar' && (
        <Registrar tarjeta={tarjeta} propuesta={propuesta} onHecho={hecho} onCerrar={onCerrar} />
      )}
      {tipo === 'resultado' && <Resultado propuesta={propuesta} onHecho={hecho} />}
      {tipo === 'deshacer' && <Deshacer tarjeta={tarjeta} onHecho={hecho} />}
    </Dialogo>
  );
}

/** movimiento: { tarjeta, tipo } (o null, cerrado). onHecho: recargar el tablero. */
export default function MoverTarjeta({ movimiento, onHecho, onCerrar }) {
  if (!movimiento) return null;
  // Con su clave, cada movimiento carga de cero: no enseña lo cargado para otra tarjeta.
  return (
    <Movimiento
      key={`${movimiento.tarjeta.id}:${movimiento.tipo}`}
      {...movimiento}
      onHecho={onHecho}
      onCerrar={onCerrar}
    />
  );
}
