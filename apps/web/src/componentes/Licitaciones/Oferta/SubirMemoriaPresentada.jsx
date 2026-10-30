// La memoria que se entregó, hecha fuera de la plataforma: se sube tal cual (PDF o Word, también
// con el plazo vencido) y pasa a ser LA memoria de la oferta. Aquí se ve con su etiqueta
// «Presentada», sus archivos, su nota y lo que Hermes aprende de ella; no se revisa, no se
// mejora ni se descarta (lo entregado no cambia). Subir otra la sustituye: la anterior pasa al
// historial de MemoriaOferta (versionesDeLaVista).
import { useEffect, useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, BORDE_CONTROL, ACCION, RIESGO, RADIUS, TIPO, alpha } from '../../../lib/tema';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { fechaHora } from '../../../lib/formato';
import { enlaceDocumento } from '../../../lib/propuestasFormato';
import { estadoEvaluacionMemoria, textoEvaluacionMemoria } from '../../../lib/memoriaFormato';
import {
  errorArchivoPresentada,
  memoriaPresentada,
  rutasPresentada,
  textoBotonPresentada,
  textoSubidaPresentada,
} from '../../../lib/memoriaPresentadaFormato';
import { EVENTO_ABRIR_PRESENTADA, esAbrirPresentada } from '../../../lib/subidaVersionFormato';
import useAccionAviso from '../../../hooks/useAccionAviso';
import { Aviso, Boton, Chip } from '../../ui';
import Lecciones from './Lecciones';

const texto = { fontSize: TIPO.texto, color: TINTA, lineHeight: 1.5 };
const apagado = { fontSize: TIPO.pequeno, color: TINTA_2 };
const NOMBRE_DOC = { '.docx': 'Word presentado', '.pdf': 'PDF', '.md': 'Texto' };

function Enlace({ ruta, primero }) {
  const ext = (ruta.match(/\.[a-z]+$/i)?.[0] ?? '').toLowerCase();
  const nombre = primero ? (ext === '.pdf' ? 'PDF presentado' : 'Word presentado') : (NOMBRE_DOC[ext] ?? 'Abrir');
  return (
    <a
      href={enlaceDocumento(ruta)}
      target="_blank"
      rel="noreferrer"
      title={ruta}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        minHeight: 32,
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: RADIUS,
        border: `1px solid ${BORDE_CONTROL}`,
        color: TINTA,
        textDecoration: 'none',
      }}
    >
      <FileText size={14} aria-hidden="true" />
      {nombre}
    </a>
  );
}

function Presentada({ id, m, onCambio }) {
  const e = estadoEvaluacionMemoria(m);
  const nota = e?.evaluacion ? textoEvaluacionMemoria(e.evaluacion) : e?.enCurso ? 'Hermes la está evaluando…' : null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: TINTA }}>Memoria presentada v{m.version}</span>
        <Chip tono="ok" punto={false}>
          Presentada
        </Chip>
        <span style={apagado}>subida {fechaHora(m.pedida_en)}</span>
      </div>
      {m.origen?.subida && <div style={{ ...texto, color: TINTA_2, marginTop: 2 }}>«{m.origen.subida}»</div>}
      {nota && (
        <div style={{ ...texto, marginTop: 4 }}>
          <span style={{ color: TINTA_2 }}>Nota de Hermes: </span>
          {nota}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {rutasPresentada(m).map((r, i) => (
          <Enlace key={r} ruta={r} primero={i === 0} />
        ))}
      </div>
      {m.avisos.map((v) => (
        <div key={v} style={{ ...texto, color: RIESGO, marginTop: 4 }}>
          {v}
        </div>
      ))}
      <Lecciones id={id} m={m} onCambio={onCambio} />
    </div>
  );
}

