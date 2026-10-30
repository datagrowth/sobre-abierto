// Sube un CV a Colaboradores/ y pide a Hermes que lo lea. Con personaId, el perfil que
// proponga actualiza a esa persona; sin él, sería otra persona (la subida nunca pisa un
// archivo: el CV nuevo de alguien tiene otra ruta y no se le podría asociar).
import { useRef } from 'react';
import { FileUp } from 'lucide-react';
import { altaDesdeCv } from '../../lib/colaboradoresApi';
import { Boton } from '../ui';

export default function SubirCv({ personaId, onAviso, title, children }) {
  const input = useRef(null);
  const subir = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      const ruta = await altaDesdeCv(archivo, personaId);
      onAviso({ tono: 'info', texto: `CV guardado en ${ruta}. Hermes lo leerá y dejará el perfil en «Por aprobar».` });
    } catch (err) {
      onAviso({ tono: 'error', texto: err.message });
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.odt,.md,.txt"
        onChange={subir}
        style={{ display: 'none' }}
        aria-label="CV a subir"
      />
      <Boton Icono={FileUp} onClick={() => input.current?.click()} title={title}>
        {children}
      </Boton>
    </>
  );
}
