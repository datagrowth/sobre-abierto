// Matriz rol exigido × persona. Con solo botones de equipo, la ficha podía salir en «Cumple» sin que
// nadie tuviera una materia exigida. Aquí cada rol que pide
// el pliego es una fila con sus materias y su página, y cada persona asignada lleva ✓ / ✗ / «no
// comprobado» por materia con su fuente. Las celdas las calcula el servidor sobre lo GUARDADO: lo
// que se asigna aquí se ve como «pendiente de guardar» hasta guardar la sección.
import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import useCarga from '../../../hooks/useCarga';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { candidatosEquipo, nombrePersona } from '../../../lib/ofertaFormato';
import {
  asignarAlRol,
  avisosIncompatibles,
  enlaceCelda,
  pendientesDeGuardar,
  slug,
  textoCelda,
} from '../../../lib/matrizEquipoFormato';
import { TINTA, TINTA_2, BORDE, TIPO, OK_TEXTO, IMPIDE, RIESGO } from '../../../lib/tema';
import { Aviso, Boton, Chip } from '../../ui';

const COLOR_TONO = { ok: OK_TEXTO, peligro: IMPIDE, aviso: RIESGO };

function Materia({ rol, personaId, celda }) {
  const t = textoCelda(celda);
  const enlace = enlaceCelda(personaId, celda);
  return (
    <li
      data-testid={`matriz-materia-${slug(rol)}-${personaId}-${slug(celda.materia)}`}
      data-estado={celda.estado}
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', fontSize: TIPO.pequeno }}
    >
      <span style={{ color: COLOR_TONO[t.tono], fontWeight: 700 }}>{t.simbolo}</span>
      <span style={{ color: TINTA }}>{celda.materia}</span>
      {t.fuente && <span style={{ color: TINTA_2 }}>· {t.fuente}</span>}
      {enlace && (
        <a href={enlace.href} style={{ color: TINTA }}>
          {enlace.texto}
        </a>
      )}
    </li>
  );
}

function Asignado({ fila, a }) {
  return (
    <div data-testid={`matriz-celda-${slug(fila.rol)}-${a.persona_id}`} style={{ padding: '4px 0' }}>
      <div style={{ fontSize: TIPO.texto, color: TINTA, fontWeight: 600 }}>{a.nombre}</div>
      {a.celdas.length ? (
        <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0, display: 'grid', gap: 2 }}>
          {a.celdas.map((c) => (
            <Materia key={c.materia} rol={fila.rol} personaId={a.persona_id} celda={c} />
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>El rol no pide materias concretas.</div>
      )}
    </div>
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

function Asignar({ fila, ocupados, equipoResp, personas, onAsignar }) {
  const c = candidatosEquipo(equipoResp, personas, ocupados);
  if (!c.sugeridos.length && !c.internos.length && !c.externos.length) return null;
  return (
    <select
      className="input-field"
      value=""
      onChange={(e) => e.target.value && onAsignar(e.target.value)}
      aria-label={`Asignar al rol ${fila.rol}`}
      data-testid={`matriz-asignar-${slug(fila.rol)}-${fila.lote ?? 'todos'}`}
      style={{ maxWidth: '100%', marginTop: 4 }}
    >
      <option value="">Asignar al rol…</option>
      <Grupo etiqueta="Sugeridos" items={c.sugeridos} />
      <Grupo etiqueta="Equipo" items={c.internos} />
      <Grupo etiqueta="Externos" items={c.externos} />
    </select>
  );
}

function Cabecera({ fila }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: TIPO.texto, color: TINTA, fontWeight: 700 }}>{fila.rol}</span>
      {fila.lote && <Chip>Lote {fila.lote}</Chip>}
      {fila.excluyente && (
        <Chip tono="riesgo" punto={false}>
          Excluyente
        </Chip>
      )}
      {fila.materias.length > 0 && (
        <span style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>{fila.materias.join(' · ')}</span>
      )}
      {Number.isInteger(fila.pagina) && (
        <span style={{ fontSize: TIPO.pequeno, color: TINTA_2 }} title={fila.requisito}>
          (pág. {fila.pagina})
        </span>
      )}
    </div>
  );
}

function Fila({ fila, ctx }) {
  const pendientes = pendientesDeGuardar(fila, ctx.equipo);
  const ocupados = [...fila.asignados.map((a) => a.persona_id), ...pendientes];
  return (
    <li
      data-testid={`matriz-fila-${slug(fila.rol)}-${fila.lote ?? 'todos'}`}
      style={{ padding: '8px 0', borderTop: `1px solid ${BORDE}` }}
    >
      <Cabecera fila={fila} />
      {fila.asignados.map((a) => (
        <Asignado key={a.persona_id} fila={fila} a={a} />
      ))}
      {pendientes.map((pid) => (
        <div key={pid} style={{ fontSize: TIPO.pequeno, color: TINTA_2, padding: '2px 0' }}>
          {nombrePersona(pid, ctx.personas, ctx.equipoResp)} · pendiente de guardar
        </div>
      ))}
      {!ocupados.length && (
        <div style={{ fontSize: TIPO.pequeno, color: IMPIDE, padding: '2px 0' }}>✗ Nadie asignado</div>
      )}
      <Asignar
        fila={fila}
        ocupados={ocupados}
        equipoResp={ctx.equipoResp}
        personas={ctx.personas}
        onAsignar={(pid) => ctx.onCambio(asignarAlRol(ctx.equipo, pid, fila))}
      />
    </li>
  );
}

function Contenido({ filas, ctx }) {
  const avisos = avisosIncompatibles(filas);
  return (
    <>
      {avisos.map((t) => (
        <div key={t} data-testid="matriz-incompatible" style={{ marginBottom: 6 }}>
          <Aviso tono="aviso">{t}</Aviso>
        </div>
      ))}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {filas.map((f) => (
          <Fila key={`${f.rol}-${f.lote ?? ''}-${f.requisito}`} fila={f} ctx={ctx} />
        ))}
      </ul>
    </>
  );
}

/**
 * equipo: las filas del formulario ({persona_id, rol_en_la_oferta, dedicacion, lotes});
 * equipoResp y personas: lo cargado por el cajón; recarga: la versión guardada (vuelve a pedir la matriz).
 * Sin roles exigidos devuelve null y quien la monta ofrece el alta suelta.
 */
export default function MatrizEquipo({ id, recarga = 0, equipo, equipoResp, personas = [], onCambio, vacia = null }) {
  const [cv, setCv] = useState(false);
  const m = useCarga(() => licitacionesApi.matrizEquipo(id, { cv }), [id, cv], recarga);
  if (m.kind === 'loading')
    return <div style={{ fontSize: TIPO.pequeno, color: TINTA_2 }}>Cargando la matriz del equipo…</div>;
  if (m.kind === 'error')
    return (
      <>
        <Aviso tono="error">No se pudo cargar la matriz del equipo: {m.message}</Aviso>
        {vacia}
      </>
    );
  if (!m.data.filas.length) return vacia;
  const ctx = { equipo, equipoResp, personas, onCambio };
  return (
    <div data-testid="matriz-equipo">
      <Contenido filas={m.data.filas} ctx={ctx} />
      {!cv && (
        <div style={{ marginTop: 6 }}>
          <Boton
            Icono={FileSearch}
            testid="matriz-buscar-cv"
            onClick={() => setCv(true)}
            title="Busca en los CV de la Biblioteca las materias que Colaboradores no registra"
          >
            Buscar en los CV
          </Boton>
        </div>
      )}
    </div>
  );
}
