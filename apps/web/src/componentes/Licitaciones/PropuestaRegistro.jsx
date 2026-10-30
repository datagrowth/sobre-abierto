// Registro de lo presentado en una licitación: alta de la presentación (lote, fecha,
// importe, documentos) y, después, resultado, puntuaciones, notas y lecciones. Lo escribe
// una persona; el resultado lo pone también la PLACSP al publicar la adjudicación.
import { useState } from 'react';
import { FileText, Pencil, Save, Send, Trash2 } from 'lucide-react';
import { TINTA, TINTA_2, BORDE } from '../../lib/tema';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { euros, fechaHora } from '../../lib/formato';
import { porcentaje } from '../../lib/preciosFormato';
import {
  RESULTADOS,
  camposDeResultado,
  enlaceDocumento,
  etiquetaResultadoPropuesta,
  leerPresentacion,
  leerResultado,
} from '../../lib/propuestasFormato';
import { Aviso, Boton, Campo, Chip } from '../ui';
import Confirmacion from '../comun/Confirmacion';

const TONO_RESULTADO = {
  pendiente: 'neutro',
  ganada: 'ok',
  perdida: 'impide',
  excluida: 'impide',
  desierta: 'riesgo',
  retirada: 'neutro',
};

export function ChipResultado({ resultado }) {
  return (
    <Chip tono={TONO_RESULTADO[resultado]} punto={false}>
      {etiquetaResultadoPropuesta(resultado)}
    </Chip>
  );
}

export function Documentos({ rutas }) {
  if (!rutas.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
      {rutas.map((r) => (
        <a
          key={r}
          href={enlaceDocumento(r)}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 12,
            color: TINTA,
            display: 'inline-flex',
            gap: 6,
            alignItems: 'center',
            wordBreak: 'break-all',
          }}
        >
          <FileText size={12} color={TINTA_2} aria-hidden="true" />
          {r}
        </a>
      ))}
    </div>
  );
}

function Cifra({ label, children }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 11, color: TINTA_2 }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 13, color: TINTA, marginTop: 2 }}>
        {children ?? '—'}
      </div>
    </div>
  );
}

const ETIQUETAS_PUNTOS = [
  ['puntos_tecnica', 'Técnica'],
  ['puntos_economica', 'Económica'],
  ['puntos_total', 'Total'],
  ['puntos_ganador', 'Del ganador'],
];

function CamposPuntos({ campos, poner }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {ETIQUETAS_PUNTOS.map(([k, label]) => (
        <label key={k} style={{ fontSize: 12, color: TINTA_2 }}>
          Puntos: {label}
          <input
            className="input-field"
            inputMode="decimal"
            value={campos[k]}
            onChange={poner(k)}
            style={{ display: 'block', width: 100, marginTop: 3 }}
          />
        </label>
      ))}
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Posición
        <input
          className="input-field"
          inputMode="numeric"
          value={campos.posicion}
          onChange={poner('posicion')}
          style={{ display: 'block', width: 80, marginTop: 3 }}
        />
      </label>
    </div>
  );
}

// Corregir la oferta registrada sin borrarla: un importe mal tecleado cambia la baja.
function CamposCorregirOferta({ campos, poner }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: TINTA_2 }}>
          Fecha de presentación
          <input
            className="input-field"
            type="date"
            value={campos.fecha}
            onChange={poner('fecha')}
            style={{ display: 'block', marginTop: 3 }}
          />
        </label>
        <label style={{ fontSize: 12, color: TINTA_2 }}>
          Importe ofertado sin IVA (€)
          <input
            className="input-field"
            inputMode="decimal"
            value={campos.importe}
            onChange={poner('importe')}
            style={{ display: 'block', width: 160, marginTop: 3 }}
          />
        </label>
      </div>
      <Campo label="Documentos presentados" ayuda="Con su ruta («Salidas/…» o «Conocimiento/…»), uno por línea.">
        <textarea
          className="input-field"
          rows={2}
          value={campos.documentos}
          onChange={poner('documentos')}
          style={{ width: '100%' }}
        />
      </Campo>
    </>
  );
}

