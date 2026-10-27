// «Deshacer el último cambio» de las decisiones: enseña antes su propia vista previa
// de «Qué cambia» y solo deshace al confirmarla. Sin vista previa no se deshace: si el cálculo
// falla se dice y se puede volver a intentar. El servidor no encola nada al deshacer (las piezas
// que aún no se rehicieron vuelven a casar con lo que llevan). Lo monta el cajón Decisiones.
import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import useCarga from '../../../hooks/useCarga';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import {
  clasificarImpacto,
  estadoParaConfirmar,
  pideConfirmacionFuerte,
  textoConfirmacionFuerte,
} from '../../../lib/impactoFormato';
import { Aviso, Boton } from '../../ui';
import QueCambia from './QueCambia';

function vistaDe(r, comprobaciones) {
  const { data, error } = clasificarImpacto(r);
  if (error) return { error };
  const o = estadoParaConfirmar({ comprobaciones, impacto: r });
  return { clasificacion: data, confirmacion: pideConfirmacionFuerte(o) ? textoConfirmacionFuerte(o) : null };
}

function useDeshacer(id, version, { comprobaciones, alDeshacer }) {
  const [vista, setVista] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const previa = async () => {
    setAviso(null);
    setOcupado(true);
    try {
      const v = vistaDe(await licitacionesApi.impacto(id, { deshacer: true }), comprobaciones);
      if (v.error) setAviso({ tono: 'error', texto: `No se pudo calcular qué cambia al deshacer: ${v.error}` });
      else setVista(v);
    } catch (e) {
      setAviso({ tono: 'error', texto: `No se pudo calcular qué cambia al deshacer: ${e.message}` });
    } finally {
      setOcupado(false);
    }
  };
  const aplicar = async () => {
    setOcupado(true);
    try {
      const r = await licitacionesApi.deshacerDecisiones(id, version);
      setVista(null);
      setAviso({ tono: 'info', texto: `Deshecho: vuelven las decisiones de la v${r?.restaurada ?? version - 1}.` });
      alDeshacer?.(r);
    } catch (e) {
      setAviso({ tono: 'error', texto: e.message });
    } finally {
      setOcupado(false);
    }
  };
  return { vista, aviso, ocupado, previa, aplicar, cancelar: () => setVista(null) };
}

/** Visible solo si el historial tiene una versión anterior a la vigente. */
export default function DeshacerCambio({ id, comprobaciones = null, alDeshacer = null, recarga = 0 }) {
  const historial = useCarga(() => licitacionesApi.historialDecisiones(id), [id], recarga);
  const versiones = historial.kind === 'ready' && Array.isArray(historial.data) ? historial.data : [];
  const d = useDeshacer(id, versiones[0]?.version, {
    comprobaciones,
    alDeshacer: (r) => {
      historial.recargar();
      alDeshacer?.(r);
    },
  });
  if (versiones.length < 2 && !d.aviso) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {versiones.length >= 2 && !d.vista && (
        <div>
          <Boton Icono={Undo2} testid="deshacer" onClick={d.previa} cargando={d.ocupado}>
            Deshacer el último cambio
          </Boton>
        </div>
      )}
      {d.vista && (
        <QueCambia
          c={d.vista.clasificacion}
          confirmacion={d.vista.confirmacion}
          ocupado={d.ocupado}
          onRehacer={d.aplicar}
          onCancelar={d.cancelar}
          textoRehacer={`Volver a la v${versiones[1].version}`}
        />
      )}
      {d.aviso && (
        <div data-testid="deshacer-aviso">
          <Aviso tono={d.aviso.tono}>{d.aviso.texto}</Aviso>
        </div>
      )}
    </div>
  );
}
