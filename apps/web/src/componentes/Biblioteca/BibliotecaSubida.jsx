// Subir un documento a la Biblioteca (carpeta Conocimiento de Drive): llega a Drive
// en un minuto y se puede buscar en cuanto el indexador lo lee.
import { useEffect, useId, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { TINTA, TINTA_2, BORDE, LIENZO, RADIUS, RADIUS_PANEL, SOMBRA_CAPA } from '../../lib/tema';
import { subirDocumento } from '../../lib/apiCliente';
import { Aviso, Boton } from '../ui';

const FORMATOS = '.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.csv,.md';

export default function BibliotecaSubida() {
  const [abierto, setAbierto] = useState(false);
  const abridor = useRef(null);

  // Al cerrar, el foco vuelve al botón que lo abrió en vez de perderse en <body>.
  const cerrar = () => {
    setAbierto(false);
    abridor.current?.querySelector('button')?.focus();
  };

  return (
    <span ref={abridor}>
      <Boton Icono={Upload} onClick={() => setAbierto(true)}>
        Subir documento
      </Boton>
      {abierto && <DialogoSubida onCerrar={cerrar} />}
    </span>
  );
}

function DialogoSubida({ onCerrar }) {
  const [carpeta, setCarpeta] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const input = useRef(null);
  const primerCampo = useRef(null);
  const tituloId = useId();

  // Foco al primer campo al abrir: quien usa teclado empieza a escribir sin buscar el diálogo.
  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  const subir = async () => {
    if (!archivo) return;
    setSubiendo(true);
    setAviso(null);
    try {
      const r = await subirDocumento(archivo, carpeta.trim());
      setAviso({
        tono: 'info',
        texto: `Subido a ${r.ruta}. En unos segundos se podrá buscar; en un minuto estará en Drive.`,
      });
      setArchivo(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setSubiendo(false);
    }
  };
  const alTeclear = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onCerrar();
  };

  return (
    <div
      role="dialog"
      aria-labelledby={tituloId}
      onKeyDown={alTeclear}
      style={{
        position: 'absolute',
        right: 18,
        top: 92,
        zIndex: 30,
        width: 'min(420px, calc(100vw - 32px))',
        padding: 14,
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        boxShadow: SOMBRA_CAPA,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h2 id={tituloId} style={{ fontSize: 14, fontWeight: 700, color: TINTA, margin: 0 }}>
          Subir documento
        </h2>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar subir documento"
          title="Cerrar (Esc)"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            color: TINTA_2,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            borderRadius: RADIUS,
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <label style={{ display: 'block', fontSize: 12.5, color: TINTA, marginBottom: 10 }}>
        Carpeta
        <input
          ref={primerCampo}
          className="input-field"
          value={carpeta}
          onChange={(e) => setCarpeta(e.target.value)}
          placeholder="p. ej. Empresa o Licitaciones/Presentadas/… (vacío = raíz)"
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <label style={{ display: 'block', fontSize: 12.5, color: TINTA, marginBottom: 6 }}>
        Archivo
        <input
          ref={input}
          type="file"
          accept={FORMATOS}
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          style={{ display: 'block', marginTop: 4, color: TINTA_2, fontSize: 12 }}
        />
      </label>
      <div style={{ fontSize: 11.5, color: TINTA_2, marginBottom: 10 }}>
        PDF, Office, OpenDocument, texto o markdown; hasta 100 MB. Nunca reemplaza un archivo con el mismo nombre.
      </div>
      <Boton variante="principal" Icono={Upload} disabled={!archivo} cargando={subiendo} onClick={subir}>
        {subiendo ? 'Subiendo…' : 'Subir'}
      </Boton>
      {aviso && (
        <div style={{ marginTop: 10 }}>
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}
