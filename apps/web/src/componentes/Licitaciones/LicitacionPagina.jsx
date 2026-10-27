// La ficha de una licitación en su propia página (#/licitacion/<id>/<pestaña>), con las migas a
// la lista de la que cuelga (Pipeline si es una oferta nuestra; Oportunidades si aún no) y el
// ancho de lectura de 1.200 px. Se recarga con los eventos de licitaciones como antes en la lista.
import { useState } from 'react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { leerFoco } from '../../lib/rutas';
import { seccionDeLicitacion } from '../../lib/navegacion';
import useRuta from '../../hooks/useRuta';
import useEstadoDominio from '../../hooks/useEstadoDominio';
import useAnchoPantalla from '../../hooks/useAnchoPantalla';
import { Migas } from '../comun/PanelDominio';
import FichaLicitacion from './FichaLicitacion';

export default function LicitacionPagina() {
  const ruta = useRuta();
  const { isSmall } = useAnchoPantalla();
  const { version } = useEstadoDominio(licitacionesApi.estado, 'licitacion');
  const [ficha, setFicha] = useState(null);
  const foco = leerFoco(ruta.id);
  const origen = seccionDeLicitacion(ficha?.id === foco.id ? ficha : null);
  const volver = () => ruta.ir(origen.seccion, origen.vista);
  return (
    <div className="flex-1 overflow-auto" data-testid="pagina-licitacion">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-4 md:py-5 grid grid-cols-[minmax(0,1fr)] gap-3">
        <Migas
          migas={[
            { texto: origen.texto, onClick: volver },
            { texto: ficha?.id === foco.id ? ficha.expediente : foco.id, mono: true },
          ]}
        />
        <FichaLicitacion
          key={`${foco.id}/${foco.seccion ?? ''}#${foco.bloqueo ?? ''}${foco.testid ?? ''}`}
          id={foco.id}
          seccionInicial={foco.seccion}
          foco={foco}
          version={version}
          onVolver={isSmall ? volver : undefined}
          onCambio={() => {}}
          onCargada={setFicha}
          onVerCompetidor={(nif) => ruta.ir('mercado', 'competidores', nif)}
          onVerOrganismo={(nif) => ruta.ir('mercado', 'organismos', nif)}
        />
      </div>
    </div>
  );
}
