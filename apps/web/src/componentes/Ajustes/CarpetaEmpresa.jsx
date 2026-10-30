// Carpeta Empresa: los documentos fijos de la empresa (certificados, ROLECE, AEAT, TGSS, títulos
// y CV con horas desglosadas) con su caducidad. Presentar uno caducado excluye la oferta.
import { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { TINTA, TINTA_2, BORDE } from '../../lib/tema';
import useCarga from '../../hooks/useCarga';
import { carpetaEmpresaApi } from '../../lib/carpetaEmpresaApi';
import { colaboradoresApi } from '../../lib/colaboradoresApi';
import {
  datosSubida,
  etiquetaTipo,
  hoyMadrid,
  preguntaQuitar,
  textoCaducidad,
  tonoCaducidad,
  TIPOS_DOCUMENTO,
} from '../../lib/carpetaEmpresaFormato';
import { urlDocumento } from '../../lib/apiCliente';
import { Aviso, Boton, Campo, Chip } from '../ui';
import { Bloque } from '../comun/ui';
import Confirmacion from '../comun/Confirmacion';

const TONO_CHIP = { peligro: 'impide', aviso: 'riesgo', ok: 'ok', neutro: 'neutro' };
const celda = {
  padding: '6px 8px',
  fontSize: 12.5,
  color: TINTA,
  textAlign: 'left',
  borderBottom: `1px solid ${BORDE}`,
  verticalAlign: 'middle',
};
const INICIAL = { tipo: 'certificado', nombre: '', caduca_en: '', persona_id: '', horas_desglosadas: false };

function Fila({ d, hoy, nombrePersona, onBorrar }) {
  const tono = tonoCaducidad(d.caduca_en, hoy);
  return (
    <tr data-testid={`doc-empresa-${d.id}`} data-tono={tono}>
      <td style={celda}>{etiquetaTipo(d.tipo)}</td>
      <td style={celda}>
        <a href={urlDocumento(d.ruta)} target="_blank" rel="noreferrer" style={{ color: TINTA }}>
          {d.nombre}
        </a>
      </td>
      <td style={celda}>{nombrePersona(d.persona_id)}</td>
      <td style={celda}>
        <Chip tono={TONO_CHIP[tono]} punto={false} testid={`doc-empresa-caducidad-${d.id}`}>
          {textoCaducidad(d.caduca_en, hoy)}
        </Chip>
        {d.caduca_en && <span style={{ color: TINTA_2, marginLeft: 6 }}>{d.caduca_en}</span>}
      </td>
      <td style={celda}>{d.horas_desglosadas ? 'Sí' : '—'}</td>
      <td style={celda}>
        <button
          type="button"
          data-testid={`doc-empresa-quitar-${d.id}`}
          aria-label={`Quitar ${d.nombre}`}
          onClick={() => onBorrar(d)}
          style={{ background: 'none', border: 'none', color: TINTA_2, cursor: 'pointer' }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function Subida({ personas, onSubido }) {
  const [form, setForm] = useState(INICIAL);
  const [archivo, setArchivo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const subir = async () => {
    const d = datosSubida(form);
    if (d.error || !archivo) return setAviso({ tono: 'aviso', texto: d.error ?? 'Elige el archivo a subir.' });
    setOcupado(true);
    try {
      await carpetaEmpresaApi.subir(archivo, d.datos);
      setForm(INICIAL);
      setArchivo(null);
      setAviso(null);
      onSubido();
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div
      data-testid="carpeta-empresa-subida"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}
    >
      <p style={{ fontSize: 12.5, color: TINTA_2, margin: 0 }}>
        Certificados, ROLECE, AEAT, TGSS, títulos y CV con horas desglosadas. Te avisamos 30 días antes de que caduquen.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Campo label="Tipo">
          <select className="input-field" value={form.tipo} onChange={set('tipo')} data-testid="doc-empresa-tipo">
            {TIPOS_DOCUMENTO.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Nombre">
          <input
            className="input-field"
            value={form.nombre}
            onChange={set('nombre')}
            data-testid="doc-empresa-nombre"
          />
        </Campo>
        <Campo label="Caduca el">
          <input
            className="input-field"
            type="date"
            value={form.caduca_en}
            onChange={set('caduca_en')}
            data-testid="doc-empresa-caduca"
          />
        </Campo>
        <Campo label="Persona (opcional)">
          <select
            className="input-field"
            value={form.persona_id}
            onChange={set('persona_id')}
            data-testid="doc-empresa-persona"
          >
            <option value="">—</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Archivo">
          <input
            type="file"
            accept=".pdf,.docx,.jpg,.png"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            data-testid="doc-empresa-archivo"
          />
        </Campo>
      </div>
      <label style={{ fontSize: 12.5, color: TINTA }}>
        <input type="checkbox" checked={form.horas_desglosadas} onChange={set('horas_desglosadas')} /> Con horas
        desglosadas
      </label>
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      <div>
        <Boton escribe Icono={Upload} onClick={subir} cargando={ocupado} testid="doc-empresa-subir">
          Subir documento
        </Boton>
      </div>
    </div>
  );
}

function Tabla({ docs, hoy, nombrePersona, onBorrar }) {
  if (docs.length === 0)
    return (
      <p style={{ fontSize: 12.5, color: TINTA_2, margin: 0 }} data-testid="carpeta-empresa-vacia">
        Aún no hay documentos.
      </p>
    );
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Tipo', 'Nombre', 'Persona', 'Caduca', 'Horas desglosadas', ''].map((h, i) => (
            <th key={i} style={{ ...celda, color: TINTA_2, fontWeight: 600 }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => (
          <Fila key={d.id} d={d} hoy={hoy} nombrePersona={nombrePersona} onBorrar={onBorrar} />
        ))}
      </tbody>
    </table>
  );
}

export default function CarpetaEmpresa() {
  const docs = useCarga(() => carpetaEmpresaApi.documentos().then((r) => r.documentos ?? []), []);
  const personas = useCarga(() => colaboradoresApi.personas().then((r) => r.items ?? []), []);
  const [fallo, setFallo] = useState(null);
  const lista = personas.kind === 'ready' ? personas.data : [];
  const nombrePersona = (id) => lista.find((p) => p.id === id)?.nombre ?? (id ? `#${id}` : '—');
  // Un borrado no se deshace: se pregunta antes, como el resto de borrados de la app.
  const [quitando, setQuitando] = useState(null);
  const borrar = (d) => {
    setQuitando(null);
    return carpetaEmpresaApi.borrar(d.id).then(
      () => {
        setFallo(null);
        return docs.recargar();
      },
      (e) => setFallo(e.message),
    );
  };
  return (
    <div data-testid="carpeta-empresa" style={{ maxWidth: 820 }}>
      <Bloque titulo="CARPETA EMPRESA">
        {docs.kind === 'error' && <Aviso tono="error">{docs.message}</Aviso>}
        {docs.kind === 'loading' && <div style={{ color: TINTA_2, fontSize: 13 }}>Cargando…</div>}
        {fallo && <Aviso tono="error">{fallo}</Aviso>}
        {quitando && (
          <Confirmacion
            {...preguntaQuitar(quitando)}
            textoSi="Quitar"
            destructiva
            onSi={() => borrar(quitando)}
            onNo={() => setQuitando(null)}
          />
        )}
        {docs.kind === 'ready' && (
          <Tabla docs={docs.data} hoy={hoyMadrid()} nombrePersona={nombrePersona} onBorrar={setQuitando} />
        )}
        <Subida personas={lista} onSubido={docs.recargar} />
      </Bloque>
    </div>
  );
}
