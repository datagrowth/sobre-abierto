// Quién lleva la oferta, en la cabecera de la ficha: su avatar y, para quien puede
// guardar, el selector para dársela a otra persona del equipo o a nadie. Al preparar la oferta la
// lleva quien pulsa; aquí se cambia.
import { useState } from 'react';
import useCompaneros from '../../hooks/useCompaneros';
import useUsuario from '../../hooks/useUsuario';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { opcionesResponsable } from '../../lib/responsableFormato';
import { puede } from '../../lib/usuarioActual';
import { Iniciales, Selector } from '../ui';

export default function ResponsableOferta({ f, onCambio }) {
  const yo = useUsuario();
  const companeros = useCompaneros();
  const [estado, setEstado] = useState({ ocupado: false, error: null });
  const r = f.responsable;
  const cambiar = async (valor) => {
    setEstado({ ocupado: true, error: null });
    try {
      await licitacionesApi.cambiarResponsable(f.id, valor ? Number(valor) : null);
      onCambio();
      setEstado({ ocupado: false, error: null });
    } catch (e) {
      setEstado({ ocupado: false, error: e.message });
    }
  };
  if (!puede(yo, 'editor')) {
    return r ? (
      <span data-testid="ficha-responsable" className="inline-flex items-center gap-1.5 text-tabla text-tinta">
        <Iniciales nombre={r.nombre} decorativo />
        {r.nombre}
      </span>
    ) : null;
  }
  return (
    <span data-testid="ficha-responsable" className="inline-flex items-center gap-1.5">
      {r && <Iniciales nombre={r.nombre} decorativo />}
      <Selector
        aria-label="Responsable de la oferta"
        value={r ? String(r.id) : ''}
        disabled={estado.ocupado}
        onChange={(e) => cambiar(e.target.value)}
        opciones={opcionesResponsable(companeros, r)}
        className="w-auto py-1"
        data-testid="ficha-responsable-selector"
        title={estado.error ?? undefined}
        aria-invalid={estado.error ? true : undefined}
      />
    </span>
  );
}
