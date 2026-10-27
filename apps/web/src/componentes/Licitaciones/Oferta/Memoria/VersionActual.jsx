// La versión vigente de la memoria: lo que se revisa y desde donde se piden cambios.
import { FileText, RefreshCw } from 'lucide-react';
import { TINTA, TINTA_2, ACCION, RIESGO, alpha } from '../../../../lib/tema';
import { licitacionesApi } from '../../../../lib/licitacionesApi';
import { rutaComprobacionesEn } from '../../../../lib/rutas';
import {
  filasApartados,
  memoriaSePuntuaEnOferta,
  progresoMemoria,
  sinRedactar,
  textoLimitePaginas,
  versionSiguiente,
} from '../../../../lib/memoriaFormato';
import { avisosSinFugas, textoAnonimato } from '../../../../lib/fugasFormato';
import useAccionAviso from '../../../../hooks/useAccionAviso';
import { Aviso, Boton } from '../../../ui';
import RelanzarTrabajo from '../../RelanzarTrabajo';
import PedirCambios from '../PedirCambios';
import { PanelSubida } from '../SubirVersion';
import Lecciones from '../Lecciones';
import { DetalleMemoria, FasesMemoria } from '../ProgresoMemoria';
import FichaSolucion from '../FichaSolucion';
import { TIPO_TRABAJO_FASE } from '../../../../lib/progresoMemoriaFormato';
import { texto, usePaneles } from './compartido';
import FilaApartado from './Apartados';
import Fugas from './Fugas';
import Acciones from './Acciones';
import CabeceraVersion from './CabeceraVersion';
import EvaluacionOrientativa from './EvaluacionOrientativa';

function Progreso({ id, m, onCambio }) {
  const p = progresoMemoria(m);
  const [aviso, hacer] = useAccionAviso(onCambio);
  const tipo = TIPO_TRABAJO_FASE[m.progreso?.fase];
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...texto, color: TINTA_2 }}>
        {p.texto} {tipo && <RelanzarTrabajo id={id} tipo={tipo} onHecho={onCambio} />}
      </div>
      {m.progreso?.fase === 'critica' && (
        <div style={{ marginTop: 6 }}>
          <Boton
            Icono={FileText}
            title="El texto ya está escrito: monta el Word ahora, sin esperar a la crítica ni a más rondas"
            onClick={() =>
              hacer(() => licitacionesApi.ensamblarMemoria(id, m.version), 'Se monta el Word con lo que hay.')
            }
          >
            Ensamblar ya
          </Boton>
        </div>
      )}
      {aviso && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.recibidos + p.fallidos}
        aria-label="Apartados redactados"
        style={{ height: 6, borderRadius: 3, marginTop: 4, background: alpha(ACCION, 0.12) }}
      >
        <div style={{ width: `${p.pct}%`, height: 6, borderRadius: 3, background: ACCION }} />
      </div>
    </div>
  );
}

// Páginas y, en una pendiente, el enlace a su tarjeta: la autoevaluación de Hermes infla 6-8 puntos
// (caso real: 22,25 frente a 16,1) y ya no se enseña como nota; la del crítico ciego, con su margen,
// está en la tarjeta. Sin puntos en el guion vigente no hay nota que dar.
function Cifras({ id, m, valorable }) {
  const pags = textoLimitePaginas(m);
  const pendiente = !m.ensayo && m.estado === 'ensamblada' && m.borrador?.estado === 'pendiente';
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, ...texto }}>
      {!valorable && (
        <span data-testid="memoria-no-valorable" style={{ color: TINTA_2 }}>
          No se puntúa: la mesa solo comprueba que está lo exigido
        </span>
      )}
      {pendiente && (
        <a
          data-testid="memoria-enlace-tarjeta"
          href={rutaComprobacionesEn(id, `tarjeta-revision-memoria:v${m.version}`)}
          style={{ color: TINTA }}
        >
          Dar por buena, con el resumen, los compromisos y la nota del crítico ciego, en «Revisar lo que hizo Hermes»
        </a>
      )}
      {pags && (
        <span className="tabular-nums" style={{ color: pags.aviso ? RIESGO : TINTA }}>
          <span style={{ color: TINTA_2 }}>Páginas: </span>
          {pags.texto}
        </span>
      )}
    </div>
  );
}