// lote: el de la memoria presentada si el pliego pide una por lote (null: la común).
function Panel({ id, lote = null, onCambio, onCerrar }) {
  const entrada = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [notas, setNotas] = useState('');
  const [aviso, hacer, ocupado] = useAccionAviso(onCambio);
  const error = archivo ? errorArchivoPresentada(archivo) : null;
  // Subida, el archivo y las notas se vacían: el botón se apaga y un segundo clic no crea otra presentada.
  const hecha = (r) => {
    setArchivo(null);
    setNotas('');
    if (entrada.current) entrada.current.value = '';
    return textoSubidaPresentada(r);
  };
  const subir = () => hacer(() => licitacionesApi.subirMemoriaPresentada(id, archivo, notas.trim(), lote), hecha);
  const clave = `${id}-${lote ?? 'comun'}`;
  return (
    <section
      data-testid={`subir-presentada-panel-${lote ?? 'comun'}`}
      aria-label={lote ? `Subir la memoria presentada del lote ${lote}` : 'Subir la memoria presentada'}
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: RADIUS,
        border: `1px solid ${alpha(ACCION, 0.45)}`,
        background: alpha(ACCION, 0.05),
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={entrada}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          aria-label="Memoria presentada (PDF o Word)"
        />
        <Boton Icono={Upload} onClick={() => entrada.current?.click()}>
          {archivo ? 'Cambiar archivo' : 'Elegir archivo'}
        </Boton>
        <span style={{ ...texto, wordBreak: 'break-all' }}>
          {archivo?.name ?? <span style={apagado}>El PDF o el Word tal como se entregó, con sus anexos.</span>}
        </span>
      </div>
      {error && <div style={{ ...texto, color: RIESGO, marginTop: 4 }}>{error}</div>}
      <label
        htmlFor={`notas-presentada-${clave}`}
        style={{ ...texto, fontWeight: 600, display: 'block', margin: '12px 0 4px' }}
      >
        Notas (opcional)
      </label>
      <textarea
        id={`notas-presentada-${clave}`}
        className="input-field"
        rows={3}
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        placeholder="Qué cambiasteis respecto a la versión de Hermes y por qué: Hermes aprende de ello."
        style={{ width: '100%', resize: 'vertical' }}
      />
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: 10,
          paddingTop: 10,
          borderTop: `1px solid ${BORDE}`,
        }}
      >
        <Boton
          Icono={Upload}
          variante="principal"
          testid={`subir-presentada-enviar-${lote ?? 'comun'}`}
          disabled={!archivo || Boolean(error)}
          cargando={ocupado}
          onClick={subir}
          title="Se guarda tal cual y pasa a ser la memoria de la oferta"
        >
          Subir como presentada
        </Boton>
        <Boton onClick={onCerrar}>Cancelar</Boton>
      </div>
      <div style={{ ...apagado, marginTop: 6 }}>
        Si encuentra los títulos de los apartados del guion la reparte por apartados; si no, la guarda entera. Ya no se
        revisa ni se piden cambios.
      </div>
      {aviso && (
        <div style={{ marginTop: 8 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </section>
  );
}

/**
 * El botón y su panel. lote: la presentada de ese lote (memoria por lote; solo sustituye a la de ese
 * lote); porLotes: la oferta va con una memoria por lote y esta es la común; hay: ya hay una.
 */
export function BotonSubirPresentada({ id, lote = null, porLotes = false, hay = false, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef(null);
  // «Súbela como presentada» desde «Subir mi Word» (SubirVersion.jsx) abre el panel de su lote y lo enseña.
  useEffect(() => {
    const abrir = (e) => {
      if (!esAbrirPresentada(e.detail, id, lote)) return;
      setAbierto(true);
      boton.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(EVENTO_ABRIR_PRESENTADA, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_PRESENTADA, abrir);
  }, [id, lote]);
  return (
    <>
      <div ref={boton} data-testid={`subir-presentada-${lote ?? 'comun'}`}>
        <Boton
          Icono={Upload}
          disabled={abierto}
          onClick={() => setAbierto(true)}
          title={
            hay
              ? 'Sustituye a la presentada (la anterior queda en el historial)'
              : 'La memoria que se entregó, hecha fuera de la plataforma'
          }
        >
          {textoBotonPresentada(lote, porLotes)}
        </Boton>
      </div>
      {abierto && <Panel id={id} lote={lote} onCambio={onCambio} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

/** Visible siempre que haya oferta, también sin guion de memoria. porLotes: el pliego pide una memoria por lote. */
export default function SubirMemoriaPresentada({ id, o, porLotes = false, onCambio }) {
  if (!o) return null;
  const vigente = memoriaPresentada(o.memorias ?? []);
  return (
    <section
      aria-label="Memoria presentada"
      style={{ marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${BORDE}` }}
    >
      {vigente && <Presentada id={id} m={vigente} onCambio={onCambio} />}
      <div style={{ marginTop: vigente ? 10 : 0 }}>
        <BotonSubirPresentada id={id} porLotes={porLotes} hay={Boolean(vigente)} onCambio={onCambio} />
      </div>
    </section>
  );
}
