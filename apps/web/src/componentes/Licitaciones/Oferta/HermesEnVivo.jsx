// Lo que Hermes hace ahora para esta oferta, en la barra de las
// comprobaciones: una línea por trabajo con su hora estimada en intervalo y su sitio en la cola, el último
// fallo, el tope de runs del día y lo que lo frena. Sustituye a los «¿Colgado?» repartidos por la
// oferta: «Relanzar» solo sale cuando un run pasó lo normal sin avanzar, y relanza solo esta oferta.
import { useEffect, useRef, useState } from 'react';
import { TINTA_2, TINTA, RIESGO } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import {
  cambiosQueAvisan,
  frenoElegibilidad,
  hayEnVivo,
  lineasEnVivo,
  textoTopes,
  textosFreno,
} from '../../../lib/enVivoFormato';
import { bloqueo as testidBloqueo } from '../../../lib/idsPrueba';
import useCarga from '../../../hooks/useCarga';
import useEventosLicitacion from '../../../hooks/useEventosLicitacion';
import { ir } from '../../../hooks/useRuta';
import { Enlace } from '../../comun/listas';
import Confirmacion from '../../comun/Confirmacion';

// Cada evento de la licitación (un trabajo que entra, avanza o falla) vuelve a pedir la línea.
function useEnVivo(id) {
  const [version, setVersion] = useState(0);
  useEventosLicitacion(id, () => setVersion((v) => v + 1));
  return useCarga(() => licitacionesApi.hermesEnVivo(id), [id], version);
}

const permiso = () => (typeof Notification === 'undefined' ? 'no_soportado' : Notification.permission);

function notificar(textos) {
  try {
    textos.forEach((t) => new Notification('Hermes', { body: t, tag: `hermes-${t}` }));
    return null;
  } catch (e) {
    return `El navegador no dejó avisar: ${e.message}`;
  }
}

// Compara las comprobaciones con las anteriores y avisa solo si algo pasa a «te toca» o falla. La primera
// carga no avisa: lo que ya estaba así no es nuevo para quien abre la oferta.
function useAvisoNavegador(fases, hermes) {
  const antes = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!hermes) return;
    const ahora = { fases, hermes };
    const avisos = cambiosQueAvisan(antes.current, ahora);
    antes.current = ahora;
    if (avisos.length && permiso() === 'granted') setError(notificar(avisos.map((a) => a.texto)));
  }, [fases, hermes]);
  return error;
}

function BotonAvisarme({ error }) {
  const [estado, setEstado] = useState(permiso);
  const pedir = async () => {
    try {
      setEstado(await Notification.requestPermission());
    } catch {
      setEstado('denied');
    }
  };
  if (error)
    return (
      <span role="alert" style={{ color: RIESGO }}>
        {error}
      </span>
    );
  if (estado === 'default') {
    return (
      <span data-testid="hermes-avisarme">
        <Enlace onClick={pedir} title="Un aviso del navegador cuando algo pase a «te toca» o falle">
          Avisarme cuando me toque
        </Enlace>
      </span>
    );
  }
  if (estado === 'granted')
    return (
      <span data-testid="hermes-en-vivo-avisos" style={{ color: TINTA_2 }}>
        Te aviso cuando te toque
      </span>
    );
  return null;
}

function Relanzar({ id, linea, onHecho }) {
  const [pide, setPide] = useState(false);
  const [aviso, setAviso] = useState(null);
  const relanzar = async () => {
    setPide(false);
    try {
      await licitacionesApi.relanzarTrabajo(id, linea.tipo);
      setAviso({ error: false, texto: 'Relanzado: vuelve a la cola.' });
      onHecho();
    } catch (e) {
      setAviso({ error: true, texto: e.message });
    }
  };
  if (pide) {
    return (
      <Confirmacion
        pregunta={`¿Relanzar «${linea.nombre}»?`}
        textoSi="Relanzar"
        onSi={relanzar}
        onNo={() => setPide(false)}
        detalle="Relanza solo esta oferta: para el run en Hermes y lo vuelve a poner en la cola sin gastar intento."
      />
    );
  }
  return (
    <span data-testid={`hermes-relanzar-${linea.id}`} style={{ display: 'inline-flex', gap: 6 }}>
      <Enlace onClick={() => setPide(true)} title="Lleva más de lo normal sin avanzar">
        Relanzar
      </Enlace>
      {aviso && (
        <span role={aviso.error ? 'alert' : 'status'} style={{ color: aviso.error ? RIESGO : TINTA_2 }}>
          {aviso.texto}
        </span>
      )}
    </span>
  );
}

