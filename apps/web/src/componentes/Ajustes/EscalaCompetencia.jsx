// La escala de los rankings de competencia (competencia/escala.ts en el servidor): el territorio y la
// banda de presupuesto con que se abren Mercado › Competidores y Organismos. Va aparte del prefiltro,
// que decide qué entra en el radar.
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { licitacionesApi } from '../../lib/licitacionesApi';
import { escalaAFormulario, formularioAEscala, opcionesRegion } from '../../lib/escalaFormulario';
import { Aviso, Boton, Campo, Entrada, Selector, Tarjeta } from '../ui';

export default function EscalaCompetencia() {
  const [valores, setValores] = useState(null);
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    licitacionesApi.escalaCompetencia().then(
      (e) => setValores(escalaAFormulario(e)),
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  }, []);
  const set = (k) => (e) => setValores((v) => ({ ...v, [k]: e.target.value }));
  const guardar = () => {
    const { escala, errores } = formularioAEscala(valores);
    if (errores.length) {
      setAviso({ tono: 'error', texto: errores.join(' ') });
      return;
    }
    licitacionesApi.guardarEscalaCompetencia(escala).then(
      (e) => {
        setValores(escalaAFormulario(e));
        setAviso({ tono: 'ok', texto: 'Guardada: los rankings se abren ya a esta escala.' });
      },
      (e) => setAviso({ tono: 'error', texto: e.message }),
    );
  };
  return (
    <Tarjeta
      titulo="Escala de los rankings"
      subtitulo="Competidores y Organismos se abren en este territorio y esta banda de presupuesto; «Toda España» y «Todos los importes» los quitan en cada vista."
      testid="escala-competencia"
    >
      {valores && (
        <>
          <div className="flex flex-wrap gap-3">
            <div style={{ flex: '2 1 220px' }}>
              <Campo etiqueta="Territorio">
                <Selector
                  opciones={opcionesRegion(valores.region_nuts).map(([valor, texto]) => ({ valor, texto }))}
                  value={valores.region_nuts}
                  onChange={set('region_nuts')}
                  data-testid="escala-region"
                />
              </Campo>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Campo etiqueta="Banda desde" ayuda="€ sin IVA">
                <Entrada
                  inputMode="decimal"
                  value={valores.banda_min}
                  onChange={set('banda_min')}
                  data-testid="escala-banda-min"
                />
              </Campo>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Campo etiqueta="hasta" ayuda="€ sin IVA">
                <Entrada
                  inputMode="decimal"
                  value={valores.banda_max}
                  onChange={set('banda_max')}
                  data-testid="escala-banda-max"
                />
              </Campo>
            </div>
          </div>
          <p className="m-0 mb-3 text-leyenda text-tinta-2">
            La banda vale mientras no haya 5 propuestas presentadas; después se calcula con ellas (percentiles 10 y 90).
            Vacía, todos los importes.
          </p>
          <Boton variante="principal" Icono={Save} onClick={guardar} testid="escala-guardar">
            Guardar escala
          </Boton>
        </>
      )}
      {aviso && (
        <div className="mt-3">
          <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}
