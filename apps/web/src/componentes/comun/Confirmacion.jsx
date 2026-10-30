// Confirmación en la propia página (no un window.confirm): se lee junto a lo que se va a
// cambiar, Escape cancela y, si lo pide, exige un motivo de una frase (leerMotivo).
import { useEffect, useId, useRef, useState } from 'react';
import { TINTA, TINTA_2, SUPERFICIE_2, RADIUS, IMPIDE, RIESGO, alpha } from '../../lib/tema';
import { leerMotivo } from '../../lib/comprobacionesFormato';
import { CONFIRMACION, CONFIRMACION_NO, CONFIRMACION_SI } from '../../lib/idsPrueba';
import { Boton } from '../ui';

function CampoMotivo({ id, texto, setTexto, error }) {
  return (
    <div style={{ marginTop: 8 }}>
      <label htmlFor={id} style={{ fontSize: 12.5, color: TINTA_2 }}>
        Motivo
      </label>
      <textarea
        id={id}
        className="input-field"
        rows={2}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
        data-testid="confirmacion-motivo"
        style={{ width: '100%', marginTop: 4, resize: 'vertical' }}
      />
      {error && (
        <div role="alert" style={{ fontSize: 12, color: IMPIDE, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** onSi(motivo): con `conMotivo`, el motivo ya validado; sin él, sin argumentos. */
export default function Confirmacion({
  pregunta,
  detalle = null,
  textoSi = 'Sí',
  textoNo = 'Cancelar',
  destructiva = false,
  conMotivo = false,
  onSi,
  onNo,
}) {
  const ids = useId();
  const caja = useRef(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(null);
  // Con motivo, el foco va donde hay que escribir; si no, al botón principal.
  useEffect(() => {
    caja.current?.querySelector(conMotivo ? 'textarea' : `[data-testid="${CONFIRMACION_SI}"]`)?.focus();
  }, [conMotivo]);
  const si = () => {
    if (!conMotivo) return onSi();
    const r = leerMotivo(texto);
    if (r.error) return setError(r.error);
    return onSi(r.motivo);
  };
  const alTeclear = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onNo();
    }
  };
  return (
    <div
      ref={caja}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${ids}-p`}
      aria-describedby={detalle ? `${ids}-d` : undefined}
      data-testid={CONFIRMACION}
      onKeyDown={alTeclear}
      style={{
        padding: 12,
        borderRadius: RADIUS,
        background: SUPERFICIE_2,
        border: `1px solid ${destructiva ? alpha(IMPIDE, 0.6) : alpha(RIESGO, 0.5)}`,
      }}
    >
      <div id={`${ids}-p`} style={{ fontSize: 13, fontWeight: 600, color: TINTA }}>
        {pregunta}
      </div>
      {detalle && (
        <div id={`${ids}-d`} style={{ fontSize: 12.5, color: TINTA_2, marginTop: 4, lineHeight: 1.5 }}>
          {detalle}
        </div>
      )}
      {conMotivo && (
        <CampoMotivo
          id={`${ids}-m`}
          texto={texto}
          setTexto={(t) => {
            setTexto(t);
            setError(null);
          }}
          error={error}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Boton variante={destructiva ? 'peligro' : 'principal'} escribe testid={CONFIRMACION_SI} onClick={si}>
          {textoSi}
        </Boton>
        <Boton testid={CONFIRMACION_NO} onClick={onNo}>
          {textoNo}
        </Boton>
      </div>
    </div>
  );
}
