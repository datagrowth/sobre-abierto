// «Subir un pliego que falta»: lo que la PLACSP no dejó bajar (o una rectificación) se sube a mano
// a la carpeta de pliegos; la Biblioteca lo indexa y, si rectifica, la ficha se rehace sola.
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { subirPliego } from '../../lib/pliegosApi';
import { AYUDA_SUBIDA, errorArchivo, textoTrasSubir } from '../../lib/pliegosFormato';
import { TINTA_2, IMPIDE } from '../../lib/tema';
import { Boton } from '../ui';

const CADA_MS = 5000;
const MAX_REVISIONES = 24;

// Mientras se indexa se vuelve a pedir la ficha para ver el estado de los pliegos.
function useRevision(subido, indexado, onCambio) {
  useEffect(() => {
    if (!subido || indexado) return undefined;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > MAX_REVISIONES) clearInterval(t);
      else onCambio?.();
    }, CADA_MS);
    return () => clearInterval(t);
  }, [subido, indexado, onCambio]);
}

export default function SubirPliego({ id, sinIndexar = 0, onCambio }) {
  const entrada = useRef(null);
  const [estado, setEstado] = useState({ ocupado: false, error: null, subido: null });
  const indexado = Boolean(estado.subido) && sinIndexar === 0;
  useRevision(Boolean(estado.subido), indexado, onCambio);
  const elegir = async (e) => {
    const archivo = e.target.files?.[0] ?? null;
    e.target.value = '';
    const error = errorArchivo(archivo);
    if (error) {
      setEstado({ ocupado: false, error, subido: null });
      return;
    }
    setEstado({ ocupado: true, error: null, subido: null });
    try {
      const r = await subirPliego(id, archivo);
      setEstado({ ocupado: false, error: null, subido: { duplicado: r?.duplicado ?? null } });
      onCambio?.();
    } catch (err) {
      setEstado({ ocupado: false, error: err.message, subido: null });
    }
  };
  return (
    <div data-testid="subir-pliego" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      <span style={{ fontSize: 12, color: TINTA_2 }}>{AYUDA_SUBIDA}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          ref={entrada}
          type="file"
          hidden
          data-testid="subir-pliego-archivo"
          aria-label="Pliego que falta"
          onChange={elegir}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.zip,.xml"
        />
        <Boton
          Icono={Upload}
          escribe
          testid="subir-pliego-boton"
          cargando={estado.ocupado}
          onClick={() => entrada.current?.click()}
        >
          Subir un pliego que falta
        </Boton>
        {estado.subido && (
          <span role="status" data-testid="subir-pliego-estado" style={{ fontSize: 12.5 }}>
            {textoTrasSubir({ indexado, duplicado: estado.subido.duplicado })}
          </span>
        )}
        {estado.error && (
          <span role="alert" style={{ fontSize: 12.5, color: IMPIDE }}>
            {estado.error}
          </span>
        )}
      </div>
    </div>
  );
}
