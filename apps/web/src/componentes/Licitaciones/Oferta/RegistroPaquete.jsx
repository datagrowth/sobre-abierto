// «Registrar presentación del paquete vN»: una fila por lote precargada con lo decidido
// (importe o precio por unidad, con la baja sobre su máximo) y un registro por lote, como
// hasta ahora. Al registrarlo, la versión se copia sola a DOCUMENTACION PRESENTADA.
// Con filas de las comprobaciones que impiden presentar (`impiden`), el botón se apaga y dice cuáles:
// registrar es afirmar que se presentó, y el servidor también lo frena. Se puede registrar
// igualmente con un motivo de una frase, que queda guardado con la presentación (forzar_motivo).
import { useState } from 'react';
import { Send } from 'lucide-react';
import { TINTA, TINTA_2, TIPO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { plural } from '../../../lib/formato';
import { filasRegistroPaquete, leerRegistroPaquete } from '../../../lib/presentacionFormato';
import { Aviso, Boton } from '../../ui';
import Confirmacion from '../../comun/Confirmacion';

const TITULOS_A_LA_VISTA = 2;

function textoImpiden(impiden) {
  const titulos = impiden
    .slice(0, TITULOS_A_LA_VISTA)
    .map((b) => b.titulo)
    .join('; ');
  const resto = impiden.length - TITULOS_A_LA_VISTA;
  return `No se puede registrar: ${plural(impiden.length, 'cosa impide', 'cosas impiden')} presentar (${titulos}${resto > 0 ? ` y ${resto} más` : ''})`;
}

function Cerrado({ version, impiden, onAbrir }) {
  const [pide, setPide] = useState(false);
  const bloqueado = impiden.length > 0;
  return (
    <div
      data-testid="paquete-registrar"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}
    >
      <Boton Icono={Send} testid="registrar-paquete" disabled={bloqueado} onClick={() => onAbrir(null)}>
        {bloqueado ? textoImpiden(impiden) : `Registrar presentación del paquete v${version}`}
      </Boton>
      {bloqueado && !pide && (
        <Boton testid="registrar-igualmente" onClick={() => setPide(true)}>
          Registrar igualmente con un motivo
        </Boton>
      )}
      {pide && (
        <Confirmacion
          pregunta={`¿Registrar la presentación del paquete v${version} aunque haya cosas que impiden presentarlo?`}
          detalle="El motivo queda guardado con la presentación."
          textoSi="Seguir con el registro"
          conMotivo
          onSi={(motivo) => {
            setPide(false);
            onAbrir(motivo);
          }}
          onNo={() => setPide(false)}
        />
      )}
    </div>
  );
}

// Un POST por lote. Los ya registrados no se repiten (el reintento chocaría con «Ya hay una propuesta»).
async function enviar(id, cuerpos) {
  let hechos = 0;
  try {
    for (const cuerpo of cuerpos) {
      await licitacionesApi.registrarPropuesta(id, cuerpo);
      hechos += 1;
    }
    return { hechos, error: null };
  } catch (e) {
    return { hechos, error: e.message };
  }
}

function Filas({ filas, poner }) {
  return filas.map((f, i) => (
    <label
      key={f.lote || 'contrato'}
      style={{ fontSize: TIPO.texto, color: TINTA, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <span style={{ minWidth: 70 }}>{f.lote ? `Lote ${f.lote}` : 'Contrato'}</span>
      <input
        className="input-field"
        inputMode="decimal"
        value={f.valor}
        onChange={(e) => poner(i, e.target.value)}
        aria-label={`${f.unidad ? `Precio por ${f.unidad}` : 'Importe'}${f.lote ? ` del lote ${f.lote}` : ''}`}
        style={{ width: 140 }}
      />
      <span style={{ color: TINTA_2 }}>{f.unidad ? `€ por ${f.unidad}` : '€ sin impuestos'}</span>
    </label>
  ));
}

export default function RegistroPaquete({ id, version, registro, impiden = [], onHecho }) {
  const [abierto, setAbierto] = useState(false);
  const [forzar, setForzar] = useState(null);
  const [filas, setFilas] = useState(() => filasRegistroPaquete(registro));
  const [fecha, setFecha] = useState('');
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  if (!registro.length) return null;
  const poner = (i, valor) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, valor } : x)));
  const abrir = (motivo) => {
    setFilas(filasRegistroPaquete(registro));
    setForzar(motivo);
    setAbierto(true);
  };
  const registrar = async () => {
    const r = leerRegistroPaquete(filas, version, fecha);
    if (r.error) {
      setEstado({ ocupado: false, error: r.error });
      return;
    }
    setEstado({ ocupado: true, error: null });
    const { hechos, error } = await enviar(
      id,
      forzar ? r.cuerpos.map((c) => ({ ...c, forzar_motivo: forzar })) : r.cuerpos,
    );
    if (hechos) onHecho();
    if (error) {
      setFilas((xs) => xs.slice(hechos));
      setEstado({ ocupado: false, error });
      return;
    }
    setEstado({ ocupado: false, error: null });
    setAbierto(false);
  };
  if (!abierto) return <Cerrado version={version} impiden={impiden} onAbrir={abrir} />;
  return (
    <div data-testid="paquete-registro" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {forzar && <Aviso tono="aviso">{`Se registrará aunque algo impide presentarlo. Motivo: ${forzar}`}</Aviso>}
      <Filas filas={filas} poner={poner} />
      <label style={{ fontSize: TIPO.texto, color: TINTA, display: 'flex', gap: 8, alignItems: 'center' }}>
        Presentada el{' '}
        <input
          className="input-field"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          aria-label="Fecha de presentación"
        />
        <span style={{ color: TINTA_2 }}>(vacío: hoy)</span>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton
          Icono={Send}
          variante="principal"
          escribe
          cargando={estado.ocupado}
          testid="paquete-registro-enviar"
          onClick={registrar}
        >
          Registrar
        </Boton>
        <Boton testid="paquete-registro-cancelar" onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
      </div>
      {estado.error && <Aviso tono="error">{estado.error}</Aviso>}
    </div>
  );
}