function FormResultado({ p, onGuardado, onCancelar }) {
  const [campos, setCampos] = useState(() => camposDeResultado(p));
  const [error, setError] = useState(null);
  const poner = (k) => (e) => setCampos((c) => ({ ...c, [k]: e.target.value }));
  const guardar = async (e) => {
    e.preventDefault();
    const r = leerResultado(campos, p.resultado);
    if (r.error) return setError(r.error);
    try {
      await licitacionesApi.cambiarPropuesta(p.id, r.body);
      onGuardado();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form onSubmit={guardar} style={{ marginTop: 10 }}>
      <CamposCorregirOferta campos={campos} poner={poner} />
      <Campo
        label="Resultado"
        ayuda="Si lo cambias a mano, la PLACSP ya no lo toca; «Pendiente» le devuelve el control."
      >
        <select className="input-field" value={campos.resultado} onChange={poner('resultado')}>
          {RESULTADOS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </Campo>
      <CamposPuntos campos={campos} poner={poner} />
      <Campo label="Notas">
        <textarea
          className="input-field"
          rows={2}
          maxLength={5000}
          value={campos.notas}
          onChange={poner('notas')}
          style={{ width: '100%' }}
        />
      </Campo>
      <Campo
        label="Lecciones aprendidas"
        ayuda="Qué haríamos distinto: lo leen el redactor y el evaluador en las próximas."
      >
        <textarea
          className="input-field"
          rows={3}
          maxLength={5000}
          value={campos.lecciones}
          onChange={poner('lecciones')}
          style={{ width: '100%' }}
        />
      </Campo>
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton Icono={Save} variante="principal" submit>
          Guardar
        </Boton>
        <Boton
          onClick={(e) => {
            e.preventDefault();
            onCancelar();
          }}
        >
          Cancelar
        </Boton>
      </div>
      {error && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
    </form>
  );
}

function Ganador({ p }) {
  if (!p.ganador_nombre && !p.ganador_nif) return null;
  return (
    <div style={{ fontSize: 12, color: TINTA_2, marginTop: 6 }}>
      Adjudicada (PLACSP) a <b style={{ color: TINTA, fontWeight: 600 }}>{p.ganador_nombre ?? p.ganador_nif}</b> por{' '}
      {euros(p.importe_ganador)} · baja {porcentaje(p.baja_ganadora)}
    </div>
  );
}

function CifrasPropuesta({ p }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
      <Cifra label="Presentada">{p.presentada_en}</Cifra>
      <Cifra label="Importe ofertado">{euros(p.importe_ofertado)}</Cifra>
      <Cifra label="Baja ofertada">{porcentaje(p.baja_ofertada)}</Cifra>
      <Cifra label="Puntos (total)">{p.puntos_total}</Cifra>
      <Cifra label="Ganador (puntos)">{p.puntos_ganador}</Cifra>
      <Cifra label="Posición">{p.posicion}</Cifra>
    </div>
  );
}

export function Presentada({ p, onCambio }) {
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState(null);
  const [pideBorrar, setPideBorrar] = useState(false);
  const borrar = async () => {
    setPideBorrar(false);
    try {
      await licitacionesApi.borrarPropuesta(p.id);
      onCambio();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div style={{ padding: '10px 0', borderTop: `1px solid ${BORDE}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: TINTA, fontWeight: 600 }}>
          {p.lote ? `Lote ${p.lote}` : 'Contrato entero'}
        </span>
        <ChipResultado resultado={p.resultado} />
        {p.resultado_origen && <Chip>{p.resultado_origen === 'placsp' ? 'según la PLACSP' : 'puesto a mano'}</Chip>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Boton
            Icono={Pencil}
            onClick={() => setEditando((v) => !v)}
            title="Oferta, resultado, puntos, notas y lecciones"
          >
            Editar
          </Boton>
          <Boton
            Icono={Trash2}
            testid="borrar-propuesta"
            onClick={() => setPideBorrar(true)}
            title="Borrar un registro hecho por error"
          >
            Borrar
          </Boton>
        </span>
      </div>
      {pideBorrar && (
        <div style={{ marginTop: 8 }}>
          <Confirmacion
            pregunta="¿Borrar este registro? La oportunidad se queda en su estado."
            textoSi="Borrar"
            destructiva
            onSi={borrar}
            onNo={() => setPideBorrar(false)}
          />
        </div>
      )}
      <CifrasPropuesta p={p} />
      <Ganador p={p} />
      <Documentos rutas={p.documentos} />
      {p.lecciones && (
        <div style={{ fontSize: 12.5, color: TINTA, marginTop: 6 }}>
          <span style={{ color: TINTA_2 }}>Lecciones:</span> {p.lecciones}
        </div>
      )}
      {editando && (
        <FormResultado
          p={p}
          onGuardado={() => {
            setEditando(false);
            onCambio();
          }}
          onCancelar={() => setEditando(false)}
        />
      )}
      {error && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
      <div style={{ fontSize: 11, color: TINTA_2, marginTop: 4 }}>Actualizada {fechaHora(p.actualizada_en)}</div>
    </div>
  );
}

function ElegirDocumentos({ candidatos, elegidos, onCambio }) {
  if (!candidatos.length) return null;
  const alternar = (r) => onCambio(elegidos.includes(r) ? elegidos.filter((x) => x !== r) : [...elegidos, r]);
  return (
    <div
      role="group"
      aria-label="Documentos presentados"
      style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}
    >
      {candidatos.map((r) => (
        <label
          key={r}
          style={{ fontSize: 12, color: TINTA, display: 'flex', gap: 6, alignItems: 'center', wordBreak: 'break-all' }}
        >
          <input type="checkbox" checked={elegidos.includes(r)} onChange={() => alternar(r)} />
          {r}
        </label>
      ))}
    </div>
  );
}

const VACIO = { lote: '', fecha: '', importe: '', documentos: [], otros: '', notas: '' };

function CamposOferta({ campos, poner }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Lote (vacío: el contrato)
        <input
          className="input-field"
          value={campos.lote}
          onChange={poner('lote')}
          maxLength={20}
          style={{ display: 'block', width: 120, marginTop: 3 }}
        />
      </label>
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Fecha de presentación
        <input
          className="input-field"
          type="date"
          value={campos.fecha}
          onChange={poner('fecha')}
          style={{ display: 'block', marginTop: 3 }}
        />
      </label>
      <label style={{ fontSize: 12, color: TINTA_2 }}>
        Importe ofertado sin IVA (€)
        <input
          className="input-field"
          inputMode="decimal"
          value={campos.importe}
          onChange={poner('importe')}
          placeholder="p. ej. 95.000"
          style={{ display: 'block', width: 160, marginTop: 3 }}
        />
      </label>
    </div>
  );
}

export function FormPresentacion({ id, candidatos, loteInicial = '', onHecho, onCancelar }) {
  const [campos, setCampos] = useState({ ...VACIO, lote: loteInicial });
  const [error, setError] = useState(null);
  const poner = (k) => (e) => setCampos((c) => ({ ...c, [k]: e.target.value }));
  const enviar = async (e) => {
    e.preventDefault();
    const r = leerPresentacion(campos);
    if (r.error) return setError(r.error);
    try {
      await licitacionesApi.registrarPropuesta(id, r.body);
      setCampos(VACIO);
      setError(null);
      onHecho();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form onSubmit={enviar} style={{ marginTop: 10 }}>
      <CamposOferta campos={campos} poner={poner} />
      <Campo
        label="Documentos presentados"
        ayuda="Los de su carpeta en Salidas y en Conocimiento; otros, con su ruta («Salidas/…» o «Conocimiento/…»), uno por línea."
        grupo
      >
        <ElegirDocumentos
          candidatos={candidatos}
          elegidos={campos.documentos}
          onCambio={(documentos) => setCampos((c) => ({ ...c, documentos }))}
        />
        <textarea
          className="input-field"
          rows={2}
          value={campos.otros}
          onChange={poner('otros')}
          aria-label="Otros documentos"
          style={{ width: '100%' }}
        />
      </Campo>
      <Campo label="Notas">
        <textarea
          className="input-field"
          rows={2}
          maxLength={5000}
          value={campos.notas}
          onChange={poner('notas')}
          style={{ width: '100%' }}
        />
      </Campo>
      <div style={{ display: 'flex', gap: 8 }}>
        <Boton Icono={Send} variante="principal" submit>
          Registrar presentación
        </Boton>
        <Boton
          onClick={(e) => {
            e.preventDefault();
            onCancelar();
          }}
        >
          Cancelar
        </Boton>
      </div>
      {error && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
    </form>
  );
}
