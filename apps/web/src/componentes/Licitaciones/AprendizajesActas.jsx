// «Aprendido de las actas»: Hermes lee las actas e informes de valoración de lo presentado
// (Conocimiento/Licitaciones/Presentadas) y saca, criterio a criterio, nuestros puntos, los
// del ganador y el comentario literal de la mesa, más unas lecciones. Entra pendiente: una
// persona lo acepta (y entonces el redactor de memorias lo usa) o lo descarta.
import { BookOpenCheck } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, TIPO } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { nuloSi404 } from '../../lib/apiCliente';
import { fechaHora } from '../../lib/formato';
import {
  aprendizajesVisibles,
  etiquetaResultadoActa,
  filasCriteriosActa,
  textoLeerActas,
  textoPuntosActa,
  tituloAprendizaje,
} from '../../lib/propuestasFormato';
import useCarga from '../../hooks/useCarga';
import useAccionAviso from '../../hooks/useAccionAviso';
import { SectionCard } from '../Biblioteca/bibliotecaUi';
import { Celda, Fila, Tabla } from '../comun/listas';
import { Aviso, Boton, Chip } from '../ui';
import { RevisionIa } from './EvaluacionPropuesta';
import { Documentos } from './PropuestaRegistro';

const TONO_RESULTADO = {
  ganada: 'ok',
  perdida: 'impide',
  excluida: 'impide',
  desierta: 'riesgo',
  desconocido: 'neutro',
};
const CABECERA = [['Criterio'], ['Tu empresa', 'd'], ['Ganador', 'd'], ['La mesa dijo']];

function Criterios({ criterios }) {
  const filas = filasCriteriosActa(criterios);
  if (!filas.length) return null;
  return (
    <Tabla cabecera={CABECERA}>
      {filas.map((c) => (
        <Fila key={c.clave}>
          <Celda largo>{c.criterio}</Celda>
          <Celda d>{c.nuestros}</Celda>
          <Celda d>{c.ganador}</Celda>
          <Celda largo>
            {c.comentario ? `«${c.comentario}»` : '—'}
            {c.pagina && <span style={{ color: TINTA_2 }}> · {c.pagina}</span>}
          </Celda>
        </Fila>
      ))}
    </Tabla>
  );
}

function Aprendizaje({ a, onCambio }) {
  const [aviso, hacer] = useAccionAviso(onCambio);
  const d = a.datos ?? {};
  const puntos = textoPuntosActa(d);
  // Descartar lo saca de la lista y Hermes deja de usarlo: se pregunta antes.
  const decidir = (decision) => {
    if (
      decision === 'descartar' &&
      !window.confirm('¿Descartar este aprendizaje? Deja de mostrarse y Hermes no lo usará al redactar.')
    )
      return;
    hacer(
      () => licitacionesApi.revisarAprendizaje(a.id, decision),
      decision === 'aceptar' ? 'Aprendizaje aceptado: el redactor lo tendrá en cuenta.' : 'Aprendizaje descartado.',
    );
  };
  return (
    <details style={{ borderTop: `1px solid ${BORDE}`, padding: '8px 0' }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: TIPO.texto,
          color: TINTA,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Chip tono={TONO_RESULTADO[d.resultado]} punto={false}>
          {etiquetaResultadoActa(d.resultado)}
        </Chip>
        <span style={{ fontWeight: 600 }}>{tituloAprendizaje(a)}</span>
        {puntos && (
          <span className="tabular-nums" style={{ color: TINTA_2 }}>
            {puntos}
          </span>
        )}
        {a.estado === 'pendiente' && (
          <Chip tono="riesgo" punto={false}>
            Pendiente de revisar
          </Chip>
        )}
      </summary>
      <div style={{ marginTop: 6 }}>
        <RevisionIa estado={a.estado} onDecidir={decidir} />
      </div>
      {aviso && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <Criterios criterios={d.criterios ?? []} />
      </div>
      {(d.lecciones ?? []).length > 0 && (
        <ul
          aria-label="Lecciones"
          style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 }}
        >
          {d.lecciones.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {a.documento && <Documentos rutas={[a.documento]} />}
      <div style={{ fontSize: TIPO.pequeno, color: TINTA_2, marginTop: 4 }}>
        {a.agente} · {fechaHora(a.creado_en)}
      </div>
    </details>
  );
}

function LeerActas({ pendientes, onCambio }) {
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const b = textoLeerActas(pendientes);
  const hecho = (r) =>
    typeof r?.encolados === 'number'
      ? `Hermes lee ${r.encolados === 1 ? '1 acta' : `${r.encolados} actas`}; lo aprendido aparecerá aquí para revisar.`
      : 'Hermes lee las actas pendientes.';
  return (
    <div>
      <Boton
        Icono={BookOpenCheck}
        disabled={Boolean(b.motivo)}
        cargando={ocupado}
        title={b.motivo ?? 'Un run de Hermes por acta: puntos por criterio, comentario de la mesa y lecciones'}
        onClick={() => hacer(() => licitacionesApi.leerActas(), hecho)}
      >
        {b.texto}
      </Boton>
      {b.motivo && <div style={{ fontSize: TIPO.pequeno, color: TINTA_2, marginTop: 4 }}>{b.motivo}</div>}
      {aviso && (
        <div style={{ marginTop: 6 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}

/** Con un servidor que aún no lee actas (404) no se enseña nada. */
export default function AprendizajesActas({ version }) {
  const carga = useCarga(() => nuloSi404(licitacionesApi.aprendizajes()), [], version);
  if (carga.kind === 'loading' || (carga.kind === 'ready' && !carga.data)) return null;
  if (carga.kind === 'error') return <Aviso tono="error">{carga.message}</Aviso>;
  const items = aprendizajesVisibles(carga.data.items ?? []);
  return (
    <SectionCard
      title="Aprendido de las actas"
      right={items.length ? String(items.length) : undefined}
      style={{ flex: 'none' }}
    >
      <LeerActas pendientes={carga.data.pendientes_de_leer} onCambio={carga.recargar} />
      {items.length === 0 ? (
        <div style={{ fontSize: TIPO.texto, color: TINTA_2, marginTop: 8 }}>
          Aún no hay nada aprendido. Hermes lee las actas de valoración que haya en las carpetas de Presentadas.
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {items.map((a) => (
            <Aprendizaje key={a.id} a={a} onCambio={carga.recargar} />
          ))}
        </div>
      )}
      <div style={{ fontSize: TIPO.pequeno, color: TINTA_2, marginTop: 6 }}>
        Lo aceptado lo lee el redactor de memorias en los apartados parecidos.
      </div>
    </SectionCard>
  );
}
