// El estado de la oferta, arriba de la Oferta y de la Revisión: el veredicto (lo dice el servidor,
// la web no lo recalcula), el plazo (con la hora de Canarias si la empresa está allí), el cierre interno, los minutos de
// persona, los lotes y lo que Hermes está haciendo. «Siguiente tarea →» salta a la siguiente de la
// Mesa sin volver al Pipeline.
import { useContext, useState } from 'react';
import { TINTA, TINTA_2, OK_TEXTO, RIESGO, IMPIDE, LIENZO, BORDE, RADIUS_PANEL } from '../../../lib/tema';
import { textoCierreInterno, textoMinutos } from '../../../lib/comprobacionesFormato';
import { licitacionesApi } from '../../../lib/licitacionesApi';
import { siguienteTarea } from '../../../lib/mesaFormato';
import { SIGUIENTE_TAREA, VEREDICTO } from '../../../lib/idsPrueba';
import { CambiosContext } from '../../../hooks/useCambiosSinGuardar';
import { irAHash } from '../../../hooks/useRuta';
import { Boton, Chip } from '../../ui';
import { Plazo } from '../../comun/ui';
import HermesEnVivo from './HermesEnVivo';

const COLOR_VEREDICTO = {
  descartada: TINTA_2,
  no_presentable: IMPIDE,
  faltan_decisiones: RIESGO,
  hermes_trabajando: TINTA_2,
  presentable_con_riesgos: RIESGO,
  lista_para_firmar: OK_TEXTO,
};

function Veredicto({ veredicto }) {
  const color = COLOR_VEREDICTO[veredicto.tipo] ?? TINTA_2;
  return (
    <div
      data-testid={VEREDICTO}
      data-estado={veredicto.tipo}
      role="status"
      style={{ fontSize: 15, fontWeight: 700, color: TINTA, borderLeft: `4px solid ${color}`, paddingLeft: 10 }}
    >
      {veredicto.texto}
    </div>
  );
}

// La Mesa se lee al pulsar: es la de ese momento y no cuesta nada si no se usa. Con cambios sin
// guardar en el detalle de la oferta, pregunta antes de salir (pedirSalida).
function SiguienteTarea({ id }) {
  const pedirSalida = useContext(CambiosContext)?.pedirSalida;
  const [estado, setEstado] = useState({ ocupado: false, aviso: null });
  const saltar = async () => {
    setEstado({ ocupado: true, aviso: null });
    try {
      const t = siguienteTarea(await licitacionesApi.mesa(), id);
      setEstado({ ocupado: false, aviso: t ? null : 'No queda otra tarea en la Mesa.' });
      if (!t) return;
      const navegar = () => irAHash(t.ruta);
      if (pedirSalida) pedirSalida(navegar);
      else navegar();
    } catch (e) {
      setEstado({ ocupado: false, aviso: `No se pudo leer la Mesa: ${e.message}` });
    }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
      {estado.aviso && (
        <span data-testid="siguiente-tarea-aviso" role="status" style={{ fontSize: 12.5, color: TINTA_2 }}>
          {estado.aviso}
        </span>
      )}
      <Boton testid={SIGUIENTE_TAREA} cargando={estado.ocupado} onClick={saltar}>
        Siguiente tarea →
      </Boton>
    </span>
  );
}

function Plazos({ f, c, completa }) {
  const cierre = textoCierreInterno(c.hora_interna_cierre);
  const minutos = completa ? textoMinutos(c.minutos_persona) : null;
  const lotes = (f.lotes_interes ?? []).map((l) => l.id).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, color: TINTA_2 }}>
      <Plazo fechaLimite={f.fecha_limite} fechaSolicitud={f.fecha_solicitud} peninsular />
      {cierre && <span data-testid="cierre-interno">{cierre}</span>}
      {minutos && <span data-testid="minutos-persona">{minutos}</span>}
      {lotes.map((id) => (
        <Chip key={id} testid={`lote-decidido-${id}`}>
          Lote {id}
        </Chip>
      ))}
    </div>
  );
}

/** modo: el de modoComprobaciones; una oferta descartada no tiene a Hermes trabajando. extra: botones de la pestaña. */
export default function EstadoOferta({ f, c, modo, extra = null }) {
  return (
    <section
      aria-label="Estado de la oferta"
      data-testid="estado-oferta"
      style={{
        background: LIENZO,
        border: `1px solid ${BORDE}`,
        borderRadius: RADIUS_PANEL,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Veredicto veredicto={c.veredicto} />
        <SiguienteTarea id={f.id} />
      </div>
      <Plazos f={f} c={c} completa={modo === 'completa'} />
      {extra}
      {modo !== 'solo_lectura' && <HermesEnVivo id={f.id} fases={c.fases} />}
    </section>
  );
}
