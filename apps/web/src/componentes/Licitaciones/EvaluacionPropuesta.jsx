// Una evaluación de Hermes sobre un documento de propuesta: puntuación estimada por
// criterio, qué eliminar, modificar y reforzar (con su sección o página), comparables y
// riesgos. Con una memoria ensamblada, la vara son los apartados del guion: cada criterio
// trae el tramo de la escala del pliego y se listan los párrafos genéricos. Es la opinión de
// la IA: orientativa, el documento no se toca. Entra pendiente y una persona la acepta o la
// descarta (RevisionIa, también para los borradores).
import { Check, X } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, OK_TEXTO, RIESGO, IMPIDE, alpha } from '../../lib/tema';
import { fechaHora } from '../../lib/formato';
import {
  ETIQUETA_REVISION,
  etiquetaResultadoPropuesta,
  puntosSobre,
  textoGenericos,
} from '../../lib/propuestasFormato';
import { Boton, Chip } from '../ui';

/** Estado de revisión de algo escrito por la IA, con Aceptar (si está pendiente) y Descartar. */
export function RevisionIa({ estado, onDecidir }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip tono={estado === 'aceptada' ? 'ok' : 'riesgo'} punto={false}>
        {ETIQUETA_REVISION[estado] ?? estado}
      </Chip>
      {estado === 'pendiente' && (
        <Boton Icono={Check} onClick={() => onDecidir('aceptar')} title="Lo has revisado y sirve">
          Aceptar
        </Boton>
      )}
      <Boton
        Icono={X}
        onClick={() => onDecidir('descartar')}
        title="Deja de mostrarse y Hermes no lo usa como contexto"
      >
        Descartar
      </Boton>
    </span>
  );
}

const TONO_GRAVEDAD = { alta: 'impide', media: 'riesgo', baja: 'neutro' };
const SUGERENCIAS = [
  { clave: 'eliminar', titulo: 'Eliminar', color: IMPIDE },
  { clave: 'modificar', titulo: 'Modificar', color: RIESGO },
  { clave: 'reforzar', titulo: 'Reforzar', color: OK_TEXTO },
];

function Criterio({ c }) {
  const pct = c.peso > 0 ? Math.min(100, (c.puntuacion / c.peso) * 100) : 0;
  return (
    <li style={{ fontSize: 12.5, color: TINTA, padding: '6px 0', borderTop: `1px solid ${BORDE}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>
          {typeof c.apartado === 'number' ? `${c.apartado}. ` : ''}
          {c.criterio}
        </span>
        <Chip tono={c.tipo === 'formula' ? 'neutro' : 'riesgo'} punto={false}>
          {c.tipo === 'formula' ? 'fórmula' : 'juicio de valor'}
        </Chip>
        {typeof c.tramo === 'number' && (
          <Chip title="Tramo de la escala del pliego en el que la puntuaría la mesa">tramo {c.tramo}</Chip>
        )}
        <span className="tabular-nums" style={{ color: TINTA_2 }}>
          {puntosSobre(c.puntuacion, c.peso)}
        </span>
      </div>
      <div aria-hidden="true" style={{ height: 4, borderRadius: 2, marginTop: 4, background: alpha(ACCION, 0.12) }}>
        <div style={{ width: `${pct}%`, height: 4, borderRadius: 2, background: ACCION }} />
      </div>
      <div style={{ color: TINTA_2, marginTop: 3 }}>
        {c.justificacion}
        {c.referencia ? <span style={{ color: TINTA_2 }}> · {c.referencia}</span> : null}
      </div>
    </li>
  );
}

function Sugerencias({ datos }) {
  const grupos = SUGERENCIAS.filter((g) => datos[g.clave].length);
  if (!grupos.length) return null;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
      {grupos.map((g) => (
        <div
          key={g.clave}
          style={{
            flex: '1 1 220px',
            border: `1px solid ${alpha(g.color, 0.35)}`,
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          <div style={{ fontSize: 12, color: g.color, fontWeight: 700, marginBottom: 4 }}>{g.titulo}</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: TINTA, lineHeight: 1.5 }}>
            {datos[g.clave].map((s, i) => (
              <li key={i}>
                <span style={{ color: TINTA_2 }}>{s.referencia}:</span> {s.que}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Párrafos sin quién, cuándo ni medida, declarativos o que repiten el pliego: la mesa no los puntúa.
function Genericos({ items }) {
  if (!items?.length) return null;
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5, color: RIESGO, fontWeight: 600 }}>
        {textoGenericos(items.length)}
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12.5, color: TINTA, lineHeight: 1.5 }}>
        {items.map((g, i) => (
          <li key={i} style={{ marginTop: 4 }}>
            <span style={{ color: TINTA_2 }}>{g.referencia}:</span> «{g.texto}»
            <div style={{ color: TINTA_2 }}>{g.por_que}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Extras({ datos }) {
  return (
    <>
      {datos.comparables.length > 0 && (
        <div style={{ fontSize: 12.5, color: TINTA_2, marginTop: 10 }}>
          <div style={{ color: TINTA_2, fontSize: 11.5, marginBottom: 2 }}>Comparado con</div>
          {datos.comparables.map((c, i) => (
            <div key={i}>
              {c.referencia}
              {c.resultado ? ` (${etiquetaResultadoPropuesta(c.resultado)})` : ''}: {c.parecido}
            </div>
          ))}
        </div>
      )}
      {datos.riesgos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, fontSize: 12.5, color: TINTA }}>
          {datos.riesgos.map((r, i) => (
            <div key={i}>
              <Chip tono={TONO_GRAVEDAD[r.gravedad]} punto={false}>
                {r.gravedad}
              </Chip>{' '}
              {r.descripcion}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// sinRevision: dentro de la memoria la evaluación es solo la explicación de su nota, sin aceptar ni descartar.
export default function EvaluacionPropuesta({ evaluacion, onRevisar, sinRevision = false }) {
  const d = evaluacion.datos;
  return (
    <details
      open
      id={`evaluacion-${evaluacion.id}`}
      style={{ borderTop: `1px solid ${BORDE}`, padding: '8px 0', scrollMarginTop: 12 }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 12.5,
          color: TINTA,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15 }} className="tabular-nums">
          {puntosSobre(d.puntuacion_total, d.puntuacion_maxima)}
        </span>
        <span style={{ color: TINTA_2, wordBreak: 'break-all' }}>{evaluacion.documento}</span>
        <span style={{ color: TINTA_2, fontSize: 11.5 }}>
          {evaluacion.agente} · {fechaHora(evaluacion.creada_en)}
        </span>
      </summary>
      {!sinRevision && (
        <div style={{ marginTop: 6 }}>
          <RevisionIa estado={evaluacion.estado} onDecidir={onRevisar} />
        </div>
      )}
      <p style={{ fontSize: 12.5, color: TINTA, lineHeight: 1.55, margin: '6px 0' }}>{d.resumen}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {d.criterios.map((c, i) => (
          <Criterio key={i} c={c} />
        ))}
      </ul>
      <Sugerencias datos={d} />
      <Genericos items={d.genericos} />
      <Extras datos={d} />
    </details>
  );
}
