// Tarjeta «propuesta de decisiones» de la bandeja de revisión: lo guardado frente a lo
// que propone Hermes, campo a campo, con «Aplicar» por fila: «Cargarla en el
// formulario» pisaba todo para cambiar un solo plazo. Las filas de
// acreditación se aplican de una en una (son una declaración) y una propuesta de otro guion no
// se aplica: Hermes la rehace. Tras aplicar se relee el diff, y la fila pasa a «Sin cambios».
import { useState } from 'react';
import { BORDE, TINTA_2, TINTA, TIPO, RIESGO } from '../../../../lib/tema';
import { revisionApi } from '../../../../lib/revisionApi';
import { colaboradoresApi } from '../../../../lib/colaboradoresApi';
import {
  esObsoleta,
  etiquetaCampo,
  filasVisibles,
  resumenAplicar,
  textoCabeceraDiff,
  textoObsoleta,
  textoValor,
} from '../../../../lib/diffPropuestaFormato';
import useCarga from '../../../../hooks/useCarga';
import { Aviso, Boton } from '../../../ui';

const celda = {
  padding: '6px 8px',
  borderTop: `1px solid ${BORDE}`,
  verticalAlign: 'top',
  fontSize: TIPO.texto,
  color: TINTA,
};
const cabecera = {
  ...celda,
  borderTop: 'none',
  color: TINTA_2,
  fontWeight: 600,
  textAlign: 'left',
  fontSize: TIPO.pequeno,
};

function Motivo({ texto }) {
  if (!texto) return null;
  return (
    <details style={{ marginTop: 4, fontSize: TIPO.pequeno, color: TINTA_2 }}>
      <summary style={{ cursor: 'pointer' }}>Por qué lo propone Hermes</summary>
      <div style={{ marginTop: 2 }}>{texto}</div>
    </details>
  );
}

function Fila({ c, nombre, accion }) {
  return (
    <tr data-testid={`diff-fila-${c.campo}`}>
      <td style={celda}>
        {etiquetaCampo(c, nombre)}
        {c.acreditacion && (
          <div style={{ fontSize: TIPO.pequeno, color: RIESGO }}>Acreditación: confírmala una a una</div>
        )}
      </td>
      <td style={{ ...celda, color: TINTA_2 }}>{textoValor(c.seccion, c.guardado, nombre)}</td>
      <td style={celda}>
        {textoValor(c.seccion, c.propuesto, nombre)}
        <Motivo texto={c.motivo_hermes} />
      </td>
      <td style={celda}>{accion}</td>
    </tr>
  );
}

function Tabla({ campos, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cabecera}>Campo</th>
            <th style={cabecera}>Guardado</th>
            <th style={cabecera}>Propuesta de Hermes</th>
            <th style={cabecera} aria-label="Acción" />
          </tr>
        </thead>
        <tbody>{campos.map(children)}</tbody>
      </table>
    </div>
  );
}

function SinCambios({ iguales, nombre }) {
  if (!iguales.length) return null;
  return (
    <details data-testid="diff-sin-cambios" style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
      <summary style={{ cursor: 'pointer' }}>Sin cambios ({iguales.length})</summary>
      <Tabla campos={iguales}>{(c) => <Fila key={c.campo} c={c} nombre={nombre} accion={null} />}</Tabla>
    </details>
  );
}

// Los nombres del equipo, para no enseñar «Persona 7»: sin ellos, el diff se lee igual.
function useNombres() {
  const p = useCarga(() => colaboradoresApi.personas().then((r) => r.items ?? []), []);
  return (personaId) => p.data?.find((x) => x.id === Number(personaId))?.nombre ?? null;
}

function useAplicar(id, alAplicar) {
  const [ocupado, setOcupado] = useState(null);
  const [error, setError] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const aplicar = async (clave, campos) => {
    setOcupado(clave);
    setError(null);
    try {
      const r = await revisionApi.aplicar(id, campos);
      setAvisos(r?.avisos ?? []);
      alAplicar();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(null);
    }
  };
  return { aplicar, ocupado, error, avisos };
}

function Diff({ id, onCambio }) {
  const d = useCarga(() => revisionApi.diff(id), [id]);
  const nombre = useNombres();
  const a = useAplicar(id, () => {
    d.recargar();
    onCambio?.();
  });
  if (d.kind === 'error') return <Aviso tono="error">{d.message}</Aviso>;
  if (!d.data) return <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>Cargando la propuesta…</div>;
  const obsoleta = esObsoleta(d.data);
  const { cambios, iguales } = filasVisibles(d.data.campos);
  const todo = resumenAplicar(d.data.campos);
  const boton = (c) => (
    <Boton
      testid={`aplicar-fila-${c.campo}`}
      escribe
      disabled={obsoleta || a.ocupado !== null}
      cargando={a.ocupado === c.campo}
      onClick={() => a.aplicar(c.campo, [c.campo])}
    >
      Aplicar
    </Boton>
  );
  return (
    <div data-testid="diff-propuesta" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div data-testid="diff-cabecera" style={{ fontSize: TIPO.texto, color: TINTA_2 }}>
        {textoCabeceraDiff(d.data)}
      </div>
      {obsoleta && (
        <Aviso tono="aviso">
          <span data-testid="diff-obsoleta">{textoObsoleta(d.data)}</span>
        </Aviso>
      )}
      {cambios.length > 0 && (
        <div>
          <Boton
            testid="aplicar-todo"
            variante="principal"
            escribe
            disabled={obsoleta || !todo.claves.length || a.ocupado !== null}
            cargando={a.ocupado === 'todo'}
            onClick={() => a.aplicar('todo', todo.claves)}
          >
            {todo.texto}
          </Boton>
        </div>
      )}
      {cambios.length === 0 && (
        <div style={{ fontSize: TIPO.texto, color: TINTA_2 }}>Lo guardado ya coincide con la propuesta.</div>
      )}
      {cambios.length > 0 && (
        <Tabla campos={cambios}>{(c) => <Fila key={c.campo} c={c} nombre={nombre} accion={boton(c)} />}</Tabla>
      )}
      <SinCambios iguales={iguales} nombre={nombre} />
      {a.avisos.map((t) => (
        <Aviso key={t} tono="aviso">
          {t}
        </Aviso>
      ))}
      {a.error && <Aviso tono="error">{a.error}</Aviso>}
    </div>
  );
}

export default function DiffPropuesta({ tarjeta, onAbrir, id, onCambio }) {
  const [abierta, setAbierta] = useState(false);
  const abrir = () => {
    setAbierta(true);
    onAbrir?.();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>{tarjeta.titulo}</div>
      <div style={{ fontSize: 12.5, color: TINTA_2 }}>{tarjeta.resumen}</div>
      {abierta ? (
        <Diff id={id} onCambio={onCambio} />
      ) : (
        <div>
          <Boton testid={`abrir-${tarjeta.clave}`} onClick={abrir}>
            Abrir
          </Boton>
        </div>
      )}
    </div>
  );
}
