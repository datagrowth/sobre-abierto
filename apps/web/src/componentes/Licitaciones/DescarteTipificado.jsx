// Descartar desde la web: siempre con el motivo tipificado y unas palabras. El tipo
// alimenta «Qué nos falta» y el aviso «Descartada el … por …»; el servidor lo exige igual.
import { useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { MOTIVOS_DESCARTE, cuerpoDescarte } from '../../lib/licitacionesFormato';
import useAccionAviso from '../../hooks/useAccionAviso';
import { Aviso, Boton } from '../ui';

/** testid: el del contenedor (la Mesa y las comprobaciones tienen el suyo); los campos llevan los mismos. */
export default function DescarteTipificado({ id, onHecho, onCancelar, testid = 'mesa-descarte' }) {
  const [tipo, setTipo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [aviso, hacer, ocupado] = useAccionAviso(() => {});
  const enviar = () =>
    hacer(async () => {
      const c = cuerpoDescarte({ tipo, motivo });
      if (c.error) throw new Error(c.error);
      await licitacionesApi.cambiar(id, c.data);
      onHecho();
    }, 'Descartada.');
  return (
    <div data-testid={testid} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <select
        className="input-field"
        aria-label="Motivo del descarte"
        value={tipo}
        onChange={(e) => setTipo(e.target.value)}
        data-testid="descarte-tipo"
      >
        <option value="">Elige el motivo…</option>
        {MOTIVOS_DESCARTE.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <input
        className="input-field"
        aria-label="Dilo en pocas palabras"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={300}
        placeholder="Dilo en pocas palabras"
        data-testid="descarte-motivo"
        style={{ flex: '1 1 200px' }}
      />
      <Boton variante="peligro" escribe cargando={ocupado} testid="descarte-confirmar" onClick={enviar}>
        Descartar
      </Boton>
      <Boton onClick={onCancelar}>Cancelar</Boton>
      {aviso?.tono === 'error' && <Aviso tono="error">{aviso.texto}</Aviso>}
    </div>
  );
}