function Linea({ id, linea, onHecho }) {
  return (
    <li
      data-testid={`hermes-trabajo-${linea.id}`}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}
    >
      <span style={{ color: TINTA }}>{linea.texto}</span>
      {linea.fallo && (
        <span data-testid={`hermes-fallo-${linea.id}`} style={{ color: RIESGO }}>
          {linea.fallo}
        </span>
      )}
      {linea.sesion && (
        <span data-testid={`hermes-ver-sesion-${linea.id}`}>
          <Enlace onClick={() => ir('actividad', null, linea.sesion)}>Ver lo que está haciendo</Enlace>
        </span>
      )}
      {linea.relanzable && <Relanzar id={id} linea={linea} onHecho={onHecho} />}
    </li>
  );
}

// Lleva a la fila que espera tu «Vamos», que está en estas mismas comprobaciones.
function irAFila(clave) {
  const el = document.querySelector(`[data-testid="${CSS.escape(testidBloqueo(clave))}"]`);
  el?.scrollIntoView({ block: 'center' });
  el?.focus?.();
}

function FrenoElegibilidad({ hermes }) {
  const f = frenoElegibilidad(hermes);
  if (!f) return null;
  return (
    <div data-testid="hermes-freno-elegibilidad" style={{ color: RIESGO, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <span>{f.texto}</span>
      {f.bloqueos.map((b, i) => (
        <span key={b.clave} data-testid={`hermes-freno-${b.clave}`}>
          <Enlace onClick={() => irAFila(b.clave)}>{b.titulo}</Enlace>
          {i < f.bloqueos.length - 1 ? ';' : '.'}
        </span>
      ))}
    </div>
  );
}

function Pie({ hermes, error }) {
  const topes = textoTopes(hermes);
  // Un fallo de un trabajo que sigue vivo ya sale en su línea.
  const fallo =
    hermes.ultimo_fallo && !(hermes.trabajos ?? []).some((t) => t.tipo === hermes.ultimo_fallo.tipo && t.codigo)
      ? hermes.ultimo_fallo
      : null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, color: TINTA_2 }}>
      {fallo && (
        <span data-testid="hermes-ultimo-fallo" style={{ color: RIESGO }}>
          {fallo.nombre}: {fallo.texto}
        </span>
      )}
      {textosFreno(hermes).map((t) => (
        <span key={t} data-testid="hermes-freno" style={{ color: RIESGO }}>
          {t}
        </span>
      ))}
      {topes && <span data-testid="hermes-topes">{topes}</span>}
      <BotonAvisarme error={error} />
    </div>
  );
}

/** id: la licitación; fases: las de las comprobaciones, para avisar cuando una pasa a «te toca». */
export default function HermesEnVivo({ id, fases }) {
  const carga = useEnVivo(id);
  const hermes = carga.kind === 'ready' ? carga.data : null;
  const error = useAvisoNavegador(fases, hermes);
  if (carga.kind === 'error')
    return (
      <div data-testid="hermes-en-vivo-error" role="alert" style={{ fontSize: 12, color: RIESGO }}>
        No se pudo saber qué hace Hermes: {carga.message}
      </div>
    );
  if (!hayEnVivo(hermes)) return null;
  return (
    <div
      data-testid="hermes-en-vivo"
      role="status"
      aria-label="Lo que hace Hermes"
      style={{
        fontSize: 12.5,
        borderLeft: `3px solid ${TINTA_2}`,
        paddingLeft: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {lineasEnVivo(hermes).map((l) => (
          <Linea key={l.id} id={id} linea={l} onHecho={carga.recargar} />
        ))}
      </ul>
      <FrenoElegibilidad hermes={hermes} />
      <Pie hermes={hermes} error={error} />
    </div>
  );
}