function Fallida({ id, m, onCambio }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  // Una que falló antes de acabar (dossier, estrategia o redacción) no tiene Word que montar.
  if (sinRedactar(m)) {
    return (
      <div style={{ marginTop: 8 }}>
        <Aviso tono="error">
          La v{m.version} no llegó a redactarse{m.error ? `: ${m.error}` : ''}. Empieza otra desde cero.
        </Aviso>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <Aviso tono="error">No se pudo montar el Word{m.error ? `: ${m.error}` : ''}.</Aviso>
      <div style={{ marginTop: 6 }}>
        <Boton
          Icono={RefreshCw}
          onClick={() =>
            hacer(
              () => licitacionesApi.ensamblarMemoria(id, m.version),
              'Se vuelve a montar con los apartados recibidos.',
            )
          }
        >
          Volver a montar
        </Boton>
      </div>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}

// El pliego pide el equipo sin nombres y esta versión nombra a alguien (sin decir a quién).
function Anonimato({ m }) {
  const t = textoAnonimato(m);
  if (!t) return null;
  return (
    <div data-testid="memoria-anonimato" style={{ marginTop: 8 }}>
      <Aviso tono="error">{t}</Aviso>
    </div>
  );
}

/** La versión actual: lo que se revisa y desde donde se piden cambios. onAviso: lo que crea otra versión se dice en MemoriaOferta. */
export default function VersionActual({ id, m, o, evaluaciones, onCambio, onAviso }) {
  const p = usePaneles();
  const [aviso, hacer] = useAccionAviso(onCambio);
  const enCurso = progresoMemoria(m).enCurso;
  const valorable = memoriaSePuntuaEnOferta(o, m);
  return (
    <section aria-label={`Memoria v${m.version}`}>
      <CabeceraVersion m={m} />
      {m.progreso && <FasesMemoria m={m} />}
      <FichaSolucion id={id} m={m} onCambio={onCambio} />
      {enCurso ? <Progreso id={id} m={m} onCambio={onCambio} /> : <Cifras id={id} m={m} valorable={valorable} />}
      {!enCurso && (
        <Acciones
          id={id}
          m={m}
          o={o}
          abierto={Boolean(p.pidiendo)}
          onPedir={p.pedir}
          onPedirMotivos={() => p.pedirMotivos(m)}
          subiendo={p.subiendo}
          onSubir={p.subir}
          hacer={hacer}
          onAviso={onAviso}
        />
      )}
      {aviso?.texto && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      {!enCurso && <Fugas m={m} guion={o.guion?.datos} onPedirConCita={p.pedirConCita} />}
      {!enCurso && <Anonimato m={m} />}
      {p.pidiendo && (
        <PedirCambios
          key={p.pidiendo.inicial?.indicaciones ?? 'evaluacion'}
          id={id}
          m={m}
          o={o}
          inicial={p.pidiendo.inicial}
          onCambio={onCambio}
          onCerrar={p.cerrarPedir}
          onAviso={onAviso}
        />
      )}
      {p.subiendo && (
        <PanelSubida
          id={id}
          o={o}
          siguiente={versionSiguiente(o.memorias)}
          lote={m.lote ?? null}
          onCambio={onCambio}
          onCerrar={p.cerrarSubir}
          onAviso={onAviso}
        />
      )}
      {m.estado === 'fallida' && <Fallida id={id} m={m} onCambio={onCambio} />}
      {avisosSinFugas(m.avisos).map((v) => (
        <div key={v} style={{ marginTop: 6 }}>
          <Aviso tono="aviso">{v}</Aviso>
        </div>
      ))}
      <ul aria-label="Apartados" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
        {filasApartados(m).map((a) => (
          <FilaApartado key={a.apartado} id={id} m={m} a={a} valorable={valorable} />
        ))}
      </ul>
      {m.progreso && <DetalleMemoria m={m} id={id} onCambio={onCambio} />}
      <Lecciones id={id} m={m} onCambio={onCambio} />
      <EvaluacionOrientativa id={id} m={m} valorable={valorable} evaluaciones={evaluaciones} onCambio={onCambio} />
    </section>
  );
}
