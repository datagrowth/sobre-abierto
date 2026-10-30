// El equipo nominal de la oferta dentro de las decisiones: quién va, con qué rol y
// dedicación. Arriba, la matriz rol exigido × persona: se asigna a alguien desde la fila del rol
// que pide el pliego. Sin roles exigidos en la ficha, se añade desde la lista por grupos.
// Debajo, las filas de cada persona; el detalle de candidatos por requisito queda plegado.
import { Plus, Trash2 } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, TIPO } from '../../../lib/tema';
import { candidatosEquipo, nombrePersona } from '../../../lib/ofertaFormato';
import EquipoLicitacion from '../EquipoLicitacion';
import MatrizEquipo from './MatrizEquipo';

const quitar = { background: 'none', border: 'none', color: TINTA_2, cursor: 'pointer', padding: 4 };

// Con varios lotes, en cuáles trabaja (ninguno marcado = en todos).
function LotesPersona({ p, nombre, lotes, onCambio }) {
  if (lotes.length < 2) return null;
  const marcados = (p.lotes ?? []).filter((l) => lotes.includes(l));
  const cambiar = (l, si) => onCambio({ ...p, lotes: si ? [...marcados, l] : marcados.filter((x) => x !== l) });
  return (
    <span
      role="group"
      aria-label={`Lotes de ${nombre}`}
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        fontSize: TIPO.pequeno,
        color: TINTA_2,
        flexBasis: '100%',
      }}
    >
      Para los lotes:
      {lotes.map((l) => (
        <label key={l} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <input type="checkbox" checked={marcados.includes(l)} onChange={(e) => cambiar(l, e.target.checked)} />
          {l}
        </label>
      ))}
      {!marcados.length && <span style={{ color: TINTA_2 }}>(todos)</span>}
    </span>
  );
}

function Fila({ p, nombre, lotes, onCambio, onQuitar }) {
  const poner = (k) => (e) => onCambio({ ...p, [k]: e.target.value });
  return (
    <li
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '6px 0',
        borderTop: `1px solid ${BORDE}`,
      }}
    >
      <span style={{ fontSize: TIPO.texto, color: TINTA, fontWeight: 600, flex: '1 1 140px' }}>{nombre}</span>
      <input
        className="input-field"
        value={p.rol_en_la_oferta}
        onChange={poner('rol_en_la_oferta')}
        placeholder="Rol en la oferta"
        aria-label={`Rol de ${nombre} en la oferta`}
        maxLength={120}
        style={{ flex: '2 1 160px' }}
      />
      <input
        className="input-field"
        value={p.dedicacion}
        onChange={poner('dedicacion')}
        placeholder="Dedicación (opcional)"
        aria-label={`Dedicación de ${nombre}`}
        maxLength={80}
        style={{ flex: '1 1 120px' }}
      />
      <button type="button" onClick={onQuitar} aria-label={`Quitar a ${nombre}`} style={quitar}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
      <LotesPersona p={p} nombre={nombre} lotes={lotes} onCambio={onCambio} />
    </li>
  );
}

function Grupo({ etiqueta, items }) {
  if (!items.length) return null;
  return (
    <optgroup label={etiqueta}>
      {items.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nombre}
          {p.rol ? ` · ${p.rol}` : ''}
        </option>
      ))}
    </optgroup>
  );
}

function Anadir({ candidatos, onAnadir }) {
  const hayAlguien = candidatos.sugeridos.length + candidatos.internos.length + candidatos.externos.length > 0;
  return (
    <div style={{ marginTop: 8 }}>
      {hayAlguien ? (
        <select
          className="input-field"
          value=""
          onChange={(e) => e.target.value && onAnadir(Number(e.target.value))}
          aria-label="Añadir a una persona"
          data-testid="equipo-anadir"
          style={{ maxWidth: '100%' }}
        >
          <option value="">Añadir a una persona…</option>
          <Grupo etiqueta="Sugeridos" items={candidatos.sugeridos} />
          <Grupo etiqueta="Equipo" items={candidatos.internos} />
          <Grupo etiqueta="Externos" items={candidatos.externos} />
        </select>
      ) : (
        <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>
          No hay personas activas en Equipo: da de alta a alguien (sección Equipo) para nombrarlo en la oferta.
        </div>
      )}
    </div>
  );
}

/** filas: [{persona_id, rol_en_la_oferta, dedicacion, lotes}]; lotes: los de la oferta; equipo y personas: las respuestas cargadas (o null si fallaron). */
export default function EquipoOferta({ id, version, filas, lotes = [], onCambio, equipo, personas }) {
  const candidatos = candidatosEquipo(
    equipo,
    personas ?? [],
    filas.map((p) => p.persona_id),
  );
  const anadir = (personaId) =>
    onCambio([...filas, { persona_id: personaId, rol_en_la_oferta: '', dedicacion: '', lotes: [] }]);
  return (
    <div>
      <MatrizEquipo
        id={id}
        recarga={version}
        equipo={filas}
        equipoResp={equipo}
        personas={personas ?? []}
        onCambio={onCambio}
        vacia={<Anadir candidatos={candidatos} onAnadir={anadir} />}
      />
      {filas.length === 0 && (
        <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
          Nadie todavía: la memoria nombra a las personas y sus roles, y Hermes lee sus CV.
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {filas.map((p, i) => (
          <Fila
            key={`${p.persona_id}-${i}`}
            p={p}
            lotes={lotes}
            nombre={nombrePersona(p.persona_id, personas ?? [], equipo)}
            onCambio={(nueva) => onCambio(filas.map((x, j) => (j === i ? nueva : x)))}
            onQuitar={() => onCambio(filas.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <details style={{ marginTop: 8 }}>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: TIPO.pequeno,
            color: TINTA_2,
            display: 'inline-flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <Plus size={12} aria-hidden="true" />
          Candidatos por requisito de la ficha
        </summary>
        <div style={{ marginTop: 6 }}>
          <EquipoLicitacion id={id} version={version} sinMarco equipo={equipo} />
        </div>
      </details>
    </div>
  );
}
