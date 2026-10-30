// La pastilla «Hermes» de la barra lateral: qué hace Hermes ahora, por
// dominio, con lo que corre, lo que espera y lo que falló. Se recarga con los eventos de la
// plataforma (agrupados, como Hoy) y cada 30 s; pulsarla lleva a Hermes › Actividad.
import { useEffect, useState } from 'react';
import { plataformaApi } from '../../lib/plataformaApi';
import { lineasPastilla } from '../../lib/hoyFormato';
import { BORDE, TINTA_2, TINTA } from '../../lib/tema';

const ESPERA_EVENTOS_MS = 1500;
const CADA_MS = 30_000;

function useResumenCola() {
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    let temporizador = null;
    const cargar = () =>
      plataformaApi.colaResumen().then(
        (r) => {
          if (vivo) {
            setResumen(r);
            setError(false);
          }
        },
        () => {
          if (vivo) setError(true);
        },
      );
    // Una criba de 40 son 40 eventos: una sola recarga.
    const avisar = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(cargar, ESPERA_EVENTOS_MS);
    };
    cargar();
    const iv = setInterval(cargar, CADA_MS);
    window.addEventListener('plataforma', avisar);
    return () => {
      vivo = false;
      clearInterval(iv);
      clearTimeout(temporizador);
      window.removeEventListener('plataforma', avisar);
    };
  }, []);
  return { resumen, error };
}

export default function PastillaHermes({ onIr }) {
  const { resumen, error } = useResumenCola();
  const lineas = lineasPastilla(resumen);
  const vacio = error
    ? 'Hermes: no se pudo leer la cola'
    : resumen
      ? 'Hermes: nada en marcha'
      : 'Hermes: leyendo la cola…';
  return (
    <button
      type="button"
      data-testid="pastilla-hermes"
      onClick={() => onIr('actividad')}
      title="Ver la actividad de Hermes"
      className="cursor-pointer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        margin: '0 4px 6px',
        padding: '6px 8px',
        textAlign: 'left',
        fontSize: 11.5,
        lineHeight: 1.4,
        color: TINTA_2,
        background: 'none',
        border: `1px solid ${BORDE}`,
        borderRadius: 8,
      }}
    >
      {lineas.length === 0 && <span>{vacio}</span>}
      {lineas.map((l) => (
        <span
          key={l.dominio}
          data-testid={`pastilla-hermes-${l.dominio}`}
          style={{ color: l.pausa ? TINTA_2 : TINTA, opacity: l.pausa ? 0.7 : 1 }}
        >
          {l.texto}
        </span>
      ))}
    </button>
  );
}
