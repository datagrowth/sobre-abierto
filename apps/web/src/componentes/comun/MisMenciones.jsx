// Las menciones de quien entra, en la barra lateral junto a su nombre: cuántas siguen sin
// leer y la lista para ir a cada una. Abrir una la da por leída; abrir la pestaña donde está, también
// (useComentarios). Se relee cada minuto y cuando llega un comentario.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign } from 'lucide-react';
import { plataformaApi } from '../../lib/plataformaApi';
import { textoMencion } from '../../lib/comentariosFormato';
import { fechaHora } from '../../lib/formato';
import { irAHash } from '../../hooks/useRuta';
import { salirCon } from '../../hooks/useCambiosSinGuardar';

const CADA_MS = 60_000;

function useMenciones() {
  const [datos, setDatos] = useState({ sin_leer: 0, menciones: [] });
  const cargar = useCallback(() => plataformaApi.menciones().then(setDatos, () => undefined), []);
  useEffect(() => {
    cargar();
    const iv = setInterval(cargar, CADA_MS);
    const alEvento = (e) => {
      if (e.detail?.tipo === 'plataforma.comentario') cargar();
    };
    window.addEventListener('plataforma', alEvento);
    window.addEventListener('menciones-leidas', cargar);
    return () => {
      clearInterval(iv);
      window.removeEventListener('plataforma', alEvento);
      window.removeEventListener('menciones-leidas', cargar);
    };
  }, [cargar]);
  return { ...datos, cargar };
}

export default function MisMenciones() {
  const m = useMenciones();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => {
      if (!raiz.current?.contains(e.target)) setAbierto(false);
    };
    const tecla = (e) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);
  if (!m.sin_leer) return null;
  const ir = (x) => {
    setAbierto(false);
    plataformaApi.leerMenciones([x.comentario]).then(m.cargar, () => undefined);
    salirCon(() => irAHash(x.enlace));
  };
  const todas = () => {
    setAbierto(false);
    plataformaApi.leerMenciones(null).then(m.cargar, () => undefined);
  };
  return (
    <div ref={raiz} className="relative" style={{ padding: '0 6px' }}>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
        data-testid="mis-menciones"
        className="w-full inline-flex items-center gap-1.5 rounded-control border-0 bg-transparent px-1 py-1 text-leyenda text-tinta cursor-pointer hover:bg-superficie-2"
      >
        <AtSign size={14} aria-hidden="true" />
        <span>{m.sin_leer === 1 ? '1 mención sin leer' : `${m.sin_leer} menciones sin leer`}</span>
      </button>
      {abierto && (
        <div
          role="dialog"
          aria-label="Menciones sin leer"
          className="absolute bottom-full left-0 z-30 mb-1 w-72 max-h-80 overflow-y-auto grid gap-1 p-1.5 bg-lienzo border border-borde rounded-control shadow-capa"
        >
          {m.menciones.map((x) => (
            <button
              key={x.comentario}
              type="button"
              onClick={() => ir(x)}
              data-testid={`mencion-${x.comentario}`}
              className="grid gap-0.5 text-left rounded-control border-0 bg-transparent px-2 py-1.5 cursor-pointer hover:bg-superficie-2"
            >
              <b className="text-tabla font-medium text-tinta">{textoMencion(x)}</b>
              <span className="text-leyenda text-tinta-2 line-clamp-2">{x.texto}</span>
              <span className="text-leyenda text-tinta-2">{fechaHora(x.creado_en)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={todas}
            className="text-left rounded-control border-0 bg-transparent px-2 py-1.5 text-leyenda text-tinta underline cursor-pointer"
          >
            Marcar todas como leídas
          </button>
        </div>
      )}
    </div>
  );
}
