// Guardar pasando antes por «Qué cambia»: pide el impacto y, si todo se regenera
// por código con 0 runs, guarda sin preguntar y deja un aviso en línea; si cuesta runs o pierde
// algo, abre el panel (QueCambia). Si el cálculo falla no guarda a ciegas: pregunta si guardar y
// marcar todo para revisar, que es lo único seguro sin saber qué cambia.
// `guardar(tras)` es de quien llama (tras: 'rehacer' | 'marcar'); `calcular()` sustituye al
// impacto de una oferta (el perfil de empresa lo pide a varias).
import { useState } from 'react';
import { licitacionesApi } from '../lib/licitacionesApi';
import { avisoTrasGuardar, pasoTrasImpacto, TEXTO_FALLO_IMPACTO } from '../lib/impactoFormato';

const QUIETO = { fase: 'quieto' };

export default function useGuardarConImpacto(id, { cambio = null, guardar, comprobaciones = null, calcular = null }) {
  const [estado, setEstado] = useState(QUIETO);
  const [aviso, setAviso] = useState(null);

  const aplicar = async (tras, previo = estado) => {
    setEstado({ ...previo, guardando: true });
    try {
      await guardar(tras);
      // tras y clasificacion van con el aviso: PanelImpacto lo rehace si pide él los apartados.
      setAviso({
        tono: 'info',
        texto: avisoTrasGuardar(tras, previo.clasificacion),
        tras,
        clasificacion: previo.clasificacion ?? null,
      });
      setEstado(QUIETO);
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
      // Si el guardado directo falla, el panel deja ver qué cambiaba y volver a intentarlo.
      setEstado(previo.fase === 'directo' ? { ...previo, fase: 'panel' } : previo);
    }
  };

  const iniciar = async (cambioAhora = cambio) => {
    setAviso(null);
    setEstado({ fase: 'calculando' });
    let siguiente;
    try {
      siguiente = pasoTrasImpacto(
        await (calcular ? calcular(cambioAhora) : licitacionesApi.impacto(id, { cambio: cambioAhora })),
        comprobaciones,
      );
    } catch (e) {
      siguiente = { fase: 'fallo', texto: TEXTO_FALLO_IMPACTO, detalle: e.message };
    }
    if (siguiente.fase === 'directo') return aplicar('rehacer', siguiente);
    return setEstado(siguiente);
  };

  return {
    estado,
    aviso,
    iniciar,
    ocupado: estado.fase === 'calculando' || Boolean(estado.guardando),
    rehacer: () => aplicar('rehacer'),
    marcar: () => aplicar('marcar'),
    cancelar: () => setEstado(QUIETO),
  };
}
