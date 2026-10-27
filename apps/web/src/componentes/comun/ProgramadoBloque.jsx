// «Programado»: lo que la plataforma hace sola (con su última y próxima vez) y las tareas
// de cron de cada perfil de Hermes. Se refresca cada 30 s mientras está a la vista.
import { useCallback, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, RIESGO, IMPIDE } from '../../lib/tema';
import { plataformaApi } from '../../lib/plataformaApi';
import { fechaHora } from '../../lib/formato';
import { ESTADOS_PROGRAMADO, cuando, nombrePerfil, tonoTarea } from '../../lib/programadoFormato';
import { SectionCard } from '../Biblioteca/bibliotecaUi';
import { Aviso, Boton, Chip } from '../ui';

const TONO_CHIP = { exito: 'ok', aviso: 'riesgo', error: 'impide', neutro: 'neutro' };
const REFRESCO_MS = 30_000;

function Momento({ etiqueta, iso }) {
  return (
    <span title={iso ? fechaHora(iso) : undefined}>
      {etiqueta}: <span style={{ color: TINTA }}>{cuando(iso)}</span>
    </span>
  );
}

function Fila({ titulo, chip, children }) {
  return (
    <li style={{ padding: '8px 0', borderTop: `1px solid ${BORDE}`, fontSize: 12.5, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: TINTA, fontWeight: 600 }}>{titulo}</span>
        {chip}
      </div>
      {children}
    </li>
  );
}

function Automatismo({ a, accion }) {
  const e = ESTADOS_PROGRAMADO[a.estado] ?? { texto: a.estado, tono: 'neutro' };
  return (
    <Fila
      titulo={a.nombre}
      chip={
        <Chip tono={TONO_CHIP[e.tono]} punto={false}>
          {e.texto}
        </Chip>
      }
    >
      <div style={{ color: TINTA_2 }}>{a.que_hace}</div>
      <div
        className="tabular-nums"
        style={{ color: TINTA_2, display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}
      >
        <span>Cada {a.cada}</span>
        <Momento etiqueta="Última" iso={a.ultima} />
        <Momento etiqueta="Próxima" iso={a.proxima} />
      </div>
      {a.detalle && <div style={{ color: a.estado === 'activo' ? TINTA_2 : RIESGO }}>{a.detalle}</div>}
      {accion && (
        <div style={{ marginTop: 6 }}>
          <Boton Icono={Play} cargando={accion.ocupado} onClick={accion.lanzar}>
            {accion.texto}
          </Boton>
        </div>
      )}
    </Fila>
  );
}

function Tarea({ t }) {
  return (
    <Fila
      titulo={t.nombre}
      chip={
        <Chip tono={TONO_CHIP[tonoTarea(t.estado)]} punto={false}>
          {t.estado}
        </Chip>
      }
    >
      {t.que_hace && t.que_hace !== t.nombre && <div style={{ color: TINTA_2 }}>{t.que_hace}</div>}
      <div
        className="tabular-nums"
        style={{ color: TINTA_2, display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}
      >
        <span>
          Cuándo: <span style={{ color: TINTA }}>{t.cuando}</span>
        </span>
        <Momento etiqueta="Última" iso={t.ultima} />
        <Momento etiqueta="Próxima" iso={t.proxima} />
        {t.entrega && <span>Entrega en: {t.entrega}</span>}
      </div>
      {t.ultimo_error && <div style={{ color: IMPIDE }}>Último error: {t.ultimo_error}</div>}
    </Fila>
  );
}

function useProgramado() {
  const [estado, setEstado] = useState({ kind: 'loading' });
  const cargar = useCallback(
    () =>
      plataformaApi.programado().then(
        (r) => setEstado({ kind: 'ready', ...r }),
        (e) => setEstado({ kind: 'error', message: e.message }),
      ),
    [],
  );
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar]);
  return [estado, cargar];
}

// dominios: qué automatismos enseñar (los del núcleo, «plataforma», siempre).
// acciones: { clave: { texto, fn } } para lanzar a mano los que tienen `accion`.
export default function ProgramadoBloque({ dominios, acciones = {} }) {
  const [estado, cargar] = useProgramado();
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState(null);
  const lanzar = (clave) => async () => {
    setOcupado(clave);
    try {
      await acciones[clave].fn();
      setAviso({ tono: 'info', texto: 'Pedido: se verá en la próxima actualización.' });
      cargar();
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setOcupado(null);
    }
  };
  if (estado.kind === 'loading')
    return (
      <SectionCard title="PROGRAMADO" style={{ flexBasis: '100%' }}>
        <div style={{ color: TINTA_2, fontSize: 12.5 }}>Cargando…</div>
      </SectionCard>
    );
  if (estado.kind === 'error') return <Aviso tono="error">{estado.message}</Aviso>;
  const propios = estado.automatismos.filter((a) => a.dominio === 'plataforma' || dominios.includes(a.dominio));
  const conTareas = estado.hermes.filter((p) => p.tareas.length || p.error);
  return (
    <SectionCard title="PROGRAMADO" right="se actualiza cada 30 s" style={{ flexBasis: '100%' }}>
      <div style={{ fontSize: 11.5, color: TINTA_2, letterSpacing: '0.04em' }}>LO QUE HACE LA PLATAFORMA SOLA</div>
      <ul style={{ listStyle: 'none', margin: '4px 0 12px', padding: 0 }}>
        {propios.map((a) => {
          const acc =
            a.accion && acciones[a.accion]
              ? { texto: acciones[a.accion].texto, lanzar: lanzar(a.accion), ocupado: ocupado === a.accion }
              : null;
          return <Automatismo key={a.id} a={a} accion={acc} />;
        })}
      </ul>
      <div style={{ fontSize: 11.5, color: TINTA_2, letterSpacing: '0.04em' }}>TAREAS PROGRAMADAS DE HERMES</div>
      {conTareas.length === 0 && (
        <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 4 }}>
          Ningún perfil de Hermes tiene tareas programadas.
        </div>
      )}
      {conTareas.map((p) => (
        <div key={p.perfil} style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12.5, color: TINTA, fontWeight: 600 }}>{nombrePerfil(p.perfil)}</div>
          {p.error && <div style={{ fontSize: 12.5, color: RIESGO }}>{p.error}</div>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {p.tareas.map((t) => (
              <Tarea key={t.id} t={t} />
            ))}
          </ul>
        </div>
      ))}
      <div style={{ fontSize: 12, color: TINTA_2, marginTop: 8 }}>
        Las tareas de Hermes se crean, pausan o borran en el <b>Panel de Hermes</b> (Cron) o con{' '}
        <code>hermes -p &lt;perfil&gt; cron</code>; aquí solo se ven.
      </div>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </SectionCard>
  );
}
