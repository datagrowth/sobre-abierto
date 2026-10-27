// Candidatos para un requisito de medios personales: lo que el código entendió del
// requisito y, por separado, personas del equipo y externas con su puntuación, cada
// regla (cumple, en parte, no cumple, sin dato), la disponibilidad calculada y los motivos
// de afinidad. Con onProponer, cada candidato se puede proponer para un perfil a incorporar.
import { FileText } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, ACCION, RIESGO, alpha } from '../../lib/tema';
import { urlDocumento } from '../../lib/apiCliente';
import { DISPONIBILIDADES, RESULTADOS_REGLA, etiquetaRegla, textoRequisito } from '../../lib/colaboradoresFormulario';
import { Boton, Chip } from '../ui';

const TONO_REGLA = { cumple: 'ok', parcial: 'riesgo', no_cumple: 'impide', desconocido: 'neutro' };

function Barra({ puntos, color }) {
  return (
    <div title={`${puntos} de 100`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <span aria-hidden="true" style={{ flex: 1, height: 6, borderRadius: 3, background: alpha(color, 0.15) }}>
        <span
          style={{
            display: 'block',
            width: `${Math.min(100, puntos)}%`,
            height: 6,
            borderRadius: 3,
            background: color,
          }}
        />
      </span>
      <span className="tabular-nums" style={{ fontSize: 12, color: TINTA, width: 26, textAlign: 'right' }}>
        {puntos}
      </span>
    </div>
  );
}

function Candidato({ c, onProponer }) {
  const color = c.cumple_minimos ? ACCION : RIESGO;
  return (
    <li style={{ padding: '8px 0', borderTop: `1px solid ${BORDE}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>{c.nombre}</span>
        {c.rol && <span style={{ fontSize: 12, color: TINTA_2 }}>{c.rol}</span>}
        {c.cv_ruta && (
          <a
            href={urlDocumento(c.cv_ruta)}
            target="_blank"
            rel="noreferrer"
            aria-label={`CV de ${c.nombre}`}
            style={{ color: TINTA_2 }}
          >
            <FileText size={13} />
          </a>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {onProponer && (
            <Boton tamano="pequeno" escribe onClick={() => onProponer(c)} testid={`proponer-${c.id}`}>
              Proponer como candidato
            </Boton>
          )}
          <Barra puntos={c.puntuacion} color={color} />
        </span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
        {!c.cumple_minimos && (
          <Chip tono="impide" punto={false}>
            no llega a algún mínimo
          </Chip>
        )}
        {c.disponibilidad !== 'disponible' && (
          <Chip tono="riesgo" punto={false} title={c.disponibilidad_motivo}>
            {DISPONIBILIDADES[c.disponibilidad]}
          </Chip>
        )}
        {c.reglas.map((r) => (
          <Chip key={`${r.regla}-${r.exigido}`} tono={TONO_REGLA[r.resultado]} punto={false} title={r.detalle}>
            {etiquetaRegla(r.regla)} {r.exigido}: {RESULTADOS_REGLA[r.resultado]}
          </Chip>
        ))}
      </div>
      {c.afinidad.length > 0 && (
        <div style={{ fontSize: 11.5, color: TINTA_2, marginTop: 4 }}>{c.afinidad.join(' · ')}</div>
      )}
    </li>
  );
}

function Grupo({ titulo, lista, onProponer }) {
  return (
    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
      <div
        style={{ fontSize: 11.5, color: TINTA_2, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        {titulo}
      </div>
      {lista.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lista.map((c) => (
            <Candidato key={c.id} c={c} onProponer={onProponer} />
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: TINTA_2, padding: '8px 0' }}>Nadie encaja.</div>
      )}
    </div>
  );
}

/** resultado: un requisito de la respuesta del servidor ({requisito, internos, externos}). */
export default function Candidatos({ resultado, onProponer }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: TINTA_2, marginBottom: 6 }}>
        Se comprueba: {textoRequisito(resultado.requisito)}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Grupo titulo="Equipo" lista={resultado.internos} onProponer={onProponer} />
        <Grupo titulo="Externos" lista={resultado.externos} onProponer={onProponer} />
      </div>
    </div>
  );
}
